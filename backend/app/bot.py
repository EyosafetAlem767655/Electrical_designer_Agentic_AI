"""
Telegram bot state machine — ported from lib/bot.ts.

Architect flow:
  /start → AWAITING_VERIFICATION
  full name + project → COLLECTING_PURPOSE
  purpose → AWAITING_FLOOR_COUNT
  floor count → AWAITING_FLOOR_NAMES
  floor names → COLLECTING_SPECIAL_REQUIREMENTS
  special reqs → AWAITING_IMAGE  (per floor)
  image received → ANALYZING / DESIGNING (queued)
  AI questions answered → DESIGNING (queued)
  design ready → AWAITING_APPROVAL
  revision feedback → DESIGNING (revision queued)
  approval → next floor or done
"""
from __future__ import annotations
import logging
from typing import Optional

from .supabase_client import get_supabase
from .state_machine import (
    parse_bind_command, parse_start_payload, parse_verification_details,
    parse_positive_integer, parse_floor_names, normalize_telegram_username,
    is_project_name_match, is_person_name_match, normalize_project_code,
)
from .telegram import send_message, send_project_invite
from . import jobs

log = logging.getLogger("bot")


async def _log_message(project_id: Optional[str], floor_id: Optional[str], sender: str,
                       message: str, message_type: str = "text", telegram_message_id: Optional[int] = None) -> None:
    if not project_id:
        return
    get_supabase().table("conversations").insert({
        "project_id": project_id, "floor_id": floor_id, "sender": sender,
        "message": message, "message_type": message_type,
        "telegram_message_id": telegram_message_id,
    }).execute()


async def _bot_reply(chat_id: int, project_id: Optional[str], floor_id: Optional[str], text: str) -> None:
    await send_message(chat_id, text)
    await _log_message(project_id, floor_id, "bot", text)


def _get_or_create_session(message: dict) -> dict:
    user = message.get("from")
    if not user:
        raise ValueError("Telegram message has no sender")

    supabase = get_supabase()
    username = normalize_telegram_username(user.get("username")) or None
    existing = supabase.table("bot_sessions").select("*").eq("telegram_user_id", user["id"]).maybe_single().execute()
    if existing and existing.data:
        return existing.data

    inserted = supabase.table("bot_sessions").insert({
        "telegram_user_id": user["id"],
        "telegram_chat_id": message["chat"]["id"],
        "telegram_username": username,
        "state": "AWAITING_VERIFICATION",
    }).execute()
    return inserted.data[0]


def _update_session(session_id: str, values: dict) -> dict:
    supabase = get_supabase()
    resp = supabase.table("bot_sessions").update(values).eq("id", session_id).execute()
    return resp.data[0] if resp.data else {}


def _start_link_required_message() -> str:
    return ("Please open the project-specific Telegram start link from your project admin before verifying. "
            "The link includes the project start code I need to identify the assignment.")


def _find_project_for_verification(full_name: str, project_name: str,
                                  username: Optional[str], project_hint: Optional[str]) -> Optional[dict]:
    if not project_hint:
        return None
    supabase = get_supabase()
    normalized_username = normalize_telegram_username(username) if username else None
    normalized_hint = normalize_project_code(project_hint)
    resp = supabase.table("projects").select("*").in_(
        "status", ["created", "awaiting_verification", "verified", "in_progress"]
    ).execute()
    for project in resp.data or []:
        stored = normalize_telegram_username(project.get("architect_telegram_username") or "")
        username_ok = not stored or stored.startswith("pending-") or (normalized_username and stored == normalized_username)
        hint_ok = (project.get("id") == project_hint
                   or (project.get("project_code") and normalize_project_code(project["project_code"]) == normalized_hint))
        if (hint_ok and username_ok
                and is_project_name_match(project_name, project.get("project_name") or "")
                and is_person_name_match(full_name, project.get("architect_name") or "")):
            return project
    return None


def _verify_project(project: dict, message: dict, session: dict) -> None:
    supabase = get_supabase()
    update = {
        "status": "verified",
        "telegram_chat_id": message["chat"]["id"],
        "telegram_user_id": (message.get("from") or {}).get("id"),
        "architect_telegram_username": session.get("telegram_username") or project.get("architect_telegram_username"),
    }
    try:
        supabase.table("projects").update(update).eq("id", project["id"]).execute()
    except Exception:
        update.pop("telegram_user_id", None)
        supabase.table("projects").update(update).eq("id", project["id"]).execute()


async def _bind_group(project: dict, message: dict) -> None:
    from datetime import datetime, timezone
    supabase = get_supabase()
    chat = message["chat"]
    update = {
        "group_chat_id": chat["id"],
        "telegram_group_title": chat.get("title"),
        "telegram_group_bound_at": datetime.now(timezone.utc).isoformat(),
        "telegram_outreach_status": "bound",
        "status": "awaiting_verification" if project.get("status") == "created" else project.get("status"),
    }
    try:
        supabase.table("projects").update(update).eq("id", project["id"]).execute()
    except Exception:
        supabase.table("projects").update({
            "group_chat_id": chat["id"],
            "status": "awaiting_verification" if project.get("status") == "created" else project.get("status"),
        }).eq("id", project["id"]).execute()


async def _handle_group_message(message: dict) -> dict:
    text = (message.get("text") or "").strip()
    project_code = parse_bind_command(text)
    if not project_code:
        return {"ok": True, "ignored": "non-bind group message"}
    supabase = get_supabase()
    resp = supabase.table("projects").select("*").ilike("project_code", project_code).maybe_single().execute()
    project = resp.data if resp else None
    if not project:
        await send_message(message["chat"]["id"],
                           "I could not find a project for that bind code. Please copy the exact /bind command from the dashboard.")
        return {"ok": False, "error": "project_not_found"}
    await _bind_group(project, message)
    await _log_message(project["id"], None, "bot",
                       f"Telegram group bound: {message['chat'].get('title') or message['chat']['id']}",
                       "command", message.get("message_id"))
    try:
        await send_project_invite(message["chat"]["id"],
                                  project.get("architect_telegram_username") or "",
                                  project.get("architect_name"),
                                  project.get("project_code") or project["id"])
        supabase.table("projects").update({"telegram_outreach_status": "invite_sent"}).eq("id", project["id"]).execute()
    except Exception as e:
        supabase.table("projects").update({"telegram_outreach_status": "invite_failed"}).eq("id", project["id"]).execute()
        await send_message(message["chat"]["id"],
                           f"Group bound for {project['project_name']}, but I could not send the architect invite: {e}")
        return {"ok": False, "error": "invite_failed"}
    return {"ok": True, "bound": True, "projectId": project["id"]}


def _image_attachment(message: dict) -> Optional[dict]:
    photos = message.get("photo") or []
    if photos:
        photo = sorted(photos,
                       key=lambda p: (p.get("width", 0) * p.get("height", 0)) or p.get("file_size", 0),
                       reverse=True)[0]
        if photo.get("file_id"):
            return {"fileId": photo["file_id"], "filename": "floor-plan.jpg", "contentType": "image/jpeg"}
    document = message.get("document") or {}
    file_id = document.get("file_id")
    if not file_id:
        return None
    descriptor = f"{document.get('mime_type') or ''} {document.get('file_name') or ''}"
    import re
    if not re.search(r"(^|\s)image/(png|jpe?g)|\.(png|jpe?g)$", descriptor, re.I):
        return None
    mime = document.get("mime_type") or ""
    return {
        "fileId": file_id,
        "filename": document.get("file_name") or "floor-plan-image",
        "contentType": mime if mime.startswith("image/") else "image/png",
    }


def _mark_floor_image_received(floor_id: str) -> None:
    supabase = get_supabase()
    try:
        supabase.table("floors").update({"status": "image_received"}).eq("id", floor_id).execute()
    except Exception:
        supabase.table("floors").update({"status": "pdf_received"}).eq("id", floor_id).execute()


def _current_floor(project_id: str, current_floor_index: int) -> dict:
    supabase = get_supabase()
    resp = supabase.table("floors").select("*").eq("project_id", project_id).eq("floor_number", current_floor_index).single().execute()
    return resp.data


def _create_floors(project: dict, names: list[str]) -> list[dict]:
    supabase = get_supabase()
    rows = [{"project_id": project["id"], "floor_name": name, "floor_number": i} for i, name in enumerate(names)]
    resp = supabase.table("floors").upsert(rows, on_conflict="project_id,floor_number").execute()
    return sorted(resp.data, key=lambda f: f["floor_number"])


async def handle_telegram_update(update: dict) -> dict:
    message = update.get("message")
    if not message or not message.get("from") or (message["from"].get("is_bot")):
        return {"ok": True, "ignored": True}

    chat_type = message["chat"].get("type")
    if chat_type != "private":
        return await _handle_group_message(message)

    supabase = get_supabase()
    session = _get_or_create_session(message)
    text = (message.get("text") or message.get("caption") or "").strip()

    await _log_message(
        session.get("project_id"), session.get("current_floor_id"), "architect",
        text or (message.get("document") or {}).get("file_name") or ("Image attachment" if message.get("photo") else "Attachment"),
        "photo" if message.get("photo") else ("document" if message.get("document") else "text"),
        message.get("message_id"),
    )

    chat_id = message["chat"]["id"]

    if text.startswith("/start"):
        project_hint = parse_start_payload(text)
        session = _update_session(session["id"], {
            "project_id": None, "current_floor_id": None,
            "state": "AWAITING_VERIFICATION",
            "telegram_chat_id": chat_id,
            "data": {"projectHint": project_hint} if project_hint else {},
        })
        await _bot_reply(chat_id, None, None,
                         "Project link received. To verify your identity, please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name"
                         if project_hint else _start_link_required_message())
        return {"ok": True}

    if not session.get("project_id") or session.get("state") == "AWAITING_VERIFICATION":
        project_hint = (session.get("data") or {}).get("projectHint")
        if not project_hint:
            await _bot_reply(chat_id, None, None, _start_link_required_message())
            return {"ok": True}
        if not text:
            await _bot_reply(chat_id, None, None,
                             "Please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name")
            return {"ok": True}
        details = parse_verification_details(text)
        if not details["fullName"] or not details["projectName"]:
            await _bot_reply(chat_id, None, None,
                             "Please send your exact full name and exact project name like this:\nFull name: Your Name\nProject: Project Name")
            return {"ok": True}
        project = _find_project_for_verification(details["fullName"], details["projectName"],
                                                session.get("telegram_username"), project_hint)
        if not project:
            await _bot_reply(chat_id, None, None,
                             "I'm sorry, I could not verify that start code, full name, and project name. Please check the project-specific link and exact assignment details with your project admin.")
            return {"ok": True}
        _verify_project(project, message, session)
        session = _update_session(session["id"], {
            "project_id": project["id"], "state": "COLLECTING_PURPOSE", "telegram_chat_id": chat_id,
        })
        await _bot_reply(chat_id, project["id"], None,
                         f"Great! You're verified for project {project['project_name']}. "
                         "What is the primary purpose of this building? For example: residential, commercial, "
                         "mixed-use, industrial, hospital, hotel, or school.")
        return {"ok": True}

    project = supabase.table("projects").select("*").eq("id", session["project_id"]).single().execute().data

    state = session.get("state")

    if state == "COLLECTING_PURPOSE":
        supabase.table("projects").update({"building_purpose": text}).eq("id", project["id"]).execute()
        _update_session(session["id"], {"state": "AWAITING_FLOOR_COUNT"})
        await _bot_reply(chat_id, project["id"], None,
                         "How many total floors does this building have, including basements, ground floor, and rooftop if applicable?")
        return {"ok": True}

    if state == "AWAITING_FLOOR_COUNT":
        count = parse_positive_integer(text)
        if not count:
            await _bot_reply(chat_id, project["id"], None, "Please send the total floor count as a number, for example: 6.")
            return {"ok": True}
        _update_session(session["id"], {"state": "AWAITING_FLOOR_NAMES", "data": {"totalFloors": count}})
        supabase.table("projects").update({"total_floors": count, "status": "in_progress"}).eq("id", project["id"]).execute()
        await _bot_reply(chat_id, project["id"], None,
                         f"Please send the {count} floor names in bottom-to-top order, one per line. "
                         "Example:\nBasement\nGround Floor\nFirst Floor\nRooftop")
        return {"ok": True}

    if state == "AWAITING_FLOOR_NAMES":
        count = int((session.get("data") or {}).get("totalFloors") or project.get("total_floors") or 0)
        parsed = parse_floor_names(text, count)
        if not parsed["ok"]:
            await _bot_reply(chat_id, project["id"], None,
                             f"{parsed['error']} Please resend the full list, one floor per line, from lowest to highest.")
            return {"ok": True}
        floors = _create_floors(project, parsed["names"])
        supabase.table("projects").update({"floor_sequence": parsed["names"], "current_floor": 0}).eq("id", project["id"]).execute()
        _update_session(session["id"], {
            "state": "COLLECTING_SPECIAL_REQUIREMENTS",
            "current_floor_id": floors[0]["id"] if floors else None,
        })
        await _bot_reply(chat_id, project["id"], None,
                         "Any special electrical requirements? Include backup generators, solar, EV charging, "
                         "server rooms, industrial machinery, medical equipment, or similar loads.")
        return {"ok": True}

    if state == "COLLECTING_SPECIAL_REQUIREMENTS":
        floor = _current_floor(project["id"], project.get("current_floor") or 0)
        supabase.table("projects").update({"special_requirements": text}).eq("id", project["id"]).execute()
        _update_session(session["id"], {"state": "AWAITING_IMAGE", "current_floor_id": floor["id"]})
        await _bot_reply(chat_id, project["id"], floor["id"],
                         f"Let's begin with the lowest floor. Please send a clear PNG or JPG image of the architectural "
                         f"floor plan for {floor['floor_name']}. For best accuracy, send the original exported image as a "
                         f"file rather than a blurry photo.")
        return {"ok": True}

    if state in ("AWAITING_IMAGE", "AWAITING_PDF"):
        image = _image_attachment(message)
        if not image:
            await _bot_reply(chat_id, project["id"], session.get("current_floor_id"),
                             "Please upload the architectural floor plan as a clear PNG or JPG image only. "
                             "PDFs are no longer accepted for this workflow.")
            return {"ok": True}
        floor_id = session.get("current_floor_id") or _current_floor(project["id"], project.get("current_floor") or 0)["id"]
        _mark_floor_image_received(floor_id)
        if text:
            supabase.table("floors").update({
                "architect_answers": {"raw": text, "source": "telegram_image_caption"}
            }).eq("id", floor_id).execute()
        await jobs.create_telegram_image_job({
            "projectId": project["id"], "floorId": floor_id,
            "fileId": image["fileId"], "filename": image["filename"], "contentType": image["contentType"],
        })
        await jobs.trigger_job_processing()
        _update_session(session["id"], {
            "state": "DESIGNING" if text else "ANALYZING",
            "current_floor_id": floor_id,
        })
        await _bot_reply(chat_id, project["id"], floor_id,
                         "Image and instructions received. I am analyzing the plan and preparing the deterministic electrical drawing."
                         if text else "Image received. I am analyzing the floor plan now.")
        return {"ok": True}

    if state in ("ANALYZING", "DESIGNING") and text and session.get("current_floor_id"):
        supabase.table("floors").update({
            "architect_answers": {"raw": text, "source": "telegram_followup_feedback"}
        }).eq("id", session["current_floor_id"]).execute()
        await _bot_reply(chat_id, project["id"], session["current_floor_id"],
                         "I added that feedback to the current floor. If processing has already started, "
                         "the engineering dashboard can request a revision with the same note.")
        return {"ok": True}

    if state == "AWAITING_APPROVAL" and text and session.get("current_floor_id"):
        supabase.table("floors").update({
            "status": "revision_requested",
            "architect_answers": {"raw": text, "source": "telegram_revision_feedback"},
        }).eq("id", session["current_floor_id"]).execute()
        await jobs.create_job("revision_design", {
            "projectId": project["id"], "floorId": session["current_floor_id"], "improvementRequest": text,
        })
        await jobs.trigger_job_processing()
        _update_session(session["id"], {"state": "DESIGNING"})
        await _bot_reply(chat_id, project["id"], session["current_floor_id"],
                         "Revision feedback received. I am generating an updated deterministic PNG and PDF.")
        return {"ok": True}

    if state == "AWAITING_ANSWERS":
        if not text:
            await _bot_reply(chat_id, project["id"], session.get("current_floor_id"),
                             "Please send your answers as text so I can generate the design.")
            return {"ok": True}
        supabase.table("floors").update({
            "architect_answers": {"raw": text}, "status": "designing",
        }).eq("id", session["current_floor_id"]).execute()
        await jobs.create_job("generate_design", {
            "projectId": project["id"], "floorId": session["current_floor_id"],
        })
        await jobs.trigger_job_processing()
        _update_session(session["id"], {"state": "DESIGNING"})
        await _bot_reply(chat_id, project["id"], session["current_floor_id"],
                         "Thank you. I am generating the electrical design and will send it for engineering review.")
        return {"ok": True}

    await _bot_reply(chat_id, project["id"], session.get("current_floor_id"),
                     "Your current project step is being processed. I will message you when the next action is needed.")
    return {"ok": True}
