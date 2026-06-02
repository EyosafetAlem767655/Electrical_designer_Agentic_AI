from dataclasses import dataclass

SYMBOL_CODES = [
    "MSU", "ATS", "G", "DB", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA",
    "AC", "EF", "WH", "PUMP", "COOKER", "EV", "LIFT", "MACHINE", "EQUIP",
]


@dataclass(frozen=True)
class SymbolDefinition:
    symbol: str
    label: str
    description: str
    category: str
    default_specification: str
    unit: str
    color: str
    prompt_guidance: str = ""
    boq_mapping: str = ""
    renderer_shape: str = ""


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
    "AC": SymbolDefinition("AC", "Air Conditioner", "Split or packaged air-conditioning load point",
                           "Mechanical power", "Dedicated AC supply point with local isolator, rating to be verified", "No.", "#0f766e"),
    "EF": SymbolDefinition("EF", "Extractor Fan", "Ventilation or extractor fan point",
                           "Mechanical power", "Extractor fan point with local control/isolator", "No.", "#4b5563"),
    "WH": SymbolDefinition("WH", "Water Heater", "Electric water heater load point",
                           "Power", "Dedicated water-heater circuit with local isolator", "No.", "#0ea5e9"),
    "PUMP": SymbolDefinition("PUMP", "Pump", "Water, sump, or booster pump load point",
                             "Mechanical power", "Dedicated pump supply with starter/protection as required", "No.", "#2563eb"),
    "COOKER": SymbolDefinition("COOKER", "Cooker", "Dedicated cooker or kitchen equipment point",
                               "Power", "Dedicated cooker control unit and final connection point", "No.", "#b45309"),
    "EV": SymbolDefinition("EV", "EV Charger", "Dedicated electric vehicle charging point",
                           "EV charging", "EV charger point with dedicated protection and load management verification", "No.", "#16a34a"),
    "LIFT": SymbolDefinition("LIFT", "Lift", "Lift or elevator electrical supply point",
                             "Vertical transport", "Lift feeder and isolator, final rating by lift vendor", "No.", "#7c3aed"),
    "MACHINE": SymbolDefinition("MACHINE", "Machine Load", "Dedicated machinery or industrial equipment supply",
                                "Industrial power", "Dedicated machinery circuit, protection and cable size by final load schedule", "No.", "#be123c"),
    "EQUIP": SymbolDefinition("EQUIP", "Equipment Point", "Generic dedicated electrical equipment point",
                              "Power", "Dedicated equipment point, final load to be verified", "No.", "#64748b"),
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


def prompt_guidance_for_symbol(symbol: str) -> str:
    item = SYMBOL_DICTIONARY[symbol]
    return item.prompt_guidance or f"Use {symbol} only where {item.description.lower()} is required or clearly implied."


def boq_mapping_for_symbol(symbol: str) -> str:
    item = SYMBOL_DICTIONARY[symbol]
    return item.boq_mapping or item.label


def renderer_shape_for_symbol(symbol: str) -> str:
    item = SYMBOL_DICTIONARY[symbol]
    if item.renderer_shape:
        return item.renderer_shape
    if symbol == "FL":
        return "rounded luminaire rectangle"
    if symbol == "EL":
        return "emergency triangle"
    if symbol == "SO":
        return "socket rectangle"
    if symbol == "G":
        return "generator circle"
    if symbol == "CCTV/DATA":
        return "data camera tag"
    return "labeled equipment tag"
