from __future__ import annotations
from pathlib import Path
import sys
import json

from service.tool_run_axe_core import run_axe_core
from service.tool_run_html_sniffer import run_html_sniffer
from service.tool_run_lighthouse import run_lighthouse
from service.tool_run_ibm import run_ibm
from service.tool_run_uuv import run_uuv
from service.tool_run_oobee import run_oobee

TOOLS = [
    ("axe-core", run_axe_core),
    ("html-sniffer", run_html_sniffer),
    ("lighthouse", run_lighthouse),
    ("ibm", run_ibm),
    ("uuv", run_uuv),
    ("oobee", run_oobee),
]

def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m service.run_all_compatible_tools <job_dir>")
        raise SystemExit(1)

    job_dir = Path(sys.argv[1])
    summary = {}

    for name, fn in TOOLS:
        try:
            fn(job_dir)
            summary[name] = {"status": "ok"}
        except Exception as exc:
            summary[name] = {"status": "error", "message": str(exc)}

    out = job_dir / "logs" / "tool_run_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Wrote tool run summary: {out}")

if __name__ == "__main__":
    main()
