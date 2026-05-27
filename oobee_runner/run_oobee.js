const { chromium } = require('playwright');
const { scanPage } = require('@govtechsg/oobee');
const fs = require('fs');
const path = require('path');
const { safeSlug, ensureJob } = require('../common/job_utils.cjs');

function buildContextOptions(storageStatePath) {
  const options = {};
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    options.storageState = storageStatePath;
    console.log(`Oobee using storage state: ${storageStatePath}`);
  } else {
    console.log('Oobee running without storage state for public job');
  }
  return options;
}

(async () => {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_oobee.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'oobee');

  const browser = await chromium.launch({ headless: true });

  for (const url of urls) {
    const context = await browser.newContext(buildContextOptions(storageStatePath));
    const page = await context.newPage();

    try {
      console.log(`Navigating to: ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });

      await page.waitForTimeout(1500);

      console.log('Scanning with Oobee...');

      const scanResults = await scanPage(page, {
        axeConfig: {
          runOnly: {
            type: 'tag',
            values: [
              'wcag2aa',
              'wcag21aa',
              'wcag22aa',
              'wcag2aaa',
              'wcag21aaa'
            ]
          }
        }
      });

      const base = safeSlug(url);
      const outputPath = path.join(reportsDir, `${base}.json`);

      fs.writeFileSync(outputPath, JSON.stringify(scanResults, null, 2), 'utf8');
      console.log(`Saved results to: ${outputPath}`);
    } catch (error) {
      const errorPath = path.join(reportsDir, `${safeSlug(url)}.json`);
      fs.writeFileSync(errorPath, JSON.stringify({
        tool: 'oobee',
        url,
        error: error.message,
        scanned_at: new Date().toISOString()
      }, null, 2));
      console.error(`Error scanning ${url}:`, error.message);
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();
})();