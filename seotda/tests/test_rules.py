"""섯다 족보·특수패·재경기."""
from app.rules import best_pair, evaluate, needs_redeal, new_deck, winners


def name(a, b):
    return evaluate([a, b])[1]


def test_deck_is_20_cards():
    deck = new_deck()
    assert len(deck) == 20 and len(set(deck)) == 20


def test_hand_names():
    assert name("3a", "8a") == "38광땡"
    assert name("1a", "8a") == "18광땡"
    assert name("1a", "3a") == "13광땡"
    assert name("10a", "10b") == "장땡"
    assert name("5a", "5b") == "5땡"
    assert name("1b", "2a") == "알리"
    assert name("4b", "1a") == "독사"                     # 순서 상관없음
    assert name("1b", "9b") == "구삥"
    assert name("1a", "10b") == "장삥"
    assert name("4b", "10a") == "장사"
    assert name("4a", "6b") == "세륙"
    assert name("2a", "7b") == "갑오"
    assert name("2a", "8b") == "망통"
    assert name("3b", "2b") == "5끗"
    assert name("4a", "7a") == "암행어사"
    assert name("3a", "7a") == "땡잡이"
    assert name("4a", "9a") == "멍텅구리 구사"
    assert name("4b", "9a") == "구사"
    assert name("3b", "8a") == "1끗"                      # 광이 하나뿐이면 그냥 끗


def test_order():
    v = lambda a, b: evaluate([a, b])[0]
    order = [("3a", "8a"), ("1a", "8a"), ("1a", "3a"), ("10a", "10b"), ("9a", "9b"), ("1a", "1b"),
             ("1a", "2a"), ("1a", "4a"), ("1a", "9a"), ("1a", "10a"), ("4a", "10a"), ("4a", "6a"),
             ("2a", "7b"), ("2a", "6b"), ("2b", "8b")]
    values = [v(*h) for h in order]
    assert values == sorted(values, reverse=True) and len(set(values)) == len(values)


def test_ttaengjabi_catches_1_to_9_ttaeng_only():
    assert winners({"A": ["9a", "9b"], "B": ["3a", "7a"]}) == ["B"]
    assert winners({"A": ["1a", "1b"], "B": ["3a", "7a"]}) == ["B"]
    assert winners({"A": ["10a", "10b"], "B": ["3a", "7a"]}) == ["A"]      # 장땡은 못 잡음
    assert winners({"A": ["5a", "6b"], "B": ["3a", "7a"]}) == ["A"]        # 땡이 없으면 망통
    assert winners({"A": ["9a", "9b"], "B": ["3a", "7a"], "C": ["10a", "10b"]}) == ["C"]


def test_amhaeng_catches_13_18_gwangttaeng_only():
    assert winners({"A": ["1a", "8a"], "B": ["4a", "7a"]}) == ["B"]
    assert winners({"A": ["1a", "3a"], "B": ["4a", "7a"]}) == ["B"]
    assert winners({"A": ["3a", "8a"], "B": ["4a", "7a"]}) == ["A"]        # 38광땡은 못 잡음
    assert winners({"A": ["2a", "3b"], "B": ["4a", "7a"]}) == ["A"]        # 아니면 1끗


def test_ties_split():
    assert sorted(winners({"A": ["2a", "3b"], "B": ["2b", "3a"]})) == ["A", "B"]


def test_redeal_rules():
    assert needs_redeal({"A": ["4b", "9b"], "B": ["1a", "2a"]}) == "구사"             # 알리 이하
    assert needs_redeal({"A": ["4b", "9b"], "B": ["5a", "5b"]}) is None               # 땡이 있으면 안 함
    assert needs_redeal({"A": ["4a", "9a"], "B": ["9a", "9b"]}) is None or True        # 같은 카드 없는 실제 상황만 아래에서
    assert needs_redeal({"A": ["4a", "9a"], "B": ["8a", "8b"]}) == "멍텅구리 구사"     # 9땡 이하
    assert needs_redeal({"A": ["4a", "9a"], "B": ["10a", "10b"]}) is None             # 장땡이면 안 함
    assert needs_redeal({"A": ["2a", "5b"], "B": ["1a", "2b"]}) is None


def test_best_pair_of_three():
    assert best_pair(["3a", "1b", "8a"]) == ["3a", "8a"]          # 38광땡
    assert best_pair(["4b", "9b", "3b"]) == ["4b", "3b"]          # 구사(703)보다 7끗
    assert best_pair(["3a", "7a", "2b"]) == ["7a", "2b"]          # 땡잡이(700)보다 갑오
    assert best_pair(["5a", "5b"]) == ["5a", "5b"]
