from __future__ import annotations

import json
from pathlib import Path


def prepare_public_job(job_dir: Path, config_path: Path) -> dict:
    job_dir.mkdir(parents=True, exist_ok=True)

    input_dir = job_dir / "input"
    auth_dir = job_dir / "auth"
    logs_dir = job_dir / "logs"
    reports_dir = job_dir / "reports"

    input_dir.mkdir(parents=True, exist_ok=True)
    auth_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    config = json.loads(config_path.read_text(encoding="utf-8"))
    target_urls = config.get("target_urls", [])

    urls_file = input_dir / "urls.txt"
    urls_file.write_text("\n".join(target_urls) + "\n", encoding="utf-8")

    status = {
        "job_id": config.get("job_id"),
        "auth_required": False,
        "auth_success": True,
        "message": "Public job prepared without authentication",
        "target_url_count": len(target_urls),
    }

    status_path = job_dir / "status.json"
    status_path.write_text(json.dumps(status, indent=2), encoding="utf-8")

    return status