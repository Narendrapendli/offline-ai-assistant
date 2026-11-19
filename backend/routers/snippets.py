from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from ..database.snippet_store import SnippetStore

router = APIRouter()
store = SnippetStore()

class SnippetCreate(BaseModel):
    language: str
    description: str
    code: str
    tags: str

class SnippetResponse(BaseModel):
    id: int
    language: str
    description: Optional[str]
    code: str
    tags: Optional[str]
    use_count: int

@router.post("/save", response_model=dict)
async def save_snippet(snippet: SnippetCreate):
    snippet_id = store.save_snippet(snippet.language, snippet.description, snippet.code, snippet.tags)
    return {"status": "success", "id": snippet_id}

@router.get("/search", response_model=List[SnippetResponse])
async def search_snippets(q: str = "", lang: Optional[str] = None):
    results = store.search_snippets(q, lang)
    return results

@router.get("/suggest", response_model=Optional[SnippetResponse])
async def suggest_snippet(prefix: str, lang: str):
    # Used for ghost text auto-suggest
    result = store.find_similar(prefix, lang)
    return result

@router.post("/use/{snippet_id}")
async def use_snippet(snippet_id: int):
    store.increment_use_count(snippet_id)
    return {"status": "success"}
