import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlanSpecWithOpenAI } from "@/lib/openai-plan-analyzer";
import { samplePlanSpec } from "@/lib/plan-schema.test";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("OpenAI plan analyzer", () => {
  it("uses Responses JSON schema with image input and never calls image generation", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const spec = samplePlanSpec();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return new Response(JSON.stringify({ output_text: JSON.stringify(spec) }), { status: 200 });
      })
    );

    const output = await createPlanSpecWithOpenAI({
      projectId: "project-1",
      floorId: "floor-1",
      projectName: "Nova Heights",
      floorName: "Basement",
      sourceImageUrl: "data:image/png;base64,ZmFrZQ==",
      feedback: { raw: "Generator in storage room" }
    });

    expect(output.equipment.map((item) => item.type)).toEqual(expect.arrayContaining(["MSU", "ATS", "DB", "G"]));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.stringify(requests[0].body)).toContain("input_image");
    expect(JSON.stringify(requests[0].body)).toContain("json_schema");
    expect(requests[0].url).not.toContain("/images/");
  });

  it("repairs invalid model JSON once", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const spec = samplePlanSpec();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ output_text: "{\"project\":{\"title\":\"bad\"}}" }), { status: 200 });
        return new Response(JSON.stringify({ output_text: JSON.stringify(spec) }), { status: 200 });
      })
    );

    const output = await createPlanSpecWithOpenAI({
      projectId: "project-1",
      floorId: "floor-1",
      projectName: "Nova Heights",
      floorName: "Basement",
      sourceImageUrl: "data:image/png;base64,ZmFrZQ==",
      feedback: { raw: "Use defaults" }
    });

    expect(calls).toBe(2);
    expect(output.boq.find((item) => item.symbol === "FL")?.quantity).toBe(2);
  });
});
