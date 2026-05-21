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

## Environment Notes

Vercel environment variable names are case-sensitive. Use `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_BASE_URL` as the primary Telegram values. `INSTALLER_TELEGRAM_BOT_TOKEN`, `INSTALLER_WEBHOOK_BASE_URL`, and `ORCHESTRATOR_URL` are supported fallbacks, but the primary names are preferred.

The generation pipeline keeps model ownership explicit: Grok creates or revises the electrical design image directly on the floor plan and Grok generates the BOQ from that final image. OpenAI only performs the readability/text cleanup pass and a background QA check for blurry labels, cut symbols, symbol-legend consistency, mandatory fluorescent lamps, manual switches, 220-230V earthed socket outlets, DB/MSU clarity, and BOQ countability. The first Grok design is saved to the dashboard immediately after Grok BOQ generation; if OpenAI QA finds issues and the floor has not already been approved, one Grok correction pass is queued automatically.

BOQ generation is counted by Grok from the generated design image. Visible lamps, switches, sockets, DB/protection items, emergency/fire/data devices, and route allowances are counted from the drawing; uncertain cable/conduit lengths should be marked for site verification rather than replaced with generic template quantities.

Set `OPENAI_API_KEY` in Vercel; the existing alias `OPEN_AI_KEY` is also supported. Optional OpenAI overrides are `OPENAI_IMAGE_MODEL` (default `gpt-image-1.5`) for readability edits and `OPENAI_REVIEW_MODEL` (default `gpt-5.5`) for QA.

After adding or changing Vercel environment variables, redeploy the project so runtime functions receive the new values.

## Supabase Schema Reset

If project creation fails with a schema cache error such as `Could not find the 'architect_name' column of 'projects'`, the Supabase database has an incompatible pre-existing table. For a clean prototype database, run this destructive reset in the Supabase SQL editor:

```sql
-- Paste and run the full contents of:
-- supabase/reset_app_schema.sql
```

This drops and recreates only the app tables: `projects`, `floors`, `designs`, `conversations`, `files`, `bot_sessions`, and `jobs`. It also creates or updates the public `project-files` storage bucket.

After running it, open Supabase API settings and reload the schema cache if needed, then redeploy or retry project creation.

To remove all project data while keeping the schema, run `supabase/purge_app_data.sql` in the Supabase SQL editor.

## Webhook

You can register and inspect the Telegram webhook from the dashboard at `/telegram`.

If `TELEGRAM_SETUP_SECRET`, `JOB_SECRET`, or `CRON_SECRET` is configured, enter that value in the setup secret field on `/telegram` before pressing Check Status or Register Webhook.
The setup page keeps that secret in browser session storage, so it remains available while that tab is open.

Register Telegram webhook after deployment from the app:

```bash
curl -X POST "$TELEGRAM_WEBHOOK_BASE_URL/api/telegram/setup" \
  -H "x-setup-secret: $TELEGRAM_SETUP_SECRET"
```

Check current webhook status:

```bash
curl "$TELEGRAM_WEBHOOK_BASE_URL/api/telegram/setup" \
  -H "x-setup-secret: $TELEGRAM_SETUP_SECRET"
```

If `TELEGRAM_WEBHOOK_BASE_URL` is not configured, `/api/telegram/setup` derives the webhook origin from the incoming request headers, including Vercel's forwarded host/protocol headers.

The webhook endpoint returns readiness details from `GET /api/telegram/webhook`. If Telegram reports a previous `500 Internal Server Error`, redeploy this version and press Register Webhook again from `/telegram`.

If project creation fails while Supabase env vars are present, check the on-screen diagnostics. In production, `SUPABASE_SERVICE_ROLE_KEY` is recommended for server-side inserts; anon keys can fail when Row Level Security blocks writes.

Or register directly with Telegram:

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

## Testing

GitHub Actions runs the same verification suite on every push and pull request through `.github/workflows/verify.yml`.

Run the local verification suite before pushing changes:

```bash
npm.cmd run verify
```

The suite runs lint, unit tests, production build, and Playwright smoke tests. A Husky pre-commit hook runs the same command when the local hooks are installed with:

```bash
npm.cmd run prepare
```
