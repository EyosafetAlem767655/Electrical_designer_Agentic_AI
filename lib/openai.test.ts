import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBoqItemsWithOpenAI, improveDesignTextWithOpenAI } from "@/lib/openai";

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
    expect(String(form.get("prompt"))).toContain("Do not redesign");
    expect(String(form.get("prompt"))).toContain("Do not create a new sheet, side panel, blank box");
  });

  it("uses OpenAI vision and structured JSON for BOQ from the final cleaned image", async () => {
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        category: "Lighting",
                        item: "LED luminaire",
                        specification: "230V AC LED fitting, IEC/EU compliant",
                        unit: "pcs",
                        quantity: 14,
                        standard: "EBCS, IEC 60598",
                        notes: "Counted from final cleaned design image; site verify final quantity"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        );
      })
    );

    const items = await generateBoqItemsWithOpenAI({
      projectName: "Nova Heights",
      floorName: "Ground Floor",
      finalDesignImageUrl: "https://example.com/final-cleaned.png",
      requirements: { rooms: ["Office"] }
    });

    expect(requests[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(requests[0].body.model).toBe("gpt-5.5");
    expect(JSON.stringify(requests[0].body.messages)).toContain("https://example.com/final-cleaned.png");
    expect(requests[0].body.response_format).toMatchObject({ type: "json_schema" });
    expect(items[0]).toMatchObject({ item: "LED luminaire", quantity: 14 });
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
