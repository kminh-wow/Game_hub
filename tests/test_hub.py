"""허브에 붙은 두 게임이 하위 경로에서 화면과 WebSocket 모두 동작하는지 확인한다."""
import pytest
from fastapi.testclient import TestClient

from hub.main import app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.mark.parametrize(
    ("path", "needle"),
    [
        ("/", "Game Hub"),
        ("/wordchain/", "끝말잇기 온라인"),
        ("/wordchain/static/app.js", "new URL(\"ws\""),
        ("/quoridor/", "Quoridor"),
        ("/quoridor/net.js", "new URL(\"ws\""),
        ("/quoridor/vendor/three/build/three.module.js", "three"),
    ],
)
def test_pages(client, path, needle):
    r = client.get(path)
    assert r.status_code == 200
    assert needle in r.text


@pytest.mark.parametrize("name", ["wordchain", "quoridor"])
def test_redirect_to_trailing_slash(client, name):
    r = client.get(f"/{name}", follow_redirects=False)
    assert r.status_code in (307, 308)
    assert r.headers["location"] == f"/{name}/"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/wordchain/docs", "/quoridor/docs", "/nothing"])
def test_hidden_pages(client, path):
    assert client.get(path).status_code == 404


def test_quoridor_glb_asset(client):
    r = client.get("/quoridor/assets/models/pawn.glb")
    assert r.status_code == 200 and r.content[:4] == b"glTF"


def test_wordchain_websocket(client):
    with client.websocket_connect("/wordchain/ws?name=tester") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        assert msg["player"]["name"] == "tester"


def test_quoridor_websocket(client):
    with client.websocket_connect("/quoridor/ws") as ws:
        ws.send_json({"type": "create_room"})
        msg = ws.receive_json()
        assert msg["type"] == "room_created"


def test_responses_are_revalidated(client):
    r = client.get("/wordchain/static/app.js")
    assert r.headers["cache-control"] == "no-cache"
    etag = r.headers["etag"]
    assert client.get("/wordchain/static/app.js", headers={"If-None-Match": etag}).status_code == 304
