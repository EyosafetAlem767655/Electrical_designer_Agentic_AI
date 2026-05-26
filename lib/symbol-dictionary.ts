import type { BoqItem, SymbolLegendItem } from "@/types";

export const SYMBOL_CODES = ["MSU", "ATS", "G", "DB", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA"] as const;

export type SymbolCode = (typeof SYMBOL_CODES)[number];

export type SymbolDefinition = {
  symbol: SymbolCode;
  label: string;
  description: string;
  category: string;
  defaultSpecification: string;
  unit: string;
  color: string;
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
