"""포트리스 월드: 산 지형 만들기, 포탄 궤적, 폭발(지형 파괴·피해), 탱크 이동.

좌표는 왼쪽 아래가 (0, 0)이고 위로 갈수록 y 가 커진다. 지형은 열마다 땅 높이 하나(높이맵)다.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

WIDTH = 1200
HEIGHT = 700
SEA = 24                 # 바다 높이: 땅이 이보다 낮아지면 그 자리 탱크는 빠진다
GRAVITY = 300.0          # 단위/초²
MAX_SPEED = 580.0        # 파워 100일 때 포탄 속도
WIND_ACCEL = 6.0         # 바람 1당 가로 가속도
MAX_WIND = 10
SIM_DT = 1 / 120
FRAME_EVERY = 4          # 30Hz 로 궤적 기록
MAX_FLIGHT = 12.0        # 포탄이 날아가는 최대 시간(초)

TANK_RADIUS = 13         # 직격 판정 반지름
TANK_CENTER = 8          # 탱크 중심이 땅에서 떨어진 높이
BARREL = 22              # 포신 길이 (포탄이 나오는 곳)
MAX_FUEL = 120           # 한 차례에 움직일 수 있는 거리
MOVE_STEP = 3
MAX_CLIMB = 6            # 한 걸음에 오를 수 있는 높이
MAX_HP = 100

# 포탄 종류: 폭발 반지름, 최대 피해, 판마다 쓸 수 있는 개수 (None 은 무제한)
WEAPONS = {
    "normal": {"name": "기본탄", "radius": 38, "damage": 35, "stock": None},
    "big": {"name": "대형탄", "radius": 62, "damage": 55, "stock": 1},
}
DIRECT_BONUS = 10


# ---- 지형 ----

# 산 지형 만들기
def generate_terrain(rng: random.Random) -> list[int]:
    peaks = [(rng.uniform(.38, .62) * WIDTH, rng.uniform(300, 400), rng.uniform(110, 160))]   # 가운데 큰 산
    for _ in range(rng.randint(3, 5)):
        peaks.append((rng.uniform(0, WIDTH), rng.uniform(70, 210), rng.uniform(60, 140)))
    phase = rng.uniform(0, math.tau)
    out = []
    for x in range(WIDTH):
        h = 110 + sum(a * math.exp(-((x - c) / w) ** 2) for c, a, w in peaks)
        h += 14 * math.sin(x / 37 + phase) + 7 * math.sin(x / 11 + phase * 2)
        if h > 440:                                         # 높은 봉우리는 완만하게 눌러 평평한 꼭대기를 피한다
            h = 440 + (h - 440) * .45
        out.append(int(max(SEA + 30, min(HEIGHT - 120, h))))
    return out


# 출발 자리 (고르게 퍼뜨리고 발밑을 평평하게)
def spawn_points(rng: random.Random, terrain: list[int], count: int) -> list[float]:
    xs = []
    for i in range(count):
        x = (i + .5) / count * WIDTH + rng.uniform(-40, 40)
        x = max(40, min(WIDTH - 40, x))
        lo, hi = int(x) - 12, int(x) + 12
        flat = round(sum(terrain[lo:hi + 1]) / (hi - lo + 1))
        for c in range(lo, hi + 1):
            terrain[c] = flat
        xs.append(x)
    rng.shuffle(xs)
    return xs


def ground(terrain: list[int], x: float) -> int:
    return terrain[max(0, min(WIDTH - 1, int(round(x))))]


# ---- 탱크 ----

@dataclass
class Tank:
    id: str
    name: str
    color: int
    x: float
    y: float = 0.0
    hp: int = MAX_HP
    alive: bool = True
    facing: int = 1           # 1 오른쪽, -1 왼쪽
    angle: float = 45.0       # 바라보는 쪽 기준 포신 각도 (0~90)
    dummy: bool = False       # 연습용 허수아비 (차례가 없다)
    stock: dict[str, int] = field(default_factory=lambda: {k: w["stock"] for k, w in WEAPONS.items() if w["stock"]})

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "color": self.color,
            "x": round(self.x, 1), "y": round(self.y, 1), "hp": self.hp, "alive": self.alive,
            "facing": self.facing, "angle": round(self.angle, 1), "dummy": self.dummy, "stock": self.stock,
        }


# 탱크 이동 (움직인 거리, 막혔으면 0)
def move_tank(terrain: list[int], tank: Tank, direction: int) -> float:
    nx = tank.x + direction * MOVE_STEP
    if not 10 <= nx <= WIDTH - 10:
        return 0.0
    gy = ground(terrain, nx)
    if gy - tank.y > MAX_CLIMB or gy <= SEA:
        return 0.0
    tank.x, tank.y = nx, gy
    return MOVE_STEP


# ---- 포탄 ----

def muzzle(tank: Tank) -> tuple[float, float, float, float]:
    """포탄이 나오는 곳과 방향 단위 벡터."""
    rad = math.radians(tank.angle)
    dx, dy = math.cos(rad) * tank.facing, math.sin(rad)
    return tank.x + dx * BARREL, tank.y + TANK_CENTER + 4 + dy * BARREL, dx, dy


# 포탄 궤적 (기록한 점들, 터진 곳, 직격한 탱크)
def fly(terrain: list[int], tanks: list[Tank], shooter: Tank, power: float, wind: int) -> dict[str, Any]:
    x, y, dx, dy = muzzle(shooter)
    speed = MAX_SPEED * max(0.0, min(100.0, power)) / 100
    vx, vy = dx * speed, dy * speed
    frames = [[round(x, 1), round(y, 1)]]
    t = 0.0
    step = 0
    hit = None
    direct = None
    while t < MAX_FLIGHT:
        if 0 <= x < WIDTH and y <= ground(terrain, x):
            hit = (x, max(y, 0.0))
            break
        for tank in tanks:
            if tank.alive and (tank is not shooter or t > .15) and \
                    math.hypot(tank.x - x, tank.y + TANK_CENTER - y) < TANK_RADIUS:
                hit, direct = (x, y), tank
                break
        if hit or x < -60 or x > WIDTH + 60 or y < -60:
            break
        vx += wind * WIND_ACCEL * SIM_DT
        vy -= GRAVITY * SIM_DT
        x += vx * SIM_DT
        y += vy * SIM_DT
        t += SIM_DT
        step += 1
        if step % FRAME_EVERY == 0:
            frames.append([round(x, 1), round(y, 1)])
    frames.append([round(x, 1), round(y, 1)])
    return {"frames": frames, "hit": hit, "direct": direct}


# 지형 파이기 (원 안의 흙이 사라지고 위에 있던 흙은 내려앉는다)
def carve(terrain: list[int], cx: float, cy: float, radius: float) -> None:
    for c in range(max(0, int(cx - radius)), min(WIDTH, int(cx + radius) + 1)):
        s = math.sqrt(max(0.0, radius * radius - (c - cx) ** 2))
        h = terrain[c]
        overlap = max(0.0, min(h, cy + s) - max(0.0, cy - s))
        terrain[c] = int(round(h - overlap))


# 폭발 (피해, 지형 파괴, 떨어짐)
def explode(terrain: list[int], tanks: list[Tank], x: float, y: float, weapon: str,
            direct: Tank | None) -> list[dict[str, Any]]:
    w = WEAPONS[weapon]
    reach = w["radius"] + TANK_RADIUS
    results = {t.id: {"id": t.id, "damage": 0, "fall": 0, "cause": None} for t in tanks if t.alive}
    for tank in tanks:
        if not tank.alive:
            continue
        d = math.hypot(tank.x - x, tank.y + TANK_CENTER - y)
        if d < reach:
            results[tank.id]["damage"] += round(w["damage"] * (1 - d / reach))
        if tank is direct:
            results[tank.id]["damage"] += DIRECT_BONUS
    carve(terrain, x, y, w["radius"])
    for tank in tanks:
        if not tank.alive:
            continue
        r = results[tank.id]
        gy = ground(terrain, tank.x)
        fall = tank.y - gy
        if fall > 0:
            r["fall"] = round(fall)
            r["damage"] += max(0, round((fall - 30) * .3))
            tank.y = gy
        tank.hp = max(0, tank.hp - r["damage"])
        if gy <= SEA:
            tank.hp = 0
            r["cause"] = "sea"
        elif tank.hp == 0:
            r["cause"] = "hit"
        if tank.hp == 0:
            tank.alive = False
        r["hp"] = tank.hp
    return [r for r in results.values() if r["damage"] or r["fall"] or r["cause"]]
