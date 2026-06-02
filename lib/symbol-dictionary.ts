import type { BoqItem, SymbolLegendItem } from "@/types";

export const SYMBOL_CODES = [
  "MSU",
  "ATS",
  "G",
  "DB",
  "FL",
  "EL",
  "SW",
  "SO",
  "FA",
  "CCTV/DATA",
  "AC",
  "EF",
  "WH",
  "PUMP",
  "COOKER",
  "EV",
  "LIFT",
  "MACHINE",
  "EQUIP"
] as const;

export type SymbolCode = (typeof SYMBOL_CODES)[number];

export type SymbolDefinition = {
  symbol: SymbolCode;
  label: string;
  description: string;
  category: string;
  defaultSpecification: string;
  unit: string;
  color: string;
  promptGuidance?: string;
  boqMapping?: string;
  rendererShape?: string;
};

export const SYMBOL_DICTIONARY: Record<SymbolCode, SymbolDefinition> = {
  MSU: {
    symbol: "MSU",
    label: "Main Switch Unit",
    description: "Main incoming supply from utility or transformer",
    category: "Distribution",
    defaultSpecification: "Main switch unit for utility incomer",
    unit: "No.",
    color: "#111111"
  },
  ATS: {
    symbol: "ATS",
    label: "Automatic Transfer Switch",
    description: "Automatic transfer switch for utility/generator changeover",
    category: "Distribution",
    defaultSpecification: "ATS for utility/generator changeover",
    unit: "No.",
    color: "#d76b18"
  },
  G: {
    symbol: "G",
    label: "Generator",
    description: "Standby generator, 80 kVA when specified or required",
    category: "Power generation",
    defaultSpecification: "80 kVA standby generator",
    unit: "No.",
    color: "#d76b18"
  },
  DB: {
    symbol: "DB",
    label: "Distribution Board",
    description: "Floor distribution board",
    category: "Distribution",
    defaultSpecification: "Floor DB with DIN rail MCB/RCD protection",
    unit: "No.",
    color: "#1666d8"
  },
  FL: {
    symbol: "FL",
    label: "Fluorescent Light",
    description: "Default fluorescent lighting fixture",
    category: "Lighting",
    defaultSpecification: "220-230V fluorescent light fixture",
    unit: "No.",
    color: "#1557d6"
  },
  EL: {
    symbol: "EL",
    label: "Emergency Light",
    description: "Emergency light on escape route",
    category: "Emergency lighting",
    defaultSpecification: "Emergency luminaire with battery backup",
    unit: "No.",
    color: "#e32020"
  },
  SW: {
    symbol: "SW",
    label: "Switch",
    description: "Manual wall switch",
    category: "Lighting controls",
    defaultSpecification: "220-230V manual wall switch",
    unit: "No.",
    color: "#008b4a"
  },
  SO: {
    symbol: "SO",
    label: "Socket Outlet",
    description: "220-230V earthed socket outlet",
    category: "Power",
    defaultSpecification: "220-230V earthed socket outlet",
    unit: "No.",
    color: "#6a38b1"
  },
  FA: {
    symbol: "FA",
    label: "Fire Alarm Device",
    description: "Fire alarm point or detector",
    category: "Fire alarm",
    defaultSpecification: "Fire alarm device or detector",
    unit: "No.",
    color: "#e32020"
  },
  "CCTV/DATA": {
    symbol: "CCTV/DATA",
    label: "CCTV or Data Point",
    description: "Low-current CCTV or data point",
    category: "Low current",
    defaultSpecification: "CCTV/data point with low-current containment",
    unit: "No.",
    color: "#555555"
  },
  AC: {
    symbol: "AC",
    label: "Air Conditioner",
    description: "Split or packaged air-conditioning load point",
    category: "Mechanical power",
    defaultSpecification: "Dedicated AC supply point with local isolator, rating to be verified",
    unit: "No.",
    color: "#0f766e"
  },
  EF: {
    symbol: "EF",
    label: "Extractor Fan",
    description: "Ventilation or extractor fan point",
    category: "Mechanical power",
    defaultSpecification: "Extractor fan point with local control/isolator",
    unit: "No.",
    color: "#4b5563"
  },
  WH: {
    symbol: "WH",
    label: "Water Heater",
    description: "Electric water heater load point",
    category: "Power",
    defaultSpecification: "Dedicated water-heater circuit with local isolator",
    unit: "No.",
    color: "#0ea5e9"
  },
  PUMP: {
    symbol: "PUMP",
    label: "Pump",
    description: "Water, sump, or booster pump load point",
    category: "Mechanical power",
    defaultSpecification: "Dedicated pump supply with starter/protection as required",
    unit: "No.",
    color: "#2563eb"
  },
  COOKER: {
    symbol: "COOKER",
    label: "Cooker",
    description: "Dedicated cooker or kitchen equipment point",
    category: "Power",
    defaultSpecification: "Dedicated cooker control unit and final connection point",
    unit: "No.",
    color: "#b45309"
  },
  EV: {
    symbol: "EV",
    label: "EV Charger",
    description: "Dedicated electric vehicle charging point",
    category: "EV charging",
    defaultSpecification: "EV charger point with dedicated protection and load management verification",
    unit: "No.",
    color: "#16a34a"
  },
  LIFT: {
    symbol: "LIFT",
    label: "Lift",
    description: "Lift or elevator electrical supply point",
    category: "Vertical transport",
    defaultSpecification: "Lift feeder and isolator, final rating by lift vendor",
    unit: "No.",
    color: "#7c3aed"
  },
  MACHINE: {
    symbol: "MACHINE",
    label: "Machine Load",
    description: "Dedicated machinery or industrial equipment supply",
    category: "Industrial power",
    defaultSpecification: "Dedicated machinery circuit, protection and cable size by final load schedule",
    unit: "No.",
    color: "#be123c"
  },
  EQUIP: {
    symbol: "EQUIP",
    label: "Equipment Point",
    description: "Generic dedicated electrical equipment point",
    category: "Power",
    defaultSpecification: "Dedicated equipment point, final load to be verified",
    unit: "No.",
    color: "#64748b"
  }
};

export function isKnownSymbol(value: string): value is SymbolCode {
  return SYMBOL_CODES.includes(value as SymbolCode);
}

export function standardLegend(symbols: Iterable<string> = SYMBOL_CODES): SymbolLegendItem[] {
  const unique = new Set<string>(symbols);
  return SYMBOL_CODES.filter((symbol) => unique.has(symbol)).map((symbol) => {
    const item = SYMBOL_DICTIONARY[symbol];
    return {
      symbol,
      label: item.label,
      color: item.color,
      description: item.description
    };
  });
}

export function boqItemForSymbol(symbol: SymbolCode, quantity: number): BoqItem {
  const item = SYMBOL_DICTIONARY[symbol];
  return {
    category: item.category,
    item: item.label,
    specification: item.defaultSpecification,
    unit: item.unit,
    quantity,
    standard: symbol === "FA" ? "EBCS fire safety / IEC" : "EBCS / IEC 60364",
    notes: "Quantity generated from validated visible drawing specification"
  };
}

export function symbolPromptGuidance(symbol: SymbolCode) {
  const item = SYMBOL_DICTIONARY[symbol];
  return item.promptGuidance ?? `Use ${symbol} only where ${item.description.toLowerCase()} is required or clearly implied.`;
}

export function symbolBoqMapping(symbol: SymbolCode) {
  const item = SYMBOL_DICTIONARY[symbol];
  return item.boqMapping ?? item.label;
}

export function symbolRendererShape(symbol: SymbolCode) {
  const item = SYMBOL_DICTIONARY[symbol];
  if (item.rendererShape) return item.rendererShape;
  if (symbol === "FL") return "rounded luminaire rectangle";
  if (symbol === "EL") return "emergency triangle";
  if (symbol === "SO") return "socket rectangle";
  if (symbol === "G") return "generator circle";
  if (symbol === "CCTV/DATA") return "data camera tag";
  return "labeled equipment tag";
}
