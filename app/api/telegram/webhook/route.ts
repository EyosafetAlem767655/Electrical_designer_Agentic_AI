import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/bot";
import type { TelegramUpdate } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const update = (await request.json()) as TelegramUpdate;
    const result = await handleTelegramUpdate(update);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Telegram webhook error", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Webhook failed" }, { status: 500 });
  }
}
