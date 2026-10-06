from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket

if TYPE_CHECKING:
    from .room import BaseRoom as Room


@dataclass(eq=False)
class Player:
    id: str
    name: str
    ws: WebSocket
    token: str = ""  # 브라우저별 식별값. 같은 브라우저의 재접속을 알아보는 데 쓴다.
    room: Room | None = None
    spectating: bool = False   # 관전 중 (방에는 있지만 참가자는 아님)
    client_errors: int = 0     # 이 접속에서 받은 브라우저 오류 수

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}

    async def send(self, msg: dict[str, Any]) -> None:
        try:
            await self.ws.send_json(msg)
        except Exception:
            # 끊긴 소켓은 수신 루프 쪽에서 정리된다.
            pass


async def broadcast(players: Iterable[Player], msg: dict[str, Any]) -> None:
    await asyncio.gather(*(p.send(msg) for p in players))
