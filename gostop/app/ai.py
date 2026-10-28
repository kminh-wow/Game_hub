"""고스톱 AI: 낼 카드 고르기, 고·스톱 정하기. 먹을 수 있는 패의 값어치를 보는 단순한 욕심쟁이."""
from __future__ import annotations

import random

from .rules import best_of, month, worth


def choose_play(hand: list[str], floor: list[str], rng: random.Random | None = None) -> dict:
    """낼 카드와 방법: {card, target, shake, bomb}."""
    rng = rng or random.Random()
    best = None
    for card in hand:
        m = month(card)
        same_hand = [c for c in hand if month(c) == m]
        matches = [c for c in floor if month(c) == m]
        bomb = len(same_hand) == 3 and len(matches) == 1
        shake = len(same_hand) == 3 and not matches
        if bomb:
            value = 100 + sum(worth(c) for c in same_hand + matches)
        elif not matches:
            value = -worth(card) * 0.4                       # 버리는 카드는 값어치 낮은 것부터
        elif len(matches) == 3:
            value = 40 + worth(card) + sum(worth(c) for c in matches)
        else:
            value = 10 + worth(card) + worth(best_of(matches))
        value += rng.random() * 2
        if best is None or value > best[0]:
            best = (value, {"card": card, "target": best_of(matches) if matches else None, "shake": shake, "bomb": bomb})
    return best[1]


def choose_go(score: int, gos: int, hand_left: int, threshold: int, others_best: int) -> bool:
    """고를 할지: 손패가 넉넉하고, 상대가 곧 날 것 같지 않으면 고."""
    if hand_left < 2 or gos >= 3:
        return False
    if others_best >= threshold - 1:
        return False
    return score < threshold + 4
