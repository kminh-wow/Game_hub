"""공통 멀티플레이 서버(common/multiplayer)의 연결 처리."""
from dataclasses import dataclass, replace

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient

from common.multiplayer import BaseRoom, GameServer, create_app

starlette_websockets = pytest.importorskip("starlette.websockets")


@dataclass
class _Settings:
    def copy(self):
        return replace(self)


class _Room(BaseRoom):
    settings_class = _Settings

    def create_game(self):
        raise NotImplementedError


@pytest.fixture
def server_and_client(tmp_path):
    server = GameServer(_Room)
    app = create_app(server, tmp_path, "test")
    with TestClient(app) as client:
        yield server, client


def test_abrupt_disconnect_is_cleaned_up_without_error(server_and_client, monkeypatch):
    """이미 끊긴 연결에서 다시 받으려 하면 새 Starlette 는 WebSocketDisconnected 를 던진다.
    (WebSocketDisconnect 와 다른 예외라서, 잡지 않으면 에러 로그가 남는다.) 정리는 정상으로 돼야 한다."""
    server, client = server_and_client
    disconnected = getattr(starlette_websockets, "WebSocketDisconnected", None)
    if disconnected is None:
        pytest.skip("이 Starlette 에는 WebSocketDisconnected 가 없다")

    async def receive_text(self):
        raise disconnected('WebSocket is not connected. Need to call "accept" first.')

    monkeypatch.setattr(WebSocket, "receive_text", receive_text)
    with client.websocket_connect("/ws?name=abrupt&token=t") as ws:
        assert ws.receive_json()["type"] == "welcome"
    assert server.players == {}      # 에러가 나더라도 퇴장 정리는 끝까지 된다


def test_normal_disconnect_removes_player(server_and_client):
    server, client = server_and_client
    with client.websocket_connect("/ws?name=normal&token=t") as ws:
        assert ws.receive_json()["type"] == "welcome"
        assert len(server.players) == 1
    assert server.players == {}


# ---- 게임 기록 ----

@pytest.fixture
def game_log():
    import logging

    from common.multiplayer.log import log

    records = []

    class Keep(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = Keep()
    log.addHandler(handler)
    yield records
    log.removeHandler(handler)


def _lines(records):
    return [r.getMessage() for r in records]


def _until(ws, kind):
    for _ in range(50):
        m = ws.receive_json()
        if m["type"] == kind:
            return m
    raise AssertionError(kind)


def test_connect_room_and_leave_are_logged(server_and_client, game_log):
    _, client = server_and_client
    with client.websocket_connect("/ws?name=logger&token=t") as ws:
        _until(ws, "welcome")
        ws.send_json({"type": "create_room", "title": "기록방"})
        _until(ws, "room")
        ws.send_json({"type": "leave_room"})
        _until(ws, "lobby")
    lines = _lines(game_log)
    assert any("접속 logger" in l for l in lines)
    assert any("방 만듦 '기록방' 방장 logger" in l and l.startswith("[test #") for l in lines)
    assert any("입장 logger" in l for l in lines)
    assert any("나감 logger" in l for l in lines) and any("방 닫힘" in l for l in lines)
    assert any("접속 끊김 logger" in l for l in lines)


def test_browser_errors_are_logged_with_limit(server_and_client, game_log):
    import logging

    _, client = server_and_client
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1"
    with client.websocket_connect("/ws?name=crash&token=t") as ws:
        _until(ws, "welcome")
        for i in range(25):
            ws.send_json({"type": "client_error", "message": f"화면: boom {i}", "stack": "at draw\nat tick", "ua": ua})
        ws.send_json({"type": "ping"})
        ws.send_json({"type": "chat", "text": "끝"})
        _until(ws, "chat")
    errors = [r for r in game_log if r.levelno == logging.WARNING]
    assert len(errors) == 20                                 # 접속 하나당 20개까지만
    line = errors[0].getMessage()
    assert "브라우저 오류 crash (모바일 사파리 17): 화면: boom 0 | at draw / at tick" in line


def test_server_error_in_action_keeps_connection(tmp_path, game_log):
    async def explode(room, player, msg):
        raise RuntimeError("터짐")

    class Game:
        async def start(self):
            pass

        async def finish(self):
            pass

        async def remove_player(self, player):
            pass

    class Room(_Room):
        min_players = 1

        def create_game(self):
            return Game()

    server = GameServer(Room, actions={"boom": explode})
    with TestClient(create_app(server, tmp_path, "Fortress")) as client:
        with client.websocket_connect("/ws?name=bug&token=t") as ws:
            _until(ws, "welcome")
            ws.send_json({"type": "create_room", "title": "x"})
            _until(ws, "room")
            ws.send_json({"type": "start"})
            ws.send_json({"type": "boom"})
            assert "서버에서 오류" in _until(ws, "error")["message"]
            ws.send_json({"type": "chat", "text": "아직 연결됨"})
            assert _until(ws, "chat")["text"] == "아직 연결됨"
    lines = _lines(game_log)
    assert any(l.startswith("[포트리스 #") and "서버 오류 bug 메시지 boom" in l for l in lines)
    assert any("게임 시작 · bug" in l for l in lines)
