"""
backend/rag/metadata_store.py
SQLite database for storing the actual code contents and metadata for chunks in FAISS.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from .schemas import CodeChunk
from ..core.logger import get_logger

logger = get_logger(__name__)


class MetadataStore:
    """Stores full CodeChunk objects (content, line numbers) keyed by UUID."""

    def __init__(self, db_path: str = "data/faiss_index/metadata.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """Create the chunks table."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    file_path TEXT,
                    start_line INTEGER,
                    end_line INTEGER,
                    content TEXT,
                    chunk_type TEXT,
                    file_hash TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path)")
            conn.commit()

    def insert_chunk(self, chunk: CodeChunk) -> None:
        """Insert or replace a CodeChunk."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO chunks 
                (id, file_path, start_line, end_line, content, chunk_type, file_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk.id, chunk.file_path, chunk.start_line, chunk.end_line, 
                 chunk.content, chunk.chunk_type, chunk.file_hash)
            )
            conn.commit()

    def insert_chunks(self, chunks: list[CodeChunk]) -> None:
        """Batch insert CodeChunks."""
        if not chunks:
            return
        
        with sqlite3.connect(self.db_path) as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO chunks 
                (id, file_path, start_line, end_line, content, chunk_type, file_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [(c.id, c.file_path, c.start_line, c.end_line, c.content, c.chunk_type, c.file_hash) for c in chunks]
            )
            conn.commit()

    def get_chunk(self, chunk_id: str) -> CodeChunk | None:
        """Retrieve a CodeChunk by its UUID."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT * FROM chunks WHERE id = ?", (chunk_id,))
            row = cursor.fetchone()
            if row:
                return CodeChunk(*row)
        return None

    def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[CodeChunk]:
        """Retrieve multiple CodeChunks by UUIDs."""
        if not chunk_ids:
            return []
            
        placeholders = ",".join("?" * len(chunk_ids))
        chunks = []
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(f"SELECT * FROM chunks WHERE id IN ({placeholders})", chunk_ids)
            for row in cursor.fetchall():
                chunks.append(CodeChunk(*row))
        return chunks

    def get_chunks_by_file(self, file_path: str) -> list[CodeChunk]:
        """Retrieve all CodeChunks belonging to a specific file."""
        chunks = []
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT * FROM chunks WHERE file_path = ?", (file_path,))
            for row in cursor.fetchall():
                chunks.append(CodeChunk(*row))
        return chunks

    def delete_chunks_by_file(self, file_path: str) -> None:
        """Remove all CodeChunks for a specific file (e.g. before re-indexing it)."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM chunks WHERE file_path = ?", (file_path,))
            conn.commit()
