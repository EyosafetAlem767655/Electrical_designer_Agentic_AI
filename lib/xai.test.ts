import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBoqItems, generateDesignImage, normalizeLegend } from "@/lib/xai";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("xAI image generation", () => {
  it("edits the source plan image without sending unsupported size", async () => {
    process.env.XAI_API_KEY = "xai-test";
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        if (String(url).endsWith("/responses")) {
          return new Response(JSON.stringify({ output_text: JSON.stringify({ approved: true, required_changes: [], risk_flags: [], prompt_additions: [] }) }), { status: 200 });
        }
        if (String(url).endsWith("/chat/completions")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "Lighting and socket coverage checklist" } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [{ url: "https://example.com/design.png" }] }), { status: 200 });
      })
    );

    const image = await generateDesignImage({
      projectName: "Nova Heights",
      projectCode: "NOVA123",
      floorName: "Ground Floor",
      floorNumber: 0,
      revision: 1,
      sourceImageUrl: "https://example.com/source-plan.png",
      requirements: { rooms: ["Lobby"] }
    });

    expect(image.url).toBe("https://example.com/design.png");
    expect(requests[0].url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.stringify(requests[0].body.messages)).toContain("room-by-room fluorescent lamp fixture placement");
    expect(JSON.stringify(requests[0].body.messages)).toContain("final pre-drawing completeness check");
    expect(requests[1].url).toBe("https://api.openai.com/v1/responses");
    expect(requests[1].body).toMatchObject({ model: "gpt-5.5", reasoning: { effort: "medium" } });
    expect(JSON.stringify(requests[1].body)).toContain("220-230V earthed socket outlets");
    expect(requests[2].url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.stringify(requests[2].body.messages)).toContain("reconciling Grok's draft with OpenAI's critique");
    expect(requests[3].url).toBe("https://api.x.ai/v1/images/edits");
    expect(requests[3].body).toMatchObject({
      model: "grok-imagine-image-quality",
      image: { url: "https://example.com/source-plan.png", type: "image_url" }
    });
    expect(requests[3].body).not.toHaveProperty("size");
    expect(String(requests[3].body.prompt)).toContain("Draw the electrical design only as an overlay directly on top of this same plan");
    expect(String(requests[3].body.prompt)).toContain("Preserve the original floor plan exactly");
    expect(String(requests[3].body.prompt)).toContain("Only add electrical overlay content");
    expect(String(requests[3].body.prompt)).toContain("Do not omit FL, S, or P devices");
    expect(String(requests[3].body.prompt)).toContain("Do not use leader-arrow");
    expect(String(requests[3].body.prompt)).toContain("compact");
    expect(String(requests[3].body.prompt)).toContain("Lighting and socket coverage checklist");
    expect(requests[4].url).toBe("https://api.x.ai/v1/images/edits");
    expect(String(requests[4].body.prompt)).toContain("TEXT READABILITY CORRECTION ONLY");
    expect(String(requests[4].body.prompt)).toContain("The original architectural floor plan is locked");
    expect(String(requests[4].body.prompt)).toContain("Do not add leader-arrow callouts");
    expect(String(requests[4].body.prompt)).toContain("Do not redraw the electrical design");
    expect(String(requests[4].body.prompt)).toContain("Do not create a new sheet, side panel, blank box");
  });

  it("keeps image edit prompts under xAI's 8000 character limit", async () => {
    process.env.XAI_API_KEY = "xai-test";
    process.env.OPENAI_API_KEY = "openai-test";
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        if (String(url).endsWith("/responses")) {
          return new Response(JSON.stringify({ output_text: JSON.stringify({ approved: true, required_changes: [], risk_flags: [], prompt_additions: [] }) }), { status: 200 });
        }
        if (String(url).endsWith("/chat/completions")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "A concise design plan ".repeat(300) } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [{ url: "https://example.com/design.png" }] }), { status: 200 });
      })
    );

    await generateDesignImage({
      projectName: "Very Large Project",
      projectCode: "LARGE123",
      floorName: "Basement",
      floorNumber: 0,
      revision: 1,
      sourceImageUrl: "https://example.com/source-plan.png",
      requirements: {
        special_requirements: "backup generator ".repeat(1000),
        architect_answers: { raw: "architect answer ".repeat(1000) },
        ai_analysis: {
          rooms: Array.from({ length: 200 }, (_, index) => `Room ${index}`),
          lighting_plan: Array.from({ length: 200 }, (_, index) => `Lighting plan item ${index} ` + "details ".repeat(20)),
          socket_outlet_plan: Array.from({ length: 200 }, (_, index) => `Socket plan item ${index} ` + "details ".repeat(20)),
          circuit_strategy: "circuit strategy ".repeat(1000),
          cable_route_strategy: "cable route strategy ".repeat(1000)
        }
      }
    });

    const imageEditPrompts = requests.filter((request) => request.url.endsWith("/images/edits")).map((request) => String(request.body.prompt));
    expect(imageEditPrompts).toHaveLength(2);
    expect(imageEditPrompts[0].length).toBeLessThanOrEqual(8000);
    expect(imageEditPrompts[1].length).toBeLessThanOrEqual(8000);
  });

  it("fails the design image pipeline when text cleanup fails", async () => {
    process.env.XAI_API_KEY = "xai-test";
    process.env.OPENAI_API_KEY = "openai-test";
    let imageCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/responses")) {
          return new Response(JSON.stringify({ output_text: JSON.stringify({ approved: true, required_changes: [], risk_flags: [], prompt_additions: [] }) }), { status: 200 });
        }
        if (String(url).endsWith("/chat/completions")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "Design plan" } }] }), { status: 200 });
        }
        imageCalls += 1;
        if (imageCalls === 1) {
          return new Response(JSON.stringify({ data: [{ url: "https://example.com/draft.png" }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "cleanup failed" } }), { status: 500 });
      })
    );

    await expect(
      generateDesignImage({
        projectName: "Nova Heights",
        projectCode: "NOVA123",
        floorName: "Ground Floor",
        floorNumber: 0,
        revision: 1,
        sourceImageUrl: "https://example.com/source-plan.png",
        requirements: { rooms: ["Lobby"] }
      })
    ).rejects.toThrow(/cleanup failed/);
  });

  it("generates Ethiopian IEC/EU BOQ items", async () => {
    process.env.XAI_API_KEY = "xai-test";
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
                  content: JSON.stringify([
                    {
                      category: "Power",
                      item: "Schuko socket outlet",
                      specification: "230V, 16A, Type F earthed outlet",
                      unit: "pcs",
                      quantity: 12,
                      standard: "EBCS, IEC 60884",
                      notes: "Final quantity site verified"
                    }
                  ])
                }
              }
            ]
          }),
          { status: 200 }
        );
      })
    );

    const items = await generateBoqItems({
      projectName: "Nova Heights",
      floorName: "Ground Floor",
      finalDesignImageUrl: "https://example.com/final-cleaned-design.png",
      requirements: { ai_analysis: { rooms: ["Office"], socket_outlet_plan: ["Four outlets"] } }
    });

    expect(requests[0].url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.stringify(requests[0].body.messages)).toContain("https://example.com/final-cleaned-design.png");
    expect(JSON.stringify(requests[0].body.messages)).toContain("This BOQ must be unique to this exact floor and this exact final design image");
    expect(JSON.stringify(requests[0].body.messages)).toContain("Count visible symbols and routes from the final cleaned drawing first");
    expect(JSON.stringify(requests[0].body.messages)).toContain("Do not count from the legend alone");
    expect(items[0]).toMatchObject({
      item: "Schuko socket outlet",
      specification: "230V, 16A, Type F earthed outlet",
      standard: "EBCS, IEC 60884"
    });
  });

  it("rejects placeholder all-1 BOQ quantities for final design images", async () => {
    process.env.XAI_API_KEY = "xai-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    { category: "Lighting", item: "Fluorescent lamp fixture", specification: "230V AC fluorescent fitting", unit: "pcs", quantity: 1, standard: "EBCS, IEC 60598", notes: "placeholder" },
                    { category: "Switching", item: "Manual wall switch", specification: "230V AC manual switch", unit: "pcs", quantity: 1, standard: "EBCS, IEC 60669", notes: "placeholder" },
                    { category: "Power", item: "Earthed socket outlet", specification: "230V, 16A outlet", unit: "pcs", quantity: 1, standard: "IEC 60884, EBCS", notes: "placeholder" }
                  ])
                }
              }
            ]
          }),
          { status: 200 }
        );
      })
    );

    await expect(
      generateBoqItems({
        projectName: "Nova Heights",
        floorName: "Basement",
        finalDesignImageUrl: "https://example.com/final-cleaned-design.png",
        requirements: { ai_analysis: { rooms: ["Parking"] } }
      })
    ).rejects.toThrow(/placeholder quantities/);
  });

  it("requires the final design image for BOQ generation", async () => {
    await expect(
      generateBoqItems({
        projectName: "Nova Heights",
        floorName: "Ground Floor",
        requirements: { ai_analysis: { rooms: ["Office"] } }
      })
    ).rejects.toThrow(/Final design image is required/);
  });

  it("keeps symbol legends to symbol meanings only", () => {
    const legend = normalizeLegend(
      [
        { symbol: "FL", label: "Fluorescent lamp fixture (230V, 2x36W) qty 12", description: "Long specification with quantities" },
        { symbol: "P", label: "Socket outlet: 16A Type F, count by room", description: "Another long note" }
      ],
      []
    );

    expect(legend).toEqual([
      { symbol: "FL", label: "Fluorescent lamp fixture", color: "#2f8178", description: "Fluorescent lamp fixture" },
      { symbol: "P", label: "Socket outlet", color: "#2f8178", description: "Socket outlet" }
    ]);
  });
});
