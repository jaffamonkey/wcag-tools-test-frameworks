from __future__ import annotations

import argparse
from pathlib import Path

from service.full_job_runner import DEFAULT_TOOLS, run_full_job


def main() -> int:
    parser = argparse.ArgumentParser(description="Run full accessibility job: auth, tools, analysis.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--job-config", required=True)
    parser.add_argument("--auth-service-dir", default=".")
    parser.add_argument("--analysis-repo-dir", required=True)
    parser.add_argument("--tools", nargs="*", default=DEFAULT_TOOLS)
    parser.add_argument("--skip-analysis", action="store_true")
    args = parser.parse_args()

    summary = run_full_job(
        job_id=args.job_id,
        job_config=Path(args.job_config),
        auth_service_dir=Path(args.auth_service_dir),
        analysis_repo_dir=Path(args.analysis_repo_dir),
        tools=args.tools,
        skip_analysis=args.skip_analysis,
    )

    print(summary)

    if summary["auth"]["status"] == "error":
        return 1
    if summary["analysis"]["status"] == "error":
        return 1
    if any(v.get("status") == "error" for v in summary["tools"].values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())