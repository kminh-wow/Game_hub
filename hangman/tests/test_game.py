"""행맨 게임 흐름: 돌아가며 출제, 차례대로 추측, 점수, 힌트, 퇴장 처리."""
import uuid

import pytest
from fastapi.testclient import TestClient

import app.game as game_module
from app.main import app, server
from app.words import WordList


@pytest.fixture(autouse=True)
def fast_breaks(monkeypatch):
    monkeypatch.setattr(game_module, "ROUND_BREAK", 0.05)
    monkeypatch.setattr(game_module, "CANCEL_BREAK", 0.05)


@pytest.fixture
def client():
    # with 로 열어야 모든 WebSocket 연결이 이벤트 루프 하나를 공유한다 (타이머·브로드캐스트가 섞이지 않게).
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
        for _ in range(200):
            msg = self.ws.receive_json()
            if msg["type"] == type_ and pred(msg):
                return msg
        raise AssertionError(f"{self.name}: {type_} 메시지를 못 받음")

    def game(self, pred=lambda g: True):
        return self.until("game", lambda m: pred(m["game"]))

    def close(self):
        self._ctx.__exit__(None, None, None)


def names(n):
    tag = uuid.uuid4().hex[:4]
    return [f"p{i}{tag}" for i in range(n)]


def start_game(client, n, **settings):
    conns = [Conn(client, name) for name in names(n)]
    host = conns[0]
    host.send("create_room", title="행맨 테스트")
    room_id = host.until("room")["room"]["id"]
    for c in conns[1:]:
        c.send("join_room", room_id=room_id)
        c.until("room")
        c.send("ready")
    if settings:
        host.send("update_settings", settings=settings)
    host.until("room", lambda m: all(p["ready"] for p in m["room"]["players"][1:]) and len(m["room"]["players"]) == n)
    host.send("start")
    return conns


def test_words_normalize_and_lookup():
    w = WordList(["apple", "ab", "Zebra", "x-ray"], ["apple", "nope"])
    assert "APPLE" in w and "apple" in w
    assert "AB" not in w           # 3글자 미만 제외
    assert "X-RAY" not in w        # 알파벳만
    assert w.common == ["APPLE"]


def test_full_game_two_players(client):
    a, b = start_game(client, 2)

    # 1라운드: 먼저 들어온 a 가 출제
    g = a.game(lambda g: g["phase"] == "setting")["game"]
    assert g["setter_id"] == a.id and g["total_rounds"] == 2

    b.send("set_word", word="apple")
    assert "출제할 수 없" in b.until("error")["message"]
    a.send("set_word", word="qzxqz")
    assert "사전에 없는" in a.until("error")["message"]
    a.send("set_word", word="apple", hint="fruit")

    g = b.game(lambda g: g["phase"] == "guessing")["game"]
    assert g["word"] is None and g["pattern"] == [None] * 5   # 추측자에게는 정답을 안 보낸다
    assert g["guesser_id"] == b.id and g["hint"] is None
    assert a.game(lambda g: g["phase"] == "guessing")["game"]["word"] == "APPLE"  # 출제자는 볼 수 있다

    b.send("guess", text="p")
    m = b.game(lambda g: "P" in g["pattern"])
    assert m["events"][0] == {"kind": "letter_ok", "player_id": b.id, "letter": "P", "count": 2, "gain": 20}
    assert m["game"]["guesser_id"] == b.id           # 맞히면 한 번 더

    b.send("guess", text="P")
    assert "이미 나온 글자" in b.until("error")["message"]

    b.send("guess", text="z")
    g = b.game(lambda g: g["strikes"][b.id] == 1)["game"]
    assert g["wrong_letters"] == ["Z"] and g["strikes"][a.id] == 0

    b.send("guess", text="APPLE")                     # 남은 빈칸 3개 × 10 + 30
    g = b.game(lambda g: g["phase"] == "break")["game"]
    assert g["word"] == "APPLE" and g["solver_id"] == b.id
    assert g["scores"][b.id] == 20 + 60

    # 2라운드: b 가 출제, a 가 추측. 6번 틀리면 a 의 교수대 완성 → a -20, 출제자 +20
    g = a.game(lambda g: g["phase"] == "setting" and g["round"] == 2)["game"]
    assert g["setter_id"] == b.id
    b.send("set_word", word="kiwi")
    a.game(lambda g: g["phase"] == "guessing")
    for letter in "ABCDEF":
        a.send("guess", text=letter)
    m = a.game(lambda g: g["phase"] == "break")
    g = m["game"]
    assert g["solver_id"] is None and g["hanged"] == [a.id]
    assert g["scores"][b.id] == 80 + 20 and g["scores"][a.id] == -20
    assert [e["kind"] for e in m["events"]][-2:] == ["hanged", "round_end"]

    ranking = a.until("game_over")["ranking"]
    assert [r["name"] for r in ranking] == [b.name, a.name]
    a.close()
    b.close()


def test_guess_order_skips_setter_and_hint_letter(client):
    a, b, c = start_game(client, 3, hint_turn=2)
    a.game(lambda g: g["phase"] == "setting")
    a.send("set_word", word="banana")                   # 힌트 없음 → 글자 하나 공개

    g = b.game(lambda g: g["phase"] == "guessing")["game"]
    assert g["guesser_id"] == b.id                      # 출제자 다음 사람부터
    b.send("guess", text="x")
    g = c.game(lambda g: g["guesser_id"] == c.id)["game"]
    assert g["hint_in"] == 1
    c.send("guess", text="q")
    m = b.game(lambda g: g["guesser_id"] == b.id and g["strikes"][c.id] == 1)  # 출제자 a 는 건너뜀
    assert m["game"]["hint_letter"] in ("A", "N", "B")
    assert m["events"][-1]["kind"] == "hint_letter"
    for conn in (a, b, c):
        conn.close()


# 힌트 공개 기준
def test_only_wrong_guesses_count_toward_hint(client):
    a, b, c = start_game(client, 3, hint_turn=2)
    a.game(lambda g: g["phase"] == "setting")
    a.send("set_word", word="tiger")                    # 힌트 없음 → 틀린 추측이 쌓이면 글자 하나 공개
    b.game(lambda g: g["phase"] == "guessing" and g["guesser_id"] == b.id)

    for letter in "tig":                                # 맞힌 추측은 세지 않는다
        b.send("guess", text=letter)
        g = b.game(lambda g, l=letter: l.upper() in g["pattern"])["game"]
    assert g["hint_in"] == 2 and g["hint_letter"] is None and g["guesser_id"] == b.id

    b.send("guess", text="z")                           # 첫 번째 틀린 추측
    g = c.game(lambda g: g["guesser_id"] == c.id)["game"]
    assert g["hint_in"] == 1 and g["hint_letter"] is None

    c.send("guess", text="q")                           # 두 번째 틀린 추측 → 힌트 공개
    m = b.game(lambda g: g["hint_letter"] is not None)
    assert m["game"]["hint_letter"] in ("E", "R") and m["game"]["hint_in"] == 0
    assert m["events"][-1]["kind"] == "hint_letter"
    for conn in (a, b, c):
        conn.close()


def test_setter_leaving_cancels_round(client):
    a, b, c = start_game(client, 3)
    a.game(lambda g: g["phase"] == "setting")
    a.close()                                           # 출제 중에 나감
    g = b.game(lambda g: g["phase"] == "setting" and g["round"] == 2)["game"]
    assert g["setter_id"] == b.id                       # 다음 사람이 출제
    assert g["total_rounds"] == 3
    for conn in (b, c):
        conn.close()


def test_guesser_leaving_passes_turn(client):
    a, b, c = start_game(client, 3)
    a.game(lambda g: g["phase"] == "setting")
    a.send("set_word", word="tiger")
    c.game(lambda g: g["guesser_id"] == b.id)
    b.close()
    g = c.game(lambda g: g["guesser_id"] == c.id)["game"]
    assert g["order"] == [a.id, c.id]
    for conn in (a, c):
        conn.close()


def test_last_guesser_leaving_ends_game(client):
    a, b = start_game(client, 2)
    a.game(lambda g: g["phase"] == "setting")
    b.close()
    assert a.until("game_over")["ranking"][0]["name"] == a.name
    assert all(r.game is None for r in server.rooms.values() if a.id in [p.id for p in r.players])
    a.close()


def test_hanged_player_is_skipped_until_all_hanged(client):
    a, b, c = start_game(client, 3, lives=4)
    a.game(lambda g: g["phase"] == "setting")
    a.send("set_word", word="kiwi")
    b.game(lambda g: g["phase"] == "guessing")

    # b, c 번갈아 틀림 → 4번째에 b 탈락. 그다음부터는 c 만 계속 추측
    for i, (letter, who) in enumerate(zip("ABCDEFG", [b, c, b, c, b, c, b])):
        if i > 0:  # 첫 차례(b)는 이미 위에서 받았다
            who.game(lambda g, w=who: g["guesser_id"] == w.id)
        who.send("guess", text=letter)
    g = c.game(lambda g: b.id in g["hanged"])["game"]
    assert g["guesser_id"] == c.id and g["strikes"][b.id] == 4 and g["strikes"][c.id] == 3
    assert g["scores"][b.id] == -20 and g["scores"][a.id] == 20

    c.send("guess", text="H")                               # c 도 탈락 → 모두 탈락, 라운드 끝
    g = c.game(lambda g: g["phase"] == "break")["game"]
    assert g["hanged"] == [b.id, c.id]
    assert g["scores"][a.id] == 40 and g["scores"][c.id] == -20
    for conn in (a, b, c):
        conn.close()
