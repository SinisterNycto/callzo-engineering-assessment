"""Authenticated read/admin API. Every route here requires `Authorization: Bearer <key>`."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.periods import current_period, format_period, parse_period
from app.reconcile import reconcile_account, reconcile_all
from app.security import is_valid_api_key

bearer = HTTPBearer(auto_error=False)


def require_api_key(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    if credentials is None or not is_valid_api_key(
        credentials.credentials, request.app.state.settings.api_keys
    ):
        raise HTTPException(
            status_code=401,
            detail="missing or invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


router = APIRouter(prefix="/v1", dependencies=[Depends(require_api_key)])

AccountId = Annotated[str, Path(pattern=r"^acct_[A-Za-z0-9_-]{1,64}$")]
PeriodParam = Annotated[
    str | None,
    Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="Billing month, YYYY-MM (UTC). Defaults to the current month."),
]

USAGE_SELECT = """
    SELECT a.account_id,
           a.monthly_cap_cents,
           COALESCE(u.completed_calls, 0)     AS completed_calls,
           COALESCE(u.total_seconds, 0)       AS total_seconds,
           COALESCE(u.total_cost_cents, 0)    AS total_cost_cents,
           COALESCE(u.billable_cost_cents, 0) AS billable_cost_cents,
           COALESCE(u.over_cap_calls, 0)      AS over_cap_calls,
           COALESCE(u.over_cap_cost_cents, 0) AS over_cap_cost_cents,
           COALESCE(u.late_calls, 0)          AS late_calls,
           u.cap_cents                        AS cap_applied_cents,
           u.cap_reached_at,
           u.recomputed_at
    FROM accounts a
    LEFT JOIN usage_monthly u ON u.account_id = a.account_id AND u.period = %(period)s
"""


@router.get("/accounts/{account_id}/usage")
def get_account_usage(request: Request, account_id: AccountId, period: PeriodParam = None) -> dict:
    month = parse_period(period) if period else current_period()
    with request.app.state.pool.connection() as conn:
        row = conn.execute(
            USAGE_SELECT + " WHERE a.account_id = %(account_id)s",
            {"period": month, "account_id": account_id},
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    return _usage_response(row, month)


@router.get("/usage")
def list_usage(request: Request, period: PeriodParam = None) -> dict:
    month = parse_period(period) if period else current_period()
    with request.app.state.pool.connection() as conn:
        rows = conn.execute(USAGE_SELECT + " ORDER BY a.account_id", {"period": month}).fetchall()
    return {"period": format_period(month), "accounts": [_usage_response(r, month) for r in rows]}


@router.post("/admin/reconcile")
async def run_reconciliation(
    request: Request,
    account_id: Annotated[str | None, Query(pattern=r"^acct_[A-Za-z0-9_-]{1,64}$")] = None,
) -> dict:
    pool, settings = request.app.state.pool, request.app.state.settings
    if account_id is None:
        return await run_in_threadpool(reconcile_all, pool, settings)

    def reconcile_one() -> dict:
        with pool.connection() as conn:
            drift = reconcile_account(conn, account_id, settings)
        return {"accounts_checked": 1, "drift": {account_id: drift} if drift else {}}

    return await run_in_threadpool(reconcile_one)


@router.get("/admin/review")
def review_queue(
    request: Request, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> dict:
    """Things a human should look at: late-arriving usage and events we gave up on."""
    with request.app.state.pool.connection() as conn:
        late_calls = conn.execute(
            """
            SELECT call_id, account_id, billing_period, ended_at, cost_cents, over_cap, updated_at
            FROM calls WHERE late_arrival
            ORDER BY updated_at DESC LIMIT %s
            """,
            (limit,),
        ).fetchall()
        dead_events = conn.execute(
            """
            SELECT event_id, event_type, account_id, call_id, attempts, last_error, received_at
            FROM raw_events WHERE status = 'dead'
            ORDER BY received_at DESC LIMIT %s
            """,
            (limit,),
        ).fetchall()
    for call in late_calls:
        call["billing_period"] = format_period(call["billing_period"])
    return {"late_calls": late_calls, "dead_events": dead_events}


def _usage_response(row: dict, month: date) -> dict:
    # A month's cap is the one in force when it was last recomputed; for a month
    # with no usage yet, it's the account's current cap.
    cap = row["cap_applied_cents"] if row["cap_applied_cents"] is not None else row["monthly_cap_cents"]
    billable = row["billable_cost_cents"]
    return {
        "account_id": row["account_id"],
        "period": format_period(month),
        "monthly_cap_cents": cap,
        "completed_calls": row["completed_calls"],
        "total_seconds": row["total_seconds"],
        "total_cost_cents": row["total_cost_cents"],
        "billable_cost_cents": billable,
        "over_cap_calls": row["over_cap_calls"],
        "over_cap_cost_cents": row["over_cap_cost_cents"],
        "late_calls": row["late_calls"],
        "remaining_cents": max(cap - billable, 0),
        "cap_reached": billable >= cap,
        "calls_allowed": billable < cap,
        "cap_reached_at": row["cap_reached_at"],
        "recomputed_at": row["recomputed_at"],
    }
