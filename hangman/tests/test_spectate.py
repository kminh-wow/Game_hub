"""관전: 정답은 관전자에게도 숨겨지고, 정답 공개 때만 보인다."""
import uuid

from test_game import Conn, client, fast_breaks, start_game  # noqa: F401  (같은 폴더의 행맨 테스트 도구)


def spectate(client, host):
    spec = Conn(client, "w" + uuid.uuid4().hex[:5])
    lobby = spec.until("lobby", lambda m: any(r["host"] == host.name for r in m["rooms"]))
    room_id = next(r["id"] for r in lobby["rooms"] if r["host"] == host.name)
    spec.send("spectate_room", room_id=room_id)
    return spec


def test_spectator_never_sees_the_answer_until_reveal(client):
    a, b, c = start_game(client, 3)
    a.game(lambda g: g["phase"] == "setting")
    a.send("set_word", word="tiger")
    b.game(lambda g: g["phase"] == "guessing" and g["guesser_id"] == b.id)

    spec = spectate(client, a)
    room = spec.until("room")["room"]
    assert room["playing"] and [s["id"] for s in room["spectators"]] == [spec.id]
    g = spec.game()["game"]                                     # 늦게 들어와도 지금 상태를 받는다
    assert g["phase"] == "guessing" and g["word"] is None and g["pattern"] == [None] * 5

    b.send("guess", text="t")
    g = spec.game(lambda g: g["pattern"][0] == "T")["game"]
    assert g["word"] is None                                    # 맞힌 글자가 열려도 정답 전체는 숨겨져 있다

    spec.send("guess", text="i")
    assert "관전 중" in spec.until("error")["message"]
    spec.send("set_word", word="apple")
    assert "관전 중" in spec.until("error")["message"]

    b.send("guess", text="tiger")                               # 정답을 맞혀서 공개되면 관전자도 본다
    g = spec.game(lambda g: g["phase"] == "break")["game"]
    assert g["word"] == "TIGER"
    for conn in (a, b, c, spec):
        conn.close()
