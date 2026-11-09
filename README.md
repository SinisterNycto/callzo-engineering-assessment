# Callzo engineering assessment

Two independent projects, one folder each. Each has its own `docker-compose.yml` and README.

| folder | task | run | then |
|---|---|---|---|
| [`task1-usage-metering/`](task1-usage-metering/) | Backend: webhook ingestion, usage metering, monthly cap (FastAPI + Postgres) | `cd task1-usage-metering && docker compose up` | the bundled simulator runs every scenario against the API; inspect at http://localhost:8000/docs |
| [`task2-admin-console/`](task2-admin-console/) | UI: usage admin console (React + Tailwind + Recharts) | `cd task2-admin-console && docker compose up` | open http://localhost:3000 |

Both start with that one command and need no other setup. They use different ports (8000/5432-internal vs 3000/8001), so they can run side by side.

- Task 1 tests: `docker compose --profile test run --rm tests` (59 tests, real Postgres)
- Task 2 tests: `npm ci && npm test` (35 unit tests)

The design decisions, failure behaviour, trade-offs and what I'd do next are in each task's README.
