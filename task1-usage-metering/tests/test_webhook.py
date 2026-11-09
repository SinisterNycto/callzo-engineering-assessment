"""End-to-end webhook behaviour against a real Postgres, one test per simulator scenario."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.periods import format_period, period_of
from tests.helpers import call_pair, event, post

NOW = datetime.now(timezone.utc)
THIS_MONTH = format_period(period_of(NOW))
# A fixed past month for tests where only ordering matters.
JUNE = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)


def usage(client, auth_headers, account_id="acct_001", period=THIS_MONTH):
    response = client.get(f"/v1/accounts/{account_id}/usage", params={"period": period}, headers=auth_headers)
    assert response.status_code == 200, response.text
    return response.json()


def count(pool, sql, *params):
    with pool.connection() as conn:
        return list(conn.execute(sql, params).fetchone().values())[0]


class TestSignatures:
    def test_invalid_signature_rejected_and_nothing_stored(self, client, pool):
        response = post(client, event(), secret=b"wrong_secret")
        assert response.status_code == 401
        assert count(pool, "SELECT count(*) FROM raw_events") == 0

    def test_missing_signature_rejected(self, client, pool):
        response = client.post("/webhooks/calls", content=json.dumps(event()).encode())
        assert response.status_code == 401
        assert count(pool, "SELECT count(*) FROM raw_events") == 0

    def test_garbage_body_with_bad_signature_is_401_not_400(self, client):
        # Signature is checked before we even try to parse.
        response = client.post("/webhooks/calls", content=b"{not json", headers={"X-Signature": "00"})
        assert response.status_code == 401


class TestMalformed:
    @pytest.mark.parametrize(
        "body,status",
        [
            (b"", 400),
            (b'{"event_id": "evt_abc", "event_type": "call.ended", "accoun', 400),
            (b"[1, 2, 3]", 422),
            (json.dumps({"event_id": "evt_x", "event_type": "call.ended"}).encode(), 422),
            (json.dumps(event(duration_seconds="not_a_number", cost_cents=None)).encode(), 422),
            (json.dumps(event(event_type="call.exploded")).encode(), 422),
        ],
    )
    def test_rejected_cleanly(self, client, pool, body, status):
        response = post(client, body)
        assert response.status_code == status
        assert "error" in response.json()
        assert count(pool, "SELECT count(*) FROM raw_events") == 0

    def test_oversized_body_rejected(self, client):
        response = post(client, b"{" + b" " * 20_000 + b"}")
        assert response.status_code == 413


class TestNormalFlow:
    def test_started_then_ended_is_counted(self, client, auth_headers):
        started, ended = call_pair("acct_002", NOW, duration_seconds=690, cost_cents=23)
        assert post(client, started).status_code == 200
        response = post(client, ended)
        assert response.status_code == 200
        assert response.json()["status"] == "processed"

        u = usage(client, auth_headers, "acct_002")
        assert u["completed_calls"] == 1
        assert u["total_seconds"] == 690
        assert u["billable_cost_cents"] == 23
        assert u["calls_allowed"] is True

    def test_failed_call_costs_nothing(self, client, auth_headers, pool):
        started = event(account_id="acct_003")
        failed = event(event_type="call.failed", account_id="acct_003", call_id=started["call_id"])
        post(client, started)
        post(client, failed)
        assert count(pool, "SELECT status FROM calls WHERE call_id = %s", started["call_id"]) == "failed"
        assert usage(client, auth_headers, "acct_003")["completed_calls"] == 0


class TestDuplicates:
    def test_same_event_three_times_counts_once(self, client, auth_headers, pool):
        _, ended = call_pair("acct_004", NOW, 600, 20)
        statuses = [post(client, ended).json()["status"] for _ in range(3)]

        assert statuses == ["processed", "duplicate", "duplicate"]
        assert usage(client, auth_headers, "acct_004")["billable_cost_cents"] == 20
        assert count(pool, "SELECT delivery_count FROM raw_events WHERE event_id = %s", ended["event_id"]) == 3

    def test_two_ended_events_for_same_call_do_not_double_count(self, client, auth_headers):
        # Different event_ids, same call: dedupe also happens at the call level.
        _, ended = call_pair("acct_004", NOW, 600, 20)
        post(client, ended)
        post(client, {**ended, "event_id": "evt_resent0001"})
        assert usage(client, auth_headers, "acct_004")["billable_cost_cents"] == 20


class TestOutOfOrder:
    def test_ended_before_started_ends_in_correct_state(self, client, auth_headers, pool):
        started, ended = call_pair("acct_006", NOW, 300, 10)
        post(client, ended)
        post(client, started)

        with pool.connection() as conn:
            call = conn.execute("SELECT * FROM calls WHERE call_id = %s", (started["call_id"],)).fetchone()
        assert call["status"] == "completed"
        assert call["started_at"] is not None
        assert call["cost_cents"] == 10
        assert usage(client, auth_headers, "acct_006")["completed_calls"] == 1

    def test_failed_after_ended_does_not_erase_usage(self, client, auth_headers):
        _, ended = call_pair("acct_006", NOW, 300, 10)
        post(client, ended)
        post(client, event(event_type="call.failed", account_id="acct_006", call_id=ended["call_id"]))
        assert usage(client, auth_headers, "acct_006")["billable_cost_cents"] == 10


class TestLateEvents:
    def test_late_event_lands_in_its_own_month_and_is_flagged(self, client, auth_headers):
        occurred = NOW - timedelta(days=35)
        _, ended = call_pair("acct_008", occurred, 284, 9)
        assert post(client, ended).status_code == 200

        old_month = format_period(period_of(occurred))
        assert usage(client, auth_headers, "acct_008", old_month)["late_calls"] == 1
        assert usage(client, auth_headers, "acct_008", old_month)["billable_cost_cents"] == 9
        assert usage(client, auth_headers, "acct_008", THIS_MONTH)["total_cost_cents"] == 0

        review = client.get("/v1/admin/review", headers=auth_headers).json()
        assert [c["call_id"] for c in review["late_calls"]] == [ended["call_id"]]


class TestCap:
    def test_cap_engages_partway_through_a_burst(self, client, auth_headers):
        # Default cap is 500c. 40 calls x 20c: the first 25 reach exactly 500c,
        # the remaining 15 are recorded but not billed.
        responses = []
        for i in range(40):
            _, ended = call_pair("acct_001", JUNE + timedelta(minutes=i), 600, 20)
            responses.append(post(client, ended))
        assert all(r.status_code == 200 for r in responses)

        u = usage(client, auth_headers, "acct_001", "2026-06")
        assert u["completed_calls"] == 40
        assert u["total_cost_cents"] == 800
        assert u["billable_cost_cents"] == 500
        assert u["over_cap_calls"] == 15
        assert u["over_cap_cost_cents"] == 300
        assert u["cap_reached"] is True
        assert u["calls_allowed"] is False
        assert u["remaining_cents"] == 0

    def test_out_of_order_arrival_gives_same_cap_result(self, client, auth_headers, pool):
        # Cap is evaluated by when calls ended, not when we heard about them.
        ends = [JUNE + timedelta(minutes=i) for i in range(3)]
        pairs = [call_pair("acct_005", t, 600, 300)[1] for t in ends]
        for ended in reversed(pairs):
            post(client, ended)

        u = usage(client, auth_headers, "acct_005", "2026-06")
        assert u["billable_cost_cents"] == 600
        assert u["over_cap_calls"] == 1
        over = count(pool, "SELECT call_id FROM calls WHERE over_cap")
        assert over == pairs[2]["call_id"]
