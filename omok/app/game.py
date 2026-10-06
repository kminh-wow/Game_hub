"""오목 한 판: 흑이 먼저, 번갈아 한 수씩. 혼자면 AI 가 백 또는 흑을 맡는다."""
from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING, Any

from common.multiplayer.banter import Banter

from .ai import LEVEL_NAMES, ai_move, judge_move
from common.multiplayer import spicy

from .banter import LINES, SITUATIONS
from .rules import BLACK, LINES as DIRECTIONS, WHITE, in_bounds, is_full, new_board, other, winning_line

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

AI_DELAY = 0.6   # AI 가 두기 전 기다리는 시간(초)
MOVE_COOLDOWN = 2.5   # 사람 수에 대한 AI 반응 사이 최소 간격(초)


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
        ai = next((p for p in (self.black, self.white) if isinstance(p, AIPlayer)), None)
        self.banter = None                       # AI 대사 (AI 와 둘 때만)
        if ai:
            self.banter = Banter(room, ai.public(), LINES, game="오목", situations=SITUATIONS,
                                 spicy=spicy.lines("omok") if self.settings.ai_talk else None)
        self.human = next((p for p in (self.black, self.white) if not isinstance(p, AIPlayer)), None)
        self._judged: str | None = None          # 사람이 방금 둔 수 평가

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
        if self.banter:
            self.banter.say("start", important=True, name=self.human.name)
        await self._start_turn()

    # 플레이어 채팅에 AI 대꾸
    async def hear_chat(self, player: Player, text: str) -> None:
        if self.banter and not self.finished and player is self.human:
            self.banter.hear(player, text)

    # 이번 수로 이어진 가장 긴 줄
    def _longest(self, x: int, y: int) -> int:
        color = self.board[y][x]
        best = 1
        for dx, dy in DIRECTIONS:
            n = 1
            for sx, sy in ((dx, dy), (-dx, -dy)):
                cx, cy = x + sx, y + sy
                while in_bounds(cx, cy) and self.board[cy][cx] == color:
                    n += 1
                    cx, cy = cx + sx, cy + sy
            best = max(best, n)
        return best

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
        self._judged = judge_move(self.board, self.turn, x, y) if self.banter else None
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
            if self.banter:
                self._react(x, y)
            self.turn = other(self.turn)
            await self._start_turn()

    # 수에 대한 AI 반응
    def _react(self, x: int, y: int) -> None:
        by_ai = isinstance(self.current, AIPlayer)
        if self._longest(x, y) >= 4:
            self.banter.say("ai_threat" if by_ai else "player_threat", chance=.8)
        elif by_ai:
            self.banter.say("ai_move", chance=.12)
        elif self._judged:                       # 사람 수마다 잘 뒀나 못 뒀나
            chance = {"blunder": 1.0, "bad": .75, "good": .65}[self._judged]
            self.banter.say(f"player_{self._judged}", chance=chance, cooldown=MOVE_COOLDOWN)

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
        if self.banter and reason != "leave":
            kind = ("draw" if winner is None else "ai_win" if isinstance(winner, AIPlayer)
                    else "ai_lose")
            if winner is not None and isinstance(winner, AIPlayer) and reason in ("resign", "timeout"):
                kind = "player_resign" if reason == "resign" else "player_timeout"
            self.banter.say(kind, important=True, name=self.human.name)
        await self.broadcast_state()
        await self.room.broadcast({
            "type": "game_over",
            "winner": winner.public() if winner else None,
            "reason": reason,
        })
        await self.room.end_game(self)
