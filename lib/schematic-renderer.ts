import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { planBoqItems, planSymbolLegend, type PlanSpec } from "@/lib/plan-schema";
import { standardLegend, SYMBOL_DICTIONARY, type SymbolCode } from "@/lib/symbol-dictionary";
import type { BoqItem, Floor, Project, SymbolLegendItem } from "@/types";

type RenderInput = {
  sourceImageUrl: string;
  project: Pick<Project, "project_name" | "building_purpose" | "special_requirements">;
  floor: Pick<Floor, "floor_name" | "floor_number" | "architect_answers">;
  version: number;
  spec: PlanSpec;
};

export type RenderedSchematic = {
  buffer: Buffer;
  debugBuffer: Buffer;
  planSpec: PlanSpec;
  symbolLegend: SymbolLegendItem[];
  boqItems: BoqItem[];
};

function parseDataUrl(value: string) {
  const match = value.match(/^data:.*?;base64,(.*)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

async function imageBufferFromSource(source: string) {
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not load floor-plan image for deterministic render: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(source, "base64");
}

function pythonCommands() {
  const configured = process.env.PYTHON_RENDERER_COMMAND?.trim();
  if (configured) return [configured];
  return process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
}

function runPythonCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with exit ${code}: ${stderr.trim()}`));
    });
  });
}

async function runPythonRenderer(args: string[]) {
  const errors: string[] = [];
  for (const command of pythonCommands()) {
    try {
      await runPythonCommand(command, args);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Python plan renderer could not start. Tried ${pythonCommands().join(", ")}. Errors: ${errors.join(" | ")}`);
}

type CanvasContext = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

const routeStyles: Record<string, { color: string; width: number; dash?: number[] }> = {
  main_distribution: { color: "#111111", width: 7 },
  generator_backup: { color: "#d76b18", width: 6, dash: [20, 12] },
  lighting: { color: "#1557d6", width: 4 },
  emergency_lighting: { color: "#e32020", width: 4, dash: [14, 10] },
  power_socket: { color: "#6a38b1", width: 4, dash: [18, 8, 4, 8] },
  switch_control: { color: "#008b4a", width: 3 },
  fire_alarm: { color: "#e32020", width: 3, dash: [8, 8] },
  cctv_data: { color: "#555555", width: 3, dash: [6, 8] }
};

function drawNodeText(ctx: CanvasContext, text: string, x: number, y: number, options: { size?: number; weight?: string; color?: string; align?: CanvasTextAlign } = {}) {
  ctx.font = `${options.weight ?? "600"} ${options.size ?? 14}px Arial`;
  ctx.fillStyle = options.color ?? "#111111";
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function drawNodeLabel(ctx: CanvasContext, text: string, x: number, y: number, color: string, align: "center" | "left" = "center") {
  ctx.font = "700 13px Arial";
  const metrics = ctx.measureText(text);
  const w = Math.max(32, metrics.width + 12);
  const h = 22;
  const left = align === "center" ? x - w / 2 : x;
  const top = align === "center" ? y - h / 2 : y;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 4);
  ctx.fill();
  ctx.stroke();
  drawNodeText(ctx, text, left + 6, top + 4, { size: 13, weight: "700", color });
}

function drawNodeSymbol(ctx: CanvasContext, symbol: SymbolCode, label: string, x: number, y: number) {
  const color = SYMBOL_DICTIONARY[symbol].color;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 3;
  if (symbol === "FL") {
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 8, 36, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.stroke();
    drawNodeLabel(ctx, label || "FL", x, y + 24, color);
  } else if (symbol === "EL" || symbol === "SW") {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawNodeText(ctx, symbol, x - 10, y - 7, { size: 12, weight: "800", color });
  } else if (symbol === "SO") {
    ctx.beginPath();
    ctx.roundRect(x - 15, y - 12, 30, 24, 5);
    ctx.fill();
    ctx.stroke();
    drawNodeText(ctx, "SO", x - 10, y - 7, { size: 12, weight: "800", color });
  } else if (symbol === "FA") {
    ctx.beginPath();
    ctx.moveTo(x, y - 15);
    ctx.lineTo(x + 14, y + 13);
    ctx.lineTo(x - 14, y + 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawNodeText(ctx, "FA", x - 8, y - 1, { size: 10, weight: "800", color });
  } else if (symbol === "CCTV/DATA") {
    drawNodeLabel(ctx, "DATA", x, y, color);
  } else {
    drawNodeLabel(ctx, symbol === "G" ? "G / 80 kVA" : symbol, x, y, color);
  }
  ctx.restore();
}

async function renderNodeFallback(input: RenderInput, baseBuffer: Buffer): Promise<RenderedSchematic> {
  const canvas = createCanvas(2400, 1500);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawNodeText(ctx, input.spec.project.title, 48, 28, { size: 30, weight: "900" });
  drawNodeText(ctx, `${input.project.project_name} / ${input.floor.floor_name}`, 48, 65, { size: 16, color: "#4f5257" });

  const base = await loadImage(baseBuffer);
  const margin = 48;
  const titleH = 90;
  const panelW = 610;
  const planW = canvas.width - panelW - margin * 3;
  const planH = canvas.height - titleH - margin * 2;
  const scale = Math.min(planW / base.width, planH / base.height);
  const drawW = base.width * scale;
  const drawH = base.height * scale;
  const planX = margin + (planW - drawW) / 2;
  const planY = titleH + margin + (planH - drawH) / 2;
  const panelX = margin * 2 + planW;
  const panelY = titleH + margin;
  ctx.drawImage(base, planX, planY, drawW, drawH);
  ctx.strokeStyle = "#8b929c";
  ctx.lineWidth = 2;
  ctx.strokeRect(planX, planY, drawW, drawH);

  const imageW = input.spec.base_plan.image_width || base.width;
  const imageH = input.spec.base_plan.image_height || base.height;
  const tx = ([x, y]: [number, number]): [number, number] => [
    planX + Math.max(0, Math.min(imageW, x)) / Math.max(1, imageW) * drawW,
    planY + Math.max(0, Math.min(imageH, y)) / Math.max(1, imageH) * drawH
  ];

  ctx.save();
  ctx.beginPath();
  ctx.rect(planX, planY, drawW, drawH);
  ctx.clip();
  for (const route of input.spec.routes) {
    const style = routeStyles[route.type] ?? routeStyles.main_distribution;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash ?? []);
    ctx.beginPath();
    route.points.map(tx).forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const item of [...input.spec.equipment, ...input.spec.devices]) {
    const [x, y] = tx(item.location);
    drawNodeSymbol(ctx, item.type, item.label, x, y);
  }
  ctx.restore();

  ctx.fillStyle = "#f8f9fb";
  ctx.strokeStyle = "#d3d7de";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, canvas.width - margin - panelX, canvas.height - margin - panelY, 8);
  ctx.fill();
  ctx.stroke();
  let y = panelY + 24;
  drawNodeText(ctx, "Legend", panelX + 24, y, { size: 22, weight: "900" });
  y += 44;
  for (const item of input.spec.legend) {
    drawNodeSymbol(ctx, item.symbol, item.symbol, panelX + 48, y + 10);
    drawNodeText(ctx, item.symbol, panelX + 92, y, { size: 16, weight: "800", color: SYMBOL_DICTIONARY[item.symbol].color });
    drawNodeText(ctx, item.meaning, panelX + 172, y + 2, { size: 14 });
    y += 48;
  }
  y += 16;
  drawNodeText(ctx, "BOQ", panelX + 24, y, { size: 22, weight: "900" });
  y += 38;
  for (const item of input.spec.boq.slice(0, 16)) {
    drawNodeText(ctx, item.symbol, panelX + 24, y, { size: 14, weight: "800" });
    drawNodeText(ctx, item.description.slice(0, 42), panelX + 140, y, { size: 14 });
    drawNodeText(ctx, String(item.quantity), canvas.width - margin - 72, y, { size: 14, weight: "800" });
    y += 26;
  }

  const buffer = await canvas.encode("png");
  return {
    buffer,
    debugBuffer: buffer,
    planSpec: input.spec,
    symbolLegend: planSymbolLegend(input.spec),
    boqItems: planBoqItems(input.spec)
  };
}

export function programmaticLegend(): SymbolLegendItem[] {
  return standardLegend();
}

export function programmaticBoq(spec?: PlanSpec): BoqItem[] {
  return spec ? planBoqItems(spec) : [];
}

export async function renderProgrammaticElectricalSchematic(input: RenderInput): Promise<RenderedSchematic> {
  const tempDir = await mkdtemp(join(tmpdir(), "elec-plan-render-"));
  const baseBuffer = await imageBufferFromSource(input.sourceImageUrl);
  const basePath = join(tempDir, "base-plan.png");
  const specPath = join(tempDir, "plan-spec.json");
  const pngPath = join(tempDir, "revised_plan.png");
  const debugPath = join(tempDir, "debug_overlay.png");
  try {
    await writeFile(basePath, baseBuffer);
    await writeFile(
      specPath,
      JSON.stringify(
        {
          spec: input.spec,
          meta: {
            project_name: input.project.project_name,
            floor_name: input.floor.floor_name,
            version: input.version
          }
        },
        null,
        2
      ),
      "utf8"
    );
    try {
      await runPythonRenderer(["scripts/render_plan.py", specPath, basePath, pngPath, debugPath]);
    } catch (error) {
      console.warn("[schematic-renderer] Python unavailable; using deterministic Node renderer fallback", error);
      return await renderNodeFallback(input, baseBuffer);
    }
    return {
      buffer: await readFile(pngPath),
      debugBuffer: await readFile(debugPath),
      planSpec: input.spec,
      symbolLegend: planSymbolLegend(input.spec),
      boqItems: planBoqItems(input.spec)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
