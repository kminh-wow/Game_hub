"""관전: 늦게 들어와도 진행 상황(시작 → 라운드 → 지금 차례)을 받고, 낱말은 관전자에게도 간다."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, dictionary


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class Conn:
    def __init__(self, client, name):
        self.name = name
        self._ctx = client.websocket_connect(f"/ws?name={name}&token={name}")
        self.ws = self._ctx.__enter__()
        self.id = self.until("welcome")["player"]["id"]

    def send(self, type_, **data):
        self.ws.send_json({"type": type_, **data})

    def until(self, type_, pred=lambda m: True):
        for _ in range(300):
            msg = self.ws.receive_json()
            if msg["type"] == type_ and pred(msg):
                return msg
        raise AssertionError(f"{self.name}: {type_} 못 받음")

    def close(self):
        self._ctx.__exit__(None, None, None)


def test_spectator_gets_progress_and_words(client):
    tag = uuid.uuid4().hex[:5]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title=f"관전-{tag}")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: len(m["room"]["players"]) == 2 and m["room"]["players"][1]["ready"])
    a.send("start")
    turn = a.until("turn")
    players = {a.id: a, b.id: b}

    spec = Conn(client, f"w{tag}")
    spec.send("spectate_room", room_id=room_id)
    room = spec.until("room")["room"]
    assert room["playing"] and [s["id"] for s in room["spectators"]] == [spec.id]
    start = spec.until("game_start")                            # 늦게 들어와도 진행 상황을 차례로 받는다
    assert start["order"] == [a.id, b.id]
    rnd = spec.until("round_start")
    assert rnd["round"] == 1 and rnd["chain"] == [rnd["start_word"]]
    watched = spec.until("turn")
    assert watched["player_id"] == turn["player_id"] and 0 < watched["turn_left_ms"] <= watched["turn_limit_ms"]

    spec.send("submit_word", word="사과")
    assert "관전 중" in spec.until("error")["message"]
    spec.send("ready")
    assert "관전 중" in spec.until("error")["message"]

    word = next(w for c in turn["chars"] for w in sorted(dictionary._by_first.get(c, ())) if len(w) <= 3)
    players[turn["player_id"]].send("submit_word", word=word)
    ok = spec.until("word_ok")                                  # 낱말이 관전자에게도 간다
    assert ok["word"] == word
    for conn in (a, b, spec):
        conn.close()
