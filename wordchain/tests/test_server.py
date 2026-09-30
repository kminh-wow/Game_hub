"""접속 관리: 닉네임 중복, 같은 브라우저 이어받기, 빈 방 정리."""
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app, server


@pytest.fixture
def client():
    return TestClient(app)


def unique_name() -> str:
    return "t" + uuid.uuid4().hex[:6]


def connect(client, name, token):
    ws = client.websocket_connect(f"/ws?name={name}&token={token}")
    conn = ws.__enter__()
    return ws, conn


def receive_until(conn, msg_type):
    while True:
        msg = conn.receive_json()
        if msg["type"] == msg_type:
            return msg


def test_duplicate_name_rejected(client):
    name = unique_name()
    ws1, c1 = connect(client, name, "token-a")
    receive_until(c1, "welcome")
    with pytest.raises(WebSocketDisconnect) as err:
        with client.websocket_connect(f"/ws?name={name.upper()}&token=token-b") as c2:
            c2.receive_json()
    assert err.value.code == 4001
    ws1.__exit__(None, None, None)


def test_same_browser_takes_over_and_empty_room_removed(client):
    name = unique_name()
    ws1, c1 = connect(client, name, "same-token")
    receive_until(c1, "welcome")
    c1.send_json({"type": "create_room", "title": "빈 방 테스트"})
    room_id = receive_until(c1, "room")["room"]["id"]
    assert room_id in server.rooms

    ws2, c2 = connect(client, name, "same-token")
    assert receive_until(c2, "welcome")["player"]["name"] == name
    assert receive_until(c1, "kicked")

    same_name = [p for p in server.players.values() if p.name == name]
    assert len(same_name) == 1
    assert room_id not in server.rooms  # 예전 연결만 있던 방은 사라진다

    ws2.__exit__(None, None, None)
    ws1.__exit__(None, None, None)


def test_room_removed_when_last_player_disconnects(client):
    name = unique_name()
    with client.websocket_connect(f"/ws?name={name}&token=x") as c:
        receive_until(c, "welcome")
        c.send_json({"type": "create_room"})
        room_id = receive_until(c, "room")["room"]["id"]
        assert room_id in server.rooms
    assert room_id not in server.rooms
    assert all(p.name != name for p in server.players.values())
