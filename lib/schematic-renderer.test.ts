import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderProgrammaticElectricalSchematic } from "@/lib/schematic-renderer";
import { samplePlanSpec } from "@/lib/plan-schema.test";

function testPlanDataUrl() {
  const canvas = createCanvas(420, 280);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 420, 280);
  ctx.strokeStyle = "#888888";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, 360, 220);
  ctx.strokeRect(50, 50, 90, 70);
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

describe("deterministic Python plan renderer", () => {
  it("renders PNG, debug overlay, legend, and BOQ from the same spec", async () => {
    const spec = samplePlanSpec();
    const output = await renderProgrammaticElectricalSchematic({
      sourceImageUrl: testPlanDataUrl(),
      project: { project_name: "Test Project", building_purpose: "Basement parking", special_requirements: "Generator backup" },
      floor: { floor_name: "1st Basement", floor_number: 1, architect_answers: {} },
      version: 1,
      spec
    });

    expect(output.buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(output.debugBuffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(output.symbolLegend.map((item) => item.symbol)).toEqual(expect.arrayContaining(["MSU", "ATS", "G", "DB", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA"]));
    expect(output.boqItems.find((item) => item.item === "Fluorescent Light")?.quantity).toBe(2);

    const image = await loadImage(output.buffer);
    expect(image.width).toBe(2400);
    expect(image.height).toBe(1500);
  });
});
