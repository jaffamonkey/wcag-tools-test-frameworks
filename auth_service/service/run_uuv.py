from __future__ import annotations

from pathlib import Path
import sys

from service.tool_run_uuv import run_uuv


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_uuv <job_dir>")
        raise SystemExit(1)

    job_dir = Path(sys.argv[1])
    run_uuv(job_dir, require_storage_state=False)
    print("uuv reports written under:", job_dir / "reports" / "uuv")


if __name__ == "__main__":
    main()