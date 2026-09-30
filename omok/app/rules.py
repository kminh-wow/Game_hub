"""오목 규칙(자유룰: 5개 이상 이으면 승리)과 간단한 AI."""
from __future__ import annotations

import random

SIZE = 15
EMPTY, BLACK, WHITE = 0, 1, 2
LINES = [(1, 0), (0, 1), (1, 1), (1, -1)]   # 가로, 세로, 대각선 둘

Board = list[list[int]]


def new_board() -> Board:
    return [[EMPTY] * SIZE for _ in range(SIZE)]


def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < SIZE and 0 <= y < SIZE


def other(color: int) -> int:
    return WHITE if color == BLACK else BLACK


def _run(board: Board, x: int, y: int, dx: int, dy: int, color: int) -> list[tuple[int, int]]:
    """(x, y)에서 (dx, dy) 방향으로 이어진 같은 색 돌 (시작점 제외)."""
    out = []
    x, y = x + dx, y + dy
    while in_bounds(x, y) and board[y][x] == color:
        out.append((x, y))
        x, y = x + dx, y + dy
    return out


def winning_line(board: Board, x: int, y: int) -> list[tuple[int, int]] | None:
    """(x, y)에 놓인 돌로 5개 이상 이어졌으면 그 줄을 돌려준다."""
    color = board[y][x]
    if color == EMPTY:
        return None
    for dx, dy in LINES:
        line = _run(board, x, y, -dx, -dy, color)[::-1] + [(x, y)] + _run(board, x, y, dx, dy, color)
        if len(line) >= 5:
            return line
    return None


def is_full(board: Board) -> bool:
    return all(cell != EMPTY for row in board for cell in row)


# ---- AI ----
# 빈 칸마다 "내가 두면 얼마나 좋은가(공격)"와 "상대가 두면 얼마나 위험한가(수비)"를 더해 가장 높은 칸에 둔다.
# 이어진 돌 수와 양끝이 열려 있는지만 보는 단순한 방식이다 (띈 모양은 보지 않는다).

_SCORES = {
    # (이어진 수, 열린 끝 수): 점수
    (4, 2): 100_000, (4, 1): 10_000,
    (3, 2): 5_000, (3, 1): 500,
    (2, 2): 200, (2, 1): 50,
    (1, 2): 10, (1, 1): 2,
}
FIVE = 1_000_000


def _point_score(board: Board, x: int, y: int, color: int) -> int:
    total = 0
    for dx, dy in LINES:
        count, open_ends = 1, 0
        for sx, sy in ((dx, dy), (-dx, -dy)):
            run = _run(board, x, y, sx, sy, color)
            count += len(run)
            ex, ey = x + sx * (len(run) + 1), y + sy * (len(run) + 1)
            if in_bounds(ex, ey) and board[ey][ex] == EMPTY:
                open_ends += 1
        if count >= 5:
            total += FIVE
        elif open_ends:
            total += _SCORES.get((count, open_ends), 0)
    return total


def candidates(board: Board, reach: int = 2) -> list[tuple[int, int]]:
    """이미 놓인 돌 근처(reach 칸 이내)의 빈 칸. 판이 비어 있으면 가운데."""
    near = set()
    for y in range(SIZE):
        for x in range(SIZE):
            if board[y][x] == EMPTY:
                continue
            for ny in range(y - reach, y + reach + 1):
                for nx in range(x - reach, x + reach + 1):
                    if in_bounds(nx, ny) and board[ny][nx] == EMPTY:
                        near.add((nx, ny))
    return sorted(near) or [(SIZE // 2, SIZE // 2)]


def ai_move(board: Board, color: int, rng: random.Random | None = None) -> tuple[int, int]:
    rng = rng or random.Random()
    best: list[tuple[int, int]] = []
    best_score = -1.0
    for x, y in candidates(board):
        score = _point_score(board, x, y, color) * 1.1 + _point_score(board, x, y, other(color))
        if score > best_score:
            best, best_score = [(x, y)], score
        elif score == best_score:
            best.append((x, y))
    return rng.choice(best)
