from functools import lru_cache
from supabase import create_client, Client

from .config import get_settings


@lru_cache
def get_supabase() -> Client:
    settings = get_settings()
    url = settings.require("supabase_url")
    key = settings.require("supabase_service_role_key")
    return create_client(url, key)
