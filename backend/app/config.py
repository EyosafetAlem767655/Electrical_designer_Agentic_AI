from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    openai_api_key: str = ""
    openai_design_model: str = "gpt-5.5"
    openai_analysis_model: str = "gpt-5.5"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "project-files"

    telegram_bot_token: str = ""
    telegram_bot_username: str = "awolaibot"
    telegram_webhook_secret: str = ""

    job_secret: str = ""
    public_base_url: str = "http://localhost:8000"
    webapp_base_url: str = "http://localhost:3000"
    log_level: str = "INFO"

    def require(self, name: str) -> str:
        value = getattr(self, name, "")
        if not value:
            raise RuntimeError(f"Missing required env var: {name.upper()}")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
