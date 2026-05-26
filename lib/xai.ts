import { ELECTRICAL_SYSTEM_PROMPT } from "@/lib/constants";
import { getEnv } from "@/lib/env";
import type { BoqItem, DesignAnnotation, SymbolLegendItem } from "@/types";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> };

type OpenAiResponsePayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  error?: { message?: string };
};

const OPENAI_TIMEOUT_MS = 240_000;
const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function requireOpenAiKey() {
  const key = getEnv("OPENAI_API_KEY") ?? getEnv("OPEN_AI_KEY");
  if (!key) throw new Error("Missing required environment variable: OPENAI_API_KEY or OPEN_AI_KEY");
  return key;
}

function model(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

function outputText(payload: OpenAiResponsePayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim() ?? "";
}

async function openAiResponses(body: Record<string, unknown>, label: string) {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireOpenAiKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
    });
    const text = await response.text();
    let payload: OpenAiResponsePayload = {};
    try {
      payload = text ? (JSON.parse(text) as OpenAiResponsePayload) : {};
    } catch {
      payload = {};
    }
    if (response.ok) return outputText(payload);
    lastError = payload.error?.message ?? text;
    if (!RETRY_STATUSES.has(response.status) || attempt === 2) throw new Error(`${label} failed: ${response.status} - ${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw new Error(`${label} failed: ${lastError}`);
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

function toOpenAiContent(content: ChatMessage["content"]) {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  return content.map((item) => {
    if (item.type === "image_url") {
      const image = item.image_url as { url?: string; detail?: string };
      return { type: "input_image", image_url: image.url, detail: image.detail ?? "high" };
    }
    if (item.type === "text") return { type: "input_text", text: String(item.text ?? "") };
    return { type: "input_text", text: JSON.stringify(item) };
  });
}

export async function chatCompletion(messages: ChatMessage[], temperature = 0.5) {
  const input = messages.map((message) => ({
    role: message.role,
    content: toOpenAiContent(message.content)
  }));
  return openAiResponses(
    {
      model: model("OPENAI_ANALYSIS_MODEL", model("OPENAI_DESIGN_MODEL", "gpt-5.5")),
      reasoning: { effort: "medium" },
      temperature,
      text: { verbosity: "medium" },
      input
    },
    "OpenAI analysis chat"
  );
}

export async function analyzeFloorPlan(imageBase64: string, context: Record<string, unknown>) {
  const imageUrl = /^https?:\/\//i.test(imageBase64) || imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;
  const response = await openAiResponses(
    {
      model: model("OPENAI_ANALYSIS_MODEL", model("OPENAI_DESIGN_MODEL", "gpt-5.5")),
      reasoning: { effort: "high" },
      text: {
        verbosity: "low",
        format: { type: "json_object" }
      },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: ELECTRICAL_SYSTEM_PROMPT }]
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: imageUrl, detail: "high" },
            {
              type: "input_text",
              text: `Analyze this architectural floor plan for Ethiopian/EBCS + IEC electrical installation. Return JSON only with keys rooms, load_assumptions, main_supply_source, lighting_plan, socket_outlet_plan, switch_plan, db_recommendation, circuit_strategy, cable_route_strategy, emergency_systems, fire_alarm_plan, data_cctv_plan, unclear_items, questions, annotations, symbol_legend, electrician_notes.

Use fluorescent lamps, manual switches, and 220-230V earthed socket outlets as defaults unless explicitly changed. Ask about the utility incomer/MSU location when unclear.

Context: ${JSON.stringify(context)}`
            }
          ]
        }
      ]
    },
    "OpenAI floor-plan analysis"
  );

  return extractJson(response, {
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
