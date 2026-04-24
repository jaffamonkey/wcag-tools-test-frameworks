# Shared Auth + Job Scaffold Starter

This starter is aimed at turning the current accessibility tool chain into a service.

It focuses on the tools that can realistically share a Playwright-authenticated session:

- axe-core / Playwright
- IBM Accessibility Checker / Playwright
- Lighthouse / Playwright flow
- UUV
- html-sniffer / Playwright
- Oobee

It does **not** try to solve authenticated runs for:

- pa11y-ci
- axe-scan

## What this starter gives you

This version includes:

- a shared Playwright authentication module
- a job-folder scaffold
- a simple `run_job.py` entry point
- a small FastAPI app in `main.py`
- `requirements.txt`
- a real authenticated `axe-core` runner
- authenticated runner scaffolds for:
  - `html-sniffer`
  - `lighthouse`
  - `ibm`
  - `uuv`
  - `oobee`

The overall idea is:

1. create a job
2. authenticate once
3. save `storage_state.json`
4. reuse that authenticated state for all compatible tools
5. write each tool’s output into `jobs/<job-id>/reports/<tool>/`

---

## Project structure

```text
jobs/
  <job-id>/
    input/
      urls.txt
      job_config.json
    auth/
      storage_state.json
      login.log
      login-result.png
    reports/
      axe-core/
      ibm/
      lighthouse/
      uuv/
      html-sniffer/
      oobee/
    analysis/
      analysis.json
      accessibility_analysis.xlsx
      dashboard/
    logs/
      orchestrator.log
      axe-core.log
      ibm.log
      ...
    status.json
```

---

## Requirements

- Python 3.10+
- Node.js 18+
- npm
- Playwright Chromium

---

## Installation

### 1. Create and activate a virtual environment

#### macOS / Linux

```bash
python -m venv venv
source venv/bin/activate
```

#### Windows PowerShell

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```

---

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

---

### 3. Install Playwright browser

```bash
playwright install chromium
```

If Playwright asks for system dependencies on Linux, install them as prompted.

---

## Quick start

### 1. Prepare a job using the example config

```bash
python run_job.py jobs/example-job example_job_config.json
```

This will:

- create the job folders
- write `jobs/example-job/input/urls.txt`
- run the shared authentication flow
- save:
  - `jobs/example-job/auth/storage_state.json`
  - `jobs/example-job/auth/login.log`
  - `jobs/example-job/auth/login-result.png`
- write `jobs/example-job/status.json`

---

### 2. Run the authenticated axe-core runner

```bash
python -m service.run_authenticated_axe_core jobs/example-job
```

This will:

- read `jobs/example-job/input/urls.txt`
- read `jobs/example-job/auth/storage_state.json`
- launch Playwright Chromium with the authenticated session
- run axe-core on each URL
- write JSON reports into:

```text
jobs/example-job/reports/axe-core/
```

---

### 3. Run one of the scaffolded authenticated runners

Examples:

```bash
python -m service.run_authenticated_html_sniffer jobs/example-job
python -m service.run_authenticated_lighthouse jobs/example-job
python -m service.run_authenticated_ibm jobs/example-job
python -m service.run_authenticated_uuv jobs/example-job
python -m service.run_authenticated_oobee jobs/example-job
```

These currently prove:

- shared authenticated session reuse
- shared `urls.txt`
- per-tool report folder layout
- service wiring

They are scaffolds, so their output currently contains placeholder JSON showing where the real tool execution should be plugged in.

---

## Running the API

Start the FastAPI app with:

```bash
uvicorn main:app --reload
```

By default this will start on:

```text
http://127.0.0.1:8000
```

Interactive API docs will be available at:

```text
http://127.0.0.1:8000/docs
```

---

## API usage

### Health check

```http
GET /
```

Example response:

```json
{
  "ok": true,
  "message": "Accessibility service starter is running"
}
```

---

### Create a job

```http
POST /jobs
```

Example request body:

```json
{
  "job_id": "example-job",
  "login_entry_url": "https://example.com",
  "target_urls": [
    "https://example.com/",
    "https://example.com/account",
    "https://example.com/products"
  ],
  "credentials": {
    "username": "user@example.com",
    "password": "secret"
  },
  "auth_mode": "auto",
  "selectors": {
    "login_trigger": null,
    "username": null,
    "password": null,
    "submit": null,
    "success": null,
    "logged_in_text": null
  },
  "headless": true,
  "timeout_ms": 20000
}
```

This will:

- create `jobs/<job-id>/`
- save the incoming config
- run the shared login flow
- save the job status

---

### Check job status

```http
GET /jobs/{job_id}
```

Example:

```http
GET /jobs/example-job
```

---

### Run authenticated axe-core

```http
POST /jobs/{job_id}/run/axe-core
```

Example:

```http
POST /jobs/example-job/run/axe-core
```

This writes output to:

```text
jobs/example-job/reports/axe-core/
```

---

### Run scaffolded authenticated tools

```http
POST /jobs/{job_id}/run/html-sniffer
POST /jobs/{job_id}/run/lighthouse
POST /jobs/{job_id}/run/ibm
POST /jobs/{job_id}/run/uuv
POST /jobs/{job_id}/run/oobee
```

Examples:

```http
POST /jobs/example-job/run/html-sniffer
POST /jobs/example-job/run/lighthouse
POST /jobs/example-job/run/ibm
POST /jobs/example-job/run/uuv
POST /jobs/example-job/run/oobee
```

---

## Authentication model

The shared login module supports this idea:

- user provides a login entry URL
- that URL may be:
  - a direct login form page
  - a page containing a login link
  - a page where a login trigger opens a modal
- the module attempts to:
  - detect the login form
  - or detect and click a login trigger
  - find username/email, password, and submit fields
  - submit credentials
  - verify success
  - save Playwright storage state

Saved artifacts include:

- `auth/storage_state.json`
- `auth/login.log`
- `auth/login-result.png`

---

## Selector overrides

The shared auth flow supports optional selector hints for harder sites.

Available override fields:

- `login_trigger`
- `username`
- `password`
- `submit`
- `success`
- `logged_in_text`

These can be sent in the API request or included in a config JSON file.

Example:

```json
{
  "selectors": {
    "login_trigger": "a[href*='login']",
    "username": "input[name='email']",
    "password": "input[type='password']",
    "submit": "button[type='submit']",
    "success": "a[href*='logout']",
    "logged_in_text": "My account"
  }
}
```

This is useful when automatic detection is not reliable enough.

---

## Example CLI workflow

### Step 1: prepare the job

```bash
python run_job.py jobs/example-job example_job_config.json
```

### Step 2: inspect auth output

Check:

```text
jobs/example-job/auth/login.log
jobs/example-job/auth/login-result.png
jobs/example-job/auth/storage_state.json
jobs/example-job/status.json
```

### Step 3: run axe-core

```bash
python -m service.run_authenticated_axe_core jobs/example-job
```

### Step 4: inspect reports

```text
jobs/example-job/reports/axe-core/
```

---

## Example API workflow

### Start server

```bash
uvicorn main:app --reload
```

### Create a job

Use Swagger UI at `/docs`, or send a request like:

```bash
curl -X POST "http://127.0.0.1:8000/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "example-job",
    "login_entry_url": "https://example.com",
    "target_urls": [
      "https://example.com/",
      "https://example.com/account"
    ],
    "credentials": {
      "username": "user@example.com",
      "password": "secret"
    },
    "auth_mode": "auto",
    "selectors": {
      "login_trigger": null,
      "username": null,
      "password": null,
      "submit": null,
      "success": null,
      "logged_in_text": null
    },
    "headless": true,
    "timeout_ms": 20000
  }'
```

### Run axe-core

```bash
curl -X POST "http://127.0.0.1:8000/jobs/example-job/run/axe-core"
```

### Get status

```bash
curl "http://127.0.0.1:8000/jobs/example-job"
```

---

## Current status of tool runners

### Implemented as a real authenticated runner

- `axe-core`

### Present as authenticated scaffolds

- `html-sniffer`
- `lighthouse`
- `ibm`
- `uuv`
- `oobee`

These scaffolds currently validate the service pattern and file layout, but still need the real tool-specific execution logic wired in.

### Explicitly deferred for authenticated mode

- `pa11y-ci`
- `axe-scan`

These are intentionally left out for now because they are less suitable for complex shared authenticated flows.

---

## Troubleshooting

### `storage_state.json` was not created

Check:

- credentials are correct
- login entry URL is correct
- the login flow is being detected correctly
- `auth/login.log`
- `auth/login-result.png`

If needed, add selector overrides.

---

### Playwright browser is missing

Install it with:

```bash
playwright install chromium
```

---

### Node or npm errors when running tool runners

Make sure Node.js and npm are installed:

```bash
node -v
npm -v
```

---

### Login succeeds manually but not in the starter

This usually means one of:

- login trigger detection is wrong
- selectors need manual overrides
- the site uses a multi-step flow
- the site uses SSO, MFA, or a custom login widget
- success verification needs a better selector

Try setting explicit:

- `login_trigger`
- `username`
- `password`
- `submit`
- `success`

---

## Next steps

Recommended order:

1. turn `html-sniffer` from scaffold into a real runner
2. wire in the real authenticated `oobee` runner
3. wire in the real authenticated `lighthouse` runner
4. add per-tool logs under `jobs/<job-id>/logs/`
5. add a combined “run all authenticated tools” endpoint
6. connect the analysis framework to `jobs/<job-id>/reports/`
7. write workbook/dashboard outputs into `jobs/<job-id>/analysis/`

---

## Summary

This starter is meant to prove the service architecture:

- one shared auth step
- one job folder
- multiple compatible tools reusing the same authenticated state
- one output structure ready for downstream analysis

The first real runner is `axe-core`, and the rest are scaffolded in the same shape so they can be completed incrementally.
