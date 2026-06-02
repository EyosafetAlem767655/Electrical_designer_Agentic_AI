"""
Project orchestration endpoints invoked by the Next.js webapp.

The webapp (Vercel) collects architect/project metadata then POSTs to /projects/init.
The backend then:
  1. Creates / updates the Supabase project row.
  2. Sends a Telegram invite to the architect (when group/chat is known).
  3. Returns the project_code so the webapp can show the t.me/<bot>?start=<code> link.
"""
from __future__ import annotations
import secrets
import string

from fastapi import APIRouter, HTTPException

from .. import jobs
from ..supabase_client import get_supabase
from ..telegram import project_start_link, send_project_invite

router = APIRouter(prefix="/projects", tags=["projects"])


def _generate_project_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _floor_names_from_payload(payload: dict) -> list[str]:
    raw = payload.get("floor_names") or payload.get("floorNames") or payload.get("floor_sequence") or []
    if isinstance(raw, str):
        names = [line.strip() for line in raw.replace(",", "\n").splitlines() if line.strip()]
    elif isinstance(raw, list):
        names = [str(item).strip() for item in raw if str(item).strip()]
    else:
        names = []
    if names:
        return names
    total = payload.get("total_floors") or payload.get("totalFloors")
    try:
        count = int(total)
    except Exception:
        count = 0
    return [f"Floor {i + 1}" for i in range(max(0, count))]


def _insert_floors(project_id: str, floor_names: list[str]) -> list[dict]:
    if not floor_names:
        return []
    supabase = get_supabase()
    rows = [{"project_id": project_id, "floor_name": name, "floor_number": i} for i, name in enumerate(floor_names)]
    resp = supabase.table("floors").upsert(rows, on_conflict="project_id,floor_number").execute()
    return sorted(resp.data or [], key=lambda row: row.get("floor_number") or 0)


def _number_list(value, length: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        raise HTTPException(status_code=400, detail=f"{label} must be a {length}-number array")
    out = []
    for item in value:
        if not isinstance(item, (int, float)):
            raise HTTPException(status_code=400, detail=f"{label} must contain only numbers")
        out.append(float(item))
    return out


def _validate_point(value, label: str, width: float, height: float) -> list[float]:
    point = _number_list(value, 2, label)
    if point[0] < 0 or point[1] < 0 or point[0] > width or point[1] > height:
        raise HTTPException(status_code=400, detail=f"{label} is outside the source image bounds")
    return point


def _validate_bbox(value, label: str, width: float, height: float) -> list[float]:
    bbox = _number_list(value, 4, label)
    x1, y1, x2, y2 = bbox
    if x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail=f"{label} must be ordered as [x1,y1,x2,y2]")
    if x1 < 0 or y1 < 0 or x2 > width or y2 > height:
        raise HTTPException(status_code=400, detail=f"{label} is outside the source image bounds")
    return bbox


def _bbox_from_polygon(poly: list[list[float]]) -> list[float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [min(xs), min(ys), max(xs), max(ys)]


def _validate_markings(value) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="markings object is required")
    source_size = _number_list(value.get("source_size"), 2, "source_size")
    width, height = source_size
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="source_size must be positive")
    polygon_value = value.get("boundary_polygon")
    if not isinstance(polygon_value, list) or len(polygon_value) < 3:
        raise HTTPException(status_code=400, detail="boundary_polygon must contain at least 3 points")
    polygon = [_validate_point(point, f"boundary_polygon[{index}]", width, height) for index, point in enumerate(polygon_value)]
    design_bbox = _validate_bbox(value.get("design_bbox") or _bbox_from_polygon(polygon), "design_bbox", width, height)
    db_room_bbox = _validate_bbox(value.get("db_room_bbox"), "db_room_bbox", width, height)
    generator_room_bbox = _validate_bbox(value.get("generator_room_bbox"), "generator_room_bbox", width, height)
    warnings = value.get("warnings") if isinstance(value.get("warnings"), list) else []
    confidence = value.get("confidence") if isinstance(value.get("confidence"), (int, float)) else 0
    return {
        "source_size": source_size,
        "boundary_polygon": polygon,
        "design_bbox": design_bbox,
        "db_room_bbox": db_room_bbox,
        "generator_room_bbox": generator_room_bbox,
        "confidence": float(confidence),
        "warnings": warnings,
    }


@router.post("/init")
async def init_project(payload: dict):
    """Webapp entry point. Body:
       { project_name, architect_name, architect_telegram_username, building_purpose? }
    Returns the created project row + invite link.
    """
    supabase = get_supabase()
    project_name = (payload.get("project_name") or "").strip()
    architect_name = (payload.get("architect_name") or "").strip()
    username = (payload.get("architect_telegram_username") or "").strip().lstrip("@")
    if not project_name or not architect_name:
        raise HTTPException(status_code=400, detail="project_name and architect_name are required")
    if not username:
        username = f"pending-{_generate_project_code(6).lower()}"

    project_code = _generate_project_code()
    floor_names = _floor_names_from_payload(payload)
    row = {
        "project_name": project_name,
        "architect_name": architect_name,
        "architect_telegram_username": username,
        "project_code": project_code,
        "status": "created",
        "building_purpose": payload.get("building_purpose"),
        "special_requirements": payload.get("special_requirements") or payload.get("specialRequirements"),
        "total_floors": len(floor_names) or payload.get("total_floors") or payload.get("totalFloors"),
        "floor_sequence": floor_names,
        "current_floor": 0,
    }
    resp = supabase.table("projects").insert(row).execute()
    project = resp.data[0]
    floors = _insert_floors(project["id"], floor_names)
    return {"ok": True, "project": project, "floors": floors, "invite_link": project_start_link(project_code)}


@router.get("/{project_id}")
async def get_project(project_id: str):
    supabase = get_supabase()
    project = supabase.table("projects").select("*").eq("id", project_id).single().execute().data
    floors = supabase.table("floors").select("*").eq("project_id", project_id).order("floor_number").execute().data or []
    floor_ids = [f["id"] for f in floors]
    designs = (supabase.table("designs").select("*").in_("floor_id", floor_ids)
               .order("version", desc=True).execute().data) if floor_ids else []
    return {"project": project, "floors": floors, "designs": designs}


@router.post("/{project_id}/approve")
async def approve_floor(project_id: str, payload: dict):
    """Engineering dashboard signals approval for a floor and advances to the next floor."""
    supabase = get_supabase()
    floor_id = payload.get("floor_id")
    if not floor_id:
        raise HTTPException(status_code=400, detail="floor_id required")
    supabase.table("floors").update({"status": "approved"}).eq("id", floor_id).execute()
    project = supabase.table("projects").select("*").eq("id", project_id).single().execute().data
    current = project.get("current_floor") or 0
    floors = supabase.table("floors").select("*").eq("project_id", project_id).order("floor_number").execute().data or []
    next_index = current + 1
    if next_index >= len(floors):
        supabase.table("projects").update({"status": "completed"}).eq("id", project_id).execute()
        supabase.table("bot_sessions").update({"state": "PROJECT_COMPLETE"}).eq("project_id", project_id).execute()
        return {"ok": True, "completed": True}
    next_floor = floors[next_index]
    supabase.table("projects").update({"current_floor": next_index}).eq("id", project_id).execute()
    supabase.table("bot_sessions").update({
        "state": "AWAITING_IMAGE", "current_floor_id": next_floor["id"],
    }).eq("project_id", project_id).execute()
    chat_id = project.get("telegram_chat_id")
    if chat_id:
        from ..telegram import send_message
        await send_message(chat_id, f"Approved. Please send the architectural floor plan image for {next_floor['floor_name']}.")
    return {"ok": True, "next_floor": next_floor}


@router.post("/{project_id}/revise")
async def revise_floor(project_id: str, payload: dict):
    """Engineering dashboard requests a revision for a floor."""
    floor_id = payload.get("floor_id")
    note = (payload.get("improvement_request") or "").strip()
    if not floor_id or not note:
        raise HTTPException(status_code=400, detail="floor_id and improvement_request required")
    supabase = get_supabase()
    supabase.table("floors").update({"status": "revision_requested"}).eq("id", floor_id).execute()
    await jobs.create_job("revision_design", {
        "projectId": project_id, "floorId": floor_id, "improvementRequest": note,
    })
    await jobs.trigger_job_processing()
    return {"ok": True}


@router.get("/{project_id}/floors/{floor_id}")
async def get_floor(project_id: str, floor_id: str):
    supabase = get_supabase()
    floor = supabase.table("floors").select("*").eq("id", floor_id).single().execute().data
    designs = supabase.table("designs").select("*").eq("floor_id", floor_id).order("version", desc=True).execute().data
    return {"floor": floor, "designs": designs}


@router.post("/{project_id}/floors/{floor_id}/review-input")
async def save_review_input(project_id: str, floor_id: str, payload: dict):
    markings = _validate_markings(payload.get("markings"))
    answers = payload.get("answers") if isinstance(payload.get("answers"), dict) else {}
    queue_generation = bool(payload.get("queueGeneration", True))
    supabase = get_supabase()
    floor = supabase.table("floors").select("*").eq("project_id", project_id).eq("id", floor_id).single().execute().data
    existing_markings = floor.get("design_markings") if isinstance(floor.get("design_markings"), dict) else {}
    updated_markings = {**existing_markings, "confirmed": markings}
    status = "designing" if queue_generation else "marking_review"
    supabase.table("floors").update({
        "design_markings": updated_markings,
        "review_answers": answers,
        "status": status,
    }).eq("project_id", project_id).eq("id", floor_id).execute()
    supabase.table("conversations").insert({
        "project_id": project_id,
        "floor_id": floor_id,
        "sender": "bot",
        "message": "Engineering review confirmed floor markings and clarification answers.",
    }).execute()
    if queue_generation:
        await jobs.create_job("generate_design", {"projectId": project_id, "floorId": floor_id})
        await jobs.trigger_job_processing()
    return {"ok": True, "status": status, "markings": updated_markings}
