import { DEFAULT_SYMBOL_LEGEND } from "@/lib/constants";
import { getBaseUrl, getEnv } from "@/lib/env";
import { convertPdfToPngPages, createFloorPdf, createProjectPackagePdf } from "@/lib/pdf-utils";
import { getSupabaseAdmin } from "@/lib/supabase";
import { downloadTelegramFile, sendTelegramMessage } from "@/lib/telegram";
import { fetchStorageBase64, uploadProjectFile, uploadRemoteImage } from "@/lib/storage";
import { createElectricalDesignWithOpenAI, evaluateDesignImageWithOpenAI, generateDesignPackageWithOpenAI, improveDesignTextWithOpenAI } from "@/lib/openai";
import {
  analyzeFloorPlan,
  fallbackAnnotations,
  generateBoqItems,
  generateDesignCorrectionDraftImage,
  generateDesignDraftImage,
  generateQuestions,
  normalizeAnnotations
} from "@/lib/xai";
import type { BoqItem, Conversation, Design, Floor, Job, JobType, Project } from "@/types";

const MAX_JOB_ATTEMPTS = 3;
const STALE_PROCESSING_MINUTES = 6;

export async function createJob(type: JobType, payload: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("jobs").insert({ type, payload }).select("*").single();
  if (error) throw error;
  return data as Job;
}

async function createDelayedJob(type: JobType, payload: Record<string, unknown>, delayMs = 0) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type, payload, run_after: new Date(Date.now() + delayMs).toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  await triggerJobProcessing();
  return data as Job;
}

function jobErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}

function qaIssueSummary(
  qa?:
    | {
        missing_defaults?: string[];
        coverage_issues?: string[];
        drawing_issues?: string[];
        readability_issues?: string[];
        symbol_issues?: string[];
        requirement_issues?: string[];
        boq_issues?: string[];
      }
    | null
) {
  const issues = [
    ...(qa?.missing_defaults ?? []),
    ...(qa?.coverage_issues ?? []),
    ...(qa?.drawing_issues ?? []),
    ...(qa?.readability_issues ?? []),
    ...(qa?.symbol_issues ?? []),
    ...(qa?.requirement_issues ?? []),
    ...(qa?.boq_issues ?? [])
  ].filter(Boolean);
  return issues.join("; ");
}

function mergeLegendWithDefaults(legend: Design["symbol_legend"]) {
  const bySymbol = new Map(DEFAULT_SYMBOL_LEGEND.map((item) => [item.symbol.toUpperCase(), item]));
  for (const item of legend) {
    bySymbol.set(item.symbol.toUpperCase(), item);
  }
  return Array.from(bySymbol.values());
}

function missingBoqColumn(error: unknown) {
  const message =
    error && typeof error === "object"
      ? `${"message" in error ? String(error.message ?? "") : ""} ${"details" in error ? String(error.details ?? "") : ""} ${"hint" in error ? String(error.hint ?? "") : ""}`
      : String(error ?? "");
  return /boq_items|schema cache|column/i.test(message);
}

function boqMigrationWarning() {
  return "Grok BOQ was generated, but this Supabase database is missing designs.boq_items. Apply supabase/migrations/003_design_boq_items.sql, then retry/revise this design so BOQ can be stored and exported.";
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
  if (job.type !== "generate_design" && job.type !== "revision_design") return;
  const { projectId, floorId } = job.payload as { projectId?: string; floorId?: string };
  if (!projectId || !floorId) return;
  const supabase = getSupabaseAdmin();
  await Promise.all([
    supabase.from("floors").update({ status: "designing" }).eq("id", floorId),
    supabase.from("bot_sessions").update({ state: "DESIGNING", current_floor_id: floorId }).eq("project_id", projectId)
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
    supabase.from("floors").update({ status: "questions_sent" }).eq("id", floorId),
    supabase.from("bot_sessions").update({ state: "AWAITING_ANSWERS", current_floor_id: floorId }).eq("project_id", projectId)
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

async function designImageInput(design?: Design | null) {
  if (!design) return null;
  if (design.design_image_url) return design.design_image_url;
  if (design.design_image_path) return `data:image/png;base64,${await fetchStorageBase64(design.design_image_path)}`;
  return null;
}

async function uploadGeneratedImage(imagePath: string, image: { url?: string; b64_json?: string }) {
  if (image.url) return uploadRemoteImage(imagePath, image.url);
  if (image.b64_json) return uploadProjectFile(imagePath, Buffer.from(image.b64_json, "base64"), "image/png");
  throw new Error("Generated design image returned no URL or base64 payload");
}

async function recentConversationContext(projectId: string, floorId: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("conversations")
    .select("sender,message,created_at")
    .eq("project_id", projectId)
    .or(`floor_id.eq.${floorId},floor_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(12);
  return ((data ?? []) as Pick<Conversation, "sender" | "message" | "created_at">[])
    .reverse()
    .map((item) => ({ sender: item.sender, message: item.message, created_at: item.created_at }));
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

  await supabase
    .from("floors")
    .update({ status: "questions_sent", ai_analysis: analysis, ai_questions: questions })
    .eq("id", floorId);

  await supabase
    .from("bot_sessions")
    .update({ state: "AWAITING_ANSWERS", current_floor_id: floorId })
    .eq("project_id", projectId);

  if (project.telegram_chat_id) {
    const text = `I analyzed ${floor.floor_name}. Please answer these questions:\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
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
  const phase = typeof job.payload.phase === "string" ? job.payload.phase : "grok_design";
  if (phase === "openai_qa") {
    await processOpenAiQaStage(job);
    return null;
  }
  if (phase === "openai_fix" || phase === "grok_fix") {
    await processOpenAiFixStage(job);
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: existing } = await supabase.from("designs").select("*").eq("floor_id", floorId).order("version", { ascending: false }).limit(2);
  const version =
    typeof job.payload.version === "number" && Number.isFinite(job.payload.version)
      ? job.payload.version
      : ((existing?.[0] as Design | undefined)?.version ?? 0) + 1;
  const attempt = typeof job.payload.designAttempt === "number" && Number.isFinite(job.payload.designAttempt) ? job.payload.designAttempt : 1;
  const sourceImageUrl =
    floor.architectural_image_url ??
    (floor.architectural_image_path ? `data:image/png;base64,${await fetchStorageBase64(floor.architectural_image_path)}` : null);
  const latestDesign = (existing?.[0] as Design | undefined) ?? null;
  const revisionSourceImageUrl = improvementRequest ? await designImageInput(latestDesign) : null;
  const correctionPrompt = typeof job.payload.correctionPrompt === "string" ? job.payload.correctionPrompt : null;
  const designEditSourceImageUrl = chooseDesignEditSource({
    improvementRequest: improvementRequest ?? correctionPrompt ?? undefined,
    originalImageUrl: sourceImageUrl,
    previousDesignImageUrl: (typeof job.payload.previousDesignUrl === "string" ? job.payload.previousDesignUrl : null) ?? revisionSourceImageUrl
  });

  const imagePath = `projects/${projectId}/floors/${floorId}/design-v${version}.png`;
  if (!designEditSourceImageUrl) throw new Error("Floor has no image source for Grok design generation");
  const annotations = normalizeAnnotations((floor.ai_analysis as Record<string, unknown>)?.annotations, fallbackAnnotations());
  const legend = mergeLegendWithDefaults(DEFAULT_SYMBOL_LEGEND);
  const conversationHistory = await recentConversationContext(projectId, floorId);
  const baseDraftRequirements = {
    ai_analysis: floor.ai_analysis,
    architect_answers: floor.architect_answers,
    special_requirements: project.special_requirements,
    conversation_history: conversationHistory,
    architectural_image_url: floor.architectural_image_url,
    original_architectural_image_url: sourceImageUrl,
    previous_design: latestDesign,
    improvement_request: improvementRequest,
    main_supply_source: floor.architect_answers?.main_supply_source,
    correction_prompt: correctionPrompt,
    design_attempt: attempt,
    symbol_legend: legend,
    annotations
  };
  const projectCode = project.project_code ?? project.id.slice(0, 6).toUpperCase();

  console.log("[jobs:generate_design] Grok design stage started", { jobId: job.id, projectId, floorId, version, attempt, phase });
  const draftImage =
    phase === "grok_fix" && correctionPrompt
      ? await generateDesignCorrectionDraftImage({
          projectName: project.project_name,
          projectCode,
          floorName: floor.floor_name,
          floorNumber: floor.floor_number,
          buildingPurpose: project.building_purpose,
          revision: version,
          sourceImageUrl: designEditSourceImageUrl,
          correctionPrompt,
          requirements: baseDraftRequirements
        })
      : await generateDesignDraftImage({
          projectName: project.project_name,
          projectCode,
          floorName: floor.floor_name,
          floorNumber: floor.floor_number,
          buildingPurpose: project.building_purpose,
          companyName: project.company_name,
          revision: version,
          sourceImageUrl: designEditSourceImageUrl,
          mode: improvementRequest ? "revision" : "new",
          requirements: baseDraftRequirements
        });
  console.log("[jobs:generate_design] Grok design stage completed", { jobId: job.id, projectId, floorId, version, attempt });

  console.log("[jobs:generate_design] OpenAI readability stage started", { jobId: job.id, projectId, floorId, version, attempt });
  const cleanedImage = await improveDesignTextWithOpenAI(draftImage, {
    projectName: project.project_name,
    floorName: floor.floor_name,
    revision: version,
    originalPlanImageUrl: sourceImageUrl,
    designerName: "Grok"
  });
  const designUrl = await uploadGeneratedImage(imagePath, cleanedImage);
  console.log("[jobs:generate_design] OpenAI readability stage completed", { jobId: job.id, projectId, floorId, version, attempt, imagePath });

  const boqContext = {
    ...baseDraftRequirements,
    ai_analysis: floor.ai_analysis,
    architect_answers: floor.architect_answers,
    special_requirements: project.special_requirements,
    improvement_request: improvementRequest,
    symbol_legend: legend,
    annotations,
    final_design_image_url: designUrl
  };
  console.log("[jobs:generate_design] Grok BOQ stage started", { jobId: job.id, projectId, floorId, version, attempt });
  const boqItems = await generateBoqItems({
    projectName: project.project_name,
    floorName: floor.floor_name,
    buildingPurpose: project.building_purpose,
    finalDesignImageUrl: designUrl,
    requirements: boqContext
  });
  console.log("[jobs:generate_design] Grok BOQ stage completed", { jobId: job.id, projectId, floorId, version, attempt, itemCount: boqItems.length });

  const design = await saveGeneratedDesign({
    project,
    floor,
    projectId,
    floorId,
    version,
    designUrl,
    imagePath,
    annotations,
    symbolLegend: legend,
    boqItems,
    improvementRequest,
    revisionNotes: correctionPrompt ? `Correction requested by OpenAI QA: ${correctionPrompt}` : null,
    existing: (existing ?? []) as Design[],
    designOwner: "Grok"
  });

  await createDelayedJob(job.type, {
    projectId,
    floorId,
    improvementRequest,
    phase: "openai_qa",
    version,
    designAttempt: attempt,
    designId: design.id,
    designUrl,
    imagePath
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
  annotations: Design["annotations"];
  symbolLegend: Design["symbol_legend"];
  boqItems: BoqItem[];
  improvementRequest?: string;
  revisionNotes?: string | null;
  existing: Design[];
  designOwner: "Grok" | "OpenAI";
}) {
  const supabase = getSupabaseAdmin();
  const finalLegend = mergeLegendWithDefaults(input.symbolLegend);
  const designPayload: Record<string, unknown> = {
    floor_id: input.floorId,
    version: input.version,
    design_image_url: input.designUrl,
    design_image_path: input.imagePath,
    annotations: input.annotations,
    symbol_legend: finalLegend,
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

  await supabase.from("files").insert({ project_id: input.projectId, floor_id: input.floorId, file_type: "electrical_design", storage_path: input.imagePath, public_url: input.designUrl });
  await supabase.from("floors").update({ status: "design_ready" }).eq("id", input.floorId);
  await supabase.from("bot_sessions").update({ state: "AWAITING_APPROVAL" }).eq("project_id", input.projectId);

  if (input.project.telegram_chat_id) {
    const message =
      input.version > 1
        ? `${input.designOwner} has updated the electrical design and BOQ for ${input.floor.floor_name} using OpenAI QA feedback. The revised design is ready for engineering review.`
        : `Grok has generated the electrical design and BOQ for ${input.floor.floor_name}. OpenAI is checking readability and symbols in the background while the design is available for engineering review.`;
    await sendTelegramMessage(input.project.telegram_chat_id, message);
    await supabase.from("conversations").insert({ project_id: input.projectId, floor_id: input.floorId, sender: "bot", message });
  }

  return design as Design;
}

async function processOpenAiQaStage(job: Job) {
  const { projectId, floorId, improvementRequest, version, designAttempt, designId, designUrl } = job.payload as {
    projectId: string;
    floorId: string;
    improvementRequest?: string;
    version: number;
    designAttempt: number;
    designId: string;
    designUrl: string;
  };
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: designData } = await supabase.from("designs").select("*").eq("id", designId).maybeSingle();
  const design = designData as Design | null;
  const annotations = normalizeAnnotations((floor.ai_analysis as Record<string, unknown>)?.annotations, fallbackAnnotations());
  const qaContext = {
    ai_analysis: floor.ai_analysis,
    architect_answers: floor.architect_answers,
    special_requirements: project.special_requirements,
    improvement_request: improvementRequest,
    symbol_legend: design?.symbol_legend?.length ? design.symbol_legend : DEFAULT_SYMBOL_LEGEND,
    boq_items: design?.boq_items ?? [],
    annotations,
    final_design_image_url: designUrl,
    correction_attempt: designAttempt - 1
  };
  console.log("[jobs:generate_design] OpenAI QA stage started", { jobId: job.id, projectId, floorId, version, attempt: designAttempt });
  const qa = await evaluateDesignImageWithOpenAI({
    projectName: project.project_name,
    floorName: floor.floor_name,
    buildingPurpose: project.building_purpose,
    finalDesignImageUrl: designUrl,
    requirements: qaContext
  });
  console.log("[jobs:generate_design] OpenAI QA stage completed", { jobId: job.id, projectId, floorId, version, attempt: designAttempt, approved: qa.approved, score: qa.score });

  if (qa.approved) {
    if (design?.id) {
      const notes = [design.revision_notes, "OpenAI QA passed: readability, symbol key, defaults, DB/MSU, and BOQ countability checked."].filter(Boolean).join("\n");
      await supabase.from("designs").update({ revision_notes: notes }).eq("id", design.id);
    }
    return;
  }

  const reasons = qaIssueSummary(qa) || "OpenAI QA found unresolved readability, symbol, requirement, or BOQ issues.";
  if (floor.status === "approved") {
    await supabase.from("conversations").insert({
      project_id: projectId,
      floor_id: floorId,
      sender: "bot",
      message: `OpenAI QA found issues after approval, so no automatic correction was made. Issues: ${reasons}`
    });
    return;
  }

  if (designAttempt >= 2) {
    if (design?.id) {
      const notes = [design.revision_notes, `OpenAI QA warning after OpenAI correction: ${reasons}`].filter(Boolean).join("\n");
      await supabase.from("designs").update({ revision_notes: notes }).eq("id", design.id);
    }
    if (project.telegram_chat_id) {
      const message = `The electrical design for ${floor.floor_name} is ready for engineering review with OpenAI QA warnings. Issues: ${reasons}`;
      await sendTelegramMessage(project.telegram_chat_id, message);
      await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "bot", message });
    }
    return;
  }

  await createDelayedJob(job.type, {
    projectId,
    floorId,
    improvementRequest,
    phase: "openai_fix",
    designAttempt: designAttempt + 1,
    previousDesignUrl: designUrl,
    correctionPrompt: qa.correction_prompt || reasons
  });
}

async function processOpenAiFixStage(job: Job) {
  const { projectId, floorId, improvementRequest, designAttempt, previousDesignUrl } = job.payload as {
    projectId: string;
    floorId: string;
    improvementRequest?: string;
    designAttempt: number;
    previousDesignUrl: string;
    correctionPrompt?: string;
  };
  const correctionPrompt =
    typeof job.payload.correctionPrompt === "string" && job.payload.correctionPrompt.trim()
      ? job.payload.correctionPrompt.trim()
      : "OpenAI QA requested a professional correction: repair missing defaults, readability, symbol explanation, DB/MSU clarity, circuit routes, and BOQ countability.";
  if (!previousDesignUrl) throw new Error("OpenAI correction requires the previous design image URL");
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: existing } = await supabase.from("designs").select("*").eq("floor_id", floorId).order("version", { ascending: false }).limit(2);
  const latestDesign = (existing?.[0] as Design | undefined) ?? null;
  const version = ((existing?.[0] as Design | undefined)?.version ?? 0) + 1;
  const sourceImageUrl =
    floor.architectural_image_url ??
    (floor.architectural_image_path ? `data:image/png;base64,${await fetchStorageBase64(floor.architectural_image_path)}` : null);
  if (!sourceImageUrl) throw new Error("Floor has no original image source for OpenAI correction");
  const annotations = normalizeAnnotations((floor.ai_analysis as Record<string, unknown>)?.annotations, fallbackAnnotations());
  const legend = mergeLegendWithDefaults(DEFAULT_SYMBOL_LEGEND);
  const conversationHistory = await recentConversationContext(projectId, floorId);
  const projectCode = project.project_code ?? project.id.slice(0, 6).toUpperCase();
  const imagePath = `projects/${projectId}/floors/${floorId}/design-v${version}.png`;
  const requirements = {
    ai_analysis: floor.ai_analysis,
    architect_answers: floor.architect_answers,
    special_requirements: project.special_requirements,
    conversation_history: conversationHistory,
    architectural_image_url: floor.architectural_image_url,
    original_architectural_image_url: sourceImageUrl,
    previous_design: latestDesign,
    previous_design_image_url: previousDesignUrl,
    previous_boq_items: latestDesign?.boq_items ?? [],
    improvement_request: improvementRequest,
    main_supply_source: floor.architect_answers?.main_supply_source,
    correction_prompt: correctionPrompt,
    design_attempt: designAttempt,
    symbol_legend: latestDesign?.symbol_legend?.length ? latestDesign.symbol_legend : legend,
    annotations
  };

  console.log("[jobs:generate_design] OpenAI correction stage started", { jobId: job.id, projectId, floorId, version, attempt: designAttempt });
  const correctedImage = await createElectricalDesignWithOpenAI({
    projectName: project.project_name,
    projectCode,
    floorName: floor.floor_name,
    floorNumber: floor.floor_number,
    buildingPurpose: project.building_purpose,
    revision: version,
    sourceImageUrl: previousDesignUrl,
    originalPlanImageUrl: sourceImageUrl,
    mode: "correction",
    correctionPrompt,
    requirements
  });
  const cleanedImage = await improveDesignTextWithOpenAI(correctedImage, {
    projectName: project.project_name,
    floorName: floor.floor_name,
    revision: version,
    originalPlanImageUrl: sourceImageUrl,
    designerName: "OpenAI"
  });
  const designUrl = await uploadGeneratedImage(imagePath, cleanedImage);
  console.log("[jobs:generate_design] OpenAI correction image completed", { jobId: job.id, projectId, floorId, version, attempt: designAttempt, imagePath });

  const designPackage = await generateDesignPackageWithOpenAI({
    projectName: project.project_name,
    floorName: floor.floor_name,
    buildingPurpose: project.building_purpose,
    finalDesignImageUrl: designUrl,
    requirements: {
      ...requirements,
      final_design_image_url: designUrl,
      openai_qa_feedback: correctionPrompt
    }
  });
  if (!designPackage.boq_items.length) {
    throw new Error("OpenAI correction produced no BOQ items for the revised design");
  }

  const design = await saveGeneratedDesign({
    project,
    floor,
    projectId,
    floorId,
    version,
    designUrl,
    imagePath,
    annotations,
    symbolLegend: designPackage.symbol_legend.length ? designPackage.symbol_legend : legend,
    boqItems: designPackage.boq_items,
    improvementRequest,
    revisionNotes: `OpenAI corrected the design and BOQ from QA feedback: ${correctionPrompt}`,
    existing: (existing ?? []) as Design[],
    designOwner: "OpenAI"
  });

  await createDelayedJob(job.type, {
    projectId,
    floorId,
    improvementRequest,
    phase: "openai_qa",
    version,
    designAttempt,
    designId: design.id,
    designUrl,
    imagePath
  });
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
