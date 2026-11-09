import os

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.config import Settings
from app.main import create_app

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://callzo:callzo_local_dev@localhost:5432/callzo_test"
)


def _ensure_database_exists(url: str) -> None:
    db_name = conninfo_to_dict(url)["dbname"]
    admin_url = make_conninfo(url, dbname="postgres")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{db_name}"')


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        database_url=TEST_DATABASE_URL,
        webhook_secret=b"test_webhook_secret",
        api_keys=("test_key_one", "test_key_two"),
        default_monthly_cap_cents=500,
        period_grace_days=3,
        retry_max_attempts=3,
        retry_poll_seconds=1,
        reconcile_interval_seconds=60,
        log_level="WARNING",
    )


@pytest.fixture(scope="session")
def client(settings):
    _ensure_database_exists(settings.database_url)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def pool(client):
    return client.app.state.pool


@pytest.fixture(autouse=True)
def clean_tables(request):
    if "client" not in request.fixturenames:
        yield
        return
    pool = request.getfixturevalue("pool")
    with pool.connection() as conn:
        conn.execute("TRUNCATE usage_monthly, calls, raw_events, accounts")
    yield


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test_key_one"}
