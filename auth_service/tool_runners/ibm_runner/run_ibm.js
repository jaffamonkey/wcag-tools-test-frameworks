const { chromium } = require('playwright');
const aChecker = require('accessibility-checker');
const fs = require('fs');
const path = require('path');
const { safeSlug, ensureJob } = require('../common/job_utils.cjs');

function lightenHtml(html, opts = {}) {
  const {
    stripScripts = true,
    stripStyles = true,
    stripLinkStylesheets = true,
    stripIframes = true,
    stripImages = true,
  } = opts;

  let out = String(html || '');

  if (stripScripts) {
    out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  if (stripStyles) {
    out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  }

  if (stripLinkStylesheets) {
    out = out.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '');
  }

  if (stripIframes) {
    out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
    out = out.replace(/<iframe\b[^>]*\/>/gi, '');
  }

  if (stripImages) {
    out = out.replace(/\s(src|srcset)=["'][^"']*["']/gi, '');
  }

  out = out.replace(/\son\w+=["'][^"']*["']/gi, '');
  return out;
}

function extractFindings(report) {
  if (Array.isArray(report?.results)) return report.results;
  if (Array.isArray(report?.issues)) return report.issues;
  return [];
}

function shouldBlockRequest(url) {
  const u = String(url || '').toLowerCase();

  return (
    u.includes('doubleclick.net') ||
    u.includes('googleads.g.doubleclick.net') ||
    u.includes('googlesyndication.com') ||
    u.includes('adservice.google.com') ||
    u.includes('googleadservices.com') ||
    u.includes('recaptcha') ||
    u.includes('google-analytics.com') ||
    u.includes('googletagmanager.com') ||
    u.includes('socket.io') ||
    u.includes('googlesyndication') ||
    u.includes('adsbygoogle') ||
    u.includes('googlefc') ||
    u.includes('pagead')
  );
}

async function runIbmForUrl(browser, url, storageStatePath, reportsDir) {
  const contextOptions = {
    ignoreHTTPSErrors: true,
  };

  if (storageStatePath && fs.existsSync(storageStatePath)) {
    console.log(`IBM using storage state: ${storageStatePath}`);
    contextOptions.storageState = storageStatePath;
  } else {
    console.log('IBM running without storage state for public job');
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

  try {
    console.log(`IBM loading page: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForTimeout(1500);

    const base = safeSlug(url);

    console.log(`IBM extracting body HTML: ${url}`);

    const pageLang = await page.evaluate(() => document.documentElement.lang || '');
    const pageTitle = await page.title();
    const bodyHtml = await page.evaluate(() => (document.body ? document.body.outerHTML : ''));

    let html = `<!doctype html>
<html lang="${pageLang}">
<head>
  <meta charset="utf-8">
  <title>${pageTitle}</title>
</head>
<body>
${bodyHtml}
</body>
</html>`;

    html = lightenHtml(html, {
      stripScripts: true,
      stripStyles: true,
      stripLinkStylesheets: true,
      stripIframes: true,
      stripImages: true,
    });

    console.log(`IBM HTML size for ${url}: ${html.length}`);

    if (html.length > 1500000) {
      throw new Error(`IBM skipped page because HTML is too large (${html.length} chars)`);
    }

    console.log(`IBM running checker: ${url}`);

    const report = await Promise.race([
      aChecker.getCompliance(html, base),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('IBM scan timed out after 120000ms')), 120000)
      ),
    ]);

    console.log(`IBM finished checker: ${url}`);

    const findings = extractFindings(report);
    const jsonPath = path.join(reportsDir, `${base}.json`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Saved IBM report: ${jsonPath} (${findings.length} findings)`);

    return {
      ok: true,
      url,
      findings: findings.length,
    };
  } catch (error) {
    const errorPath = path.join(reportsDir, `${safeSlug(url)}-error.json`);

    fs.writeFileSync(
      errorPath,
      JSON.stringify(
        {
          tool: 'ibm',
          url,
          error: error?.message || String(error),
          scanned_at: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );

    console.error(`Error scanning ${url}: ${error?.message || String(error)}`);
    if (error?.stack) {
      console.error(error.stack.split('\n').slice(0, 12).join('\n'));
    }

    return {
      ok: false,
      url,
      error: error?.message || String(error),
    };
  } finally {
    await page.close();
    await context.close();

    if (global.gc) {
      try {
        global.gc();
      } catch (_) {}
    }
  }
}

(async () => {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_ibm.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'ibm');
  const browser = await chromium.launch({ headless: true });

  try {
    for (const url of urls) {
      await runIbmForUrl(browser, url, storageStatePath, reportsDir);
    }
  } finally {
    try {
      if (typeof aChecker.close === 'function') {
        await aChecker.close();
      }
    } catch (err) {
      console.warn(`IBM checker close() warning: ${err.message}`);
    }

    await browser.close();
  }
})();