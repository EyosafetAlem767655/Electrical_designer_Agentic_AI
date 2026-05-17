import { DESIGN_PROMPT_RULES, ELECTRICAL_SYSTEM_PROMPT } from "@/lib/constants";
import { getEnv, requireEnv } from "@/lib/env";
import type { BoqItem, DesignAnnotation, SymbolLegendItem } from "@/types";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> };

type XaiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const IMAGE_PROMPT_LIMIT = 8000;
const IMAGE_PROMPT_TARGET = 7200;

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

function limitText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 16)}... [truncated]`;
}

function compactList(value: unknown, maxItems = 8) {
  if (!Array.isArray(value)) return value ?? [];
  return value.slice(0, maxItems);
}

function compactRequirements(requirements: Record<string, unknown>) {
  const analysis = (requirements.ai_analysis && typeof requirements.ai_analysis === "object" ? requirements.ai_analysis : {}) as Record<string, unknown>;
  return {
    special_requirements: limitText(requirements.special_requirements, 700),
    architect_answers: limitText(requirements.architect_answers, 900),
    improvement_request: limitText(requirements.improvement_request, 700),
    rooms: compactList(analysis.rooms, 20),
    load_assumptions: compactList(analysis.load_assumptions),
    lighting_plan: compactList(analysis.lighting_plan, 20),
    socket_outlet_plan: compactList(analysis.socket_outlet_plan, 20),
    switch_plan: compactList(analysis.switch_plan, 20),
    db_recommendation: limitText(analysis.db_recommendation, 500),
    circuit_strategy: limitText(analysis.circuit_strategy, 900),
    cable_route_strategy: limitText(analysis.cable_route_strategy, 900),
    emergency_systems: compactList(analysis.emergency_systems),
    fire_alarm_plan: compactList(analysis.fire_alarm_plan),
    data_cctv_plan: compactList(analysis.data_cctv_plan),
    unclear_items: compactList(analysis.unclear_items),
    electrician_notes: compactList(analysis.electrician_notes, 10)
  };
}

function clampPrompt(prompt: string) {
  if (prompt.length <= IMAGE_PROMPT_LIMIT) return prompt;
  return `${prompt.slice(0, IMAGE_PROMPT_TARGET)}\n\n[Context truncated to stay within xAI image prompt limit. Preserve full engineering intent: practical lighting in every room/section, socket outlets in usable rooms, clear switches, DB, circuit numbers, wiring routes, legend, and readable labels.]`;
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
            text: `Analyze this architectural floor plan for a real-world electrical installation design. Do a careful engineering checklist before answering, then return strict JSON only. The JSON must include keys rooms, load_assumptions, lighting_plan, socket_outlet_plan, switch_plan, db_recommendation, circuit_strategy, cable_route_strategy, emergency_systems, fire_alarm_plan, data_cctv_plan, unclear_items, questions, annotations, symbol_legend, electrician_notes.

Requirements:
- Identify every room, corridor, stair, lobby, service room, wet area, and usable section.
- Ensure every room and section receives appropriate lighting coverage.
- Ensure every habitable or working room receives practical socket outlet coverage.
- Recommend switch positions near entrances.
- Recommend cable routes that electricians can understand and install.
- List any assumptions where the plan is unclear.

Context: ${JSON.stringify(context)}`
          }
        ]
      }
    ]
  });

  return extractJson(firstText(response), {
    rooms: [],
    load_assumptions: [],
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
    questions: ["Please confirm the room purposes and any special equipment for this floor."],
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
        content: `Create concise numbered clarification questions for the architect. Ask only what affects electrical design. Return JSON array of strings. Analysis: ${JSON.stringify(
          analysis
        )}. Context: ${JSON.stringify(context)}`
      }
    ],
    0.4
  );

  return extractJson<string[]>(text, ["Please confirm room purposes, special equipment, and preferred outlet/lighting requirements."]);
}

export async function generateBoqItems(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  designPlan?: string;
  requirements: Record<string, unknown>;
}) {
  const requirements = compactRequirements(context.requirements);
  const text = await chatCompletion(
    [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create a floor-level Bill of Quantity for this Ethiopian/IEC electrical design. Return strict JSON array only. Every item must have category, item, specification, unit, quantity, standard, and notes.

Rules:
- Use Ethiopian/EBCS and IEC/EU standards, not US/NEC standards.
- Use 220-230V single-phase, 380-400V three-phase, 50Hz assumptions.
- Use mm2 copper cable sizes, DIN-rail protection devices, PVC conduit/trunking, IP-rated fittings where needed, Type F/Schuko-style earthed socket outlets where appropriate.
- Include lighting fixtures for every room/section, switches, socket outlets, DB/protection devices, wiring, conduits, junction boxes, emergency lighting, fire alarm, data/CCTV where applicable.
- Quantities may be engineering estimates from the plan and must be practical for procurement, with notes saying final quantity is site-verified.
- Avoid US terms like AWG, NEMA, 120V, 240V split phase, or NEC.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Design plan: ${limitText(context.designPlan, 1600)}
Compacted requirements: ${JSON.stringify(requirements)}`
      }
    ],
    0.2
  );

  return normalizeBoqItems(extractJson<unknown>(text, []), fallbackBoqItems());
}

async function createDesignPlan(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  requirements: Record<string, unknown>;
}) {
  const requirements = compactRequirements(context.requirements);
  return chatCompletion(
    [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Prepare the final electrician-facing electrical drawing plan before image generation. Be concise but complete. Do not include hidden chain-of-thought. Return a practical checklist with:
- room-by-room lighting coverage
- socket outlet coverage
- switch locations
- DB location and circuit grouping
- clear wiring/cable route plan
- emergency lighting, fire alarm, data/CCTV where applicable
- any real-world assumptions used

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${JSON.stringify(requirements)}`
      }
    ],
    0.2
  );
}

function imageInputFromResult(image: { url?: string; b64_json?: string }) {
  if (image.url) return image.url;
  if (image.b64_json) return `data:image/png;base64,${image.b64_json}`;
  throw new Error("xAI image generation returned no image");
}

async function improveDesignTextReadability(image: { url?: string; b64_json?: string }, context: { projectName: string; floorName: string; revision: number }) {
  const payload = await xaiFetch<{ data?: Array<{ url?: string; b64_json?: string }> }>("images/edits", {
    model: model("XAI_IMAGE_MODEL", "grok-imagine-image-quality"),
    prompt: `Edit this completed electrical design drawing to improve text and label readability only.

Preserve the architectural plan, electrical symbols, DB location, lighting points, socket outlets, wiring routes, circuit groupings, and all engineering intent.
Re-render blurry, distorted, tiny, or unreadable labels as crisp high-contrast technical labels.
Make circuit numbers, DB labels, legend text, title block text, room-facing callouts, and leader-line labels readable to electricians.
Do not remove lighting or socket outlets. Do not simplify wiring. Do not change the building layout.

Project: ${context.projectName}
Floor: ${context.floorName}
Revision: ${context.revision}`,
    image: {
      url: imageInputFromResult(image),
      type: "image_url"
    }
  });

  const improved = payload.data?.[0];
  if (!improved?.url && !improved?.b64_json) {
    throw new Error("xAI text readability pass returned no image");
  }
  return improved;
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
  const compactedRequirements = compactRequirements(context.requirements);
  const designPlan = await createDesignPlan({
    projectName: context.projectName,
    floorName: context.floorName,
    buildingPurpose: context.buildingPurpose,
    requirements: compactedRequirements
  });
  const prompt = clampPrompt(`${context.sourceImageUrl ? "Edit the provided architectural floor-plan image. Preserve the original plan geometry, walls, doors, room labels, dimensions, and scale. Draw the electrical design directly on top of this same plan." : "Create a professional electrical installation design drawing for this architectural plan."}

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
- Put lighting points in every room and section, with switch control near entrances.
- Put socket outlets in every habitable/working room and practical locations for real use.
- Make wiring routes and circuit numbers obvious enough for electricians to follow.
- Do not invent a different building layout or redraw the architecture from scratch.

Prepared engineering drawing plan:
${limitText(designPlan, 1800)}

Compacted requirements and analysis:
${limitText(compactedRequirements, 2200)}`);

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

  const firstPassImage = payload.data?.[0];
  if (!firstPassImage?.url && !firstPassImage?.b64_json) {
    throw new Error("xAI image generation returned no image");
  }

  return improveDesignTextReadability(firstPassImage, {
    projectName: context.projectName,
    floorName: context.floorName,
    revision: context.revision
  });
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

export function fallbackBoqItems(): BoqItem[] {
  return [
    { category: "Lighting", item: "LED luminaire", specification: "230V AC LED fitting, IEC/EU compliant", unit: "pcs", quantity: 1, standard: "EBCS, IEC 60598", notes: "Quantity to be expanded per room lighting layout and verified on site" },
    { category: "Power", item: "Earthed socket outlet", specification: "230V, 16A, Type F/Schuko-style outlet with earth", unit: "pcs", quantity: 1, standard: "IEC 60884, EBCS", notes: "Final location and count by approved layout" },
    { category: "Wiring", item: "Copper conductors in PVC conduit", specification: "IEC copper conductors in PVC conduit/trunking, mm2 sizing by circuit load", unit: "m", quantity: 1, standard: "IEC 60227, IEC 60364", notes: "Route length to be verified on site" }
  ];
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
