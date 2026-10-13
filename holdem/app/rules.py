"""홀덤 규칙: 카드, 족보 판정(7장 중 가장 좋은 5장), 팟 나누기(사이드 팟).

카드는 "As"(스페이드 A), "Td"(다이아 10)처럼 숫자 1글자 + 무늬 1글자 문자열.
족보 값은 (등급, 비교용 숫자들) 튜플이라 큰 쪽이 이긴다.
"""
from __future__ import annotations

from collections import Counter
from itertools import combinations

RANKS = "23456789TJQKA"
SUITS = "shdc"            # 스페이드, 하트, 다이아, 클럽

# 족보 등급 (높을수록 셈)
HIGH, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH = range(9)
HAND_NAMES = ["하이카드", "원페어", "투페어", "트리플", "스트레이트", "플러시", "풀하우스", "포카드", "스트레이트 플러시"]


def new_deck() -> list[str]:
    return [r + s for s in SUITS for r in RANKS]


def rank_of(card: str) -> int:
    return RANKS.index(card[0]) + 2


# 5장 족보 값
def eval5(cards: list[str]) -> tuple:
    ranks = sorted((rank_of(c) for c in cards), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    uniq = sorted(set(ranks), reverse=True)
    top = None
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            top = uniq[0]
        elif uniq == [14, 5, 4, 3, 2]:          # A-2-3-4-5 (가장 낮은 스트레이트)
            top = 5
    if top and flush:
        return (STRAIGHT_FLUSH, top)
    counts = Counter(ranks)
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    shape = [n for _, n in groups]
    order = tuple(r for r, _ in groups)
    if shape[0] == 4:
        return (QUADS, *order)
    if shape[:2] == [3, 2]:
        return (FULL_HOUSE, *order)
    if flush:
        return (FLUSH, *ranks)
    if top:
        return (STRAIGHT, top)
    if shape[0] == 3:
        return (TRIPS, *order)
    if shape[:2] == [2, 2]:
        return (TWO_PAIR, *order)
    if shape[0] == 2:
        return (PAIR, *order)
    return (HIGH, *ranks)


# 5~7장 중 가장 좋은 5장 (값, 그 5장)
def best_hand(cards: list[str]) -> tuple[tuple, list[str]]:
    best = None
    for combo in combinations(cards, 5):
        value = eval5(list(combo))
        if best is None or value > best[0]:
            best = (value, list(combo))
    return best


# 보여 주기용 정렬 (짝 많은 숫자 먼저, 큰 숫자 먼저)
def sort_five(cards: list[str]) -> list[str]:
    counts = Counter(c[0] for c in cards)
    return sorted(cards, key=lambda c: (counts[c[0]], rank_of(c)), reverse=True)


def hand_name(value: tuple) -> str:
    if value[0] == STRAIGHT_FLUSH and value[1] == 14:
        return "로열 플러시"
    return HAND_NAMES[value[0]]


# 지금까지 보이는 카드로 만든 족보 이름 (2~4장이면 짝만 봄)
def current_name(cards: list[str]) -> str:
    if len(cards) >= 5:
        return hand_name(best_hand(cards)[0])
    counts = sorted(Counter(c[0] for c in cards).values(), reverse=True)
    if counts[0] >= 4:
        return "포카드"
    if counts[0] == 3:
        return "트리플"
    if counts[0] == 2:
        return "투페어" if len(counts) > 1 and counts[1] == 2 else "원페어"
    return "하이카드"


# 지금 카드로 가진 족보: 가장 센 것 이름, 그 족보를 만드는 카드, 갖춘 족보 이름 전부
def made_info(cards: list[str]) -> dict:
    counts = Counter(c[0] for c in cards)
    sizes = sorted(counts.values(), reverse=True)
    made = {HIGH}
    if sizes[0] >= 2:
        made.add(PAIR)
    if sum(1 for n in sizes if n >= 2) >= 2:
        made.add(TWO_PAIR)
    if sizes[0] >= 3:
        made.add(TRIPS)
    if sizes[0] >= 4:
        made.add(QUADS)
    if sizes[0] >= 3 and sum(1 for n in sizes if n >= 2) >= 2:
        made.add(FULL_HOUSE)
    if len(cards) >= 5:
        value, five = best_hand(cards)
        best = value[0]
        for combo in combinations(cards, 5):
            made.add(eval5(list(combo))[0])
    else:
        best = max(made)
        five = cards
    name = HAND_NAMES[best] if not (best == STRAIGHT_FLUSH and value[1] == 14) else "로열 플러시"
    if best in (STRAIGHT, FLUSH, FULL_HOUSE, STRAIGHT_FLUSH):
        key = list(five)
    elif best == HIGH:
        key = [max(cards, key=rank_of)]
    else:
        group = Counter(c[0] for c in five)
        need = {PAIR: 1, TWO_PAIR: 2, TRIPS: 1, QUADS: 1}[best]
        ranks = sorted((r for r, n in group.items() if n >= 2), key=lambda r: (group[r], RANKS.index(r)), reverse=True)[:need]
        key = [c for c in five if c[0] in ranks]
    return {"best": name, "key": sort_five(key), "made": [HAND_NAMES[k] for k in sorted(made, reverse=True)]}


def split_pots(committed: dict[str, int], live: set[str]) -> list[tuple[int, list[str]]]:
    """낸 칩으로 팟 나누기. committed: 자리 → 이번 판에 낸 총액, live: 폴드 안 한 자리.

    돌려주는 값: [(팟 크기, 그 팟을 받을 수 있는 자리들)] — 메인 팟부터.
    폴드한 사람의 칩은 팟에 들어가지만 받을 자격은 없다.
    """
    pots: list[tuple[int, list[str]]] = []
    levels = sorted({v for k, v in committed.items() if k in live and v > 0})
    prev = 0
    for level in levels:
        size = sum(min(v, level) - min(v, prev) for v in committed.values())
        eligible = [k for k in committed if k in live and committed[k] >= level]
        if size:
            if pots and pots[-1][1] == eligible:
                pots[-1] = (pots[-1][0] + size, eligible)
            else:
                pots.append((size, eligible))
        prev = level
    # 살아 있는 사람 누구보다 더 낸 폴드 칩 (이론상 없지만 남기지 않게 마지막 팟에)
    rest = sum(max(0, v - prev) for v in committed.values())
    if rest and pots:
        pots[-1] = (pots[-1][0] + rest, pots[-1][1])
    return pots
