"""
backend/context/schemas.py
Data structures shared across the context management pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ContextBundle:
    """
    Everything needed to assemble a well-scoped prompt for the LLM.

    Fields
    ------
    prefix : str
        Code above the cursor (for FIM / autocomplete).
    suffix : str
        Code below the cursor (for FIM / autocomplete). Empty for chat.
    system_prompt : str
        The fixed system instruction prepended to every request.
    code_context : str
        Relevant code extracted from the current file (function body, imports).
    rag_context : str
        Snippet(s) retrieved from the FAISS / RAG index.
    total_tokens_used : int
        Approximate token count of all context fields combined.
    """

    prefix: str = ""
    suffix: str = ""
    language: str = ""
    system_prompt: str = ""
    code_context: str = ""
    rag_context: str = ""
    total_tokens_used: int = 0

    # ── convenience ───────────────────────────────────────────────────────

    def as_chat_messages(self) -> list[dict[str, str]]:
        """
        Convert the bundle into an Ollama-compatible messages list.
        Suitable for passing to /api/chat.
        """
        messages: list[dict[str, str]] = []

        # System instruction
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})

        # Inject RAG context as a system-level context note
        if self.rag_context:
            messages.append({
                "role": "system",
                "content": f"Relevant code from the project:\n\n{self.rag_context}",
            })

        # Inject file-level code context
        if self.code_context:
            messages.append({
                "role": "system",
                "content": f"Current file context:\n\n{self.code_context}",
            })

        return messages

    def as_fim_prompt(self) -> str:
        """
        Assemble a DeepSeek-Coder FIM prompt from prefix/suffix.
        Use this for autocomplete requests.
        """
        return (
            f"<|fim_prefix|>{self.prefix}"
            f"<|fim_suffix|>{self.suffix}"
            f"<|fim_middle|>"
        )

    @property
    def budget_remaining(self) -> int:
        """Tokens still available within a 4096-token context window."""
        return max(0, 4096 - self.total_tokens_used)
