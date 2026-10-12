// 실행: node --test crossy/tests/logic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { BACK_LIMIT, HOP_TIME, W, createGame, move, rowAt, step } from "../web/logic.js";

function run(s, seconds) {
  const events = [];
  for (let t = 0; t < seconds && !s.over; t += 1 / 60) events.push(...step(s, 1 / 60));
  return events;
}

// 시험용으로 줄 하나를 원하는 모양으로 바꾸기
function setRow(s, z, row) {
  const i = s.rows.findIndex((r) => r.z === z);
  s.rows[i] = { z, coins: new Set(), ...row };
  return s.rows[i];
}
const grass = (blocks = []) => ({ type: "grass", blocks: new Set(blocks), kinds: {} });

test("같은 시드면 같은 길", () => {
  const a = createGame(3);
  const b = createGame(3);
  assert.deepEqual(a.rows.map((r) => r.type), b.rows.map((r) => r.type));
});

test("출발점 근처는 비어 있고, 풀밭 줄은 늘 5칸 이상 걸을 수 있다", () => {
  const s = createGame(1);
  for (let z = -1; z <= 3; z++) assert.equal(rowAt(s, z).type, "grass");
  assert.equal(rowAt(s, 0).blocks.has(0), false);
  for (let seed = 1; seed < 30; seed++) {
    for (const r of createGame(seed).rows.filter((r) => r.type === "grass")) {
      let open = 0;
      for (let x = -W; x <= W; x++) if (!r.blocks.has(x)) open++;
      assert.ok(open >= 5);
    }
  }
});

test("한 칸씩 뛰고, 나무와 가장자리는 못 지나간다", () => {
  const s = createGame(2);
  setRow(s, 1, grass([0]));
  assert.equal(move(s, "up"), false);                        // 앞에 나무
  assert.equal(move(s, "left"), true);
  assert.equal(s.x, -1);
  run(s, HOP_TIME + 0.02);
  assert.equal(move(s, "up"), true);
  assert.deepEqual([s.x, s.z, s.score], [-1, 1, 1]);
  const t = createGame(2);
  t.x = W;
  assert.equal(move(t, "right"), false);                     // 가장자리
});

test("뛰는 중에 누른 건 하나만 미리 받아 둔다", () => {
  const s = createGame(4);
  for (const z of [1, 2, 3]) setRow(s, z, grass());
  move(s, "up");
  move(s, "up");
  move(s, "up");
  run(s, HOP_TIME * 3);
  assert.equal(s.z, 2);
});

test("차에 부딪히면 끝", () => {
  const s = createGame(5);
  setRow(s, 1, { type: "road", dir: 1, speed: 3, truck: false, cars: [{ x: -1.5, len: 1.4, color: 0 }] });
  move(s, "up");
  const ev = run(s, 2);
  assert.ok(s.over && s.cause === "car");
  assert.ok(ev.some((e) => e.type === "over"));
});

test("통나무를 타면 떠내려가고, 물에 떨어지면 빠진다", () => {
  const s = createGame(6);
  const river = setRow(s, 1, { type: "river", dir: 1, speed: 1, pads: new Set(), logs: [{ x: 0, len: 3 }] });
  move(s, "up");
  run(s, 0.5);
  assert.ok(!s.over && s.x > 0.3);                           // 통나무와 같이 움직임
  river.logs = [{ x: 12, len: 2 }];                          // 통나무를 치우면
  run(s, 0.2);
  assert.ok(s.over && s.cause === "water");
  const t = createGame(6);
  setRow(t, 1, { type: "river", dir: 1, speed: 4, pads: new Set(), logs: [{ x: 3, len: 4 }] });
  t.x = 3;
  move(t, "up");
  run(t, 3);
  assert.equal(t.cause, "river");                            // 화면 밖으로 떠내려감
});

test("연잎 위에는 서 있을 수 있다", () => {
  const s = createGame(7);
  setRow(s, 1, { type: "river", dir: 1, speed: 0, pads: new Set([0]), logs: [] });
  move(s, "up");
  run(s, 1);
  assert.ok(!s.over);
});

test("기차는 경고 뒤에 지나가고, 철길에 서 있으면 치인다", () => {
  const s = createGame(8);
  setRow(s, 1, { type: "rail", dir: 1, train: null, wait: 1.2, warn: 0 });
  move(s, "up");
  const ev = run(s, 3);
  assert.ok(ev.some((e) => e.type === "warn"));
  assert.equal(s.cause, "train");
});

test("독수리: 뒤로 세 칸, 또는 가만히 오래 있으면", () => {
  const s = createGame(9);
  for (const z of [-3, -2, -1, 1]) setRow(s, z, grass());
  for (let i = 0; i < BACK_LIMIT; i++) {
    move(s, "down");
    run(s, HOP_TIME + 0.02);
  }
  assert.equal(s.cause, "eagle");
  const t = createGame(9);
  setRow(t, 1, grass());
  move(t, "up");
  run(t, 30);
  assert.equal(t.cause, "eagle");
});

test("동전을 주우면 모인다", () => {
  const s = createGame(10);
  setRow(s, 1, { ...grass(), coins: new Set([0]) });
  const ev = [];
  move(s, "up", ev);
  assert.equal(s.coins, 1);
  assert.ok(ev.some((e) => e.type === "coin"));
});

test("앞으로 갈수록 줄이 계속 생기고, 지나간 줄은 치운다", () => {
  const s = createGame(11);
  s.maxZ = 200;
  s.z = 200;
  s.edge = 190;
  step(s, 1 / 60);
  assert.ok(s.rows[s.rows.length - 1].z >= 228);
  assert.ok(s.rows[0].z >= 180);
  const types = new Set(s.rows.map((r) => r.type));
  assert.ok(types.size >= 3);
});
