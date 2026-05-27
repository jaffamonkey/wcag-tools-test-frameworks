const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function safeSlug(input) {
  return String(input || "")
    .replace(/^https?:\/\//i, "")
    .replace(/#/, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function readUrls(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendLog(filePath, text) {
  fs.appendFileSync(filePath, text, "utf8");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getTopLevelMeta(reportJson, fallbackUrl) {
  if (Array.isArray(reportJson) && reportJson[0]) {
    return {
      url: reportJson[0].url || fallbackUrl,
      title: reportJson[0].title || fallbackUrl,
    };
  }

  return {
    url: reportJson?.url || fallbackUrl,
    title: reportJson?.title || fallbackUrl,
  };
}

function resolveContrastBinary() {
  const localBin = path.resolve(__dirname, "node_modules/.bin/contrastcheck");
  if (fs.existsSync(localBin)) return localBin;
  return "contrastcheck";
}

function buildToolCommand({ url, outputPath }) {
  return {
    command: resolveContrastBinary(),
    args: [
      url,
      "--json",
      "--output",
      outputPath,
      // Add real wait/timeout flags here if the CLI supports them.
      // Example only:
      // "--timeout", "120000",
      // "--wait", "3000",
    ],
  };
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

function tryParseJsonString(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const firstBracket = raw.indexOf("[");
    const firstBrace = raw.indexOf("{");

    let start = -1;
    if (firstBracket >= 0 && firstBrace >= 0) {
      start = Math.min(firstBracket, firstBrace);
    } else if (firstBracket >= 0) {
      start = firstBracket;
    } else if (firstBrace >= 0) {
      start = firstBrace;
    }

    if (start >= 0) {
      const sliced = raw.slice(start);
      try {
        return JSON.parse(sliced);
      } catch {
        return null;
      }
    }

    return null;
  }
}

(function main() {
  const jobDir = process.argv[2] || process.cwd();

  const resolvedJobDir = path.resolve(jobDir);
  const urlsFile = path.join(resolvedJobDir, "input", "urls.txt");
  const contrastDir = path.join(resolvedJobDir, "reports", "contrast-checker");
  const manifestPath = path.join(contrastDir, "manifest.json");

  const maxAttempts = Number(process.env.CONTRAST_RETRIES || 2);
  const retryDelayMs = Number(process.env.CONTRAST_RETRY_DELAY_MS || 3000);

  if (!fs.existsSync(urlsFile)) {
    throw new Error(`urls.txt not found: ${urlsFile}`);
  }

  ensureDir(contrastDir);

  const urls = readUrls(urlsFile);
  const manifest = [];

  for (const url of urls) {
    const slug = safeSlug(url);
    const jsonFile = `${slug}.json`;
    const jsonPath = path.join(contrastDir, jsonFile);
    const errorPath = path.join(contrastDir, `${slug}-error.json`);
    const logPath = path.join(contrastDir, `${slug}-runlog.txt`);

    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }

    if (fs.existsSync(errorPath)) {
      fs.unlinkSync(errorPath);
    }

    let success = false;
    let lastFailure = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        appendLog(logPath, `\n=== Attempt ${attempt} of ${maxAttempts} ===\n`);
        appendLog(logPath, `Started: ${new Date().toISOString()}\n`);
        appendLog(logPath, `URL: ${url}\n`);

        const toolCmd = buildToolCommand({
          url,
          outputPath: jsonPath,
        });

        appendLog(logPath, `Command: ${toolCmd.command} ${toolCmd.args.join(" ")}\n`);
        console.log(`Running contrast check: ${url} (attempt ${attempt}/${maxAttempts})`);

        const result = runCommand(toolCmd.command, toolCmd.args, resolvedJobDir);

        if (result.error) {
          throw result.error;
        }

        appendLog(logPath, `Exit code: ${result.status}\n`);
        appendLog(logPath, `\n--- STDOUT ---\n${result.stdout}\n`);
        appendLog(logPath, `\n--- STDERR ---\n${result.stderr}\n`);

        let reportJson = null;
        let sourceType = null;

        if (fs.existsSync(jsonPath)) {
          try {
            reportJson = readJson(jsonPath);
            sourceType = "file";
            appendLog(logPath, `Parsed JSON from file: ${jsonPath}\n`);
          } catch (error) {
            appendLog(logPath, `Failed to parse JSON file: ${error.message}\n`);
            reportJson = null;
          }
        }

        if (!reportJson) {
          const stdoutJson = tryParseJsonString(result.stdout);
          if (stdoutJson) {
            reportJson = stdoutJson;
            sourceType = "stdout";
            writeJson(jsonPath, reportJson);
            appendLog(logPath, `Parsed JSON from stdout and wrote file: ${jsonPath}\n`);
          } else {
            appendLog(logPath, "No usable JSON found in stdout\n");
          }
        }
        if (!reportJson) {
          lastFailure = {
            tool: "contrast-checker",
            url,
            error: "No usable JSON report found in output file or stdout",
            exit_code: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            attempt,
            scanned_at: new Date().toISOString(),
          };

          appendLog(logPath, `Attempt ${attempt} failed: no usable JSON\n`);

          if (attempt < maxAttempts) {
            appendLog(logPath, `Retrying after ${retryDelayMs}ms\n`);
            sleep(retryDelayMs);
            continue;
          }

          writeJson(errorPath, lastFailure);
          console.error(`Contrast failed for ${url}: no usable JSON report`);
          break;
        }

        const meta = getTopLevelMeta(reportJson, url);

        manifest.push({
          page: slug,
          title: meta.title || slug,
          url: meta.url || url,
          file: jsonFile,
          status: result.status === 0 ? "ok" : "partial",
          source: sourceType,
        });

        appendLog(
          logPath,
          `Success: saved ${jsonPath} (${sourceType}${result.status !== 0 ? ", non-zero exit" : ""})\n`
        );

        console.log(
          `Saved contrast JSON: ${jsonPath} (${sourceType}${result.status !== 0 ? ", non-zero exit" : ""})`
        );

        success = true;
        break;
      } catch (error) {
        lastFailure = {
          tool: "contrast-checker",
          url,
          error: error.message,
          attempt,
          scanned_at: new Date().toISOString(),
        };

        appendLog(logPath, `Attempt ${attempt} threw error: ${error.message}\n`);

        if (attempt < maxAttempts) {
          appendLog(logPath, `Retrying after ${retryDelayMs}ms\n`);
          sleep(retryDelayMs);
          continue;
        }

        writeJson(errorPath, lastFailure);
        console.error(`Contrast failed for ${url}: ${error.message}`);
      }
    }

    if (!success && lastFailure && !fs.existsSync(errorPath)) {
      writeJson(errorPath, lastFailure);
    }
  }

  writeJson(manifestPath, manifest);
  console.log(`Saved manifest: ${manifestPath}`);
})();