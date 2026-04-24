from pathlib import Path
import json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from service.job_runner_stub import prepare_job
from service.tool_run_axe_core import run_axe_core
from service.tool_run_html_sniffer import run_html_sniffer
from service.tool_run_lighthouse import run_lighthouse
from service.tool_run_ibm import run_ibm
from service.tool_run_uuv import run_uuv
from service.tool_run_oobee import run_oobee

app = FastAPI(title="Accessibility Service Starter")

class CredentialsModel(BaseModel):
    username: str
    password: str

class SelectorHintsModel(BaseModel):
    login_trigger: str | None = None
    username: str | None = None
    password: str | None = None
    submit: str | None = None
    success: str | None = None
    logged_in_text: str | None = None

class JobRequest(BaseModel):
    job_id: str
    login_entry_url: str
    target_urls: list[str]
    credentials: CredentialsModel
    auth_mode: str = "auto"
    selectors: SelectorHintsModel = SelectorHintsModel()
    headless: bool = True
    timeout_ms: int = 20000

@app.get("/")
def root():
    return {"ok": True, "message": "Accessibility service starter is running"}

@app.post("/jobs")
def create_job(req: JobRequest):
    jobs_root = Path("jobs")
    job_dir = jobs_root / req.job_id
    config_path = job_dir / "incoming_job_config.json"
    job_dir.mkdir(parents=True, exist_ok=True)
    config_path.write_text(req.model_dump_json(indent=2), encoding="utf-8")
    try:
        prepare_job(job_dir, config_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    status_path = job_dir / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {}
    return {"job_id": req.job_id, "job_dir": str(job_dir), "status": status}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job_dir = Path("jobs") / job_id
    status_path = job_dir / "status.json"
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    return json.loads(status_path.read_text(encoding="utf-8"))

def _run_tool(job_id: str, fn, tool_name: str):
    job_dir = Path("jobs") / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        fn(job_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"job_id": job_id, "tool": tool_name, "reports_dir": str(job_dir / "reports" / tool_name)}

@app.post("/jobs/{job_id}/run/axe-core")
def run_job_axe_core(job_id: str):
    return _run_tool(job_id, run_axe_core, "axe-core")

@app.post("/jobs/{job_id}/run/html-sniffer")
def run_job_html_sniffer(job_id: str):
    return _run_tool(job_id, run_html_sniffer, "html-sniffer")

@app.post("/jobs/{job_id}/run/lighthouse")
def run_job_lighthouse(job_id: str):
    return _run_tool(job_id, run_lighthouse, "lighthouse")

@app.post("/jobs/{job_id}/run/ibm")
def run_job_ibm(job_id: str):
    return _run_tool(job_id, run_ibm, "ibm")

@app.post("/jobs/{job_id}/run/uuv")
def run_job_uuv(job_id: str):
    return _run_tool(job_id, run_uuv, "uuv")

@app.post("/jobs/{job_id}/run/oobee")
def run_job_oobee(job_id: str):
    return _run_tool(job_id, run_oobee, "oobee")
