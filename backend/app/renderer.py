"""
Deterministic Pillow renderer.

Takes a validated PlanSpec, the base architectural image, and a metadata dict;
produces a final PNG, a debug PNG, a legend list, and a BOQ list.

This renderer is the *only* component that produces the technical drawing.
No image generation models are used anywhere in this system.
"""
from __future__ import annotations
import io
import math
import json
from collections import defaultdict
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from .schemas import PlanSpec
from .symbols import SYMBOL_DICTIONARY, boq_item_for_symbol, standard_legend

SYMBOLS = {code: (defn.label, defn.color) for code, defn in SYMBOL_DICTIONARY.items()}

ROUTE_STYLE = {
    "main_distribution": ("#111111", 7, None),
    "generator_backup": ("#d76b18", 6, (22, 12)),
    "lighting": ("#1557d6", 4, None),
    "emergency_lighting": ("#e32020", 4, (16, 10)),
    "power_socket": ("#6a38b1", 4, (18, 8, 4, 8)),
    "switch_control": ("#008b4a", 3, None),
    "fire_alarm": ("#c62828", 3, (8, 8)),
    "cctv_data": ("#555555", 3, (6, 8)),
}

DEVICE_LIMITS = {"FL": 42, "EL": 14, "SW": 16, "SO": 22, "FA": 14, "CCTV/DATA": 12}


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for item in candidates:
        try:
            return ImageFont.truetype(item, size)
        except OSError:
            continue
    return ImageFont.load_default()


F10 = _font(10); F12 = _font(12); F14 = _font(14); F16 = _font(16, True); F18 = _font(18, True); F24 = _font(24, True); F34 = _font(34, True)


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _dashed_line(draw, points, fill, width, dash=None):
    if len(points) < 2:
        return
    if not dash:
        draw.line(points, fill=fill, width=width, joint="curve")
        return
    pattern = list(dash)
    for a, b in zip(points, points[1:]):
        x1, y1 = a; x2, y2 = b
        length = math.hypot(x2 - x1, y2 - y1)
        if length == 0:
            continue
        ux = (x2 - x1) / length; uy = (y2 - y1) / length
        distance = 0; index = 0; draw_segment = True
        while distance < length:
            step = min(pattern[index % len(pattern)], length - distance)
            if draw_segment:
                p1 = (x1 + ux * distance, y1 + uy * distance)
                p2 = (x1 + ux * (distance + step), y1 + uy * (distance + step))
                draw.line([p1, p2], fill=fill, width=width)
            distance += step; index += 1; draw_segment = not draw_segment


def _halo_line(draw, points, fill, width, dash=None):
    _dashed_line(draw, points, "white", width + 5, dash)
    _dashed_line(draw, points, fill, width, dash)


def _text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def _label(draw, xy, text, fill="#111111", anchor="center", fnt=F12):
    if not text:
        return
    x, y = xy
    text = str(text)[:36]
    w, h = _text_size(draw, text, fnt)
    if anchor == "left":
        box = [x - 4, y - 3, x + w + 7, y + h + 5]; pos = (x, y)
    else:
        box = [x - w / 2 - 5, y - h / 2 - 4, x + w / 2 + 5, y + h / 2 + 4]; pos = (x - w / 2, y - h / 2)
    draw.rounded_rectangle(box, radius=3, fill="white", outline=fill, width=1)
    draw.text(pos, text, fill=fill, font=fnt)


def _clean_label(symbol, raw, index):
    if symbol in {"FL", "EL", "SW", "SO", "FA"}:
        return f"{symbol}-{index}"
    if symbol == "CCTV/DATA":
        return f"DATA-{index}"
    if symbol == "G":
        return "G / 80 kVA"
    return symbol


def _draw_symbol(draw, symbol, xy, label_text=None, small=False):
    x, y = xy
    _, color = SYMBOLS[symbol]
    scale = 0.78 if small else 1.0
    if symbol == "FL":
        w, h = 34 * scale, 16 * scale
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=3, outline=color, width=max(2, int(3 * scale)), fill="#f4f8ff")
        draw.line([x - w / 2 + 4, y, x + w / 2 - 4, y], fill=color, width=2)
    elif symbol == "EL":
        r = 12 * scale
        draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=3, fill="#fff4f4")
        draw.text((x - 8 * scale, y - 7 * scale), "EL", fill=color, font=F10 if small else F12)
    elif symbol == "SW":
        r = 11 * scale
        draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=3, fill="#f0fff7")
        draw.text((x - 8 * scale, y - 7 * scale), "SW", fill=color, font=F10 if small else F12)
    elif symbol == "SO":
        w, h = 28 * scale, 22 * scale
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=4, outline=color, width=3, fill="#f7f2ff")
        draw.text((x - 9 * scale, y - 7 * scale), "SO", fill=color, font=F10 if small else F12)
    elif symbol == "FA":
        r = 13 * scale
        draw.polygon([(x, y - r), (x + r, y + r), (x - r, y + r)], outline=color, fill="#fff4f4")
        draw.line([(x, y - r), (x + r, y + r), (x - r, y + r), (x, y - r)], fill=color, width=3)
    elif symbol == "CCTV/DATA":
        _label(draw, (x, y), "DATA", color, fnt=F10 if small else F12)
    else:
        _label(draw, (x, y), "G / 80 kVA" if symbol == "G" else symbol, color, fnt=F12 if small else F16)
    if label_text and not small and symbol in {"MSU", "ATS", "G", "DB"}:
        _label(draw, (x + 22, y + 22), label_text, color, anchor="left", fnt=F12)


def _select_devices(spec_dict: dict):
    grouped = defaultdict(list)
    for item in spec_dict.get("devices", []):
        grouped[item["type"]].append(item)
    selected: list = []
    warnings = list(spec_dict.get("warnings", []))
    for symbol, items in grouped.items():
        items = sorted(items, key=lambda it: (it["location"][1], it["location"][0]))
        limit = DEVICE_LIMITS.get(symbol, 999)
        selected.extend(items[:limit])
        if len(items) > limit:
            warnings.append({"severity": "verify",
                             "message": f"{symbol} symbols reduced from {len(items)} to {limit} for readable schematic density."})
    return selected, warnings


def _equipment_locations(spec_dict: dict, tx) -> dict:
    result = {}
    for item in spec_dict.get("equipment", []):
        result[item["type"]] = tx(item["location"])
    devices = [tx(it["location"]) for it in spec_dict.get("devices", [])]
    if devices:
        cx = sum(p[0] for p in devices) / len(devices)
        cy = sum(p[1] for p in devices) / len(devices)
    else:
        cx, cy = 400, 300
    result.setdefault("DB", (cx, cy))
    result.setdefault("MSU", (cx - 120, cy - 80))
    result.setdefault("ATS", (cx - 40, cy - 80))
    return result


def _clusters_by_y(points, max_gap=92):
    if not points:
        return []
    ordered = sorted(points, key=lambda it: it[1])
    clusters = [[ordered[0]]]
    for p in ordered[1:]:
        avg = sum(q[1] for q in clusters[-1]) / len(clusters[-1])
        if abs(p[1] - avg) <= max_gap:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    return clusters


def _draw_bus_layer(draw, points, db, route_type, label_prefix, min_branch=20):
    if not points:
        return
    color, width, dash = ROUTE_STYLE[route_type]
    for index, cluster in enumerate(_clusters_by_y(points), start=1):
        xs = [p[0] for p in cluster]
        y = sum(p[1] for p in cluster) / len(cluster)
        left = min(xs) - 28; right = max(xs) + 28
        trunk_x = min(max(db[0], left), right)
        if db[0] > right:
            route = [(db[0], db[1]), (db[0], y), (left, y)]
        else:
            route = [(db[0], db[1]), (db[0], y), (right, y)]
        _halo_line(draw, route, color, width, dash)
        _label(draw, (trunk_x + 8, y - 22), f"{label_prefix}{index}", color, anchor="left", fnt=F12)
        for px, py in cluster:
            if abs(py - y) > min_branch:
                _halo_line(draw, [(px, y), (px, py)], color, max(2, width - 1), dash)


def _nearest_path(points):
    if len(points) <= 2:
        return points
    remaining = list(points)
    path = [remaining.pop(0)]
    while remaining:
        last = path[-1]
        idx = min(range(len(remaining)), key=lambda i: math.hypot(remaining[i][0] - last[0], remaining[i][1] - last[1]))
        path.append(remaining.pop(idx))
    return path


def _draw_loop_layer(draw, points, db, route_type, label_text):
    if not points:
        return
    color, width, dash = ROUTE_STYLE[route_type]
    ordered = _nearest_path(sorted(points, key=lambda p: (p[1], p[0])))
    route = [db, (ordered[0][0], db[1]), ordered[0], *ordered[1:]]
    _halo_line(draw, route, color, width, dash)
    mid = ordered[len(ordered) // 2]
    _label(draw, (mid[0] + 10, mid[1] - 24), label_text, color, anchor="left", fnt=F12)


def _draw_distribution(draw, eq):
    msu = eq.get("MSU"); ats = eq.get("ATS"); db = eq.get("DB"); gen = eq.get("G")
    if msu and ats:
        color, width, dash = ROUTE_STYLE["main_distribution"]
        _halo_line(draw, [msu, (ats[0], msu[1]), ats], color, width, dash)
        _label(draw, ((msu[0] + ats[0]) / 2, msu[1] - 25), "MSU -> ATS", color, fnt=F12)
    if ats and db:
        color, width, dash = ROUTE_STYLE["main_distribution"]
        _halo_line(draw, [ats, (db[0], ats[1]), db], color, width, dash)
        _label(draw, ((ats[0] + db[0]) / 2, ats[1] + 18), "ATS -> DB", color, fnt=F12)
    if gen and ats:
        color, width, dash = ROUTE_STYLE["generator_backup"]
        _halo_line(draw, [gen, (gen[0], ats[1]), ats], color, width, dash)
        _label(draw, (gen[0] + 10, (gen[1] + ats[1]) / 2), "G 80 kVA -> ATS", color, anchor="left", fnt=F12)


def _draw_compact_panel(draw, spec_dict, meta, panel):
    x, y, w, h = panel
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill="#f8f9fb", outline="#cfd5dd", width=2)
    draw.text((x + 18, y + 14), "Legend / BOQ", fill="#111111", font=F18)
    col_w = w / 2
    row_y = y + 48
    for item in (spec_dict.get("legend") or [])[:10]:
        symbol = item["symbol"]
        _, color = SYMBOLS.get(symbol, ("", "#111"))
        _draw_symbol(draw, symbol, (x + 34, row_y + 12), symbol, small=True)
        draw.text((x + 72, row_y + 2), symbol, fill=color, font=F12)
        draw.text((x + 142, row_y + 2), item["meaning"][:26], fill="#222", font=F12)
        row_y += 28
        if row_y > y + h - 24:
            break
    boq_x = x + col_w + 16; row_y = y + 48
    draw.text((boq_x, row_y - 24), "Visible Quantity", fill="#555", font=F12)
    for item in (spec_dict.get("boq") or [])[:10]:
        draw.text((boq_x, row_y), item["symbol"], fill="#111", font=F12)
        draw.text((boq_x + 82, row_y), str(item["quantity"]), fill="#111", font=F12)
        draw.text((boq_x + 130, row_y), item["description"][:28], fill="#333", font=F12)
        row_y += 24
        if row_y > y + h - 24:
            break
    footer = f"{meta.get('project_name', '')} / {meta.get('floor_name', '')} - deterministic routed overlay"
    draw.text((x + 18, y + h - 22), footer[:90], fill="#555", font=F10)


def render_plan(*, spec: PlanSpec, base_image_bytes: bytes, meta: dict) -> dict:
    """Render and return {png, debug_png, plan_spec_json, legend, boq_items}."""
    spec_dict = json.loads(spec.model_dump_json(by_alias=True))
    base = Image.open(io.BytesIO(base_image_bytes)).convert("RGB")

    sheet_w, sheet_h = 2400, 1500
    margin = 46; title_h = 82; panel_h = 230
    plan_w = sheet_w - margin * 2
    plan_h = sheet_h - title_h - panel_h - margin * 2
    scale = min(plan_w / base.width, plan_h / base.height)
    draw_w = int(base.width * scale); draw_h = int(base.height * scale)
    plan_x = margin + int((plan_w - draw_w) / 2)
    plan_y = title_h + margin
    panel = (margin, plan_y + draw_h + 26, plan_w, panel_h)

    sheet = Image.new("RGB", (sheet_w, sheet_h), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 25), spec_dict["project"]["title"], fill="#111", font=F34)
    draw.text((margin, 62), f"{meta.get('project_name', '')} / {meta.get('floor_name', '')}", fill="#4f5257", font=F16)
    sheet.paste(base.resize((draw_w, draw_h)), (plan_x, plan_y))
    draw.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#858b94", width=2)

    image_w = max(1, spec_dict["base_plan"].get("image_width") or base.width)
    image_h = max(1, spec_dict["base_plan"].get("image_height") or base.height)

    def tx(point):
        px = _clamp(float(point[0]), 0, image_w)
        py = _clamp(float(point[1]), 0, image_h)
        return (plan_x + px / image_w * draw_w, plan_y + py / image_h * draw_h)

    devices, warnings = _select_devices(spec_dict)
    eq = _equipment_locations(spec_dict, tx)
    point_groups: dict[str, list] = defaultdict(list)
    for item in devices:
        point_groups[item["type"]].append(tx(item["location"]))

    overlay = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    _draw_distribution(odraw, eq)
    db = eq["DB"]
    _draw_bus_layer(odraw, point_groups["FL"], db, "lighting", "L")
    _draw_bus_layer(odraw, point_groups["SO"], db, "power_socket", "P")
    _draw_bus_layer(odraw, point_groups["SW"], db, "switch_control", "SW")
    _draw_loop_layer(odraw, point_groups["EL"], db, "emergency_lighting", "E1")
    _draw_loop_layer(odraw, point_groups["FA"], db, "fire_alarm", "FA1")
    _draw_loop_layer(odraw, point_groups["CCTV/DATA"], db, "cctv_data", "DATA")

    mask = Image.new("L", sheet.size, 0)
    ImageDraw.Draw(mask).rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], fill=255)
    sheet = Image.composite(Image.alpha_composite(sheet.convert("RGBA"), overlay).convert("RGB"), sheet, mask)
    draw = ImageDraw.Draw(sheet)

    for item in spec_dict.get("equipment", []):
        _draw_symbol(draw, item["type"], tx(item["location"]), _clean_label(item["type"], item.get("label"), 1))
    counts: dict[str, int] = defaultdict(int)
    for item in devices:
        counts[item["type"]] += 1
        _draw_symbol(draw, item["type"], tx(item["location"]), _clean_label(item["type"], item.get("label"), counts[item["type"]]))

    panel_spec = {**spec_dict, "warnings": warnings}
    _draw_compact_panel(draw, panel_spec, meta, panel)

    debug = sheet.copy()
    dbg = ImageDraw.Draw(debug)
    dbg.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#ff00ff", width=4)
    dbg.text((plan_x + 8, plan_y + 8), "DEBUG: model routes suppressed; Python trunk routing active", fill="#ff00ff", font=F14)

    png_buf = io.BytesIO(); sheet.save(png_buf, "PNG")
    debug_buf = io.BytesIO(); debug.save(debug_buf, "PNG")

    visible_symbols = {item.type for item in (*spec.equipment, *spec.devices)}
    legend = standard_legend(visible_symbols)
    symbol_counts: dict[str, int] = defaultdict(int)
    for item in (*spec.equipment, *spec.devices):
        symbol_counts[item.type] += 1
    boq_items = [boq_item_for_symbol(s, q) for s, q in symbol_counts.items()]

    return {
        "png": png_buf.getvalue(),
        "debug_png": debug_buf.getvalue(),
        "plan_spec_json": spec_dict,
        "legend": legend,
        "boq_items": boq_items,
        "warnings": warnings,
    }
