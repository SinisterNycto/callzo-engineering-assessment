import hashlib
import logging

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app import ingest
from app.metrics import WEBHOOK_EVENTS, WEBHOOK_LATENCY
from app.models import CallEvent
from app.security import verify_signature

log = logging.getLogger(__name__)
router = APIRouter()

MAX_BODY_BYTES = 16 * 1024


@router.post("/webhooks/calls")
async def receive_call_event(request: Request) -> JSONResponse:
    with WEBHOOK_LATENCY.time():
        return await _handle(request)


async def _handle(request: Request) -> JSONResponse:
    declared_length = request.headers.get("content-length", "0")
    if declared_length.isdigit() and int(declared_length) > MAX_BODY_BYTES:
        return _reject(413, "payload_too_large", "body exceeds 16 KiB")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return _reject(413, "payload_too_large", "body exceeds 16 KiB")

    # Signature first: nothing about an unsigned body is trusted, not even its JSON shape.
    settings = request.app.state.settings
    if not verify_signature(settings.webhook_secret, body, request.headers.get("x-signature")):
        return _reject(401, "invalid_signature", "missing or invalid X-Signature")

    try:
        event = CallEvent.model_validate_json(body)
    except ValidationError as exc:
        return _validation_error(exc)

    pool = request.app.state.pool
    body_sha256 = hashlib.sha256(body).hexdigest()
    status = await run_in_threadpool(_store_and_process, pool, settings, event, body_sha256)

    fields = {
        "event_id": event.event_id,
        "event_type": event.event_type,
        "account_id": event.account_id,
        "call_id": event.call_id,
        "outcome": status,
    }
    WEBHOOK_EVENTS.labels(outcome=status).inc()
    log.info("webhook_received", extra={"fields": fields})

    # 202: we have durably stored the event but haven't applied it yet. Either
    # way the provider must not resend; retries are our job from here.
    http_status = 200 if status in ("processed", "duplicate") else 202
    return JSONResponse(status_code=http_status, content={"event_id": event.event_id, "status": status})


def _store_and_process(pool, settings, event: CallEvent, body_sha256: str) -> str:
    with pool.connection() as conn:
        stored = ingest.store_event(conn, event, body_sha256)
    if stored is ingest.StoreOutcome.DUPLICATE:
        return "duplicate"

    outcome = ingest.process_with_bookkeeping(pool, event.event_id, settings)
    return "processed" if outcome == "processed" else "queued"


def _validation_error(exc: ValidationError) -> JSONResponse:
    errors = exc.errors(include_input=False, include_url=False, include_context=False)
    if any(e["type"] == "json_invalid" for e in errors):
        return _reject(400, "invalid_json", "body is not valid JSON")
    details = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in errors]
    return _reject(422, "invalid_payload", "payload failed validation", details)


def _reject(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    WEBHOOK_EVENTS.labels(outcome=code).inc()
    log.warning("webhook_rejected", extra={"fields": {"status": status, "reason": code, "details": details}})
    content = {"error": code, "message": message}
    if details:
        content["details"] = details
    return JSONResponse(status_code=status, content=content)
