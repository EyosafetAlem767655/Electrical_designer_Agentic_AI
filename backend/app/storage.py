import base64
import httpx

from .config import get_settings
from .supabase_client import get_supabase


def upload_project_file(path: str, data: bytes, content_type: str) -> str:
    settings = get_settings()
    supabase = get_supabase()
    bucket = settings.supabase_storage_bucket
    storage = supabase.storage.from_(bucket)
    storage.upload(
        path=path,
        file=data,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return storage.get_public_url(path)


def fetch_storage_base64(path: str) -> str:
    supabase = get_supabase()
    bucket = get_settings().supabase_storage_bucket
    blob = supabase.storage.from_(bucket).download(path)
    return base64.b64encode(blob).decode("utf-8")


def fetch_storage_bytes(path: str) -> bytes:
    supabase = get_supabase()
    bucket = get_settings().supabase_storage_bucket
    return supabase.storage.from_(bucket).download(path)


async def upload_remote_image(path: str, url: str) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    content_type = resp.headers.get("content-type", "image/png")
    return upload_project_file(path, resp.content, content_type)
