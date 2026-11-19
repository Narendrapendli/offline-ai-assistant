"""
backend/context/import_extractor.py
Extracts import / include statements from source files.

These are prepended to code context so the LLM understands the dependencies
available in scope without repeating the full file content.
"""

from __future__ import annotations

import re


class ImportExtractor:
    """
    Utility for extracting dependency declarations from source files.

    Supports Python (import / from … import) and C/C++ (#include …).
    Additional languages can be added as new methods.
    """

    # ── Python ────────────────────────────────────────────────────────────

    def extract_python_imports(self, content: str) -> list[str]:
        """
        Return all ``import`` and ``from … import`` lines from Python source.

        Multi-line imports (with trailing ``\\``) are joined into a single
        logical line. Only the first 100 import lines are returned to cap size.

        Parameters
        ----------
        content : str
            Full Python source file text.

        Returns
        -------
        list[str]
            Import lines in their original order, stripped of surrounding
            whitespace.

        Examples
        --------
        >>> ie = ImportExtractor()
        >>> lines = ie.extract_python_imports("import os\\nfrom pathlib import Path\\nx = 1")
        >>> lines
        ['import os', 'from pathlib import Path']
        """
        if not content:
            return []

        results: list[str] = []
        raw_lines = content.splitlines()
        i = 0

        while i < len(raw_lines) and len(results) < 100:
            line = raw_lines[i].rstrip()

            # Detect import start
            stripped = line.lstrip()
            if stripped.startswith(("import ", "from ")):
                # Handle line continuation with backslash
                logical = line
                while logical.endswith("\\") and i + 1 < len(raw_lines):
                    i += 1
                    logical = logical[:-1] + raw_lines[i].strip()  # type: ignore

                # Handle parenthesised multi-line import
                if "(" in logical and ")" not in logical:
                    while i + 1 < len(raw_lines):
                        i += 1
                        cont = raw_lines[i].strip()
                        logical += " " + cont
                        if ")" in cont:
                            break

                results.append(logical.strip())

            i += 1

        return results

    # ── C / C++ ───────────────────────────────────────────────────────────

    def extract_cpp_includes(self, content: str) -> list[str]:
        """
        Return all ``#include`` preprocessor directives from C/C++ source.

        Skips blank lines and comments between includes but does not parse
        conditional compilation blocks (``#ifdef``, etc.).

        Parameters
        ----------
        content : str
            Full C/C++ source file text.

        Returns
        -------
        list[str]
            ``#include`` lines in their original order.

        Examples
        --------
        >>> ie = ImportExtractor()
        >>> lines = ie.extract_cpp_includes('#include <stdio.h>\\nint main() {}')
        >>> lines
        ['#include <stdio.h>']
        """
        if not content:
            return []

        _INCLUDE_RE = re.compile(r'^\s*#\s*include\s*[<"].*[>"]', re.MULTILINE)
        return [m.group(0).strip() for m in _INCLUDE_RE.finditer(content)]

    # ── TypeScript / JavaScript ───────────────────────────────────────────

    def extract_js_imports(self, content: str) -> list[str]:
        """
        Return ES module ``import`` statements and CommonJS ``require`` calls.

        Parameters
        ----------
        content : str
            Full JS/TS source file text.

        Returns
        -------
        list[str]
            Import / require lines in original order, limited to 100.
        """
        if not content:
            return []

        _IMPORT_RE = re.compile(
            r"^\s*(import\s.+?['\"];|const\s+\w+\s*=\s*require\s*\(['\"].*?['\"]\);)",
            re.MULTILINE,
        )
        return [m.group(0).strip() for m in _IMPORT_RE.finditer(content)][:100]  # type: ignore

    # ── Generic dispatcher ────────────────────────────────────────────────

    def extract(self, content: str, language: str) -> list[str]:
        """
        Dispatch to the appropriate language-specific extractor.

        Parameters
        ----------
        content : str
            Source file text.
        language : str
            Language identifier (e.g. ``"python"``, ``"cpp"``).

        Returns
        -------
        list[str]
            Extracted import / include lines.
        """
        lang = language.lower()
        if lang == "python":
            return self.extract_python_imports(content)
        if lang in {"c", "cpp", "c++"}:
            return self.extract_cpp_includes(content)
        if lang in {"javascript", "typescript", "js", "ts", "tsx", "jsx"}:
            return self.extract_js_imports(content)
        return []
