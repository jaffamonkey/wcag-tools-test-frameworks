from __future__ import annotations

from pathlib import Path

from service.tool_runner_common import run_node_tool


def run_uuv(job_dir: Path, *, require_storage_state: bool = True) -> None:
    run_node_tool(
        job_dir,
        "uuv_runner",
        "run_uuv.js",
        log_name="uuv.log",
        require_storage_state=require_storage_state,
    )