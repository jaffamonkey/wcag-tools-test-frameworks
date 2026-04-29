const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readUrls(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mergeUrls(jobUrls, templateUrls) {
  const templateObjects = (templateUrls || []).filter(
    (entry) => entry && typeof entry === 'object' && entry.url
  );

  const merged = [];

  for (const url of jobUrls) {
    const matchingObject = templateObjects.find((entry) => entry.url === url);
    if (matchingObject) {
      merged.push(matchingObject);
    } else {
      merged.push(url);
    }
  }

  return merged;
}

function rewriteReporterDirs(reporters, reportsDir) {
  return (reporters || []).map((reporter) => {
    if (Array.isArray(reporter) && reporter[0] === './custom-reporter.js') {
      return [
        './custom-reporter.js',
        {
          ...(reporter[1] || {}),
          dir: reportsDir
        }
      ];
    }

    if (reporter === 'pa11y-ci-reporter-html') {
      return [
        'pa11y-ci-reporter-html',
        {
          destination: path.join(reportsDir, 'pa11y-report.html')
        }
      ];
    }

    return reporter;
  });
}

const jobDir = process.argv[2];
if (!jobDir) {
  throw new Error('Usage: node run_pa11y.js <job_dir>');
}

const resolvedJobDir = path.resolve(jobDir);
const urlsFile = path.join(resolvedJobDir, 'input', 'urls.txt');
const reportsDir = path.join(resolvedJobDir, 'reports', 'pa11y');
const templateConfigPath = path.join(__dirname, 'pa11yconfig-template.json');
const generatedConfigPath = path.join(resolvedJobDir, 'input', 'pa11y.config.generated.json');

if (!fs.existsSync(urlsFile)) {
  throw new Error(`urls.txt not found: ${urlsFile}`);
}
if (!fs.existsSync(templateConfigPath)) {
  throw new Error(`Template config not found: ${templateConfigPath}`);
}

fs.mkdirSync(reportsDir, { recursive: true });

const jobUrls = readUrls(urlsFile);
const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf8'));

const generatedConfig = {
  ...templateConfig,
  defaults: {
    ...(templateConfig.defaults || {}),
    reporters: rewriteReporterDirs(templateConfig.defaults?.reporters, reportsDir)
  },
  urls: mergeUrls(jobUrls, templateConfig.urls || [])
};

fs.writeFileSync(generatedConfigPath, JSON.stringify(generatedConfig, null, 2), 'utf8');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['pa11y-ci', '--config', generatedConfigPath],
  {
    cwd: __dirname,
    stdio: 'inherit'
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);