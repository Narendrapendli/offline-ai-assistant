"""
backend/routers/git_router.py
"""

from __future__ import annotations

import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..services.git_service import global_git
from ..services.ollama_service import OllamaService
from ..config import get_settings

router = APIRouter()
settings = get_settings()

class HistoryQuery(BaseModel):
    file_path: str
    question: str
    project_path: str

async def _stream_explanation(history_text: str, question: str):
    ollama = OllamaService()
    prompt = f"Developer asks: '{question}'. Git history for relevant code:\n{history_text}\nExplain: what changed, when it changed, WHY it was changed based on commit messages. Be specific about the code evolution over time."
    async for token in ollama.generate_stream(prompt=prompt, model=settings.chat_model):
        if token:
            yield token.encode('utf-8')

@router.post("/explain-history")
async def explain_history(data: HistoryQuery):
    history_text = global_git.get_file_history(data.file_path, data.project_path)
    return StreamingResponse(_stream_explanation(history_text, data.question), media_type="text/plain")
