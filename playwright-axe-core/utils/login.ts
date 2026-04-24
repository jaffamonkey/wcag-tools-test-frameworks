// login.ts
import { Page, expect } from "@playwright/test";

export type LoginOptions = {
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  buttonSelector?: string;
  postLoginWaitMs?: number;
};

export async function ensureLoggedIn(page: Page): Promise<void> {
  const password = page.locator("#password");
  const onLoginPage = (await password.count()) > 0;

  if (onLoginPage) {
    await login(page);
  }
}

export async function loginwithurl(
  page: Page,
  opts: LoginOptions = {}
): Promise<void> {

  const username = opts.username ?? process.env.TEST_USERNAME ?? "student";
  const password = opts.password ?? process.env.TEST_PASSWORD ?? "Password123";
  const login_url = opts.password ?? process.env.TEST_URL ?? "https://practicetestautomation.com/practice-test-login/";

  await page.goto(login_url);
  await page.waitForSelector("#username", { state: "visible", timeout: 10_000 });
  const usernameSelector = opts.usernameSelector ?? "#username";
  const passwordSelector = opts.passwordSelector ?? "#password";
  const buttonSelector = opts.buttonSelector ?? "[type=submit]";
  const postLoginWaitMs = opts.postLoginWaitMs ?? 3000;

  await page.locator(usernameSelector).fill(username);
  await page.locator(passwordSelector).fill(password);
  await page.locator(buttonSelector).click();
  await page.waitForTimeout(postLoginWaitMs);
}

export async function login(
  page: Page,
  opts: LoginOptions = {}
): Promise<void> {
  const username = opts.username ?? process.env.TEST_USERNAME ?? "student";
  const password = opts.password ?? process.env.TEST_PASSWORD ?? "Password123";
  const usernameSelector = opts.usernameSelector ?? "#username";
  const passwordSelector = opts.passwordSelector ?? "#password";
  const buttonSelector = opts.buttonSelector ?? "#submit";
  const postLoginWaitMs = opts.postLoginWaitMs ?? 3000;

  await page.locator(usernameSelector).fill(username);
  await page.locator(passwordSelector).fill(password);
  await page.locator(buttonSelector).click();
  await page.waitForTimeout(postLoginWaitMs);
}
