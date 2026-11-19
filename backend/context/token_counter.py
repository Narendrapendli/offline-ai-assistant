"""
backend/context/token_counter.py
Lightweight token estimation utilities (no model tokenizer required).

Rule of thumb: ~3.5 characters per token (GPT / LLaMA family).
This is an approximation — actual token counts vary by model and content.
"""

from __future__ import annotations

from typing import List

CHARS_PER_TOKEN: float = 3.5


def count_tokens_approximate(text: str) -> int:
    """
    Estimate the number of tokens in *text*.

    Uses the 3.5-chars-per-token heuristic which is accurate within ±15%
    for English + code mixed content.

    Parameters
    ----------
    text : str
        Input string to measure.

    Returns
    -------
    int
        Estimated token count (always >= 0).
    """
    if not text:
        return 0
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def truncate_to_token_limit(text: str, max_tokens: int, from_end: bool = False) -> str:
    """
    Truncate *text* so its approximate token count does not exceed *max_tokens*.

    Parameters
    ----------
    text : str
        Text to truncate.
    max_tokens : int
        Maximum allowed tokens.
    from_end : bool
        If True, truncate from the beginning (keep the tail).
        If False (default), truncate from the end (keep the head).

    Returns
    -------
    str
        Truncated text (may be the full text if already within budget).

    Examples
    --------
    >>> t = truncate_to_token_limit("hello world foo bar", max_tokens=3)
    >>> count_tokens_approximate(t) <= 3
    True
    """
    if not text:
        return ""

    char_limit = int(max_tokens * CHARS_PER_TOKEN)

    if len(text) <= char_limit:
        return text

    if from_end:
        # Keep the tail (useful for prefix context — recent code is most relevant)
        return text[-char_limit:]  # type: ignore
    else:
        return text[:char_limit]  # type: ignore


def split_into_chunks(text: str, chunk_size: int, overlap: int = 0) -> List[str]:
    """
    Split *text* into chunks of at most *chunk_size* tokens.

    Parameters
    ----------
    text : str
        Source text to split.
    chunk_size : int
        Target maximum tokens per chunk.
    overlap : int
        Number of tokens to repeat at the start of each subsequent chunk.
        Useful for sliding-window RAG indexing.

    Returns
    -------
    List[str]
        List of text chunks. May be a single-element list if text fits in one chunk.

    Examples
    --------
    >>> chunks = split_into_chunks("a " * 200, chunk_size=50, overlap=10)
    >>> all(count_tokens_approximate(c) <= 55 for c in chunks)  # slight slack for overlap
    True
    """
    if not text:
        return []

    char_chunk  = int(chunk_size  * CHARS_PER_TOKEN)
    char_overlap = int(overlap    * CHARS_PER_TOKEN)

    if len(text) <= char_chunk:
        return [text]

    step = int(max(1, char_chunk - char_overlap))
    chunks: List[str] = []
    pos: int = 0

    while pos < len(text):
        end: int = int(pos + char_chunk)
        chunk: str = str(text[pos:end])
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        pos = int(pos + step)

    return chunks
