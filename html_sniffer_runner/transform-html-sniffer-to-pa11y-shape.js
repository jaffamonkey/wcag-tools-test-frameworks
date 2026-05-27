#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [
  reportsFolder,
  baseUrl = '',
  documentTitle = '',
] = process.argv.slice(2);

if (!reportsFolder) {
  console.error(`
Usage:
  node transform-html-sniffer-to-pa11y-shape.js <reports-folder> [baseUrl] [documentTitle]
`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function mapType(htmlcsType) {
  const normalised = String(htmlcsType || '').toUpperCase();

  if (normalised === 'ERROR') {
    return { type: 'error', typeCode: 1 };
  }
  if (normalised === 'WARNING') {
    return { type: 'warning', typeCode: 2 };
  }
  if (normalised === 'NOTICE') {
    return { type: 'notice', typeCode: 3 };
  }

  return { type: 'warning', typeCode: 2 };
}

function inferImpact(type) {
  if (type === 'error') return 'serious';
  if (type === 'warning') return 'moderate';
  return 'minor';
}

// function inferCode(rule, message) {
//   const text = `${rule} ${message}`.toLowerCase();

//   if (text.includes('contrast')) return 'color-contrast';
//   if (text.includes('heading') || text.includes('h1')) return 'page-has-heading-one';
//   if (text.includes('new window') || text.includes('target="_blank"')) return 'link-opens-new-window';

//   const parts = String(rule || '').split('.');
//   return parts[parts.length - 1] || 'htmlcs-issue';
// }

function inferCode(rule) {
  return String(rule || '').trim() || 'htmlcs-issue';
}

function inferFriendlyCode(rule, message) {
  const text = `${rule} ${message}`.toLowerCase();

  if (text.includes('contrast')) return 'color-contrast';
  if (text.includes('heading') || text.includes('h1')) return 'page-has-heading-one';
  if (text.includes('new window') || text.includes('target="_blank"')) return 'link-opens-new-window';

  return '';
}

function inferHelp(code, message) {
  if (code === 'color-contrast') {
    return 'Elements must meet minimum color contrast ratio thresholds';
  }
  if (code === 'page-has-heading-one') {
    return 'Page should contain a level-one heading';
  }
  if (code === 'link-opens-new-window') {
    return 'Links that open in a new window should indicate this in their link text or accessible name';
  }
  return message || 'HTML_CodeSniffer accessibility issue';
}

function inferDescription(code, message) {
  if (code === 'color-contrast') {
    return 'Ensure the contrast between foreground and background colors meets WCAG contrast thresholds';
  }
  if (code === 'page-has-heading-one') {
    return 'Ensure that heading structure is logical and the page has an appropriate level-one heading';
  }
  if (code === 'link-opens-new-window') {
    return 'Ensure users are warned when links open a new window or tab';
  }
  return message || 'HTML_CodeSniffer accessibility check';
}

function inferWcag(rule) {
  const wcag = [];
  const raw = String(rule || '');

  if (raw.includes('1_3_1')) wcag.push('WCAG 1.3.1');
  if (raw.includes('1_4_3')) wcag.push('WCAG 1.4.3 AA');
  if (raw.includes('1_4_6')) wcag.push('WCAG 1.4.6 AAA');
  if (raw.includes('2_4_4')) wcag.push('WCAG 2.4.4');
  if (raw.includes('2_4_9')) wcag.push('WCAG 2.4.9 AAA');
  if (raw.includes('3_2_5')) wcag.push('WCAG 3.2.5 AAA');

  return [...new Set(wcag)];
}

function filenameToPageUrl(filename, baseUrl) {
  if (!baseUrl) return '';

  const nameWithoutExt = path.basename(filename, '.json');
  const pathPart = nameWithoutExt.replace(/^index$/i, '').replace(/_/g, '-');
  const cleanBase = baseUrl.replace(/\/+$/, '');

  if (!pathPart) return `${cleanBase}/`;
  return `${cleanBase}/${pathPart}/`;
}

function isAlreadyNormalised(input) {
  return (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Array.isArray(input.issues) &&
    input.issues.some((issue) => issue && issue.runner === 'htmlcs')
  );
}

function parseHtmlSnifferLog(logLine) {
  const rawLog = String(logLine || '');
  const cleaned = rawLog.replace(/^\[HTMLCS\]\s*/, '');
  const parts = cleaned.split('|');
  
  const htmlcsType = parts[0] || '';
  const rule = parts[1] || '';
  const selector = parts[2] || '';
  const subSelector = parts[3] || '';
  const message = parts[4] || '';
  const context = parts.slice(5).join('|') || '';

  const mappedType = mapType(htmlcsType);

  const code = inferCode(rule);
  const friendlyCode = inferFriendlyCode(rule, message);

  return {
    code,
    type: mappedType.type,
    typeCode: mappedType.typeCode,
    message,
    context,
    selector: subSelector || selector || '',
    runner: 'htmlcs',
    runnerExtras: {
      description: inferDescription(code, message),
      impact: inferImpact(mappedType.type),
      needsFurtherReview: mappedType.type !== 'error',
      help: inferHelp(code, message),
      helpUrl: '',
      friendlyCode,
      originalRule: rule,
      originalRunner: 'html-sniffer',
      originalType: htmlcsType,
      wcag: inferWcag(rule),
      rawLog,
    },
  };
}

function normaliseInput(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.logs)) return input.logs;
  if (Array.isArray(input.results)) return input.results;
  if (Array.isArray(input.issues)) return input.issues;
  throw new Error('Input JSON must be an array, or contain logs/results/issues array.');
}

function transform(input, filename) {
  if (isAlreadyNormalised(input)) {
    return input;
  }

  const rows = normaliseInput(input);

  const issues = rows
    .map((row) => {
      if (typeof row === 'string') {
        return parseHtmlSnifferLog(row);
      }
      if (row && typeof row.log === 'string') {
        return parseHtmlSnifferLog(row.log);
      }
      return null;
    })
    .filter(Boolean);

  const inferredPageUrl =
    input.pageUrl ||
    input.url ||
    input.page ||
    filenameToPageUrl(filename, baseUrl);

  const inferredDocumentTitle =
    input.documentTitle ||
    input.title ||
    documentTitle;

  return {
    documentTitle: inferredDocumentTitle,
    pageUrl: inferredPageUrl,
    issues,
  };
}

function getJsonFiles(folderPath) {
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    .filter((entry) => entry.name.toLowerCase() !== 'manifest.json')
    .filter((entry) => !entry.name.toLowerCase().endsWith('-error.json'))
    .map((entry) => entry.name);
}

function main() {
  const folderPath = path.resolve(reportsFolder);

  if (!fs.existsSync(folderPath)) {
    throw new Error(`Reports folder does not exist: ${folderPath}`);
  }

  const jsonFiles = getJsonFiles(folderPath);

  if (jsonFiles.length === 0) {
    console.log(`No JSON files found in: ${folderPath}`);
    return;
  }

  let transformedCount = 0;
  let skippedCount = 0;
  let unchangedCount = 0;

  for (const filename of jsonFiles) {
    const filePath = path.join(folderPath, filename);

    try {
      const input = readJson(filePath);

      if (isAlreadyNormalised(input)) {
        unchangedCount += 1;
        console.log(`- Already normalised: ${filename}`);
        continue;
      }

      const transformed = transform(input, filename);
      writeJson(filePath, transformed);

      transformedCount += 1;
      console.log(`✓ Overwrote ${filename} (${transformed.issues.length} issue(s))`);
    } catch (error) {
      skippedCount += 1;
      console.warn(`✗ Skipped ${filename}: ${error.message}`);
    }
  }

  console.log('');
  console.log('Done.');
  console.log(`Transformed: ${transformedCount}`);
  console.log(`Already normalised: ${unchangedCount}`);
  console.log(`Skipped: ${skippedCount}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}