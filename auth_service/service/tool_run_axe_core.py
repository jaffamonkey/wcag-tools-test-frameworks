from __future__ import annotations
from pathlib import Path
import subprocess
from pathlib import Path
import subprocess

def run_axe_core(job_dir: Path) -> None:
    storage_state = job_dir / "auth" / "storage_state.json"
    urls_file = job_dir / "input" / "urls.txt"

    if not urls_file.exists():
        raise FileNotFoundError(
            f"Missing input URLs file: {urls_file}. Run job preparation first."
        )

    if not storage_state.exists():
        raise FileNotFoundError(
            f"Missing authenticated storage state: {storage_state}. "
            f"Check jobs status, auth/login.log, and auth/login-result.png."
        )

    runner_dir = Path(__file__).resolve().parent.parent / "tool_runners" / "axe_core_runner"
    subprocess.run(["npm", "install"], cwd=runner_dir, check=True)
    subprocess.run(["node", "run_axe_core.js", str(job_dir.resolve())], cwd=runner_dir, check=True)
