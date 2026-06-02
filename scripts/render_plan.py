import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SYMBOLS = {
    "MSU": ("Main Switch Unit", "#111111"),
    "ATS": ("Automatic Transfer Switch", "#d76b18"),
    "G": ("Generator 80 kVA", "#d76b18"),
    "DB": ("Distribution Board", "#1666d8"),
    "FL": ("Fluorescent Light", "#1557d6"),
    "EL": ("Emergency Light", "#e32020"),
    "SW": ("Manual Switch", "#008b4a"),
    "SO": ("Socket Outlet", "#6a38b1"),
    "FA": ("Fire Alarm", "#c62828"),
    "CCTV/DATA": ("CCTV/Data", "#555555"),
    "AC": ("Air Conditioner", "#0f766e"),
    "EF": ("Extractor Fan", "#4b5563"),
    "WH": ("Water Heater", "#0ea5e9"),
    "PUMP": ("Pump", "#2563eb"),
    "COOKER": ("Cooker", "#b45309"),
    "EV": ("EV Charger", "#16a34a"),
    "LIFT": ("Lift", "#7c3aed"),
    "MACHINE": ("Machine Load", "#be123c"),
    "EQUIP": ("Equipment Point", "#64748b"),
}

POWER_LOAD_SYMBOLS = {"AC", "EF", "WH", "PUMP", "COOKER", "EV", "LIFT", "MACHINE", "EQUIP"}

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

DEVICE_LIMITS = {
    "FL": 42,
    "EL": 14,
    "SW": 16,
    "SO": 22,
    "FA": 14,
    "CCTV/DATA": 12,
    "AC": 18,
    "EF": 18,
    "WH": 12,
    "PUMP": 12,
    "COOKER": 10,
    "EV": 12,
    "LIFT": 8,
    "MACHINE": 18,
    "EQUIP": 18,
}


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for item in candidates:
        try:
            return ImageFont.truetype(item, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_10 = font(10)
FONT_12 = font(12)
FONT_14 = font(14)
FONT_16 = font(16, True)
FONT_18 = font(18, True)
FONT_24 = font(24, True)
FONT_34 = font(34, True)


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def clamp(value, low, high):
    return max(low, min(high, value))


def dashed_line(draw, points, fill, width, dash=None):
    if len(points) < 2:
        return
    if not dash:
        draw.line(points, fill=fill, width=width, joint="curve")
        return
    pattern = list(dash)
    for start, end in zip(points, points[1:]):
        x1, y1 = start
        x2, y2 = end
        length = math.hypot(x2 - x1, y2 - y1)
        if length == 0:
            continue
        ux = (x2 - x1) / length
        uy = (y2 - y1) / length
        distance = 0
        index = 0
        draw_segment = True
        while distance < length:
            step = min(pattern[index % len(pattern)], length - distance)
            if draw_segment:
                a = (x1 + ux * distance, y1 + uy * distance)
                b = (x1 + ux * (distance + step), y1 + uy * (distance + step))
                draw.line([a, b], fill=fill, width=width)
            distance += step
            index += 1
            draw_segment = not draw_segment


def halo_line(draw, points, fill, width, dash=None):
    dashed_line(draw, points, "white", width + 5, dash)
    dashed_line(draw, points, fill, width, dash)


def label(draw, xy, text, fill="#111111", anchor="center", fnt=FONT_12):
    if not text:
        return
    x, y = xy
    text = str(text)[:36]
    w, h = text_size(draw, text, fnt)
    if anchor == "left":
        box = [x - 4, y - 3, x + w + 7, y + h + 5]
        pos = (x, y)
    else:
        box = [x - w / 2 - 5, y - h / 2 - 4, x + w / 2 + 5, y + h / 2 + 4]
        pos = (x - w / 2, y - h / 2)
    draw.rounded_rectangle(box, radius=3, fill="white", outline=fill, width=1)
    draw.text(pos, text, fill=fill, font=fnt)


def clean_label(symbol, raw, index):
    raw = str(raw or "").strip()
    if symbol in {"FL", "EL", "SW", "SO", "FA"}:
        return f"{symbol}-{index}"
    if symbol == "CCTV/DATA":
        return f"DATA-{index}"
    if symbol in POWER_LOAD_SYMBOLS:
        return f"{symbol}-{index}"
    if symbol == "G":
        return "G / 80 kVA"
    return symbol


def draw_symbol(draw, symbol, xy, label_text=None, small=False):
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
        draw.text((x - 8 * scale, y - 7 * scale), "EL", fill=color, font=FONT_10 if small else FONT_12)
    elif symbol == "SW":
        r = 11 * scale
        draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=3, fill="#f0fff7")
        draw.text((x - 8 * scale, y - 7 * scale), "SW", fill=color, font=FONT_10 if small else FONT_12)
    elif symbol == "SO":
        w, h = 28 * scale, 22 * scale
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=4, outline=color, width=3, fill="#f7f2ff")
        draw.text((x - 9 * scale, y - 7 * scale), "SO", fill=color, font=FONT_10 if small else FONT_12)
    elif symbol == "FA":
        r = 13 * scale
        draw.polygon([(x, y - r), (x + r, y + r), (x - r, y + r)], outline=color, fill="#fff4f4")
        draw.line([(x, y - r), (x + r, y + r), (x - r, y + r), (x, y - r)], fill=color, width=3)
    elif symbol == "CCTV/DATA":
        label(draw, (x, y), "DATA", color, fnt=FONT_10 if small else FONT_12)
    elif symbol in POWER_LOAD_SYMBOLS:
        label(draw, (x, y), symbol, color, fnt=FONT_10 if small else FONT_12)
    else:
        label(draw, (x, y), "G / 80 kVA" if symbol == "G" else symbol, color, fnt=FONT_12 if small else FONT_16)
    if label_text and not small and (symbol in {"MSU", "ATS", "G", "DB"} or symbol in POWER_LOAD_SYMBOLS):
        label(draw, (x + 22, y + 22), label_text, color, anchor="left", fnt=FONT_12)


def unwrap_payload(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload["spec"], payload.get("meta", {})


def normalized_transform(spec, base, plan_x, plan_y, draw_w, draw_h):
    image_w = max(1, spec["base_plan"].get("image_width") or base.width)
    image_h = max(1, spec["base_plan"].get("image_height") or base.height)

    def tx(point):
        x = clamp(float(point[0]), 0, image_w)
        y = clamp(float(point[1]), 0, image_h)
        return (
            plan_x + x / image_w * draw_w,
            plan_y + y / image_h * draw_h,
        )

    return tx


def select_devices(spec):
    grouped = defaultdict(list)
    for item in spec.get("devices", []):
        grouped[item["type"]].append(item)
    selected = []
    warnings = list(spec.get("warnings", []))
    for symbol, items in grouped.items():
        items = sorted(items, key=lambda item: (item["location"][1], item["location"][0]))
        limit = DEVICE_LIMITS.get(symbol, 999)
        selected.extend(items[:limit])
        if len(items) > limit:
            warnings.append({"severity": "verify", "message": f"{symbol} symbols reduced from {len(items)} to {limit} for readable schematic density."})
    return selected, warnings


def equipment_locations(spec, tx):
    result = {}
    for item in spec.get("equipment", []):
        result[item["type"]] = tx(item["location"])
    devices = [tx(item["location"]) for item in spec.get("devices", [])]
    if devices:
        cx = sum(p[0] for p in devices) / len(devices)
        cy = sum(p[1] for p in devices) / len(devices)
    else:
        cx, cy = 400, 300
    result.setdefault("DB", (cx, cy))
    result.setdefault("MSU", (cx - 120, cy - 80))
    result.setdefault("ATS", (cx - 40, cy - 80))
    return result


def clusters_by_y(points, max_gap=92):
    if not points:
        return []
    ordered = sorted(points, key=lambda item: item[1])
    clusters = [[ordered[0]]]
    for point in ordered[1:]:
        if abs(point[1] - sum(p[1] for p in clusters[-1]) / len(clusters[-1])) <= max_gap:
            clusters[-1].append(point)
        else:
            clusters.append([point])
    return clusters


def draw_bus_layer(draw, points, db, route_type, label_prefix, min_branch=20):
    if not points:
        return
    color, width, dash = ROUTE_STYLE[route_type]
    clusters = clusters_by_y(points)
    for index, cluster in enumerate(clusters, start=1):
        xs = [p[0] for p in cluster]
        y = sum(p[1] for p in cluster) / len(cluster)
        left = min(xs) - 28
        right = max(xs) + 28
        trunk_x = min(max(db[0], left), right)
        route = [(db[0], db[1]), (db[0], y), (right, y)]
        if db[0] > right:
            route = [(db[0], db[1]), (db[0], y), (left, y)]
        elif db[0] < left:
            route = [(db[0], db[1]), (db[0], y), (right, y)]
        halo_line(draw, route, color, width, dash)
        label(draw, (trunk_x + 8, y - 22), f"{label_prefix}{index}", color, anchor="left", fnt=FONT_12)
        for px, py in cluster:
            branch_start = (px, y)
            if abs(py - y) > min_branch:
                halo_line(draw, [branch_start, (px, py)], color, max(2, width - 1), dash)


def nearest_path(points):
    if len(points) <= 2:
        return points
    remaining = points[:]
    path = [remaining.pop(0)]
    while remaining:
        last = path[-1]
        next_index = min(range(len(remaining)), key=lambda i: math.hypot(remaining[i][0] - last[0], remaining[i][1] - last[1]))
        path.append(remaining.pop(next_index))
    return path


def draw_loop_layer(draw, points, db, route_type, label_text):
    if not points:
        return
    color, width, dash = ROUTE_STYLE[route_type]
    ordered = nearest_path(sorted(points, key=lambda item: (item[1], item[0])))
    route = [db, (ordered[0][0], db[1]), ordered[0], *ordered[1:]]
    halo_line(draw, route, color, width, dash)
    mid = ordered[len(ordered) // 2]
    label(draw, (mid[0] + 10, mid[1] - 24), label_text, color, anchor="left", fnt=FONT_12)


def draw_distribution(draw, eq):
    msu = eq.get("MSU")
    ats = eq.get("ATS")
    db = eq.get("DB")
    gen = eq.get("G")
    if msu and ats:
        color, width, dash = ROUTE_STYLE["main_distribution"]
        halo_line(draw, [msu, (ats[0], msu[1]), ats], color, width, dash)
        label(draw, ((msu[0] + ats[0]) / 2, msu[1] - 25), "MSU -> ATS", color, fnt=FONT_12)
    if ats and db:
        color, width, dash = ROUTE_STYLE["main_distribution"]
        halo_line(draw, [ats, (db[0], ats[1]), db], color, width, dash)
        label(draw, ((ats[0] + db[0]) / 2, ats[1] + 18), "ATS -> DB", color, fnt=FONT_12)
    if gen and ats:
        color, width, dash = ROUTE_STYLE["generator_backup"]
        elbow = (gen[0], ats[1])
        halo_line(draw, [gen, elbow, ats], color, width, dash)
        label(draw, (gen[0] + 10, (gen[1] + ats[1]) / 2), "G 80 kVA -> ATS", color, anchor="left", fnt=FONT_12)


def draw_compact_panel(draw, spec, meta, panel):
    x, y, w, h = panel
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill="#f8f9fb", outline="#cfd5dd", width=2)
    draw.text((x + 18, y + 14), "Legend / BOQ", fill="#111111", font=FONT_18)
    col_w = w / 2
    row_y = y + 48
    for item in spec.get("legend", [])[:10]:
        symbol = item["symbol"]
        _, color = SYMBOLS[symbol]
        draw_symbol(draw, symbol, (x + 34, row_y + 12), symbol, small=True)
        draw.text((x + 72, row_y + 2), symbol, fill=color, font=FONT_12)
        draw.text((x + 142, row_y + 2), item["meaning"][:26], fill="#222222", font=FONT_12)
        row_y += 28
        if row_y > y + h - 24:
            break
    boq_x = x + col_w + 16
    row_y = y + 48
    draw.text((boq_x, row_y - 24), "Visible Quantity", fill="#555555", font=FONT_12)
    for item in spec.get("boq", [])[:10]:
        draw.text((boq_x, row_y), item["symbol"], fill="#111111", font=FONT_12)
        draw.text((boq_x + 82, row_y), str(item["quantity"]), fill="#111111", font=FONT_12)
        draw.text((boq_x + 130, row_y), item["description"][:28], fill="#333333", font=FONT_12)
        row_y += 24
        if row_y > y + h - 24:
            break
    footer = f"{meta.get('project_name', '')} / {meta.get('floor_name', '')} - deterministic routed overlay"
    draw.text((x + 18, y + h - 22), footer[:90], fill="#555555", font=FONT_10)


def main():
    spec_path, base_path, png_path, debug_path = map(Path, sys.argv[1:5])
    spec, meta = unwrap_payload(spec_path)
    base = Image.open(base_path).convert("RGB")

    sheet_w, sheet_h = 2400, 1500
    margin = 46
    title_h = 82
    panel_h = 230
    plan_w = sheet_w - margin * 2
    plan_h = sheet_h - title_h - panel_h - margin * 2
    scale = min(plan_w / base.width, plan_h / base.height)
    draw_w = int(base.width * scale)
    draw_h = int(base.height * scale)
    plan_x = margin + int((plan_w - draw_w) / 2)
    plan_y = title_h + margin
    panel = (margin, plan_y + draw_h + 26, plan_w, panel_h)

    sheet = Image.new("RGB", (sheet_w, sheet_h), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 25), spec["project"]["title"], fill="#111111", font=FONT_34)
    draw.text((margin, 62), f"{meta.get('project_name', '')} / {meta.get('floor_name', '')}", fill="#4f5257", font=FONT_16)
    sheet.paste(base.resize((draw_w, draw_h)), (plan_x, plan_y))
    draw.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#858b94", width=2)

    tx = normalized_transform(spec, base, plan_x, plan_y, draw_w, draw_h)
    devices, warnings = select_devices(spec)
    eq = equipment_locations(spec, tx)
    point_groups = defaultdict(list)
    for item in devices:
        point_groups[item["type"]].append(tx(item["location"]))

    overlay = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    odraw.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], fill=(0, 0, 0, 0))
    draw_distribution(odraw, eq)
    db = eq["DB"]
    draw_bus_layer(odraw, point_groups["FL"], db, "lighting", "L")
    power_points = list(point_groups["SO"])
    for symbol in sorted(POWER_LOAD_SYMBOLS):
        power_points.extend(point_groups[symbol])
    draw_bus_layer(odraw, power_points, db, "power_socket", "P")
    draw_bus_layer(odraw, point_groups["SW"], db, "switch_control", "SW")
    draw_loop_layer(odraw, point_groups["EL"], db, "emergency_lighting", "E1")
    draw_loop_layer(odraw, point_groups["FA"], db, "fire_alarm", "FA1")
    draw_loop_layer(odraw, point_groups["CCTV/DATA"], db, "cctv_data", "DATA")

    mask = Image.new("L", sheet.size, 0)
    ImageDraw.Draw(mask).rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], fill=255)
    sheet = Image.composite(Image.alpha_composite(sheet.convert("RGBA"), overlay).convert("RGB"), sheet, mask)
    draw = ImageDraw.Draw(sheet)

    for item in spec.get("equipment", []):
        draw_symbol(draw, item["type"], tx(item["location"]), clean_label(item["type"], item.get("label"), 1))
    counts = defaultdict(int)
    for item in devices:
        counts[item["type"]] += 1
        draw_symbol(draw, item["type"], tx(item["location"]), clean_label(item["type"], item.get("label"), counts[item["type"]]))

    panel_spec = {**spec, "warnings": warnings}
    draw_compact_panel(draw, panel_spec, meta, panel)

    debug = sheet.copy()
    dbg = ImageDraw.Draw(debug)
    dbg.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#ff00ff", width=4)
    dbg.text((plan_x + 8, plan_y + 8), "DEBUG: model routes suppressed; Python trunk routing active", fill="#ff00ff", font=FONT_14)

    sheet.save(png_path)
    debug.save(debug_path)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("Usage: render_plan.py spec.json base.png revised.png debug.png")
    main()
