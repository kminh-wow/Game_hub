"""턴제 FPS AI: 보이는 자리를 찾아 움직이고, 보이면 쏘고, 안 보이면 수류탄을 던진다. 난이도만큼 조준이 흔들린다."""
from __future__ import annotations

import math
import random
from dataclasses import replace
from typing import Any

from .world import (
    EYE, MOVE_MAX, WEAPONS, Box, Soldier, blocked, direction, sees, throw,
)

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


# 갈 자리 고르기: 상대가 보이는 곳 중 가까운 곳, 없으면 상대에게 가장 가까워지는 곳
def choose_spot(boxes: list[Box], soldiers: list[Soldier], me: Soldier, target: Soldier,
                rng: random.Random) -> tuple[float, float]:
    best_seen, best_close = None, None
    for i in range(48):
        ang = i / 48 * math.tau
        for r in (0.0, 2.0, 4.0, MOVE_MAX - 0.3):
            x, z = me.x + math.cos(ang) * r, me.z + math.sin(ang) * r
            if r and (blocked(boxes, x, z) or not _path_clear(boxes, me.x, me.z, x, z)):
                continue
            probe = replace(me, x=x, z=z)
            dist = math.hypot(target.x - x, target.z - z)
            others = [s if s.id != me.id else probe for s in soldiers]
            if any(sees(boxes, others, probe, target, y=y) for y in (1.15, 0.85, 1.62)):
                score = r + abs(dist - 14) * 0.3                # 너무 붙지도 멀지도 않게
                if best_seen is None or score < best_seen[0]:
                    best_seen = (score, x, z)
            if best_close is None or dist < best_close[0]:
                best_close = (dist, x, z)
    pick = best_seen or best_close
    return pick[1], pick[2]


def _aim_at(me: Soldier, x: float, y: float, z: float) -> tuple[float, float]:
    dx, dy, dz = x - me.x, y - EYE, z - me.z
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
        miss = math.dist(result["at"], (target.x, 0.9, target.z))
        if miss < best[0]:
            best = (miss, yaw, math.radians(deg))
    return best


# 이번 차례 계획: 갈 자리, 무기, 조준 (yaw, pitch)
def plan(boxes: list[Box], soldiers: list[Soldier], me: Soldier, level: int,
         rng: random.Random) -> dict[str, Any]:
    target = _target(me, soldiers)
    if target is None:
        return {"to": (me.x, me.z), "weapon": "rifle", "yaw": me.yaw, "pitch": me.pitch}
    x, z = choose_spot(boxes, soldiers, me, target, rng)
    there = replace(me, x=x, z=z)
    others = [s if s.id != me.id else there for s in soldiers]
    err = math.radians(_AIM_ERROR[level])
    visible = [y for y in (1.15, 0.85, 1.62) if sees(boxes, others, there, target, y=y)]   # 보이는 부위
    if visible:
        dist = math.hypot(target.x - x, target.z - z)
        weapon = "sniper" if level >= 2 and dist > 16 and me.stock.get("sniper", 0) > 0 else "rifle"
        y = 1.62 if 1.62 in visible and rng.random() < _HEAD_SHOT[level] else visible[0]
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
        yaw, pitch = _aim_at(there, target.x, 0.9, target.z)
    return {"to": (x, z), "weapon": weapon, "yaw": yaw, "pitch": max(-1.4, min(1.4, pitch))}


__all__ = ["LEVEL_NAMES", "plan", "choose_spot", "direction", "WEAPONS"]
