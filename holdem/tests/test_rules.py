"""족보 판정과 팟 나누기."""
from app.rules import (FLUSH, FULL_HOUSE, HIGH, PAIR, QUADS, STRAIGHT, STRAIGHT_FLUSH, TRIPS, TWO_PAIR,
                       best_hand, current_name, eval5, hand_name, sort_five, split_pots)


def cat(cards: str) -> int:
    return best_hand(cards.split())[0][0]


def test_categories():
    assert cat("As Ks Qs Js Ts 2d 3c") == STRAIGHT_FLUSH
    assert cat("9h 9d 9s 9c 2d 3c 4h") == QUADS
    assert cat("9h 9d 9s 2c 2d 3c 4h") == FULL_HOUSE
    assert cat("2h 7h 9h Jh Kh 3c 4d") == FLUSH
    assert cat("5d 6c 7h 8s 9d Kc 2h") == STRAIGHT
    assert cat("Ah 2c 3d 4s 5h Kc 9h") == STRAIGHT      # A-5 스트레이트
    assert cat("9h 9d 9s 2c 5d 3c Kh") == TRIPS
    assert cat("9h 9d 2s 2c 5d 3c Kh") == TWO_PAIR
    assert cat("9h 9d 2s 7c 5d 3c Kh") == PAIR
    assert cat("9h Jd 2s 7c 5d 3c Kh") == HIGH


def test_comparisons():
    def v(s):
        return eval5(s.split())
    assert v("Ah 2c 3d 4s 5h") < v("2h 3c 4d 5s 6h")          # A-5 가 가장 낮은 스트레이트
    assert v("Kh Kd 9s 9c 2d") > v("Kh Kd 8s 8c Ad")          # 투페어는 두 번째 짝도 비교
    assert v("Ah Ad 5s 4c 2d") < v("Ah Ad 6s 4c 2d")          # 같은 짝이면 남은 카드
    assert v("9h 9d 9s 2c 2d") > v("8h 8d 8s Ac Ad")          # 풀하우스는 트리플 먼저
    assert v("As Ks Qs Js Ts") == v("Ah Kh Qh Jh Th")         # 무늬는 상관없음


def test_names():
    assert hand_name(eval5("As Ks Qs Js Ts".split())) == "로열 플러시"
    assert hand_name(eval5("9s Ks Qs Js Ts".split())) == "스트레이트 플러시"
    assert current_name(["As", "Ad"]) == "원페어"
    assert current_name(["As", "Kd"]) == "하이카드"
    assert current_name(["As", "Kd", "Ac", "Kh"]) == "투페어"
    assert current_name("As Kd Ac Kh Ad".split()) == "풀하우스"


def test_sort_five():
    assert sort_five("7s Tc As 7h 9c".split()) == ["7s", "7h", "As", "Tc", "9c"]


def test_split_pots():
    # A 100 올인, B 300 올인, C 500 콜, D 50 내고 폴드
    pots = split_pots({"A": 100, "B": 300, "C": 500, "D": 50}, {"A", "B", "C"})
    assert pots == [(350, ["A", "B", "C"]), (400, ["B", "C"]), (200, ["C"])]
    assert sum(p for p, _ in pots) == 950
    assert split_pots({"A": 40, "B": 40, "C": 20}, {"A", "B"}) == [(100, ["A", "B"])]
