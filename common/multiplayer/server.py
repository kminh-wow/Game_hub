"""접속자와 로비, 방 목록을 관리하고 클라이언트 메시지를 처리한다.

공통 메시지: chat, create_room, join_room, leave_room, ready, update_settings, start
게임 메시지: GameServer(actions={...}) 로 넘긴다. 핸들러는 (room, player, msg) 를 받고,
            오류가 있으면 안내 문구(str)를 돌려준다. 방에서 게임 중일 때만 불린다.
"""
from __future__ import annotations

import itertools
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket

from .models import Player, broadcast
from .room import BaseRoom

MAX_NAME = 12
MAX_TITLE = 30
MAX_CHAT = 200
MAX_TOKEN = 64

# WebSocket 종료 코드 (클라이언트가 안내 문구를 고르는 데 쓴다)
CLOSE_INVALID_NAME = 4000
CLOSE_NAME_TAKEN = 4001
CLOSE_REPLACED = 4002

Action = Callable[[Any, Player, dict], Awaitable[str | None]]


def valid_name(name: str) -> bool:
    return 1 <= len(name) <= MAX_NAME


class GameServer:
    def __init__(
        self,
        room_class: type[BaseRoom],
        ctx: Any = None,
        actions: dict[str, Action] | None = None,
        welcome_info: Callable[[], dict[str, Any]] = dict,
    ):
        self.room_class = room_class
        self.ctx = ctx
        self.welcome_info = welcome_info
        self.players: dict[str, Player] = {}
        self.rooms: dict[str, BaseRoom] = {}
        self._room_ids = itertools.count(1)
        self._handlers = {
            "chat": self._on_chat,
            "create_room": self._on_create_room,
            "join_room": self._on_join_room,
            "leave_room": self._on_leave_room,
            "ready": self._on_ready,
            "update_settings": self._on_update_settings,
            "start": self._on_start,
        }
        self._actions = actions or {}

    # ---- 연결 ----

    def _find_by_name(self, name: str) -> Player | None:
        key = name.casefold()
        return next((p for p in self.players.values() if p.name.casefold() == key), None)

    async def connect(self, ws: WebSocket, name: str, token: str) -> Player | None:
        """닉네임 중복을 막는다. 같은 브라우저(token 일치)면 예전 연결을 끊고 이어받는다."""
        token = token[:MAX_TOKEN]
        existing = self._find_by_name(name)
        if existing:
            if not token or existing.token != token:
                await ws.close(code=CLOSE_NAME_TAKEN, reason="name taken")
                return None
            await existing.send({"type": "kicked", "message": "다른 창에서 같은 닉네임으로 접속했어요."})
            await self.disconnect(existing)
            try:
                await existing.ws.close(code=CLOSE_REPLACED)
            except Exception:
                pass

        player = Player(id=uuid.uuid4().hex[:8], name=name, ws=ws, token=token)
        self.players[player.id] = player
        await player.send({"type": "welcome", "player": player.public(), **self.welcome_info()})
        await self.broadcast_lobby()
        return player

    async def disconnect(self, player: Player) -> None:
        # 이어받기로 먼저 정리된 연결이 나중에 한 번 더 들어와도 무시한다.
        if self.players.get(player.id) is not player:
            return
        del self.players[player.id]
        if player.room:
            await self._leave(player)
        await self.broadcast_lobby()

    async def handle(self, player: Player, msg: Any) -> None:
        if not isinstance(msg, dict):
            return
        kind = msg.get("type")
        if handler := self._handlers.get(kind):
            await handler(player, msg)
        elif (action := self._actions.get(kind)) and player.room and player.room.game:
            await self._error(player, await action(player.room, player, msg))

    # ---- 로비 ----

    def lobby_state(self) -> dict[str, Any]:
        return {
            "type": "lobby",
            "rooms": [r.summary() for r in self.rooms.values()],
            "users": [
                {**p.public(), "room_id": p.room.id if p.room else None}
                for p in self.players.values()
            ],
        }

    async def broadcast_lobby(self) -> None:
        in_lobby = [p for p in self.players.values() if p.room is None]
        await broadcast(in_lobby, self.lobby_state())

    async def _leave(self, player: Player) -> None:
        room = player.room
        if room is None:
            return
        await room.remove(player)
        if not room.players:
            if room.game:
                await room.game.finish()
            self.rooms.pop(room.id, None)
            await self.broadcast_lobby()
        await player.send({"type": "room", "room": None})

    # ---- 메시지 처리 ----

    @staticmethod
    async def _error(player: Player, message: str | None) -> None:
        if message:
            await player.send({"type": "error", "message": message})

    async def _on_chat(self, player: Player, msg: dict) -> None:
        text = str(msg.get("text", "")).strip()[:MAX_CHAT]
        if not text:
            return
        out = {"type": "chat", "from": player.public(), "text": text}
        if player.room:
            await player.room.broadcast({**out, "scope": "room"})
        else:
            in_lobby = [p for p in self.players.values() if p.room is None]
            await broadcast(in_lobby, {**out, "scope": "lobby"})

    async def _on_create_room(self, player: Player, msg: dict) -> None:
        if player.room:
            return await self._error(player, "이미 방에 있어요.")
        cls = self.room_class
        title = str(msg.get("title", "")).strip()[:MAX_TITLE] or f"{player.name}의 방"
        max_players = cls.default_max_players
        try:
            max_players = int(msg.get("max_players", max_players))
        except (TypeError, ValueError):
            pass
        max_players = max(cls.min_players, min(cls.max_players_limit, max_players))
        room = cls(
            room_id=str(next(self._room_ids)),
            title=title,
            host=player,
            max_players=max_players,
            ctx=self.ctx,
            on_lobby_change=self.broadcast_lobby,
        )
        self.rooms[room.id] = room
        await room.add(player)

    async def _on_join_room(self, player: Player, msg: dict) -> None:
        if player.room:
            return await self._error(player, "이미 방에 있어요.")
        room = self.rooms.get(str(msg.get("room_id")))
        if room is None:
            return await self._error(player, "없는 방이에요.")
        if room.playing:
            return await self._error(player, "게임이 진행 중인 방이에요.")
        if room.full:
            return await self._error(player, "방이 꽉 찼어요.")
        await room.add(player)

    async def _on_leave_room(self, player: Player, msg: dict) -> None:
        await self._leave(player)

    async def _on_ready(self, player: Player, msg: dict) -> None:
        if player.room:
            await self._error(player, await player.room.toggle_ready(player))

    async def _on_update_settings(self, player: Player, msg: dict) -> None:
        if player.room:
            settings = msg.get("settings")
            if isinstance(settings, dict):
                await self._error(player, await player.room.update_settings(player, settings))

    async def _on_start(self, player: Player, msg: dict) -> None:
        if player.room:
            await self._error(player, await player.room.start(player))
