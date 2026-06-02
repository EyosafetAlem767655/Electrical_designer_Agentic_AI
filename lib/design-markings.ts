import { z } from "zod";

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const bboxSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);

export const designMarkingsSchema = z
  .object({
    source_size: z.tuple([z.number().positive(), z.number().positive()]),
    boundary_polygon: z.array(pointSchema).min(3).max(24),
    design_bbox: bboxSchema.optional(),
    db_room_bbox: bboxSchema,
    generator_room_bbox: bboxSchema,
    confidence: z.number().min(0).max(1).optional(),
    warnings: z.array(z.object({ severity: z.string().optional(), message: z.string().min(1) }).passthrough()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const [width, height] = value.source_size;
    const checkPoint = (point: [number, number], path: (string | number)[]) => {
      if (point[0] < 0 || point[0] > width || point[1] < 0 || point[1] > height) {
        ctx.addIssue({ code: "custom", path, message: "Point is outside the source image bounds." });
      }
    };
    value.boundary_polygon.forEach((point, index) => checkPoint(point, ["boundary_polygon", index]));
    for (const key of ["design_bbox", "db_room_bbox", "generator_room_bbox"] as const) {
      const bbox = value[key];
      if (!bbox) continue;
      const [x1, y1, x2, y2] = bbox;
      if (x2 <= x1 || y2 <= y1) {
        ctx.addIssue({ code: "custom", path: [key], message: "Bounding box must be ordered as [x1, y1, x2, y2]." });
      }
      checkPoint([x1, y1], [key, 0]);
      checkPoint([x2, y2], [key, 2]);
    }
  });

export const reviewInputSchema = z.object({
  markings: designMarkingsSchema,
  answers: z.record(z.string(), z.unknown()).default({}),
  queueGeneration: z.boolean().default(true)
});

export type DesignMarkingsInput = z.infer<typeof designMarkingsSchema>;
