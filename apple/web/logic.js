// 사과게임 규칙 (화면과 분리된 순수 로직, DOM 없음). 원조 Fruit Box 기준.
// 판은 가로 17 × 세로 10, 사과마다 1~9. 네모로 묶은 사과 숫자 합이 딱 10이면 사라지고 1개당 1점.
// 지운 칸은 빈칸(0)으로 남고, 위에서 떨어지거나 새로 채워지지 않는다. 시간은 2분.

export const COLS = 17;
export const ROWS = 10;
export const TIME = 120;             // 한 판 시간(초)
export const TARGET = 10;            // 지워지는 합

// ---- 난수 (시드 고정) ----

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 새 판 (원조처럼 전체 합이 10의 배수인 판만)
export function createBoard(seed) {
  const rand = makeRng(seed);
  for (;;) {
    const cells = Array.from({ length: ROWS * COLS }, () => 1 + Math.floor(rand() * 9));
    if (cells.reduce((a, b) => a + b, 0) % TARGET === 0) return cells;
  }
}

// 한 판 상태
export function createGame(seed) {
  return { cells: createBoard(seed), score: 0, left: TIME, over: false };
}

// 네모 범위 정리 (두 모서리 칸 → 위·아래·왼·오른 경계, 판 밖은 잘라냄)
export function normRect(r0, c0, r1, c1) {
  return {
    top: Math.max(0, Math.min(r0, r1)), bottom: Math.min(ROWS - 1, Math.max(r0, r1)),
    left: Math.max(0, Math.min(c0, c1)), right: Math.min(COLS - 1, Math.max(c0, c1)),
  };
}

// 네모 안의 사과 (빈칸 제외)와 합
export function select(cells, rect) {
  const picked = [];
  let sum = 0;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      const v = cells[r * COLS + c];
      if (v) {
        picked.push(r * COLS + c);
        sum += v;
      }
    }
  }
  return { picked, sum };
}

// 지우기 시도 (합이 10이면 지우고 지운 칸 목록, 아니면 빈 목록)
export function clear(s, rect) {
  if (s.over) return [];
  const { picked, sum } = select(s.cells, rect);
  if (sum !== TARGET) return [];
  for (const i of picked) s.cells[i] = 0;
  s.score += picked.length;
  if (s.score === ROWS * COLS) s.over = true;
  return picked;
}

// 시간 흘리기
export function tick(s, dt) {
  if (s.over) return;
  s.left = Math.max(0, s.left - dt);
  if (s.left === 0) s.over = true;
}

// 아직 지울 수 있는 네모가 있는지 (누적합으로 모든 네모 확인)
export function hasMove(cells) {
  const P = new Int32Array((ROWS + 1) * (COLS + 1));
  const at = (r, c) => r * (COLS + 1) + c;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) P[at(r + 1, c + 1)] = cells[r * COLS + c] + P[at(r, c + 1)] + P[at(r + 1, c)] - P[at(r, c)];
  }
  for (let t = 0; t < ROWS; t++) {
    for (let b = t; b < ROWS; b++) {
      for (let l = 0; l < COLS; l++) {
        for (let rr = l; rr < COLS; rr++) {
          const sum = P[at(b + 1, rr + 1)] - P[at(t, rr + 1)] - P[at(b + 1, l)] + P[at(t, l)];
          if (sum === TARGET) return true;
          if (sum > TARGET) break;
        }
      }
    }
  }
  return false;
}
