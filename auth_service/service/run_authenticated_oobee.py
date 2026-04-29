from __future__ import annotations
from pathlib import Path
import sys
from service.tool_run_oobee import run_oobee

def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_authenticated_oobee <job_dir>")
        raise SystemExit(1)
    job_dir = Path(sys.argv[1])
    run_oobee(job_dir)
    print("oobee reports written under:", job_dir / "reports" / "oobee")

if __name__ == "__main__":
    main()
