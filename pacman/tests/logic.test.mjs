// 실행: node --test pacman/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAZE, W, H, PAC_START, HOUSE_EXIT, HOUSE_CENTER, TUNNEL_ROW,
  isOpen, createPellets, createEntity, position, step, reverse,
  chooseGhostDir, ghostTarget, modeAt, DIRS, DIR_ORDER, nextTile,
} from "../web/logic.js";

test("미로는 28x31 이고 모든 줄 길이가 같다", () => {
  assert.equal(W, 28);
  assert.equal(H, 31);
  MAZE.forEach((row, y) => assert.equal(row.length, W, `row ${y}`));
});

test("점 240개 + 파워 점 4개", () => {
  const pellets = [...createPellets().values()];
  assert.equal(pellets.filter((v) => v === "dot").length, 240);
  assert.equal(pellets.filter((v) => v === "power").length, 4);
});

test("팩맨 시작 위치에서 모든 점에 갈 수 있다 (문은 통과 못 함)", () => {
  const seen = new Set([`${PAC_START.x},${PAC_START.y}`]);
  const queue = [PAC_START];
  while (queue.length) {
    const cur = queue.shift();
    for (const d of DIR_ORDER) {
      const n = nextTile({ x: cur.x, y: cur.y }, d);
      const key = `${n.x},${n.y}`;
      if (!seen.has(key) && isOpen(n.x, n.y)) {
        seen.add(key);
        queue.push(n);
      }
    }
  }
  for (const key of createPellets().keys()) assert.ok(seen.has(key), key);
  assert.ok(!seen.has(`${HOUSE_CENTER.x},${HOUSE_CENTER.y}`), "유령 집에는 못 들어감");
});

test("유령 집 문은 door 옵션이 있을 때만 열린다", () => {
  assert.equal(isOpen(13, 12), false);
  assert.equal(isOpen(13, 12, { door: true }), true);
  assert.equal(isOpen(HOUSE_EXIT.x, HOUSE_EXIT.y), true);
});

test("step: 타일 중앙마다 방향을 고르고, 막히면 멈춘다", () => {
  const e = createEntity(1, 1, null);
  step(e, 2.5, () => "right");
  assert.deepEqual([e.x, e.y, e.p], [3, 1, 0.5]);
  assert.deepEqual(position(e), { x: 3.5, y: 1 });

  const wall = createEntity(1, 1, null);
  step(wall, 1, (x) => (isOpen(x.x, x.y - 1) ? "up" : null));
  assert.deepEqual([wall.x, wall.y, wall.dir], [1, 1, null]);
});

test("step: 터널 끝에서 반대편으로 넘어간다", () => {
  const e = createEntity(0, TUNNEL_ROW, null);
  step(e, 1, () => "left");
  assert.deepEqual([e.x, e.y], [W - 1, TUNNEL_ROW]);
});

test("reverse: 타일 중간에서 바로 돌아선다", () => {
  const e = createEntity(1, 1, null);
  step(e, 0.3, () => "right");
  reverse(e);
  assert.equal(e.dir, "left");
  assert.equal(e.x, 2);
  assert.ok(Math.abs(position(e).x - 1.3) < 1e-9);
});

test("유령은 뒤로 돌지 않고 목표에 가까운 쪽으로 간다", () => {
  // (6,5) 갈림길에서 오른쪽으로 오던 유령: 뒤(왼쪽) 제외, 목표가 아래면 아래
  const g = { x: 6, y: 5, dir: "right", p: 0 };
  assert.equal(chooseGhostDir(g, { x: 6, y: 20 }), "down");
  assert.notEqual(chooseGhostDir(g, { x: 0, y: 5 }), "left");
  const rnd = chooseGhostDir(g, { x: 0, y: 0 }, () => 0.99);
  assert.ok(["up", "down", "right"].includes(rnd));
});

test("유령 목표: pinky 4칸 앞, inky 는 blinky 를 뒤집은 곳, clyde 는 가까우면 구석", () => {
  const pac = { x: 10, y: 10 };
  const ctx = { pac, pacDir: "left", self: { x: 0, y: 0 }, blinky: { x: 12, y: 10 } };
  assert.deepEqual(ghostTarget("pinky", "chase", ctx), { x: 6, y: 10 });
  assert.deepEqual(ghostTarget("inky", "chase", ctx), { x: 4, y: 10 });
  assert.deepEqual(ghostTarget("clyde", "chase", { ...ctx, self: { x: 11, y: 10 } }), { x: 0, y: 31 });
  assert.deepEqual(ghostTarget("clyde", "chase", { ...ctx, self: { x: 25, y: 29 } }), pac);
  assert.deepEqual(ghostTarget("blinky", "scatter", ctx), { x: 25, y: -3 });
});

test("모드 일정: 흩어지기 7초 → 쫓기 20초 → …", () => {
  assert.equal(modeAt(0), "scatter");
  assert.equal(modeAt(6.9), "scatter");
  assert.equal(modeAt(7), "chase");
  assert.equal(modeAt(27), "scatter");
  assert.equal(modeAt(10_000), "chase");
  assert.equal(modeAt(7, [10, 15, Infinity]), "scatter");   // 난이도별 시간표
  assert.equal(modeAt(10, [10, 15, Infinity]), "chase");
});

test("DIRS 와 DIR_ORDER 가 일치한다", () => {
  assert.deepEqual(Object.keys(DIRS).sort(), [...DIR_ORDER].sort());
});
