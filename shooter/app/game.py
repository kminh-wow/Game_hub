"""턴제 FPS 한 판: 돌아가며 움직이고, 둘러보고, 한 발 쏜다. 마지막까지 살아남은 사람이 이긴다."""
from __future__ import annotations

import asyncio
import logging
import math
import random
from typing import TYPE_CHECKING, Any

from common.multiplayer import room_event, spicy
from common.multiplayer.banter import Banter

from . import ai
from .banter import LINES
from .world import (
    MOVE_MAX, SIZE, STEP_MAX, WEAPONS, Soldier, corners, generate_map, shoot, step, throw,
)

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

SHOT_MS = 900            # 총을 쏜 뒤 다음 차례까지
BLAST_MS = 1100          # 수류탄이 터진 뒤 다음 차례까지
DUMMY_ID = "dummy"
AI_ID = "ai"
AI_THINK = 0.8           # AI 가 움직이기 전 기다리는 시간(초)
AI_AIM = 0.7             # AI 가 조준한 뒤 쏘기까지(초)
AI_STEP = 0.08           # AI 가 한 걸음 옮길 때마다 쉬는 시간(초)


class Game:
    def __init__(self, room: Room, rng: random.Random | None = None):
        self.room = room
        self.settings = room.settings.copy()
        self.rng = rng or random.Random()
        self.players: dict[str, Player] = {p.id: p for p in room.players}

        names = [(p.id, p.name) for p in room.players]
        self.ai_level = 0
        if len(names) == 1:
            self.ai_level = self.settings.solo_opponent
            if self.ai_level:                             # 혼자면 AI 와 대결
                names.append((AI_ID, f"AI · {ai.LEVEL_NAMES[self.ai_level]}"))
            else:                                         # 혼자면 연습용 과녁
                names.append((DUMMY_ID, "허수아비"))
        spots = corners(len(names))
        self.rng.shuffle(spots)
        self.boxes = generate_map(self.rng, spots)
        self.soldiers: dict[str, Soldier] = {}
        for i, ((pid, name), (x, z)) in enumerate(zip(names, spots)):
            s = Soldier(id=pid, name=name, color=i, x=x, z=z, dummy=pid == DUMMY_ID)
            s.yaw = math.atan2(-(SIZE / 2 - x), -(SIZE / 2 - z))   # 가운데를 보고 시작
            self.soldiers[pid] = s

        self.order: list[str] = [pid for pid, _ in names if pid != DUMMY_ID]   # 차례 순서
        self.banter = None                       # AI 대사 (AI 와 대결할 때만)
        if AI_ID in self.soldiers:
            self.banter = Banter(room, {"id": AI_ID, "name": self.soldiers[AI_ID].name}, LINES, self.rng,
                                 spicy=spicy.lines("shooter") if self.settings.ai_talk else None)
        self.human = room.players[0] if self.banter else None
        self.turn_idx = self.rng.randrange(len(self.order))
        self.turn = 0
        self.move_left = MOVE_MAX
        self.acting = False                      # 총알·수류탄 재생 중
        self.finished = False
        self.deaths: list[str] = []
        self.events: list[dict[str, Any]] = []
        self.deadline = 0.0
        self._timer: asyncio.Task | None = None
        self._after: asyncio.Task | None = None

    # ---- 조회 ----

    @property
    def current_id(self) -> str:
        return self.order[self.turn_idx]

    def state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return {
            "size": SIZE,
            "boxes": [b.public() for b in self.boxes],
            "soldiers": [s.public() for s in self.soldiers.values()],
            "weapons": {k: {key: w[key] for key in ("name", "stock", "spread", "speed", "radius", "fuse") if key in w}
                        for k, w in WEAPONS.items()},
            "current_id": None if self.finished else self.current_id,
            "turn": self.turn,
            "move_left": round(self.move_left, 2),
            "move_max": MOVE_MAX,
            "acting": self.acting,
            "time_left_ms": 0 if self.finished or self.acting else max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": self.settings.turn_time * 1000,
        }

    async def broadcast_state(self) -> None:
        events, self.events = self.events, []
        await self.room.broadcast({"type": "game", "game": self.state(), "events": events})

    # 관전자 입장 시 현재 상태
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(), "events": []}]

    def _alive(self) -> list[Soldier]:
        return [s for s in self.soldiers.values() if s.alive]

    # ---- 진행 ----

    async def start(self) -> None:
        if self.banter:
            self.banter.say("start", important=True, name=self.human.name)
        await self._start_turn()

    # 플레이어 채팅에 AI 대꾸
    async def hear_chat(self, player: Player, text: str) -> None:
        if self.banter and not self.finished and player is self.human:
            self.banter.hear(player, text)

    async def _start_turn(self) -> None:
        self._cancel_timer()
        self.turn += 1
        self.move_left = MOVE_MAX
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        turn = self._ai_turn() if self.current_id == AI_ID else self._turn_timer()
        self._timer = asyncio.create_task(turn)
        self.events.append({"kind": "turn", "player_id": self.current_id})
        await self.broadcast_state()

    async def _turn_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._timer = None
        room_event(self.room, f"시간 초과 {self.soldiers[self.current_id].name}")
        if self.banter and self.current_id != AI_ID:
            self.banter.say("player_timeout", chance=.7, name=self.human.name)
        self.events.append({"kind": "timeout", "player_id": self.current_id})
        await self._next_turn()

    # AI 차례 (자리 잡기 → 조준 → 발사)
    async def _ai_turn(self) -> None:
        me = self.soldiers[AI_ID]
        try:
            await asyncio.sleep(AI_THINK)
            try:
                plan = await asyncio.to_thread(ai.plan, self.boxes, list(self.soldiers.values()), me,
                                               self.ai_level, self.rng)
            except Exception:
                logging.getLogger(__name__).exception("AI 계획 실패")
                plan = {"to": (me.x, me.z), "weapon": "rifle", "yaw": me.yaw, "pitch": me.pitch}
            tx, tz = plan["to"]
            for _ in range(60):                               # 한 걸음씩 걸어가는 모습
                dx, dz = tx - me.x, tz - me.z
                dist = math.hypot(dx, dz)
                if dist < 0.05 or self.move_left <= 0:
                    break
                k = min(STEP_MAX * .8, dist, self.move_left) / dist
                me.yaw = math.atan2(-dx, -dz)
                moved = step(self.boxes, list(self.soldiers.values()), me, dx * k, dz * k)
                if not moved:
                    break
                self.move_left = max(0.0, self.move_left - moved)
                await self._send_soldier(me)
                await asyncio.sleep(AI_STEP)
            me.yaw, me.pitch = plan["yaw"], plan["pitch"]
            await self.room.broadcast({"type": "look", "id": me.id, "yaw": me.yaw, "pitch": me.pitch})
            await asyncio.sleep(AI_AIM)
        except asyncio.CancelledError:
            return
        self._timer = None
        weapon = plan["weapon"] if me.stock.get(plan["weapon"], 1) > 0 else "rifle"
        await self._fire(me, weapon)

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    async def _next_turn(self) -> None:
        if self._game_over():
            await self.finish()
            return
        for _ in range(len(self.order)):
            self.turn_idx = (self.turn_idx + 1) % len(self.order)
            if self.soldiers[self.current_id].alive:
                break
        await self._start_turn()

    def _game_over(self) -> bool:
        return len(self._alive()) <= 1 or not any(self.soldiers[pid].alive for pid in self.players)

    # ---- 입력 ----

    def _check_turn(self, player: Player) -> str | None:
        if self.finished or player.id != self.current_id:
            return "지금은 내 차례가 아니에요."
        if self.acting:
            return "사격이 끝날 때까지 기다려 주세요."
        return None

    @staticmethod
    def _angles(yaw: Any, pitch: Any) -> tuple[float, float] | None:
        try:
            yaw, pitch = float(yaw), float(pitch)
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(yaw) and math.isfinite(pitch)):
            return None
        return math.remainder(yaw, math.tau), max(-1.45, min(1.45, pitch))

    # 둘러보기 (다른 사람 화면에 시선 표시)
    async def look(self, player: Player, yaw: Any, pitch: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        angles = self._angles(yaw, pitch)
        if angles is None:
            return "잘못된 시선이에요."
        s = self.soldiers[player.id]
        s.yaw, s.pitch = angles
        await self.room.broadcast({"type": "look", "id": s.id, "yaw": s.yaw, "pitch": s.pitch})
        return None

    # 이동 (한 걸음씩)
    async def move(self, player: Player, dx: Any, dz: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        try:
            dx, dz = float(dx), float(dz)
        except (TypeError, ValueError):
            return "잘못된 이동이에요."
        length = math.hypot(dx, dz)
        if not math.isfinite(length) or length == 0:
            return None
        k = min(STEP_MAX, length, self.move_left) / length
        if k <= 0:
            return None
        s = self.soldiers[player.id]
        moved = step(self.boxes, list(self.soldiers.values()), s, dx * k, dz * k)
        self.move_left = max(0.0, self.move_left - moved)
        await self._send_soldier(s)
        return None

    async def _send_soldier(self, s: Soldier) -> None:
        await self.room.broadcast({"type": "soldier", "soldier": s.public(), "move_left": round(self.move_left, 2)})

    # 발사
    async def fire(self, player: Player, weapon: Any, yaw: Any, pitch: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        if weapon not in WEAPONS:
            return "그런 무기는 없어요."
        s = self.soldiers[player.id]
        if s.stock.get(weapon, 1) <= 0:
            return f"{WEAPONS[weapon]['name']}을 다 썼어요."
        angles = self._angles(yaw, pitch)
        if angles is None:
            return "잘못된 조준이에요."
        s.yaw, s.pitch = angles
        await self._fire(s, weapon)
        return None

    # 사격 계산과 재생 예약
    async def _fire(self, s: Soldier, weapon: str) -> None:
        if weapon in s.stock:
            s.stock[weapon] -= 1
        self._cancel_timer()
        everyone = list(self.soldiers.values())
        if weapon == "grenade":
            result = throw(self.boxes, everyone, s)
            duration = (len(result["frames"]) - 1) * 1000 / 30 + BLAST_MS
            event = {"kind": "shot", "weapon": weapon, "player_id": s.id, "frames": result["frames"],
                     "frame_ms": 1000 / 30, "at": result["at"], "radius": WEAPONS["grenade"]["radius"],
                     "results": result["results"], "landed_ms": round((len(result["frames"]) - 1) * 1000 / 30)}
        else:
            result = shoot(self.boxes, everyone, s, weapon, self.rng)
            duration = SHOT_MS
            event = {"kind": "shot", "weapon": weapon, "player_id": s.id, "from": result["from"],
                     "to": result["to"], "target": result["target"], "part": result["part"],
                     "results": result["results"], "landed_ms": 0}
        event["duration_ms"] = round(duration)
        event["yaw"], event["pitch"] = round(s.yaw, 4), round(s.pitch, 4)
        for r in result["results"]:
            if r["dead"] and r["id"] not in self.deaths:
                self.deaths.append(r["id"])
        self._log_shot(s, weapon, result)
        if self.banter:
            self._react(s, weapon, result, event["landed_ms"] / 1000)
        self.events.append(event)
        self.acting = True
        await self.broadcast_state()
        self._after = asyncio.create_task(self._after_shot(duration / 1000))

    def _log_shot(self, s: Soldier, weapon: str, result: dict[str, Any]) -> None:
        cells = [f"{self.soldiers[r['id']].name} -{r['damage']}({r['part']}) 남은 {r['hp']}{' 탈락' if r['dead'] else ''}"
                 for r in result["results"]]
        room_event(self.room, f"{WEAPONS[weapon]['name']} {s.name} → " + (", ".join(cells) if cells else "빗나감"))

    # 사격 결과에 대한 AI 반응
    def _react(self, shooter: Soldier, weapon: str, result: dict[str, Any], landed: float) -> None:
        hurt = {r["id"]: r for r in result["results"]}
        foe = self.human.id
        values = {"name": self.human.name, "hp": self.soldiers[foe].hp, "my_hp": self.soldiers[AI_ID].hp,
                  "weapon": WEAPONS[weapon]["name"]}
        hit = hurt.get(foe) or hurt.get(AI_ID)
        if hit:
            values["damage"] = hit["damage"]
        say = lambda kind, chance: self.banter.say(kind, chance=chance, after=landed, **values)
        if shooter.id == AI_ID:
            if foe in hurt:
                say("ai_head" if hurt[foe]["part"] == "head" else "ai_hit", .9)
            elif AI_ID in hurt:
                say("ai_self", .9)
            else:
                say("ai_miss", .5)
        elif AI_ID in hurt and self.soldiers[AI_ID].alive:
            if self.soldiers[AI_ID].hp < 30:
                say("got_hit_low", .9)
            elif hurt[AI_ID]["part"] == "head":
                say("got_head", .9)
            else:
                say("got_hit", .8)
        elif foe in hurt:
            say("player_self", .8)
        else:
            say("player_miss", .35)

    async def _after_shot(self, seconds: float) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        self._after = None
        self.acting = False
        if not self.finished:
            await self._next_turn()

    # ---- 종료 / 퇴장 ----

    async def remove_player(self, player: Player) -> None:
        if self.finished or player.id not in self.order:
            return
        was_current = player.id == self.current_id
        idx = self.order.index(player.id)
        self.players.pop(player.id, None)
        s = self.soldiers[player.id]
        if s.alive:
            s.alive = False
            s.hp = 0
            self.deaths.append(s.id)
        self.events.append({"kind": "left", "player_id": player.id})
        self.order.remove(player.id)
        if not self.players:
            await self.finish()
            return
        if idx < self.turn_idx:
            self.turn_idx -= 1
        elif was_current:
            self.turn_idx = (idx - 1) % len(self.order)   # _next_turn 이 한 칸 넘긴다
        if self.acting:
            await self.broadcast_state()
        elif self._game_over():
            await self.finish()
        elif was_current:
            self._cancel_timer()
            await self._next_turn()
        else:
            await self.broadcast_state()

    # 순위 (살아남은 사람, 늦게 탈락한 순)
    def ranking(self) -> list[dict[str, Any]]:
        alive = sorted(self._alive(), key=lambda s: -s.hp)
        dead = [self.soldiers[i] for i in reversed(self.deaths)]
        return [{"id": s.id, "name": s.name, "hp": s.hp, "alive": s.alive} for s in alive + dead]

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self.acting = False
        self._cancel_timer()
        if self._after:
            self._after.cancel()
            self._after = None
        ranking = self.ranking()
        winner = ranking[0] if ranking and ranking[0]["alive"] else None
        if self.banter and self.players:
            self.banter.say("ai_win" if winner and winner["id"] == AI_ID else "ai_lose", important=True,
                            name=self.human.name, turn=self.turn)
        await self.broadcast_state()
        await self.room.broadcast({"type": "game_over", "ranking": ranking, "winner": winner})
        await self.room.end_game(self)
