"""Move-quality feedback for the learning mode.

Scores every legal action available to a player the same way the AI
evaluates its own candidates (see ai.py) and turns that score into a
human-readable label and reasons, so a learner can hover a cell or wall
slot and see why it's a good or bad idea.
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


def _reasons(before: game.GameState, after: game.GameState, player: int, is_wall: bool) -> list[str]:
    opp = game.other(player)
    my_before, my_after = game.shortest_path_len(before, player), game.shortest_path_len(after, player)
    opp_before, opp_after = game.shortest_path_len(before, opp), game.shortest_path_len(after, opp)
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


def analyze_actions(state: game.GameState, player: int) -> list[dict]:
    entries = []
    for to in game.legal_pawn_moves(state, player):
        nxt = state.clone()
        game.apply_move(nxt, player, to)
        entries.append({
            "kind": "move",
            "to": list(to),
            "score": ai._score(nxt, player),
            "reasons": _reasons(state, nxt, player, is_wall=False),
        })

    for r, c, orientation in game.legal_wall_placements(state, player):
        nxt = state.clone()
        game.apply_wall(nxt, player, r, c, orientation)
        entries.append({
            "kind": "wall",
            "r": r,
            "c": c,
            "orientation": orientation,
            "score": ai._score(nxt, player),
            "reasons": _reasons(state, nxt, player, is_wall=True),
        })

    if not entries:
        return entries

    best_score = max(e["score"] for e in entries)
    for e in entries:
        e["label"] = _label_for(best_score - e["score"])
        del e["score"]
    return entries
