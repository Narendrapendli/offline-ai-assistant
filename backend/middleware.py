"""
backend/middleware.py
Request logging middleware: logs method, path, status code, and response time.
Also tracks global statistics for the /stats endpoint.
"""

import time
import logging
from collections.abc import Callable

from fastapi import Request, Response  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore
from starlette.types import ASGIApp  # type: ignore

logger = logging.getLogger("ai_assistant.access")

# Global stats storage
class AppStats:
    start_time = time.time()
    total_requests = 0
    total_response_time_ms = 0.0
    cache_hits = 0
    cache_misses = 0

    @classmethod
    def get_avg_latency(cls) -> float:
        if cls.total_requests == 0:
            return 0.0
        return cls.total_response_time_ms / cls.total_requests

stats = AppStats()

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that emits one log line per request and tracks stats."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)  # type: ignore

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()

        # Track requests
        stats.total_requests += 1

        # Pass request down the middleware stack
        response: Response = await call_next(request)

        elapsed_ms = (time.perf_counter() - start) * 1000
        stats.total_response_time_ms += elapsed_ms

        # Build query string suffix
        qs = f"?{request.url.query}" if request.url.query else ""
        path = f"{request.url.path}{qs}"

        # Colour-code by status range
        status = response.status_code
        if status < 300:
            level = logging.INFO
        elif status < 400:
            level = logging.WARNING
        else:
            level = logging.ERROR

        logger.log(
            level,
            "%s %s -> %d  (%.1f ms)",
            request.method,
            path,
            status,
            elapsed_ms,
        )

        # Expose timing to client via header
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
        return response
