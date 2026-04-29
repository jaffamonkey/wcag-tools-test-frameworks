# Screen Reader Snapshot Tests (Guidepup Virtual Screen Reader)

This repo contains two Jest utilities that generate **deterministic screen-reader traversal logs** using **@guidepup/virtual-screen-reader**:

- **Fixtures runner**: loads static HTML files from `fixtures/` and writes a JSON log per file.  
- **URL runner**: fetches HTML from URLs listed in `urls.json` and writes a JSON log per page.

Outputs are written into `./results/`.

---

## Install (Yarn)

```bash
yarn install
```

If you’re adding deps to a fresh repo:

```bash
yarn add -D jest jsdom @guidepup/virtual-screen-reader
```

> If you’re on Windows (or want cross-platform env vars in scripts), also add:
```bash
yarn add -D cross-env
```

---

## Folder layout

```
.
├─ fixtures/
│  ├─ card.html
│  └─ ...
├─ results/
│  ├─ card.json
│  ├─ card.items.json
│  └─ ...
├─ urls.json
├─ screenreader.snippet.test.js
└─ scrapefromurl.test.js
```

---

## 1) Fixtures runner (static HTML)

**File:** `screenreader.snippet.test.js`

This test:

- Reads all `.html` files in `./fixtures`
- Loads them into jsdom (scripts are stripped)
- Traverses the document using the virtual cursor
- Writes a JSON log to `./results/<fixtureName>.json`

### Logging mode switch (`GUIDEPUP_LOG_MODE`)

The fixtures runner supports three output modes:

- `spoken` (default) → writes **spokenPhraseLog** to `results/<name>.json`
- `item` → writes **itemTextLog** to `results/<name>.json` (reuses the same filename)
- `both` → writes:
  - `results/<name>.json` (spokenPhraseLog)
  - `results/<name>.items.json` (itemTextLog)

Run examples:

```bash
# default: spokenPhraseLog -> results/<name>.json
yarn jest screenreader.snippet.test.js

# itemTextLog -> results/<name>.json
GUIDEPUP_LOG_MODE=item yarn jest screenreader.snippet.test.js

# both -> results/<name>.json and results/<name>.items.json
GUIDEPUP_LOG_MODE=both yarn jest screenreader.snippet.test.js
```

---

## 2) URL runner (scrape from URL list)

**File:** `scrapefromurl.test.js`  
**Config:** `urls.json`

This test:

- Reads `urls.json`
- Fetches each URL (supports redirects + gzip/deflate)
- Loads HTML into jsdom (scripts are stripped)
- Traverses the page with the virtual cursor
- Writes a JSON log to `./results/<pagename>.json`

### `urls.json` format

```json
[
  { "url": "https://example.com", "pagename": "Home" },
  { "url": "https://example.com/about", "pagename": "About" }
]
```

Run:

```bash
yarn jest scrapefromurl.test.js
```

> Note: the URL runner currently outputs **spokenPhraseLog only**.

---

## Results

All outputs are JSON arrays written under `./results/`:

- `spokenPhraseLog` (virtual SR announcements)
- `itemTextLog` (text of the item under the virtual cursor)

These logs are designed to be easy to diff in PRs, and work well as “accessibility snapshots”.

---

## Suggested `package.json` scripts

Add something like this under `"scripts"` in your existing `package.json`:

### Option A: macOS/Linux (env vars inline)

```json
{
  "scripts": {
    "sr:fixtures": "jest screenreader.snippet.test.js",
    "sr:fixtures:item": "GUIDEPUP_LOG_MODE=item jest screenreader.snippet.test.js",
    "sr:fixtures:both": "GUIDEPUP_LOG_MODE=both jest screenreader.snippet.test.js",
    "sr:urls": "jest scrapefromurl.test.js"
  }
}
```

Run:

```bash
yarn sr:fixtures
yarn sr:fixtures:item
yarn sr:fixtures:both
yarn sr:urls
```

### Option B: cross-platform (recommended if Windows is in the mix)

Requires `cross-env`:

```bash
yarn add -D cross-env
```

Then:

```json
{
  "scripts": {
    "sr:fixtures": "jest screenreader.snippet.test.js",
    "sr:fixtures:item": "cross-env GUIDEPUP_LOG_MODE=item jest screenreader.snippet.test.js",
    "sr:fixtures:both": "cross-env GUIDEPUP_LOG_MODE=both jest screenreader.snippet.test.js",
    "sr:urls": "jest scrapefromurl.test.js"
  }
}
```

---

## Notes

- Both runners strip `<script>` tags to keep jsdom stable and avoid flaky results.
- Traversal includes caps/guards to avoid infinite loops on pages with cyclical focus.
- The fixtures runner prefers traversing a dialog container (if present) before falling back to `document.body` to reduce wrap/cycle behavior.
