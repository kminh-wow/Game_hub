"""포트리스 한 판: 돌아가며 움직이고 조준해서 한 발씩 쏜다. 마지막까지 남은 탱크가 이긴다."""
from __future__ import annotations

import asyncio
import logging
import random
from typing import TYPE_CHECKING, Any

from common.multiplayer import room_event
from common.multiplayer.banter import Banter

from . import ai
from .banter import LINES, SITUATIONS
from .world import (
    HEIGHT, MAX_FUEL, MAX_WIND, SEA, WEAPONS, WIDTH, Tank, explode, fly, generate_terrain, pack,
    move_tank, spawn_points, surface, to_columns,
)

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

EXPLOSION_MS = 900       # 터진 뒤 다음 차례까지 기다리는 시간
DUMMY_ID = "dummy"
AI_ID = "ai"
AI_THINK = 1.0           # AI 가 조준하기 전 기다리는 시간(초)
AI_AIM = .7              # AI 가 포신을 돌린 뒤 쏘기까지 기다리는 시간(초)


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
        heights = generate_terrain(self.rng)
        xs = spawn_points(self.rng, heights, len(names))
        self.terrain = to_columns(heights)
        self.tanks: dict[str, Tank] = {}
        for i, ((pid, name), x) in enumerate(zip(names, xs)):
            tank = Tank(id=pid, name=name, color=i, x=x, dummy=pid == DUMMY_ID)
            tank.y = surface(self.terrain, x)
            tank.facing = 1 if x < WIDTH / 2 else -1
            self.tanks[pid] = tank

        self.order: list[str] = [pid for pid, _ in names if pid != DUMMY_ID]   # 차례 순서 (탱크 id)
        self.banter = None                       # AI 대사 (AI 와 대결할 때만)
        if AI_ID in self.tanks:
            self.banter = Banter(room, {"id": AI_ID, "name": self.tanks[AI_ID].name}, LINES, self.rng,
                                 game="포트리스", situations=SITUATIONS)
        self.human = room.players[0] if self.banter else None
        self.turn_idx = self.rng.randrange(len(self.order))
        self.turn = 0
        self.wind = 0
        self.fuel = MAX_FUEL
        self.flying = False
        self.finished = False
        self.deaths: list[str] = []          # 탈락 순서
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
            "width": WIDTH, "height": HEIGHT, "sea": SEA,
            "terrain": pack(self.terrain),
            "tanks": [t.public() for t in self.tanks.values()],
            "weapons": {k: {"name": w["name"], "radius": w["radius"]} for k, w in WEAPONS.items()},
            "current_id": None if self.finished else self.current_id,
            "turn": self.turn,
            "wind": self.wind,
            "fuel": round(self.fuel),
            "fuel_max": MAX_FUEL,
            "flying": self.flying,
            "time_left_ms": 0 if self.finished or self.flying else max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": self.settings.turn_time * 1000,
        }

    async def broadcast_state(self) -> None:
        events, self.events = self.events, []
        await self.room.broadcast({"type": "game", "game": self.state(), "events": events})

    # 관전자 입장 시 현재 상태
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(), "events": []}]

    def _alive_players(self) -> list[Tank]:
        return [t for t in self.tanks.values() if t.alive]

    # ---- 진행 ----

    async def start(self) -> None:
        if self.banter:
            self.banter.say("start", important=True, name=self.human.name)
        await self._start_turn()

    # 플레이어 채팅에 AI 대꾸
    async def hear_chat(self, player: Player, text: str) -> None:
        if self.banter and not self.finished and player is self.human:
            self.banter.hear(player, text)

    # 발사 결과에 대한 AI 반응
    def _react(self, tank: Tank, shot: dict[str, Any], results: list[dict[str, Any]], landed: float) -> None:
        hurt = {r["id"]: r for r in results if r["damage"] > 0}
        say = lambda kind, chance: self.banter.say(kind, chance=chance, after=landed)
        foe = self.human.id
        if tank.id == AI_ID:
            if foe in hurt:
                say("ai_direct" if shot["direct"] and shot["direct"].id == foe else "ai_hit", .9)
            elif AI_ID in hurt:
                say("ai_self", .9)
            else:
                say("ai_miss", .5)
        elif AI_ID in hurt and self.tanks[AI_ID].alive:
            if self.tanks[AI_ID].hp < 30:
                say("got_hit_low", .9)
            elif shot["direct"] and shot["direct"].id == AI_ID:
                say("got_direct", .9)
            else:
                say("got_hit", .8)
        elif foe in hurt:
            say("player_self", .8)
        else:
            say("player_miss", .35)

    # 차례 시작 (바람·연료 새로)
    async def _start_turn(self) -> None:
        self._cancel_timer()
        self.turn += 1
        self.wind = self.rng.randint(-MAX_WIND, MAX_WIND)
        self.fuel = MAX_FUEL
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        turn = self._ai_turn() if self.current_id == AI_ID else self._turn_timer()
        self._timer = asyncio.create_task(turn)
        self.events.append({"kind": "turn", "player_id": self.current_id, "wind": self.wind})
        await self.broadcast_state()

    async def _turn_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._timer = None
        room_event(self.room, f"시간 초과 {self.tanks[self.current_id].name}")
        if self.banter and self.current_id != AI_ID:
            self.banter.say("player_timeout", chance=.7)
        self.events.append({"kind": "timeout", "player_id": self.current_id})
        await self._next_turn()

    # AI 차례 (궤적 계산 → 포신 돌리기 → 발사)
    async def _ai_turn(self) -> None:
        tank = self.tanks[AI_ID]
        try:
            await asyncio.sleep(AI_THINK)
            try:
                angle, facing, power, weapon = await asyncio.to_thread(
                    ai.plan, self.terrain, list(self.tanks.values()), tank, self.wind, self.ai_level, self.rng)
            except Exception:
                logging.getLogger(__name__).exception("AI 조준 실패")
                angle, facing, power, weapon = tank.angle, tank.facing, 50.0, "normal"
            tank.angle, tank.facing = angle, facing
            await self.room.broadcast({"type": "aim", "id": tank.id, "angle": angle, "facing": facing})
            await asyncio.sleep(AI_AIM)
        except asyncio.CancelledError:
            return
        self._timer = None
        await self._fire(tank, power, weapon)

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    # 다음 차례 (탈락한 탱크는 건너뜀)
    async def _next_turn(self) -> None:
        if self._game_over():
            await self.finish()
            return
        for _ in range(len(self.order)):
            self.turn_idx = (self.turn_idx + 1) % len(self.order)
            if self.tanks[self.current_id].alive:
                break
        await self._start_turn()

    def _game_over(self) -> bool:
        alive = self._alive_players()
        return len(alive) <= 1 or not any(self.tanks[pid].alive for pid in self.players)

    # ---- 입력 ----

    def _check_turn(self, player: Player) -> str | None:
        if self.finished or player.id != self.current_id:
            return "지금은 내 차례가 아니에요."
        if self.flying:
            return "포탄이 떨어질 때까지 기다려 주세요."
        return None

    # 조준 (각도·방향)
    async def aim(self, player: Player, angle: Any, facing: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        tank = self.tanks[player.id]
        try:
            tank.angle = max(0.0, min(90.0, float(angle)))
        except (TypeError, ValueError):
            return "잘못된 각도예요."
        if facing in (1, -1):
            tank.facing = facing
        await self.room.broadcast({"type": "aim", "id": tank.id, "angle": tank.angle, "facing": tank.facing})
        return None

    # 이동
    async def move(self, player: Player, direction: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        if direction not in (1, -1):
            return "잘못된 방향이에요."
        tank = self.tanks[player.id]
        tank.facing = direction
        if self.fuel > 0:
            self.fuel = max(0.0, self.fuel - move_tank(self.terrain, tank, direction))
        await self.room.broadcast({"type": "tank", "tank": tank.public(), "fuel": round(self.fuel)})
        return None

    # 발사
    async def fire(self, player: Player, power: Any, weapon: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        tank = self.tanks[player.id]
        if weapon not in WEAPONS:
            return "그런 포탄은 없어요."
        if tank.stock.get(weapon, 1) <= 0:
            return f"{WEAPONS[weapon]['name']}을 다 썼어요."
        try:
            power = max(0.0, min(100.0, float(power)))
        except (TypeError, ValueError):
            return "잘못된 파워예요."
        await self._fire(tank, power, weapon)
        return None

    # 포탄 계산과 재생 예약
    async def _fire(self, tank: Tank, power: float, weapon: str) -> None:
        if weapon in tank.stock:
            tank.stock[weapon] -= 1
        self._cancel_timer()
        tanks = list(self.tanks.values())
        shot = fly(self.terrain, tanks, tank, power, self.wind)
        results: list[dict[str, Any]] = []
        if shot["hit"]:
            results = explode(self.terrain, tanks, *shot["hit"], weapon, shot["direct"])
        for r in results:
            if r["cause"] and r["id"] not in self.deaths:
                self.deaths.append(r["id"])
        self._log_shot(tank, power, weapon, shot, results)
        frame_ms = 1000 / 30
        duration = (len(shot["frames"]) - 1) * frame_ms + (EXPLOSION_MS if shot["hit"] else 300)
        self.events.append({
            "kind": "shot",
            "player_id": tank.id,
            "weapon": weapon,
            "power": round(power, 1),
            "frames": shot["frames"],
            "frame_ms": frame_ms,
            "hit": {"x": round(shot["hit"][0], 1), "y": round(shot["hit"][1], 1),
                    "radius": WEAPONS[weapon]["radius"]} if shot["hit"] else None,
            "direct": shot["direct"].id if shot["direct"] else None,
            "results": results,
            "duration_ms": round(duration),
        })
        if self.banter:
            self._react(tank, shot, results, (len(shot["frames"]) - 1) / 30)
        self.flying = True
        await self.broadcast_state()
        self._after = asyncio.create_task(self._after_shot(duration / 1000))

    # 발사 기록
    def _log_shot(self, tank: Tank, power: float, weapon: str, shot: dict[str, Any], results: list[dict[str, Any]]) -> None:
        head = (f"발사 {tank.name} 각도 {tank.angle:.0f} 파워 {power:.0f} {WEAPONS[weapon]['name']} 바람 {self.wind:+d}")
        if not shot["hit"]:
            body = "맵 밖으로 빗나감"
        else:
            cells = []
            for r in results:
                name = self.tanks[r["id"]].name
                cause = {"sea": " 바다에 빠져 탈락", "hit": " 탈락"}.get(r["cause"], "")
                cells.append(f"{name} -{r['damage']} (남은 {r['hp']}){cause}")
            target = f"직격 {shot['direct'].name}" if shot["direct"] else f"착탄 x={shot['hit'][0]:.0f}"
            body = f"{target} · " + (", ".join(cells) if cells else "피해 없음")
        room_event(self.room, f"{head} → {body}")

    async def _after_shot(self, seconds: float) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        self._after = None
        self.flying = False
        if not self.finished:
            await self._next_turn()

    # ---- 종료 / 퇴장 ----

    async def remove_player(self, player: Player) -> None:
        if self.finished or player.id not in self.order:
            return
        was_current = player.id == self.current_id
        idx = self.order.index(player.id)
        self.players.pop(player.id, None)
        tank = self.tanks[player.id]
        if tank.alive:
            tank.alive = False
            tank.hp = 0
            self.deaths.append(tank.id)
        self.events.append({"kind": "left", "player_id": player.id})
        self.order.remove(player.id)
        if not self.players:
            await self.finish()
            return
        if idx < self.turn_idx:
            self.turn_idx -= 1
        elif was_current:
            self.turn_idx = (idx - 1) % len(self.order)   # _next_turn 이 한 칸 넘긴다
        if self.flying:
            await self.broadcast_state()                # 날아가는 중이면 끝난 뒤 다음 차례로
        elif self._game_over():
            await self.finish()
        elif was_current:
            self._cancel_timer()
            await self._next_turn()
        else:
            await self.broadcast_state()

    # 순위 (살아남은 탱크, 늦게 탈락한 순)
    def ranking(self) -> list[dict[str, Any]]:
        alive = sorted(self._alive_players(), key=lambda t: -t.hp)
        dead = [self.tanks[i] for i in reversed(self.deaths)]
        return [{"id": t.id, "name": t.name, "hp": t.hp, "alive": t.alive} for t in alive + dead]

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self.flying = False
        self._cancel_timer()
        if self._after:
            self._after.cancel()
            self._after = None
        ranking = self.ranking()
        winner = ranking[0] if ranking and ranking[0]["alive"] else None
        if self.banter and self.players:
            self.banter.say("ai_win" if winner and winner["id"] == AI_ID else "ai_lose", important=True)
        await self.broadcast_state()
        await self.room.broadcast({"type": "game_over", "ranking": ranking, "winner": winner})
        await self.room.end_game(self)
