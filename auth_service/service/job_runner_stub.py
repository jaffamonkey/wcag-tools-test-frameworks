from __future__ import annotations
from pathlib import Path
import json
from auth.models import JobConfig, Credentials, SelectorHints
from auth.shared_login import run_shared_login
from service.job_layout import create_job_dirs

def load_job_config(path: Path) -> JobConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return JobConfig(
        login_entry_url=raw["login_entry_url"],
        target_urls=raw["target_urls"],
        credentials=Credentials(**raw["credentials"]),
        auth_mode=raw.get("auth_mode", "auto"),
        selectors=SelectorHints(**raw.get("selectors", {})),
        headless=raw.get("headless", True),
        timeout_ms=raw.get("timeout_ms", 20000),
    )

def prepare_job(job_dir: Path, config_path: Path) -> None:
    create_job_dirs(job_dir)
    config = load_job_config(config_path)
    (job_dir / "input" / "urls.txt").write_text("\n".join(config.target_urls) + "\n", encoding="utf-8")
    (job_dir / "input" / "job_config.json").write_text(config_path.read_text(encoding="utf-8"), encoding="utf-8")
    auth_result = run_shared_login(config, job_dir)
    status = {
        "auth_success": auth_result.success,
        "auth_method": auth_result.method,
        "final_url": auth_result.final_url,
        "storage_state_path": str(auth_result.storage_state_path) if auth_result.storage_state_path else None,
        "message": auth_result.message,
    }
    (job_dir / "status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
