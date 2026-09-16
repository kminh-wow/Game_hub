"""A lightweight Quoridor AI opponent.

Uses shortest-path (BFS) distance as the core heuristic and a shallow
2-ply minimax search. Wall-placement candidates are restricted to a
bounding box around both pawns so the search stays fast enough for a
free-tier server.
"""
from __future__ import annotations

from . import game

TOP_K_FOR_LOOKAHEAD = 8


def _restricted_wall_candidates(state: game.GameState, player: int):
    r1, c1 = state.pawns[1]
    r2, c2 = state.pawns[2]
    rmin, rmax = max(0, min(r1, r2) - 2), min(game.BOARD_SIZE - 2, max(r1, r2) + 1)
    cmin, cmax = max(0, min(c1, c2) - 2), min(game.BOARD_SIZE - 2, max(c1, c2) + 1)
    candidates = []
    for r in range(rmin, rmax + 1):
        for c in range(cmin, cmax + 1):
            for orientation in ("H", "V"):
                ok, _ = game.can_place_wall(state, player, r, c, orientation)
                if ok:
                    candidates.append((r, c, orientation))
    return candidates


def _actions(state: game.GameState, player: int):
    acts = [("move", m) for m in game.legal_pawn_moves(state, player)]
    if state.walls_left[player] > 0:
        acts += [("wall", w) for w in _restricted_wall_candidates(state, player)]
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


def choose_move(state: game.GameState, player: int):
    """Returns the chosen ("move", pos) or ("wall", (r, c, orientation))."""
    opp = game.other(player)
    actions = _actions(state, player)
    if not actions:
        return None

    scored = []
    for action in actions:
        nxt = _apply(state, player, action)
        scored.append((_score(nxt, player), action, nxt))
    scored.sort(key=lambda t: t[0], reverse=True)

    top = scored[:TOP_K_FOR_LOOKAHEAD]
    best_action, best_value = top[0][1], float("-inf")
    for value, action, nxt in top:
        if nxt.winner == player:
            return action
        reply_actions = _actions(nxt, opp)
        worst = value if not reply_actions else float("inf")
        for reply in reply_actions:
            after_reply = _apply(nxt, opp, reply)
            worst = min(worst, _score(after_reply, player))
        if worst > best_value:
            best_value = worst
            best_action = action
    return best_action
