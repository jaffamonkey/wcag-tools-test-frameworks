from __future__ import annotations
from pathlib import Path
import subprocess
def run_html_sniffer(job_dir: Path) -> None:
    runner_dir = Path(__file__).resolve().parent.parent / "tool_runners" / "htmlsniffer_runner"
    subprocess.run(["npm", "install"], cwd=runner_dir, check=True)
    subprocess.run(["node", "run_htmlsniffer.js", str(job_dir.resolve())], cwd=runner_dir, check=True)
