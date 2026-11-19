"""
backend/rag/schemas.py
Data structures for the RAG pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CodeChunk:
    """
    Represents a searchable snippet of source code.

    Fields
    ------
    id : str
        Unique identifier (usually a UUID hex string).
    file_path : str
        Source file this chunk was extracted from.
    start_line : int
        1-indexed starting line number.
    end_line : int
        1-indexed ending line number.
    content : str
        The actual source code snippet.
    chunk_type : str
        e.g., "function", "class", "generic".
    file_hash : str
        SHA-256 hash of the parent file content (used for staleness checks).
    """
    id: str
    file_path: str
    start_line: int
    end_line: int
    content: str
    chunk_type: str
    file_hash: str
