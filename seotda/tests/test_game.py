"""섯다 한 판 진행: 판돈, 베팅(삥·하프·따당·콜·다이), 공개, 재경기, 탈락, 판 수 제한, 나감, 시간 초과."""
import asyncio
import random

import pytest

import app.game as game_mod
from app.game import Game
from app.room import RoomSettings


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
    """자리 순서는 그대로, 덱은 정해 둔 카드가 차례로 나오게 (판마다 같은 순서)."""
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


def test_ante_and_deal():
    async def main():
        room, g = await new_game(3)
        assert g.pot == 30 and all(s.total == 10 and s.bet == 0 for s in g.seats)
        assert all(len(s.cards) == 2 for s in g.seats)
        assert cur(g).id == "B"                                   # 선(A) 다음부터
        st = g.state(g.seats[1].player)
        assert st["seats"][1]["cards"] and st["seats"][0]["cards"] is None   # 남의 패는 안 보임
        opts = st["me"]["options"]
        assert opts["can_check"] and opts["bbing"] == 10 and opts["ddadang"] is None
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
        assert g.phase == "showdown" and g.results                  # 한 바퀴 끝나면 바로 공개
        assert sum(r["amount"] for r in g.results) == 30 + 20 + 20
        await g.finish()
    asyncio.run(main())


def test_showdown_winner_and_cards_shown():
    # A: 38광땡, B: 장땡, C: 망통
    async def main():
        room, g = await new_game(3, tops=[["3a", "8a", "10a", "10b", "2a", "8b"]])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        await g.act(B, "check")
        await g.act(C, "check")
        await g.act(A, "check")
        await settle()
        assert g.results[0]["id"] == "A" and g.results[0]["hand"] == "38광땡" and g.results[0]["amount"] == 30
        assert g.state(C)["seats"][0]["cards"] == ["3a", "8a"]    # 공개하면 모두가 봄
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
        await g.finish()
    asyncio.run(main())


def test_gusa_redeal_keeps_pot_and_redeals():
    # 첫 판: A 구사, B 알리, C 망통 → 재경기. 다시: A 5땡, B 1끗, C 2끗
    first = ["4b", "9b", "1a", "2a", "2b", "8b"]
    second = ["5a", "5b", "3b", "8a", "6b", "2b"]
    async def main():
        room, g = await new_game(3, tops=[first, second])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        for p in (B, C, A):
            await g.act(p, "check")
        await settle()
        assert any("재경기" in t for t in room.texts)
        assert g.pot == 30 and g.seats[0].cards == ["5a", "5b"]      # 판돈은 그대로, 다시 받음
        for p in (B, C, A):
            await g.act(p, "check")
        await settle()
        assert g.results[0]["id"] == "A" and g.results[0]["hand"] == "5땡"
        await g.finish()
    asyncio.run(main())


def test_ttaengjabi_wins_in_game():
    async def main():
        room, g = await new_game(2, tops=[["9a", "9b", "3a", "7a"]])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B = (s.player for s in g.seats)
        await g.act(B, "check")
        await g.act(A, "check")
        await settle()
        assert g.results[0]["id"] == "B" and g.results[0]["hand"] == "땡잡이"
        await g.finish()
    asyncio.run(main())


def test_allin_side_pot():
    # A 장땡(칩 적음), B 9땡, C 망통
    async def main():
        room, g = await new_game(3, tops=[["10a", "10b", "9a", "9b", "2a", "8b"]])
        game_mod.SHOWDOWN_PAUSE = 60
        A, B, C = (s.player for s in g.seats)
        g.seats[0].chips = 40
        await g.act(B, "bbing")
        await g.act(C, "ddadang")
        await g.act(A, "allin")                                      # 40 올인 (판돈 포함 50)
        await g.act(B, "ddadang")                                    # 80 으로
        await g.act(C, "call")
        await settle()
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
        room, g = await new_game(2, tops=[["10a", "10b", "2a", "8b"]])
        A, B = (s.player for s in g.seats)
        await g.act(B, "allin")
        await g.act(A, "call")
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
