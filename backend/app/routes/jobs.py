from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from .. import jobs
from ..config import get_settings

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _require_secret(secret: str | None) -> None:
    expected = get_settings().job_secret
    if expected and secret != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/process")
async def process(background: BackgroundTasks,
                  mode: str | None = None,
                  x_job_secret: str | None = Header(None, alias="X-Job-Secret"),
                  x_job_mode: str | None = Header(None, alias="X-Job-Mode")):
    _require_secret(x_job_secret)
    effective_mode = mode or x_job_mode or "foreground"
    if effective_mode == "background":
        background.add_task(jobs.process_jobs)
        return {"ok": True, "mode": "background"}
    return {"ok": True, **await jobs.process_jobs()}


@router.post("/{job_id}/retry")
async def retry(job_id: str,
                x_job_secret: str | None = Header(None, alias="X-Job-Secret")):
    _require_secret(x_job_secret)
    job = await jobs.retry_failed_job(job_id)
    return {"ok": True, "job": job}
