# Elec Nova Tech AI

Agentic electrical design dashboard and Telegram intake system for floor-by-floor building electrical installation design.

## Local Setup

1. Copy `.env.example` to `.env.local` and fill in real values.
2. Rotate any credentials that were ever pasted into chat or logs before production use.
3. Run `npm.cmd install`.
4. Apply `supabase/migrations/001_initial_schema.sql` in Supabase SQL editor.
5. Create a Supabase Storage bucket named `project-files`.
6. Enable Supabase Realtime on `projects`, `floors`, and `designs`.
7. Set `JOB_SECRET` and `CRON_SECRET` to the same strong value in production so Vercel Cron can process queued jobs.
8. Run `npm.cmd run dev`.

## Webhook

Register Telegram webhook after deployment:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TELEGRAM_WEBHOOK_BASE_URL/api/telegram/webhook\"}"
```

## Telegram Group Binding

Telegram invite links such as `https://t.me/+...` are stored only for admin reference. The Bot API cannot send messages to an invite link.

1. Add `@awolaibot` to the Telegram group.
2. Create the project in the dashboard.
3. Open the project and copy its `/bind PROJECT_CODE` command.
4. Send that command in the Telegram group.
5. The bot captures the real numeric group chat ID, stores it, and posts the architect handoff message.

## Notes

This v1 intentionally has no admin authentication. Do not expose it publicly until an auth gate is added.
