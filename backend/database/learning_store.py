import sqlite3
import os
import time
from typing import List, Dict

DB_PATH = os.path.join(os.path.dirname(__file__), "learning.db")

class LearningStore:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS errors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    language TEXT NOT NULL,
                    error_type TEXT,
                    error_message TEXT,
                    file TEXT,
                    timestamp REAL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS patterns (
                    error_type TEXT PRIMARY KEY,
                    count INTEGER DEFAULT 0,
                    last_seen REAL
                )
            """)
            conn.commit()

    def record_error(self, language: str, error_type: str, message: str, file: str):
        with sqlite3.connect(self.db_path) as conn:
            now = time.time()
            conn.execute(
                "INSERT INTO errors (language, error_type, error_message, file, timestamp) VALUES (?, ?, ?, ?, ?)",
                (language, error_type, message, file, now)
            )
            conn.execute("""
                INSERT INTO patterns (error_type, count, last_seen) 
                VALUES (?, 1, ?) 
                ON CONFLICT(error_type) DO UPDATE SET 
                count = count + 1, last_seen = ?
            """, (error_type, now, now))
            conn.commit()

    def get_patterns(self, language: str = "") -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM patterns ORDER BY count DESC")
            return [dict(row) for row in cursor.fetchall()]

    def get_weaknesses(self) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT error_type, count FROM patterns ORDER BY count DESC LIMIT 5")
            return [dict(row) for row in cursor.fetchall()]
