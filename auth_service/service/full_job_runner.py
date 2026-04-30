from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from service.prepare_public_job import prepare_public_job


DEFAULT_TOOLS = [
    "axe-core",
    "axe-scan",
    "html-sniffer",
    "oobee",
    "lighthouse",
    "ibm",
    "uuv",
    "pa11y",
]

AUTH_TOOL_MODULES = {
    "axe-core": "service.run_authenticated_axe_core",
    "html-sniffer": "service.run_authenticated_html_sniffer",
    "oobee": "service.run_authenticated_oobee",
    "lighthouse": "service.run_authenticated_lighthouse",
    "ibm": "service.run_authenticated_ibm",
    "uuv": "service.run_authenticated_uuv",
    "pa11y": "service.run_authenticated_pa11y",
    "axe-scan": "service.run_axe_scan",
}

PUBLIC_TOOL_MODULES = {
    "axe-core": "service.run_axe_core",
    "html-sniffer": "service.run_html_sniffer",
    "oobee": "service.run_oobee",
    "lighthouse": "service.run_lighthouse",
    "ibm": "service.run_ibm",
    "uuv": "service.run_uuv",
    "pa11y": "service.run_pa11y",
    "axe-scan": "service.run_axe_scan",
}


def _run_command(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=False)


def _load_status(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def run_full_job(
    *,
    job_id: str,
    job_config: Path,
    auth_service_dir: Path,
    analysis_repo_dir: Path,
    tools: list[str] | None = None,
    skip_analysis: bool = False,
) -> dict:
    tools = tools or DEFAULT_TOOLS

    auth_service_dir = auth_service_dir.resolve()
    analysis_repo_dir = analysis_repo_dir.resolve()
    job_config = job_config.resolve()

    job_dir = auth_service_dir / "jobs" / job_id
    reports_dir = job_dir / "reports"
    analysis_dir = job_dir / "analysis"

    config_data = json.loads(job_config.read_text(encoding="utf-8"))
    credentials = config_data.get("credentials") or {}
    requires_auth = bool(config_data.get("login_entry_url")) and bool(
        credentials.get("username") or credentials.get("password")
    )

    tool_modules = AUTH_TOOL_MODULES if requires_auth else PUBLIC_TOOL_MODULES

    summary = {
        "job_id": job_id,
        "job_dir": str(job_dir),
        "job_config": str(job_config),
        "reports_dir": str(reports_dir),
        "analysis_dir": str(analysis_dir),
        "auth": {"status": "pending"},
        "tools": {},
        "analysis": {"status": "skipped" if skip_analysis else "pending"},
    }

    status_path = job_dir / "status.json"

    if requires_auth:
        prepare_cmd = [
            sys.executable,
            "run_job.py",
            f"jobs/{job_id}",
            str(job_config),
        ]
        prepare_result = _run_command(prepare_cmd, cwd=auth_service_dir)

        job_status = _load_status(status_path)

        if prepare_result.returncode != 0:
            summary["auth"] = {
                "status": "error",
                "returncode": prepare_result.returncode,
                "message": "run_job.py failed",
            }
            _write_summary(job_dir, summary)
            return summary

        if not job_status.get("auth_success"):
            summary["auth"] = {
                "status": "error",
                "message": job_status.get("message", "Authentication failed"),
            }
            _write_summary(job_dir, summary)
            return summary

        summary["auth"] = {
            "status": "ok",
            "message": job_status.get("message", "Authentication succeeded"),
            "final_url": job_status.get("final_url"),
        }
    else:
        job_status = prepare_public_job(job_dir, job_config)
        summary["auth"] = {
            "status": "skipped",
            "message": job_status.get("message", "Authentication not required"),
        }

    for tool in tools:
        module = tool_modules.get(tool)
        tool_reports_dir = reports_dir / tool
        skip_marker = tool_reports_dir / "SKIPPED"

        if not module:
            summary["tools"][tool] = {
                "status": "error",
                "message": f"Unknown tool: {tool}",
            }
            continue

        result = _run_command(
            [sys.executable, "-m", module, f"jobs/{job_id}"],
            cwd=auth_service_dir,
        )

        if skip_marker.exists():
            summary["tools"][tool] = {
                "status": "skipped",
                "message": skip_marker.read_text(encoding="utf-8").strip(),
                "reports_dir": str(tool_reports_dir),
            }
            continue

        report_count = len(list(tool_reports_dir.glob("*.json"))) if tool_reports_dir.exists() else 0

        if result.returncode == 0:
            summary["tools"][tool] = {
                "status": "ok",
                "report_count": report_count,
                "reports_dir": str(tool_reports_dir),
            }
        elif report_count > 0:
            summary["tools"][tool] = {
                "status": "partial",
                "returncode": result.returncode,
                "report_count": report_count,
                "reports_dir": str(tool_reports_dir),
                "message": "Tool returned non-zero but produced report files",
            }
        else:
            summary["tools"][tool] = {
                "status": "error",
                "returncode": result.returncode,
                "report_count": 0,
                "reports_dir": str(tool_reports_dir),
            }

    if not skip_analysis:
        analysis_cmd = [
            sys.executable,
            "run_job_analysis.py",
            "--reports-dir",
            str(reports_dir),
            "--output-dir",
            str(analysis_dir),
        ]
        analysis_result = _run_command(analysis_cmd, cwd=analysis_repo_dir)

        if analysis_result.returncode == 0:
            summary["analysis"] = {
                "status": "ok",
                "output_dir": str(analysis_dir),
                "dashboard": str(analysis_dir / "index.html"),
                "workbook": str(analysis_dir / "accessibility_analysis.xlsx"),
            }
        else:
            summary["analysis"] = {
                "status": "error",
                "returncode": analysis_result.returncode,
                "output_dir": str(analysis_dir),
            }

    _write_summary(job_dir, summary)
    return summary


def _write_summary(job_dir: Path, summary: dict) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    summary_path = job_dir / "full_job_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")