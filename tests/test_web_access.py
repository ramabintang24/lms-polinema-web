"""Access gate for the hosted web UI."""

from fastapi.testclient import TestClient

from lms_polinema_mcp.api import app
from lms_polinema_mcp.auth.credentials import CredentialStore


def test_health_is_open_without_access_key(monkeypatch):
    monkeypatch.delenv("LMS_POLINEMA_ACCESS_KEY", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json()["access"] == "open"


def test_data_routes_reject_a_missing_or_wrong_key(monkeypatch):
    monkeypatch.setenv("LMS_POLINEMA_ACCESS_KEY", "correct-key")
    client = TestClient(app)

    missing = client.get("/api/courses")
    assert missing.status_code == 401
    assert missing.json()["code"] == "access"

    wrong = client.get("/api/courses", headers={"X-LMS-Access-Key": "nope"})
    assert wrong.status_code == 401

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["access"] == "required"


def test_cookie_and_header_match_the_access_key(monkeypatch):
    monkeypatch.setenv("LMS_POLINEMA_ACCESS_KEY", "correct-key")
    from lms_polinema_mcp.api import access_granted

    class Request:
        def __init__(self, headers=None, cookies=None):
            self.headers = headers or {}
            self.cookies = cookies or {}

    assert access_granted(Request(headers={"x-lms-access-key": "correct-key"}))
    assert access_granted(Request(cookies={"lms_access": "correct-key"}))
    assert not access_granted(Request(cookies={"lms_access": "wrong"}))


def test_env_credentials_override_the_file(monkeypatch):
    monkeypatch.setenv("LMS_POLINEMA_NIM", "000")
    monkeypatch.setenv("LMS_POLINEMA_PASSWORD", "not-the-real-password")
    store = CredentialStore()
    assert store.exists()
    assert store.load() == ("000", "not-the-real-password")
