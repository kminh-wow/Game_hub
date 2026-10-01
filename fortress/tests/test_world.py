"""포트리스 월드: 지형, 포탄, 폭발, 이동."""
import random

from app.world import (
    CLIMB_FUEL, MAX_CLIMB, MOVE_STEP, REPOSE, SEA, WEAPONS, WIDTH, Tank, carve, explode, fly, generate_terrain, ground,
    move_tank, spawn_points,
)


def flat(h=200):
    return [h] * WIDTH


def tank(x, terrain, tid="a", **kw):
    return Tank(id=tid, name=tid, color=0, x=x, y=ground(terrain, x), **kw)


def test_starting_terrain_can_be_climbed_everywhere():
    for seed in range(20):
        rng = random.Random(seed)
        t = generate_terrain(rng)
        spawn_points(rng, t, 4)
        assert max(abs(t[c] - t[c + MOVE_STEP]) for c in range(WIDTH - MOVE_STEP)) <= MAX_CLIMB


def test_terrain_is_mountainous_and_in_bounds():
    for seed in range(20):
        t = generate_terrain(random.Random(seed))
        assert len(t) == WIDTH and min(t) > SEA and max(t) < 700
        middle = max(t[WIDTH // 3: WIDTH * 2 // 3])
        edges = (sum(t[:100]) + sum(t[-100:])) / 200
        assert middle > edges + 80                          # 가운데에 큰 산


def test_spawn_points_are_spread_and_flat():
    rng = random.Random(3)
    t = generate_terrain(rng)
    xs = sorted(spawn_points(rng, t, 4))
    assert all(b - a > 150 for a, b in zip(xs, xs[1:]))
    for x in xs:
        pad = t[int(x) - 4:int(x) + 5]
        assert max(pad) - min(pad) <= 1                     # 발밑은 평평 (가파른 비탈에서는 좁아진다)


def test_shot_straight_up_falls_back_near_shooter():
    t = flat()
    a = tank(600, t, angle=90)
    shot = fly(t, [a], a, 30, 0)
    assert shot["hit"] and abs(shot["hit"][0] - 600) < 15
    assert shot["direct"] is a                              # 제자리에 떨어지면 자기가 맞는다


def test_wind_pushes_the_shell():
    t = flat()
    a = tank(600, t, angle=60)
    calm = fly(t, [a], a, 60, 0)["hit"][0]
    assert fly(t, [a], a, 60, 8)["hit"][0] > calm + 50
    assert fly(t, [a], a, 60, -8)["hit"][0] < calm - 50


def test_direct_hit_on_another_tank():
    t = flat()
    a, b = tank(300, t, "a", angle=45), tank(900, t, "b")
    hits = [p for p in range(40, 101) if fly(t, [a, b], a, p, 0)["direct"] is b]
    assert hits                                           # 어떤 파워로는 맞힐 수 있다


def test_shell_leaving_the_map_hits_nothing():
    t = flat()
    a = tank(1100, t, angle=30)
    shot = fly(t, [a], a, 100, 0)
    assert shot["hit"] is None and shot["frames"][-1][0] > WIDTH


def test_carve_digs_a_crater_and_collapses_dirt_above():
    t = flat(200)
    carve(t, 600, 200, 40)
    assert 158 <= t[600] <= 165 and t[500] == 200 and t[620] < 200
    t = flat(300)
    carve(t, 600, 150, 40)                                # 땅속에서 터지면 위의 흙이 내려앉는다
    assert 218 <= t[600] <= 225
    t = flat(30)
    carve(t, 600, 0, 80)
    assert min(t) >= 0


def test_crater_walls_collapse_into_climbable_slopes():
    for radius in (38, 62):
        t = flat(200)
        carve(t, 600, 200, radius)
        assert max(abs(t[c] - t[c + 1]) for c in range(WIDTH - 1)) <= REPOSE
        a = tank(600, t)
        for _ in range(60):                               # 구덩이 바닥에서 걸어 나올 수 있다
            move_tank(t, a, 1)
        assert a.x > 600 + radius and a.y == 200


def test_explosion_damage_falls_off_with_distance():
    t = flat()
    near, far, out = tank(600, t, "n"), tank(640, t, "f"), tank(800, t, "o")
    results = {r["id"]: r for r in explode(t, [near, far, out], 600, 200, "normal", None)}
    assert results["n"]["damage"] > results["f"]["damage"] > 0
    assert "o" not in results and out.hp == 100
    assert near.y < 200                                   # 구덩이로 내려앉음


def test_direct_hit_bonus_and_big_shell():
    def damage(weapon, direct):
        t = flat()
        a = tank(600, t)
        return explode(t, [a], 600, 208, weapon, a if direct else None)[0]["damage"]

    assert damage("normal", True) == damage("normal", False) + 10
    assert damage("big", False) > damage("normal", False)
    assert WEAPONS["big"]["radius"] > WEAPONS["normal"]["radius"]


def test_tank_in_the_sea_is_destroyed():
    t = flat(SEA + 20)
    a = tank(600, t)
    r = explode(t, [a], 600, SEA + 20, "big", None)[0]
    assert r["cause"] == "sea" and not a.alive and a.hp == 0


def test_move_uses_fuel_and_respects_slopes_and_edges():
    t = flat()
    a = tank(600, t)
    assert move_tank(t, a, 1) == MOVE_STEP and a.x == 600 + MOVE_STEP
    t[int(a.x) + MOVE_STEP] = 210                         # 오르막은 연료를 더 쓴다
    assert move_tank(t, a, 1) == MOVE_STEP + 10 * CLIMB_FUEL and a.y == 210
    t[int(a.x) + MOVE_STEP] = 210 + MAX_CLIMB + 1         # 너무 가파른 벽
    assert move_tank(t, a, 1) == 0
    b = tank(11, flat())
    assert move_tank(flat(), b, -1) == 0                   # 맵 끝
    shore = [SEA - 1] * 598 + [200] * (WIDTH - 598)
    c = tank(600, shore)
    assert move_tank(shore, c, -1) == 0                   # 바다로는 못 감
