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
    if not project_name or not architect_name or not username:
        raise HTTPException(status_code=400, detail="project_name, architect_name, architect_telegram_username are required")

    project_code = _generate_project_code()
    row = {
        "project_name": project_name,
        "architect_name": architect_name,
        "architect_telegram_username": username,
        "project_code": project_code,
        "status": "created",
        "building_purpose": payload.get("building_purpose"),
    }
    resp = supabase.table("projects").insert(row).execute()
    project = resp.data[0]
    return {"ok": True, "project": project, "invite_link": project_start_link(project_code)}


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
