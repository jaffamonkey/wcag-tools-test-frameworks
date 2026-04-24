const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

function safeSlug(input) {
  return String(input || "").replace(/^https?:\/\//i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) throw new Error("Usage: node run_axe_core.js <job_dir>");
  const urls = fs.readFileSync(path.join(jobDir, "input", "urls.txt"), "utf-8").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const storageStatePath = path.join(jobDir, "auth", "storage_state.json");
  const reportsDir = path.join(jobDir, "reports", "axe-core");
  fs.mkdirSync(reportsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: storageStatePath });

  try {
    for (const url of urls) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "wcag2aaa", "wcag21aaa"]).analyze();
        const out = { tool: "axe-core", url, scanned_at: new Date().toISOString(), violations: results.violations || [], passes: results.passes || [], incomplete: results.incomplete || [], inapplicable: results.inapplicable || [] };
        fs.writeFileSync(path.join(reportsDir, `${safeSlug(url)}.json`), JSON.stringify(out, null, 2));
      } catch (err) {
        fs.writeFileSync(path.join(reportsDir, `${safeSlug(url)}-error.json`), JSON.stringify({ tool: "axe-core", url, error: String(err && err.message ? err.message : err), scanned_at: new Date().toISOString() }, null, 2));
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
