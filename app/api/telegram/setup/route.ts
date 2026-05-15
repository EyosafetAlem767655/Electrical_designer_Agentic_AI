import { NextResponse } from "next/server";
import { getBaseUrl, getEnv } from "@/lib/env";
import { getTelegramWebhookInfo, setTelegramWebhook } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = getEnv("TELEGRAM_SETUP_SECRET") ?? getEnv("JOB_SECRET") ?? getEnv("CRON_SECRET");
  if (!secret) return true;
  const setupHeader = request.headers.get("x-setup-secret");
  const authHeader = request.headers.get("authorization");
  return setupHeader === secret || authHeader === `Bearer ${secret}`;
}

function webhookUrl() {
  return `${getBaseUrl().replace(/\/$/, "")}/api/telegram/webhook`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ ok: true, expectedUrl: webhookUrl(), webhook: info });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to read Telegram webhook" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = webhookUrl();
    await setTelegramWebhook(url);
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ ok: true, url, webhook: info });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to register Telegram webhook" }, { status: 500 });
  }
}
