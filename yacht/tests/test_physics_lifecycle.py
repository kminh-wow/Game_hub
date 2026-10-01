"""Exercise timer/turn changes while the physics worker or replay is pending."""
import asyncio
import copy
import threading
from types import SimpleNamespace

from app.game import Game
from app.physics import initial_poses
from app.room import RoomSettings


class RoomStub:
    def __init__(self):
        self.settings = RoomSettings()
        self.players = [SimpleNamespace(id="a", name="A"), SimpleNamespace(id="b", name="B")]
        self.messages = []

    async def broadcast(self, msg):
        self.messages.append(copy.deepcopy(msg))


def result():
    poses = initial_poses()
    return {"dice": [1]*5, "poses": poses, "frames": [poses, poses],
            "frame_ms": 40, "duration_ms": 40}


def test_departure_discards_pending_worker(monkeypatch):
    started, release = threading.Event(), threading.Event()

    def simulate(*args):
        started.set()
        assert release.wait(3)
        return result()

    monkeypatch.setattr("app.game.throw_dice", simulate)

    async def scenario():
        room = RoomStub()
        game = Game(room)
        await game.start()
        task = asyncio.create_task(game.roll(room.players[0]))
        try:
            assert await asyncio.to_thread(started.wait, 3)
            await game.remove_player(room.players[0])
            release.set()
            assert await task == "차례가 바뀌었어요."
            assert game.current.id == "b" and game.rolls_left == 3
            assert not game.rolling
            assert not any(e["kind"] == "roll" for m in room.messages for e in m["events"])
        finally:
            release.set()
            game._cancel_timer()
            game._cancel_roll()
    asyncio.run(scenario())


def test_timeout_waits_for_throw_then_scores(monkeypatch):
    monkeypatch.setattr("app.game.throw_dice", lambda *args: result())

    async def scenario():
        room = RoomStub()
        game = Game(room)
        await game.start()
        game._cancel_timer()
        game.settings.turn_time = 0
        await game._turn_timer()
        assert game.sheets["a"]["yacht"] == 50
        assert game.current.id == "b"
        start = next(m for m in room.messages if any(e["kind"] == "roll" for e in m["events"]))
        assert start["game"]["rolling"] and start["game"]["preview"] is None
        game._cancel_timer()
        game._cancel_roll()
    asyncio.run(scenario())


def throw_of(dice):
    return {**result(), "dice": list(dice)}


def test_rethrow_picks_more_matching_dice_when_collecting_one_face(monkeypatch):
    monkeypatch.setattr("app.game.YACHT_ASSIST", 1.0)
    monkeypatch.setattr("app.game.throw_dice", lambda *args: throw_of([4, 4, 1, 2, 3]))

    async def scenario():
        game = Game(RoomStub())
        game.dice = [4, 4, 1, 2, 3]
        game.held = [True, True, False, False, False]
        first = throw_of([4, 4, 1, 2, 3])
        assert (await game._maybe_rethrow(first))["dice"] == [4, 4, 1, 2, 3]   # 두 번째가 같으면 첫 결과
        monkeypatch.setattr("app.game.throw_dice", lambda *args: throw_of([4, 4, 4, 4, 6]))
        assert (await game._maybe_rethrow(first))["dice"] == [4, 4, 4, 4, 6]   # 더 많이 맞으면 두 번째
        monkeypatch.setattr("app.game.throw_dice", lambda *args: throw_of([4, 4, 5, 5, 5]))
        better = throw_of([4, 4, 4, 5, 5])
        assert (await game._maybe_rethrow(better))["dice"] == [4, 4, 4, 5, 5]  # 더 적으면 첫 결과
    asyncio.run(scenario())


def test_no_rethrow_without_a_single_kept_face(monkeypatch):
    monkeypatch.setattr("app.game.YACHT_ASSIST", 1.0)
    calls = []
    monkeypatch.setattr("app.game.throw_dice", lambda *args: calls.append(1) or throw_of([6] * 5))

    async def scenario():
        game = Game(RoomStub())
        first = throw_of([1, 2, 3, 4, 5])
        game.dice = [3, 3, 5, 1, 2]
        for held in ([False] * 5, [True, False, False, False, False], [True, False, True, False, False]):
            game.held = held                                  # 안 남김 / 1개 남김 / 서로 다른 눈 2개 남김
            assert await game._maybe_rethrow(first) is first
        assert not calls
    asyncio.run(scenario())
