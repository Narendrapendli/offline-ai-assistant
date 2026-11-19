"""
backend/schemas.py
Pydantic request / response models shared across all routers.
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


# ── Autocomplete ──────────────────────────────────────────────────────────────

class AutocompleteRequest(BaseModel):
    """Inline FIM (fill-in-the-middle) completion request."""

    prefix: str = Field(..., description="Code above the cursor")
    suffix: str = Field("", description="Code below the cursor")
    language: str = Field("python", description="Programming language")
    max_tokens: int = Field(60, ge=1, le=512, description="Maximum completion tokens")
    temperature: float = Field(0.1, ge=0.0, le=2.0)


class AutocompleteResponse(BaseModel):
    completion: str
    model: str
    source: Literal["HIT", "MISS"] = "MISS"
    latency_ms: float = 0.0


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single turn in a conversation."""

    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """Multi-turn chat request with optional code context."""

    messages: list[ChatMessage]
    code_context: str = Field("", description="Selected code or file snippet to attach")
    language: str = Field("python", description="Language of code_context")
    model: str = Field("", description="Override chat model (empty = use settings)")
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(500, ge=1, le=8192)


# ── Generate (single-shot, non-chat) ─────────────────────────────────────────

class GenerateRequest(BaseModel):
    """Single-shot generation request (docstrings, tests, etc.)."""

    instruction: str = Field(..., description="What to generate")
    context: str = Field("", description="Code context / selected text")
    language: str = Field("python", description="Target programming language")
    max_tokens: int = Field(500, ge=1, le=8192)
    temperature: float = Field(0.7, ge=0.0, le=2.0)


class GenerateResponse(BaseModel):
    result: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


# ── Indexing / RAG ────────────────────────────────────────────────────────────

class ProjectIndexRequest(BaseModel):
    """Request to index a workspace directory for RAG."""

    project_path: str = Field(..., description="Absolute path to workspace root")
    extensions: list[str] = Field(
        default=[".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java"],
        description="File extensions to include",
    )
    exclude_dirs: list[str] = Field(
        default=["node_modules", ".git", "__pycache__", "dist", ".venv", "venv"],
        description="Directory names to skip",
    )
    force_reindex: bool = Field(False, description="Re-index even if already indexed")


class IndexStatusResponse(BaseModel):
    status: Literal["idle", "indexing", "complete", "error"]
    files_total: int = 0
    files_done: int = 0
    chunks_indexed: int = 0
    error: str | None = None


# ── Model status ──────────────────────────────────────────────────────────────

class ModelStatusResponse(BaseModel):
    status: Literal["ok", "error"]
    models: dict[str, str] = Field(
        default_factory=dict,
        description="Mapping of model name → status string",
    )
    ollama_url: str = ""


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "error"]
    ollama_reachable: bool
    message: str = ""
