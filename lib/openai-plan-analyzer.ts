import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getEnv } from "@/lib/env";
import { normalizePlanSpec, planSpecJsonSchema, validatePlanSymbolConsistency, type PlanSpec } from "@/lib/plan-schema";
import { SYMBOL_CODES, SYMBOL_DICTIONARY, symbolBoqMapping, symbolPromptGuidance, symbolRendererShape } from "@/lib/symbol-dictionary";

type ResponsesPayload = {
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

function model() {
  return getEnv("OPENAI_DESIGN_MODEL") ?? "gpt-5.5";
}

function outputText(payload: ResponsesPayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim() ?? "";
}

function extractJsonText(text: string) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI returned no JSON object");
    return match[0];
  }
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
    let payload: ResponsesPayload = {};
    try {
      payload = text ? (JSON.parse(text) as ResponsesPayload) : {};
    } catch {
      payload = {};
    }
    if (response.ok) return { text: outputText(payload), raw: text };
    lastError = payload.error?.message ?? text;
    if (!RETRY_STATUSES.has(response.status) || attempt === 2) {
      throw new Error(`${label} failed: ${response.status} - ${lastError}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw new Error(`${label} failed: ${lastError}`);
}

function truncate(value: unknown, max = 9000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max - 18)}... [truncated]` : text;
}

function strictJsonFormat(name: string) {
  return {
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema: planSpecJsonSchema
    },
    verbosity: "low"
  };
}

function symbolCatalog() {
  return Object.values(SYMBOL_DICTIONARY).map((item) => ({
    symbol: item.symbol,
    label: item.label,
    description: item.description,
    category: item.category,
    default_specification: item.defaultSpecification,
    unit: item.unit,
    prompt_guidance: symbolPromptGuidance(item.symbol),
    boq_mapping: symbolBoqMapping(item.symbol),
    renderer_shape: symbolRendererShape(item.symbol)
  }));
}

async function persistFailedOutput(projectId: string, floorId: string, raw: string, reason: string) {
  const path = join(tmpdir(), `failed-plan-spec-${projectId}-${floorId}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify({ projectId, floorId, reason, raw }, null, 2), "utf8").catch(() => undefined);
  return path;
}

export async function repairInvalidPlanJson(input: {
  invalidJson: string;
  validationError: string;
  projectId: string;
  floorId: string;
}) {
  const { text } = await openAiResponses(
    {
      model: model(),
      reasoning: { effort: "medium" },
      text: strictJsonFormat("electrical_plan_spec_repair"),
      input: [
        {
          role: "system",
          content: "Repair malformed electrical drawing JSON. Return JSON only and obey the schema exactly."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `The previous plan specification failed validation: ${input.validationError}

Repair it without adding undefined symbols. Allowed symbols: ${SYMBOL_CODES.join(", ")}.
JSON to repair:
${truncate(input.invalidJson, 22000)}`
            }
          ]
        }
      ]
    },
    "OpenAI plan JSON repair"
  );
  return text;
}

export async function createPlanSpecWithOpenAI(input: {
  projectId: string;
  floorId: string;
  projectName: string;
  floorName: string;
  buildingPurpose?: string | null;
  sourceImageUrl: string;
  feedback: unknown;
  analysis?: unknown;
  confirmedMarkings?: unknown;
  reviewAnswers?: unknown;
  previousPlanSpec?: unknown;
  previousDesignImageUrl?: string | null;
  specialRequirements?: string | null;
  improvementRequest?: string | null;
}) {
  const prompt = `Analyze the architectural plan image and architect feedback, then return one deterministic drawing specification JSON object only.

The renderer, not the model, will draw the final technical plan. Do not describe artwork. Do not generate images. Use exact coordinates in source-image pixels. If source dimensions are unknown, estimate image_width/image_height and keep coordinates in that same estimated pixel space.

Symbol library (the renderer can draw only these):
${JSON.stringify(symbolCatalog(), null, 2)}
Required defaults unless explicitly changed: FL fluorescent lights, SW manual switches, SO 220V earthed socket outlets.
Routes policy:
- Do not create point-to-point branch wiring for every symbol.
- Return only major route intent: MSU -> ATS, G -> ATS, ATS -> DB, and one high-level trunk per system when useful.
- Keep routes array under 10 items total.
- The Python renderer will generate readable orthogonal trunk-and-branch circuits by layer.
- Lighting routes must be blue. Emergency lighting routes must be red. Do not mix main lighting and emergency lighting.
Do not design anything outside the floor boundary. If room identity is uncertain, use a clean label with VERIFY warning.
Confirmed full-plan markings in original source-image pixels override inferred guesses:
${truncate(input.confirmedMarkings)}
Use the confirmed boundary_polygon for the PlanSpec boundary. Place MSU/DB/ATS in db_room_bbox when present. Place G in generator_room_bbox when present unless the review answers override it.

Web review answers / clarifications:
${truncate(input.reviewAnswers)}
Do not invent labels such as S5, BB, EB, OO, T, random numbers, or EV unless defined and requested. EV must not appear unless explicitly requested.
Main distribution should be traceable: utility incomer -> MSU -> ATS -> DB. If generator backup is requested or implied, show G / 80 kVA in storage/generator area and route G -> ATS.
Legend and BOQ must include only visible symbols and BOQ quantities must equal the visible equipment/devices.
Device density policy:
- For basement parking, use enough FL fixtures for coverage but avoid excessive symbols; prefer a clean grid along drive aisles and parking rows.
- Place SW only at control points/entrances, not beside every fixture.
- Place SO at practical maintenance/service/utility points, not beside every bay.
- Use VERIFY warnings instead of pretending uncertain rooms or equipment are confirmed.

Project: ${input.projectName}
Floor: ${input.floorName}
Building purpose: ${input.buildingPurpose ?? "not specified"}
Special requirements: ${input.specialRequirements ?? "none"}
Improvement request: ${input.improvementRequest ?? "none"}
Architect feedback/context: ${truncate(input.feedback)}
Existing image analysis: ${truncate(input.analysis)}
Previous PlanSpec for revision continuity:
${truncate(input.previousPlanSpec, 16000)}

For revisions, use the previous rendered PNG only as QA context. Do not use image generation and do not ask for new boundary marks.`;

  const content: Array<Record<string, unknown>> = [{ type: "input_image", image_url: input.sourceImageUrl, detail: "high" }];
  if (input.previousDesignImageUrl) {
    content.push({ type: "input_text", text: "Previous rendered design PNG for revision QA context:" });
    content.push({ type: "input_image", image_url: input.previousDesignImageUrl, detail: "high" });
  }
  content.push({ type: "input_text", text: prompt });

  const { text: firstText, raw } = await openAiResponses(
    {
      model: model(),
      reasoning: { effort: "high" },
      text: strictJsonFormat("electrical_plan_spec"),
      input: [
        {
          role: "system",
          content:
            "You are a senior Ethiopian electrical design engineer. Produce strict JSON for a deterministic code renderer. Never produce final artwork or prose."
        },
        {
          role: "user",
          content
        }
      ]
    },
    "OpenAI plan specification"
  );

  let lastText = firstText;
  try {
    const spec = normalizePlanSpec(JSON.parse(extractJsonText(firstText)));
    validatePlanSymbolConsistency(spec);
    return spec;
  } catch (error) {
    const validationError = error instanceof Error ? error.message : "Plan specification validation failed";
    await persistFailedOutput(input.projectId, input.floorId, raw || firstText, validationError);
    lastText = await repairInvalidPlanJson({
      invalidJson: firstText,
      validationError,
      projectId: input.projectId,
      floorId: input.floorId
    });
  }

  try {
    const spec: PlanSpec = normalizePlanSpec(JSON.parse(extractJsonText(lastText)));
    validatePlanSymbolConsistency(spec);
    return spec;
  } catch (error) {
    const validationError = error instanceof Error ? error.message : "Repaired plan specification validation failed";
    await persistFailedOutput(input.projectId, input.floorId, lastText, validationError);
    throw new Error(`OpenAI did not return a valid plan specification after repair: ${validationError}`);
  }
}
