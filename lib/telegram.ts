import { getEnv, requireEnv } from "@/lib/env";
import { normalizeTelegramUsername } from "@/lib/utils";

export type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

function telegramToken() {
  return requireEnv("TELEGRAM_BOT_TOKEN");
}

export async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram ${method} failed`);
  }

  return payload.result as T;
}

export async function setTelegramWebhook(url: string, secretToken?: string) {
  return telegramApi<true>("setWebhook", {
    url,
    allowed_updates: ["message"],
    ...(secretToken ? { secret_token: secretToken } : {})
  });
}

export async function getTelegramWebhookInfo() {
  return telegramApi<TelegramWebhookInfo>("getWebhookInfo");
}

export async function ensureTelegramWebhook(url: string, secretToken?: string) {
  const info = await getTelegramWebhookInfo();
  if (info.url === url) {
    return { changed: false, webhook: info };
  }
  await setTelegramWebhook(url, secretToken);
  return { changed: true, webhook: await getTelegramWebhookInfo() };
}

export async function sendTelegramMessage(chatId: number | string, text: string) {
  return telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export async function sendProjectInvite(groupChatId: number | string, architectUsername: string, architectName?: string | null) {
  const username = normalizeTelegramUsername(architectUsername);
  const botUsername = getEnv("TELEGRAM_BOT_USERNAME") ?? "awolaibot";
  const name = architectName?.trim() ? `${architectName.trim()} ` : "";
  return sendTelegramMessage(
    groupChatId,
    `Hello ${name}@${username}! I'm the Elec Nova Tech AI assistant. I've been assigned to help with an electrical design project. Please send me a direct message to get started. Tap @${botUsername} and press Start.`
  );
}

export async function getTelegramFile(fileId: string) {
  return telegramApi<{ file_id: string; file_unique_id: string; file_size?: number; file_path: string }>("getFile", {
    file_id: fileId
  });
}

export async function downloadTelegramFile(fileId: string) {
  const fileInfo = await getTelegramFile(fileId);
  const response = await fetch(`https://api.telegram.org/file/bot${telegramToken()}/${fileInfo.file_path}`);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filePath: fileInfo.file_path
  };
}
