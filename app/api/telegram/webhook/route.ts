import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/bot";
import { getEnv } from "@/lib/env";
import type { TelegramUpdate } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, route: "telegram-webhook", message: "Telegram webhook endpoint is alive. Telegram sends updates with POST." });
}

export async function POST(request: Request) {
  try {
    const secret = getEnv("TELEGRAM_WEBHOOK_SECRET");
    if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    const result = await handleTelegramUpdate(update);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Telegram webhook error", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Webhook failed" }, { status: 500 });
  }
}
