import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

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

  const urls = fs
    .readFileSync(urlsPath, 'utf-8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  return { urls, storageStatePath, reportsDir };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not get free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runOneUrl(url, reportsDir, storageState) {
  const base = safeSlug(url);
  const port = await getFreePort();

  const userDataDir = path.join(
    os.tmpdir(),
    `lh-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  fs.mkdirSync(userDataDir, { recursive: true });

  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
      ],
    });

    const page = context.pages()[0] ?? (await context.newPage());

    if (storageState?.cookies?.length) {
      await context.addCookies(storageState.cookies);
    }

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(1500);

    const result = await withTimeout(
      lighthouse(
        url,
        {
          port,
          output: 'json',
          logLevel: 'info',
          onlyCategories: ['accessibility'],
          disableStorageReset: true,
        },
        undefined
      ),
      120000,
      `Lighthouse audit for ${url}`
    );

    if (!result?.report || !result?.lhr) {
      throw new Error('Lighthouse did not return a report');
    }

    const reportPath = path.join(reportsDir, `${base}.json`);
    fs.writeFileSync(reportPath, result.report, 'utf8');
    console.log(`Saved Lighthouse report: ${reportPath}`);
    return null;
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
    return {
      url,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const jobDir = process.argv[2];
  if (!jobDir) {
    throw new Error('Usage: node run_lighthouse.js <job_dir>');
  }

  const { urls, storageStatePath, reportsDir } = ensureJob(jobDir, 'lighthouse');

  const hasStorageState = storageStatePath && fs.existsSync(storageStatePath);
  const storageState = hasStorageState
    ? JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'))
    : null;

  if (hasStorageState) {
    console.log(`Lighthouse using storage state: ${storageStatePath}`);
  } else {
    console.log('Lighthouse running without storage state for public job');
  }

  const failures = [];

  for (const url of urls) {
    console.log(`Auditing Lighthouse accessibility: ${url}`);
    const failure = await runOneUrl(url, reportsDir, storageState);
    if (failure) failures.push(failure);
  }

  if (failures.length) {
    console.log(
      `Lighthouse completed with ${failures.length} failed URL(s). See error JSON files for details.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});