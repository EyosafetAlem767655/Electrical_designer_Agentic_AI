import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SYMBOLS = {
    "MSU": ("Main Switch Unit", "#111111"),
    "ATS": ("Automatic Transfer Switch", "#d76b18"),
    "G": ("Generator", "#d76b18"),
    "DB": ("Distribution Board", "#1666d8"),
    "FL": ("Fluorescent Light", "#1557d6"),
    "EL": ("Emergency Light", "#e32020"),
    "SW": ("Switch", "#008b4a"),
    "SO": ("Socket Outlet", "#6a38b1"),
    "FA": ("Fire Alarm Device", "#e32020"),
    "CCTV/DATA": ("CCTV/Data Point", "#555555"),
}

ROUTES = {
    "main_distribution": ("#111111", 7, None),
    "generator_backup": ("#d76b18", 6, (20, 12)),
    "lighting": ("#1557d6", 4, None),
    "emergency_lighting": ("#e32020", 4, (14, 10)),
    "power_socket": ("#6a38b1", 4, (18, 8, 4, 8)),
    "switch_control": ("#008b4a", 3, None),
    "fire_alarm": ("#e32020", 3, (8, 8)),
    "cctv_data": ("#555555", 3, (6, 8)),
}


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for item in candidates:
        try:
            return ImageFont.truetype(item, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_12 = font(12)
FONT_14 = font(14)
FONT_16 = font(16)
FONT_18 = font(18, True)
FONT_22 = font(22, True)
FONT_30 = font(30, True)


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def clamp(value, low, high):
    return max(low, min(high, value))


def dashed_line(draw, points, fill, width, dash):
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


def label(draw, xy, text, fill="#111111", anchor="mm", fnt=FONT_14):
    x, y = xy
    w, h = text_size(draw, text, fnt)
    if anchor == "mm":
        box = [x - w / 2 - 5, y - h / 2 - 4, x + w / 2 + 5, y + h / 2 + 4]
        pos = (x - w / 2, y - h / 2)
    else:
        box = [x - 4, y - 3, x + w + 6, y + h + 5]
        pos = (x, y)
    draw.rounded_rectangle(box, radius=4, fill="white", outline=fill, width=1)
    draw.text(pos, text, fill=fill, font=fnt)


def draw_symbol(draw, symbol, xy, label_text):
    x, y = xy
    name, color = SYMBOLS[symbol]
    if symbol == "FL":
        draw.rounded_rectangle([x - 18, y - 8, x + 18, y + 8], radius=3, outline=color, width=3, fill="#f5f9ff")
        draw.line([x - 14, y, x + 14, y], fill=color, width=2)
        label(draw, (x, y + 22), label_text or "FL", color, fnt=FONT_12)
    elif symbol == "EL":
        draw.ellipse([x - 13, y - 13, x + 13, y + 13], outline=color, width=3, fill="#fff4f4")
        draw.text((x - 9, y - 8), "EL", fill=color, font=FONT_12)
    elif symbol == "SW":
        draw.ellipse([x - 12, y - 12, x + 12, y + 12], outline=color, width=3, fill="#f0fff7")
        draw.text((x - 9, y - 8), "SW", fill=color, font=FONT_12)
    elif symbol == "SO":
        draw.rounded_rectangle([x - 15, y - 12, x + 15, y + 12], radius=5, outline=color, width=3, fill="#f7f2ff")
        draw.text((x - 10, y - 7), "SO", fill=color, font=FONT_12)
    elif symbol == "FA":
        draw.polygon([(x, y - 15), (x + 14, y + 13), (x - 14, y + 13)], outline=color, fill="#fff4f4")
        draw.line([(x, y - 15), (x + 14, y + 13), (x - 14, y + 13), (x, y - 15)], fill=color, width=3)
        draw.text((x - 8, y - 1), "FA", fill=color, font=FONT_12)
    elif symbol == "CCTV/DATA":
        draw.rounded_rectangle([x - 24, y - 12, x + 24, y + 12], radius=5, outline=color, width=3, fill="white")
        draw.text((x - 21, y - 7), "DATA", fill=color, font=FONT_12)
    else:
        text = "G\n80kVA" if symbol == "G" else symbol
        w, h = 64, 44 if symbol != "G" else 58
        draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=5, outline=color, width=3, fill="white")
        lines = text.split("\n")
        for i, line in enumerate(lines):
            tw, th = text_size(draw, line, FONT_16)
            draw.text((x - tw / 2, y - len(lines) * th / 2 + i * (th + 2)), line, fill=color, font=FONT_16)
    if label_text and label_text not in {symbol, "FL", "EL", "SW", "SO", "FA"}:
        label(draw, (x + 24, y + 18), label_text, color, anchor="lt", fnt=FONT_12)


def wrap(draw, text, x, y, max_width, line_height, fnt, fill="#222222"):
    words = str(text).split()
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if text_size(draw, candidate, fnt)[0] > max_width and line:
            draw.text((x, y), line, fill=fill, font=fnt)
            y += line_height
            line = word
        else:
            line = candidate
    if line:
        draw.text((x, y), line, fill=fill, font=fnt)
        y += line_height
    return y


def main():
    spec_path, base_path, png_path, pdf_path, debug_path = map(Path, sys.argv[1:6])
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    spec = payload["spec"]
    meta = payload.get("meta", {})
    base = Image.open(base_path).convert("RGB")

    sheet_w, sheet_h = 2400, 1500
    margin = 48
    title_h = 90
    panel_w = 610
    plan_w = sheet_w - panel_w - margin * 3
    plan_h = sheet_h - title_h - margin * 2
    scale = min(plan_w / base.width, plan_h / base.height)
    draw_w = int(base.width * scale)
    draw_h = int(base.height * scale)
    plan_x = margin + int((plan_w - draw_w) / 2)
    plan_y = title_h + margin + int((plan_h - draw_h) / 2)
    panel_x = margin * 2 + plan_w
    panel_y = title_h + margin

    sheet = Image.new("RGB", (sheet_w, sheet_h), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 28), spec["project"]["title"], fill="#111111", font=FONT_30)
    draw.text((margin, 65), f"{meta.get('project_name', '')} / {meta.get('floor_name', '')}", fill="#4f5257", font=FONT_16)
    sheet.paste(base.resize((draw_w, draw_h)), (plan_x, plan_y))
    draw.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#8b929c", width=2)

    def tx(point):
        x = clamp(point[0], 0, max(1, spec["base_plan"]["image_width"] or base.width))
        y = clamp(point[1], 0, max(1, spec["base_plan"]["image_height"] or base.height))
        sx = plan_x + x / max(1, spec["base_plan"]["image_width"] or base.width) * draw_w
        sy = plan_y + y / max(1, spec["base_plan"]["image_height"] or base.height) * draw_h
        return sx, sy

    clip = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    overlay = ImageDraw.Draw(clip)
    for route in spec["routes"]:
        color, width, dash = ROUTES[route["type"]]
        points = [tx(point) for point in route["points"]]
        dashed_line(overlay, points, color, width, dash)
        mid = points[len(points) // 2]
        label(draw, (mid[0] + 10, mid[1] - 20), route["label"], color, anchor="lt", fnt=FONT_12)

    mask = Image.new("L", sheet.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], fill=255)
    sheet = Image.composite(Image.alpha_composite(sheet.convert("RGBA"), clip).convert("RGB"), sheet, mask)
    draw = ImageDraw.Draw(sheet)

    for room in spec["rooms"]:
        x1, y1 = tx(room["bbox"][:2])
        x2, y2 = tx(room["bbox"][2:])
        draw.rectangle([x1, y1, x2, y2], outline="#9aa0a6", width=1)
        room_label = room["label"] if room.get("confidence", 1) >= 0.55 else f"VERIFY {room['label']}"
        label(draw, (x1 + 6, y1 + 6), room_label[:42], "#333333", anchor="lt", fnt=FONT_12)

    for item in spec["equipment"] + spec["devices"]:
        x, y = tx(item["location"])
        draw_symbol(draw, item["type"], (x, y), item.get("label", item["type"]))

    draw.rounded_rectangle([panel_x, panel_y, sheet_w - margin, sheet_h - margin], radius=8, fill="#f8f9fb", outline="#d3d7de", width=2)
    y = panel_y + 24
    draw.text((panel_x + 24, y), "Legend", fill="#111111", font=FONT_22)
    y += 42
    for item in spec["legend"]:
        symbol = item["symbol"]
        _, color = SYMBOLS[symbol]
        draw_symbol(draw, symbol, (panel_x + 48, y + 10), symbol)
        draw.text((panel_x + 92, y), symbol, fill=color, font=FONT_18)
        draw.text((panel_x + 172, y + 2), item["meaning"], fill="#222222", font=FONT_14)
        y += 48

    y += 12
    draw.line([panel_x + 24, y, sheet_w - margin - 24, y], fill="#d3d7de", width=2)
    y += 24
    draw.text((panel_x + 24, y), "BOQ", fill="#111111", font=FONT_22)
    y += 40
    draw.text((panel_x + 24, y), "Symbol", fill="#5f6368", font=FONT_12)
    draw.text((panel_x + 140, y), "Description", fill="#5f6368", font=FONT_12)
    draw.text((sheet_w - margin - 80, y), "Qty", fill="#5f6368", font=FONT_12)
    y += 24
    for item in spec["boq"][:14]:
        draw.line([panel_x + 24, y - 4, sheet_w - margin - 24, y - 4], fill="#e5e8ec", width=1)
        draw.text((panel_x + 24, y), item["symbol"], fill="#111111", font=FONT_14)
        draw.text((panel_x + 140, y), item["description"][:42], fill="#222222", font=FONT_14)
        draw.text((sheet_w - margin - 72, y), str(item["quantity"]), fill="#111111", font=FONT_14)
        y += 26

    y += 18
    draw.line([panel_x + 24, y, sheet_w - margin - 24, y], fill="#d3d7de", width=2)
    y += 24
    draw.text((panel_x + 24, y), "Notes / Warnings", fill="#111111", font=FONT_22)
    y += 38
    notes = spec["project"].get("notes", []) + [f"{w['severity'].upper()}: {w['message']}" for w in spec.get("warnings", [])]
    if not notes:
        notes = ["Final cable sizing and protection ratings to be verified by licensed engineer."]
    for item in notes[:9]:
        y = wrap(draw, f"- {item}", panel_x + 24, y, panel_w - 86, 18, FONT_12, "#444444") + 6

    debug = sheet.copy()
    dbg = ImageDraw.Draw(debug)
    dbg.rectangle([plan_x, plan_y, plan_x + draw_w, plan_y + draw_h], outline="#ff00ff", width=4)
    dbg.text((plan_x + 8, plan_y + 8), "DEBUG PLAN BOUNDARY", fill="#ff00ff", font=FONT_14)

    sheet.save(png_path)
    sheet.save(pdf_path, "PDF", resolution=150)
    debug.save(debug_path)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit("Usage: render_plan.py spec.json base.png revised.png revised.pdf debug.png")
    main()
