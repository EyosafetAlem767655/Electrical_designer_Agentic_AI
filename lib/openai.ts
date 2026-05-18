import { getEnv } from "@/lib/env";
import { normalizeBoqItems, fallbackBoqItems } from "@/lib/xai";
import type { BoqItem } from "@/types";

type ImageResult = { url?: string; b64_json?: string };

type OpenAiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
};

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
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

async function openAiJson<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
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
    throw new Error(message ? `OpenAI request failed: ${response.status} - ${message}` : `OpenAI request failed: ${response.status}`);
  }
  return payload;
}

function firstText(payload: OpenAiChatResponse) {
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

function parseJson<T>(text: string, fallback: T): T {
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

export async function improveDesignTextWithOpenAI(image: ImageResult, context: { projectName: string; floorName: string; revision: number }) {
  const { blob, filename } = await imageToBlob(image);
  const form = new FormData();
  form.append("model", openAiModel("OPENAI_IMAGE_MODEL", "gpt-image-1.5"));
  form.append("image", blob, filename);
  form.append("output_format", "png");
  form.append(
    "prompt",
    `Edit this electrical drawing image to fix blurred or unreadable text only.

Hard constraints:
- Preserve the exact drawing composition, floor plan, symbols, cable routes, DB location, lighting points, socket outlets, switch points, circuit colors, and circuit topology.
- Do not redesign, simplify, move, delete, or add electrical devices or routes.
- Do not create a new sheet, side panel, blank box, large border, title-block expansion, or new annotation area.
- Only sharpen, correct, and rewrite existing text so it is legible.
- Use short professional CAD labels: DB, L1, L2, S1, S2, P1, P2, E1, FA1, D1, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
- If a label is too long, replace it with a shorter professional equivalent without changing the design.

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

export async function generateBoqItemsWithOpenAI(context: {
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  finalDesignImageUrl: string;
  requirements: Record<string, unknown>;
}): Promise<BoqItem[]> {
  const response = await openAiJson<OpenAiChatResponse>("chat/completions", {
    model: openAiModel("OPENAI_BOQ_MODEL", "gpt-5.5"),
    messages: [
      {
        role: "system",
        content:
          "You are an Ethiopian/IEC electrical quantity surveyor. Return only valid JSON matching the requested schema. Use EBCS and IEC/EU terminology, not US/NEC terminology."
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: context.finalDesignImageUrl, detail: "high" } },
          {
            type: "text",
            text: `Create an accurate floor-level Bill of Quantity from this final cleaned electrical design drawing.

Count visible lighting points, switch points, socket outlets, DB/protection panels, emergency lights, fire alarm devices, data/CCTV points, conduit/trunking route allowances, cable runs, junction boxes, and protection devices.

Rules:
- Return JSON object only: {"items":[...]}.
- Every item must have category, item, specification, unit, quantity, standard, and notes.
- Use Ethiopian/EBCS and IEC/EU assumptions: 220-230V single-phase, 380-400V three-phase, 50Hz, copper conductors in mm2, DIN-rail MCB/RCBO/RCCB, PVC conduit/trunking, Type F/Schuko-style outlets where applicable.
- Base quantities on visible symbols/routes in the final design image first, then project context.
- For route lengths, estimate practical quantities and mark notes as site-verified.
- Avoid AWG, NEMA, 120V, 240V split phase, and NEC.

Project: ${context.projectName}
Floor: ${context.floorName}
Building purpose: ${context.buildingPurpose ?? "not specified"}
Context: ${JSON.stringify(context.requirements)}`
          }
        ]
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "boq_items",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  category: { type: "string" },
                  item: { type: "string" },
                  specification: { type: "string" },
                  unit: { type: "string" },
                  quantity: { type: "number" },
                  standard: { type: "string" },
                  notes: { type: "string" }
                },
                required: ["category", "item", "specification", "unit", "quantity", "standard", "notes"]
              }
            }
          },
          required: ["items"]
        }
      }
    }
  });

  const parsed = parseJson<{ items?: unknown }>(firstText(response), { items: [] });
  return normalizeBoqItems(parsed.items, fallbackBoqItems());
}
