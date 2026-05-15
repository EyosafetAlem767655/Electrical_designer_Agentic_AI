import { DEFAULT_SYMBOL_LEGEND } from "@/lib/constants";
import { getBaseUrl, getEnv } from "@/lib/env";
import { convertPdfToPngPages, createFloorPdf, createProjectPackagePdf } from "@/lib/pdf-utils";
import { getSupabaseAdmin } from "@/lib/supabase";
import { downloadTelegramFile, sendTelegramMessage } from "@/lib/telegram";
import { fetchStorageBase64, uploadProjectFile, uploadRemoteImage } from "@/lib/storage";
import { analyzeFloorPlan, fallbackAnnotations, generateDesignImage, generateQuestions, normalizeLegend } from "@/lib/xai";
import type { Design, Floor, Job, JobType, Project } from "@/types";

export async function createJob(type: JobType, payload: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("jobs").insert({ type, payload }).select("*").single();
  if (error) throw error;
  return data as Job;
}

export async function triggerJobProcessing() {
  const baseUrl = getBaseUrl();
  const secret = getEnv("JOB_SECRET") ?? getEnv("CRON_SECRET");
  try {
    await fetch(`${baseUrl}/api/jobs/process`, {
      method: "POST",
      headers: secret ? { "x-job-secret": secret } : undefined
    });
  } catch {
    // Cron/manual processing remains the durable fallback.
  }
}

async function claimNextJob() {
  const supabase = getSupabaseAdmin();
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
  const message = error instanceof Error ? error.message : String(error);
  const maxAttempts = 3;
  if (job.attempts >= maxAttempts) {
    await supabase.from("jobs").update({ status: "failed", error: message }).eq("id", job.id);
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

async function processAnalyzeFloor(job: Job) {
  const { projectId, floorId } = job.payload as { projectId: string; floorId: string };
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  if (!floor.architectural_image_path) throw new Error("Floor has no architectural image path");

  const imageBase64 = await fetchStorageBase64(floor.architectural_image_path);
  const analysis = await analyzeFloorPlan(imageBase64, { project, floor });
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
  const supabase = getSupabaseAdmin();
  const { project, floor } = await getProjectFloor(projectId, floorId);
  const { data: existing } = await supabase.from("designs").select("*").eq("floor_id", floorId).order("version", { ascending: false }).limit(2);
  const version = ((existing?.[0] as Design | undefined)?.version ?? 0) + 1;

  const image = await generateDesignImage({
    projectName: project.project_name,
    projectCode: project.project_code ?? project.id.slice(0, 6).toUpperCase(),
    floorName: floor.floor_name,
    floorNumber: floor.floor_number,
    buildingPurpose: project.building_purpose,
    companyName: project.company_name,
    revision: version,
    requirements: {
      ai_analysis: floor.ai_analysis,
      architect_answers: floor.architect_answers,
      special_requirements: project.special_requirements,
      architectural_image_url: floor.architectural_image_url,
      previous_design: existing?.[0] ?? null,
      improvement_request: improvementRequest
    }
  });

  const imagePath = `projects/${projectId}/floors/${floorId}/design-v${version}.png`;
  const designUrl = image.url ? await uploadRemoteImage(imagePath, image.url) : await uploadProjectFile(imagePath, Buffer.from(image.b64_json!, "base64"), "image/png");
  const annotations = Array.isArray((floor.ai_analysis as Record<string, unknown>)?.annotations)
    ? ((floor.ai_analysis as Record<string, unknown>).annotations as unknown[])
    : fallbackAnnotations();
  const legend = normalizeLegend((floor.ai_analysis as Record<string, unknown>)?.symbol_legend, DEFAULT_SYMBOL_LEGEND);

  const { data: design, error } = await supabase
    .from("designs")
    .insert({
      floor_id: floorId,
      version,
      design_image_url: designUrl,
      design_image_path: imagePath,
      annotations,
      symbol_legend: legend,
      improvement_request: improvementRequest ?? null
    })
    .select("*")
    .single();
  if (error) throw error;

  const keep = ((existing ?? []) as Design[]).slice(1).map((item) => item.id);
  if (keep.length) await supabase.from("designs").delete().in("id", keep);

  await supabase.from("files").insert({ project_id: projectId, floor_id: floorId, file_type: "electrical_design", storage_path: imagePath, public_url: designUrl });
  await supabase.from("floors").update({ status: "design_ready" }).eq("id", floorId);
  await supabase.from("bot_sessions").update({ state: "AWAITING_APPROVAL" }).eq("project_id", projectId);

  if (project.telegram_chat_id) {
    const message = `The electrical design for ${floor.floor_name} has been generated and sent to the engineering team for review. I'll notify you once it's approved.`;
    await sendTelegramMessage(project.telegram_chat_id, message);
    await supabase.from("conversations").insert({ project_id: projectId, floor_id: floorId, sender: "bot", message });
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
    if (job.type === "telegram_pdf") await processTelegramPdf(job);
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
