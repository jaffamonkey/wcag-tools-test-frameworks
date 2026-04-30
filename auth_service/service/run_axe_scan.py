from __future__ import annotations

import sys
from pathlib import Path

from service.tool_run_axe_scan import run_axe_scan


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python -m service.run_axe_scan <job_dir>")

    job_dir = Path(sys.argv[1]).resolve()
    run_axe_scan(job_dir)


if __name__ == "__main__":
    main()