const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function safeSlug(input) {
  return String(input || "")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) throw new Error("Usage: node run_htmlsniffer.js <job_dir>");
  const urls = fs.readFileSync(path.join(jobDir, "input", "urls.txt"), "utf-8").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const storageStatePath = path.join(jobDir, "auth", "storage_state.json");
  const reportsDir = path.join(jobDir, "reports", "html-sniffer");
  fs.mkdirSync(reportsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: storageStatePath });

  try {
    for (const url of urls) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        const out = {
          tool: "html-sniffer",
          url,
          scanned_at: new Date().toISOString(),
          title: await page.title(),
          note: "Starter scaffold: plug in real html-sniffer execution here using authenticated Playwright state."
        };
        fs.writeFileSync(path.join(reportsDir, `${safeSlug(url)}.json`), JSON.stringify(out, null, 2));
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
