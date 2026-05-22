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
  sendTelegramMessage: vi.fn()
}));

vi.mock("@/lib/storage", () => ({
  fetchStorageBase64: vi.fn(),
  uploadProjectFile: vi.fn(),
  uploadRemoteImage: vi.fn()
}));

vi.mock("@/lib/xai", () => ({
  analyzeFloorPlan: vi.fn(),
  evaluateFinalDesignImageWithGrok: vi.fn(),
  fallbackAnnotations: vi.fn(),
  generateBoqItems: vi.fn(),
  generateDesignDraftImage: vi.fn(),
  generateQuestions: vi.fn(),
  normalizeAnnotations: vi.fn(),
  normalizeLegend: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createElectricalDesignWithOpenAI: vi.fn(),
  evaluateDesignImageWithOpenAI: vi.fn(),
  improveDesignTextWithOpenAI: vi.fn()
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

  it("keeps the first-pass generate_design pipeline owned by Grok, then queues OpenAI QA", () => {
    const source = readFileSync(join(process.cwd(), "lib", "jobs.ts"), "utf8");
    const pipeline = source.slice(source.indexOf("async function processGenerateDesign"));

    expect(source).toContain('const phase = typeof job.payload.phase === "string" ? job.payload.phase : "grok_design"');
    expect(pipeline.indexOf("generateDesignDraftImage")).toBeGreaterThan(-1);
    expect(pipeline.indexOf("improveDesignTextWithOpenAI")).toBeGreaterThan(pipeline.indexOf("generateDesignDraftImage"));
    expect(pipeline.indexOf("generateBoqItems")).toBeGreaterThan(pipeline.indexOf("improveDesignTextWithOpenAI"));
    expect(pipeline.indexOf('phase: "openai_qa"')).toBeGreaterThan(pipeline.indexOf("generateBoqItems"));
    expect(source).toContain("async function processOpenAiFixStage");
    expect(source).toContain("createElectricalDesignWithOpenAI");
    expect(source).toContain("generateDesignPackageWithOpenAI");
    expect(source).toContain('phase: "openai_fix"');
  });

  it("labels design stages by actual Grok/OpenAI responsibility", () => {
    expect(
      describeJobStage({
        type: "generate_design",
        status: "processing",
        attempts: 1,
        error: null,
        payload: { phase: "grok_design", version: 1 }
      })?.label
    ).toBe("Grok design + BOQ");

    expect(
      describeJobStage({
        type: "generate_design",
        status: "processing",
        attempts: 1,
        error: null,
        payload: { phase: "openai_qa", version: 1, designAttempt: 1 }
      })?.label
    ).toBe("OpenAI QA review");

    expect(
      describeJobStage({
        type: "generate_design",
        status: "processing",
        attempts: 1,
        error: null,
        payload: { phase: "openai_fix", designAttempt: 2 }
      })?.label
    ).toBe("OpenAI critique correction");
  });
});
