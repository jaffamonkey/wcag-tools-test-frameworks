# Playwright + axe-core accessibility tests

This project runs automated accessibility checks with **Playwright Test** + **@axe-core/playwright** and produces:

- A **Playwright HTML test report** (`playwright-report/`)
- Per-scan **axe HTML + JSON reports** (`a11y-reports/`)
- Optional **screenshots on failures** (`a11y-reports/screenshots/`)
- A rolling **summary.json** for quick tracking (`a11y-reports/summary.json`)

---

## Repository structure

```text
playwright-axe-core/
├─ a11y-reports/                 # generated axe reports + summary + screenshots
├─ playwright-report/            # generated Playwright HTML report
├─ test-results/                 # Playwright output (traces, etc.)
├─ tests/
│  ├─ a11y.shared.ts
│  ├─ accessibility.offers-rewards.spec.ts
│  ├─ accessibility.partners-virgin.spec.ts
│  ├─ accessibility.rewards-history.spec.ts
│  └─ accessibility.spec         # (optional/legacy)
├─ utils/
│  ├─ accessibility.ts           # axe runner + reporting helpers
│  └─ login.ts                   # login helpers
├─ playwright.config.ts
├─ tsconfig.json
└─ urls.json
```

---

## Prerequisites

- **Node.js** (LTS recommended)
- **Playwright browsers** installed for the repo

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npx playwright install --with-deps
```

---

## Configuration

### Credentials

Login is handled by `utils/login.ts`. By default it reads credentials from environment variables:

- `TEST_USERNAME`
- `TEST_PASSWORD`

Example (macOS/Linux):

```bash
export TEST_USERNAME="your.user@example.com"
export TEST_PASSWORD="yourPasswordHere"
```

Example (PowerShell):

```powershell
$env:TEST_USERNAME="your.user@example.com"
$env:TEST_PASSWORD="yourPasswordHere"
```

> Tip: Store secrets in your CI secret variables rather than committing credentials.

### URLs

`urls.json` is intended as a simple place to keep environment URLs (e.g. SIT/UAT), so your tests can reference a single source of truth.

---

## Running the tests

Run the full suite:

```bash
npx playwright test
```

Run a single spec:

```bash
npx playwright test tests/test.ts
```

Run tests by name:

```bash
npx playwright test -g "Offers & Rewards"
```

Run headed / headless:

- If your `playwright.config.ts` supports it, use an env var such as `HEADLESS=true`.
- Otherwise, run with Playwright’s CLI option:

```bash
npx playwright test --headed
```

---

## What the tests do

Each test:

1. Navigates/logs in (via `utils/login.ts`)
2. Puts the UI into the right state (open dialog, scroll header/footer into view, etc.)
3. Runs **axe-core** either:
   - **Whole page scan**, or
   - **Scoped scan** to a selector using `AxeBuilder.include(<cssSelector>)`
4. Writes reports into `a11y-reports/`
5. Optionally attaches artifacts into the Playwright HTML report via `testInfo`

### Scoping rules (important)

When scoping checks, **only use valid CSS selectors** (because axe runs in the browser with `querySelectorAll`).

✅ Good:
- `#main-content`
- `[role="dialog"]`
- `header[data-business-unit="mnscore"]`

❌ Avoid (not CSS / Playwright-only / invalid for `querySelectorAll`):
- `:visible` (Playwright-only)
- `:has-text()` (Playwright-only)

Your helper typically handles this by:
- Waiting for visibility using a Playwright selector (e.g. appending `:visible`)
- Passing **plain CSS** to axe for the actual scan

---

## Reports & outputs

### 1) Playwright HTML report

After a run:

```bash
npx playwright show-report
```

Output folder:
- `playwright-report/`

This report is useful for:
- Test pass/fail overview
- Attached artifacts per test (axe HTML/JSON, screenshots)

### 2) axe reports

Output folder:
- `a11y-reports/`

Typical files per scan:
- `*.html` — human-friendly axe HTML report
- `*.json` — raw axe results + metadata
- `summary.json` — rolling index of scans
- `screenshots/` — failure-only screenshots (if enabled)

---

## Tuning what “fails” a test

In `utils/accessibility.ts` there’s usually a list of impacts that fail the build (commonly):

- `serious`
- `critical`

If you want stricter behavior (e.g. fail on `moderate`), update the configured failing impacts.

---

## Common troubleshooting

### Playwright can’t find my tests
Check `playwright.config.ts`:

- `testDir` should point to `./tests`
- Your files should match Playwright’s naming conventions:
  - `*.spec.ts` / `*.test.ts`

If you renamed the root folder, verify paths/imports still match and your editor updated TS path references correctly.

### “NoSuchElement / selector” issues in scoped scans
Scoped scans require:
- The element exists
- The element is visible
- The selector is valid CSS

If the UI animates in, add an explicit `await expect(locator).toBeVisible({ timeout: ... })` before scanning.

### Reports are huge
If reports become heavy:
- Reduce screenshots (max elements)
- Limit attachments to only failures
- Prefer JSON for machine processing and HTML for quick viewing

---

## Extending the suite

Add a new spec file in `tests/`:

- `accessibility.some-page.spec.ts`

Reuse shared constants/selectors from `tests/a11y.shared.ts`.

Keep tests small and focused:
- “Whole page”
- “Header”
- “Main content”
- “Dialog X”
- “Modal Y”

This makes failures easier to triage and keeps runs stable.

---

## Quick commands reference

```bash
# Install
npm install
npx playwright install --with-deps

# Run all tests
npx playwright test

# Run one file
npx playwright test tests/accessibility.offers-rewards.spec.ts

# Run by test name
npx playwright test -g "Whole page"

# View Playwright report
npx playwright show-report
```
