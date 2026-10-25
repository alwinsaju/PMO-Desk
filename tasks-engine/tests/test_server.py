"""The service shell: identity probe, loopback-only CORS, the --port launch argument."""
import sys
import types

import pytest
from fastapi.testclient import TestClient

import main as engine


def client():
    return TestClient(engine.app, raise_server_exceptions=False)


def test_health_identifies_the_service():
    assert client().get("/health").json() == {"ok": True, "service": "tasks-engine"}


@pytest.mark.parametrize("origin", [
    "http://127.0.0.1:3100", "http://localhost:3000", "http://localhost", "http://[::1]:8123",
])
def test_cors_allows_loopback_pages(origin):
    resp = client().get("/health", headers={"Origin": origin})
    assert resp.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize("origin", [
    "https://evil.example", "http://localhost.evil.example", "http://127.0.0.1.evil.example:3100",
    "http://192.168.1.20:3100", "https://127.0.0.1:3100",
])
def test_cors_refuses_everything_else(origin):
    resp = client().get("/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in resp.headers


def test_removed_office_endpoints_are_gone():
    c = client()
    for method, path in [
        ("get", "/agents"), ("get", "/agents/adam/health"), ("get", "/agents/adam/metrics"),
        ("post", "/tasks/rescan"), ("get", "/tasks/candidate-folders"), ("post", "/tasks/inspect"),
        ("post", "/tasks/x/schedule"), ("post", "/tasks/x/rename"),
    ]:
        assert getattr(c, method)(path).status_code in (404, 405), path


def test_main_serves_on_loopback_on_the_given_port(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, "uvicorn", types.SimpleNamespace(run=lambda *a, **kw: calls.append((a, kw))))

    engine.main(["--port", "8123"])

    (args, kwargs), = calls
    assert args == (engine.app,)
    assert kwargs["host"] == "127.0.0.1" and kwargs["port"] == 8123


def test_main_requires_a_port(capsys):
    with pytest.raises(SystemExit) as exc:
        engine.main([])
    assert exc.value.code == 2
    assert "--port" in capsys.readouterr().err
