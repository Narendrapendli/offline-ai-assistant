"""
backend/context/code_window_extractor.py
Extracts relevant code windows around the cursor from source file content.

Two strategies:
  1. extract_cursor_window  — fixed n_before / n_after line window
  2. extract_current_function — language-aware function/class boundary detection
"""

from __future__ import annotations

import re
from typing import List


class CodeWindowExtractor:
    """
    Utility for extracting source code snippets relative to a cursor position.

    All line numbers are 0-indexed internally; callers may pass 0-indexed
    or 1-indexed values (use the ``one_indexed`` parameter where noted).
    """

    # ── Public API ────────────────────────────────────────────────────────

    def extract_cursor_window(
        self,
        content: str,
        line: int,
        n_before: int = 50,
        n_after: int = 20,
        one_indexed: bool = False,
    ) -> str:
        """
        Return a slice of *content* spanning *n_before* lines above and
        *n_after* lines below the cursor *line*.

        Parameters
        ----------
        content : str
            Full file text.
        line : int
            Cursor line number (0-indexed by default).
        n_before : int
            Lines to include above the cursor.
        n_after : int
            Lines to include below the cursor.
        one_indexed : bool
            Set True if *line* is 1-indexed.

        Returns
        -------
        str
            Extracted text snippet.
        """
        if not content:
            return ""

        lines = content.splitlines()
        idx = (line - 1) if one_indexed else line
        idx = max(0, min(idx, len(lines) - 1))

        start = max(0, idx - n_before)
        end   = min(len(lines), idx + n_after + 1)

        return "\n".join(lines[start:end])  # type: ignore

    def extract_current_function(
        self,
        content: str,
        line: int,
        language: str = "python",
        one_indexed: bool = False,
    ) -> str:
        """
        Detect and return the body of the function or class that contains
        the cursor at *line*.

        Supports:
        - Python  → indent-based detection
        - C-like  (c, cpp, java, javascript, typescript, go, rust) → brace-matching
        - Fallback → cursor window of 80 lines

        Parameters
        ----------
        content : str
            Full file text.
        line : int
            Cursor line number (0-indexed by default).
        language : str
            Language identifier (e.g. ``"python"``, ``"cpp"``).
        one_indexed : bool
            Set True if *line* is 1-indexed.

        Returns
        -------
        str
            Extracted function / class body. Never exceeds 200 lines.
        """
        if not content:
            return ""

        lines = content.splitlines()
        idx   = (line - 1) if one_indexed else line
        idx   = max(0, min(idx, len(lines) - 1))

        lang = language.lower()
        if lang == "python":
            return self._extract_python_block(lines, idx)
        if lang in {"c", "cpp", "c++", "java", "javascript", "typescript",
                    "go", "rust", "csharp", "cs", "kotlin", "swift"}:
            return self._extract_brace_block(lines, idx)

        # Fallback: simple cursor window
        return self.extract_cursor_window(content, idx, n_before=40, n_after=40)

    # ── Python: indent-based block ────────────────────────────────────────

    def _extract_python_block(self, lines: List[str], cursor: int) -> str:
        """Walk up to find the nearest def/class, then walk down to end of block."""
        _DEF = re.compile(r"^(\s*)(async\s+def|def|class)\s+\w+")

        # Current indent level (use space count)
        cur_indent = self._indent_level(lines[cursor])

        # Search upwards for the enclosing def / class
        start = cursor
        for i in range(cursor, -1, -1):
            m = _DEF.match(lines[i])
            if m:
                block_indent = len(m.group(1))
                if block_indent <= cur_indent:
                    start = i
                    break

        def_indent = self._indent_level(lines[start])

        # Walk downward: block ends when a non-empty line returns to <= def indent
        end = start + 1
        while end < len(lines):
            ln = lines[end]
            if ln.strip() == "":
                end += 1
                continue
            if self._indent_level(ln) <= def_indent and end > start + 1:
                break
            end += 1

        # Cap at 200 lines
        end = min(end, start + 200)
        return "\n".join(lines[start:end])  # type: ignore

    # ── C-like: brace-matching block ──────────────────────────────────────

    def _extract_brace_block(self, lines: List[str], cursor: int) -> str:
        """
        Walk upward from cursor to find the opening brace of the enclosing
        function, then walk downward to the matching closing brace.
        """
        # --- Phase 1: walk up to find the opening `{` ----------------------
        depth   = 0
        start   = 0
        found   = False

        for i in range(cursor, -1, -1):
            for ch in reversed(lines[i]):
                if ch == "}":
                    depth += 1
                elif ch == "{":
                    if depth == 0:
                        start = i
                        found = True
                        break
                    depth -= 1
            if found:
                break

        # --- Phase 2: walk down to the matching `}` -------------------------
        depth = 0
        end   = start

        for i in range(start, len(lines)):
            for ch in lines[i]:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if depth == 0 and i > start:
                end = i
                break

        # One line before `start` is usually the function signature
        sig_start = max(0, int(start) - 3)
        end = min(int(end) + 1, sig_start + 200)
        return "\n".join(lines[sig_start:end])  # type: ignore

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _indent_level(line: str) -> int:
        """Return the number of leading spaces (tabs expanded to 4 spaces)."""
        return len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip())
