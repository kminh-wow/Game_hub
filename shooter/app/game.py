"""턴제 FPS 한 판: 돌아가며 움직이고, 둘러보고, 쏜다. 마지막까지 살아남은 사람이 이긴다.
한 바퀴가 한 라운드. 라운드마다 보급 상자가 하나씩 늘고, ZONE_ROUND 부터는 안전 구역이 줄어 밖에 있으면 다친다."""
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
    CROUCH_COST, ITEMS, MOVE_MAX, PICK_R, SIZE, STEP_MAX, WEAPONS, ZONE_ROUND, Item, Soldier, corners, free_spot,
    generate_map, hurt, pick, shoot, step, throw, zone_damage, zone_radius,
)

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

SHOT_MS = 900            # 총을 쏜 뒤 다음 차례까지
RIFLE_GAP_MS = 350       # 소총 한 발 뒤 다음 발까지 (차례 안에서)
AI_BURST = 0.45          # AI 가 소총을 연달아 쏠 때 쉬는 시간(초)
BLAST_MS = 1100          # 수류탄이 터진 뒤 다음 차례까지
DUMMY_ID = "dummy"
AI_ID = "ai"
AI_THINK = 0.8           # AI 가 움직이기 전 기다리는 시간(초)
AI_AIM = 0.7             # AI 가 조준한 뒤 쏘기까지(초)
AI_STEP = 0.08           # AI 가 한 걸음 옮길 때마다 쉬는 시간(초)
ITEM_START = 4           # 처음 깔리는 보급 상자 수
ITEM_MAX = 6             # 맵에 동시에 있을 수 있는 보급 상자 수


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

        # 안전 구역 (가운데는 무작위, 처음엔 맵 전체를 덮음)
        self.zone_x, self.zone_z = self.rng.uniform(14, SIZE - 14), self.rng.uniform(14, SIZE - 14)
        self.zone_r0 = max(math.hypot(cx - self.zone_x, cz - self.zone_z) for cx in (0, SIZE) for cz in (0, SIZE)) + 1
        self.round = 1
        # 보급 상자
        self.items: list[Item] = []
        self._item_seq = 0
        for kind in ("ammo", "heal", "ammo", "heal")[:ITEM_START]:
            self._spawn_item(kind, spots)

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
        self.ending = False                      # 이번 사격이 끝나면 차례가 넘어감
        self.shots = 0                           # 이번 차례에 쏜 수
        self.turn_weapon: str | None = None      # 이번 차례에 쓴 무기 (한 차례에 한 종류)
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

    def _zone(self, rnd: int | None = None) -> tuple[float, float, float]:
        return self.zone_x, self.zone_z, zone_radius(self.zone_r0, self.round if rnd is None else rnd)

    def state(self) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return {
            "size": SIZE,
            "boxes": [b.public() for b in self.boxes],
            "items": [it.public() for it in self.items],
            "item_kinds": {k: v["name"] for k, v in ITEMS.items()},
            "round": self.round,
            "zone": {"x": round(self.zone_x, 2), "z": round(self.zone_z, 2), "r": round(self._zone()[2], 2),
                     "next_r": round(self._zone(self.round + 1)[2], 2), "start": ZONE_ROUND,
                     "next_damage": zone_damage(self.round + 1)},
            "soldiers": [s.public() for s in self.soldiers.values()],
            "weapons": {k: {key: w[key] for key in ("name", "stock", "per_turn", "spread", "speed", "radius", "fuse")
                            if key in w} for k, w in WEAPONS.items()},
            "shots": self.shots,
            "turn_weapon": self.turn_weapon,
            "current_id": None if self.finished else self.current_id,
            "turn": self.turn,
            "move_left": round(self.move_left, 2),
            "move_max": MOVE_MAX,
            "acting": self.acting,
            "time_left_ms": 0 if self.finished or self.ending else max(int((self.deadline - loop.time()) * 1000), 0),
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
        self.shots = 0
        self.turn_weapon = None
        self.acting = self.ending = False
        if self._after:                          # 시간이 다 돼서 넘어온 경우 남은 재생 예약 정리
            self._after.cancel()
            self._after = None
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
                                               self.ai_level, self.rng, self._zone(self.round + 1),
                                               self._useful_items(me))
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
                moved, picked = self._walk(me, dx * k, dz * k)
                if not moved:
                    break
                await self._send_soldier(me)
                if picked:
                    await self.broadcast_state()
                await asyncio.sleep(AI_STEP)
            me.yaw, me.pitch = plan["yaw"], plan["pitch"]
            await self.room.broadcast({"type": "look", "id": me.id, "yaw": me.yaw, "pitch": me.pitch})
            await asyncio.sleep(AI_AIM)
        except asyncio.CancelledError:
            return
        self._timer = None
        weapon = plan["weapon"] if me.stock.get(plan["weapon"], 0) > 0 else "rifle"
        if me.stock.get(weapon, 0) <= 0:
            await self._end_turn()
            return
        await self._fire(me, weapon)
        while weapon == "rifle" and not self.ending and not self.finished:   # 소총은 연달아
            await asyncio.sleep(AI_BURST)
            aim = ai.reaim(self.boxes, list(self.soldiers.values()), me, self.ai_level, self.rng)
            if aim is None or me.stock.get("rifle", 0) <= 0 or self.finished:
                await self._end_turn()
                return
            me.yaw, me.pitch = aim
            await self._fire(me, "rifle")

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    async def _next_turn(self) -> None:
        if self._game_over():
            await self.finish()
            return
        prev = self.turn_idx
        self._advance()
        if self.turn_idx <= prev:                     # 한 바퀴 돌았으면 새 라운드
            self._new_round()
            if self._game_over():
                await self.finish()
                return
            if not self.soldiers[self.current_id].alive:
                self._advance()
        await self._start_turn()

    def _advance(self) -> None:
        for _ in range(len(self.order)):
            self.turn_idx = (self.turn_idx + 1) % len(self.order)
            if self.soldiers[self.current_id].alive:
                break

    # 새 라운드: 구역 줄이고 밖에 있는 사람 피해, 보급 상자 하나 추가
    def _new_round(self) -> None:
        self.round += 1
        zx, zz, r = self._zone()
        results = []
        if self.round >= ZONE_ROUND:
            damage = zone_damage(self.round)
            for s in self._alive():
                if math.hypot(s.x - zx, s.z - zz) > r:
                    results.append(hurt(s, damage, "zone"))
                    if not s.alive:
                        self.deaths.append(s.id)
        if len(self.items) < ITEM_MAX:
            self._spawn_item(self.rng.choice(list(ITEMS)), [(s.x, s.z) for s in self._alive()], (zx, zz, r))
        self.events.append({"kind": "round", "round": self.round, "r": round(r, 2), "results": results})
        if results:
            room_event(self.room, f"{self.round}라운드 구역 밖 피해: " + ", ".join(
                f"{self.soldiers[x['id']].name} -{x['damage']} 남은 {x['hp']}" for x in results))

    def _spawn_item(self, kind: str, avoid: list[tuple[float, float]],
                    zone: tuple[float, float, float] | None = None) -> None:
        avoid = avoid + [(it.x, it.z) for it in self.items]
        spot = free_spot(self.rng, self.boxes, avoid, zone if zone and zone[2] > 3 else None)
        if spot:
            self._item_seq += 1
            self.items.append(Item(self._item_seq, kind, *spot))

    # AI 가 챙길 만한 상자 (체력이 깎였으면 구급, 탄이 줄었으면 탄약)
    def _useful_items(self, s: Soldier) -> list[Item]:
        low_ammo = any(s.stock.get(w, 0) < WEAPONS[w]["stock"] for w in ITEMS["ammo"]["gain"])
        return [it for it in self.items if (it.kind == "heal" and s.hp < 80) or (it.kind == "ammo" and low_ammo)]

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
        s = self.soldiers[player.id]
        k = min(STEP_MAX, length, self.move_left / (CROUCH_COST if s.crouch else 1)) / length
        if k <= 0:
            return None
        _, picked = self._walk(s, dx * k, dz * k)
        await self._send_soldier(s)
        if picked:
            await self.broadcast_state()
        return None

    # 한 걸음 (이동 거리 차감, 지나간 자리 보급 상자 줍기). (움직인 거리, 주웠는지)
    def _walk(self, s: Soldier, dx: float, dz: float) -> tuple[float, bool]:
        moved = step(self.boxes, list(self.soldiers.values()), s, dx, dz)
        self.move_left = max(0.0, self.move_left - moved * (CROUCH_COST if s.crouch else 1))
        picked = False
        for it in list(self.items):
            if math.hypot(it.x - s.x, it.z - s.z) > PICK_R:
                continue
            gains = pick(s, it)
            if not gains:
                continue                                  # 꽉 차 있으면 그대로 둠
            self.items.remove(it)
            self.events.append({"kind": "pickup", "player_id": s.id, "item": it.kind, "gains": gains})
            room_event(self.room, f"{s.name} {ITEMS[it.kind]['name']} 획득 {gains}")
            picked = True
        return moved, picked

    # 앉기 / 일어서기
    async def crouch(self, player: Player, on: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        s = self.soldiers[player.id]
        s.crouch = bool(on)
        await self._send_soldier(s)
        return None

    async def _send_soldier(self, s: Soldier) -> None:
        await self.room.broadcast({"type": "soldier", "soldier": s.public(), "move_left": round(self.move_left, 2)})

    # 차례 끝내기 (쏘지 않거나 소총을 덜 쏘고 넘길 때)
    async def end_turn(self, player: Player) -> str | None:
        if err := self._check_turn(player):
            return err
        await self._end_turn()
        return None

    async def _end_turn(self) -> None:
        if self.finished:
            return
        self._cancel_timer()
        self.events.append({"kind": "pass", "player_id": self.current_id})
        await self._next_turn()

    # 발사
    async def fire(self, player: Player, weapon: Any, yaw: Any, pitch: Any) -> str | None:
        if err := self._check_turn(player):
            return err
        if weapon not in WEAPONS:
            return "그런 무기는 없어요."
        s = self.soldiers[player.id]
        if s.stock.get(weapon, 0) <= 0:
            return f"{WEAPONS[weapon]['name']} 탄약이 없어요."
        if self.turn_weapon and self.turn_weapon != weapon:
            return f"이번 차례에는 {WEAPONS[self.turn_weapon]['name']}만 쓸 수 있어요."
        angles = self._angles(yaw, pitch)
        if angles is None:
            return "잘못된 조준이에요."
        s.yaw, s.pitch = angles
        await self._fire(s, weapon)
        return None

    # 사격 계산과 재생 예약
    async def _fire(self, s: Soldier, weapon: str) -> None:
        s.stock[weapon] = max(0, s.stock.get(weapon, 0) - 1)
        self.shots += 1
        self.turn_weapon = weapon
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
        # 한 차례에 쏠 수 있는 만큼 다 쐈거나, 탄이 떨어졌거나, 승부가 났으면 차례 끝
        self.ending = (self.shots >= WEAPONS[weapon]["per_turn"] or s.stock.get(weapon, 0) <= 0
                       or self._game_over())
        self.acting = True
        if self.ending:
            self._cancel_timer()
        else:
            duration = RIFLE_GAP_MS
        await self.broadcast_state()
        self._after = asyncio.create_task(self._after_shot(duration / 1000, self.ending))

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

    async def _after_shot(self, seconds: float, ending: bool) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        self._after = None
        self.acting = False
        if self.finished:
            return
        if ending:
            self.ending = False
            await self._next_turn()
        else:
            await self.broadcast_state()                 # 같은 차례에 다음 발

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
