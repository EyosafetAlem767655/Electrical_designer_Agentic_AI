import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { programmaticBoq, programmaticLegend, renderProgrammaticElectricalSchematic } from "@/lib/schematic-renderer";

function testPlanDataUrl() {
  const canvas = createCanvas(320, 180);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 320, 180);
  ctx.strokeStyle = "#999999";
  ctx.strokeRect(20, 20, 280, 140);
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

describe("programmatic schematic renderer", () => {
  it("renders a PNG with structured legend and visible-count BOQ", async () => {
    const output = await renderProgrammaticElectricalSchematic({
      sourceImageUrl: testPlanDataUrl(),
      project: { project_name: "Test Project", building_purpose: "Basement parking", special_requirements: "No EV chargers" },
      floor: { floor_name: "1st Basement", floor_number: 1, architect_answers: {} },
      version: 1,
      omittedSymbols: ["EV"]
    });

    expect(output.buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(output.buffer.length).toBeGreaterThan(100_000);
    const image = await loadImage(output.buffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const titlePixels = ctx.getImageData(30, 20, 900, 80).data;
    let darkPixels = 0;
    for (let index = 0; index < titlePixels.length; index += 4) {
      if (titlePixels[index] < 80 && titlePixels[index + 1] < 80 && titlePixels[index + 2] < 80) darkPixels += 1;
    }
    expect(darkPixels).toBeGreaterThan(100);
    expect(output.symbolLegend.map((item) => item.symbol)).toEqual(expect.arrayContaining(["FL", "EL", "SW", "SO", "MSU", "ATS", "G"]));
    expect(output.symbolLegend.some((item) => item.symbol === "EV")).toBe(false);
    expect(output.boqItems.find((item) => item.item.includes("Fluorescent"))?.quantity).toBe(25);
    expect(output.boqItems.some((item) => /electric vehicle|ev charger/i.test(item.item))).toBe(false);
  });

  it("keeps deterministic legend and BOQ families aligned", () => {
    const legendSymbols = programmaticLegend(["EV"]).map((item) => item.symbol);
    const boqText = programmaticBoq(["EV"]).map((item) => item.item).join(" ");

    expect(legendSymbols).toEqual(expect.arrayContaining(["FL", "EL", "SW", "SO", "DB", "MSU", "G", "ATS", "FA", "CCTV/DATA"]));
    expect(legendSymbols).not.toContain("EV");
    expect(boqText).toContain("Manual switches");
    expect(boqText).toContain("220-230V earthed socket outlets");
  });
});
