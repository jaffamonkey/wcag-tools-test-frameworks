# End-to-End Setup and Run Guide

## What this setup now does

You now have an end-to-end flow with two local apps:

- **Auth / scan service** (`auth_service`)
  - accepts job submissions from a web form
  - creates a job config automatically
  - runs authentication only when login details are supplied
  - runs the selected tool frameworks
  - writes job metadata to a local database
  - exposes public result/status pages and a jobs list
- **Reporting / analysis service** (`wcag-tools-reporting-analysis`)
  - reads a specific job's reports
  - builds workbook + dashboard output
  - serves per-job dashboards and downloads

The main job structure is:

```text
jobs/<job-id>/
  input/
  auth/
  reports/
    axe-core/
    html-sniffer/
    oobee/
    lighthouse/
    ibm/
    uuv/
    pa11y/
  analysis/
    index.html
    accessibility_analysis.xlsx
    data/
      analysis.json
    static/
    analysis_status.json
  logs/
  status.json
  full_job_summary.json
  incoming_job_config.json
```

---

## Repos used

### 1. Auth / scan service repo

Example local path:

```text
/Users/user/code/github/wcag-tools-test-frameworks/auth_service
```

### 2. Reporting / analysis repo

Example local path:

```text
/Users/user/code/github/wcag-tools-reporting-analysis
```

---

## High-level flow

1. Start the **auth service**.
2. Start the **analysis service**.
3. Submit a job from the auth-service form.
4. The public result page shows queued/running/completed/failed state.
5. When complete, the result page redirects to the dashboard.

---

# Setup

## A. Auth service setup

Open a terminal:

```bash
cd /Users/user/code/github/wcag-tools-test-frameworks/auth_service
source auth/bin/activate
```

Install dependencies if needed:

```bash
pip install -r requirements.txt
playwright install chromium
```

If there is no complete `requirements.txt`, at minimum:

```bash
pip install fastapi uvicorn playwright pydantic
playwright install chromium
```

---

## B. Analysis service setup

Open another terminal:

```bash
cd /Users/user/code/github/wcag-tools-reporting-analysis
source analysis1/bin/activate
```

Install dependencies if needed:

```bash
pip install -r requirements.txt
```

If required, install manually:

```bash
pip install fastapi uvicorn openpyxl jinja2 pydantic
```

---

# Recommended server ports

Use different ports so the two apps are easy to tell apart.

- **Auth service**: `8001`
- **Analysis service**: `8000`

---

# Start the servers

## 1. Start auth service

From the `auth_service` repo:

```bash
cd /Users/user/code/github/wcag-tools-test-frameworks/auth_service
source auth/bin/activate
python -m uvicorn main:app --reload --port 8001
```

## 2. Start analysis service

From the reporting repo:

```bash
cd /Users/user/code/github/wcag-tools-reporting-analysis
source analysis1/bin/activate
python -m uvicorn app.main:app --reload --port 8000
```

---

# Primary current flow: submit from the form

Open the auth service form:

```text
http://127.0.0.1:8001/
```

The form now asks only for user-meaningful inputs:

- **Job Name**
- **URLs to test**
- **Optional Login Details**
- **Tool selection**

The service generates the internal config file automatically.

### Current user flow

1. Fill in the form
2. Submit the job
3. The page redirects to the public result/status page
4. That page auto-refreshes while the job is queued/running
5. When the job is complete, it redirects to the dashboard

---

# Supporting pages

## Jobs list / visibility page

```text
http://127.0.0.1:8001/jobs-view
```

This shows:
- queued jobs
- running jobs
- completed jobs
- failed jobs
- links to public result, dashboard, workbook

## Public result/status page

```text
http://127.0.0.1:8001/r/<public-slug>
```

Behavior:
- **queued**: shows queued status and auto-refreshes
- **running**: shows analysis in progress, elapsed timer, and auto-refreshes
- **completed**: redirects to dashboard
- **failed**: shows failure state and any error text

---

# Dashboard and analysis URLs

These are served from the **analysis service**, not the auth service.

## Dashboard

```text
http://127.0.0.1:8000/jobs/<job-id>/dashboard
```

## Workbook

```text
http://127.0.0.1:8000/jobs/<job-id>/workbook
```

## Analysis status

```text
http://127.0.0.1:8000/jobs/<job-id>/analysis-status
```

## Raw analysis data

```text
http://127.0.0.1:8000/jobs/<job-id>/data/analysis.json
```

---

# Guide/document links from the dashboard

The dashboard guide links must use **root-relative app URLs**, not job-relative URLs.

Correct patterns:

```text
/readme_overview.html
/workbook_guide.html
/dashboard_guide.html
/site_preview.html
```

Wrong patterns:

```text
/jobs/<job-id>/readme_overview.html
/jobs/<job-id>/workbook_guide.html
```

If the guide links are broken, check that the generated dashboard `index.html` uses absolute root paths.

---

# Manual API examples

## Submit a public job by API

```bash
curl -i -X POST "http://127.0.0.1:8001/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "job_name": "public-site-audit",
    "target_urls": [
      "https://example.com/",
      "https://example.com/contact"
    ],
    "tools": ["axe-core", "html-sniffer", "oobee", "lighthouse", "ibm", "uuv", "pa11y"]
  }'
```

## Submit an authenticated job by API

```bash
curl -i -X POST "http://127.0.0.1:8001/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "job_name": "private-site-audit",
    "target_urls": [
      "https://practicetestautomation.com/",
      "https://practicetestautomation.com/practice-test-exceptions/",
      "https://practicetestautomation.com/practice-test-table/"
    ],
    "login_entry_url": "https://practicetestautomation.com/practice-test-login/",
    "credentials": {
      "username": "student",
      "password": "Password123"
    },
    "tools": ["axe-core", "html-sniffer", "oobee", "lighthouse", "ibm", "uuv", "pa11y"]
  }'
```

## Query a job by internal id

```bash
curl "http://127.0.0.1:8001/jobs/<job-id>"
```

## List jobs

```bash
curl "http://127.0.0.1:8001/jobs-list"
```

---

# Legacy/manual full-job flow

This still exists and is useful for debugging, but it is no longer the main user-facing flow.

## Run full job manually

```bash
curl -X POST "http://127.0.0.1:8001/jobs/example-job/run-full" \
  -H "Content-Type: application/json" \
  -d '{
    "job_config": "/Users/user/code/github/wcag-tools-test-frameworks/auth_service/example_job_config.json",
    "analysis_repo_dir": "/Users/user/code/github/wcag-tools-reporting-analysis",
    "auth_service_dir": "/Users/user/code/github/wcag-tools-test-frameworks/auth_service"
  }'
```

This path is still useful if you want to drive the older orchestrated flow directly.

---

# Manual step-by-step debugging flow

If you want to run it step-by-step instead:

## Auth / prepare

```bash
cd /Users/user/code/github/wcag-tools-test-frameworks/auth_service
source auth/bin/activate
python3 run_job.py jobs/example-job example_job_config.json
```

## Run tools individually

```bash
python3 -m service.run_authenticated_axe_core jobs/example-job
python3 -m service.run_authenticated_html_sniffer jobs/example-job
python3 -m service.run_authenticated_oobee jobs/example-job
python3 -m service.run_authenticated_lighthouse jobs/example-job
python3 -m service.run_authenticated_ibm jobs/example-job
python3 -m service.run_authenticated_uuv jobs/example-job
python3 -m service.run_authenticated_pa11y jobs/example-job
```

## Build analysis manually

```bash
cd /Users/user/code/github/wcag-tools-reporting-analysis
source analysis1/bin/activate

python run_job_analysis.py \
  --reports-dir /Users/user/code/github/wcag-tools-test-frameworks/auth_service/jobs/example-job/reports \
  --output-dir /Users/user/code/github/wcag-tools-test-frameworks/auth_service/jobs/example-job/analysis
```

---

# Tool coverage

## Strong authenticated Playwright-based tools

These are the cleaner, stronger authenticated runners:

- axe-core
- html-sniffer
- oobee
- lighthouse
- ibm
- uuv

## Best-effort authenticated tool

- pa11y-ci

Pa11y is useful, but it uses a different auth approach and is more fragile than the Playwright session-sharing tools.

---

# Public vs authenticated jobs

## Public job
If no `login_entry_url` and no `credentials` are supplied:
- authentication is skipped
- the job is prepared as a public job
- runners should work without `storage_state.json`

## Authenticated job
If both `login_entry_url` and `credentials` are supplied:
- auth is attempted
- storage state is created
- authenticated pages are scanned

Both login fields must be provided together, or omitted together.

---

# Quirks and gotchas

## 1. Wrong port problems

This was the most common source of confusion.

### Auth service routes live on `8001`

Examples:
- `GET /`
- `POST /jobs`
- `GET /jobs-view`
- `GET /r/{slug}`

### Analysis service routes live on `8000`

Examples:
- `GET /jobs/{job_id}/dashboard`
- `GET /jobs/{job_id}/workbook`

### Rule of thumb

- **submit / monitor jobs** on the auth service
- **view dashboards** on the analysis service

---

## 2. Do not use the old global `/dashboard`

Use:

```text
/jobs/<job-id>/dashboard
```

not:

```text
/dashboard
```

The old `/dashboard` route belongs to the earlier global flow and can trigger stale behaviour like trying to analyse `./reports`.

---

## 3. Job-aware dashboard assets matter

The generated dashboard must use job-relative/static-aware links.

Important patterns:

- `./static/styles.css`
- `./static/script.js`
- `/readme_overview.html`
- `/workbook_guide.html`
- `/dashboard_guide.html`
- `/site_preview.html`

If old paths remain, you can get:
- 404 on CSS/JS
- broken guide links
- old live-analysis calls

---

## 4. The analysis service must point at the auth-service jobs folder

The analysis app must resolve job folders under the auth-service jobs directory.

Good local default:

```python
DEFAULT_LOCAL_JOBS_DIR = Path(
    "/Users/user/code/github/wcag-tools-test-frameworks/auth_service/jobs"
)
```

If this path is wrong, `/jobs/<job-id>/dashboard` can 404 even when files exist.

---

## 5. Uvicorn path / virtualenv mix-ups

A few issues came from starting the wrong app in the wrong environment.

### Use module form

Prefer:

```bash
python -m uvicorn ...
```

instead of:

```bash
uvicorn ...
```

This avoids stale global launchers.

### Make sure each repo uses its own venv

- auth service terminal should use the auth-service environment
- analysis terminal should use the reporting environment

### Correct startup targets

- **auth service**: `main:app`
- **analysis service**: `app.main:app`

Examples:

```bash
python -m uvicorn main:app --reload --port 8001
python -m uvicorn app.main:app --reload --port 8000
```

---

## 6. Pa11y exits non-zero when it finds issues

Pa11y can produce good reports and still exit non-zero because of threshold / pass-fail semantics.

For service mode, this was treated as acceptable if reports were produced.

Meaning:
- output files matter more than raw exit code
- this is expected behaviour, not necessarily a failed scan

---

## 7. UUV originally failed on findings

UUV originally behaved like a test and failed the scenario when high findings existed.

For service mode, that behaviour was adjusted so it:
- still writes reports
- does not treat findings themselves as a crash

---

## 8. IBM had package/API quirks

IBM worked once aligned with the repo’s known-good invocation pattern and config.

If IBM breaks again, check:
- runner file version
- `.achecker.yml`
- package version
- whether a newer or older runner file accidentally got copied back in

---

## 9. Cached browser assets can mislead

After changing:
- `script.js`
- `index.html`
- dashboard asset routes

do a hard refresh in the browser.

Old JS can cause very misleading behaviour.

---

## 10. Public jobs require runners to tolerate missing storage state

Public jobs skip authentication, so `storage_state.json` may not exist.

Playwright-based runners should only apply `storageState` if the file exists.

Pattern:

```javascript
const contextOptions = { ignoreHTTPSErrors: true };
if (fs.existsSync(STORAGE_STATE_FILE)) {
  contextOptions.storageState = STORAGE_STATE_FILE;
}
const context = await browser.newContext(contextOptions);
```

---

## 11. JSON payloads must use straight quotes

When sending API payloads with `curl`, use plain JSON quotes:

```text
"
```

Not smart quotes:

```text
“ ”
```

Smart quotes will cause JSON decode errors.

---

## 12. Duplicate job ids / names

The service now generates a unique internal job id from the submitted job name plus a timestamp.

That means:
- user-facing job names can repeat
- internal job ids should still be unique

If you are testing older endpoints or older DB records, duplicate id errors can still appear.

---

# Useful checks

## Check auth-service docs

```text
http://127.0.0.1:8001/docs
```

You should see:
- `POST /jobs`
- `GET /jobs-view`
- `GET /jobs-list`
- `GET /jobs/{job_id}`

## Check analysis-service docs

```text
http://127.0.0.1:8000/docs
```

You should see job dashboard/workbook/status routes there.

## Check summary file

```text
auth_service/jobs/<job-id>/full_job_summary.json
```

This is the first place to look if the flow ran but the dashboard looks wrong.

## Check generated config

```text
auth_service/jobs/<job-id>/incoming_job_config.json
```

This is useful when verifying what the simplified form actually submitted.

---

# Suggested local operating pattern

## Terminal 1 — auth service

```bash
cd /Users/user/code/github/wcag-tools-test-frameworks/auth_service
source auth/bin/activate
python -m uvicorn main:app --reload --port 8001
```

## Terminal 2 — analysis service

```bash
cd /Users/user/code/github/wcag-tools-reporting-analysis
source analysis1/bin/activate
python -m uvicorn app.main:app --reload --port 8000
```

## Browser 1 — submit job

```text
http://127.0.0.1:8001/
```

## Browser 2 — job list

```text
http://127.0.0.1:8001/jobs-view
```

## Browser 3 — final dashboard

```text
http://127.0.0.1:8000/jobs/<job-id>/dashboard
```

---

# Next logical improvements

- store `job_name` separately in the DB
- show more detailed per-job progress
- friendly failure summaries
- async worker separation from the web service
- persistent job registry / Postgres migration
- hosted deployment / Render migration
- optional auth-UX-specific scan mode later

---

# Summary

The happy-path flow is now:

1. start auth service
2. start analysis service
3. submit a job from the auth-service form
4. land on the public result/status page
5. wait while it auto-refreshes
6. get redirected to the analysis dashboard when complete

That is the main flow to follow.


# EMERGENCY JOB STOP

Find your jobs DB:
```
find /Users/user/code/github/wcag-tools-test-frameworks/auth_service -name "*.db"
```
Then inspect the stuck row:
```
sqlite3 /path/to/your.db "select id,status,error_message from jobs where id='practice-expandtesting-com-20260428-213755';"
```
And update it:
```
sqlite3 /path/to/your.db "update jobs set status='failed', error_message='Interrupted during IBM run after auth; process no longer running' where id='practice-expandtesting-com-20260428-213755';"
```