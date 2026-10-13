"""홀덤 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


# 폴드·체크·콜·레이즈·올인
async def act(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.act(player, msg.get("action"), msg.get("amount"))


server = GameServer(Room, actions={"act": act})
app = create_app(server, STATIC_DIR, "Holdem")
