"""점수 순위: 올리기, 이름별 최고 점수, 이번 주, 말이 안 되는 점수 거르기."""
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
    return TestClient(app)


def post(client, board, name, score, duration=600.0):
    return client.post(f"/api/leaderboard/{board}", json={"name": name, "score": score, "duration": duration, "token": "t"})


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


def test_rejects_bad_submissions(client):
    assert post(client, "nothing", "a", 1).status_code == 404
    assert post(client, "crossy", "", 10).status_code == 400
    assert post(client, "crossy", "가" * 13, 10).status_code == 400
    assert post(client, "crossy", "a", 0).status_code == 400
    assert post(client, "crossy", "a", 500, duration=10).status_code == 400      # 10초에 500칸은 불가능
    assert post(client, "crossy", "a", 80, duration=10).status_code == 200
    assert post(client, "pacman-hard", "a", 3000, duration=60).status_code == 200


def test_too_fast_submits_are_limited(client, monkeypatch):
    monkeypatch.setattr(lb, "SUBMIT_GAP", 60)
    assert post(client, "crossy", "a", 5, 60).status_code == 200
    assert post(client, "crossy", "a", 6, 60).status_code == 429


def test_week_start_is_monday_midnight_kst():
    ws = lb.week_start(time.mktime((2026, 10, 15, 12, 0, 0, 0, 0, -1)))   # 목요일
    from datetime import datetime
    d = datetime.fromtimestamp(ws, lb.KST)
    assert (d.weekday(), d.hour, d.minute) == (0, 0, 0)
