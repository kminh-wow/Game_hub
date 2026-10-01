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
