"""오목 AI: 난이도 5단계 (하·중·중상·상·최상)."""
from __future__ import annotations

import random
import time

from .rules import EMPTY, LINES, SIZE, Board, in_bounds, other

# 난이도
LEVEL_NAMES = ("하", "중", "중상", "상", "최상")
DEFAULT_LEVEL = 2
MAX_THINK_SEC = 1.0   # 최상이 한 수에 쓰는 최대 시간

FIVE = 1_000_000
WALL = 3              # 판 밖


# ---- 중상 이하: 이어진 돌 수와 열린 끝 수로 점수 ----

_SCORES = {
    # (이어진 수, 열린 끝 수): 점수
    (4, 2): 100_000, (4, 1): 10_000,
    (3, 2): 5_000, (3, 1): 500,
    (2, 2): 200, (2, 1): 50,
    (1, 2): 10, (1, 1): 2,
}


def _run(board: Board, x: int, y: int, dx: int, dy: int, color: int) -> int:
    n = 0
    x, y = x + dx, y + dy
    while in_bounds(x, y) and board[y][x] == color:
        n += 1
        x, y = x + dx, y + dy
    return n


# 단순 점수
def _point_score(board: Board, x: int, y: int, color: int) -> int:
    total = 0
    for dx, dy in LINES:
        count, open_ends = 1, 0
        for sx, sy in ((dx, dy), (-dx, -dy)):
            run = _run(board, x, y, sx, sy, color)
            count += run
            ex, ey = x + sx * (run + 1), y + sy * (run + 1)
            if in_bounds(ex, ey) and board[ey][ex] == EMPTY:
                open_ends += 1
        if count >= 5:
            total += FIVE
        elif open_ends:
            total += _SCORES.get((count, open_ends), 0)
    return total


# ---- 상 이상: 띈 모양과 이중 위협까지 읽는 점수 ----

_FIVE, _OPEN4, _FOUR, _OPEN3, _THREE = 5, 4, 3, 2, 1
_KIND_SCORE = {_FIVE: FIVE, _OPEN4: 100_000, _FOUR: 10_000, _OPEN3: 5_000, _THREE: 500}
_POTENTIAL = (0, 1, 4, 16, 64, 0)   # 상대 돌 없는 5칸 창에 내 돌이 n개일 때


# 한 줄 9칸 (가운데가 둘 자리)
def _cells(board: Board, x: int, y: int, dx: int, dy: int, color: int) -> list[int]:
    out = []
    for k in range(-4, 5):
        nx, ny = x + dx * k, y + dy * k
        if k == 0:
            out.append(color)
        elif in_bounds(nx, ny):
            out.append(board[ny][nx])
        else:
            out.append(WALL)
    return out


# 5칸 창 중 4개+빈칸 1개인 곳의 빈칸 위치
def _completions(cells: list[int], color: int) -> set[int]:
    points = set()
    for i in range(5):
        window = cells[i:i + 5]
        if window.count(color) == 4 and window.count(EMPTY) == 1:
            points.add(i + window.index(EMPTY))
    return points


def _has_five(cells: list[int], color: int) -> bool:
    return any(cells[i:i + 5].count(color) == 5 for i in range(5))


# 한 줄의 위협 종류
def _line_kind(cells: list[int], color: int) -> int:
    if _has_five(cells, color):
        return _FIVE
    done = _completions(cells, color)
    if len(done) >= 2:
        return _OPEN4
    if done:
        return _FOUR
    if cells.count(color) < 3:
        return 0
    kind = 0
    for j in range(9):
        if cells[j] != EMPTY:
            continue
        cells[j] = color
        after = _completions(cells, color)
        cells[j] = EMPTY
        if len(after) >= 2:
            return _OPEN3
        if after:
            kind = _THREE
    return kind


# 상 이상 점수
def _point_score_v2(board: Board, x: int, y: int, color: int) -> int:
    foe = other(color)
    kinds = []
    potential = 0
    for dx, dy in LINES:
        cells = _cells(board, x, y, dx, dy, color)
        kind = _line_kind(cells, color)
        if kind == _FIVE:
            return FIVE
        kinds.append(kind)
        for i in range(5):
            window = cells[i:i + 5]
            if foe not in window and WALL not in window:
                potential += _POTENTIAL[window.count(color)]
    total = sum(_KIND_SCORE.get(k, 0) for k in kinds) + potential
    fours = sum(k in (_FOUR, _OPEN4) for k in kinds)
    threes = kinds.count(_OPEN3)
    if _OPEN4 in kinds or fours >= 2:
        total += 90_000
    elif fours and threes:
        total += 60_000
    elif threes >= 2:
        total += 15_000
    return total


# ---- 후보와 순위 ----

# 돌 근처 빈 칸
def _candidates(board: Board, reach: int = 2) -> list[tuple[int, int]]:
    near = set()
    for y in range(SIZE):
        row = board[y]
        for x in range(SIZE):
            if row[x] == EMPTY:
                continue
            for ny in range(max(y - reach, 0), min(y + reach, SIZE - 1) + 1):
                for nx in range(max(x - reach, 0), min(x + reach, SIZE - 1) + 1):
                    if board[ny][nx] == EMPTY:
                        near.add((nx, ny))
    return sorted(near) or [(SIZE // 2, SIZE // 2)]


# 점수순 후보
def _ranked(board: Board, color: int, advanced: bool, reach: int = 2) -> list[tuple[float, int, tuple[int, int]]]:
    score = _point_score_v2 if advanced else _point_score
    foe = other(color)
    out = []
    for x, y in _candidates(board, reach):
        attack = score(board, x, y, color)
        out.append((attack * 1.1 + score(board, x, y, foe), attack, (x, y)))
    out.sort(key=lambda t: -t[0])
    return out


def _pick_best(ranked: list, rng: random.Random) -> tuple[int, int]:
    top = [r[2] for r in ranked if r[0] == ranked[0][0]]
    return rng.choice(top)


# ---- 최상: 사 연속 공격 + 앞수 탐색 ----

class _Timeout(Exception):
    pass


# 둔 돌이 만드는 위협 (오목 여부, 다음에 오목이 되는 칸들)
def _threats(board: Board, x: int, y: int, color: int) -> tuple[bool, set[tuple[int, int]]]:
    points = set()
    for dx, dy in LINES:
        cells = _cells(board, x, y, dx, dy, color)
        if _has_five(cells, color):
            return True, set()
        for i in _completions(cells, color):
            points.add((x + dx * (i - 4), y + dy * (i - 4)))
    return False, points


# 열린 3을 막는 칸들 (이어서 열린 4를 만드는 칸과 그 완성 칸)
def _open_three_defenses(board: Board, x: int, y: int, dx: int, dy: int, color: int) -> set[tuple[int, int]]:
    cells = _cells(board, x, y, dx, dy, color)
    out = set()
    for j in range(9):
        if cells[j] != EMPTY:
            continue
        cells[j] = color
        after = _completions(cells, color)
        cells[j] = EMPTY
        if len(after) >= 2:
            for i in (j, *after):
                out.add((x + dx * (i - 4), y + dy * (i - 4)))
    return out


# 위협 수 (둔 칸, 방어 칸들, 바로 승리 여부)
def _threat_moves(board: Board, color: int, fours_only: bool) -> list[tuple[int, tuple[int, int], set[tuple[int, int]], bool]]:
    out = []
    for x, y in _candidates(board):
        kinds = []
        defenses: set[tuple[int, int]] = set()
        forced: set[tuple[int, int]] = set()
        for dx, dy in LINES:
            cells = _cells(board, x, y, dx, dy, color)
            if cells.count(color) < 3:
                continue
            kind = _line_kind(cells, color)
            if kind == _FIVE:
                kinds = [_FIVE]
                break
            if kind in (_FOUR, _OPEN4):
                kinds.append(kind)
                for i in _completions(cells, color):
                    forced.add((x + dx * (i - 4), y + dy * (i - 4)))
            elif kind == _OPEN3 and not fours_only:
                kinds.append(kind)
                defenses |= _open_three_defenses(board, x, y, dx, dy, color)
        if not kinds:
            continue
        if _FIVE in kinds or _OPEN4 in kinds or len(forced) >= 2:
            out.append((3, (x, y), set(), True))
        elif forced:
            out.append((2, (x, y), forced, False))
        else:
            out.append((1, (x, y), defenses, False))
    out.sort(key=lambda t: -t[0])
    return out


_VCT_WIDTH = 6


# 위협 연속 승리 수 찾기 (fours_only 면 사 연속만)
def _vct(board: Board, color: int, depth: int, deadline: float, fours_only: bool = False) -> tuple[int, int] | None:
    if depth == 0:
        return None
    if time.monotonic() > deadline:
        raise _Timeout
    foe = other(color)
    for _, (x, y), defenses, wins in _threat_moves(board, color, fours_only)[:_VCT_WIDTH]:
        if wins:
            return (x, y)
        board[y][x] = color
        try:
            refuted = False
            for rx, ry in defenses:
                board[ry][rx] = foe
                try:
                    five, counter = _threats(board, rx, ry, foe)
                    if five or counter or _vct(board, color, depth - 1, deadline, fours_only) is None:
                        refuted = True
                finally:
                    board[ry][rx] = EMPTY
                if refuted:
                    break
        finally:
            board[y][x] = EMPTY
        if not refuted and defenses:
            return (x, y)
    return None


# 최상 수 고르기
def _expert_move(board: Board, color: int, rng: random.Random, limit: float) -> tuple[int, int]:
    deadline = time.monotonic() + limit
    board = [row[:] for row in board]
    ranked = _ranked(board, color, True)
    choice = _pick_best(ranked, rng)
    if ranked[0][0] >= FIVE:                       # 바로 이기거나 막아야 하는 오목
        return choice
    foe = other(color)
    try:
        for depth, fours_only in ((8, True), (4, False)):
            if mine := _vct(board, color, depth, deadline, fours_only):
                return mine
        theirs = _vct(board, foe, 4, deadline)
        if theirs:                                  # 상대 연속 공격을 끊는 수
            for x, y in [theirs] + [r[2] for r in ranked[:12]]:
                board[y][x] = color
                try:
                    broken = _vct(board, foe, 4, deadline) is None
                finally:
                    board[y][x] = EMPTY
                if broken:
                    return (x, y)
    except _Timeout:
        pass
    return choice


# ---- 수 고르기 ----

def ai_move(
    board: Board, color: int, rng: random.Random | None = None,
    level: int = DEFAULT_LEVEL, think_sec: float = MAX_THINK_SEC,
) -> tuple[int, int]:
    rng = rng or random.Random()
    if level >= 4:
        return _expert_move(board, color, rng, think_sec)
    ranked = _ranked(board, color, advanced=level >= 3)
    if level >= 2 or ranked[0][0] >= FIVE * 1.1:   # 바로 이기는 수는 모든 단계가 둔다
        return _pick_best(ranked, rng)
    blocks = ranked[0][0] >= FIVE                   # 상대 오목을 막아야 하는 판
    if level == 1:
        if blocks or rng.random() >= 0.25:
            return _pick_best(ranked, rng)
        return rng.choice(ranked[1:3] or ranked[:1])[2]
    if blocks and rng.random() < 0.5:
        return _pick_best(ranked, rng)
    return rng.choice(ranked[:6])[2]
