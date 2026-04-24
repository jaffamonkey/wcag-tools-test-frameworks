const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  globalTimeout: 600000, // 10 minutes
  testDir: './tests',
  fullyParallel: true,
  reporter: [
    ['html', {
      open: 'never',
      outputFolder: 'my-custom-report-folder'
    }]
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
