/**
 * accessibility.js
 *
 * Playwright + IBM Equal Access (accessibility-checker) integration:
 * - Whole page scans (via page.content() snapshot)
 * - Scoped scans for a specific subtree (header/footer/dialog/main-content) by scanning a scoped HTML document
 * - If scoped scan fails/times out, auto-fallback to full page scan (clearly labeled)
 * - Lets accessibility-checker write its own reports (html/json/csv/xlsx) via .achecker.yml
 * - ALSO writes our own JSON+CSV with a stable, matching base filename
 * - Attaches our JSON+CSV + any newly-created aChecker files to Playwright HTML report
 * - Failure-only screenshots (highlighted full page + best-effort element screenshots)
 **/

const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");
const aChecker = require("accessibility-checker");

const INTERNAL_DIR = "custom-reports"; // our files: json/csv/xlsx-copy + screenshots + summary
const SCREENSHOT_DIR = path.join(INTERNAL_DIR, "screenshots");
const SUMMARY_FILE = "summary.json";

// Keep attachments modest to avoid Playwright HTML reporter bloat:
const MAX_ELEMENT_SHOTS_TOTAL = 2; // total element screenshots per scan
const MAX_ELEMENT_SHOTS_PER_RULE = 1; // per rule id
const MAX_ACHECKER_ATTACH = 6; // max achecker-generated files to attach per scan

// Guardrail timeouts (ms)
const SCOPE_VISIBLE_TIMEOUT_MS = 30_000; // Playwright expect timeout
const SCOPE_VISIBLE_GUARD_MS = 35_000; // wrapper guard timeout
const ACHECKER_WHOLE_SCAN_GUARD_MS = 360_000; // 6 min per scan
const ACHECKER_SCOPED_SCAN_GUARD_MS = 120_000; // scoped scans should be faster; tune if needed
const BUILD_SCOPED_DOC_GUARD_MS = 20_000;
const REPORT_DIR = "accessibility-reports";

let _cachedConfig = null;
let _cachedOutputDir = null;
let lastFailedLabel = null;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Make a safe string label from anything (avoids "[object Object]" filenames).
 */
function normalizeLabel(label, fallback = "accessibility-report") {
  if (typeof label === "string" && label.trim()) return label.trim();
  if (label && typeof label === "object") {
    if (typeof label.title === "string" && label.title.trim()) return label.title.trim();
    if (typeof label.name === "string" && label.name.trim()) return label.name.trim();
  }
  return fallback;
}

function safeBaseName(name) {
  return String(name || "a11y")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isProbablySelector(input) {
  return /^[#.[(:]/.test(input) || /\s|\]|\[|>|\+|~|=|\./.test(input);
}

function cssEscape(value) {
  return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function toCssSelector(idOrSelector) {
  return isProbablySelector(idOrSelector) ? idOrSelector : `#${cssEscape(idOrSelector)}`;
}

// Playwright-only ":visible" helper
function toPlaywrightVisibleSelector(idOrSelector) {
  const base = toCssSelector(idOrSelector);
  return base.includes(":visible") ? base : `${base}:visible`;
}

function isHtml(fp) {
  const ext = path.extname(fp).toLowerCase();
  return ext === ".html" || ext === ".htm";
}

function isXlsx(fp) {
  return path.extname(fp).toLowerCase() === ".xlsx";
}

function newestFile(files) {
  let best = null;
  let bestMtime = 0;

  for (const fp of files) {
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      const m = st.mtimeMs || 0;
      if (m > bestMtime) {
        bestMtime = m;
        best = fp;
      }
    } catch {
      // ignore
    }
  }
  return best;
}

/**
 * Make the aChecker XLSX in outputFolder match the aChecker HTML basename.
 * Example:
 *   accessibility-reports/Offers-...html
 *   accessibility-reports/results_...xlsx
 * -> accessibility-reports/Offers-...xlsx
 */
function ensureOutputXlsxMatchesHtml(createdFiles, labelKey) {
  const createdHtml = createdFiles.filter(isHtml);
  const createdXlsx = createdFiles.filter(isXlsx);

  const htmlMatch =
    newestFile(createdHtml.filter((fp) => safeBaseName(path.basename(fp)).includes(labelKey))) ||
    newestFile(createdHtml);

  const xlsxProduced = newestFile(createdXlsx);
  if (!htmlMatch || !xlsxProduced) return null;

  const htmlBase = path.basename(htmlMatch, path.extname(htmlMatch));
  const desiredXlsxPath = path.join(path.dirname(htmlMatch), `${htmlBase}.xlsx`);

  // already correct?
  if (path.resolve(xlsxProduced) === path.resolve(desiredXlsxPath)) return desiredXlsxPath;

  // don't overwrite
  if (fs.existsSync(desiredXlsxPath)) return desiredXlsxPath;

  // copy is safer than rename (Windows + file locks)
  fs.copyFileSync(xlsxProduced, desiredXlsxPath);

  // optional cleanup: remove generic "results_....xlsx"
  try {
    const bn = path.basename(xlsxProduced).toLowerCase();
    if (bn.startsWith("results_") && fs.existsSync(xlsxProduced)) fs.unlinkSync(xlsxProduced);
  } catch {
    // ignore
  }

  return desiredXlsxPath;
}


/**
 * Promise wrapper to prevent hanging until the test-level timeout.
 */
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * accessibility-checker results are usually in report.results (array).
 */
function extractFindings(report) {
  return Array.isArray(report?.results) ? report.results : [];
}

function groupByRule(findings) {
  const by = new Map();
  for (const f of findings) {
    const ruleId = f.ruleId || f.rule || f.id || "unknown-rule";
    if (!by.has(ruleId)) by.set(ruleId, []);
    by.get(ruleId).push(f);
  }
  return by;
}

function countByLevel(findings) {
  const counts = {
    violation: 0,
    potentialviolation: 0,
    recommendation: 0,
    potentialrecommendation: 0,
    manual: 0,
    pass: 0,
  };
  for (const f of findings) {
    const lvl = String(f.level || "").toLowerCase();
    if (lvl in counts) counts[lvl] += 1;
  }
  return { total: findings.length, ...counts };
}

function formatFindings(findings, max = 50) {
  const slice = findings.slice(0, max);
  return slice
    .map((f, i) => {
      const rule = f.ruleId || f.rule || f.id || "unknown-rule";
      const level = String(f.level || "unknown").toUpperCase();
      const msg = f.message || f.reason || f.help || "";
      const snippet = f.snippet ? `\nSnippet: ${String(f.snippet).slice(0, 200)}` : "";
      const pathDom = f?.path?.dom ? `\nDOM: ${f.path.dom}` : "";
      const pathSel = f?.path?.selector ? `\nSelector: ${f.path.selector}` : "";
      const help = f?.helpUrl ? `\nHelp: ${f.helpUrl}` : "";
      return `${i + 1}) [${level}] ${rule}\n${msg}${help}${pathSel}${pathDom}${snippet}\n`;
    })
    .join("\n");
}

/**
 * Minimal internal summary store (used to post-process late XLSX after aChecker.close()).
 */
function appendSummary(entry) {
  ensureDir(INTERNAL_DIR);
  const summaryPath = path.join(INTERNAL_DIR, SUMMARY_FILE);

  let existing = [];
  if (fs.existsSync(summaryPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }

  existing.push(entry);
  fs.writeFileSync(summaryPath, JSON.stringify(existing, null, 2), "utf8");
}

function readSummary() {
  try {
    const p = path.join(INTERNAL_DIR, SUMMARY_FILE);
    if (!fs.existsSync(p)) return [];
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function attachFile(testInfo, name, filePath, contentType) {
  if (!testInfo) return;
  if (!fs.existsSync(filePath)) return;
  await testInfo.attach(name, { path: filePath, contentType });
}

function contentTypeForPath(fp) {
  const ext = path.extname(fp).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "text/html";
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Our own CSV writer (so CSV always exists + matches JSON filename).
 */
function toCsvValue(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function findingsToCsv(findings) {
  const header = ["level", "ruleId", "message", "helpUrl", "selector", "dom", "snippet"].join(",");

  const rows = findings.map((f) => {
    const ruleId = f.ruleId || f.rule || f.id || "";
    const level = f.level || "";
    const message = f.message || f.reason || f.help || "";
    const helpUrl = f.helpUrl || "";
    const selector = f?.path?.selector || "";
    const dom = f?.path?.dom || "";
    const snippet = f.snippet || "";

    return [
      toCsvValue(level),
      toCsvValue(ruleId),
      toCsvValue(message),
      toCsvValue(helpUrl),
      toCsvValue(selector),
      toCsvValue(dom),
      toCsvValue(snippet),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

/**
 * Fetch and cache aChecker config (reads .achecker.yml / aceconfig.js).
 */
async function getAcheckerConfig() {
  if (_cachedConfig) return _cachedConfig;
  try {
    _cachedConfig = await aChecker.getConfig();
  } catch {
    _cachedConfig = {};
  }
  return _cachedConfig;
}

/**
 * Determine output folder used by accessibility-checker built-in reporting.
 */
async function getAcheckerOutputDir() {
  if (_cachedOutputDir) return _cachedOutputDir;

  const cfg = await getAcheckerConfig();
  const out = cfg?.outputFolder || "results";
  _cachedOutputDir = path.isAbsolute(out) ? out : path.resolve(process.cwd(), out);
  return _cachedOutputDir;
}

function listFilesSafe(dir) {
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * (Optional) make the HTML we feed to aChecker lighter/faster.
 * We remove scripts/styles/links/iframes and optionally strip image src.
 * This reduces chances of hanging on external fetches / huge pages.
 */
function lightenHtml(html, opts = {}) {
  const {
    stripScripts = true,
    stripStyles = true,
    stripLinkStylesheets = true,
    stripIframes = true,
    stripImages = true,
  } = opts;

  let out = String(html || "");

  if (stripScripts) out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  if (stripStyles) out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  if (stripLinkStylesheets) {
    out = out.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "");
  }

  if (stripIframes) {
    out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
    out = out.replace(/<iframe\b[^>]*\/>/gi, "");
  }

  if (stripImages) {
    out = out.replace(/\s(src|srcset)=["'][^"']*["']/gi, "");
  }

  return out;
}

/**
 * Build a self-contained HTML doc around the subtree.
 * Adds <base href="page.url()"> so relative URLs resolve if needed.
 * Also runs lightenHtml() to keep scans fast and avoid hanging.
 */
async function buildScopedDocument(page, scopeCssSelector) {
  const url = page.url();

  const data = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      found: !!el,
      outerHTML: el ? el.outerHTML : "",
      title: document.title || "",
      lang: document.documentElement?.getAttribute("lang") || "en",
    };
  }, scopeCssSelector);

  if (!data?.found || !data.outerHTML) {
    throw new Error(`Scope element not found for selector: ${scopeCssSelector}`);
  }

  const escapedTitle = String(data.title).replace(/</g, "&lt;");
  const escapedLang = String(data.lang || "en").replace(/"/g, "");

  const doc = `<!doctype html>
<html lang="${escapedLang}">
<head>
  <meta charset="utf-8"/>
  <title>${escapedTitle}</title>
  <base href="${url}"/>
</head>
<body>
${data.outerHTML}
</body>
</html>`;

  // keep it light to reduce timeouts/hangs
  return lightenHtml(doc, {
    stripScripts: true,
    stripStyles: true,
    stripLinkStylesheets: true,
    stripIframes: true,
    stripImages: true,
  });
}

/**
 * Highlight issues on the page (best-effort) using finding.path.selector or finding.path.dom (xpath).
 */
async function highlightFindingsOnPage(page, findings, scopeCssSelector) {
  const MAX_HIGHLIGHT = 40;
  const items = [];

  for (const f of findings) {
    if (items.length >= MAX_HIGHLIGHT) break;
    const selector = f?.path?.selector;
    const xpath = f?.path?.dom;
    if (selector) items.push({ kind: "css", value: selector });
    else if (xpath) items.push({ kind: "xpath", value: xpath });
  }

  await page.evaluate(
    ({ items, scope }) => {
      const STYLE_ID = "__a11y_highlight_style__";
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
          [data-a11y-highlight="true"] { outline: 3px solid #ff3b30 !important; outline-offset: 2px !important; }
          [data-a11y-highlight="true"] { scroll-margin-top: 80px; }
        `;
        document.head.appendChild(style);
      }

      const root = scope ? document.querySelector(scope) : document;
      if (!root) return;

      const mark = (el) => {
        if (el && el.setAttribute) el.setAttribute("data-a11y-highlight", "true");
      };

      const findByXPath = (xp) => {
        try {
          const res = document.evaluate(
            xp,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          const els = [];
          for (let i = 0; i < res.snapshotLength; i++) els.push(res.snapshotItem(i));
          return els;
        } catch {
          return [];
        }
      };

      for (const item of items) {
        try {
          if (item.kind === "css") {
            root.querySelectorAll(item.value).forEach(mark);
          } else {
            const els = findByXPath(item.value);
            if (!scope) els.forEach(mark);
            else {
              const scopeEl = document.querySelector(scope);
              els.filter((el) => scopeEl && scopeEl.contains(el)).forEach(mark);
            }
          }
        } catch {
          // ignore
        }
      }
    },
    { items, scope: scopeCssSelector || null }
  );
}

async function clearHighlights(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-a11y-highlight="true"]').forEach((el) => {
      el.removeAttribute("data-a11y-highlight");
    });
    const style = document.getElementById("__a11y_highlight_style__");
    if (style) style.remove();
  });
}

function locatorForFinding(page, finding, scopeVisibleSelector) {
  const scope = scopeVisibleSelector ? page.locator(scopeVisibleSelector) : page;
  const selector = finding?.path?.selector;
  const xpath = finding?.path?.dom;

  if (selector) return scope.locator(selector).first();
  if (xpath) return scope.locator(`xpath=${xpath}`).first();
  return null;
}

async function takeFailureScreenshots(params) {
  const { page, testInfo, reportBase, findings, scopeCssSelector, scopeVisibleSelector } = params;

  ensureDir(SCREENSHOT_DIR);

  // 1) Element screenshots (best-effort)
  let total = 0;
  const byRule = groupByRule(findings);

  for (const [ruleId, list] of byRule.entries()) {
    let perRule = 0;

    for (const f of list) {
      if (total >= MAX_ELEMENT_SHOTS_TOTAL || perRule >= MAX_ELEMENT_SHOTS_PER_RULE) break;

      try {
        const loc = locatorForFinding(page, f, scopeVisibleSelector);
        if (!loc) continue;
        if ((await loc.count()) === 0) continue;

        const isVisible = await loc.isVisible().catch(() => false);
        if (!isVisible) continue;

        await loc.scrollIntoViewIfNeeded();

        const shotName = `${reportBase}-element-${safeBaseName(ruleId)}-${total}.png`;
        const shotPath = path.join(SCREENSHOT_DIR, shotName);

        await loc.screenshot({ path: shotPath });
        await attachFile(testInfo, `a11y: failing element (${ruleId})`, shotPath, "image/png");

        total += 1;
        perRule += 1;
      } catch {
        // ignore
      }
    }

    if (total >= MAX_ELEMENT_SHOTS_TOTAL) break;
  }

  // 2) Highlighted page screenshot (JPEG to reduce size)
  try {
    await highlightFindingsOnPage(page, findings, scopeCssSelector);
    const highlightedPath = path.join(SCREENSHOT_DIR, `${reportBase}-page-highlighted.jpg`);
    await page.screenshot({ path: highlightedPath, fullPage: true, type: "jpeg", quality: 70 });
    await attachFile(testInfo, "a11y: page screenshot (highlighted)", highlightedPath, "image/jpeg");
  } finally {
    await clearHighlights(page).catch(() => { });
  }

  // 3) Scope screenshot (if we have one)
  if (scopeVisibleSelector) {
    try {
      const scopeLoc = page.locator(scopeVisibleSelector).first();
      if (await scopeLoc.isVisible().catch(() => false)) {
        const scopePath = path.join(SCREENSHOT_DIR, `${reportBase}-scope.png`);
        await scopeLoc.screenshot({ path: scopePath });
        await attachFile(testInfo, "a11y: scope screenshot", scopePath, "image/png");
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Copy the best matching XLSX produced by aChecker into INTERNAL_DIR/reportBase.xlsx.
 * This is a best-effort heuristic. It helps when XLSX appears during scan.
 */
function copyMatchingXlsxNow(createdFiles, reportBase) {
  try {
    const createdXlsx = createdFiles.filter(isXlsx);
    const producedXlsx = newestFile(createdXlsx);
    if (!producedXlsx) return null;

    const xlsxCopyPath = path.join(INTERNAL_DIR, `${reportBase}.xlsx`);
    fs.copyFileSync(producedXlsx, xlsxCopyPath);
    return xlsxCopyPath;
  } catch {
    return null;
  }
}

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

async function captureScreenshots(page, normalizedLabel, findings, opts) {
  ensureScreenshotDir();

  const fullPath = path.join(
    SCREENSHOT_DIR,
    `${normalizedLabel}-fullpage.png`
  );

  await page.screenshot({
    path: fullPath,
    fullPage: true,
  });

  if (opts?.testInfo) {
    await opts.testInfo.attach("a11y: fullpage failure screenshot", {
      path: fullPath,
      contentType: "image/png",
    });
  }

  // Best-effort element screenshots
  let totalShots = 0;
  const ruleCounts = {};

  for (const finding of findings) {
    if (totalShots >= MAX_ELEMENT_SHOTS_TOTAL) break;

    const ruleId = finding.ruleId || "unknown-rule";
    ruleCounts[ruleId] = ruleCounts[ruleId] || 0;

    if (ruleCounts[ruleId] >= MAX_ELEMENT_SHOTS_PER_RULE) continue;

    const target = finding.target?.[0];
    if (!target) continue;

    try {
      const locator = page.locator(target).first();
      await locator.waitFor({ state: "visible", timeout: 3000 });

      const elementPath = path.join(
        SCREENSHOT_DIR,
        `${normalizedLabel}-${ruleId}-${totalShots + 1}.png`
      );

      await locator.screenshot({ path: elementPath });

      if (opts?.testInfo) {
        await opts.testInfo.attach(
          `a11y: element ${ruleId}`,
          {
            path: elementPath,
            contentType: "image/png",
          }
        );
      }

      totalShots++;
      ruleCounts[ruleId]++;
    } catch {
      // Ignore element screenshot failures
    }
  }
}

/**
 * Shared reporting pipeline once we have `scan` already.
 * `scanKind` is for metadata/labels only ("whole" vs "scoped" vs "fallback").
 */
async function finalizeAndReport(page, normalizedLabel, scan, beforeFiles, opts = {}, scanKind = "whole") {
  ensureDir(INTERNAL_DIR);
  ensureDir(SCREENSHOT_DIR);

  const outputDir = await getAcheckerOutputDir();
  ensureDir(outputDir);

  const report = scan?.report || scan;
  const findings = extractFindings(report);
  const counts = countByLevel(findings);

  // Use ONE reportBase for: our json/csv + screenshots + xlsx-copy
  const reportBase = `${safeBaseName(normalizedLabel)}-${Date.now()}`;
  const scanStartedAt = Date.now();

  // ---- Our own JSON + CSV (same basename) ----
  const jsonPath = path.join(INTERNAL_DIR, `${reportBase}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        meta: {
          label: normalizedLabel,
          url: page.url(),
          scannedAt: new Date().toISOString(),
          scanStartedAt,
          scanKind,
          scopeSelector: opts.scopeCssSelector || null,
        },
        report,
      },
      null,
      2
    ),
    "utf8"
  );

  const csvPath = path.join(INTERNAL_DIR, `${reportBase}.csv`);
  fs.writeFileSync(csvPath, findingsToCsv(findings), "utf8");

  // Attach our JSON+CSV (always)
  await attachFile(opts.testInfo, "a11y: results (json)", jsonPath, "application/json");
  await attachFile(opts.testInfo, "a11y: report (csv)", csvPath, "text/csv");

  // ---- Attach newly-created aChecker output files (best-effort) ----
  const afterFiles = new Set(listFilesSafe(outputDir));
  const created = [];
  for (const fp of afterFiles) if (!beforeFiles.has(fp)) created.push(fp);

  try {
    const labelKey = safeBaseName(normalizedLabel || label || "accessibility-report");
    ensureOutputXlsxMatchesHtml(created, labelKey);
  } catch (e) {
    console.warn("a11y: could not rename/copy output xlsx:", e?.message || e);
  }

  // ---- Copy aChecker-produced XLSX into custom-reports/<reportBase>.xlsx (if produced now) ----
  let internalXlsxName = null;
  const xlsxCopyNow = copyMatchingXlsxNow(created, reportBase);
  if (xlsxCopyNow) {
    internalXlsxName = path.basename(xlsxCopyNow);
    await attachFile(
      opts.testInfo,
      "a11y: report (xlsx)",
      xlsxCopyNow,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }

  // Prefer files matching the label slug, else attach what was created
  const labelKey = safeBaseName(normalizedLabel);
  const createdForLabel = created.filter((fp) => safeBaseName(path.basename(fp)).includes(labelKey));
  const toAttach = createdForLabel.length ? createdForLabel : created;

  for (const fp of toAttach.slice(0, MAX_ACHECKER_ATTACH)) {
    await attachFile(opts.testInfo, `achecker: ${path.basename(fp)}`, fp, contentTypeForPath(fp));
  }

  // Optional internal summary (used for post-close XLSX renaming)
  appendSummary({
    reportBase,
    label: normalizedLabel,
    labelKey,
    url: page.url(),
    scannedAt: new Date().toISOString(),
    scanStartedAt,
    scanKind,
    scopeSelector: opts.scopeCssSelector || null,
    counts,
    acheckerOutputDir: outputDir,
    createdFiles: toAttach.map((x) => path.basename(x)),
    internalFiles: {
      json: path.basename(jsonPath),
      csv: path.basename(csvPath),
      xlsx: internalXlsxName,
    },
  });

  // Fail logic based on accessibility-checker config failLevels (assertCompliance)
  let returnCode = 0;
  try {
    returnCode = aChecker.assertCompliance(report);
  } catch (e) {
    returnCode = findings.some((f) => String(f.level || "").toLowerCase() === "violation") ? 2 : 0;
  }

  const violations = findings.filter(
    (f) => String(f.level || "").toLowerCase() === "violation"
  );

  const failingFindings = [...violations];

  if (failingFindings.length > 0) {
    lastFailedLabel = normalizedLabel;
    await captureScreenshots(page, normalizedLabel, failingFindings, opts);
  }

  if (returnCode !== 0 && violations.length > 0) {
    try {
      await takeFailureScreenshots({
        page,
        testInfo: opts.testInfo,
        reportBase,
        findings: violations,
        scopeCssSelector: opts.scopeCssSelector,
        scopeVisibleSelector: opts.scopeVisibleSelector,
      });
    } catch (e) {
      console.warn("a11y screenshot capture failed:", e?.message || e);
      await opts.testInfo?.attach?.("a11y: screenshot capture failed", {
        body: Buffer.from(String(e?.stack || e)),
        contentType: "text/plain",
      });
    }

    const msg = formatFindings(violations, 80);
    expect(violations, `Accessibility violations found:\n${msg}`).toEqual([]);
  }

  // Potentials as warnings
  const potentials = findings.filter(
    (f) => String(f.level || "").toLowerCase() === "potentialviolation"
  );
  if (potentials.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`Accessibility potential violations:\n${formatFindings(potentials, 30)}`);
  }

  return {
    report,
    findings,
    counts,
    outputDir,
    scanKind,
    internal: { jsonPath, csvPath },
    internalXlsxName,
    acheckerAttached: toAttach.map((x) => path.basename(x)),
  };
}

/**
 * Whole-page scan.
 * options: { testInfo }
 */
async function runAccessibilityCheck(page, reportName = "accessibility-report", options = {}) {
  const normalizedLabel = normalizeLabel(reportName, "accessibility-report");

  const outputDir = await getAcheckerOutputDir();
  ensureDir(outputDir);

  const before = new Set(listFilesSafe(outputDir));

  const html = lightenHtml(await page.content(), {
    stripScripts: true,
    stripStyles: true,
    stripLinkStylesheets: true,
    stripIframes: true,
    stripImages: true,
  });

  const scan = await withTimeout(
    aChecker.getCompliance(html, normalizedLabel),
    ACHECKER_WHOLE_SCAN_GUARD_MS,
    `aChecker scan (whole): ${normalizedLabel}`
  );

  return finalizeAndReport(page, normalizedLabel, scan, before, { testInfo: options.testInfo }, "whole");
}

/**
 * Scoped scan helper:
 * - Waits for scope to be visible
 * - Scans ONLY the subtree by feeding a scoped HTML document to aChecker
 * - If scoped scan fails/times out, falls back to full page scan (clearly labeled)
 *
 * Supports both call shapes:
 *  - runDialogAccessibilityCheck(page, scopeSelector, reportName, options)
 *  - runDialogAccessibilityCheck(page, scopeSelector, options)   // reportName auto-generated
 */
async function runDialogAccessibilityCheck(page, scopeIdOrSelector, reportNameOrOptions, maybeOptions) {
  const cssSelector = toCssSelector(scopeIdOrSelector);
  const visibleSelector = toPlaywrightVisibleSelector(scopeIdOrSelector);

  let reportName = reportNameOrOptions;
  let options = maybeOptions;

  // If caller omitted reportName and passed options as 3rd arg:
  if (reportNameOrOptions && typeof reportNameOrOptions === "object" && !maybeOptions) {
    options = reportNameOrOptions;
    reportName = `scope ${cssSelector} accessibility report`;
  }

  const normalizedLabel = normalizeLabel(reportName, `scope ${cssSelector} accessibility report`);

  await withTimeout(
    expect(page.locator(visibleSelector)).toBeVisible({ timeout: SCOPE_VISIBLE_TIMEOUT_MS }),
    SCOPE_VISIBLE_GUARD_MS,
    `Scope visibility: ${normalizedLabel}`
  );

  const outputDir = await getAcheckerOutputDir();
  ensureDir(outputDir);
  const before = new Set(listFilesSafe(outputDir));

  // Try scoped first
  try {
    const scopedDoc = await withTimeout(
      buildScopedDocument(page, cssSelector),
      BUILD_SCOPED_DOC_GUARD_MS,
      `Build scoped document: ${normalizedLabel}`
    );

    const scan = await withTimeout(
      aChecker.getCompliance(scopedDoc, normalizedLabel),
      ACHECKER_SCOPED_SCAN_GUARD_MS,
      `aChecker scan (scoped): ${normalizedLabel}`
    );

    return finalizeAndReport(
      page,
      normalizedLabel,
      scan,
      before,
      {
        testInfo: options?.testInfo,
        scopeCssSelector: cssSelector,
        scopeVisibleSelector: visibleSelector,
      },
      "scoped"
    );
  } catch (e) {
    // Scoped failed -> fallback full page (this is what you were effectively doing before)
    // eslint-disable-next-line no-console
    console.warn(`a11y scoped scan failed, falling back to full page: ${normalizedLabel}`, e?.message || e);

    await options?.testInfo?.attach?.("a11y: scoped scan failed (fallback full page)", {
      body: Buffer.from(String(e?.stack || e)),
      contentType: "text/plain",
    });

    const fallbackLabel = `${normalizedLabel} (fallback full page)`;

    const html = lightenHtml(await page.content(), {
      stripScripts: true,
      stripStyles: true,
      stripLinkStylesheets: true,
      stripIframes: true,
      stripImages: true,
    });

    const scan = await withTimeout(
      aChecker.getCompliance(html, fallbackLabel),
      ACHECKER_WHOLE_SCAN_GUARD_MS,
      `aChecker scan (fallback whole): ${fallbackLabel}`
    );

    return finalizeAndReport(
      page,
      fallbackLabel,
      scan,
      before,
      {
        testInfo: options?.testInfo,
        scopeCssSelector: cssSelector,
        scopeVisibleSelector: visibleSelector,
      },
      "fallback-whole"
    );
  }
}

/**
 * After all scans:
 * - call aChecker.close() to flush CSV/XLSX
 * - then try to copy late-written XLSX into INTERNAL_DIR using summary mapping
 */
async function closeAccessibilityChecker() {
  if (typeof aChecker.close === "function") {
    await aChecker.close();
  }

  // Remove aChecker summary JSON files, keep page-level reports
  try {
    const outputDir = await getAcheckerOutputDir();

    for (const file of fs.readdirSync(outputDir)) {
      if (/^summary_.*\.json$/i.test(file)) {
        fs.unlinkSync(path.join(outputDir, file));
        console.log(`Removed summary report: ${file}`);
      }
    }
  } catch (err) {
    console.warn("Could not clean summary JSON reports:", err.message);
  }

  // Existing XLSX rename logic
  try {
    const files = fs
      .readdirSync(REPORT_DIR)
      .filter((f) => f.startsWith("results_") && f.endsWith(".xlsx"))
      .map((f) => ({
        name: f,
        time: fs.statSync(path.join(REPORT_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (!files.length) return;

    const latestFile = files[0].name;

    if (!lastFailedLabel) {
      console.log("No failing scan found — leaving XLSX filename as default.");
      return;
    }

    const newPath = path.join(REPORT_DIR, `${lastFailedLabel}.xlsx`);
    const oldPath = path.join(REPORT_DIR, latestFile);

    fs.renameSync(oldPath, newPath);

    console.log(`Renamed XLSX to: ${lastFailedLabel}.xlsx`);
  } catch (err) {
    console.warn("Could not rename XLSX file:", err.message);
  }
}

module.exports = {
  runAccessibilityCheck,
  runDialogAccessibilityCheck,
  closeAccessibilityChecker,
};
