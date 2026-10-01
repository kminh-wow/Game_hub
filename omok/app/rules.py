"""오목 규칙(자유룰: 5개 이상 이으면 승리)."""
from __future__ import annotations

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
