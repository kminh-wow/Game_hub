"""턴제 FPS 대전 흐름: 차례, 이동·시선·발사, 무기 개수, 시간 초과, AI, 관전, 퇴장."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.world import MOVE_MAX


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
        for _ in range(500):
            msg = self.ws.receive_json()
            if msg["type"] == type_ and pred(msg):
                return msg
        raise AssertionError(f"{self.name}: {type_} 못 받음")

    def game(self, pred=lambda g: True):
        return self.until("game", lambda m: pred(m["game"]))

    def close(self):
        self._ctx.__exit__(None, None, None)


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    import app.game as game_module
    monkeypatch.setattr(game_module, "SHOT_MS", 50)
    monkeypatch.setattr(game_module, "BLAST_MS", 50)
    monkeypatch.setattr(game_module, "AI_THINK", 0.02)
    monkeypatch.setattr(game_module, "AI_AIM", 0.02)
    monkeypatch.setattr(game_module, "AI_STEP", 0.0)


def pair(client):
    tag = uuid.uuid4().hex[:5]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title=f"총-{tag}")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: m["room"]["players"][1]["ready"])
    a.send("start")
    g = a.game()["game"]
    b.game()
    cur, other = (a, b) if g["current_id"] == a.id else (b, a)
    return a, b, cur, other, room_id, g


def me_of(g, pid):
    return next(s for s in g["soldiers"] if s["id"] == pid)


def test_turns_move_look_and_fire(client):
    a, b, cur, other, _, g = pair(client)
    assert len(g["soldiers"]) == 2 and len(g["boxes"]) > 4 and g["move_left"] == MOVE_MAX

    other.send("fire", weapon="rifle", yaw=0, pitch=0)
    assert "차례" in other.until("error")["message"]

    start = me_of(g, cur.id)
    cur.send("move", dx=0.5, dz=0)
    m = other.until("soldier")
    moved = abs(m["soldier"]["x"] - start["x"]) + abs(m["soldier"]["z"] - start["z"])
    assert m["move_left"] == pytest.approx(MOVE_MAX - moved, abs=0.01)
    cur.send("move", dx=50, dz=0)                                    # 한 번에 멀리는 못 감
    m = other.until("soldier")
    assert m["move_left"] >= MOVE_MAX - moved - 0.61

    cur.send("look", yaw=1.0, pitch=9)
    m = other.until("look")
    assert m["pitch"] == pytest.approx(1.45)                       # 위아래 한계

    cur.send("fire", weapon="rifle", yaw=0.3, pitch=-0.2)
    m = other.game(lambda g: g["acting"])
    shot = next(e for e in m["events"] if e["kind"] == "shot")
    assert shot["weapon"] == "rifle" and len(shot["from"]) == 3 and len(shot["to"]) == 3
    cur.send("fire", weapon="rifle", yaw=0, pitch=0)
    assert "기다려" in cur.until("error")["message"]
    other.game(lambda g: not g["acting"] and g["current_id"] == other.id)
    for c in (a, b):
        c.close()


def test_limited_weapons_and_bad_input(client):
    a, b, cur, other, _, g = pair(client)
    cur.send("fire", weapon="laser", yaw=0, pitch=0)
    assert "없어요" in cur.until("error")["message"]
    cur.send("fire", weapon="sniper", yaw="nan", pitch=0)
    assert "조준" in cur.until("error")["message"]
    cur.send("fire", weapon="grenade", yaw=0, pitch=0.5)
    m = cur.game(lambda g: g["acting"])
    shot = next(e for e in m["events"] if e["kind"] == "shot")
    assert shot["weapon"] == "grenade" and len(shot["frames"]) >= 2 and shot["radius"] > 0
    assert me_of(m["game"], cur.id)["stock"]["grenade"] == 1
    for c in (a, b):
        c.close()


def test_timeout_passes_turn(client, monkeypatch):
    from app.room import Room
    monkeypatch.setattr(Room, "setting_limits", {"turn_time": (1, 60), "solo_opponent": (0, 3), "ai_talk": (0, 1)})
    me = Conn(client, "t" + uuid.uuid4().hex[:4])
    me.send("create_room", title="시간")
    me.until("room")
    me.send("update_settings", settings={"turn_time": 1})
    me.until("room", lambda m: m["room"]["settings"]["turn_time"] == 1)
    me.send("start")
    me.game()
    m = me.game(lambda g: g["turn"] == 2)
    assert any(e["kind"] == "timeout" for e in m["events"]) and m["game"]["current_id"] == me.id   # 허수아비는 차례 없음
    me.close()


def test_solo_against_ai_plays_out(client):
    me = Conn(client, "ai" + uuid.uuid4().hex[:4])
    me.send("create_room", title="AI전")
    me.until("room")
    me.send("update_settings", settings={"solo_opponent": 3})
    me.until("room", lambda m: m["room"]["settings"]["solo_opponent"] == 3)
    me.send("start")
    g = me.game()["game"]
    assert me_of(g, "ai")["name"] == "AI · 상"
    if g["current_id"] == me.id:
        me.send("fire", weapon="rifle", yaw=0, pitch=-1.2)            # 바닥에 쏘고 넘김
        me.game(lambda g: g["current_id"] == "ai")
    m = me.game(lambda g: g["acting"])
    assert any(e["kind"] == "shot" and e["player_id"] == "ai" for e in m["events"])
    me.close()


def test_spectator_and_leaving(client):
    a, b, cur, other, room_id, g = pair(client)
    spec = Conn(client, "w" + uuid.uuid4().hex[:4])
    spec.send("spectate_room", room_id=room_id)
    assert spec.game()["game"]["boxes"]
    spec.send("fire", weapon="rifle", yaw=0, pitch=0)
    assert "관전 중" in spec.until("error")["message"]
    other.close()
    over = cur.until("game_over")
    assert over["winner"]["id"] == cur.id
    for c in (cur, spec):
        c.close()
