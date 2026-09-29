from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket

if TYPE_CHECKING:
    from .room import Room


@dataclass(eq=False)
class Player:
    id: str
    name: str
    ws: WebSocket
    room: Room | None = None

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
