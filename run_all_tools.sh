#!/usr/bin/env bash
set -uo pipefail

# Run all accessibility tool runners against one urls.txt file and collect output in:
#   ./reports/<tool-name>/
#
# Statuses describe whether the runner completed and produced artefacts.
# They do NOT mean the tested page passed accessibility checks.
#
# Usage:
#   ./run_all_tools.sh [path/to/urls.txt]
#
# Defaults:
#   URL file: ./input/urls.txt if it exists, otherwise ./urls.txt
#
# Useful env vars:
#   TOOLS="axe-core html-sniffer screenshots" ./run_all_tools.sh urls.txt
#   INSTALL_DEPS=1 ./run_all_tools.sh urls.txt
#   CLEAN_REPORTS=1 ./run_all_tools.sh urls.txt
#   STOP_ON_FAIL=1 ./run_all_tools.sh urls.txt
#   PLAYWRIGHT_INSTALL_CHROME=1 ./run_all_tools.sh urls.txt
#   PLAYWRIGHT_BROWSER_CHANNEL=chrome ./run_all_tools.sh urls.txt
#   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./run_all_tools.sh urls.txt

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_DIR="$SCRIPT_DIR"
INPUT_DIR="$JOB_DIR/input"
REPORTS_DIR="$JOB_DIR/reports"
LOGS_DIR="$REPORTS_DIR/_logs"
SUMMARY_JSON="$REPORTS_DIR/_run-summary.json"
SUMMARY_TMP="$REPORTS_DIR/.run-summary-lines.jsonl"

URLS_SOURCE="${1:-}"

if [[ -z "$URLS_SOURCE" ]]; then
  if [[ -f "$INPUT_DIR/urls.txt" ]]; then
    URLS_SOURCE="$INPUT_DIR/urls.txt"
  elif [[ -f "$JOB_DIR/urls.txt" ]]; then
    URLS_SOURCE="$JOB_DIR/urls.txt"
  else
    echo "Usage: $0 [path/to/urls.txt]" >&2
    echo "No URL file supplied, and neither ./input/urls.txt nor ./urls.txt exists." >&2
    exit 1
  fi
fi

if [[ ! -f "$URLS_SOURCE" ]]; then
  echo "URL file not found: $URLS_SOURCE" >&2
  exit 1
fi

mkdir -p "$INPUT_DIR" "$REPORTS_DIR" "$LOGS_DIR"

# Normalise the shared input expected by all runners.
# Avoid cp failing when the source is already ./input/urls.txt.
if [[ "$(cd "$(dirname "$URLS_SOURCE")" && pwd)/$(basename "$URLS_SOURCE")" != "$INPUT_DIR/urls.txt" ]]; then
  cp "$URLS_SOURCE" "$INPUT_DIR/urls.txt"
fi

if [[ "${CLEAN_REPORTS:-0}" == "1" ]]; then
  find "$REPORTS_DIR" -mindepth 1 -maxdepth 1 ! -name "_logs" -exec rm -rf {} +
  : > "$SUMMARY_TMP"
else
  : > "$SUMMARY_TMP"
fi

# Default tool order. Override with TOOLS="tool-a tool-b".
DEFAULT_TOOLS=(
  "axe-core"
  "html-sniffer"
  "ibm"
  "lighthouse"
  "oobee"
  "pa11y"
  "pa11y-axe"
  "pa11y-htmlcs"
  "uuv"
  "virtual-screenreader"
  "tab-map"
  "screenshots"
  "contrast-checker"
  "axe-scan"
)

if [[ -n "${TOOLS:-}" ]]; then
  # shellcheck disable=SC2206
  TOOL_LIST=(${TOOLS})
else
  TOOL_LIST=("${DEFAULT_TOOLS[@]}")
fi

json_escape() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

count_json_files() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -name '*.json' | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

count_report_files() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

has_report_artifacts() {
  local dir="$1"
  [[ "$(count_report_files "$dir")" -gt 0 ]]
}

# Some CLI accessibility tools use non-zero exit codes to mean
# "accessibility findings were reported" rather than "the runner crashed".
# Pa11y conventionally exits 2 when issues are found.
is_expected_findings_exit() {
  local tool="$1"
  local exit_code="$2"

  case "$tool:$exit_code" in
    pa11y:2|pa11y-axe:2|pa11y-htmlcs:2)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# In this project, a successful run means the tool executed and generated
# reports/artefacts. Accessibility findings are expected and are not treated
# as failed tool runs.
is_failed_status() {
  local status="$1"
  case "$status" in
    failed|skipped)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_login_if_needed() {
  local auth_dir="$JOB_DIR/auth"
  local login_script="$auth_dir/login_and_save_state.js"
  local login_config="$auth_dir/login_config.json"
  local storage_state="$auth_dir/storage_state.json"

  if [[ "${RUN_LOGIN:-0}" != "1" ]]; then
    return 0
  fi

  if [[ ! -f "$login_config" ]]; then
    echo "RUN_LOGIN=1 but no login config found at: $login_config" >&2
    return 1
  fi

  if [[ ! -f "$login_script" ]]; then
    echo "RUN_LOGIN=1 but no login script found at: $login_script" >&2
    return 1
  fi

  echo "Running login bootstrap..."
  (
    cd "$auth_dir" || exit 1
    if [[ ! -d node_modules ]]; then
      echo "Installing auth dependencies..."
      npm install || exit 1
      npx playwright install chromium || exit 1
    fi
    node "$login_script" "$JOB_DIR" || exit 1
  ) || return 1

  if [[ ! -f "$storage_state" ]]; then
    echo "Login completed but no storage state was created: $storage_state" >&2
    return 1
  fi

  echo "Login bootstrap complete: $storage_state"
}

write_summary_line() {
  local tool="$1"
  local status="$2"
  local exit_code="$3"
  local started="$4"
  local ended="$5"
  local report_dir="$6"
  local log_file="$7"
  local notes="$8"
  local json_count file_count
  json_count="$(count_json_files "$report_dir")"
  file_count="$(count_report_files "$report_dir")"

  python3 - "$SUMMARY_TMP" "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$json_count" "$file_count" "$notes" <<'PY'
import json
import sys
from pathlib import Path

summary_tmp, tool, status, exit_code, started, ended, report_dir, log_file, json_count, file_count, notes = sys.argv[1:]
record = {
    "tool": tool,
    "status": status,
    "exit_code": int(exit_code),
    "started_at": started,
    "ended_at": ended,
    "report_dir": report_dir,
    "log_file": log_file,
    "json_reports": int(json_count),
    "report_files": int(file_count),
    "generated_reports": int(file_count) > 0,
}
if notes:
    record["notes"] = notes
with open(summary_tmp, "a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=False) + "\n")
PY
}

finalise_summary() {
  python3 - "$SUMMARY_TMP" "$SUMMARY_JSON" <<'PY'
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
records = []
if src.exists():
    with src.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

failed = [r for r in records if r.get("status") in {"failed", "skipped"}]
payload = {
    "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "status_meaning": "completed means the tool runner executed and generated reports/artifacts; it does not mean the page passed accessibility checks",
    "tools_run": len(records),
    "tools_completed": len(records) - len(failed),
    "tools_failed_or_skipped": len(failed),
    "failed": failed,
    "tools": records,
}
dst.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
PY
}

install_deps_if_needed() {
  local runner_dir="$1"
  local package_json="$runner_dir/package.json"
  local runner_label="${runner_dir#$SCRIPT_DIR/}"

  if [[ ! -f "$package_json" ]]; then
    return 0
  fi

  # INSTALL_DEPS=1 forces an install. Otherwise, install automatically when
  # node_modules is missing, because the runners require their local packages
  # even when using an externally installed Chrome browser.
  if [[ "${INSTALL_DEPS:-0}" != "1" && -d "$runner_dir/node_modules" ]]; then
    return 0
  fi

  echo "Installing Node dependencies in $runner_label"
  (
    cd "$runner_dir" || exit 1

    # This skips the heavy bundled-browser downloads during npm install.
    # The Playwright package itself is still installed, which is required for
    # require('playwright') / import { chromium } from 'playwright'.
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    export PUPPETEER_SKIP_DOWNLOAD=1

    if [[ -f package-lock.json ]]; then
      npm ci || {
        echo "npm ci failed in $runner_label; falling back to npm install so package-lock/package.json drift does not block the run."
        npm install
      }
    else
      npm install
    fi

    # Optional, but useful for a clean machine: install Playwright's Chrome
    # browser channel instead of the usual bundled Chromium browser.
    # Enabled automatically when INSTALL_DEPS=1 unless disabled explicitly.
    if grep -q '"playwright"\|"@playwright/test"' package.json; then
      if [[ "${PLAYWRIGHT_INSTALL_CHROME:-${INSTALL_DEPS:-0}}" == "1" ]]; then
        echo "Installing Playwright Chrome channel in $runner_label"
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= PUPPETEER_SKIP_DOWNLOAD= npx playwright install chrome
      fi
    fi
  )
}

if ! run_login_if_needed; then
  echo "Login bootstrap failed" >&2
  exit 1
fi

run_node_tool() {
  local tool="$1"
  local runner_subdir="$2"
  local command="$3"
  local report_subdir="$4"

  local runner_dir="$SCRIPT_DIR/$runner_subdir"
  local report_dir="$REPORTS_DIR/$report_subdir"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

  rm -rf "$report_dir"
  mkdir -p "$report_dir"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ ! -d "$runner_dir" ]]; then
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    write_summary_line "$tool" "skipped" "127" "$started" "$ended" "$report_dir" "$log_file" "Runner directory not found: $runner_subdir"
    echo "[$tool] skipped: runner directory not found"
    return 127
  fi

  if ! install_deps_if_needed "$runner_dir" >"$log_file" 2>&1; then
    exit_code=$?
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "[$tool] failed during dependency install. Log: $log_file"
    write_summary_line "$tool" "failed" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "Dependency install failed; see log file"
    if [[ "${STOP_ON_FAIL:-0}" == "1" ]]; then
      finalise_summary
      exit "$exit_code"
    fi
    return "$exit_code"
  fi

  echo "[$tool] running..."
  (
    cd "$runner_dir" && \
    STORAGE_STATE_PATH="$JOB_DIR/auth/storage_state.json" \
    PLAYWRIGHT_BROWSER_CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chrome}" \
    CHROME_PATH="${CHROME_PATH:-}" \
    bash -lc "$command \"$JOB_DIR\""
  ) >>"$log_file" 2>&1
  exit_code=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$exit_code" -eq 0 ]]; then
    status="completed"
    notes="Runner completed and generated its normal output. This does not mean the scanned page passed accessibility checks."
    echo "[$tool] completed"
  elif is_expected_findings_exit "$tool" "$exit_code"; then
    status="completed_with_findings"
    notes="Tool exited with code $exit_code, which usually means accessibility findings were reported rather than the runner crashing. See log file and JSON reports."
    echo "[$tool] completed with findings (exit code $exit_code). Log: $log_file"
  elif has_report_artifacts "$report_dir"; then
    status="completed_nonzero"
    notes="Tool exited with code $exit_code but report artefacts were generated. Treat as a completed scan with non-zero tool exit; inspect log if needed."
    echo "[$tool] completed with non-zero exit code $exit_code; reports were generated. Log: $log_file"
  else
    status="failed"
    notes="No report artefacts were generated. See log file."
    echo "[$tool] failed with exit code $exit_code and no reports generated. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if is_failed_status "$status" && [[ "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  if is_failed_status "$status"; then
    return "$exit_code"
  fi

  return 0
}

run_axe_scan() {
  local tool="axe-scan"
  local runner_dir="$SCRIPT_DIR/axe-scan"
  local report_dir="$REPORTS_DIR/axe-scan"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

  rm -rf "$report_dir"
  mkdir -p "$report_dir"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ ! -d "$runner_dir" ]]; then
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    write_summary_line "$tool" "skipped" "127" "$started" "$ended" "$report_dir" "$log_file" "Runner directory not found: axe-scan"
    echo "[$tool] skipped: runner directory not found"
    return 127
  fi

  if ! command -v axe-scan >/dev/null 2>&1; then
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    write_summary_line "$tool" "skipped" "127" "$started" "$ended" "$report_dir" "$log_file" "axe-scan command not found. Install with: npm install -g axe-scan"
    echo "[$tool] skipped: axe-scan command not found. Install with: npm install -g axe-scan"
    return 127
  fi

  echo "[$tool] running..."
  (
    cd "$runner_dir" && \
    rm -rf reports axe-results.csv && \
    cp "$INPUT_DIR/urls.txt" urls.txt && \
    axe-scan run > axe-results.csv && \
    ./convert-csv-to-json-files.sh && \
    mkdir -p "$report_dir" && \
    cp -R reports/. "$report_dir/"
  ) >"$log_file" 2>&1
  exit_code=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$exit_code" -eq 0 ]]; then
    status="completed"
    notes="Runner completed and generated its normal output. This does not mean the scanned page passed accessibility checks."
    echo "[$tool] completed"
  elif has_report_artifacts "$report_dir"; then
    status="completed_nonzero"
    notes="Tool exited with code $exit_code but report artefacts were generated. Treat as a completed scan with non-zero tool exit; inspect log if needed."
    echo "[$tool] completed with non-zero exit code $exit_code; reports were generated. Log: $log_file"
  else
    status="failed"
    notes="No report artefacts were generated. See log file."
    echo "[$tool] failed with exit code $exit_code and no reports generated. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if is_failed_status "$status" && [[ "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  if is_failed_status "$status"; then
    return "$exit_code"
  fi

  return 0
}

run_screenshots() {
  local tool="screenshots"
  local runner_dir="$SCRIPT_DIR/axe_core_runner"
  local report_dir="$REPORTS_DIR/screenshots"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

  rm -rf "$report_dir"
  mkdir -p "$report_dir"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if ! install_deps_if_needed "$runner_dir" >"$log_file" 2>&1; then
    exit_code=$?
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "[$tool] failed during dependency install. Log: $log_file"
    write_summary_line "$tool" "failed" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "Dependency install failed; see log file"
    if [[ "${STOP_ON_FAIL:-0}" == "1" ]]; then
      finalise_summary
      exit "$exit_code"
    fi
    return "$exit_code"
  fi

  echo "[$tool] running..."
  (
    cd "$runner_dir" && \
    STORAGE_STATE_PATH="$JOB_DIR/auth/storage_state.json" \
    PLAYWRIGHT_BROWSER_CHANNEL="${PLAYWRIGHT_BROWSER_CHANNEL:-chrome}" \
    CHROME_PATH="${CHROME_PATH:-}" \
    node run_screenshots.js "$JOB_DIR" && \
    rm -rf "$report_dir" && \
    mkdir -p "$report_dir" && \
    if [[ -d "$JOB_DIR/screenshots" ]]; then cp -R "$JOB_DIR/screenshots/." "$report_dir/"; fi
  ) >>"$log_file" 2>&1
  exit_code=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$exit_code" -eq 0 ]]; then
    status="completed"
    notes="Screenshots are copied from ./screenshots into ./reports/screenshots for a single reports tree."
    echo "[$tool] completed"
  elif has_report_artifacts "$report_dir"; then
    status="completed_nonzero"
    notes="Screenshot runner exited with code $exit_code but screenshot artefacts were generated. Inspect log if needed."
    echo "[$tool] completed with non-zero exit code $exit_code; screenshots were generated. Log: $log_file"
  else
    status="failed"
    notes="No screenshot artefacts were generated. See log file."
    echo "[$tool] failed with exit code $exit_code and no screenshots generated. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if is_failed_status "$status" && [[ "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  if is_failed_status "$status"; then
    return "$exit_code"
  fi

  return 0
}

run_tool_by_name() {
  case "$1" in
    axe-core) run_node_tool "axe-core" "axe_core_runner" "node run_axe_core.js" "axe-core" ;;
    html-sniffer) run_node_tool "html-sniffer" "html_sniffer_runner" "node run_htmlsniffer.js" "html-sniffer" ;;
    ibm) run_node_tool "ibm" "ibm_runner" "node run_ibm.js" "ibm" ;;
    lighthouse) run_node_tool "lighthouse" "lighthouse_runner" "node run_lighthouse.js" "lighthouse" ;;
    oobee) run_node_tool "oobee" "oobee_runner" "node run_oobee.js" "oobee" ;;
    pa11y) run_node_tool "pa11y" "pa11y_runner" "node run_pa11y.js" "pa11y" ;;
    pa11y-axe) run_node_tool "pa11y-axe" "pa11y_runner_axe" "node run_pa11y_axe.js" "pa11y-axe" ;;
    pa11y-htmlcs) run_node_tool "pa11y-htmlcs" "pa11y_runner_htmlcs" "node run_pa11y_htmlcs.js" "pa11y-htmlcs" ;;
    uuv) run_node_tool "uuv" "uuv_runner" "node run_uuv.js" "uuv" ;;
    virtual-screenreader) run_node_tool "virtual-screenreader" "virtual_screenreader_runner" "node run_virtual_screenreader.js" "virtual-screenreader" ;;
    tab-map) run_node_tool "tab-map" "tab-map-runner" "node run_tab_map.js" "tab-map" ;;
    contrast-checker) run_node_tool "contrast-checker" "contrast_checker" "node run_contrast.js" "contrast-checker" ;;
    screenshots) run_screenshots ;;
    axe-scan) run_axe_scan ;;
    *)
      echo "Unknown tool: $1" >&2
      return 2
      ;;
  esac
}

echo "URL input: $INPUT_DIR/urls.txt"
echo "Reports:   $REPORTS_DIR"
echo "Logs:      $LOGS_DIR"
echo

failures=0
for tool in "${TOOL_LIST[@]}"; do
  run_tool_by_name "$tool"
  rc=$?
  if [[ "$rc" -ne 0 ]]; then
    failures=$((failures + 1))
  fi
  echo
done

finalise_summary
rm -f "$SUMMARY_TMP"

echo "Summary: $SUMMARY_JSON"
if [[ "$failures" -gt 0 ]]; then
  echo "Completed with $failures tool runner failure(s)/skip(s). Check $LOGS_DIR and $SUMMARY_JSON."
  exit 1
fi

echo "Completed: all selected tool runners executed and generated their expected report artefacts."
echo "Note: this does not mean the tested pages passed accessibility checks; inspect the JSON reports for findings."
