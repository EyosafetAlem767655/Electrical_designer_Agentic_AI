import { DESIGN_PROMPT_RULES, ELECTRICAL_SYSTEM_PROMPT } from "@/lib/constants";
import { getEnv, requireEnv } from "@/lib/env";
import { reviewDesignPlanWithOpenAI } from "@/lib/openai";
import type { BoqItem, DesignAnnotation, SymbolLegendItem } from "@/types";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> };

type XaiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type DesignVisualQaResult = {
  approved: boolean;
  score: number;
  missing_defaults: string[];
  coverage_issues: string[];
  drawing_issues: string[];
  correction_prompt: string;
};

const IMAGE_PROMPT_LIMIT = 8000;
const IMAGE_PROMPT_TARGET = 7200;
const DEFAULT_XAI_TIMEOUT_MS = 240_000;
const READABILITY_PASS_TIMEOUT_MS = 45_000;

function model(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

async function xaiFetch<T>(path: string, body: Record<string, unknown>, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_XAI_TIMEOUT_MS;
  const response = await fetch(`https://api.x.ai/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
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

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function normalizeQaResult(value: unknown): DesignVisualQaResult {
  if (!value || typeof value !== "object") {
    return {
      approved: false,
      score: 0,
      missing_defaults: ["Visual QA did not return valid JSON"],
      coverage_issues: [],
      drawing_issues: ["Malformed visual QA response"],
      correction_prompt: "Rebuild the electrical overlay with complete fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/circuit identifiers, and readable routes in every applicable room and usable zone. Do not add an in-image legend or long text."
    };
  }
  const record = value as Record<string, unknown>;
  const score = typeof record.score === "number" ? record.score : typeof record.score === "string" ? Number(record.score) : 0;
  const missingDefaults = normalizeStringArray(record.missing_defaults);
  const coverageIssues = normalizeStringArray(record.coverage_issues);
  const drawingIssues = normalizeStringArray(record.drawing_issues);
  const correctionPrompt =
    typeof record.correction_prompt === "string" && record.correction_prompt.trim()
      ? record.correction_prompt.trim()
      : "Correct the electrical overlay so every applicable room and usable zone has fluorescent lamp fixtures, manual switch control, 220-230V earthed socket outlets, DB/circuit identifiers, and electrician-readable wiring routes. Do not add an in-image legend or long text.";
  return {
    approved: record.approved === true && missingDefaults.length === 0 && coverageIssues.length === 0 && drawingIssues.length === 0,
    score: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
    missing_defaults: missingDefaults,
    coverage_issues: coverageIssues,
    drawing_issues: drawingIssues,
    correction_prompt: correctionPrompt
  };
}

function clampPrompt(prompt: string) {
  if (prompt.length <= IMAGE_PROMPT_LIMIT) return prompt;
  return `${prompt.slice(0, IMAGE_PROMPT_TARGET)}\n\n[Context truncated to stay within xAI image prompt limit. Preserve the original architectural floor plan exactly: do not alter walls, doors, windows, stairs, columns, room boundaries, grid lines, dimensions, room labels, parking bays, or architectural symbols. Preserve full engineering intent: practical fluorescent lamp fixtures in every room/section, manual switches near entrances, socket outlets in usable rooms, DB, complete circuit numbers, visible wiring routes, compact in-drawing labels, and legend. Do not use leader-arrow callout labels. Do not omit complete lighting, switch, and socket outlet circuits because the floor is basement, parking, roof, service, corridor, or any other non-residential area.]`;
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
- Unless the architect requested otherwise, assume fluorescent lamp fixtures, manual wall switches, and earthed socket outlets as the default Ethiopian installation devices. Use LED only if requested.
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
  finalDesignImageUrl?: string | null;
  requirements: Record<string, unknown>;
}) {
  if (!context.finalDesignImageUrl) {
    throw new Error("Final design image is required for BOQ generation");
  }
  const requirements = compactRequirements(context.requirements);
  const prompt = `Create a floor-level Bill of Quantity for this Ethiopian/IEC electrical design. Return strict JSON array only. Every item must have category, item, specification, unit, quantity, standard, and notes.

Rules:
- Use Ethiopian/EBCS and IEC/EU standards, not US/NEC standards.
- This BOQ must be unique to this exact floor and this exact final design image. Do not reuse a template, sample, fallback, or generic BOQ from another floor.
- Use 220-230V single-phase, 380-400V three-phase, 50Hz assumptions.
- Default devices are fluorescent lamp fixtures, manual wall switches, and earthed socket outlets unless the architect explicitly requested LED or another device type.
- Use LED fixtures only when requested in architect answers, special requirements, or visible design labels.
- Use mm2 copper cable sizes, DIN-rail protection devices, PVC conduit/trunking, IP-rated fittings where needed, and Type F/Schuko-style earthed socket outlets where appropriate.
- Include and count fluorescent lamp fixtures, manual switches, socket outlets, DB/protection devices, wiring, conduits, junction boxes, emergency lighting, fire alarm, data/CCTV where applicable.
- Count visible symbols and routes from the final cleaned drawing first. Count lighting points, switch points, socket outlets, DB/protection panels, emergency/fire/data devices, and visible conduit/cable route allowances from the image.
- Do not count from the legend alone. The legend only explains symbols; quantities must come from visible placements and routes in the floor drawing.
- Quantities and units must be realistic and accurate: pcs for counted devices, m for cable/conduit/trunking route lengths, set only for complete DB assemblies. Do not output placeholder quantity 1 for every row.
- Quantities must be defensible estimates from the final drawing. Count every visible fluorescent lamp, manual switch, socket outlet, DB, breaker/protection item, and low-current/fire/emergency device. Estimate cable/conduit lengths in meters from visible routes and plan scale where possible. Put "site verify final quantity" in notes where route length or exact device count is uncertain.
- If the image is not clear enough to count an item, omit that item or return an empty array rather than inventing generic quantities.
- Avoid US terms like AWG, NEMA, 120V, 240V split phase, or NEC.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Design plan: ${limitText(context.designPlan, 1600)}
Compacted requirements: ${JSON.stringify(requirements)}`;

  let lastValidationError = "Grok BOQ returned no usable counted items from the final design image";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptPrompt =
      attempt === 0
        ? prompt
        : `${prompt}

Your previous BOQ response was rejected because: ${lastValidationError}.
Re-inspect the final design image and return a corrected, image-counted BOQ only. Count visible devices/routes from this floor drawing. Do not return placeholders, all-1 quantities, generic templates, samples, fallback estimates, or legend-only quantities.`;
    const items = await requestBoqItems(context.finalDesignImageUrl, attemptPrompt, attempt === 0 ? 0.2 : 0.1);
    const validationError = validateCountedBoqItems(items);
    if (!validationError) return items;
    lastValidationError = validationError;
  }
  throw new Error(lastValidationError);
}

async function requestBoqItems(finalDesignImageUrl: string, prompt: string, temperature: number) {
  const messages: ChatMessage[] = [
    { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: finalDesignImageUrl, detail: "high" } },
        { type: "text", text: prompt }
      ]
    }
  ];

  const payload = await xaiFetch<XaiChatResponse>("chat/completions", {
    model: model("XAI_VISION_MODEL", "grok-4"),
    messages,
    temperature
  });

  const parsed = extractJson<unknown>(firstText(payload), []);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];
  const items = normalizeBoqItems(rawItems, []);
  return items;
}

function validateCountedBoqItems(items: BoqItem[]) {
  if (!items.length) return "Grok BOQ returned no usable counted items from the final design image";
  if (items.length >= 3 && items.every((item) => item.quantity <= 1)) {
    return "Grok BOQ returned placeholder quantities; refusing to store an all-1 BOQ";
  }
  if (items.some((item) => /fallback|template|generic|sample/i.test(`${item.notes ?? ""} ${item.specification}`))) {
    return "Grok BOQ returned generic/template items; refusing to store a non-counted BOQ";
  }
  return null;
}

async function createGrokDesignPlan(context: {
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
        content: `Prepare the final electrician-facing electrical drawing plan before image generation. Take time to reason through the engineering checklist internally, but do not include hidden chain-of-thought. Return a practical checklist with:
- room-by-room fluorescent lamp fixture placement for every enclosed room, corridor, stair, lobby, service room, parking bay zone, exterior/balcony zone, and usable section
- socket outlet coverage for every habitable, working, service, kitchen, office, shop, equipment, or practical-use area, including multiple outlets where real-world use requires them
- manual wall switch locations near entrances and logical switch control for every lighting group
- default device assumptions: fluorescent lamp fixtures, manual wall switches, and earthed socket outlets unless the architect explicitly requested LED or another device; do not silently substitute LED
- basement/parking completeness: fluorescent fixtures across parking bays, drive aisles, ramps, stair/lift lobbies, service rooms, storage, entrances/exits, and dark corners; manual switching/control zones at stair doors, entries, exits, and service rooms; practical earthed socket outlets at maintenance, security/attendant, DB, cleaning, and service/equipment points
- DB location and circuit grouping
- clear wiring/cable route plan with separate light, switch/control, and socket outlet circuits
- emergency lighting, fire alarm, data/CCTV where applicable
- any real-world assumptions used
- final pre-drawing completeness check that every relevant zone has FL lighting, S manual switch control, P socket outlet coverage, DB/circuit numbering, and electrician-readable wiring routes
- explicit note that no floor type is exempt from lighting, switch, socket, DB, circuit numbering, and electrician-readable wiring routes

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${JSON.stringify(requirements)}`
      }
    ],
    0.2
  );
}

async function reconcileDesignPlanWithGrok(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  requirements: Record<string, unknown>;
  grokPlan: string;
  openAiReview: Awaited<ReturnType<typeof reviewDesignPlanWithOpenAI>>;
}) {
  const requirements = compactRequirements(context.requirements);
  return chatCompletion(
    [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create the final image-generation electrical design plan by reconciling Grok's draft with OpenAI's critique. Return a compact electrician-facing plan only; do not include hidden reasoning.

The final plan must preserve Ethiopian/EBCS and IEC/EU practice, fluorescent lamp fixtures by default, manual wall switches by default, and 220-230V earthed socket outlets by default unless the architect explicitly requested otherwise. LED must not be used unless requested.

The final plan must be countable from the generated drawing for BOQ: every visible FL, S, P, DB/protection, emergency, fire, data/CCTV device and route family must have clear compact labels.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${JSON.stringify(requirements)}

Grok draft plan:
${limitText(context.grokPlan, 2200)}

OpenAI review JSON:
${JSON.stringify(context.openAiReview)}

Final plan requirements:
- Include all required changes and prompt additions from OpenAI.
- Keep room-by-room or zone-by-zone coverage specific enough for drawing.
- Explicitly mention FL fluorescent lamps, S manual switches, P 220-230V earthed socket outlets, DB/circuit labels, route labels, and BOQ-countable symbols.
- Keep labels compact and drawable.`
      }
    ],
    0.15
  );
}

async function createCollaborativeDesignPlan(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  requirements: Record<string, unknown>;
}) {
  const requirements = compactRequirements(context.requirements);
  const grokPlan = await createGrokDesignPlan({ ...context, requirements });
  const openAiReview = await reviewDesignPlanWithOpenAI({
    projectName: context.projectName,
    floorName: context.floorName,
    buildingPurpose: context.buildingPurpose,
    requirements,
    grokPlan
  });
  return reconcileDesignPlanWithGrok({
    projectName: context.projectName,
    floorName: context.floorName,
    buildingPurpose: context.buildingPurpose,
    requirements,
    grokPlan,
    openAiReview
  });
}

function imageInputFromResult(image: { url?: string; b64_json?: string }) {
  if (image.url) return image.url;
  if (image.b64_json) return `data:image/png;base64,${image.b64_json}`;
  throw new Error("xAI image generation returned no image");
}

export async function improveDesignTextReadability(image: { url?: string; b64_json?: string }, context: { projectName: string; floorName: string; revision: number }) {
  const payload = await xaiFetch<{ data?: Array<{ url?: string; b64_json?: string }> }>(
    "images/edits",
    {
      model: model("XAI_IMAGE_MODEL", "grok-imagine-image-quality"),
      prompt: `TEXT READABILITY CORRECTION ONLY. This is a preservation edit, not a redesign.

The original architectural floor plan is locked. Do not alter, redraw, restyle, crop, stretch, erase, move, or reinterpret any original wall, door, window, stair, column, grid line, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
Keep the exact same electrical design: architectural plan, walls, doors, room geometry, electrical symbols, DB location, lighting points, socket outlets, switches, wiring routes, circuit grouping, cable paths, colors, and circuit topology must stay unchanged.
Only improve blurry, distorted, tiny, or misspelled text labels.
Rewrite labels as short professional drafting labels with crisp high-contrast CAD-style text.
Use compact labels such as DB, FL1, FL2, S1, S2, P1, P2, E1, FA1, D1, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
Preserve any existing compact symbol legend location if present; only sharpen or correct its symbol-to-meaning text.
Do not create a new sheet, side panel, blank box, large border, title block, new title block area, or empty annotation rectangles.
Do not redraw the electrical design. Do not move, remove, simplify, or add circuits while fixing text.
Do not add leader-arrow callouts, side callout labels, external annotation boxes, or large text panels. Keep compact labels directly beside their electrical symbols/routes inside the drawing.
If a long label cannot be made readable, replace it with a shorter professional label rather than adding large boxes.

Project: ${context.projectName}
Floor: ${context.floorName}
Revision: ${context.revision}`,
      image: {
        url: imageInputFromResult(image),
        type: "image_url"
      }
    },
    { timeoutMs: READABILITY_PASS_TIMEOUT_MS }
  );

  const improved = payload.data?.[0];
  if (!improved?.url && !improved?.b64_json) {
    throw new Error("xAI text readability pass returned no image");
  }
  return improved;
}

export async function generateDesignDraftImage(context: {
  projectName: string;
  projectCode: string;
  floorName: string;
  floorNumber: number;
  buildingPurpose?: string | null;
  companyName?: string | null;
  revision: number;
  sourceImageUrl?: string | null;
  mode?: "new" | "revision";
  requirements: Record<string, unknown>;
}) {
  const compactedRequirements = compactRequirements(context.requirements);
  const designPlan = await createCollaborativeDesignPlan({
    projectName: context.projectName,
    floorName: context.floorName,
    buildingPurpose: context.buildingPurpose,
    requirements: compactedRequirements
  });
  const editInstruction =
    context.mode === "revision"
      ? "Edit the provided existing electrical design image as an overlay-only revision. The original architectural floor plan inside it is locked reference geometry and must not change. Preserve the current architecture, walls, doors, room labels, dimensions, stairs, columns, parking bays, symbols, circuit routes, DB position, lighting points, switches, socket outlets, and cable topology unless the revision request explicitly asks for an electrical overlay change. Apply the requested revision on top of this existing generated design."
      : context.sourceImageUrl
        ? "Edit the provided architectural floor-plan image as locked reference geometry. Preserve the original floor plan exactly: walls, doors, windows, stairs, columns, grid lines, room boundaries, parking bays, room labels, dimensions, scale, title text, and architectural symbols must not change. Draw the electrical design only as an overlay directly on top of this same plan."
        : "Create a professional electrical installation design drawing for this architectural plan.";
  const prompt = clampPrompt(`${editInstruction}

Project: ${context.projectName}
Floor: ${context.floorName}
Drawing No: ENT-${context.projectCode}-E-${context.floorNumber}
Company: Elec Nova Tech
Revision: ${context.revision}

Prepared engineering drawing plan:
${limitText(designPlan, 1200)}

Compacted requirements and analysis:
${limitText(compactedRequirements, 1400)}

${DESIGN_PROMPT_RULES}

Overlay requirements:
- Keep the original architectural image as the base layer.
- Do not modify the base layer. Do not change any architectural geometry, room layout, wall thickness, door swing, stair, column, parking bay, grid, dimension, room label, or title text from the supplied floor plan.
- Do not fade, white out, clean up, redraw, simplify, crop, or remove original architectural linework, labels, grid bubbles, parking bay markings, ramp/stair graphics, room names, or boundary lines.
- The source floor plan must still be recognizable pixel-for-pixel as the same drawing after editing. If there is any conflict between improving the overlay and preserving the original plan, preserve the original plan.
- Only add electrical overlay content: symbols, routes, compact in-drawing circuit labels, DB marks, legends, and electrical notes.
- Add electrical symbols, circuit routes, distribution board location, lighting points, switches, socket outlets, emergency lighting, fire alarm points, data/CCTV where applicable.
- Use fluorescent lamp fixtures as the default lighting points, manual wall switches as the default switching/control points, and earthed socket outlets as the default outlet points. Use LED fixtures only if the architect requested LED. Do not omit FL, S, or P devices from applicable rooms.
- Use clean drafting-style colored overlays that remain legible against the source plan.
- Draw circuit routes with an outlined drafting style: white halo/outline below the colored route, then colored route on top, so circuits remain readable over any background.
- Put fluorescent lamp lighting points in every room, corridor, stair, lobby, service room, exterior/balcony zone, parking bay zone, and usable section, with manual switch control near entrances.
- Put socket outlets in every habitable/working room and in practical service/equipment/kitchen/office/shop locations for real use.
- For basement/parking designs, add enough fluorescent fixtures to cover drive aisles, parking rows, ramps, corners, stair/lift lobbies, service rooms, exits, and fuel/generator/storage areas; add emergency lights on egress paths; add wall/manual switches at access points; add earthed socket outlets at DB/maintenance/security/service/cleaning points rather than leaving large areas without outlets.
- Draw complete separate circuits for lighting, switch/control runs, and socket outlets. Label each circuit number and show the route back to the DB.
- No floor type is exempt. Basements, parking, roofs, service floors, corridors, and utility areas still need appropriate lighting, switches, sockets where practical, DB/circuit logic, and visible wiring routes.
- Make wiring routes and circuit numbers obvious enough for electricians to follow without guessing.
- For revisions, preserve already-correct parts of the existing generated design. Do not restart from the original architectural image. Do not remove existing circuits, outlets, lights, switches, DBs, or labels unless the revision request explicitly says so.
- Text must be professional and readable in the generated image itself: crisp CAD-style lettering, high contrast, aligned horizontally, no pseudo-text, no random scribbles, no misspelled fake labels.
- Use short standardized labels instead of paragraphs: DB, FL1/FL2 fluorescent lighting, S1/S2 manual switches, P1/P2 socket outlets, E1 emergency, FA1 fire alarm, D1 data/CCTV, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
- Do not use leader-arrow callout text, side annotation labels, external label boxes, or large text panels. Put compact labels directly beside the relevant symbol or route inside the drawing area, without covering important architecture.
- Keep any legend compact and inside available margins of the original plan. The legend must only explain symbols and must not include quantities, specifications, schedules, title-block data, notes, or paragraphs. Do not add a separate side panel, blank right-hand box, decorative sheet border, title block, or large empty annotation boxes.
- Do not invent a different building layout or redraw the architecture from scratch.`);

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

  return firstPassImage;
}

export async function generateDesignCorrectionDraftImage(context: {
  projectName: string;
  projectCode: string;
  floorName: string;
  floorNumber: number;
  buildingPurpose?: string | null;
  revision: number;
  sourceImageUrl: string;
  correctionPrompt: string;
  requirements: Record<string, unknown>;
}) {
  const compactedRequirements = compactRequirements(context.requirements);
  const prompt = clampPrompt(`Edit the provided generated electrical design image as a correction pass. Preserve the architectural base plan exactly and preserve all already-correct electrical overlay content.

Project: ${context.projectName}
Floor: ${context.floorName}
Drawing No: ENT-${context.projectCode}-E-${context.floorNumber}
Revision: ${context.revision}
Building purpose: ${context.buildingPurpose ?? "not specified"}

Grok visual QA correction required:
${limitText(context.correctionPrompt, 1100)}

Compacted requirements and analysis:
${limitText(compactedRequirements, 1200)}

${DESIGN_PROMPT_RULES}

Correction rules:
- Do not re-run or redesign the whole drawing. Apply only the QA correction and any directly required electrical overlay additions.
- Keep the original architectural plan locked: do not alter walls, doors, windows, stairs, columns, dimensions, room labels, parking bays, title text, or architectural symbols.
- Ensure every applicable room and usable zone has FL fluorescent lamp fixtures, S manual switch control, and P 220-230V earthed socket outlets unless explicitly overridden.
- Add or repair DB/protection labels, circuit numbers, and electrician-readable routes back to the DB.
- Keep all labels compact and BOQ-countable: FL, S, P, DB, E, FA, D, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
- Do not use LED unless the architect explicitly requested LED.
- Do not add side panels, leader-arrow callouts, large note boxes, title-block expansions, or decorative borders.`);

  const payload = await xaiFetch<{ data?: Array<{ url?: string; b64_json?: string }> }>("images/edits", {
    model: model("XAI_IMAGE_MODEL", "grok-imagine-image-quality"),
    prompt,
    image: {
      url: context.sourceImageUrl,
      type: "image_url"
    }
  });

  const corrected = payload.data?.[0];
  if (!corrected?.url && !corrected?.b64_json) {
    throw new Error("xAI correction image generation returned no image");
  }
  return corrected;
}

export async function evaluateFinalDesignImageWithGrok(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  finalDesignImageUrl: string;
  requirements: Record<string, unknown>;
}) {
  const requirements = compactRequirements(context.requirements);
  const payload = await xaiFetch<XaiChatResponse>("chat/completions", {
    model: model("XAI_VISION_MODEL", "grok-4"),
    temperature: 0.1,
    messages: [
      { role: "system", content: ELECTRICAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: context.finalDesignImageUrl, detail: "high" } },
          {
            type: "text",
            text: `QA-check this final cleaned electrical design image before engineering review and BOQ generation. Return strict JSON only with keys approved, score, missing_defaults, coverage_issues, drawing_issues, correction_prompt.

Reject the design if any applicable room, corridor, stair, lobby, service room, parking/drive zone, kitchen, office, shop, wet area, exterior/balcony zone, or usable section lacks practical electrical coverage.

Default requirements unless explicitly overridden:
- fluorescent lamp fixtures, not LED
- manual wall switches near entrances/control points
- 220-230V earthed socket outlets in every practical room/usable area
- DB/protection mark and clear circuit identifiers
- electrician-readable wiring routes back to DB
- symbols/routes must be countable for BOQ from visible placement, color, and simple IDs

Important text-quality rule:
- Do not reject a design merely because it lacks a drawn legend, title block, long equipment names, cable sizes, lux text, or dense FL/S/P/DB/E/FA/D labels. The dashboard renders a clean legend outside the image.
- Prefer clean symbols and routes over AI-generated text. Penalize messy fake text, large legends, note panels, or unreadable text blocks as drawing issues.
- If correction is needed, the correction_prompt must ask for symbols/routes/device placement first and must explicitly say not to add an in-image legend or long text.

Approve only when the drawing is professional, usable, and countable for BOQ. The correction_prompt must be short and directly usable as an image edit instruction if rejected.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${JSON.stringify(requirements)}`
          }
        ]
      }
    ]
  });

  return normalizeQaResult(extractJson<unknown>(firstText(payload), null));
}

export async function generateDesignImage(context: Parameters<typeof generateDesignDraftImage>[0]) {
  const draft = await generateDesignDraftImage(context);
  return improveDesignTextReadability(draft, {
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
      const label = typeof record.label === "string" && record.label.trim() ? sanitizeLegendMeaning(record.label) : null;
      if (!symbol || !label) return null;
      return {
        symbol,
        label,
        color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : "#2f8178",
        description: label
      } satisfies SymbolLegendItem;
    })
    .filter((item): item is SymbolLegendItem => Boolean(item));

  return legend.length ? legend : fallback;
}

function sanitizeLegendMeaning(value: string) {
  const withoutDetails = value
    .replace(/\([^)]*\)/g, "")
    .split(/[:;|]/)[0]
    .split(/\b(?:qty|quantity|count|specification|standard|notes?|schedule|rating|load)\b/i)[0]
    .trim()
    .replace(/\s+/g, " ");
  return withoutDetails.slice(0, 42).trim();
}

export function fallbackBoqItems(): BoqItem[] {
  return [
    { category: "Lighting", item: "Fluorescent lamp fixture", specification: "230V AC fluorescent fitting, IEC/EU compliant", unit: "pcs", quantity: 8, standard: "EBCS, IEC 60598", notes: "Fallback estimate only; final quantity must be counted from approved drawing" },
    { category: "Switching", item: "Manual wall switch", specification: "230V AC manual lighting switch, one/two-gang as required", unit: "pcs", quantity: 6, standard: "EBCS, IEC 60669", notes: "Fallback estimate only; final quantity must be counted from approved drawing" },
    { category: "Power", item: "Earthed socket outlet", specification: "230V, 16A, Type F/Schuko-style outlet with earth", unit: "pcs", quantity: 10, standard: "IEC 60884, EBCS", notes: "Fallback estimate only; final location and count by approved layout" },
    { category: "Wiring", item: "Copper conductors in PVC conduit", specification: "IEC copper conductors in PVC conduit/trunking, mm2 sizing by circuit load", unit: "m", quantity: 120, standard: "IEC 60227, IEC 60364", notes: "Fallback route allowance; verify length on site" }
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
