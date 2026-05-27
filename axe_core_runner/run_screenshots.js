const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome';
function getBrowserLaunchOptions(extra = {}) {
  return browserChannel
    ? { channel: browserChannel, ...extra }
    : { ...extra };
}

function safeSlug(input) {
  return String(input || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function readUrls(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
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

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function tryClickConsent(page, label) {
  const regex = new RegExp(`^\\s*${escapeRegex(label)}\\s*$`, 'i');
  const containsRegex = new RegExp(escapeRegex(label), 'i');

  const candidates = [
    page.getByRole('button', { name: regex }),
    page.getByRole('link', { name: regex }),
    page.locator(`button:has-text("${label}")`),
    page.locator(`a:has-text("${label}")`),
    page.locator(`[aria-label="${label}"]`),
    page.locator(`[title="${label}"]`),
    page.getByText(containsRegex).locator('..'),
  ];

  for (const locator of candidates) {
    try {
      const first = locator.first();
      if (await first.isVisible({ timeout: 400 })) {
        await first.click({ timeout: 1500 });
        await page.waitForTimeout(700);
        return { clicked: true, label };
      }
    } catch {
      // ignore and continue
    }
  }

  return { clicked: false, label };
}

async function dismissCookieBanners(page) {
  const labels = [
    'Accept',
    'Accept all',
    'Accept All',
    'Accept cookies',
    'Allow',
    'Allow all',
    'Allow All',
    'I agree',
    'I Agree',
    'Agree',
    'OK',
    'Ok',
    'Got it',
    'Continue',
    'Yes, I agree',
    'Consent',
    'Reject',
    'Reject all',
    'Reject All',
    'Decline',
    'Only necessary',
    'Essential only',
  ];

  for (const label of labels) {
    const result = await tryClickConsent(page, label);
    if (result.clicked) {
      return { action: 'clicked', detail: label };
    }
  }

  const removed = await page.evaluate(() => {
    const keywordRe = /(cookie|consent|gdpr|privacy|cmp|onetrust|trustarc|didomi|cookiebot|qc-cmp|sp_message_container)/i;
    let removedCount = 0;

    const elements = Array.from(document.querySelectorAll('body *'));
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || '').slice(0, 500);
      const idClass = `${el.id || ''} ${(el.className || '').toString()}`;
      const attrs = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('role') || ''}`;

      const keywordMatch = keywordRe.test(idClass) || keywordRe.test(text) || keywordRe.test(attrs);
      const overlayish = style.position === 'fixed' || style.position === 'sticky';
      const highZ =
        style.zIndex === '2147483647' ||
        (!Number.isNaN(Number(style.zIndex)) && Number(style.zIndex) >= 999);
      const largeEnough =
        rect.width >= window.innerWidth * 0.3 ||
        rect.height >= window.innerHeight * 0.15;

      if (keywordMatch && (overlayish || highZ) && largeEnough) {
        el.remove();
        removedCount += 1;
      }
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    return removedCount;
  });

  if (removed > 0) {
    await page.waitForTimeout(500);
    return { action: 'removed', detail: `${removed} overlay(s)` };
  }

  return { action: 'none', detail: '' };
}

async function settleForScreenshot(page) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
  } catch {
    // ignore
  }

  await page.waitForTimeout(1200);

  const actions = [];
  for (let i = 0; i < 2; i += 1) {
    const result = await dismissCookieBanners(page);
    if (result.action !== 'none') {
      actions.push(result);
    }
    await page.waitForTimeout(500);
  }

  return actions;
}

(async () => {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_screenshots.js <job_dir>');
  }

  const resolvedJobDir = path.resolve(jobDir);
  const urlsFile = path.join(resolvedJobDir, 'input', 'urls.txt');
  const screenshotsDir = path.join(resolvedJobDir, 'screenshots');
  const manifestPath = path.join(screenshotsDir, 'manifest.json');
  const storageStatePath = process.env.STORAGE_STATE_PATH || '';

  if (!fs.existsSync(urlsFile)) {
    throw new Error(`urls.txt not found: ${urlsFile}`);
  }

  fs.mkdirSync(screenshotsDir, { recursive: true });

  const urls = readUrls(urlsFile);
  const browser = await chromium.launch(getBrowserLaunchOptions({ headless: true }));
  const manifest = [];

  try {
    const contextOptions = {
      viewport: { width: 1440, height: 1200 },
      ignoreHTTPSErrors: true,
    };

    if (storageStatePath && fs.existsSync(storageStatePath)) {
      console.log(`Screenshots using storage state: ${storageStatePath}`);
      contextOptions.storageState = storageStatePath;
    } else {
      console.log('Screenshots running without storage state for public job');
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
      const screenshotFile = `${slug}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotFile);

      try {
        console.log(`Capturing screenshot: ${url}`);

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        });

        const consentActions = await settleForScreenshot(page);

        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        const title = await page.title();

        manifest.push({
          page: slug,
          url,
          title: title || slug,
          screenshot: screenshotFile,
          consent_actions: consentActions,
        });

        if (consentActions.length) {
          console.log(
            `Consent handling for ${url}: ${consentActions
              .map((a) => `${a.action}:${a.detail}`)
              .join(', ')}`
          );
        }

        console.log(`Saved screenshot: ${screenshotPath}`);
      } catch (error) {
        const errorFile = `${slug}-error.json`;
        fs.writeFileSync(
          path.join(screenshotsDir, errorFile),
          JSON.stringify(
            {
              tool: 'screenshots',
              url,
              error: error.message,
              scanned_at: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf8'
        );

        manifest.push({
          page: slug,
          url,
          title: slug,
          screenshot: null,
          error: error.message,
        });

        console.error(`Failed screenshot for ${url}: ${error.message}`);
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await context.close();
  } finally {
    await browser.close();
  }
})();