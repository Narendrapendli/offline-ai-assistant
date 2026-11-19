"""
backend/context/context_manager.py
High-level context assembly for autocomplete and chat requests.

Token budgets
─────────────
  Autocomplete  : 3 500 tokens total
    ├─ system prompt   :  ~100 tokens (fixed)
    ├─ imports         :  up to 200 tokens
    ├─ function body   :  up to 600 tokens
    ├─ RAG context     :  up to 400 tokens
    ├─ prefix (FIM)    : up to 2 000 tokens  (≈70% of remainder)
    └─ suffix (FIM)    : up to  200 tokens

  Chat          : 6 000 tokens total
    ├─ system prompt   :  ~100 tokens (fixed)
    ├─ history         : up to 1 000 tokens
    ├─ imports         :  up to 300 tokens
    ├─ code window     :  up to 800 tokens
    ├─ RAG context     :  up to 800 tokens
    └─ user query      :  remainder
"""

from __future__ import annotations

from .schemas import ContextBundle
from .token_counter import count_tokens_approximate, truncate_to_token_limit
from .code_window_extractor import CodeWindowExtractor
from .import_extractor import ImportExtractor
from ..services.ollama_service import SYSTEM_PROMPT

# Budget constants (tokens)
AUTOCOMPLETE_BUDGET        = 3_500
AUTOCOMPLETE_IMPORT_BUDGET =   200
AUTOCOMPLETE_FN_BUDGET     =   600
AUTOCOMPLETE_RAG_BUDGET    =   400
AUTOCOMPLETE_PREFIX_BUDGET = 2_000
AUTOCOMPLETE_SUFFIX_BUDGET =   200

CHAT_BUDGET           = 6_000
CHAT_HISTORY_BUDGET   = 1_000
CHAT_IMPORT_BUDGET    =   300
CHAT_CODE_WIN_BUDGET  =   800
CHAT_RAG_BUDGET       =   800


class ContextManager:
    """
    Assembles context bundles for the LLM, respecting token budgets.
    All heavy parsing is delegated to CodeWindowExtractor and ImportExtractor.
    """

    def __init__(self) -> None:
        self._window   = CodeWindowExtractor()
        self._imports  = ImportExtractor()

    # ── Public API ────────────────────────────────────────────────────────

    def build_autocomplete_context(
        self,
        file_content: str,
        cursor_line: int,
        cursor_col: int,
        language: str,
        rag_results: list[str] | None = None,
    ) -> ContextBundle:
        """
        Build a ContextBundle optimised for FIM autocomplete.

        Parameters
        ----------
        file_content : str
            Full text of the file being edited.
        cursor_line : int
            0-indexed line of the cursor.
        cursor_col : int
            0-indexed column of the cursor.
        language : str
            Language identifier (e.g. ``"python"``).
        rag_results : list[str] | None
            Pre-retrieved RAG snippets (chunks). Pass ``None`` to skip RAG.

        Returns
        -------
        ContextBundle
            Fully assembled bundle ready for the autocomplete router.
        """
        bundle = ContextBundle(system_prompt=SYSTEM_PROMPT)
        used   = count_tokens_approximate(SYSTEM_PROMPT)

        # ── Imports ───────────────────────────────────────────────────────
        import_lines = self._imports.extract(file_content, language)
        import_text  = "\n".join(import_lines)
        import_text  = truncate_to_token_limit(import_text, AUTOCOMPLETE_IMPORT_BUDGET)
        bundle.code_context += import_text + "\n" if import_text else ""
        used += count_tokens_approximate(import_text)

        # ── Current function body ─────────────────────────────────────────
        fn_body = self._window.extract_current_function(
            file_content, cursor_line, language
        )
        fn_body = truncate_to_token_limit(fn_body, AUTOCOMPLETE_FN_BUDGET)
        bundle.code_context += fn_body
        used += count_tokens_approximate(fn_body)

        # ── RAG context ───────────────────────────────────────────────────
        if rag_results:
            rag_text = "\n\n---\n\n".join(rag_results)
            rag_text = truncate_to_token_limit(rag_text, AUTOCOMPLETE_RAG_BUDGET)
            bundle.rag_context = rag_text
            used += count_tokens_approximate(rag_text)

        # ── Prefix and suffix (FIM) ───────────────────────────────────────
        full_text     = file_content
        cursor_offset = self._offset_from_line_col(full_text, cursor_line, cursor_col)
        raw_prefix    = full_text[:cursor_offset]  # type: ignore
        raw_suffix    = full_text[cursor_offset:]  # type: ignore

        prefix = truncate_to_token_limit(raw_prefix, AUTOCOMPLETE_PREFIX_BUDGET, from_end=True)
        suffix = truncate_to_token_limit(raw_suffix, AUTOCOMPLETE_SUFFIX_BUDGET)

        bundle.prefix            = prefix
        bundle.suffix            = suffix
        bundle.total_tokens_used = used + count_tokens_approximate(prefix + suffix)

        return bundle

    def build_chat_context(
        self,
        file_content: str,
        cursor_line: int,
        language: str,
        user_query: str,
        rag_results: list[str] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> ContextBundle:
        """
        Build a ContextBundle optimised for multi-turn chat.

        Parameters
        ----------
        file_content : str
            Full text of the currently open file.
        cursor_line : int
            0-indexed cursor line (used for code window extraction).
        language : str
            Language identifier.
        user_query : str
            The user's current message.
        rag_results : list[str] | None
            Pre-retrieved RAG snippets.
        history : list[dict[str,str]] | None
            Prior conversation messages (role / content dicts).

        Returns
        -------
        ContextBundle
            Bundle ready to be converted to Ollama messages via
            ``bundle.as_chat_messages()``.
        """
        bundle = ContextBundle(system_prompt=SYSTEM_PROMPT)
        used   = count_tokens_approximate(SYSTEM_PROMPT)

        # ── Conversation history ──────────────────────────────────────────
        history_text = ""
        if history:
            history_text = "\n".join(
                f"{m.get('role','user').capitalize()}: {m.get('content','')}"
                for m in history
            )
            history_text = truncate_to_token_limit(history_text, CHAT_HISTORY_BUDGET, from_end=True)
            used += count_tokens_approximate(history_text)

        # ── Imports ───────────────────────────────────────────────────────
        import_lines = self._imports.extract(file_content, language)
        import_text  = "\n".join(import_lines)
        import_text  = truncate_to_token_limit(import_text, CHAT_IMPORT_BUDGET)
        used += count_tokens_approximate(import_text)

        # ── Code window (cursor vicinity) ─────────────────────────────────
        code_window = self._window.extract_cursor_window(
            file_content, cursor_line, n_before=50, n_after=20
        )
        code_window = truncate_to_token_limit(code_window, CHAT_CODE_WIN_BUDGET)
        used += count_tokens_approximate(code_window)

        # Build combined code_context
        parts: list[str] = []
        if import_text:
            parts.append(f"# Imports / dependencies\n{import_text}")
        if code_window:
            parts.append(f"# Code near cursor (line {cursor_line})\n{code_window}")
        bundle.code_context = "\n\n".join(parts)

        # ── RAG context ───────────────────────────────────────────────────
        if rag_results:
            rag_text = "\n\n---\n\n".join(rag_results)
            rag_text = truncate_to_token_limit(rag_text, CHAT_RAG_BUDGET)
            bundle.rag_context = rag_text
            used += count_tokens_approximate(rag_text)

        # ── User query (no truncation — if over budget we still include it) ─
        used += count_tokens_approximate(user_query)

        bundle.total_tokens_used = used
        return bundle

    # ── Private helpers ───────────────────────────────────────────────────

    @staticmethod
    def _offset_from_line_col(text: str, line: int, col: int) -> int:
        """Convert (line, col) — both 0-indexed — to a character offset."""
        lines = text.splitlines(keepends=True)
        offset = sum(len(lines[i]) for i in range(min(line, len(lines))))
        offset += min(col, len(lines[line]) if line < len(lines) else 0)
        return offset
