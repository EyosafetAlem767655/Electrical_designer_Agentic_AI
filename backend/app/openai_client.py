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
from .symbols import (
    SYMBOL_CODES, SYMBOL_DICTIONARY, boq_mapping_for_symbol,
    prompt_guidance_for_symbol, renderer_shape_for_symbol,
)

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


def _schema_format(name: str, schema: dict, verbosity: str = "low") -> dict:
    return {
        "format": {
            "type": "json_schema",
            "name": name,
            "strict": True,
            "schema": schema,
        },
        "verbosity": verbosity,
    }


def _symbol_catalog() -> list[dict]:
    return [
        {
            "symbol": code,
            "label": item.label,
            "description": item.description,
            "category": item.category,
            "default_specification": item.default_specification,
            "unit": item.unit,
            "prompt_guidance": prompt_guidance_for_symbol(code),
            "boq_mapping": boq_mapping_for_symbol(code),
            "renderer_shape": renderer_shape_for_symbol(code),
        }
        for code, item in SYMBOL_DICTIONARY.items()
    ]


def _analysis_schema() -> dict:
    point = {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}}
    bbox = {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "number"}}
    warning = {
        "type": "object",
        "additionalProperties": False,
        "required": ["severity", "message"],
        "properties": {
            "severity": {"type": "string", "enum": ["info", "verify", "warning", "error"]},
            "message": {"type": "string"},
        },
    }
    room = {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "label", "room_type", "bbox", "confidence", "notes"],
        "properties": {
            "id": {"type": "string"},
            "label": {"type": "string"},
            "room_type": {"type": "string"},
            "bbox": bbox,
            "confidence": {"type": "number"},
            "notes": {"type": "array", "items": {"type": "string"}},
        },
    }
    markings = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "source_size", "boundary_polygon", "design_bbox", "db_room_bbox",
            "generator_room_bbox", "confidence", "warnings",
        ],
        "properties": {
            "source_size": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}},
            "boundary_polygon": {"type": "array", "minItems": 3, "maxItems": 24, "items": point},
            "design_bbox": bbox,
            "db_room_bbox": bbox,
            "generator_room_bbox": bbox,
            "confidence": {"type": "number"},
            "warnings": {"type": "array", "items": warning},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "summary", "rooms", "load_assumptions", "main_supply_source",
            "lighting_plan", "socket_outlet_plan", "switch_plan", "db_recommendation",
            "circuit_strategy", "cable_route_strategy", "emergency_systems",
            "fire_alarm_plan", "data_cctv_plan", "unclear_items", "questions",
            "annotations", "symbol_legend", "electrician_notes", "markings",
        ],
        "properties": {
            "summary": {"type": "string"},
            "rooms": {"type": "array", "items": room},
            "load_assumptions": {"type": "array", "items": {"type": "string"}},
            "main_supply_source": {"type": "string"},
            "lighting_plan": {"type": "array", "items": {"type": "string"}},
            "socket_outlet_plan": {"type": "array", "items": {"type": "string"}},
            "switch_plan": {"type": "array", "items": {"type": "string"}},
            "db_recommendation": {"type": "string"},
            "circuit_strategy": {"type": "string"},
            "cable_route_strategy": {"type": "string"},
            "emergency_systems": {"type": "array", "items": {"type": "string"}},
            "fire_alarm_plan": {"type": "array", "items": {"type": "string"}},
            "data_cctv_plan": {"type": "array", "items": {"type": "string"}},
            "unclear_items": {"type": "array", "items": {"type": "string"}},
            "questions": {"type": "array", "items": {"type": "string"}},
            "annotations": {"type": "array", "items": {"type": "string"}},
            "symbol_legend": {"type": "array", "items": {"type": "string"}},
            "electrician_notes": {"type": "array", "items": {"type": "string"}},
            "markings": markings,
        },
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
    "You are a senior electrical design engineer working on a real architectural floor plan. "
    "A deterministic Python renderer will draw the final technical drawing from your JSON. "
    "Think like a real engineer: read the image, understand room purposes from context, "
    "and decide the layout. Return one strict JSON PlanSpec. No prose, no images."
)


def _build_design_prompt(*, project_name: str, floor_name: str, building_purpose: Optional[str],
                        special_requirements: Optional[str], improvement_request: Optional[str],
                        architect_description: Any, analysis: Any,
                        confirmed_markings: Any, review_answers: Any,
                        previous_plan_spec: Any) -> str:
    """One open prompt — model gets the image and the architect's words, then designs."""
    return f"""Design the electrical installation for this floor. Return one JSON PlanSpec.

Project: {project_name}
Floor: {floor_name}
Building purpose: {building_purpose or "infer from the image"}
Architect's description / requirements:
{_truncate(architect_description) or "(none — use the image and your judgement)"}

Special project requirements: {special_requirements or "none"}
Revision request (if any): {improvement_request or "none"}
Web review answers / clarifications:
{_truncate(review_answers) or "{}"}

Existing AI analysis:
{_truncate(analysis) or "{}"}

Confirmed full-plan markings in source image pixel coordinates:
{_truncate(confirmed_markings) or "{}"}

Previous PlanSpec for revision continuity:
{_truncate(previous_plan_spec, 16000) or "{}"}

CRITICAL — boundary:
- First, look at the image and determine the USABLE design boundary as a polygon of points
  (clockwise, 4–12 points, in base-image pixel coordinates). Exclude outdoor areas, ramps
  going to other floors, voids, and anything obviously not part of this floor's interior.
- Every single device and equipment location you return MUST fall strictly inside that polygon.
  The renderer clips to the boundary; anything outside disappears.
- Set base_plan.image_width / image_height to the pixel dimensions you reason in.
- If confirmed markings are provided, they override any inferred boundary/room guess.
- Place DB/MSU/ATS in the confirmed DB / meter room box when present.
- Place G in the confirmed generator/store room box when present, unless review answers override it.

What to return (JSON, schema-validated):
- project.title — short, e.g. "{floor_name} Electrical Layout"
- base_plan: image_width, image_height, scale_known
- boundary_polygon: list of [x, y] points, clockwise, inside the floor
- rooms: rectangles (bbox = [x1,y1,x2,y2]) with a label like "Parking Aisle", "DB / Meter Room"
- equipment: one each of MSU, DB (always), ATS (if applicable), G (if generator implied / requested).
  Place them in plant/service spaces you can identify in the image.
- devices: FL, EL, SW, SO, FA, CCTV/DATA as appropriate. Each with a unique id.
- circuits: group devices by id into circuits with source = "DB" (or "G" for emergency-only).
- legend: list every symbol you actually used.
- boq: count each visible symbol.
- warnings: anything uncertain — use VERIFY warnings instead of guessing.

Symbol library (the renderer can only draw these):
{json.dumps(_symbol_catalog(), indent=2)}

Routing — IMPORTANT:
You do NOT need to draw the wiring. The Python renderer builds clean orthogonal trunk-and-branch
routes automatically from device positions. Return `routes: []` (empty array is fine) OR a short
list of major intent routes (MSU→ATS, ATS→DB, G→ATS). Do not enumerate one route per device.

Engineering judgement (apply, don't recite):
- Place FL fixtures with sensible spacing for the room type (parking aisles: regular grid along
  the drive aisles; corridors: along the corridor; rooms: 1–4 per room depending on size). Avoid
  over-symbolling — readability matters.
- Place SW at entrances and control points only; not next to every fixture.
- SO go in service rooms, plant rooms, near DBs — not at every parking bay unless asked.
- EL on escape routes, near stairs, lobbies, exit signs.
- G (default 80 kVA if not specified) feeds ATS, which feeds emergency loads.
- If you can't identify a room, label it conservatively and add a VERIFY warning.

For revisions:
- Preserve the confirmed markings; do not ask anyone to mark boundaries again.
- Use the previous rendered design image only as visual QA context; do not request image generation.
- Apply the revision in the JSON PlanSpec and let Python re-render deterministically.

Return JSON only.
"""


async def create_plan_spec(*, project_id: str, floor_id: str, project_name: str, floor_name: str,
                          building_purpose: Optional[str], source_image_url: str,
                          architect_description: Any = None,
                          special_requirements: Optional[str] = None,
                          improvement_request: Optional[str] = None,
                          analysis: Any = None,
                          confirmed_markings: Any = None,
                          review_answers: Any = None,
                          previous_plan_spec: Any = None,
                          previous_design_image_url: Optional[str] = None) -> PlanSpec:
    """Single-pass design: image + architect description → PlanSpec. No question pre-pass."""
    prompt = _build_design_prompt(
        project_name=project_name, floor_name=floor_name, building_purpose=building_purpose,
        special_requirements=special_requirements, improvement_request=improvement_request,
        architect_description=architect_description, analysis=analysis,
        confirmed_markings=confirmed_markings, review_answers=review_answers,
        previous_plan_spec=previous_plan_spec,
    )

    user_content = [_image_input(source_image_url)]
    if previous_design_image_url:
        user_content.append({"type": "input_text", "text": "Previous rendered design PNG for revision QA context:"})
        user_content.append(_image_input(previous_design_image_url))
    user_content.append({"type": "input_text", "text": prompt})

    body = {
        "model": _design_model(),
        "reasoning": {"effort": "high"},
        "text": _strict_format("electrical_plan_spec"),
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": DESIGN_SYSTEM_PROMPT}]},
            {"role": "user", "content": user_content},
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
        "Also propose full-plan markings for web review: source_size, usable boundary_polygon, "
        "design_bbox, db_room_bbox, and generator_room_bbox. Coordinates must be in original source "
        "image pixel coordinates. If uncertain, still return conservative boxes and add warnings.\n\n"
        f"Context: {json.dumps(context, default=str)}"
    )

    body = {
        "model": _analysis_model(),
        "reasoning": {"effort": "high"},
        "text": _schema_format("floor_analysis_with_markings", _analysis_schema()),
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
            "summary": "", "rooms": [], "load_assumptions": [], "main_supply_source": "",
            "lighting_plan": [], "socket_outlet_plan": [], "switch_plan": [],
            "db_recommendation": "", "circuit_strategy": "", "cable_route_strategy": "",
            "emergency_systems": [], "fire_alarm_plan": [], "data_cctv_plan": [],
            "unclear_items": [], "questions": [
                "Please confirm room purposes, main supply/MSU location, and any special equipment for this floor."
            ],
            "annotations": [], "symbol_legend": [], "electrician_notes": [],
            "markings": {
                "source_size": context.get("source_size") or [1, 1],
                "boundary_polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "design_bbox": [0, 0, 1, 1],
                "db_room_bbox": [0, 0, 1, 1],
                "generator_room_bbox": [0, 0, 1, 1],
                "confidence": 0,
                "warnings": [{"severity": "warning", "message": "AI marking extraction failed; engineer must mark this floor in the dashboard."}],
            },
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
