from __future__ import annotations
from pathlib import Path
import subprocess

def run_node_tool(job_dir: Path, runner_dir_name: str, node_script: str, *, log_name: str) -> None:
    storage_state = job_dir / "auth" / "storage_state.json"
    urls_file = job_dir / "input" / "urls.txt"
    logs_dir = job_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / log_name

    if not urls_file.exists():
        raise FileNotFoundError(f"Missing input URLs file: {urls_file}")
    if not storage_state.exists():
        raise FileNotFoundError(f"Missing authenticated storage state: {storage_state}")

    runner_dir = Path(__file__).resolve().parent.parent / "tool_runners" / runner_dir_name

    with log_file.open("w", encoding="utf-8") as fh:
        subprocess.run(["npm", "install"], cwd=runner_dir, check=True, stdout=fh, stderr=subprocess.STDOUT)
        subprocess.run(["node", "--max-old-space-size=8192", "--expose-gc", node_script, str(job_dir.resolve())], cwd=runner_dir, check=True, stdout=fh, stderr=subprocess.STDOUT)
