from fastapi import APIRouter, Header, HTTPException, Request

from ..bot import handle_telegram_update
from ..config import get_settings
from ..telegram import ensure_webhook, send_message

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.get("/webhook")
async def webhook_health():
    settings = get_settings()
    return {
        "ok": True, "route": "telegram-webhook",
        "message": "Telegram webhook endpoint is alive. Telegram sends updates with POST.",
        "readiness": {
            "hasTelegramBotToken": bool(settings.telegram_bot_token),
            "hasSupabaseServerEnv": bool(settings.supabase_url and settings.supabase_service_role_key),
            "hasWebhookSecret": bool(settings.telegram_webhook_secret),
        },
    }


@router.post("/webhook")
async def webhook(request: Request,
                  x_telegram_bot_api_secret_token: str | None = Header(None,
                                                                       alias="X-Telegram-Bot-Api-Secret-Token")):
    settings = get_settings()
    if settings.telegram_webhook_secret and x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
    update = await request.json()
    try:
        return await handle_telegram_update(update)
    except Exception as e:
        return {"ok": False, "handled": False, "error": str(e)}


@router.post("/setup")
async def setup_webhook(payload: dict):
    """payload: {url, secret_token?}"""
    url = payload.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing 'url'")
    result = await ensure_webhook(url, payload.get("secret_token") or get_settings().telegram_webhook_secret or None)
    return {"ok": True, **result}


@router.post("/send-message")
async def send(payload: dict):
    chat_id = payload.get("chat_id"); text = payload.get("text")
    if not chat_id or not text:
        raise HTTPException(status_code=400, detail="Missing chat_id or text")
    result = await send_message(chat_id, text)
    return {"ok": True, "result": result}
