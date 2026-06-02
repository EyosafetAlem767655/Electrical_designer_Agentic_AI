import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import telegram as telegram_routes
from .routes import jobs as job_routes
from .routes import projects as project_routes
from .routes import ai as ai_routes


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

    app = FastAPI(
        title="Electrical Designer Agentic AI - Backend",
        version="1.0.0",
        description=("Python orchestration layer: Telegram bot, OpenAI plan-spec generation, "
                     "deterministic Pillow renderer, Supabase persistence."),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    @app.get("/")
    def root():
        return {
            "ok": True,
            "service": "electrical-designer-backend",
            "endpoints": [
                "GET  /healthz",
                "POST /telegram/webhook",
                "POST /telegram/setup",
                "POST /telegram/send-message",
                "POST /jobs/process",
                "POST /jobs/{job_id}/retry",
                "POST /projects/init",
                "GET  /projects/{project_id}",
                "POST /projects/{project_id}/approve",
                "POST /projects/{project_id}/revise",
                "POST /ai/analyze",
                "POST /ai/questions",
            ],
        }

    @app.get("/healthz")
    def healthz():
        return {
            "ok": True,
            "openai_configured": bool(settings.openai_api_key),
            "supabase_configured": bool(settings.supabase_url and settings.supabase_service_role_key),
            "telegram_configured": bool(settings.telegram_bot_token),
        }

    app.include_router(telegram_routes.router)
    app.include_router(job_routes.router)
    app.include_router(project_routes.router)
    app.include_router(ai_routes.router)

    return app


app = create_app()
