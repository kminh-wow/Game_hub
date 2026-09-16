"""Quoridor rule engine.

Board coordinates are (row, col) with row, col in 0..8.
Player 1 starts at the top (row 0) and must reach row 8.
Player 2 starts at the bottom (row 8) and must reach row 0.

Walls sit on an 8x8 grid of intersections. A wall at intersection (r, c)
with orientation 'H' blocks the edges between (r, c)-(r+1, c) and
(r, c+1)-(r+1, c+1). A wall with orientation 'V' blocks the edges between
(r, c)-(r, c+1) and (r+1, c)-(r+1, c+1).
"""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Optional

BOARD_SIZE = 9
WALLS_PER_PLAYER = 10
GOAL_ROW = {1: 8, 2: 0}
START_POS = {1: (0, 4), 2: (8, 4)}


def in_bounds(r: int, c: int) -> bool:
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def other(player: int) -> int:
    return 2 if player == 1 else 1


def _edge(a: tuple[int, int], b: tuple[int, int]) -> frozenset:
    return frozenset((a, b))


@dataclass
class GameState:
    pawns: dict = field(default_factory=lambda: dict(START_POS))
    walls_left: dict = field(default_factory=lambda: {1: WALLS_PER_PLAYER, 2: WALLS_PER_PLAYER})
    blocked_edges: set = field(default_factory=set)
    wall_slots: set = field(default_factory=set)  # (r, c) intersections already used
    walls: list = field(default_factory=list)  # [{r, c, orientation}] for rendering
    turn: int = 1
    winner: Optional[int] = None

    def clone(self) -> "GameState":
        return deepcopy(self)

    def to_dict(self) -> dict:
        return {
            "pawns": {str(p): list(pos) for p, pos in self.pawns.items()},
            "wallsLeft": dict(self.walls_left),
            "walls": [dict(w) for w in self.walls],
            "turn": self.turn,
            "winner": self.winner,
        }


def wall_blocks(state: GameState, a: tuple[int, int], b: tuple[int, int]) -> bool:
    return _edge(a, b) in state.blocked_edges


def _perpendicular(dr: int, dc: int):
    if dr != 0:
        return [(0, -1), (0, 1)]
    return [(-1, 0), (1, 0)]


def legal_pawn_moves(state: GameState, player: int) -> list[tuple[int, int]]:
    r, c = state.pawns[player]
    orow, ocol = state.pawns[other(player)]
    moves = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if not in_bounds(nr, nc) or wall_blocks(state, (r, c), (nr, nc)):
            continue
        if (nr, nc) == (orow, ocol):
            jr, jc = nr + dr, nc + dc
            if in_bounds(jr, jc) and not wall_blocks(state, (nr, nc), (jr, jc)):
                moves.append((jr, jc))
            else:
                for ddr, ddc in _perpendicular(dr, dc):
                    sr, sc = nr + ddr, nc + ddc
                    if in_bounds(sr, sc) and not wall_blocks(state, (nr, nc), (sr, sc)):
                        moves.append((sr, sc))
        else:
            moves.append((nr, nc))
    return moves


def shortest_path_len(state: GameState, player: int) -> Optional[int]:
    """BFS distance to the player's goal row, ignoring pawn occupancy."""
    start = state.pawns[player]
    goal_row = GOAL_ROW[player]
    if start[0] == goal_row:
        return 0
    seen = {start}
    q = deque([(start, 0)])
    while q:
        (r, c), dist = q.popleft()
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if not in_bounds(nr, nc) or (nr, nc) in seen:
                continue
            if wall_blocks(state, (r, c), (nr, nc)):
                continue
            if nr == goal_row:
                return dist + 1
            seen.add((nr, nc))
            q.append(((nr, nc), dist + 1))
    return None


def _wall_edges(r: int, c: int, orientation: str):
    if orientation == "H":
        return [((r, c), (r + 1, c)), ((r, c + 1), (r + 1, c + 1))]
    return [((r, c), (r, c + 1)), ((r + 1, c), (r + 1, c + 1))]


def can_place_wall(state: GameState, player: int, r: int, c: int, orientation: str) -> tuple[bool, str]:
    if state.walls_left[player] <= 0:
        return False, "no walls left"
    if not (0 <= r < BOARD_SIZE - 1 and 0 <= c < BOARD_SIZE - 1):
        return False, "wall out of bounds"
    if orientation not in ("H", "V"):
        return False, "invalid orientation"
    if (r, c) in state.wall_slots:
        return False, "wall overlaps an existing wall"
    new_edges = _wall_edges(r, c, orientation)
    if any(_edge(a, b) in state.blocked_edges for a, b in new_edges):
        return False, "wall overlaps an existing wall"

    trial = state.clone()
    trial.blocked_edges |= {_edge(a, b) for a, b in new_edges}
    if shortest_path_len(trial, 1) is None or shortest_path_len(trial, 2) is None:
        return False, "wall would block a player's only path"
    return True, ""


def apply_move(state: GameState, player: int, to: tuple[int, int]) -> tuple[bool, str]:
    if state.winner is not None:
        return False, "game already over"
    if state.turn != player:
        return False, "not your turn"
    if to not in legal_pawn_moves(state, player):
        return False, "illegal move"
    state.pawns[player] = to
    if to[0] == GOAL_ROW[player]:
        state.winner = player
    else:
        state.turn = other(player)
    return True, ""


def apply_wall(state: GameState, player: int, r: int, c: int, orientation: str) -> tuple[bool, str]:
    if state.winner is not None:
        return False, "game already over"
    if state.turn != player:
        return False, "not your turn"
    ok, err = can_place_wall(state, player, r, c, orientation)
    if not ok:
        return False, err
    for a, b in _wall_edges(r, c, orientation):
        state.blocked_edges.add(_edge(a, b))
    state.wall_slots.add((r, c))
    state.walls.append({"r": r, "c": c, "orientation": orientation, "player": player})
    state.walls_left[player] -= 1
    state.turn = other(player)
    return True, ""


def legal_wall_placements(state: GameState, player: int):
    if state.walls_left[player] <= 0:
        return []
    result = []
    for r in range(BOARD_SIZE - 1):
        for c in range(BOARD_SIZE - 1):
            for orientation in ("H", "V"):
                ok, _ = can_place_wall(state, player, r, c, orientation)
                if ok:
                    result.append((r, c, orientation))
    return result
