"""점수 계산 설명(explain): 점수와 어긋나지 않는지. rules 만 쓰므로 pybullet 없이도 돌릴 수 있다."""
import random

import pytest

from app.rules import CATEGORY_IDS, NOT_MET, UPPER_IDS, all_notes, explain, score


@pytest.mark.parametrize(("category", "dice", "expected"), [
    ("aces", [1, 1, 3, 4, 1], "1+1+1"),
    ("sixes", [6, 6, 2, 6, 5], "6+6+6"),
    ("fours", [1, 2, 3, 5, 6], "0개"),
    ("choice", [6, 1, 4, 2, 5], "1+2+4+5+6"),
    ("four_kind", [5, 2, 5, 5, 5], "2+5+5+5+5"),
    ("four_kind", [5, 5, 5, 2, 2], NOT_MET),
    ("full_house", [3, 2, 3, 2, 3], "2+2+3+3+3"),
    ("full_house", [4, 4, 4, 4, 4], NOT_MET),
    ("small_straight", [1, 2, 3, 4, 6], "1-2-3-4"),
    ("small_straight", [3, 3, 4, 5, 6], "3-4-5-6"),
    ("small_straight", [1, 2, 3, 4, 5], "1-2-3-4-5"),   # 5개 연속이어도 이어진 눈을 전부 보여 준다
    ("small_straight", [1, 2, 3, 5, 6], NOT_MET),
    ("large_straight", [6, 5, 4, 3, 2], "2-3-4-5-6"),
    ("large_straight", [1, 2, 3, 4, 6], NOT_MET),
    ("yacht", [2, 2, 2, 2, 2], "2×5"),
    ("yacht", [2, 2, 2, 2, 3], NOT_MET),
])
def test_explain(category, dice, expected):
    assert explain(category, dice) == expected


def test_explanation_never_contradicts_score():
    """무작위 주사위 5000판: 설명이 '안 맞음'이면 0점, 아니면 0점이 아니고, 더하는 식은 점수와 같다."""
    rng = random.Random(7)
    for _ in range(5000):
        dice = [rng.randint(1, 6) for _ in range(5)]
        for category in CATEGORY_IDS:
            note, points = explain(category, dice), score(category, dice)
            if note in (NOT_MET, "0개"):
                assert points == 0, (category, dice, note)
                continue
            assert points > 0, (category, dice, note)
            if "+" in note or category in UPPER_IDS:
                assert sum(int(x) for x in note.split("+")) == points, (category, dice, note)


def test_all_notes_covers_every_category():
    assert set(all_notes([1, 2, 3, 4, 5])) == set(CATEGORY_IDS)
