"use client";

import { RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";

type WebhookStatus = {
  ok: boolean;
  expectedUrl?: string;
  registeredUrl?: string | null;
  isRegistered?: boolean;
  needsRegistration?: boolean;
  hasBotToken?: boolean;
  hasSetupSecret?: boolean;
  hasWebhookSecret?: boolean;
  webhook?: {
    pending_update_count?: number;
    last_error_message?: string;
    max_connections?: number;
  };
  error?: string;
};

export function TelegramWebhookPanel() {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [busy, setBusy] = useState<"check" | "register" | null>(null);

  async function callSetup(method: "GET" | "POST") {
    setBusy(method === "GET" ? "check" : "register");
    const response = await fetch("/api/telegram/setup", { method, cache: "no-store" });
    const payload = (await response.json().catch(() => ({ ok: false, error: "Invalid JSON response" }))) as WebhookStatus;
    setStatus(payload);
    setBusy(null);
  }

  return (
    <div className="glass-panel rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-[#fffaf0]">Telegram Webhook</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#efe4d4]/62">
            Check the currently registered Telegram webhook and register this deployed app as the bot webhook.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NeonButton variant="ghost" disabled={busy !== null} onClick={() => callSetup("GET")}>
            <RefreshCw className="h-4 w-4" />
            Check Status
          </NeonButton>
          <NeonButton disabled={busy !== null} onClick={() => callSetup("POST")}>
            <Send className="h-4 w-4" />
            Register Webhook
          </NeonButton>
        </div>
      </div>

      {busy ? <p className="mt-4 text-sm text-[#efe4d4]/62">Telegram setup request is running...</p> : null}

      {status ? (
        <div className="mt-5 grid gap-3">
          <div className={status.ok ? "rounded border border-[#8fa37c]/28 bg-[#8fa37c]/10 p-3" : "rounded border border-rose-300/30 bg-rose-500/10 p-3"}>
            <p className="text-sm font-semibold text-[#fffaf0]">{status.ok ? (status.isRegistered ? "Webhook registered" : "Webhook needs registration") : "Webhook check failed"}</p>
            {status.error ? <p className="mt-1 text-sm text-rose-100/80">{status.error}</p> : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">Expected URL</p>
              <code className="mt-2 block break-all text-sm text-[#fffaf0]">{status.expectedUrl ?? "Unknown"}</code>
            </div>
            <div className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">Telegram URL</p>
              <code className="mt-2 block break-all text-sm text-[#fffaf0]">{status.registeredUrl ?? "Not registered"}</code>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Bot token", status.hasBotToken ? "Present" : "Missing"],
              ["Setup secret", status.hasSetupSecret ? "Present" : "Not set"],
              ["Webhook secret", status.hasWebhookSecret ? "Present" : "Not set"],
              ["Pending updates", String(status.webhook?.pending_update_count ?? 0)]
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-[#c6a171]/14 bg-white/[0.025] p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-[#c9b9a6]/48">{label}</p>
                <p className="mt-2 text-sm font-semibold text-[#fffaf0]">{value}</p>
              </div>
            ))}
          </div>

          {status.webhook?.last_error_message ? (
            <div className="rounded border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              Telegram last error: {status.webhook.last_error_message}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
