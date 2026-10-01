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


NOT_MET = "조건 안 맞음"


def _longest_run(faces: set[int]) -> list[int]:
    """이어진 눈 중 가장 긴 줄 (예: {1,2,3,5,6} -> [1,2,3])."""
    best: list[int] = []
    run: list[int] = []
    for face in sorted(faces):
        run = run + [face] if run and face == run[-1] + 1 else [face]
        if len(run) > len(best):
            best = run
    return best


def explain(category: str, dice: list[int]) -> str:
    """점수가 어떻게 나왔는지 짧은 식으로 설명한다 (점수판의 점수 아래에 작게 보여 준다).

    - 눈을 더하는 칸: "2+2+2" 처럼 더한 눈을 그대로 보여 준다.
    - 스트레이트: 이어진 눈 "2-3-4-5", 요트: "6×5" (점수는 15·30·50으로 정해져 있다).
    - 점수가 0이면 에이스~식스는 "0개", 나머지는 "조건 안 맞음".
    """
    counts = Counter(dice)
    faces = set(dice)
    plus = lambda xs: "+".join(str(x) for x in xs)  # noqa: E731
    if category in UPPER_IDS:
        face = UPPER_IDS.index(category) + 1
        return plus([face] * counts[face]) if counts[face] else "0개"
    if category == "choice":
        return plus(sorted(dice))
    if category == "four_kind":
        return plus(sorted(dice)) if max(counts.values()) >= 4 else NOT_MET
    if category == "full_house":
        return plus(sorted(dice)) if sorted(counts.values()) == [2, 3] else NOT_MET
    if category == "small_straight":
        run = _longest_run(faces)
        return "-".join(str(x) for x in run) if len(run) >= 4 else NOT_MET
    if category == "large_straight":
        return "-".join(str(x) for x in sorted(faces)) if faces in ({1, 2, 3, 4, 5}, {2, 3, 4, 5, 6}) else NOT_MET
    if category == "yacht":
        return f"{dice[0]}×{DICE}" if len(faces) == 1 else NOT_MET
    raise ValueError(category)


def all_notes(dice: list[int]) -> dict[str, str]:
    return {c: explain(c, dice) for c in CATEGORY_IDS}


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
