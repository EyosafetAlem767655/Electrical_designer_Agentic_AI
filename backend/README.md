# Electrical Designer Agentic AI — Python Backend

Python (FastAPI) backend that replaces the Next.js TypeScript orchestration layer.
The Next.js app on Vercel remains the **frontend** (dashboard + architect-facing webapp);
this service owns the **agent loop**: Telegram bot, OpenAI design generation, deterministic
schematic rendering, and Supabase persistence.

## Why Python

- Pillow + numpy give us a deterministic renderer that does not depend on Node's `@napi-rs/canvas`.
- The reference design pipeline (in `professional_plan_designer_v9.py`) is Python.
- The OpenAI prompt has been re-written to give the model **engineering freedom** rather than
  micro-managing density/symbol counts — this is the pattern that produces strong results on
  the ChatGPT website but was previously throttled by the over-prescriptive prompt in the
  TS code.

## Design principles

1. **No image generation.** The model returns a strict JSON `PlanSpec`. Python draws the PNG.
2. **Open prompts.** The model receives the floor image, project context, and engineering
   principles — then it decides density, placement, and circuits as a human engineer would.
3. **Single source of truth.** `app/symbols.py` and `app/schemas.py` define the symbol
   vocabulary and JSON schema; the renderer and validator share them.
4. **Job queue lives in Supabase.** Same `jobs` table as the TS implementation, so the
   webapp can keep showing job status from its own Supabase reads.

## Layout

```
backend/
├── app/
│   ├── main.py              # FastAPI app
│   ├── config.py            # Settings (env)
│   ├── symbols.py           # Symbol vocabulary + BOQ template
│   ├── schemas.py           # Pydantic PlanSpec + JSON schema
│   ├── state_machine.py     # Bot parser helpers
│   ├── supabase_client.py   # Cached admin client
│   ├── storage.py           # Supabase storage upload / download
│   ├── telegram.py          # Telegram API
│   ├── bot.py               # Telegram state machine
│   ├── openai_client.py     # OpenAI Responses API (analysis + design + repair)
│   ├── renderer.py          # Deterministic Pillow renderer
│   ├── jobs.py              # Job worker (Supabase-backed queue)
│   └── routes/
│       ├── telegram.py
│       ├── jobs.py
│       ├── projects.py
│       └── ai.py
├── requirements.txt
├── Dockerfile
└── .env.example
```

## API contract (consumed by the Next.js frontend)

| Method | Path                           | Purpose                                          |
|--------|--------------------------------|--------------------------------------------------|
| GET    | `/healthz`                     | Liveness + which env vars are wired              |
| POST   | `/telegram/webhook`            | Telegram update receiver (set via setWebhook)    |
| POST   | `/telegram/setup`              | Idempotent setWebhook helper                     |
| POST   | `/telegram/send-message`       | Manual send                                      |
| POST   | `/jobs/process`                | Drain queued jobs (cron-friendly)                |
| POST   | `/jobs/{job_id}/retry`         | Retry a failed/stalled job                       |
| POST   | `/projects/init`               | Webapp creates a new project; returns invite link |
| GET    | `/projects/{id}`               | Project + floors + designs                       |
| POST   | `/projects/{id}/approve`       | Approve floor & advance to the next              |
| POST   | `/projects/{id}/revise`        | Queue a revision job for a floor                 |
| POST   | `/ai/analyze`                  | Ad-hoc vision pass for a single image            |
| POST   | `/ai/questions`                | Ad-hoc question generator                        |

## Running locally

```bash
cd backend
cp .env.example .env  # fill in OPENAI_API_KEY, SUPABASE_*, TELEGRAM_BOT_TOKEN
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then point Telegram's webhook at your tunnel (e.g. ngrok):

```bash
curl -X POST http://localhost:8000/telegram/setup \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://<your-tunnel>/telegram/webhook"}'
```

Drain the job queue from cron:

```bash
curl -X POST 'http://localhost:8000/jobs/process' -H "X-Job-Secret: $JOB_SECRET"
```

## Docker

```bash
docker build -t electrical-designer-backend ./backend
docker run -p 8000:8000 --env-file backend/.env electrical-designer-backend
```

## Wiring the Next.js frontend

Set `BACKEND_BASE_URL=https://<your-backend-host>` in the Vercel project,
then change the Next.js API routes (`app/api/...`) to proxy to the backend.
The frontend dashboard / webapp pages do not need changes — they read directly
from Supabase tables, which both services share.

The legacy TypeScript handlers under `lib/` can be removed once the proxy is in
place; they're left in the repo as a reference while the migration is rolled out.

## What changed from the TS implementation

1. **Prompt re-architected.** `openai_client.create_plan_spec` builds an open-ended,
   judgement-style prompt that lists engineering *principles* and trusts the model to
   decide density, placement, and circuit structure. The previous prompt was full of
   hard density rules (`Place SW only at control points`, `For basement parking, use
   enough FL fixtures...`) which suppressed the model's reasoning. Same JSON schema,
   same renderer, looser instructions = stronger designs.
2. **No DALL-E / image generation anywhere.** Confirmed by inspection: the TS code
   already removed it, but the entire path is now native Python so there is no
   accidental fallback to model-rendered art.
3. **Single language for the data path.** Validation (Pydantic), prompting, calling,
   rendering, and persisting all live in Python — fewer translation layers between
   the model's JSON and the rendered pixels.
