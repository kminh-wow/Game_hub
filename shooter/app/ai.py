"""턴제 FPS AI: 보이는 자리를 찾아 움직이고, 보이면 쏘고, 안 보이면 수류탄을 던진다. 난이도만큼 조준이 흔들린다.
안전 구역 밖은 피하고, 지나는 길의 보급 상자는 챙긴다."""
from __future__ import annotations

import math
import random
from dataclasses import replace
from typing import Any

from .world import (
    MOVE_MAX, PICK_R, WEAPONS, Box, Item, Soldier, blocked, direction, sees, throw,
)

Zone = tuple[float, float, float]   # 다음 라운드 안전 구역 (가운데 x, z, 반지름)

# 난이도 (1 하, 2 중, 3 상)
LEVEL_NAMES = {1: "하", 2: "중", 3: "상"}
_AIM_ERROR = {1: 2.5, 2: 1.0, 3: 0.35}    # 조준 흔들림(도)
_HEAD_SHOT = {1: 0.0, 2: 0.1, 3: 0.25}    # 머리를 노릴 확률


def _target(me: Soldier, soldiers: list[Soldier]) -> Soldier | None:
    foes = [s for s in soldiers if s.alive and s.id != me.id]
    return min(foes, key=lambda s: math.hypot(s.x - me.x, s.z - me.z)) if foes else None


def _path_clear(boxes: list[Box], x0: float, z0: float, x1: float, z1: float) -> bool:
    dist = math.hypot(x1 - x0, z1 - z0)
    steps = max(1, int(dist / 0.3))
    return all(not blocked(boxes, x0 + (x1 - x0) * i / steps, z0 + (z1 - z0) * i / steps) for i in range(1, steps + 1))


# 갈 만한 자리 후보 (둘레 샘플 + 닿는 보급 상자)
def _candidates(boxes: list[Box], me: Soldier, items: list[Item]) -> list[tuple[float, float]]:
    out = [(me.x, me.z)]
    for i in range(48):
        ang = i / 48 * math.tau
        for r in (2.0, 4.0, MOVE_MAX - 0.3):
            out.append((me.x + math.cos(ang) * r, me.z + math.sin(ang) * r))
    out += [(it.x, it.z) for it in items if math.hypot(it.x - me.x, it.z - me.z) <= MOVE_MAX - 0.3]
    return [(x, z) for x, z in out
            if (x, z) == (me.x, me.z) or (not blocked(boxes, x, z) and _path_clear(boxes, me.x, me.z, x, z))]


# 갈 자리 고르기: 상대가 보이는 곳 중 가까운 곳, 없으면 상대에게 가장 가까워지는 곳 (구역 밖은 벌점, 상자는 덤)
def choose_spot(boxes: list[Box], soldiers: list[Soldier], me: Soldier, target: Soldier,
                rng: random.Random, zone: Zone | None = None, items: list[Item] = ()) -> tuple[float, float]:
    best_seen, best_close = None, None
    for x, z in _candidates(boxes, me, list(items)):
        r = math.hypot(x - me.x, z - me.z)
        extra = 0.0
        if zone:
            extra += max(0.0, math.hypot(x - zone[0], z - zone[1]) - zone[2]) * 6
        if any(math.hypot(it.x - x, it.z - z) < PICK_R for it in items):
            extra -= 4
        probe = replace(me, x=x, z=z)
        dist = math.hypot(target.x - x, target.z - z)
        others = [s if s.id != me.id else probe for s in soldiers]
        if any(sees(boxes, others, probe, target, y=y) for y in target.aim_points()):
            score = r + abs(dist - 14) * 0.3 + extra            # 너무 붙지도 멀지도 않게
            if best_seen is None or score < best_seen[0]:
                best_seen = (score, x, z)
        if best_close is None or dist + extra < best_close[0]:
            best_close = (dist + extra, x, z)
    pick = best_seen or best_close
    return pick[1], pick[2]


def _aim_at(me: Soldier, x: float, y: float, z: float) -> tuple[float, float]:
    dx, dy, dz = x - me.x, y - me.eye[1], z - me.z
    yaw = math.atan2(-dx, -dz)
    pitch = math.atan2(dy, math.hypot(dx, dz))
    return yaw, pitch


# 수류탄 각도 찾기 (상대 근처에 떨어지는 위로 던지는 각)
def _grenade_aim(boxes: list[Box], soldiers: list[Soldier], me: Soldier, target: Soldier) -> tuple[float, float, float]:
    yaw, _ = _aim_at(me, target.x, 1.0, target.z)
    best = (float("inf"), yaw, 0.6)
    for deg in range(5, 76, 5):
        probe = replace(me, yaw=yaw, pitch=math.radians(deg), hp=me.hp)
        dummies = [replace(s, hp=s.hp) for s in soldiers if s.id != me.id] + [probe]
        result = throw(boxes, dummies, probe)
        miss = math.dist(result["at"], (target.x, target.body_top * 0.65, target.z))
        if miss < best[0]:
            best = (miss, yaw, math.radians(deg))
    return best


# 연발용 다시 조준 (지금 자리에서 상대가 보이면 흔들림 섞은 시선, 안 보이면 None)
def reaim(boxes: list[Box], soldiers: list[Soldier], me: Soldier, level: int,
          rng: random.Random) -> tuple[float, float] | None:
    target = _target(me, soldiers)
    if target is None:
        return None
    visible = [y for y in target.aim_points() if sees(boxes, soldiers, me, target, y=y)]
    if not visible:
        return None
    err = math.radians(_AIM_ERROR[level])
    yaw, pitch = _aim_at(me, target.x, visible[0], target.z)
    return yaw + rng.gauss(0, err), max(-1.4, min(1.4, pitch + rng.gauss(0, err * .6)))


# 이번 차례 계획: 갈 자리, 무기, 조준 (yaw, pitch)
def plan(boxes: list[Box], soldiers: list[Soldier], me: Soldier, level: int,
         rng: random.Random, zone: Zone | None = None, items: list[Item] = ()) -> dict[str, Any]:
    target = _target(me, soldiers)
    if target is None:
        return {"to": (me.x, me.z), "weapon": "rifle", "yaw": me.yaw, "pitch": me.pitch}
    x, z = choose_spot(boxes, soldiers, me, target, rng, zone, items)
    there = replace(me, x=x, z=z)
    others = [s if s.id != me.id else there for s in soldiers]
    err = math.radians(_AIM_ERROR[level])
    head = target.head_y
    visible = [y for y in target.aim_points() if sees(boxes, others, there, target, y=y)]   # 보이는 부위
    if visible:
        dist = math.hypot(target.x - x, target.z - z)
        weapon = "sniper" if level >= 2 and dist > 16 and me.stock.get("sniper", 0) > 0 else "rifle"
        y = head if head in visible and rng.random() < _HEAD_SHOT[level] else visible[0]
        yaw, pitch = _aim_at(there, target.x, y, target.z)
        yaw += rng.gauss(0, err)
        pitch += rng.gauss(0, err * .6)
    elif me.stock.get("grenade", 0) > 0 and math.hypot(target.x - x, target.z - z) < 22:
        weapon = "grenade"
        miss, yaw, pitch = _grenade_aim(boxes, others, there, target)
        yaw += rng.gauss(0, err * 1.5)
        pitch += rng.gauss(0, err)
    else:
        weapon = "rifle"
        yaw, pitch = _aim_at(there, target.x, target.body_top * 0.65, target.z)
    return {"to": (x, z), "weapon": weapon, "yaw": yaw, "pitch": max(-1.4, min(1.4, pitch))}


__all__ = ["LEVEL_NAMES", "plan", "choose_spot", "direction", "WEAPONS"]
