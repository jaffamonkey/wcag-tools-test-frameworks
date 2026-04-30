from __future__ import annotations

import os
import subprocess
from pathlib import Path


def run_node_tool(
    job_dir: Path,
    runner_dir_name: str,
    node_script: str,
    *,
    log_name: str,
    require_storage_state: bool = True,
    check: bool = True,
) -> None:
    job_dir = job_dir.resolve()

    storage_state = job_dir / "auth" / "storage_state.json"
    logs_dir = job_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / log_name

    if require_storage_state and not storage_state.exists():
        raise FileNotFoundError(f"Missing authenticated storage state: {storage_state}")

    env = os.environ.copy()
    if storage_state.exists():
        env["STORAGE_STATE_PATH"] = str(storage_state)
    else:
        env.pop("STORAGE_STATE_PATH", None)

    auth_service_dir = Path(__file__).resolve().parents[1]
    runner_dir = auth_service_dir / "tool_runners" / runner_dir_name

    if not runner_dir.exists():
        raise FileNotFoundError(f"Runner directory not found: {runner_dir}")

    script_path = runner_dir / node_script
    if not script_path.exists():
        raise FileNotFoundError(f"Runner script not found: {script_path}")

    with log_path.open("a", encoding="utf-8") as fh:
        subprocess.run(
            ["node", node_script, str(job_dir)],
            cwd=runner_dir,
            check=check,
            stdout=fh,
            stderr=subprocess.STDOUT,
            env=env,
        )