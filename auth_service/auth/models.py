from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

AuthMode = Literal["auto", "guided", "manual"]

@dataclass
class Credentials:
    username: str
    password: str

@dataclass
class SelectorHints:
    login_trigger: str | None = None
    username: str | None = None
    password: str | None = None
    submit: str | None = None
    success: str | None = None
    logged_in_text: str | None = None

@dataclass
class JobConfig:
    login_entry_url: str
    target_urls: list[str]
    credentials: Credentials
    auth_mode: AuthMode = "auto"
    selectors: SelectorHints = field(default_factory=SelectorHints)
    headless: bool = True
    timeout_ms: int = 20000

@dataclass
class AuthResult:
    success: bool
    method: str
    final_url: str | None
    storage_state_path: Path | None
    screenshot_path: Path | None
    log_path: Path | None
    message: str
