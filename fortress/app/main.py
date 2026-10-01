"""포트리스 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


async def aim(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.aim(player, msg.get("angle"), msg.get("facing"))


async def move(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.move(player, msg.get("dir"))


async def fire(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.fire(player, msg.get("power"), msg.get("weapon", "normal"))


server = GameServer(Room, actions={"aim": aim, "move": move, "fire": fire})
app = create_app(server, STATIC_DIR, "Fortress")
