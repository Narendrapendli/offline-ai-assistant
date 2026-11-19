"""
backend/ast_analysis/ast_parser.py
Loads Tree-sitter grammars and orchestrates AST parsing.
"""

from __future__ import annotations

import tree_sitter
from tree_sitter import Parser, Tree
import tree_sitter_python
import tree_sitter_cpp
from ..core.logger import get_logger

logger = get_logger(__name__)



class ASTParser:
    """
    Manages tree-sitter parsing.
    Includes a simple in-memory cache keyed by file path and content hash.
    """

    def __init__(self):
        self._parsers: dict[str, Parser] = {}
        self._cache: dict[str, tuple[int, Tree]] = {}  # {path: (content_hash, tree)}
        self._init_parsers()

    def _init_parsers(self) -> None:
        """Initialize parsers for Python and C++."""
        try:
            from tree_sitter import Language
            
            # Python parser
            py_lang = Language(tree_sitter_python.language())
            self._parsers["python"] = Parser(py_lang)

            # C++ parser
            cpp_lang = Language(tree_sitter_cpp.language())
            self._parsers["cpp"] = Parser(cpp_lang)
            self._parsers["c"] = self._parsers["cpp"]  # Use C++ grammar for C as a fallback
            
            logger.info("AST parsers initialized for Python and C++.")
        except Exception as e:
            logger.error(f"Failed to initialize tree-sitter parsers: {e}")

    def parse(self, content: str, language: str) -> Tree | None:
        """
        Parse raw content into an AST Tree.
        """
        parser = self._parsers.get(language.lower())
        if not parser:
            # Unsupported language
            return None

        try:
            tree = parser.parse(bytes(content, "utf-8"))
            return tree
        except Exception as e:
            logger.error(f"Failed to parse {language} source: {e}")
            return None

    def parse_with_cache(self, path: str, content: str, language: str) -> Tree | None:
        """
        Parse content, reusing the cached AST if the content hash hasn't changed.
        """
        content_hash = hash(content)
        
        if path in self._cache:
            cached_hash, cached_tree = self._cache[path]
            if cached_hash == content_hash:
                return cached_tree

        tree = self.parse(content, language)
        if tree:
            self._cache[path] = (content_hash, tree)

        return tree
