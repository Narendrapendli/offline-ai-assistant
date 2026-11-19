"""
backend/routers/generate.py
POST /generate  — Single-shot instruction-following generation (streaming)

Use cases: docstring generation, test writing, bug detection, git diff explanation.
"""

from __future__ import annotations

from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..config import get_settings
from ..schemas import GenerateRequest
from ..services.ollama_service import OllamaService, SYSTEM_PROMPT

router = APIRouter()
settings = get_settings()


def _build_generate_prompt(request: GenerateRequest) -> str:
    """Compose a structured prompt from instruction + code context."""
    parts: list[str] = [SYSTEM_PROMPT, ""]

    if request.context:
        lang = request.language or "text"
        parts.append(f"Code context ({lang}):")
        parts.append(f"```{lang}")
        parts.append(request.context)
        parts.append("```")
        parts.append("")

    parts.append(f"Task: {request.instruction}")
    parts.append("")
    parts.append("Response:")
    return "\n".join(parts)


async def _stream_generate(request: GenerateRequest) -> AsyncGenerator[bytes, None]:
    """Build the prompt and stream raw token bytes."""
    svc = OllamaService()
    prompt = _build_generate_prompt(request)

    async for token in svc.generate_stream(
        prompt=prompt,
        model=settings.chat_model,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
    ):
        yield token.encode("utf-8")


@router.post(
    "",
    summary="Streaming single-shot code generation",
    response_class=StreamingResponse,
)
async def generate(request: GenerateRequest) -> StreamingResponse:
    """
    Stream an instruction-following generation response.
    """
    return StreamingResponse(
        _stream_generate(request),
        media_type="text/plain; charset=utf-8",
        headers={"X-Model": settings.chat_model},
    )
