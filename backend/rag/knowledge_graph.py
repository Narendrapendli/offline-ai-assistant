import os
import re
from typing import Dict, List, Set

class KnowledgeGraph:
    def __init__(self):
        self.adj = {} # {file: [connected_files]}

    def build_graph(self, project_path: str):
        self.adj = {}
        for root, _, files in os.walk(project_path):
            for file in files:
                if file.endswith(('.py', '.cpp', '.h', '.ts', '.js')):
                    path = os.path.relpath(os.path.join(root, file), project_path)
                    self.adj[path] = self._extract_imports(os.path.join(root, file), project_path)

    def _extract_imports(self, file_path: str, project_path: str) -> List[str]:
        imports = []
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Python: from x import y, import x
                py_imports = re.findall(r'^(?:from|import)\s+([\w\.]+)', content, re.M)
                # C++: #include "x.h"
                cpp_imports = re.findall(r'#include\s+"([^"]+)"', content)
                # TS/JS: import x from 'y'
                ts_imports = re.findall(r'from\s+[\'"](.+)[\'"]', content)

                for imp in py_imports + cpp_imports + ts_imports:
                    # Logic to resolve path would normally be here
                    imports.append(imp)
        except:
            pass
        return list(set(imports))

    def get_subgraph(self, file_path: str, depth: int = 2) -> Dict[str, List[str]]:
        subgraph = {}
        queue = [(file_path, 0)]
        visited = {file_path}

        while queue:
            node, d = queue.pop(0)
            if d >= depth: continue
            
            neighbors = self.adj.get(node, [])
            subgraph[node] = neighbors
            for n in neighbors:
                if n not in visited:
                    visited.add(n)
                    queue.append((n, d+1))
        return subgraph

    def to_mermaid(self, subgraph: Dict[str, List[str]]) -> str:
        lines = ["graph TD"]
        for node, neighbors in subgraph.items():
            node_clean = node.replace('.', '_').replace('/', '_')
            for n in neighbors:
                n_clean = n.replace('.', '_').replace('/', '_')
                lines.append(f'    {node_clean}["{node}"] --> {n_clean}["{n}"]')
        return "\n".join(lines)

global_graph = KnowledgeGraph()
