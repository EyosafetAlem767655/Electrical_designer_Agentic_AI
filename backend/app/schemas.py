from __future__ import annotations
from collections import Counter
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator

from .symbols import SYMBOL_CODES, SYMBOL_DICTIONARY, boq_item_for_symbol, standard_legend

Point = tuple[float, float]
Bbox = tuple[float, float, float, float]
RouteType = Literal[
    "main_distribution", "generator_backup", "lighting", "emergency_lighting",
    "power_socket", "switch_control", "fire_alarm", "cctv_data",
]


class ProjectMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1)
    drawing_type: str = "schematic_overlay"
    notes: list[str] = Field(default_factory=list)


class BasePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_width: int = Field(ge=0)
    image_height: int = Field(ge=0)
    scale_known: bool = False


class Room(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    bbox: Bbox
    confidence: float = 0.5
    notes: list[str] = Field(default_factory=list)


class Equipment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: str
    label: str = Field(min_length=1)
    location: Point
    room_id: Optional[str] = None
    notes: list[str] = Field(default_factory=list)

    @field_validator("type")
    @classmethod
    def _known_symbol(cls, v: str) -> str:
        if v not in SYMBOL_CODES:
            raise ValueError(f"Unknown symbol '{v}'")
        return v


class Device(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: str
    label: str = Field(min_length=1)
    location: Point
    circuit_id: Optional[str] = None
    room_id: Optional[str] = None
    switch_id: Optional[str] = None

    @field_validator("type")
    @classmethod
    def _known_symbol(cls, v: str) -> str:
        if v not in SYMBOL_CODES:
            raise ValueError(f"Unknown symbol '{v}'")
        return v


class Route(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: RouteType
    from_: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)
    points: list[Point] = Field(min_length=2)
    label: str = Field(min_length=1)
    style: str = Field(min_length=1)


class Circuit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    source: str = Field(min_length=1)
    devices: list[str] = Field(default_factory=list)
    switches: list[str] = Field(default_factory=list)
    label: str = Field(min_length=1)


class LegendEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str
    meaning: str = Field(min_length=1)


class BoqEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str
    description: str = Field(min_length=1)
    quantity: float = Field(ge=0)


class Warning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    severity: Literal["info", "verify", "warning", "error"] = "verify"
    message: str = Field(min_length=1)


class PlanSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    project: ProjectMeta
    base_plan: BasePlan
    boundary_polygon: list[Point] = Field(default_factory=list,
        description="Usable design polygon in base-image pixel coordinates. Devices and routes must lie inside.")
    rooms: list[Room] = Field(default_factory=list)
    equipment: list[Equipment] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
    routes: list[Route] = Field(default_factory=list)
    circuits: list[Circuit] = Field(default_factory=list)
    legend: list[LegendEntry] = Field(default_factory=list)
    boq: list[BoqEntry] = Field(default_factory=list)
    warnings: list[Warning] = Field(default_factory=list)


def _symbol_counts(spec: PlanSpec) -> Counter:
    counts: Counter = Counter()
    for item in (*spec.equipment, *spec.devices):
        counts[item.type] += 1
    return counts


def normalize_plan_spec(raw: dict) -> PlanSpec:
    """Validate and re-derive legend + BOQ from actual visible symbols."""
    parsed = PlanSpec.model_validate(raw)
    counts = _symbol_counts(parsed)
    symbols = set(counts.keys())
    for item in parsed.legend:
        symbols.add(item.symbol)
    for item in parsed.boq:
        symbols.add(item.symbol)
    parsed.legend = [
        LegendEntry(symbol=item["symbol"], meaning=item["label"])
        for item in standard_legend(symbols)
    ]
    parsed.boq = [
        BoqEntry(symbol=sym, description=boq_item_for_symbol(sym, qty)["item"], quantity=qty)
        for sym, qty in counts.items()
    ]
    return parsed


def validate_symbol_consistency(spec: PlanSpec) -> None:
    visible = {item.type for item in (*spec.equipment, *spec.devices)}
    undefined = [s for s in visible if s not in SYMBOL_DICTIONARY]
    if undefined:
        raise ValueError(f"Undefined symbols in plan specification: {', '.join(sorted(set(undefined)))}")
    legend = {item.symbol for item in spec.legend}
    missing = [s for s in visible if s not in legend]
    if missing:
        raise ValueError(f"Visible symbols missing from legend: {', '.join(missing)}")


def plan_spec_json_schema() -> dict:
    """JSON schema accepted by OpenAI Responses API `response_format=json_schema`."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["project", "base_plan", "boundary_polygon", "rooms", "equipment",
                     "devices", "routes", "circuits", "legend", "boq", "warnings"],
        "properties": {
            "boundary_polygon": {
                "type": "array",
                "items": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}},
                "description": "Usable design polygon in base-image pixel coordinates (4+ points, clockwise).",
            },
            "project": {
                "type": "object", "additionalProperties": False,
                "required": ["title", "drawing_type", "notes"],
                "properties": {
                    "title": {"type": "string"},
                    "drawing_type": {"type": "string"},
                    "notes": {"type": "array", "items": {"type": "string"}},
                },
            },
            "base_plan": {
                "type": "object", "additionalProperties": False,
                "required": ["image_width", "image_height", "scale_known"],
                "properties": {
                    "image_width": {"type": "integer"},
                    "image_height": {"type": "integer"},
                    "scale_known": {"type": "boolean"},
                },
            },
            "rooms": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "label", "bbox", "confidence", "notes"],
                    "properties": {
                        "id": {"type": "string"}, "label": {"type": "string"},
                        "bbox": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "number"}},
                        "confidence": {"type": "number"},
                        "notes": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "equipment": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "type", "label", "location", "room_id", "notes"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {"type": "string", "enum": SYMBOL_CODES},
                        "label": {"type": "string"},
                        "location": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}},
                        "room_id": {"type": ["string", "null"]},
                        "notes": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "devices": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "type", "label", "location", "circuit_id", "room_id", "switch_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {"type": "string", "enum": SYMBOL_CODES},
                        "label": {"type": "string"},
                        "location": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}},
                        "circuit_id": {"type": ["string", "null"]},
                        "room_id": {"type": ["string", "null"]},
                        "switch_id": {"type": ["string", "null"]},
                    },
                },
            },
            "routes": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "type", "from", "to", "points", "label", "style"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {"type": "string", "enum": [
                            "main_distribution", "generator_backup", "lighting", "emergency_lighting",
                            "power_socket", "switch_control", "fire_alarm", "cctv_data",
                        ]},
                        "from": {"type": "string"}, "to": {"type": "string"},
                        "points": {"type": "array",
                                   "items": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}}},
                        "label": {"type": "string"}, "style": {"type": "string"},
                    },
                },
            },
            "circuits": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "type", "source", "devices", "switches", "label"],
                    "properties": {
                        "id": {"type": "string"}, "type": {"type": "string"},
                        "source": {"type": "string"},
                        "devices": {"type": "array", "items": {"type": "string"}},
                        "switches": {"type": "array", "items": {"type": "string"}},
                        "label": {"type": "string"},
                    },
                },
            },
            "legend": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["symbol", "meaning"],
                    "properties": {
                        "symbol": {"type": "string", "enum": SYMBOL_CODES},
                        "meaning": {"type": "string"},
                    },
                },
            },
            "boq": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["symbol", "description", "quantity"],
                    "properties": {
                        "symbol": {"type": "string", "enum": SYMBOL_CODES},
                        "description": {"type": "string"},
                        "quantity": {"type": "number"},
                    },
                },
            },
            "warnings": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["severity", "message"],
                    "properties": {
                        "severity": {"type": "string", "enum": ["info", "verify", "warning", "error"]},
                        "message": {"type": "string"},
                    },
                },
            },
        },
    }
