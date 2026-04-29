from __future__ import annotations
from pathlib import Path
from service.tool_runner_common import run_node_tool

def run_ibm(job_dir: Path) -> None:
    run_node_tool(job_dir, "ibm_runner", "run_ibm.js", log_name="ibm.log")