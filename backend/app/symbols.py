from dataclasses import dataclass

SYMBOL_CODES = ["MSU", "ATS", "G", "DB", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA"]


@dataclass(frozen=True)
class SymbolDefinition:
    symbol: str
    label: str
    description: str
    category: str
    default_specification: str
    unit: str
    color: str


SYMBOL_DICTIONARY: dict[str, SymbolDefinition] = {
    "MSU": SymbolDefinition("MSU", "Main Switch Unit", "Main incoming supply from utility or transformer",
                            "Distribution", "Main switch unit for utility incomer", "No.", "#111111"),
    "ATS": SymbolDefinition("ATS", "Automatic Transfer Switch", "Automatic transfer switch for utility/generator changeover",
                            "Distribution", "ATS for utility/generator changeover", "No.", "#d76b18"),
    "G": SymbolDefinition("G", "Generator", "Standby generator, 80 kVA when specified or required",
                          "Power generation", "80 kVA standby generator", "No.", "#d76b18"),
    "DB": SymbolDefinition("DB", "Distribution Board", "Floor distribution board",
                           "Distribution", "Floor DB with DIN rail MCB/RCD protection", "No.", "#1666d8"),
    "FL": SymbolDefinition("FL", "Fluorescent Light", "Default fluorescent lighting fixture",
                           "Lighting", "220-230V fluorescent light fixture", "No.", "#1557d6"),
    "EL": SymbolDefinition("EL", "Emergency Light", "Emergency light on escape route",
                           "Emergency lighting", "Emergency luminaire with battery backup", "No.", "#e32020"),
    "SW": SymbolDefinition("SW", "Switch", "Manual wall switch",
                           "Lighting controls", "220-230V manual wall switch", "No.", "#008b4a"),
    "SO": SymbolDefinition("SO", "Socket Outlet", "220-230V earthed socket outlet",
                           "Power", "220-230V earthed socket outlet", "No.", "#6a38b1"),
    "FA": SymbolDefinition("FA", "Fire Alarm Device", "Fire alarm point or detector",
                           "Fire alarm", "Fire alarm device or detector", "No.", "#e32020"),
    "CCTV/DATA": SymbolDefinition("CCTV/DATA", "CCTV or Data Point", "Low-current CCTV or data point",
                                  "Low current", "CCTV/data point with low-current containment", "No.", "#555555"),
}


def is_known_symbol(value: str) -> bool:
    return value in SYMBOL_DICTIONARY


def standard_legend(symbols) -> list[dict]:
    unique = set(symbols)
    return [
        {"symbol": s, "label": SYMBOL_DICTIONARY[s].label,
         "color": SYMBOL_DICTIONARY[s].color, "description": SYMBOL_DICTIONARY[s].description}
        for s in SYMBOL_CODES if s in unique
    ]


def boq_item_for_symbol(symbol: str, quantity: float) -> dict:
    item = SYMBOL_DICTIONARY[symbol]
    return {
        "category": item.category,
        "item": item.label,
        "specification": item.default_specification,
        "unit": item.unit,
        "quantity": quantity,
        "standard": "EBCS fire safety / IEC" if symbol == "FA" else "EBCS / IEC 60364",
        "notes": "Quantity generated from validated visible drawing specification",
    }
