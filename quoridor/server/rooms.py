"""In-memory room/session management for Quoridor matches."""
from __future__ import annotations

import random
import string
from typing import Optional

from fastapi import WebSocket

from . import game

CODE_ALPHABET = string.ascii_uppercase + string.digits
MAX_WATCHERS = 20   # 방마다 관전자 수 제한


class Room:
    def __init__(self, code: str, mode: str, difficulty: str = "medium"):
        self.code = code
        self.mode = mode  # "pvp", "ai", or "learn"
        self.difficulty = difficulty  # "easy", "medium", or "hard" (ai/learn rooms)
        self.sockets: dict[int, WebSocket] = {}
        self.watchers: list[WebSocket] = []   # 관전자 (방 코드로 들어와 보기만 한다)
        self.state = game.GameState()

    def opponent_of(self, player: int) -> int:
        return game.other(player)

    async def broadcast(self, message: dict):
        for ws in [*self.sockets.values(), *self.watchers]:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    async def send_to(self, player: int, message: dict):
        ws = self.sockets.get(player)
        if ws is not None:
            try:
                await ws.send_json(message)
            except Exception:
                pass


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        self.socket_room: dict[WebSocket, tuple[str, int]] = {}
        self.watching: dict[WebSocket, str] = {}   # 관전자 소켓 -> 방 코드

    def _new_code(self) -> str:
        while True:
            code = "".join(random.choices(CODE_ALPHABET, k=6))
            if code not in self.rooms:
                return code

    def watch_room(self, code: str, ws: WebSocket) -> Optional[Room]:
        """방 코드로 관전자로 들어간다. 없는 방, 이미 방에 있는 소켓, 관전석이 가득 찬 경우는 None."""
        room = self.rooms.get(code)
        if room is None or ws in self.socket_room or ws in self.watching or len(room.watchers) >= MAX_WATCHERS:
            return None
        room.watchers.append(ws)
        self.watching[ws] = code
        return room

    def stop_watching(self, ws: WebSocket) -> None:
        """관전을 끝낸다 (연결은 그대로)."""
        code = self.watching.pop(ws, None)
        room = self.rooms.get(code) if code else None
        if room is not None and ws in room.watchers:
            room.watchers.remove(ws)

    def create_room(self, ws: WebSocket) -> Room:
        self.stop_watching(ws)
        code = self._new_code()
        room = Room(code, mode="pvp")
        room.sockets[1] = ws
        self.rooms[code] = room
        self.socket_room[ws] = (code, 1)
        return room

    def join_room(self, code: str, ws: WebSocket) -> Optional[Room]:
        self.stop_watching(ws)
        room = self.rooms.get(code)
        if room is None or room.mode != "pvp" or 2 in room.sockets:
            return None
        room.sockets[2] = ws
        self.socket_room[ws] = (code, 2)
        return room

    def _create_solo_room(self, ws: WebSocket, mode: str, difficulty: str = "medium") -> Room:
        self.stop_watching(ws)
        code = self._new_code()
        room = Room(code, mode=mode, difficulty=difficulty)
        room.sockets[1] = ws
        self.rooms[code] = room
        self.socket_room[ws] = (code, 1)
        return room

    def create_ai_room(self, ws: WebSocket, difficulty: str = "medium") -> Room:
        return self._create_solo_room(ws, mode="ai", difficulty=difficulty)

    def create_learn_room(self, ws: WebSocket) -> Room:
        return self._create_solo_room(ws, mode="learn")

    def lookup(self, ws: WebSocket) -> Optional[tuple[Room, int]]:
        entry = self.socket_room.get(ws)
        if entry is None:
            return None
        code, player = entry
        room = self.rooms.get(code)
        if room is None:
            return None
        return room, player

    def disconnect(self, ws: WebSocket) -> list[WebSocket]:
        """연결을 정리한다. 방이 닫혀서 갈 곳이 없어진 관전자 소켓들을 돌려준다."""
        if ws in self.watching:
            self.stop_watching(ws)
            return []
        entry = self.socket_room.pop(ws, None)
        if entry is None:
            return []
        code, player = entry
        room = self.rooms.get(code)
        if room is None:
            return []
        room.sockets.pop(player, None)
        if room.sockets:
            return []
        self.rooms.pop(code, None)
        orphans = list(room.watchers)
        for watcher in orphans:
            self.watching.pop(watcher, None)
        room.watchers.clear()
        return orphans
