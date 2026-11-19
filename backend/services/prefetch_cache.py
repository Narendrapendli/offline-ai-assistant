"""
backend/services/prefetch_cache.py
Simple in-memory cache for autocompletions.
"""
import collections

class PrefetchCache:
    def __init__(self, size: int = 100):
        self._cache: collections.OrderedDict[str, str] = collections.OrderedDict()
        self.max_size = size

    def get(self, prefix: str) -> str | None:
        if prefix in self._cache:
            self._cache.move_to_end(prefix)
            return self._cache[prefix]
        return None

    def set(self, prefix: str, completion: str):
        self._cache[prefix] = completion
        self._cache.move_to_end(prefix)
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)

global_cache = PrefetchCache()
