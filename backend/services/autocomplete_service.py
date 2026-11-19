"""
backend/services/autocomplete_service.py
Service for handling FIM (Fill-in-the-Middle) streaming autocompletions.
"""

from __future__ import annotations

import collections
from typing import AsyncGenerator
from .ollama_service import OllamaService
from .completion_postprocessor import CompletionPostProcessor
from ..context.schemas import ContextBundle
from ..core.logger import get_logger

logger = get_logger(__name__)


class AutocompleteService:
    """Manages the generation of inline autocompletions using the smaller model."""
    
    def __init__(self, ollama_service: OllamaService, model_name: str = "deepseek-coder:1.3b"):
        self.ollama = ollama_service
        self.model_name = model_name
        self._cache_size = 20
        self._cache: collections.OrderedDict[str, str] = collections.OrderedDict()

    def _get_comment_style(self, language: str) -> tuple[str, str]:
        """Returns (start, end) for comments based on language."""
        lang = language.lower()
        if lang in ["python", "shell", "bash", "ruby", "yaml", "r"]:
            return ("# ", "")
        if lang in ["javascript", "typescript", "cpp", "csharp", "go", "rust", "kotlin", "java", "php", "swift"]:
            return ("// ", "")
        if lang in ["html", "xml"]:
            return ("<!-- ", " -->")
        if lang in ["css"]:
            return ("/* ", " */")
        if lang in ["sql"]:
            return ("-- ", "")
        return ("// ", "")

    async def stream_completion(
        self, 
        bundle: ContextBundle, 
        max_tokens: int = 150
    ) -> AsyncGenerator[str, None]:
        """
        Generates a streaming completion using the DeepSeek FIM format.
        """
        cache_key = f"{bundle.prefix}|{bundle.suffix}"
        if cache_key in self._cache:
            yield self._cache[cache_key]
            return

        # Build language-appropriate structural hint
        c_start, c_end = self._get_comment_style(bundle.language or "python")
        injected_context = ""
        if bundle.code_context:
            injected_context += f"{c_start}Structural Context: {bundle.code_context.replace(chr(10), ' ')}{c_end}\n"
        
        fim_prompt = (
            f"<｜fim begin｜>{injected_context}{bundle.prefix}"
            f"<｜fim hole｜>{bundle.suffix}<｜fim end｜>"
        )

        processor = CompletionPostProcessor(language=bundle.language or "python")
        full_result = ""
        
        try:
            stream = self.ollama.generate_stream(
                prompt=fim_prompt,
                model=self.model_name,
                options={
                    "num_predict": max_tokens,
                    "temperature": 0.2,
                    "top_p": 0.9,
                    "stop": ["<｜end of sentence｜>", "<｜fim hole｜>", "<｜EOT｜>", "<|EOT|>"]
                }
            )
            
            async for token in stream:
                if not token: continue
                cleaned_token, should_stop = processor.process_token(token)
                if cleaned_token:
                    full_result += cleaned_token
                    yield cleaned_token
                if should_stop: break
                    
            if full_result.strip():
                final_clean = processor.clean_completion(full_result, bundle.prefix)
                self._cache[cache_key] = final_clean
                self._cache.move_to_end(cache_key)
                if len(self._cache) > self._cache_size:
                    self._cache.popitem(last=False)
                    
        except Exception as e:
            logger.error(f"Error during autocomplete stream: {e}")
            yield ""
