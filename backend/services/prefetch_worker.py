"""
backend/services/prefetch_worker.py
Background worker that observes editor activity and preemptively warms the cache.
"""

from __future__ import annotations

import asyncio
from .ollama_service import OllamaService
from .autocomplete_service import AutocompleteService
from .prefetch_cache import global_cache
from ..context.schemas import ContextBundle
from ..config import get_settings
from ..core.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()

class PrefetchWorker:
    """Monitors activity and triggers pre-generation to make autocomplete feel instant."""

    def __init__(self):
        self.queue: asyncio.Queue[tuple[str, str, str]] = asyncio.Queue(maxsize=1)
        self.ollama = OllamaService()
        self.auto_svc = AutocompleteService(self.ollama, model_name=settings.autocomplete_model)
        self.worker_task: asyncio.Task | None = None

    async def start(self):
        if self.worker_task is None:
            self.worker_task = asyncio.create_task(self._loop())
            logger.info("Prefetch worker started.")

    async def schedule(self, prefix: str, suffix: str, language: str):
        """Add a high-priority prefetch job (drops previous if pending)."""
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        await self.queue.put((prefix, suffix, language))

    async def _loop(self):
        while True:
            prefix, suffix, language = await self.queue.get()
            try:
                # Approximate 500ms delay to ensure user actually stopped typing
                await asyncio.sleep(0.5)
                if not self.queue.empty():
                    continue # Newer job arrived

                bundle = ContextBundle(prefix=prefix, suffix=suffix, language=language)
                
                # Check cache again
                if global_cache.get(prefix):
                    continue

                full_completion = ""
                async for token in self.auto_svc.stream_completion(bundle, max_tokens=60):
                    full_completion += token
                
                if full_completion.strip():
                    global_cache.set(prefix, full_completion)
                    logger.debug(f"Prefetched: {prefix[-20:]!r} -> {full_completion[:20]!r}")

            except Exception as e:
                logger.error(f"Prefetch loop error: {e}")
            finally:
                self.queue.task_done()

global_worker = PrefetchWorker()
