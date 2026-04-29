from __future__ import annotations
from typing import Iterable
from playwright.sync_api import Page, Locator

LOGIN_TRIGGER_SELECTORS = [
    "a:has-text('Login')", "a:has-text('Log in')", "a:has-text('Sign in')",
    "button:has-text('Login')", "button:has-text('Log in')", "button:has-text('Sign in')",
    "a[href*='login']", "a[href*='signin']", "a[href*='sign-in']",
    # --- New Additions ---
    "a:has-text('Sign up')", "button:has-text('Sign up')", # Often leads to a toggleable login form
    "a[href*='account']", "a[href*='auth']",
    "button[aria-label*='log in' i]", "a[aria-label*='log in' i]",
    "button[data-testid*='login' i]", ".login-button", "#login-button"
]

USERNAME_SELECTORS = [
    "input[type='email']",
    "input[name='email']",
    "input[id*='email']",
    "input[name*='user']",
    "input[id*='user']",
    "input[name*='login']",
    "input[id*='login']",
    "input[placeholder*='user' i]",
    "input[placeholder*='email' i]",
    "input[type='text']",
    # --- New Additions ---
    "input[autocomplete='username']",
    "input[autocomplete='email']",
    "input[name='auth-user']",
    "input[data-testid*='user' i]",
    "input[aria-label*='user' i]",
    "input[aria-label*='email' i]",
    "input[id*='username' i]",
    "input[name*='username' i]"
]

PASSWORD_SELECTORS = [
    "input[type='password']",
    "input[name*='pass']",
    "input[id*='pass']",
    "input[placeholder*='pass' i]",
    # --- New Additions ---
    "input[autocomplete='current-password']",
    "input[autocomplete='new-password']",
    "input[data-testid*='password' i]",
    "input[aria-label*='password' i]",
    "input[id*='password' i]",
    "input[name*='password' i]"
]

SUBMIT_SELECTORS = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Submit')",
    "input[value='Submit']",
    "button:has-text('Login')",
    "button:has-text('Log in')",
    "button:has-text('Sign in')",
    "button:has-text('Continue')",
    "#submit",
    # --- New Additions ---
    "button:has-text('Next')", # Common in multi-step (Google/MS style)
    "button:has-text('Log In')", # Case variation
    "button:has-text('Sign In')", # Case variation
    "[role='button']:has-text('Login')", # Divs styled as buttons
    "form button:not([type='button'])", # Default button behavior in forms
    "input[type='button'][value*='Login' i]"
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
