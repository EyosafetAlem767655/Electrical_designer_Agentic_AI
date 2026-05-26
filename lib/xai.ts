import { ELECTRICAL_SYSTEM_PROMPT } from "@/lib/constants";
import { getEnv, requireEnv } from "@/lib/env";
import type { BoqItem, DesignAnnotation, SymbolLegendItem } from "@/types";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> };

type XaiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const DEFAULT_XAI_TIMEOUT_MS = 240_000;

function model(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

async function xaiFetch<T>(path: string, body: Record<string, unknown>, options: { timeoutMs?: number } = {}) {
  const response = await fetch(`https://api.x.ai/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_XAI_TIMEOUT_MS)
  });
  const text = await response.text();
  let payload = {} as T & { error?: { message?: string } };
  try {
    payload = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : payload;
  } catch {
    payload = {} as T & { error?: { message?: string } };
  }
  if (!response.ok) throw new Error(payload.error?.message ? `xAI request failed: ${response.status} - ${payload.error.message}` : `xAI request failed: ${response.status}`);
  return payload;
}

function firstText(payload: XaiChatResponse) {
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

function extractJson<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return fallback;
    }
  }
}

export async function chatCompletion(messages: ChatMessage[], temperature = 0.5) {
  const payload = await xaiFetch<XaiChatResponse>("chat/completions", {
    model: model("XAI_CHAT_MODEL", "grok-4.3"),
    messages,
    temperature
  });
  return firstText(payload);
}

export async function analyzeFloorPlan(imageBase64: string, context: Record<string, unknown>) {
  const imageUrl = /^https?:\/\//i.test(imageBase64) || imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;
  const response = await xaiFetch<XaiChatResponse>("chat/completions", {
    model: model("XAI_VISION_MODEL", "grok-4"),
    temperature: 0.3,
    messages: [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          {
            type: "text",
            text: `Analyze this architectural floor plan for a real-world Ethiopian/EBCS + IEC electrical installation. Return strict JSON only with keys rooms, load_assumptions, main_supply_source, lighting_plan, socket_outlet_plan, switch_plan, db_recommendation, circuit_strategy, cable_route_strategy, emergency_systems, fire_alarm_plan, data_cctv_plan, unclear_items, questions, annotations, symbol_legend, electrician_notes.

Use fluorescent lamps, manual switches, and 220-230V earthed socket outlets as defaults unless the architect explicitly changed them. Ask about the utility incomer/MSU location when unclear.

Context: ${JSON.stringify(context)}`
          }
        ]
      }
    ]
  });

  return extractJson(firstText(response), {
    rooms: [],
    load_assumptions: [],
    main_supply_source: "",
    lighting_plan: [],
    socket_outlet_plan: [],
    switch_plan: [],
    db_recommendation: "",
    circuit_strategy: "",
    cable_route_strategy: "",
    emergency_systems: [],
    fire_alarm_plan: [],
    data_cctv_plan: [],
    unclear_items: [],
    questions: ["Please confirm room purposes, main supply/MSU location, and any special equipment for this floor."],
    annotations: [],
    symbol_legend: [],
    electrician_notes: []
  });
}

export async function generateQuestions(analysis: Record<string, unknown>, context: Record<string, unknown>) {
  const text = await chatCompletion(
    [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create concise numbered clarification questions for the architect. Ask only what affects electrical design. The first required question must ask where the incoming main supply unit/source from the transformer or utility incomer is located unless already clear. Return JSON array of strings. Analysis: ${JSON.stringify(
          analysis
        )}. Context: ${JSON.stringify(context)}`
      }
    ],
    0.4
  );

  const questions = extractJson<string[]>(text, ["Please confirm room purposes, special equipment, and preferred outlet/lighting requirements."]);
  const sourceText = [
    typeof analysis.main_supply_source === "string" ? analysis.main_supply_source : "",
    typeof (context as { main_supply_source?: unknown }).main_supply_source === "string" ? String((context as { main_supply_source?: unknown }).main_supply_source) : "",
    typeof (context as { project?: { special_requirements?: unknown } }).project?.special_requirements === "string" ? String((context as { project?: { special_requirements?: unknown } }).project?.special_requirements) : ""
  ].join(" ");
  const sourceKnown = /transformer|utility incomer|incoming main|main supply.+(?:room|yard|gate|basement|ground|north|south|east|west|near|at)/i.test(sourceText);
  const asksSource = questions.some((question) => /main supply|transformer|utility incomer|incoming/i.test(question));
  return !sourceKnown && !asksSource ? ["Where is the incoming main supply unit/source from the transformer or utility incomer located for this project/floor?", ...questions] : questions;
}

export async function chatWithProjectContext(question: string, context: Record<string, unknown>) {
  return chatCompletion(
    [
      { role: "system", content: `${ELECTRICAL_SYSTEM_PROMPT}\nAnswer as Elec Nova Tech AI. Be specific and cite project/floor facts from context when available.` },
      { role: "user", content: `Project context: ${JSON.stringify(context)}\n\nQuestion: ${question}` }
    ],
    0.4
  );
}

export function fallbackAnnotations(): DesignAnnotation[] {
  return [
    { label: "DB", x: 88, y: 14, targetX: 48, targetY: 42, type: "distribution_board", description: "Recommended distribution board zone" },
    { label: "Lighting L1", x: 8, y: 18, targetX: 42, targetY: 34, type: "lighting", description: "Lighting circuit run" },
    { label: "Power P1", x: 8, y: 78, targetX: 56, targetY: 64, type: "power", description: "Power outlet circuit run" }
  ];
}

function numberInPlanBounds(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
}

export function normalizeAnnotations(value: unknown, fallback: DesignAnnotation[]) {
  if (!Array.isArray(value)) return fallback;
  const annotations = value
    .map((item, index): DesignAnnotation | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : `Note ${index + 1}`;
      return {
        label,
        x: numberInPlanBounds(record.x, 12),
        y: numberInPlanBounds(record.y, 12 + index * 8),
        targetX: numberInPlanBounds(record.targetX, 24),
        targetY: numberInPlanBounds(record.targetY, 24 + index * 8),
        type: typeof record.type === "string" && record.type.trim() ? record.type.trim() : "electrical_note",
        description: typeof record.description === "string" ? record.description : undefined
      };
    })
    .filter((item): item is DesignAnnotation => Boolean(item));
  return annotations.length ? annotations : fallback;
}

function sanitizeLegendMeaning(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .split(/[:;|]/)[0]
    .split(/\b(?:qty|quantity|count|specification|standard|notes?|schedule|rating|load)\b/i)[0]
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 42)
    .trim();
}

export function normalizeLegend(value: unknown, fallback: SymbolLegendItem[]) {
  if (!Array.isArray(value)) return fallback;
  const legend = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" && record.symbol.trim() ? record.symbol.trim() : null;
      const label = typeof record.label === "string" && record.label.trim() ? sanitizeLegendMeaning(record.label) : null;
      if (!symbol || !label) return null;
      return {
        symbol,
        label,
        color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : "#2f8178",
        description: label
      };
    })
    .filter((item): item is SymbolLegendItem => Boolean(item));
  return legend.length ? legend : fallback;
}

export function normalizeBoqItems(value: unknown, fallback: BoqItem[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item): BoqItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.item === "string" && record.item.trim() ? record.item.trim() : null;
      if (!name) return null;
      const quantity = typeof record.quantity === "number" ? record.quantity : typeof record.quantity === "string" ? Number(record.quantity) : 1;
      return {
        category: typeof record.category === "string" && record.category.trim() ? record.category.trim() : "Electrical",
        item: name,
        specification: typeof record.specification === "string" && record.specification.trim() ? record.specification.trim() : "IEC/EU compliant electrical material",
        unit: typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : "pcs",
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 100) / 100 : 1,
        standard: typeof record.standard === "string" && record.standard.trim() ? record.standard.trim() : "EBCS, IEC 60364",
        notes: typeof record.notes === "string" && record.notes.trim() ? record.notes.trim() : "Final quantity to be verified on site"
      };
    })
    .filter((item): item is BoqItem => Boolean(item));
  return items.length ? items : fallback;
}
