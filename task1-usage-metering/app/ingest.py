"""Storing webhook events and folding them into calls and monthly usage.

Write path for one event:
  1. store_event:   INSERT into raw_events in its own transaction. After this
                    commits we own the event; the provider can stop retrying.
  2. process_event: in a second transaction, lock the account, apply the event
                    to its call, recompute the affected month, and mark the
                    event processed.
If step 2 fails, the event stays 'pending' and the retry worker picks it up.

Every write for an account happens while holding that account's row lock
(SELECT ... FOR UPDATE), so concurrent events, retries and reconciliation for
the same account are serialised. Different accounts never block each other.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum

from psycopg import Connection
from psycopg_pool import ConnectionPool

from app.config import Settings
from app.models import CallEvent
from app.periods import is_late_arrival, period_of
from app.usage import recompute_period

log = logging.getLogger(__name__)

# How long a freshly stored event is left alone by the retry worker, so the
# worker doesn't race the request that is processing it inline.
INLINE_PROCESSING_WINDOW_SECONDS = 30
MAX_BACKOFF_SECONDS = 600


class StoreOutcome(str, Enum):
    NEW = "new"
    DUPLICATE = "duplicate"


class ProcessOutcome(str, Enum):
    PROCESSED = "processed"
    SKIPPED = "skipped"  # already processed, dead, or being processed elsewhere


@dataclass(frozen=True)
class StoredEvent:
    event_id: str
    event_type: str
    account_id: str
    call_id: str
    occurred_at: datetime
    duration_seconds: int
    cost_cents: int
    received_at: datetime


STORED_EVENT_COLUMNS = (
    "event_id, event_type, account_id, call_id, occurred_at, "
    "duration_seconds, cost_cents, received_at"
)


def store_event(conn: Connection, event: CallEvent, body_sha256: str) -> StoreOutcome:
    with conn.transaction():
        inserted = conn.execute(
            """
            INSERT INTO raw_events (
                event_id, event_type, account_id, call_id, occurred_at,
                duration_seconds, cost_cents, destination_country, body_sha256,
                next_attempt_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now() + make_interval(secs => %s))
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            (
                event.event_id,
                event.event_type,
                event.account_id,
                event.call_id,
                event.timestamp,
                event.duration_seconds,
                event.cost_cents,
                event.destination_country,
                body_sha256,
                INLINE_PROCESSING_WINDOW_SECONDS,
            ),
        ).fetchone()
        if inserted:
            return StoreOutcome.NEW

        existing = conn.execute(
            """
            UPDATE raw_events SET delivery_count = delivery_count + 1
            WHERE event_id = %s
            RETURNING body_sha256
            """,
            (event.event_id,),
        ).fetchone()

    if existing["body_sha256"] != body_sha256:
        # Same id, different content. We keep the first version; a human should look.
        log.warning(
            "event_id_reused_with_different_body",
            extra={"fields": {"event_id": event.event_id, "account_id": event.account_id}},
        )
    return StoreOutcome.DUPLICATE


def process_event(conn: Connection, event_id: str, settings: Settings) -> ProcessOutcome:
    with conn.transaction():
        row = conn.execute(
            f"""
            SELECT {STORED_EVENT_COLUMNS} FROM raw_events
            WHERE event_id = %s AND status = 'pending'
            FOR UPDATE SKIP LOCKED
            """,
            (event_id,),
        ).fetchone()
        if row is None:
            return ProcessOutcome.SKIPPED

        event = StoredEvent(**row)
        lock_account(conn, event.account_id, settings.default_monthly_cap_cents)
        for period in apply_event(conn, event, settings.period_grace_days):
            recompute_period(conn, event.account_id, period)

        conn.execute(
            """
            UPDATE raw_events
            SET status = 'processed', processed_at = now(), last_error = NULL
            WHERE event_id = %s
            """,
            (event_id,),
        )
    return ProcessOutcome.PROCESSED


def record_failure(conn: Connection, event_id: str, error: Exception, max_attempts: int) -> str:
    """Bump the attempt counter and schedule the next try, or give up. Returns new status."""
    with conn.transaction():
        row = conn.execute(
            """
            UPDATE raw_events SET
                attempts = attempts + 1,
                last_error = %(error)s,
                status = CASE WHEN attempts + 1 >= %(max)s THEN 'dead' ELSE 'pending' END,
                next_attempt_at = now() + make_interval(secs => LEAST(%(cap)s, power(2, attempts + 1)))
            WHERE event_id = %(event_id)s AND status = 'pending'
            RETURNING status, attempts
            """,
            {
                "error": f"{type(error).__name__}: {error}"[:500],
                "max": max_attempts,
                "cap": MAX_BACKOFF_SECONDS,
                "event_id": event_id,
            },
        ).fetchone()
    status = row["status"] if row else "unknown"
    log.error(
        "event_processing_failed",
        extra={
            "fields": {
                "event_id": event_id,
                "attempts": row["attempts"] if row else None,
                "status": status,
                "error": str(error),
            }
        },
    )
    return status


def process_with_bookkeeping(pool: ConnectionPool, event_id: str, settings: Settings) -> str:
    """Process one event; on failure record it for retry. Returns 'processed', 'skipped', 'pending' or 'dead'."""
    with pool.connection() as conn:
        try:
            return process_event(conn, event_id, settings).value
        except Exception as exc:  # noqa: BLE001 - any failure here is retryable by design
            return record_failure(conn, event_id, exc, settings.retry_max_attempts)


def lock_account(conn: Connection, account_id: str, default_cap_cents: int) -> None:
    """Create the account on first sight, then take its row lock for this transaction."""
    conn.execute(
        """
        INSERT INTO accounts (account_id, monthly_cap_cents) VALUES (%s, %s)
        ON CONFLICT (account_id) DO NOTHING
        """,
        (account_id, default_cap_cents),
    )
    conn.execute("SELECT 1 FROM accounts WHERE account_id = %s FOR UPDATE", (account_id,))


def apply_event(conn: Connection, event: StoredEvent, grace_days: int) -> set[date]:
    """Fold one event into its call row. Returns the billing periods that need recomputing.

    The fold is order-independent:
      - started only ever fills in started_at (earliest wins);
      - ended always wins over in_progress/failed, and a later ended replaces an earlier one;
      - failed only applies to a call that hasn't ended.
    """
    if event.event_type == "call.started":
        _apply_started(conn, event)
        return set()
    if event.event_type == "call.failed":
        _apply_failed(conn, event)
        return set()
    return _apply_ended(conn, event, grace_days)


def _apply_started(conn: Connection, event: StoredEvent) -> None:
    conn.execute(
        """
        INSERT INTO calls (call_id, account_id, status, started_at)
        VALUES (%s, %s, 'in_progress', %s)
        ON CONFLICT (call_id) DO UPDATE SET
            started_at = LEAST(calls.started_at, EXCLUDED.started_at),
            updated_at = now()
        """,
        (event.call_id, event.account_id, event.occurred_at),
    )


def _apply_failed(conn: Connection, event: StoredEvent) -> None:
    conn.execute(
        """
        INSERT INTO calls (call_id, account_id, status)
        VALUES (%s, %s, 'failed')
        ON CONFLICT (call_id) DO UPDATE SET status = 'failed', updated_at = now()
        WHERE calls.status = 'in_progress'
        """,
        (event.call_id, event.account_id),
    )


def _apply_ended(conn: Connection, event: StoredEvent, grace_days: int) -> set[date]:
    period = period_of(event.occurred_at)
    previous = conn.execute(
        "SELECT billing_period FROM calls WHERE call_id = %s", (event.call_id,)
    ).fetchone()

    conn.execute(
        """
        INSERT INTO calls (
            call_id, account_id, status, ended_at, duration_seconds, cost_cents,
            billing_period, late_arrival
        ) VALUES (%s, %s, 'completed', %s, %s, %s, %s, %s)
        ON CONFLICT (call_id) DO UPDATE SET
            status           = 'completed',
            ended_at         = EXCLUDED.ended_at,
            duration_seconds = EXCLUDED.duration_seconds,
            cost_cents       = EXCLUDED.cost_cents,
            billing_period   = EXCLUDED.billing_period,
            late_arrival     = EXCLUDED.late_arrival,
            updated_at       = now()
        WHERE calls.ended_at IS NULL OR EXCLUDED.ended_at >= calls.ended_at
        """,
        (
            event.call_id,
            event.account_id,
            event.occurred_at,
            event.duration_seconds,
            event.cost_cents,
            period,
            is_late_arrival(period, event.received_at, grace_days),
        ),
    )

    affected = {period}
    if previous and previous["billing_period"]:
        affected.add(previous["billing_period"])
    return affected
