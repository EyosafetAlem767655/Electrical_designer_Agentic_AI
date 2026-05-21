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
  image_received: "Image Received",
  analyzing: "Analyzing",
  questions_sent: "Questions Sent",
  designing: "Designing",
  design_ready: "Design Ready",
  revision_requested: "Revision Requested",
  approved: "Approved"
};

export const DEFAULT_SYMBOL_LEGEND: SymbolLegendItem[] = [
  { symbol: "DB", label: "Distribution Board", color: "#2f8178", description: "Floor distribution board" },
  { symbol: "MSU", label: "Main Supply Unit", color: "#2f8178", description: "Incoming supply from transformer or utility source" },
  { symbol: "FL", label: "Fluorescent Lamp", color: "#d6a744", description: "Default lighting fixture unless LED is requested" },
  { symbol: "S", label: "Manual Switch", color: "#8fa37c", description: "Manual lighting switch near entrance/control point" },
  { symbol: "P", label: "Earthed Socket Outlet", color: "#61788f", description: "220-230V earthed power outlet" },
  { symbol: "E", label: "Emergency Light", color: "#c95f55", description: "Emergency luminaire or exit lighting" },
  { symbol: "FA", label: "Fire Alarm", color: "#d66f61", description: "Smoke/heat detector or manual call point" },
  { symbol: "D", label: "Data/CCTV", color: "#6d5a87", description: "Data, telecom, intercom, or CCTV point" },
  { symbol: "EV", label: "EV Charger", color: "#5b8fb9", description: "Dedicated electric vehicle charging point" },
  { symbol: "G", label: "Generator/ATS", color: "#9b6b45", description: "Generator, ATS, or essential supply equipment" }
];

export const ELECTRICAL_SYSTEM_PROMPT = `You are an expert electrical installation engineer specializing in Ethiopian building standards (EBCS - Ethiopian Building Code Standards) and IEC/EU-style installation practice, not US NEC practice. You design practical, buildable electrical systems for real buildings including power distribution, lighting, socket outlet placement, distribution board sizing, circuit design, emergency lighting, fire alarm, earthing, and low-current systems.

Follow EBCS, IEC 60364, IEC 60529, EEU connection requirements, and IEC 60617 symbols. Ethiopian supply assumptions: 220-230V single-phase, 380-400V three-phase, 50Hz. The main supply unit / main source from the transformer or utility incomer is non-negotiable design context: always identify it, ask for its location if unknown, and route the floor DB/circuits logically from that source. Use IEC/EU equipment language: DIN-rail MCB/RCBO/RCCB, Type F/Schuko-style earthed socket outlets where appropriate, copper conductors sized in mm2, PVC conduit/trunking, IP-rated fittings for wet/outdoor areas. Default device assumptions unless the architect explicitly requests otherwise: fluorescent lamp fixtures, manual wall switches, and earthed socket outlets on every floor. Use LED fixtures only when requested by the architect or project requirements. Do not use US-only terminology such as AWG, receptacle yokes, 120/240V split phase, NEMA outlets, or NEC article references. Lighting minimums: offices 500 lux, corridors 100 lux, bathrooms 200 lux, kitchens 300 lux, parking 75 lux, stairs 150 lux.

Before proposing a design, perform a careful internal engineering checklist: identify every enclosed room, corridor, stair, lobby, service room, wet area, outdoor/balcony area, and ambiguous space; decide lighting coverage, switch locations, socket outlets, emergency lighting, fire alarm, data/CCTV, distribution board position, circuit grouping, cable routes, and electrician-readable labels. Do not rush to a drawing until this checklist is complete.

When analyzing a floor plan, identify rooms, expected load, main supply/source location, lighting fixtures, socket placement, switches, circuit grouping, DB location, cable routes, emergency systems, and unclear areas. Every room and usable section must have lighting coverage. Every floor must include lamps, socket outlets, and manual switches unless a specific area is physically unsuitable. Ask clarifying questions when room purpose, equipment, loads, source location, or client preferences are ambiguous.`;

export const DESIGN_PROMPT_RULES = `CRITICAL DRAWING RULES:
- Professional CAD-quality technical drawing, black architectural linework on white background with color-coded electrical circuits.
- The original architectural floor plan is locked reference geometry. Do not alter, redraw, restyle, crop, stretch, simplify, erase, move, or reinterpret any original wall, door, window, stair, column, grid line, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Draw electrical work only as an overlay on top of the unchanged source plan. The result must look like transparent electrical drafting has been added over the original floor plan, not like a regenerated floor plan.
- Use IEC 60617 electrical symbols.
- Lighting circuits yellow, power blue, emergency red, data/telecom green, fire alarm orange.
- Use fluorescent lamp fixtures as the default lighting device, manual wall switches as the default control device, and earthed socket outlets as the default power outlet device. Use LED fixtures only if the architect/project requirements explicitly request LED.
- Before drawing, verify that the overlay includes all three default systems where practical: fluorescent lamp fixtures, manual wall switches, and earthed socket outlets. Do not produce a design that only shows routes or DBs while omitting these devices.
- Distribution board marked with a bold rectangle and DB label.
- Every room, corridor, stair, lobby, service room, and section must have appropriate lighting points.
- Every habitable/working room must have socket outlets placed where electricians would expect them; kitchens, offices, shops, bedrooms, halls, and service rooms need multiple outlets when practical.
- Switches must be placed near room entrances and connected logically to lighting points.
- For basements and parking floors, treat parking bays, drive aisles, ramps, stair lobbies, lift lobbies, generator/fuel/service rooms, storage rooms, entrances, exits, and corners as separate usable zones. Add fluorescent lighting coverage to every zone, manual switching/control zones at entrances/stairs/service doors, emergency lighting on routes/exits, and practical earthed socket outlets for maintenance/service/security/cleaning points where appropriate.
- Circuit numbers must be visible on each run.
- Cable routes must be thick, clear, dashed where appropriate, and follow walls/ceilings where practical so electricians can understand routing.
- Use consistent professional drafting text: uppercase where appropriate, straight baseline, crisp black or dark-blue lettering, simple sans-serif/CAD style, no decorative or fake handwritten text.
- Do not use leader-arrow callouts, external annotation boxes, or side callout labels. Put compact drafting labels directly beside the relevant electrical symbol or route inside the drawing area.
- Use compact labels only: DB, FL1/FL2 fluorescent lighting, S1/S2 manual switches, P1/P2 socket outlets, E1 emergency, FA1 fire alarm, D1 data/CCTV.
- Include a small readable symbol legend only if space exists. The legend must contain only symbol-to-meaning entries, for example "FL - fluorescent lamp", "S - manual switch", "P - socket outlet". Do not put notes, quantities, specifications, schedules, title blocks, or paragraphs in the legend.
- Do not create a new sheet layout, side panel, large blank box, thick decorative border, or empty annotation rectangles.
- Do not add fake illegible notes. If text cannot be kept readable, use fewer shorter labels instead of blurry long sentences.`;

export function makeProjectCode(projectName: string) {
  const compact = projectName.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (compact.slice(0, 6) || "ENT") + Date.now().toString().slice(-4);
}
