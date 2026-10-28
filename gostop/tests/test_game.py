"""고스톱 한 판 진행: 쪽·뻑·따닥·쓸·폭탄·흔들기·뻑 먹기, 고·스톱, 정산(배수·박·고박), 나가리, 총통, AI 대신하기."""
import asyncio
import random

import pytest

import app.game as game_mod
from app.game import Game
from app.room import RoomSettings


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    for name in ("AI_DELAY", "SKIP_DELAY", "RESULT_PAUSE"):
        monkeypatch.setattr(game_mod, name, 0)


class P:
    def __init__(self, name):
        self.id = self.name = name

    def public(self):
        return {"id": self.id, "name": self.name}

    async def send(self, msg):
        pass


class FakeRoom:
    def __init__(self, n, **settings):
        self.players = [P(c) for c in "ABC"[:n]]
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


async def settle():
    for _ in range(40):
        await asyncio.sleep(0)


def table(g, hands, floor, pile, turn=0, captured=None):
    """판을 원하는 모양으로 (pile 은 뒤에서부터 뒤집힘)."""
    g._cancel()
    for s, h in zip(g.seats, hands):
        s.hand = list(h)
        s.captured = []
        s.gos = s.go_score = s.shakes = s.bombs = s.skip = s.ppeok = 0
    for s, c in zip(g.seats, captured or []):
        s.captured = list(c)
    g.floor = list(floor)
    g.pile = list(pile)
    g.turn = turn
    g.phase = "play"
    g.result = None


async def new_game(humans=2, **settings):
    settings.setdefault("size", 2)
    room = FakeRoom(humans, **settings)
    g = Game(room, rng=random.Random(5))
    await g.start()
    await settle()
    g.seats.sort(key=lambda s: s.id)                         # A, B 순서로 (AI 는 뒤)
    return room, g


def who(g, i):
    return g.seats[i].player


def test_deal_sizes_and_ai_fill():
    async def main():
        room, g = await new_game(1, size=3)
        assert len(g.seats) == 3 and sum(1 for s in g.seats if s.is_bot) == 2
        assert g.threshold == 3
        await g.finish()
        room, g = await new_game(2, size=2)
        assert [len(s.hand) for s in g.seats] == [10, 10] and len(g.pile) == 20 and g.threshold == 7
        await g.finish()
    asyncio.run(main())


def test_simple_capture_and_flip_capture():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "5c"], ["6c", "6d"]], ["1c", "3c"], ["2c", "3a"])
        await g.play(who(g, 0), "1a")
        await settle()
        assert set(g.seats[0].captured) == {"1a", "1c", "3a", "3c"}      # 낸 카드로 1월, 뒤집은 3월 광으로 3월
        assert g.floor == [] or g.floor == ["2c"]
        await g.finish()
    asyncio.run(main())


def test_jjok_steals_pi():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "5c"], ["6c"]], ["3c"], ["2c", "1c"], captured=[[], ["7c", "7d"]])
        await g.play(who(g, 0), "1a")
        await settle()
        assert {"1a", "1c"} <= set(g.seats[0].captured) and "쪽" in g.last["events"]
        assert len(g.seats[1].captured) == 1                         # 피 한 장 뺏김
        await g.finish()
    asyncio.run(main())


def test_ppeok_leaves_three_and_ppeok_meokgi_takes_four():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "5c"], ["1d", "6c"]], ["1b", "3c"], ["2c", "9c", "1c"])
        await g.play(who(g, 0), "1a")
        await settle()
        assert "뻑" in g.last["events"] and sorted(f for f in g.floor if f.startswith("1")) == ["1a", "1b", "1c"]
        await g.play(who(g, 1), "1d")                                # 남은 한 장으로 뻑 먹기
        await settle()
        assert {"1a", "1b", "1c", "1d"} <= set(g.seats[1].captured) and "뻑 먹기" in g.last["events"]
        await g.finish()
    asyncio.run(main())


def test_ttadak_takes_four():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "5c"], ["6c"]], ["1b", "1c", "3c"], ["2c", "1d"])
        await g.play(who(g, 0), "1a", target="1c")
        await settle()
        assert {"1a", "1b", "1c", "1d"} <= set(g.seats[0].captured) and "따닥" in g.last["events"]
        await g.finish()
    asyncio.run(main())


def test_choose_target_when_two_match():
    async def main():
        room, g = await new_game()
        table(g, [["1c", "5c"], ["6c"]], ["1a", "1b", "3c"], ["2c", "9c"])
        assert g.options(g.seats[0])["cards"]["1c"]["choose"] is True
        await g.play(who(g, 0), "1c", target="1b")
        await settle()
        assert "1b" in g.seats[0].captured and "1a" in g.floor
        await g.finish()
    asyncio.run(main())


def test_sweep():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "5c"], ["6c"]], ["1b", "3c"], ["2c", "3a"], captured=[[], ["7c"]])
        await g.play(who(g, 0), "1a")
        await settle()
        assert g.floor == [] and "쓸" in g.last["events"] and g.seats[1].captured == []
        await g.finish()
    asyncio.run(main())


def test_bomb_and_skip_turns():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "1b", "1c", "5c"], ["6c", "6d", "7c", "7d"]], ["1d", "3c"], ["2c", "9c", "10c", "11c", "4c"])
        opts = g.options(g.seats[0])["cards"]["1a"]
        assert opts["bomb"] is True
        await g.play(who(g, 0), "1a", bomb=True)
        await settle()
        s = g.seats[0]
        assert {"1a", "1b", "1c", "1d"} <= set(s.captured) and s.bombs == 1 and "폭탄" in g.last["events"]
        assert s.hand == ["5c"] and s.skip == 2
        await g.play(who(g, 1), "6c")
        await settle()
        assert s.skip == 1                                           # 내 차례는 뒤집기만 자동으로
        await g.finish()
    asyncio.run(main())


def test_shake_doubles():
    async def main():
        room, g = await new_game()
        table(g, [["1a", "1b", "1c", "5c"], ["6c"]], ["3c"], ["2c", "9c"])
        assert g.options(g.seats[0])["cards"]["1a"]["shake"] is True
        await g.play(who(g, 0), "1a", shake=True)
        await settle()
        assert g.seats[0].shakes == 1 and "흔들기" in g.last["events"]
        await g.finish()
    asyncio.run(main())


def test_gostop_go_then_stop_and_settle():
    pis = ["1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c", "5d", "6c"]   # 피 11장 = 2점
    async def main():
        room, g = await new_game(2, point_value=100)
        game_mod.RESULT_PAUSE = 60
        # A 는 광 3장 + 피 = 5점, 한 장 먹으면 7점 이상
        table(g, [["8a", "10c"], ["7c", "12c"]], ["8c", "9c"], ["11c", "2a", "4a", "12d"],
              captured=[["1a", "3a", "11a"] + pis, []])
        await g.play(who(g, 0), "8a")
        await settle()
        assert g.phase == "gostop" and g.options(g.seats[0])["gostop"]["score"] >= 7
        await g.decide(who(g, 0), True)                              # 1고
        assert g.seats[0].gos == 1 and g.turn == 1
        await g.play(who(g, 1), "7c")
        await settle()
        before = [s.chips for s in g.seats]
        await g.play(who(g, 0), "10c")                               # 점수가 그대로면 고·스톱 안 물음 → 마지막이라 끝
        await settle()
        assert g.result is None or g.result["type"] in ("win", "nagari")
        await g.finish()
    asyncio.run(main())


def test_settlement_multipliers_and_baks():
    async def main():
        room, g = await new_game(2, point_value=100)
        game_mod.RESULT_PAUSE = 60
        pis = ["1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c", "5d"]
        table(g, [[], []], [], [], captured=[["1a", "3a", "8a"] + pis, ["6c"]])
        g.seats[0].shakes = 1
        await g._settle(0)
        r = g.result
        assert r["score"] == 3 + 1 and r["mult"] == 2                 # 광 3 + 피 1, 흔들기 ×2
        pay = r["pays"][0]
        assert set(pay["baks"]) == {"피박", "광박"} and pay["amount"] == 4 * 2 * 4 * 100
        assert g.seats[0].chips == 10000 + 3200 and g.seats[1].chips == 10000 - 3200
        await g.finish()
    asyncio.run(main())


def test_three_player_gobak():
    async def main():
        room, g = await new_game(3, size=3, point_value=10)
        game_mod.RESULT_PAUSE = 60
        table(g, [[], [], []], [], [], captured=[["1a", "3a", "8a"], ["1c", "2c", "3c", "4c", "5c", "6c"], ["7c", "8c", "9c", "10c", "11c", "11d"]])
        g.seats[1].gos = 1                                           # B 가 고 했다가 A 가 남
        await g._settle(0)
        pays = {p["id"]: p for p in g.result["pays"]}
        assert pays["C"]["amount"] == 0 and "고박" in pays["B"]["baks"]
        assert pays["B"]["amount"] == (3 * 10 * 2) * 2                # 둘 다 광박(×2), B 가 혼자 두 사람 몫
        await g.finish()
    asyncio.run(main())


def test_nagari_doubles_next_round():
    async def main():
        room, g = await new_game(2)
        game_mod.RESULT_PAUSE = 60
        table(g, [["1a"], ["2a"]], ["5c"], ["9c", "10c"])
        await g.play(who(g, 0), "1a")
        await settle()
        await g.play(who(g, 1), "2a")
        await settle()
        assert g.result["type"] == "nagari" and g.nagari == 2
        await g.finish()
    asyncio.run(main())


def test_chongtong(monkeypatch):
    async def main():
        room = FakeRoom(2, size=2)
        g = Game(room, rng=random.Random(5))
        game_mod.RESULT_PAUSE = 60
        real = g.rng.shuffle

        def rigged(x):
            real(x)
            for c in ["1a", "1b", "1c", "1d"]:                       # 첫 사람 손에 1월 네 장
                x.remove(c)
            x.extend(["1a", "1b", "1c", "1d"])
        g.rng.shuffle = rigged
        await g.start()
        await settle()
        assert g.result and g.result["chongtong"] == 1 and g.result["points"] == 10
        assert any("총통" in t for t in room.texts)
        await g.finish()
    asyncio.run(main())


def test_leaving_player_is_replaced_by_ai():
    async def main():
        room, g = await new_game(2)
        A, B = who(g, 0), who(g, 1)
        await g.remove_player(B)
        assert g.seats[1].is_bot and "B(AI)" == g.seats[1].player.name
        assert not g.finished
        await g.remove_player(A)
        assert g.finished and room.over
    asyncio.run(main())


def test_full_games_with_ai_keep_chips():
    """사람 자리도 AI 처럼 둬서 여러 판을 끝까지: 칩 합계는 그대로, 게임이 끝남."""
    async def main():
        for seed in range(30):
            room = FakeRoom(1, size=2 + seed % 2, max_rounds=5, point_value=50)
            g = Game(room, rng=random.Random(seed))
            total = sum(s.chips for s in g.seats)
            await g.start()
            for _ in range(5000):
                if g.finished:
                    break
                await settle()
                if g.turn is not None and not g.seats[g.turn].is_bot and g.phase == "play" and g.seats[g.turn].skip == 0:
                    seat = g.seats[g.turn]
                    from app.ai import choose_play
                    pick = choose_play(seat.hand, g.floor, random.Random(seed))
                    err = await g.play(seat.player, pick["card"], pick["target"], pick["shake"], pick["bomb"])
                    assert err is None, err
                elif g.turn is not None and g.phase == "gostop" and not g.seats[g.turn].is_bot:
                    await g.decide(g.seats[g.turn].player, False)
                assert sum(s.chips for s in g.seats) == total
                assert len(g.floor) + len(g.pile) + sum(len(s.hand) + len(s.captured) for s in g.seats) == 48 or g.phase == "result"
            await settle()
            assert g.finished and room.over, seed
    asyncio.run(main())
