import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/lib/env";
import type { SchematicDeviceKind, SchematicRenderPlan, SchematicRouteKind } from "@/lib/schematic-renderer";
import type { BoqItem, SymbolLegendItem } from "@/types";

type ImageResult = { url?: string; b64_json?: string; path?: string };

export type OpenAiDesignReview = {
  approved: boolean;
  required_changes: string[];
  risk_flags: string[];
  prompt_additions: string[];
};

export type OpenAiDesignQaResult = {
  approved: boolean;
  score: number;
  readability_issues: string[];
  symbol_issues: string[];
  requirement_issues: string[];
  boq_issues: string[];
  correction_prompt: string;
};

type OpenAiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
};

type OpenAiResponsesPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: { message?: string };
};

export type OpenAiDesignPackage = {
  boq_items: BoqItem[];
  symbol_legend: SymbolLegendItem[];
};

const OPENAI_TIMEOUT_MS = 240_000;
const OPENAI_RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const OPENAI_IMAGE_PROMPT_LIMIT = 32_000;
const OPENAI_IMAGE_PROMPT_TARGET = 29_500;

function openAiModel(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

function openAiImageModel() {
  const configured = getEnv("OPENAI_IMAGE_MODEL")?.trim();
  if (!configured) return "gpt-image-1.5";
  if (/^(?:gpt-image|chatgpt-image|dall-e)/i.test(configured)) return configured;
  return "gpt-image-1.5";
}

function requireOpenAiKey() {
  const key = getEnv("OPENAI_API_KEY") ?? getEnv("OPEN_AI_KEY");
  if (!key) throw new Error("Missing required environment variable: OPENAI_API_KEY or OPEN_AI_KEY");
  return key;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactErrorText(text: string) {
  const withoutHtml = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutHtml.slice(0, 260);
}

function limitText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 18)}... [truncated]`;
}

function clampOpenAiImagePrompt(prompt: string) {
  if (prompt.length <= OPENAI_IMAGE_PROMPT_LIMIT) return prompt;
  return `${prompt.slice(0, OPENAI_IMAGE_PROMPT_TARGET)}

[Context truncated to satisfy OpenAI image prompt length. Preserve the locked architectural plan. Use only standardized, legend-defined electrical tags: FL, EL, SW, SO/P, DB, MSU, G, ATS, FA, CCTV/DATA. Do not use EV/EV1 unless explicitly requested. Do not use orphan codes such as D1/D2/D3/D6, DE, EE, EF, IG, K, 9A1. Keep routes uncluttered and electrician-readable.]`;
}

function openAiErrorMessage(status: number, payload: { error?: { message?: string } }, text: string) {
  const message = payload.error?.message?.trim() || compactErrorText(text);
  return message ? `${status} - ${message}` : String(status);
}

async function openAiFetchWithRetry(url: string, init: RequestInit, label: string) {
  let lastText = "";
  let lastStatus = 0;
  let lastPayload = {} as { error?: { message?: string } };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
    });
    const text = await response.text();
    let payload = {} as { error?: { message?: string } };
    if (text) {
      try {
        payload = JSON.parse(text) as { error?: { message?: string } };
      } catch {
        payload = {};
      }
    }

    if (response.ok || !OPENAI_RETRY_STATUSES.has(response.status) || attempt === 2) {
      return { response, text, payload };
    }

    lastText = text;
    lastStatus = response.status;
    lastPayload = payload;
    await sleep(750 * (attempt + 1));
  }

  throw new Error(`${label} failed: ${openAiErrorMessage(lastStatus, lastPayload, lastText)}`);
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid data URL image input");
  const contentType = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const data = match[3] ?? "";
  return {
    buffer: Buffer.from(isBase64 ? data : decodeURIComponent(data), isBase64 ? "base64" : "utf8"),
    contentType
  };
}

async function imageToBlob(image: ImageResult) {
  if (image.b64_json) {
    return {
      blob: new Blob([Buffer.from(image.b64_json, "base64")], { type: "image/png" }),
      filename: "design.png"
    };
  }
  if (image.path) {
    const publicPath = image.path.replace(/^\/?public[\\/]/i, "").replace(/^[/\\]+/, "");
    const absolutePath = join(process.cwd(), "public", publicPath);
    const buffer = await readFile(absolutePath);
    const extension = absolutePath.toLowerCase().endsWith(".jpg") || absolutePath.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
    return {
      blob: new Blob([buffer], { type: extension === "jpg" ? "image/jpeg" : "image/png" }),
      filename: `reference.${extension}`
    };
  }
  if (!image.url) throw new Error("OpenAI image edit needs an image URL, local path, or base64 image");
  if (image.url.startsWith("data:")) {
    const { buffer, contentType } = dataUrlToBuffer(image.url);
    return {
      blob: new Blob([buffer], { type: contentType }),
      filename: contentType.includes("jpeg") || contentType.includes("jpg") ? "design.jpg" : "design.png"
    };
  }

  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Image download for OpenAI failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "image/png";
  return {
    blob: new Blob([Buffer.from(await response.arrayBuffer())], { type: contentType }),
    filename: contentType.includes("jpeg") || contentType.includes("jpg") ? "design.jpg" : "design.png"
  };
}

function extractJson<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return fallback;
    }
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function normalizeDesignReview(value: unknown): OpenAiDesignReview {
  if (!value || typeof value !== "object") {
    return {
      approved: false,
      required_changes: ["OpenAI review did not return valid JSON; require conservative Grok reconciliation before drawing."],
      risk_flags: ["Malformed OpenAI design review"],
      prompt_additions: ["Re-check all rooms for fluorescent lamp fixtures, manual switches, 220-230V earthed socket outlets, DB/circuit labels, and countable BOQ symbols."]
    };
  }
  const record = value as Record<string, unknown>;
  const requiredChanges = stringArray(record.required_changes);
  const riskFlags = stringArray(record.risk_flags);
  const promptAdditions = stringArray(record.prompt_additions);
  return {
    approved: record.approved === true && requiredChanges.length === 0,
    required_changes: requiredChanges,
    risk_flags: riskFlags,
    prompt_additions: promptAdditions
  };
}

function responseText(payload: OpenAiResponsesPayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function numberValue(value: unknown, fallback = 1) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function normalizeOpenAiBoqItems(value: unknown): BoqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): BoqItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.item === "string" && record.item.trim() ? record.item.trim() : null;
      if (!name) return null;
      return {
        category: typeof record.category === "string" && record.category.trim() ? record.category.trim() : "Electrical",
        item: name,
        specification: typeof record.specification === "string" && record.specification.trim() ? record.specification.trim() : "EBCS/IEC compliant electrical material",
        unit: typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : "pcs",
        quantity: numberValue(record.quantity),
        standard: typeof record.standard === "string" && record.standard.trim() ? record.standard.trim() : "EBCS, IEC 60364",
        notes: typeof record.notes === "string" && record.notes.trim() ? record.notes.trim() : "Site verify final quantity"
      };
    })
    .filter((item): item is BoqItem => Boolean(item));
}

function normalizeOpenAiLegend(value: unknown): SymbolLegendItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SymbolLegendItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" && record.symbol.trim() ? record.symbol.trim().slice(0, 12) : null;
      const label = typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, 48) : null;
      if (!symbol || !label) return null;
      return {
        symbol,
        label,
        color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : "#2f8178",
        description: typeof record.description === "string" && record.description.trim() ? record.description.trim().slice(0, 160) : label
      };
    })
    .filter((item): item is SymbolLegendItem => Boolean(item));
}

function normalizeOpenAiDesignPackage(value: unknown): OpenAiDesignPackage {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    boq_items: normalizeOpenAiBoqItems(record.boq_items),
    symbol_legend: normalizeOpenAiLegend(record.symbol_legend)
  };
}

function normalizeDesignQa(value: unknown): OpenAiDesignQaResult {
  if (!value || typeof value !== "object") {
    return {
      approved: false,
      score: 0,
      readability_issues: ["OpenAI QA did not return valid JSON"],
      symbol_issues: [],
      requirement_issues: [],
      boq_issues: ["Malformed OpenAI QA response"],
      correction_prompt:
        "OpenAI must correct the electrical design and BOQ: make all text crisp, restore any cut symbols, ensure every symbol is explained by the structured legend, include fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/MSU labels, clear routes, and regenerate a counted BOQ."
    };
  }
  const record = value as Record<string, unknown>;
  const score = typeof record.score === "number" ? record.score : typeof record.score === "string" ? Number(record.score) : 0;
  const readabilityIssues = stringArray(record.readability_issues);
  const symbolIssues = stringArray(record.symbol_issues);
  const requirementIssues = stringArray(record.requirement_issues);
  const boqIssues = stringArray(record.boq_issues);
  const correctionPrompt =
    typeof record.correction_prompt === "string" && record.correction_prompt.trim()
      ? record.correction_prompt.trim()
      : "OpenAI must correct the electrical design and BOQ: repair unreadable text/symbols, explain every visible symbol in the structured legend, include all mandatory FL/S/P defaults, DB/MSU, readable routes, and regenerate counted BOQ.";
  return {
    approved: record.approved === true && readabilityIssues.length === 0 && symbolIssues.length === 0 && requirementIssues.length === 0 && boqIssues.length === 0,
    score: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
    readability_issues: readabilityIssues,
    symbol_issues: symbolIssues,
    requirement_issues: requirementIssues,
    boq_issues: boqIssues,
    correction_prompt: correctionPrompt
  };
}

export async function evaluateDesignImageWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  finalDesignImageUrl: string;
  requirements: Record<string, unknown>;
}) {
  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.1"),
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "electrical_design_qa",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["approved", "score", "readability_issues", "symbol_issues", "requirement_issues", "boq_issues", "correction_prompt"],
            properties: {
              approved: { type: "boolean" },
              score: { type: "number", minimum: 0, maximum: 100 },
              readability_issues: { type: "array", items: { type: "string" } },
              symbol_issues: { type: "array", items: { type: "string" } },
              requirement_issues: { type: "array", items: { type: "string" } },
              boq_issues: { type: "array", items: { type: "string" } },
              correction_prompt: { type: "string" }
            }
          }
        }
      },
      input: [
        {
          role: "system",
          content:
            "You are OpenAI acting as an electrical drawing QA checker, professional critique reviewer, and correction planner. Return strict JSON that matches the schema."
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: context.finalDesignImageUrl, detail: "high" },
            {
              type: "input_text",
              text: `QA-check this OpenAI GPT-5.5-generated Ethiopian/EBCS + IEC electrical design image and the stored legend/BOQ. Do not redesign in this JSON response; if rejected, write correction_prompt for the next OpenAI correction image pass. Return JSON only.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements/context: ${limitText(context.requirements, 12000)}

Check these non-negotiable items:
- Readability: no blurry text, pseudo-text, misspelled labels, cut symbols, orphan tags, or unreadable key explanations.
- Layout discipline: reject mixed/gibberish lighting layouts where FL main lights, EL emergency lights, switch routes, socket routes, and emergency routes are visually blended or unclear.
- Symbol explanation: every visible symbol family in the drawing must be explained by the structured symbol legend; reject unexplained or cut-off symbols.
- Defaults: fluorescent lamps, manual switches, and 220-230V earthed socket outlets must be present where practical on every floor and usable room/zone unless explicitly overridden.
- Standard naming: use FL, EL, SW, SO/P, DB, MSU, G, ATS, FA, CCTV/DATA consistently. Reject orphan/ambiguous tags such as D1/D2/D3/D6, DE, EE, EF, IG, K, 9A1 unless clearly defined.
- No-EV compliance: if requirements say no EV chargers, reject any EV, EV1, EV charger legend entry, charger route, or charger BOQ item.
- Source/distribution: main supply unit/source from transformer or utility incomer must be marked as MSU/MSU? and DB/circuit routes must be understandable.
- Generator/ATS: if required, G location and ATS/MSU/DB route must be visible and understandable, and BOQ must match visible symbols.
- Professionalism/design accuracy: drawing must be practical, electrician-readable, visually clean, dimensionally respectful of the base plan, and accurate to the user's stated requirements and floor use.
- BOQ: BOQ must exist, must be generated from the visible OpenAI design, must include counted lamps, switches, sockets, DB/protection, routes/conduit/cable allowances, and applicable emergency/fire/data/EV/generator devices.
- Legend/symbol sheet should be the structured dashboard/PDF legend, not blurry AI text inside the image.

If rejected, correction_prompt must be a concise instruction for the OpenAI correction pass, including both drawing fixes and BOQ updates.`
            }
          ]
        }
      ]
    })
  }, "OpenAI design QA");
  if (!response.ok) {
    throw new Error(`OpenAI design QA failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  return normalizeDesignQa(extractJson<unknown>(responseText(payload as OpenAiResponsesPayload), null));
}

function normalizedCoordinate(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0.02, Math.min(0.96, parsed)) : fallback;
}

function normalizeSchematicPlan(value: unknown): SchematicRenderPlan {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const deviceKinds = new Set<SchematicDeviceKind>(["MSU", "ATS", "DB", "G", "FL", "EL", "SW", "SO", "FA", "CCTV/DATA"]);
  const routeKinds = new Set<SchematicRouteKind>(["utility", "generator", "distribution", "lighting", "emergency", "power", "fire", "data"]);
  const devices: NonNullable<SchematicRenderPlan["devices"]> = [];
  for (const item of Array.isArray(record.devices) ? record.devices : []) {
    if (!item || typeof item !== "object") continue;
    const device = item as Record<string, unknown>;
    const kind = typeof device.kind === "string" ? (device.kind.toUpperCase() as SchematicDeviceKind) : ("" as SchematicDeviceKind);
    if (!deviceKinds.has(kind)) continue;
    devices.push({
      kind,
      id: typeof device.id === "string" ? device.id.slice(0, 16) : undefined,
      label: typeof device.label === "string" ? device.label.slice(0, 18) : undefined,
      x: normalizedCoordinate(device.x, 0.5),
      y: normalizedCoordinate(device.y, 0.5)
    });
  }

  const routes: NonNullable<SchematicRenderPlan["routes"]> = [];
  for (const item of Array.isArray(record.routes) ? record.routes : []) {
    if (!item || typeof item !== "object") continue;
    const route = item as Record<string, unknown>;
    const kind = typeof route.kind === "string" ? (route.kind.toLowerCase() as SchematicRouteKind) : ("" as SchematicRouteKind);
    if (!routeKinds.has(kind) || !Array.isArray(route.points)) continue;
    const points: [number, number][] = [];
    for (const point of route.points.slice(0, 10)) {
      if (!Array.isArray(point) || point.length < 2) continue;
      points.push([normalizedCoordinate(point[0], 0.5), normalizedCoordinate(point[1], 0.5)]);
    }
    if (points.length < 2) continue;
    routes.push({
      kind,
      id: typeof route.id === "string" && route.id.trim() ? route.id.slice(0, 16) : kind.toUpperCase(),
      label: typeof route.label === "string" ? route.label.slice(0, 36) : undefined,
      points
    });
  }

  const notes: NonNullable<SchematicRenderPlan["notes"]> = [];
  for (const item of Array.isArray(record.notes) ? record.notes : []) {
    if (!item || typeof item !== "object") continue;
    const note = item as Record<string, unknown>;
    const label = typeof note.label === "string" && note.label.trim() ? note.label.slice(0, 42) : null;
    if (!label) continue;
    const noteKind = typeof note.kind === "string" ? note.kind : "";
    const kind =
      deviceKinds.has(noteKind.toUpperCase() as SchematicDeviceKind)
        ? (noteKind.toUpperCase() as SchematicDeviceKind)
        : routeKinds.has(noteKind.toLowerCase() as SchematicRouteKind)
          ? (noteKind.toLowerCase() as SchematicRouteKind)
          : undefined;
    notes.push({ label, x: normalizedCoordinate(note.x, 0.5), y: normalizedCoordinate(note.y, 0.5), kind });
  }
  return {
    devices,
    routes,
    notes,
    boq_items: normalizeOpenAiBoqItems(record.boq_items)
  };
}

export async function createSchematicRenderPlanWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  sourceImageUrl: string;
  requirements: Record<string, unknown>;
}) {
  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_DESIGN_MODEL", "gpt-5.1"),
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      input: [
        {
          role: "system",
          content:
            "You are the AI electrical designer. Analyze the floor-plan image and project requirements, then return a compact JSON drawing plan for a code renderer. The renderer will draw exact symbols, text, routes, legend, and BOQ; do not return prose."
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: context.sourceImageUrl, detail: "high" },
            {
              type: "input_text",
              text: `Create a structured electrical schematic render plan for Ethiopian/EBCS + IEC practice.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements/context: ${limitText(context.requirements, 11000)}

Return JSON only:
{
  "devices": [{"kind":"MSU","id":"MSU","label":"MSU","x":0.10,"y":0.10}],
  "routes": [{"kind":"utility","id":"F-01","label":"MSU -> ATS","points":[[0.08,0.10],[0.45,0.10]]}],
  "notes": [{"label":"ELECTRICAL METER ROOM","x":0.08,"y":0.14,"kind":"MSU"}],
  "boq_items": [{"category":"Lighting","item":"Fluorescent lamp fixtures","specification":"230V fluorescent batten/linear fittings","unit":"No.","quantity":20,"standard":"EBCS / IEC 60598","notes":"Counted from planned visible FL symbols"}]
}

Coordinate rules:
- x and y are normalized 0..1 inside the architectural plan image.
- Place devices near actual rooms/zones visible in the floor plan, not in a decorative side panel.
- Keep routes sparse, orthogonal, and electrician-readable. Use trunk routes plus short branches, not dense spaghetti.

Mandatory symbols:
- MSU main incoming supply/source from transformer or utility. If source location is unknown, put MSU? in the electrical meter/service room or most likely incomer zone.
- DB floor distribution board.
- ATS and G if generator/ATS is required.
- FL fluorescent lamps, EL emergency lights, SW manual switches, SO 220-230V earthed sockets, FA fire alarm, CCTV/DATA.
- Do not include EV when requirements forbid EV chargers.

Professional constraints:
- Main FL lighting and EL emergency lighting must be visually separate.
- Switches must be near entrances/control points and associated with zones.
- Sockets must cover practical rooms/usable zones and remain clearly non-EV when EV is forbidden.
- BOQ must include counted devices plus cable/conduit/containment allowances for lighting, power, emergency, fire, data/CCTV, generator feeder, and earthing/bonding.
- Use only these names: FL, EL, SW, SO, DB, MSU, G, ATS, FA, CCTV/DATA. No orphan codes.`
            }
          ]
        }
      ]
    })
  }, "OpenAI schematic render planning");
  if (!response.ok) {
    throw new Error(`OpenAI schematic render planning failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  return normalizeSchematicPlan(extractJson<unknown>(responseText(payload as OpenAiResponsesPayload), {}));
}

export async function reviewDesignPlanWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  requirements: Record<string, unknown>;
  grokPlan: string;
}) {
  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.1"),
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      input: [
        {
          role: "system",
          content:
            "You are a senior Ethiopian electrical design checker. Review the proposed electrical drawing plan for EBCS/IEC buildability. Return strict JSON only with keys approved, required_changes, risk_flags, prompt_additions."
        },
        {
          role: "user",
          content: `Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}

Default standard unless explicitly overridden: Ethiopian/EBCS and IEC/EU practice, fluorescent lamp fixtures, manual wall switches, 220-230V earthed socket outlets, 380-400V three-phase where needed, 50Hz, copper conductors in mm2, DIN-rail protection, no US/NEC terminology.

Review for:
- missing room/zone coverage
- missing fluorescent lamps, manual switches, or 220-230V earthed socket outlets
- weak DB location, circuit grouping, route labels, or electrician readability
- drawing risks that would make BOQ image counting unreliable
- any accidental LED/default substitution not requested by the architect

Requirements and analysis:
${JSON.stringify(context.requirements)}

Grok draft plan:
${context.grokPlan}`
        }
      ]
    })
  }, "OpenAI design review");
  if (!response.ok) {
    throw new Error(`OpenAI design review failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  return normalizeDesignReview(extractJson<unknown>(responseText(payload as OpenAiResponsesPayload), null));
}

export async function createElectricalDesignWithOpenAI(context: {
  projectName: string;
  projectCode: string;
  floorName: string;
  floorNumber: number;
  buildingPurpose?: string | null;
  revision: number;
  sourceImageUrl: string;
  originalPlanImageUrl?: string | null;
  referenceDesignImagePath?: string | null;
  mode?: "new" | "revision" | "correction";
  correctionPrompt?: string | null;
  requirements: Record<string, unknown>;
}) {
  const modelName = openAiImageModel();
  const form = new FormData();
  form.append("model", modelName);
  if (modelName.startsWith("gpt-image") || modelName.startsWith("chatgpt-image")) {
    form.append("input_fidelity", "high");
    form.append("quality", getEnv("OPENAI_IMAGE_QUALITY") ?? "high");
  }
  form.append("output_format", "png");

  const baseInputs = context.originalPlanImageUrl && context.originalPlanImageUrl !== context.sourceImageUrl
    ? [{ url: context.originalPlanImageUrl }, { url: context.sourceImageUrl }]
    : [{ url: context.sourceImageUrl }];
  const inputs = context.referenceDesignImagePath ? [...baseInputs, { path: context.referenceDesignImagePath }] : baseInputs;
  const imageFieldName = inputs.length > 1 ? "image[]" : "image";
  for (const [index, input] of inputs.entries()) {
    const { blob, filename } = await imageToBlob(input);
    const namedFile =
      index === 0 && inputs.length > 1
        ? `locked-original-plan-${filename}`
        : index === inputs.length - 1 && context.referenceDesignImagePath
          ? `accepted-electrical-reference-${filename}`
          : filename;
    form.append(imageFieldName, blob, namedFile);
  }

  const action =
    context.mode === "correction"
      ? `Correction required by OpenAI QA critique: ${context.correctionPrompt ?? "Complete missing default electrical design requirements."}`
      : context.mode === "revision"
        ? "Revise the existing electrical overlay according to the architect/engineer request while preserving correct existing work."
        : "Create the electrical design overlay directly on the architectural floor plan.";

  const prompt = clampOpenAiImagePrompt(`Create a professional Ethiopian/EBCS + IEC electrical installation drawing.

${action}

Input image rules:
- If one image is provided, it is the locked architectural floor plan or the existing design to edit.
- If two images are provided, the first image is the locked original architectural floor plan and the second image is the current generated electrical design. Use the first image as the unchanged base reference and transfer/correct only the electrical overlay from the second image.
- If a third image is provided, it is the accepted reference electrical drawing style. Copy its drafting discipline: clean magenta lighting fixtures, green switching/socket routing, red emergency routes, sparse readable symbols, separated main lighting and emergency lighting, and no clutter. Do not copy its architecture or device quantities; only copy its professional layout style.

Hard requirements:
- Preserve the architectural floor plan exactly. Do not alter, redraw, crop, stretch, erase, simplify, move, or reinterpret any wall, door, window, stair, column, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Add only electrical overlay content: fluorescent lamp fixtures, manual wall switches, 220-230V earthed socket outlets, DB/protection mark, circuit numbers, wiring routes, emergency/fire/data devices where applicable.
- Non-negotiable defaults for every floor: fluorescent lamp fixtures, manual switches, and 220-230V earthed socket outlets. Do not omit these systems. Every room, lobby, stair, service room, corridor, parking bay zone, ramp, equipment area, and practical usable zone needs visible fluorescent lighting coverage, manual switch/control points, and socket outlets where physically practical.
- For basement/parking floors, add repeated fluorescent fixtures across open parking bays, drive aisles, ramps, corners, stair/lift lobbies, generator/electrical/storage rooms, and service alcoves. Add manual switches at every entrance, ramp access, stair/lift lobby, generator/electrical room, and service alcove. Add earthed sockets at DB/equipment points, perimeter/column maintenance points, generator/electrical rooms, security/attendant/cleaning points, and practical service zones.
- Place the main supply unit/source from transformer or utility incomer as MSU if known. If unknown, mark the likely incoming source as MSU? near the DB/incomer and route DB logic from it.
- If requirements say no EV chargers, do not draw EV, EV1, charger symbols, charger routes, charger labels, or EV legend entries.
- If a generator is required, mark it clearly with G in the specified storage/generator room, mark ATS near the supply/DB path, and show an understandable G -> ATS -> MSU/DB essential supply route.
- Use LED only if the architect/project requirements explicitly request LED.
- Use Ethiopian/EBCS and IEC/EU language: 220-230V single-phase, 380-400V three-phase where needed, 50Hz, copper conductors in mm2, DIN-rail MCB/RCBO/RCCB, PVC conduit/trunking, IP-rated fittings for wet/outdoor zones.
- Avoid US/NEC terms such as AWG, NEMA, 120V, split-phase, or receptacle.
- Make the drawing electrician-readable and BOQ-countable through clear symbols, consistent colors, visible routes, and simple circuit IDs.
- Use only standardized, legend-defined symbols and tags: FL fluorescent lamp, EL emergency light, SW manual switch, SO or P earthed socket outlet, DB distribution board, MSU main supply, G generator, ATS automatic transfer switch, FA fire alarm, CCTV/DATA low-current point. Do not use unexplained codes such as D1, D2, D3, D6, DE, EE, EF, IG, K, 9A1, or random one-off tags.
- Include a small clean symbol legend/symbol sheet only if it can be kept readable inside an existing clear margin. Use symbol plus short meaning only, such as "FL - fluorescent lamp", "SW - manual switch", "SO - socket outlet", "DB - distribution board", "MSU - main supply", "G - generator", "ATS - transfer switch". Do not include BOQ quantities, specifications, schedules, paragraphs, or title-block data inside the image.
- Text discipline is critical: no bill of quantity table, schedule, notes panel, side panel, large note box, leader-arrow callout, title-block expansion, decorative border, or paragraph text inside the image.
- Avoid long words and specifications inside the drawing. Use only short readable tags where unavoidable: DB, MSU, FL, EL, SW, SO/P, FA, CCTV/DATA, G, ATS, L1-L6, P1-P6. Do not write labels like "fluorescent batten", "socket outlet", "generator 80kVA", cable sizes, lux values, or standards in the image.
- Reduce visual clutter: use fewer trunk routes with clear branch points, avoid overlapping dashed routes, keep tags away from cars/walls/boundaries/grid bubbles, and leave white space around every device symbol.
- Keep systems visually separated like the reference: fluorescent/main lighting layout must be distinct from emergency lighting; switches and sockets must be on their own clear routes; do not mix FL fixtures with EL fixtures or emergency routes.
- Every visible tag family must be explained by the structured legend and must be countable for BOQ. If a tag cannot be explained, do not draw it.
- If an existing generated image contains a messy AI-drawn legend/title block, remove or ignore that generated legend content and keep the electrical overlay on the original plan clean.

Project: ${context.projectName}
Floor: ${context.floorName}
Drawing No: ENT-${context.projectCode}-E-${context.floorNumber}
Revision: ${context.revision}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${limitText(context.requirements, 9000)}`);
  form.append("prompt", prompt);

  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`
    },
    body: form
  }, "OpenAI electrical design image");
  if (!response.ok) {
    throw new Error(`OpenAI electrical design image failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  const image = (payload as OpenAiImageResponse).data?.[0];
  if (!image?.url && !image?.b64_json) throw new Error("OpenAI electrical design image returned no image");
  return image;
}

export async function generateDesignPackageWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  finalDesignImageUrl: string;
  requirements: Record<string, unknown>;
}) {
  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.1"),
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      input: [
        {
          role: "system",
          content:
            "You are OpenAI acting as a professional electrical critique and correction reviewer. Create or update the corrected design's structured symbol legend and BOQ from the final drawing. Return JSON only with keys symbol_legend and boq_items."
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: context.finalDesignImageUrl, detail: "high" },
            {
              type: "input_text",
              text: `Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements/context: ${JSON.stringify(context.requirements)}

Return strict JSON:
{
  "symbol_legend": [{"symbol":"FL","label":"Fluorescent Lamp","color":"#d6a744","description":"Default lighting fixture"}],
  "boq_items": [{"category":"Lighting","item":"Fluorescent lamp fixture","specification":"230V fluorescent fitting","unit":"pcs","quantity":10,"standard":"EBCS, IEC 60598","notes":"Counted from final drawing; site verify final quantity"}]
}

Rules:
- OpenAI generated or corrected the design, so OpenAI must generate the BOQ and symbol sheet from the visible final drawing.
- Use standardized legend symbols only: FL, EL, SW, SO/P, DB, MSU, G, ATS, FA, CCTV/DATA. Do not output duplicate emergency-light entries such as both E and EL.
- Include no EV/EV1/EV Charger legend or BOQ items when requirements say no EV chargers.
- Do not include orphan/unexplained tag families such as D1/D2/D3/D6, DE, EE, EF, IG, K, 9A1 unless they are visibly defined and necessary; prefer CCTV/DATA, FA, L1-L6, P1-P6.
- BOQ must include fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/protection, wiring/conduit route allowances, and visible emergency/fire/data/generator/ATS items where applicable.
- If generator/ATS is required, include G and ATS only when visible on the drawing; if not visible, put a correction note rather than inventing hidden BOQ quantities.
- If exact counts are unclear, estimate conservatively from the visible drawing and notes, and put "site verify final quantity" in notes. Do not return an empty BOQ.
- Use Ethiopian/EBCS and IEC/EU language, mm2 copper conductors, DIN-rail protection, 220-230V single phase and 380-400V three phase where applicable.`
            }
          ]
        }
      ]
    })
  }, "OpenAI design package generation");
  if (!response.ok) {
    throw new Error(`OpenAI design package generation failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  return normalizeOpenAiDesignPackage(extractJson<unknown>(responseText(payload as OpenAiResponsesPayload), {}));
}

export async function improveDesignTextWithOpenAI(image: ImageResult, context: { projectName: string; floorName: string; revision: number; originalPlanImageUrl?: string | null; designerName?: string }) {
  const modelName = openAiImageModel();
  const form = new FormData();
  form.append("model", modelName);
  if (modelName.startsWith("gpt-image") || modelName.startsWith("chatgpt-image")) {
    form.append("input_fidelity", "high");
    form.append("quality", getEnv("OPENAI_IMAGE_QUALITY") ?? "high");
  }
  const inputs = context.originalPlanImageUrl ? [{ url: context.originalPlanImageUrl }, image] : [image];
  const imageFieldName = inputs.length > 1 ? "image[]" : "image";
  for (const [index, input] of inputs.entries()) {
    const { blob, filename } = await imageToBlob(input);
    form.append(imageFieldName, blob, index === 0 && context.originalPlanImageUrl ? `locked-original-plan-${filename}` : filename);
  }
  form.append("output_format", "png");
  form.append(
    "prompt",
    `Professional electrical drafting readability and symbol check pass.

Hard constraints:
- If two input images are provided, the first image is the locked original architectural floor plan and the second image is the draft electrical overlay. Use the first image as the unchanged base layer and transfer/improve only the electrical overlay from the second image.
- Preserve the original architectural floor plan exactly. Do not alter, redraw, restyle, crop, stretch, erase, move, or reinterpret any original wall, door, window, stair, column, grid line, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Do not fade, white out, clean up, redraw, simplify, crop, or remove original architectural linework, labels, grid bubbles, parking bay markings, ramp/stair graphics, room names, or boundary lines. If the draft overlay conflicts with the locked original plan, the locked original plan wins.
- Improve readability only: sharpen overlay line weights, align routes if already present, clean symbol placement, improve contrast, and standardize short IDs.
- Do not redesign the electrical system in this readability pass. ${context.designerName ?? "OpenAI GPT-5.5"} is the design owner for this image. Do not add new devices/routes except to restore a clearly corrupted or unreadable symbol from the draft.
- Ensure symbols remain standard and explainable by the dashboard legend: FL, EL, SW, SO/P, DB, MSU, G, ATS, FA, CCTV/DATA.
- Remove or rename orphan/ambiguous labels such as D1, D2, D3, D6, DE, EE, EF, IG, K, 9A1, and unclear EV tags unless they are explicitly required and explained by the structured legend.
- Main/fluorescent lighting must stay visually distinct from emergency lighting. Do not allow FL and EL symbols/routes to overlap or share unreadable labels.
- Do not create or keep an AI-drawn legend, title block, BOQ table, schedule, side panel, large note box, leader-arrow callout, title-block expansion, external annotation area, decorative layout, or paragraph text. If the draft contains messy generated legend/title text, remove that generated text while preserving the plan and electrical overlay.
- Use only short readable CAD IDs where unavoidable: MSU, DB, FL, EL, SW, SO/P, FA, CCTV/DATA, G, ATS, L1-L6, P1-P6. Do not write long equipment names, cable specifications, standards, lux values, or BOQ quantities inside the image.
- Reduce clutter: keep tags away from walls, cars, boundaries, and grid bubbles; avoid overlapping dashed routes; keep circuit routes grouped and electrician-readable.
- Do not convert fluorescent fixtures to LED unless the drawing or project explicitly requests LED.
- This pass should make OpenAI verify readability and symbol clarity only.

Project: ${context.projectName}
Floor: ${context.floorName}
Revision: ${context.revision}`
  );

  const { response, text, payload } = await openAiFetchWithRetry("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`
    },
    body: form
  }, "OpenAI image edit");
  if (!response.ok) {
    throw new Error(`OpenAI image edit failed: ${openAiErrorMessage(response.status, payload, text)}`);
  }

  const edited = (payload as OpenAiImageResponse).data?.[0];
  if (!edited?.url && !edited?.b64_json) throw new Error("OpenAI image edit returned no image");
  return edited;
}
