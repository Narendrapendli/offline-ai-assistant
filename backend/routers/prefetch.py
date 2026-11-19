from fastapi import APIRouter, Response
from pydantic import BaseModel
from ..services.prefetch_cache import global_cache
from ..services.prefetch_worker import global_worker

router = APIRouter()

class PrefetchSchedule(BaseModel):
    prefix: str
    suffix: str
    language: str

@router.post("/schedule")
async def schedule_prefetch(data: PrefetchSchedule):
    await global_worker.schedule(data.prefix, data.suffix, data.language)
    return {"status": "scheduled"}

@router.get("/status")
async def get_prefetch_status():
    return {
        "cache_size": len(global_cache._cache),
        "queue_size": global_worker.queue.qsize()
    }
