# Elec Nova Tech AI

Agentic electrical design dashboard and Telegram intake system for floor-by-floor building electrical installation design.

## Local Setup

1. Copy `.env.example` to `.env.local` and fill in real values.
2. Rotate any credentials that were ever pasted into chat or logs before production use.
3. Run `npm.cmd install`.
4. Apply `supabase/migrations/001_initial_schema.sql` in Supabase SQL editor.
5. Create a Supabase Storage bucket named `project-files`.
6. Enable Supabase Realtime on `projects`, `floors`, and `designs`.
7. Set `JOB_SECRET` and `CRON_SECRET` to the same strong value in production. The app triggers queued jobs when they are created, and the Hobby-compatible daily cron is only a fallback.
8. Run `npm.cmd run dev`.

## Webhook

Register Telegram webhook after deployment:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TELEGRAM_WEBHOOK_BASE_URL/api/telegram/webhook\"}"
```

## Telegram Architect Intake

Default flow:

1. Create the project in the dashboard with company name, architect full name, and project name.
2. Open the project page and send the bot start link to the architect.
3. The architect clicks Start.
4. The bot asks for full name and project name.
5. If both match the project record, the floor-by-floor intake continues.

Optional group binding is still supported with `/bind PROJECT_CODE`, but Telegram Bot API cannot send messages directly to invite links such as `https://t.me/+...`.

## Notes

This v1 intentionally has no admin authentication. Do not expose it publicly until an auth gate is added.
