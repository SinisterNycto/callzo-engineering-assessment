"""Monthly usage and cap enforcement.

Cap policy (see README "Monthly cap"): the cap is hard on what we bill.
Completed calls in a month are walked in the order they ended. A call is
billable if the account was still under its cap when the call ended,
and it is billed in full even if it crosses the cap. Every call after that
is recorded but marked over_cap and is not billed. The account's
`calls_allowed` flag goes false the moment billable usage reaches the cap.

usage_monthly is always recomputed from the calls table, never incremented.
That keeps the result independent of event arrival order: the same calls
give the same totals whether they arrived in order, out of order, or
were replayed by reconciliation.
"""

from dataclasses import dataclass
from datetime import date, datetime

from psycopg import Connection


@dataclass(frozen=True)
class CompletedCall:
    call_id: str
    ended_at: datetime
    cost_cents: int


@dataclass(frozen=True)
class CapSplit:
    billable_cents: int
    over_cap_cents: int
    over_cap_call_ids: frozenset[str]
    cap_reached_at: datetime | None


def split_by_cap(calls: list[CompletedCall], cap_cents: int) -> CapSplit:
    billable = 0
    over_cap = 0
    over_cap_ids: set[str] = set()
    cap_reached_at = None

    for call in sorted(calls, key=lambda c: (c.ended_at, c.call_id)):
        if billable >= cap_cents:
            over_cap += call.cost_cents
            over_cap_ids.add(call.call_id)
            continue
        billable += call.cost_cents
        if billable >= cap_cents:
            cap_reached_at = call.ended_at

    return CapSplit(billable, over_cap, frozenset(over_cap_ids), cap_reached_at)


def recompute_period(conn: Connection, account_id: str, period: date) -> None:
    """Rebuild one account-month from its calls. Caller must hold the account lock."""
    cap_cents = conn.execute(
        "SELECT monthly_cap_cents FROM accounts WHERE account_id = %s", (account_id,)
    ).fetchone()["monthly_cap_cents"]

    rows = conn.execute(
        """
        SELECT call_id, ended_at, cost_cents, duration_seconds, late_arrival
        FROM calls
        WHERE account_id = %s AND billing_period = %s AND status = 'completed'
        """,
        (account_id, period),
    ).fetchall()

    if not rows:
        conn.execute(
            "DELETE FROM usage_monthly WHERE account_id = %s AND period = %s", (account_id, period)
        )
        return

    split = split_by_cap(
        [CompletedCall(r["call_id"], r["ended_at"], r["cost_cents"]) for r in rows], cap_cents
    )
    _write_over_cap_flags(conn, account_id, period, split.over_cap_call_ids)

    conn.execute(
        """
        INSERT INTO usage_monthly (
            account_id, period, completed_calls, total_seconds, total_cost_cents,
            billable_cost_cents, over_cap_calls, over_cap_cost_cents, late_calls,
            cap_cents, cap_reached_at, recomputed_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (account_id, period) DO UPDATE SET
            completed_calls     = EXCLUDED.completed_calls,
            total_seconds       = EXCLUDED.total_seconds,
            total_cost_cents    = EXCLUDED.total_cost_cents,
            billable_cost_cents = EXCLUDED.billable_cost_cents,
            over_cap_calls      = EXCLUDED.over_cap_calls,
            over_cap_cost_cents = EXCLUDED.over_cap_cost_cents,
            late_calls          = EXCLUDED.late_calls,
            cap_cents           = EXCLUDED.cap_cents,
            cap_reached_at      = EXCLUDED.cap_reached_at,
            recomputed_at       = now()
        """,
        (
            account_id,
            period,
            len(rows),
            sum(r["duration_seconds"] for r in rows),
            sum(r["cost_cents"] for r in rows),
            split.billable_cents,
            len(split.over_cap_call_ids),
            split.over_cap_cents,
            sum(1 for r in rows if r["late_arrival"]),
            cap_cents,
            split.cap_reached_at,
        ),
    )


def _write_over_cap_flags(
    conn: Connection, account_id: str, period: date, over_cap_ids: frozenset[str]
) -> None:
    # Only touch rows whose flag actually changes.
    conn.execute(
        """
        UPDATE calls
        SET over_cap = (call_id = ANY(%(ids)s)), updated_at = now()
        WHERE account_id = %(account_id)s
          AND billing_period = %(period)s
          AND over_cap IS DISTINCT FROM (call_id = ANY(%(ids)s))
        """,
        {"ids": list(over_cap_ids), "account_id": account_id, "period": period},
    )
