"""요트 다이스 한 판: 들어온 순서대로 돌아가며, 한 차례에 최대 3번 굴리고 족보 하나에 점수를 적는다."""
from __future__ import annotations

import asyncio
import logging
import random
from typing import TYPE_CHECKING, Any

from .rules import CATEGORY_IDS, DICE, MAX_ROLLS, ROUNDS, all_notes, all_scores, best_category, explain, score, totals
from .physics import initial_poses, throw_dice

YACHT_ASSIST = 0.5   # 같은 눈을 모으는 중일 때 두 번 던지는 비율 (요트 확률 약 +3%p)

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room


class Game:
    def __init__(self, room: Room, rng: random.Random | None = None):
        self.room = room
        self.settings = room.settings.copy()
        self.rng = rng or random.Random()
        self.order: list[Player] = list(room.players)
        self.sheets: dict[str, dict[str, int | None]] = {p.id: {c: None for c in CATEGORY_IDS} for p in self.order}
        self.notes: dict[str, dict[str, str]] = {p.id: {} for p in self.order}   # 적은 칸의 점수 계산 설명
        self.names = {p.id: p.name for p in self.order}

        self.round = 1
        self.turn_idx = 0
        self.dice = [1] * DICE
        self.held = [False] * DICE
        self.rolls_left = MAX_ROLLS
        self.finished = False
        self._timer: asyncio.Task | None = None
        self.deadline = 0.0
        self.events: list[dict[str, Any]] = []
        self.poses = initial_poses()
        self.rolling = False
        self._settler: asyncio.Task | None = None
        self._generation = 0

    # ---- 조회 ----

    @property
    def current(self) -> Player:
        return self.order[self.turn_idx]

    @property
    def rolled(self) -> bool:
        return self.rolls_left < MAX_ROLLS

    def state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return {
            "round": self.round,
            "rounds": ROUNDS,
            "order": [p.id for p in self.order],
            "names": self.names,
            "current_id": None if self.finished else self.current.id,
            "dice": self.dice,
            "poses": self.poses,
            "rolling": self.rolling,
            "held": self.held,
            "rolls_left": self.rolls_left,
            "rolled": self.rolled,
            "preview": all_scores(self.dice) if self.rolled and not self.rolling else None,
            "preview_notes": all_notes(self.dice) if self.rolled and not self.rolling else None,
            "sheets": self.sheets,
            "notes": self.notes,
            "totals": {pid: totals(sheet) for pid, sheet in self.sheets.items()},
            "time_left_ms": 0 if self.finished else max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": self.settings.turn_time * 1000,
        }

    async def broadcast_state(self) -> None:
        events, self.events = self.events, []
        await self.room.broadcast({"type": "game", "game": self.state(), "events": events})

    # 관전자 입장 시 현재 상태
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(), "events": []}]

    # ---- 진행 ----

    async def start(self) -> None:
        await self._start_turn()

    async def _start_turn(self) -> None:
        self._cancel_roll()
        self.poses = initial_poses()
        self.dice = [1] * DICE
        self.held = [False] * DICE
        self.rolls_left = MAX_ROLLS
        self._cancel_timer()
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        self._timer = asyncio.create_task(self._turn_timer())
        self.events.append({"kind": "turn", "player_id": self.current.id, "round": self.round})
        await self.broadcast_state()

    async def _turn_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._timer = None
        generation = self._generation
        while self.rolling:
            await asyncio.sleep(.05)
            if generation != self._generation or self.finished:
                return
        # 시간 초과: 한 번도 안 굴렸으면 굴리고, 점수가 가장 높은 칸에 자동으로 적는다.
        if not self.rolled:
            error = await self._roll()
            if generation != self._generation or self.finished:
                return
            if error:
                # A failed simulation consumes no roll and gives time to retry.
                self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
                self._timer = asyncio.create_task(self._turn_timer())
                await self.broadcast_state()
                return
            await self.broadcast_state()
            while self.rolling:
                await asyncio.sleep(.05)
                if generation != self._generation or self.finished:
                    return
        category = best_category(self.sheets[self.current.id], self.dice)
        self.events.append({"kind": "timeout", "player_id": self.current.id})
        await self._write(category)

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _cancel_roll(self) -> None:
        self._generation += 1
        self.rolling = False
        if self._settler:
            self._settler.cancel()
            self._settler = None

    async def _settle(self, duration: float, generation: int) -> None:
        await asyncio.sleep(duration)
        if generation == self._generation and not self.finished:
            self.rolling = False
            self._settler = None
            await self.broadcast_state()

    # 요트 보정 (같은 눈을 모으는 중이면 두 번 던져 더 나은 쪽 선택)
    async def _maybe_rethrow(self, result: dict[str, Any]) -> dict[str, Any]:
        kept = {self.dice[i] for i in range(DICE) if self.held[i]}
        if sum(self.held) < 2 or len(kept) != 1 or self.rng.random() >= YACHT_ASSIST:
            return result
        face = kept.pop()
        second = await asyncio.to_thread(throw_dice, self.rng, self.poses, self.held)
        if second["dice"].count(face) > result["dice"].count(face):
            return second
        return result

    async def _roll(self) -> str | None:
        self.rolling = True
        generation = self._generation
        try:
            result = await asyncio.to_thread(throw_dice, self.rng, self.poses, self.held)
            result = await self._maybe_rethrow(result)
        except Exception:
            logging.getLogger(__name__).exception("Dice simulation failed")
            if generation == self._generation:
                self.rolling = False
            return "주사위가 멈추지 않았어요. 다시 굴려 주세요."
        if generation != self._generation or self.finished:
            return "차례가 바뀌었어요."
        self.dice = result["dice"]
        self.poses = result["poses"]
        self.rolls_left -= 1
        self.events.append({
            "kind": "roll",
            "player_id": self.current.id,
            "dice": self.dice,
            "rolled": [not h for h in self.held],   # 이번에 굴러간 주사위 (애니메이션용)
            "frames": result["frames"],
            "frame_ms": result["frame_ms"],
            "duration_ms": result["duration_ms"],
        })
        self._settler = asyncio.create_task(self._settle(result["duration_ms"] / 1000, generation))
        return None

    # ---- 입력 ----

    def _check_turn(self, player: Player) -> str | None:
        if self.finished or player is not self.current:
            return "지금은 내 차례가 아니에요."
        if self.rolling:
            return "주사위가 멈출 때까지 기다려 주세요."
        return None

    async def hold(self, player: Player, held: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        if not self.rolled:
            return "먼저 주사위를 굴려 주세요."
        if not (isinstance(held, list) and len(held) == DICE):
            return "잘못된 요청이에요."
        self.held = [bool(h) for h in held]
        await self.broadcast_state()
        return None

    async def roll(self, player: Player) -> str | None:
        if err := self._check_turn(player):
            return err
        if self.rolls_left <= 0:
            return "이번 차례에는 더 굴릴 수 없어요. 점수를 적어 주세요."
        if self.rolled and all(self.held):
            return "고정하지 않은 주사위가 없어요."
        if err := await self._roll():
            return err
        await self.broadcast_state()
        return None

    async def write(self, player: Player, category: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        if not self.rolled:
            return "먼저 주사위를 굴려 주세요."
        if category not in CATEGORY_IDS or self.sheets[player.id][category] is not None:
            return "그 칸에는 적을 수 없어요."
        await self._write(category)
        return None

    async def _write(self, category: str) -> None:
        self._cancel_timer()
        points = score(category, self.dice)
        self.sheets[self.current.id][category] = points
        self.notes[self.current.id][category] = explain(category, self.dice)
        self.events.append({"kind": "write", "player_id": self.current.id, "category": category, "points": points})
        await self._next_turn()

    async def _next_turn(self) -> None:
        self.turn_idx += 1
        if self.turn_idx >= len(self.order):
            self.turn_idx = 0
            self.round += 1
        if self.round > ROUNDS:
            await self.finish()
        else:
            await self._start_turn()

    # ---- 종료 / 퇴장 ----

    async def remove_player(self, player: Player) -> None:
        if self.finished or player not in self.order:
            return
        idx = self.order.index(player)
        was_current = idx == self.turn_idx
        self.order.remove(player)
        self.sheets.pop(player.id, None)
        self.notes.pop(player.id, None)
        if not self.order:
            await self.finish()
            return
        if idx < self.turn_idx:
            self.turn_idx -= 1
        if was_current:
            self._cancel_timer()
            self.turn_idx -= 1           # _next_turn 이 한 칸 올린다
            await self._next_turn()
        else:
            await self.broadcast_state()

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self._cancel_roll()
        self._cancel_timer()
        ranking = sorted(
            ({**p.public(), "score": totals(self.sheets[p.id])["total"]} for p in self.order),
            key=lambda r: r["score"],
            reverse=True,
        )
        await self.broadcast_state()
        await self.room.broadcast({"type": "game_over", "ranking": ranking})
        await self.room.end_game(self)
