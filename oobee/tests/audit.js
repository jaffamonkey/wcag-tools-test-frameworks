const { chromium } = require('playwright');
const { scanPage } = require('@govtechsg/oobee');
const fs = require('fs');
const path = require('path');

(async () => {
  const urls = fs.readFileSync(path.join(__dirname, 'urls.txt'), 'utf-8')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '');

  const reportsDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  for (const url of urls) {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      console.log(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle' });

      const urlObj = new URL(url);

      // Get segments, filter out empty strings (caused by trailing slashes)
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);

      // Use the last segment, or 'index' if the path was empty
      const lastPart = pathSegments.length > 0
        ? pathSegments[pathSegments.length - 1]
        : 'index';

      // Clean up the name for the filesystem
      const safeName = lastPart.replace(/[^a-zA-Z0-9._-]+/g, '-');
      const filename = `${safeName}.json`;
      const outputPath = path.join(reportsDir, filename);

      console.log('Scanning...');

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

      fs.writeFileSync(outputPath, JSON.stringify(scanResults, null, 2));
      console.log(`Saved results to: ${outputPath}`);
    } catch (error) {
      console.error(`Error scanning ${url}:`, error.message);
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }
})();