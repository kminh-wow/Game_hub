"""포트리스 한 판: 돌아가며 움직이고 조준해서 한 발씩 쏜다. 마지막까지 남은 탱크가 이긴다."""
from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING, Any

from .world import (
    HEIGHT, MAX_FUEL, MAX_WIND, SEA, WEAPONS, WIDTH, Tank, explode, fly, generate_terrain, ground,
    move_tank, spawn_points,
)

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

EXPLOSION_MS = 900       # 터진 뒤 다음 차례까지 기다리는 시간
DUMMY_ID = "dummy"


class Game:
    def __init__(self, room: Room, rng: random.Random | None = None):
        self.room = room
        self.settings = room.settings.copy()
        self.rng = rng or random.Random()
        self.order: list[Player] = list(room.players)
        self.terrain = generate_terrain(self.rng)

        names = [(p.id, p.name) for p in self.order]
        if len(names) == 1:
            names.append((DUMMY_ID, "허수아비"))       # 혼자면 연습용 과녁
        xs = spawn_points(self.rng, self.terrain, len(names))
        self.tanks: dict[str, Tank] = {}
        for i, ((pid, name), x) in enumerate(zip(names, xs)):
            tank = Tank(id=pid, name=name, color=i, x=x, dummy=pid == DUMMY_ID)
            tank.y = ground(self.terrain, x)
            tank.facing = 1 if x < WIDTH / 2 else -1
            self.tanks[pid] = tank

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
    def current(self) -> Player:
        return self.order[self.turn_idx]

    def state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return {
            "width": WIDTH, "height": HEIGHT, "sea": SEA,
            "terrain": self.terrain,
            "tanks": [t.public() for t in self.tanks.values()],
            "weapons": {k: {"name": w["name"], "radius": w["radius"]} for k, w in WEAPONS.items()},
            "current_id": None if self.finished else self.current.id,
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
        await self._start_turn()

    # 차례 시작 (바람·연료 새로)
    async def _start_turn(self) -> None:
        self._cancel_timer()
        self.turn += 1
        self.wind = self.rng.randint(-MAX_WIND, MAX_WIND)
        self.fuel = MAX_FUEL
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        self._timer = asyncio.create_task(self._turn_timer())
        self.events.append({"kind": "turn", "player_id": self.current.id, "wind": self.wind})
        await self.broadcast_state()

    async def _turn_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._timer = None
        self.events.append({"kind": "timeout", "player_id": self.current.id})
        await self._next_turn()

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
            if self.tanks[self.current.id].alive:
                break
        await self._start_turn()

    def _game_over(self) -> bool:
        alive = self._alive_players()
        return len(alive) <= 1 or not any(self.tanks[p.id].alive for p in self.order)

    # ---- 입력 ----

    def _check_turn(self, player: Player) -> str | None:
        if self.finished or player is not self.current:
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
        if weapon in tank.stock:
            if tank.stock[weapon] <= 0:
                return f"{WEAPONS[weapon]['name']}을 다 썼어요."
            tank.stock[weapon] -= 1
        try:
            power = max(0.0, min(100.0, float(power)))
        except (TypeError, ValueError):
            return "잘못된 파워예요."

        self._cancel_timer()
        tanks = list(self.tanks.values())
        shot = fly(self.terrain, tanks, tank, power, self.wind)
        results: list[dict[str, Any]] = []
        if shot["hit"]:
            results = explode(self.terrain, tanks, *shot["hit"], weapon, shot["direct"])
        for r in results:
            if r["cause"] and r["id"] not in self.deaths:
                self.deaths.append(r["id"])
        frame_ms = 1000 / 30
        duration = (len(shot["frames"]) - 1) * frame_ms + (EXPLOSION_MS if shot["hit"] else 300)
        self.events.append({
            "kind": "shot",
            "player_id": player.id,
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
        self.flying = True
        await self.broadcast_state()
        self._after = asyncio.create_task(self._after_shot(duration / 1000))
        return None

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
        if self.finished or player not in self.order:
            return
        was_current = player is self.current
        idx = self.order.index(player)
        tank = self.tanks[player.id]
        if tank.alive:
            tank.alive = False
            tank.hp = 0
            self.deaths.append(tank.id)
        self.events.append({"kind": "left", "player_id": player.id})
        self.order.remove(player)
        if not self.order:
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
        await self.broadcast_state()
        await self.room.broadcast({"type": "game_over", "ranking": ranking, "winner": winner})
        await self.room.end_game(self)
