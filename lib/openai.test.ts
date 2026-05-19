import { afterEach, describe, expect, it, vi } from "vitest";
import { improveDesignTextWithOpenAI } from "@/lib/openai";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("OpenAI design finishing", () => {
  it("uses OpenAI image edits to fix text while preserving the drawing", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "https://example.com/draft.png") {
          return new Response(Buffer.from("fake-image"), { status: 200, headers: { "content-type": "image/png" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("final").toString("base64") }] }), { status: 200 });
      })
    );

    const image = await improveDesignTextWithOpenAI(
      { url: "https://example.com/draft.png" },
      { projectName: "Nova Heights", floorName: "Ground Floor", revision: 2 }
    );

    expect(image.b64_json).toBe(Buffer.from("final").toString("base64"));
    expect(requests[1].url).toBe("https://api.openai.com/v1/images/edits");
    const form = requests[1].init?.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(String(form.get("prompt"))).toContain("The original architectural floor plan is locked");
    expect(String(form.get("prompt"))).toContain("Do not alter, redraw, restyle, crop");
    expect(String(form.get("prompt"))).toContain("Do not redesign");
    expect(String(form.get("prompt"))).toContain("Do not create a new sheet, side panel, blank box");
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
