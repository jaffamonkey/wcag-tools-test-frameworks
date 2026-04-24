from __future__ import annotations
from typing import Iterable
from playwright.sync_api import Page, Locator

LOGIN_TRIGGER_SELECTORS = [
    "a:has-text('Login')","a:has-text('Log in')","a:has-text('Sign in')",
    "button:has-text('Login')","button:has-text('Log in')","button:has-text('Sign in')",
    "a[href*='login']","a[href*='signin']","a[href*='sign-in']",
]
USERNAME_SELECTORS = [
    "input[type='email']","input[name='email']","input[id*='email']",
    "input[name*='user']","input[id*='user']","input[name*='login']",
    "input[id*='login']","input[type='text']",
]
PASSWORD_SELECTORS = ["input[type='password']","input[name*='pass']","input[id*='pass']"]
SUBMIT_SELECTORS = [
    "button[type='submit']","input[type='submit']",
    "button:has-text('Login')","button:has-text('Log in')","button:has-text('Sign in')","button:has-text('Continue')",
]

def first_visible(page: Page, selectors: Iterable[str]) -> Locator | None:
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=500):
                return locator
        except Exception:
            continue
    return None

def detect_login_form(page: Page):
    return first_visible(page, USERNAME_SELECTORS), first_visible(page, PASSWORD_SELECTORS), first_visible(page, SUBMIT_SELECTORS)

def detect_login_trigger(page: Page):
    return first_visible(page, LOGIN_TRIGGER_SELECTORS)
