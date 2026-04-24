from __future__ import annotations
from pathlib import Path
import sys
from service.tool_run_lighthouse import run_lighthouse
def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_authenticated_lighthouse <job_dir>")
        raise SystemExit(1)
    job_dir = Path(sys.argv[1])
    run_lighthouse(job_dir)
    print("lighthouse reports written under:", job_dir / "reports" / "lighthouse")
if __name__ == "__main__":
    main()
