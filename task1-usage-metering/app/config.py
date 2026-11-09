"""Runtime configuration, read once from environment variables.

Secrets (webhook secret, API keys, DB password) have no defaults here on
purpose: if they are missing the process refuses to start instead of running
with a value that lives in the codebase.
"""

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    pass


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"environment variable {name} is required")
    return value


def _int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}, got {value}")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    webhook_secret: bytes
    api_keys: tuple[str, ...]
    default_monthly_cap_cents: int
    period_grace_days: int
    retry_max_attempts: int
    retry_poll_seconds: int
    reconcile_interval_seconds: int
    log_level: str


def load_settings() -> Settings:
    api_keys = tuple(k.strip() for k in _required("API_KEYS").split(",") if k.strip())
    if not api_keys:
        raise ConfigError("API_KEYS must contain at least one key")

    return Settings(
        database_url=_required("DATABASE_URL"),
        webhook_secret=_required("WEBHOOK_SECRET").encode(),
        api_keys=api_keys,
        default_monthly_cap_cents=_int("DEFAULT_MONTHLY_CAP_CENTS", 500),
        period_grace_days=_int("PERIOD_GRACE_DAYS", 3),
        retry_max_attempts=_int("RETRY_MAX_ATTEMPTS", 8, minimum=1),
        retry_poll_seconds=_int("RETRY_POLL_SECONDS", 5, minimum=1),
        reconcile_interval_seconds=_int("RECONCILE_INTERVAL_SECONDS", 300, minimum=10),
        log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    )
