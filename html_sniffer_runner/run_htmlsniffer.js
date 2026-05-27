const { chromium } = require('playwright');
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome';
function getBrowserLaunchOptions(extra = {}) {
  return browserChannel
    ? { channel: browserChannel, ...extra }
    : { ...extra };
}
const fs = require('fs');
const path = require('path');
const { safeSlug, ensureJob } = require('../common/job_utils.cjs');

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength = 4000) {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function sanitizeField(value, maxLength) {
  const cleaned = normalizeWhitespace(value).replace(/\|/g, '\\|');
  return typeof maxLength === 'number' ? truncate(cleaned, maxLength) : cleaned;
}

function buildContextOptions(storageStatePath) {
  const options = {};
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    options.storageState = storageStatePath;
    console.log(`HTMLCS using storage state: ${storageStatePath}`);
  } else {
    console.log('HTMLCS running without storage state for public job');
  }
  return options;
}

(async () => {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_htmlsniffer.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'html-sniffer');

  const browser = await chromium.launch(getBrowserLaunchOptions({ headless: true }));

  const htmlcsPath = path.resolve(
    __dirname,
    'node_modules/html_codesniffer/build/HTMLCS.js'
  );

  if (!fs.existsSync(htmlcsPath)) {
    throw new Error(`HTMLCS script not found: ${htmlcsPath}`);
  }

  for (const url of urls) {
    const context = await browser.newContext(buildContextOptions(storageStatePath));
    await context.addInitScript({ path: htmlcsPath });
    const page = await context.newPage();

    try {
      console.log(`Auditing (Playwright + HTMLCS): ${url}...`);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });

      await page.waitForTimeout(1500);

      console.log(`Using HTMLCS from: ${htmlcsPath}`);

      await page.waitForFunction(() => typeof window.HTMLCS !== 'undefined', {
        timeout: 10000
      });

      const auditTime = new Date().toISOString();

      const results = await page.evaluate(async (time) => {
        const TYPE_MAP = { 1: 'ERROR', 2: 'WARNING', 3: 'NOTICE' };

        function getSelector(element) {
          if (!element || typeof element.getAttribute !== 'function') return '';
          const id = element.getAttribute('id');
          if (id) return `#${id}`;
          const name = element.getAttribute('name');
          if (name) return `[name="${name}"]`;
          return '';
        }

        return new Promise((resolve, reject) => {
          if (typeof window.HTMLCS === 'undefined') {
            reject(new Error('HTMLCS was not available in page context'));
            return;
          }

          window.HTMLCS.process('WCAG2AAA', document, () => {
            const messages = window.HTMLCS.getMessages();
            const filtered = messages.filter(msg => msg.type === 1 || msg.type === 2);

            const formatted = filtered.map((msg) => ({
              time,
              type: TYPE_MAP[msg.type] || String(msg.type || ''),
              code: msg.code || '',
              tag: msg.element?.tagName?.toLowerCase() || '',
              selector: getSelector(msg.element),
              message: msg.msg || msg.message || '',
              html: msg.element?.outerHTML || ''
            }));

            resolve(formatted);
          });
        });
      }, auditTime);

      const report = results.map((item) => ({
        time: item.time,
        log: `[HTMLCS] ${[
          sanitizeField(item.type),
          sanitizeField(item.code),
          sanitizeField(item.tag),
          sanitizeField(item.selector),
          sanitizeField(item.message),
          sanitizeField(item.html, 4000)
        ].join('|')}`
      }));

      const base = safeSlug(url);
      const jsonPath = path.join(reportsDir, `${base}.json`);

      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`Successfully saved ${path.basename(jsonPath)}`);
    } catch (err) {
      const errorPath = path.join(reportsDir, `${safeSlug(url)}-error.json`);
      fs.writeFileSync(errorPath, JSON.stringify({
        tool: 'html-sniffer',
        url,
        error: err.message,
        scanned_at: new Date().toISOString()
      }, null, 2));
      console.error(`Error processing ${url}: ${err.message}`);
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();
  console.log('HTMLCS run complete.');
})();