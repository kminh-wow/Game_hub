"""오목 한 판: 흑이 먼저, 번갈아 한 수씩. 혼자면 AI 가 백 또는 흑을 맡는다."""
from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING, Any

from .ai import LEVEL_NAMES, ai_move
from .rules import BLACK, WHITE, in_bounds, is_full, new_board, other, winning_line

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

AI_DELAY = 0.6   # AI 가 두기 전 기다리는 시간(초)


class AIPlayer:
    id = "ai"

    def __init__(self, level: int):
        self.level = level
        self.name = f"AI · {LEVEL_NAMES[level]}"

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


class Game:
    def __init__(self, room: Room):
        self.room = room
        self.settings = room.settings.copy()
        players: list[Any] = list(room.players)
        if len(players) == 1:
            players.append(AIPlayer(self.settings.ai_level))
        # 첫 판은 무작위, 다음 판부터는 직전 판에서 진 사람이 흑
        if room.last_loser_id in (players[1].id,):
            players.reverse()
        elif room.last_loser_id is None:
            random.shuffle(players)
        self.black, self.white = players

        self.board = new_board()
        self.turn = BLACK
        self.moves: list[tuple[int, int]] = []
        self.winner: Any = None
        self.win_line: list[tuple[int, int]] | None = None
        self.reason: str | None = None
        self.finished = False
        self._timer: asyncio.Task | None = None
        self.deadline = 0.0

    # ---- 조회 ----

    @property
    def current(self) -> Any:
        return self.black if self.turn == BLACK else self.white

    def opponent_of(self, player: Any) -> Any:
        return self.white if player is self.black else self.black

    def state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return {
            "board": self.board,
            "black": self.black.public(),
            "white": self.white.public(),
            "turn": "black" if self.turn == BLACK else "white",
            "current_id": None if self.finished else self.current.id,
            "last": list(self.moves[-1]) if self.moves else None,
            "move_count": len(self.moves),
            "time_left_ms": 0 if self.finished else max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": self.settings.turn_time * 1000,
            "winner_id": self.winner.id if self.winner else None,
            "win_line": [list(p) for p in self.win_line] if self.win_line else None,
            "reason": self.reason,
        }

    async def broadcast_state(self) -> None:
        await self.room.broadcast({"type": "game", "game": self.state()})

    # 관전자 입장 시 현재 상태
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state()}]

    # ---- 진행 ----

    async def start(self) -> None:
        await self._start_turn()

    async def _start_turn(self) -> None:
        self._cancel_timer()
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        if isinstance(self.current, AIPlayer):
            self._timer = asyncio.create_task(self._ai_turn())
        else:
            self._timer = asyncio.create_task(self._turn_timer())
        await self.broadcast_state()

    async def _turn_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._timer = None
        loser = self.current
        await self.finish(winner=self.opponent_of(loser), reason="timeout")

    # AI 수 두기
    async def _ai_turn(self) -> None:
        loop = asyncio.get_running_loop()
        started = loop.time()
        try:
            board = [row[:] for row in self.board]
            x, y = await asyncio.to_thread(ai_move, board, self.turn, None, self.current.level)
            await asyncio.sleep(max(AI_DELAY - (loop.time() - started), 0))
        except asyncio.CancelledError:
            return
        self._timer = None
        await self._place(x, y)

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    async def place(self, player: Player, x: Any, y: Any) -> str | None:
        if self.finished or player is not self.current:
            return "지금은 내 차례가 아니에요."
        try:
            x, y = int(x), int(y)
        except (TypeError, ValueError):
            return "잘못된 위치예요."
        if not in_bounds(x, y):
            return "판 밖이에요."
        if self.board[y][x]:
            return "이미 돌이 있는 자리예요."
        await self._place(x, y)
        return None

    async def _place(self, x: int, y: int) -> None:
        self._cancel_timer()
        self.board[y][x] = self.turn
        self.moves.append((x, y))
        if line := winning_line(self.board, x, y):
            self.win_line = line
            await self.finish(winner=self.current, reason="five")
        elif is_full(self.board):
            await self.finish(winner=None, reason="draw")
        else:
            self.turn = other(self.turn)
            await self._start_turn()

    async def resign(self, player: Player) -> str | None:
        if self.finished or player not in (self.black, self.white):
            return None
        await self.finish(winner=self.opponent_of(player), reason="resign")
        return None

    async def remove_player(self, player: Player) -> None:
        if not self.finished and player in (self.black, self.white):
            await self.finish(winner=self.opponent_of(player), reason="leave")

    async def finish(self, winner: Any = None, reason: str = "abort") -> None:
        if self.finished:
            return
        self.finished = True
        self._cancel_timer()
        self.winner = winner
        self.reason = reason
        loser = self.opponent_of(winner) if winner else None
        self.room.record_result(winner, loser)
        await self.broadcast_state()
        await self.room.broadcast({
            "type": "game_over",
            "winner": winner.public() if winner else None,
            "reason": reason,
        })
        await self.room.end_game(self)
