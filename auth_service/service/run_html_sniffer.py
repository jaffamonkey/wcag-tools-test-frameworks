from __future__ import annotations

from pathlib import Path
import sys

from service.tool_run_html_sniffer import run_html_sniffer


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_html_sniffer <job_dir>")
        raise SystemExit(1)

    job_dir = Path(sys.argv[1])
    run_html_sniffer(job_dir, require_storage_state=False)
    print("html-sniffer reports written under:", job_dir / "reports" / "html-sniffer")


if __name__ == "__main__":
    main()