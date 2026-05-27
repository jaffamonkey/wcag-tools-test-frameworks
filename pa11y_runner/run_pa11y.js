const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readUrls(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function domainMatches(cookieDomain, hostname) {
  if (!cookieDomain || !hostname) {
    return false;
  }

  const normalizedCookieDomain = String(cookieDomain).replace(/^\./, '').toLowerCase();
  const normalizedHost = String(hostname).toLowerCase();

  return (
    normalizedHost === normalizedCookieDomain ||
    normalizedHost.endsWith(`.${normalizedCookieDomain}`)
  );
}

function pathMatches(cookiePath, pathname) {
  const expectedPath = cookiePath || '/';
  const actualPath = pathname || '/';
  return actualPath.startsWith(expectedPath);
}

function isCookieExpired(cookie) {
  if (!cookie || cookie.expires === undefined || cookie.expires === null) {
    return false;
  }

  const expires = Number(cookie.expires);
  if (!Number.isFinite(expires) || expires <= 0) {
    return false;
  }

  return expires < Math.floor(Date.now() / 1000);
}

function buildCookieHeaderForUrl(cookies, targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return '';
  }

  const matchingCookies = (cookies || []).filter((cookie) => {
    if (!cookie || !cookie.name) {
      return false;
    }

    if (isCookieExpired(cookie)) {
      return false;
    }

    if (!domainMatches(cookie.domain, parsed.hostname)) {
      return false;
    }

    if (!pathMatches(cookie.path, parsed.pathname)) {
      return false;
    }

    if (cookie.secure && parsed.protocol !== 'https:') {
      return false;
    }

    return true;
  });

  return matchingCookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function mergeUrls(jobUrls, templateUrls, perUrlOverrides = {}) {
  const templateObjects = (templateUrls || []).filter(
    (entry) => entry && typeof entry === 'object' && entry.url
  );

  const merged = [];

  for (const url of jobUrls) {
    const matchingObject = templateObjects.find((entry) => entry.url === url);
    const override = perUrlOverrides[url] || {};

    if (matchingObject) {
      merged.push({
        ...matchingObject,
        ...override,
        headers: {
          ...(matchingObject.headers || {}),
          ...(override.headers || {})
        }
      });
    } else if (Object.keys(override).length > 0) {
      merged.push({
        url,
        ...override,
        headers: {
          ...(override.headers || {})
        }
      });
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

function defaultChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
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
const storageStatePath = path.join(resolvedJobDir, 'auth', 'storage_state.json');

if (!fs.existsSync(urlsFile)) {
  throw new Error(`urls.txt not found: ${urlsFile}`);
}
if (!fs.existsSync(templateConfigPath)) {
  throw new Error(`Template config not found: ${templateConfigPath}`);
}

fs.mkdirSync(reportsDir, { recursive: true });

const jobUrls = readUrls(urlsFile);
const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf8'));
const storageState = readJsonIfExists(storageStatePath);
const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];

const perUrlOverrides = {};
for (const url of jobUrls) {
  const cookieHeader = buildCookieHeaderForUrl(cookies, url);
  if (cookieHeader) {
    perUrlOverrides[url] = {
      headers: {
        Cookie: cookieHeader
      }
    };
  }
}

const generatedConfig = {
  ...templateConfig,
  defaults: {
    ...(templateConfig.defaults || {}),
    chromeLaunchConfig: {
      ...((templateConfig.defaults || {}).chromeLaunchConfig || {}),
      executablePath: defaultChromePath()
    },
    reporters: rewriteReporterDirs(templateConfig.defaults?.reporters, reportsDir)
  },
  urls: mergeUrls(jobUrls, templateConfig.urls || [], perUrlOverrides)
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