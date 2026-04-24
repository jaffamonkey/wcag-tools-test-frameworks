// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.{js,cjs}', '**/*.test.{js,cjs}'],

  timeout: 4 * 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },

  fullyParallel: false,
  workers: 1,

  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    // ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  outputDir: 'test-results',

  use: {
    browserName: 'chromium',
    headless: true,
    actionTimeout: 15 * 1000,
    navigationTimeout: 60 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});