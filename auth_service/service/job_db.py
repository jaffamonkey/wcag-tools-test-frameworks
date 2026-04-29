from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "jobs.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                public_slug TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL,
                job_config_path TEXT,
                login_url TEXT,
                urls_json TEXT NOT NULL,
                tools_json TEXT NOT NULL,
                dashboard_url TEXT,
                workbook_url TEXT,
                summary_path TEXT,
                error_message TEXT
            )
            """
        )
        conn.commit()


def create_job(record: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, public_slug, created_at, updated_at, status,
                job_config_path, login_url, urls_json, tools_json,
                dashboard_url, workbook_url, summary_path, error_message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["public_slug"],
                record["created_at"],
                record["updated_at"],
                record["status"],
                record.get("job_config_path"),
                record.get("login_url"),
                json.dumps(record.get("urls", [])),
                json.dumps(record.get("tools", [])),
                record.get("dashboard_url"),
                record.get("workbook_url"),
                record.get("summary_path"),
                record.get("error_message"),
            ),
        )
        conn.commit()


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    columns = ", ".join(f"{k} = ?" for k in fields.keys())
    values = list(fields.values()) + [job_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE jobs SET {columns} WHERE id = ?", values)
        conn.commit()

def list_jobs(limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM jobs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

def get_job(job_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None


def get_job_by_slug(slug: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE public_slug = ?", (slug,)).fetchone()
        return dict(row) if row else None