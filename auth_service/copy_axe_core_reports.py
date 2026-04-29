#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "Usage: python copy_axe_core_reports.py "
            "<auth_service_job_dir> <analysis_repo_dir>"
        )
        return 1

    job_dir = Path(sys.argv[1]).resolve()
    analysis_dir = Path(sys.argv[2]).resolve()

    src_dir = job_dir / "reports" / "axe-core"
    dst_dir = analysis_dir / "reports" / "axe-core"

    if not job_dir.exists():
        print(f"Job directory not found: {job_dir}")
        return 1

    if not src_dir.exists():
        print(f"Source axe-core reports folder not found: {src_dir}")
        print("Run the authenticated axe-core step first.")
        return 1

    if not analysis_dir.exists():
        print(f"Analysis repo directory not found: {analysis_dir}")
        return 1

    dst_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    removed = 0

    for existing in dst_dir.glob("*.json"):
        existing.unlink()
        removed += 1

    for src_file in sorted(src_dir.glob("*.json")):
        shutil.copy2(src_file, dst_dir / src_file.name)
        copied += 1

    print(f"Copied {copied} axe-core report file(s)")
    print(f"Cleared {removed} old file(s)")
    print(f"From: {src_dir}")
    print(f"To:   {dst_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
