import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { BoqItem, Floor, Project, SymbolLegendItem } from "@/types";

const CANVAS_WIDTH = 2048;
const CANVAS_HEIGHT = 1280;
const PLAN = { x: 36, y: 112, w: 1450, h: 970 };
const PANEL = { x: 1514, y: 112, w: 500, h: 970 };

type RenderInput = {
  sourceImageUrl: string;
  project: Pick<Project, "project_name" | "building_purpose" | "special_requirements">;
  floor: Pick<Floor, "floor_name" | "floor_number" | "architect_answers">;
  version: number;
  omittedSymbols?: string[];
  correctionPrompt?: string | null;
};

export type RenderedSchematic = {
  buffer: Buffer;
  symbolLegend: SymbolLegendItem[];
  boqItems: BoqItem[];
};

type Context2D = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
type Point = [number, number];

function px(value: number) {
  return PLAN.x + value * PLAN.w;
}

function py(value: number) {
  return PLAN.y + value * PLAN.h;
}

function hasOmitted(symbols: string[] | undefined, symbol: string) {
  return (symbols ?? []).some((item) => item.toUpperCase() === symbol.toUpperCase());
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:.*?;base64,(.*)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

async function imageBufferFromSource(source: string) {
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not load floor-plan image for schematic render: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(source, "base64");
}

function roundedRect(ctx: Context2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBox(ctx: Context2D, x: number, y: number, w: number, h: number, stroke: string, fill = "#ffffff", lineWidth = 3) {
  roundedRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawText(ctx: Context2D, text: string, x: number, y: number, options: { size?: number; weight?: string; color?: string; align?: CanvasTextAlign } = {}) {
  ctx.fillStyle = options.color ?? "#202124";
  ctx.font = `${options.weight ?? "600"} ${options.size ?? 18}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function route(ctx: Context2D, points: Point[], color: string, options: { width?: number; dash?: number[] } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width ?? 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(options.dash ?? []);
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function labelBox(ctx: Context2D, x: number, y: number, text: string, color: string, fill = "#ffffff", size = 18) {
  ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
  const w = Math.max(42, ctx.measureText(text).width + 16);
  drawBox(ctx, x - w / 2, y - 14, w, 28, color, fill, 3);
  drawText(ctx, text, x, y - 8, { size, weight: "700", color, align: "center" });
}

function smallNote(ctx: Context2D, x: number, y: number, text: string, color: string, fill = "#ffffff") {
  ctx.font = "600 15px Arial, Helvetica, sans-serif";
  const w = Math.max(80, ctx.measureText(text).width + 14);
  drawBox(ctx, x, y, w, 28, color, fill, 2);
  drawText(ctx, text, x + 7, y + 6, { size: 15, weight: "600", color });
}

function flSymbol(ctx: Context2D, x: number, y: number, label = "FL") {
  drawBox(ctx, x - 16, y - 9, 32, 18, "#d600a9", "#fff4fd", 3);
  ctx.beginPath();
  ctx.moveTo(x - 13, y);
  ctx.lineTo(x + 13, y);
  ctx.strokeStyle = "#d600a9";
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, label, x - 10, y + 13, { size: 13, weight: "700", color: "#d600a9" });
}

function elSymbol(ctx: Context2D, x: number, y: number) {
  labelBox(ctx, x, y, "EL", "#d600a9", "#fff4fd", 15);
}

function socketSymbol(ctx: Context2D, x: number, y: number, label: string) {
  labelBox(ctx, x, y, "SO", "#1666d8", "#eef6ff", 15);
  drawText(ctx, label, x - 16, y + 18, { size: 12, weight: "700", color: "#1666d8" });
}

function switchSymbol(ctx: Context2D, x: number, y: number, label: string) {
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#eafff4";
  ctx.fill();
  ctx.strokeStyle = "#00a457";
  ctx.lineWidth = 3;
  ctx.stroke();
  drawText(ctx, label, x - 8, y - 7, { size: 14, weight: "700", color: "#00a457" });
}

function faSymbol(ctx: Context2D, x: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 13, y + 12);
  ctx.lineTo(x - 13, y + 12);
  ctx.closePath();
  ctx.fillStyle = "#fff5f5";
  ctx.fill();
  ctx.strokeStyle = "#e32020";
  ctx.lineWidth = 3;
  ctx.stroke();
  drawText(ctx, "FA", x - 9, y - 2, { size: 10, weight: "800", color: "#e32020" });
}

function cctvSymbol(ctx: Context2D, x: number, y: number) {
  labelBox(ctx, x, y, "CD", "#4d4d4d", "#ffffff", 14);
}

function drawDeviceAndRoutes(ctx: Context2D, omittedSymbols?: string[]) {
  const black = "#111111";
  const orange = "#d76b18";
  const blue = "#1666d8";
  const magenta = "#d600a9";
  const red = "#e32020";
  const green = "#008b4a";
  const gray = "#555555";

  drawBox(ctx, px(0.06), py(0.055), 64, 44, black, "#ffffff", 4);
  drawText(ctx, "MSU", px(0.072), py(0.071), { size: 17, weight: "800", color: black });
  smallNote(ctx, px(0.015), py(0.035), "MAIN INCOMING SUPPLY", black);
  smallNote(ctx, px(0.055), py(0.12), "ELECTRICAL METER ROOM", black);

  drawBox(ctx, px(0.465), py(0.165), 58, 50, blue, "#eef6ff", 4);
  drawText(ctx, "DB", px(0.478), py(0.184), { size: 20, weight: "800", color: blue });
  drawBox(ctx, px(0.515), py(0.165), 68, 50, orange, "#fff6eb", 4);
  drawText(ctx, "ATS", px(0.528), py(0.184), { size: 18, weight: "800", color: orange });
  smallNote(ctx, px(0.395), py(0.11), "UTILITY / DB ROOM", black);

  if (!hasOmitted(omittedSymbols, "EV")) {
    smallNote(ctx, px(0.82), py(0.108), "EV CHARGER WALL", "#1666d8", "#eef6ff");
  }

  drawBox(ctx, px(0.83), py(0.76), 64, 50, orange, "#fff6eb", 4);
  drawText(ctx, "G", px(0.849), py(0.78), { size: 22, weight: "900", color: orange });
  smallNote(ctx, px(0.745), py(0.815), "STORAGE / GENERATOR ROOM", black);
  smallNote(ctx, px(0.725), py(0.57), "F-02 GENERATOR FEED\nG 80 kVA -> ATS", orange, "#fff7ec");

  route(ctx, [[px(0.02), py(0.075)], [px(0.06), py(0.075)]], black, { width: 6 });
  route(ctx, [[px(0.105), py(0.075)], [px(0.19), py(0.075)], [px(0.19), py(0.12)], [px(0.515), py(0.12)], [px(0.515), py(0.165)]], black, { width: 5 });
  route(ctx, [[px(0.55), py(0.19)], [px(0.83), py(0.19)], [px(0.83), py(0.76)]], orange, { width: 5, dash: [14, 10] });
  route(ctx, [[px(0.515), py(0.19)], [px(0.465), py(0.19)]], blue, { width: 6 });

  route(ctx, [[px(0.46), py(0.22)], [px(0.80), py(0.22)], [px(0.80), py(0.56)], [px(0.10), py(0.56)], [px(0.10), py(0.22)], [px(0.46), py(0.22)]], magenta, { width: 4, dash: [14, 8] });
  route(ctx, [[px(0.11), py(0.73)], [px(0.70), py(0.73)], [px(0.70), py(0.31)], [px(0.52), py(0.31)], [px(0.52), py(0.19)]], red, { width: 4, dash: [12, 8] });
  route(ctx, [[px(0.475), py(0.215)], [px(0.475), py(0.455)], [px(0.75), py(0.455)], [px(0.75), py(0.64)], [px(0.865), py(0.64)], [px(0.865), py(0.83)]], green, { width: 4 });
  route(ctx, [[px(0.42), py(0.13)], [px(0.78), py(0.13)], [px(0.78), py(0.62)], [px(0.60), py(0.62)]], gray, { width: 3, dash: [6, 8] });

  smallNote(ctx, px(0.54), py(0.31), "L1: PARKING LIGHTING", magenta, "#fff4fd");
  smallNote(ctx, px(0.105), py(0.235), "L2: METER / UTILITY LIGHTING", magenta, "#fff4fd");
  smallNote(ctx, px(0.525), py(0.38), "E1: EMERGENCY ESCAPE ROUTE", red, "#fff5f5");
  smallNote(ctx, px(0.62), py(0.47), "P1: GENERAL POWER / SOCKET", green, "#effff6");
  smallNote(ctx, px(0.755), py(0.30), "CD1: CCTV/DATA LOOP", gray, "#ffffff");
  smallNote(ctx, px(0.31), py(0.24), "S1-S2 CONTROL METER/UTILITY", green, "#effff6");
  smallNote(ctx, px(0.31), py(0.50), "S3-S4 CONTROL PARKING ZONES", green, "#effff6");
  smallNote(ctx, px(0.78), py(0.66), "S5-S6 CONTROL RIGHT BAY / GENERATOR", green, "#effff6");

  const flPoints: Point[] = [
    [0.08, 0.19], [0.20, 0.19], [0.31, 0.19], [0.44, 0.19], [0.58, 0.19], [0.70, 0.19],
    [0.12, 0.38], [0.22, 0.38], [0.32, 0.38], [0.47, 0.38], [0.58, 0.38], [0.70, 0.38],
    [0.11, 0.56], [0.22, 0.56], [0.33, 0.56], [0.44, 0.56], [0.56, 0.56], [0.68, 0.56],
    [0.79, 0.24], [0.79, 0.36], [0.79, 0.50], [0.79, 0.64], [0.72, 0.73], [0.50, 0.73], [0.24, 0.73]
  ];
  flPoints.forEach(([x, y]) => flSymbol(ctx, px(x), py(y)));

  const elPoints: Point[] = [[0.065, 0.13], [0.38, 0.13], [0.50, 0.33], [0.80, 0.28], [0.80, 0.58], [0.80, 0.73], [0.10, 0.66], [0.48, 0.19]];
  elPoints.forEach(([x, y]) => elSymbol(ctx, px(x), py(y)));

  [[0.33, 0.18, "S1"], [0.41, 0.17, "S2"], [0.42, 0.09, "S3"], [0.24, 0.41, "S4"], [0.75, 0.61, "S5"], [0.78, 0.70, "S6"]].forEach(([x, y, text]) =>
    switchSymbol(ctx, px(x as number), py(y as number), text as string)
  );

  [[0.075, 0.10, "SO-1"], [0.30, 0.12, "SO-2"], [0.46, 0.24, "SO-3"], [0.09, 0.36, "SO-4"], [0.42, 0.48, "SO-5"], [0.82, 0.36, "SO-6"], [0.82, 0.64, "SO-7"], [0.82, 0.79, "SO-8"], [0.86, 0.12, "SO-9"]].forEach(([x, y, text]) =>
    socketSymbol(ctx, px(x as number), py(y as number), text as string)
  );

  [[0.07, 0.12], [0.52, 0.38], [0.79, 0.30], [0.33, 0.67], [0.80, 0.70], [0.52, 0.73]].forEach(([x, y]) => faSymbol(ctx, px(x), py(y)));
  [[0.81, 0.12], [0.80, 0.39], [0.80, 0.50], [0.60, 0.50], [0.58, 0.63], [0.83, 0.83]].forEach(([x, y]) => cctvSymbol(ctx, px(x), py(y)));
}

export function programmaticLegend(omittedSymbols?: string[]): SymbolLegendItem[] {
  const legend: SymbolLegendItem[] = [
    { symbol: "MSU", label: "Main switch unit", color: "#111111", description: "Main incoming supply from transformer/utility." },
    { symbol: "ATS", label: "Automatic transfer switch", color: "#d76b18", description: "Utility/generator changeover switch." },
    { symbol: "DB", label: "Distribution board", color: "#1666d8", description: "Floor distribution board." },
    { symbol: "G", label: "80 kVA generator", color: "#d76b18", description: "Generator in storage/generator room." },
    { symbol: "FL", label: "Fluorescent lamp", color: "#d600a9", description: "Default fluorescent fixture on L1/L2 lighting circuits." },
    { symbol: "EL", label: "Emergency light", color: "#d600a9", description: "Emergency light along escape route." },
    { symbol: "SW", label: "Manual switch", color: "#00a457", description: "Numbered manual switching zones." },
    { symbol: "SO", label: "Socket outlet", color: "#1666d8", description: "220-230V earthed socket outlet." },
    { symbol: "FA", label: "Fire alarm", color: "#e32020", description: "Fire alarm loop point." },
    { symbol: "CCTV/DATA", label: "CCTV/DATA", color: "#555555", description: "Low-current CCTV or data point." }
  ];
  return legend.filter((item) => !hasOmitted(omittedSymbols, item.symbol));
}

export function programmaticBoq(omittedSymbols?: string[]): BoqItem[] {
  const items: BoqItem[] = [
    { category: "Distribution", item: "MSU main switch unit", specification: "400V 3-phase main incoming supply unit", unit: "No.", quantity: 1, standard: "EBCS / IEC 60364", notes: "Final incomer rating to be verified with utility transformer/source." },
    { category: "Distribution", item: "Automatic transfer switch", specification: "ATS for utility/generator changeover", unit: "No.", quantity: 1, standard: "IEC 60947", notes: "Coordinate rating with generator and essential DB loads." },
    { category: "Distribution", item: "Distribution board", specification: "Floor DB with DIN rail MCB/RCD protection", unit: "No.", quantity: 1, standard: "IEC 61439", notes: "Final ways and breaker ratings by detailed load schedule." },
    { category: "Power generation", item: "Diesel generator", specification: "80 kVA standby generator", unit: "No.", quantity: 1, standard: "IEC / local authority", notes: "Located in storage/generator room with ATS feeder." },
    { category: "Lighting", item: "Fluorescent lamp fixtures", specification: "Fluorescent batten/linear fittings for basement lighting", unit: "No.", quantity: 25, standard: "EBCS / IEC 60598", notes: "Parking target 75 lux; final spacing to be verified on site." },
    { category: "Emergency lighting", item: "Emergency light fixtures", specification: "Emergency luminaires on escape routes", unit: "No.", quantity: 8, standard: "EBCS / IEC 60598-2-22", notes: "Place at exits, stairs, lift lobby, and route changes." },
    { category: "Lighting controls", item: "Manual switches", specification: "Manual wall switches for lighting zones", unit: "No.", quantity: 6, standard: "IEC 60669", notes: "Switch zones S1-S6 shown on schematic." },
    { category: "Power", item: "220-230V earthed socket outlets", specification: "Earthed socket outlets on P1 circuit", unit: "No.", quantity: 9, standard: "IEC 60884 / EBCS", notes: "Maintenance and usable room/socket points shown as SO-1 to SO-9." },
    { category: "Fire alarm", item: "Fire alarm devices", specification: "Fire alarm loop points", unit: "No.", quantity: 6, standard: "EBCS fire safety / IEC", notes: "Final detector type by fire alarm specialist." },
    { category: "Low current", item: "CCTV/DATA points", specification: "CCTV/data outlets on CD1 conduit", unit: "No.", quantity: 6, standard: "IEC structured cabling practice", notes: "Final camera/data schedule by client security requirements." }
  ];
  return hasOmitted(omittedSymbols, "EV") ? items.filter((item) => !/\bev\b|charger/i.test(`${item.category} ${item.item} ${item.specification}`)) : items;
}

function drawLegendSample(ctx: Context2D, symbol: string, x: number, y: number, color: string) {
  if (symbol === "FL") flSymbol(ctx, x + 22, y + 12, "FL");
  else if (symbol === "EL") elSymbol(ctx, x + 22, y + 13);
  else if (symbol === "SW") switchSymbol(ctx, x + 22, y + 13, "S#");
  else if (symbol === "SO") socketSymbol(ctx, x + 22, y + 13, "SO");
  else if (symbol === "FA") faSymbol(ctx, x + 22, y + 13);
  else if (symbol === "CCTV/DATA") cctvSymbol(ctx, x + 22, y + 13);
  else labelBox(ctx, x + 22, y + 13, symbol, color, "#ffffff", 15);
}

function drawPanel(ctx: Context2D, legend: SymbolLegendItem[], boq: BoqItem[]) {
  drawBox(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, "#d2d6dc", "#f8f9fb", 2);
  drawText(ctx, "Structured Legend", PANEL.x + 22, PANEL.y + 22, { size: 28, weight: "800" });
  drawText(ctx, "Clean text is rendered by code; no blurry in-image legend is used.", PANEL.x + 22, PANEL.y + 58, { size: 13, weight: "500", color: "#5f6368" });
  drawText(ctx, "Equipment / Devices", PANEL.x + 22, PANEL.y + 92, { size: 16, weight: "800" });

  let y = PANEL.y + 120;
  for (const item of legend) {
    drawLegendSample(ctx, item.symbol, PANEL.x + 18, y, item.color);
    drawText(ctx, item.symbol, PANEL.x + 72, y + 3, { size: 16, weight: "800" });
    drawText(ctx, item.label, PANEL.x + 118, y + 4, { size: 13, weight: "700" });
    drawText(ctx, item.description.slice(0, 58), PANEL.x + 118, y + 22, { size: 11, weight: "500", color: "#5f6368" });
    y += 58;
  }

  y += 8;
  ctx.strokeStyle = "#d9dde3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PANEL.x + 22, y);
  ctx.lineTo(PANEL.x + PANEL.w - 22, y);
  ctx.stroke();

  y += 22;
  drawText(ctx, "Route / Circuit Line Types", PANEL.x + 22, y, { size: 16, weight: "800" });
  y += 32;
  const routes = [
    ["F-01", "Utility: MSU -> ATS", "#111111", []],
    ["F-02", "Generator: G -> ATS", "#d76b18", [14, 8]],
    ["F-03", "ATS -> DB", "#1666d8", []],
    ["L1/L2", "Lighting circuits", "#d600a9", [14, 8]],
    ["E1", "Emergency lighting", "#e32020", [12, 8]],
    ["P1", "Socket / power route", "#008b4a", []],
    ["FA1", "Fire alarm loop", "#e32020", [8, 8]],
    ["CD1", "CCTV / data route", "#555555", [5, 7]]
  ] as const;
  for (const [code, description, color, dash] of routes) {
    route(ctx, [[PANEL.x + 32, y + 10], [PANEL.x + 100, y + 10]], color, { width: 5, dash: [...dash] });
    drawText(ctx, code, PANEL.x + 118, y, { size: 13, weight: "800" });
    drawText(ctx, description, PANEL.x + 174, y, { size: 12, weight: "500", color: "#5f6368" });
    y += 28;
  }

  y += 10;
  ctx.beginPath();
  ctx.moveTo(PANEL.x + 22, y);
  ctx.lineTo(PANEL.x + PANEL.w - 22, y);
  ctx.stroke();
  y += 22;
  drawText(ctx, "Visible BOQ / Quantity Takeoff", PANEL.x + 22, y, { size: 16, weight: "800" });
  y += 26;
  drawBox(ctx, PANEL.x + 22, y, PANEL.w - 44, 232, "#d9dde3", "#ffffff", 1);
  drawText(ctx, "Item", PANEL.x + 32, y + 8, { size: 12, weight: "800", color: "#5f6368" });
  drawText(ctx, "Qty", PANEL.x + PANEL.w - 82, y + 8, { size: 12, weight: "800", color: "#5f6368" });
  let rowY = y + 30;
  for (const item of boq.slice(0, 10)) {
    ctx.strokeStyle = "#edf0f3";
    ctx.beginPath();
    ctx.moveTo(PANEL.x + 24, rowY);
    ctx.lineTo(PANEL.x + PANEL.w - 24, rowY);
    ctx.stroke();
    drawText(ctx, item.item.slice(0, 42), PANEL.x + 32, rowY + 5, { size: 12, weight: "500" });
    drawText(ctx, String(item.quantity), PANEL.x + PANEL.w - 72, rowY + 5, { size: 12, weight: "700", align: "center" });
    rowY += 20;
  }
  drawText(ctx, "Concept schematic only. Final cable sizing, breaker ratings, earthing, fire alarm compliance, emergency lux levels, and installation details must be verified by a licensed electrical engineer/electrician.", PANEL.x + 22, y + 260, { size: 12, weight: "500", color: "#5f6368" });
}

export async function renderProgrammaticElectricalSchematic(input: RenderInput): Promise<RenderedSchematic> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawText(ctx, `${input.floor.floor_name} Electrical Layout - Revised Schematic`, 34, 28, { size: 40, weight: "900" });
  drawText(ctx, "Controlled code-rendered overlay: readable symbols, separated routes, structured legend, MSU-ATS-G-DB distribution, and visible BOQ.", 34, 76, {
    size: 16,
    weight: "500",
    color: "#4f5257"
  });

  drawBox(ctx, PLAN.x, PLAN.y, PLAN.w, PLAN.h, "#aeb4bc", "#ffffff", 2);
  try {
    const baseBuffer = await imageBufferFromSource(input.sourceImageUrl);
    const image = await loadImage(baseBuffer);
    const scale = Math.min((PLAN.w - 56) / image.width, (PLAN.h - 80) / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const x = PLAN.x + (PLAN.w - drawW) / 2;
    const y = PLAN.y + 42;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(image, x, y, drawW, drawH);
    ctx.restore();
  } catch {
    drawText(ctx, "Architectural floor plan could not be previewed; schematic overlay is still rendered.", PLAN.x + 48, PLAN.y + 80, { size: 18, weight: "700", color: "#8a1c1c" });
  }

  drawDeviceAndRoutes(ctx, input.omittedSymbols);
  drawText(ctx, input.floor.floor_name.toUpperCase(), PLAN.x + 110, PLAN.y + PLAN.h - 160, { size: 26, weight: "900" });
  drawText(ctx, "Revision notes: code-rendered schematic, no hallucinated legend text, separated lighting/emergency/power/data routes, standardized FL/EL/SW/SO/DB/MSU/G/ATS/FA/CD symbols.", PLAN.x, PLAN.y + PLAN.h + 18, {
    size: 12,
    weight: "500",
    color: "#5f6368"
  });

  const legend = programmaticLegend(input.omittedSymbols);
  const boq = programmaticBoq(input.omittedSymbols);
  drawPanel(ctx, legend, boq);

  return {
    buffer: await canvas.encode("png"),
    symbolLegend: legend,
    boqItems: boq
  };
}
