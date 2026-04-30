from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


def _load_job_config(job_dir: Path) -> dict:
    candidates = [
        job_dir / "incoming_job_config.json",
        job_dir / "input" / "job_config.json",
    ]
    for path in candidates:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _job_requires_auth(cfg: dict) -> bool:
    login_entry_url = str(cfg.get("login_entry_url") or "").strip()

    credentials = cfg.get("credentials") or {}
    username = str(credentials.get("username") or "").strip()
    password = str(credentials.get("password") or "").strip()

    return bool(login_entry_url or username or password)


def _resolve_runner_dir() -> Path:
    env_dir = os.environ.get("AXE_SCAN_REPO_DIR")
    if env_dir:
        path = Path(env_dir).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"AXE_SCAN_REPO_DIR does not exist: {path}")
        return path

    default = Path(__file__).resolve().parents[1] / "tool_runners" / "axe-scan"
    if not default.exists():
        raise FileNotFoundError(
            f"Could not find axe-scan repo at: {default}. "
            "Set AXE_SCAN_REPO_DIR to the correct folder."
        )
    return default.resolve()


def _find_axe_scan_command() -> list[str]:
    exe = shutil.which("axe-scan")
    if exe:
        return [exe, "run"]

    npx = shutil.which("npx")
    if npx:
        return [npx, "axe-scan", "run"]

    raise FileNotFoundError(
        "Could not find 'axe-scan' or 'npx'. Install axe-scan or make it available on PATH."
    )


def _normalize_urls_file(src: Path, dst: Path) -> int:
    raw_lines = src.read_text(encoding="utf-8").splitlines()
    clean_urls = [line.strip() for line in raw_lines if line.strip()]
    dst.write_text("\n".join(clean_urls), encoding="utf-8")
    return len(clean_urls)


def run_axe_scan(job_dir: Path) -> None:
    job_dir = job_dir.resolve()

    reports_dir = job_dir / "reports" / "axe-scan"
    logs_dir = job_dir / "logs"
    work_dir = job_dir / "tool_work" / "axe-scan"

    reports_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    log_path = logs_dir / "axe-scan.log"
    skipped_marker = reports_dir / "SKIPPED"

    job_cfg = _load_job_config(job_dir)
    if _job_requires_auth(job_cfg):
        skipped_marker.write_text(
            "axe-scan skipped because this job requires authentication.\n",
            encoding="utf-8",
        )
        return

    runner_dir = _resolve_runner_dir()
    urls_src = job_dir / "input" / "urls.txt"
    urls_dst = work_dir / "urls.txt"

    if not urls_src.exists():
        raise FileNotFoundError(f"urls.txt not found: {urls_src}")

    url_count = _normalize_urls_file(urls_src, urls_dst)
    if url_count == 0:
        raise RuntimeError(f"axe-scan received no valid URLs from: {urls_src}")

    config_src = runner_dir / "axe-scan.config.json"
    converter_src = runner_dir / "convert-csv-to-json-files.sh"

    if not config_src.exists():
        raise FileNotFoundError(f"Missing axe-scan.config.json in {runner_dir}")
    if not converter_src.exists():
        raise FileNotFoundError(f"Missing convert-csv-to-json-files.sh in {runner_dir}")

    shutil.copy2(config_src, work_dir / "axe-scan.config.json")
    shutil.copy2(converter_src, work_dir / "convert-csv-to-json-files.sh")

    os.chmod(work_dir / "convert-csv-to-json-files.sh", 0o755)

    # Clear previous generated artifacts in the work dir
    for old_json in work_dir.rglob("*.json"):
        if old_json.name != "axe-scan.config.json":
            old_json.unlink(missing_ok=True)
    csv_path = work_dir / "axe-results.csv"
    csv_path.unlink(missing_ok=True)

    axe_scan_cmd = _find_axe_scan_command()

    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(f"Running axe-scan in {work_dir}\n")
        fh.write(f"Using runner dir: {runner_dir}\n")
        fh.write(f"Normalized URL count: {url_count}\n")
        fh.write(f"Command: {' '.join(axe_scan_cmd)}\n")

        with csv_path.open("w", encoding="utf-8") as csv_fh:
            result = subprocess.run(
                axe_scan_cmd,
                cwd=str(work_dir),
                check=False,
                stdout=csv_fh,
                stderr=fh,
                text=True,
            )

        if result.returncode != 0:
            raise RuntimeError(f"axe-scan run failed with exit code {result.returncode}")

        convert_result = subprocess.run(
            ["bash", "convert-csv-to-json-files.sh"],
            cwd=str(work_dir),
            check=False,
            stdout=fh,
            stderr=fh,
            text=True,
        )

        if convert_result.returncode != 0:
            raise RuntimeError(
                f"convert-csv-to-json-files.sh failed with exit code {convert_result.returncode}"
            )

        json_candidates = [str(p) for p in work_dir.rglob("*.json")]
        fh.write("JSON candidates after conversion:\n")
        for candidate in json_candidates:
            fh.write(f"  {candidate}\n")

    copied = 0
    for json_file in sorted(work_dir.rglob("*.json")):
        if json_file.name == "axe-scan.config.json":
            continue
        shutil.copy2(json_file, reports_dir / json_file.name)
        copied += 1

    if csv_path.exists():
        shutil.copy2(csv_path, reports_dir / csv_path.name)

    if copied == 0:
        raise RuntimeError(
            f"axe-scan completed but produced no JSON reports under {work_dir}. "
            f"Check {log_path} and inspect the converter output."
        )