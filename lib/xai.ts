import { DESIGN_PROMPT_RULES, ELECTRICAL_SYSTEM_PROMPT } from "@/lib/constants";
import { getEnv, requireEnv } from "@/lib/env";
import type { DesignAnnotation, SymbolLegendItem } from "@/types";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> };

type XaiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function model(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

async function xaiFetch<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.x.ai/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {} as T & { error?: { message?: string } };
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: { message?: string } };
    } catch {
      payload = {} as T & { error?: { message?: string } };
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `xAI request failed: ${response.status} - ${message}` : `xAI request failed: ${response.status}`);
  }

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
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
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
            text: `Analyze this architectural floor plan for electrical design. Return strict JSON with keys rooms, load_assumptions, db_recommendation, circuit_strategy, emergency_systems, unclear_items, questions, annotations, symbol_legend. Context: ${JSON.stringify(context)}`
          }
        ]
      }
    ]
  });

  return extractJson(firstText(response), {
    rooms: [],
    load_assumptions: [],
    db_recommendation: "",
    circuit_strategy: "",
    emergency_systems: [],
    unclear_items: [],
    questions: ["Please confirm the room purposes and any special equipment for this floor."],
    annotations: [],
    symbol_legend: []
  });
}

export async function generateQuestions(analysis: Record<string, unknown>, context: Record<string, unknown>) {
  const text = await chatCompletion(
    [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create concise numbered clarification questions for the architect. Ask only what affects electrical design. Return JSON array of strings. Analysis: ${JSON.stringify(
          analysis
        )}. Context: ${JSON.stringify(context)}`
      }
    ],
    0.4
  );

  return extractJson<string[]>(text, ["Please confirm room purposes, special equipment, and preferred outlet/lighting requirements."]);
}

export async function generateDesignImage(context: {
  projectName: string;
  projectCode: string;
  floorName: string;
  floorNumber: number;
  buildingPurpose?: string | null;
  companyName?: string | null;
  revision: number;
  sourceImageUrl?: string | null;
  requirements: Record<string, unknown>;
}) {
  const prompt = `${context.sourceImageUrl ? "Edit the provided architectural floor-plan image. Preserve the original plan geometry, walls, doors, room labels, dimensions, and scale. Draw the electrical design directly on top of this same plan." : "Create a professional electrical installation design drawing for this architectural plan."}

Project: ${context.projectName}
Floor: ${context.floorName}
Drawing No: ENT-${context.projectCode}-E-${context.floorNumber}
Company: Elec Nova Tech
Revision: ${context.revision}

${DESIGN_PROMPT_RULES}

Overlay requirements:
- Keep the original architectural image as the base layer.
- Add electrical symbols, circuit routes, distribution board location, lighting points, switches, sockets, emergency lighting, fire alarm points, data/CCTV where applicable, and clear labels.
- Use clean drafting-style colored overlays that remain legible against the source plan.
- Do not invent a different building layout or redraw the architecture from scratch.

Specific requirements and analysis:
${JSON.stringify(context.requirements, null, 2)}`;

  const modelName = model("XAI_IMAGE_MODEL", "grok-imagine-image-quality");
  const payload = context.sourceImageUrl
    ? await xaiFetch<{ data?: Array<{ url?: string; b64_json?: string }> }>("images/edits", {
        model: modelName,
        prompt,
        image: {
          url: context.sourceImageUrl,
          type: "image_url"
        }
      })
    : await xaiFetch<{ data?: Array<{ url?: string; b64_json?: string }> }>("images/generations", {
        model: modelName,
        prompt
      });

  const image = payload.data?.[0];
  if (!image?.url && !image?.b64_json) {
    throw new Error("xAI image generation returned no image");
  }

  return image;
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
      } satisfies DesignAnnotation;
    })
    .filter((item): item is DesignAnnotation => Boolean(item));

  return annotations.length ? annotations : fallback;
}

export function normalizeLegend(value: unknown, fallback: SymbolLegendItem[]) {
  if (!Array.isArray(value)) return fallback;
  const legend = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" && record.symbol.trim() ? record.symbol.trim() : null;
      const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : null;
      if (!symbol || !label) return null;
      return {
        symbol,
        label,
        color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : "#2f8178",
        description: typeof record.description === "string" && record.description.trim() ? record.description.trim() : "Electrical design symbol"
      } satisfies SymbolLegendItem;
    })
    .filter((item): item is SymbolLegendItem => Boolean(item));

  return legend.length ? legend : fallback;
}
