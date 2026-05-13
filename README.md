# Elec Nova Tech AI

Agentic electrical design dashboard and Telegram intake system for floor-by-floor building electrical installation design.

## Local Setup

1. Copy `.env.example` to `.env.local` and fill in real values.
2. Rotate any credentials that were ever pasted into chat or logs before production use.
3. Run `npm.cmd install`.
4. Apply `supabase/migrations/001_initial_schema.sql` in Supabase SQL editor.
5. Create a Supabase Storage bucket named `project-files`.
6. Enable Supabase Realtime on `projects`, `floors`, and `designs`.
7. Run `npm.cmd run dev`.

## Webhook

Register Telegram webhook after deployment:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TELEGRAM_WEBHOOK_BASE_URL/api/telegram/webhook\"}"
```

## Notes

This v1 intentionally has no admin authentication. Do not expose it publicly until an auth gate is added.
