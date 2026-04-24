// playwright.config.js
import { defineConfig, devices } from '@playwright/test';

const headless = process.env.HEADLESS
  ? ['true', '1', 'yes', 'on'].includes(process.env.HEADLESS.toLowerCase())
  : true; // default: headed (not headless)

export default defineConfig({
  globalTeardown: './global-teardown.js',
  globalTimeout: 600000, // 10 minutes
  testDir: './tests',
  testMatch: ['**/*.spec.{js,cjs}', '**/*.test.{js,cjs}'],
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['html', {
      open: 'never',
      outputFolder: 'custom-reports'
    }]
  ],
  use: {
    baseURL: 'https://practicetestautomation.com',
    trace: 'on-first-retry',
    headless
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalTeardown: require.resolve("./global-teardown.js"),
});
