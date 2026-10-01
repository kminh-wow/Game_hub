"""관전: 굴리는 장면과 점수판이 관전자에게도 가고, 조작은 막힌다."""
import uuid

from test_yacht import Conn, client  # noqa: F401  (같은 폴더의 요트 테스트 도구)


def test_spectator_sees_rolls_but_cannot_act(client):
    tag = uuid.uuid4().hex[:5]
    host = Conn(client, f"h{tag}")
    host.send("create_room", title=f"관전-{tag}")
    room_id = host.until("room")["room"]["id"]
    host.send("start")                                          # 혼자 시작하는 연습 모드
    host.game()

    spec = Conn(client, f"w{tag}")
    spec.send("spectate_room", room_id=room_id)
    assert [s["id"] for s in spec.until("room")["room"]["spectators"]] == [spec.id]
    g = spec.game()["game"]
    assert g["current_id"] == host.id and g["rolls_left"] == 3   # 늦게 들어와도 지금 상태를 받는다

    for kind, data in [("roll", {}), ("hold", {"held": [True] * 5}), ("write", {"category": "choice"})]:
        spec.send(kind, **data)
        assert "관전 중" in spec.until("error")["message"], kind

    host.send("roll")
    m = spec.until("game", lambda m: any(e["kind"] == "roll" for e in m["events"]))
    roll = next(e for e in m["events"] if e["kind"] == "roll")
    assert len(roll["dice"]) == 5                               # 굴러간 결과가 관전자에게도 간다
    spec.game(lambda g: g["rolls_left"] == 2)
    for conn in (host, spec):
        conn.close()
