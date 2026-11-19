"""
backend/services/completion_postprocessor.py
Cleans up and truncates model autocomplete streams to prevent runaway generation.
"""

from __future__ import annotations

import re


class CompletionPostProcessor:
    """Stateful processor to clean tokens as they stream and determine early stop conditions."""

    def __init__(self, language: str):
        self.language = language
        self.accumulated = ""
        self.line_count = 0
        self.max_lines = 15

        # DeepSeek FIM tokens we need to stop at or strip
        self.stop_tokens = ["<｜fim hole｜>", "<｜end of sentence｜>", "<|EOT|>", "<｜EOT｜>"]

    def process_token(self, token: str) -> tuple[str, bool]:
        """
        Process a single incoming token.
        Returns: (cleaned_token, should_stop_boolean)
        """
        if not token:
            return "", False

        # Accumulate to check full context
        self.accumulated += token
        self.line_count += token.count("\n")

        # 1. Check for explicit stop tokens in the accumulated text
        for st in self.stop_tokens:
            if st in self.accumulated:
                # We found a stop token. The actual token being yielded right now
                # might contain part of it. We chop the token.
                # Easiest way for streaming: just tell caller to stop.
                return "", True

        # 2. Heuristic: stop on double newline if we've already generated some code
        # (This prevents the model from generating entirely new unrelated functions)
        if len(self.accumulated.strip()) > 10 and "\n\n" in token:
            return token.split("\n\n")[0], True

        # 3. Stop if we exceed line limits
        if self.line_count >= self.max_lines:
            return token, True

        # 4. Repetition detection (simple trailing repetition)
        # E.g., model gets stuck repeating "int x = 0; int x = 0;"
        if len(self.accumulated) > 50:
            tail = self.accumulated[-40:]
            # Check if the last 20 chars are just the previous 20 chars repeated
            if tail[:20] == tail[20:]:
                return "", True

        return token, False

    def clean_completion(self, raw: str, prefix: str) -> str:
        """
        Post-generation cleanup on the final composed string.
        (Useful if running in non-streaming mode or batching).
        """
        clean = raw
        
        # Remove any FIM markers
        for st in self.stop_tokens:
            clean = clean.split(st)[0]
            
        # The model sometimes echoes the very end of the prefix.
        # Find overlap and remove it.
        # e.g., Prefix ends with "def foo():" and model generates "foo():\n    pass"
        overlap = self._find_overlap(prefix[-50:], clean[:50])
        if overlap > 0:
            clean = clean[overlap:]

        return clean

    def _find_overlap(self, a: str, b: str) -> int:
        """Find the length of the longest suffix of 'a' that matches a prefix of 'b'."""
        max_overlap = min(len(a), len(b))
        for i in range(max_overlap, 0, -1):
            if a.endswith(b[:i]):
                return i
        return 0
