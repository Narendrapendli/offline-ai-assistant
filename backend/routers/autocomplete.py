"""
backend/routers/autocomplete.py
POST /autocomplete  — FIM inline completion (streaming)
"""

from __future__ import annotations

import time
from typing import AsyncGenerator

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from ..config import get_settings
from ..schemas import AutocompleteRequest
from ..services.ollama_service import OllamaService
from ..services.autocomplete_service import AutocompleteService
from ..context.schemas import ContextBundle
from ..services.prefetch_cache import global_cache
from ..services.prefetch_worker import global_worker
from ..middleware import stats

router = APIRouter()
settings = get_settings()

async def _stream_completion(request: AutocompleteRequest) -> AsyncGenerator[bytes, None]:
    """Build a FIM prompt and stream tokens from Ollama."""
    ollama_svc = OllamaService()
    auto_svc = AutocompleteService(ollama_service=ollama_svc, model_name=settings.autocomplete_model)
    
    bundle = ContextBundle(
        prefix=request.prefix,
        suffix=request.suffix,
        language=request.language
    )

    async for token in auto_svc.stream_completion(bundle, max_tokens=request.max_tokens):
        yield token.encode("utf-8")


@router.post(
    "",
    summary="FIM inline code completion (streaming)",
)
async def autocomplete(request: AutocompleteRequest, response: Response) -> Response:
    """
    Accepts prefix / suffix context and streams a fill-in-the-middle completion.
    Check cache first for 'instant' feel.
    """
    # Cache check
    cached = global_cache.get(request.prefix)
    if cached:
        stats.cache_hits += 1
        response.headers["X-Cache"] = "HIT"
        return Response(content=cached, media_type="text/plain")

    stats.cache_misses += 1

    # Schedule prefetch on miss
    await global_worker.schedule(request.prefix, request.suffix, request.language)

    return StreamingResponse(
        _stream_completion(request),
        media_type="text/plain; charset=utf-8",
        headers={
            "X-Model": settings.autocomplete_model,
            "X-Timestamp": str(int(time.time() * 1000)),
            "X-Cache": "MISS"
        },
    )
