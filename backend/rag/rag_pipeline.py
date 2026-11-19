"""
backend/rag/rag_pipeline.py
Orchestrates the entire RAG flow: chunking, embedding, indexing, and querying.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from .schemas import CodeChunk
from .file_chunker import FileChunker
from .embedding_service import EmbeddingService
from .faiss_manager import FAISSIndexManager
from .metadata_store import MetadataStore
from ..services.ollama_service import OllamaService
from ..core.logger import get_logger


logger = get_logger(__name__)


class RAGPipeline:
    """High-level API for indexing projects and executing RAG queries."""

    def __init__(self, ollama_service: OllamaService):
        self.chunker = FileChunker()
        self.embedder = EmbeddingService(ollama_service)
        self.faiss = FAISSIndexManager()
        self.meta = MetadataStore()

    async def index_project(
        self,
        project_path: str,
        extensions: list[str] | None = None,
        exclude_dirs: list[str] | None = None
    ) -> dict[str, int]:
        """
        Walk a directory and incrementally index all matching files.
        """
        if extensions is None:
            extensions = [".py", ".ts", ".js", ".tsx", ".jsx", ".cpp", ".hpp", ".c", ".h", ".go", ".rs"]
        if exclude_dirs is None:
            exclude_dirs = ["node_modules", "dist", "build", ".git", ".venv", "venv", "__pycache__"]

        root = Path(project_path)
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Invalid project path: {project_path}")

        files_processed: int = 0
        chunks_indexed: int = 0

        # Walk workspace, collect files
        for current_dir, dirs, files in os.walk(root):
            # Mutate dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith(".")]  # type: ignore

            for file in files:
                ext = Path(file).suffix.lower()
                if ext not in extensions:
                    continue

                full_path = Path(current_dir) / file
                
                try:
                    res = await self.update_file(str(full_path))
                    if res is not None:
                        files_processed += 1
                        chunks_indexed += int(res.get("chunks", 0))
                except Exception as e:
                    logger.error(f"Failed to index {full_path}: {e}")

        # Persist index after batch
        self.faiss.save()
        
        return {
            "files_processed": files_processed,
            "chunks_indexed": chunks_indexed
        }

    async def update_file(self, file_path: str) -> dict[str, int] | None:
        """
        Update the index for a single file.
        Deletes old chunks, then chunks and embeds the new content.
        """
        path = Path(file_path)
        if not path.exists():
            return None

        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Skip binary files
            return None

        # Determine file hash to check staleness
        new_hash = self.chunker.compute_hash(content)
        
        # Check if existing chunks have the same hash
        existing = self.meta.get_chunks_by_file(str(path))
        if existing and all(c.file_hash == new_hash for c in existing):
            logger.debug(f"File {path.name} unchanged, skipping index update.")
            return None

        logger.info(f"Indexing file: {path.name}")
        
        # Note: We don't easily remove vectors from IndexFlatIP, so we just
        # keep them and let the metadata override handle it, OR we recreate
        # the index periodically. For a local assistant, relying on the 
        # embedding cache to re-add them fast to a fresh index is often best.
        # But here we'll just add the new chunks. Stale vectors won't be returned
        # if we garbage collect the metadata.
        self.meta.delete_chunks_by_file(str(path))

        chunks = self.chunker.chunk_file(content, str(path))
        if not chunks:
            return None

        # Assign UUIDs
        for c in chunks:
            c.id = str(uuid.uuid4())

        # Embed
        texts = [c.content for c in chunks]
        hashes = [c.file_hash for c in chunks]
        
        embeddings = await self.embedder.embed_batch(texts, content_hashes=hashes)

        # Store in FAISS
        chunk_ids = [c.id for c in chunks]
        self.faiss.add_embeddings(embeddings, chunk_ids)

        # Store Metadata
        self.meta.insert_chunks(chunks)

        return {"chunks": len(chunks)}

    async def query(self, text: str, top_k: int = 5) -> list[CodeChunk]:
        """
        Search the project for chunks semantic similar to the query text.
        """
        if not text.strip():
            return []

        # Embed query (no cache)
        query_emb = await self.embedder.embed_single(text)
        
        # Search
        distances, ids = self.faiss.search(query_emb, top_k=top_k)
        
        if not ids:
            return []

        # Retrieve metadata
        chunks = self.meta.get_chunks_by_ids(ids)
        
        # Sort chunks to match the order of FAISS results
        id_to_chunk = {c.id: c for c in chunks}
        sorted_chunks = [id_to_chunk[chunk_id] for chunk_id in ids if chunk_id in id_to_chunk]

        return sorted_chunks

    def delete_file(self, file_path: str) -> None:
        """Remove a file's chunks from metadata store."""
        self.meta.delete_chunks_by_file(file_path)
