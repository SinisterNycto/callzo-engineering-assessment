"""Background worker: retries pending events and periodically reconciles usage.

Run with `python -m app.worker`. Safe to run more than one copy: event pickup
uses SKIP LOCKED and reconciliation takes per-account locks.
"""

import logging
import signal
import threading
import time

from psycopg_pool import ConnectionPool

from app.config import Settings, load_settings
from app.db import create_pool, migrate
from app.ingest import process_with_bookkeeping
from app.logs import configure_logging
from app.reconcile import reconcile_all

log = logging.getLogger(__name__)

RETRY_BATCH_SIZE = 100


def retry_due_events(pool: ConnectionPool, settings: Settings) -> dict[str, int]:
    """Process every pending event whose retry time has come. Returns counts by outcome."""
    with pool.connection() as conn:
        due = conn.execute(
            """
            SELECT event_id FROM raw_events
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY next_attempt_at
            LIMIT %s
            """,
            (RETRY_BATCH_SIZE,),
        ).fetchall()

    counts: dict[str, int] = {}
    for row in due:
        outcome = process_with_bookkeeping(pool, row["event_id"], settings)
        counts[outcome] = counts.get(outcome, 0) + 1
    if counts:
        log.info("retry_batch_finished", extra={"fields": counts})
    return counts


def run_forever(settings: Settings, stop: threading.Event) -> None:
    pool = create_pool(settings.database_url)
    migrate(pool)
    log.info("worker_started")
    next_reconcile = 0.0
    try:
        while not stop.is_set():
            _run_safely("retry", retry_due_events, pool, settings)
            if time.monotonic() >= next_reconcile:
                _run_safely("reconcile", reconcile_all, pool, settings)
                next_reconcile = time.monotonic() + settings.reconcile_interval_seconds
            stop.wait(settings.retry_poll_seconds)
    finally:
        pool.close()
        log.info("worker_stopped")


def _run_safely(name: str, job, *args) -> None:
    # One bad iteration (DB restart, etc.) must not kill the worker loop.
    try:
        job(*args)
    except Exception:
        log.exception("worker_job_failed", extra={"fields": {"job": name}})


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    run_forever(settings, stop)


if __name__ == "__main__":
    main()
