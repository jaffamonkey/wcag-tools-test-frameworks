#!/usr/bin/env bash
cd /Users/user/code/github/wcag-tools-reporting-analysis || exit 1
source analysis1/bin/activate
export ANALYSIS_JOBS_BASE_DIR="/Users/user/code/github/wcag-tools-test-frameworks/auth_service/jobs"
python -m uvicorn app.main:app --reload --port 8000