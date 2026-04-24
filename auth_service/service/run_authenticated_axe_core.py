from __future__ import annotations
from pathlib import Path
import sys
from service.tool_run_axe_core import run_axe_core
def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_authenticated_axe_core <job_dir>")
        raise SystemExit(1)
    job_dir = Path(sys.argv[1])
    run_axe_core(job_dir)
    print("axe-core reports written under:", job_dir / "reports" / "axe-core")
if __name__ == "__main__":
    main()
