#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${1:-$(pwd)}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
LOG_DIR="$ROOT_DIR/orchestrator-logs"
SUMMARY_FILE="$LOG_DIR/summary.txt"
mkdir -p "$LOG_DIR"
: > "$SUMMARY_FILE"

# Set to 1 if you want the script to stop at the first failure.
FAIL_FAST="${FAIL_FAST:-0}"

# Set to 0 to skip deleting old report/output folders before a new run.
CLEAN_FIRST="${CLEAN_FIRST:-1}"

cleanup_outputs() {
  local dir
  local removed_any=0

  echo "Cleaning old report/output folders..."

  # Start fresh for orchestrator logs as well.
  rm -rf "$LOG_DIR"
  mkdir -p "$LOG_DIR"
  : > "$SUMMARY_FILE"

  # Common output/report folder names used by the tool frameworks.
  local -a dir_names=(
    report reports
    result results
    output outputs
    artifacts
    audit-results
    axe-results
    htmlcs-results
    ibm-results
    lighthouse-results
    oobee-results
    pa11y-results
    uuv-results
    playwright-report
    test-results
    blob-report
    allure-results
    allure-report
    coverage
    tmp
    temp
  )

  # Common single-file outputs worth clearing.
  local -a file_names=(
    axe-results.csv
    accessibility_analysis.xlsx
    summary.html
    summary.json
    results.json
    report.html
    report.json
  )

  local -a tool_dirs=(
    "$ROOT_DIR/axe-scan"
    "$ROOT_DIR/htmlsniffer"
    "$ROOT_DIR/oobee"
    "$ROOT_DIR/pa11y-ci"
    "$ROOT_DIR/playwright-achecker"
    "$ROOT_DIR/playwright-axe-core"
    "$ROOT_DIR/playwright-lighthouse"
    "$ROOT_DIR/uuv"
    # "$ROOT_DIR/virtual-screenreader"
  )

  for dir in "${tool_dirs[@]}"; do
    [[ -d "$dir" ]] || continue

    local name path
    for name in "${dir_names[@]}"; do
      while IFS= read -r -d '' path; do
        echo "  removing dir: $path"
        rm -rf "$path"
        removed_any=1
      done < <(find "$dir" -mindepth 1 -type d -name "$name" -print0 2>/dev/null)
    done

    for name in "${file_names[@]}"; do
      while IFS= read -r -d '' path; do
        echo "  removing file: $path"
        rm -f "$path"
        removed_any=1
      done < <(find "$dir" -mindepth 1 -type f -name "$name" -print0 2>/dev/null)
    done
  done

  if [[ "$removed_any" == "0" ]]; then
    echo "  no prior report/output folders found"
  fi
}


have_cmd() { command -v "$1" >/dev/null 2>&1; }

run_step() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/${name}.log"
  echo "\n=== $name ===" | tee -a "$SUMMARY_FILE"
  if "$@" > >(tee "$logfile") 2>&1; then
    echo "PASS $name" | tee -a "$SUMMARY_FILE"
  else
    local rc=$?
    echo "FAIL $name (exit $rc)" | tee -a "$SUMMARY_FILE"
    if [[ "$FAIL_FAST" == "1" ]]; then
      echo "Stopping because FAIL_FAST=1"
      exit "$rc"
    fi
  fi
}

npm_install() {
  local dir="$1"
  (
    cd "$dir"
    npm install
  )
}

yarn_install() {
  local dir="$1"
  (
    cd "$dir"
    yarn install
  )
}

find_chrome_for_htmlsniffer() {
  local candidate
  for candidate in \
    "/usr/bin/google-chrome" \
    "/usr/bin/google-chrome-stable" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "C:/Program Files/Google/Chrome/Application/chrome.exe"; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done

  if [[ -d "$HOME/.cache/ms-playwright" ]]; then
    candidate="$(find "$HOME/.cache/ms-playwright" -type f \( -name chrome -o -name chromium -o -name 'Google Chrome' \) 2>/dev/null | head -n 1 || true)"
    [[ -n "$candidate" ]] && { echo "$candidate"; return 0; }
  fi

  if have_cmd google-chrome; then command -v google-chrome; return 0; fi
  if have_cmd chromium-browser; then command -v chromium-browser; return 0; fi
  if have_cmd chromium; then command -v chromium; return 0; fi
  return 1
}

run_axe_scan() {
  local dir="$ROOT_DIR/axe-scan"
  cd "$dir"

  if ! have_cmd axe-scan; then
    echo "axe-scan CLI not found. Installing locally via npm..."
    npm install --no-save axe-scan
    export PATH="$dir/node_modules/.bin:$PATH"
  fi

  axe-scan run > axe-results.csv
  chmod +x ./convert-csv-to-json-files.sh
  ./convert-csv-to-json-files.sh
}

run_htmlsniffer() {
  local dir="$ROOT_DIR/htmlsniffer"
  cd "$dir"

  npm install

  local chrome_path
  chrome_path="$(find_chrome_for_htmlsniffer)" || {
    echo "Could not find Chrome/Chromium for htmlsniffer."
    echo "Install Google Chrome or Playwright Chromium first, then rerun."
    return 1
  }

  echo "Using browser for htmlsniffer: $chrome_path"
  cp index.js index.js.bak
  python3 - <<PY
from pathlib import Path
p = Path("index.js")
text = p.read_text()
start = text.index("const EXECUTABLE_PATH =")
end = text.index("const fs = require('fs');", start)
replacement = "const EXECUTABLE_PATH = " + repr(r'''$chrome_path''') + ";\n\n"
p.write_text(text[:start] + replacement + text[end:])
PY

  trap '[[ -f index.js.bak ]] && mv -f index.js.bak index.js' RETURN
  npm start
  mv -f index.js.bak index.js
  trap - RETURN
}

run_oobee() {
  local dir="$ROOT_DIR/oobee"
  cd "$dir"
  npm install

  # Patch Oobee URL test script so JSON outputs go to ../reports when the script
  # lives under tests/.
  local oobee_script=""
  if [[ -f "$dir/tests/index.js" ]]; then
    oobee_script="$dir/tests/index.js"
  elif [[ -f "$dir/tests/oobee.js" ]]; then
    oobee_script="$dir/tests/oobee.js"
  else
    oobee_script="$(find "$dir/tests" -maxdepth 2 -type f -name '*.js' 2>/dev/null | head -n 1 || true)"
  fi

  if [[ -n "$oobee_script" && -f "$oobee_script" ]]; then
    echo "Patching Oobee script output path: $oobee_script"
    cp "$oobee_script" "$oobee_script.bak"
    python3 - <<PY
from pathlib import Path
p = Path(r"""$oobee_script""")
text = p.read_text(encoding="utf-8")

# Ensure urls.txt is read relative to the script location.
text = text.replace(
    "const urls = fs.readFileSync('urls.txt', 'utf-8')",
    "const urls = fs.readFileSync(path.join(__dirname, 'urls.txt'), 'utf-8')"
)

# Ensure reportsDir points to ../reports when the script lives in tests/.
if "const reportsDir = path.join(__dirname, '..', 'reports');" not in text:
    if "const reportsDir = path.join(__dirname, 'reports');" in text:
        text = text.replace(
            "const reportsDir = path.join(__dirname, 'reports');",
            "const reportsDir = path.join(__dirname, '..', 'reports');"
        )
    elif "for (const url of urls) {" in text:
        text = text.replace(
            "for (const url of urls) {",
            "const reportsDir = path.join(__dirname, '..', 'reports');\\n  fs.mkdirSync(reportsDir, { recursive: true });\\n\\n  for (const url of urls) {",
            1
        )

# Ensure write path uses reportsDir.
text = text.replace(
    "path.join(__dirname, filename)",
    "path.join(reportsDir, filename)"
)

p.write_text(text, encoding="utf-8")
PY

    trap '[[ -f "$oobee_script.bak" ]] && mv -f "$oobee_script.bak" "$oobee_script"' RETURN
  else
    echo "Warning: could not find Oobee test script under $dir/tests to patch"
  fi

  npm test

  if [[ -f "${oobee_script}.bak" ]]; then
    mv -f "${oobee_script}.bak" "$oobee_script"
  fi
  trap - RETURN
}

run_pa11y_ci() {
  local dir="$ROOT_DIR/pa11y-ci"
  cd "$dir"
  npm install --no-save pa11y-ci pa11y-ci-reporter-html
  npx pa11y-ci --config pa11yconfig-multiple-urls.json
}

run_playwright_achecker() {
  local dir="$ROOT_DIR/playwright-achecker"
  cd "$dir"
  npm install
  npx playwright install --with-deps
  npm test
}

run_playwright_axe_core() {
  local dir="$ROOT_DIR/playwright-axe-core"
  cd "$dir"
  npm install
  npx playwright install --with-deps
  npx playwright test
}

run_playwright_lighthouse() {
  local dir="$ROOT_DIR/playwright-lighthouse"
  cd "$dir"
  npm install
  npx playwright install --with-deps
  npx playwright test
}

run_uuv() {
  local dir="$ROOT_DIR/uuv"
  cd "$dir"
  npm install
  npx playwright install chromium
  npm run audit
}

run_virtual_screenreader() {
  local dir="$ROOT_DIR/virtual-screenreader"
  cd "$dir"
  if have_cmd yarn; then
    yarn install
    yarn sr:urls
  else
    echo "yarn not found; falling back to npm install + npx jest"
    npm install
    npx jest tests/scrapefromurl.test.js
  fi
}


copy_reports_to_collection() {
  local reports_root="$ROOT_DIR/reports"
  mkdir -p "$reports_root"

  echo "Collecting tool report folders into: $reports_root"

  # Start fresh so only the latest run is present.
  rm -rf "$reports_root"
  mkdir -p "$reports_root"

  copy_first_existing_dir() {
    local target_name="$1"
    shift
    local candidate
    for candidate in "$@"; do
      if [[ -d "$candidate" ]]; then
        echo "  copying: $candidate -> $reports_root/$target_name"
        cp -R "$candidate" "$reports_root/$target_name"
        return 0
      fi
    done
    echo "  no report directory found for $target_name"
    return 1
  }

  copy_first_existing_dir "axe-scan" \
    "$ROOT_DIR/axe-scan/reports"

  copy_first_existing_dir "html-sniffer" \
    "$ROOT_DIR/htmlsniffer/accessibility_reports" 

  copy_first_existing_dir "oobee" \
    "$ROOT_DIR/oobee/reports"

  copy_first_existing_dir "pa11y" \
    "$ROOT_DIR/pa11y-ci/accessibility-reports" 

  copy_first_existing_dir "axe-core" \
    "$ROOT_DIR/playwright-axe-core/ally-reports" 

  copy_first_existing_dir "ibm" \
    "$ROOT_DIR/playwright-achecker/accessibility-reports"

  copy_first_existing_dir "lighthouse" \
    "$ROOT_DIR/playwright-lighthouse/tests/reports"

  copy_first_existing_dir "uuv" \
    "$ROOT_DIR/uuv/reports/per-url"

  echo "Report collection complete."
}

main() {
  echo "Root: $ROOT_DIR"
  echo "Logs: $LOG_DIR"

  [[ -d "$ROOT_DIR/axe-scan" ]] || { echo "Could not find tool folders under $ROOT_DIR"; exit 1; }

  if [[ "$CLEAN_FIRST" == "1" ]]; then
    cleanup_outputs
  fi

  run_step axe-scan run_axe_scan
  run_step htmlsniffer run_htmlsniffer
  run_step oobee run_oobee
  run_step pa11y-ci run_pa11y_ci
  run_step playwright-achecker run_playwright_achecker
  run_step playwright-axe-core run_playwright_axe_core
  run_step playwright-lighthouse run_playwright_lighthouse
  run_step uuv run_uuv
  # run_step virtual-screenreader run_virtual_screenreader

  copy_reports_to_collection

  echo "\nFinished. See $SUMMARY_FILE and logs in $LOG_DIR/"
}

main "$@"
