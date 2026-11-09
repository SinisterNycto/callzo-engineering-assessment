"""Rebuild calls and monthly usage from raw_events, and report any drift.

Reconciliation replays an account's processed events through the same
apply_event() used by the live path, so there is one definition of
"what an event does", not two that could disagree.
"""

import logging
from datetime import date

from psycopg import Connection
from psycopg_pool import ConnectionPool

from app.config import Settings
from app.ingest import STORED_EVENT_COLUMNS, StoredEvent, apply_event, lock_account
from app.periods import format_period
from app.usage import recompute_period

log = logging.getLogger(__name__)

COMPARED_FIELDS = ("completed_calls", "total_cost_cents", "billable_cost_cents", "over_cap_calls")


def reconcile_account(conn: Connection, account_id: str, settings: Settings) -> list[dict]:
    """Recompute one account from scratch. Returns a list of per-period differences."""
    with conn.transaction():
        lock_account(conn, account_id, settings.default_monthly_cap_cents)
        before = _usage_snapshot(conn, account_id)

        conn.execute("DELETE FROM calls WHERE account_id = %s", (account_id,))
        conn.execute("DELETE FROM usage_monthly WHERE account_id = %s", (account_id,))

        events = conn.execute(
            f"""
            SELECT {STORED_EVENT_COLUMNS} FROM raw_events
            WHERE account_id = %s AND status = 'processed'
            ORDER BY occurred_at, event_id
            """,
            (account_id,),
        ).fetchall()

        periods: set[date] = set()
        for row in events:
            periods |= apply_event(conn, StoredEvent(**row), settings.period_grace_days)
        for period in periods:
            recompute_period(conn, account_id, period)

        after = _usage_snapshot(conn, account_id)

    drift = _diff(before, after)
    if drift:
        log.warning("reconcile_drift", extra={"fields": {"account_id": account_id, "drift": drift}})
    return drift


def reconcile_all(pool: ConnectionPool, settings: Settings) -> dict:
    """Reconcile every account, one transaction per account."""
    with pool.connection() as conn:
        account_ids = [
            r["account_id"]
            for r in conn.execute(
                """
                SELECT account_id FROM accounts
                UNION
                SELECT DISTINCT account_id FROM raw_events WHERE status = 'processed'
                ORDER BY 1
                """
            ).fetchall()
        ]
        drift = {}
        for account_id in account_ids:
            account_drift = reconcile_account(conn, account_id, settings)
            if account_drift:
                drift[account_id] = account_drift

    log.info(
        "reconcile_finished",
        extra={"fields": {"accounts_checked": len(account_ids), "accounts_with_drift": len(drift)}},
    )
    return {"accounts_checked": len(account_ids), "drift": drift}


def _usage_snapshot(conn: Connection, account_id: str) -> dict[date, dict]:
    rows = conn.execute(
        f"SELECT period, {', '.join(COMPARED_FIELDS)} FROM usage_monthly WHERE account_id = %s",
        (account_id,),
    ).fetchall()
    return {r["period"]: {f: r[f] for f in COMPARED_FIELDS} for r in rows}


def _diff(before: dict[date, dict], after: dict[date, dict]) -> list[dict]:
    empty = {f: 0 for f in COMPARED_FIELDS}
    changes = []
    for period in sorted(before.keys() | after.keys()):
        old, new = before.get(period, empty), after.get(period, empty)
        if old != new:
            changes.append({"period": format_period(period), "stored": old, "recomputed": new})
    return changes
