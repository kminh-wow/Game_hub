"""고스톱 규칙: 화투 48장, 먹은 패 점수, 박, 최종 정산.

카드는 "3a"처럼 월(1~12) + a·b·c·d. 종류는 KINDS[월][글자순서].
  gwang 광, yeol 열끗, hong 홍단, cheong 청단, cho 초단, tti 띠(비띠), pi 피, ssangpi 쌍피
9월 열끗(국진)은 점수를 셀 때 열끗과 쌍피 중 유리한 쪽으로 친다.
"""
from __future__ import annotations

from collections.abc import Iterable

KINDS = {
    1: ["gwang", "hong", "pi", "pi"],
    2: ["yeol", "hong", "pi", "pi"],
    3: ["gwang", "hong", "pi", "pi"],
    4: ["yeol", "cho", "pi", "pi"],
    5: ["yeol", "cho", "pi", "pi"],
    6: ["yeol", "cheong", "pi", "pi"],
    7: ["yeol", "cho", "pi", "pi"],
    8: ["gwang", "yeol", "pi", "pi"],
    9: ["yeol", "cheong", "pi", "pi"],
    10: ["yeol", "cheong", "pi", "pi"],
    11: ["gwang", "ssangpi", "pi", "pi"],
    12: ["gwang", "yeol", "tti", "ssangpi"],
}
TTI_KINDS = ("hong", "cheong", "cho", "tti")
GODORI = {"2a", "4a", "8b"}            # 꾀꼬리·두견새·기러기
BI_GWANG = "12a"                       # 비광
GUKJIN = "9a"                          # 국진 (9월 열끗)
NAMES = {"gwang": "광", "yeol": "열끗", "hong": "홍단", "cheong": "청단", "cho": "초단", "tti": "띠", "pi": "피", "ssangpi": "쌍피"}


def new_deck() -> list[str]:
    return [f"{m}{'abcd'[i]}" for m in range(1, 13) for i in range(4)]


def month(card: str) -> int:
    return int(card[:-1])


def kind(card: str) -> str:
    return KINDS[month(card)]["abcd".index(card[-1])]


# 카드 값어치 (AI와 자동 고르기에 씀)
def worth(card: str) -> int:
    k = kind(card)
    return {"gwang": 20, "yeol": 10, "hong": 7, "cheong": 7, "cho": 7, "tti": 5, "ssangpi": 4, "pi": 2}[k] + (5 if card in GODORI else 0)


def pi_value(cards: Iterable[str], gukjin_as_pi: bool = False) -> int:
    total = 0
    for c in cards:
        k = kind(c)
        if k == "pi":
            total += 1
        elif k == "ssangpi" or (c == GUKJIN and gukjin_as_pi):
            total += 2
    return total


def _score_once(cards: list[str], gukjin_as_pi: bool) -> dict:
    gw = [c for c in cards if kind(c) == "gwang"]
    yeol = [c for c in cards if kind(c) == "yeol" and not (c == GUKJIN and gukjin_as_pi)]
    tti = [c for c in cards if kind(c) in TTI_KINDS]
    pv = pi_value(cards, gukjin_as_pi)
    parts: dict[str, int] = {}
    if len(gw) == 5:
        parts["광"] = 15
    elif len(gw) == 4:
        parts["광"] = 4
    elif len(gw) == 3:
        parts["광"] = 2 if BI_GWANG in gw else 3
    if len(yeol) >= 5:
        parts["열끗"] = len(yeol) - 4
    if GODORI <= set(cards):
        parts["고도리"] = 5
    if len(tti) >= 5:
        parts["띠"] = len(tti) - 4
    for name, k in (("홍단", "hong"), ("청단", "cheong"), ("초단", "cho")):
        if sum(1 for c in cards if kind(c) == k) == 3:
            parts[name] = 3
    if pv >= 10:
        parts["피"] = pv - 9
    return {"parts": parts, "total": sum(parts.values()), "gwang": len(gw), "yeol": len(yeol), "tti": len(tti), "pi": pv,
            "gukjin_as_pi": gukjin_as_pi}


def score(cards: Iterable[str]) -> dict:
    """먹은 패의 점수. 국진은 열끗·쌍피 중 점수가 높은 쪽 (같으면 열끗)."""
    cards = list(cards)
    a = _score_once(cards, False)
    if GUKJIN not in cards:
        return a
    b = _score_once(cards, True)
    return b if b["total"] > a["total"] else a


def go_points(base: int, gos: int) -> int:
    """고 점수: 1고 +1, 2고 +2, 3고부터는 +2 하고 두 배씩."""
    if gos <= 0:
        return base
    if gos == 1:
        return base + 1
    return (base + 2) * (2 ** max(0, gos - 2))


def loser_bak(winner: dict, loser: dict) -> list[str]:
    """진 사람에게 붙는 박: 피박(이긴 사람이 피로 점수, 진 사람 피 5 이하), 광박(광으로 점수, 진 사람 광 0), 멍박(열끗 7장 이상, 진 사람 열끗 0)."""
    baks = []
    if "피" in winner["parts"] and loser["pi"] <= 5:
        baks.append("피박")
    if "광" in winner["parts"] and loser["gwang"] == 0:
        baks.append("광박")
    if winner["yeol"] >= 7 and loser["yeol"] == 0:
        baks.append("멍박")
    return baks


def steal_pick(captured: list[str]) -> str | None:
    """피를 뺏길 때 내줄 카드: 피 한 장(없으면 쌍피, 국진은 마지막)."""
    for k in ("pi", "ssangpi"):
        for c in captured:
            if kind(c) == k:
                return c
    return GUKJIN if GUKJIN in captured else None


def best_of(cards: Iterable[str]) -> str:
    return max(cards, key=worth)
