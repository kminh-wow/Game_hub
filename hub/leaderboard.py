"""점수 순위: 혼자 하는 점수 게임(길건너기, 숫자러너, 팩맨, 사과게임, 박스헤드)의 전체·이번 주 상위 10명.

    POST /api/leaderboard/{board}/start   → {"ticket": ...}   판을 시작할 때 입장권을 받는다
    GET  /api/leaderboard/{board}         → {"all": [...], "week": [...]}   (이름별 최고 점수)
    POST /api/leaderboard/{board}         {name, score, ticket, token}  → 순위와 목록

기록은 서버의 SQLite 파일(기본: private/leaderboard.sqlite3, git 에 없음)에 쌓인다.
점수는 브라우저가 계산해서 보내므로 믿지 않고, 걸린 시간만 서버가 직접 잰다:
시작할 때 서명된 입장권(발급 시각, 난수)을 주고, 올릴 때 입장권으로 경과 시간을 계산해
그 시간에 사람이 낼 수 있는 점수(BOARDS 의 상한)를 넘으면 거절한다. 입장권은 한 번만 쓸 수 있다.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

log = logging.getLogger("hub")
REPO = Path(__file__).resolve().parent.parent
MAX_NAME = 12
TOP = 10
SUBMIT_GAP = 2.0                      # 같은 곳에서 연달아 올릴 때 최소 간격(초)
START_PER_MINUTE = 300                # 같은 곳에서 1분에 받을 수 있는 입장권 수
GRACE = 3.0                           # 판이 끝나고 올리기까지의 여유(초)
HUMAN_MARGIN = 1.8                    # 사람이 낼 수 있는 최대 속도의 이만큼까지 받아 줌
KST = timezone(timedelta(hours=9))


def _runner_max(seconds: float) -> float:
    # 규칙이 정한 최고 속도 10m/s, 보스는 1000m마다 (k번째 보스 500×k 점). 실제 기록(1200초에 39,162점)의 1.8배보다 낮음
    dist = seconds * 10 + 1
    k = int(dist // 1000) + 1
    return dist + 500 * k * (k + 1) / 2


# 순위표: 이름, 걸린 시간(초) → 나올 수 있는 최고 점수, 판이 이보다 길 수는 없는 시간(초)
# 상한 = 사람의 최대치 × HUMAN_MARGIN. 최대치는 서버 기록·규칙·시뮬레이션으로 정함:
#   길건너기  기록 최대 4.27칸/초 (규칙상 한계 9.09)      → 7.7칸/초
#   사과게임  숙련자 약 1.2개/초, 170개가 만점             → 2.2개/초, 170 이하
#   팩맨      숙련자 약 85점/초 (유령 연쇄 포함)           → 153점/초
#   박스헤드  완벽 조준·무적 봇의 점수가 시간^1.5 로 늘어 ≈ 3.4·t^1.5 → 1.8배
BOARDS: dict[str, tuple[str, Callable[[float], float], float]] = {
    "crossy": ("길건너기", lambda sec: HUMAN_MARGIN * 4.27 * sec + 6, 3 * 3600),
    "runner": ("숫자러너", _runner_max, 3 * 3600),
    "boxhead": ("박스헤드", lambda sec: HUMAN_MARGIN * 3.4 * sec ** 1.5 + 300, 2 * 3600),
    "apple": ("사과게임", lambda sec: min(170, HUMAN_MARGIN * 1.2 * sec + 8), 150),
    **{f"pacman-{lv}": (f"팩맨 · {label}", lambda sec: HUMAN_MARGIN * 85 * sec + 3000, 2 * 3600)
       for lv, label in (("easy", "쉬움"), ("normal", "보통"), ("midhigh", "중상"), ("hard", "어려움"))},
}

router = APIRouter()
_lock = threading.Lock()
_last_submit: dict[str, float] = {}
_starts: dict[str, list[float]] = {}


def db_path() -> Path:
    return Path(os.environ.get("LEADERBOARD_DB") or REPO / "private" / "leaderboard.sqlite3")


# ---- 입장권: 게임·발급 시각·난수를 서버 비밀키로 서명한 문자열 (서버가 재시작돼도 유효) ----

_key_cache: dict[str, bytes] = {}


def _key() -> bytes:
    """서명용 비밀키. DB 옆 파일에 처음 한 번 만들어 둔다 (private/ 는 git 에 없음)."""
    path = db_path().with_suffix(".key")
    cached = _key_cache.get(str(path))
    if cached:
        return cached
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(32), encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
    key = path.read_text(encoding="utf-8").strip().encode()
    _key_cache[str(path)] = key
    return key


def _sign(board: str, issued: int, nonce: str) -> str:
    return hmac.new(_key(), f"{board}|{issued}|{nonce}".encode(), hashlib.sha256).hexdigest()[:32]


def make_ticket(board: str, now: float | None = None) -> str:
    issued = int((time.time() if now is None else now) * 1000)
    nonce = secrets.token_hex(8)
    return f"{issued}.{nonce}.{_sign(board, issued, nonce)}"


def read_ticket(board: str, ticket: str) -> tuple[float, str]:
    """입장권이 진짜인지 보고 (발급 시각 초, 난수) 를 돌려준다. 가짜면 ValueError."""
    try:
        issued_s, nonce, sig = ticket.split(".")
        issued = int(issued_s)
    except (ValueError, AttributeError):
        raise ValueError("형식") from None
    if len(nonce) != 16 or not hmac.compare_digest(sig, _sign(board, issued, nonce)):
        raise ValueError("서명")
    return issued / 1000, nonce


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
    if "ticket" not in {row[1] for row in con.execute("PRAGMA table_info(scores)")}:
        con.execute("ALTER TABLE scores ADD COLUMN ticket TEXT")                      # 예전 DB 에 입장권 열 추가
    con.execute("CREATE INDEX IF NOT EXISTS scores_board ON scores (board, created)")
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS scores_ticket ON scores (ticket) WHERE ticket IS NOT NULL")   # 한 번만 쓰기


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


# 판 시작: 입장권 발급 (같은 곳에서 너무 자주 받으면 거절)
@router.post("/api/leaderboard/{board}/start")
def start(board: str, request: Request) -> dict[str, Any]:
    _check_board(board)
    ip = request.client.host if request.client else ""
    now = time.time()
    with _lock:
        recent = [t for t in _starts.get(ip, []) if now - t < 60]
        if len(recent) >= START_PER_MINUTE:
            raise HTTPException(429, "잠시 뒤에 다시 해 주세요.")
        recent.append(now)
        _starts[ip] = recent
        if len(_starts) > 5000:                                   # 오래된 곳 정리
            for key in [k for k, v in _starts.items() if not v or now - v[-1] > 60]:
                del _starts[key]
    return {"ticket": make_ticket(board, now), "max_seconds": BOARDS[board][2]}


class Submit(BaseModel):
    name: str
    score: int
    ticket: str = ""
    duration: float = 0.0             # 예전 화면이 보내던 값 (이제 무시하고 서버가 잰 시간을 씀)
    token: str = ""


# 거절 (사유를 로그에 남김)
def _reject(board: str, why: str, name: str, ip: str, message: str) -> HTTPException:
    log.warning("순위 거절 [%s] %s · %s · %s", board, why, name, ip)
    return HTTPException(400, message)


@router.post("/api/leaderboard/{board}")
def submit(board: str, body: Submit, request: Request) -> dict[str, Any]:
    _check_board(board)
    name = body.name.strip()
    ip = request.client.host if request.client else ""
    if not 1 <= len(name) <= MAX_NAME:
        raise HTTPException(400, "닉네임은 1~12자예요.")
    if body.score <= 0:
        raise HTTPException(400, "0점은 올리지 않아요.")
    try:
        issued, nonce = read_ticket(board, body.ticket)
    except ValueError:
        raise _reject(board, "입장권 없음·가짜", name, ip, "입장권이 없거나 잘못됐어요. 페이지를 새로고침하고 다시 해 주세요.") from None
    now = time.time()
    elapsed = now - issued
    if elapsed < 0:
        raise _reject(board, "미래 입장권", name, ip, "입장권이 잘못됐어요.")
    if elapsed > BOARDS[board][2] + GRACE:
        raise _reject(board, "입장권 만료", name, ip, "판이 너무 오래돼서 올릴 수 없어요.")
    if body.score > BOARDS[board][1](elapsed):
        raise _reject(board, f"점수 과다 {body.score} / {elapsed:.0f}초", name, ip, "걸린 시간에 비해 점수가 너무 높아요.")
    with _lock:
        if now - _last_submit.get(ip, 0) < SUBMIT_GAP:
            raise HTTPException(429, "잠시 뒤에 다시 올려 주세요.")
        _last_submit[ip] = now
        with _connect() as con:
            try:
                con.execute("INSERT INTO scores (board, name, score, duration, token, ip, created, ticket) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (board, name, body.score, elapsed, body.token[:64], ip, now, f"{board}:{nonce}"))
            except sqlite3.IntegrityError:
                raise _reject(board, "입장권 재사용", name, ip, "이미 올린 판이에요.") from None
            ws = week_start(now)
            return {
                "board": board, "title": BOARDS[board][0],
                "rank": _rank(con, board, body.score), "week_rank": _rank(con, board, body.score, ws),
                "all": _top(con, board), "week": _top(con, board, ws),
            }
