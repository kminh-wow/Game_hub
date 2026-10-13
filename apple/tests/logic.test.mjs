// 실행: node --test apple/tests/logic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { COLS, ROWS, TIME, clear, createBoard, createGame, hasMove, normRect, select, tick } from "../web/logic.js";

test("판은 17×10, 1~9, 합은 10의 배수, 같은 시드면 같은 판", () => {
  for (let seed = 1; seed < 20; seed++) {
    const b = createBoard(seed);
    assert.equal(b.length, COLS * ROWS);
    assert.ok(b.every((v) => v >= 1 && v <= 9));
    assert.equal(b.reduce((a, v) => a + v, 0) % 10, 0);
  }
  assert.deepEqual(createBoard(5), createBoard(5));
});

test("합이 10이면 지우고 1개당 1점, 아니면 그대로", () => {
  const s = createGame(1);
  s.cells.fill(5);
  s.cells[0] = 3;
  s.cells[1] = 7;
  assert.deepEqual(clear(s, normRect(0, 0, 0, 2)), []);      // 3+7+5
  assert.deepEqual(clear(s, normRect(0, 1, 0, 0)), [0, 1]);   // 거꾸로 그려도 같음
  assert.equal(s.score, 2);
  assert.equal(s.cells[0], 0);
});

test("빈칸은 0이라 건너서 묶을 수 있다", () => {
  const s = createGame(2);
  s.cells.fill(9);
  s.cells[COLS] = 4;
  s.cells[COLS + 1] = 0;
  s.cells[COLS + 2] = 0;
  s.cells[COLS + 3] = 6;
  assert.deepEqual(select(s.cells, normRect(1, 0, 1, 3)).sum, 10);
  assert.equal(clear(s, normRect(1, 0, 1, 3)).length, 2);
  assert.equal(s.score, 2);
});

test("판 밖으로 그린 네모는 잘라낸다", () => {
  assert.deepEqual(normRect(-3, 20, 2, 15), { top: 0, bottom: 2, left: 15, right: COLS - 1 });
});

test("2분이 지나면 끝, 끝나면 못 지운다", () => {
  const s = createGame(3);
  tick(s, TIME - 1);
  assert.equal(s.over, false);
  tick(s, 2);
  assert.ok(s.over && s.left === 0);
  s.cells[0] = 4;
  s.cells[1] = 6;
  assert.deepEqual(clear(s, normRect(0, 0, 0, 1)), []);
});

test("다 지우면 끝", () => {
  const s = createGame(4);
  s.cells.fill(0);
  s.cells[5] = 1;
  s.cells[6] = 9;
  s.score = ROWS * COLS - 2;
  clear(s, normRect(0, 5, 0, 6));
  assert.ok(s.over);
});

test("지울 수 있는 네모가 남았는지", () => {
  const cells = new Array(ROWS * COLS).fill(0);
  assert.equal(hasMove(cells), false);
  cells[0] = 9;
  cells[COLS * 9 + 16] = 1;                                    // 대각선 끝과 끝: 둘 다 든 네모는 판 전체
  assert.equal(hasMove(cells), true);
  cells[COLS] = 5;                                             // 9+5+1 → 다른 조합 없음
  assert.equal(hasMove(cells), false);
  assert.equal(hasMove(createBoard(7)), true);
});
