import { getEnv } from "@/lib/env";

type ImageResult = { url?: string; b64_json?: string };

export type OpenAiDesignReview = {
  approved: boolean;
  required_changes: string[];
  risk_flags: string[];
  prompt_additions: string[];
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

export async function improveDesignTextWithOpenAI(image: ImageResult, context: { projectName: string; floorName: string; revision: number; originalPlanImageUrl?: string | null }) {
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
    `Professional electrical drafting enhancement pass.

Hard constraints:
- If two input images are provided, the first image is the locked original architectural floor plan and the second image is the draft electrical overlay. Use the first image as the unchanged base layer and transfer/improve only the electrical overlay from the second image.
- Preserve the original architectural floor plan exactly. Do not alter, redraw, restyle, crop, stretch, erase, move, or reinterpret any original wall, door, window, stair, column, grid line, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Do not fade, white out, clean up, redraw, simplify, crop, or remove original architectural linework, labels, grid bubbles, parking bay markings, ramp/stair graphics, room names, or boundary lines. If the draft overlay conflicts with the locked original plan, the locked original plan wins.
- Improve the electrical overlay professionalism only: sharpen line weights, align circuit routes, clean symbol placement, improve contrast, standardize labels, and make the drawing look deployable and electrician-readable.
- You may complete visibly missing standard electrical overlay items where needed for a deployable design: fluorescent lamp fixtures, manual wall switches, earthed socket outlets, DB labels, route labels, and circuit numbers. For basement/parking plans, cover parking bays, drive aisles, ramps, stair/lift lobbies, service rooms, exits, dark corners, DB/maintenance/security/cleaning/service points, and egress routes. Do not change the architectural base plan while doing this.
- Do not remove existing valid electrical devices or routes. Do not convert fluorescent fixtures to LED fixtures unless the drawing or project explicitly requests LED.
- Do not create a new sheet, side panel, blank box, large border, title-block expansion, external annotation area, or decorative layout.
- Do not add leader-arrow callouts, side callout labels, external annotation boxes, or large text panels. Keep compact labels directly beside their electrical symbols/routes inside the drawing.
- Use short professional CAD labels: DB, FL1, FL2, S1, S2, P1, P2, E1, FA1, D1, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
- If a label is too long, replace it with a shorter professional equivalent without changing the design.
- The legend, if present, must be only symbol-to-meaning entries. No notes, quantities, specifications, schedules, or explanatory paragraphs inside the legend.

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
