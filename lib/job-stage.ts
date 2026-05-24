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
    if (phase === "openai_qa") {
      return {
        label: "OpenAI QA review",
        detail: [revision, designAttempt ? `attempt ${designAttempt}` : null, "checking readability, symbols, legend, BOQ, and defaults"].filter(Boolean).join(" - ")
      };
    }
    if (phase === "openai_readability") {
      return {
        label: "OpenAI text/symbol cleanup",
        detail: [revision, "cleaning blurry labels and cut symbols"].filter(Boolean).join(" - ")
      };
    }
    if (designAttempt && designAttempt > 1) {
      return {
        label: "Programmatic schematic correction",
        detail: [revision, `attempt ${designAttempt}`, "rendering QA feedback with updated BOQ"].filter(Boolean).join(" - ")
      };
    }
    if (phase === "final_save") {
      return {
        label: "Saving reviewed design",
        detail: [revision, "storing drawing, legend, and OpenAI BOQ"].filter(Boolean).join(" - ")
      };
    }
    if (phase === "openai_design" || !phase) {
      return {
        label: "AI-planned schematic + BOQ",
        detail: [revision, job.type === "revision_design" ? "OpenAI planned revision, code-rendered overlay, structured legend, and BOQ" : "OpenAI planned layout, code-rendered overlay, structured legend, and BOQ"].filter(Boolean).join(" - ")
      };
    }
    return {
      label: "AI-planned schematic + BOQ",
      detail: [revision, "AI planning with controlled code rendering"].filter(Boolean).join(" - ")
    };
  }

  if (job.type === "analyze_floor") return { label: "Grok floor-plan analysis", detail: "reading rooms, loads, and clarification questions" };
  if (job.type === "telegram_pdf") return { label: "Floor-plan PDF intake", detail: "downloading and converting architectural PDF" };
  if (job.type === "telegram_image") return { label: "Floor-plan image intake", detail: "downloading uploaded architectural image" };
  if (job.type === "pdf_export") return { label: "Floor PDF export", detail: "rendering approved floor package" };
  if (job.type === "pdf_compile") return { label: "Final package compile", detail: "combining approved floors into one package" };
  return { label: job.type, detail: job.status };
}
