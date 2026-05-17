import type { FloorStatus, ProjectStatus, SymbolLegendItem } from "@/types";

export const STORAGE_BUCKET = "project-files";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  created: "Created",
  awaiting_verification: "Awaiting Verification",
  verified: "Verified",
  in_progress: "In Progress",
  completed: "Completed"
};

export const FLOOR_STATUS_LABELS: Record<FloorStatus, string> = {
  pending: "Pending",
  pdf_received: "PDF Received",
  analyzing: "Analyzing",
  questions_sent: "Questions Sent",
  designing: "Designing",
  design_ready: "Design Ready",
  revision_requested: "Revision Requested",
  approved: "Approved"
};

export const DEFAULT_SYMBOL_LEGEND: SymbolLegendItem[] = [
  { symbol: "DB", label: "Distribution Board", color: "#2f8178", description: "Floor distribution board" },
  { symbol: "L", label: "Lighting Circuit", color: "#d6a744", description: "Switched lighting circuit" },
  { symbol: "P", label: "Power Outlet", color: "#61788f", description: "General power socket circuit" },
  { symbol: "E", label: "Emergency", color: "#c95f55", description: "Emergency light or exit system" },
  { symbol: "D", label: "Data/Telecom", color: "#6d5a87", description: "Data, telecom, intercom, or CCTV point" },
  { symbol: "FA", label: "Fire Alarm", color: "#d66f61", description: "Smoke detector or manual call point" }
];

export const ELECTRICAL_SYSTEM_PROMPT = `You are an expert electrical installation engineer specializing in Ethiopian building standards (EBCS - Ethiopian Building Code Standards). You design practical, buildable electrical systems for real buildings including power distribution, lighting, socket outlet placement, distribution board sizing, circuit design, emergency lighting, fire alarm, earthing, and low-current systems.

Follow EBCS, IEC 60364, IEC 60529, EEU connection requirements, and IEC 60617 symbols. Ethiopian supply assumptions: 220V single-phase, 380V three-phase, 50Hz. Lighting minimums: offices 500 lux, corridors 100 lux, bathrooms 200 lux, kitchens 300 lux, parking 75 lux, stairs 150 lux.

Before proposing a design, perform a careful internal engineering checklist: identify every enclosed room, corridor, stair, lobby, service room, wet area, outdoor/balcony area, and ambiguous space; decide lighting coverage, switch locations, socket outlets, emergency lighting, fire alarm, data/CCTV, distribution board position, circuit grouping, cable routes, and electrician-readable labels. Do not rush to a drawing until this checklist is complete.

When analyzing a floor plan, identify rooms, expected load, lighting fixtures, socket placement, switches, circuit grouping, DB location, cable routes, emergency systems, and unclear areas. Every room and usable section must have lighting coverage. Every habitable/working room must have sensible socket outlet coverage. Ask clarifying questions when room purpose, equipment, loads, or client preferences are ambiguous.`;

export const DESIGN_PROMPT_RULES = `CRITICAL DRAWING RULES:
- Professional CAD-quality technical drawing, black architectural linework on white background with color-coded electrical circuits.
- Use IEC 60617 electrical symbols.
- Lighting circuits yellow, power blue, emergency red, data/telecom green, fire alarm orange.
- Distribution board marked with a bold rectangle and DB label.
- Every room, corridor, stair, lobby, service room, and section must have appropriate lighting points.
- Every habitable/working room must have socket outlets placed where electricians would expect them; kitchens, offices, shops, bedrooms, halls, and service rooms need multiple outlets when practical.
- Switches must be placed near room entrances and connected logically to lighting points.
- Circuit numbers must be visible on each run.
- Cable routes must be thick, clear, dashed where appropriate, and follow walls/ceilings where practical so electricians can understand routing.
- ALL text labels and annotations must be outside the floor plan boundary, connected with thin leader lines.
- Use large, crisp, high-contrast labels; avoid tiny text, blurry text, decorative fonts, or fake unreadable drafting notes.
- Include a simple readable symbol legend and title block with project, floor, drawing number, scale, date, Elec Nova Tech AI, checker, company, and revision.`;

export function makeProjectCode(projectName: string) {
  const compact = projectName.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (compact.slice(0, 6) || "ENT") + Date.now().toString().slice(-4);
}
