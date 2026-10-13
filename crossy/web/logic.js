// 길건너기 규칙 (화면과 분리된 순수 로직, DOM 없음).
// 좌표: x 는 가로 칸(-W ~ W, 왼쪽 -), z 는 앞으로 간 줄 수(시작 0, 앞이 +). 한 칸 = 1.
// 한 판 상태는 createGame() 이 만들고, move() 로 한 칸 뛰고, step() 이 시간을 흘리며 사건 목록을 돌려준다.

export const W = 4;                  // 걸어 다닐 수 있는 가로 칸 (-4 ~ 4, 9칸)
export const SPAN = 13;              // 차·통나무가 오가는 가로 범위 (화면 밖까지)
export const HOP_TIME = 0.11;        // 한 칸 뛰는 데 걸리는 시간(초)
export const BACK_LIMIT = 3;         // 가장 멀리 간 줄에서 이만큼 뒤로 가면 독수리
export const EDGE_LAG = 4;           // 화면 아래 끝이 가장 멀리 간 줄에서 이만큼 뒤까지만 처짐
export const CREEP = 0.42;           // 화면이 스스로 올라오는 속도(줄/초), 가만히 있으면 독수리
export const AHEAD = 28;             // 미리 만들어 두는 줄 수
const PLAYER_HALF = 0.32;            // 닭 몸 반폭 (부딪힘 판정)
const TRAIN_SPEED = 26;
const TRAIN_LEN = 12;
const WARN_TIME = 1.1;               // 기차 오기 전 경고등

export const CAR_COLORS = [0xe8473f, 0x3f8ee8, 0xf2c14e, 0x6cc551, 0xb06ee8, 0xf28c38, 0xeeeeee];

// ---- 난수 (시드 고정) ----

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// 앞으로 갈수록 빨라지는 배율 (1 → 최대 2)
export function pace(z) {
  return 1 + Math.min(1, Math.max(0, z) / 220);
}

// ---- 줄 만들기 ----

function grassRow(s, z, safe = false) {
  const r = s.rng;
  const blocks = new Set();
  for (let x = -SPAN; x <= SPAN; x++) {
    if (Math.abs(x) > W) {
      if (r.next() < 0.75) blocks.add(x);                       // 걸을 수 없는 바깥은 숲
    } else if (!safe && r.next() < 0.13) blocks.add(x);
  }
  // 막힌 칸이 너무 많으면 몇 개 비우기 (걸을 칸은 늘 7칸 이상)
  const inside = [...blocks].filter((x) => Math.abs(x) <= W);
  while (inside.length > 2) blocks.delete(inside.splice(r.int(0, inside.length - 1), 1)[0]);  const kinds = {};
  for (const x of blocks) kinds[x] = r.next() < 0.75 ? "tree" : "rock";
  return { z, type: "grass", blocks, kinds, coins: coinsFor(s, blocks) };
}

function coinsFor(s, blocks = new Set()) {
  const coins = new Set();
  for (let x = -W; x <= W; x++) if (!blocks.has(x) && s.rng.next() < 0.04) coins.add(x);
  return coins;
}

// 칸을 따라 오가는 것들 놓기 (길이, 간격 범위)
function lineUp(r, lenFn, gapLo, gapHi) {
  const items = [];
  let x = -SPAN + r.range(0, gapHi);
  while (x < SPAN) {
    const len = lenFn();
    items.push({ x: x + len / 2, len });
    x += len + r.range(gapLo, gapHi);
  }
  return items;
}

function roadRow(s, z) {
  const r = s.rng;
  const p = pace(z);
  const truck = r.next() < 0.3;
  const cars = lineUp(r, () => (truck ? 2.4 : 1.4), 2.5 / Math.sqrt(p), 6.5 / Math.sqrt(p));
  for (const c of cars) c.color = r.pick(CAR_COLORS);
  return {
    z, type: "road", dir: r.next() < 0.5 ? 1 : -1, speed: r.range(1.4, 3.2) * p * (truck ? 0.8 : 1),
    truck, cars, coins: coinsFor(s),
  };
}

function railRow(s, z) {
  return { z, type: "rail", dir: s.rng.next() < 0.5 ? 1 : -1, train: null, wait: s.rng.range(1.5, 6) / pace(z), warn: 0, coins: new Set() };
}

function riverRow(s, z, prev) {
  const r = s.rng;
  const p = pace(z);
  // 땅 다음 강은 가끔 연잎 줄 (움직이지 않음)
  if (prev.type !== "river" && r.next() < 0.22) {
    const pads = new Set();
    for (let x = -W; x <= W; x++) if (r.next() < 0.45) pads.add(x);
    if (pads.size < 2) pads.add(r.int(-W, W));
    return { z, type: "river", pads, logs: [], dir: 1, speed: 0, coins: new Set() };
  }
  const dir = prev.type === "river" && prev.speed ? -prev.dir : r.next() < 0.5 ? 1 : -1;     // 이어진 강은 번갈아
  const logs = lineUp(r, () => r.int(2, 4), 1.2, 3.4);
  return { z, type: "river", pads: new Set(), logs, dir, speed: r.range(1, 2.1) * Math.sqrt(p), coins: new Set() };
}

// 다음 묶음 (풀밭 사이에 도로·철길·강 묶음)
function nextChunk(s) {
  const r = s.rng;
  const z = s.rows.length ? s.rows[s.rows.length - 1].z + 1 : 0;
  const p = pace(z);
  const prev = s.rows[s.rows.length - 1];
  if (prev.type !== "grass") {
    for (let i = r.int(1, 2); i > 0; i--) s.rows.push(grassRow(s, s.rows[s.rows.length - 1].z + 1));
    return;
  }
  const roll = r.next();
  if (roll < 0.45) {
    const n = r.int(1, Math.min(5, 2 + Math.floor(p * 1.5)));
    for (let i = 0; i < n; i++) s.rows.push(roadRow(s, z + i));
  } else if (roll < 0.62 && z > 6) {
    const n = r.int(1, p > 1.4 ? 2 : 1);
    for (let i = 0; i < n; i++) s.rows.push(railRow(s, z + i));
  } else if (z > 4) {
    const n = r.int(1, Math.min(4, 1 + Math.floor(p * 1.5)));
    for (let i = 0; i < n; i++) s.rows.push(riverRow(s, z + i, s.rows[s.rows.length - 1]));
  } else {
    s.rows.push(grassRow(s, z));
  }
}

export function rowAt(s, z) {
  const first = s.rows[0]?.z ?? 0;
  return s.rows[z - first] || null;
}

// ---- 한 판 ----

export function createGame(seed = Date.now()) {
  const s = {
    seed, rng: makeRng(seed), t: 0, rows: [],
    x: 0, z: 0, maxZ: 0, score: 0, coins: 0,
    fromX: 0, fromZ: 0,               // 이번 뛰기를 시작한 자리 (뛰는 동안 판정용)
    hop: 0, queue: null, facing: "up", started: false,
    edge: -EDGE_LAG, over: false, cause: null, log: null,
  };
  for (let z = -8; z <= 3; z++) s.rows.push(grassRow(s, z, z >= -1));   // 출발점 근처는 비워 둠
  while (s.rows[s.rows.length - 1].z < AHEAD) nextChunk(s);
  return s;
}

const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

// 한 칸 뛰기 (뛰는 중이면 하나만 미리 받아 둠). 움직였으면 true
export function move(s, dir, events = []) {
  if (s.over || !DIRS[dir]) return false;
  if (s.hop > 0) {
    s.queue = dir;
    return false;
  }
  const [dx, dz] = DIRS[dir];
  s.facing = dir;
  const target = rowAt(s, s.z + dz);
  if (!target) return false;
  const from = rowAt(s, s.z);
  const base = from?.type === "river" ? s.x : Math.round(s.x);
  let tx = base + dx;
  if (target.type !== "river") {
    tx = Math.round(tx);
    if (Math.abs(tx) > W) return false;
    if (target.type === "grass" && target.blocks.has(tx)) return false;           // 나무·바위
  } else if (Math.abs(tx) > W + 0.4) return false;
  s.fromX = s.x;
  s.fromZ = s.z;
  s.x = tx;
  s.z += dz;
  s.hop = HOP_TIME;
  s.started = true;
  s.log = null;
  events.push({ type: "hop", dir, x: s.x, z: s.z });
  if (s.z > s.maxZ) {
    s.maxZ = s.z;
    s.score = s.maxZ;
  }
  const cell = Math.round(s.x);
  if (target.coins?.has(cell) && target.type !== "river") {
    target.coins.delete(cell);
    s.coins += 1;
    events.push({ type: "coin", x: cell, z: s.z });
  }
  if (s.z <= s.maxZ - BACK_LIMIT) die(s, "eagle", events);                        // 너무 뒤로
  return true;
}

function die(s, cause, events) {
  if (s.over) return;
  s.over = true;
  s.cause = cause;
  events.push({ type: "over", cause, x: s.x, z: s.z });
}

// 오가는 것 옮기기 (화면 밖으로 나가면 반대편에서 다시)
function slide(items, dir, speed, dt) {
  for (const it of items) {
    it.x += dir * speed * dt;
    if (dir > 0 && it.x - it.len / 2 > SPAN) it.x -= 2 * SPAN + it.len;
    if (dir < 0 && it.x + it.len / 2 < -SPAN) it.x += 2 * SPAN + it.len;
  }
}

function overlaps(items, x, half) {
  return items.some((it) => Math.abs(it.x - x) < it.len / 2 + half);
}

// 시간 흘리기
export function step(s, dt) {
  const events = [];
  if (s.over) return events;
  s.t += dt;
  // 뛰기
  if (s.hop > 0) {
    s.hop = Math.max(0, s.hop - dt);
    if (s.hop === 0 && s.queue) {
      const q = s.queue;
      s.queue = null;
      move(s, q, events);
    }
  }
  traffic(s, dt, events);
  // 강: 통나무를 타고 떠내려감, 아무것도 없으면 빠짐
  const here = rowAt(s, s.z);
  if (here?.type === "river" && s.hop === 0) {
    const log = here.logs.find((l) => Math.abs(l.x - s.x) < l.len / 2);
    const pad = here.pads.has(Math.round(s.x)) && Math.abs(Math.round(s.x) - s.x) < 0.45;
    if (log) {
      if (s.log !== log) {                                     // 처음 올라탔으면 통나무 칸에 맞춰 섬
        const left = log.x - log.len / 2 + 0.5;
        s.x = left + Math.max(0, Math.min(log.len - 1, Math.round(s.x - left)));
        s.log = log;
        events.push({ type: "land", on: "log" });
      }
      s.x += here.dir * here.speed * dt;
      if (Math.abs(s.x) > W + 0.6) die(s, "river", events);   // 화면 밖으로 떠내려감
    } else if (pad) {
      s.x = Math.round(s.x);
    } else {
      die(s, "water", events);
    }
  }
  // 차·기차에 부딪힘 (뛰는 중이면 화면에 보이는 자리로: 앞 절반은 떠난 줄, 뒤 절반은 갈 줄)
  const k = s.hop > 0 ? 1 - s.hop / HOP_TIME : 1;
  const hitRow = rowAt(s, k < 0.5 ? s.fromZ : s.z);
  const hitX = s.fromX + (s.x - s.fromX) * k;
  if (hitRow?.type === "road" && overlaps(hitRow.cars, hitX, PLAYER_HALF)) die(s, "car", events);
  if (hitRow?.type === "rail" && hitRow.train && overlaps([hitRow.train], hitX, PLAYER_HALF)) die(s, "train", events);
  // 화면 아래 끝이 올라옴 (가만히 있거나 처지면 독수리)
  if (s.started) s.edge = Math.max(s.edge + CREEP * Math.sqrt(pace(s.maxZ)) * dt, s.maxZ - EDGE_LAG);
  if (s.z < s.edge) die(s, "eagle", events);
  // 앞쪽 줄 만들기, 뒤쪽 줄 치우기
  while (s.rows[s.rows.length - 1].z < s.maxZ + AHEAD) nextChunk(s);
  while (s.rows[0].z < s.edge - 10) s.rows.shift();
  return events;
}

// 차·기차·통나무 움직임 (죽은 뒤에도 화면에서 계속 지나가게 따로 부름)
export function traffic(s, dt, events = []) {
  for (const row of s.rows) {
    if (row.type === "road") slide(row.cars, row.dir, row.speed, dt);
    else if (row.type === "river" && row.speed) slide(row.logs, row.dir, row.speed, dt);
    else if (row.type === "rail") rail(s, row, dt, events);
  }
  return events;
}

// 철길: 기다림 → 경고등 → 기차 지나감
function rail(s, row, dt, events) {
  if (row.train) {
    row.train.x += row.dir * TRAIN_SPEED * dt;
    if (Math.abs(row.train.x) > SPAN + TRAIN_LEN) {
      row.train = null;
      row.wait = s.rng.range(2, 6) / pace(row.z);
    }
    return;
  }
  row.wait -= dt;
  if (row.wait <= WARN_TIME && !row.warn) {
    row.warn = 1;
    if (Math.abs(row.z - s.z) < 10) events.push({ type: "warn", z: row.z });
  }
  if (row.wait <= 0) {
    row.warn = 0;
    row.train = { x: -row.dir * (SPAN + TRAIN_LEN / 2), len: TRAIN_LEN };
  }
}
