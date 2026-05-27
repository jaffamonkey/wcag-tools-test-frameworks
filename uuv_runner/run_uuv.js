const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const jobDir = process.argv[2];
if (!jobDir) {
  throw new Error('Usage: node run_uuv.js <job_dir>');
}

const resolvedJobDir = path.resolve(jobDir);
const urlsFile = path.join(resolvedJobDir, 'input', 'urls.txt');
const storageStateFile = path.join(resolvedJobDir, 'auth', 'storage_state.json');
const reportDir = path.join(resolvedJobDir, 'reports', 'uuv');

fs.mkdirSync(reportDir, { recursive: true });

if (!fs.existsSync(urlsFile)) {
  throw new Error(`urls.txt not found: ${urlsFile}`);
}

const hasStorageState = fs.existsSync(storageStateFile);

if (hasStorageState) {
  console.log(`UUV using storage state: ${storageStateFile}`);
} else {
  console.log('UUV running without storage state for public job');
}

const env = {
  ...process.env,
  JOB_DIR: resolvedJobDir,
  URLS_FILE: urlsFile,
  REPORT_DIR: reportDir,
};

if (hasStorageState) {
  env.STORAGE_STATE_FILE = storageStateFile;
} else {
  delete env.STORAGE_STATE_FILE;
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['cucumber-js', '--config', 'cucumber.cjs'],
  {
    env,
    encoding: 'utf-8',
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error('Failed to start cucumber-js:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`cucumber-js exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}