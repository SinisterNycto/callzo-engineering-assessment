from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Arbitrary constant so the API and the worker don't race each other creating
# tables when they boot at the same time.
MIGRATION_LOCK_ID = 74_210_001


def create_pool(database_url: str) -> ConnectionPool:
    # autocommit: single reads commit on their own; anything that needs
    # atomicity opens an explicit `with conn.transaction():` block.
    pool = ConnectionPool(
        database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row, "autocommit": True},
        open=False,
    )
    pool.open(wait=True, timeout=30)
    return pool


def migrate(pool: ConnectionPool) -> None:
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_ID,))
        conn.execute(SCHEMA_PATH.read_text())
