from __future__ import annotations

import json
import logging
import os
from typing import AsyncGenerator, Any

import httpx  # type: ignore
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_PROMPT = """You are 'Beast AI', a specialized assistant for software development. 
Your Core Mission: Provide code, technical explanations, and help with developer tools.

Rules:
1. ALWAYS give complete working code immediately when asked
2. NEVER ask for clarification
3. NEVER say please provide more details
4. Answer every coding question directly with runnable code examples
5. If someone asks something non-technical, say: I am a dedicated coding assistant. I can only help with programming-related queries."""


class OllamaService:
    """Wrapper around the Ollama REST API endpoints."""

    def __init__(self):
        self.base_url = settings.ollama_base_url.rstrip("/")

    async def check_health(self) -> bool:
        """Check if Ollama is responsive."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/")
                return resp.status_code == 200
        except Exception as e:
            logger.error(f"Ollama health check failed: {e}")
            return False
        
        return False


    async def generate_stream(
        self,
        prompt: str,
        model: str,
        options: dict[str, Any] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream completion from /api/generate."""
        opts = options or {}
        if max_tokens is not None:
            opts["num_predict"] = max_tokens
        if temperature is not None:
            opts["temperature"] = temperature

        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            "options": opts,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST", f"{self.base_url}/api/generate", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if "response" in data:
                            yield data["response"]
                    except json.JSONDecodeError:
                        pass

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str,
        options: dict[str, Any] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream chat tokens from /api/chat."""
        opts = options or {}
        if max_tokens is not None:
            opts["num_predict"] = max_tokens
        if temperature is not None:
            opts["temperature"] = temperature

        # Always inject system prompt
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        full_messages.extend(messages)

        payload = {
            "model": model,
            "messages": full_messages,
            "stream": True,
            "options": opts,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                    except json.JSONDecodeError:
                        pass

    async def embed(self, text: str, model: str) -> list[float]:
        """Generate embeddings via /api/embeddings."""
        payload = {"model": model, "prompt": text}
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/embeddings", json=payload
                )
                resp.raise_for_status()
                data = resp.json()
                embedding = data.get("embedding", [])
                if isinstance(embedding, list):
                    return [float(x) for x in embedding]
                return []
        except Exception as e:
            logger.error(f"Ollama embed failed: {e}")
        return []

    async def generate(
        self,
        prompt: str,
        model: str,
        options: dict[str, Any] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        """Non-streaming generation."""
        opts = options or {}
        if max_tokens is not None:
            opts["num_predict"] = max_tokens
        if temperature is not None:
            opts["temperature"] = temperature

        full_prompt = f"{SYSTEM_PROMPT}\n\nUser: {prompt}\n\nAssistant:"

        payload = {
            "model": model,
            "prompt": full_prompt,
            "stream": False,
            "options": opts,
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/generate", json=payload
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("response", "")
        except Exception as e:
            logger.error(f"Ollama generate failed: {e}")
        return ""


# Singleton instance for export
ollama_service = OllamaService()
