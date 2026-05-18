import type { BoqItem, DesignAnnotation, SymbolLegendItem } from "@/types";
import type { DrawingTextPlan } from "@/lib/xai";

type CanvasRenderingContext2D = import("@napi-rs/canvas").SKRSContext2D;

export type ProfessionalDrawingSheetInput = {
  imageBuffer: Buffer;
  projectName: string;
  projectCode: string;
  floorName: string;
  floorNumber: number;
  companyName?: string | null;
  revision: number;
  legend: SymbolLegendItem[];
  annotations: DesignAnnotation[];
  boqItems: BoqItem[];
  textPlan: DrawingTextPlan;
};

const SHEET_W = 2200;
const SHEET_H = 1550;
const MARGIN = 38;
const HEADER_H = 116;
const PANEL_W = 560;
const PLAN_GAP = 28;
const COLORS = {
  ink: "#172029",
  muted: "#5c6670",
  border: "#1f2a33",
  panel: "#f7f8f6",
  title: "#0f171d",
  lighting: "#d7a526",
  power: "#2f6fa3",
  switch: "#5b7186",
  emergency: "#c94135",
  data: "#2f8178",
  fire: "#d96f2f"
};

function fitRect(srcW: number, srcH: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { width, height, scale };
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight: "normal" | "bold" = "normal") {
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth || words.join(" ").length > lines.join(" ").length) {
      lines[maxLines - 1] = `${last.replace(/\s+\S+$/, "")}...`;
    }
  }
  return lines;
}

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawPanelTitle(ctx: CanvasRenderingContext2D, title: string, x: number, y: number, w: number) {
  ctx.fillStyle = COLORS.title;
  ctx.fillRect(x, y, w, 34);
  setFont(ctx, 18, "bold");
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title.toUpperCase(), x + 14, y + 23);
}

function drawLineSample(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, dashed = false) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dashed ? [18, 10] : []);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 92, y);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 92, y);
  ctx.stroke();
  ctx.restore();
}

function colorForAnnotation(annotation: DesignAnnotation) {
  const text = `${annotation.type} ${annotation.label}`.toLowerCase();
  if (text.includes("light")) return COLORS.lighting;
  if (text.includes("power") || text.includes("socket") || text.includes("outlet")) return COLORS.power;
  if (text.includes("switch")) return COLORS.switch;
  if (text.includes("emergency")) return COLORS.emergency;
  if (text.includes("fire")) return COLORS.fire;
  if (text.includes("data") || text.includes("cctv") || text.includes("telecom")) return COLORS.data;
  return "#2f8178";
}

function drawAnnotations(ctx: CanvasRenderingContext2D, annotations: DesignAnnotation[], plan: { x: number; y: number; w: number; h: number }) {
  setFont(ctx, 19, "bold");
  annotations.slice(0, 12).forEach((annotation, index) => {
    const color = colorForAnnotation(annotation);
    const targetX = plan.x + (annotation.targetX / 100) * plan.w;
    const targetY = plan.y + (annotation.targetY / 100) * plan.h;
    const labelLeft = index % 2 === 0 ? plan.x + 18 : plan.x + plan.w - 230;
    const labelTop = Math.min(plan.y + plan.h - 56, Math.max(plan.y + 18, plan.y + 28 + index * 58));
    const labelW = 210;
    const labelH = 40;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(labelLeft + (labelLeft < targetX ? labelW : 0), labelTop + labelH / 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(labelLeft + (labelLeft < targetX ? labelW : 0), labelTop + labelH / 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.fillRect(labelLeft, labelTop, labelW, labelH);
    ctx.strokeRect(labelLeft, labelTop, labelW, labelH);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(targetX, targetY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(annotation.label.slice(0, 18), labelLeft + 10, labelTop + 26);
    ctx.restore();
  });
}

function drawCircuitSchedule(ctx: CanvasRenderingContext2D, input: ProfessionalDrawingSheetInput, x: number, y: number, w: number) {
  drawPanelTitle(ctx, "Circuit Schedule", x, y, w);
  let cursor = y + 56;
  setFont(ctx, 15, "bold");
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("CKT", x + 12, cursor);
  ctx.fillText("SYSTEM / DESCRIPTION", x + 86, cursor);
  ctx.fillText("CABLE", x + 330, cursor);
  cursor += 12;
  ctx.strokeStyle = "#c6ccd2";
  ctx.beginPath();
  ctx.moveTo(x + 10, cursor);
  ctx.lineTo(x + w - 10, cursor);
  ctx.stroke();
  cursor += 28;

  input.textPlan.circuitSchedule.slice(0, 7).forEach((item) => {
    setFont(ctx, 18, "bold");
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(item.circuit, x + 12, cursor);
    setFont(ctx, 16, "bold");
    ctx.fillText(item.system, x + 86, cursor);
    setFont(ctx, 14);
    ctx.fillStyle = COLORS.muted;
    const descBottom = drawWrapped(ctx, item.description, x + 86, cursor + 22, 225, 17, 2);
    setFont(ctx, 14, "bold");
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(item.cable, x + 330, cursor);
    setFont(ctx, 13);
    ctx.fillStyle = COLORS.muted;
    drawWrapped(ctx, item.protection, x + 330, cursor + 20, 175, 16, 2);
    cursor = Math.max(descBottom + 18, cursor + 68);
  });

  return cursor;
}

function drawLegend(ctx: CanvasRenderingContext2D, legend: SymbolLegendItem[], x: number, y: number, w: number) {
  drawPanelTitle(ctx, "Legend + Line Style", x, y, w);
  let cursor = y + 60;
  legend.slice(0, 6).forEach((item, index) => {
    const color = item.color || [COLORS.lighting, COLORS.power, COLORS.emergency, COLORS.data, COLORS.fire, COLORS.switch][index] || COLORS.data;
    drawLineSample(ctx, x + 14, cursor - 6, color, index % 2 === 1);
    setFont(ctx, 17, "bold");
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(item.symbol, x + 124, cursor);
    setFont(ctx, 15);
    ctx.fillStyle = COLORS.muted;
    drawWrapped(ctx, `${item.label}: ${item.description}`, x + 172, cursor, w - 190, 17, 2);
    cursor += 54;
  });
  return cursor;
}

function drawNotes(ctx: CanvasRenderingContext2D, notes: string[], x: number, y: number, w: number) {
  drawPanelTitle(ctx, "Engineering Notes", x, y, w);
  let cursor = y + 56;
  setFont(ctx, 15);
  ctx.fillStyle = COLORS.ink;
  notes.slice(0, 5).forEach((note, index) => {
    ctx.fillText(`${index + 1}.`, x + 14, cursor);
    cursor = drawWrapped(ctx, note, x + 42, cursor, w - 58, 18, 2) + 14;
  });
  return cursor;
}

function drawTitleBlock(ctx: CanvasRenderingContext2D, input: ProfessionalDrawingSheetInput, x: number, y: number, w: number) {
  drawPanelTitle(ctx, "Title Block", x, y, w);
  const rows = [
    ["Project", input.projectName],
    ["Floor", input.floorName],
    ["Drawing", `ENT-${input.projectCode}-E-${input.floorNumber}`],
    ["Title", input.textPlan.drawingTitle],
    ["Standard", "EBCS / IEC 60364 / IEC 60617"],
    ["Supply", "220-230V 1P / 380-400V 3P, 50Hz"],
    ["Revision", `R${input.revision}`],
    ["Prepared By", "Elec Nova Tech AI"],
    ["Checked By", "Engineering Review"]
  ];
  let cursor = y + 58;
  rows.forEach(([label, value]) => {
    setFont(ctx, 13, "bold");
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(label.toUpperCase(), x + 14, cursor);
    setFont(ctx, 16, "bold");
    ctx.fillStyle = COLORS.ink;
    cursor = drawWrapped(ctx, value, x + 150, cursor, w - 166, 18, 2) + 10;
    ctx.strokeStyle = "#d8dde1";
    ctx.beginPath();
    ctx.moveTo(x + 12, cursor - 4);
    ctx.lineTo(x + w - 12, cursor - 4);
    ctx.stroke();
  });
  return cursor;
}

export async function createProfessionalDrawingSheet(input: ProfessionalDrawingSheetInput) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const source = await loadImage(input.imageBuffer);
  const canvas = createCanvas(SHEET_W, SHEET_H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(MARGIN / 2, MARGIN / 2, SHEET_W - MARGIN, SHEET_H - MARGIN);

  ctx.fillStyle = COLORS.title;
  ctx.fillRect(MARGIN, MARGIN, SHEET_W - MARGIN * 2, HEADER_H - 18);
  setFont(ctx, 34, "bold");
  ctx.fillStyle = "#ffffff";
  ctx.fillText("ELEC NOVA TECH", MARGIN + 26, MARGIN + 44);
  setFont(ctx, 24, "bold");
  ctx.fillText(input.textPlan.drawingTitle, MARGIN + 26, MARGIN + 78);
  setFont(ctx, 18);
  ctx.fillStyle = "#dce4e8";
  ctx.fillText(`${input.projectName} / ${input.floorName} / Revision R${input.revision}`, MARGIN + 760, MARGIN + 62);

  const planX = MARGIN;
  const planY = MARGIN + HEADER_H;
  const planW = SHEET_W - MARGIN * 2 - PANEL_W - PLAN_GAP;
  const planH = SHEET_H - planY - MARGIN;
  ctx.fillStyle = "#eef2f3";
  ctx.fillRect(planX, planY, planW, planH);
  ctx.strokeStyle = "#25313b";
  ctx.lineWidth = 3;
  ctx.strokeRect(planX, planY, planW, planH);

  const fitted = fitRect(source.width, source.height, planW - 28, planH - 28);
  const imgX = planX + (planW - fitted.width) / 2;
  const imgY = planY + (planH - fitted.height) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, imgX, imgY, fitted.width, fitted.height);
  drawAnnotations(ctx, input.annotations, { x: imgX, y: imgY, w: fitted.width, h: fitted.height });

  const panelX = planX + planW + PLAN_GAP;
  const panelY = planY;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(panelX, panelY, PANEL_W, planH);
  ctx.strokeStyle = "#25313b";
  ctx.lineWidth = 3;
  ctx.strokeRect(panelX, panelY, PANEL_W, planH);

  let cursor = drawTitleBlock(ctx, input, panelX + 18, panelY + 18, PANEL_W - 36) + 18;
  cursor = drawLegend(ctx, input.legend, panelX + 18, cursor, PANEL_W - 36) + 18;
  cursor = drawCircuitSchedule(ctx, input, panelX + 18, cursor, PANEL_W - 36) + 18;
  drawNotes(ctx, input.textPlan.designNotes, panelX + 18, Math.min(cursor, SHEET_H - 270), PANEL_W - 36);

  const boqPreview = input.boqItems.slice(0, 3).map((item) => `${item.item}: ${item.quantity} ${item.unit}`).join("  |  ");
  ctx.fillStyle = "#f1f3f1";
  ctx.fillRect(MARGIN, SHEET_H - MARGIN - 42, planW, 42);
  setFont(ctx, 16, "bold");
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(`BOQ CHECK: ${boqPreview || "See floor BOQ table for quantities."}`, MARGIN + 14, SHEET_H - MARGIN - 16);

  return canvas.toBuffer("image/png");
}
