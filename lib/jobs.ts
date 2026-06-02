import { getBaseUrl, getEnv } from "@/lib/env";
import { convertPdfToPngPages, createFloorPdf, createProjectPackagePdf } from "@/lib/pdf-utils";
import { renderProgrammaticElectricalSchematic } from "@/lib/schematic-renderer";
import { getSupabaseAdmin } from "@/lib/supabase";
import { downloadTelegramFile, sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram";
import { fetchStorageBase64, uploadProjectFile } from "@/lib/storage";
import { createPlanSpecWithOpenAI } from "@/lib/openai-plan-analyzer";
import { designMarkingsSchema } from "@/lib/design-markings";
import {
  analyzeFloorPlan,
  fallbackAnnotations,
  generateQuestions,
  normalizeAnnotations
} from "@/lib/xai";
import type { BoqItem, Design, Floor, Job, JobType, Project } from "@/types";

const MAX_JOB_ATTEMPTS = 3;
const STALE_PROCESSING_MINUTES = 6;

export async function createJob(type: JobType, payload: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("jobs").insert({ type, payload }).select("*").single();
  if (error) throw error;
  return data as Job;
}

function jobErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}

function missingBoqColumn(error: unknown) {
  const message =
    error && typeof error === "object"
      ? `${"message" in error ? String(error.message ?? "") : ""} ${"details" in error ? String(error.details ?? "") : ""} ${"hint" in error ? String(error.hint ?? "") : ""}`
      : String(error ?? "");
  return /boq_items|schema cache|column/i.test(message);
}

function boqMigrationWarning() {
  return "OpenAI BOQ was generated, but this Supabase database is missing designs.boq_items. Apply supabase/migrations/003_design_boq_items.sql, then retry/revise this design so BOQ can be stored and exported.";
}

async function insertFileRecord(row: Record<string, unknown>, fallbackType = "electrical_design") {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("files").insert(row);
  if (!error) return;
  if (!/file_type|check constraint|violates|schema cache|column/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) throw error;
  await supabase.from("files").insert({ ...row, file_type: fallbackType });
}

export async function createTelegramImageJob(payload: Record<string, unknown>) {
  try {
    return await createJob("telegram_image", payload);
  } catch (error) {
    const message = jobErrorMessage(error);
    if (!/type|check constraint|violates|telegram_image|schema cache/i.test(message)) throw error;
    return createJob("telegram_pdf", { ...payload, fileKind: "image" });
  }
}

export async function triggerJobProcessing() {
  const baseUrl = getBaseUrl();
  const secret = getEnv("JOB_SECRET") ?? getEnv("CRON_SECRET");
  try {
    await fetch(`${baseUrl}/api/jobs/process?mode=background`, {
      method: "POST",
      headers: {
        ...(secret ? { "x-job-secret": secret } : {}),
        "x-job-mode": "background"
      }
    });
  } catch {
    // Cron/manual processing remains the durable fallback.
  }
}

export async function retryFailedJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (lookupError) throw lookupError;

  const current = existing as Job;
  const staleBefore = Date.now() - STALE_PROCESSING_MINUTES * 60_000;
  if (current.status === "processing" && new Date(current.updated_at).getTime() > staleBefore) {
    throw new Error(`Job is still processing. Wait ${STALE_PROCESSING_MINUTES} minutes before recovering it, or check the job processor logs.`);
  }

  if (current.status === "pending") {
    await triggerJobProcessing();
    return current;
  }

  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "pending",
      attempts: 0,
      error: null,
      run_after: new Date().toISOString()
    })
    .eq("id", jobId)
    .select("*")
    .single();
  if (error) throw error;
  await prepareRetriedJob(data as Job);
  await triggerJobProcessing();
  return data as Job;
}

async function prepareRetriedJob(job: Job) {
  if (job.type !== "analyze_floor" && job.type !== "generate_design" && job.type !== "revision_design") return;
  const { projectId, floorId } = job.payload as { projectId?: string; floorId?: string };
  if (!projectId || !floorId) return;
  const supabase = getSupabaseAdmin();
  const isAnalysis = job.type === "analyze_floor";
  await Promise.all([
    supabase.from("floors").update({ status: isAnalysis ? "analyzing" : "designing" }).eq("id", floorId),
    supabase.from("bot_sessions").update({ state: isAnalysis ? "ANALYZING" : "DESIGNING", current_floor_id: floorId }).eq("project_id", projectId)
  ]);
}

async function recoverStaleProcessingJobs() {
  const supabase = getSupabaseAdmin();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "processing")
    .lte("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(5);
  if (error) throw error;

  for (const job of (data ?? []) as Job[]) {
    const message = `Job timed out or was interrupted while processing for more than ${STALE_PROCESSING_MINUTES} minutes.`;
    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      await supabase.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
      await applyJobFailureSideEffects(job, message);
      continue;
    }

    await supabase
      .from("jobs")
      .update({
        status: "pending",
        error: `${message} Retrying automatically.`,
        run_after: new Date().toISOString()
      })
      .eq("id", job.id);
  }
}

async function claimNextJob() {
  const supabase = getSupabaseAdmin();
  await recoverStaleProcessingJobs();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const job = jobs?.[0] as Job | undefined;
  if (!job) return null;

  const { data, error: updateError } = await supabase
    .from("jobs")
    .update({ status: "processing", attempts: job.attempts + 1, error: null })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (updateError) return null;
  return data as Job;
}

async function completeJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  await supabase.from("jobs").update({ status: "completed", error: null }).eq("id", jobId);
}

async function failJob(job: Job, error: unknown) {
  const supabase = getSupabaseAdmin();
  const message = jobErrorMessage(error);
  if (job.attempts >= MAX_JOB_ATTEMPTS) {
    await supabase.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
    await applyJobFailureSideEffects(job, message);
    return;
  }

  const backoffMs = 30_000 * Math.max(1, job.attempts);
  await supabase
    .from("jobs")
    .update({
      status: "pending",
      error: message,
      run_after: new Date(Date.now() + backoffMs).toISOString()
    })
    .eq("id", job.id);
}

async function applyJobFailureSideEffects(job: Job, message: string) {
  if (job.type !== "generate_design" && job.type !== "revision_design") return;
  const { projectId, floorId } = job.payload as { projectId?: string; floorId?: string };
  if (!projectId || !floorId) return;

  const supabase = getSupabaseAdmin();
  await Promise.all([
    supabase.from("floors").update({ status: "marking_review" }).eq("id", floorId),
    supabase.from("bot_sessions").update({ state: "ANALYZING", current_floor_id: floorId }).eq("project_id", projectId)
  ]);

  const { data: project } = await supabase.from("projects").select("telegram_chat_id").eq("id", projectId).maybeSingle();
  const text = `Design generation did not finish. The engineering dashboard now shows the failed job and can retry it. Error: ${message}`;
  await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "bot", message: text });
  const chatId = (project as { telegram_chat_id?: number | null } | null)?.telegram_chat_id;
  if (chatId) {
    try {
      await sendTelegramMessage(chatId, text);
    } catch (sendError) {
      console.error("Failed to notify architect about design job failure", sendError);
    }
  }
}

function imageExtension(filename?: string, contentType?: string) {
  const value = `${contentType ?? ""} ${filename ?? ""}`.toLowerCase();
  if (/jpe?g/.test(value)) return "jpg";
  return "png";
}

async function getProjectFloor(projectId: string, floorId: string) {
  const supabase = getSupabaseAdmin();
  const [{ data: project, error: projectError }, { data: floor, error: floorError }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("floors").select("*").eq("id", floorId).single()
  ]);
  if (projectError) throw projectError;
  if (floorError) throw floorError;
  return { project: project as Project, floor: floor as Floor };
}

function fallbackMarkings(sourceSize: [number, number]) {
  const [w, h] = sourceSize;
  return {
    source_size: sourceSize,
    boundary_polygon: [
      [w * 0.05, h * 0.08],
      [w * 0.95, h * 0.08],
      [w * 0.95, h * 0.9],
      [w * 0.05, h * 0.9]
    ],
    design_bbox: [w * 0.05, h * 0.08, w * 0.95, h * 0.9],
    db_room_bbox: [w * 0.05, h * 0.08, w * 0.28, h * 0.18],
    generator_room_bbox: [w * 0.78, h * 0.08, w * 0.95, h * 0.2],
    confidence: 0,
    warnings: [{ severity: "warning", message: "AI did not return valid marking candidates; review and adjust manually." }]
  };
}

function normalizeDesignMarkings(analysis: unknown) {
  const raw = analysis && typeof analysis === "object" ? (analysis as Record<string, unknown>).markings : null;
  const sourceCandidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>).source_size : null;
  const sourceSize: [number, number] =
    Array.isArray(sourceCandidate) && typeof sourceCandidate[0] === "number" && typeof sourceCandidate[1] === "number"
      ? [Math.max(1, sourceCandidate[0]), Math.max(1, sourceCandidate[1])]
      : [1000, 700];
  const parsed = designMarkingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallbackMarkings(sourceSize);
}

function markingsForGeneration(floor: Floor) {
  const designMarkings = floor.design_markings ?? {};
  return designMarkings.confirmed ?? designMarkings.ai ?? {};
}

async function fetchPreviousPlanSpec(floorId: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("files").select("*").eq("floor_id", floorId).eq("file_type", "plan_spec").order("created_at", { ascending: false }).limit(1);
  const path = data?.[0]?.storage_path as string | undefined;
  if (!path) return null;
  try {
    return JSON.parse(Buffer.from(await fetchStorageBase64(path), "base64").toString("utf8")) as unknown;
  } catch (error) {
    console.warn("Could not load previous plan spec", error);
    return null;
  }
}

export function chooseDesignEditSource(input: { improvementRequest?: string; originalImageUrl: string | null; previousDesignImageUrl?: string | null }) {
  return input.improvementRequest && input.previousDesignImageUrl ? input.previousDesignImageUrl : input.originalImageUrl;
}

async function processTelegramPdf(job: Job) {
  const { projectId, floorId, fileId, filename } = job.payload as {
    projectId: string;
    floorId: string;
    fileId: string;
    filename?: string;
  };
  const supabase = getSupabaseAdmin();
  const { buffer } = await downloadTelegramFile(fileId);
  const pdfPath = `projects/${projectId}/floors/${floorId}/architectural.pdf`;
  const pdfUrl = await uploadProjectFile(pdfPath, buffer, "application/pdf");
  const pages = await convertPdfToPngPages(buffer);
  if (!pages[0]) throw new Error("PDF conversion produced no pages");

  const imagePath = `projects/${projectId}/floors/${floorId}/plan.png`;
  const imageUrl = await uploadProjectFile(imagePath, pages[0], "image/png");

  await supabase.from("files").insert([
    { project_id: projectId, floor_id: floorId, file_type: "architectural_pdf", storage_path: pdfPath, public_url: pdfUrl, original_filename: filename },
    { project_id: projectId, floor_id: floorId, file_type: "floor_screenshot", storage_path: imagePath, public_url: imageUrl, original_filename: "plan.png" }
  ]);
  await supabase
    .from("floors")
    .update({
      architectural_pdf_url: pdfUrl,
      architectural_image_url: imageUrl,
      architectural_pdf_path: pdfPath,
      architectural_image_path: imagePath,
      status: "analyzing"
    })
    .eq("id", floorId);

  await createJob("analyze_floor", { projectId, floorId });
}

async function processTelegramImage(job: Job) {
  const { projectId, floorId, fileId, filename, contentType } = job.payload as {
    projectId: string;
    floorId: string;
    fileId: string;
    filename?: string;
    contentType?: string;
  };
  const supabase = getSupabaseAdmin();
  const { buffer } = await downloadTelegramFile(fileId);
  const extension = imageExtension(filename, contentType);
  const imagePath = `projects/${projectId}/floors/${floorId}/architectural-image.${extension}`;
  const imageUrl = await uploadProjectFile(imagePath, buffer, extension === "jpg" ? "image/jpeg" : "image/png");

  const { error: fileError } = await supabase.from("files").insert({
    project_id: projectId,
    floor_id: floorId,
    file_type: "architectural_image",
    storage_path: imagePath,
    public_url: imageUrl,
    original_filename: filename ?? `floor-plan.${extension}`
  });
  if (fileError && !/file_type|check constraint|violates|schema cache|column/i.test(`${fileError.message ?? ""} ${fileError.details ?? ""}`)) throw fileError;
  if (fileError) {
    await supabase.from("files").insert({
      project_id: projectId,
      floor_id: floorId,
      file_type: "floor_screenshot",
      storage_path: imagePath,
      public_url: imageUrl,
      original_filename: filename ?? `floor-plan.${extension}`
    });
  }

  await supabase
    .from("floors")
    .update({
      architectural_pdf_url: null,
      architectural_image_url: imageUrl,
      architectural_pdf_path: null,
      architectural_image_path: imagePath,
      status: "analyzing"
    })
    .eq("id", floorId);

  await createJob("analyze_floor", { projectId, floorId });
}

async function processAnalyzeFloor(job: Job) {
  const { projectId, floorId } = job.payload as { projectId: string; floorId: string };
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  if (!floor.architectural_image_path) throw new Error("Floor has no architectural image path");

  const imageInput = floor.architectural_image_url ?? (await fetchStorageBase64(floor.architectural_image_path));
  const analysis = await analyzeFloorPlan(imageInput, { project, floor });
  const questions = await generateQuestions(analysis as Record<string, unknown>, { project, floor });
  const markings = normalizeDesignMarkings(analysis);

  await supabase
    .from("floors")
    .update({ status: "marking_review", ai_analysis: analysis, ai_questions: questions, design_markings: { ai: markings } })
    .eq("id", floorId);

  await supabase
    .from("bot_sessions")
    .update({ state: "ANALYZING", current_floor_id: floorId })
    .eq("project_id", projectId);

  if (project.telegram_chat_id) {
    const text = `I analyzed ${floor.floor_name}. The engineering dashboard now has GPT-5.5 marking candidates and clarification questions for review.`;
    await sendTelegramMessage(project.telegram_chat_id, text);
    await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "bot", message: text });
  }
}

async function processGenerateDesign(job: Job) {
  const { projectId, floorId, improvementRequest } = job.payload as {
    projectId: string;
    floorId: string;
    improvementRequest?: string;
  };

  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: existing } = await supabase.from("designs").select("*").eq("floor_id", floorId).order("version", { ascending: false }).limit(2);
  const version =
    typeof job.payload.version === "number" && Number.isFinite(job.payload.version)
      ? job.payload.version
      : ((existing?.[0] as Design | undefined)?.version ?? 0) + 1;
  const sourceImageUrl =
    floor.architectural_image_url ??
    (floor.architectural_image_path ? `data:image/png;base64,${await fetchStorageBase64(floor.architectural_image_path)}` : null);
  if (!sourceImageUrl) throw new Error("Floor has no architectural image source for deterministic plan rendering");
  const imagePath = `projects/${projectId}/floors/${floorId}/design-v${version}.png`;
  const specPath = `projects/${projectId}/floors/${floorId}/plan-spec-v${version}.json`;
  const debugPath = `projects/${projectId}/floors/${floorId}/debug-overlay-v${version}.png`;
  const annotations = normalizeAnnotations((floor.ai_analysis as Record<string, unknown>)?.annotations, fallbackAnnotations());
  const previousDesign = (existing?.[0] as Design | undefined) ?? null;
  const previousPlanSpec = improvementRequest ? await fetchPreviousPlanSpec(floorId) : null;

  console.log("[jobs:generate_design] OpenAI JSON plan specification started", { jobId: job.id, projectId, floorId, version });
  const planSpec = await createPlanSpecWithOpenAI({
    projectId,
    floorId,
    projectName: project.project_name,
    floorName: floor.floor_name,
    buildingPurpose: project.building_purpose,
    sourceImageUrl,
    feedback: floor.architect_answers,
    analysis: floor.ai_analysis,
    confirmedMarkings: markingsForGeneration(floor),
    reviewAnswers: floor.review_answers ?? {},
    previousPlanSpec,
    previousDesignImageUrl: improvementRequest ? previousDesign?.design_image_url ?? null : null,
    specialRequirements: project.special_requirements,
    improvementRequest
  });

  console.log("[jobs:generate_design] Python deterministic render started", { jobId: job.id, projectId, floorId, version });
  const renderedDesign = await renderProgrammaticElectricalSchematic({
    sourceImageUrl,
    project,
    floor,
    version,
    spec: planSpec
  });
  const designUrl = await uploadProjectFile(imagePath, renderedDesign.buffer, "image/png");
  const debugUrl = await uploadProjectFile(debugPath, renderedDesign.debugBuffer, "image/png");
  const specUrl = await uploadProjectFile(specPath, Buffer.from(JSON.stringify(renderedDesign.planSpec, null, 2)), "application/json");
  const boqItems = renderedDesign.boqItems;
  if (!boqItems.length) throw new Error("Programmatic BOQ generation returned no items for this design");
  console.log("[jobs:generate_design] Deterministic render completed", {
    jobId: job.id,
    projectId,
    floorId,
    version,
    itemCount: boqItems.length,
    legendCount: renderedDesign.symbolLegend.length,
    imagePath,
    specPath
  });

  await saveGeneratedDesign({
    project,
    floor,
    projectId,
    floorId,
    version,
    designUrl,
    imagePath,
    specUrl,
    specPath,
    debugUrl,
    debugPath,
    annotations,
    symbolLegend: renderedDesign.symbolLegend,
    boqItems,
    improvementRequest,
    revisionNotes: `Deterministic Python renderer output from validated OpenAI JSON plan specification. Spec artifact: ${specPath}`,
    existing: (existing ?? []) as Design[],
    designOwner: "Deterministic Python renderer"
  });
  return null;
}

async function saveGeneratedDesign(input: {
  project: Project;
  floor: Floor;
  projectId: string;
  floorId: string;
  version: number;
  designUrl: string;
  imagePath: string;
  specUrl: string;
  specPath: string;
  debugUrl: string;
  debugPath: string;
  annotations: Design["annotations"];
  symbolLegend: Design["symbol_legend"];
  boqItems: BoqItem[];
  improvementRequest?: string;
  revisionNotes?: string | null;
  existing: Design[];
  designOwner: string;
}) {
  const supabase = getSupabaseAdmin();
  const designPayload: Record<string, unknown> = {
    floor_id: input.floorId,
    version: input.version,
    design_image_url: input.designUrl,
    design_image_path: input.imagePath,
    design_pdf_url: null,
    design_pdf_path: null,
    annotations: input.annotations,
    symbol_legend: input.symbolLegend,
    boq_items: input.boqItems,
    revision_notes: input.revisionNotes ?? null,
    improvement_request: input.improvementRequest ?? null
  };
  let { data: design, error } = await supabase.from("designs").insert(designPayload).select("*").single();
  if (error && missingBoqColumn(error)) {
    delete designPayload.boq_items;
    designPayload.revision_notes = [designPayload.revision_notes, boqMigrationWarning()].filter(Boolean).join("\n");
    const retry = await supabase.from("designs").insert(designPayload).select("*").single();
    design = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  const keep = input.existing.slice(1).map((item) => item.id);
  if (keep.length) await supabase.from("designs").delete().in("id", keep);

  await insertFileRecord({ project_id: input.projectId, floor_id: input.floorId, file_type: "electrical_design", storage_path: input.imagePath, public_url: input.designUrl });
  await insertFileRecord({ project_id: input.projectId, floor_id: input.floorId, file_type: "plan_spec", storage_path: input.specPath, public_url: input.specUrl }, "electrical_design");
  await insertFileRecord({ project_id: input.projectId, floor_id: input.floorId, file_type: "debug_overlay", storage_path: input.debugPath, public_url: input.debugUrl }, "electrical_design");
  await supabase.from("floors").update({ status: "design_ready" }).eq("id", input.floorId);
  await supabase.from("bot_sessions").update({ state: "AWAITING_APPROVAL" }).eq("project_id", input.projectId);

  if (input.project.telegram_chat_id) {
    const message =
      input.version > 1
        ? `${input.designOwner} has updated the electrical design and BOQ for ${input.floor.floor_name}. The revised image is ready for engineering review. Use the dashboard Save PDF button if you need a PDF.`
        : `${input.designOwner} has generated the clean electrical plan and BOQ for ${input.floor.floor_name}. The image is ready for engineering review. Use the dashboard Save PDF button if you need a PDF.`;
    await sendTelegramMessage(input.project.telegram_chat_id, message);
    await sendTelegramPhoto(input.project.telegram_chat_id, input.designUrl, `${input.floor.floor_name} revised electrical plan PNG`);
    await supabase.from("conversations").insert({ project_id: input.projectId, floor_id: input.floorId, sender: "bot", message });
  }

  return design as Design;
}

async function processPdfExport(job: Job) {
  const { projectId, floorId, designId } = job.payload as { projectId: string; floorId: string; designId: string };
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: design, error } = await supabase.from("designs").select("*").eq("id", designId).single();
  if (error) throw error;

  const buffer = await createFloorPdf(project, floor, design as Design);
  const path = `projects/${projectId}/floors/${floorId}/export-v${(design as Design).version}.pdf`;
  const url = await uploadProjectFile(path, buffer, "application/pdf");
  await supabase.from("designs").update({ design_pdf_url: url, design_pdf_path: path }).eq("id", designId);
  await supabase.from("files").insert({ project_id: projectId, floor_id: floorId, file_type: "final_pdf", storage_path: path, public_url: url });
}

async function processPdfCompile(job: Job) {
  const { projectId } = job.payload as { projectId: string };
  const supabase = getSupabaseAdmin();
  const [{ data: project, error: projectError }, { data: floors, error: floorsError }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("floors").select("*").eq("project_id", projectId).order("floor_number", { ascending: true })
  ]);
  if (projectError) throw projectError;
  if (floorsError) throw floorsError;

  const floorIds = ((floors ?? []) as Floor[]).map((floor) => floor.id);
  const { data: designs, error: designsError } = floorIds.length
    ? await supabase.from("designs").select("*").in("floor_id", floorIds).order("version", { ascending: false })
    : { data: [], error: null };
  if (designsError) throw designsError;

  const buffer = await createProjectPackagePdf(project as Project, (floors ?? []) as Floor[], (designs ?? []) as Design[]);
  const path = `projects/${projectId}/final-package.pdf`;
  const url = await uploadProjectFile(path, buffer, "application/pdf");
  await supabase.from("files").insert({ project_id: projectId, file_type: "final_pdf", storage_path: path, public_url: url, original_filename: "final-package.pdf" });
}

export async function processNextJob() {
  const job = await claimNextJob();
  if (!job) return { processed: false };

  try {
    if (job.type === "telegram_pdf" && (job.payload as { fileKind?: string }).fileKind === "image") await processTelegramImage(job);
    else if (job.type === "telegram_pdf") await processTelegramPdf(job);
    if (job.type === "telegram_image") await processTelegramImage(job);
    if (job.type === "analyze_floor") await processAnalyzeFloor(job);
    if (job.type === "generate_design" || job.type === "revision_design") await processGenerateDesign(job);
    if (job.type === "pdf_export") await processPdfExport(job);
    if (job.type === "pdf_compile") await processPdfCompile(job);
    await completeJob(job.id);
    return { processed: true, jobId: job.id, type: job.type };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}

export async function processJobs(options: { maxJobs?: number; maxMs?: number } = {}) {
  const started = Date.now();
  const maxJobs = options.maxJobs ?? 10;
  const maxMs = options.maxMs ?? 50_000;
  const results: Array<{ processed: boolean; jobId?: string; type?: string; error?: string }> = [];

  for (let index = 0; index < maxJobs; index += 1) {
    if (Date.now() - started > maxMs) break;
    try {
      const result = await processNextJob();
      if (!result.processed) break;
      results.push(result);
    } catch (error) {
      results.push({ processed: false, error: error instanceof Error ? error.message : "Job processing failed" });
    }
  }

  return {
    processed: results.filter((item) => item.processed).length,
    failed: results.filter((item) => item.error).length,
    results
  };
}
