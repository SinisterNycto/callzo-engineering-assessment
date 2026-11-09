"""Billing periods are calendar months in UTC, identified by their first day."""

from datetime import date, datetime, time, timedelta, timezone


def period_of(ts: datetime) -> date:
    utc = ts.astimezone(timezone.utc)
    return date(utc.year, utc.month, 1)


def next_period(period: date) -> date:
    if period.month == 12:
        return date(period.year + 1, 1, 1)
    return date(period.year, period.month + 1, 1)


def period_closes_at(period: date, grace_days: int) -> datetime:
    """After this instant, new usage for `period` counts as a late arrival."""
    end = datetime.combine(next_period(period), time.min, tzinfo=timezone.utc)
    return end + timedelta(days=grace_days)


def is_late_arrival(period: date, received_at: datetime, grace_days: int) -> bool:
    return received_at >= period_closes_at(period, grace_days)


def parse_period(value: str) -> date:
    """'2026-11' -> date(2026, 11, 1). Format is validated by the caller."""
    year, month = value.split("-")
    return date(int(year), int(month), 1)


def format_period(period: date) -> str:
    return period.strftime("%Y-%m")


def current_period() -> date:
    return period_of(datetime.now(timezone.utc))
