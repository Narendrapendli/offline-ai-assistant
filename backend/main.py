"""
backend/main.py
FastAPI application entry point.

Routers:
  /health          → health.py
  /autocomplete    → autocomplete.py
  /chat            → chat.py
  /generate        → generate.py
  /index           → rag.py
  /model           → health.py (model status sub-routes)
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn  # type: ignore
from fastapi import FastAPI, Request, BackgroundTasks  # type: ignore
from fastapi.responses import JSONResponse, StreamingResponse  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore

from .config import get_settings
from .middleware import RequestLoggingMiddleware, stats
from .routers import autocomplete, chat, generate, health, rag, snippets, learning, prefetch, graph, git_router, history
from .services.prefetch_worker import global_worker
from .services.prefetch_cache import global_cache

# ── Logging setup ─────────────────────────────────────────────────────────────
settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("ai_assistant.main")


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: verify Ollama is reachable.
    Shutdown: nothing special required (httpx clients are per-request).
    """
    from .services.ollama_service import OllamaService

    logger.info("Starting Offline AI Assistant backend …")
    logger.info("Ollama URL : %s", settings.ollama_base_url)
    logger.info("Autocomplete model : %s", settings.autocomplete_model)
    logger.info("Chat model         : %s", settings.chat_model)
    logger.info("Embedding model    : %s", settings.embedding_model)

    svc = OllamaService()
    reachable = await svc.check_health()
    if reachable:
        logger.info("✓ Ollama is reachable")
    else:
        logger.warning(
            "⚠ Ollama not reachable at %s — extension features will fail "
            "until Ollama is started.",
            settings.ollama_base_url,
        )

    yield  # application runs here

    logger.info("Shutting down AI Assistant backend")


# ── Application factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="Offline VS Code AI Assistant",
        description=(
            "Fully offline AI coding assistant backend. "
            "Powered by Ollama + DeepSeek-Coder. No internet required."
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # ── CORS (allow all origins — localhost only in practice) ──────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Request logging ────────────────────────────────────────────────────
    app.add_middleware(RequestLoggingMiddleware)

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(health.router,       tags=["Health"])
    app.include_router(autocomplete.router, prefix="/autocomplete", tags=["Autocomplete"])
    app.include_router(chat.router,         prefix="/chat",         tags=["Chat"])
    app.include_router(generate.router,     prefix="/generate",     tags=["Generate"])
    app.include_router(rag.router,          prefix="/index",        tags=["RAG / Index"])
    app.include_router(snippets.router,     prefix="/snippets",     tags=["Snippets"])
    app.include_router(learning.router,     prefix="/learning",     tags=["Learning"])
    app.include_router(prefetch.router,     prefix="/prefetch",     tags=["Prefetch"])
    app.include_router(graph.router,        prefix="/graph",        tags=["Graph"])
    app.include_router(git_router.router,   prefix="/git",          tags=["Git"])
    app.include_router(history.router,      prefix="/history",      tags=["History"])

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        import traceback
        print("=== GLOBAL EXCEPTION ===")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "traceback": traceback.format_exc()},
        )

    @app.get("/stats", tags=["Internal"])
    async def get_stats():
        import time
        return {
            "uptime_seconds": int(time.time() - stats.start_time),
            "total_requests": stats.total_requests,
            "avg_response_ms": round(stats.get_avg_latency(), 2),
            "model_name": settings.chat_model,
            "cache_hit_rate": f"{(stats.cache_hits / (stats.cache_hits + stats.cache_misses) * 100):.1f}%" if (stats.cache_hits + stats.cache_misses) > 0 else "0%"
        }

    return app


app = create_app()


# ── Dev entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.fastapi_host,
        port=settings.fastapi_port,
        reload=True,
        log_level=settings.log_level.lower(),
    )
