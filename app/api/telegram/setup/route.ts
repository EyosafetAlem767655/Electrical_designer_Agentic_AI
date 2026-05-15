import { NextResponse } from "next/server";
import { getEnv, getRequestBaseUrl } from "@/lib/env";
import { hasSupabaseServerEnv } from "@/lib/supabase";
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

function webhookUrl(request: Request) {
  return `${getRequestBaseUrl(request)}/api/telegram/webhook`;
}

function webhookSecret() {
  return getEnv("TELEGRAM_WEBHOOK_SECRET");
}

function setupStatus(request: Request, webhook: Awaited<ReturnType<typeof getTelegramWebhookInfo>>) {
  const expectedUrl = webhookUrl(request);
  return {
    expectedUrl,
    registeredUrl: webhook.url || null,
    isRegistered: webhook.url === expectedUrl,
    needsRegistration: webhook.url !== expectedUrl,
    hasBotToken: Boolean(getEnv("TELEGRAM_BOT_TOKEN")),
    hasInstallerBotToken: Boolean(getEnv("INSTALLER_TELEGRAM_BOT_TOKEN")),
    hasSetupSecret: Boolean(getEnv("TELEGRAM_SETUP_SECRET") ?? getEnv("JOB_SECRET") ?? getEnv("CRON_SECRET")),
    hasWebhookSecret: Boolean(webhookSecret()),
    hasSupabaseServerEnv: hasSupabaseServerEnv(),
    webhookEndpoint: `${expectedUrl.replace(/\/$/, "")}`,
    webhook
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ ok: true, ...setupStatus(request, info) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to read Telegram webhook" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = webhookUrl(request);
    await setTelegramWebhook(url, webhookSecret());
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({ ok: true, url, ...setupStatus(request, info) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to register Telegram webhook" }, { status: 500 });
  }
}
