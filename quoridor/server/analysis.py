"""Move-quality feedback for the learning mode.

Scores every legal action available to a player the same way the AI
evaluates its own candidates (see ai.py) and turns that score into a
human-readable label, plain-language reasons, and a step-by-step
"pseudocode" trace of the BFS + scoring calculation, so a learner can
hover a cell or wall slot and see exactly how the number was produced.
"""
from __future__ import annotations

from . import ai, game

BEST_THRESHOLD = 0.01
GOOD_THRESHOLD = 9
OK_THRESHOLD = 19


def _label_for(gap: float) -> str:
    if gap <= BEST_THRESHOLD:
        return "최선의 수"
    if gap <= GOOD_THRESHOLD:
        return "좋은 수"
    if gap <= OK_THRESHOLD:
        return "괜찮은 수"
    return "안좋은 수"


def _reasons(my_before, my_after, opp_before, opp_after, before, after, player, is_wall) -> list[str]:
    reasons = []

    if after.winner == player:
        return ["이 수로 바로 승리합니다!"]

    if my_after != my_before:
        verb = "단축" if my_after < my_before else "증가"
        reasons.append(f"내 최단거리: {my_before} → {my_after}칸 ({verb})")
    elif not is_wall:
        reasons.append(f"내 최단거리는 그대로 {my_after}칸입니다")

    if opp_after != opp_before:
        verb = "증가 (상대에게 불리)" if opp_after > opp_before else "감소 (상대에게 유리)"
        reasons.append(f"상대 최단거리: {opp_before} → {opp_after}칸 ({verb})")
    elif is_wall:
        reasons.append("상대 최단거리는 그대로입니다 — 벽 효과가 거의 없습니다")

    if is_wall:
        reasons.append(f"벽 사용: 남은 벽 {before.walls_left[player]} → {after.walls_left[player]}개")

    return reasons


def _trace(action_desc, my_before, my_after, opp_before, opp_after, before, after, player, score) -> list[str]:
    opp = game.other(player)
    return [
        "[ 현재 상태 ]",
        f"BFS(내 위치={list(before.pawns[player])}, 목표행={game.GOAL_ROW[player]}) = {my_before}칸",
        f"BFS(상대 위치={list(before.pawns[opp])}, 목표행={game.GOAL_ROW[opp]}) = {opp_before}칸",
        "",
        f"[ {action_desc} 이후 ]",
        f"BFS(내 위치={list(after.pawns[player])}, 목표행={game.GOAL_ROW[player]}) = {my_after}칸",
        f"BFS(상대 위치={list(after.pawns[opp])}, 목표행={game.GOAL_ROW[opp]}) = {opp_after}칸",
        "",
        "score = (상대거리 − 내거리) × 10 + (내 벽 − 상대 벽) × 0.5",
        f"      = ({opp_after} − {my_after}) × 10"
        f" + ({after.walls_left[player]} − {after.walls_left[opp]}) × 0.5",
        f"      = {score:.1f}",
    ]


def analyze_actions(state: game.GameState, player: int) -> list[dict]:
    opp = game.other(player)
    my_before = game.shortest_path_len(state, player)
    opp_before = game.shortest_path_len(state, opp)

    entries = []

    def add_entry(kind, payload, nxt, action_desc):
        my_after = game.shortest_path_len(nxt, player)
        opp_after = game.shortest_path_len(nxt, opp)
        score = ai._score(nxt, player)
        entries.append({
            "kind": kind,
            **payload,
            "score": score,
            "reasons": _reasons(my_before, my_after, opp_before, opp_after, state, nxt, player, kind == "wall"),
            "trace": _trace(action_desc, my_before, my_after, opp_before, opp_after, state, nxt, player, score),
        })

    for to in game.legal_pawn_moves(state, player):
        nxt = state.clone()
        game.apply_move(nxt, player, to)
        add_entry("move", {"to": list(to)}, nxt, f"({to[0]}, {to[1]})로 이동")

    for r, c, orientation in game.legal_wall_placements(state, player):
        nxt = state.clone()
        game.apply_wall(nxt, player, r, c, orientation)
        add_entry(
            "wall", {"r": r, "c": c, "orientation": orientation}, nxt,
            f"({r}, {c}) {orientation} 벽 설치",
        )

    if not entries:
        return entries

    best_score = max(e["score"] for e in entries)
    for e in entries:
        e["label"] = _label_for(best_score - e["score"])
        del e["score"]
    return entries
