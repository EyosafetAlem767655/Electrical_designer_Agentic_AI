import { describe, expect, it } from "vitest";
import { normalizePlanSpec, planBoqItems, planSymbolLegend, validatePlanSymbolConsistency, type PlanSpec } from "@/lib/plan-schema";
import { SYMBOL_CODES, SYMBOL_DICTIONARY } from "@/lib/symbol-dictionary";

export function samplePlanSpec(): PlanSpec {
  return normalizePlanSpec({
    project: { title: "Basement Electrical Layout", drawing_type: "schematic_overlay", notes: ["Default Ethiopian/IEC assumptions"] },
    base_plan: { image_width: 1000, image_height: 700, scale_known: false },
    rooms: [{ id: "room_001", label: "Electrical Meter Room", bbox: [50, 50, 260, 190], confidence: 0.9, notes: [] }],
    equipment: [
      { id: "msu_001", type: "MSU", label: "MSU", location: [90, 100], room_id: "room_001", notes: ["Main incoming supply"] },
      { id: "ats_001", type: "ATS", label: "ATS", location: [190, 100], room_id: "room_001", notes: [] },
      { id: "db_001", type: "DB", label: "DB", location: [250, 100], room_id: "room_001", notes: [] },
      { id: "g_001", type: "G", label: "G / 80 kVA", location: [850, 560], room_id: null, notes: [] }
    ],
    devices: [
      { id: "fl_001", type: "FL", label: "FL-1", location: [400, 220], circuit_id: "L1", room_id: null, switch_id: "sw_001" },
      { id: "fl_002", type: "FL", label: "FL-2", location: [560, 220], circuit_id: "L1", room_id: null, switch_id: "sw_001" },
      { id: "el_001", type: "EL", label: "EL-1", location: [500, 500], circuit_id: "E1", room_id: null, switch_id: null },
      { id: "sw_001", type: "SW", label: "SW", location: [330, 190], circuit_id: "L1", room_id: null, switch_id: null },
      { id: "so_001", type: "SO", label: "SO-1", location: [720, 310], circuit_id: "P1", room_id: null, switch_id: null },
      { id: "fa_001", type: "FA", label: "FA", location: [620, 420], circuit_id: "FA1", room_id: null, switch_id: null },
      { id: "cd_001", type: "CCTV/DATA", label: "DATA", location: [840, 220], circuit_id: "CD1", room_id: null, switch_id: null }
    ],
    routes: [
      { id: "r_001", type: "main_distribution", from: "MSU", to: "ATS", points: [[90, 100], [190, 100]], label: "MSU -> ATS", style: "main_supply" },
      { id: "r_002", type: "generator_backup", from: "G", to: "ATS", points: [[850, 560], [850, 100], [190, 100]], label: "G -> ATS", style: "generator_backup" },
      { id: "r_003", type: "lighting", from: "DB", to: "FL-1", points: [[250, 100], [400, 220], [560, 220]], label: "L1 lighting", style: "lighting" },
      { id: "r_004", type: "emergency_lighting", from: "DB", to: "EL-1", points: [[250, 100], [500, 500]], label: "E1 emergency", style: "emergency" }
    ],
    circuits: [{ id: "L1", type: "lighting", source: "DB", devices: ["fl_001", "fl_002"], switches: ["sw_001"], label: "Lighting Circuit L1" }],
    legend: [],
    boq: [],
    warnings: [{ severity: "verify", message: "Room use uncertain in open parking area." }]
  });
}

describe("plan schema and symbol inventory", () => {
  it("normalizes strict specs and derives legend and BOQ from visible symbols", () => {
    const spec = samplePlanSpec();
    validatePlanSymbolConsistency(spec);

    expect(planSymbolLegend(spec).map((item) => item.symbol)).toEqual(expect.arrayContaining(["MSU", "ATS", "G", "DB", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA"]));
    expect(planBoqItems(spec).find((item) => item.item === "Fluorescent Light")?.quantity).toBe(2);
    expect(spec.boq.find((item) => item.symbol === "FL")?.quantity).toBe(2);
  });

  it("keeps the standard dictionary aligned with allowed symbols", () => {
    expect(Object.keys(SYMBOL_DICTIONARY).sort()).toEqual([...SYMBOL_CODES].sort());
    expect(SYMBOL_CODES).not.toContain("EV" as never);
  });

  it("rejects undefined symbols", () => {
    const invalid = {
      ...samplePlanSpec(),
      devices: [{ id: "bad", type: "S5", label: "S5", location: [1, 1], circuit_id: null, room_id: null, switch_id: null }]
    };
    expect(() => normalizePlanSpec(invalid)).toThrow();
  });
});
