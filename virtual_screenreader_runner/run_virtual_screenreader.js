const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome';
function getBrowserLaunchOptions(extra = {}) {
  return browserChannel
    ? { channel: browserChannel, ...extra }
    : { ...extra };
}
const { JSDOM } = require('jsdom');
const { virtual } = require('@guidepup/virtual-screen-reader');

function readUrls(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function safeSlug(input) {
  return String(input || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function shouldBlockRequest(url) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('doubleclick.net') ||
    u.includes('googlesyndication.com') ||
    u.includes('googleads.g.doubleclick.net') ||
    u.includes('googleadservices.com') ||
    u.includes('googletagmanager.com') ||
    u.includes('google-analytics.com') ||
    u.includes('recaptcha') ||
    u.includes('adsbygoogle') ||
    u.includes('pagead') ||
    u.includes('socket.io')
  );
}

async function getVirtualScreenReaderLinesFromHtml(html) {
  const dom = new JSDOM(html, {
    url: "https://example.test/",
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  global.CSS = dom.window.CSS || { escape: (value) => String(value) };
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.MutationObserver = dom.window.MutationObserver;

  try {
    console.log("virtual.detect:", await virtual.detect());
    console.log("body child count:", document.body ? document.body.children.length : 0);

    await virtual.start({ container: document.body });

    let guard = 0;
    let lastPhrase = await virtual.lastSpokenPhrase();
    console.log("initial lastSpokenPhrase:", lastPhrase);

    while (lastPhrase !== "end of document" && guard < 2000) {
      await virtual.next();
      lastPhrase = await virtual.lastSpokenPhrase();
      guard += 1;
    }

    const spoken = await virtual.spokenPhraseLog();
    const items = await virtual.itemTextLog();

    console.log("virtual guard count:", guard);
    console.log("spokenPhraseLog length:", Array.isArray(spoken) ? spoken.length : -1);
    console.log("itemTextLog length:", Array.isArray(items) ? items.length : -1);
    if (Array.isArray(spoken) && spoken.length) {
      console.log("spoken sample:", spoken.slice(0, 10));
    }
    if (Array.isArray(items) && items.length) {
      console.log("item sample:", items.slice(0, 10));
    }

    const lines = (Array.isArray(spoken) && spoken.length ? spoken : items || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    return lines;
  } finally {
    try {
      await virtual.stop();
    } catch (err) {
      console.warn("virtual.stop warning:", err?.message || String(err));
    }
    delete global.window;
    delete global.document;
    delete global.Node;
    delete global.HTMLElement;
    delete global.navigator;
    delete global.CSS;
    delete global.getComputedStyle;
    delete global.MutationObserver;
    dom.window.close();
  }
}

(async () => {
  let browser;
  try {
    const jobDir = process.argv[2];
    if (!jobDir) {
      throw new Error('Usage: node run_virtual_screenreader.js <job_dir>');
    }

    const resolvedJobDir = path.resolve(jobDir);
    const urlsFile = path.join(resolvedJobDir, 'input', 'urls.txt');
    const reportsDir = path.join(resolvedJobDir, 'reports', 'virtual-screenreader');
    const manifestPath = path.join(reportsDir, 'manifest.json');
    const storageStatePath = process.env.STORAGE_STATE_PATH || '';

    if (!fs.existsSync(urlsFile)) {
      throw new Error(`urls.txt not found: ${urlsFile}`);
    }

    fs.mkdirSync(reportsDir, { recursive: true });

    const urls = readUrls(urlsFile);
    browser = await chromium.launch(getBrowserLaunchOptions({ headless: true }));
    const manifest = [];

    const contextOptions = {
      viewport: { width: 1440, height: 1200 },
      ignoreHTTPSErrors: true,
    };

    if (storageStatePath && fs.existsSync(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
      console.log(`Using storage state: ${storageStatePath}`);
    } else {
      console.log('Running without storage state');
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (shouldBlockRequest(requestUrl)) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    for (const url of urls) {
      const slug = safeSlug(url);
      const outPath = path.join(reportsDir, `${slug}.json`);

      try {
        console.log(`Virtual screenreader loading: ${url}`);

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        });

        await page.waitForTimeout(1200);

        const title = await page.title();
        const html = await page.content();
        const lines = await getVirtualScreenReaderLinesFromHtml(html);

        const payload = {
          tool: 'virtual-screenreader',
          url,
          title,
          page: slug,
          captured_at: new Date().toISOString(),
          lines,
        };

        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

        manifest.push({
          page: slug,
          url,
          title,
          report: `${slug}.json`,
          line_count: lines.length,
          ok: true,
        });

        console.log(`Saved virtual screenreader report: ${outPath}`);
      } catch (error) {
        const errPayload = {
          tool: 'virtual-screenreader',
          url,
          page: slug,
          captured_at: new Date().toISOString(),
          error: error.message || String(error),
          lines: [],
        };

        fs.writeFileSync(outPath, JSON.stringify(errPayload, null, 2), 'utf8');

        manifest.push({
          page: slug,
          url,
          title: slug,
          report: `${slug}.json`,
          line_count: 0,
          ok: false,
          error: error.message || String(error),
        });

        console.error(`Virtual screenreader failed for ${url}: ${error.message || String(error)}`);
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await context.close();
    process.exit(0);
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
})();