import { getEnv } from "@/lib/env";

type ImageResult = { url?: string; b64_json?: string };

type OpenAiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
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
- The original architectural floor plan is locked. Do not alter, redraw, restyle, crop, stretch, erase, move, or reinterpret any original wall, door, window, stair, column, grid line, room boundary, parking bay, dimension, room label, title text, or architectural symbol.
- Preserve the exact drawing composition, floor plan, symbols, cable routes, DB location, lighting points, socket outlets, switch points, circuit colors, and circuit topology.
- Do not redesign, simplify, move, delete, add, convert, or reinterpret electrical devices or routes.
- Do not convert fluorescent fixtures to LED fixtures. Preserve the device type shown by the design.
- Do not create a new sheet, side panel, blank box, large border, title-block expansion, or new annotation area.
- Only sharpen, correct, and rewrite existing text so it is legible.
- Do not add leader-arrow callouts, side callout labels, external annotation boxes, or large text panels. Keep compact labels directly beside their electrical symbols/routes inside the drawing.
- Use short professional CAD labels: DB, FL1, FL2, S1, S2, P1, P2, E1, FA1, D1, 10A MCB, 16A RCBO, 3x1.5mm2 Cu, 3x2.5mm2 Cu.
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
