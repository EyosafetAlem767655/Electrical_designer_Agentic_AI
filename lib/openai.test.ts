import { afterEach, describe, expect, it, vi } from "vitest";
import { createElectricalDesignWithOpenAI, improveDesignTextWithOpenAI, reviewDesignPlanWithOpenAI } from "@/lib/openai";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("OpenAI design finishing", () => {
  it("creates the electrical design image directly with OpenAI for Grok QA", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "https://example.com/plan.png") {
          return new Response(Buffer.from("fake-plan"), { status: 200, headers: { "content-type": "image/png" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("design").toString("base64") }] }), { status: 200 });
      })
    );

    const image = await createElectricalDesignWithOpenAI({
      projectName: "Nova Heights",
      projectCode: "NOVA123",
      floorName: "Ground Floor",
      floorNumber: 0,
      buildingPurpose: "Office",
      revision: 1,
      sourceImageUrl: "https://example.com/plan.png",
      requirements: { rooms: ["Office"] }
    });

    expect(image.b64_json).toBe(Buffer.from("design").toString("base64"));
    expect(requests[1].url).toBe("https://api.openai.com/v1/images/edits");
    const form = requests[1].init?.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("input_fidelity")).toBe("high");
    expect(String(form.get("prompt"))).toContain("Create a professional Ethiopian/EBCS + IEC electrical installation drawing");
    expect(String(form.get("prompt"))).toContain("fluorescent lamp fixtures");
    expect(String(form.get("prompt"))).toContain("manual wall switches");
    expect(String(form.get("prompt"))).toContain("220-230V earthed socket outlets");
    expect(String(form.get("prompt"))).toContain("BOQ-countable");
  });

  it("reviews Grok design plans through the Responses API", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    process.env.OPENAI_REVIEW_MODEL = "gpt-5.5-review";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              approved: false,
              required_changes: ["Add missing socket outlets in offices"],
              risk_flags: ["BOQ counting risk"],
              prompt_additions: ["Use clear P labels for every 220-230V socket outlet"]
            })
          }),
          { status: 200 }
        );
      })
    );

    const review = await reviewDesignPlanWithOpenAI({
      projectName: "Nova Heights",
      floorName: "Ground Floor",
      buildingPurpose: "Office",
      requirements: { rooms: ["Office"] },
      grokPlan: "Office lighting only"
    });

    expect(review).toEqual({
      approved: false,
      required_changes: ["Add missing socket outlets in offices"],
      risk_flags: ["BOQ counting risk"],
      prompt_additions: ["Use clear P labels for every 220-230V socket outlet"]
    });
    expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(requests[0].init?.body ?? "{}")) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.5-review",
      reasoning: { effort: "medium" },
      text: { verbosity: "low" }
    });
    expect(JSON.stringify(body)).toContain("fluorescent lamp fixtures");
    expect(JSON.stringify(body)).toContain("manual wall switches");
    expect(JSON.stringify(body)).toContain("220-230V earthed socket outlets");
  });

  it("returns a conservative review when OpenAI review JSON is malformed", async () => {
    process.env.OPEN_AI_KEY = "openai-alias-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ output_text: "not json" }), { status: 200 });
      })
    );

    const review = await reviewDesignPlanWithOpenAI({
      projectName: "Nova Heights",
      floorName: "Ground Floor",
      requirements: {},
      grokPlan: "Plan"
    });

    expect(review.approved).toBe(false);
    expect(review.required_changes[0]).toMatch(/valid JSON/i);
    expect(review.prompt_additions.join(" ")).toContain("fluorescent lamp fixtures");
  });

  it("uses OpenAI image edits to professionalize the overlay while preserving the original plan", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "https://example.com/original-plan.png" || url === "https://example.com/draft.png") {
          return new Response(Buffer.from("fake-image"), { status: 200, headers: { "content-type": "image/png" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("final").toString("base64") }] }), { status: 200 });
      })
    );

    const image = await improveDesignTextWithOpenAI(
      { url: "https://example.com/draft.png" },
      { projectName: "Nova Heights", floorName: "Ground Floor", revision: 2, originalPlanImageUrl: "https://example.com/original-plan.png" }
    );

    expect(image.b64_json).toBe(Buffer.from("final").toString("base64"));
    expect(requests[2].url).toBe("https://api.openai.com/v1/images/edits");
    const form = requests[2].init?.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("input_fidelity")).toBe("high");
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(String(form.get("prompt"))).toContain("Professional electrical drafting readability and symbol check pass");
    expect(String(form.get("prompt"))).toContain("the first image is the locked original architectural floor plan");
    expect(String(form.get("prompt"))).toContain("Preserve the original architectural floor plan exactly");
    expect(String(form.get("prompt"))).toContain("Do not alter, redraw, restyle, crop");
    expect(String(form.get("prompt"))).toContain("Improve readability only");
    expect(String(form.get("prompt"))).toContain("Grok is the designer");
    expect(String(form.get("prompt"))).toContain("Do not create or keep an AI-drawn legend");
    expect(String(form.get("prompt"))).toContain("Ensure symbols remain standard and explainable by the dashboard legend");
    expect(String(form.get("prompt"))).toContain("Grok generates the BOQ");
    expect(String(form.get("prompt"))).toContain("side panel, large note box");
  });

  it("accepts OPEN_AI_KEY as the Vercel env alias", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPEN_AI_KEY = "openai-alias-test";
    let authHeader = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "https://example.com/draft.png") {
          return new Response(Buffer.from("fake-image"), { status: 200, headers: { "content-type": "image/png" } });
        }
        authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? "");
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("final").toString("base64") }] }), { status: 200 });
      })
    );

    await improveDesignTextWithOpenAI(
      { url: "https://example.com/draft.png" },
      { projectName: "Nova Heights", floorName: "Ground Floor", revision: 1 }
    );

    expect(authHeader).toBe("Bearer openai-alias-test");
  });
});
