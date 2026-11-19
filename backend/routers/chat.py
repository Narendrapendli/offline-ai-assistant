"""
backend/routers/chat.py
POST /chat/stream  — SSE streaming chat using deepseek-coder:6.7b
POST /chat         — Non-streaming chat (full response at once)
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..config import get_settings
from ..schemas import ChatMessage, ChatRequest
from ..services.ollama_service import OllamaService

router = APIRouter()
settings = get_settings()


def _build_messages(request: ChatRequest) -> list[dict[str, str]]:
    """
    Ensure system prompt is at the top, merge code_context if present.
    """
    from ..services.ollama_service import SYSTEM_PROMPT

    msgs: list[dict[str, str]] = []

    # Check if a system prompt is already in the history
    system_msg = next((msg for msg in request.messages if msg.role == "system"), None)
    
    if not system_msg:
        msgs.append({"role": "system", "content": SYSTEM_PROMPT})
    
    for msg in request.messages:
        msgs.append({"role": msg.role, "content": msg.content})

    if request.code_context:
        for i in range(len(msgs) - 1, -1, -1):
            if msgs[i]["role"] == "user":
                lang = request.language or "text"
                original_user_msg = msgs[i]["content"]
                msgs[i]["content"] = (
                    f"=== CURRENT EDITOR FILE CONTEXT ===\n"
                    f"```{lang}\n{request.code_context}\n```\n\n"
                    f"=== USER QUERY ===\n"
                    f"{original_user_msg}"
                )
                break

    return msgs


async def _sse_generator(request: ChatRequest) -> AsyncGenerator[dict, None]:
    """Yield SSE-compatible dicts for each token, then a [DONE] sentinel."""
    svc = OllamaService()
    model = request.model or settings.chat_model
    try:
        messages = _build_messages(request)
        async for token in svc.chat_stream(
            messages=messages,
            model=model,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        ):
            yield {"data": json.dumps({"token": token})}
    except Exception as e:
        yield {"data": json.dumps({"error": str(e)})}
    finally:
        yield {"data": "[DONE]"}


@router.post(
    "/stream",
    summary="Streaming chat via Server-Sent Events",
)
async def chat_stream(request: ChatRequest) -> EventSourceResponse:
    """
    Stream chat tokens as SSE events.
    """
    return EventSourceResponse(_sse_generator(request))


@router.post(
    "",
    summary="Non-streaming chat (returns full response)",
)
async def chat(request: ChatRequest) -> dict:
    """Complete the conversation and return the full assistant reply at once."""
    svc = OllamaService()
    model = request.model or settings.chat_model
    messages = _build_messages(request)
    
    full_response = ""
    async for chunk in svc.chat_stream(
        messages=messages,
        model=model,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
    ):
        full_response += chunk

    return {
        "role": "assistant",
        "content": full_response,
        "model": model,
    }
