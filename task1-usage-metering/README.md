# Task 1: Usage Metering Service

This service receives signed call events from the telephony provider and stores every one of them. It works out usage per account per month, enforces a monthly spend cap, and serves usage through an authenticated API.

Stack: Python 3.12, FastAPI, Postgres 16 and psycopg 3 with plain SQL (no ORM).

## Running it

```bash
docker compose up
```

That's the only step. Compose starts five things:

| service     | what it does |
|-------------|--------------|
| `db`        | Postgres 16, with data in the `pgdata` volume |
| `api`       | FastAPI on http://localhost:8000. It creates the schema on startup. |
| `worker`    | Retries events that failed processing and runs reconciliation every 5 minutes |
| `simulator` | The provided `meetrj/callzo-webhook-simulator`. It waits for the API to be healthy, runs `--scenario all` once, then exits. |

When the simulator exits, you can look at the results:

```bash
KEY='Authorization: Bearer local_dev_api_key'

curl -s localhost:8000/health
curl -s -H "$KEY" localhost:8000/v1/accounts/acct_001/usage          # current month
curl -s -H "$KEY" "localhost:8000/v1/usage?period=2026-10"            # all accounts, Oct
curl -s -H "$KEY" localhost:8000/v1/admin/review                      # late calls + dead events
curl -s -H "$KEY" -X POST localhost:8000/v1/admin/reconcile           # recompute + drift report
docker compose exec db psql -U callzo -d callzo                       # poke at the tables
```

Interactive API docs are at http://localhost:8000/docs.

**Running one scenario:** run `SIMULATOR_SCENARIO=duplicates docker compose up`, or put the variable in `.env`.

**Starting from an empty database:** run `docker compose down -v`. Usage builds up across runs, so a second `up` finds `acct_001` already capped.

**Running the tests** (they use a real Postgres, in a separate `callzo_test` database):

```bash
docker compose --profile test run --rm tests
```

There are 59 tests. They cover every simulator scenario end to end, plus the retry path, dead-lettering, reconciliation repairing corrupted data, auth, and input validation. Unit tests cover the signature check, the cap arithmetic and the month-boundary maths.

### Configuration and secrets

The application reads all configuration from environment variables (`app/config.py`). Secrets have no defaults in the code: the app refuses to start if `WEBHOOK_SECRET`, `API_KEYS` or `DATABASE_URL` is missing.

To make `docker compose up` work without any setup, `docker-compose.yml` supplies local-dev defaults using `${VAR:-default}`. The default `WEBHOOK_SECRET` is the public test secret from the spec, and compose passes the same variable to the simulator's `--secret` flag, so the two sides can't drift apart. To override any value, copy `.env.example` to `.env`; `.env` is git-ignored. In a real deployment these values would come from a secret manager.

| variable | default | meaning |
|---|---|---|
| `WEBHOOK_SECRET` | spec's test secret | HMAC key for `X-Signature` |
| `API_KEYS` | `local_dev_api_key` | comma-separated bearer keys; listing two lets you rotate keys without downtime |
| `DEFAULT_MONTHLY_CAP_CENTS` | `500` | cap given to an account the first time we see it |
| `PERIOD_GRACE_DAYS` | `3` | how long after month end usage still counts as on time |
| `RETRY_MAX_ATTEMPTS` | `8` | processing attempts before an event is marked `dead` |
| `RECONCILE_INTERVAL_SECONDS` | `300` | how often the worker reconciles |

The 500¢ default is deliberately low: the `cap_burst` scenario (40 calls at 20¢ each) crosses it partway through.

## Assumptions I made

The spec leaves these points open, so I picked an answer for each:

1. **Which month does a call belong to?** The UTC calendar month of its `call.ended` timestamp. That event carries the cost, and using it means a `call.started` arriving late can never move a call between months.
2. **Is `event_id` the only dedupe key?** No. Duplicates are caught twice. Repeats of an `event_id` are absorbed in `raw_events`. A second `call.ended` for the same `call_id`, even with a new `event_id`, overwrites the call instead of adding to it, so it can't double-count.
3. **Do accounts exist up front?** No. An account is created the first time one of its events is processed, with the default cap. The simulator only sends `acct_001` to `acct_010`, but nothing in the code assumes that.
4. **Non-zero cost on `call.started` or `call.failed`?** The spec says these are always 0. If they aren't, the cost is ignored, because only `call.ended` creates cost.
5. **`call.failed` after `call.ended`?** The ended call wins. A call with real duration and cost wasn't a failed call, and I'd rather keep the money than lose it.
6. **Timestamps without a timezone** are rejected with 422. A naive timestamp can't be placed in a billing month.
7. **What "enforce a cap" means for events about calls that already happened** is explained in the next section.

## Design

### Data model: three layers, each derived from the one above

```
raw_events      append-only; one row per event_id; the source of truth
    │ fold (apply_event)
calls           one row per call_id: status, start/end, duration, cost, month, flags
    │ aggregate (recompute_period)
usage_monthly   one row per (account, month): totals, billable, over-cap, late count
```

- **`raw_events`** stores every validated event as received, plus `delivery_count` and processing state (`pending`, `processed` or `dead`, with attempts and the last error). Because nothing upstream is ever deleted, every number in the layers below can be rebuilt from this table.
- **`calls`** is what makes out-of-order delivery simple. Applying an event to a call doesn't depend on order: `started` only fills in `started_at`, `ended` always wins, and `failed` only applies to a call that hasn't ended. A `call.ended` arriving before its `call.started` is just an insert followed by an update.
- **`usage_monthly`** is never incremented. Each time a month changes, it is recomputed from that month's completed calls. That costs a little more per event (one query over at most a few thousand calls per account-month), but it makes the totals the same whatever order events arrived in. It also means the live path and reconciliation can't disagree.
- **Money** is `BIGINT` cents throughout. There are no floats anywhere: Pydantic is in strict mode, so `2.5` or `"2"` for `cost_cents` is a 422.

### Write path and transactions

```
POST /webhooks/calls
  1. size check (16 KiB) → 413
  2. HMAC-SHA256 over the raw body bytes, compared in constant time → 401
  3. strict JSON parse + validation → 400 (not JSON) / 422 (bad fields)
  4. txn A: INSERT raw_events ON CONFLICT (event_id) DO NOTHING
             (conflict → delivery_count += 1, respond 200 "duplicate")
  5. txn B: lock raw event (FOR UPDATE SKIP LOCKED)
            lock account row (FOR UPDATE)
            apply event to calls → recompute affected month(s) → mark processed
            → 200 "processed"
     if txn B throws: attempts += 1, schedule retry → 202 "queued"
```

- The signature is checked before anything else touches the body, including JSON parsing. An unsigned body is untrusted bytes.
- Storing (txn A) and processing (txn B) are separate transactions on purpose. Once txn A commits, the event is durable and we can tell the provider to stop retrying, even if processing hits a bug or a lock timeout. Recovering from there is our job.
- All writes for an account happen under that account's row lock. Concurrent events, worker retries and reconciliation for one account are therefore applied one at a time, and the cap decision can't race. Different accounts never block each other.
- Failures that mean "don't resend this" (bad signature, malformed body) return 4xx. Valid events return 2xx, including ones over the cap; see the next section for why.

### Monthly cap (hard on billing, overshoot of at most one call)

The cap limits what the customer is billed in a month. When the call events arrive, those calls have already happened, so "enforcing" the cap has two parts:

1. **What we bill.** A month's completed calls are walked in the order they ended:
   - A call that ends while billable usage is still under the cap is billed in full, even if it takes usage over the cap.
   - Every call after that is recorded with `over_cap = true` and is not billed. Its cost shows up in `over_cap_cost_cents`.
2. **What we tell the provider.** `GET /v1/accounts/{id}/usage` returns `calls_allowed: false` as soon as billable usage is at or above the cap. The provider (or our own call-routing layer) checks this flag before placing new calls.

At the boundary:

- **Usage lands exactly on the cap:** the cap counts as reached and the next call is over cap.
- **A call crosses the cap:** it is billed in full. I don't prorate part of a call, so billable usage can exceed the cap by at most one call. Charging for half a call the customer actually completed felt worse than a small, bounded overshoot. This is the one way the cap is soft.
- **Cap of 0:** nothing is billed.

Webhooks for calls past the cap still get `200`. The call happened and the record is correct. A 4xx would make the provider retry the event or drop it, and either way we'd lose track of real usage.

Because the walk uses `ended_at` rather than arrival order, the result is deterministic. If an earlier call arrives late, a later call can flip from billable to over-cap. That's the correct answer for "what happened first", and reconciliation gives the same result.

In the simulator run, `acct_001` has 37¢ of normal traffic, then gets the 40-call burst. Calls are billed up to 517¢: the crossing call takes it from 497¢ to 517¢. The remaining 16 calls (320¢) are `over_cap`, `calls_allowed` flips to false, and `cap_reached_at` records the moment.

### Late events

**Policy:** a late call is counted in the month it actually happened, and it is flagged for review if that month had already closed when the event arrived.

- A month "closes" 3 days (`PERIOD_GRACE_DAYS`) after it ends. A `call.ended` received after that point gets `late_arrival = true`.
- Its usage still goes into its real month, so October's numbers stay true to what happened in October.
- It shows up under `GET /v1/admin/review` and in `usage_monthly.late_calls`, so finance can decide whether to issue an adjustment on an invoice that's already gone out.
- It never counts toward the current month's cap.

The simulator's late events are dated 2026-10-04 and arrive on 2026-11-08. They land in October, flagged.

I chose this over the other two options. Booking late usage into the current month is common, but it makes monthly reports wrong. Rejecting late events outright loses money. This way the data stays true and the billing decision stays with a person.

### Retries (background worker)

`python -m app.worker` runs as its own container:

- **Retry loop:** every 5 seconds it picks up `pending` events whose `next_attempt_at` has passed and processes them with the same code as the webhook path.
  - Backoff is exponential (2, 4, 8 … seconds, capped at 10 minutes).
  - After `RETRY_MAX_ATTEMPTS` the event is marked `dead` with its last error. Dead events appear in `/v1/admin/review` and in the `dead_events` count on `/health`.
- **Avoiding a race with the API:** a newly stored event isn't eligible for retry for its first 30 seconds, so the worker doesn't race the request that is processing it inline. `SKIP LOCKED` covers the rest, so you can run more than one worker.

### Reconciliation

`reconcile_account` takes the account lock, deletes the account's `calls` and `usage_monthly` rows, and replays every processed event in `(occurred_at, event_id)` order through the same `apply_event` function the live path uses. It then compares the rebuilt totals with what was stored and returns (and logs) any differences.

- **When it runs:** the worker reconciles every account every 5 minutes, and you can trigger it with `POST /v1/admin/reconcile[?account_id=…]`.
- **Why replay rather than re-query:** there is exactly one definition of what an event does to a call. A separate "reconciliation query" would be a second definition that could quietly disagree with the first.
- **It also applies cap changes.** To change a cap, run `UPDATE accounts SET monthly_cap_cents = …` and then reconcile the account (there's a test for this).

### API and auth

All `/v1` routes need `Authorization: Bearer <key>`. Keys come from `API_KEYS` and are compared in constant time. Path and query parameters are validated by pattern (`acct_…`, `YYYY-MM`), so a bad value is a 422 and never reaches SQL. All SQL is parameterised anyway.

| method | path | |
|---|---|---|
| `POST` | `/webhooks/calls` | HMAC-signed provider webhook (no bearer token) |
| `GET` | `/v1/accounts/{account_id}/usage?period=YYYY-MM` | one account's usage for a month (default: current) |
| `GET` | `/v1/usage?period=YYYY-MM` | every account for a month |
| `POST` | `/v1/admin/reconcile?account_id=` | recompute from raw events; returns drift |
| `GET` | `/v1/admin/review` | late-arriving calls and dead events |
| `GET` | `/health` | 200 if Postgres responds (503 if not), plus pending/dead counts |
| `GET` | `/metrics` | Prometheus: `callzo_webhook_events_total{outcome}`, `callzo_webhook_seconds` |

### Logs and metrics

Every log line is a single JSON object on stdout, written by about 20 lines of stdlib code (`app/logs.py`) rather than a logging library. Each webhook logs its `event_id`, `account_id`, `call_id` and outcome. Rejections log the reason and the field-level errors, but not the payload values.

Prometheus metrics are exposed on `/metrics`, and `/health` doubles as the Docker healthcheck.

## Failure behaviour

| situation | what happens | HTTP |
|---|---|---|
| bad or missing `X-Signature` | rejected before parsing; nothing stored; logged | 401 |
| body > 16 KiB | rejected before reading/verifying | 413 |
| empty body or truncated JSON | rejected; nothing stored | 400 |
| missing fields, wrong types, unknown `event_type`, naive timestamp | rejected with field-level errors | 422 |
| same `event_id` again | `delivery_count` incremented; usage unchanged | 200 `duplicate` |
| same `event_id`, different body | first version kept; warning logged | 200 `duplicate` |
| `call.ended` before `call.started` | call completed on `ended`; `started_at` filled in later | 200 |
| event for a closed month | counted in its own month, flagged `late_arrival`, listed for review | 200 |
| call after the account hit its cap | recorded, `over_cap = true`, not billed | 200 |
| processing throws (bug, lock timeout, …) | event stays `pending`; worker retries with backoff, then marks it `dead` | 202 `queued` |
| Postgres down when the webhook arrives | nothing stored; provider retries | 500 |
| Postgres down for health check | | 503 |
| worker crashes or a loop iteration fails | error logged, loop continues; restart policy restarts the container | |
| stored usage drifts from raw events | the next reconciliation repairs it and logs `reconcile_drift` | |

## Trade-offs

- **Recompute vs increment.** Recomputing an account-month on every `call.ended` is O(calls in that month). That's fine for thousands of calls per account per month, but not for millions. In exchange, totals never depend on arrival order. At higher volume I'd increment in the live path and keep reconciliation as the safety net.
- **Per-account lock.** This serialises all events for one account. It's simple to reason about and rules out cap races, but it caps throughput for a single very busy account. Different accounts never block each other.
- **Account created on first processed event.** An event that is stored but not yet processed doesn't make its account visible, so `/usage` returns 404 for a brand-new account until the worker gets to its first event.
- **Malformed events are logged, not stored.** I didn't add a rejected-events table, so a malformed payload survives only in the logs.
- **Schema is applied on startup** with `CREATE TABLE IF NOT EXISTS` under an advisory lock. That's fine for one version of the schema, but it isn't a migration tool.
- **Process-wide API keys.** Every key can read every account. There are no per-tenant keys or scopes.
- **Some edge cases accept "last write wins".** One example: two different `call.ended` events for the same call with the same timestamp but different costs. The live path keeps whichever arrived last; replay keeps the one with the larger `event_id`. I judged this unlikely enough not to add code for.

## What I'd do next with more time

1. **Alembic migrations** instead of `schema.sql` on startup.
2. **An endpoint to change an account's cap**, which records who changed it and recomputes the current month. Right now this is SQL plus a reconcile.
3. **Per-tenant API keys**, stored hashed with scopes, so a customer can read only their own usage.
4. **Timeouts for stuck calls:** `call.started` with no `ended` after N hours gets flagged. Today such a call simply stays `in_progress`.
5. **Incremental usage updates** with reconciliation as the backstop, once per-account volume makes recompute expensive. I'd also partition `raw_events` by month.
6. **An outbound "cap reached" event** to the provider, so enforcement doesn't depend on them polling `calls_allowed`.
7. **More metrics:** retry queue depth and dead-event count as gauges, reconciliation drift as a counter, and alerts on both.

## Layout

```
app/
  main.py        app factory, request logging, /health, /metrics
  webhooks.py    POST /webhooks/calls: size → signature → validate → store → process
  api.py         authenticated /v1 routes
  ingest.py      store_event, process_event, apply_event (the fold), retry bookkeeping
  usage.py       cap split + recompute_period
  reconcile.py   replay raw events, diff, repair
  worker.py      retry loop + periodic reconciliation
  models.py      strict Pydantic model for the webhook payload
  security.py    HMAC verification, API key check
  periods.py     UTC month and late-arrival maths
  config.py      env parsing, fails fast on missing secrets
  logs.py        JSON log formatter
  schema.sql
tests/           unit + integration (real Postgres)
```
