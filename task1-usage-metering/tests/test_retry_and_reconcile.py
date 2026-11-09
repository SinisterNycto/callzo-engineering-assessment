from datetime import datetime, timezone

from app import ingest
from app.periods import format_period, period_of
from app.worker import retry_due_events
from tests.helpers import call_pair, post

NOW = datetime.now(timezone.utc)
THIS_MONTH = format_period(period_of(NOW))


def make_due_now(pool):
    with pool.connection() as conn:
        conn.execute("UPDATE raw_events SET next_attempt_at = now() WHERE status = 'pending'")


def event_row(pool, event_id):
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM raw_events WHERE event_id = %s", (event_id,)).fetchone()


def billable(client, auth_headers, account_id):
    response = client.get(
        f"/v1/accounts/{account_id}/usage", params={"period": THIS_MONTH}, headers=auth_headers
    )
    return response.json()["billable_cost_cents"]


def failing_apply(*_args, **_kwargs):
    raise RuntimeError("simulated failure")


class TestRetry:
    def test_failed_processing_is_queued_then_retried(self, client, pool, settings, auth_headers, monkeypatch):
        _, ended = call_pair("acct_002", NOW, 600, 20)

        monkeypatch.setattr(ingest, "apply_event", failing_apply)
        response = post(client, ended)
        assert response.status_code == 202
        assert response.json()["status"] == "queued"

        row = event_row(pool, ended["event_id"])
        assert row["status"] == "pending"
        assert row["attempts"] == 1
        assert "simulated failure" in row["last_error"]
        with pool.connection() as conn:
            assert conn.execute("SELECT count(*) AS n FROM calls").fetchone()["n"] == 0

        monkeypatch.undo()
        make_due_now(pool)
        assert retry_due_events(pool, settings) == {"processed": 1}
        assert event_row(pool, ended["event_id"])["status"] == "processed"
        assert billable(client, auth_headers, "acct_002") == 20

    def test_event_goes_dead_after_max_attempts(self, client, pool, settings, monkeypatch):
        _, ended = call_pair("acct_002", NOW, 600, 20)
        monkeypatch.setattr(ingest, "apply_event", failing_apply)
        post(client, ended)  # attempt 1

        for _ in range(settings.retry_max_attempts - 1):
            make_due_now(pool)
            retry_due_events(pool, settings)

        row = event_row(pool, ended["event_id"])
        assert row["status"] == "dead"
        assert row["attempts"] == settings.retry_max_attempts

    def test_duplicate_of_pending_event_does_not_process_twice(self, client, pool, settings, auth_headers, monkeypatch):
        _, ended = call_pair("acct_002", NOW, 600, 20)
        monkeypatch.setattr(ingest, "apply_event", failing_apply)
        post(client, ended)
        monkeypatch.undo()

        assert post(client, ended).json()["status"] == "duplicate"
        make_due_now(pool)
        retry_due_events(pool, settings)
        assert billable(client, auth_headers, "acct_002") == 20


class TestReconcile:
    def test_no_drift_when_state_is_consistent(self, client, auth_headers):
        for cost in (10, 20, 30):
            started, ended = call_pair("acct_003", NOW, 60, cost)
            post(client, ended)
            post(client, started)

        result = client.post("/v1/admin/reconcile", headers=auth_headers).json()
        assert result == {"accounts_checked": 1, "drift": {}}

    def test_repairs_corrupted_usage_and_reports_drift(self, client, pool, auth_headers):
        _, a = call_pair("acct_003", NOW, 60, 10)
        _, b = call_pair("acct_003", NOW, 60, 20)
        post(client, a)
        post(client, b)

        with pool.connection() as conn:
            conn.execute("UPDATE usage_monthly SET billable_cost_cents = 9999 WHERE account_id = 'acct_003'")
            conn.execute("DELETE FROM calls WHERE call_id = %s", (a["call_id"],))

        result = client.post(
            "/v1/admin/reconcile", params={"account_id": "acct_003"}, headers=auth_headers
        ).json()
        drift = result["drift"]["acct_003"][0]
        assert drift["period"] == THIS_MONTH
        assert drift["stored"]["billable_cost_cents"] == 9999
        assert drift["recomputed"]["billable_cost_cents"] == 30
        assert billable(client, auth_headers, "acct_003") == 30

    def test_cap_change_is_applied_by_reconcile(self, client, pool, auth_headers):
        for _ in range(3):
            post(client, call_pair("acct_007", NOW, 60, 200)[1])
        with pool.connection() as conn:
            conn.execute("UPDATE accounts SET monthly_cap_cents = 100 WHERE account_id = 'acct_007'")

        client.post("/v1/admin/reconcile", params={"account_id": "acct_007"}, headers=auth_headers)
        assert billable(client, auth_headers, "acct_007") == 200
