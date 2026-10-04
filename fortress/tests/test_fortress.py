"""포트리스 대전 흐름: 차례, 조준·이동·발사, 포탄 종류, 퇴장, 관전."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.world import MAX_FUEL


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
        for _ in range(400):
            msg = self.ws.receive_json()
            if msg["type"] == type_ and pred(msg):
                return msg
        raise AssertionError(f"{self.name}: {type_} 못 받음")

    def game(self, pred=lambda g: True):
        return self.until("game", lambda m: pred(m["game"]))

    def close(self):
        self._ctx.__exit__(None, None, None)


def pair(client):
    tag = uuid.uuid4().hex[:5]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title=f"포격-{tag}")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: m["room"]["players"][1]["ready"])
    a.send("start")
    g = a.game()["game"]
    b.game()
    return a, b, room_id, g


def tank(g, pid):
    return next(t for t in g["tanks"] if t["id"] == pid)


def shoot_self(conn, weapon="normal"):
    """바로 위로 약하게 쏴서 빨리 끝나는 한 발."""
    conn.send("aim", angle=90, facing=1)
    conn.until("aim")
    conn.send("fire", power=8, weapon=weapon)


def test_turns_aim_move_and_fire(client):
    a, b, _, g = pair(client)
    assert len(g["terrain"]) == g["width"] and len(g["tanks"]) == 2
    cur, other = (a, b) if g["current_id"] == a.id else (b, a)

    other.send("fire", power=50)
    assert "차례" in other.until("error")["message"]

    x0 = tank(g, cur.id)["x"]
    cur.send("move", dir=1)
    m = other.until("tank")
    assert m["fuel"] <= MAX_FUEL and m["tank"]["facing"] == 1
    assert m["tank"]["x"] in (x0, x0 + 3)                      # 오르막이면 막힐 수 있다

    cur.send("aim", angle=200, facing=-1)
    m = other.until("aim")
    assert m["angle"] == 90 and m["facing"] == -1               # 각도는 0~90

    shoot_self(cur)
    m = other.game(lambda g: g["flying"])
    shot = next(e for e in m["events"] if e["kind"] == "shot")
    assert shot["player_id"] == cur.id and shot["frames"] and shot["hit"]
    assert tank(m["game"], cur.id)["hp"] < 100                  # 제자리 포격은 자기가 맞는다
    cur.send("fire", power=50)
    assert "기다려" in cur.until("error")["message"]            # 날아가는 중에는 못 쏜다

    m = other.game(lambda g: not g["flying"] and g["current_id"] == other.id)
    assert any(e["kind"] == "turn" for e in m["events"])
    for c in (a, b):
        c.close()


def test_big_shell_can_be_used_once(client):
    a, b, _, g = pair(client)
    cur, other = (a, b) if g["current_id"] == a.id else (b, a)
    cur.send("fire", power="abc", weapon="big")                 # 잘못된 요청은 대형탄을 쓰지 않는다
    assert "파워" in cur.until("error")["message"]
    shoot_self(cur, "big")
    m = cur.game(lambda g: g["flying"])
    assert tank(m["game"], cur.id)["stock"]["big"] == 0
    cur.game(lambda g: g["current_id"] == other.id and not g["flying"])
    shoot_self(other)
    other.game(lambda g: g["current_id"] == cur.id and not g["flying"])
    cur.send("fire", power=30, weapon="big")
    assert "다 썼어요" in cur.until("error")["message"]
    cur.send("fire", power="abc")
    assert "파워" in cur.until("error")["message"]
    cur.send("fire", power=30, weapon="nuke")
    assert "없어요" in cur.until("error")["message"]
    for c in (a, b):
        c.close()


def test_leaving_player_loses(client):
    a, b, _, _ = pair(client)
    b.close()
    over = a.until("game_over")
    assert over["winner"]["id"] == a.id
    assert [r["id"] for r in over["ranking"]] == [a.id, b.id]
    a.close()


def test_solo_practice_has_a_dummy_that_never_plays(client):
    me = Conn(client, "solo" + uuid.uuid4().hex[:4])
    me.send("create_room", title="연습")
    me.until("room")
    me.send("start")
    g = me.game()["game"]
    dummy = next(t for t in g["tanks"] if t["dummy"])
    assert dummy["name"] == "허수아비" and g["current_id"] == me.id
    shoot_self(me)
    g = me.game(lambda g: not g["flying"] and g["turn"] == 2)["game"]
    assert g["current_id"] == me.id                            # 허수아비는 차례가 없다
    me.close()


def test_spectator_sees_shots_but_cannot_act(client):
    a, b, room_id, g = pair(client)
    spec = Conn(client, "w" + uuid.uuid4().hex[:4])
    spec.send("spectate_room", room_id=room_id)
    assert spec.game()["game"]["terrain"]
    spec.send("ping")                                          # 연결 유지 신호는 오류 없이 무시
    spec.send("chat", text="구경")
    for _ in range(50):
        m = spec.ws.receive_json()
        assert m["type"] != "error", m
        if m["type"] == "chat":
            break
    for kind, data in [("fire", {"power": 50}), ("move", {"dir": 1}), ("aim", {"angle": 30})]:
        spec.send(kind, **data)
        assert "관전 중" in spec.until("error")["message"]
    cur = a if g["current_id"] == a.id else b
    shoot_self(cur)
    m = spec.game(lambda g: g["flying"])
    assert any(e["kind"] == "shot" for e in m["events"])
    for c in (a, b, spec):
        c.close()


def test_timeout_passes_the_turn_and_solo_gets_it_back(client, monkeypatch):
    from app.room import Room
    monkeypatch.setattr(Room, "setting_limits", {"turn_time": (1, 60)})
    me = Conn(client, "t" + uuid.uuid4().hex[:4])
    me.send("create_room", title="시간")
    me.until("room")
    me.send("update_settings", settings={"turn_time": 1})
    me.until("room", lambda m: m["room"]["settings"]["turn_time"] == 1)
    me.send("start")
    me.game()
    m = me.game(lambda g: g["turn"] == 2)
    assert any(e["kind"] == "timeout" and e["player_id"] == me.id for e in m["events"])
    assert m["game"]["current_id"] == me.id and m["game"]["fuel"] == MAX_FUEL
    shoot_self(me)                                              # 시간 초과 뒤에도 쏠 수 있다
    me.game(lambda g: g["flying"])
    me.close()


def test_solo_against_ai_takes_turns(client, monkeypatch):
    import app.game as game_module
    monkeypatch.setattr(game_module, "AI_THINK", 0.05)
    monkeypatch.setattr(game_module, "AI_AIM", 0.05)
    me = Conn(client, "ai" + uuid.uuid4().hex[:4])
    me.send("create_room", title="AI전")
    me.until("room")
    me.send("update_settings", settings={"solo_opponent": 3})
    me.until("room", lambda m: m["room"]["settings"]["solo_opponent"] == 3)
    me.send("start")
    g = me.game()["game"]
    ai_tank = next(t for t in g["tanks"] if t["id"] == "ai")
    assert ai_tank["name"] == "AI · 상" and not any(t["dummy"] for t in g["tanks"])
    if g["current_id"] == me.id:
        shoot_self(me)
        me.game(lambda g: g["current_id"] == "ai" and not g["flying"])
    m = me.game(lambda g: g["flying"])                         # AI 가 스스로 쏜다
    assert any(e["kind"] == "shot" and e["player_id"] == "ai" for e in m["events"])
    m = me.game(lambda g: not g["flying"] and g["current_id"] in (me.id, None))
    me.close()


def test_solo_opponent_setting_is_limited(client):
    me = Conn(client, "lim" + uuid.uuid4().hex[:4])
    me.send("create_room", title="설정")
    assert me.until("room")["room"]["settings"]["solo_opponent"] == 0     # 기본은 허수아비
    me.send("update_settings", settings={"solo_opponent": 9})
    assert me.until("room")["room"]["settings"]["solo_opponent"] == 3
    me.close()
