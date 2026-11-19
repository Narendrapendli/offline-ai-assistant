"""
backend/routers/health.py
GET /health          — Ollama connectivity check
GET /model/status    — list loaded model statuses
GET /models/list     — list all locally installed Ollama models
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..config import get_settings
from ..schemas import HealthResponse, ModelStatusResponse
from ..services.ollama_service import OllamaService
from ..services.model_manager import ModelManager

router = APIRouter()
settings = get_settings()


@router.get("/health", response_model=HealthResponse, summary="Backend health check")
async def health_check() -> HealthResponse:
    """Check whether the backend can reach Ollama."""
    svc = OllamaService()
    reachable = await svc.check_health()
    return HealthResponse(
        status="ok" if reachable else "degraded",
        ollama_reachable=reachable,
        message=(
            "All systems nominal"
            if reachable
            else f"Cannot reach Ollama at {settings.ollama_base_url}"
        ),
    )


@router.get(
    "/model/status",
    response_model=ModelStatusResponse,
    summary="Get status of each configured model",
)
async def model_status() -> ModelStatusResponse:
    """Return a status string for every configured model."""
    manager = ModelManager()
    statuses = await manager.get_model_status()
    all_ok = all(v == "loaded" for v in statuses.values())
    return ModelStatusResponse(
        status="ok" if all_ok else "error",
        models=statuses,
        ollama_url=settings.ollama_base_url,
    )


@router.post(
    "/model/preload",
    summary="Warm up / preload all configured models",
)
async def preload_models() -> JSONResponse:
    """Send a short warmup prompt to each model to load it into GPU memory."""
    manager = ModelManager()
    await manager.preload_models()
    return JSONResponse(content={"status": "preload_started"})


@router.get(
    "/models/list",
    summary="List all locally installed Ollama models",
)
async def list_models() -> JSONResponse:
    """
    Fetch the list of locally installed models from Ollama (/api/tags)
    and return a trimmed list suitable for the chat UI model picker.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()

        models = []
        for m in data.get("models", []):
            size_bytes = m.get("size", 0)
            size_gb = round(size_bytes / 1_073_741_824, 1) if size_bytes else None
            models.append({
                "name": m.get("name", ""),
                "size_gb": size_gb,
                "modified_at": m.get("modified_at", ""),
            })

        # Sort: smaller models first so lightweight ones are on top
        models.sort(key=lambda x: x.get("size_gb") or 999)
        return JSONResponse(content={"models": models, "active": settings.chat_model})

    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"models": [], "active": settings.chat_model, "error": str(exc)},
        )
