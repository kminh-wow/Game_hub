"""박스헤드 FastAPI 앱: 혼자 하기(/)는 정적 파일, 같이 하기(/multi)는 공통 로비·방 + 중계."""
from __future__ import annotations

from pathlib import Path

from fastapi.responses import FileResponse

from common.multiplayer import GameServer, Player, create_app

from .room import Room

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


# 참가자 입력 → 방장
async def send_input(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.relay_input(player, msg)


# 방장 화면 값 → 나머지
async def send_snap(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.relay_snap(player, msg)


# 방장이 끝남을 알림
async def send_over(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.over(player, msg)


server = GameServer(Room, actions={"input": send_input, "snap": send_snap, "over": send_over})
app = create_app(server, STATIC_DIR, "Boxhead")


@app.get("/multi")
async def multi() -> FileResponse:
    return FileResponse(STATIC_DIR / "multi.html")
