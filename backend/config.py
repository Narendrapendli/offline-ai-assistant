"""
backend/config.py
Application settings loaded from .env via pydantic-settings.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the AI Assistant backend.

    All values can be overridden by the .env file at project root.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",          # ignore unknown keys from .env
    )

    # ── Ollama ────────────────────────────────────────────────────────────
    ollama_base_url: str = "http://localhost:11434"

    # ── FastAPI ───────────────────────────────────────────────────────────
    fastapi_host: str = "127.0.0.1"
    fastapi_port: int = 8000

    # ── Models ────────────────────────────────────────────────────────────
    autocomplete_model: str = "phi3:mini"
    chat_model: str = "phi3:mini"
    embedding_model: str = "nomic-embed-text"

    # ── Autocomplete tuning ───────────────────────────────────────────────
    autocomplete_max_tokens: int = 128
    autocomplete_temperature: float = 0.1
    autocomplete_debounce_ms: int = 150

    # ── Chat tuning ───────────────────────────────────────────────────────
    chat_max_tokens: int = 2048
    chat_temperature: float = 0.7

    # ── RAG / FAISS ───────────────────────────────────────────────────────
    faiss_index_dir: str = "./data/faiss_index"
    sqlite_db_path: str = "./data/assistant.db"
    rag_top_k: int = 5
    chunk_max_tokens: int = 512
    chunk_overlap_tokens: int = 50

    # ── Prefetch cache ────────────────────────────────────────────────────
    prefetch_cache_ttl_days: int = 7
    prefetch_cache_max_entries: int = 10_000

    # ── File watcher ──────────────────────────────────────────────────────
    watch_debounce_seconds: int = 2
    watch_extensions: str = ".py,.ts,.js,.tsx,.jsx,.go,.rs,.java,.cpp,.c,.h"

    # ── Logging ───────────────────────────────────────────────────────────
    log_level: str = "INFO"
    ollama_debug: bool = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    return Settings()
