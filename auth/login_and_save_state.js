const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function existsAndNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normaliseText(value) {
  return String(value || "").trim();
}

async function dismissCommonJunk(page) {
  const candidates = [
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button:has-text('OK')",
    "button:has-text('Got it')",
    "button:has-text('Allow all')",
    "button:has-text('Accept all')",
    "[aria-label='Close']",
    "[data-testid='close']"
  ];

  for (const selector of candidates) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ timeout: 1000 });
      }
    } catch {
      // ignore
    }
  }
}

async function detectLoginElements(page) {
  return await page.evaluate(() => {
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function selectorFor(el) {
      if (!el) return null;
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
      if (el.getAttribute("type")) {
        return `${el.tagName.toLowerCase()}[type="${CSS.escape(el.getAttribute("type"))}"]`;
      }
      return el.tagName.toLowerCase();
    }

    function scoreUsernameInput(el) {
      const attrs = [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("autocomplete"),
        el.getAttribute("aria-label"),
        el.getAttribute("type")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;

      if (!isVisible(el)) score -= 100;
      if (el.disabled) score -= 100;
      if (el.type === "hidden") score -= 100;
      if (el.type === "email") score += 80;
      if (el.type === "text") score += 30;
      if (attrs.includes("email")) score += 90;
      if (attrs.includes("user")) score += 70;
      if (attrs.includes("login")) score += 50;
      if (attrs.includes("identifier")) score += 40;
      if (attrs.includes("username")) score += 90;
      if (attrs.includes("search")) score -= 60;

      return score;
    }

    function scorePasswordInput(el) {
      const attrs = [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("autocomplete"),
        el.getAttribute("aria-label"),
        el.getAttribute("type")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;

      if (!isVisible(el)) score -= 100;
      if (el.disabled) score -= 100;
      if (el.type === "password") score += 200;
      if (attrs.includes("password")) score += 120;
      if (attrs.includes("current-password")) score += 50;

      return score;
    }

    function scoreSubmit(el) {
      const text = [
        el.textContent,
        el.getAttribute("value"),
        el.getAttribute("aria-label"),
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("title"),
        el.getAttribute("type")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;

      if (!isVisible(el)) score -= 100;
      if (el.disabled) score -= 100;
      if (el.tagName.toLowerCase() === "button") score += 40;
      if ((el.getAttribute("type") || "").toLowerCase() === "submit") score += 100;
      if (text.includes("sign in")) score += 120;
      if (text.includes("log in")) score += 120;
      if (text.includes("login")) score += 120;
      if (text.includes("continue")) score += 40;
      if (text.includes("next")) score += 20;
      if (text.includes("submit")) score += 30;
      if (text.includes("register")) score -= 80;
      if (text.includes("sign up")) score -= 80;

      return score;
    }

    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const buttons = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button']")
    );

    const passwordCandidates = inputs
      .map((el) => ({ el, score: scorePasswordInput(el) }))
      .sort((a, b) => b.score - a.score);

    const passwordEl = passwordCandidates[0]?.score > 0 ? passwordCandidates[0].el : null;

    let container = null;
    if (passwordEl) {
      container =
        passwordEl.closest("form") ||
        passwordEl.closest("[role='form']") ||
        passwordEl.parentElement;
    }

    const usernamePool = container
      ? Array.from(container.querySelectorAll("input, textarea"))
      : inputs;

    const usernameCandidates = usernamePool
      .filter((el) => el !== passwordEl)
      .map((el) => ({ el, score: scoreUsernameInput(el) }))
      .sort((a, b) => b.score - a.score);

    const usernameEl = usernameCandidates[0]?.score > 0 ? usernameCandidates[0].el : null;

    const submitPool = container
      ? Array.from(container.querySelectorAll("button, input[type='submit'], input[type='button']"))
      : buttons;

    const submitCandidates = submitPool
      .map((el) => ({ el, score: scoreSubmit(el) }))
      .sort((a, b) => b.score - a.score);

    const submitEl = submitCandidates[0]?.score > 0 ? submitCandidates[0].el : null;

    return {
      username_selector: selectorFor(usernameEl),
      password_selector: selectorFor(passwordEl),
      submit_selector: selectorFor(submitEl)
    };
  });
}

async function waitForLoginSuccess(page, config) {
  const timeout = 30000;

  if (existsAndNonEmpty(config.success_selector)) {
    await page.locator(config.success_selector).first().waitFor({ state: "visible", timeout });
    return;
  }

  if (existsAndNonEmpty(config.success_url_contains)) {
    await page.waitForURL(
      (url) => url.toString().includes(config.success_url_contains),
      { timeout }
    );
    return;
  }

  await page.waitForTimeout(Number(config.post_login_wait_ms || 3000));
}

async function main() {
  const repoDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const authDir = path.join(repoDir, "auth");
  const configPath = path.join(authDir, "login_config.json");
  const storageStatePath = path.join(authDir, "storage_state.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Login config not found: ${configPath}`);
  }

  const config = readJson(configPath);

  if (!existsAndNonEmpty(config.login_url)) {
    throw new Error("login_url is required in auth/login_config.json");
  }
  if (!existsAndNonEmpty(config.username)) {
    throw new Error("username is required in auth/login_config.json");
  }
  if (!existsAndNonEmpty(config.password)) {
    throw new Error("password is required in auth/login_config.json");
  }

  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-features=PasswordLeakDetection,PasswordCheck,AutofillServerCommunication",
      "--disable-save-password-bubble"
    ]
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  try {
    await page.goto(config.login_url, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await page.waitForTimeout(Number(config.pre_login_wait_ms || 1500));
    await dismissCommonJunk(page);

    let usernameSelector = normaliseText(config.username_selector);
    let passwordSelector = normaliseText(config.password_selector);
    let submitSelector = normaliseText(config.submit_selector);

    if (!usernameSelector || !passwordSelector || !submitSelector) {
      const detected = await detectLoginElements(page);

      if (!usernameSelector) usernameSelector = detected.username_selector || "";
      if (!passwordSelector) passwordSelector = detected.password_selector || "";
      if (!submitSelector) submitSelector = detected.submit_selector || "";
    }

    if (!usernameSelector) {
      throw new Error("Could not determine username/email field selector");
    }
    if (!passwordSelector) {
      throw new Error("Could not determine password field selector");
    }
    if (!submitSelector) {
      throw new Error("Could not determine submit button selector");
    }

    console.log("Using selectors:");
    console.log(`  username: ${usernameSelector}`);
    console.log(`  password: ${passwordSelector}`);
    console.log(`  submit:   ${submitSelector}`);

    await page.locator(usernameSelector).first().fill(config.username);
    await page.locator(passwordSelector).first().fill(config.password);

    await Promise.all([
      page.locator(submitSelector).first().click(),
      page.waitForLoadState("domcontentloaded").catch(() => {})
    ]);

    await waitForLoginSuccess(page, config);
    await page.waitForTimeout(Number(config.post_login_wait_ms || 3000));

    await context.storageState({ path: storageStatePath });
    console.log(`Saved storage state: ${storageStatePath}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});