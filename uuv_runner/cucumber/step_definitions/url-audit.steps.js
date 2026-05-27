const fs = require('node:fs');
const path = require('node:path');
const {
  BeforeAll,
  AfterAll,
  Before,
  After,
  Given,
  When,
  setWorldConstructor,
  setDefaultTimeout,
} = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

setDefaultTimeout(90 * 1000);

const JOB_DIR = process.env.JOB_DIR ? path.resolve(process.env.JOB_DIR) : process.cwd();
const URLS_FILE = process.env.URLS_FILE
  ? path.resolve(process.env.URLS_FILE)
  : path.join(JOB_DIR, 'input', 'urls.txt');
const STORAGE_STATE_FILE = process.env.STORAGE_STATE_FILE
  ? path.resolve(process.env.STORAGE_STATE_FILE)
  : path.join(JOB_DIR, 'auth', 'storage_state.json');
const REPORT_DIR = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.join(JOB_DIR, 'reports', 'uuv');

let browser;

class CustomWorld {
  constructor() {
    this.context = null;
    this.page = null;
    this.currentUrl = null;
    this.startedAt = null;
    this.scenarioName = null;
    this.pageErrors = [];
    this.consoleMessages = [];
    this.failedRequests = [];
    this.report = null;
  }
}

setWorldConstructor(CustomWorld);

BeforeAll(async function () {
  browser = await chromium.launch({ headless: true });
});

AfterAll(async function () {
  if (browser) await browser.close();
});

Before(async function ({ pickle }) {
  this.scenarioName = pickle.name;

  const contextOptions = {
    ignoreHTTPSErrors: true,
  };

  if (fs.existsSync(STORAGE_STATE_FILE)) {
    contextOptions.storageState = STORAGE_STATE_FILE;
  }

  this.context = await browser.newContext(contextOptions);
  this.page = null;
  this.currentUrl = null;
  this.startedAt = null;
  this.pageErrors = [];
  this.consoleMessages = [];
  this.failedRequests = [];
  this.report = null;
});

After(async function ({ result }) {
  if (this.currentUrl) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const outputPath = path.join(REPORT_DIR, buildReportFileName(this.scenarioName) + '.json');

    const payload = this.report || {
      scenarioName: this.scenarioName,
      requestedUrl: this.currentUrl,
      finalUrl: this.page ? this.page.url() : null,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      status: normalizeStatus(result?.status),
      errorMessage: result?.message || null,
      generatedBy: '@uuv/playwright + cucumber-js + playwright',
    };

    if (!payload.status) payload.status = normalizeStatus(result?.status);
    if (!payload.errorMessage && result?.message) payload.errorMessage = result.message;
    if (!payload.endedAt) payload.endedAt = new Date().toISOString();

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  if (this.page) await this.page.close().catch(() => { });
  if (this.context) await this.context.close().catch(() => { });
});

Given('I prepare the report folder', function () {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
});

When('I run a rich full page check for {string}', async function (url) {
  await resetPageState.call(this);
  await runRichFullPageCheck.call(this, url);
});

When(
  'I run a rich full page check for every URL in {string}',
  { timeout: 15 * 60 * 1000 },
  async function (_ignoredFileName) {
    const urls = fs
      .readFileSync(URLS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const url of urls) {
      await resetPageState.call(this);
      await runRichFullPageCheck.call(this, url);
    }
  }
);

async function resetPageState() {
  if (this.page) {
    await this.page.close().catch(() => { });
  }

  this.page = await this.context.newPage();
  this.pageErrors = [];
  this.consoleMessages = [];
  this.failedRequests = [];
  this.report = null;

  this.page.on('pageerror', (error) => {
    this.pageErrors.push(error.message);
  });

  this.page.on('console', (msg) => {
    const type = msg.type();
    if (['error', 'warning'].includes(type)) {
      this.consoleMessages.push({
        type,
        text: msg.text(),
      });
    }
  });

  this.page.on('requestfailed', (request) => {
    this.failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure() ? request.failure().errorText : 'unknown',
    });
  });
}

async function runRichFullPageCheck(url) {
  this.currentUrl = url;
  this.startedAt = new Date().toISOString();
  this.scenarioName = `Full page check for ${url}`;
  this.pageErrors = [];
  this.consoleMessages = [];
  this.failedRequests = [];
  this.report = null;

  await this.page.goto('about:blank').catch(() => { });

  let response = null;

  try {
    response = await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await this.page.waitForLoadState('domcontentloaded');

    await this.page.waitForFunction(() => {
      const body = document.body;
      if (!body) return false;

      const hasVisibleText = (body.innerText || '').trim().length > 0;
      const visibleElement = Array.from(body.querySelectorAll('*')).some((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });

      return hasVisibleText || visibleElement;
    }, { timeout: 15000 });
  } catch (error) {
    const finalUrl = this.page ? this.page.url() : null;

    this.report = {
      scenarioName: this.scenarioName,
      requestedUrl: url,
      finalUrl,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      status: 'failed',
      generatedBy: '@uuv/playwright + cucumber-js + playwright',
      summary: {
        httpStatus: response ? response.status() : null,
        finalUrl,
        title: null,
        bodyPresent: false,
        titlePresent: false,
        headingCount: 0,
        linkCount: 0,
        buttonCount: 0,
        inputCount: 0,
        imageCount: 0,
        formCount: 0,
        frameCount: 0,
        firstHeading: null,
        pageErrorCount: this.pageErrors.length,
        consoleIssueCount: this.consoleMessages.length,
        failedRequestCount: this.failedRequests.length,
        axeViolationCount: 0,
        axeIncompleteCount: 0,
        manualReviewNeeded: false,
        contrastViolationCount: 0,
        contrastIncompleteCount: 0,
      },
      findings: [
        {
          severity: 'high',
          code: 'page-readiness-failed',
          message: error.message || String(error),
        },
      ],
      pageErrors: this.pageErrors,
      consoleMessages: this.consoleMessages,
      failedRequests: this.failedRequests,
      details: {},
      axe: {
        violationCount: 0,
        violations: [],
        incompleteCount: 0,
        incomplete: [],
        passes: {
          broad: null,
          contrast: null,
        },
        inapplicable: {
          broad: null,
          contrast: null,
        },
        scans: {},
      },
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const outputPath = path.join(REPORT_DIR, buildReportFileName(this.scenarioName) + '.json');
    fs.writeFileSync(outputPath, JSON.stringify(this.report, null, 2), 'utf8');

    return;
  }

  await this.page.evaluate(async () => {
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    } catch { }

    document.querySelectorAll('details:not([open])').forEach((el) => el.setAttribute('open', ''));

    document.querySelectorAll('[aria-expanded="false"]').forEach((el) => {
      if (
        el.matches('button,summary,[role="button"]') &&
        !el.hasAttribute('disabled') &&
        el.getAttribute('aria-controls')
      ) {
        try {
          el.click();
        } catch { }
      }
    });
  });

  try {
    const beforeScrollUrl = this.page.url();
    await autoScrollWithRetry(this.page);
    const afterScrollUrl = this.page.url();

    if (afterScrollUrl !== beforeScrollUrl) {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
    }
  } catch (error) {
    this.consoleMessages.push({
      type: 'warning',
      text: `Auto-scroll skipped: ${error.message || String(error)}`,
    });
  }

  // try {
  //   const beforeScrollUrl = this.page.url();
  //   await autoScrollWithRetry(this.page);
  //   const afterScrollUrl = this.page.url();

  //   if (afterScrollUrl !== beforeScrollUrl) {
  //     await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
  //   }
  // } catch (error) {
  //   this.consoleMessages.push({
  //     type: 'warning',
  //     text: `Auto-scroll skipped: ${error.message || String(error)}`,
  //   });
  // }
  
  await this.page
    .addStyleTag({
      content: `
      *,
      *::before,
      *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }
      html:focus-within { scroll-behavior: auto !important; }
    `,
    })
    .catch(() => { });

  await this.page.waitForTimeout(300);

  const title = (await this.page.title()).trim();
  const finalUrl = this.page.url();

  const domStats = await this.page.evaluate(() => {
    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const hrefOf = (el) => el.getAttribute('href') || '';

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const links = Array.from(document.querySelectorAll('a'));
    const buttons = Array.from(
      document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="reset"]')
    );
    const images = Array.from(document.querySelectorAll('img'));
    const inputs = Array.from(document.querySelectorAll('input,textarea,select'));
    const forms = Array.from(document.forms || []);
    const iframes = Array.from(document.querySelectorAll('iframe,frame'));

    const linksWithoutText = links
      .filter((el) => !textOf(el) && !el.getAttribute('aria-label') && !el.getAttribute('title'))
      .slice(0, 20)
      .map((el) => ({ href: hrefOf(el), outerHTML: el.outerHTML.slice(0, 300) }));

    const buttonsWithoutText = buttons
      .filter((el) => {
        const value = el.getAttribute('value') || '';
        return !textOf(el) && !value.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title');
      })
      .slice(0, 20)
      .map((el) => ({ outerHTML: el.outerHTML.slice(0, 300) }));

    const imagesMissingAlt = images
      .filter((img) => !img.hasAttribute('alt'))
      .slice(0, 20)
      .map((img) => ({ src: img.getAttribute('src') || '', outerHTML: img.outerHTML.slice(0, 300) }));

    const missingLabelInputs = inputs
      .filter((el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;

        const id = el.id;
        const hasAria = !!(
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          el.getAttribute('title')
        );
        const hasLabel = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;
        const wrappedByLabel = !!el.closest('label');

        return !(hasAria || hasLabel || wrappedByLabel);
      })
      .slice(0, 20)
      .map((el) => ({
        name: el.getAttribute('name') || '',
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        outerHTML: el.outerHTML.slice(0, 300),
      }));

    return {
      bodyPresent: !!document.body,
      titlePresent: !!document.title && document.title.trim().length > 0,
      headingCount: headings.length,
      firstHeading: headings.length ? textOf(headings[0]) : null,
      linkCount: links.length,
      buttonCount: buttons.length,
      inputCount: inputs.length,
      imageCount: images.length,
      formCount: forms.length,
      frameCount: iframes.length,
      hasMain: !!document.querySelector('main, [role="main"]'),
      hasHeader: !!document.querySelector('header, [role="banner"]'),
      hasFooter: !!document.querySelector('footer, [role="contentinfo"]'),
      hasNav: !!document.querySelector('nav, [role="navigation"]'),
      linksWithoutText,
      buttonsWithoutText,
      imagesMissingAlt,
      missingLabelInputs,
    };
  });

  const mapAxeRule = (v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl || null,
    tags: Array.isArray(v.tags) ? v.tags : [],
    wcag: Array.isArray(v.tags) ? v.tags.filter((tag) => /^wcag\d+[a-z]*$/i.test(tag)) : [],
    nodeCount: Array.isArray(v.nodes) ? v.nodes.length : 0,
    nodes: Array.isArray(v.nodes)
      ? v.nodes.map((node) => ({
        target: Array.isArray(node.target) ? node.target : [],
        html: node.html || '',
        impact: node.impact || v.impact || null,
        failureSummary: node.failureSummary || '',
        any: Array.isArray(node.any)
          ? node.any.map((check) => ({
            id: check.id,
            message: check.message,
            data: check.data || null,
          }))
          : [],
        all: Array.isArray(node.all)
          ? node.all.map((check) => ({
            id: check.id,
            message: check.message,
            data: check.data || null,
          }))
          : [],
        none: Array.isArray(node.none)
          ? node.none.map((check) => ({
            id: check.id,
            message: check.message,
            data: check.data || null,
          }))
          : [],
      }))
      : [],
  });

  const runAxe = async (label, builder) => {
    try {
      const results = await builder.analyze();
      return {
        label,
        violationCount: results.violations.length,
        violations: results.violations.map(mapAxeRule),
        incompleteCount: results.incomplete.length,
        incomplete: results.incomplete.map(mapAxeRule),
        passCount: Array.isArray(results.passes) ? results.passes.length : null,
        inapplicableCount: Array.isArray(results.inapplicable) ? results.inapplicable.length : null,
      };
    } catch (error) {
      return {
        label,
        violationCount: null,
        violations: [],
        incompleteCount: null,
        incomplete: [],
        error: error.message,
      };
    }
  };

  const broadAxe = await runAxe(
    'broad',
    new AxeBuilder({ page: this.page }).options({
      runOnly: {
        type: 'tag',
        values: [
          'wcag2aa',
          'wcag21aa',
          'wcag22aa',
          'wcag21aaa',
          'best-practice',
          'experimental',
          'cat.aria',
        ],
      },
      resultTypes: ['violations', 'incomplete'],
    })
  );

  const contrastAxe = await runAxe(
    'contrast',
    new AxeBuilder({ page: this.page })
      .withRules(['color-contrast', 'color-contrast-enhanced'])
      .options({
        resultTypes: ['violations', 'incomplete'],
      })
  );

  const combinedViolations = [...(broadAxe.violations || []), ...(contrastAxe.violations || [])];
  const dedupedViolations = dedupeAxeViolations(combinedViolations);

  const combinedIncomplete = [...(broadAxe.incomplete || []), ...(contrastAxe.incomplete || [])];
  const dedupedIncomplete = dedupeAxeViolations(combinedIncomplete);

  const axe = {
    violationCount: dedupedViolations.length,
    violations: dedupedViolations,
    incompleteCount: dedupedIncomplete.length,
    incomplete: dedupedIncomplete,
    passes: {
      broad: broadAxe.passCount ?? null,
      contrast: contrastAxe.passCount ?? null,
    },
    inapplicable: {
      broad: broadAxe.inapplicableCount ?? null,
      contrast: contrastAxe.inapplicableCount ?? null,
    },
    scans: {
      broad: broadAxe,
      contrast: contrastAxe,
    },
  };

  const findings = [];

  if (!response) {
    findings.push({
      severity: 'high',
      code: 'no-main-document-response',
      message: 'No main document HTTP response was captured.',
    });
  }

  if (response && response.status() >= 400) {
    findings.push({
      severity: 'high',
      code: 'http-error-status',
      message: `Main document returned HTTP ${response.status()}.`,
    });
  }

  if (!domStats.titlePresent) {
    findings.push({
      severity: 'medium',
      code: 'blank-title',
      message: 'The page title is blank.',
    });
  }

  if (this.pageErrors.length > 0) {
    findings.push({
      severity: 'high',
      code: 'page-errors',
      message: `${this.pageErrors.length} uncaught page error(s) detected.`,
    });
  }

  if (this.failedRequests.length > 0) {
    findings.push({
      severity: 'medium',
      code: 'failed-requests',
      message: `${this.failedRequests.length} network request(s) failed.`,
    });
  }

  if (this.consoleMessages.length > 0) {
    findings.push({
      severity: 'low',
      code: 'console-noise',
      message: `${this.consoleMessages.length} console warning/error message(s) captured.`,
    });
  }

  if (domStats.headingCount === 0) {
    findings.push({
      severity: 'medium',
      code: 'no-headings',
      message: 'No headings were found on the page.',
    });
  }

  if (domStats.linksWithoutText.length > 0) {
    findings.push({
      severity: 'medium',
      code: 'blank-links',
      message: `${domStats.linksWithoutText.length} link(s) appear to have no accessible text.`,
    });
  }

  if (domStats.buttonsWithoutText.length > 0) {
    findings.push({
      severity: 'medium',
      code: 'blank-buttons',
      message: `${domStats.buttonsWithoutText.length} button(s) appear to have no accessible text.`,
    });
  }

  if (domStats.imagesMissingAlt.length > 0) {
    findings.push({
      severity: 'medium',
      code: 'images-missing-alt',
      message: `${domStats.imagesMissingAlt.length} image(s) are missing an alt attribute.`,
    });
  }

  if (domStats.missingLabelInputs.length > 0) {
    findings.push({
      severity: 'medium',
      code: 'inputs-missing-label',
      message: `${domStats.missingLabelInputs.length} input control(s) appear to lack a visible or programmatic label.`,
    });
  }

  if (axe.violationCount > 0) {
    findings.push({
      severity: 'high',
      code: 'axe-violations',
      message: `${axe.violationCount} axe accessibility violation(s) detected.`,
      ruleIds: axe.violations.map((v) => v.id),
      wcag: [...new Set(axe.violations.flatMap((v) => v.wcag || []))],
    });
  }

  const summary = {
    httpStatus: response ? response.status() : null,
    finalUrl,
    title,
    bodyPresent: domStats.bodyPresent,
    titlePresent: domStats.titlePresent,
    headingCount: domStats.headingCount,
    linkCount: domStats.linkCount,
    buttonCount: domStats.buttonCount,
    inputCount: domStats.inputCount,
    imageCount: domStats.imageCount,
    formCount: domStats.formCount,
    frameCount: domStats.frameCount,
    firstHeading: domStats.firstHeading,
    pageErrorCount: this.pageErrors.length,
    consoleIssueCount: this.consoleMessages.length,
    failedRequestCount: this.failedRequests.length,
    axeViolationCount: axe.violationCount,
    axeIncompleteCount: axe.incompleteCount,
    manualReviewNeeded: axe.incompleteCount > 0,
    contrastViolationCount: (contrastAxe.violations || []).length,
    contrastIncompleteCount: (contrastAxe.incomplete || []).length,
  };

  this.report = {
    scenarioName: this.scenarioName,
    requestedUrl: url,
    finalUrl,
    startedAt: this.startedAt,
    endedAt: new Date().toISOString(),
    status: findings.some((f) => f.severity === 'high') ? 'failed' : 'passed',
    generatedBy: '@uuv/playwright + cucumber-js + playwright',
    summary,
    landmarks: {
      hasMain: domStats.hasMain,
      hasHeader: domStats.hasHeader,
      hasFooter: domStats.hasFooter,
      hasNav: domStats.hasNav,
    },
    findings,
    pageErrors: this.pageErrors,
    consoleMessages: this.consoleMessages,
    failedRequests: this.failedRequests,
    details: {
      linksWithoutText: domStats.linksWithoutText,
      buttonsWithoutText: domStats.buttonsWithoutText,
      imagesMissingAlt: domStats.imagesMissingAlt,
      missingLabelInputs: domStats.missingLabelInputs,
    },
    axe,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = path.join(REPORT_DIR, buildReportFileName(this.scenarioName) + '.json');
  fs.writeFileSync(outputPath, JSON.stringify(this.report, null, 2), 'utf8');
}

async function autoScrollWithRetry(page, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
      await autoScroll(page);
      return;
    } catch (err) {
      const message = String((err && err.message) || err);
      const isNavigationError =
        message.includes('Execution context was destroyed') ||
        message.includes('most likely because of a navigation') ||
        message.includes('Cannot find context with specified id');

      if (!isNavigationError || attempt === maxAttempts) {
        throw err;
      }

      await page.waitForTimeout(1000);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
    }
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      let ticks = 0;
      const maxTicks = 50;
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));

      const timer = setInterval(() => {
        ticks += 1;

        const body = document.body;
        const html = document.documentElement;

        const maxScroll = Math.max(
          body ? body.scrollHeight : 0,
          html ? html.scrollHeight : 0
        );

        window.scrollBy(0, step);
        total += step;

        if (total >= maxScroll + window.innerHeight || ticks >= maxTicks) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

function dedupeAxeViolations(items) {
  const seen = new Set();

  return (items || []).filter((item) => {
    const targets = (item.nodes || []).flatMap((n) => n.target || []).join('|');
    const key = `${item.id}::${targets}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// function buildReportFileName(input) {
//   const cleaned = String(input)
//     .replace(/^Full[\s-]*page[\s-]*check[\s-]*for[\s-]*/i, '')
//     .trim();

//   try {
//     const url = new URL(cleaned);
//     const host = url.hostname.replace(/[^a-zA-Z0-9]+/g, '-');
//     const parts = url.pathname.split('/').filter(Boolean);
//     const pathPart = parts.join('-').replace(/[^a-zA-Z0-9]+/g, '-');

//     const hashPart = (url.hash || '')
//       .replace(/^#/, '')
//       .replace(/[^a-zA-Z0-9]+/g, '-')
//       .replace(/^-+|-+$/g, '');

//     const combined = [host, pathPart, hashPart].filter(Boolean).join('-');
//     return combined.replace(/^-+|-+$/g, '') || 'report';
//   } catch {
//     return (
//       cleaned
//         .replace(/^https?:\/\//i, '')
//         .replace(/#/g, '-')
//         .replace(/[^a-zA-Z0-9]+/g, '-')
//         .replace(/^-+|-+$/g, '') || 'report'
//     );
//   }
// }

function buildReportFileName(input) {
  const cleaned = String(input)
    .replace(/^Full[\s-]*page[\s-]*check[\s-]*for[\s-]*/i, '')
    .trim();

  try {
    const url = new URL(cleaned);

    const queryPart = url.search
      ? url.search
          .replace(/^\?/, '')
          .replace(/=/g, '/')
          .replace(/&/g, '/')
      : '';

    const hashPart = url.hash
      ? url.hash.replace(/^#/, '')
      : '';

    const fullPath = [
      url.hostname,
      url.pathname,
      queryPart,
      hashPart,
    ]
      .filter(Boolean)
      .join('/');

    return (
      fullPath
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'report'
    );
  } catch {
    return (
      cleaned
        .replace(/^https?:\/\//i, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'report'
    );
  }
}

function normalizeStatus(status) {
  if (!status) return 'unknown';
  return String(status).toLowerCase();
}