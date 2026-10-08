"""턴제 FPS 월드: 맵, 이동 충돌, 사격, 수류탄, 앉기, 보급 상자, 안전 구역, AI."""
import math
import random

from app import ai
from app.world import (
    EYE, MOVE_MAX, RADIUS, SIZE, WEAPONS, ZONE_ROUND, Box, Item, Soldier, blast, blocked, cast, corners, direction,
    free_spot, generate_map, pick, sees, shoot, step, throw, zone_damage, zone_radius,
)


def face(a: Soldier, x: float, y: float, z: float) -> None:
    dx, dz = x - a.x, z - a.z
    a.yaw = math.atan2(-dx, -dz)
    a.pitch = math.atan2(y - EYE, math.hypot(dx, dz))


class Steady(random.Random):
    """퍼짐 없는 난수 (가우스 0)."""

    def gauss(self, mu=0.0, sigma=1.0):
        return mu


def test_direction_matches_camera_convention():
    assert [round(v, 6) for v in direction(0, 0)] == [0, 0, -1]          # yaw 0 은 -z
    assert [round(v, 6) for v in direction(math.pi / 2, 0)] == [-1, 0, 0]
    assert round(direction(0, math.pi / 2)[1], 6) == 1


def test_map_has_walls_cover_and_clear_spawns():
    for seed in range(20):
        rng = random.Random(seed)
        spots = corners(4)
        boxes = generate_map(rng, spots)
        assert len(boxes) >= 4 + 10
        for x, z in spots:
            assert not blocked(boxes, x, z)
        for b in boxes[4:]:
            assert 0 < b.x0 < b.x1 < SIZE and 0 < b.z0 < b.z1 < SIZE


def test_step_slides_along_walls_and_respects_others():
    wall = [Box(10, 0, 11, 40, 3)]
    s = Soldier("a", "A", 0, 9.4, 20)
    assert step(wall, [s], s, 0.5, 0.0) == 0                     # 벽으로는 못 감
    moved = step(wall, [s], s, 0.5, 0.5)
    assert moved and s.x == 9.4 and s.z == 20.5                  # 벽을 따라 미끄러짐
    other = Soldier("b", "B", 1, 9.4, 21.2)
    assert step(wall, [s, other], s, 0.0, 0.4) == 0              # 사람끼리 겹치지 않음
    edge = Soldier("c", "C", 0, RADIUS + 0.05, 5)
    assert step([], [edge], edge, -0.5, 0) == 0                   # 아레나 밖으로 못 감


def test_rifle_hits_body_and_head_and_wall_blocks():
    a, b = Soldier("a", "A", 0, 5, 20), Soldier("b", "B", 1, 15, 20)
    face(a, b.x, 1.0, b.z)
    r = shoot([], [a, b], a, "rifle", Steady())
    assert r["target"] == "b" and r["part"] == "body" and r["results"][0]["damage"] == WEAPONS["rifle"]["body"]
    b.hp = 100
    face(a, b.x, 1.62, b.z)
    r = shoot([], [a, b], a, "sniper", Steady())
    assert r["part"] == "head" and not b.alive                   # 저격 헤드샷은 한 방
    c = Soldier("c", "C", 1, 15, 20)
    face(a, c.x, 1.0, c.z)
    r = shoot([Box(9, 18, 10, 22, 3)], [a, c], a, "rifle", Steady())
    assert r["target"] is None and r["surface"] == "wall" and c.hp == 100


def test_rifle_damage_falls_off_far_away():
    a, b = Soldier("a", "A", 0, 1, 20), Soldier("b", "B", 1, 39, 20)
    face(a, b.x, 1.0, b.z)
    r = shoot([], [a, b], a, "rifle", Steady())
    assert r["results"][0]["damage"] < WEAPONS["rifle"]["body"]


def test_grenade_arcs_and_cover_reduces_blast():
    a, b = Soldier("a", "A", 0, 10, 20), Soldier("b", "B", 1, 18, 20)
    face(a, b.x, 1.0, b.z)
    a.pitch = math.radians(30)
    g = throw([], [a, b], a)
    assert len(g["frames"]) > 5 and max(f[1] for f in g["frames"]) > EYE     # 위로 솟았다 떨어짐
    open_hit = blast([], [Soldier("x", "X", 0, 20, 20)], (21, 0.1, 20))[0]["damage"]
    covered = blast([Box(20.3, 18, 20.6, 22, 2)], [Soldier("x", "X", 0, 20, 20)], (21, 0.1, 20))[0]["damage"]
    assert covered < open_hit
    assert blast([], [Soldier("x", "X", 0, 30, 20)], (21, 0.1, 20)) == []      # 범위 밖


def test_sees_and_cast_floor():
    a, b = Soldier("a", "A", 0, 5, 20), Soldier("b", "B", 1, 15, 20)
    assert sees([], [a, b], a, b)
    assert not sees([Box(9, 15, 10, 25, 3)], [a, b], a, b)
    t, hit, part = cast([], [], (0, 1, 0), (0, -1, 0))
    assert part == "floor" and abs(t - 1) < 1e-9 and hit is None


def test_ai_plan_moves_within_budget_and_aims_at_visible_target():
    for seed in range(15):
        rng = random.Random(seed)
        spots = corners(2)
        boxes = generate_map(rng, spots)
        me, foe = Soldier("ai", "AI", 0, *spots[0]), Soldier("p", "P", 1, *spots[1])
        plan = ai.plan(boxes, [me, foe], me, 3, rng)
        x, z = plan["to"]
        assert math.hypot(x - me.x, z - me.z) <= MOVE_MAX + 1e-6 and not blocked(boxes, x, z)
        assert plan["weapon"] in WEAPONS and -1.45 <= plan["pitch"] <= 1.45


def test_ai_is_accurate_up_close_at_high_level():
    hits = 0
    for seed in range(30):
        rng = random.Random(seed)
        me, foe = Soldier("ai", "AI", 0, 10, 20), Soldier("p", "P", 1, 20, 20)
        plan = ai.plan([], [me, foe], me, 3, rng)
        me.x, me.z = plan["to"]
        me.yaw, me.pitch = plan["yaw"], plan["pitch"]
        r = shoot([], [me, foe], me, plan["weapon"], rng)
        hits += bool(r["results"])
    assert hits >= 24


def test_crouch_lowers_hitbox_and_eye():
    a, b = Soldier("a", "A", 0, 5, 20), Soldier("b", "B", 1, 15, 20)
    face(a, b.x, 1.62, b.z)
    b.crouch = True
    r = shoot([], [a, b], a, "sniper", Steady())
    assert r["target"] is None                                   # 서 있을 때 머리 높이는 앉으면 빗나감
    face(a, b.x, b.head_y, b.z)
    assert shoot([], [a, b], a, "sniper", Steady())["part"] == "head"
    low = Box(9, 15, 10, 25, 1.2)
    assert not sees([low], [a, b], a, b, y=b.head_y)              # 낮은 엄폐물 뒤에 숨음
    a.crouch = True
    assert a.eye[1] < EYE


def test_items_fill_up_to_limits():
    s = Soldier("a", "A", 0, 5, 5, hp=90)
    assert pick(s, Item(1, "heal", 5, 5)) == {"hp": 10} and s.hp == 100
    assert pick(s, Item(2, "heal", 5, 5)) == {}                   # 꽉 차면 못 주움
    s.stock = {"rifle": 40, "sniper": 0, "grenade": 2}
    assert pick(s, Item(3, "ammo", 5, 5)) == {"rifle": 5, "sniper": 1}
    rng = random.Random(1)
    for _ in range(20):
        x, z = free_spot(rng, [], [], zone=(20, 20, 5))
        assert math.hypot(x - 20, z - 20) <= 5


def test_zone_shrinks_and_hurts_more_each_round():
    assert zone_radius(30, ZONE_ROUND - 1) == 30 and zone_damage(ZONE_ROUND - 1) == 0
    radii = [zone_radius(30, ZONE_ROUND + i) for i in range(10)]
    assert radii == sorted(radii, reverse=True) and radii[-1] == 0
    assert zone_damage(ZONE_ROUND + 1) > zone_damage(ZONE_ROUND) > 0


def test_ai_heads_into_zone_and_takes_items():
    me, foe = Soldier("ai", "AI", 0, 4, 4), Soldier("p", "P", 1, 36, 36)
    walls = [Box(10, 0, 11, 40, 4)]                               # 서로 안 보임
    x, z = ai.choose_spot(walls, [me, foe], me, foe, random.Random(0), zone=(30, 4, 3))
    assert x > me.x                                               # 구역 쪽으로
    it = Item(1, "heal", 6, 6)
    x, z = ai.choose_spot(walls, [me, foe], me, foe, random.Random(0), items=[it])
    assert math.hypot(x - it.x, z - it.z) < 0.9
