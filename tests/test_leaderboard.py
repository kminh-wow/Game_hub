"""점수 순위: 입장권으로 서버가 시간을 재기, 상한, 재사용·위조 막기, 이름별 최고 점수, 이번 주."""
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

import hub.leaderboard as lb
from hub.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LEADERBOARD_DB", str(tmp_path / "lb.sqlite3"))
    monkeypatch.setattr(lb, "SUBMIT_GAP", 0)
    lb._last_submit.clear()
    lb._starts.clear()
    lb._key_cache.clear()
    return TestClient(app)


def ticket(board, age=60.0):
    """age 초 전에 시작한 판의 입장권."""
    return lb.make_ticket(board, time.time() - age)


def post(client, board, name, score, age=600.0, **extra):
    body = {"name": name, "score": score, "ticket": ticket(board, age), "token": "t", **extra}
    return client.post(f"/api/leaderboard/{board}", json=body)


def test_start_gives_a_ticket_that_works(client):
    t = client.post("/api/leaderboard/crossy/start").json()
    assert t["max_seconds"] > 0
    r = client.post("/api/leaderboard/crossy", json={"name": "철수", "score": 5, "ticket": t["ticket"]})
    assert r.status_code == 200


def test_submit_and_rank_by_best_per_name(client):
    assert client.get("/api/leaderboard/crossy").json() == {"board": "crossy", "title": "길건너기", "all": [], "week": []}
    post(client, "crossy", "철수", 30)
    post(client, "crossy", "영희", 50)
    r = post(client, "crossy", "철수", 40).json()
    assert r["rank"] == 2
    assert r["all"] == [{"name": "영희", "score": 50}, {"name": "철수", "score": 40}]   # 이름마다 최고 점수 하나
    assert r["week"] == r["all"]
    assert post(client, "runner", "철수", 100).json()["all"] == [{"name": "철수", "score": 100}]   # 순위표는 게임별


def test_week_only_counts_since_monday(client):
    post(client, "crossy", "지난주", 99)
    with lb._connect() as con:
        con.execute("UPDATE scores SET created = ?", (lb.week_start() - 3600,))
    post(client, "crossy", "이번주", 10)
    data = client.get("/api/leaderboard/crossy").json()
    assert [e["name"] for e in data["all"]] == ["지난주", "이번주"]
    assert [e["name"] for e in data["week"]] == ["이번주"]


def test_rejects_bad_names_and_scores(client):
    assert post(client, "nothing", "a", 1).status_code == 404
    assert client.post("/api/leaderboard/nothing/start").status_code == 404
    assert post(client, "crossy", "", 10).status_code == 400
    assert post(client, "crossy", "가" * 13, 10).status_code == 400
    assert post(client, "crossy", "a", 0).status_code == 400
    assert post(client, "crossy", "a", -5).status_code == 400


def test_server_measures_time_not_the_client(client):
    """클라이언트가 시간을 6시간이라고 속여도, 입장권으로 잰 시간(방금 시작)이 기준이다."""
    fresh = ticket("crossy", age=10)
    r = client.post("/api/leaderboard/crossy", json={"name": "a", "score": 5000, "ticket": fresh, "duration": 21600})
    assert r.status_code == 400 and "너무 높아" in r.json()["detail"]
    r = client.post("/api/leaderboard/crossy", json={"name": "a", "score": 60, "ticket": ticket("crossy", age=10), "duration": 0.1})
    assert r.status_code == 200                                  # 10초에 60칸(초당 6칸)은 사람이 낼 수 있음


def test_missing_forged_and_wrong_board_tickets(client):
    base = {"name": "a", "score": 5}
    assert client.post("/api/leaderboard/crossy", json=base).status_code == 400                       # 입장권 없음
    assert client.post("/api/leaderboard/crossy", json={**base, "ticket": "1.2.3"}).status_code == 400
    assert client.post("/api/leaderboard/crossy", json={**base, "ticket": "abc"}).status_code == 400
    good = ticket("crossy")
    issued, nonce, sig = good.split(".")
    forged = f"{int(issued) - 3_600_000}.{nonce}.{sig}"                                               # 발급 시각을 1시간 앞당김
    assert client.post("/api/leaderboard/crossy", json={**base, "ticket": forged}).status_code == 400
    assert client.post("/api/leaderboard/runner", json={**base, "ticket": good}).status_code == 400   # 다른 게임 입장권
    future = lb.make_ticket("crossy", time.time() + 3600)
    assert client.post("/api/leaderboard/crossy", json={**base, "ticket": future}).status_code == 400


def test_ticket_is_single_use_and_expires(client):
    t = ticket("crossy", age=30)
    body = {"name": "a", "score": 5, "ticket": t}
    assert client.post("/api/leaderboard/crossy", json=body).status_code == 200
    again = client.post("/api/leaderboard/crossy", json={**body, "name": "b", "score": 6})
    assert again.status_code == 400 and "이미" in again.json()["detail"]
    old = ticket("apple", age=lb.BOARDS["apple"][2] + 60)                                              # 판이 이보다 길 수 없음
    assert client.post("/api/leaderboard/apple", json={"name": "a", "score": 5, "ticket": old}).status_code == 400


def test_ticket_survives_restart(client):
    t = client.post("/api/leaderboard/crossy/start").json()["ticket"]
    lb._key_cache.clear()                                                                              # 서버 재시작
    assert client.post("/api/leaderboard/crossy", json={"name": "a", "score": 3, "ticket": t}).status_code == 200


def test_caps_are_human_max_times_1_8():
    cap = {b: v[1] for b, v in lb.BOARDS.items()}
    assert round(cap["crossy"](100)) == round(1.8 * 4.27 * 100 + 6)
    assert cap["apple"](120) == 170 and cap["apple"](30) < 170
    assert cap["boxhead"](600) > cap["boxhead"](300) > cap["boxhead"](60)
    assert cap["runner"](60) < 1500


def test_real_records_pass_and_cheats_do_not():
    """서버에 쌓였던 실제 기록과 사람의 한계 근처는 통과하고, 속임수 점수는 걸러진다."""
    cap = {b: v[1] for b, v in lb.BOARDS.items()}
    assert 280 <= cap["crossy"](66)                      # 길건너기 280칸 / 66초
    assert 39162 <= cap["runner"](1201)                  # 숫자러너 39,162점 / 1201초
    assert 4790 <= cap["pacman-midhigh"](113)            # 팩맨 4,790점 / 113초
    assert 81 <= cap["apple"](120)                       # 사과게임 81개 / 120초
    assert cap["crossy"](10) < 200                       # 10초에 200칸
    assert cap["boxhead"](60) < 20000                    # 1분에 2만 점
    assert cap["apple"](20) < 100                        # 20초에 100개
    assert cap["pacman-easy"](60) < 20000


def test_fresh_ticket_cannot_post_a_big_score_on_any_board(client):
    for board, big in (("crossy", 3000), ("runner", 50000), ("boxhead", 500000), ("apple", 170), ("pacman-hard", 90000)):
        r = client.post(f"/api/leaderboard/{board}", json={"name": "a", "score": big, "ticket": ticket(board, age=5)})
        assert r.status_code == 400, board


def test_rejections_are_logged(client, caplog):
    with caplog.at_level("WARNING", logger="hub"):
        client.post("/api/leaderboard/crossy", json={"name": "나쁜사람", "score": 9999, "ticket": ticket("crossy", age=5)})
        client.post("/api/leaderboard/crossy", json={"name": "나쁜사람", "score": 5})
    text = caplog.text
    assert "점수 과다" in text and "입장권 없음" in text and "나쁜사람" in text


def test_too_fast_submits_and_starts_are_limited(client, monkeypatch):
    monkeypatch.setattr(lb, "SUBMIT_GAP", 60)
    assert post(client, "crossy", "a", 5, 60).status_code == 200
    assert post(client, "crossy", "a", 6, 60).status_code == 429
    monkeypatch.setattr(lb, "START_PER_MINUTE", 3)
    codes = [client.post("/api/leaderboard/crossy/start").status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_old_database_gets_the_ticket_column(client, tmp_path, monkeypatch):
    path = tmp_path / "old.sqlite3"
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE scores (id INTEGER PRIMARY KEY, board TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
        duration REAL NOT NULL, token TEXT, ip TEXT, created REAL NOT NULL)""")
    con.execute("INSERT INTO scores (board, name, score, duration, token, ip, created) VALUES ('crossy', '옛날', 77, 30, '', '1.1.1.1', 1)")
    con.commit()
    con.close()
    lb._key_cache.clear()
    monkeypatch.setenv("LEADERBOARD_DB", str(path))
    assert post(client, "crossy", "새 사람", 50).status_code == 200
    data = client.get("/api/leaderboard/crossy").json()
    assert [e["name"] for e in data["all"]] == ["옛날", "새 사람"]


def test_week_start_is_monday_midnight_kst():
    ws = lb.week_start(time.mktime((2026, 10, 15, 12, 0, 0, 0, 0, -1)))   # 목요일
    from datetime import datetime
    d = datetime.fromtimestamp(ws, lb.KST)
    assert (d.weekday(), d.hour, d.minute) == (0, 0, 0)
