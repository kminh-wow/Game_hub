"""오목 규칙, AI, 대전 흐름."""
import random
import uuid

import pytest
from fastapi.testclient import TestClient

import app.game as game_module
from app.main import app
from app.rules import BLACK, EMPTY, WHITE, SIZE, ai_move, is_full, new_board, winning_line


# ---- 규칙 ----

def place_all(board, color, cells):
    for x, y in cells:
        board[y][x] = color


@pytest.mark.parametrize("cells", [
    [(3, 7), (4, 7), (5, 7), (6, 7), (7, 7)],          # 가로
    [(2, 2), (2, 3), (2, 4), (2, 5), (2, 6)],          # 세로
    [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)],          # 대각선
    [(10, 0), (9, 1), (8, 2), (7, 3), (6, 4)],         # 반대 대각선
])
def test_five_wins(cells):
    b = new_board()
    place_all(b, BLACK, cells)
    line = winning_line(b, *cells[2])
    assert sorted(line) == sorted(cells)


def test_four_is_not_win_and_six_is_win():
    b = new_board()
    place_all(b, BLACK, [(0, 0), (1, 0), (2, 0), (3, 0)])
    assert winning_line(b, 3, 0) is None
    place_all(b, BLACK, [(5, 0), (6, 0)])
    b[0][4] = BLACK                                     # 장목(6개 이상)도 승리
    assert len(winning_line(b, 4, 0)) == 7


def test_board_full():
    b = [[BLACK] * SIZE for _ in range(SIZE)]
    assert is_full(b)
    b[3][3] = EMPTY
    assert not is_full(b)


def test_ai_takes_win_and_blocks():
    b = new_board()
    place_all(b, WHITE, [(3, 3), (4, 3), (5, 3), (6, 3)])       # AI(백)가 두면 이김
    place_all(b, BLACK, [(3, 5), (4, 5), (5, 5), (6, 5)])       # 흑도 4개
    assert ai_move(b, WHITE, random.Random(0)) in [(2, 3), (7, 3)]

    b = new_board()
    place_all(b, BLACK, [(3, 5), (4, 5), (5, 5), (6, 5)])       # 막지 않으면 짐
    b[5][2] = WHITE
    assert ai_move(b, WHITE, random.Random(0)) == (7, 5)


def test_ai_first_move_is_center():
    assert ai_move(new_board(), BLACK) == (SIZE // 2, SIZE // 2)


# ---- 대전 흐름 ----

@pytest.fixture(autouse=True)
def fast_ai(monkeypatch):
    monkeypatch.setattr(game_module, "AI_DELAY", 0.01)


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

    def game(self, pred=lambda g: True):
        return self.until("game", lambda m: pred(m["game"]))["game"]

    def close(self):
        self._ctx.__exit__(None, None, None)


def two_players(client):
    tag = uuid.uuid4().hex[:4]
    a, b = Conn(client, f"a{tag}"), Conn(client, f"b{tag}")
    a.send("create_room", title="오목")
    room_id = a.until("room")["room"]["id"]
    b.send("join_room", room_id=room_id)
    b.until("room")
    b.send("ready")
    a.until("room", lambda m: len(m["room"]["players"]) == 2 and m["room"]["players"][1]["ready"])
    return a, b


def test_two_player_game_and_rematch_loser_is_black(client):
    a, b = two_players(client)
    a.send("start")
    g = a.game()
    black = a if g["black"]["id"] == a.id else b
    white = b if black is a else a

    white.send("place", x=0, y=0)
    assert "차례" in white.until("error")["message"]

    for i in range(4):                                  # 흑: (3..6, 7), 백: (3..6, 9)
        black.send("place", x=3 + i, y=7)
        white.game(lambda g, i=i: g["move_count"] == 2 * i + 1)
        white.send("place", x=3 + i, y=9)
        black.game(lambda g, i=i: g["move_count"] == 2 * i + 2)
    black.send("place", x=3, y=9)
    assert "이미 돌" in black.until("error")["message"]
    black.send("place", x=7, y=7)                       # 흑 오목
    over = a.until("game_over")
    assert over["winner"]["id"] == black.id and over["reason"] == "five"
    room = a.until("room", lambda m: not m["room"]["playing"])["room"]
    assert room["wins"] == {black.id: 1}

    # 다시 시작: 진 사람(백)이 흑
    b.send("ready")
    a.until("room", lambda m: m["room"]["players"][1]["ready"])
    a.send("start")
    assert a.game()["black"]["id"] == white.id
    a.close()
    b.close()


def test_resign_and_leave(client):
    a, b = two_players(client)
    a.send("start")
    a.game()
    b.send("resign")
    over = a.until("game_over")
    assert over["winner"]["id"] == a.id and over["reason"] == "resign"

    b.send("ready")
    a.until("room", lambda m: m["room"]["players"][1]["ready"])
    a.send("start")
    a.game()
    b.close()                                          # 도중에 나가면 남은 사람 승
    over = a.until("game_over")
    assert over["winner"]["id"] == a.id and over["reason"] == "leave"
    a.close()


def test_solo_game_against_ai(client):
    me = Conn(client, "solo" + uuid.uuid4().hex[:4])
    me.send("create_room", title="AI 연습")
    me.until("room")
    me.send("start")
    g = me.game()
    assert "ai" in (g["black"]["id"], g["white"]["id"])
    if g["black"]["id"] == "ai":                       # AI 가 흑이면 먼저 둔다
        g = me.game(lambda g: g["move_count"] == 1)
    x, y = next((x, y) for y in range(SIZE) for x in range(SIZE) if g["board"][y][x] == EMPTY)
    n = g["move_count"]
    me.send("place", x=x, y=y)
    g = me.game(lambda g: g["move_count"] == n + 2)    # 내 수 + AI 응수
    assert g["current_id"] == me.id
    me.close()
