"""
Deterministic Pillow renderer — v2.

Ported from the reference Professional Electrical Plan Designer v9, adapted to
consume a PlanSpec produced by GPT-5.5 instead of CLI clicks.

Key behaviours:
- Respects spec.boundary_polygon. Devices/routes outside the polygon are clipped or dropped.
- Big landscape sheet with a side panel containing Legend (with icons), Route Styles,
  BOQ summary, and Verify Notes.
- Symbol library: distinct shapes/colors for MSU, DB, ATS, G, FL, EL, SW, SO, FA, CCTV/DATA.
- Every FL gets a normal-lighting branch; every EL gets an emergency-lighting branch.
- Main distribution (MSU->ATS->DB) and generator backup (G->ATS) rendered explicitly.
- No image generation; the renderer is the only thing that draws pixels.
"""
from __future__ import annotations
import io
import json
import math
from collections import Counter, defaultdict
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

from .schemas import PlanSpec
from .symbols import SYMBOL_DICTIONARY, boq_item_for_symbol, standard_legend


# ---------------------------------------------------------------------------
# Sheet layout
# ---------------------------------------------------------------------------

SHEET_W, SHEET_H = 3000, 1900
MARGIN = 55
PANEL_W = 660
TITLE_H = 95
FOOTER_H = 62
PLAN_BOX_X = MARGIN
PLAN_BOX_Y = MARGIN + TITLE_H
PLAN_BOX_W = SHEET_W - PANEL_W - MARGIN * 3
PLAN_BOX_H = SHEET_H - TITLE_H - FOOTER_H - MARGIN * 2
PANEL_X = PLAN_BOX_X + PLAN_BOX_W + MARGIN
PANEL_Y = MARGIN
PANEL_H = SHEET_H - MARGIN * 2

ALLOWED_SYMBOLS = {code: defn.label for code, defn in SYMBOL_DICTIONARY.items()}

ROUTE_STYLES = {
    "main_distribution":  {"label": "Main Supply / Distribution", "color": (15, 90, 210, 235), "width": 6, "dash": None},
    "generator_backup":   {"label": "Generator Emergency Feed",    "color": (70, 70, 70, 235), "width": 5, "dash": (28, 12)},
    "lighting":           {"label": "Normal Lighting Circuit",     "color": (195, 0, 145, 225), "width": 4, "dash": None},
    "lighting_branch":    {"label": "Normal Lighting Branch",      "color": (195, 0, 145, 215), "width": 2, "dash": None},
    "emergency_lighting": {"label": "Emergency Lighting Circuit",  "color": (0, 145, 80, 235),  "width": 4, "dash": None},
    "emergency_branch":   {"label": "Emergency Lighting Branch",   "color": (0, 145, 80, 220),  "width": 2, "dash": None},
    "power_socket":       {"label": "Socket / Power Circuit",      "color": (190, 100, 30, 230), "width": 4, "dash": (5, 9)},
    "switch_control":     {"label": "Switch Control",              "color": (0, 139, 74, 225),  "width": 3, "dash": None},
    "fire_alarm":         {"label": "Fire Alarm Circuit",          "color": (210, 45, 45, 230), "width": 3, "dash": (16, 8)},
    "cctv_data":          {"label": "CCTV / Data Route",           "color": (105, 55, 160, 230), "width": 3, "dash": (4, 8)},
}


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _point_in_poly(point, poly) -> bool:
    if len(poly) < 3:
        return True
    x, y = point
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def _poly_bbox(poly):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return [min(xs), min(ys), max(xs), max(ys)]


def _project_into_boundary(point, poly):
    """If point is outside the polygon, snap it inward toward the centroid."""
    if not poly or _point_in_poly(point, poly):
        return point
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    for t in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9):
        candidate = (point[0] + (cx - point[0]) * t, point[1] + (cy - point[1]) * t)
        if _point_in_poly(candidate, poly):
            return candidate
    return (cx, cy)


# ---------------------------------------------------------------------------
# Pixel-space transform
# ---------------------------------------------------------------------------

class _Transform:
    def __init__(self, scale: float, xoff: float, yoff: float):
        self.scale = scale; self.xoff = xoff; self.yoff = yoff

    def pt(self, p):
        return (int(self.xoff + p[0] * self.scale), int(self.yoff + p[1] * self.scale))

    def poly(self, points):
        return [self.pt(p) for p in points]


# ---------------------------------------------------------------------------
# Primitive drawing
# ---------------------------------------------------------------------------

def _wrap(draw, text, font, max_w):
    words = str(text).split()
    lines, line = [], ""
    for word in words:
        test = (line + " " + word).strip()
        bb = draw.textbbox((0, 0), test, font=font)
        if bb[2] - bb[0] <= max_w or not line:
            line = test
        else:
            lines.append(line); line = word
    if line:
        lines.append(line)
    return lines or [""]


def _label_box(draw, xy, text, font, *, bg=(255, 255, 255, 235), fill=(0, 0, 0, 255),
               outline=(60, 60, 60, 230), pad=6, max_w=160):
    if not text:
        return None
    x, y = xy
    lines = _wrap(draw, text, font, max_w)
    dims = [draw.textbbox((0, 0), line, font=font) for line in lines]
    w = max(b[2] - b[0] for b in dims) + pad * 2
    h = sum(b[3] - b[1] for b in dims) + (len(lines) - 1) * 4 + pad * 2
    draw.rounded_rectangle([x, y, x + w, y + h], radius=7, fill=bg, outline=outline, width=1)
    ty = y + pad
    for line, b in zip(lines, dims):
        draw.text((x + pad, ty), line, font=font, fill=fill)
        ty += (b[3] - b[1]) + 4
    return [x, y, x + w, y + h]


def _draw_line(draw, pts, fill, width=3, dash=None):
    if len(pts) < 2:
        return
    if not dash:
        draw.line(pts, fill=fill, width=width, joint="curve")
        return
    pattern = list(dash)
    for a, b in zip(pts[:-1], pts[1:]):
        x1, y1 = a; x2, y2 = b
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        ux, uy = dx / length, dy / length
        distance = 0; index = 0; draw_segment = True
        while distance < length:
            step = min(pattern[index % len(pattern)], length - distance)
            if draw_segment:
                p1 = (x1 + ux * distance, y1 + uy * distance)
                p2 = (x1 + ux * (distance + step), y1 + uy * (distance + step))
                draw.line([p1, p2], fill=fill, width=width)
            distance += step; index += 1; draw_segment = not draw_segment


# ---------------------------------------------------------------------------
# Symbol library
# ---------------------------------------------------------------------------

_BG = {
    "MSU": (235, 235, 235, 250), "DB": (245, 239, 224, 250),
    "ATS": (245, 245, 245, 250), "G": (232, 238, 232, 250),
    "FL": (255, 255, 255, 245), "EL": (225, 250, 232, 245),
    "SW": (245, 245, 245, 245), "SO": (255, 244, 226, 245),
    "FA": (255, 229, 229, 245), "CCTV/DATA": (238, 229, 253, 245),
}
_OUTLINE = (20, 20, 20, 255)


def _draw_symbol(draw, x, y, sym, label, fonts, *, small=False):
    bg = _BG.get(sym, (255, 255, 255, 245))
    s = 0.7 if small else 1.0
    if sym == "FL":
        w, h = 50 * s, 16 * s
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=6, fill=bg, outline=_OUTLINE, width=max(2, int(2 * s)))
        draw.line([x - w / 2 + 4, y, x + w / 2 - 4, y], fill=_OUTLINE, width=2)
    elif sym in ("MSU", "DB", "ATS"):
        w, h = 70 * s, 46 * s
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=6, fill=bg, outline=_OUTLINE, width=3)
    elif sym == "G":
        r = 32 * s
        draw.ellipse([x - r, y - r, x + r, y + r], fill=bg, outline=_OUTLINE, width=3)
    elif sym == "EL":
        r = 22 * s
        draw.polygon([(x, y - r - 4), (x - r, y + r - 4), (x + r, y + r - 4)], fill=bg, outline=_OUTLINE)
        draw.line([(x, y - r - 4), (x - r, y + r - 4), (x + r, y + r - 4), (x, y - r - 4)], fill=_OUTLINE, width=2)
    elif sym == "SW":
        r = 18 * s
        draw.ellipse([x - r, y - r, x + r, y + r], fill=bg, outline=_OUTLINE, width=2)
        draw.line([x - 7 * s, y + 7 * s, x + 9 * s, y - 9 * s], fill=_OUTLINE, width=2)
    elif sym == "SO":
        w, h = 38 * s, 30 * s
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=4, fill=bg, outline=_OUTLINE, width=2)
        draw.ellipse([x - 9 * s, y - 4 * s, x - 4 * s, y + 1 * s], fill=_OUTLINE)
        draw.ellipse([x + 4 * s, y - 4 * s, x + 9 * s, y + 1 * s], fill=_OUTLINE)
    elif sym == "FA":
        r = 22 * s
        draw.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=bg, outline=_OUTLINE)
        draw.line([(x, y - r), (x + r, y), (x, y + r), (x - r, y), (x, y - r)], fill=_OUTLINE, width=2)
    elif sym == "CCTV/DATA":
        draw.rounded_rectangle([x - 24 * s, y - 13 * s, x + 18 * s, y + 13 * s], radius=4, fill=bg, outline=_OUTLINE, width=2)
        draw.polygon([(x + 18 * s, y - 8 * s), (x + 31 * s, y), (x + 18 * s, y + 8 * s)], fill=bg, outline=_OUTLINE)
    short = sym if len(sym) <= 4 else "DATA"
    fnt = fonts["tiny"] if small else fonts["small_bold"]
    bb = draw.textbbox((0, 0), short, font=fnt)
    draw.text((x - (bb[2] - bb[0]) / 2, y - (bb[3] - bb[1]) / 2), short, font=fnt, fill=(0, 0, 0, 255))
    if label and not small and sym in {"MSU", "DB", "ATS", "G"}:
        _label_box(draw, (x + int(40 * s), y - 18), label, fonts["small"], max_w=180)


# ---------------------------------------------------------------------------
# Spec post-processing: clip + clean routes
# ---------------------------------------------------------------------------

def _prepare_devices(spec_dict: dict, boundary: list) -> list[dict]:
    out = []
    for item in spec_dict.get("devices", []):
        loc = list(item["location"])
        if boundary:
            loc = list(_project_into_boundary(loc, boundary))
            item = {**item, "location": loc}
        out.append(item)
    return out


def _prepare_equipment(spec_dict: dict, boundary: list) -> list[dict]:
    out = []
    for item in spec_dict.get("equipment", []):
        loc = list(item["location"])
        if boundary:
            loc = list(_project_into_boundary(loc, boundary))
            item = {**item, "location": loc}
        out.append(item)
    return out


def _equipment_locations(equipment: list[dict], devices: list[dict]) -> dict:
    by_type: dict[str, tuple[float, float]] = {}
    for item in equipment:
        by_type[item["type"]] = (float(item["location"][0]), float(item["location"][1]))
    if devices:
        cx = sum(d["location"][0] for d in devices) / len(devices)
        cy = sum(d["location"][1] for d in devices) / len(devices)
    else:
        cx, cy = 400, 300
    by_type.setdefault("DB", (cx, cy))
    return by_type


def _build_routes(devices: list[dict], equipment_pos: dict, boundary: list) -> list[dict]:
    """Build clean trunk-and-branch routes deterministically — never trust the model here."""
    routes: list[dict] = []
    msu = equipment_pos.get("MSU"); ats = equipment_pos.get("ATS")
    db = equipment_pos.get("DB"); gen = equipment_pos.get("G")
    if not boundary:
        boundary = []

    def add(route_id: str, kind: str, points: list, label: str = ""):
        routes.append({"id": route_id, "type": kind, "points": points, "label": label, "style": kind})

    # Distribution backbone
    if msu and ats:
        add("route_msu_ats", "main_distribution", [msu, (ats[0], msu[1]), ats], "MSU → ATS")
    if ats and db:
        add("route_ats_db", "main_distribution", [ats, (db[0], ats[1]), db], "ATS → DB")
    elif msu and db and not ats:
        add("route_msu_db", "main_distribution", [msu, (db[0], msu[1]), db], "MSU → DB")
    if gen and ats:
        add("route_gen_ats", "generator_backup", [gen, (gen[0], ats[1]), ats], "G → ATS")

    # Normal lighting trunks (FL grouped by circuit_id, then horizontal bus rows)
    fls = [d for d in devices if d["type"] == "FL"]
    by_circuit: dict[str, list[dict]] = defaultdict(list)
    for d in fls:
        by_circuit[d.get("circuit_id") or "L1"].append(d)

    bbox = _poly_bbox(boundary) if boundary else None
    for index, (cid, items) in enumerate(sorted(by_circuit.items()), 1):
        if not items or not db:
            continue
        avg_y = sum(it["location"][1] for it in items) / len(items)
        xs = [it["location"][0] for it in items]
        x_min, x_max = min(xs), max(xs)
        if bbox:
            x_min = max(bbox[0] + 40, x_min - 40); x_max = min(bbox[2] - 40, x_max + 40)
        riser_x = (db[0] + index * 35) if not bbox else max(bbox[0] + 40, min(db[0] + index * 35, bbox[2] - 40))
        add(f"route_{cid.lower()}_feed", "lighting",
            [db, (riser_x, db[1]), (riser_x, avg_y), (x_min, avg_y), (x_max, avg_y)], cid)
        for it in items:
            p = it["location"]
            tap = (p[0], avg_y)
            add(f"route_{it['id']}_branch", "lighting_branch", [tap, p])

    # Emergency lighting trunk and branches
    els = [d for d in devices if d["type"] == "EL"]
    if els and db:
        source = gen or db
        em_x = (bbox[0] + (bbox[2] - bbox[0]) * 0.43) if bbox else db[0]
        ys = [d["location"][1] for d in els]
        min_y, max_y = min(ys), max(ys)
        add("route_em_feed", "generator_backup" if gen else "emergency_lighting",
            [source, (em_x, source[1]), (em_x, min_y)], "G → E1" if gen else "DB → E1")
        add("route_em_trunk", "emergency_lighting", [(em_x, min_y), (em_x, max_y)], "E1")
        for d in els:
            p = d["location"]
            add(f"route_{d['id']}_branch", "emergency_branch", [(em_x, p[1]), p])

    # Socket runs (grouped per circuit_id)
    sos = [d for d in devices if d["type"] == "SO"]
    so_by_circuit: dict[str, list[dict]] = defaultdict(list)
    for d in sos:
        so_by_circuit[d.get("circuit_id") or "P1"].append(d)
    for cid, items in sorted(so_by_circuit.items()):
        if not items or not db:
            continue
        ordered = sorted(items, key=lambda x: (x["location"][1], x["location"][0]))
        first = ordered[0]["location"]
        pts = [db, (first[0], db[1]), first] + [it["location"] for it in ordered[1:]]
        add(f"route_{cid.lower()}", "power_socket", pts, cid)

    # Fire alarm loop
    fas = [d for d in devices if d["type"] == "FA"]
    if fas and db:
        ordered = sorted(fas, key=lambda x: (x["location"][1], x["location"][0]))
        first = ordered[0]["location"]
        pts = [db, (first[0], db[1]), first] + [it["location"] for it in ordered[1:]]
        add("route_fa1", "fire_alarm", pts, "FA1")

    # CCTV / data loop
    cctv = [d for d in devices if d["type"] == "CCTV/DATA"]
    if cctv and db:
        ordered = sorted(cctv, key=lambda x: (x["location"][1], x["location"][0]))
        first = ordered[0]["location"]
        pts = [db, (first[0], db[1]), first] + [it["location"] for it in ordered[1:]]
        add("route_data1", "cctv_data", pts, "DATA")

    return routes


# ---------------------------------------------------------------------------
# Panel
# ---------------------------------------------------------------------------

def _draw_panel(draw, spec_dict: dict, boq_items: list, fonts):
    x0 = PANEL_X + 22
    y = PANEL_Y + 22
    max_w = PANEL_W - 44

    # Header
    draw.text((x0, y), "Drawing Control", font=fonts["h"], fill=(0, 0, 0, 255)); y += 38
    project = spec_dict.get("project", {})
    for line in (project.get("notes") or [])[:3]:
        for wline in _wrap(draw, "• " + str(line), fonts["small"], max_w):
            draw.text((x0, y), wline, font=fonts["small"], fill=(25, 25, 25, 255))
            y += 22
    y += 6; draw.line([x0, y, x0 + max_w, y], fill=(180, 180, 180, 255), width=2); y += 14

    # Legend (symbol + text on the same row)
    draw.text((x0, y), "Legend", font=fonts["h"], fill=(0, 0, 0, 255)); y += 38
    for entry in spec_dict.get("legend", []):
        sym = entry["symbol"]
        meaning = entry.get("meaning") or ALLOWED_SYMBOLS.get(sym, sym)
        _draw_symbol(draw, x0 + 26, y + 18, sym, "", fonts, small=False)
        draw.text((x0 + 78, y + 4), sym, font=fonts["small_bold"], fill=(0, 0, 0, 255))
        for i, ln in enumerate(_wrap(draw, meaning, fonts["small"], max_w - 130)):
            draw.text((x0 + 145, y + 4 + i * 20), ln, font=fonts["small"], fill=(30, 30, 30, 255))
        y += 46
        if y > PANEL_Y + PANEL_H - 320:
            break
    y += 6; draw.line([x0, y, x0 + max_w, y], fill=(180, 180, 180, 255), width=2); y += 14

    # Route styles (only those used)
    draw.text((x0, y), "Route Styles", font=fonts["h"], fill=(0, 0, 0, 255)); y += 36
    used_types = {r["type"] for r in spec_dict.get("routes", [])}
    for key, st in ROUTE_STYLES.items():
        if key not in used_types:
            continue
        yy = y + 10
        _draw_line(draw, [(x0, yy), (x0 + 90, yy)], st["color"], st["width"], st["dash"])
        draw.text((x0 + 108, y), st["label"], font=fonts["small"], fill=(0, 0, 0, 255))
        y += 32
        if y > PANEL_Y + PANEL_H - 220:
            break
    y += 6; draw.line([x0, y, x0 + max_w, y], fill=(180, 180, 180, 255), width=2); y += 14

    # BOQ summary
    draw.text((x0, y), "BOQ Summary", font=fonts["h"], fill=(0, 0, 0, 255)); y += 34
    for item in boq_items[:14]:
        line = f"{item.get('symbol', item.get('item', '?'))}: {item.get('quantity', '')}  {item.get('description') or item.get('item', '')}"
        for ln in _wrap(draw, line, fonts["small"], max_w):
            draw.text((x0, y), ln, font=fonts["small"], fill=(20, 20, 20, 255)); y += 22
        if y > PANEL_Y + PANEL_H - 120:
            break

    y += 6; draw.line([x0, y, x0 + max_w, y], fill=(180, 180, 180, 255), width=2); y += 14
    draw.text((x0, y), "Verify Notes", font=fonts["h"], fill=(0, 0, 0, 255)); y += 32
    warnings = spec_dict.get("warnings", []) or []
    for w in warnings[:6]:
        msg = w.get("message") if isinstance(w, dict) else str(w)
        for ln in _wrap(draw, "• " + str(msg), fonts["tiny"], max_w):
            draw.text((x0, y), ln, font=fonts["tiny"], fill=(20, 20, 20, 255)); y += 18
        if y > PANEL_Y + PANEL_H - 30:
            break


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def render_plan(*, spec: PlanSpec, base_image_bytes: bytes, meta: dict) -> dict:
    spec_dict = json.loads(spec.model_dump_json(by_alias=True))
    base = Image.open(io.BytesIO(base_image_bytes)).convert("RGB")

    # Fade the base image so overlay reads clearly
    base_faded = Image.blend(base, Image.new("RGB", base.size, (255, 255, 255)), 0.18)

    scale = min(PLAN_BOX_W / base.width, PLAN_BOX_H / base.height)
    draw_w = int(base.width * scale); draw_h = int(base.height * scale)
    plan_x = PLAN_BOX_X + int((PLAN_BOX_W - draw_w) / 2)
    plan_y = PLAN_BOX_Y + int((PLAN_BOX_H - draw_h) / 2)

    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (244, 244, 241, 255))
    sheet.paste(base_faded.resize((draw_w, draw_h), Image.LANCZOS).convert("RGBA"), (plan_x, plan_y))
    draw = ImageDraw.Draw(sheet)
    fonts = {
        "title": _font(38, True), "h": _font(24, True),
        "normal": _font(18), "small": _font(15),
        "small_bold": _font(15, True), "tiny": _font(12, True),
    }

    # Title + frames
    draw.text((MARGIN, MARGIN), spec_dict["project"]["title"], font=fonts["title"], fill=(0, 0, 0, 255))
    draw.text((MARGIN, MARGIN + 48),
              f"{meta.get('project_name', '')} / {meta.get('floor_name', '')} — deterministic Python render. Engineer review required.",
              font=fonts["normal"], fill=(60, 60, 60, 255))
    draw.rounded_rectangle([PLAN_BOX_X, PLAN_BOX_Y, PLAN_BOX_X + PLAN_BOX_W, PLAN_BOX_Y + PLAN_BOX_H],
                           radius=8, outline=(30, 30, 30, 255), width=2)
    draw.rounded_rectangle([PANEL_X, PANEL_Y, PANEL_X + PANEL_W, PANEL_Y + PANEL_H],
                           radius=14, fill=(255, 255, 255, 255), outline=(35, 35, 35, 255), width=2)

    # Coordinate transform from base-image pixels to sheet pixels
    image_w = max(1, spec_dict["base_plan"].get("image_width") or base.width)
    image_h = max(1, spec_dict["base_plan"].get("image_height") or base.height)
    tr = _Transform(scale * (base.width / image_w), plan_x, plan_y)

    boundary = spec_dict.get("boundary_polygon") or []

    # Clip equipment/devices to boundary
    equipment = _prepare_equipment(spec_dict, boundary)
    devices = _prepare_devices(spec_dict, boundary)

    # Always rebuild routes deterministically; ignore model-supplied routes for visual coherence
    equipment_pos = _equipment_locations(equipment, devices)
    routes = _build_routes(devices, equipment_pos, boundary)

    overlay_spec = {**spec_dict, "equipment": equipment, "devices": devices, "routes": routes}

    # Draw boundary outline (faint)
    if boundary:
        poly = tr.poly(boundary)
        draw.line(poly + [poly[0]], fill=(0, 0, 0, 130), width=2)

    # Rooms (optional rectangles + labels)
    for r in spec_dict.get("rooms", []):
        b = r.get("bbox") or []
        if len(b) != 4:
            continue
        p1 = tr.pt((b[0], b[1])); p2 = tr.pt((b[2], b[3]))
        draw.rectangle([p1[0], p1[1], p2[0], p2[1]], outline=(110, 110, 110, 180), width=2)
        _label_box(draw, (p1[0] + 4, p1[1] + 4), r.get("label", ""), fonts["small"],
                   bg=(255, 255, 230, 235), max_w=200)

    # Routes
    for route in routes:
        st = ROUTE_STYLES.get(route["type"], ROUTE_STYLES["lighting"])
        pts = [tr.pt(p) for p in route["points"]]
        _draw_line(draw, pts, st["color"], st["width"], st["dash"])
        if route.get("label") and route["type"] in ("main_distribution", "generator_backup",
                                                    "emergency_lighting", "lighting", "power_socket",
                                                    "fire_alarm", "cctv_data"):
            mid = pts[min(len(pts) - 1, max(1, len(pts) // 2))]
            _label_box(draw, (mid[0] + 6, mid[1] + 6), route["label"], fonts["tiny"], max_w=120)

    # Equipment then devices on top
    for item in equipment:
        p = tr.pt(item["location"])
        _draw_symbol(draw, p[0], p[1], item["type"], item.get("label"), fonts)

    for item in devices:
        p = tr.pt(item["location"])
        label = "" if item["type"] in ("FL", "EL") else item.get("label", "")
        _draw_symbol(draw, p[0], p[1], item["type"], label, fonts)

    # Re-derive legend + BOQ from visible symbols (canonical)
    visible_symbols = {item["type"] for item in (*equipment, *devices)}
    canonical_legend = standard_legend(visible_symbols)
    overlay_spec["legend"] = [{"symbol": l["symbol"], "meaning": l["description"]} for l in canonical_legend]
    counts = Counter(item["type"] for item in (*equipment, *devices))
    boq_items = [boq_item_for_symbol(s, q) for s, q in counts.items()]
    overlay_spec["boq"] = [{"symbol": s, "description": ALLOWED_SYMBOLS.get(s, s), "quantity": q} for s, q in counts.items()]

    _draw_panel(draw, overlay_spec, boq_items, fonts)

    footer = "Schematic coordination drawing only. Not for construction. Verify cable routes, protection, load schedule, generator ventilation/exhaust, and local code requirements."
    draw.text((MARGIN, SHEET_H - FOOTER_H + 12), footer, font=fonts["small"], fill=(30, 30, 30, 255))

    final = sheet.convert("RGB")

    debug = final.copy()
    dbg = ImageDraw.Draw(debug)
    dbg.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#ff00ff", width=4)
    if boundary:
        dpoly = tr.poly(boundary)
        dbg.line(dpoly + [dpoly[0]], fill="#ff00ff", width=3)
    dbg.text((plan_x + 8, plan_y + 8), "DEBUG: boundary in magenta, model routes ignored, Python trunk routing active",
             fill="#ff00ff", font=fonts["normal"])

    png_buf = io.BytesIO(); final.save(png_buf, "PNG", optimize=True)
    debug_buf = io.BytesIO(); debug.save(debug_buf, "PNG", optimize=True)

    return {
        "png": png_buf.getvalue(),
        "debug_png": debug_buf.getvalue(),
        "plan_spec_json": overlay_spec,
        "legend": canonical_legend,
        "boq_items": boq_items,
        "warnings": overlay_spec.get("warnings", []),
    }
