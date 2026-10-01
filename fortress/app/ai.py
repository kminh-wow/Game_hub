"""포트리스 AI: 포탄 궤적을 미리 계산해 가장 가까운 상대를 노리고, 난이도만큼 오차를 섞는다."""
from __future__ import annotations

import math
import random
from dataclasses import replace

from .world import TANK_CENTER, WEAPONS, Tank, Terrain, fly

# 난이도 (1 하, 2 중, 3 상)
LEVEL_NAMES = {1: "하", 2: "중", 3: "상"}
_NOISE = {1: (6.0, 9.0), 2: (3.0, 4.5), 3: (1.0, 1.5)}   # 각도·파워에 섞는 최대 오차


def _target(me: Tank, tanks: list[Tank]) -> Tank | None:
    foes = [t for t in tanks if t.alive and t.id != me.id]
    return min(foes, key=lambda t: abs(t.x - me.x)) if foes else None


# 한 발의 점수 (상대에 가까울수록 낮고, 내 근처에 떨어지면 크게 감점)
def _miss(terrain: Terrain, tanks: list[Tank], me: Tank, target: Tank, angle: float, power: float,
          wind: int) -> float:
    shooter = replace(me, angle=angle)
    shot = fly(terrain, [shooter if t.id == me.id else t for t in tanks], shooter, power, wind)
    if shot["direct"] is not None:
        return 0.0 if shot["direct"].id == target.id else 1e6
    if not shot["hit"]:
        return 1e6
    x, y = shot["hit"]
    near_self = math.hypot(x - me.x, y - me.y - TANK_CENTER) < WEAPONS["normal"]["radius"] + 15
    return math.hypot(x - target.x, y - target.y - TANK_CENTER) + (1e5 if near_self else 0)


# 조준 계획 (각도, 방향, 파워, 포탄)
def plan(terrain: Terrain, tanks: list[Tank], me: Tank, wind: int, level: int,
         rng: random.Random) -> tuple[float, int, float, str]:
    target = _target(me, tanks)
    if target is None:
        return me.angle, me.facing, 50.0, "normal"
    facing = 1 if target.x >= me.x else -1
    me = replace(me, facing=facing)

    best = (float("inf"), 45.0, 50.0)
    for angle in range(10, 90, 5):
        for power in range(20, 101, 4):
            miss = _miss(terrain, tanks, me, target, angle, power, wind)
            if miss < best[0]:
                best = (miss, angle, power)
    _, a0, p0 = best
    for da in (-2.5, -1.25, 0, 1.25, 2.5):
        for dp in (-3, -1.5, 0, 1.5, 3):
            angle, power = min(90, max(0, a0 + da)), min(100, max(0, p0 + dp))
            miss = _miss(terrain, tanks, me, target, angle, power, wind)
            if miss < best[0]:
                best = (miss, angle, power)

    miss, angle, power = best
    da, dp = _NOISE[level]
    angle = min(90.0, max(0.0, angle + rng.uniform(-da, da)))
    power = min(100.0, max(0.0, power + rng.uniform(-dp, dp)))
    weapon = "big" if level >= 2 and me.stock.get("big", 0) > 0 and miss < 25 else "normal"
    return round(angle, 1), facing, round(power, 1), weapon
