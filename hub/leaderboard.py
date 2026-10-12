"""점수 순위: 혼자 하는 점수 게임(길건너기, 숫자러너, 팩맨)의 전체·이번 주 상위 10명.

    GET  /api/leaderboard/{board}   → {"all": [...], "week": [...]}   (이름별 최고 점수)
    POST /api/leaderboard/{board}   {name, score, duration, token}  → 순위와 목록

기록은 서버의 SQLite 파일(기본: private/leaderboard.sqlite3, git 에 없음)에 쌓인다.
점수는 브라우저가 계산해서 보내므로, 걸린 시간에 비해 말이 안 되는 점수만 거른다.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

REPO = Path(__file__).resolve().parent.parent
MAX_NAME = 12
TOP = 10
SUBMIT_GAP = 2.0                      # 같은 곳에서 연달아 올릴 때 최소 간격(초)
KST = timezone(timedelta(hours=9))


def _runner_max(seconds: float) -> float:
    # 최고 속도 10m/s, 보스는 1000m마다 (k번째 보스 500×k 점)
    dist = seconds * 10 + 1
    k = int(dist // 1000) + 1
    return dist + 500 * k * (k + 1) / 2


# 순위표: 이름, 걸린 시간(초) → 나올 수 있는 최고 점수
BOARDS: dict[str, tuple[str, Callable[[float], float]]] = {
    "crossy": ("길건너기", lambda sec: sec * 9.5 + 5),            # 한 칸 0.11초
    "runner": ("숫자러너", _runner_max),
    **{f"pacman-{lv}": (f"팩맨 · {label}", lambda sec: sec * 500 + 2000)
       for lv, label in (("easy", "쉬움"), ("normal", "보통"), ("midhigh", "중상"), ("hard", "어려움"))},
}

router = APIRouter()
_lock = threading.Lock()
_last_submit: dict[str, float] = {}


def db_path() -> Path:
    return Path(os.environ.get("LEADERBOARD_DB") or REPO / "private" / "leaderboard.sqlite3")


# DB 연결 (없으면 표 만들기, 끝나면 저장하고 닫기)
@contextmanager
def _connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    try:
        _create(con)
        yield con
        con.commit()
    finally:
        con.close()


def _create(con: sqlite3.Connection) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY, board TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
        duration REAL NOT NULL, token TEXT, ip TEXT, created REAL NOT NULL)""")
    con.execute("CREATE INDEX IF NOT EXISTS scores_board ON scores (board, created)")


def week_start(now: float | None = None) -> float:
    """이번 주 월요일 0시(한국 시간)의 타임스탬프."""
    t = datetime.fromtimestamp(time.time() if now is None else now, KST)
    monday = (t - timedelta(days=t.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.timestamp()


def _top(con: sqlite3.Connection, board: str, since: float = 0.0) -> list[dict[str, Any]]:
    rows = con.execute(
        "SELECT name, MAX(score) AS best, MIN(created) FROM scores WHERE board = ? AND created >= ? "
        "GROUP BY name ORDER BY best DESC, MIN(created) ASC LIMIT ?", (board, since, TOP)).fetchall()
    return [{"name": name, "score": best} for name, best, _ in rows]


def _rank(con: sqlite3.Connection, board: str, score: int, since: float = 0.0) -> int:
    above = con.execute(
        "SELECT COUNT(*) FROM (SELECT name, MAX(score) AS best FROM scores WHERE board = ? AND created >= ? "
        "GROUP BY name) WHERE best > ?", (board, since, score)).fetchone()[0]
    return above + 1


def _check_board(board: str) -> None:
    if board not in BOARDS:
        raise HTTPException(404, "그런 순위표는 없어요.")


@router.get("/api/leaderboard/{board}")
def get_board(board: str) -> dict[str, Any]:
    _check_board(board)
    with _lock, _connect() as con:
        return {"board": board, "title": BOARDS[board][0], "all": _top(con, board), "week": _top(con, board, week_start())}


class Submit(BaseModel):
    name: str
    score: int
    duration: float
    token: str = ""


@router.post("/api/leaderboard/{board}")
def submit(board: str, body: Submit, request: Request) -> dict[str, Any]:
    _check_board(board)
    name = body.name.strip()
    if not 1 <= len(name) <= MAX_NAME:
        raise HTTPException(400, "닉네임은 1~12자예요.")
    if body.score <= 0:
        raise HTTPException(400, "0점은 올리지 않아요.")
    if not 0 < body.duration <= 6 * 3600:
        raise HTTPException(400, "걸린 시간이 이상해요.")
    if body.score > BOARDS[board][1](body.duration):
        raise HTTPException(400, "걸린 시간에 비해 점수가 너무 높아요.")
    ip = request.client.host if request.client else ""
    now = time.time()
    with _lock:
        if now - _last_submit.get(ip, 0) < SUBMIT_GAP:
            raise HTTPException(429, "잠시 뒤에 다시 올려 주세요.")
        _last_submit[ip] = now
        with _connect() as con:
            con.execute("INSERT INTO scores (board, name, score, duration, token, ip, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (board, name, body.score, body.duration, body.token[:64], ip, now))
            ws = week_start(now)
            return {
                "board": board, "title": BOARDS[board][0],
                "rank": _rank(con, board, body.score), "week_rank": _rank(con, board, body.score, ws),
                "all": _top(con, board), "week": _top(con, board, ws),
            }
