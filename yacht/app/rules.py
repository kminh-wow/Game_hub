"""요트 다이스 족보와 점수 계산 (닌텐도 「세계의 아소비 대전」 요트 규칙)."""
from __future__ import annotations

from collections import Counter

DICE = 5
MAX_ROLLS = 3
UPPER_BONUS_AT = 63
UPPER_BONUS = 35

# (id, 이름) — 점수판 순서
UPPER = [("aces", "에이스"), ("deuces", "듀스"), ("threes", "트레이"),
         ("fours", "포"), ("fives", "파이브"), ("sixes", "식스")]
LOWER = [("choice", "초이스"), ("four_kind", "포 카인드"), ("full_house", "풀 하우스"),
         ("small_straight", "S. 스트레이트"), ("large_straight", "L. 스트레이트"), ("yacht", "요트")]
CATEGORIES = UPPER + LOWER
CATEGORY_IDS = [c for c, _ in CATEGORIES]
UPPER_IDS = [c for c, _ in UPPER]
ROUNDS = len(CATEGORIES)


def score(category: str, dice: list[int]) -> int:
    counts = Counter(dice)
    total = sum(dice)
    faces = set(dice)
    if category in UPPER_IDS:
        face = UPPER_IDS.index(category) + 1
        return face * counts[face]
    if category == "choice":
        return total
    if category == "four_kind":
        return total if max(counts.values()) >= 4 else 0
    if category == "full_house":
        return total if sorted(counts.values()) == [2, 3] else 0
    if category == "small_straight":
        runs = ({1, 2, 3, 4}, {2, 3, 4, 5}, {3, 4, 5, 6})
        return 15 if any(r <= faces for r in runs) else 0
    if category == "large_straight":
        return 30 if faces in ({1, 2, 3, 4, 5}, {2, 3, 4, 5, 6}) else 0
    if category == "yacht":
        return 50 if len(faces) == 1 else 0
    raise ValueError(category)


def all_scores(dice: list[int]) -> dict[str, int]:
    return {c: score(c, dice) for c in CATEGORY_IDS}


def totals(sheet: dict[str, int | None]) -> dict[str, int]:
    upper = sum(sheet.get(c) or 0 for c in UPPER_IDS)
    bonus = UPPER_BONUS if upper >= UPPER_BONUS_AT else 0
    lower = sum(sheet.get(c) or 0 for c, _ in LOWER)
    return {"upper": upper, "bonus": bonus, "total": upper + bonus + lower}


def best_category(sheet: dict[str, int | None], dice: list[int]) -> str:
    """시간 초과 때 자동으로 적을 칸: 비어 있는 칸 중 지금 점수가 가장 높은 칸.
    점수가 같으면 점수판 아래쪽 칸, 어디에 적어도 0점이면 가장 덜 아까운 위쪽 칸(에이스부터)."""
    empty = [c for c in CATEGORY_IDS if sheet.get(c) is None]
    best = max(score(c, dice) for c in empty)
    if best > 0:
        return next(c for c in reversed(empty) if score(c, dice) == best)
    # 전부 0점이면 버려도 덜 아까운 칸부터: 에이스 → 듀스 … 순
    return empty[0]
