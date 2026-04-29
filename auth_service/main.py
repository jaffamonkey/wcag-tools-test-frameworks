from __future__ import annotations

import secrets
from datetime import datetime, UTC
from pathlib import Path
import sqlite3

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, model_validator
from fastapi.responses import RedirectResponse

from service.full_job_runner import DEFAULT_TOOLS, run_full_job
from service.job_db import (
    init_db,
    create_job as db_create_job,
    get_job as db_get_job,
    get_job_by_slug,
    list_jobs as db_list_jobs,
)
from service.job_worker import run_job_in_background

import os
import re
import json

AUTH_SERVICE_DIR = Path(__file__).resolve().parent
ANALYSIS_REPO_DIR = Path(
    os.getenv(
        "ANALYSIS_REPO_DIR",
        "/Users/user/code/github/wcag-tools-reporting-analysis",
    )
).resolve()

app = FastAPI(title="Accessibility Service Starter")

init_db()


class CredentialsRequest(BaseModel):
    username: str
    password: str


class SubmitJobRequest(BaseModel):
    job_name: str
    target_urls: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=lambda: DEFAULT_TOOLS)

    login_entry_url: str | None = None
    credentials: CredentialsRequest | None = None

    @model_validator(mode="after")
    def validate_auth_fields(self):
        has_login_url = bool(self.login_entry_url)
        has_credentials = self.credentials is not None

        if has_login_url != has_credentials:
            raise ValueError(
                "login_entry_url and credentials must either both be provided or both be omitted"
            )

        if not self.target_urls:
            raise ValueError("target_urls must contain at least one URL")

        return self


class JobStatusResponse(BaseModel):
    id: str
    public_slug: str
    status: str
    job_name: str | None = None
    dashboard_url: str | None = None
    workbook_url: str | None = None
    error_message: str | None = None


class RunFullJobRequest(BaseModel):
    job_config: str
    analysis_repo_dir: str
    auth_service_dir: str | None = None
    tools: list[str] | None = None
    skip_analysis: bool = False

def make_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "job"

def utc_now() -> str:
    return datetime.now(UTC).isoformat()

def make_job_id(job_name: str) -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"{make_slug(job_name)}-{timestamp}"

@app.get("/", response_class=HTMLResponse)
def home():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Accessibility Job Submit</title>
      <style>
        :root {
          --bg: #f6f8fb;
          --panel: #ffffff;
          --text: #1f2937;
          --muted: #6b7280;
          --border: #dbe3ee;
          --primary: #2563eb;
          --primary-dark: #1d4ed8;
          --success: #0f766e;
          --danger: #b91c1c;
          --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          --radius: 16px;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 32px 20px 60px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: linear-gradient(180deg, #f8fbff 0%, #f3f6fb 100%);
          color: var(--text);
        }

        .wrap {
          max-width: 980px;
          margin: 0 auto;
        }

        .hero {
          margin-bottom: 24px;
        }

        .hero h1 {
          margin: 0 0 10px;
          font-size: clamp(2rem, 3vw, 3rem);
          line-height: 1.1;
        }

        .hero p {
          margin: 0;
          color: var(--muted);
          font-size: 1rem;
        }

        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 28px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .grid-1 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        label {
          font-weight: 600;
          font-size: 0.98rem;
        }

        .hint {
          color: var(--muted);
          font-size: 0.9rem;
          line-height: 1.4;
        }

        input[type="text"],
        input[type="password"],
        textarea {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 12px 14px;
          font: inherit;
          color: var(--text);
          background: #fff;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        input[type="text"]:focus,
        input[type="password"]:focus,
        textarea:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
        }

        textarea {
          min-height: 150px;
          resize: vertical;
        }

        .section {
          margin-top: 28px;
          padding-top: 22px;
          border-top: 1px solid var(--border);
        }

        .section h2 {
          margin: 0 0 6px;
          font-size: 1.2rem;
        }

        .section p {
          margin: 0 0 16px;
          color: var(--muted);
        }

        .tools {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px 14px;
          margin-top: 6px;
        }

        .tool-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: #fbfdff;
        }

        .tool-item input {
          transform: scale(1.15);
        }

        details {
          margin-top: 6px;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px 16px;
          background: #fbfdff;
        }

        summary {
          cursor: pointer;
          font-weight: 700;
          list-style: none;
        }

        summary::-webkit-details-marker {
          display: none;
        }

        .actions {
          margin-top: 28px;
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        button {
          border: none;
          border-radius: 12px;
          background: var(--primary);
          color: white;
          padding: 12px 18px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.05s ease;
        }

        button:hover {
          background: var(--primary-dark);
        }

        button:active {
          transform: translateY(1px);
        }

        button[disabled] {
          opacity: 0.65;
          cursor: wait;
        }

        .status {
          font-size: 0.95rem;
          color: var(--muted);
        }

        .status.success { color: var(--success); }
        .status.error { color: var(--danger); }

        pre {
          margin-top: 22px;
          background: #0f172a;
          color: #e2e8f0;
          padding: 18px;
          border-radius: 14px;
          overflow: auto;
          font-size: 0.9rem;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .quick-links {
          margin-top: 18px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .quick-links a {
          display: inline-block;
          text-decoration: none;
          color: var(--primary-dark);
          font-weight: 600;
          padding: 10px 12px;
          border: 1px solid rgba(37, 99, 235, 0.2);
          border-radius: 12px;
          background: #eff6ff;
        }

        @media (max-width: 760px) {
          .grid {
            grid-template-columns: 1fr;
          }

          body {
            padding: 20px 14px 40px;
          }

          .card {
            padding: 20px;
          }
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="hero">
          <h1>Accessibility Job Submit</h1>
          <p>
            Create a job, run your selected accessibility tools, and generate a public analysis dashboard.
          </p>
          <p><a href="/jobs-view">View submitted jobs</a></p>
        </div>

        <div class="card">
          <form id="jobForm">
            <div class="grid">
              <div class="field">
                <label for="job_name">Job Name</label>
                <input id="job_name" name="job_name" type="text" value="my-site-april-audit" />
                <div class="hint">A unique name for this scan job. The service will create the internal config automatically.</div>
              </div>

              <div class="field">
                <label for="target_urls">URLs to test</label>
                <textarea id="target_urls" name="target_urls" placeholder="https://example.com/
https://example.com/about
https://example.com/contact"></textarea>
                <div class="hint">Enter one URL per line.</div>
              </div>
            </div>

            <div class="section">
              <h2>Optional Login Details</h2>
              <p>Only fill this in if the site under test requires authentication.</p>

              <details>
                <summary>Show authentication fields</summary>

                <div class="grid" style="margin-top: 16px;">
                  <div class="field" style="grid-column: 1 / -1;">
                    <label for="login_entry_url">Login page URL</label>
                    <input id="login_entry_url" name="login_entry_url" type="text"
                      placeholder="https://example.com/login" />
                    <div class="hint">Direct login URL or page containing the login trigger.</div>
                  </div>

                  <div class="field">
                    <label for="username">Username</label>
                    <input id="username" name="username" type="text" placeholder="user@example.com" />
                  </div>

                  <div class="field">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" placeholder="••••••••" />
                  </div>
                </div>
              </details>
            </div>

            <div class="section">
              <h2>Accessibility tools to run</h2>
              <p>Technical paths and analysis directories are managed automatically by the service.</p>

              <div class="tools">
                <label class="tool-item"><input type="checkbox" name="tools" value="axe-core" checked /> axe-core</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="html-sniffer" checked /> html-sniffer</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="oobee" checked /> oobee</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="lighthouse" checked /> lighthouse</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="ibm" checked /> ibm</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="uuv" checked /> uuv</label>
                <label class="tool-item"><input type="checkbox" name="tools" value="pa11y" checked /> pa11y</label>
              </div>
            </div>

            <div class="actions">
              <button id="submitBtn" type="submit">Start analysis</button>
              <div id="status" class="status">Ready.</div>
            </div>
          </form>

          <div id="quickLinks" class="quick-links" hidden></div>
          <pre id="out" hidden></pre>
        </div>
      </div>

      <script>
        const form = document.getElementById("jobForm");
        const out = document.getElementById("out");
        const statusEl = document.getElementById("status");
        const submitBtn = document.getElementById("submitBtn");
        const quickLinks = document.getElementById("quickLinks");

        function setStatus(message, kind = "") {
          statusEl.textContent = message;
          statusEl.className = "status" + (kind ? " " + kind : "");
        }

        function showOutput(data) {
          out.hidden = false;
          out.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        }

        function showLinks(data) {
          quickLinks.innerHTML = "";
          quickLinks.hidden = true;

          if (!data) return;

          if (data.public_slug) {
            const a = document.createElement("a");
            a.href = "/r/" + data.public_slug;
            a.textContent = "Public Result";
            quickLinks.appendChild(a);
            quickLinks.hidden = false;
          }
        }

        form.addEventListener("submit", async (e) => {
          e.preventDefault();

          const fd = new FormData(form);

          const tools = Array.from(document.querySelectorAll('input[name="tools"]:checked'))
            .map(el => el.value);

          const targetUrls = (fd.get("target_urls") || "")
            .split(/\\r?\\n/)
            .map(v => v.trim())
            .filter(Boolean);

          const payload = {
            job_name: (fd.get("job_name") || "").trim(),
            target_urls: targetUrls,
            tools: tools
          };

          const loginEntryUrl = (fd.get("login_entry_url") || "").trim();
          const username = (fd.get("username") || "").trim();
          const password = (fd.get("password") || "").trim();

          if (!payload.job_name) {
            setStatus("Please enter a job name.", "error");
            return;
          }

          if (!targetUrls.length) {
            setStatus("Please enter at least one target URL.", "error");
            return;
          }

          const anyAuthValue = loginEntryUrl || username || password;
          if (anyAuthValue) {
            if (!loginEntryUrl || !username || !password) {
              setStatus("If using authentication, please fill in login URL, username, and password.", "error");
              return;
            }

            payload.login_entry_url = loginEntryUrl;
            payload.credentials = {
              username,
              password
            };
          }

          out.hidden = true;
          quickLinks.hidden = true;
          quickLinks.innerHTML = "";
          submitBtn.disabled = true;
          setStatus("Submitting job...", "");

            try {
            const res = await fetch("/jobs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }

            showOutput(data);

            if (!res.ok) {
                setStatus("Submission failed.", "error");
                return;
            }

            showLinks(data);
            setStatus("Job submitted successfully. Redirecting...", "success");

            if (data.public_slug) {
                setTimeout(() => {
                window.location.href = "/r/" + data.public_slug;
                }, 700);
            }
            } catch (err) {
            showOutput(String(err));
            setStatus("Request failed.", "error");
            } finally {
            submitBtn.disabled = false;
            }
        });
      </script>
    </body>
    </html>
    """


@app.post("/jobs", response_model=JobStatusResponse)
def submit_job(request: SubmitJobRequest, background_tasks: BackgroundTasks):
    job_id = make_job_id(request.job_name)
    public_slug = secrets.token_urlsafe(12)
    now = utc_now()

    job_dir = AUTH_SERVICE_DIR / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    config_path = job_dir / "incoming_job_config.json"

    config_payload = {
        "job_id": job_id,
        "job_name": request.job_name,
        "login_entry_url": request.login_entry_url,
        "target_urls": request.target_urls,
        "credentials": (
            request.credentials.model_dump()
            if request.credentials is not None
            else None
        ),
        "tools": request.tools,
    }
    config_path.write_text(json.dumps(config_payload, indent=2), encoding="utf-8")

    record = {
        "id": job_id,
        "public_slug": public_slug,
        "created_at": now,
        "updated_at": now,
        "status": "queued",
        "job_config_path": str(config_path),
        "login_url": request.login_entry_url,
        "urls": request.target_urls,
        "tools": request.tools,
        "dashboard_url": None,
        "workbook_url": None,
        "summary_path": None,
        "error_message": None,
    }

    try:
        db_create_job(record)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=f"Job ID '{job_id}' already exists. Please try again."
        )

    background_tasks.add_task(
        run_job_in_background,
        job_id=job_id,
        auth_service_dir=AUTH_SERVICE_DIR,
        analysis_repo_dir=ANALYSIS_REPO_DIR,
        job_config_path=config_path,
        tools=request.tools,
    )

    return JobStatusResponse(
        id=job_id,
        public_slug=public_slug,
        status="queued",
        job_name=request.job_name,
    )


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        id=job["id"],
        public_slug=job["public_slug"],
        status=job["status"],
        job_name=job["id"],
        dashboard_url=job["dashboard_url"],
        workbook_url=job["workbook_url"],
        error_message=job["error_message"],
    )


@app.post("/jobs/{job_id}/run-full")
def run_full_job_endpoint(job_id: str, request: RunFullJobRequest):
    auth_service_dir = (
        Path(request.auth_service_dir).resolve()
        if request.auth_service_dir
        else Path(__file__).resolve().parent
    )


    summary = run_full_job(
        job_id=job_id,
        job_config=Path(request.job_config),
        auth_service_dir=auth_service_dir,
        analysis_repo_dir=Path(request.analysis_repo_dir),
        tools=request.tools or DEFAULT_TOOLS,
        skip_analysis=request.skip_analysis,
    )

    return summary

@app.get("/r/{slug}", response_class=HTMLResponse)
def resolve_public_result(slug: str):
    job = get_job_by_slug(slug)
    if not job:
        raise HTTPException(status_code=404, detail="Result not found")

    status = str(job.get("status") or "unknown").lower()
    dashboard_url = job.get("dashboard_url")
    workbook_url = job.get("workbook_url")
    error_message = job.get("error_message") or ""
    job_id = job.get("id") or ""
    public_slug = job.get("public_slug") or ""

    if status == "completed" and dashboard_url:
        return RedirectResponse(dashboard_url)

    status_title = {
        "queued": "Job queued",
        "running": "Analysis in progress",
        "failed": "Job failed",
    }.get(status, "Job status")

    status_text = {
        "queued": "Your accessibility job has been submitted and is waiting to run.",
        "running": "Your accessibility job is currently running. This page will refresh automatically.",
        "failed": "This job did not complete successfully.",
    }.get(status, "This job is in an unknown state.")

    badge_class = {
        "queued": "queued",
        "running": "running",
        "failed": "failed",
    }.get(status, "unknown")

    workbook_link = (
        f'<a class="button secondary" href="{workbook_url}" target="_blank" rel="noreferrer">Open workbook</a>'
        if workbook_url else ""
    )

    dashboard_link = (
        f'<a class="button" href="{dashboard_url}" target="_blank" rel="noreferrer">Open dashboard</a>'
        if dashboard_url else ""
    )

    auto_refresh = f"""
    <script>
        const startedAt = Date.parse("{job.get('created_at') or ''}");
        const timerEl = document.getElementById("elapsedTimer");

        function formatElapsed(ms) {{
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        const millis = String(ms % 1000).padStart(3, "0");
        return `${{minutes}}:${{seconds}}.${{millis}}`;
        }}

        function tickTimer() {{
        if (!timerEl || Number.isNaN(startedAt)) return;
        const elapsed = Math.max(0, Date.now() - startedAt);
        timerEl.textContent = formatElapsed(elapsed);
        }}

        tickTimer();
        setInterval(tickTimer, 50);
        setTimeout(() => window.location.reload(), 10000);
    </script>
    """ if status in {"queued", "running"} else ""

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{status_title}</title>
      <style>
        :root {{
          --bg: #f6f8fb;
          --panel: #ffffff;
          --text: #1f2937;
          --muted: #6b7280;
          --border: #dbe3ee;
          --primary: #2563eb;
          --primary-dark: #1d4ed8;
          --success-bg: #dcfce7;
          --success-text: #166534;
          --queued-bg: #e0f2fe;
          --queued-text: #075985;
          --running-bg: #fef3c7;
          --running-text: #92400e;
          --failed-bg: #fee2e2;
          --failed-text: #991b1b;
          --unknown-bg: #e5e7eb;
          --unknown-text: #374151;
          --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          --radius: 16px;
        }}

        * {{ box-sizing: border-box; }}

        body {{
          margin: 0;
          padding: 32px 20px 60px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: linear-gradient(180deg, #f8fbff 0%, #f3f6fb 100%);
          color: var(--text);
        }}

        .wrap {{
          max-width: 760px;
          margin: 0 auto;
        }}

        .card {{
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 28px;
        }}

        h1 {{
          margin: 0 0 10px;
          font-size: clamp(2rem, 3vw, 2.6rem);
          line-height: 1.1;
        }}

        p {{
          margin: 0 0 16px;
          color: var(--muted);
          line-height: 1.5;
        }}

        .meta {{
          margin-top: 20px;
          padding-top: 18px;
          border-top: 1px solid var(--border);
          display: grid;
          gap: 10px;
        }}

        .meta-row {{
          font-size: 0.95rem;
        }}

        .meta-row strong {{
          display: inline-block;
          min-width: 110px;
        }}

        .badge {{
          display: inline-block;
          padding: 7px 12px;
          border-radius: 999px;
          font-size: 0.85rem;
          font-weight: 700;
        }}

        .queued {{ background: var(--queued-bg); color: var(--queued-text); }}
        .running {{ background: var(--running-bg); color: var(--running-text); }}
        .failed {{ background: var(--failed-bg); color: var(--failed-text); }}
        .unknown {{ background: var(--unknown-bg); color: var(--unknown-text); }}

        .actions {{
          margin-top: 24px;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }}

        .timer-wrap {{
        margin-top: 18px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #f8fafc;
        display: inline-block;
        }}

        .timer-label {{
        font-size: 0.85rem;
        color: var(--muted);
        margin-bottom: 4px;
        }}

        .timer-value {{
        font-size: 1.4rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
        }}

        .button {{
          display: inline-block;
          text-decoration: none;
          border: none;
          border-radius: 12px;
          background: var(--primary);
          color: white;
          padding: 12px 16px;
          font: inherit;
          font-weight: 700;
        }}

        .button.secondary {{
          background: white;
          color: var(--text);
          border: 1px solid var(--border);
        }}

        .error {{
          margin-top: 18px;
          padding: 14px 16px;
          border-radius: 12px;
          background: #fff7f7;
          border: 1px solid #fecaca;
          color: #7f1d1d;
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 0.92rem;
        }}

        .refresh-note {{
          margin-top: 18px;
          font-size: 0.9rem;
          color: var(--muted);
        }}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1>{status_title}</h1>
          <p>{status_text}</p>

          <span class="badge {badge_class}">{status}</span>
{"<div class='timer-wrap'><div class='timer-label'>Elapsed time</div><div id='elapsedTimer' class='timer-value'>00:00.000</div></div>" if status in {"queued", "running"} else ""}
          <div class="meta">
            <div class="meta-row"><strong>Job ID:</strong> {job_id}</div>
            <div class="meta-row"><strong>Public slug:</strong> {public_slug}</div>
          </div>

          <div class="actions">
            {dashboard_link}
            {workbook_link}
            <a class="button secondary" href="/jobs-view">View all jobs</a>
          </div>

          {"<div class='error'><strong>Error:</strong><br>" + error_message + "</div>" if error_message else ""}

          {"<div class='refresh-note'>This page refreshes automatically every 10 seconds while the job is queued or running.</div>" if status in {"queued", "running"} else ""}
        </div>
      </div>
      {auto_refresh}
    </body>
    </html>
    """

@app.get("/jobs-list")
def jobs_list():
    jobs = db_list_jobs(limit=200)
    return {"jobs": jobs}

@app.get("/jobs-view", response_class=HTMLResponse)
def jobs_view():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Submitted Jobs</title>
      <style>
        :root {
          --bg: #f6f8fb;
          --panel: #ffffff;
          --text: #1f2937;
          --muted: #6b7280;
          --border: #dbe3ee;
          --primary: #2563eb;
          --success: #0f766e;
          --warn: #b45309;
          --danger: #b91c1c;
          --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          --radius: 16px;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          padding: 32px 20px 60px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: linear-gradient(180deg, #f8fbff 0%, #f3f6fb 100%);
          color: var(--text);
        }

        .wrap {
          max-width: 1200px;
          margin: 0 auto;
        }

        .hero {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 16px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }

        .hero h1 {
          margin: 0 0 8px;
          font-size: clamp(2rem, 3vw, 3rem);
          line-height: 1.1;
        }

        .hero p {
          margin: 0;
          color: var(--muted);
        }

        .actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .button {
          display: inline-block;
          text-decoration: none;
          border: none;
          border-radius: 12px;
          background: var(--primary);
          color: white;
          padding: 12px 16px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }

        .button.secondary {
          background: white;
          color: var(--text);
          border: 1px solid var(--border);
        }

        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 22px;
        }

        .toolbar {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        input, select {
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 10px 12px;
          font: inherit;
          background: #fff;
        }

        input {
          min-width: 260px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th, td {
          text-align: left;
          padding: 14px 12px;
          border-top: 1px solid #edf2f7;
          vertical-align: top;
          font-size: 0.95rem;
        }

        th {
          color: var(--muted);
          font-weight: 700;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border-top: none;
        }

        .badge {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 0.82rem;
          font-weight: 700;
        }

        .queued { background: #e0f2fe; color: #075985; }
        .running { background: #fef3c7; color: #92400e; }
        .completed { background: #dcfce7; color: #166534; }
        .failed { background: #fee2e2; color: #991b1b; }
        .unknown { background: #e5e7eb; color: #374151; }

        .muted {
          color: var(--muted);
          font-size: 0.9rem;
        }

        .links {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .links a {
          text-decoration: none;
          color: var(--primary);
          font-weight: 600;
        }

        .empty {
          padding: 20px 0;
          color: var(--muted);
        }

        .error {
          color: var(--danger);
          white-space: pre-wrap;
          max-width: 320px;
        }

        @media (max-width: 860px) {
          table, thead, tbody, th, td, tr {
            display: block;
          }

          thead {
            display: none;
          }

          tr {
            border-top: 1px solid #edf2f7;
            padding: 12px 0;
          }

          td {
            border: none;
            padding: 8px 0;
          }

          td::before {
            content: attr(data-label);
            display: block;
            font-size: 0.8rem;
            font-weight: 700;
            color: var(--muted);
            margin-bottom: 4px;
            text-transform: uppercase;
          }
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="hero">
          <div>
            <h1>Submitted Jobs</h1>
            <p>Monitor queued, running, completed, and failed accessibility jobs.</p>
          </div>
          <div class="actions">
            <a class="button secondary" href="/">New job</a>
            <button class="button" onclick="loadJobs()">Refresh</button>
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <input id="search" type="text" placeholder="Filter by job ID or slug" oninput="renderJobs()" />
            <select id="statusFilter" onchange="renderJobs()">
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div id="tableWrap">
            <div class="empty">Loading jobs...</div>
          </div>
        </div>
      </div>

      <script>
        let ALL_JOBS = [];

        function statusClass(status) {
          const s = String(status || "unknown").toLowerCase();
          if (["queued", "running", "completed", "failed"].includes(s)) return s;
          return "unknown";
        }

        function escapeHtml(value) {
          return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        async function loadJobs() {
          const wrap = document.getElementById("tableWrap");
          wrap.innerHTML = '<div class="empty">Loading jobs...</div>';

          try {
            const res = await fetch("/jobs-list", { cache: "no-store" });
            const data = await res.json();
            ALL_JOBS = data.jobs || [];
            renderJobs();
          } catch (err) {
            wrap.innerHTML = '<div class="empty">Failed to load jobs.</div>';
          }
        }

        function renderJobs() {
          const wrap = document.getElementById("tableWrap");
          const search = (document.getElementById("search").value || "").trim().toLowerCase();
          const statusFilter = document.getElementById("statusFilter").value;

          const jobs = ALL_JOBS.filter(job => {
            const matchesSearch =
              !search ||
              String(job.id || "").toLowerCase().includes(search) ||
              String(job.public_slug || "").toLowerCase().includes(search);

            const matchesStatus =
              !statusFilter || String(job.status || "").toLowerCase() === statusFilter;

            return matchesSearch && matchesStatus;
          });

          if (!jobs.length) {
            wrap.innerHTML = '<div class="empty">No matching jobs found.</div>';
            return;
          }

          const rows = jobs.map(job => {
            const dashboard = job.dashboard_url
              ? `<a href="${escapeHtml(job.dashboard_url)}" target="_blank" rel="noreferrer">Dashboard</a>`
              : "";

            const workbook = job.workbook_url
              ? `<a href="${escapeHtml(job.workbook_url)}" target="_blank" rel="noreferrer">Workbook</a>`
              : "";

            const publicResult = job.public_slug
              ? `<a href="/r/${escapeHtml(job.public_slug)}" target="_blank" rel="noreferrer">Public result</a>`
              : "";

            const links = [publicResult, dashboard, workbook].filter(Boolean).join("");

            return `
              <tr>
                <td data-label="Job ID">
                  <strong>${escapeHtml(job.id)}</strong>
                  <div class="muted">${escapeHtml(job.public_slug || "")}</div>
                </td>
                <td data-label="Status">
                  <span class="badge ${statusClass(job.status)}">${escapeHtml(job.status || "unknown")}</span>
                </td>
                <td data-label="Created">
                  <div>${escapeHtml(job.created_at || "")}</div>
                  <div class="muted">${escapeHtml(job.updated_at || "")}</div>
                </td>
                <td data-label="Links">
                  <div class="links">${links || '<span class="muted">No links yet</span>'}</div>
                </td>
                <td data-label="Error">
                  <div class="error">${escapeHtml(job.error_message || "")}</div>
                </td>
              </tr>
            `;
          }).join("");

          wrap.innerHTML = `
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Timestamps</th>
                  <th>Links</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          `;
        }

        loadJobs();
        setInterval(loadJobs, 10000);
      </script>
    </body>
    </html>
    """