-- Three layers, each derived from the one above it:
--   raw_events     append-only log of every accepted delivery (source of truth)
--   calls          one row per call_id, folded from its events
--   usage_monthly  per account per month totals, recomputed from calls
-- All money is integer cents (BIGINT). All timestamps are UTC timestamptz.

CREATE TABLE IF NOT EXISTS accounts (
    account_id         TEXT PRIMARY KEY,
    monthly_cap_cents  BIGINT NOT NULL CHECK (monthly_cap_cents >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_events (
    event_id             TEXT PRIMARY KEY,
    event_type           TEXT NOT NULL CHECK (event_type IN ('call.started', 'call.ended', 'call.failed')),
    account_id           TEXT NOT NULL,
    call_id              TEXT NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL,
    duration_seconds     INTEGER NOT NULL CHECK (duration_seconds >= 0),
    cost_cents           BIGINT NOT NULL CHECK (cost_cents >= 0),
    destination_country  TEXT NOT NULL,
    body_sha256          TEXT NOT NULL,
    received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivery_count       INTEGER NOT NULL DEFAULT 1,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'dead')),
    attempts             INTEGER NOT NULL DEFAULT 0,
    next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error           TEXT,
    processed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS raw_events_retry_idx ON raw_events (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS raw_events_account_idx ON raw_events (account_id);

CREATE TABLE IF NOT EXISTS calls (
    call_id           TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL REFERENCES accounts (account_id),
    status            TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    duration_seconds  INTEGER NOT NULL DEFAULT 0,
    cost_cents        BIGINT NOT NULL DEFAULT 0,
    -- First day of the UTC month the call ended in. NULL until call.ended arrives.
    billing_period    DATE,
    -- The call.ended arrived after its billing period had closed.
    late_arrival      BOOLEAN NOT NULL DEFAULT false,
    -- The call happened after the account had already hit its cap; not billed.
    over_cap          BOOLEAN NOT NULL DEFAULT false,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_account_period_idx ON calls (account_id, billing_period);

CREATE TABLE IF NOT EXISTS usage_monthly (
    account_id           TEXT NOT NULL REFERENCES accounts (account_id),
    period               DATE NOT NULL,
    completed_calls      INTEGER NOT NULL,
    total_seconds        BIGINT NOT NULL,
    total_cost_cents     BIGINT NOT NULL,
    billable_cost_cents  BIGINT NOT NULL,
    over_cap_calls       INTEGER NOT NULL,
    over_cap_cost_cents  BIGINT NOT NULL,
    late_calls           INTEGER NOT NULL,
    cap_cents            BIGINT NOT NULL,
    cap_reached_at       TIMESTAMPTZ,
    recomputed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, period)
);
