from datetime import datetime, timezone

from tests.helpers import call_pair, post


class TestAuth:
    def test_missing_key_is_401(self, client):
        response = client.get("/v1/usage")
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    def test_wrong_key_is_401(self, client):
        assert client.get("/v1/usage", headers={"Authorization": "Bearer nope"}).status_code == 401

    def test_any_configured_key_works(self, client):
        for key in ("test_key_one", "test_key_two"):
            assert client.get("/v1/usage", headers={"Authorization": f"Bearer {key}"}).status_code == 200

    def test_health_and_metrics_are_public(self, client):
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["database"] == "up"
        assert "callzo_webhook_events_total" in client.get("/metrics").text


class TestValidation:
    def test_bad_period_format(self, client, auth_headers):
        for bad in ("2026-13", "2026-1", "nov", "2026-11-01"):
            response = client.get("/v1/usage", params={"period": bad}, headers=auth_headers)
            assert response.status_code == 422, bad

    def test_bad_account_id(self, client, auth_headers):
        assert client.get("/v1/accounts/not-an-account/usage", headers=auth_headers).status_code == 422

    def test_unknown_account_is_404(self, client, auth_headers):
        assert client.get("/v1/accounts/acct_999/usage", headers=auth_headers).status_code == 404


class TestListUsage:
    def test_lists_every_known_account(self, client, auth_headers):
        now = datetime.now(timezone.utc)
        post(client, call_pair("acct_001", now, 60, 5)[1])
        post(client, call_pair("acct_002", now, 60, 7)[1])

        body = client.get("/v1/usage", headers=auth_headers).json()
        totals = {a["account_id"]: a["billable_cost_cents"] for a in body["accounts"]}
        assert totals == {"acct_001": 5, "acct_002": 7}
