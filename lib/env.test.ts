import { afterEach, describe, expect, it } from "vitest";
import { getBaseUrl, getRequestBaseUrl } from "@/lib/env";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("environment URL helpers", () => {
  it("uses Telegram webhook base URL when configured", () => {
    process.env.TELEGRAM_WEBHOOK_BASE_URL = "https://example.com/";
    expect(getBaseUrl()).toBe("https://example.com");
  });

  it("falls back to Vercel URL with https", () => {
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;
    delete process.env.ORCHESTRATOR_URL;
    process.env.VERCEL_URL = "elec-nova.vercel.app";
    expect(getBaseUrl()).toBe("https://elec-nova.vercel.app");
  });

  it("uses orchestrator URL before Vercel URL", () => {
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;
    process.env.ORCHESTRATOR_URL = "https://orchestrator.example.com/";
    process.env.VERCEL_URL = "elec-nova.vercel.app";
    expect(getBaseUrl()).toBe("https://orchestrator.example.com");
  });

  it("derives request origin from forwarded Vercel headers", () => {
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;
    const request = new Request("http://internal.local/api/telegram/setup", {
      headers: {
        "x-forwarded-host": "elec-nova.vercel.app",
        "x-forwarded-proto": "https"
      }
    });

    expect(getRequestBaseUrl(request)).toBe("https://elec-nova.vercel.app");
  });

  it("uses localhost protocol for local requests", () => {
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;
    const request = new Request("http://localhost:3000/api/telegram/setup", {
      headers: {
        host: "localhost:3000"
      }
    });

    expect(getRequestBaseUrl(request)).toBe("http://localhost:3000");
  });
});
