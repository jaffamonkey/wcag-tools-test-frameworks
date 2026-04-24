// login.js

async function ensureLoggedIn(page) {
  const password = page.locator("#password");
  const onLoginPage = (await password.count()) > 0;

  if (onLoginPage) {
    await login(page);
  }
}

async function loginwithurl(page, opts = {}) {
  const username = opts.username ?? process.env.TEST_USERNAME ?? "student";
  const password = opts.password ?? process.env.TEST_PASSWORD ?? "Password123";
  const login_url = opts.test_url ?? process.env.TEST_URL ?? "https://practicetestautomation.com/practice-test-login/";
  await page.goto(login_url);
  await page.waitForSelector("#username", { state: "visible", timeout: 30_000 });
  
  const usernameSelector = opts.usernameSelector ?? "#username";
  const passwordSelector = opts.passwordSelector ?? "#password";
  const buttonSelector = opts.buttonSelector ?? "#submit";
  const postLoginWaitMs = opts.postLoginWaitMs ?? 5000;

  await page.locator(usernameSelector).fill(username);
  await page.locator(passwordSelector).fill(password);
  await page.locator(buttonSelector).click();
  await page.waitForTimeout(postLoginWaitMs);
}

async function login(page, opts = {}) {
  const username = opts.username ?? "user_email";
  const password = opts.password ?? "user_password";
  const usernameSelector = opts.usernameSelector ?? "#usernameInput";
  const passwordSelector = opts.passwordSelector ?? "#passwordInput";
  const buttonSelector = opts.buttonSelector ?? "#submitButton";
  const postLoginWaitMs = opts.postLoginWaitMs ?? 5000;

  await page.locator(usernameSelector).fill(username);
  await page.locator(passwordSelector).fill(password);
  await page.locator(buttonSelector).click();
  await page.waitForTimeout(postLoginWaitMs);
}

// CommonJS Exports
module.exports = {
  ensureLoggedIn,
  loginwithurl,
  login
};
