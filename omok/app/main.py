"""오목 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


async def place(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.place(player, msg.get("x"), msg.get("y"))


async def resign(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.resign(player)


server = GameServer(Room, actions={"place": place, "resign": resign})
app = create_app(server, STATIC_DIR, "Omok")
