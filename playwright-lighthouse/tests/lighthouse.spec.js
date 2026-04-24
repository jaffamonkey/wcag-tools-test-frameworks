// tests/lighthouse.spec.js
import { test, chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const URLS_FILE = path.join(__dirname, 'urls.txt');
const REPORTS_DIR = path.join(__dirname, 'reports');
const USER_DATA_DIR = path.join(__dirname, '.lh-profile');
const LIGHTHOUSE_PORT = 9222;

function readUrls(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`urls.txt not found at: ${filePath}`);
  }

  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getReportName(url) {
  const urlObj = new URL(url);

  // Split path into segments and remove empty strings
  const segments = urlObj.pathname.split('/').filter(Boolean);

  // Get the last segment or default to 'index'
  const lastSegment = segments.at(-1) || 'index';

  // Return the cleaned name (removes characters not safe for filenames)
  return lastSegment.replace(/[^a-z0-9-_]/gi, '-');
}

test.describe('audit', () => {
  test('run accessibility-only lighthouse audit', async () => {
    const urls = readUrls(URLS_FILE);

    if (urls.length === 0) {
      throw new Error('No URLs found in urls.txt');
    }

    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      args: [`--remote-debugging-port=${LIGHTHOUSE_PORT}`],
    });

    const page = context.pages()[0] ?? (await context.newPage());
    const failures = [];

    try {
      for (const url of urls) {
        const reportName = getReportName(url);

        try {
          console.log(`Auditing accessibility: ${url}`);

          await page.goto(url, {
            waitUntil: 'load',
            timeout: 60_000,
          });

          const result = await lighthouse(
            url,
            {
              port: LIGHTHOUSE_PORT,
              output: 'json',
              logLevel: 'info',
              onlyCategories: ['accessibility'],
            },
            undefined
          );

          if (!result?.report || !result?.lhr) {
            throw new Error('Lighthouse did not return a report');
          }

          const reportPath = path.join(REPORTS_DIR, `${reportName}.json`);
          fs.writeFileSync(reportPath, result.report);

          const accessibilityScore = Math.round(
            (result.lhr.categories.accessibility?.score ?? 0) * 100
          );

          if (accessibilityScore < 100) {
            throw new Error(
              `Accessibility score ${accessibilityScore} < 100. Report: ${reportPath}`
            );
          }

          console.log(`✅ Passed: ${url} (${accessibilityScore})`);
        } catch (error) {
          console.error(`❌ Failed: ${url}`);
          console.error(error);
          failures.push({
            url,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      await context.close();
    }

    if (failures.length > 0) {
      const summary = failures
        .map((item) => `- ${item.url}\n  ${item.message}`)
        .join('\n');

      throw new Error(
        `Lighthouse accessibility audit failed for ${failures.length} URL(s):\n${summary}`
      );
    }
  });
});