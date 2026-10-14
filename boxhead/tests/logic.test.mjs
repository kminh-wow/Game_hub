// 실행: node --test boxhead/tests/logic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { AMMO_CRATE, BLOCKS, COLS, DT, ROWS, SPAWNS, createGame, dirIndex, levelInfo, removePlayer, snapshot, step } from "../static/logic.js";

const ME = [{ id: "a", name: "가" }];

function run(s, seconds, inputs = {}) {
  for (let t = 0; t < seconds && !s.over; t += DT) step(s, DT, inputs);
}
function zombie(s, x, y, extra = {}) {
  const z = { id: s.nextId++, x, y, hp: 3, max: 3, face: 0, speed: 1.4, stun: 0, cd: 0, kx: 0, ky: 0, ...extra };
  s.zs.push(z);
  return z;
}
// 웨이브가 시작돼 있는 판 (자동 스폰 없이 시험하려고 좀비 수를 0으로)
function arena(players = ME) {
  const s = createGame(1, players);
  s.phase = "wave";
  s.level = 1;
  s.info = levelInfo(1);
  s.zLeft = 0;
  s.dLeft = 0;
  s.zs.push({ id: 0, x: 1, y: 1, hp: 99, max: 99, face: 0, speed: 0, stun: 99, cd: 99, kx: 0, ky: 0 });   // 레벨이 끝나지 않게 붙잡아 둠
  return s;
}

test("같은 시드면 같은 판", () => {
  const a = createGame(7, ME);
  const b = createGame(7, ME);
  run(a, 8);
  run(b, 8);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("8방향: 대각선도 같은 속도, 마지막 누른 방향을 봄", () => {
  assert.equal(dirIndex(1, 0), 0);
  assert.equal(dirIndex(-1, 1), 3);                  // 남서쪽
  assert.equal(dirIndex(0, -1), 6);
  assert.equal(dirIndex(0, 0), -1);
  const s = arena();
  const p = s.players[0];
  const [x0, y0] = [p.x, p.y];
  run(s, 0.5, { a: { dx: -1, dy: 1 } });
  assert.equal(p.face, 3);
  const diag = Math.hypot(p.x - x0, p.y - y0);
  const s2 = arena();
  run(s2, 0.5, { a: { dx: 1, dy: 0 } });
  const straight = Math.hypot(s2.players[0].x - x0, s2.players[0].y - y0);
  assert.ok(Math.abs(diag - straight) < 0.01);
  run(s, 0.2, { a: { dx: 0, dy: 0 } });
  assert.equal(p.face, 3);                           // 손을 떼도 방향 유지
});

test("lock 이면 제자리에서 방향만 바꿈", () => {
  const s = arena();
  const p = s.players[0];
  const [x0, y0] = [p.x, p.y];
  run(s, 0.3, { a: { dx: 0, dy: -1, lock: true } });
  assert.equal(p.face, 6);
  assert.equal(p.x, x0);
  assert.equal(p.y, y0);
});

// 한 줄 양옆이 비어 있는 상자 하나 (왼쪽에 서고 오른쪽에 목표를 두는 시험용)
function lonely() {
  return BLOCKS.find((b) => b.x > 6 && b.x < COLS - 8 && b.y > 4 && b.y < ROWS - 5 && b.w === 1 && b.h === 1);
}

test("블록과 가장자리는 지나가지 못함", () => {
  const s = arena();
  const p = s.players[0];
  const b = lonely();
  p.x = b.x - 0.9;
  p.y = b.y + 0.5;
  run(s, 1, { a: { dx: 1, dy: 0 } });                // 상자 왼쪽 면
  assert.ok(p.x < b.x);
  p.x = 1;
  run(s, 2, { a: { dx: -1, dy: -1 } });
  assert.ok(p.x >= 0.3 && p.y >= 0.3);
});

test("권총: 정면 좀비에게 맞고, 3발에 죽고, 점수와 연속 킬이 오른다", () => {
  const s = arena();
  const p = s.players[0];
  p.x = COLS / 2 - 1;
  p.y = ROWS / 2;
  p.face = 0;
  p.aim = 0;
  const z = zombie(s, COLS / 2 + 2, ROWS / 2);
  z.speed = 0;
  run(s, 1.2, { a: { fire: true } });
  assert.equal(s.zs.includes(z), false);
  assert.equal(s.kills, 1);
  assert.equal(s.score, 10);
  assert.equal(s.combo, 1);
});

test("벽 뒤의 좀비는 못 맞춤", () => {
  const s = arena();
  const p = s.players[0];
  const b = lonely();
  p.x = b.x - 2;
  p.y = b.y + 0.5;
  p.face = 0;
  p.aim = 0;
  const z = zombie(s, b.x + 3, b.y + 0.5, { speed: 0 });      // 사이에 상자
  run(s, 1, { a: { fire: true } });
  assert.equal(z.hp, 3);
});

test("샷건은 가까이서 세고 멀면 약하다, 탄약이 닳고 떨어지면 권총으로", () => {
  const s = arena();
  const p = s.players[0];
  p.has[1] = true;
  p.ammo[1] = 2;
  p.weapon = 1;
  p.x = COLS / 2 - 1;
  p.y = ROWS / 2;
  p.face = 0;
  p.aim = 0;
  const near = zombie(s, COLS / 2 + 0.5, ROWS / 2, { speed: 0 });
  const far = zombie(s, COLS / 2 + 8, ROWS / 2, { speed: 0 });
  run(s, 0.1, { a: { fire: true } });
  assert.ok(near.hp <= 0 || !s.zs.includes(near));
  assert.equal(far.hp, 3);                            // 사거리 밖
  assert.equal(p.ammo[1], 1);
  run(s, 1.6, { a: { fire: true } });
  assert.equal(p.ammo[1], 0);
  run(s, 0.8, { a: { fire: true } });
  assert.equal(p.weapon, 0);
});

test("좀비는 쫓아와서 때리고, 맞으면 체력이 줄고 가만히 있으면 다시 찬다", () => {
  const s = arena();
  const p = s.players[0];
  zombie(s, p.x + 3, p.y);
  run(s, 4);
  assert.ok(p.hp < 100 && p.hp > 0);
  s.zs = s.zs.filter((z) => z.id === 0);
  const low = p.hp;
  run(s, 8);
  assert.ok(p.hp > low);
});

test("체력이 0이면 판 끝", () => {
  const s = arena();
  s.players[0].hp = 1;
  zombie(s, s.players[0].x + 0.4, s.players[0].y);
  run(s, 2);
  assert.ok(s.over);
  assert.ok(snapshot(s).ev.some((e) => e.type === "over"));
});

test("좀비를 다 잡으면 악마, 악마까지 잡으면 클리어와 보급 상자", () => {
  const s = createGame(3, ME);
  s.phaseT = 0;
  run(s, 0.1);
  assert.equal(s.level, 1);
  assert.equal(s.dLeft, 0);                           // 1레벨에는 악마가 없음
  s.zLeft = 0;
  s.zs = [];
  s.dLeft = 1;
  run(s, 2);
  assert.ok(s.devils.length >= 1);                    // 좀비가 없으면 악마가 나옴
  s.dLeft = 0;
  s.devils = [];
  run(s, 0.1);
  assert.equal(s.phase, "intermission");
  assert.ok(s.crates.some((c) => c.kind === "supply"));
  assert.ok(s.score >= 500);
});

test("악마는 불덩이를 쏘고 맞으면 아프다", () => {
  const s = arena();
  s.zs = [];
  s.info = levelInfo(1);
  const p = s.players[0];
  p.x = COLS / 2;
  p.y = ROWS / 2;
  s.devils.push({ id: 50, x: COLS / 2 + 4, y: ROWS / 2, hp: 20, max: 20, face: 0, speed: 0, stun: 0, cd: 0, wind: 0, kx: 0, ky: 0, side: 1 });
  s.dLeft = 1;
  run(s, 2);
  assert.ok(s.events.some((e) => e.type === "fireball"));
  assert.ok(p.hp < 100);
});

test("상자: 첫 상자는 샷건, 다음은 기관총, 그다음은 탄약", () => {
  const s = arena();
  const p = s.players[0];
  const drop = () => s.crates.push({ id: s.nextId++, x: p.x, y: p.y, kind: "ammo", ttl: 20 });
  drop();
  run(s, 0.1);
  assert.deepEqual(p.has, [true, true, false]);
  assert.equal(p.ammo[1], AMMO_CRATE[1]);
  drop();
  run(s, 0.1);
  assert.deepEqual(p.has, [true, true, true]);
  drop();
  run(s, 0.1);
  assert.equal(p.ammo[1], AMMO_CRATE[1] * 2);
});

test("같이 하기: 한 명이 쓰러져도 판은 계속, 다 쓰러지면 끝, 나가면 빠짐", () => {
  const s = arena([{ id: "a", name: "가" }, { id: "b", name: "나" }]);
  s.players[0].hp = 1;
  zombie(s, s.players[0].x + 0.4, s.players[0].y);
  s.players[1].x = 20;
  s.players[1].y = 14;
  run(s, 1);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.over, false);
  removePlayer(s, "b");
  assert.ok(s.over);
});

test("레벨이 오를수록 많고 빠르고 단단하다, 사람이 많으면 더 많다", () => {
  assert.ok(levelInfo(10).zombies > levelInfo(1).zombies);
  assert.ok(levelInfo(10).zSpeed > levelInfo(1).zSpeed);
  assert.ok(levelInfo(20).dHp > levelInfo(1).dHp);
  assert.ok(levelInfo(5, 3).zombies > levelInfo(5, 1).zombies);
});

test("좀비가 블록 뒤에서 막히지 않고 돌아온다", () => {
  const s = arena();
  const p = s.players[0];
  const b = lonely();
  p.x = b.x + 2.5;
  p.y = b.y + 0.5;                                    // 상자 오른쪽
  const z = zombie(s, b.x - 1.5, b.y + 0.5, { speed: 2 });   // 상자 왼쪽 같은 높이
  run(s, 12);
  assert.ok(Math.hypot(z.x - p.x, z.y - p.y) < 1.5 || p.hp < 100);
});

test("상자는 작고 많고, 가운데는 비어 있고, 서로 떨어져 있다", () => {
  assert.ok(BLOCKS.length >= 30);
  assert.ok(BLOCKS.every((b) => b.w * b.h <= 2));
  const cx = COLS / 2;
  const cy = ROWS / 2;
  assert.ok(BLOCKS.every((b) => !(b.x < cx + 3 && b.x + b.w > cx - 3 && b.y < cy + 3 && b.y + b.h > cy - 3)));
  for (const a of BLOCKS) for (const b of BLOCKS) {
    if (a !== b) assert.ok(a.x >= b.x + b.w + 2 || b.x >= a.x + a.w + 2 || a.y >= b.y + b.h + 2 || b.y >= a.y + a.h + 2);
  }
});

test("어디서든 가운데까지 걸어갈 수 있다 (갇힌 자리 없음)", () => {
  const solid = new Set();
  for (const b of BLOCKS) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) solid.add(`${x},${y}`);
  const seen = new Set([`${COLS / 2},${ROWS / 2}`]);
  const queue = [[COLS / 2, ROWS / 2]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (x + dx < 0 || y + dy < 0 || x + dx >= COLS || y + dy >= ROWS || solid.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push([x + dx, y + dy]);
    }
  }
  assert.equal(seen.size, COLS * ROWS - solid.size);
  assert.ok(SPAWNS.every(([x, y]) => seen.has(`${Math.floor(x)},${Math.floor(y)}`)));
});

test("마우스 조준: 걷는 방향과 따로 원하는 각도로 쏜다, 없으면 이동 방향", () => {
  const s = arena();
  const p = s.players[0];
  p.x = COLS / 2;
  p.y = ROWS / 2;
  const up = zombie(s, COLS / 2, ROWS / 2 - 3.5, { speed: 0 });   // 위쪽
  const x0 = p.x;
  for (let t = 0; t < 1.5 && s.zs.includes(up); t += DT) {
    const aim = Math.atan2(up.y - p.y, up.x - p.x);                // 걸어가면서 계속 그 좀비를 조준
    step(s, DT, { a: { dx: 1, dy: 0, aim, fire: true } });
  }
  assert.ok(p.x > x0 + 0.3);                                      // 오른쪽으로 걸었고
  assert.equal(s.zs.includes(up), false);                         // 위의 좀비를 맞춤
  const t = arena();
  run(t, 0.1, { a: { dx: -1, dy: 1 } });                          // 조준 없이 남서
  assert.ok(Math.abs(snapshot(t).p[0].ang - (3 * Math.PI) / 4) < 0.01);
  run(t, 0.1, { a: { dx: 0, dy: 0, aim: 0 } });                   // 서 있어도 마우스로 방향 바뀜
  assert.equal(t.players[0].face, 0);
  assert.equal(snapshot(t).p[0].ang, 0);
});

test("좀비가 나오는 곳은 플레이어에서 너무 멀지 않다", () => {
  const s = createGame(5, ME);
  s.phase = "wave";
  s.level = 1;
  s.info = levelInfo(1);
  s.zLeft = 30;
  s.spawnT = 0;
  run(s, 25);
  const p = s.players[0];
  assert.ok(s.zs.length + s.kills > 0);
  for (const z of s.zs) assert.ok(Math.hypot(z.x - p.x, z.y - p.y) < 30);
});

test("스냅샷은 작은 값만 담는다", () => {
  const s = createGame(2, ME);
  const snap = snapshot(s);
  assert.equal(snap.p[0].id, "a");
  assert.ok(JSON.stringify(snap).length < 600);
  assert.ok(COLS === 36 && ROWS === 24);
});
