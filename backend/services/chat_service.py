"""
backend/services/chat_service.py
Service for handling chat conversations with the LLM via SSE streaming.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator
from .ollama_service import OllamaService
from ..context.schemas import ContextBundle
from ..core.logger import get_logger

logger = get_logger(__name__)


class ChatService:
    """Manages chat streams targeting the larger model (e.g. 6.7b)."""

    def __init__(self, ollama_service: OllamaService, model_name: str = "deepseek-coder:6.7b"):
        self.ollama = ollama_service
        self.model_name = model_name

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        bundle: ContextBundle
    ) -> AsyncGenerator[str, None]:
        """
        Takes conversation history + context bundle and streams tokens as SSE JSON.
        Yields JSON strings that can be sent directly over SSE.
        """
        
        # 1. Format the final list of messages
        # We start with the system prompt/RAG context, then add the user's history
        ollama_messages = bundle.as_chat_messages()
        
        # Append the actual conversation history
        for msg in messages:
            if msg.get("role") and msg.get("content"):
                ollama_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        # 2. Add structural hints exactly to the final user message if present
        if bundle.code_context and ollama_messages and ollama_messages[-1]["role"] == "user":
            original = ollama_messages[-1]["content"]
            hinted = f"Here is the code I am currently looking at:\n```\n{bundle.code_context}\n```\n\n{original}"
            ollama_messages[-1]["content"] = hinted

        logger.info(f"Starting chat stream (Total messages: {len(ollama_messages)})")

        try:
            stream = self.ollama.chat_stream(
                messages=ollama_messages,
                model=self.model_name,
                options={
                    "temperature": 0.4,
                    "top_p": 0.9,
                    "num_ctx": 8192  # Deepseek 6.7b supports longer context
                }
            )
            
            async for chunk in stream:
                if chunk:
                    # Package the literal string token into a JSON payload for Server-Sent Events
                    payload = json.dumps({"token": chunk})
                    # Yield SSE formatted string
                    yield f"data: {payload}\n\n"
                    
            # Send done signal
            yield f"data: {json.dumps({'done': True})}\n\n"
            
        except Exception as e:
            logger.error(f"Chat stream encountered an error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
