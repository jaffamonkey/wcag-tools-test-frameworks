const { virtual } = require("@guidepup/virtual-screen-reader");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const zlib = require("zlib");

const cwd = process.cwd();
const urlsPath = path.join(__dirname, "urls.json");
const resultsDir = path.join(cwd, "results");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFileName(name) {
  return String(name).trim().replace(/[^a-z0-9_-]+/gi, "_");
}

function stripScripts(html) {
  // Prevent jsdom from executing site scripts (e.g., jQuery-dependent inline scripts).
  return String(html).replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
}

function getText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; ScreenReaderTestBot/1.0; +https://example.invalid)",
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "gzip,deflate",
        },
      },
      (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            res.resume();
            return reject(new Error(`Too many redirects for ${url}`));
          }
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(getText(next, redirectsLeft - 1));
        }

        // Decompress if needed
        let stream = res;
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

        let data = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => (data += chunk));
        stream.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            return reject(
              new Error(`HTTP ${status} for ${url}. Body: ${data.slice(0, 300)}`)
            );
          }
          resolve(data);
        });
      }
    );

    req.setTimeout(30_000, () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
  });
}

async function loadHtml(url) {
  return await getText(url);
}

describe("Screen Reader Tests", () => {
  test(
    "should traverse the page announcing the expected roles and content",
    async () => {
      ensureDir(resultsDir);

      const jsonString = fs.readFileSync(urlsPath, "utf-8");
      const urllist = JSON.parse(jsonString);

      for (const entry of urllist) {
        const url = entry?.url;
        const pagename = entry?.pagename;
        if (!url || !pagename) continue;

        const html = await loadHtml(url);
        const safeHtml = stripScripts(html);

        // Reset DOM cleanly
        document.open();
        document.write(safeHtml);
        document.close();

        await virtual.start({ container: document.body });

        try {
          const spokenPhraseLog = await virtual.spokenPhraseLog();

          // Avoid infinite loops
          const maxNext = 2000;
          for (let step = 0; step < maxNext; step++) {
            const last = await virtual.lastSpokenPhrase();
            if (last === "end of document") break;
            await virtual.next();
          }

          const spokenPhraseLogClean = spokenPhraseLog
            .filter(Boolean)
            .filter((phrase) => !String(phrase).includes("document"));

          const safeName = sanitizeFileName(pagename);
          const outPath = path.join(resultsDir, `${safeName}.json`);
          fs.writeFileSync(
            outPath,
            JSON.stringify(spokenPhraseLogClean, null, 2),
            "utf-8"
          );
        } finally {
          await virtual.stop();
          document.body.innerHTML = "";
        }
      }
    },
    180_000
  );
});
