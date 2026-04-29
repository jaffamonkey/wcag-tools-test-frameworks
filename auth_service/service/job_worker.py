from __future__ import annotations

import json
from datetime import datetime, UTC
from pathlib import Path

from service.full_job_runner import DEFAULT_TOOLS, run_full_job
from service.job_db import update_job


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def run_job_in_background(
    *,
    job_id: str,
    auth_service_dir: Path,
    analysis_repo_dir: Path,
    job_config_path: Path,
    tools: list[str] | None = None,
) -> None:
    update_job(job_id, status="running", updated_at=utc_now())

    try:
        summary = run_full_job(
            job_id=job_id,
            job_config=job_config_path,
            auth_service_dir=auth_service_dir,
            analysis_repo_dir=analysis_repo_dir,
            tools=tools or DEFAULT_TOOLS,
            skip_analysis=False,
        )

        summary_path = auth_service_dir / "jobs" / job_id / "full_job_summary.json"
        ANALYSIS_BASE_URL = "http://127.0.0.1:8000"

        dashboard_url = f"{ANALYSIS_BASE_URL}/jobs/{job_id}/dashboard"
        workbook_url = f"{ANALYSIS_BASE_URL}/jobs/{job_id}/workbook"

        has_error = (
            summary.get("auth", {}).get("status") == "error"
            or summary.get("analysis", {}).get("status") == "error"
            or any(v.get("status") == "error" for v in summary.get("tools", {}).values())
        )

        update_job(
            job_id,
            status="failed" if has_error else "completed",
            updated_at=utc_now(),
            dashboard_url=dashboard_url,
            workbook_url=workbook_url,
            summary_path=str(summary_path),
            error_message=None if not has_error else json.dumps(summary),
        )
    except Exception as exc:
        update_job(
            job_id,
            status="failed",
            updated_at=utc_now(),
            error_message=str(exc),
        )