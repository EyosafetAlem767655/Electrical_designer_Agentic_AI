# Agent Operating Brief

This repo is an agentic electrical design dashboard for Elec Nova Tech. Work should preserve the floor-by-floor workflow:

1. Admin creates a project assignment in the dashboard.
2. The Telegram bot verifies the architect by full name and project name.
3. The bot collects building purpose, floor count, floor names, special requirements, and one architectural PDF per floor.
4. Jobs convert the PDF, analyze the first page, ask clarification questions, generate the electrical design image, and store artifacts in Supabase.
5. Engineering review approves the floor, requests a revision, exports a floor PDF, or compiles the final package.

## Working Rules

- Keep the dashboard private until authentication is added.
- Treat Telegram webhook setup as an operational dependency. `/telegram` and `/api/telegram/setup` are the supported status/register mechanisms.
- Prefer server-side Supabase access through `getSupabaseAdmin()` and keep clients lazily initialized.
- Long-running or external work belongs in the job queue, not directly in UI routes.
- Preserve the bot state machine in `lib/bot.ts`; add states only when the Telegram conversation requires them.
- Keep xAI calls centralized in `lib/xai.ts`.
- Keep generated files in Supabase Storage under `projects/{projectId}/...`.
- Validate request bodies with Zod in route handlers.
- Do not expose service role keys or Telegram tokens to client components.

## Required Checks

Before considering a change complete, run:

```bash
npm.cmd run verify
```

The pre-commit hook also runs this command when Husky is installed with `npm.cmd run prepare`.
