"""
Job queue — Supabase-backed, polled from /jobs/process.

Mirrors lib/jobs.ts:
- telegram_image: download Telegram image, upload to storage, enqueue analyze_floor
- analyze_floor: vision pass + question generation
- generate_design / revision_design: OpenAI plan spec + Python renderer
- pdf_export / pdf_compile: produce final PDFs
"""
from __future__ import annotations
import asyncio
import io
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from PIL import Image

from .config import get_settings
from . import openai_client
from .renderer import render_plan
from .schemas import normalize_plan_spec
from .storage import fetch_storage_base64, fetch_storage_bytes, upload_project_file
from .supabase_client import get_supabase
from .telegram import download_telegram_file, send_message, send_photo

log = logging.getLogger("jobs")

MAX_JOB_ATTEMPTS = 3
STALE_PROCESSING_MINUTES = 6


# ---------------------------------------------------------------------------
# Job table helpers
# ---------------------------------------------------------------------------

async def create_job(job_type: str, payload: dict) -> dict:
    supabase = get_supabase()
    resp = supabase.table("jobs").insert({"type": job_type, "payload": payload}).execute()
    return resp.data[0]


async def create_telegram_image_job(payload: dict) -> dict:
    try:
        return await create_job("telegram_image", payload)
    except Exception as e:
        msg = str(e)
        if not any(s in msg.lower() for s in ("check constraint", "violates", "schema cache")):
            raise
        return await create_job("telegram_pdf", {**payload, "fileKind": "image"})


async def trigger_job_processing() -> None:
    settings = get_settings()
    if not settings.public_base_url:
        return
    url = f"{settings.public_base_url.rstrip('/')}/jobs/process?mode=background"
    headers = {"x-job-mode": "background"}
    if settings.job_secret:
        headers["x-job-secret"] = settings.job_secret
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(url, headers=headers)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Worker loop
# ---------------------------------------------------------------------------

def _job_error_message(error: BaseException) -> str:
    return str(error) if error else "unknown error"


async def _recover_stale_processing_jobs() -> None:
    supabase = get_supabase()
    stale_before = (datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_MINUTES)).isoformat()
    resp = supabase.table("jobs").select("*").eq("status", "processing") \
        .lte("updated_at", stale_before).order("updated_at").limit(5).execute()
    for job in resp.data or []:
        message = f"Job timed out or was interrupted while processing for more than {STALE_PROCESSING_MINUTES} minutes."
        if (job.get("attempts") or 0) >= MAX_JOB_ATTEMPTS:
            supabase.table("jobs").update({"status": "failed", "error": message}).eq("id", job["id"]).execute()
            await _apply_job_failure_side_effects(job, message)
            continue
        supabase.table("jobs").update({
            "status": "pending",
            "error": f"{message} Retrying automatically.",
            "run_after": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job["id"]).execute()


async def _claim_next_job() -> Optional[dict]:
    supabase = get_supabase()
    await _recover_stale_processing_jobs()
    resp = supabase.table("jobs").select("*").eq("status", "pending") \
        .lte("run_after", datetime.now(timezone.utc).isoformat()) \
        .order("created_at").limit(1).execute()
    if not resp.data:
        return None
    job = resp.data[0]
    update = supabase.table("jobs").update({
        "status": "processing",
        "attempts": (job.get("attempts") or 0) + 1,
        "error": None,
    }).eq("id", job["id"]).eq("status", "pending").execute()
    if not update.data:
        return None
    return update.data[0]


async def _complete_job(job_id: str) -> None:
    get_supabase().table("jobs").update({"status": "completed", "error": None}).eq("id", job_id).execute()


async def _fail_job(job: dict, error: BaseException) -> None:
    supabase = get_supabase()
    message = _job_error_message(error)
    attempts = job.get("attempts") or 0
    if attempts >= MAX_JOB_ATTEMPTS:
        supabase.table("jobs").update({"status": "failed", "error": message}).eq("id", job["id"]).execute()
        await _apply_job_failure_side_effects(job, message)
        return
    backoff_ms = 30_000 * max(1, attempts)
    run_after = (datetime.now(timezone.utc) + timedelta(milliseconds=backoff_ms)).isoformat()
    supabase.table("jobs").update({
        "status": "pending", "error": message, "run_after": run_after,
    }).eq("id", job["id"]).execute()


async def _apply_job_failure_side_effects(job: dict, message: str) -> None:
    if job["type"] not in ("generate_design", "revision_design"):
        return
    payload = job.get("payload") or {}
    project_id = payload.get("projectId"); floor_id = payload.get("floorId")
    if not project_id or not floor_id:
        return
    supabase = get_supabase()
    supabase.table("floors").update({"status": "marking_review"}).eq("id", floor_id).execute()
    supabase.table("bot_sessions").update({
        "state": "ANALYZING", "current_floor_id": floor_id,
    }).eq("project_id", project_id).execute()
    project = supabase.table("projects").select("telegram_chat_id").eq("id", project_id).maybe_single().execute()
    text = ("Design generation did not finish. The engineering dashboard now shows the failed job "
            f"and can retry it. Error: {message}")
    supabase.table("conversations").insert({
        "project_id": project_id, "floor_id": floor_id, "sender": "bot", "message": text,
    }).execute()
    chat_id = (project.data or {}).get("telegram_chat_id") if project else None
    if chat_id:
        try:
            await send_message(chat_id, text)
        except Exception as e:
            log.exception("Failed to notify architect about design job failure: %s", e)


# ---------------------------------------------------------------------------
# Individual job handlers
# ---------------------------------------------------------------------------

def _image_extension(filename: Optional[str], content_type: Optional[str]) -> str:
    value = f"{content_type or ''} {filename or ''}".lower()
    return "jpg" if ("jpg" in value or "jpeg" in value) else "png"


async def _get_project_floor(project_id: str, floor_id: str) -> tuple[dict, dict]:
    supabase = get_supabase()
    project = supabase.table("projects").select("*").eq("id", project_id).single().execute().data
    floor = supabase.table("floors").select("*").eq("id", floor_id).single().execute().data
    return project, floor


def _image_size(image_bytes: bytes) -> list[int]:
    with Image.open(io.BytesIO(image_bytes)) as image:
        return [int(image.width), int(image.height)]


def _normalize_markings(analysis: dict, source_size: list[int]) -> dict:
    markings = analysis.get("markings") if isinstance(analysis.get("markings"), dict) else {}
    if not markings:
        w, h = source_size
        markings = {
            "source_size": source_size,
            "boundary_polygon": [[w * 0.05, h * 0.08], [w * 0.95, h * 0.08], [w * 0.95, h * 0.90], [w * 0.05, h * 0.90]],
            "design_bbox": [w * 0.05, h * 0.08, w * 0.95, h * 0.90],
            "db_room_bbox": [w * 0.05, h * 0.08, w * 0.28, h * 0.18],
            "generator_room_bbox": [w * 0.78, h * 0.08, w * 0.95, h * 0.20],
            "confidence": 0,
            "warnings": [{"severity": "warning", "message": "AI did not return marking candidates; review and adjust manually."}],
        }
    markings["source_size"] = source_size
    return markings


def _markings_for_generation(floor: dict) -> dict:
    design_markings = floor.get("design_markings") if isinstance(floor.get("design_markings"), dict) else {}
    confirmed = design_markings.get("confirmed") if isinstance(design_markings.get("confirmed"), dict) else None
    ai = design_markings.get("ai") if isinstance(design_markings.get("ai"), dict) else None
    return confirmed or ai or {}


def _fetch_previous_plan_spec(floor_id: str) -> Optional[dict]:
    supabase = get_supabase()
    files = supabase.table("files").select("*").eq("floor_id", floor_id).eq("file_type", "plan_spec") \
        .order("created_at", desc=True).limit(1).execute().data or []
    if not files:
        return None
    path = files[0].get("storage_path")
    if not path:
        return None
    try:
        return json.loads(fetch_storage_bytes(path).decode("utf-8"))
    except Exception as exc:
        log.warning("Could not load previous plan spec for floor %s: %s", floor_id, exc)
        return None


async def _process_analyze_floor(job: dict) -> None:
    payload = job.get("payload") or {}
    project_id = payload["projectId"]; floor_id = payload["floorId"]
    supabase = get_supabase()
    project, floor = await _get_project_floor(project_id, floor_id)
    if not floor.get("architectural_image_path"):
        raise RuntimeError("Floor has no architectural image path for analysis")

    image_bytes = fetch_storage_bytes(floor["architectural_image_path"])
    source_size = _image_size(image_bytes)
    image_source = floor.get("architectural_image_url") or f"data:image/png;base64,{fetch_storage_base64(floor['architectural_image_path'])}"
    context = {
        "project": project,
        "floor": floor,
        "source_size": source_size,
        "symbol_library": openai_client._symbol_catalog(),  # canonical prompt resource
    }
    analysis = await openai_client.analyze_floor_plan(image_source, context)
    markings = _normalize_markings(analysis, source_size)
    questions = await openai_client.generate_questions(analysis, context)

    supabase.table("floors").update({
        "status": "marking_review",
        "ai_analysis": analysis,
        "ai_questions": questions,
        "design_markings": {"ai": markings},
    }).eq("id", floor_id).execute()
    supabase.table("bot_sessions").update({
        "state": "ANALYZING", "current_floor_id": floor_id,
    }).eq("project_id", project_id).execute()

    if project.get("telegram_chat_id"):
        text = (
            f"I analyzed {floor['floor_name']}. The engineering dashboard now has "
            "GPT-5.5 marking candidates and clarification questions for review."
        )
        await send_message(project["telegram_chat_id"], text)
        supabase.table("conversations").insert({
            "project_id": project_id, "floor_id": floor_id, "sender": "bot", "message": text,
        }).execute()


async def _process_telegram_image(job: dict) -> None:
    payload = job.get("payload") or {}
    project_id = payload["projectId"]; floor_id = payload["floorId"]
    file_id = payload["fileId"]
    filename = payload.get("filename"); content_type = payload.get("contentType")
    supabase = get_supabase()

    image_bytes, _ = await download_telegram_file(file_id)
    ext = _image_extension(filename, content_type)
    storage_path = f"projects/{project_id}/floors/{floor_id}/architectural-image.{ext}"
    content_mime = "image/jpeg" if ext == "jpg" else "image/png"
    public_url = upload_project_file(storage_path, image_bytes, content_mime)

    try:
        supabase.table("files").insert({
            "project_id": project_id, "floor_id": floor_id,
            "file_type": "architectural_image",
            "storage_path": storage_path, "public_url": public_url,
            "original_filename": filename or f"floor-plan.{ext}",
        }).execute()
    except Exception as e:
        if "check constraint" in str(e).lower() or "schema cache" in str(e).lower():
            supabase.table("files").insert({
                "project_id": project_id, "floor_id": floor_id,
                "file_type": "floor_screenshot",
                "storage_path": storage_path, "public_url": public_url,
                "original_filename": filename or f"floor-plan.{ext}",
            }).execute()
        else:
            raise

    supabase.table("floors").update({
        "architectural_pdf_url": None, "architectural_image_url": public_url,
        "architectural_pdf_path": None, "architectural_image_path": storage_path,
        "status": "analyzing",
    }).eq("id", floor_id).execute()

    supabase.table("bot_sessions").update({
        "state": "ANALYZING", "current_floor_id": floor_id,
    }).eq("project_id", project_id).execute()

    await create_job("analyze_floor", {"projectId": project_id, "floorId": floor_id})


async def _process_generate_design(job: dict) -> None:
    payload = job.get("payload") or {}
    project_id = payload["projectId"]; floor_id = payload["floorId"]
    improvement_request = payload.get("improvementRequest")
    supabase = get_supabase()
    project, floor = await _get_project_floor(project_id, floor_id)

    existing_resp = supabase.table("designs").select("*").eq("floor_id", floor_id) \
        .order("version", desc=True).limit(2).execute()
    existing = existing_resp.data or []
    payload_version = payload.get("version")
    if isinstance(payload_version, (int, float)):
        version = int(payload_version)
    else:
        version = (existing[0]["version"] if existing else 0) + 1

    source_url = floor.get("architectural_image_url")
    if not source_url and floor.get("architectural_image_path"):
        b64 = fetch_storage_base64(floor["architectural_image_path"])
        source_url = f"data:image/png;base64,{b64}"
    if not source_url:
        raise RuntimeError("Floor has no architectural image source for deterministic plan rendering")

    architect_desc = (floor.get("architect_answers") or {}).get("raw") if floor.get("architect_answers") else None
    confirmed_markings = _markings_for_generation(floor)
    review_answers = floor.get("review_answers") if isinstance(floor.get("review_answers"), dict) else {}
    previous_plan_spec = _fetch_previous_plan_spec(floor_id) if improvement_request else None
    previous_design_image_url = existing[0].get("design_image_url") if improvement_request and existing else None
    log.info("[jobs:generate_design] OpenAI JSON plan specification started job=%s v=%s", job["id"], version)
    plan_spec = await openai_client.create_plan_spec(
        project_id=project_id, floor_id=floor_id,
        project_name=project["project_name"], floor_name=floor["floor_name"],
        building_purpose=project.get("building_purpose"),
        source_image_url=source_url,
        architect_description=architect_desc,
        special_requirements=project.get("special_requirements"),
        improvement_request=improvement_request,
        analysis=floor.get("ai_analysis"),
        confirmed_markings=confirmed_markings,
        review_answers=review_answers,
        previous_plan_spec=previous_plan_spec,
        previous_design_image_url=previous_design_image_url,
    )

    log.info("[jobs:generate_design] Python deterministic render started job=%s v=%s", job["id"], version)
    base_bytes = (httpx.get(source_url, timeout=60.0).content
                  if source_url.startswith("http")
                  else fetch_storage_bytes(floor["architectural_image_path"]))
    rendered = render_plan(spec=plan_spec, base_image_bytes=base_bytes,
                           meta={"project_name": project["project_name"], "floor_name": floor["floor_name"]})

    image_path = f"projects/{project_id}/floors/{floor_id}/design-v{version}.png"
    spec_path = f"projects/{project_id}/floors/{floor_id}/plan-spec-v{version}.json"
    debug_path = f"projects/{project_id}/floors/{floor_id}/debug-overlay-v{version}.png"
    design_url = upload_project_file(image_path, rendered["png"], "image/png")
    debug_url = upload_project_file(debug_path, rendered["debug_png"], "image/png")
    spec_url = upload_project_file(spec_path, json.dumps(rendered["plan_spec_json"], indent=2).encode("utf-8"),
                                   "application/json")

    boq_items = rendered["boq_items"]
    if not boq_items:
        raise RuntimeError("Programmatic BOQ generation returned no items for this design")

    await _save_generated_design(
        project=project, floor=floor, project_id=project_id, floor_id=floor_id,
        version=version, design_url=design_url, image_path=image_path,
        spec_url=spec_url, spec_path=spec_path,
        debug_url=debug_url, debug_path=debug_path,
        symbol_legend=rendered["legend"], boq_items=boq_items,
        improvement_request=improvement_request,
        revision_notes=f"Deterministic Python renderer output from validated OpenAI JSON plan specification. Spec artifact: {spec_path}",
        existing=existing, design_owner="Deterministic Python renderer",
    )


async def _save_generated_design(*, project: dict, floor: dict, project_id: str, floor_id: str,
                                version: int, design_url: str, image_path: str,
                                spec_url: str, spec_path: str, debug_url: str, debug_path: str,
                                symbol_legend: list, boq_items: list,
                                improvement_request: Optional[str], revision_notes: Optional[str],
                                existing: list, design_owner: str) -> None:
    supabase = get_supabase()
    design_payload: dict[str, Any] = {
        "floor_id": floor_id, "version": version,
        "design_image_url": design_url, "design_image_path": image_path,
        "design_pdf_url": None, "design_pdf_path": None,
        "annotations": [], "symbol_legend": symbol_legend, "boq_items": boq_items,
        "revision_notes": revision_notes, "improvement_request": improvement_request,
    }
    try:
        supabase.table("designs").insert(design_payload).execute()
    except Exception as e:
        if "boq_items" in str(e).lower() or "schema cache" in str(e).lower():
            design_payload.pop("boq_items", None)
            design_payload["revision_notes"] = (
                f"{revision_notes}\nOpenAI BOQ was generated, but this Supabase database is missing designs.boq_items. "
                "Apply supabase/migrations/003_design_boq_items.sql, then retry/revise this design."
            )
            supabase.table("designs").insert(design_payload).execute()
        else:
            raise

    keep = [item["id"] for item in existing[1:]]
    if keep:
        supabase.table("designs").delete().in_("id", keep).execute()

    for file_type, path, url in [
        ("electrical_design", image_path, design_url),
        ("plan_spec", spec_path, spec_url),
        ("debug_overlay", debug_path, debug_url),
    ]:
        try:
            supabase.table("files").insert({
                "project_id": project_id, "floor_id": floor_id,
                "file_type": file_type, "storage_path": path, "public_url": url,
            }).execute()
        except Exception:
            supabase.table("files").insert({
                "project_id": project_id, "floor_id": floor_id,
                "file_type": "electrical_design", "storage_path": path, "public_url": url,
            }).execute()

    supabase.table("floors").update({"status": "design_ready"}).eq("id", floor_id).execute()
    supabase.table("bot_sessions").update({"state": "AWAITING_APPROVAL"}).eq("project_id", project_id).execute()

    chat_id = project.get("telegram_chat_id")
    if chat_id:
        message = (
            f"{design_owner} has updated the electrical design and BOQ for {floor['floor_name']}. "
            "The revised image is ready for engineering review. Use the dashboard Save PDF button if you need a PDF."
            if version > 1 else
            f"{design_owner} has generated the clean electrical plan and BOQ for {floor['floor_name']}. "
            "The image is ready for engineering review. Use the dashboard Save PDF button if you need a PDF."
        )
        try:
            await send_message(chat_id, message)
            await send_photo(chat_id, design_url, f"{floor['floor_name']} revised electrical plan PNG")
        except Exception as e:
            log.exception("Failed to send design photo to architect: %s", e)
        supabase.table("conversations").insert({
            "project_id": project_id, "floor_id": floor_id, "sender": "bot", "message": message,
        }).execute()


# ---------------------------------------------------------------------------
# Public worker entrypoint
# ---------------------------------------------------------------------------

async def process_next_job() -> dict:
    job = await _claim_next_job()
    if not job:
        return {"processed": False}
    try:
        kind = job["type"]
        if kind == "telegram_pdf" and (job.get("payload") or {}).get("fileKind") == "image":
            await _process_telegram_image(job)
        elif kind == "telegram_image":
            await _process_telegram_image(job)
        elif kind in ("generate_design", "revision_design"):
            await _process_generate_design(job)
        elif kind == "analyze_floor":
            await _process_analyze_floor(job)
        else:
            log.warning("Unhandled job type: %s", kind)
        await _complete_job(job["id"])
        return {"processed": True, "jobId": job["id"], "type": kind}
    except BaseException as error:
        await _fail_job(job, error)
        raise


async def process_jobs(max_jobs: int = 10, max_seconds: int = 50) -> dict:
    import time
    started = time.time()
    results: list[dict] = []
    for _ in range(max_jobs):
        if time.time() - started > max_seconds:
            break
        try:
            result = await process_next_job()
            if not result.get("processed"):
                break
            results.append(result)
        except BaseException as error:
            results.append({"processed": False, "error": str(error)})
    return {
        "processed": sum(1 for r in results if r.get("processed")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


async def retry_failed_job(job_id: str) -> dict:
    supabase = get_supabase()
    current = supabase.table("jobs").select("*").eq("id", job_id).single().execute().data
    stale_before = datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_MINUTES)
    updated_at = datetime.fromisoformat((current.get("updated_at") or "").replace("Z", "+00:00")) if current.get("updated_at") else datetime.now(timezone.utc)
    if current.get("status") == "processing" and updated_at > stale_before:
        raise RuntimeError(f"Job is still processing. Wait {STALE_PROCESSING_MINUTES} minutes before recovering it.")
    if current.get("status") == "pending":
        await trigger_job_processing()
        return current
    resp = supabase.table("jobs").update({
        "status": "pending", "attempts": 0, "error": None,
        "run_after": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()
    job = resp.data[0]
    if job["type"] in ("analyze_floor", "generate_design", "revision_design"):
        payload = job.get("payload") or {}
        pid = payload.get("projectId"); fid = payload.get("floorId")
        if pid and fid:
            is_analysis = job["type"] == "analyze_floor"
            supabase.table("floors").update({"status": "analyzing" if is_analysis else "designing"}).eq("id", fid).execute()
            supabase.table("bot_sessions").update({
                "state": "ANALYZING" if is_analysis else "DESIGNING", "current_floor_id": fid,
            }).eq("project_id", pid).execute()
    await trigger_job_processing()
    return job
