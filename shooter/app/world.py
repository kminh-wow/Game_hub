"""턴제 FPS 월드: 아레나와 엄폐물, 이동 충돌, 총알(직선)과 수류탄(포물선) 판정.

좌표는 미터 단위, 바닥이 y=0 이고 위가 +y. 아레나는 x·z 모두 0~SIZE.
엄폐물은 바닥에서 솟은 상자(x0, z0, x1, z1, 높이)다. 사람은 원기둥 몸 + 공 머리.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

SIZE = 40.0              # 아레나 한 변
WALL = 4.0               # 바깥 벽 높이
EYE = 1.6                # 눈 높이
RADIUS = 0.4             # 몸 반지름
BODY_TOP = 1.4           # 몸통 꼭대기 (그 위는 머리)
HEAD_Y = 1.62            # 머리 중심 높이
HEAD_R = 0.24            # 머리 반지름
MOVE_MAX = 7.0           # 한 차례에 움직일 수 있는 거리
STEP_MAX = 0.6           # 이동 메시지 한 번의 최대 거리
MAX_HP = 100
GRAVITY = 9.8
MAX_RANGE = 90.0

# 무기: 퍼짐(도), 몸·머리 피해, 판마다 개수 (None 무제한)
WEAPONS: dict[str, dict[str, Any]] = {
    "rifle": {"name": "소총", "spread": 1.6, "body": 25, "head": 50, "stock": None},
    "sniper": {"name": "저격총", "spread": 0.12, "body": 70, "head": 100, "stock": 2},
    "grenade": {"name": "수류탄", "speed": 15.0, "radius": 4.5, "damage": 70, "fuse": 4.0, "stock": 2},
}
RIFLE_FALLOFF = (15.0, 35.0, 0.5)   # 이 거리부터 줄어서, 이 거리에서 이 배율


@dataclass
class Box:
    x0: float
    z0: float
    x1: float
    z1: float
    h: float

    def public(self) -> list[float]:
        return [round(v, 2) for v in (self.x0, self.z0, self.x1, self.z1, self.h)]


@dataclass
class Soldier:
    id: str
    name: str
    color: int
    x: float
    z: float
    yaw: float = 0.0          # 라디안, 0 이면 -z 쪽을 본다 (three.js 카메라와 같음)
    pitch: float = 0.0
    hp: int = MAX_HP
    alive: bool = True
    dummy: bool = False
    stock: dict[str, int] = field(default_factory=lambda: {k: w["stock"] for k, w in WEAPONS.items() if w["stock"]})

    @property
    def eye(self) -> tuple[float, float, float]:
        return (self.x, EYE, self.z)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "color": self.color,
            "x": round(self.x, 3), "z": round(self.z, 3), "yaw": round(self.yaw, 4), "pitch": round(self.pitch, 4),
            "hp": self.hp, "alive": self.alive, "dummy": self.dummy, "stock": self.stock,
        }


# ---- 맵 ----

_SHAPES = [   # (가로, 세로, 높이) — 상자, 낮은 엄폐물, 긴 벽, 기둥
    (1.4, 1.4, 1.2), (1.2, 1.2, 1.2), (3.0, 0.8, 1.0), (0.8, 3.0, 1.0),
    (5.0, 0.6, 2.8), (0.6, 5.0, 2.8), (1.0, 1.0, 3.5), (2.2, 2.2, 1.6),
]


def corners(count: int) -> list[tuple[float, float]]:
    spots = [(4.0, 4.0), (SIZE - 4, SIZE - 4), (4.0, SIZE - 4), (SIZE - 4, 4.0)]
    return spots[:count]


# 아레나 만들기 (바깥 벽 + 무작위 엄폐물)
def generate_map(rng: random.Random, spawns: list[tuple[float, float]], count: int = 16) -> list[Box]:
    boxes = [Box(-1, -1, 0, SIZE + 1, WALL), Box(SIZE, -1, SIZE + 1, SIZE + 1, WALL),
             Box(0, -1, SIZE, 0, WALL), Box(0, SIZE, SIZE, SIZE + 1, WALL)]
    placed: list[Box] = []
    for _ in range(count * 20):
        if len(placed) >= count:
            break
        w, d, h = rng.choice(_SHAPES)
        x0, z0 = rng.uniform(3, SIZE - 3 - w), rng.uniform(3, SIZE - 3 - d)
        box = Box(x0, z0, x0 + w, z0 + d, h)
        if any(_gap(box, b) < 1.6 for b in placed):
            continue
        if any(_dist_to_box(sx, sz, box) < 3.0 for sx, sz in spawns):
            continue
        placed.append(box)
    return boxes + placed


def _gap(a: Box, b: Box) -> float:
    dx = max(b.x0 - a.x1, a.x0 - b.x1, 0.0)
    dz = max(b.z0 - a.z1, a.z0 - b.z1, 0.0)
    return math.hypot(dx, dz)


def _dist_to_box(x: float, z: float, b: Box) -> float:
    dx = max(b.x0 - x, 0.0, x - b.x1)
    dz = max(b.z0 - z, 0.0, z - b.z1)
    return math.hypot(dx, dz)


# ---- 이동 ----

def blocked(boxes: list[Box], x: float, z: float) -> bool:
    if not RADIUS <= x <= SIZE - RADIUS or not RADIUS <= z <= SIZE - RADIUS:
        return True
    return any(_dist_to_box(x, z, b) < RADIUS for b in boxes)


# 한 걸음 이동 (벽에 막히면 미끄러짐). 실제로 움직인 거리
def step(boxes: list[Box], soldiers: list[Soldier], s: Soldier, dx: float, dz: float) -> float:
    others = [o for o in soldiers if o is not s and o.alive]

    def free(x: float, z: float) -> bool:
        return not blocked(boxes, x, z) and all(math.hypot(o.x - x, o.z - z) >= RADIUS * 2 for o in others)

    for nx, nz in ((s.x + dx, s.z + dz), (s.x + dx, s.z), (s.x, s.z + dz)):
        if (nx, nz) != (s.x, s.z) and free(nx, nz):
            moved = math.hypot(nx - s.x, nz - s.z)
            s.x, s.z = nx, nz
            return moved
    return 0.0


# ---- 광선 ----

def direction(yaw: float, pitch: float) -> tuple[float, float, float]:
    cp = math.cos(pitch)
    return (-math.sin(yaw) * cp, math.sin(pitch), -math.cos(yaw) * cp)


def _ray_box(o, d, b: Box) -> float | None:
    tmin, tmax = 0.0, MAX_RANGE
    for oi, di, lo, hi in ((o[0], d[0], b.x0, b.x1), (o[1], d[1], 0.0, b.h), (o[2], d[2], b.z0, b.z1)):
        if abs(di) < 1e-9:
            if not lo <= oi <= hi:
                return None
            continue
        t1, t2 = (lo - oi) / di, (hi - oi) / di
        if t1 > t2:
            t1, t2 = t2, t1
        tmin, tmax = max(tmin, t1), min(tmax, t2)
        if tmin > tmax:
            return None
    return tmin


def _ray_sphere(o, d, c, r) -> float | None:
    oc = (o[0] - c[0], o[1] - c[1], o[2] - c[2])
    b = sum(oc[i] * d[i] for i in range(3))
    q = sum(v * v for v in oc) - r * r
    disc = b * b - q
    if disc < 0:
        return None
    t = -b - math.sqrt(disc)
    return t if t >= 0 else None


def _ray_body(o, d, s: Soldier) -> float | None:
    a = d[0] ** 2 + d[2] ** 2
    if a < 1e-12:
        return None
    ox, oz = o[0] - s.x, o[2] - s.z
    b = ox * d[0] + oz * d[2]
    c = ox * ox + oz * oz - RADIUS * RADIUS
    disc = b * b - a * c
    if disc < 0:
        return None
    for t in sorted(((-b - math.sqrt(disc)) / a, (-b + math.sqrt(disc)) / a)):
        y = o[1] + d[1] * t
        if t >= 0 and 0 <= y <= BODY_TOP:
            return t
    return None


# 광선이 처음 맞는 것: (거리, 맞은 사람 또는 None, 부위)
def cast(boxes: list[Box], soldiers: list[Soldier], o, d, skip: Soldier | None = None,
         limit: float = MAX_RANGE) -> tuple[float, Soldier | None, str]:
    best = (limit, None, "none")
    if d[1] < 0:
        t = -o[1] / d[1]
        if t < best[0]:
            best = (t, None, "floor")
    for b in boxes:
        t = _ray_box(o, d, b)
        if t is not None and t < best[0]:
            best = (t, None, "wall")
    for s in soldiers:
        if not s.alive or s is skip:
            continue
        th = _ray_sphere(o, d, (s.x, HEAD_Y, s.z), HEAD_R)
        if th is not None and th < best[0]:
            best = (th, s, "head")
        tb = _ray_body(o, d, s)
        if tb is not None and tb < best[0]:
            best = (tb, s, "body")
    return best


def point(o, d, t) -> list[float]:
    return [round(o[i] + d[i] * t, 3) for i in range(3)]


# ---- 사격 ----

def _rifle_scale(dist: float) -> float:
    start, end, low = RIFLE_FALLOFF
    if dist <= start:
        return 1.0
    return max(low, 1 - (1 - low) * (dist - start) / (end - start))


# 총 쏘기 (소총·저격총): 퍼짐을 섞은 광선 한 줄
def shoot(boxes: list[Box], soldiers: list[Soldier], shooter: Soldier, weapon: str,
          rng: random.Random) -> dict[str, Any]:
    w = WEAPONS[weapon]
    spread = math.radians(w["spread"])
    yaw = shooter.yaw + rng.gauss(0, spread / 2)
    pitch = shooter.pitch + rng.gauss(0, spread / 2)
    o, d = shooter.eye, direction(yaw, pitch)
    t, target, part = cast(boxes, soldiers, o, d, skip=shooter)
    hits = []
    if target is not None:
        damage = w[part]
        if weapon == "rifle":
            damage = round(damage * _rifle_scale(t))
        hits.append(_hurt(target, damage, part))
    return {"from": point(o, d, 0.4), "to": point(o, d, t), "surface": part if target is None else "player",
            "target": target.id if target else None, "part": part if target else None, "results": hits}


def _hurt(s: Soldier, damage: int, part: str) -> dict[str, Any]:
    s.hp = max(0, s.hp - damage)
    if s.hp == 0:
        s.alive = False
    return {"id": s.id, "damage": damage, "part": part, "hp": s.hp, "dead": not s.alive}


# 수류탄 던지기: 포물선 궤적 → 처음 닿는 곳(또는 시간이 다 되면 그 자리)에서 폭발
def throw(boxes: list[Box], soldiers: list[Soldier], thrower: Soldier, dt: float = 1 / 60) -> dict[str, Any]:
    w = WEAPONS["grenade"]
    d = direction(thrower.yaw, thrower.pitch)
    pos = [thrower.x + d[0] * 0.6, EYE - 0.1 + d[1] * 0.6, thrower.z + d[2] * 0.6]
    vel = [d[0] * w["speed"], d[1] * w["speed"], d[2] * w["speed"]]
    frames = [[round(v, 3) for v in pos]]
    t, n = 0.0, 0
    while t < w["fuse"]:
        vel[1] -= GRAVITY * dt
        move = [vel[i] * dt for i in range(3)]
        length = math.sqrt(sum(m * m for m in move))
        dirn = [m / length for m in move]
        hit_t, _, _ = cast(boxes, soldiers, pos, dirn, skip=thrower if t < 0.15 else None, limit=length)
        if hit_t < length:
            pos = [pos[i] + dirn[i] * max(hit_t - 0.05, 0) for i in range(3)]
            break
        pos = [pos[i] + move[i] for i in range(3)]
        t += dt
        n += 1
        if n % 2 == 0:
            frames.append([round(v, 3) for v in pos])
    frames.append([round(v, 3) for v in pos])
    return {"frames": frames, "at": [round(v, 3) for v in pos], "results": blast(boxes, soldiers, pos)}


# 폭발 피해 (가까울수록 크고, 사이에 벽이 있으면 줄어든다)
def blast(boxes: list[Box], soldiers: list[Soldier], at) -> list[dict[str, Any]]:
    w = WEAPONS["grenade"]
    out = []
    for s in soldiers:
        if not s.alive:
            continue
        center = (s.x, 0.9, s.z)
        dist = math.dist(at, center)
        if dist >= w["radius"]:
            continue
        damage = w["damage"] * (1 - dist / w["radius"])
        if dist > 0.01:
            d = tuple((center[i] - at[i]) / dist for i in range(3))
            t, _, _ = cast(boxes, [], at, d, limit=dist)
            if t < dist - 0.05:
                damage *= 0.4
        if round(damage) > 0:
            out.append(_hurt(s, round(damage), "blast"))
    return out


# 시선이 닿는지 (from 의 눈에서 target 의 한 점까지 막힘 없이)
def sees(boxes: list[Box], soldiers: list[Soldier], viewer: Soldier, target: Soldier, y: float = 1.0) -> bool:
    o = viewer.eye
    goal = (target.x, y, target.z)
    dist = math.dist(o, goal)
    d = tuple((goal[i] - o[i]) / dist for i in range(3))
    t, hit, _ = cast(boxes, soldiers, o, d, skip=viewer, limit=dist + 0.5)
    return hit is target
