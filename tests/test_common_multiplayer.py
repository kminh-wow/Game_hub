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
