"""Pure-function tests; no database needed."""

from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.models import CallEvent
from app.periods import is_late_arrival, period_closes_at, period_of
from app.security import is_valid_api_key, sign, verify_signature
from app.usage import CompletedCall, split_by_cap

T0 = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


def call(call_id: str, minutes_after_t0: int, cost: int) -> CompletedCall:
    return CompletedCall(call_id, T0 + timedelta(minutes=minutes_after_t0), cost)


class TestSignature:
    def test_accepts_matching_signature(self):
        body = b'{"a": 1}'
        assert verify_signature(b"s3cret", body, sign(b"s3cret", body))

    def test_accepts_uppercase_hex_and_whitespace(self):
        body = b'{"a": 1}'
        assert verify_signature(b"s3cret", body, f" {sign(b's3cret', body).upper()} ")

    @pytest.mark.parametrize("header", [None, "", "deadbeef", "0" * 64, "zz-not-hex"])
    def test_rejects_missing_or_wrong(self, header):
        assert not verify_signature(b"s3cret", b'{"a": 1}', header)

    def test_rejects_signature_for_different_bytes(self):
        # Same JSON, different whitespace: must fail, which is why we sign raw bytes.
        assert not verify_signature(b"s3cret", b'{"a":1}', sign(b"s3cret", b'{"a": 1}'))

    def test_api_key_matching(self):
        assert is_valid_api_key("k2", ("k1", "k2"))
        assert not is_valid_api_key("k3", ("k1", "k2"))


class TestCapSplit:
    def test_under_cap_everything_billable(self):
        split = split_by_cap([call("a", 0, 100), call("b", 1, 100)], cap_cents=500)
        assert split.billable_cents == 200
        assert split.over_cap_call_ids == frozenset()
        assert split.cap_reached_at is None

    def test_crossing_call_is_billed_in_full_and_later_calls_are_not(self):
        calls = [call("a", 0, 300), call("b", 1, 300), call("c", 2, 300)]
        split = split_by_cap(calls, cap_cents=500)
        assert split.billable_cents == 600
        assert split.over_cap_call_ids == {"c"}
        assert split.over_cap_cents == 300
        assert split.cap_reached_at == T0 + timedelta(minutes=1)

    def test_landing_exactly_on_cap_blocks_the_next_call(self):
        split = split_by_cap([call("a", 0, 250), call("b", 1, 250), call("c", 2, 1)], cap_cents=500)
        assert split.billable_cents == 500
        assert split.over_cap_call_ids == {"c"}

    def test_zero_cap_bills_nothing(self):
        split = split_by_cap([call("a", 0, 10)], cap_cents=0)
        assert split.billable_cents == 0
        assert split.over_cap_call_ids == {"a"}

    def test_result_depends_on_end_time_not_input_order(self):
        calls = [call("late", 5, 300), call("early", 0, 300), call("mid", 2, 300)]
        split = split_by_cap(calls, cap_cents=500)
        assert split.over_cap_call_ids == {"late"}
        assert split_by_cap(list(reversed(calls)), cap_cents=500) == split


class TestPeriods:
    def test_period_is_utc_month(self):
        # 23:30 on Oct 31 in New York is already Nov 1 in UTC.
        ts = datetime(2026, 10, 31, 23, 30, tzinfo=timezone(timedelta(hours=-5)))
        assert period_of(ts) == date(2026, 11, 1)

    def test_december_rolls_into_next_year(self):
        assert period_closes_at(date(2026, 12, 1), 0) == datetime(2027, 1, 1, tzinfo=timezone.utc)

    def test_late_arrival_boundary(self):
        closes = period_closes_at(date(2026, 10, 1), grace_days=3)
        assert closes == datetime(2026, 11, 4, tzinfo=timezone.utc)
        assert not is_late_arrival(date(2026, 10, 1), closes - timedelta(microseconds=1), 3)
        assert is_late_arrival(date(2026, 10, 1), closes, 3)


class TestEventValidation:
    VALID = (
        '{"event_id": "evt_1", "event_type": "call.ended", "account_id": "acct_001", '
        '"call_id": "call_1", "timestamp": "2026-11-01T10:00:00+00:00", '
        '"duration_seconds": 60, "cost_cents": 2, "destination_country": "US"}'
    )

    def test_valid_event_parses(self):
        event = CallEvent.model_validate_json(self.VALID)
        assert event.cost_cents == 2

    @pytest.mark.parametrize(
        "old,new",
        [
            ('"cost_cents": 2', '"cost_cents": "2"'),
            ('"cost_cents": 2', '"cost_cents": 2.5'),
            ('"cost_cents": 2', '"cost_cents": -1'),
            ('"cost_cents": 2', '"cost_cents": null'),
            ('"duration_seconds": 60', '"duration_seconds": true'),
            ('"call.ended"', '"call.exploded"'),
            ("+00:00", ""),
            ('"acct_001"', '"acct_001; DROP TABLE calls"'),
        ],
    )
    def test_rejects_bad_fields(self, old, new):
        with pytest.raises(ValidationError):
            CallEvent.model_validate_json(self.VALID.replace(old, new))
