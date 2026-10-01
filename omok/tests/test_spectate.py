"""관전: 늦게 들어와도 현재 판을 보고, 조작은 못 하고, 참가자가 모두 나가면 로비로 돌아간다."""
import uuid

import pytest
from fastapi.testclient import TestClient
from test_omok import Conn

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def open_room(client, start=True):
    """방을 만들어 두 명이 들어가고(시작 옵션), 방 제목과 흑·백 참가자를 돌려준다."""
    tag = uuid.uuid4().hex[:5]
    title = f"관전-{tag}"
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title=title)
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: len(m["room"]["players"]) == 2 and m["room"]["players"][1]["ready"])
    black = white = None
    if start:
        a.send("start")
        g = a.game()
        black = a if g["black"]["id"] == a.id else b
        white = b if black is a else a
    return a, b, black, white, room_id


def watch(client, room_id, name=None):
    spec = Conn(client, name or "w" + uuid.uuid4().hex[:5])
    spec.send("spectate_room", room_id=room_id)
    return spec


def test_spectator_sees_game_but_cannot_play(client):
    a, b, black, white, room_id = open_room(client)
    spec = Conn(client, "w" + uuid.uuid4().hex[:5])
    card = next(r for r in spec.until("lobby", lambda m: any(r["id"] == room_id for r in m["rooms"]))["rooms"] if r["id"] == room_id)
    assert card["playing"] and card["spectators"] == 0

    spec.send("spectate_room", room_id=room_id)
    room = spec.until("room")["room"]
    assert room["playing"] and [s["id"] for s in room["spectators"]] == [spec.id]
    assert spec.game()["move_count"] == 0                       # 늦게 들어와도 지금 판을 바로 받는다
    a.until("room", lambda m: len(m["room"]["spectators"]) == 1)  # 참가자 화면에도 관전자가 보인다

    black.send("place", x=7, y=7)
    assert spec.game(lambda g: g["move_count"] == 1)["last"] == [7, 7]   # 둔 수가 관전자에게도 간다

    for kind, data in [("place", {"x": 0, "y": 0}), ("resign", {}), ("ready", {}), ("start", {}),
                       ("update_settings", {"settings": {"turn_time": 99}})]:
        spec.send(kind, **data)
        assert "관전 중" in spec.until("error")["message"], kind

    spec.send("chat", text="안녕")                                 # 채팅은 할 수 있고, 관전 표시가 붙는다
    chat = black.until("chat")
    assert chat["text"] == "안녕" and chat["spectator"] is True

    white.send("place", x=7, y=8)                                # 관전자의 시도가 판에 영향을 주지 않았다
    assert spec.game(lambda g: g["move_count"] == 2)["board"][8][7] == 2

    spec.send("leave_room")
    assert spec.until("room", lambda m: m["room"] is None)
    a.until("room", lambda m: m["room"] and m["room"]["spectators"] == [])
    for conn in (a, b, spec):
        conn.close()


def test_spectator_in_waiting_room_gets_game_when_it_starts(client):
    a, b, _, _, room_id = open_room(client, start=False)         # 2/2 이라 꽉 찬 대기실
    spec = watch(client, room_id)
    assert spec.until("room")["room"]["playing"] is False
    a.send("start")
    assert spec.game()["move_count"] == 0
    for conn in (a, b, spec):
        conn.close()


def test_spectators_return_to_lobby_when_everyone_leaves(client):
    a, b, _, _, room_id = open_room(client)
    spec = watch(client, room_id)
    spec.until("room")
    a.close()                                                    # 도중에 나가면 상대 승, 방은 남는다
    spec.until("game_over")
    b.close()                                                    # 참가자가 모두 나가면 방이 닫힌다
    assert spec.until("room", lambda m: m["room"] is None)
    assert "방이 닫혔어요" in spec.until("error")["message"]
    spec.close()


def test_spectator_limit(client, monkeypatch):
    monkeypatch.setattr("common.multiplayer.room.MAX_SPECTATORS", 1)
    a, b, _, _, room_id = open_room(client)
    first = watch(client, room_id)
    first.until("room")
    second = watch(client, room_id)
    assert "가득" in second.until("error")["message"]
    for conn in (a, b, first, second):
        conn.close()
