from __future__ import annotations
from pathlib import Path
import subprocess

def run_pa11y(job_dir: Path) -> None:
    storage_state = job_dir / "auth" / "storage_state.json"
    urls_file = job_dir / "input" / "urls.txt"
    logs_dir = job_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "pa11y.log"

    if not urls_file.exists():
        raise FileNotFoundError(f"Missing input URLs file: {urls_file}")

    # Pa11y uses its own config/actions path for auth, so storage_state is not required,
    # but keeping the job prepared/authenticated is still useful for consistency.
    if not storage_state.exists():
        print(f"Warning: storage state not found at {storage_state}; Pa11y will continue using its own login actions.")

    runner_dir = Path(__file__).resolve().parent.parent / "tool_runners" / "pa11y_runner"
    reports_dir = job_dir / "reports" / "pa11y"

    with log_file.open("w", encoding="utf-8") as fh:
        subprocess.run(["npm", "install"], cwd=runner_dir, check=True, stdout=fh, stderr=subprocess.STDOUT)

        result = subprocess.run(
            ["node", "run_pa11y.js", str(job_dir.resolve())],
            cwd=runner_dir,
            stdout=fh,
            stderr=subprocess.STDOUT,
        )

    # Service mode: if reports were produced, treat Pa11y as successful even if
    # pa11y-ci returned non-zero because findings exceeded threshold.
    if result.returncode != 0:
        report_files = list(reports_dir.glob("*.json"))
        if report_files:
            print(
                f"Pa11y returned exit code {result.returncode}, "
                f"but produced {len(report_files)} report file(s); treating as success for service mode."
            )
            return
        raise subprocess.CalledProcessError(result.returncode, result.args)