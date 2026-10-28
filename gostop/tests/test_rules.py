"""고스톱 카드·점수·박."""
from app.rules import KINDS, go_points, kind, loser_bak, new_deck, pi_value, score, steal_pick


def test_deck():
    deck = new_deck()
    assert len(deck) == 48 and len(set(deck)) == 48
    kinds = [kind(c) for c in deck]
    assert kinds.count("gwang") == 5 and kinds.count("yeol") == 9
    assert kinds.count("hong") == 3 and kinds.count("cheong") == 3 and kinds.count("cho") == 3 and kinds.count("tti") == 1
    assert kinds.count("ssangpi") == 2 and kinds.count("pi") == 22
    assert all(len(v) == 4 for v in KINDS.values())


def test_gwang():
    assert score(["1a", "3a", "8a"])["parts"] == {"광": 3}
    assert score(["1a", "3a", "12a"])["parts"] == {"광": 2}           # 비광이 끼면 2점
    assert score(["1a", "3a", "8a", "12a"])["parts"] == {"광": 4}
    assert score(["1a", "3a", "8a", "11a", "12a"])["parts"] == {"광": 15}
    assert score(["1a", "3a"])["total"] == 0


def test_yeol_godori_tti_dan():
    assert score(["2a", "4a", "8b"])["parts"] == {"고도리": 5}
    assert score(["2a", "4a", "5a", "6a", "7a"])["parts"] == {"열끗": 1}
    assert score(["1b", "2b", "3b"])["parts"] == {"홍단": 3}
    assert score(["6b", "9b", "10b"])["parts"] == {"청단": 3}
    assert score(["4b", "5b", "7b"])["parts"] == {"초단": 3}
    five = score(["1b", "2b", "3b", "4b", "12c"])
    assert five["parts"] == {"홍단": 3, "띠": 1}


def test_pi_and_ssangpi_and_gukjin():
    pis = ["1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c"]
    assert pi_value(pis) == 9 and score(pis)["total"] == 0
    assert score(pis + ["11b"])["parts"] == {"피": 2}                # 쌍피는 2장
    assert score(pis + ["9a"])["parts"] == {"피": 2}                  # 국진은 쌍피로 치는 게 유리하면 쌍피
    assert score(["9a", "2a", "4a", "5a", "6a"])["parts"] == {"열끗": 1}   # 열끗으로 치는 게 유리하면 열끗


def test_go_points():
    assert go_points(7, 0) == 7
    assert go_points(7, 1) == 8
    assert go_points(7, 2) == 9
    assert go_points(7, 3) == 18
    assert go_points(7, 4) == 36


def test_baks():
    winner = score(["1a", "3a", "8a"] + ["1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c", "5d"])
    assert set(loser_bak(winner, score(["6c", "6d"]))) == {"피박", "광박"}
    assert loser_bak(winner, score(["11a"] + [f"{m}c" for m in range(6, 12)])) == []
    yeol7 = score(["2a", "4a", "5a", "6a", "7a", "8b", "10a"])
    assert "멍박" in loser_bak(yeol7, score(["1c"]))


def test_steal_pick_prefers_plain_pi():
    assert steal_pick(["1a", "11b", "3c"]) == "3c"
    assert steal_pick(["1a", "11b"]) == "11b"
    assert steal_pick(["1a", "2a"]) is None
