"""턴제 FPS FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


async def look(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.look(player, msg.get("yaw"), msg.get("pitch"))


async def move(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.move(player, msg.get("dx"), msg.get("dz"))


async def fire(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.fire(player, msg.get("weapon", "rifle"), msg.get("yaw"), msg.get("pitch"))


server = GameServer(Room, actions={"look": look, "move": move, "fire": fire})
app = create_app(server, STATIC_DIR, "Turn FPS")
