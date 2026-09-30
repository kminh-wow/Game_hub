"""요트 다이스 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


async def roll(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.roll(player)


async def hold(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.hold(player, msg.get("held"))


async def write(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.write(player, msg.get("category"))


server = GameServer(Room, actions={"roll": roll, "hold": hold, "write": write})
app = create_app(server, STATIC_DIR, "Yacht Dice")
