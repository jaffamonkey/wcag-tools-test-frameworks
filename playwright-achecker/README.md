# Playwright + IBM Equal Access (accessibility-checker)

This repo runs **Playwright** UI flows and then runs **IBM Equal Access `accessibility-checker`** against the page HTML snapshot.  
It produces IBM aChecker reports (HTML and XLSX) and publishes them locally and in CI.

## Repo layout

```
playwright-achecker/
├─ accessibility-reports/          # aChecker output (from .achecker.yml: outputFolder)
│  └─ screenshots/                 # failure-only screenshots (added by utils/accessibility.js)
├─ playwright-report/              # Playwright HTML report (with attachments)
├─ test-results/                   # Playwright raw results
├─ tests/
│  ├─ a11y.shared.js
│  ├─ accessibility.offers-rewards.spec.js
│  ├─ accessibility.partners-virgin.spec.js
│  └─ accessibility.rewards-history.spec.js
├─ utils/
│  ├─ accessibility.js             # aChecker integration + attachments
│  └─ login.js
├─ .achecker.yml                   # aChecker config (policy, output formats, output folder)
├─ azure_pipelines.yml             # CI pipeline (install → run → publish reports)
└─ playwright.config.js
```

## Prerequisites

- Node.js 18+ recommended
- Playwright browsers installed (`npx playwright install`)

## Install

```bash
npm install
npx playwright install
```

## Configure credentials

The login helper reads these environment variables (defaults exist, but you probably want CI secrets):

- `TEST_USERNAME`
- `TEST_PASSWORD`
- `TEST_URL`

Example (local):

```bash
export TEST_USERNAME="you@example.com"
export TEST_PASSWORD="yourPassword"
export TEST_URL="https://test.url"
```

## Run tests

Run all a11y tests:

```bash
npx playwright test
```

Run a single spec:

```bash
npx playwright test tests/test.js
```

Headless mode:

```bash
HEADLESS=true npx playwright test
```

## Reports

### 1) Playwright HTML report

After a run:

```bash
npx playwright show-report
```

The Playwright report contains attachments for each scan:
- aChecker output files created during that scan (HTML/XLSX/… as configured)
- patched copies of the aChecker HTML (so **Learn more** links open correctly)
- screenshots on failures (element shots + highlighted full-page screenshot)

### 2) aChecker reports (`accessibility-reports/`)

aChecker writes files into the folder defined in `.achecker.yml`:

```yml
outputFolder: accessibility-reports
outputFormat:
  - html
  - xlsx
```

You should see filenames like:
- `… .html`
- `results_YYYY-MM-DDTHH-MM-SS.sssZ.xlsx`

#### Important: flushing XLSX
Some output formats (notably XLSX) may only appear after the aChecker process is closed.  
Each spec file should call `closeAccessibilityChecker()` once in `test.afterAll()`:

```js
const { closeAccessibilityChecker } = require("../utils/accessibility");

test.afterAll(async () => {
  await closeAccessibilityChecker();
});
```

## aChecker policy / levels (.achecker.yml)

Example (WCAG 2.2 AA, fail on violations):

```yml
ruleArchive: latest
policies:
  - WCAG_2_2
failLevels:
  - violation
reportLevels:
  - violation
  - potentialviolation
  - recommendation
outputFormat:
  - html
  - xlsx
outputFolder: accessibility-reports
```

If you want the build to fail on **potential violations** too:

```yml
failLevels:
  - violation
  - potentialviolation
```

## CI (Azure DevOps)

`azure_pipelines.yml`:
- installs Node + Playwright browsers
- runs Playwright tests
- publishes these artifacts:
  - `playwright-report/`
  - `accessibility-reports/`
  - `test-results/`

## Troubleshooting

### “Cannot GET /rules/archives/…/some-rule.html” in aChecker HTML
When an aChecker HTML report is opened inside the Playwright report, the browser tries to resolve
`/rules/archives/...` relative to the Playwright report server.

`utils/accessibility.js` attaches a **patched copy** of each aChecker HTML report that:
- adds `<base href="https://able.ibm.com/">`
- rewrites `href="/rules/archives/..."` to `https://able.ibm.com/rules/archives/...`

Open the `*.patched.html` attachment in the Playwright report.

### XLSX shows huge “Page url” values (data:text/html…)
aChecker scans an HTML snapshot; some formats may embed that as a `data:` URL in spreadsheets.
If you see this, it’s expected. (It doesn’t affect rule results.)
