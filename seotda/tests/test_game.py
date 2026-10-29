"""세 장 섯다 한 판 진행: 판돈, 첫 베팅, 세 장째·두 장 고르기, 마지막 베팅, 공개, 재경기, 탈락, 판 수 제한, 나감, 시간 초과."""
import asyncio
import random

import pytest

import app.game as game_mod
from app.game import Game
from app.room import RoomSettings
from app.rules import best_pair


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    for name in ("DEAL_DELAY", "SHOWDOWN_PAUSE", "FOLD_WIN_PAUSE", "REDEAL_PAUSE"):
        monkeypatch.setattr(game_mod, name, 0)


class P:
    def __init__(self, name):
        self.id = self.name = name
        self.msgs = []

    def public(self):
        return {"id": self.id, "name": self.name}

    async def send(self, msg):
        self.msgs.append(msg)


class FakeRoom:
    def __init__(self, n, **settings):
        self.players = [P(c) for c in "ABCDEF"[:n]]
        self.spectators = []
        self.settings = RoomSettings(**settings)
        self.texts, self.over, self.ended = [], None, False

    @property
    def audience(self):
        return self.players

    async def system(self, text):
        self.texts.append(text)

    async def broadcast(self, msg):
        if msg["type"] == "game_over":
            self.over = msg

    async def end_game(self, game):
        self.ended = True

    def record_result(self, winner):
        pass


class Seq(random.Random):
    """자리 순서는 그대로, 덱은 정해 둔 카드가 차례로 나오게.
    한 판에 [자리마다 두 장씩 …, 세 장째 자리 순서대로 …]."""
    def __init__(self, tops=()):
        super().__init__(1)
        self.tops = [list(t) for t in tops]

    def shuffle(self, x):
        if len(x) == 20 and self.tops:
            top = self.tops.pop(0)
            rest = [c for c in x if c not in top]
            x[:] = rest + list(reversed(top))


async def settle():
    for _ in range(30):
        await asyncio.sleep(0)


async def new_game(n=3, tops=(), **settings):
    room = FakeRoom(n, **settings)
    g = Game(room, rng=Seq(tops))
    await g.start()
    await settle()
    return room, g


def cur(g):
    return g.seats[g.turn].player


# 차례대로 모두 체크
async def check_all(g):
    while g.turn is not None and g.phase == "betting":
        await g.act(cur(g), "check")
    await settle()


# 남은 사람 모두 두 장 고르기 (안 정하면 가장 센 두 장)
async def pick_all(g, **picks):
    assert g.phase == "choose"
    for s in g.seats:
        if s.in_hand and not s.pick:
            assert await g.choose(s.player, picks.get(s.id) or best_pair(s.cards)) is None
    await settle()


def test_ante_and_deal():
    async def main():
        room, g = await new_game(3)
        assert g.pot == 30 and all(s.total == 10 and s.bet == 0 for s in g.seats)
        assert all(len(s.cards) == 2 for s in g.seats) and g.street == 1
        assert cur(g).id == "B"                                   # 선(A) 다음부터
        st = g.state(g.seats[1].player)
        assert st["seats"][1]["cards"] and st["seats"][0]["cards"] is None   # 남의 패는 안 보임
        assert st["seats"][0]["n_cards"] == 2
        opts = st["me"]["options"]
        assert opts["can_check"] and opts["bbing"] == 10 and opts["ddadang"] is None
        await g.finish()
    asyncio.run(main())


def test_third_card_and_choose():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        await check_all(g)
        assert g.phase == "choose" and g.turn is None and all(len(s.cards) == 3 for s in g.seats)
        st = g.state(A)
        assert st["me"]["choose"] and st["time_left_ms"] > 0 and st["seats"][1]["n_cards"] == 3
        three = g.seats[0].cards
        assert await g.choose(A, [three[0]]) == "카드 두 장을 골라 주세요."
        assert await g.choose(A, [three[0], three[0]]) == "카드 두 장을 골라 주세요."
        assert await g.choose(A, [three[0], "zz"]) == "카드 두 장을 골라 주세요."
        assert await g.choose(A, [{"x": 1}, three[0]]) == "카드 두 장을 골라 주세요."
        assert await g.choose(A, [three[2], three[0]]) is None
        assert g.seats[0].pick == [three[0], three[2]]
        assert await g.choose(A, three[:2]) == "이미 골랐어요."
        assert g.state(B)["seats"][0]["picked"] and g.state(B)["seats"][0]["pick"] is None   # 고른 건 안 보임
        assert await g.act(B, "check") == "지금은 내 차례가 아니에요."
        await pick_all(g)
        assert g.phase == "betting" and g.street == 2 and cur(g).id == "B" and g.current_bet == 0
        await g.finish()
    asyncio.run(main())


def test_betting_actions():
    async def main():
        room, g = await new_game(3)
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        assert await g.act(B, "bbing") is None
        assert g.current_bet == 10 and g.seats[1].last == "삥 10"
        opts = g.state(C)["me"]["options"]
        assert opts["ddadang"] == 20 and opts["half"] == 10 + max(10, -(-(40 + 10) // 2))   # 하프: 콜하고 팟의 절반
        assert await g.act(C, "ddadang") is None
        assert g.current_bet == 20
        assert await g.act(A, "check") == "콜하거나 다이해야 해요."
        await g.act(A, "die")
        await g.act(B, "call")
        await settle()
        assert g.phase == "choose" and len(g.seats[0].cards) == 2      # 다이한 사람은 세 장째 없음
        await pick_all(g)
        assert g.pot == 70 and g.current_bet == 0                      # 마지막 베팅은 새로
        await g.act(B, "bbing")
        await g.act(C, "call")
        await settle()
        assert g.phase == "showdown" and g.results
        assert sum(r["amount"] for r in g.results) == 70 + 20
        await g.finish()
    asyncio.run(main())


def test_showdown_uses_chosen_pair():
    # A 3a 8a 1b → 38광땡, B 10a 10b 5b → 장땡, C 2a 8b 6b
    async def main():
        room, g = await new_game(3, tops=[["3a", "8a", "10a", "10b", "2a", "8b", "1b", "5b", "6b"]])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        await check_all(g)
        await pick_all(g, C=["2a", "8b"])                          # C 는 일부러 망통
        await check_all(g)
        assert g.results[0]["id"] == "A" and g.results[0]["hand"] == "38광땡" and g.results[0]["amount"] == 30
        assert g.results[0]["cards"] == ["3a", "8a"] and g.results[0]["all"] == ["3a", "8a", "1b"]
        assert g.state(C)["seats"][0]["cards"] == ["3a", "8a", "1b"]   # 공개하면 모두가 봄
        assert g.state(B)["seats"][2]["pick"] == ["2a", "8b"] and g.seats[2].last == "망통"
        assert any("38광땡" in t for t in room.texts)
        await g.finish()
    asyncio.run(main())


def test_everyone_dies():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        game_mod.FOLD_WIN_PAUSE = 60
        await g.act(B, "bbing")
        await g.act(C, "die")
        await g.act(A, "die")
        await settle()
        assert g.results[0]["id"] == "B" and g.results[0]["fold"] and g.seats[1].chips == 1000 - 20 + 40
        assert all(len(s.cards) == 2 for s in g.seats)                 # 첫 베팅에서 끝나면 세 장째 없음
        await g.finish()
    asyncio.run(main())


def test_gusa_redeal_keeps_pot_and_redeals():
    # 첫 판: A 구사(골라서), B 알리, C 8끗 → 재경기. 다시: A 5땡, B 7끗, C 갑오
    first = ["4b", "9b", "1a", "2a", "2b", "8b", "3b", "5b", "6b"]
    second = ["5a", "5b", "3b", "8a", "6b", "2b", "1b", "4b", "7b"]
    async def main():
        room, g = await new_game(3, tops=[first, second])
        game_mod.SHOWDOWN_PAUSE = 60
        await check_all(g)
        await pick_all(g, A=["4b", "9b"])
        await check_all(g)
        assert any("재경기" in t for t in room.texts)
        assert g.pot == 30 and g.seats[0].cards == ["5a", "5b"] and g.street == 1   # 판돈 그대로, 두 장부터 다시
        await check_all(g)
        await pick_all(g)
        await check_all(g)
        assert g.results[0]["id"] == "A" and g.results[0]["hand"] == "5땡"
        await g.finish()
    asyncio.run(main())


def test_ttaengjabi_must_be_chosen():
    # B 3a 7a 2b: 가장 높은 값은 갑오지만 땡잡이를 골라 9땡을 잡음
    async def main():
        room, g = await new_game(2, tops=[["9a", "9b", "3a", "7a", "1b", "2b"]])
        game_mod.SHOWDOWN_PAUSE = 60
        await check_all(g)
        await pick_all(g, B=["3a", "7a"])
        await check_all(g)
        assert g.results[0]["id"] == "B" and g.results[0]["hand"] == "땡잡이"
        await g.finish()
    asyncio.run(main())


def test_allin_side_pot():
    # A 장땡(칩 적음), B 9땡, C 6끗
    async def main():
        room, g = await new_game(3, tops=[["10a", "10b", "9a", "9b", "2a", "8b", "1b", "3b", "4b"]])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        g.seats[0].chips = 40
        await g.act(B, "bbing")
        await g.act(C, "ddadang")
        await g.act(A, "allin")                                      # 40 올인 (판돈 포함 50)
        await g.act(B, "ddadang")                                    # 80 으로
        await g.act(C, "call")
        await settle()
        await pick_all(g)                                            # 올인한 사람도 고름
        assert cur(g).id == "B"
        await check_all(g)
        won = {r["id"]: r["amount"] for r in g.results}
        assert won["A"] == 50 * 3                                     # 메인 팟: 장땡
        assert won["B"] == 40 * 2 and won.get("C", 0) == 0            # 사이드 팟: 장땡이 못 받으니 9땡
        assert sum(s.chips for s in g.seats) == 40 + 10 + 1000 + 1000          # 칩이 새거나 생기지 않음
        await g.finish()
    asyncio.run(main())


def test_max_hands_ends_with_chip_ranking():
    async def main():
        room, g = await new_game(2, max_hands=1)
        A, B = (s.player for s in g.seats)
        await g.act(B, "bbing")
        await g.act(A, "die")
        await settle()
        assert room.over and room.over["ranking"][0]["id"] == "B" and room.over["hands"] == 1
        assert room.over["ranking"][0]["score"] == 1010
    asyncio.run(main())


def test_bust_and_last_one_wins():
    async def main():
        room, g = await new_game(2, tops=[["10a", "10b", "2a", "8b", "1b", "3b"]])
        A, B = (s.player for s in g.seats)
        await g.act(B, "allin")
        await g.act(A, "call")
        await settle()
        await pick_all(g)                                            # 둘 다 올인이면 고른 뒤 바로 공개
        for _ in range(5):
            await settle()
        assert room.over and room.over["winner"]["id"] == "A"
        assert g.seats[0].chips == 2000
    asyncio.run(main())


def test_timeout_and_leave():
    async def main():
        room, g = await new_game(3)
        game_mod.FOLD_WIN_PAUSE = 60
        game_mod.SHOWDOWN_PAUSE = 60
        g.settings.turn_time = 0
        await g._start_turn(1)
        await asyncio.sleep(0.01)
        await settle()
        assert g.seats[1].away and any("시간 초과" in t for t in room.texts)
        g.settings.turn_time = 30
        A, B, C = (s.player for s in g.seats)
        await g.remove_player(A)
        await g.remove_player(C)
        assert room.over and room.over["winner"]["id"] == "B"
    asyncio.run(main())


def test_choose_timeout_and_away_auto_pick():
    async def main():
        room, g = await new_game(3)
        g.seats[2].away = True
        while g.turn is not None:
            await g._apply(g.seats[g.turn], "check")              # 자리 비움이 풀리지 않게 직접
        await settle()
        assert g.phase == "choose" and g.seats[2].pick == best_pair(g.seats[2].cards)
        g._cancel()
        g.settings.turn_time = 0
        await g._choose_timer()
        await settle()
        assert g.phase == "betting" and g.street == 2
        assert all(s.pick == best_pair(s.cards) for s in g.seats)       # 비움은 바로, 나머지는 시간 초과로
        assert g.seats[0].away and any("가장 센 두 장" in t for t in room.texts)
        await g.finish()
    asyncio.run(main())


def test_leave_while_choosing():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        await check_all(g)
        await g.choose(A, best_pair(g.seats[0].cards))
        await g.choose(B, best_pair(g.seats[1].cards))
        await g.remove_player(C)                                     # 남은 사람은 다 골랐으니 마지막 베팅
        assert g.phase == "betting" and g.street == 2
        await g.finish()

        room, g = await new_game(3)
        game_mod.FOLD_WIN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        await g.act(B, "check")
        await g.act(C, "check")
        await g.act(A, "die")
        await settle()
        assert g.phase == "choose"
        await g.remove_player(C)                                     # 고르던 사람이 혼자 남음
        assert g.results[0]["id"] == "B" and g.results[0]["fold"]
        await g.finish()
    asyncio.run(main())
