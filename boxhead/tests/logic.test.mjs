// 실행: node --test boxhead/tests/logic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { AMMO_CRATE, BLOCKS, COLS, DT, ROWS, createGame, dirIndex, levelInfo, removePlayer, snapshot, step } from "../static/logic.js";

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

test("블록과 가장자리는 지나가지 못함", () => {
  const s = arena();
  const p = s.players[0];
  p.x = 4.2;
  p.y = 5;
  run(s, 1, { a: { dx: 1, dy: 0 } });                // 블록(5,4,2,2) 왼쪽 면
  assert.ok(p.x < BLOCKS[0].x);
  p.x = 1;
  run(s, 2, { a: { dx: -1, dy: -1 } });
  assert.ok(p.x >= 0.3 && p.y >= 0.3);
});

test("권총: 정면 좀비에게 맞고, 3발에 죽고, 점수와 연속 킬이 오른다", () => {
  const s = arena();
  const p = s.players[0];
  p.x = 3;
  p.y = 8;
  p.face = 0;
  const z = zombie(s, 6, 8);
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
  p.x = 3;
  p.y = 5;
  p.face = 0;
  const z = zombie(s, 8, 5, { speed: 0 });           // 사이에 블록(5~7, 4~6)
  run(s, 1, { a: { fire: true } });
  assert.equal(z.hp, 3);
});

test("샷건은 가까이서 세고 멀면 약하다, 탄약이 닳고 떨어지면 권총으로", () => {
  const s = arena();
  const p = s.players[0];
  p.has[1] = true;
  p.ammo[1] = 2;
  p.weapon = 1;
  p.x = 3;
  p.y = 8;
  p.face = 0;
  const near = zombie(s, 4.5, 8, { speed: 0 });
  const far = zombie(s, 11, 8, { speed: 0 });
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
  p.x = 12;
  p.y = 8;
  s.devils.push({ id: 50, x: 12, y: 3, hp: 20, max: 20, face: 0, speed: 0, stun: 0, cd: 0, wind: 0, kx: 0, ky: 0, side: 1 });
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
  p.x = 8;
  p.y = 5;                                            // 블록(5~7, 4~6) 오른쪽
  const z = zombie(s, 3.5, 5, { speed: 2 });          // 블록 왼쪽 같은 높이
  run(s, 12);
  assert.ok(Math.hypot(z.x - p.x, z.y - p.y) < 1.5 || p.hp < 100);
});

test("스냅샷은 작은 값만 담는다", () => {
  const s = createGame(2, ME);
  const snap = snapshot(s);
  assert.equal(snap.p[0].id, "a");
  assert.ok(JSON.stringify(snap).length < 600);
  assert.ok(COLS === 24 && ROWS === 16);
});
