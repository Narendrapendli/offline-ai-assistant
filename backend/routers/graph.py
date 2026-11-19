from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from ..rag.knowledge_graph import global_graph
from typing import List

router = APIRouter()

class GraphQuery(BaseModel):
    query: str
    project_path: str

@router.post("/build")
async def build_graph(project_path: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(global_graph.build_graph, project_path)
    return {"status": "build started"}

@router.post("/query")
async def query_graph(data: GraphQuery):
    root_files = list(global_graph.adj.keys())
    root_files = [f for f in root_files if data.query.lower() in f.lower()][:3]
    
    subgraph = {}
    for f in root_files:
        subgraph.update(global_graph.get_subgraph(f, depth=2))
    
    mermaid = global_graph.to_mermaid(subgraph)
    
    return {
        "mermaid": mermaid,
        "files": list(subgraph.keys()),
        "summary": f"Identified {len(root_files)} core files and their immediate dependencies for '{data.query}'."
    }
