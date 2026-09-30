"""In-memory room/session management for Quoridor matches."""
from __future__ import annotations

import random
import string
from typing import Optional

from fastapi import WebSocket

from . import game

CODE_ALPHABET = string.ascii_uppercase + string.digits


class Room:
    def __init__(self, code: str, mode: str, difficulty: str = "medium"):
        self.code = code
        self.mode = mode  # "pvp", "ai", or "learn"
        self.difficulty = difficulty  # "easy", "medium", or "hard" (ai/learn rooms)
        self.sockets: dict[int, WebSocket] = {}
        self.state = game.GameState()

    def opponent_of(self, player: int) -> int:
        return game.other(player)

    async def broadcast(self, message: dict):
        for ws in list(self.sockets.values()):
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

    def _new_code(self) -> str:
        while True:
            code = "".join(random.choices(CODE_ALPHABET, k=6))
            if code not in self.rooms:
                return code

    def create_room(self, ws: WebSocket) -> Room:
        code = self._new_code()
        room = Room(code, mode="pvp")
        room.sockets[1] = ws
        self.rooms[code] = room
        self.socket_room[ws] = (code, 1)
        return room

    def join_room(self, code: str, ws: WebSocket) -> Optional[Room]:
        room = self.rooms.get(code)
        if room is None or room.mode != "pvp" or 2 in room.sockets:
            return None
        room.sockets[2] = ws
        self.socket_room[ws] = (code, 2)
        return room

    def _create_solo_room(self, ws: WebSocket, mode: str, difficulty: str = "medium") -> Room:
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

    def disconnect(self, ws: WebSocket):
        entry = self.socket_room.pop(ws, None)
        if entry is None:
            return
        code, player = entry
        room = self.rooms.get(code)
        if room is None:
            return
        room.sockets.pop(player, None)
        if not room.sockets:
            self.rooms.pop(code, None)
