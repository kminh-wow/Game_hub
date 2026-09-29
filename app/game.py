"""한 방에서 진행되는 끝말잇기 게임 한 판."""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from .dictionary import HANGUL_WORD, next_chars

if TYPE_CHECKING:
    from .models import Player
    from .room import Room

ROUND_BREAK = 3.0     # 라운드 사이 쉬는 시간(초)
MIN_TURN_TIME = 1.0   # 라운드 시간이 거의 끝나도 최소한 주는 턴 시간(초)
FAIL_PENALTY = 50
CHAIN_HISTORY = 30


class Game:
    def __init__(self, room: Room):
        self.room = room
        self.dictionary = room.dictionary
        self.settings = room.settings.copy()
        self.order: list[Player] = list(room.players)
        self.scores: dict[str, int] = {p.id: 0 for p in self.order}

        self.round = 0
        self.turn_idx = 0
        self.chars: tuple[str, ...] = ()
        self.used: set[str] = set()
        self.chain: list[str] = []
        self.round_left = 0.0
        self.turn_limit = 0.0
        self.turn_started = 0.0

        self.accepting = False
        self.finished = False
        self._timer: asyncio.Task | None = None

    @property
    def current(self) -> Player:
        return self.order[self.turn_idx]

    def snapshot(self) -> dict[str, Any]:
        return {
            "round": self.round,
            "rounds": self.settings.rounds,
            "current_id": self.current.id if self.accepting else None,
            "chars": list(self.chars),
            "chain": self.chain[-CHAIN_HISTORY:],
            "scores": self.scores,
        }

    # ---- 진행 ----

    async def start(self) -> None:
        await self.room.broadcast({
            "type": "game_start",
            "order": [p.id for p in self.order],
            "scores": self.scores,
        })
        await self._start_round()

    async def _start_round(self) -> None:
        self.round += 1
        start_word = self.dictionary.random_start_word()
        self.used = {start_word}
        self.chain = [start_word]
        self.chars = next_chars(start_word)
        self.round_left = float(self.settings.round_time)
        await self.room.broadcast({
            "type": "round_start",
            "round": self.round,
            "rounds": self.settings.rounds,
            "start_word": start_word,
            "chars": list(self.chars),
        })
        await self._start_turn()

    async def _start_turn(self) -> None:
        self.turn_limit = min(float(self.settings.turn_time), max(self.round_left, MIN_TURN_TIME))
        self.turn_started = asyncio.get_running_loop().time()
        self.accepting = True
        await self.room.broadcast({
            "type": "turn",
            "player_id": self.current.id,
            "chars": list(self.chars),
            "turn_limit_ms": int(self.turn_limit * 1000),
            "round_left_ms": int(self.round_left * 1000),
            "round_time_ms": self.settings.round_time * 1000,
        })
        self._timer = asyncio.create_task(self._turn_timer(self.turn_limit))

    async def _turn_timer(self, limit: float) -> None:
        try:
            await asyncio.sleep(limit)
        except asyncio.CancelledError:
            return
        self._timer = None
        await self._on_timeout()

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    async def _on_timeout(self) -> None:
        self.accepting = False
        loser = self.current
        self.scores[loser.id] -= FAIL_PENALTY
        await self.room.broadcast({
            "type": "round_end",
            "loser_id": loser.id,
            "penalty": FAIL_PENALTY,
            "chars": list(self.chars),
            "scores": self.scores,
        })
        await asyncio.sleep(ROUND_BREAK)
        if self.finished:
            return
        if self.round >= self.settings.rounds:
            await self.finish()
        else:
            # 진 사람이 다음 라운드를 시작한다 (turn_idx 그대로).
            await self._start_round()

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self.accepting = False
        self._cancel_timer()
        ranking = sorted(
            ({**p.public(), "score": self.scores[p.id]} for p in self.order),
            key=lambda r: r["score"],
            reverse=True,
        )
        await self.room.broadcast({"type": "game_over", "ranking": ranking})
        await self.room.end_game(self)

    # ---- 입력 ----

    def _validate(self, word: str) -> str | None:
        if not HANGUL_WORD.fullmatch(word):
            return "한글 단어만 쓸 수 있어요"
        if len(word) < 2:
            return "두 글자 이상이어야 해요"
        if word[0] not in self.chars:
            return f"'{'/'.join(self.chars)}'(으)로 시작해야 해요"
        if word in self.used:
            return "이미 나온 단어예요"
        if word not in self.dictionary:
            return "사전에 없는 단어예요"
        if self.settings.no_killer and self.dictionary.is_killer(word):
            return "한방단어는 금지예요"
        return None

    async def submit(self, player: Player, word: str) -> None:
        if not self.accepting or player is not self.current:
            return
        word = word.strip()
        reason = self._validate(word)
        if reason:
            await self.room.broadcast({
                "type": "word_fail",
                "player_id": player.id,
                "word": word[:20],
                "reason": reason,
            })
            return

        self._cancel_timer()
        self.accepting = False
        elapsed = asyncio.get_running_loop().time() - self.turn_started
        self.round_left = max(0.0, self.round_left - elapsed)

        base = 10 * len(word)
        speed_ratio = max(0.0, 1 - elapsed / self.turn_limit)
        gain = base + round(base * speed_ratio)
        self.scores[player.id] += gain

        self.used.add(word)
        self.chain.append(word)
        self.chars = next_chars(word)
        self.turn_idx = (self.turn_idx + 1) % len(self.order)

        await self.room.broadcast({
            "type": "word_ok",
            "player_id": player.id,
            "word": word,
            "gain": gain,
            "scores": self.scores,
        })
        await self._start_turn()

    async def remove_player(self, player: Player) -> None:
        if player not in self.order or self.finished:
            return
        idx = self.order.index(player)
        was_current = idx == self.turn_idx
        self.order.remove(player)

        if len(self.order) < 2:
            await self.finish()
            return
        if idx < self.turn_idx:
            self.turn_idx -= 1
        self.turn_idx %= len(self.order)

        if was_current and self.accepting:
            # 나간 사람 차례였으면 같은 글자로 다음 사람에게 넘긴다.
            self._cancel_timer()
            self.accepting = False
            await self._start_turn()
