from typing import Any, Optional
from urllib.parse import quote
import httpx

from .config import get_settings
from .state_machine import normalize_telegram_username


def _token() -> str:
    return get_settings().require("telegram_bot_token")


async def telegram_api(method: str, body: Optional[dict] = None) -> Any:
    url = f"https://api.telegram.org/bot{_token()}/{method}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=body or {})
    try:
        payload = resp.json()
    except Exception:
        raise RuntimeError(f"Telegram {method} returned non-JSON: {resp.text[:200]}")
    if not resp.is_success or not payload.get("ok"):
        raise RuntimeError(payload.get("description") or f"Telegram {method} failed")
    return payload.get("result")


async def set_webhook(url: str, secret_token: Optional[str] = None) -> Any:
    body: dict = {"url": url, "allowed_updates": ["message"]}
    if secret_token:
        body["secret_token"] = secret_token
    return await telegram_api("setWebhook", body)


async def get_webhook_info() -> Any:
    return await telegram_api("getWebhookInfo")


async def ensure_webhook(url: str, secret_token: Optional[str] = None) -> dict:
    info = await get_webhook_info()
    if info.get("url") == url:
        return {"changed": False, "webhook": info}
    await set_webhook(url, secret_token)
    return {"changed": True, "webhook": await get_webhook_info()}


async def send_message(chat_id: int | str, text: str) -> Any:
    return await telegram_api("sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True})


async def send_photo(chat_id: int | str, photo: str, caption: Optional[str] = None) -> Any:
    body: dict = {"chat_id": chat_id, "photo": photo}
    if caption:
        body["caption"] = caption
    return await telegram_api("sendPhoto", body)


async def send_document(chat_id: int | str, document: str, caption: Optional[str] = None) -> Any:
    body: dict = {"chat_id": chat_id, "document": document}
    if caption:
        body["caption"] = caption
    return await telegram_api("sendDocument", body)


def project_start_link(project_code: Optional[str]) -> str:
    username = get_settings().telegram_bot_username
    base = f"https://t.me/{username}"
    if project_code:
        return f"{base}?start={quote(project_code)}"
    return base


async def send_project_invite(group_chat_id: int | str, architect_username: str,
                              architect_name: Optional[str], project_code: Optional[str]) -> Any:
    username = normalize_telegram_username(architect_username)
    name = f"{architect_name.strip()} " if architect_name and architect_name.strip() else ""
    link = project_start_link(project_code)
    return await send_message(
        group_chat_id,
        f"Hello {name}@{username}! I'm the Elec Nova Tech AI assistant. I've been assigned to help with an electrical design project. Please open this project link to continue: {link}",
    )


async def get_telegram_file(file_id: str) -> dict:
    return await telegram_api("getFile", {"file_id": file_id})


async def download_telegram_file(file_id: str) -> tuple[bytes, str]:
    info = await get_telegram_file(file_id)
    file_path = info["file_path"]
    url = f"https://api.telegram.org/file/bot{_token()}/{file_path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    return resp.content, file_path
