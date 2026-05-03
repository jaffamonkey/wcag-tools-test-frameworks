# Virtual Screenreader (Playwright runner)

This version replaces the Jest harness with a Playwright-based runner so it can:

- use logged-in browser state from Playwright `storageState`
- load real pages after client-side rendering
- stay in sync with the rest of the accessibility job pipeline
- write one JSON transcript per page plus a manifest

## Install

```bash
npm install
npx playwright install chromium
```

## Run

Public pages:

```bash
node run_virtual_screenreader.js /path/to/job_dir
```

Authenticated pages:

```bash
STORAGE_STATE_PATH=/path/to/storage_state.json node run_virtual_screenreader.js /path/to/job_dir
```

The runner expects:

- `<job_dir>/input/urls.txt`
- optional auth state at `STORAGE_STATE_PATH`

Outputs are written to:

- `<job_dir>/reports/virtual-screenreader/*.json`
- `<job_dir>/reports/virtual-screenreader/manifest.json`

## Notes

This keeps `@guidepup/virtual-screen-reader` for transcript generation, but switches page loading/navigation to Playwright.
The flow is:

1. Open the page in Playwright
2. Wait for the rendered DOM
3. Read the final HTML via `page.content()`
4. Load that HTML into JSDOM
5. Run Guidepup virtual screenreader against the JSDOM body
6. Save transcript lines as JSON
