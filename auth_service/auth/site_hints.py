from __future__ import annotations
from dataclasses import dataclass

@dataclass
class SiteHint:
    domain: str
    login_trigger: str | None = None
    username: str | None = None
    password: str | None = None
    submit: str | None = None
    success: str | None = None

KNOWN_SITE_HINTS: list[SiteHint] = []
