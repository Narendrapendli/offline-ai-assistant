from fastapi import APIRouter # type: ignore
from pydantic import BaseModel # type: ignore
from typing import List
from ..database.learning_store import LearningStore # type: ignore

router = APIRouter()
store = LearningStore()

class ErrorRecord(BaseModel):
    language: str
    error_type: str
    message: str
    file: str

@router.post("/record")
async def record_error(error: ErrorRecord):
    store.record_error(error.language, error.error_type, error.message, error.file)
    return {"status": "success"}

@router.get("/patterns")
async def get_patterns():
    return store.get_patterns()

@router.get("/weaknesses")
async def get_weaknesses():
    return store.get_weaknesses()
