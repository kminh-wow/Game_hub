"""섯다 규칙: 화투 1~10월 20장, 두 장 족보, 특수패(암행어사·땡잡이·구사), 승패 정하기.

카드는 "3a"처럼 월(1~10) + 종류 한 글자.
  a: 그 달의 좋은 패 (1·3·8월은 광, 나머지는 열끗)
  b: 나머지 한 장 (띠 또는 피)
족보 값은 숫자가 클수록 세다.
"""
from __future__ import annotations

from collections.abc import Iterable

GWANG_MONTHS = (1, 3, 8)
MONTH_NAMES = {10: "장"}
SPECIAL_NAMES = {(1, 2): "알리", (1, 4): "독사", (1, 9): "구삥", (1, 10): "장삥", (4, 10): "장사", (4, 6): "세륙"}
SPECIAL_VALUES = {(1, 2): 800, (1, 4): 790, (1, 9): 780, (1, 10): 770, (4, 10): 760, (4, 6): 750}
TTAENG_BASE = 900          # 1땡 901 … 장땡 910
KKEUT_BASE = 700           # 망통 700 … 갑오 709


def new_deck() -> list[str]:
    return [f"{m}{k}" for m in range(1, 11) for k in "ab"]


def month(card: str) -> int:
    return int(card[:-1])


def is_gwang(card: str) -> bool:
    return card[-1] == "a" and month(card) in GWANG_MONTHS


def is_yeol(card: str) -> bool:
    return card[-1] == "a" and month(card) not in GWANG_MONTHS


# 두 장의 족보: (값, 이름, 특수패 종류 또는 None)
def evaluate(cards: Iterable[str]) -> tuple[int, str, str | None]:
    a, b = sorted(cards, key=lambda c: (month(c), c))
    ma, mb = month(a), month(b)
    if is_gwang(a) and is_gwang(b):
        pair = (ma, mb)
        if pair == (3, 8):
            return 1000, "38광땡", None
        if pair == (1, 8):
            return 990, "18광땡", None
        return 980, "13광땡", None
    if ma == mb:
        return TTAENG_BASE + ma, ("장땡" if ma == 10 else f"{ma}땡"), None
    if (ma, mb) == (4, 7) and is_yeol(a) and is_yeol(b):
        return KKEUT_BASE + 1, "암행어사", "amhaeng"
    if (ma, mb) == (3, 7) and is_gwang(a) and is_yeol(b):
        return KKEUT_BASE, "땡잡이", "ttaengjabi"
    if (ma, mb) == (4, 9):
        if is_yeol(a) and is_yeol(b):
            return KKEUT_BASE + 3, "멍텅구리 구사", "meong49"
        return KKEUT_BASE + 3, "구사", "49"
    if (ma, mb) in SPECIAL_VALUES:
        return SPECIAL_VALUES[(ma, mb)], SPECIAL_NAMES[(ma, mb)], None
    k = (ma + mb) % 10
    return KKEUT_BASE + k, ("갑오" if k == 9 else "망통" if k == 0 else f"{k}끗"), None


def needs_redeal(hands: dict[str, list[str]]) -> str | None:
    """구사 재경기인지: 구사는 가장 센 패가 알리 이하, 멍텅구리 구사는 9땡 이하일 때. 재경기면 그 패 이름."""
    evals = {k: evaluate(v) for k, v in hands.items()}
    top = max(v[0] for v in evals.values())
    if any(e[2] == "meong49" for e in evals.values()) and top <= TTAENG_BASE + 9:
        return "멍텅구리 구사"
    if any(e[2] == "49" for e in evals.values()) and top <= SPECIAL_VALUES[(1, 2)]:
        return "구사"
    return None


def effective(hands: dict[str, list[str]]) -> dict[str, float]:
    """특수패까지 따진 실제 세기. 땡잡이는 1~9땡을, 암행어사는 13·18광땡을 잡는다."""
    evals = {k: evaluate(v) for k, v in hands.items()}
    top = max(v[0] for v in evals.values())
    out: dict[str, float] = {}
    for k, (value, _name, special) in evals.items():
        if special == "ttaengjabi" and TTAENG_BASE + 1 <= top <= TTAENG_BASE + 9:
            out[k] = top + 0.5
        elif special == "amhaeng" and top in (980, 990):
            out[k] = top + 0.5
        else:
            out[k] = value
    return out


def winners(hands: dict[str, list[str]]) -> list[str]:
    eff = effective(hands)
    best = max(eff.values())
    return [k for k, v in eff.items() if v == best]


def split_pots(committed: dict[str, int], live: set[str]) -> list[tuple[int, list[str]]]:
    """낸 칩으로 팟 나누기 (홀덤과 같음). 메인 팟부터 [(크기, 받을 수 있는 사람들)]."""
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
    rest = sum(max(0, v - prev) for v in committed.values())
    if rest and pots:
        pots[-1] = (pots[-1][0] + rest, pots[-1][1])
    return pots


# 족보 표 (화면 설명용, 센 것부터)
RANKING = [
    ("38광땡", "3월 광 + 8월 광"), ("18광땡", "1월 광 + 8월 광"), ("13광땡", "1월 광 + 3월 광"),
    ("장땡", "10월 두 장"), ("9땡 ~ 1땡", "같은 월 두 장"), ("알리", "1 + 2"), ("독사", "1 + 4"),
    ("구삥", "1 + 9"), ("장삥", "1 + 10"), ("장사", "4 + 10"), ("세륙", "4 + 6"),
    ("갑오", "합의 끝자리 9"), ("8끗 ~ 1끗", "합의 끝자리"), ("망통", "합의 끝자리 0"),
]
