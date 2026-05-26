import { z } from "zod";
import type { BoqItem, SymbolLegendItem } from "@/types";
import { boqItemForSymbol, isKnownSymbol, standardLegend, SYMBOL_CODES, type SymbolCode } from "@/lib/symbol-dictionary";

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const bboxSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const symbolSchema = z.enum(SYMBOL_CODES);

export const routeTypeSchema = z.enum([
  "main_distribution",
  "generator_backup",
  "lighting",
  "emergency_lighting",
  "power_socket",
  "switch_control",
  "fire_alarm",
  "cctv_data"
]);

export const planSpecSchema = z
  .object({
    project: z
      .object({
        title: z.string().min(1),
        drawing_type: z.string().min(1).default("schematic_overlay"),
        notes: z.array(z.string()).default([])
      })
      .strict(),
    base_plan: z
      .object({
        image_width: z.number().int().nonnegative(),
        image_height: z.number().int().nonnegative(),
        scale_known: z.boolean().default(false)
      })
      .strict(),
    rooms: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            bbox: bboxSchema,
            confidence: z.number().min(0).max(1).default(0.5),
            notes: z.array(z.string()).default([])
          })
          .strict()
      )
      .default([]),
    equipment: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: symbolSchema,
            label: z.string().min(1),
            location: pointSchema,
            room_id: z.string().nullable().optional(),
            notes: z.array(z.string()).default([])
          })
          .strict()
      )
      .default([]),
    devices: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: symbolSchema,
            label: z.string().min(1),
            location: pointSchema,
            circuit_id: z.string().nullable().optional(),
            room_id: z.string().nullable().optional(),
            switch_id: z.string().nullable().optional()
          })
          .strict()
      )
      .default([]),
    routes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: routeTypeSchema,
            from: z.string().min(1),
            to: z.string().min(1),
            points: z.array(pointSchema).min(2),
            label: z.string().min(1),
            style: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    circuits: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: z.string().min(1),
            source: z.string().min(1),
            devices: z.array(z.string()).default([]),
            switches: z.array(z.string()).default([]),
            label: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    legend: z.array(z.object({ symbol: symbolSchema, meaning: z.string().min(1) }).strict()).default([]),
    boq: z
      .array(
        z
          .object({
            symbol: symbolSchema,
            description: z.string().min(1),
            quantity: z.number().nonnegative()
          })
          .strict()
      )
      .default([]),
    warnings: z
      .array(
        z
          .object({
            severity: z.enum(["info", "verify", "warning", "error"]).default("verify"),
            message: z.string().min(1)
          })
          .strict()
      )
      .default([])
  })
  .strict();

export type PlanSpec = z.infer<typeof planSpecSchema>;
export type RouteType = z.infer<typeof routeTypeSchema>;

export const planSpecJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["project", "base_plan", "rooms", "equipment", "devices", "routes", "circuits", "legend", "boq", "warnings"],
  properties: {
    project: {
      type: "object",
      additionalProperties: false,
      required: ["title", "drawing_type", "notes"],
      properties: {
        title: { type: "string" },
        drawing_type: { type: "string" },
        notes: { type: "array", items: { type: "string" } }
      }
    },
    base_plan: {
      type: "object",
      additionalProperties: false,
      required: ["image_width", "image_height", "scale_known"],
      properties: {
        image_width: { type: "integer" },
        image_height: { type: "integer" },
        scale_known: { type: "boolean" }
      }
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "bbox", "confidence", "notes"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          bbox: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } },
          confidence: { type: "number" },
          notes: { type: "array", items: { type: "string" } }
        }
      }
    },
    equipment: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "label", "location", "room_id", "notes"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: SYMBOL_CODES },
          label: { type: "string" },
          location: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          room_id: { type: ["string", "null"] },
          notes: { type: "array", items: { type: "string" } }
        }
      }
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "label", "location", "circuit_id", "room_id", "switch_id"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: SYMBOL_CODES },
          label: { type: "string" },
          location: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          circuit_id: { type: ["string", "null"] },
          room_id: { type: ["string", "null"] },
          switch_id: { type: ["string", "null"] }
        }
      }
    },
    routes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "from", "to", "points", "label", "style"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: routeTypeSchema.options },
          from: { type: "string" },
          to: { type: "string" },
          points: {
            type: "array",
            items: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } }
          },
          label: { type: "string" },
          style: { type: "string" }
        }
      }
    },
    circuits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "source", "devices", "switches", "label"],
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          source: { type: "string" },
          devices: { type: "array", items: { type: "string" } },
          switches: { type: "array", items: { type: "string" } },
          label: { type: "string" }
        }
      }
    },
    legend: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "meaning"],
        properties: { symbol: { type: "string", enum: SYMBOL_CODES }, meaning: { type: "string" } }
      }
    },
    boq: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "description", "quantity"],
        properties: {
          symbol: { type: "string", enum: SYMBOL_CODES },
          description: { type: "string" },
          quantity: { type: "number" }
        }
      }
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "message"],
        properties: {
          severity: { type: "string", enum: ["info", "verify", "warning", "error"] },
          message: { type: "string" }
        }
      }
    }
  }
} as const;

function symbolCounts(spec: PlanSpec) {
  const counts = new Map<SymbolCode, number>();
  for (const item of [...spec.equipment, ...spec.devices]) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  return counts;
}

export function normalizePlanSpec(input: unknown): PlanSpec {
  const parsed = planSpecSchema.parse(input);
  const counts = symbolCounts(parsed);
  const symbols = new Set<SymbolCode>([...counts.keys()]);
  for (const item of parsed.legend) symbols.add(item.symbol);
  for (const item of parsed.boq) symbols.add(item.symbol);

  const legend = standardLegend(symbols).map((item) => ({
    symbol: item.symbol as SymbolCode,
    meaning: item.label
  }));
  const boq = Array.from(counts.entries()).map(([symbol, quantity]) => ({
    symbol,
    description: boqItemForSymbol(symbol, quantity).item,
    quantity
  }));
  return { ...parsed, legend, boq };
}

export function planSymbolLegend(spec: PlanSpec): SymbolLegendItem[] {
  return standardLegend(spec.legend.map((item) => item.symbol));
}

export function planBoqItems(spec: PlanSpec): BoqItem[] {
  const counts = symbolCounts(spec);
  return Array.from(counts.entries()).map(([symbol, quantity]) => boqItemForSymbol(symbol, quantity));
}

export function validatePlanSymbolConsistency(spec: PlanSpec) {
  const undefinedSymbols = [...spec.equipment, ...spec.devices].map((item) => item.type).filter((symbol) => !isKnownSymbol(symbol));
  if (undefinedSymbols.length) {
    throw new Error(`Undefined symbols in plan specification: ${Array.from(new Set(undefinedSymbols)).join(", ")}`);
  }
  const legendSymbols = new Set(spec.legend.map((item) => item.symbol));
  const visibleSymbols = new Set([...spec.equipment, ...spec.devices].map((item) => item.type));
  const missingLegend = [...visibleSymbols].filter((symbol) => !legendSymbols.has(symbol));
  if (missingLegend.length) throw new Error(`Visible symbols missing from legend: ${missingLegend.join(", ")}`);
}
