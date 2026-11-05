"""The service shell: identity probe, loopback-only CORS, the request guard (Host, Origin,
token) and the --port launch argument."""
import sys
import types

import pytest
from conftest import make_client

import main as engine

client = make_client
TOKEN = "s3cret-token"


def test_health_identifies_the_service():
    assert client().get("/health").json() == {"ok": True, "service": "tasks-engine", "instance": None}


def test_health_echoes_the_launch_instance_id(monkeypatch):
    monkeypatch.setenv(engine.INSTANCE_ENV, "launch-1234")
    assert client().get("/health").json()["instance"] == "launch-1234"


def test_health_instance_is_null_when_the_variable_is_empty(monkeypatch):
    monkeypatch.setenv(engine.INSTANCE_ENV, "")
    assert client().get("/health").json()["instance"] is None


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


@pytest.mark.parametrize("base_url", [
    "http://127.0.0.1:8000", "http://127.0.0.1", "http://localhost:8123", "http://LOCALHOST:8000",
])
def test_guard_accepts_loopback_hosts(base_url):
    assert client(base_url=base_url).get("/health").status_code == 200


def test_guard_accepts_the_ipv6_loopback_host_header():
    # TestClient cannot take an IPv6 base_url, so the Host header is set directly
    assert client().get("/health", headers={"Host": "[::1]:8000"}).status_code == 200
    assert client().get("/health", headers={"Host": "[::1]x"}).status_code == 403
    assert client().get("/health", headers={"Host": "[::2]:8000"}).status_code == 403


@pytest.mark.parametrize("base_url", [
    "http://evil.example", "http://evil.example:8000", "http://127.0.0.1.evil.example:8000",
    "http://localhost.evil.example", "http://192.168.1.20:8000", "http://0.0.0.0:8000", "http://testserver",
])
def test_guard_refuses_any_other_host_header(base_url):
    resp = client(base_url=base_url).get("/health")

    assert resp.status_code == 403
    body = resp.json()
    assert body["ok"] is False and "127.0.0.1" in body["reason"]


def test_guard_refuses_a_bad_host_on_every_method_and_route():
    c = client(base_url="http://evil.example:8000")
    for method, path in [("get", "/tasks"), ("post", "/tasks/x/approve"), ("options", "/tasks"), ("head", "/health")]:
        assert getattr(c, method)(path).status_code == 403, (method, path)


@pytest.mark.parametrize("origin", [
    "https://evil.example", "http://localhost.evil.example", "http://192.168.1.20:3100", "https://127.0.0.1:3100", "null",
])
@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_guard_refuses_a_changing_request_from_a_foreign_origin(method, origin):
    resp = getattr(client(), method)("/tasks/ghost/approve", headers={"Origin": origin})

    assert resp.status_code == 403
    assert resp.json()["ok"] is False and "web pages" in resp.json()["reason"]


@pytest.mark.parametrize("origin", ["http://127.0.0.1:3100", "http://localhost:3000", "http://[::1]:8123"])
def test_guard_lets_a_loopback_page_post(origin):
    resp = client().post("/tasks/ghost/approve", headers={"Origin": origin})

    assert resp.status_code == 200 and resp.json() == {"ok": False, "reason": "unknown task"}


def test_guard_lets_a_post_without_an_origin_header_through():
    # the Electron shell, curl and the launcher send no Origin
    assert client().post("/tasks/ghost/approve").json() == {"ok": False, "reason": "unknown task"}


def test_guard_does_not_origin_check_reads():
    resp = client().get("/tasks", headers={"Origin": "https://evil.example"})

    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers  # CORS still keeps the page from reading it


def test_token_is_not_required_when_the_variable_is_unset_or_empty(monkeypatch):
    assert client().get("/tasks").status_code == 200
    monkeypatch.setenv(engine.TOKEN_ENV, "")
    assert client().get("/tasks").status_code == 200
    assert client().post("/tasks/ghost/start").status_code == 200


@pytest.mark.parametrize("headers", [{}, {engine.TOKEN_HEADER: "wrong"}, {engine.TOKEN_HEADER: ""},
                                     {engine.TOKEN_HEADER: TOKEN + "x"}, {engine.TOKEN_HEADER: TOKEN[:-1]}])
@pytest.mark.parametrize("method, path", [("get", "/tasks"), ("post", "/tasks/ghost/approve"), ("get", "/tasks/ghost/log")])
def test_token_missing_or_wrong_is_refused(monkeypatch, method, path, headers):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    resp = getattr(client(), method)(path, headers=headers)

    assert resp.status_code == 403
    assert resp.json()["ok"] is False and "token" in resp.json()["reason"]


def test_the_right_token_is_accepted(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)
    c = client()
    headers = {engine.TOKEN_HEADER: TOKEN}

    assert c.get("/tasks", headers=headers).status_code == 200
    assert c.post("/tasks/ghost/approve", headers=headers).json() == {"ok": False, "reason": "unknown task"}


def test_token_comparison_is_constant_time(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)
    calls = []
    real = engine.hmac.compare_digest
    monkeypatch.setattr(engine.hmac, "compare_digest", lambda a, b: (calls.append((a, b)), real(a, b))[1])

    client().get("/tasks", headers={engine.TOKEN_HEADER: TOKEN})

    assert calls == [(TOKEN.encode(), TOKEN.encode())]


def test_a_non_ascii_token_header_is_refused_not_a_crash(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    resp = client().get("/tasks", headers={engine.TOKEN_HEADER.encode(): "t\u00f6ken".encode("utf-8")})

    assert resp.status_code == 403


def test_health_needs_no_token(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    assert client().get("/health").json()["service"] == "tasks-engine"


def test_health_is_exempt_only_for_get_and_head(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    assert client().head("/health").status_code == 200
    assert client().get("/health").status_code == 200
    assert client().post("/health").status_code == 403
    assert client().head("/tasks").status_code == 403


def test_preflight_needs_no_token_and_allows_the_token_header(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    resp = client().options("/tasks/x/approve", headers={
        "Origin": "http://127.0.0.1:3100",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-ai-os-token, content-type",
    })

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://127.0.0.1:3100"
    assert "x-ai-os-token" in resp.headers["access-control-allow-headers"].lower()


def test_a_plain_options_request_needs_no_token_but_still_needs_a_loopback_host(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    assert client().options("/tasks").status_code != 403
    assert client(base_url="http://evil.example").options("/tasks").status_code == 403


def test_a_refusal_still_carries_cors_headers_so_the_page_can_read_it(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)

    resp = client().get("/tasks", headers={"Origin": "http://127.0.0.1:3100"})

    assert resp.status_code == 403
    assert resp.headers["access-control-allow-origin"] == "http://127.0.0.1:3100"


def test_refusal_order_is_host_then_origin_then_token(monkeypatch):
    monkeypatch.setenv(engine.TOKEN_ENV, TOKEN)
    foreign = {"Origin": "https://evil.example"}

    assert "127.0.0.1" in client(base_url="http://evil.example").post("/tasks/x/start", headers=foreign).json()["reason"]
    assert "web pages" in client().post("/tasks/x/start", headers=foreign).json()["reason"]
    assert "token" in client().post("/tasks/x/start").json()["reason"]


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
    assert kwargs["access_log"] is False  # the 2-second poll must not fill the launch log


def test_main_requires_a_port(capsys):
    with pytest.raises(SystemExit) as exc:
        engine.main([])
    assert exc.value.code == 2
    assert "--port" in capsys.readouterr().err
