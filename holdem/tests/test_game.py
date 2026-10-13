"""한 판 진행: 블라인드, 베팅 차례, 레이즈 규칙, 쇼다운, 사이드 팟, 탈락, 나감, 시간 초과."""
import asyncio
import random

import pytest

import app.game as game_mod
from app.game import Game
from app.room import RoomSettings


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    for name in ("STREET_DELAY", "RUNOUT_DELAY", "SHOWDOWN_PAUSE", "FOLD_WIN_PAUSE"):
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
        self.players = [P(c) for c in "ABCDEFGH"[:n]]
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
    """자리 순서는 그대로, 덱은 정해 둔 카드가 위에서부터 나오게."""
    def __init__(self, top=()):
        super().__init__(1)
        self.top = list(top)

    def shuffle(self, x):
        if len(x) == 52 and self.top:
            rest = [c for c in x if c not in self.top]
            x[:] = rest + list(reversed(self.top))     # pop() 이 뒤에서 꺼냄


async def settle():
    for _ in range(30):
        await asyncio.sleep(0)


async def new_game(n=3, top=(), **settings):
    room = FakeRoom(n, **settings)
    g = Game(room, rng=Seq(top))
    await g.start()
    await settle()
    return room, g


def cur(g):
    return g.seats[g.turn].player


def test_blinds_and_first_actor():
    async def main():
        room, g = await new_game(3)
        # 딜러 A, SB B, BB C → 첫 차례 A
        assert (g.dealer, g.sb_i, g.bb_i) == (0, 1, 2)
        assert [s.bet for s in g.seats] == [0, 10, 20]
        assert cur(g).id == "A"
        assert all(len(s.cards) == 2 for s in g.seats)
        st = g.state(g.seats[0].player)
        assert st["seats"][0]["cards"] and st["seats"][1]["cards"] is None      # 남의 카드는 안 보임
        assert st["me"]["options"]["to_call"] == 20
        await g.finish()
    asyncio.run(main())


def test_heads_up_dealer_is_small_blind():
    async def main():
        room, g = await new_game(2)
        assert g.dealer == g.sb_i == 0 and g.bb_i == 1
        assert cur(g).id == "A"                        # 프리플랍은 딜러(SB) 먼저
        await g.act(cur(g), "call", 0)
        assert cur(g).id == "B"                        # BB 옵션
        await g.act(cur(g), "check", 0)
        await settle()
        assert g.street == "flop" and len(g.board) == 3
        assert cur(g).id == "B"                        # 플랍부터는 BB 먼저
        await g.finish()
    asyncio.run(main())


def test_raise_rules():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        assert await g.act(A, "raise", 30) == "최소 40까지 올려야 해요."
        assert await g.act(B, "call", 0) == "지금은 내 차례가 아니에요."
        assert await g.act(A, "raise", 60) is None    # 40 올림 → 다음 최소 레이즈 100
        assert g.state(B)["me"]["options"]["min_to"] == 100
        assert await g.act(B, "check", 0) == "콜하거나 폴드해야 해요."
        await g.act(B, "fold", 0)
        await g.act(C, "call", 0)
        await settle()
        assert g.street == "flop" and g.pot == 130
        assert cur(g).id == "C"                        # 딜러 다음 살아 있는 사람
        await g.finish()
    asyncio.run(main())


def test_everyone_folds_to_big_blind():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        await g.act(A, "fold", 0)
        await g.act(B, "fold", 0)
        await settle()
        assert g.hand_no == 2 and g.dealer == 1      # 다음 판, 딜러 이동
        assert sum(s.chips + s.total for s in g.seats) == 3000
        assert [s.chips + s.total for s in g.seats] == [1000, 990, 1010]   # BB 가 블라인드 10 을 땀
        await g.finish()
    asyncio.run(main())


def test_showdown_side_pot():
    # 개인 카드는 A부터 차례로 2장씩: A=AA, B=KK, C=QQ, 판 2 3 4 / 8 / 9 (버리는 카드 포함)
    top = ["As", "Ad", "Ks", "Kd", "Qs", "Qd", "5c", "2h", "3h", "4c", "6c", "8d", "7c", "9s"]

    async def main():
        room, g = await new_game(3, top=top)
        A, B, C = (s.player for s in g.seats)
        g.seats[0].chips = 100                          # A 는 작은 스택
        game_mod.SHOWDOWN_PAUSE = 60                    # 결과를 보는 동안 멈춤
        await g.act(A, "allin", 0)
        await g.act(B, "raise", 500)
        await g.act(C, "call", 0)
        await settle()
        while g.turn is not None:
            await g.act(cur(g), "check", 0)
            await settle()
        assert g.street == "showdown"
        assert g.board == ["2h", "3h", "4c", "8d", "9s"]
        # 메인 팟 300 은 A(에이스 원페어), 사이드 팟 800 은 B(킹)
        assert [s.chips for s in g.seats] == [300, 1300, 500]
        assert g.results[0]["id"] == "B" and g.results[0]["hand"] == "원페어"
        st = g.state(C)
        assert st["seats"][0]["cards"] == ["As", "Ad"]   # 쇼다운이면 공개
        await g.finish()
    asyncio.run(main())


def test_allin_runout_ends_game():
    top = ["As", "Ad", "Ks", "Kd", "5c", "2h", "3h", "7c", "6c", "8d", "Tc", "9s"]

    async def main():
        room, g = await new_game(2, top=top)
        A, B = (s.player for s in g.seats)
        await g.act(A, "allin", 0)
        await g.act(B, "call", 0)
        for _ in range(5):
            await settle()
        assert room.over and room.over["winner"]["id"] == "A"
        assert [p["id"] for p in room.over["ranking"]] == ["A", "B"]
        assert g.seats[0].chips == 2000 and room.ended
    asyncio.run(main())


def test_incomplete_allin_does_not_reopen_raise():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        g.seats[1].chips = 45                           # B: 블라인드 10 + 45 → 올인 55
        await g.act(A, "raise", 40)                     # 20 올림
        await g.act(B, "allin", 0)                      # 55 (15 올림, 최소 레이즈 미만)
        await g.act(C, "call", 0)
        opts = g.state(A)["me"]["options"]
        assert opts["to_call"] == 15 and opts["can_raise"] is False
        await g.finish()
    asyncio.run(main())


def test_timeout_folds_and_marks_away():
    async def main():
        room, g = await new_game(3)
        game_mod.FOLD_WIN_PAUSE = 60
        g.settings.turn_time = 0
        await g._start_turn(0)
        await asyncio.sleep(0.01)
        await settle()
        assert g.seats[0].away and g.seats[0].last == "폴드"
        assert any("시간 초과" in t for t in room.texts)
        await g.finish()
    asyncio.run(main())


def test_leave_mid_hand():
    async def main():
        room, g = await new_game(3)
        A, B, C = (s.player for s in g.seats)
        await g.remove_player(A)                       # 차례인 사람이 나감
        assert g.seats[0].out and cur(g).id == "B"
        await g.remove_player(C)
        assert room.over and room.over["winner"]["id"] == "B"
        assert g.seats[1].chips == 1000 + 20           # 걸린 칩(B 10 + C 20)을 가져감
    asyncio.run(main())
