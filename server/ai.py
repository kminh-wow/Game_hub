"""A lightweight Quoridor AI opponent with three difficulty presets.

Uses shortest-path (BFS) distance as the core heuristic. "medium" and
"hard" add a shallow 2-ply minimax search on top; "easy" plays greedily
off a narrow view of the board and occasionally blunders. Wall-placement
candidates can be restricted to a bounding box around both pawns so the
search stays fast enough for a free-tier server.
"""
from __future__ import annotations

import random

from . import game

DEFAULT_DIFFICULTY = "medium"

# top_k: how many of the AI's own 1-ply candidates get 2-ply lookahead.
# wall_margin: how far past the pawns' bounding box wall candidates reach
#   (None = consider every legal wall on the board).
# lookahead: whether to simulate the opponent's best reply before deciding.
# blunder_rate: chance of playing a uniformly random legal action instead.
_PRESETS = {
    "easy":   {"top_k": 1,  "wall_margin": 1,    "lookahead": False, "blunder_rate": 0.3},
    "medium": {"top_k": 8,  "wall_margin": 2,    "lookahead": True,  "blunder_rate": 0.0},
    "hard":   {"top_k": 16, "wall_margin": None, "lookahead": True,  "blunder_rate": 0.0},
}

DIFFICULTIES = tuple(_PRESETS.keys())


def _wall_candidates(state: game.GameState, player: int, margin):
    if margin is None:
        return game.legal_wall_placements(state, player)

    r1, c1 = state.pawns[1]
    r2, c2 = state.pawns[2]
    rmin, rmax = max(0, min(r1, r2) - margin), min(game.BOARD_SIZE - 2, max(r1, r2) + margin)
    cmin, cmax = max(0, min(c1, c2) - margin), min(game.BOARD_SIZE - 2, max(c1, c2) + margin)
    candidates = []
    for r in range(rmin, rmax + 1):
        for c in range(cmin, cmax + 1):
            for orientation in ("H", "V"):
                ok, _ = game.can_place_wall(state, player, r, c, orientation)
                if ok:
                    candidates.append((r, c, orientation))
    return candidates


def _actions(state: game.GameState, player: int, wall_margin):
    acts = [("move", m) for m in game.legal_pawn_moves(state, player)]
    if state.walls_left[player] > 0:
        acts += [("wall", w) for w in _wall_candidates(state, player, wall_margin)]
    return acts


def _apply(state: game.GameState, player: int, action) -> game.GameState:
    nxt = state.clone()
    kind, payload = action
    if kind == "move":
        game.apply_move(nxt, player, payload)
    else:
        r, c, orientation = payload
        game.apply_wall(nxt, player, r, c, orientation)
    return nxt


def _score(state: game.GameState, player: int) -> float:
    opp = game.other(player)
    if state.winner == player:
        return 1000.0
    if state.winner == opp:
        return -1000.0
    my_dist = game.shortest_path_len(state, player)
    opp_dist = game.shortest_path_len(state, opp)
    score = (opp_dist - my_dist) * 10
    score += state.walls_left[player] * 0.5
    score -= state.walls_left[opp] * 0.5
    return score


def choose_move(state: game.GameState, player: int, difficulty: str = DEFAULT_DIFFICULTY):
    """Returns the chosen ("move", pos) or ("wall", (r, c, orientation))."""
    cfg = _PRESETS.get(difficulty, _PRESETS[DEFAULT_DIFFICULTY])
    opp = game.other(player)
    actions = _actions(state, player, cfg["wall_margin"])
    if not actions:
        return None

    if random.random() < cfg["blunder_rate"]:
        return random.choice(actions)

    scored = []
    for action in actions:
        nxt = _apply(state, player, action)
        scored.append((_score(nxt, player), action, nxt))
    scored.sort(key=lambda t: t[0], reverse=True)

    top = scored[: cfg["top_k"]]
    if not cfg["lookahead"]:
        return top[0][1]

    best_action, best_value = top[0][1], float("-inf")
    for value, action, nxt in top:
        if nxt.winner == player:
            return action
        reply_actions = _actions(nxt, opp, cfg["wall_margin"])
        worst = value if not reply_actions else float("inf")
        for reply in reply_actions:
            after_reply = _apply(nxt, opp, reply)
            worst = min(worst, _score(after_reply, player))
        if worst > best_value:
            best_value = worst
            best_action = action
    return best_action
