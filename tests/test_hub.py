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
        ("/", "Ddan Jit"),
        ("/wordchain/", "끝말잇기 온라인"),
        ("/wordchain/static/app.js", "new URL(\"ws\""),
        ("/quoridor/", "Quoridor"),
        ("/quoridor/net.js", "new URL(\"ws\""),
        ("/quoridor/vendor/three/build/three.module.js", "three"),
        ("/pacman/", "팩맨"),
        ("/pacman/game.js", "./logic.js"),
        ("/pacman/logic.js", "export const MAZE"),
        ("/hangman/", "행맨"),
        ("/hangman/static/app.js", "new URL(\"ws\""),
        ("/omok/", "오목"),
        ("/omok/static/app.js", "GameLobby.init"),
        ("/common/lobby.js", "new URL(\"ws\""),
        ("/yacht/", "요트"),
        ("/yacht/static/app.js", "GameLobby.init"),
    ],
)
def test_pages(client, path, needle):
    r = client.get(path)
    assert r.status_code == 200
    assert needle in r.text


@pytest.mark.parametrize("name", ["wordchain", "quoridor", "pacman", "hangman", "omok", "yacht"])
def test_redirect_to_trailing_slash(client, name):
    r = client.get(f"/{name}", follow_redirects=False)
    assert r.status_code in (307, 308)
    assert r.headers["location"] == f"/{name}/"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/wordchain/docs", "/quoridor/docs", "/pacman/docs", "/hangman/docs", "/omok/docs", "/yacht/docs", "/nothing"])
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


def test_hangman_websocket(client):
    with client.websocket_connect("/hangman/ws?name=hubtester&token=t") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome" and msg["word_count"] > 100_000


def test_omok_websocket(client):
    with client.websocket_connect("/omok/ws?name=hubomok&token=t") as ws:
        assert ws.receive_json()["type"] == "welcome"


def test_yacht_websocket(client):
    with client.websocket_connect("/yacht/ws?name=hubyacht&token=t") as ws:
        assert ws.receive_json()["type"] == "welcome"


def test_all_games_loaded():
    """배포 전에 이 테스트가 실패하면 어떤 게임이 왜 못 뜨는지 알 수 있다 (예: 요트 다이스의 pybullet 누락)."""
    from hub.main import FAILED_GAMES, GAME_MODULES, GAMES

    assert FAILED_GAMES == {}
    assert set(GAMES) == set(GAME_MODULES)


def test_one_broken_game_does_not_take_down_the_hub():
    from hub.main import load_games

    games, failed = load_games({"ok": "pacman.app", "broken": "no_such_module_for_test"})
    assert "ok" in games
    assert list(failed) == ["broken"] and "ModuleNotFoundError" in failed["broken"]
