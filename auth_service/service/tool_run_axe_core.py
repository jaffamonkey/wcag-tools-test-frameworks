from __future__ import annotations

import os
import subprocess
from pathlib import Path


def run_axe_core(job_dir: Path, *, require_storage_state: bool = True) -> None:
    job_dir = job_dir.resolve()
    reports_dir = job_dir / "reports" / "axe-core"
    logs_dir = job_dir / "logs"
    reports_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    storage_state = job_dir / "auth" / "storage_state.json"
    if require_storage_state and not storage_state.exists():
        raise FileNotFoundError(
            f"Missing authenticated storage state: {storage_state}. "
            "Check jobs status, auth/login.log, and auth/login-result.png."
        )

    env = os.environ.copy()
    if storage_state.exists():
        env["STORAGE_STATE_PATH"] = str(storage_state)
    else:
        env.pop("STORAGE_STATE_PATH", None)

    auth_service_dir = Path(__file__).resolve().parents[1]
    runner_dir = auth_service_dir / "tool_runners" / "axe_core_runner"
    log_path = logs_dir / "axe-core.log"

    if not runner_dir.exists():
        raise FileNotFoundError(f"Runner directory not found: {runner_dir}")

    script_path = runner_dir / "run_axe_core.js"
    if not script_path.exists():
        raise FileNotFoundError(f"Runner script not found: {script_path}")

    with log_path.open("a", encoding="utf-8") as fh:
        subprocess.run(
            ["node", "run_axe_core.js", str(job_dir)],
            cwd=runner_dir,
            check=True,
            stdout=fh,
            stderr=subprocess.STDOUT,
            env=env,
        )