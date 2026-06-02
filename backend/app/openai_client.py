"""
OpenAI orchestration.

Design principle (per project owner's note):
- Do NOT use image generation. The Python renderer draws the final PNG/PDF.
- The model returns a strict JSON `PlanSpec`.
- Give the model freedom — describe what we want, then trust the model's judgement
  rather than micro-managing density, symbol counts, switch placement etc.
  The ChatGPT website gives stronger results when prompts are open-ended; we
  emulate that by leaving room for engineering reasoning.
"""
from __future__ import annotations
import asyncio
import base64
import json
import mimetypes
import re
import tempfile
from pathlib import Path
from typing import Any, Optional

import httpx

from .config import get_settings
from .schemas import (
    PlanSpec, normalize_plan_spec, plan_spec_json_schema, validate_symbol_consistency,
)
from .symbols import SYMBOL_CODES

OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_TIMEOUT_SECONDS = 240.0
RETRY_STATUSES = {408, 409, 429, 500, 502, 503, 504}


def _require_key() -> str:
    return get_settings().require("openai_api_key")


def _design_model() -> str:
    return get_settings().openai_design_model


def _analysis_model() -> str:
    return get_settings().openai_analysis_model


def _output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()
    chunks: list[str] = []
    for item in payload.get("output", []) or []:
        for c in item.get("content", []) or []:
            if isinstance(c, dict) and isinstance(c.get("text"), str):
                chunks.append(c["text"])
    return "\n".join(chunks).strip()


def _extract_json_text(text: str) -> str:
    cleaned = re.sub(r"^```json\s*", "", text, flags=re.I)
    cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        json.loads(cleaned)
        return cleaned
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        raise ValueError("Model returned no JSON object")
    return match.group(0)


async def _post_responses(body: dict, label: str) -> tuple[str, str]:
    last_err = ""
    headers = {"Authorization": f"Bearer {_require_key()}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=OPENAI_TIMEOUT_SECONDS) as client:
        for attempt in range(3):
            resp = await client.post(OPENAI_URL, headers=headers, json=body)
            raw = resp.text
            try:
                payload = resp.json() if raw else {}
            except Exception:
                payload = {}
            if resp.is_success:
                return _output_text(payload), raw
            last_err = (payload.get("error") or {}).get("message") or raw
            if resp.status_code not in RETRY_STATUSES or attempt == 2:
                raise RuntimeError(f"{label} failed: {resp.status_code} - {last_err}")
            await asyncio.sleep(0.75 * (attempt + 1))
    raise RuntimeError(f"{label} failed: {last_err}")


def _truncate(value: Any, max_len: int = 9000) -> str:
    text = value if isinstance(value, str) else json.dumps(value or "")
    return text if len(text) <= max_len else text[: max_len - 18] + "... [truncated]"


def _image_input(source: str) -> dict:
    """Accepts http(s) URL, data URL, or raw base64."""
    if re.match(r"^https?://", source, re.I) or source.startswith("data:"):
        return {"type": "input_image", "image_url": source, "detail": "high"}
    return {"type": "input_image", "image_url": f"data:image/png;base64,{source}", "detail": "high"}


def _image_input_from_path(path: str | Path) -> dict:
    mime, _ = mimetypes.guess_type(str(path))
    if not mime:
        mime = "image/png"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("utf-8")
    return {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}", "detail": "high"}


def _strict_format(name: str) -> dict:
    return {
        "format": {
            "type": "json_schema",
            "name": name,
            "strict": True,
            "schema": plan_spec_json_schema(),
        },
        "verbosity": "low",
    }


async def _persist_failed_output(project_id: str, floor_id: str, raw: str, reason: str) -> str:
    path = Path(tempfile.gettempdir()) / f"failed-plan-spec-{project_id}-{floor_id}.json"
    try:
        path.write_text(json.dumps({"projectId": project_id, "floorId": floor_id, "reason": reason, "raw": raw}, indent=2),
                        encoding="utf-8")
    except Exception:
        pass
    return str(path)


# ---------------------------------------------------------------------------
# Design generation
# ---------------------------------------------------------------------------

DESIGN_SYSTEM_PROMPT = (
    "You are a senior Ethiopian electrical design engineer reasoning over an "
    "architectural floor plan. A deterministic Python renderer (not you) will "
    "draw the final technical drawing from your JSON output. Your job is to "
    "make the engineering decisions — locations, circuits, equipment, BOQ — "
    "and return them as one strict JSON object. Reason like a real engineer: "
    "consider room purposes, code requirements (EBCS / IEC 60364), human "
    "circulation, life safety, maintainability. Do not produce prose or images."
)


def _build_design_prompt(*, project_name: str, floor_name: str, building_purpose: Optional[str],
                        special_requirements: Optional[str], improvement_request: Optional[str],
                        feedback: Any, analysis: Any) -> str:
    """Open-ended prompt — describes intent and constraints, leaves engineering judgement to the model."""
    return f"""You are designing the electrical installation for a single floor of a real building.

Goal:
Return ONE JSON object that fully describes the electrical layout. The downstream renderer will draw it deterministically from this JSON — your symbol counts, coordinates, and circuit logic are what produce the final plan, so place items where they actually make sense for the rooms and usage you can see in the image.

What you have:
- An architectural floor plan image (provided below). Use its actual rooms, walls, doors, and corridors to inform the design.
- Project: {project_name}
- Floor: {floor_name}
- Building purpose: {building_purpose or "not specified"}
- Special requirements: {special_requirements or "none"}
- Architect feedback / answers: {_truncate(feedback)}
- Prior image analysis (may be empty or partial): {_truncate(analysis)}
- Revision request (if any): {improvement_request or "none"}

What the JSON must contain:
- project: {{title, drawing_type, notes}}
- base_plan: {{image_width, image_height, scale_known}} — set image_width/height to the pixel dimensions you reason from; coordinates everywhere else must be in that same pixel space.
- rooms: rectangles labeled with their function.
- equipment: MSU, ATS (if applicable), DB (per floor), G (generator if applicable), each with a single location.
- devices: FL, EL, SW, SO, FA, CCTV/DATA as appropriate to the rooms.
- routes: keep it light — major intent only (MSU→ATS, G→ATS, ATS→DB, one high-level trunk per system if useful). The renderer will compute readable orthogonal trunk-and-branch wiring per circuit. Do NOT enumerate one route per device.
- circuits: groupings of devices with their source DB and switch references.
- legend: only symbols that actually appear.
- boq: counts of visible equipment/devices only.
- warnings: anything uncertain — use a VERIFY warning rather than guessing a room identity or fabricating equipment.

Symbol vocabulary (use only these; the renderer cannot draw others): {", ".join(SYMBOL_CODES)}.

Engineering principles you should apply with judgement, not as rigid rules:
- Lighting density and layout should fit the room: a parking deck is uniform aisle grids; an office is per-room; a corridor is run-based. Avoid over-symbolling.
- Place switches where someone would actually reach for them (near entrances/control points), not next to every fixture.
- Socket placement should follow the room purpose (service rooms, utility, plant) — not every parking bay.
- Emergency lighting (EL) must be on escape paths and stair/lobby zones.
- Generator (G, default 80 kVA) feeds emergency loads via ATS; do not mix emergency with normal lighting trunks.
- If a room's identity is unclear from the image, label it conservatively and add a VERIFY warning instead of inventing.
- Do not introduce symbols (e.g., EV charger) that the architect did not request.

You have engineering freedom inside these principles. Make the decisions you would make if you were the responsible engineer reviewing this plan.

Return JSON only — no markdown, no commentary.
"""


async def create_plan_spec(*, project_id: str, floor_id: str, project_name: str, floor_name: str,
                          building_purpose: Optional[str], source_image_url: str,
                          feedback: Any = None, analysis: Any = None,
                          special_requirements: Optional[str] = None,
                          improvement_request: Optional[str] = None) -> PlanSpec:
    prompt = _build_design_prompt(
        project_name=project_name, floor_name=floor_name, building_purpose=building_purpose,
        special_requirements=special_requirements, improvement_request=improvement_request,
        feedback=feedback, analysis=analysis,
    )

    body = {
        "model": _design_model(),
        "reasoning": {"effort": "high"},
        "text": _strict_format("electrical_plan_spec"),
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": DESIGN_SYSTEM_PROMPT}]},
            {"role": "user", "content": [_image_input(source_image_url),
                                         {"type": "input_text", "text": prompt}]},
        ],
    }

    first_text, raw = await _post_responses(body, "OpenAI plan specification")

    last_text = first_text
    try:
        spec = normalize_plan_spec(json.loads(_extract_json_text(first_text)))
        validate_symbol_consistency(spec)
        return spec
    except Exception as e:
        await _persist_failed_output(project_id, floor_id, raw or first_text, str(e))
        last_text = await _repair_invalid_json(invalid=first_text, validation_error=str(e))

    try:
        spec = normalize_plan_spec(json.loads(_extract_json_text(last_text)))
        validate_symbol_consistency(spec)
        return spec
    except Exception as e:
        await _persist_failed_output(project_id, floor_id, last_text, str(e))
        raise RuntimeError(f"OpenAI did not return a valid plan specification after repair: {e}")


async def _repair_invalid_json(*, invalid: str, validation_error: str) -> str:
    body = {
        "model": _design_model(),
        "reasoning": {"effort": "medium"},
        "text": _strict_format("electrical_plan_spec_repair"),
        "input": [
            {"role": "system", "content": [{"type": "input_text",
                                            "text": "Repair malformed electrical drawing JSON. Return JSON only and obey the schema exactly."}]},
            {"role": "user", "content": [{"type": "input_text", "text":
                f"The previous JSON failed validation: {validation_error}\n\n"
                f"Allowed symbols: {', '.join(SYMBOL_CODES)}.\n"
                f"Repair the JSON without inventing symbols.\n\n"
                f"JSON to repair:\n{_truncate(invalid, 22000)}"
            }]},
        ],
    }
    text, _ = await _post_responses(body, "OpenAI plan JSON repair")
    return text


# ---------------------------------------------------------------------------
# Floor analysis & question generation (vision pass before design)
# ---------------------------------------------------------------------------

ANALYSIS_SYSTEM_PROMPT = (
    "You are a senior Ethiopian electrical design engineer (EBCS / IEC 60364). "
    "You are reviewing an architectural floor plan to plan an electrical install. "
    "Default fixtures: fluorescent lighting, manual switches, 220-230 V earthed "
    "socket outlets unless the architect specifies otherwise."
)


async def analyze_floor_plan(image_source: str, context: dict) -> dict:
    """Returns a structured analysis. Image source can be URL, data URL or base64."""
    prompt = (
        "Analyze this architectural floor plan for an electrical installation. "
        "Identify rooms and their likely purpose, lighting and socket needs, where the main supply enters, "
        "where a DB/MSU/ATS/generator should sit, emergency and fire-alarm considerations, and anything you "
        "cannot determine with confidence.\n\n"
        "Return JSON only with these keys: rooms, load_assumptions, main_supply_source, lighting_plan, "
        "socket_outlet_plan, switch_plan, db_recommendation, circuit_strategy, cable_route_strategy, "
        "emergency_systems, fire_alarm_plan, data_cctv_plan, unclear_items, questions, annotations, "
        "symbol_legend, electrician_notes.\n\n"
        f"Context: {json.dumps(context, default=str)}"
    )

    body = {
        "model": _analysis_model(),
        "reasoning": {"effort": "high"},
        "text": {"verbosity": "low", "format": {"type": "json_object"}},
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": ANALYSIS_SYSTEM_PROMPT}]},
            {"role": "user", "content": [_image_input(image_source), {"type": "input_text", "text": prompt}]},
        ],
    }
    text, _ = await _post_responses(body, "OpenAI floor-plan analysis")
    try:
        return json.loads(_extract_json_text(text))
    except Exception:
        return {
            "rooms": [], "load_assumptions": [], "main_supply_source": "",
            "lighting_plan": [], "socket_outlet_plan": [], "switch_plan": [],
            "db_recommendation": "", "circuit_strategy": "", "cable_route_strategy": "",
            "emergency_systems": [], "fire_alarm_plan": [], "data_cctv_plan": [],
            "unclear_items": [], "questions": [
                "Please confirm room purposes, main supply/MSU location, and any special equipment for this floor."
            ],
            "annotations": [], "symbol_legend": [], "electrician_notes": [],
        }


async def generate_questions(analysis: dict, context: dict) -> list[str]:
    """Ask only what affects electrical design. First question must locate the main supply if unknown."""
    prompt = (
        "Create concise numbered questions for the architect. Only ask what affects the electrical design.\n"
        "First question must locate the incoming main supply / utility incomer if not already clear.\n"
        "Return JSON array of strings.\n\n"
        f"Analysis: {json.dumps(analysis, default=str)}\nContext: {json.dumps(context, default=str)}"
    )
    body = {
        "model": _analysis_model(),
        "reasoning": {"effort": "medium"},
        "text": {"verbosity": "medium"},
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": ANALYSIS_SYSTEM_PROMPT}]},
            {"role": "user", "content": [{"type": "input_text", "text": prompt}]},
        ],
    }
    text, _ = await _post_responses(body, "OpenAI question generation")
    try:
        cleaned = _extract_json_text(text) if "{" in text else text
        data = json.loads(cleaned)
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    data = v
                    break
        questions = [str(q).strip() for q in data if str(q).strip()] if isinstance(data, list) else []
    except Exception:
        questions = ["Please confirm room purposes, special equipment, and preferred outlet/lighting requirements."]

    source_text = " ".join([
        str(analysis.get("main_supply_source") or ""),
        str(context.get("main_supply_source") or ""),
        str((context.get("project") or {}).get("special_requirements") or ""),
    ])
    source_known = bool(re.search(
        r"transformer|utility incomer|incoming main|main supply.+(room|yard|gate|basement|ground|north|south|east|west|near|at)",
        source_text, re.I))
    asks_source = any(re.search(r"main supply|transformer|utility incomer|incoming", q, re.I) for q in questions)
    if not source_known and not asks_source:
        questions = [
            "Where is the incoming main supply unit/source from the transformer or utility incomer located for this project/floor?",
            *questions,
        ]
    return questions
