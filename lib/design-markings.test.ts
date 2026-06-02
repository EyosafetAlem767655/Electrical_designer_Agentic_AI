import { describe, expect, it } from "vitest";
import { designMarkingsSchema, reviewInputSchema } from "@/lib/design-markings";

const validMarkings = {
  source_size: [1000, 700],
  boundary_polygon: [[50, 50], [950, 50], [950, 650], [50, 650]],
  design_bbox: [50, 50, 950, 650],
  db_room_bbox: [70, 70, 220, 160],
  generator_room_bbox: [760, 70, 940, 180],
  confidence: 0.8,
  warnings: []
};

describe("designMarkingsSchema", () => {
  it("accepts source-pixel marking candidates", () => {
    expect(designMarkingsSchema.parse(validMarkings).boundary_polygon).toHaveLength(4);
  });

  it("rejects out-of-bounds polygons and inverted boxes", () => {
    expect(() =>
      designMarkingsSchema.parse({
        ...validMarkings,
        boundary_polygon: [[-1, 50], [950, 50], [950, 650]],
        db_room_bbox: [220, 160, 70, 70]
      })
    ).toThrow();
  });
});

describe("reviewInputSchema", () => {
  it("defaults queueGeneration and answers", () => {
    const parsed = reviewInputSchema.parse({ markings: validMarkings });
    expect(parsed.queueGeneration).toBe(true);
    expect(parsed.answers).toEqual({});
  });
});
