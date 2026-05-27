#!/usr/bin/env bash
set -uo pipefail

# Run all accessibility tool runners against one urls.txt file and collect output in:
#   ./reports/<tool-name>/
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

write_summary_line() {
  local tool="$1"
  local status="$2"
  local exit_code="$3"
  local started="$4"
  local ended="$5"
  local report_dir="$6"
  local log_file="$7"
  local notes="$8"
  local json_count
  json_count="$(count_json_files "$report_dir")"

  python3 - "$SUMMARY_TMP" "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$json_count" "$notes" <<'PY'
import json
import sys
from pathlib import Path

summary_tmp, tool, status, exit_code, started, ended, report_dir, log_file, json_count, notes = sys.argv[1:]
record = {
    "tool": tool,
    "status": status,
    "exit_code": int(exit_code),
    "started_at": started,
    "ended_at": ended,
    "report_dir": report_dir,
    "log_file": log_file,
    "json_reports": int(json_count),
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

payload = {
    "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "tools_run": len(records),
    "failed": [r for r in records if r.get("status") != "ok"],
    "tools": records,
}
dst.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
PY
}

install_deps_if_needed() {
  local runner_dir="$1"
  local package_json="$runner_dir/package.json"
  if [[ "${INSTALL_DEPS:-0}" != "1" || ! -f "$package_json" ]]; then
    return 0
  fi

  echo "Installing dependencies in ${runner_dir#$SCRIPT_DIR/}"
  (
    cd "$runner_dir" && \
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 && \
    export PUPPETEER_SKIP_DOWNLOAD=1 && \
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  )
}

run_node_tool() {
  local tool="$1"
  local runner_subdir="$2"
  local command="$3"
  local report_subdir="$4"

  local runner_dir="$SCRIPT_DIR/$runner_subdir"
  local report_dir="$REPORTS_DIR/$report_subdir"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

  mkdir -p "$report_dir"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ ! -d "$runner_dir" ]]; then
    ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    write_summary_line "$tool" "skipped" "127" "$started" "$ended" "$report_dir" "$log_file" "Runner directory not found: $runner_subdir"
    echo "[$tool] skipped: runner directory not found"
    return 127
  fi

  install_deps_if_needed "$runner_dir" >"$log_file" 2>&1 || true

  echo "[$tool] running..."
  (
    cd "$runner_dir" && \
    STORAGE_STATE_PATH="$JOB_DIR/auth/storage_state.json" \
    bash -lc "$command \"$JOB_DIR\""
  ) >>"$log_file" 2>&1
  exit_code=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$exit_code" -eq 0 ]]; then
    status="ok"
    notes=""
    echo "[$tool] ok"
  else
    status="failed"
    notes="See log file"
    echo "[$tool] failed with exit code $exit_code. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if [[ "$exit_code" -ne 0 && "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  return "$exit_code"
}

run_axe_scan() {
  local tool="axe-scan"
  local runner_dir="$SCRIPT_DIR/axe-scan"
  local report_dir="$REPORTS_DIR/axe-scan"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

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
    status="ok"
    notes=""
    echo "[$tool] ok"
  else
    status="failed"
    notes="See log file"
    echo "[$tool] failed with exit code $exit_code. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if [[ "$exit_code" -ne 0 && "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  return "$exit_code"
}

run_screenshots() {
  local tool="screenshots"
  local runner_dir="$SCRIPT_DIR/axe_core_runner"
  local report_dir="$REPORTS_DIR/screenshots"
  local log_file="$LOGS_DIR/${tool}.log"
  local started ended exit_code status notes

  mkdir -p "$report_dir"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  install_deps_if_needed "$runner_dir" >"$log_file" 2>&1 || true

  echo "[$tool] running..."
  (
    cd "$runner_dir" && \
    STORAGE_STATE_PATH="$JOB_DIR/auth/storage_state.json" \
    node run_screenshots.js "$JOB_DIR" && \
    rm -rf "$report_dir" && \
    mkdir -p "$report_dir" && \
    if [[ -d "$JOB_DIR/screenshots" ]]; then cp -R "$JOB_DIR/screenshots/." "$report_dir/"; fi
  ) >>"$log_file" 2>&1
  exit_code=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$exit_code" -eq 0 ]]; then
    status="ok"
    notes="Screenshots are copied from ./screenshots into ./reports/screenshots for a single reports tree."
    echo "[$tool] ok"
  else
    status="failed"
    notes="See log file"
    echo "[$tool] failed with exit code $exit_code. Log: $log_file"
  fi

  write_summary_line "$tool" "$status" "$exit_code" "$started" "$ended" "$report_dir" "$log_file" "$notes"

  if [[ "$exit_code" -ne 0 && "${STOP_ON_FAIL:-0}" == "1" ]]; then
    finalise_summary
    exit "$exit_code"
  fi

  return "$exit_code"
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
  echo "Completed with $failures failed/skipped tool(s). Check $LOGS_DIR and $SUMMARY_JSON."
  exit 1
fi

echo "Completed successfully."
