"""요트 다이스 족보 계산과 대전 흐름."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rules import CATEGORY_IDS, ROUNDS, best_category, score, totals


@pytest.mark.parametrize(("category", "dice", "expected"), [
    ("aces", [1, 1, 3, 4, 1], 3),
    ("sixes", [6, 6, 2, 6, 5], 18),
    ("choice", [1, 2, 3, 4, 6], 16),
    ("four_kind", [5, 5, 5, 5, 2], 22),
    ("four_kind", [5, 5, 5, 5, 5], 25),       # 요트도 포 카인드
    ("four_kind", [5, 5, 5, 2, 2], 0),
    ("full_house", [3, 3, 3, 2, 2], 13),
    ("full_house", [4, 4, 4, 4, 4], 0),       # 5개 같은 건 풀 하우스가 아님
    ("full_house", [3, 3, 2, 2, 1], 0),
    ("small_straight", [1, 2, 3, 4, 6], 15),
    ("small_straight", [3, 4, 5, 6, 6], 15),
    ("small_straight", [1, 2, 3, 5, 6], 0),
    ("large_straight", [2, 3, 4, 5, 6], 30),
    ("large_straight", [1, 2, 3, 4, 6], 0),
    ("yacht", [2, 2, 2, 2, 2], 50),
    ("yacht", [2, 2, 2, 2, 3], 0),
])
def test_scores(category, dice, expected):
    assert score(category, dice) == expected


def test_upper_bonus():
    sheet = {c: None for c in CATEGORY_IDS}
    sheet.update(aces=3, deuces=6, threes=9, fours=12, fives=15, sixes=18)   # 63
    assert totals(sheet) == {"upper": 63, "bonus": 35, "total": 98}
    sheet["sixes"] = 12
    assert totals(sheet)["bonus"] == 0


def test_best_category_for_timeout():
    empty = {c: None for c in CATEGORY_IDS}
    assert best_category(empty, [6, 6, 6, 6, 6]) == "yacht"
    assert best_category(empty, [1, 2, 3, 4, 5]) == "large_straight"
    full = {**empty, **{c: 0 for c in CATEGORY_IDS if c not in ("aces", "yacht")}}
    assert best_category(full, [2, 3, 4, 5, 6]) == "aces"   # 둘 다 0점이면 덜 아까운 위쪽 칸


# ---- 대전 흐름 ----

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
        return self.until("game", lambda m: not m["game"].get("rolling") and pred(m["game"]))

    def close(self):
        self._ctx.__exit__(None, None, None)


def test_turn_roll_hold_write_and_order(client):
    tag = uuid.uuid4().hex[:4]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title="요트")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: len(m["room"]["players"]) == 2 and m["room"]["players"][1]["ready"])
    a.send("start")

    g = a.game()["game"]
    assert g["current_id"] == a.id and g["rolls_left"] == 3   # 먼저 들어온 사람부터

    a.send("write", category="choice")
    assert "먼저 주사위" in a.until("error")["message"]
    b.send("roll")
    assert "차례" in b.until("error")["message"]

    a.send("roll")
    animation = a.until("game", lambda m: bool(m["events"]) and m["events"][0]["kind"] == "roll")
    for action, payload in [("roll", {}), ("hold", {"held": [True]*5}), ("write", {"category": "choice"})]:
        a.send(action, **payload)
        assert "멈출 때까지" in a.until("error")["message"]
    m = a.game(lambda g: g["rolls_left"] == 2)
    first = m["game"]["dice"]
    assert animation["events"][0]["rolled"] == [True] * 5
    assert animation["game"]["preview"] is None
    other = b.until("game", lambda m: any(ev["kind"] == "roll" for ev in m["events"]))
    assert other["events"] == animation["events"]
    assert m["game"]["poses"] == animation["events"][0]["frames"][-1]
    assert m["game"]["preview"]["choice"] == sum(first)

    a.send("hold", held=[True, True, False, False, False])
    a.game(lambda g: g["held"] == [True, True, False, False, False])
    a.send("roll")
    g = a.game(lambda g: g["rolls_left"] == 1)["game"]
    assert g["dice"][:2] == first[:2]                           # 고정한 주사위는 그대로

    a.send("write", category="choice")
    m = b.game(lambda g: g["current_id"] == b.id)
    assert m["game"]["sheets"][a.id]["choice"] == sum(g["dice"])
    assert m["game"]["rolls_left"] == 3 and m["game"]["held"] == [False] * 5

    b.send("roll")
    b.game(lambda g: g["rolls_left"] == 2)
    b.send("write", category="choice")
    g = a.game(lambda g: g["current_id"] == a.id)["game"]
    assert g["round"] == 2                                       # 모두 한 번씩 적으면 다음 라운드

    a.send("roll")
    a.game(lambda g: g["rolls_left"] == 2)
    a.send("write", category="choice")
    assert "적을 수 없" in a.until("error")["message"]          # 이미 적은 칸
    a.close()
    b.close()


def test_solo_game_to_the_end(client):
    me = Conn(client, "solo" + uuid.uuid4().hex[:4])
    me.send("create_room", title="연습")
    me.until("room")
    me.send("start")
    me.game()
    for category in CATEGORY_IDS:
        me.send("roll")
        me.game(lambda g: g["rolls_left"] == 2)
        me.send("write", category=category)
    ranking = me.until("game_over")["ranking"]
    assert ranking[0]["name"] == me.name and ranking[0]["score"] >= 0
    assert ROUNDS == 12
    me.close()


def test_leaving_passes_turn(client):
    tag = uuid.uuid4().hex[:4]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title="요트")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: len(m["room"]["players"]) == 2 and m["room"]["players"][1]["ready"])
    a.send("start")
    b.game(lambda g: g["current_id"] == a.id)
    a.close()
    g = b.game(lambda g: g["current_id"] == b.id)["game"]
    assert g["order"] == [b.id] and g["round"] == 1
    b.close()
