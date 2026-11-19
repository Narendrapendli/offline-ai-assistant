"""
backend/ast_analysis/cpp_extractor.py
Extracts structural information from C/C++ ASTs using tree-sitter queries.
"""

from __future__ import annotations

from tree_sitter import Tree, Node, Language
import tree_sitter_cpp
from .schemas import FunctionInfo, ClassInfo
from typing import Any, Dict, List, Optional



class CppExtractor:
    """AST visitor/query engine for C/C++."""

    def __init__(self):
        self.language = Language(tree_sitter_cpp.language())  # type: ignore

    def extract_imports(self, tree: Tree, source: bytes) -> list[str]:
        """Extract #include directives."""
        query = self.language.query("""
            (preproc_include) @include
        """)
        return [self._get_text(node, source) for node, _ in query.captures(tree.root_node)]

    def extract_functions(self, tree: Tree, source: bytes) -> list[FunctionInfo]:
        """Extract top-level functions."""
        query = self.language.query("""
            (function_definition
                declarator: (function_declarator
                    declarator: (identifier) @name
                )
            ) @func
        """)
        
        funcs = []
        captures = query.captures(tree.root_node)
        
        func_nodes: Dict[int, Dict[str, Any]] = {}
        for node, capture_name in captures:
            if capture_name == "func":
                func_nodes[node.id] = {"node": node}
            elif capture_name == "name":
                p = node.parent
                while p and p.type != "function_definition":
                    p = p.parent
                if p and p.id in func_nodes:
                    data = func_nodes[p.id]
                    data["name"] = self._get_text(node, source)

        for data in func_nodes.values():
            if "name" in data:
                funcs.append(self._build_function_info(data["node"], data["name"], source))

        return funcs

    def extract_classes(self, tree: Tree, source: bytes) -> list[ClassInfo]:
        """Extract classes and structs."""
        query = self.language.query("""
            (class_specifier
                name: (type_identifier) @name
            ) @class
            (struct_specifier
                name: (type_identifier) @name
            ) @struct
        """)
        
        classes = []
        captures = query.captures(tree.root_node)
        
        class_nodes: Dict[int, Dict[str, Any]] = {}
        for node, capture_name in captures:
            if capture_name in ("class", "struct"):
                class_nodes[node.id] = {"node": node}
            elif capture_name == "name":
                p = node.parent
                while p and p.type not in ("class_specifier", "struct_specifier"):
                    p = p.parent
                if p and p.id in class_nodes:
                    data = class_nodes[p.id]
                    data["name"] = self._get_text(node, source)

        for data in class_nodes.values():
            if "name" not in data:
                continue
                
            node = data["node"]
            name = data["name"]
            
            methods = self._extract_methods(node, source)
            
            classes.append(ClassInfo(
                name=name,
                start_line=node.start_point[0],
                end_line=node.end_point[0],
                bases=[],  # Simplified: not extracting inheritance yet
                methods=methods
            ))

        return classes

    def get_function_at_line(self, tree: Tree, source: bytes, line: int) -> FunctionInfo | None:
        """Find the smallest function containing the given 0-indexed line."""
        best_node = None
        best_name = ""
        
        def traverse(node: Node):
            nonlocal best_node, best_name
            if node.start_point[0] <= line <= node.end_point[0]:
                if node.type == "function_definition":
                    best_node = node
                    # Find name identifier
                    for child in node.children:
                        if child.type == "function_declarator":
                            for gc in child.children:
                                if gc.type == "identifier":
                                    best_name = self._get_text(gc, source)
                                    break
                for child in node.children:
                    traverse(child)

        traverse(tree.root_node)
        
        if best_node and best_name:
            return self._build_function_info(best_node, best_name, source)
        return None

    # ── Internal Helpers ───────────────────────────────────────────────────

    def _get_text(self, node: Node, source: bytes) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8")

    def _build_function_info(self, node: Node, name: str, source: bytes) -> FunctionInfo:
        params = []
        return_type = None

        # Look for the return type (first child of function_definition usually)
        for child in node.children:
            if child.type == "primitive_type" or child.type == "type_identifier":
                return_type = self._get_text(child, source)
            elif child.type == "function_declarator":
                # Find parameter_list inside declarator
                for gc in child.children:
                    if gc.type == "parameter_list":
                        p_text = self._get_text(gc, source)
                        if p_text.startswith("(") and p_text.endswith(")"):
                            p_text = p_text[1:-1] # type: ignore
                        if p_text.strip():
                            params = [p.strip() for p in p_text.split(",")]

        return FunctionInfo(
            name=name,
            start_line=node.start_point[0],
            end_line=node.end_point[0],
            parameters=params,
            return_type=return_type,
            docstring=None  # C++ docstrings are usually comments before the node
        )

    def _extract_methods(self, class_node: Node, source: bytes) -> list[FunctionInfo]:
        methods = []
        for child in class_node.children:
            if child.type == "field_declaration_list":
                for stmt in child.children:
                    if stmt.type == "function_definition":
                        name = ""
                        # Find name inside declarator
                        for b_child in stmt.children:
                            if b_child.type == "function_declarator":
                                for gc in b_child.children:
                                    if gc.type == "identifier":
                                        name = self._get_text(gc, source)
                                        break
                        if name:
                            methods.append(self._build_function_info(stmt, name, source))
        return methods
