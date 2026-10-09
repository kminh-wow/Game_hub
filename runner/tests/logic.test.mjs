// 실행: node --test runner/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOSS_EVERY, HALF, MAX_LEVEL, MAX_SQUAD, START_SQUAD, applyGate, createGame, difficulty, gateGood, gateLabel,
  makeGroup, score, squadRadius, step,
} from "../web/logic.js";

// 아무것도 없는 판 (사건이 저절로 생기지 않게 멀리 미룸)
function empty(seed = 1) {
  const s = createGame(seed);
  s.nextSpawn = 1e9;
  s.nextBoss = 1e9;
  return s;
}

function run(s, seconds, input = {}) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...step(s, 1 / 60, input));
  return events;
}

test("문 계산: 더하기·빼기·곱하기·나누기, 0~999 사이", () => {
  assert.equal(applyGate(10, { op: "num", v: 15 }), 25);
  assert.equal(applyGate(10, { op: "num", v: -30 }), 0);
  assert.equal(applyGate(10, { op: "mul", v: 3 }), 30);
  assert.equal(applyGate(11, { op: "div", v: 2 }), 6);
  assert.equal(applyGate(600, { op: "mul", v: 2 }), MAX_SQUAD);
  assert.equal(gateLabel({ op: "num", v: -5 }), "-5");
  assert.equal(gateLabel({ op: "mul", v: 2 }), "×2");
  assert.equal(gateLabel({ op: "num", v: 9, hidden: true }), "?");
  assert.ok(gateGood({ op: "mul", v: 2 }) && !gateGood({ op: "div", v: 2 }) && !gateGood({ op: "num", v: -1 }));
});

test("같은 시드면 같은 판", () => {
  const a = createGame(42);
  const b = createGame(42);
  run(a, 20, { targetX: 2 });
  run(b, 20, { targetX: 2 });
  assert.equal(a.count, b.count);
  assert.equal(a.dist, b.dist);
  assert.equal(JSON.stringify(a.gates), JSON.stringify(b.gates));
});

test("서 있는 쪽 문이 적용된다", () => {
  const s = empty();
  s.gates.push({ id: 1, d: 5, left: { op: "num", v: 20, acc: 0 }, right: { op: "div", v: 2, acc: 0 }, passed: false });
  s.weapon = "pistol";
  s.x = -2;
  const ev = run(s, 1.5, { targetX: -2 });
  const gate = ev.find((e) => e.type === "gate");
  assert.equal(gate.side, "left");
  assert.equal(gate.after, START_SQUAD + 20 + (gate.after - gate.before - 20));   // 쏴서 오른 만큼 더해질 수 있음
  assert.ok(s.count >= START_SQUAD + 20);
});

test("문을 쏘면 숫자가 올라간다", () => {
  const s = empty();
  s.gates.push({ id: 1, d: 25, left: { op: "num", v: -20, acc: 0 }, right: { op: "num", v: -20, acc: 0 }, passed: false });
  s.x = 3;
  run(s, 1.2, { targetX: 3 });
  assert.ok(s.gates[0].right.v > -20 && s.gates[0].right.v <= 0);
  assert.equal(s.gates[0].left.v, -20);                     // 무리가 오른쪽이라 오른쪽 문만 맞음
});

test("총으로 적 무리를 줄이고, 맞붙으면 서로 줄어든다", () => {
  const s = empty();
  s.count = 50;
  s.groups.push(makeGroup(s, "mob", 0, 40, 20));
  run(s, 2);
  assert.ok(s.kills > 0, "다가오는 동안 쏴서 줄임");
  const s2 = empty();
  s2.count = 20;
  s2.groups.push(makeGroup(s2, "mob", 0, 1.5, 15));
  const ev = run(s2, 1);
  assert.ok(ev.some((e) => e.type === "clash" && e.lost > 0));
  assert.ok(s2.count < 20 && s2.groups.length === 0);
});

test("병사가 0이 되면 게임 오버", () => {
  const s = empty();
  s.count = 5;
  s.groups.push(makeGroup(s, "brute", 0, 2, 1));
  s.groups[0].pool = s.groups[0].unitHp = 1e6;
  const ev = run(s, 3);
  assert.ok(s.over && s.count === 0);
  assert.equal(ev.filter((e) => e.type === "over").length, 1);
  assert.deepEqual(step(s, 1 / 60), []);                    // 끝나면 더 진행 안 함
});

test("옆으로 비키면 적 무리를 피한다", () => {
  const s = empty();
  s.x = -3;
  s.groups.push(makeGroup(s, "mob", 3.5, 20, 30));
  s.groups[0].pool = s.groups[0].unitHp * 30 * 1000;       // 총으로는 안 죽게
  run(s, 4, { targetX: -3.5 });
  assert.equal(s.count, START_SQUAD);
});

test("무기 상자: 다른 무기면 바꾸고, 같은 무기면 레벨 업", () => {
  const s = empty();
  s.crates.push({ id: 1, kind: "weapon", what: "smg", x: 0, d: 12, hp: 1, maxHp: 1 });
  const ev = run(s, 1);
  assert.ok(ev.some((e) => e.type === "weapon"));
  assert.equal(s.weapon, "smg");
  s.crates.push({ id: 2, kind: "weapon", what: "smg", x: 0, d: 12, hp: 1, maxHp: 1 });
  run(s, 1);
  assert.equal(s.level, 2);
  s.level = MAX_LEVEL;
  s.crates.push({ id: 3, kind: "weapon", what: "smg", x: 0, d: 12, hp: 1, maxHp: 1 });
  run(s, 1);
  assert.equal(s.level, MAX_LEVEL);
});

test("철창을 부수면 병사가 늘고, 아이템은 바로 쓴다", () => {
  const s = empty();
  s.cages.push({ id: 1, x: 0, d: 10, hp: 1, maxHp: 1, n: 7 });
  run(s, 1);
  assert.equal(s.count, START_SQUAD + 7);
  s.crates.push({ id: 2, kind: "item", what: "shield", x: 0, d: 10, hp: 1, maxHp: 1 });
  run(s, 1);
  assert.ok(s.invuln > 0);
  s.groups.push(makeGroup(s, "mob", 0, 1.5, 30));
  s.groups[0].pool = s.groups[0].unitHp * 30;
  run(s, 0.5);
  assert.equal(s.count, START_SQUAD + 7);                   // 보호막 동안은 안 잃음
});

test("동료: 의무병은 회복, 방패병은 피해를 나눠 막음", () => {
  const s = empty();
  s.count = 100;
  s.allies.medic = 1;
  run(s, 2.1);
  assert.ok(s.count > 100);
  const a = empty();
  const b = empty();
  for (const t of [a, b]) {
    t.count = 100;
    t.groups.push(makeGroup(t, "mob", 0, 1.5, 20));
  }
  b.allies.shield = 1;
  b.shieldHp = 100;
  run(a, 1.5);
  run(b, 1.5);
  assert.ok(b.count > a.count);
});

test("보스: 거리마다 나오고, 쓰러뜨리면 보상", () => {
  const s = createGame(3);
  s.nextSpawn = 1e9;
  s.dist = BOSS_EVERY - 1;
  s.count = 500;
  const ev = run(s, 0.5);
  assert.ok(ev.some((e) => e.type === "boss") && s.boss);
  s.boss.hp = 1;
  const level = s.level;
  const ev2 = run(s, 6);
  assert.ok(ev2.some((e) => e.type === "boss_down"));
  assert.equal(s.boss, null);
  assert.equal(s.level, level + 1);
  assert.ok(score(s) >= Math.floor(s.dist) + 500);
});

test("보스 폭탄은 비켜 서면 안 맞는다", () => {
  const s = empty();
  s.count = 100;
  s.bombs.push({ x: 3, r: 1.5, t: 0.2, total: 1.3 });
  s.x = -3;
  const ev = run(s, 0.5, { targetX: -3 });
  assert.equal(ev.find((e) => e.type === "bomb").lost, 0);
  s.bombs.push({ x: s.x, r: 1.5, t: 0.2, total: 1.3 });
  const ev2 = run(s, 0.5, { targetX: s.x });
  assert.ok(ev2.find((e) => e.type === "bomb").lost > 0);
});

test("무리는 도로 밖으로 못 나가고, 난이도는 거리에 따라 커진다", () => {
  const s = empty();
  run(s, 3, { dir: 1 });
  assert.ok(s.x + squadRadius(s.count) * 0.7 <= HALF);
  assert.ok(difficulty(2000) > difficulty(1000) && difficulty(1000) > difficulty(0));
});

test("가만히 있어도 언젠가는 끝나고, 값이 망가지지 않는다", () => {
  for (const seed of [1, 2, 3]) {
    const s = createGame(seed);
    while (!s.over && s.t < 1800) {
      step(s, 1 / 30, {});
      assert.ok(Number.isFinite(s.count) && Number.isFinite(s.x) && Number.isFinite(s.dist));
    }
    assert.ok(s.over, `seed ${seed}`);
  }
});
