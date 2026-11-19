from fastapi import APIRouter, HTTPException, Query
from ..database.chat_history import ChatHistoryDB
from typing import List, Optional
from pydantic import BaseModel

router = APIRouter()
db = ChatHistoryDB()

class SessionTitleUpdate(BaseModel):
    title: str

class MessageCreate(BaseModel):
    session_id: str
    role: str
    content: str

@router.get("/sessions")
async def get_sessions():
    return db.get_all_sessions()

@router.get("/session/{session_id}")
async def get_session_messages(session_id: str):
    messages = db.get_session_messages(session_id)
    if not messages and not any(s['id'] == session_id for s in db.get_all_sessions()):
        raise HTTPException(status_code=404, detail="Session not found")
    return messages

@router.post("/session")
async def create_session(title: Optional[str] = "New Chat"):
    session_id = db.create_session(title)
    return {"id": session_id}

@router.post("/message")
async def add_message(msg: MessageCreate):
    msg_id = db.add_message(msg.session_id, msg.role, msg.content)
    return {"id": msg_id}

@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    db.delete_session(session_id)
    return {"status": "success"}

@router.patch("/session/{session_id}")
async def update_session_title(session_id: str, data: SessionTitleUpdate):
    db.update_session_title(session_id, data.title)
    return {"status": "success"}

@router.get("/search")
async def search_messages(q: str = Query(...)):
    return db.search_messages(q)
