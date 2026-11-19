import sqlite3
import os
import time
from typing import List, Optional, Dict

DB_PATH = os.path.join(os.path.dirname(__file__), "snippets.db")

class SnippetStore:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS snippets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    language TEXT NOT NULL,
                    description TEXT,
                    code TEXT NOT NULL,
                    tags TEXT,
                    use_count INTEGER DEFAULT 0,
                    created_at REAL
                )
            """)
            conn.commit()

    def save_snippet(self, language: str, description: str, code: str, tags: str) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "INSERT INTO snippets (language, description, code, tags, created_at) VALUES (?, ?, ?, ?, ?)",
                (language, description, code, tags, time.time())
            )
            last_id = cursor.lastrowid
            conn.commit()
            if last_id is None:
                raise Exception("Failed to save snippet")
            return int(last_id)

    def search_snippets(self, query: str, language: Optional[str] = None) -> List[Dict]:
        sql = "SELECT * FROM snippets WHERE (description LIKE ? OR tags LIKE ?) "
        params = [f"%{query}%", f"%{query}%"]
        if language:
            sql += " AND language = ?"
            params.append(language)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def get_popular_snippets(self, language: str, limit: int = 10) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM snippets WHERE language = ? ORDER BY use_count DESC LIMIT ?",
                (language, limit)
            )
            return [dict(row) for row in cursor.fetchall()]

    def increment_use_count(self, snippet_id: int):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE snippets SET use_count = use_count + 1 WHERE id = ?", (snippet_id,))
            conn.commit()

    def find_similar(self, code_prefix: str, language: str) -> Optional[Dict]:
        # Simple similarity: find a snippet that starts with or contains the prefix
        # or matches the comment context.
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            # Try to find a snippet where the code starts with what the user is typing
            cursor = conn.execute(
                "SELECT * FROM snippets WHERE language = ? AND code LIKE ? LIMIT 1",
                (language, f"{code_prefix}%")
            )
            row = cursor.fetchone()
            return dict(row) if row else None
