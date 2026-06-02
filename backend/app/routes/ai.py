"""
Dashboard endpoints: ask the model for analysis or questions on demand.

The deterministic design pipeline runs through /jobs/process — these endpoints
are for ad-hoc UI calls (engineering dashboard).
"""
from fastapi import APIRouter, HTTPException

from .. import openai_client

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/analyze")
async def analyze(payload: dict):
    image = payload.get("image_url") or payload.get("image_base64")
    if not image:
        raise HTTPException(status_code=400, detail="image_url or image_base64 required")
    context = payload.get("context") or {}
    return await openai_client.analyze_floor_plan(image, context)


@router.post("/questions")
async def questions(payload: dict):
    analysis = payload.get("analysis") or {}
    context = payload.get("context") or {}
    return {"questions": await openai_client.generate_questions(analysis, context)}
