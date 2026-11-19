"""
backend/ast_analysis/python_extractor.py
Extracts structural information from Python ASTs using tree-sitter queries.
"""

from __future__ import annotations

from tree_sitter import Tree, Node
import tree_sitter_python
from tree_sitter import Language
from .schemas import FunctionInfo, ClassInfo
from typing import Any, Dict



class PythonExtractor:
    """AST visitor/query engine for Python."""

    def __init__(self):
        self.language = Language(tree_sitter_python.language())  # type: ignore

    def extract_imports(self, tree: Tree, source: bytes) -> list[str]:
        """Extract all import statements."""
        query = self.language.query("""
            (import_statement) @import
            (import_from_statement) @import
        """)
        imports = []
        for node, _ in query.captures(tree.root_node):
            imports.append(self._get_text(node, source))
        return imports

    def extract_functions(self, tree: Tree, source: bytes) -> list[FunctionInfo]:
        """Extract top-level functions (not methods inside classes)."""
        query = self.language.query("""
            (module (function_definition 
                name: (identifier) @name
            ) @func)
        """)
        
        funcs = []
        captures = query.captures(tree.root_node)
        
        # Group captures by function node
        func_nodes: Dict[int, Dict[str, Any]] = {}
        for node, capture_name in captures:
            if capture_name == "func":
                func_nodes[node.id] = {"node": node}
            elif capture_name == "name":
                # Find parent func
                p = node.parent
                while p and p.type != "function_definition":
                    p = p.parent
                if p and p.id in func_nodes:
                    func_nodes[p.id]["name"] = self._get_text(node, source) # type: ignore

        for data in func_nodes.values():
            if "name" in data:
                funcs.append(self._build_function_info(data["node"], data["name"], source))

        return funcs

    def extract_classes(self, tree: Tree, source: bytes) -> list[ClassInfo]:
        """Extract classes and their methods."""
        
        # 1. Find all classes
        class_query = self.language.query("""
            (class_definition 
                name: (identifier) @name
            ) @class
        """)
        
        classes = []
        captures = class_query.captures(tree.root_node)
        
        class_nodes: Dict[int, Dict[str, Any]] = {}
        for node, capture_name in captures:
            if capture_name == "class":
                class_nodes[node.id] = {"node": node}
            elif capture_name == "name":
                p = node.parent
                while p and p.type != "class_definition":
                    p = p.parent
                if p and p.id in class_nodes:
                    class_nodes[p.id]["name"] = self._get_text(node, source) # type: ignore

        # 2. Extract details
        for data in class_nodes.values():
            if "name" not in data:
                continue
                
            node = data["node"]
            name = data["name"]
            
            bases = self._extract_bases(node, source)
            methods = self._extract_methods(node, source)
            
            classes.append(ClassInfo(
                name=name,
                start_line=node.start_point[0],
                end_line=node.end_point[0],
                bases=bases,
                methods=methods
            ))

        return classes

    def get_function_at_line(self, tree: Tree, source: bytes, line: int) -> FunctionInfo | None:
        """Find the smallest function containing the given 0-indexed line."""
        
        # Simple walk to find the narrowest matching function node
        best_node = None
        best_name = ""
        
        def traverse(node: Node):
            nonlocal best_node, best_name
            if node.start_point[0] <= line <= node.end_point[0]:
                if node.type == "function_definition":
                    best_node = node
                    # Find name identifier
                    for child in node.children:
                        if child.type == "identifier":
                            best_name = self._get_text(child, source)
                            break
                for child in node.children:
                    traverse(child)

        traverse(tree.root_node)
        
        if best_node and best_name:
            return self._build_function_info(best_node, best_name, source)
        return None

    # ── Internal Helpers ───────────────────────────────────────────────────

    def _get_text(self, node: Node, source: bytes) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8") # type: ignore

    def _build_function_info(self, node: Node, name: str, source: bytes) -> FunctionInfo:
        """Construct a FunctionInfo object from a function_definition node."""
        params = []
        return_type = None
        docstring = None

        # Parse children
        for child in node.children:
            if child.type == "parameters":
                params_text = self._get_text(child, source)
                # Remove parens
                if params_text.startswith("(") and params_text.endswith(")"):
                    params_text = params_text[1:-1] # type: ignore
                if params_text.strip():
                    params = [p.strip() for p in params_text.split(",")]
            elif child.type == "type":
                return_type = self._get_text(child, source)
            elif child.type == "block":
                # Check first statment for docstring (expression_statement -> string)
                if child.children and child.children[0].type == "expression_statement":
                    expr = child.children[0]
                    if expr.children and expr.children[0].type == "string":
                        docstring = self._get_text(expr.children[0], source).strip('\'"')

        return FunctionInfo(
            name=name,
            start_line=node.start_point[0],
            end_line=node.end_point[0],
            parameters=params,
            return_type=return_type,
            docstring=docstring
        )

    def _extract_bases(self, class_node: Node, source: bytes) -> list[str]:
        bases = []
        for child in class_node.children:
            if child.type == "argument_list":
                bases_text = self._get_text(child, source)
                if bases_text.startswith("(") and bases_text.endswith(")"):
                    bases_text = bases_text[1:-1] # type: ignore
                if bases_text.strip():
                    bases = [b.strip() for b in bases_text.split(",")]
        return bases

    def _extract_methods(self, class_node: Node, source: bytes) -> list[FunctionInfo]:
        methods = []
        for child in class_node.children:
            if child.type == "block":
                for stmt in child.children:
                    if stmt.type == "function_definition":
                        name = ""
                        for b_child in stmt.children:
                            if b_child.type == "identifier":
                                name = self._get_text(b_child, source)
                                break
                        if name:
                            methods.append(self._build_function_info(stmt, name, source))
        return methods
