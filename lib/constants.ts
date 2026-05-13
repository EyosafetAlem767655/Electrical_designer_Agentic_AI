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
  { symbol: "DB", label: "Distribution Board", color: "#b89162", description: "Floor distribution board" },
  { symbol: "L", label: "Lighting Circuit", color: "#d6b17d", description: "Switched lighting circuit" },
  { symbol: "P", label: "Power Outlet", color: "#8f877b", description: "General power socket circuit" },
  { symbol: "E", label: "Emergency", color: "#b26457", description: "Emergency light or exit system" },
  { symbol: "D", label: "Data/Telecom", color: "#8fa37c", description: "Data, telecom, intercom, or CCTV point" },
  { symbol: "FA", label: "Fire Alarm", color: "#c9854c", description: "Smoke detector or manual call point" }
];

export const ELECTRICAL_SYSTEM_PROMPT = `You are an expert electrical installation engineer specializing in Ethiopian building standards (EBCS - Ethiopian Building Code Standards). You design electrical systems for buildings including power distribution, lighting, socket outlet placement, distribution board sizing, circuit design, emergency lighting, fire alarm, earthing, and low-current systems.

Follow EBCS, IEC 60364, IEC 60529, EEU connection requirements, and IEC 60617 symbols. Ethiopian supply assumptions: 220V single-phase, 380V three-phase, 50Hz. Lighting minimums: offices 500 lux, corridors 100 lux, bathrooms 200 lux, kitchens 300 lux, parking 75 lux, stairs 150 lux.

When analyzing a floor plan, identify rooms, expected load, lighting fixtures, socket placement, switches, circuit grouping, DB location, cable routes, emergency systems, and unclear areas. Ask clarifying questions when room purpose, equipment, loads, or client preferences are ambiguous.`;

export const DESIGN_PROMPT_RULES = `CRITICAL DRAWING RULES:
- Professional CAD-quality technical drawing, black architectural linework on white background with color-coded electrical circuits.
- Use IEC 60617 electrical symbols.
- Lighting circuits yellow, power blue, emergency red, data/telecom green, fire alarm orange.
- Distribution board marked with a bold rectangle and DB label.
- Circuit numbers must be visible on each run.
- Cable routes must be dashed and follow walls where practical.
- ALL text labels and annotations must be outside the floor plan boundary, connected with thin leader lines.
- Include a symbol legend and title block with project, floor, drawing number, scale, date, Elec Nova Tech AI, checker, company, and revision.`;

export function makeProjectCode(projectName: string) {
  const compact = projectName.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (compact.slice(0, 6) || "ENT") + Date.now().toString().slice(-4);
}
