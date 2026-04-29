const fs = require("fs");
const path = require("path");

function safeSlug(input) {
  return String(input || "")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureJob(jobDir, toolDir) {
  const urlsPath = path.join(jobDir, "input", "urls.txt");
  const storageStatePath = path.join(jobDir, "auth", "storage_state.json");
  const reportsDir = path.join(jobDir, "reports", toolDir);

  fs.mkdirSync(reportsDir, { recursive: true });

  if (!fs.existsSync(urlsPath)) {
    throw new Error(`urls.txt not found: ${urlsPath}`);
  }

  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`storage_state.json not found: ${storageStatePath}`);
  }

  const urls = fs
    .readFileSync(urlsPath, "utf-8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  return { urls, storageStatePath, reportsDir };
}

module.exports = { safeSlug, ensureJob };