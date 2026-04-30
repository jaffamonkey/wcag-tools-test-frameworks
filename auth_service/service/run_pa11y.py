from __future__ import annotations

from pathlib import Path
import sys

from service.tool_run_pa11y import run_pa11y


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_pa11y <job_dir>")
        raise SystemExit(1)

    job_dir = Path(sys.argv[1])
    run_pa11y(job_dir, require_storage_state=False)
    print("pa11y reports written under:", job_dir / "reports" / "pa11y")


if __name__ == "__main__":
    main()