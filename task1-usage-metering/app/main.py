import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app import api, webhooks
from app.config import Settings, load_settings
from app.db import create_pool, migrate
from app.logs import configure_logging

log = logging.getLogger(__name__)

QUIET_PATHS = {"/health", "/metrics"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = create_pool(settings.database_url)
        migrate(pool)
        app.state.pool = pool
        log.info("api_started")
        yield
        pool.close()

    app = FastAPI(title="Callzo usage metering", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.include_router(webhooks.router)
    app.include_router(api.router)
    app.middleware("http")(log_requests)
    app.add_api_route("/health", health, methods=["GET"])
    app.add_api_route("/metrics", metrics, methods=["GET"], include_in_schema=False)
    return app


async def log_requests(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled_error", extra={"fields": {"path": request.url.path}})
        return JSONResponse(status_code=500, content={"error": "internal_error"})

    level = logging.DEBUG if request.url.path in QUIET_PATHS else logging.INFO
    log.log(
        level,
        "http_request",
        extra={
            "fields": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            }
        },
    )
    return response


async def health(request: Request) -> JSONResponse:
    """Liveness + readiness in one: 200 only if Postgres answers."""

    def check() -> dict:
        with request.app.state.pool.connection(timeout=2) as conn:
            return conn.execute(
                """
                SELECT count(*) FILTER (WHERE status = 'pending') AS pending_events,
                       count(*) FILTER (WHERE status = 'dead')    AS dead_events
                FROM raw_events
                """
            ).fetchone()

    try:
        counts = await run_in_threadpool(check)
    except Exception as exc:  # noqa: BLE001 - any DB failure means "not healthy"
        log.error("health_check_failed", extra={"fields": {"error": str(exc)}})
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "down"})
    return JSONResponse(content={"status": "ok", "database": "up", **counts})


async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
