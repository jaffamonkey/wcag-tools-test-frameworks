import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,

  // No Playwright HTML report
  reporter: [['line']],

  outputDir: 'test-results',

  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    viewport: { width: 1600, height: 1000 },

    // keep Playwright output noise down
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});