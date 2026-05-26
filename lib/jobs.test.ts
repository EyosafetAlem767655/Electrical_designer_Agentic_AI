import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const supabaseMock = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  responses: [] as Array<{ data: unknown; error: unknown }>
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        supabaseMock.inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => supabaseMock.responses.shift() ?? { data: null, error: new Error("No mocked response") }
          })
        };
      }
    })
  })
}));

vi.mock("@/lib/env", () => ({
  getBaseUrl: () => "http://localhost:3000",
  getEnv: () => undefined
}));

vi.mock("@/lib/pdf-utils", () => ({
  convertPdfToPngPages: vi.fn(),
  createFloorPdf: vi.fn(),
  createProjectPackagePdf: vi.fn()
}));

vi.mock("@/lib/telegram", () => ({
  downloadTelegramFile: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendTelegramPhoto: vi.fn()
}));

vi.mock("@/lib/storage", () => ({
  fetchStorageBase64: vi.fn(),
  uploadProjectFile: vi.fn(),
  uploadRemoteImage: vi.fn()
}));

vi.mock("@/lib/xai", () => ({
  analyzeFloorPlan: vi.fn(),
  fallbackAnnotations: vi.fn(),
  generateQuestions: vi.fn(),
  normalizeAnnotations: vi.fn()
}));

vi.mock("@/lib/openai-plan-analyzer", () => ({
  createPlanSpecWithOpenAI: vi.fn()
}));

vi.mock("@/lib/schematic-renderer", () => ({
  renderProgrammaticElectricalSchematic: vi.fn()
}));

vi.mock("@/lib/boq", () => ({
  fallbackBoqFromDesign: vi.fn()
}));

import { describeJobStage } from "@/lib/job-stage";
import { chooseDesignEditSource, createTelegramImageJob } from "@/lib/jobs";

describe("job enqueue helpers", () => {
  beforeEach(() => {
    supabaseMock.inserts.length = 0;
    supabaseMock.responses.length = 0;
  });

  it("creates a telegram_image job when the database schema supports it", async () => {
    const payload = { projectId: "project-1", floorId: "floor-1", fileId: "file-1", contentType: "image/png" };
    supabaseMock.responses.push({ data: { id: "job-1", type: "telegram_image", payload }, error: null });

    const job = await createTelegramImageJob(payload);

    expect(job).toMatchObject({ id: "job-1", type: "telegram_image" });
    expect(supabaseMock.inserts).toEqual([{ table: "jobs", row: { type: "telegram_image", payload } }]);
  });

  it("falls back to a legacy telegram_pdf image job when the new type constraint is missing", async () => {
    const payload = { projectId: "project-1", floorId: "floor-1", fileId: "file-1", contentType: "image/png" };
    supabaseMock.responses.push(
      { data: null, error: { message: 'new row violates check constraint "jobs_type_check"' } },
      { data: { id: "job-2", type: "telegram_pdf", payload: { ...payload, fileKind: "image" } }, error: null }
    );

    const job = await createTelegramImageJob(payload);

    expect(job).toMatchObject({ id: "job-2", type: "telegram_pdf" });
    expect(supabaseMock.inserts).toEqual([
      { table: "jobs", row: { type: "telegram_image", payload } },
      { table: "jobs", row: { type: "telegram_pdf", payload: { ...payload, fileKind: "image" } } }
    ]);
  });

  it("uses the original image for first designs and latest generated design for revisions", () => {
    expect(
      chooseDesignEditSource({
        originalImageUrl: "https://example.com/original-plan.png",
        previousDesignImageUrl: "https://example.com/design-v1.png"
      })
    ).toBe("https://example.com/original-plan.png");

    expect(
      chooseDesignEditSource({
        improvementRequest: "Make labels larger",
        originalImageUrl: "https://example.com/original-plan.png",
        previousDesignImageUrl: "https://example.com/design-v1.png"
      })
    ).toBe("https://example.com/design-v1.png");
  });

  it("uses OpenAI only for JSON plan specs and Python deterministic rendering for image artifacts", () => {
    const source = readFileSync(join(process.cwd(), "lib", "jobs.ts"), "utf8");
    const pipeline = source.slice(source.indexOf("async function processGenerateDesign"));

    expect(source).toContain("renderProgrammaticElectricalSchematic");
    expect(source).toContain("createPlanSpecWithOpenAI");
    expect(pipeline.indexOf("createPlanSpecWithOpenAI")).toBeGreaterThan(-1);
    expect(pipeline.indexOf("renderProgrammaticElectricalSchematic")).toBeGreaterThan(pipeline.indexOf("createPlanSpecWithOpenAI"));
    expect(pipeline.indexOf("renderProgrammaticElectricalSchematic")).toBeGreaterThan(-1);
    expect(pipeline.indexOf("uploadProjectFile")).toBeGreaterThan(pipeline.indexOf("renderProgrammaticElectricalSchematic"));
    expect(source).toContain("sendTelegramPhoto");
    expect(pipeline).not.toContain("sendTelegramDocument");
    expect(pipeline).not.toContain("pdfUrl");
    expect(pipeline).not.toContain("pdfBuffer");
    expect(source).not.toContain("createElectricalDesignWithOpenAI");
    expect(source).not.toContain("createSchematicRenderPlanWithOpenAI");
    expect(source).not.toContain("evaluateDesignImageWithOpenAI");
    expect(source).not.toContain("generateDesignPackageWithOpenAI");
    expect(source).not.toContain("improveDesignTextWithOpenAI");
    expect(source).not.toContain("generateDesignDraftImage");
    expect(source).not.toContain("generateDesignCorrectionDraftImage");
    expect(source).not.toContain("generateBoqItems");
    expect(source).not.toContain("async function processOpenAiFixStage");
  });

  it("labels design stages by programmatic render responsibility", () => {
    expect(
      describeJobStage({
        type: "generate_design",
        status: "processing",
        attempts: 1,
        error: null,
        payload: { phase: "plan_spec", version: 1 }
      })?.label
    ).toBe("JSON spec + deterministic render");

    expect(
      describeJobStage({
        type: "generate_design",
        status: "processing",
        attempts: 1,
        error: null,
        payload: { phase: "plan_spec", designAttempt: 2 }
      })?.label
    ).toBe("Deterministic plan revision");
  });
});
