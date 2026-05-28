# Accessibility Tool Runners

A standalone collection of accessibility tool runners for scanning a list of URLs and collecting each tool's JSON output into a single `reports/` folder.

This repo is intended to be the runner layer only: it runs the tools, captures their raw reports, screenshots, tab-order maps, and contrast data, then organises everything ready for later analysis.

Important: a top-level `completed` status means the tool runner executed and generated reports or artefacts. It does **not** mean the scanned page passed accessibility checks. Accessibility findings are expected output.

## What it runs

The top-level `run_all_tools.sh` script can run and collate output from:

| Tool | Output folder |
| --- | --- |
| axe-core via Playwright | `reports/axe-core/` |
| HTML_CodeSniffer | `reports/html-sniffer/` |
| IBM Accessibility Checker | `reports/ibm/` |
| Lighthouse | `reports/lighthouse/` |
| Oobee | `reports/oobee/` |
| Pa11y | `reports/pa11y/` |
| Pa11y with axe runner | `reports/pa11y-axe/` |
| Pa11y with HTMLCS runner | `reports/pa11y-htmlcs/` |
| UUV | `reports/uuv/` |
| Virtual Screen Reader | `reports/virtual-screenreader/` |
| Tab map | `reports/tab-map/` |
| Screenshots | `reports/screenshots/` |
| Contrast checker | `reports/contrast-checker/` |
| axe-scan CLI, optional | `reports/axe-scan/` |

Each tool also gets a log file in:

```text
reports/_logs/
```

A run summary is written to:

```text
reports/_run-summary.json
```

## Requirements

You will need:

- macOS, Linux, or another Unix-like shell environment
- Bash
- Node.js and npm
- Python 3
- Google Chrome installed locally; Playwright-based runners are configured to use your installed Chrome rather than downloading the full Playwright browser bundle
- Google Chrome installed locally; `npx playwright install chrome` can set up the Playwright Chrome channel when `PLAYWRIGHT_INSTALL_CHROME=1` is used

The script can install each runner's npm dependencies for you by setting `INSTALL_DEPS=1`. Browser downloads are skipped during dependency installation; the runners use local Chrome by default.

## URL input

Create a plain text file containing one URL per line:

```text
https://example.com/
https://example.com/about
https://example.com/contact
```

You can either pass this file to the script:

```bash
./run_all_tools.sh urls.txt
```

Or place it at:

```text
input/urls.txt
```

and run:

```bash
./run_all_tools.sh
```

The script normalises the chosen URL file into `input/urls.txt`, because the individual runners expect that shared location.

## Quick start

From the repo root:

```bash
chmod +x run_all_tools.sh
INSTALL_DEPS=1 PLAYWRIGHT_INSTALL_CHROME=1 ./run_all_tools.sh urls.txt
```

That will:

1. copy `urls.txt` into `input/urls.txt`
2. install npm dependencies in each runner folder that has a `package.json`
3. run each configured tool
4. collect reports into `reports/<tool-name>/`
5. write logs into `reports/_logs/`
6. install and use local `axe-scan` from `axe-scan/node_modules` when axe-scan is included
7. omit `axe-scan` automatically when login/auth mode is enabled
8. write a machine-readable summary to `reports/_run-summary.json`

## Common commands

Run everything using an existing `input/urls.txt`:

```bash
./run_all_tools.sh
```

Run everything using a specific URL file:

```bash
./run_all_tools.sh path/to/urls.txt
```

Install dependencies before running:

```bash
INSTALL_DEPS=1 ./run_all_tools.sh urls.txt
```

## Chrome rather than full Playwright Chromium install

The runners are configured to use the Chrome browser channel by default:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=chrome
```

That means the repo does **not** need the usual full bundled-browser step:

```bash
npx playwright install chromium
```

However, the `playwright` **npm package** is still required by runners that do `require("playwright")`. Use this on a fresh checkout:

```bash
INSTALL_DEPS=1 PLAYWRIGHT_INSTALL_CHROME=1 ./run_all_tools.sh urls.txt
```

That does two separate things:

1. installs each runner's Node dependencies, including the `playwright` package where needed;
2. runs `npx playwright install chrome`, which installs/uses the Chrome channel rather than the bundled Chromium browser.

For Pa11y/Puppeteer-based tools, the default Chrome path is inferred for macOS, Windows, and Linux. Override it when needed:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./run_all_tools.sh urls.txt
```

Clean old reports before running:

```bash
CLEAN_REPORTS=1 ./run_all_tools.sh urls.txt
```

Stop as soon as one tool fails:

```bash
STOP_ON_FAIL=1 ./run_all_tools.sh urls.txt
```

Run only selected tools:

```bash
TOOLS="axe-core html-sniffer tab-map screenshots contrast-checker" ./run_all_tools.sh urls.txt
```

Run just screenshots and tab maps:

```bash
TOOLS="screenshots tab-map" ./run_all_tools.sh urls.txt
```

Run in login/auth mode. Compatible runners receive `auth/storage_state.json`; `axe-scan` is omitted because it cannot reuse that browser state:

```bash
USE_LOGIN=1 ./run_all_tools.sh urls.txt
```

## Tool names for `TOOLS`

Use these names when limiting a run:

```text
axe-core
html-sniffer
ibm
lighthouse
oobee
pa11y
pa11y-axe
pa11y-htmlcs
uuv
virtual-screenreader
tab-map
screenshots
contrast-checker
axe-scan
```

Example:

```bash
TOOLS="pa11y pa11y-axe pa11y-htmlcs" ./run_all_tools.sh urls.txt
```

## Output structure

After a run, the repo should look broadly like this:

```text
.
├── input/
│   └── urls.txt
├── reports/
│   ├── axe-core/
│   ├── html-sniffer/
│   ├── ibm/
│   ├── lighthouse/
│   ├── oobee/
│   ├── pa11y/
│   ├── pa11y-axe/
│   ├── pa11y-htmlcs/
│   ├── uuv/
│   ├── virtual-screenreader/
│   ├── tab-map/
│   ├── screenshots/
│   ├── contrast-checker/
│   ├── axe-scan/
│   ├── _logs/
│   └── _run-summary.json
└── run_all_tools.sh
```

The intention is that `reports/` can be consumed by a separate analyser later.

## Run summary

The script writes `reports/_run-summary.json` after every run.

It includes:

- which tools ran
- start and end timestamps
- exit codes
- report folder paths
- log file paths
- number of JSON reports found per tool
- number of JSON reports found per tool
- total report files found per tool
- whether reports or artefacts were generated
- failed or skipped tool runners

The run summary uses runner-focused statuses:

| Status | Meaning |
| --- | --- |
| `completed` | The runner exited cleanly and generated its normal output. |
| `completed_with_findings` | The runner used a non-zero exit code to indicate accessibility findings, but it still completed. Common for Pa11y exit code `2`. |
| `completed_nonzero` | The runner exited non-zero, but report artefacts were generated, so the scan is treated as completed with a non-zero tool exit. Check the log if needed. |
| `failed` | The runner did not generate report artefacts. Usually setup, dependency, browser, or script failure. |
| `skipped` | The runner was unavailable, for example a runner folder was missing. |
| `omitted` | The runner was deliberately not run for this mode. Currently used for `axe-scan` during login/auth runs. |

This is useful for CI, debugging, and checking whether a run produced the expected report files.

## Logs

Each tool writes stdout and stderr to its own log file:

```text
reports/_logs/<tool-name>.log
```

For example:

```text
reports/_logs/axe-core.log
reports/_logs/html-sniffer.log
reports/_logs/screenshots.log
```

If a tool fails, check its log first.

## Authentication / logged-in pages

Some runners use Playwright and support a shared storage state file:

```text
auth/storage_state.json
```

If present, the orchestration script exposes it to compatible runners as:

```text
STORAGE_STATE_PATH=./auth/storage_state.json
```

You can also make the intended mode explicit:

```bash
USE_LOGIN=1 ./run_all_tools.sh urls.txt
```

This is useful when scanning pages that need an authenticated browser session.

### axe-scan and login/auth mode

`axe-scan` is the exception. It can do simple/basic authentication, but it cannot reuse the Playwright `auth/storage_state.json` session used by the other browser-based runners.

For that reason, `run_all_tools.sh` automatically omits `axe-scan` when login/auth mode is detected. The summary records it as:

```json
"status": "omitted"
```

Login/auth mode is detected when either:

- `USE_LOGIN=1`, `LOGIN=1`, or `AUTH_ENABLED=1` is set; or
- `auth/storage_state.json` exists; or
- `AUTH_STORAGE_STATE` points at an existing storage-state file.

## Local axe-scan support

The `axe-scan` runner is local to this repo. It has its own package file:

```text
axe-scan/package.json
```

The orchestration script installs it with the same dependency step as the other runners:

```bash
INSTALL_DEPS=1 ./run_all_tools.sh urls.txt
```

Then it runs the local binary with:

```bash
npm exec -- axe-scan run
```

You do **not** need a global `axe-scan` install.

Run only axe-scan:

```bash
TOOLS="axe-scan" ./run_all_tools.sh urls.txt
```

## Notes on dependency installation

Most runner folders have their own `package.json` and `package-lock.json`. The `axe-scan` folder now also has a local `package.json`, so it is installed and executed from the repo rather than from a global npm install.

When you run with:

```bash
INSTALL_DEPS=1 ./run_all_tools.sh urls.txt
```

The script will run:

```bash
npm ci
```

where a `package-lock.json` exists, otherwise:

```bash
npm install
```

This repo version removes the local Playwright `postinstall` browser download hooks and sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and `PUPPETEER_SKIP_DOWNLOAD=1` during `INSTALL_DEPS=1`, so dependency installation should not pull down full browser bundles.

## Troubleshooting

### `Permission denied: ./run_all_tools.sh`

Make the script executable:

```bash
chmod +x run_all_tools.sh
```

### A tool shows accessibility findings

That is expected. The orchestration script is concerned with whether the runner completed and produced reports, not whether the target page passed accessibility testing.

For example, Pa11y can exit with code `2` when it finds issues. The script records that as `completed_with_findings`, not as a failed runner.

### A runner failed but the script continued

By default, the script keeps going so you can still get reports from the other tools.

Check:

```text
reports/_run-summary.json
reports/_logs/<tool-name>.log
```

To stop on the first genuine runner failure:

```bash
STOP_ON_FAIL=1 ./run_all_tools.sh urls.txt
```

### `axe-scan` did not run

If login/auth mode is enabled, this is expected. `axe-scan` cannot reuse the Playwright login state, so the script records it as `omitted` and continues.

If you are not using login/auth mode, install local dependencies and run again:

```bash
INSTALL_DEPS=1 TOOLS="axe-scan" ./run_all_tools.sh urls.txt
```

You do not need `npm install -g axe-scan`; the repo uses `axe-scan/package.json` and runs the local binary with `npm exec`.

To exclude axe-scan explicitly:

```bash
TOOLS="axe-core html-sniffer ibm lighthouse oobee pa11y pa11y-axe pa11y-htmlcs uuv virtual-screenreader tab-map screenshots contrast-checker" ./run_all_tools.sh urls.txt
```

### Browser or Playwright errors

This repo is set up to use Chrome rather than the full Playwright bundled Chromium install.

If you see `Cannot find module 'playwright'`, the browser is not the issue: the runner's Node dependencies have not been installed. Run:

```bash
INSTALL_DEPS=1 PLAYWRIGHT_INSTALL_CHROME=1 ./run_all_tools.sh urls.txt
```

This installs the npm dependencies and then runs `npx playwright install chrome` for the Chrome channel.

On macOS, the default Chrome path is:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

On Linux, the default Chrome path for Pa11y/Puppeteer-based tools is:

```text
/usr/bin/google-chrome
```

If Chrome is installed somewhere else, pass it explicitly:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./run_all_tools.sh urls.txt
```

For Playwright-based tools, Chrome is selected with:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=chrome ./run_all_tools.sh urls.txt
```

That is also the default. To deliberately go back to Playwright's bundled Chromium later, set `PLAYWRIGHT_BROWSER_CHANNEL=` and run the relevant Playwright install yourself.

### Old reports are still present

Run with:

```bash
CLEAN_REPORTS=1 ./run_all_tools.sh urls.txt
```

This removes previous tool report folders before the new run.

## Suggested `.gitignore`

For a public GitHub repo, you probably want to commit the runners and scripts, but not generated reports or installed dependencies.

```gitignore
node_modules/
reports/
screenshots/
input/urls.txt
auth/storage_state.json
.DS_Store
```

If you want to include example input, add something like:

```text
input/example-urls.txt
```

rather than committing your working `input/urls.txt`.

## Current scope

This repo runs tools and collects raw output.

It does not yet attempt to deduplicate findings, rank issues, merge duplicate selectors, or provide cross-tool analysis. That analysis layer can be built separately on top of the `reports/` folder produced here.
