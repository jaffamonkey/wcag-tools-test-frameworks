from __future__ import annotations

from pathlib import Path
from service.tool_runner_common import run_node_tool


def run_pa11y(job_dir: Path, *, require_storage_state: bool = True) -> None:
    run_node_tool(
        job_dir,
        "pa11y_runner",
        "run_pa11y.js",
        log_name="pa11y.log",
        require_storage_state=require_storage_state,
        check=False,
    )