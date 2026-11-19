"""
backend/rag/faiss_manager.py
Manages the FAISS vector index for fast semantic similarity search.
"""

from __future__ import annotations

import os
import faiss  # type: ignore
import numpy as np  # type: ignore
from pathlib import Path
from ..core.logger import get_logger

logger = get_logger(__name__)


class FAISSIndexManager:
    """Wrapper around faiss.IndexFlatIP (inner product/cosine similarity)."""

    def __init__(self, dimension: int = 768, index_path: str = "data/faiss_index/project.index"):
        self.dimension = dimension
        self.index_path = Path(index_path)
        self.index: faiss.Index | None = None
        self._id_map: list[str] = []  # Maps FAISS integer ID -> UUID string
        
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.load(self.index_path)

    def _create_new_index(self) -> None:
        """Initialize a new empty L2-normalized Inner Product index (Cosine Similarity)."""
        self.index = faiss.IndexFlatIP(self.dimension)
        self._id_map = []
        logger.info(f"Created new FAISS index (dimension={self.dimension})")

    def load(self, path: Path | str | None = None) -> None:
        """Load the index and ID mapping from disk, or create a new one if missing."""
        load_path = Path(path) if path else self.index_path
        mapping_path = load_path.with_suffix(".map")

        if load_path.exists() and mapping_path.exists():
            try:
                self.index = faiss.read_index(str(load_path))
                with open(mapping_path, "r", encoding="utf-8") as f:
                    self._id_map = [line.strip() for line in f if line.strip()]
                
                # Check consistency
                if self.index is not None:
                    if self.index.ntotal != len(self._id_map):
                        logger.warning(f"Index size ({self.index.ntotal}) differs from map size ({len(self._id_map)}). Recreating.")
                        self._create_new_index()
                    else:
                        logger.info(f"Loaded FAISS index with {self.index.ntotal} vectors.")
                else:
                    self._create_new_index()
                return
            except Exception as e:
                logger.error(f"Failed to load FAISS index: {e}. Recreating.")
        
        self._create_new_index()

    def save(self, path: Path | str | None = None) -> None:
        """Save the index and ID mapping to disk."""
        if not self.index:
            return

        save_path = Path(path) if path else self.index_path
        try:
            if self.index is not None:
                faiss.write_index(self.index, str(save_path))
                with open(save_path.with_suffix(".map"), "w", encoding="utf-8") as f:
                    for uuid_str in self._id_map:
                        f.write(f"{uuid_str}\n")
                logger.info(f"Saved FAISS index with {self.index.ntotal} vectors.")
        except Exception as e:
            logger.error(f"Failed to save FAISS index: {e}")

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str]) -> None:
        """
        Add new embeddings to the index.
        
        Parameters
        ----------
        embeddings : list[list[float]]
            The dense vectors to embed.
        ids : list[str]
            The UUIDs corresponding to each vector.
        """
        if not embeddings or not ids or len(embeddings) != len(ids):
            return

        if self.index is None:
            self._create_new_index()

        # Convert to float32 numpy array
        vectors = np.array(embeddings, dtype=np.float32)

        # Normalize for cosine similarity because IndexFlatIP does inner product 
        # (normalized inner product = cosine similarity)
        faiss.normalize_L2(vectors)

        # Add to index
        assert self.index is not None
        self.index.add(vectors)  # type: ignore

        # Update ID map
        self._id_map.extend(ids)

    def search(self, query_embedding: list[float], top_k: int = 5) -> tuple[list[float], list[str]]:
        """
        Search for the top_k most similar vectors.

        Returns
        -------
        tuple[list[float], list[str]]
            (distances, UUIDs)
        """
        if not self.index or self.index.ntotal == 0:
            return [], []

        vector = np.array([query_embedding], dtype=np.float32)
        faiss.normalize_L2(vector)

        # D = distances, I = indices in FAISS
        assert self.index is not None
        D, I = self.index.search(vector, min(top_k, self.index.ntotal))  # type: ignore

        # Map FAISS sequential indices back to our UUIDs
        distances = D[0].tolist()
        indices = I[0].tolist()
        
        uuids = [self._id_map[i] for i in indices if i != -1]
        
        return distances, uuids
