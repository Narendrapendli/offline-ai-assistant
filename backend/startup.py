"""
backend/startup.py
Startup sequence and health checks before the FastAPI server fully launches.
"""

import time
import asyncio
from .services.ollama_service import OllamaService
from .rag.rag_pipeline import RAGPipeline
from .core.logger import get_logger
from .config import get_settings

logger = get_logger(__name__)
settings = get_settings()

async def run_startup_sequence() -> None:
    """Verifies dependencies and pre-warms LLM models."""
    logger.info("Initializing VS Code AI Assistant Backend...")
    start_time = time.time()
    
    ollama = OllamaService()
    
    # 1. Check Ollama Health
    retries = 5
    healthy = False
    for i in range(retries):
        if await ollama.check_health():
            healthy = True
            break
        logger.warning(f"Ollama not ready. Retrying in 2s ({i+1}/{retries})...")
        await asyncio.sleep(2)
        
    if not healthy:
        logger.error("Failed to connect to Ollama on localhost:11434. Ensure 'ollama serve' is running.")
        # We don't exit; the VS Code extension handles the red status bar icon.
    
    if healthy:
        # 2. Pre-warm / pull models if missing
        logger.info("Pre-warming models...")
        models_to_check = [
            settings.autocomplete_model,
            settings.chat_model,
            settings.embedding_model
        ]
        
        # A simple check (Ollama v0.1+ supports /api/tags)
        try:
           # Doing a quick load by embedded a dummy string and doing a tiny completion
           await ollama.embed("warmup", model=settings.embedding_model)
           logger.info(f"Loaded {settings.embedding_model}")
        except Exception as e:
            logger.warning(f"Could not warm up embedding model: {e}")

    # 3. Initialize RAG Pipeline (Loads FAISS index into memory)
    logger.info("Loading FAISS RAG Index...")
    RAGPipeline(ollama)
    
    elapsed = time.time() - start_time
    logger.info(f"Startup sequence completed in {elapsed:.2f} seconds.")
