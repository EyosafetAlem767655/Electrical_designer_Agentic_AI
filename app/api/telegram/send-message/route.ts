import { NextResponse } from "next/server";
import { z } from "zod";
import { proxyToBackend } from "@/lib/backend";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  chatId: z.union([z.string(), z.number()]),
  text: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const proxied = await proxyToBackend("/telegram/send-message", {
      method: "POST",
      body: JSON.stringify({ chat_id: input.chatId, text: input.text })
    });
    if (proxied) return NextResponse.json(proxied.body, { status: proxied.response.status });

    const result = await sendTelegramMessage(input.chatId, input.text);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to send message" }, { status: 400 });
  }
}
