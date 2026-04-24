# UUV richer full-page audit

This version makes the single Gherkin step do a much more useful full-page sweep.

## What the full page check now validates
- page opens and returns a main-document HTTP status
- no uncaught page errors
- captures console warnings/errors
- captures failed network requests
- checks body is visible
- checks title is present
- counts headings, links, buttons, inputs, images, iframes and forms
- records the first heading text when present
- checks for landmark roles / semantic containers (`main`, `header`, `footer`, `nav`, `form`)
- detects blank links/buttons
- detects images missing `alt`
- runs an axe accessibility scan and stores violations

## Install
```bash
npm install
npx playwright install chromium
```

## Run
```bash
npm run audit
```

## Output
One JSON file per scenario is written to:

```bash
uuv/reports/per-url/
```

Each JSON includes a `summary`, `findings`, `axe`, `consoleMessages`, and `failedRequests` section.
