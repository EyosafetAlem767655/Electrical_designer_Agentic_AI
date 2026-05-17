import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDesignImage } from "@/lib/xai";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("xAI image generation", () => {
  it("edits the source plan image without sending unsupported size", async () => {
    process.env.XAI_API_KEY = "xai-test";
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
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
    expect(JSON.stringify(requests[0].body.messages)).toContain("room-by-room lighting coverage");
    expect(requests[1].url).toBe("https://api.x.ai/v1/images/edits");
    expect(requests[1].body).toMatchObject({
      model: "grok-imagine-image-quality",
      image: { url: "https://example.com/source-plan.png", type: "image_url" }
    });
    expect(requests[1].body).not.toHaveProperty("size");
    expect(String(requests[1].body.prompt)).toContain("Draw the electrical design directly on top of this same plan");
    expect(String(requests[1].body.prompt)).toContain("Lighting and socket coverage checklist");
    expect(requests[2].url).toBe("https://api.x.ai/v1/images/edits");
    expect(String(requests[2].body.prompt)).toContain("improve text and label readability only");
  });
});
