import { chromium } from 'playwright';
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome';
function getBrowserLaunchOptions(extra = {}) {
  return browserChannel
    ? { channel: browserChannel, ...extra }
    : { ...extra };
}
import fs from 'node:fs';
import path from 'node:path';
import html2canvas from 'html2canvas';

function safeSlug(input) {
  return String(input || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureJob(jobDir, toolDir) {
  const urlsPath = path.join(jobDir, 'input', 'urls.txt');
  const storageStatePath = path.join(jobDir, 'auth', 'storage_state.json');
  const reportsDir = path.join(jobDir, 'reports', toolDir);

  fs.mkdirSync(reportsDir, { recursive: true });

  if (!fs.existsSync(urlsPath)) {
    throw new Error(`urls.txt not found: ${urlsPath}`);
  }

  const urls = fs
    .readFileSync(urlsPath, 'utf-8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  return { urls, storageStatePath, reportsDir };
}

function dataUrlToBuffer(dataUrl) {
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

async function injectHtml2Canvas(page) {
  const html2canvasPath = path.join(
    process.cwd(),
    'node_modules',
    'html2canvas',
    'dist',
    'html2canvas.min.js'
  );

  if (!fs.existsSync(html2canvasPath)) {
    throw new Error(`html2canvas bundle not found: ${html2canvasPath}`);
  }

  await page.addScriptTag({ path: html2canvasPath });

  try {
    await page.waitForFunction(() => typeof window.html2canvas === 'function', {
      timeout: 10000,
    });
  } catch {
    throw new Error('html2canvas did not become available in page context (possibly blocked by CSP)');
  }
}

async function generateTabMap(page) {
  return await page.evaluate(async () => {
    const html2canvas = window.html2canvas;
    if (!html2canvas) {
      throw new Error('html2canvas was not available in page context');
    }

    const selector =
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

    function isFocusable(el, doc) {
      const tabIndex = parseInt(el.getAttribute('tabindex') || '0', 10);
      const style = doc.defaultView.getComputedStyle(el);
      const isVisible =
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none';

      return tabIndex >= 0 && isVisible && !el.hasAttribute('disabled');
    }

    function collectFocusableFromDocument(doc, offsetX = 0, offsetY = 0, source = 'document') {
      return Array.from(doc.querySelectorAll(selector))
        .filter((el) => isFocusable(el, doc))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            element: el,
            tabIndex: parseInt(el.getAttribute('tabindex') || '0', 10),
            rect: {
              left: rect.left + offsetX,
              top: rect.top + offsetY,
              width: rect.width,
              height: rect.height,
            },
            source,
          };
        });
    }

    const frameInfo = {
      frameCount: 0,
      sameOriginFrameCount: 0,
      crossOriginFrameCount: 0,
    };

    let focusable = collectFocusableFromDocument(document, 0, 0, 'document');

    const frameElements = Array.from(document.querySelectorAll('frame, iframe'));
    frameInfo.frameCount = frameElements.length;

    for (const frameEl of frameElements) {
      try {
        const frameDoc = frameEl.contentDocument;
        const frameWin = frameEl.contentWindow;

        if (!frameDoc || !frameWin) {
          frameInfo.crossOriginFrameCount += 1;
          continue;
        }

        const frameRect = frameEl.getBoundingClientRect();
        frameInfo.sameOriginFrameCount += 1;

        const frameItems = collectFocusableFromDocument(
          frameDoc,
          frameRect.left + window.scrollX,
          frameRect.top + window.scrollY,
          'frame'
        );

        focusable = focusable.concat(frameItems);
      } catch {
        frameInfo.crossOriginFrameCount += 1;
      }
    }

    focusable = focusable.sort((a, b) => {
      if (a.tabIndex > 0 && b.tabIndex > 0) return a.tabIndex - b.tabIndex;
      if (a.tabIndex > 0) return -1;
      if (b.tabIndex > 0) return 1;
      return 0;
    });

    const canvas = await html2canvas(document.body, {
      allowTaint: false,
      useCORS: true,
      logging: false,
      scrollY: -window.scrollY,
      backgroundColor: '#ffffff',
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      imageTimeout: 15000,
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context unavailable');
    }

    ctx.lineWidth = 2;
    ctx.font = 'bold 12px sans-serif';

    focusable.forEach((item, index) => {
      const { left, top, width, height } = item.rect;
      const x = left;
      const y = top;

      ctx.setLineDash([]);
      ctx.strokeStyle = '#2563eb';
      ctx.strokeRect(x, y, width, height);

      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), x, y);

      if (index < focusable.length - 1) {
        const next = focusable[index + 1].rect;
        const nextX = next.left + next.width / 2;
        const nextY = next.top + next.height / 2;

        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(x + width / 2, y + height / 2);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();
      }
    });

    let dataUrl = null;
    let exportError = null;

    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      exportError = error && error.message ? error.message : String(error);
    }

    return {
      dataUrl,
      exportError,
      focusableCount: focusable.length,
      title: document.title || '',
      frameCount: frameInfo.frameCount,
      sameOriginFrameCount: frameInfo.sameOriginFrameCount,
      crossOriginFrameCount: frameInfo.crossOriginFrameCount,
    };
  });
}

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_tab_map.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'tab-map');
  const hasStorageState = storageStatePath && fs.existsSync(storageStatePath);

  const manifest = [];
  const browser = await chromium.launch(getBrowserLaunchOptions({ headless: true }));

  try {
    for (const url of urls) {
      const contextOptions = {
        ignoreHTTPSErrors: true,
        bypassCSP: true,
      };
      if (hasStorageState) {
        contextOptions.storageState = storageStatePath;
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      try {
        console.log(`Generating tab map: ${url}`);

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        });

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await page.waitForTimeout(1500);

        await injectHtml2Canvas(page);
        
        const available = await page.evaluate(() => typeof window.html2canvas);
        console.log(`html2canvas availability: ${available}`);

        const result = await generateTabMap(page);

        if (!result.dataUrl) {
          throw new Error(result.exportError || 'Tab map image export failed');
        }

        const base = safeSlug(url);
        const capturedAt = new Date().toISOString();
        const pngPath = path.join(reportsDir, `${base}.png`);
        const jsonPath = path.join(reportsDir, `${base}.json`);

        fs.writeFileSync(pngPath, dataUrlToBuffer(result.dataUrl));

        const payload = {
          tool: 'tab-map',
          url,
          title: result.title,
          page: base,
          captured_at: capturedAt,
          focusable_count: result.focusableCount,
          frame_count: result.frameCount ?? 0,
          same_origin_frame_count: result.sameOriginFrameCount ?? 0,
          cross_origin_frame_count: result.crossOriginFrameCount ?? 0,
          image: path.basename(pngPath),
          json: path.basename(jsonPath),
        };

        fs.writeFileSync(
          jsonPath,
          JSON.stringify(payload, null, 2),
          'utf8'
        );

        manifest.push(payload);

        console.log(`Saved tab map: ${pngPath}`);
      } catch (error) {
        const base = safeSlug(url);
        const capturedAt = new Date().toISOString();
        const errorPath = path.join(reportsDir, `${base}-error.json`);

        const errorPayload = {
          tool: 'tab-map',
          url,
          page: base,
          captured_at: capturedAt,
          error: error instanceof Error ? error.message : String(error),
        };

        fs.writeFileSync(
          errorPath,
          JSON.stringify(errorPayload, null, 2),
          'utf8'
        );

        manifest.push(errorPayload);

        console.error(`Failed tab map for ${url}: ${error.message || String(error)}`);
      } finally {
        await page.close().catch(() => { });
        await context.close().catch(() => { });
      }
    }

    const manifestPath = path.join(reportsDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Saved tab map manifest: ${manifestPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});