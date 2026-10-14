"""박스헤드 같이 하기: 방장 중계(입력→방장, 화면 값→나머지), 방장 나감, 관전, 잘못된 메시지."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


OPEN: list["Conn"] = []


class Conn:
    """웹소켓 하나 (받은 메시지를 쌓아 두고 원하는 것을 기다린다)."""

    def __init__(self, client, name):
        self.name = name
        self.open = True
        self.ws = client.websocket_connect(f"/ws?name={name}&token={name}").__enter__()
        self.inbox = []
        OPEN.append(self)
        self.id = self.until("welcome")["player"]["id"]

    def send(self, type, **data):
        self.ws.send_json({"type": type, **data})

    def until(self, type, pred=lambda m: True, limit=60):
        for i, m in enumerate(self.inbox):
            if m["type"] == type and pred(m):
                return self.inbox.pop(i)
        for _ in range(limit):
            m = self.ws.receive_json()
            if m["type"] == type and pred(m):
                return m
            self.inbox.append(m)
        raise AssertionError(f"{self.name}: {type} 메시지가 안 옴")

    def close(self):
        if self.open:
            self.open = False
            self.ws.__exit__(None, None, None)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
        while OPEN:                                          # 남은 연결을 닫아야 테스트가 끝남
            OPEN.pop().close()


def start_room(client, n=2):
    tag = uuid.uuid4().hex[:5]
    conns = [Conn(client, f"{'abcd'[i]}{tag}") for i in range(n)]
    host = conns[0]
    host.send("create_room", title=f"방-{tag}", max_players=4)
    room_id = host.until("room")["room"]["id"]
    for c in conns[1:]:
        c.send("join_room", room_id=room_id)
        c.until("room")
        c.send("ready")
    host.until("room", lambda m: len(m["room"]["players"]) == n and all(p["ready"] for p in m["room"]["players"][1:]))
    host.send("start")
    metas = [c.until("game")["game"] for c in conns]
    return conns, metas, room_id


def test_start_tells_everyone_host_and_seed(client):
    conns, metas, _ = start_room(client, 3)
    assert all(m == metas[0] for m in metas)
    assert metas[0]["host_id"] == conns[0].id
    assert [p["id"] for p in metas[0]["players"]] == [c.id for c in conns]
    assert 0 <= metas[0]["seed"] < 2**32


def test_needs_two_players(client):
    tag = uuid.uuid4().hex[:5]
    a = Conn(client, "solo" + tag)
    a.send("create_room", title="혼자")
    a.until("room")
    a.send("start")
    assert "2명" in a.until("error")["message"]


def test_input_goes_to_host_only(client):
    (host, guest, other), _, _ = start_room(client, 3)
    guest.send("input", input={"dx": 1, "dy": -1, "fire": True, "lock": False})
    msg = host.until("input")
    assert msg["id"] == guest.id and msg["input"]["dx"] == 1 and msg["input"]["fire"] is True
    host.send("input", input={"dx": 1})                      # 방장이 보낸 입력은 무시
    guest.send("chat", text="확인용")
    other.until("chat")
    assert not any(m["type"] == "input" for m in other.inbox)


def test_snap_goes_to_everyone_but_host_and_guest_cannot_send_it(client):
    (host, guest, other), _, _ = start_room(client, 3)
    host.send("snap", snap={"t": 1.5, "sc": 40})
    assert guest.until("snap")["snap"]["sc"] == 40
    assert other.until("snap")["snap"]["sc"] == 40
    guest.send("snap", snap={"t": 9, "sc": 999999})           # 방장이 아니면 무시
    host.send("snap", snap={"t": 2, "sc": 41})
    assert other.until("snap")["snap"]["sc"] == 41
    assert not any(m["type"] == "snap" and m["snap"]["sc"] == 999999 for m in other.inbox)


def test_oversized_or_bad_messages_are_ignored(client):
    (host, guest), _, _ = start_room(client, 2)
    host.send("snap", snap={"big": "x" * 200_000})
    host.send("snap", snap="문자열")
    guest.send("input", input="문자열")
    host.send("snap", snap={"sc": 1})
    assert guest.until("snap")["snap"] == {"sc": 1}


def test_over_ends_game_and_records_best(client):
    (host, guest), _, _ = start_room(client, 2)
    guest.send("over", result={"score": 5})                   # 방장이 아니면 무시
    host.send("over", result={"score": 1234, "level": 5, "kills": 40, "time": 150})
    over = guest.until("game_over")
    assert (over["score"], over["level"], over["kills"], over["time"]) == (1234, 5, 40, 150)
    room = guest.until("room", lambda m: m["room"]["best"] == 1234)["room"]
    assert not room["playing"]


def test_host_leaving_ends_game(client):
    (host, guest), _, _ = start_room(client, 2)
    host.close()
    over = guest.until("game_over")
    assert over["reason"] == "host_left"


def test_guest_leaving_keeps_game_going(client):
    (host, guest), _, _ = start_room(client, 2)
    guest.send("leave_room")
    host.until("room", lambda m: len(m["room"]["players"]) == 1)
    host.send("snap", snap={"sc": 3})
    assert not any(m["type"] == "game_over" for m in host.inbox)


def test_spectator_gets_meta_and_latest_snap(client):
    (host, guest), _, room_id = start_room(client, 2)
    host.send("snap", snap={"sc": 77})
    guest.until("snap")
    w = Conn(client, "w" + uuid.uuid4().hex[:5])
    w.send("spectate_room", room_id=room_id)
    assert w.until("game")["game"]["host_id"] == host.id
    assert w.until("snap")["snap"]["sc"] == 77
    host.send("snap", snap={"sc": 78})
    assert w.until("snap")["snap"]["sc"] == 78
    w.send("input", input={"dx": 1})                          # 관전자 조작은 막힘
    assert "관전" in w.until("error")["message"]
