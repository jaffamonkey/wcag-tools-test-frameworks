from __future__ import annotations
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, Page
from auth.heuristics import detect_login_form, detect_login_trigger
from auth.models import AuthResult, JobConfig
from auth.site_hints import KNOWN_SITE_HINTS

def _write_log(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")

def _hint_for_domain(url: str):
    host = urlparse(url).hostname or ""
    for hint in KNOWN_SITE_HINTS:
        if host.endswith(hint.domain):
            return hint
    return None

def _is_successful(page: Page, config: JobConfig) -> bool:
    if config.selectors.success:
        try:
            return page.locator(config.selectors.success).first.is_visible(timeout=1500)
        except Exception:
            return False
    try:
        password_field = page.locator("input[type='password']").first
        return not password_field.is_visible(timeout=750)
    except Exception:
        return True

def run_shared_login(config: JobConfig, job_dir: Path) -> AuthResult:
    auth_dir = job_dir / "auth"
    auth_dir.mkdir(parents=True, exist_ok=True)
    storage_state_path = auth_dir / "storage_state.json"
    screenshot_path = auth_dir / "login-result.png"
    log_path = auth_dir / "login.log"
    log_lines: list[str] = []
    hint = _hint_for_domain(config.login_entry_url)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=config.headless)
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(config.timeout_ms)
        try:
            page.goto(config.login_entry_url, wait_until="domcontentloaded")
            username_selector = config.selectors.username or getattr(hint, "username", None)
            password_selector = config.selectors.password or getattr(hint, "password", None)
            submit_selector = config.selectors.submit or getattr(hint, "submit", None)
            trigger_selector = config.selectors.login_trigger or getattr(hint, "login_trigger", None)
            method = "direct_form"
            if trigger_selector:
                trigger = page.locator(trigger_selector).first
                if trigger.is_visible(timeout=1500):
                    trigger.click()
                    page.wait_for_timeout(1000)
                    method = "login_trigger_override"
            if not username_selector or not password_selector or not submit_selector:
                username, password, submit = detect_login_form(page)
                if not (username and password and submit):
                    trigger = detect_login_trigger(page)
                    if trigger:
                        trigger.click()
                        page.wait_for_timeout(1000)
                        method = "login_link_or_modal"
                    username, password, submit = detect_login_form(page)
                    if not (username and password and submit):
                        raise RuntimeError("Could not detect login form fields or submit button")
                    username_selector = password_selector = submit_selector = None
            if username_selector and password_selector and submit_selector:
                username_input = page.locator(username_selector).first
                password_input = page.locator(password_selector).first
                submit_button = page.locator(submit_selector).first
            else:
                username_input, password_input, submit_button = detect_login_form(page)
            username_input.fill(config.credentials.username)
            password_input.fill(config.credentials.password)
            submit_button.click()
            page.wait_for_load_state("networkidle")
            if not _is_successful(page, config):
                raise RuntimeError("Login submitted but success could not be verified")
            context.storage_state(path=str(storage_state_path))
            page.screenshot(path=str(screenshot_path), full_page=True)
            _write_log(log_path, log_lines + [f"Saved storage state: {storage_state_path}"])
            return AuthResult(True, method, page.url, storage_state_path, screenshot_path, log_path, "Login successful")
        except Exception as exc:
            try:
                page.screenshot(path=str(screenshot_path), full_page=True)
            except Exception:
                pass
            _write_log(log_path, log_lines + [f"ERROR: {exc}"])
            return AuthResult(False, "failed", page.url, None, screenshot_path if screenshot_path.exists() else None, log_path, str(exc))
        finally:
            context.close()
            browser.close()
