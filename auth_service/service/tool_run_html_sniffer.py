from __future__ import annotations
from pathlib import Path
from service.tool_runner_common import run_node_tool

def run_html_sniffer(job_dir: Path) -> None:
    run_node_tool(job_dir, "htmlsniffer_runner", "run_htmlsniffer.js", log_name="html-sniffer.log")
