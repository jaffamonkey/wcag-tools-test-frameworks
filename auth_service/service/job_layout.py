from __future__ import annotations
from pathlib import Path
JOB_SUBDIRS = ["input", "auth", "reports", "analysis", "logs"]
def create_job_dirs(job_root: Path) -> None:
    job_root.mkdir(parents=True, exist_ok=True)
    for name in JOB_SUBDIRS:
        (job_root / name).mkdir(parents=True, exist_ok=True)
