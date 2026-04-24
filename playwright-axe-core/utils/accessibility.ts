import { AxeBuilder } from '@axe-core/playwright';
import { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export type AccessibilityCheckOptions = {
  testInfo?: TestInfo;
  includeSelectors?: string[];
  excludeSelectors?: string[];
  failOnImpacts?: Array<'minor' | 'moderate' | 'serious' | 'critical'>;
  outputDir?: string;
};

const DEFAULT_FAIL_IMPACTS: Array<'serious' | 'critical'> = ['serious', 'critical'];
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'ally-reports');

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_]/g, '-') // Added A-Z to the allowed characters
    .replace(/-+/g, '-')             // Collapse multiple dashes
    .replace(/^-+|-+$/g, '')         // Trim dashes from start/end
    || 'index';
}

function getPageReference(input: string): string {
  const { pathname } = new URL(input);

  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments.at(-1) || 'index';

  return sanitizeFileName(lastSegment);
}

export async function runAccessibilityCheck(
  page: Page,
  pageRefOrUrl: string,
  options: AccessibilityCheckOptions = {}
): Promise<void> {
  const {
    includeSelectors = [],
    excludeSelectors = [],
    failOnImpacts = DEFAULT_FAIL_IMPACTS,
    outputDir = DEFAULT_OUTPUT_DIR,
  } = options;

  ensureDir(outputDir);

  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);

  for (const selector of includeSelectors) {
    builder = builder.include(selector);
  }

  for (const selector of excludeSelectors) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const pageRef = getPageReference(pageRefOrUrl);

  const failingViolations = results.violations.filter((violation) =>
    violation.impact ? failOnImpacts.includes(violation.impact as any) : false
  );

  const payload = {
    meta: {
      pageRef,
      url: page.url(),
      scannedAt: new Date().toISOString(),
      title: await page.title(),
      testStatus: failingViolations.length > 0 ? 'failed' : 'passed',
      failOnImpacts,
    },
    counts: {
      violations: results.violations.length,
      incomplete: results.incomplete.length,
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
      failingViolations: failingViolations.length,
    },
    violations: results.violations,
    incomplete: results.incomplete,
  };

  const outputPath = path.join(outputDir, `${pageRef}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  if (failingViolations.length > 0) {
    const summary = failingViolations
      .map((v) => `${v.id} (${v.impact ?? 'unknown'})`)
      .join(', ');

    throw new Error(
      `Accessibility issues found on ${page.url()}: ${failingViolations.length} failing violation(s). ${summary}`
    );
  }
}

export async function closeAccessibilityChecker(): Promise<void> {
  // kept for compatibility with your existing test structure
}