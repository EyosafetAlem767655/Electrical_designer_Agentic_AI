import { jsPDF } from "jspdf";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Design, Floor, Project } from "@/types";

export async function convertPdfToPngPages(pdfBuffer: Buffer) {
  const { pdf } = await import("pdf-to-img");
  const tmpPath = join(tmpdir(), `elec-nova-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  await writeFile(tmpPath, pdfBuffer);

  try {
    const document = await pdf(tmpPath, { scale: 3 });
    const pages: Buffer[] = [];
    for await (const image of document) {
      pages.push(Buffer.from(image));
      if (pages.length >= 1) break;
    }
    return pages;
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

export async function createFloorPdf(project: Project, floor: Floor, design: Design) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [841, 594] });
  const margin = 18;
  const titleBlockWidth = 210;
  const titleBlockHeight = 68;

  doc.setDrawColor(10, 10, 15);
  doc.setLineWidth(0.8);
  doc.rect(margin, margin, 841 - margin * 2, 594 - margin * 2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Elec Nova Tech", margin + 8, 38);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Electrical Installation Design Package", margin + 8, 48);

  const imageX = margin + 8;
  const imageY = 62;
  const imageW = 841 - titleBlockWidth - margin * 2 - 28;
  const imageH = 594 - 140;
  if (design.design_image_url) {
    try {
      const response = await fetch(design.design_image_url);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      doc.addImage(`data:image/png;base64,${base64}`, "PNG", imageX, imageY, imageW, imageH, undefined, "FAST");
    } catch {
      doc.setFontSize(16);
      doc.text("Design image could not be embedded. See dashboard image artifact.", imageX, imageY + 20);
    }
  } else {
    doc.setFontSize(16);
    doc.text("Design image pending.", imageX, imageY + 20);
  }

  const legendX = margin + 8;
  const legendY = 526;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("SYMBOL LEGEND", legendX, legendY);
  doc.setFont("helvetica", "normal");
  design.symbol_legend.slice(0, 6).forEach((item, index) => {
    const y = legendY + 8 + index * 7;
    doc.text(`${item.symbol} - ${item.label}: ${item.description}`, legendX, y);
  });

  const tbX = 841 - margin - titleBlockWidth;
  const tbY = 594 - margin - titleBlockHeight;
  doc.rect(tbX, tbY, titleBlockWidth, titleBlockHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TITLE BLOCK", tbX + 6, tbY + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rows = [
    ["Project", project.project_name],
    ["Floor", floor.floor_name],
    ["Drawing No", `ENT-${project.project_code ?? "PROJECT"}-E-${floor.floor_number}`],
    ["Scale", "As noted"],
    ["Date", new Date().toISOString().slice(0, 10)],
    ["Designed by", "Elec Nova Tech AI"],
    ["Company", "Elec Nova Tech"],
    ["Revision", String(design.version)]
  ];
  rows.forEach(([key, value], index) => {
    doc.text(`${key}:`, tbX + 6, tbY + 19 + index * 6);
    doc.text(value, tbX + 48, tbY + 19 + index * 6);
  });

  return Buffer.from(doc.output("arraybuffer"));
}

async function addRemoteImage(doc: jsPDF, imageUrl: string | null, x: number, y: number, w: number, h: number) {
  if (!imageUrl) {
    doc.text("Design image pending.", x, y + 12);
    return;
  }

  try {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    doc.addImage(`data:image/png;base64,${base64}`, "PNG", x, y, w, h, undefined, "FAST");
  } catch {
    doc.text("Design image could not be embedded. See dashboard artifact.", x, y + 12);
  }
}

export async function createProjectPackagePdf(project: Project, floors: Floor[], designs: Design[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [841, 594] });
  const margin = 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text("Elec Nova Tech", margin, 70);
  doc.setFontSize(22);
  doc.text("Electrical Design Package", margin, 92);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.text(`Project: ${project.project_name}`, margin, 120);
  doc.text(`Purpose: ${project.building_purpose ?? "Not specified"}`, margin, 132);
  doc.text(`Architect: ${project.architect_name}`, margin, 144);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, margin, 156);
  doc.rect(margin, 500, 797, 54);
  doc.text("Standards: EBCS, IEC 60364, IEC 60529, IEC 60617, EEU connection requirements.", margin + 8, 518);
  doc.text("Supply basis: 220V single-phase, 380V three-phase, 50Hz. Final engineering checks remain required before construction.", margin + 8, 530);

  doc.addPage([841, 594], "landscape");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Table of Contents", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  floors.forEach((floor, index) => {
    doc.text(`${index + 1}. ${floor.floor_name} electrical design`, margin, 62 + index * 9);
  });
  doc.text(`${floors.length + 1}. General notes and schedules`, margin, 62 + floors.length * 9);

  for (const floor of floors) {
    const design = designs
      .filter((item) => item.floor_id === floor.id)
      .sort((a, b) => b.version - a.version)[0];
    doc.addPage([841, 594], "landscape");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`${floor.floor_name} - Electrical Installation Drawing`, margin, 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Drawing No: ENT-${project.project_code ?? "PROJECT"}-E-${floor.floor_number}`, margin, 48);
    await addRemoteImage(doc, design?.design_image_url ?? null, margin, 62, 640, 430);
    doc.rect(682, 62, 132, 190);
    doc.setFont("helvetica", "bold");
    doc.text("Legend", 690, 76);
    doc.setFont("helvetica", "normal");
    (design?.symbol_legend ?? []).slice(0, 10).forEach((item, index) => {
      doc.text(`${item.symbol} - ${item.label}`, 690, 90 + index * 9);
    });
    doc.rect(682, 438, 132, 54);
    doc.text(`Revision: ${design?.version ?? "Pending"}`, 690, 454);
    doc.text(`Status: ${floor.status}`, 690, 466);
    doc.text("Designed by: Elec Nova Tech AI", 690, 478);
  }

  doc.addPage([841, 594], "landscape");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("General Notes And Schedules", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const notes = [
    "1. All electrical installation work shall be verified by a licensed electrical engineer before construction.",
    "2. Lighting and power circuits shall be separated unless explicitly approved in engineering review.",
    "3. Bathrooms and wet areas require appropriate IP ratings and protection per IEC 60364-7-701.",
    "4. Emergency lighting shall provide minimum one-hour battery backup in corridors, stairs, and exits.",
    "5. Fire alarm, data, telecom, CCTV, earthing, and lightning protection routes require site coordination.",
    "6. Load schedules, riser diagrams, and single-line diagrams should be finalized from approved floor designs."
  ];
  notes.forEach((note, index) => doc.text(note, margin, 66 + index * 10));

  return Buffer.from(doc.output("arraybuffer"));
}
