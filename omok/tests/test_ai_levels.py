"""오목 AI 난이도 5단계."""
import random
import time

import pytest

from app.ai import DEFAULT_LEVEL, LEVEL_NAMES, ai_move
from app.rules import BLACK, EMPTY, SIZE, WHITE, new_board

LEVELS = range(len(LEVEL_NAMES))


def board_with(black=(), white=()):
    b = new_board()
    for x, y in black:
        b[y][x] = BLACK
    for x, y in white:
        b[y][x] = WHITE
    return b


def test_level_names_and_default():
    assert LEVEL_NAMES == ("하", "중", "중상", "상", "최상")
    assert LEVEL_NAMES[DEFAULT_LEVEL] == "중상"


@pytest.mark.parametrize("level", LEVELS)
def test_every_level_takes_a_win(level):
    b = board_with(black=[(3, 3), (4, 3), (6, 3), (7, 3)], white=[(5, 9), (6, 9)])   # 띈 사
    assert ai_move(b, BLACK, random.Random(1), level) == (5, 3)


@pytest.mark.parametrize("level", LEVELS)
def test_moves_are_always_legal(level):
    rng = random.Random(level)
    b = new_board()
    turn = BLACK
    for _ in range(30):
        x, y = ai_move(b, turn, rng, level, 0.1)
        assert 0 <= x < SIZE and 0 <= y < SIZE and b[y][x] == EMPTY
        b[y][x] = turn
        turn = WHITE if turn == BLACK else BLACK


@pytest.mark.parametrize("level", [2, 3, 4])
def test_mid_high_and_above_block_a_four(level):
    b = board_with(black=[(3, 5), (4, 5), (5, 5), (6, 5)], white=[(2, 5), (9, 9)])
    assert ai_move(b, WHITE, random.Random(0), level) == (7, 5)


def test_low_level_sometimes_misses_a_block():
    b = board_with(black=[(3, 5), (4, 5), (5, 5), (6, 5)], white=[(2, 5), (9, 9)])
    moves = {ai_move(b, WHITE, random.Random(seed), 0) for seed in range(40)}
    assert (7, 5) in moves and len(moves) > 1


def test_advanced_levels_see_a_split_three():
    b = board_with(white=[(5, 7), (6, 7), (8, 7)], black=[(7, 3), (3, 9)])    # ○○_○ 모양
    for level in (3, 4):
        assert ai_move(b, BLACK, random.Random(0), level) in [(4, 7), (7, 7), (9, 7)]


def test_expert_goes_for_a_winning_attack():
    b = board_with(black=[(7, 7), (8, 7), (9, 5), (9, 6)], white=[(1, 1), (13, 13)])
    assert ai_move(b, BLACK, random.Random(0), 4) in [(9, 7), (6, 7)]   # 3-3 이거나 열린 3 연속 공격


def test_expert_respects_time_limit():
    rng = random.Random(7)
    b = new_board()
    turn = BLACK
    for _ in range(40):
        x, y = ai_move(b, turn, rng, 2)
        b[y][x] = turn
        turn = WHITE if turn == BLACK else BLACK
    started = time.monotonic()
    ai_move(b, turn, rng, 4, 0.3)
    assert time.monotonic() - started < 0.8


def test_expert_does_not_change_the_board():
    b = board_with(black=[(7, 7), (8, 7), (9, 7)], white=[(7, 8), (8, 8)])
    before = [row[:] for row in b]
    ai_move(b, WHITE, random.Random(0), 4, 0.3)
    assert b == before


# ---- 사람 수 평가 (AI 대사용) ----

from app.ai import judge_move  # noqa: E402


def test_judge_not_blocking_a_four_is_a_blunder():
    b = board_with(white=[(3, 5), (4, 5), (5, 5), (6, 5)], black=[(2, 5), (9, 9)])
    assert judge_move(b, BLACK, 7, 5) in ("good", None)        # 막으면 괜찮은 수
    assert judge_move(b, BLACK, 12, 12) == "blunder"           # 안 막으면 큰 실수


def test_judge_ignoring_an_open_three_is_bad_and_blocking_is_good():
    b = board_with(white=[(5, 7), (6, 7), (7, 7)], black=[(6, 8), (9, 3)])
    assert judge_move(b, BLACK, 4, 7) == "good" or judge_move(b, BLACK, 8, 7) == "good"
    assert judge_move(b, BLACK, 1, 13) == "bad"


def test_judge_mostly_quiet_in_ordinary_moves():
    rng = random.Random(3)
    counts = {"good": 0, "bad": 0, "blunder": 0, None: 0}
    for game in range(6):
        b = new_board()
        turn = BLACK
        for _ in range(30):
            x, y = ai_move(b, turn, rng, 0 if turn == BLACK else 3)
            if turn == BLACK:
                counts[judge_move(b, turn, x, y)] += 1
            b[y][x] = turn
            turn = WHITE if turn == BLACK else BLACK
    total = sum(counts.values())
    assert counts["good"] and counts["bad"]                       # 둘 다 나온다
    assert counts[None] > total * .2                              # 매 수마다 뭔가 판정하진 않는다
