import { beforeEach, describe, expect, it, vi } from "vitest";

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
  fallbackAnnotations: vi.fn(),
  generateBoqItems: vi.fn(),
  generateDesignImage: vi.fn(),
  generateQuestions: vi.fn(),
  normalizeAnnotations: vi.fn(),
  normalizeLegend: vi.fn()
}));

vi.mock("@/lib/boq", () => ({
  fallbackBoqFromDesign: vi.fn()
}));

import { createTelegramImageJob } from "@/lib/jobs";

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
});
