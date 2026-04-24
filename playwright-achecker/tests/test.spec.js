const { test } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const {
  runAccessibilityCheck,
  closeAccessibilityChecker,
} = require("../utils/accessibility");

// Read urls.txt from the same folder as this spec
const urlsFilePath = path.join(__dirname, "urls.txt");

function getPageReference(url) {
  const pathname = new URL(url).pathname;
  const segments = pathname.split("/").filter(Boolean);

  // Last non-empty path segment becomes the page reference
  // Example:
  // /Accessories/LeadProducts/Aprons/Infab/LightningFast/ -> LightningFast
  return segments[segments.length - 1] || "UnknownPage";
}

function loadUrls(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const urls = loadUrls(urlsFilePath);

test.describe("Website Check (WCAG 2.2 AA)", () => {
  test.afterAll(async () => {
    await closeAccessibilityChecker();
  });

  test.beforeEach(async () => {
    test.setTimeout(300000);
  });

  for (const url of urls) {
    const pageRef = getPageReference(url);

    test(pageRef, async ({ page }) => {
      await page.goto(url);
      await runAccessibilityCheck(page, pageRef, {
        testInfo: test.info(),
      });
    });
  }
});