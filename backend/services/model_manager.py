"""
backend/services/model_manager.py
Manages loading status of models.
"""

from typing import Dict
from ..config import get_settings

settings = get_settings()

class ModelManager:
    """Manages Ollama model loading states."""
    
    async def get_model_status(self) -> Dict[str, str]:
        """Return status for configured models."""
        return {
            settings.chat_model: "loaded",
            settings.autocomplete_model: "loaded",
            settings.embedding_model: "loaded",
        }
        
    async def preload_models(self) -> None:
        """Preload models (dummy implementation)."""
        pass
