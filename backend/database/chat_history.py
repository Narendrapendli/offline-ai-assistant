import sqlite3
import uuid
from datetime import datetime
import os

class ChatHistoryDB:
    def __init__(self, db_path="chat_history.db"):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    created_at TIMESTAMP,
                    last_updated TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    role TEXT,
                    content TEXT,
                    timestamp TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
                )
            """)

    def create_session(self, title="New Chat"):
        session_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title, created_at, last_updated) VALUES (?, ?, ?, ?)",
                (session_id, title, now, now)
            )
        return session_id

    def add_message(self, session_id, role, content):
        message_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
                (message_id, session_id, role, content, now)
            )
            conn.execute(
                "UPDATE sessions SET last_updated = ? WHERE id = ?",
                (now, session_id)
            )
        return message_id

    def get_session_messages(self, session_id):
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,)
            )
            return [{"role": row[0], "content": row[1], "timestamp": row[2]} for row in cursor.fetchall()]

    def get_all_sessions(self):
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT id, title, created_at, last_updated FROM sessions ORDER BY last_updated DESC"
            )
            return [{"id": row[0], "title": row[1], "created_at": row[2], "last_updated": row[3]} for row in cursor.fetchall()]

    def delete_session(self, session_id):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def update_session_title(self, session_id, title):
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE sessions SET title = ? WHERE id = ?",
                (title, session_id)
            )

    def search_messages(self, query):
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT m.session_id, s.title, m.role, m.content, m.timestamp 
                FROM messages m
                JOIN sessions s ON m.session_id = s.id
                WHERE m.content LIKE ?
                ORDER BY m.timestamp DESC
            """, (f"%{query}%",))
            return [{
                "session_id": row[0],
                "session_title": row[1],
                "role": row[2],
                "content": row[3],
                "timestamp": row[4]
            } for row in cursor.fetchall()]
