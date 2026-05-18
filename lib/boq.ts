import type { BoqItem, Design } from "@/types";

export function fallbackBoqFromDesign(design?: Pick<Design, "symbol_legend"> | null): BoqItem[] {
  const base: BoqItem[] = [
    { category: "Lighting", item: "LED luminaire", specification: "230V AC LED fitting, IEC/EU compliant", unit: "pcs", quantity: 1, standard: "EBCS, IEC 60598", notes: "Estimate from drawing; final count by approved layout" },
    { category: "Power", item: "Earthed socket outlet", specification: "230V, 16A, Type F/Schuko-style outlet with earth", unit: "pcs", quantity: 1, standard: "IEC 60884, EBCS", notes: "Estimate from drawing; final count by approved layout" },
    { category: "Wiring", item: "Copper conductors in PVC conduit", specification: "IEC copper conductors in PVC conduit/trunking, mm2 sizing by circuit load", unit: "m", quantity: 1, standard: "IEC 60227, IEC 60364", notes: "Route length to be measured on site" },
    { category: "Protection", item: "DIN-rail MCB/RCBO/RCCB protection", specification: "IEC/EU DIN-rail protective devices sized by final circuit load", unit: "set", quantity: 1, standard: "IEC 60898, IEC 61008/61009", notes: "Breaker ratings to be finalized by load schedule" }
  ];

  const labels = new Set((design?.symbol_legend ?? []).map((item) => item.label.toLowerCase()));
  if ([...labels].some((label) => label.includes("emergency"))) {
    base.push({ category: "Emergency", item: "Emergency light fitting", specification: "230V maintained/non-maintained emergency luminaire with battery backup", unit: "pcs", quantity: 1, standard: "EBCS, IEC 60598-2-22", notes: "Place at exits, stairs, corridors; final count by approved design" });
  }
  if ([...labels].some((label) => label.includes("fire"))) {
    base.push({ category: "Fire Alarm", item: "Fire alarm device", specification: "Smoke/heat detector or manual call point as shown on design", unit: "pcs", quantity: 1, standard: "EBCS, IEC 54 series", notes: "Coordinate with fire alarm vendor and authority requirements" });
  }
  if ([...labels].some((label) => label.includes("data") || label.includes("telecom"))) {
    base.push({ category: "Low Current", item: "Data/CCTV/telecom point", specification: "Low-current outlet, Cat6/data or CCTV point as applicable", unit: "pcs", quantity: 1, standard: "IEC/EIA/TIA project specification", notes: "Coordinate exact device type with client IT/security requirements" });
  }

  return base;
}

export function boqItemsForDesign(design?: Design | null): BoqItem[] {
  return Array.isArray(design?.boq_items) && design.boq_items.length ? design.boq_items : fallbackBoqFromDesign(design);
}
