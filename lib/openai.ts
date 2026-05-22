import { getEnv } from "@/lib/env";
import type { BoqItem, SymbolLegendItem } from "@/types";

type ImageResult = { url?: string; b64_json?: string };

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

function openAiModel(name: string, fallback: string) {
  return getEnv(name) ?? fallback;
}

function requireOpenAiKey() {
  const key = getEnv("OPENAI_API_KEY") ?? getEnv("OPEN_AI_KEY");
  if (!key) throw new Error("Missing required environment variable: OPENAI_API_KEY or OPEN_AI_KEY");
  return key;
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
  if (!image.url) throw new Error("OpenAI image edit needs an image URL or base64 image");
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
        "Grok must correct the electrical design and BOQ: make all text crisp, restore any cut symbols, ensure every symbol is explained by the structured legend, include fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/MSU labels, clear routes, and regenerate a counted BOQ."
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
      : "Grok must correct the electrical design and BOQ: repair unreadable text/symbols, explain every visible symbol in the structured legend, include all mandatory FL/S/P defaults, DB/MSU, readable routes, and regenerate counted BOQ.";
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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.5"),
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
              text: `QA-check this Grok-generated Ethiopian/EBCS + IEC electrical design image and the stored legend/BOQ. Do not redesign in this JSON response; if rejected, write correction_prompt for the OpenAI correction image pass. Return JSON only.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements/context: ${JSON.stringify(context.requirements)}

Check these non-negotiable items:
- Readability: no blurry text, pseudo-text, misspelled labels, cut symbols, orphan tags, or unreadable key explanations.
- Symbol explanation: every visible symbol family in the drawing must be explained by the structured symbol legend; reject unexplained or cut-off symbols.
- Defaults: fluorescent lamps, manual switches, and 220-230V earthed socket outlets must be present where practical on every floor and usable room/zone unless explicitly overridden.
- Source/distribution: main supply unit/source from transformer or utility incomer must be marked as MSU/MSU? and DB/circuit routes must be understandable.
- Professionalism/design accuracy: drawing must be practical, electrician-readable, visually clean, dimensionally respectful of the base plan, and accurate to the user's stated requirements and floor use.
- BOQ: BOQ must exist, must be generated from the visible Grok design, must include counted lamps, switches, sockets, DB/protection, routes/conduit/cable allowances, and applicable emergency/fire/data/EV/generator devices.
- Legend/symbol sheet should be the structured dashboard/PDF legend, not blurry AI text inside the image.

If rejected, correction_prompt must be a concise instruction for the OpenAI correction pass, including both drawing fixes and BOQ updates.`
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const text = await response.text();
  let payload = {} as OpenAiResponsesPayload;
  if (text) {
    try {
      payload = JSON.parse(text) as OpenAiResponsesPayload;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `OpenAI design QA failed: ${response.status} - ${message}` : `OpenAI design QA failed: ${response.status}`);
  }

  return normalizeDesignQa(extractJson<unknown>(responseText(payload), null));
}

export async function reviewDesignPlanWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  requirements: Record<string, unknown>;
  grokPlan: string;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.5"),
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
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const text = await response.text();
  let payload = {} as OpenAiResponsesPayload;
  if (text) {
    try {
      payload = JSON.parse(text) as OpenAiResponsesPayload;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `OpenAI design review failed: ${response.status} - ${message}` : `OpenAI design review failed: ${response.status}`);
  }

  return normalizeDesignReview(extractJson<unknown>(responseText(payload), null));
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
  mode?: "new" | "revision" | "correction";
  correctionPrompt?: string | null;
  requirements: Record<string, unknown>;
}) {
  const modelName = openAiModel("OPENAI_IMAGE_MODEL", "gpt-image-1.5");
  const form = new FormData();
  form.append("model", modelName);
  if (modelName.startsWith("gpt-image") || modelName.startsWith("chatgpt-image")) {
    form.append("input_fidelity", "high");
    form.append("quality", getEnv("OPENAI_IMAGE_QUALITY") ?? "high");
  }
  form.append("output_format", "png");

  const inputs = context.originalPlanImageUrl && context.originalPlanImageUrl !== context.sourceImageUrl
    ? [{ url: context.originalPlanImageUrl }, { url: context.sourceImageUrl }]
    : [{ url: context.sourceImageUrl }];
  const imageFieldName = inputs.length > 1 ? "image[]" : "image";
  for (const [index, input] of inputs.entries()) {
    const { blob, filename } = await imageToBlob(input);
    form.append(imageFieldName, blob, index === 0 && inputs.length > 1 ? `locked-original-plan-${filename}` : filename);
  }

  const action =
    context.mode === "correction"
      ? `Correction required by OpenAI QA critique: ${context.correctionPrompt ?? "Complete missing default electrical design requirements."}`
      : context.mode === "revision"
        ? "Revise the existing electrical overlay according to the architect/engineer request while preserving correct existing work."
        : "Create the electrical design overlay directly on the architectural floor plan.";

  form.append(
    "prompt",
    `Create a professional Ethiopian/EBCS + IEC electrical installation drawing.

${action}

Input image rules:
- If one image is provided, it is the locked architectural floor plan or the existing design to edit.
- If two images are provided, the first image is the locked original architectural floor plan and the second image is the current generated electrical design. Use the first image as the unchanged base reference and transfer/correct only the electrical overlay from the second image.

Hard requirements:
- Preserve the architectural floor plan exactly. Do not alter, redraw, crop, stretch, erase, simplify, move, or reinterpret any wall, door, window, stair, column, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Add only electrical overlay content: fluorescent lamp fixtures, manual wall switches, 220-230V earthed socket outlets, DB/protection mark, circuit numbers, wiring routes, emergency/fire/data devices where applicable.
- Non-negotiable defaults for every floor: fluorescent lamp fixtures, manual switches, and 220-230V earthed socket outlets. Do not omit these systems. Every room, lobby, stair, service room, corridor, parking bay zone, ramp, equipment area, and practical usable zone needs visible fluorescent lighting coverage, manual switch/control points, and socket outlets where physically practical.
- For basement/parking floors, add repeated fluorescent fixtures across open parking bays, drive aisles, ramps, corners, stair/lift lobbies, generator/electrical/storage rooms, and service alcoves. Add manual switches at every entrance, ramp access, stair/lift lobby, generator/electrical room, and service alcove. Add earthed sockets at DB/equipment points, perimeter/column maintenance points, generator/electrical rooms, security/attendant/cleaning points, and practical service zones.
- Place the main supply unit/source from transformer or utility incomer as MSU if known. If unknown, mark the likely incoming source as MSU? near the DB/incomer and route DB logic from it.
- Use LED only if the architect/project requirements explicitly request LED.
- Use Ethiopian/EBCS and IEC/EU language: 220-230V single-phase, 380-400V three-phase where needed, 50Hz, copper conductors in mm2, DIN-rail MCB/RCBO/RCCB, PVC conduit/trunking, IP-rated fittings for wet/outdoor zones.
- Avoid US/NEC terms such as AWG, NEMA, 120V, split-phase, or receptacle.
- Make the drawing electrician-readable and BOQ-countable through clear symbols, consistent colors, visible routes, and simple circuit IDs.
- Include a small clean symbol legend/symbol sheet only if it can be kept readable inside an existing clear margin. Use symbol plus short meaning only, such as "FL - fluorescent lamp", "S - manual switch", "P - socket outlet", "DB - distribution board", "MSU - main supply". Do not include BOQ quantities, specifications, schedules, paragraphs, or title-block data inside the image.
- Text discipline is critical: no bill of quantity table, schedule, notes panel, side panel, large note box, leader-arrow callout, title-block expansion, decorative border, or paragraph text inside the image.
- Avoid long words and specifications inside the drawing. Use only short readable tags where unavoidable: DB, FL, S, P, E, FA, D, EV1-EV5, L1-L6, P1-P6. Do not write labels like "fluorescent batten", "socket outlet", "generator 80kVA", cable sizes, lux values, or standards in the image.
- If an existing generated image contains a messy AI-drawn legend/title block, remove or ignore that generated legend content and keep the electrical overlay on the original plan clean.

Project: ${context.projectName}
Floor: ${context.floorName}
Drawing No: ENT-${context.projectCode}-E-${context.floorNumber}
Revision: ${context.revision}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Requirements and analysis: ${JSON.stringify(context.requirements)}`
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`
    },
    body: form,
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const text = await response.text();
  let payload = {} as OpenAiImageResponse;
  if (text) {
    try {
      payload = JSON.parse(text) as OpenAiImageResponse;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `OpenAI electrical design image failed: ${response.status} - ${message}` : `OpenAI electrical design image failed: ${response.status}`);
  }

  const image = payload.data?.[0];
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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel("OPENAI_REVIEW_MODEL", "gpt-5.5"),
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
- If OpenAI corrected the design, update the BOQ and symbol sheet to match the corrected drawing. If Grok generated the drawing, critique it and still count only what is visible in the final drawing.
- Include at minimum MSU, DB, FL, S, P and any visible E, FA, D, EV, G symbols in symbol_legend.
- BOQ must include fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/protection, wiring/conduit route allowances, and visible emergency/fire/data/EV/generator items where applicable.
- If exact counts are unclear, estimate conservatively from the visible drawing and notes, and put "site verify final quantity" in notes. Do not return an empty BOQ.
- Use Ethiopian/EBCS and IEC/EU language, mm2 copper conductors, DIN-rail protection, 220-230V single phase and 380-400V three phase where applicable.`
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const text = await response.text();
  let payload = {} as OpenAiResponsesPayload;
  if (text) {
    try {
      payload = JSON.parse(text) as OpenAiResponsesPayload;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `OpenAI design package generation failed: ${response.status} - ${message}` : `OpenAI design package generation failed: ${response.status}`);
  }

  return normalizeOpenAiDesignPackage(extractJson<unknown>(responseText(payload), {}));
}

export async function improveDesignTextWithOpenAI(image: ImageResult, context: { projectName: string; floorName: string; revision: number; originalPlanImageUrl?: string | null; designerName?: string }) {
  const modelName = openAiModel("OPENAI_IMAGE_MODEL", "gpt-image-1.5");
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
- Do not redesign the electrical system in this readability pass. ${context.designerName ?? "Grok/OpenAI"} is the design owner for this image. Do not add new devices/routes except to restore a clearly corrupted or unreadable symbol from the draft.
- Ensure symbols remain standard and explainable by the dashboard legend: MSU, DB, FL, S, P, E, FA, D, EV, G.
- Do not create or keep an AI-drawn legend, title block, BOQ table, schedule, side panel, large note box, leader-arrow callout, title-block expansion, external annotation area, decorative layout, or paragraph text. If the draft contains messy generated legend/title text, remove that generated text while preserving the plan and electrical overlay.
- Use only short readable CAD IDs where unavoidable: MSU, DB, FL, S, P, E, FA, D, EV1-EV5, L1-L6, P1-P6. Do not write long equipment names, cable specifications, standards, lux values, or BOQ quantities inside the image.
- Do not convert fluorescent fixtures to LED unless the drawing or project explicitly requests LED.
- This pass should make OpenAI verify readability and symbol clarity only.

Project: ${context.projectName}
Floor: ${context.floorName}
Revision: ${context.revision}`
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`
    },
    body: form,
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const text = await response.text();
  let payload = {} as OpenAiImageResponse;
  if (text) {
    try {
      payload = JSON.parse(text) as OpenAiImageResponse;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const message = payload.error?.message ?? text;
    throw new Error(message ? `OpenAI image edit failed: ${response.status} - ${message}` : `OpenAI image edit failed: ${response.status}`);
  }

  const edited = payload.data?.[0];
  if (!edited?.url && !edited?.b64_json) throw new Error("OpenAI image edit returned no image");
  return edited;
}
