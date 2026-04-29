import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LIGHTHOUSE_PORT = 9222;

function safeSlug(input) {
  return String(input || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureJob(jobDir, toolDir) {
  const urlsPath = path.join(jobDir, 'input', 'urls.txt');
  const storageStatePath = path.join(jobDir, 'auth', 'storage_state.json');
  const reportsDir = path.join(jobDir, 'reports', toolDir);

  fs.mkdirSync(reportsDir, { recursive: true });

  if (!fs.existsSync(urlsPath)) {
    throw new Error(`urls.txt not found: ${urlsPath}`);
  }

  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`storage_state.json not found: ${storageStatePath}`);
  }

  const urls = fs
    .readFileSync(urlsPath, 'utf-8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  return { urls, storageStatePath, reportsDir };
}

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_lighthouse.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'lighthouse');

  const userDataDir = path.join(
    os.tmpdir(),
    `lh-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  fs.mkdirSync(userDataDir, { recursive: true });

  const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [`--remote-debugging-port=${LIGHTHOUSE_PORT}`],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    if (storageState.cookies?.length) {
      await context.addCookies(storageState.cookies);
    }

    const failures = [];

    for (const url of urls) {
      const base = safeSlug(url);

      try {
        console.log(`Auditing Lighthouse accessibility: ${url}`);

        await page.goto(url, {
          waitUntil: 'load',
          timeout: 60000,
        });

        // const htmlPath = path.join(reportsDir, `${base}.html`);
        // const screenshotPath = path.join(reportsDir, `${base}.png`);
        // fs.writeFileSync(htmlPath, await page.content(), 'utf8');
        // await page.screenshot({ path: screenshotPath, fullPage: true });

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

        const reportPath = path.join(reportsDir, `${base}.json`);
        fs.writeFileSync(reportPath, result.report, 'utf8');

        // const metaPath = path.join(reportsDir, `${base}.meta.json`);
        // fs.writeFileSync(
        //   metaPath,
        //   JSON.stringify(
        //     {
        //       tool: 'lighthouse',
        //       url,
        //       scanned_at: new Date().toISOString(),
        //       accessibility_score: Math.round(
        //         (result.lhr.categories.accessibility?.score ?? 0) * 100
        //       ),
        //       html_path: path.basename(htmlPath),
        //       screenshot_path: path.basename(screenshotPath),
        //     },
        //     null,
        //     2
        //   ),
        //   'utf8'
        // );

        console.log(`Saved Lighthouse report: ${reportPath}`);
      } catch (error) {
        const errorPath = path.join(reportsDir, `${base}-error.json`);
        fs.writeFileSync(
          errorPath,
          JSON.stringify(
            {
              tool: 'lighthouse',
              url,
              error: error instanceof Error ? error.message : String(error),
              scanned_at: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf8'
        );

        console.error(`Failed Lighthouse audit for ${url}`);
        console.error(error);
        failures.push({
          url,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failures.length) {
      console.log(
        `Lighthouse completed with ${failures.length} failed URL(s). See error JSON files for details.`
      );
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});