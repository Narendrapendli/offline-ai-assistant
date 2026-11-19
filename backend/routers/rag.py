"""
backend/routers/rag.py
POST /index/project   — Start background workspace indexing task
GET  /index/status    — Poll current indexing progress
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import faiss  # type: ignore[import]
import numpy as np
import sqlite_utils  # type: ignore
from fastapi import APIRouter, BackgroundTasks  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from ..config import get_settings
from ..schemas import IndexStatusResponse, ProjectIndexRequest
from ..services.ollama_service import OllamaService

router = APIRouter()
settings = get_settings()
logger = logging.getLogger("ai_assistant.rag")

# ── Shared indexing state (in-process, single-worker) ────────────────────────
_index_state: IndexStatusResponse = IndexStatusResponse(status="idle")

# FAISS index singleton (loaded lazily)
_faiss_index: faiss.IndexHNSWFlat | None = None
_faiss_lock = asyncio.Lock()


# ── FAISS helpers ─────────────────────────────────────────────────────────────

def _get_or_create_faiss() -> faiss.IndexHNSWFlat:
    """Return (or create) the HNSW FAISS index."""
    global _faiss_index
    if _faiss_index is not None:
        return _faiss_index

    index_path = Path(settings.faiss_index_dir) / "index.faiss"
    if index_path.exists():
        _faiss_index = faiss.read_index(str(index_path))
        logger.info("Loaded existing FAISS index from %s", index_path)
    else:
        # nomic-embed-text produces 768-dim vectors
        _faiss_index = faiss.IndexHNSWFlat(768, 32)
        logger.info("Created new FAISS HNSW index (dim=768, M=32)")

    assert _faiss_index is not None
    return _faiss_index


def _save_faiss(index: faiss.IndexHNSWFlat) -> None:
    index_dir = Path(settings.faiss_index_dir)
    index_dir.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(index_dir / "index.faiss"))


def _get_db() -> sqlite_utils.Database:
    db_path = Path(settings.sqlite_db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite_utils.Database(str(db_path))
    # Ensure chunks table exists
    if "chunks" not in db.table_names():
        db["chunks"].create(  # type: ignore[index]
            {
                "id": int,
                "faiss_id": int,
                "file_path": str,
                "start_line": int,
                "end_line": int,
                "chunk_text": str,
                "language": str,
                "symbol_name": str,
                "indexed_at": str,
            },
            pk="id",
        )
        db["chunks"].create_index(["file_path"])  # type: ignore[index]
    return db


# ── Chunk helpers ─────────────────────────────────────────────────────────────

def _walk_source_files(
    project_path: str,
    extensions: list[str],
    exclude_dirs: list[str],
) -> list[Path]:
    """Recursively collect source files matching extensions."""
    results: list[Path] = []
    root = Path(project_path)
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in-place
        dirnames[:] = [  # type: ignore
            d for d in dirnames
            if d not in exclude_dirs and not d.startswith(".")
        ]
        for fname in filenames:
            if any(fname.endswith(ext) for ext in extensions):
                results.append(Path(dirpath) / fname)
    return results


def _chunk_file(file_path: Path, max_tokens: int = 512) -> list[tuple[str, int, int]]:
    """
    Simple line-based sliding-window chunker.
    Returns list of (chunk_text, start_line_1based, end_line_1based).
    """
    try:
        lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    chunks: list[tuple[str, int, int]] = []
    window = 60   # ~512 tokens ≈ 60 lines of typical code
    step = 50     # 10-line overlap

    if len(lines) <= window:
        if lines:
            chunks.append(("\n".join(lines), 1, len(lines)))
    else:
        start = 0
        while start < len(lines):
            end = min(start + window, len(lines))
            chunk_lines = lines[start:end]
            chunks.append(("\n".join(chunk_lines), start + 1, end))
            if end >= len(lines):
                break
            start += step

    return chunks


# ── Background indexing task ──────────────────────────────────────────────────

async def _index_project_task(request: ProjectIndexRequest) -> None:
    """Run the full indexing pipeline in the background."""
    global _index_state

    logger.info("Indexing project: %s", request.project_path)
    _index_state = IndexStatusResponse(status="indexing")

    try:
        svc = OllamaService()
        db = _get_db()

        files = _walk_source_files(
            request.project_path,
            request.extensions,
            request.exclude_dirs,
        )
        _index_state.files_total = len(files)
        logger.info("Found %d source files to index", len(files))

        async with _faiss_lock:
            index = _get_or_create_faiss()

            for file_idx, file_path in enumerate(files):
                if not request.force_reindex:
                    # Skip already-indexed files
                    existing = list(
                        db["chunks"].rows_where(  # type: ignore[index]
                            "file_path = ?", [str(file_path)]
                        )
                    )
                    if existing:
                        _index_state.files_done += 1
                        continue

                # Remove old chunks for this file
                db["chunks"].delete_where("file_path = ?", [str(file_path)])  # type: ignore[index]

                chunks = _chunk_file(file_path)
                lang = file_path.suffix.lstrip(".")

                for chunk_text, start_line, end_line in chunks:
                    try:
                        embedding = await svc.embed(chunk_text, model=settings.embedding_model)
                    except Exception as exc:
                        logger.warning("Embed failed for %s: %s", file_path, exc)
                        continue

                    if not embedding:
                        continue

                    vec = np.array([embedding], dtype=np.float32)
                    assert index is not None
                    faiss_id = index.ntotal
                    index.add(vec)  # type: ignore

                    db["chunks"].insert(  # type: ignore[index]
                        {
                            "faiss_id": faiss_id,
                            "file_path": str(file_path),
                            "start_line": start_line,
                            "end_line": end_line,
                            "chunk_text": chunk_text,
                            "language": lang,
                            "symbol_name": "",
                            "indexed_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    _index_state.chunks_indexed += 1

                _index_state.files_done = file_idx + 1
                logger.debug(
                    "Indexed %d/%d files (%d chunks so far)",
                    _index_state.files_done,
                    _index_state.files_total,
                    _index_state.chunks_indexed,
                )

            _save_faiss(index)

        _index_state.status = "complete"
        logger.info(
            "Indexing complete: %d files, %d chunks",
            _index_state.files_done,
            _index_state.chunks_indexed,
        )

    except Exception as exc: 
        logger.exception("Indexing failed: %s", exc)
        _index_state.status = "error"
        _index_state.error = str(exc)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/project",
    status_code=202,
    summary="Start background workspace indexing",
)
async def index_project(
    request: ProjectIndexRequest,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """
    Enqueue a background indexing task.
    Poll GET /index/status to track progress.
    """
    global _index_state

    if _index_state.status == "indexing":
        return JSONResponse(
            status_code=409,
            content={"detail": "Indexing already in progress"},
        )

    # Reset state before starting
    _index_state = IndexStatusResponse(status="indexing")
    background_tasks.add_task(_index_project_task, request)

    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "message": "Indexing started in background"},
    )


@router.get(
    "/status",
    response_model=IndexStatusResponse,
    summary="Get current indexing progress",
)
async def index_status() -> IndexStatusResponse:
    """Return the current state of the background indexing task."""
    return _index_state
