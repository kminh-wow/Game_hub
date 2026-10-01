"""쿼리도 관전: 방 코드로 들어와 판을 보고, 조작은 못 하고, 방이 닫히면 알림을 받는다."""
import pytest
from fastapi.testclient import TestClient

from quoridor.server.main import app, manager


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class Conn:
    def __init__(self, client):
        self._ctx = client.websocket_connect("/ws")
        self.ws = self._ctx.__enter__()

    def send(self, type_, **data):
        self.ws.send_json({"type": type_, **data})

    def until(self, type_, pred=lambda m: True):
        for _ in range(100):
            msg = self.ws.receive_json()
            if msg["type"] == type_ and pred(msg):
                return msg
        raise AssertionError(f"{type_} 못 받음")

    def close(self):
        self._ctx.__exit__(None, None, None)


def start_match(client):
    a, b = Conn(client), Conn(client)
    a.send("create_room")
    code = a.until("room_created")["code"]
    b.send("join_room", code=code)
    b.until("joined")
    a.until("state")
    return a, b, code


def test_spectator_watches_but_cannot_play(client):
    a, b, code = start_match(client)
    spec = Conn(client)
    spec.send("watch_room", code=code.lower())                   # 소문자로 입력해도 된다
    assert spec.until("watching")["code"] == code
    state = spec.until("state")
    assert state["turn"] == 1 and state["pawns"]["1"] == a_start(state)   # 늦게 들어와도 지금 판을 받는다

    spec.send("move", to=[1, 4])
    assert "참가하지" in spec.until("error")["message"]          # 관전자는 둘 수 없다
    spec.send("chat", text="안녕")
    assert "참가하지" in spec.until("error")["message"]

    a.send("move", to=[1, 4])
    moved = spec.until("state", lambda m: m["turn"] == 2)        # 참가자의 수가 관전자에게도 간다
    assert moved["pawns"]["1"] == [1, 4]
    for conn in (a, b, spec):
        conn.close()


def a_start(state):
    return state["pawns"]["1"]


def test_spectate_unknown_room_and_leave_watch(client):
    spec = Conn(client)
    spec.send("watch_room", code="ZZZZZZ")
    assert "찾을 수 없" in spec.until("error")["message"]

    a, b, code = start_match(client)
    spec.send("watch_room", code=code)
    spec.until("watching")
    assert len(manager.rooms[code].watchers) == 1
    spec.send("leave_watch")
    spec.send("watch_room", code=code)                           # 관전을 끝내면 다시 들어올 수 있다
    spec.until("watching")
    for conn in (a, b, spec):
        conn.close()


def test_spectator_is_told_when_room_closes(client):
    a, b, code = start_match(client)
    spec = Conn(client)
    spec.send("watch_room", code=code)
    spec.until("watching")
    a.close()
    spec.until("opponent_left")                                  # 한 명이 나가면 알려 준다
    b.close()
    spec.until("room_closed")                                    # 모두 나가면 방이 닫혔다고 알려 준다
    assert code not in manager.rooms
    spec.close()


def test_watch_ai_room_and_limit(client, monkeypatch):
    monkeypatch.setattr("quoridor.server.rooms.MAX_WATCHERS", 1)
    a = Conn(client)
    a.send("start_ai_game", difficulty="easy")
    code = a.until("room_created")["code"]
    first, second = Conn(client), Conn(client)
    first.send("watch_room", code=code)
    first.until("watching")
    second.send("watch_room", code=code)
    assert "찾을 수 없" in second.until("error")["message"]      # 관전석이 가득 차면 거절한다
    for conn in (a, first, second):
        conn.close()
