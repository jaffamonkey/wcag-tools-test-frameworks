import { test, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  runAccessibilityCheck,
  closeAccessibilityChecker,
} from '../utils/accessibility';

const urlsFilePath = path.join(__dirname, 'urls.txt');

function loadUrls(filePath: string): string[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const urls: string[] = loadUrls(urlsFilePath);

test.describe('Website accessibility checks', () => {
  test.afterAll(async () => {
    await closeAccessibilityChecker();
  });

  for (const url of urls) {
    test(url, async ({ page }: { page: Page }) => {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });

      await runAccessibilityCheck(page, url, {
        outputDir: path.resolve(process.cwd(), 'ally-reports'),
        failOnImpacts: ['serious', 'critical'],
      });
    });
  }
});