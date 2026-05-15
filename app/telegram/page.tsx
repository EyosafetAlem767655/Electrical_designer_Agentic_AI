import { Bot, ShieldCheck } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { TelegramWebhookPanel } from "@/components/ui/TelegramWebhookPanel";
import { getBaseUrl, getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function TelegramSetupPage() {
  const baseUrl = getBaseUrl();
  const setupSecretConfigured = Boolean(getEnv("TELEGRAM_SETUP_SECRET") ?? getEnv("JOB_SECRET") ?? getEnv("CRON_SECRET"));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="border-b border-[#c6a171]/14 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c9b9a6]/54">Bot Operations</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#fffaf0]">Telegram Setup</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#efe4d4]/66">
          Register the Telegram bot webhook against this deployment and inspect Telegram webhook status.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[310px_1fr]">
        <GlassPanel className="h-fit">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#d6b17d]/70" />
            <p className="text-lg font-semibold text-[#fffaf0]">Environment</p>
          </div>
          <div className="mt-4 space-y-3 text-sm leading-5 text-[#efe4d4]/64">
            <p>Base URL: {baseUrl}</p>
            <p>Bot token: {getEnv("TELEGRAM_BOT_TOKEN") ? "configured" : "missing"}</p>
            <p>Bot username: {getEnv("TELEGRAM_BOT_USERNAME") ?? "awolaibot"}</p>
          </div>
          <div className="mt-5 rounded border border-[#c6a171]/16 bg-white/[0.025] p-3 text-sm leading-5 text-[#efe4d4]/64">
            If `TELEGRAM_WEBHOOK_BASE_URL` is not set, the setup API derives the URL from Vercel request headers.
          </div>
          {!setupSecretConfigured ? (
            <div className="mt-3 rounded border border-rose-300/24 bg-rose-500/10 p-3 text-sm leading-5 text-rose-100">
              Add `TELEGRAM_SETUP_SECRET` before exposing this page publicly.
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded border border-[#8fa37c]/24 bg-[#8fa37c]/10 p-3 text-sm text-[#dfe8d7]">
              <ShieldCheck className="h-4 w-4" />
              Setup route is protected by a secret.
            </div>
          )}
        </GlassPanel>

        <TelegramWebhookPanel />
      </div>
    </div>
  );
}
