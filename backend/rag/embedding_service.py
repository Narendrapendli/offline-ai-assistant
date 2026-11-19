"""
backend/rag/embedding_service.py
Service for generating embeddings via Ollama with an SQLite caching layer.
"""

from __future__ import annotations

import sqlite3
import json
from pathlib import Path
from ..services.ollama_service import OllamaService
from ..config import get_settings
from ..core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class EmbeddingService:
    """Handles text embedding using Ollama with an SQLite cache to avoid redundant calls."""
    
    def __init__(self, ollama_service: OllamaService, db_path: str = "data/faiss_index/embeddings_cache.db"):
        self.ollama = ollama_service
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """Initialize the SQLite cache table."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS embedding_cache (
                    hash TEXT PRIMARY KEY,
                    embedding TEXT
                )
            """)
            conn.commit()

    def _get_cached_embedding(self, content_hash: str) -> list[float] | None:
        """Fetch embedding from cache if it exists."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT embedding FROM embedding_cache WHERE hash = ?", (content_hash,))
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
        return None

    def _cache_embedding(self, content_hash: str, embedding: list[float]) -> None:
        """Store embedding in cache."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO embedding_cache (hash, embedding) VALUES (?, ?)",
                (content_hash, json.dumps(embedding))
            )
            conn.commit()

    async def embed_single(self, text: str, content_hash: str | None = None) -> list[float]:
        """Embed a single chunk of text, consulting the cache if content_hash is provided."""
        if content_hash:
            cached = self._get_cached_embedding(content_hash)
            if cached:
                return cached
        
        # Cache miss, call Ollama
        try:
            embedding = await self.ollama.embed(text, model=settings.embedding_model)
            if content_hash and embedding:
                self._cache_embedding(content_hash, embedding)
            return embedding
        except Exception as e:
            logger.error(f"Failed to embed text: {e}")
            raise

    async def embed_batch(self, texts: list[str], content_hashes: list[str] | None = None, batch_size: int = 10) -> list[list[float]]:
        """Embed multiple chunks of text, processing them in small batches."""
        embeddings: list[list[float]] = []
        
        # Fast path if we have hashes
        if content_hashes and len(texts) == len(content_hashes):
            for text, c_hash in zip(texts, content_hashes):
                embeddings.append(await self.embed_single(text, c_hash))
            return embeddings

        # Fallback if no hashes (don't cache)
        full_list: list[str] = list(texts)
        for i in range(0, len(full_list), batch_size):
            batch: list[str] = full_list[i:i + batch_size]
            for text in batch:
                embeddings.append(await self.embed_single(text))
                
        return embeddings
