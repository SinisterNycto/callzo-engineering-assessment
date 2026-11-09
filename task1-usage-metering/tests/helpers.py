import json
import uuid
from datetime import datetime, timedelta, timezone

from app.security import sign

SECRET = b"test_webhook_secret"


def event(**overrides) -> dict:
    payload = {
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "event_type": "call.started",
        "account_id": "acct_001",
        "call_id": f"call_{uuid.uuid4().hex[:12]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": 0,
        "cost_cents": 0,
        "destination_country": "US",
    }
    payload.update(overrides)
    return payload


def call_pair(account_id: str, ended_at: datetime, duration_seconds: int, cost_cents: int):
    """A matching (started, ended) pair for one call."""
    call_id = f"call_{uuid.uuid4().hex[:12]}"
    started = event(
        account_id=account_id,
        call_id=call_id,
        timestamp=(ended_at - timedelta(seconds=duration_seconds)).isoformat(),
    )
    ended = event(
        event_type="call.ended",
        account_id=account_id,
        call_id=call_id,
        timestamp=ended_at.isoformat(),
        duration_seconds=duration_seconds,
        cost_cents=cost_cents,
    )
    return started, ended


def post(client, payload, secret: bytes = SECRET):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return client.post(
        "/webhooks/calls",
        content=body,
        headers={"Content-Type": "application/json", "X-Signature": sign(secret, body)},
    )
