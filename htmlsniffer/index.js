const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
// Read file, split by new lines, and filter out any empty lines
const urls = fs.readFileSync('urls.txt', 'utf-8')
  .split(/\r?\n/)
  .filter(line => line.trim() !== '');

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

function buildFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || 'report';
    return `${lastSegment}.json`;
  } catch (e) {
    return `report_${Date.now()}.json`;
  }
}

(async () => {
  // Playwright handles executable paths automatically, but you can still specify if needed
  const browser = await chromium.launch({ headless: true });

  const outputDir = path.join(__dirname, 'accessibility_reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Ensure this path points to your local HTML_CodeSniffer build
  const htmlcsPath = path.resolve(__dirname, 'node_modules/html_codesniffer/build/HTMLCS.js');

  for (const url of urls) {
    // Isolated context for each URL (better for experiments)
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      console.log(`Auditing (Playwright): ${url}...`);

      // Playwright's goto is more robust with built-in waiting
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });

      await page.addScriptTag({ path: htmlcsPath });

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

        return new Promise((resolve) => {
          // HTMLCS is global once script tag is added
          HTMLCS.process('WCAG2AAA', document, () => {
            const messages = HTMLCS.getMessages();
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

      const filePath = path.join(outputDir, buildFileName(url));
      fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');

      console.log(`Successfully saved ${path.basename(filePath)}`);
    } catch (err) {
      console.error(`Error processing ${url}: ${err.message}`);
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();
  console.log('Comparison run complete.');
})();
