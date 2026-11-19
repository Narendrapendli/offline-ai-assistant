"""
backend/rag/file_chunker.py
Splits source files into semantic chunks (functions, classes) or generic sliding windows.
"""

from __future__ import annotations

import re
import hashlib
from typing import List
from .schemas import CodeChunk


# Target tokens per chunk (approximate using chars)
MIN_CHARS = 200 * 3.5  # ~200 tokens
MAX_CHARS = 400 * 3.5  # ~400 tokens


class FileChunker:
    """Methods to chunk source files based on semantic boundaries."""

    @staticmethod
    def compute_hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def chunk_file(self, content: str, path: str) -> list[CodeChunk]:
        """Dispatch based on extension."""
        if not content.strip():
            return []

        lower_path = path.lower()
        if lower_path.endswith((".py", ".pyw")):
            return self.chunk_python_file(content, path)
        if lower_path.endswith((".c", ".cpp", ".cc", ".cxx", ".h", ".hpp")):
            return self.chunk_cpp_file(content, path)

        return self.chunk_generic_file(content, path)

    def chunk_python_file(self, content: str, path: str) -> list[CodeChunk]:
        """Chunk on `def` and `class` boundaries."""
        file_hash = self.compute_hash(content)
        lines = content.splitlines(keepends=True)
        chunks: list[CodeChunk] = []

        # Simple regex for top-level or slightly indented defs/classes
        boundary_re = re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+\w+")
        
        current_block: List[str] = []
        start_line = 1
        
        for i, line in enumerate(lines, start=1):
            # If we hit a boundary AND we have accumulated enough content, yield the block
            if boundary_re.match(line) and sum(len(x) for x in current_block) > MIN_CHARS:
                _body = "".join(current_block)
                chunks.append(CodeChunk(
                    id="",  # Assigned by pipeline
                    file_path=path,
                    start_line=start_line,
                    end_line=i - 1,
                    content=_body.strip(),
                    chunk_type="python_semantic",
                    file_hash=file_hash
                ))
                current_block = []
                start_line = i

            current_block.append(line)

            # If current block gets too big, forcefully split it
            if sum(len(x) for x in current_block) > MAX_CHARS:
                _body = "".join(current_block)
                chunks.append(CodeChunk(
                    id="",
                    file_path=path,
                    start_line=start_line,
                    end_line=i,
                    content=_body.strip(),
                    chunk_type="python_large",
                    file_hash=file_hash
                ))
                current_block = []
                start_line = i + 1

        # Yield whatever is left
        if current_block and "".join(current_block).strip():
            chunks.append(CodeChunk(
                id="",
                file_path=path,
                start_line=start_line,
                end_line=len(lines),
                content="".join(current_block).strip(),
                chunk_type="python_semantic",
                file_hash=file_hash
            ))

        return chunks

    def chunk_cpp_file(self, content: str, path: str) -> list[CodeChunk]:
        """Simple syntax block splitting for C++."""
        file_hash = self.compute_hash(content)
        lines = content.splitlines(keepends=True)
        chunks: list[CodeChunk] = []

        # Look for closing brace on its own line as a boundary heuristic
        boundary_re = re.compile(r"^\s*\}\s*;?\s*$")

        current_block: List[str] = []
        start_line = 1

        for i, line in enumerate(lines, start=1):
            current_block.append(line)
            is_boundary = boundary_re.match(line)
            size = sum(len(x) for x in current_block)

            if (is_boundary and size > MIN_CHARS) or size > MAX_CHARS:
                _body = "".join(current_block)
                chunks.append(CodeChunk(
                    id="",
                    file_path=path,
                    start_line=start_line,
                    end_line=i,
                    content=_body.strip(),
                    chunk_type="cpp_semantic" if is_boundary else "cpp_large",
                    file_hash=file_hash
                ))
                current_block = []
                start_line = i + 1

        if current_block and "".join(current_block).strip():
            chunks.append(CodeChunk(
                id="",
                file_path=path,
                start_line=start_line,
                end_line=len(lines),
                content="".join(current_block).strip(),
                chunk_type="cpp_semantic",
                file_hash=file_hash
            ))

        return chunks

    def chunk_generic_file(self, content: str, path: str, size: int = 300) -> list[CodeChunk]:
        """Sliding window chunking based on lines."""
        file_hash = self.compute_hash(content)
        lines = content.splitlines(keepends=True)
        chunks: list[CodeChunk] = []
        
        # Approximate 300 tokens ~ 1000 chars. Let's just bundle lines until 1000 chars.
        TARGET_CHARS = size * 3.5
        
        current_block: List[str] = []
        start_line = 1

        
        for i, line in enumerate(lines, start=1):
            current_block.append(line)
            if sum(len(x) for x in current_block) >= TARGET_CHARS:
                _body = "".join(current_block)
                chunks.append(CodeChunk(
                    id="",
                    file_path=path,
                    start_line=start_line,
                    end_line=i,
                    content=_body.strip(),
                    chunk_type="generic_window",
                    file_hash=file_hash
                ))
                # Add overlap of ~2 lines
                overlap: List[str] = current_block[-2:] if len(current_block) >= 2 else []
                current_block = overlap
                start_line = i - len(overlap) + 1

        if current_block and "".join(current_block).strip():
            chunks.append(CodeChunk(
                id="",
                file_path=path,
                start_line=start_line,
                end_line=len(lines),
                content="".join(current_block).strip(),
                chunk_type="generic_window",
                file_hash=file_hash
            ))

        return chunks
