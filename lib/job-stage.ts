import type { Job } from "@/types";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function describeJobStage(job?: Pick<Job, "type" | "status" | "payload" | "attempts" | "error"> | null) {
  if (!job) return null;
  const phase = text(job.payload?.phase);
  const designAttempt = number(job.payload?.designAttempt);
  const version = number(job.payload?.version);
  const revision = version ? `v${version}` : null;

  if (job.type === "generate_design" || job.type === "revision_design") {
    if (phase === "qa_design") {
      return {
        label: "Grok requirement check",
        detail: [revision, designAttempt ? `attempt ${designAttempt}` : null, "checking lamps, switches, sockets, DB, routes"].filter(Boolean).join(" - ")
      };
    }
    if (phase === "finalize_design") {
      return {
        label: "BOQ and final save",
        detail: [revision, "counting final approved drawing and saving design"].filter(Boolean).join(" - ")
      };
    }
    if (designAttempt && designAttempt > 1) {
      return {
        label: "OpenAI correction generation",
        detail: [revision, `attempt ${designAttempt}`, "OpenAI applies Grok checklist corrections"].filter(Boolean).join(" - ")
      };
    }
    return {
      label: "OpenAI design generation",
      detail: [revision, job.type === "revision_design" ? "OpenAI revision overlay, Grok checks requirements" : "OpenAI electrical overlay, Grok checks requirements"].filter(Boolean).join(" - ")
    };
  }

  if (job.type === "analyze_floor") return { label: "Grok floor-plan analysis", detail: "reading rooms, loads, and clarification questions" };
  if (job.type === "telegram_pdf") return { label: "Floor-plan PDF intake", detail: "downloading and converting architectural PDF" };
  if (job.type === "telegram_image") return { label: "Floor-plan image intake", detail: "downloading uploaded architectural image" };
  if (job.type === "pdf_export") return { label: "Floor PDF export", detail: "rendering approved floor package" };
  if (job.type === "pdf_compile") return { label: "Final package compile", detail: "combining approved floors into one package" };
  return { label: job.type, detail: job.status };
}
