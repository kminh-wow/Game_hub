"""고스톱 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


# 카드 내기 (바닥에 같은 월이 두 장이면 target, 흔들기·폭탄은 shake·bomb)
async def play(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.play(player, msg.get("card"), msg.get("target"), msg.get("shake"), msg.get("bomb"))


# 고·스톱
async def gostop(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.decide(player, msg.get("go"))


server = GameServer(Room, actions={"play": play, "gostop": gostop})
app = create_app(server, STATIC_DIR, "Gostop")
