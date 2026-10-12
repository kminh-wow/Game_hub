// 탁구 규칙과 공 물리 (화면과 분리된 순수 로직, DOM 없음).
// 좌표(m): x 는 탁구대 가로(왼쪽 -), y 는 탁구대 윗면에서의 높이, z 는 길이 방향(내 쪽 +, AI 쪽 -). 네트는 z = 0.
// 한 판 상태는 createMatch() 가 만들고, step(state, dt, input) 이 시간을 흘리며 사건 목록을 돌려준다.

export const HALF_L = 1.37;          // 탁구대 길이의 절반
export const HALF_W = 0.7625;        // 탁구대 폭의 절반
export const NET_H = 0.1525;
export const NET_OUT = 0.1525;       // 네트가 탁구대 옆으로 나온 길이
export const BALL_R = 0.02;
export const FLOOR_Y = -0.76;
export const REACH = 0.3;            // 라켓 가운데에서 공까지 칠 수 있는 가로 거리
export const SMASH_Y = 0.38;         // 이보다 높이 뜬 공은 스매시할 수 있다
export const WIN_SCORE = 11;
export const ME = "me";
export const AI = "ai";

const G = 9.81;
const DRAG = 0.12;
const MAGNUS = 0.006;
const SPIN_DECAY = 0.3;              // 1초에 줄어드는 회전 비율
const TABLE_E = 0.88;                // 탁구대 반발
const TABLE_GRIP = 0.25;             // 튈 때 회전이 앞뒤 속도로 바뀌는 정도
const SUB = 1 / 240;
const DEAD_TIME = 1.1;               // 점수 난 뒤 다음 서브까지
const BOT_SERVE_WAIT = 1.9;           // AI 가 서브 들고 기다리는 시간 (점수 난 뒤 1.1초 + 이만큼 = 3초, 받을 자리 잡기)
const PAD_SPEED = 16;                // 사람 라켓이 손을 따라가는 최대 속도(m/s)
const PLAYER_ERROR = 0.04;           // 사람 샷 기본 흔들림(m)
const MAX_FLIGHT = 5;

// 라켓이 움직일 수 있는 곳 (내 쪽 기준, AI 쪽은 z 를 뒤집음)
export const ZONE = { x: 1.25, near: 0.7, far: HALF_L + 0.85, home: HALF_L + 0.4 };   // near: 짧은 공은 탁구대 위로 손을 뻗어 받음

// 샷: 가로 속도(m/s), 회전(+ 탑스핀, - 백스핀, rad/s), 네트에서 떨어지는 거리(m) — [힘 0, 힘 1]
export const SHOTS = {
  drive: { name: "드라이브", speed: [6, 10.5], top: [60, 120], depth: [0.85, 1.15] },
  smash: { name: "스매시", speed: [10, 14], top: [15, 30], depth: [0.9, 1.15] },
  block: { name: "블록", speed: [4.5, 4.5], top: [10, 10], depth: [0.8, 0.8] },
  cut: { name: "커트", speed: [4.2, 5.3], top: [-50, -90], depth: [0.6, 0.95] },
};

// AI 난이도: 라켓 속도(m/s), 반응 시간(s), 샷 흔들림(m), 평소 힘, 높은 공 스매시 확률, 노리는 폭, 짧은 서브 확률
export const LEVELS = [
  { name: "하", speed: 1.6, reaction: 0.36, error: 0.34, power: 0.1, smash: 0.1, aim: 0.25, short: 0 },
  { name: "중", speed: 2.2, reaction: 0.26, error: 0.26, power: 0.3, smash: 0.3, aim: 0.38, short: 0.08 },
  { name: "상", speed: 3.2, reaction: 0.15, error: 0.12, power: 0.65, smash: 0.75, aim: 0.55, short: 0.15 },
];

// 점수 난 이유
export const REASONS = {
  net: "네트",
  out: "아웃",
  missed: "못 받음",
  own_side: "내 코트에 떨어짐",
  serve_fault: "서브 실패",
  slow: "시간 초과",
  volley: "바운드 전에 침",
};

export const dirOf = (side) => (side === ME ? 1 : -1);   // 그 사람 쪽 z 부호
export const other = (side) => (side === ME ? AI : ME);
export const sideOfZ = (z) => (z >= 0 ? ME : AI);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- 난수 (시드 고정) ----

// 시드 난수 생성기
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

// 정규분포 난수
function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
}

// ---- 공 물리 ----

// 새 공
export function newBall() {
  return { p: { x: 0, y: 0.3, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
}

// 공 복사
function copyBall(b) {
  return { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
}

// 가로 진행 방향 (단위 벡터)
function heading(v) {
  const s = Math.hypot(v.x, v.z) || 1e-9;
  return { x: v.x / s, z: v.z / s };
}

// 진행 방향 기준 회전 → 회전 벡터 (top: 탑스핀, side: 옆회전)
export function spinVec(d, top, side = 0) {
  return { x: d.z * top, y: side, z: -d.x * top };
}

// 회전 벡터에서 탑스핀 성분 (진행 방향 기준, 백스핀은 -)
export function topOf(w, d) {
  return w.x * d.z - w.z * d.x;
}

// 공 날기 (중력·공기 저항·회전에 따른 휨)
function fly(b, h) {
  const { v, w } = b;
  const sp = Math.hypot(v.x, v.y, v.z);
  v.x += (-DRAG * sp * v.x + MAGNUS * (w.y * v.z - w.z * v.y)) * h;
  v.y += (-G - DRAG * sp * v.y + MAGNUS * (w.z * v.x - w.x * v.z)) * h;
  v.z += (-DRAG * sp * v.z + MAGNUS * (w.x * v.y - w.y * v.x)) * h;
  b.p.x += v.x * h;
  b.p.y += v.y * h;
  b.p.z += v.z * h;
  const keep = 1 - SPIN_DECAY * h;
  w.x *= keep;
  w.y *= keep;
  w.z *= keep;
}

// 탁구대·네트·바닥 부딪힘 (부딪힌 것 이름 또는 null)
function collide(b, prev) {
  const { p, v, w } = b;
  if (prev.z !== 0 && (prev.z > 0) !== (p.z > 0)) {
    const t = prev.z / (prev.z - p.z);
    const y = prev.y + (p.y - prev.y) * t;
    const x = prev.x + (p.x - prev.x) * t;
    if (y < NET_H + BALL_R && y > -BALL_R && Math.abs(x) < HALF_W + NET_OUT) {
      p.z = Math.sign(prev.z) * BALL_R;
      v.z *= -0.15;
      v.x *= 0.5;
      v.y *= 0.5;
      w.x *= 0.3;
      w.y *= 0.3;
      w.z *= 0.3;
      return "net";
    }
  }
  if (p.y < BALL_R && prev.y >= BALL_R && v.y < 0 && Math.abs(p.x) <= HALF_W && Math.abs(p.z) <= HALF_L) {
    p.y = 2 * BALL_R - p.y;
    v.y = -v.y * TABLE_E;
    const sx = v.x + w.z * BALL_R;                // 닿는 점의 미끄러지는 속도
    const sz = v.z - w.x * BALL_R;
    v.x -= TABLE_GRIP * sx;
    v.z -= TABLE_GRIP * sz;
    w.x *= 0.6;
    w.y *= 0.6;
    w.z *= 0.6;
    return "table";
  }
  if (p.y < FLOOR_Y + BALL_R && v.y < 0) {
    p.y = FLOOR_Y + BALL_R;
    v.y = -v.y * 0.55;
    v.x *= 0.8;
    v.z *= 0.8;
    return "floor";
  }
  if (Math.abs(p.z) > 6 || Math.abs(p.x) > 5) {
    v.x = v.y = v.z = 0;
    return "away";
  }
  return null;
}

// 공 미리 날려 보기 (onStep 이 true 를 돌려주면 멈춤, free 면 아무것에도 안 부딪힘)
export function simulate(ball, maxT, onStep, free = false) {
  const b = copyBall(ball);
  for (let t = 0; t < maxT; t += SUB) {
    const prev = { ...b.p };
    fly(b, SUB);
    const hit = free ? null : collide(b, prev);
    if (onStep(b, hit, prev, t) || hit === "floor" || hit === "away") break;
  }
  return b;
}

// 처음 탁구대 높이에 내려앉는 곳 (네트·탁구대 무시) + 네트 지날 때 높이
function landing(p0, v, w) {
  let netY = Infinity;
  let land = null;
  simulate({ p: p0, v, w }, 3, (b, _, prev) => {
    if (prev.z !== 0 && (prev.z > 0) !== (b.p.z > 0)) netY = Math.min(netY, b.p.y);
    if (b.p.y <= BALL_R && b.v.y < 0) {
      land = { x: b.p.x, z: b.p.z };
      return true;
    }
    return b.p.y < FLOOR_Y;
  }, true);
  return { ...(land || { x: p0.x + v.x * 3, z: p0.z + v.z * 3 }), netY };
}

// 원하는 곳에 떨어지게 하는 처음 속도 (가로 속도·회전은 정해 두고 위아래 속도를 찾음)
export function aimVelocity(p0, target, speed, top, side = 0) {
  const aim = { x: target.x, z: target.z };
  let out = null;
  for (let k = 0; k < 3; k++) {
    const dx = aim.x - p0.x;
    const dz = aim.z - p0.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const d = { x: dx / dist, z: dz / dist };
    const w = spinVec(d, top, side);
    let lo = -5;
    let hi = Math.min(7, speed * 0.9);
    for (let i = 0; i < 28; i++) {
      const vy = (lo + hi) / 2;
      const r = landing(p0, { x: d.x * speed, y: vy, z: d.z * speed }, w);
      if ((r.x - p0.x) * d.x + (r.z - p0.z) * d.z < dist) lo = vy;
      else hi = vy;
    }
    const v = { x: d.x * speed, y: (lo + hi) / 2, z: d.z * speed };
    const r = landing(p0, v, w);
    out = { v, w, land: r, netY: r.netY };
    aim.x += target.x - r.x;
    aim.z += target.z - r.z;
  }
  return out;
}

// ---- 라켓 ----

// 새 라켓 (기다리는 자리)
function newPaddle(side) {
  const z = dirOf(side) * ZONE.home;
  return { x: 0, z, px: 0, pz: z, vx: 0, vz: 0 };
}

// 라켓이 갈 수 있는 곳으로 자르기 (서브할 때는 탁구대 끝선 뒤, 탁구대 폭 안)
export function clampZone(side, x, z, serving = false) {
  const s = dirOf(side);
  const w = serving ? HALF_W - 0.05 : ZONE.x;
  return [clamp(x, -w, w), s * clamp(z * s, serving ? HALF_L + 0.15 : ZONE.near, ZONE.far)];
}

// 라켓 옮기기 (목표 쪽으로, 최대 속도 안에서) + 휘두르는 속도
function movePaddle(pad, tx, tz, maxSpeed, dt) {
  const dx = tx - pad.x;
  const dz = tz - pad.z;
  const dist = Math.hypot(dx, dz);
  const len = Math.min(dist, maxSpeed * dt);
  pad.px = pad.x;
  pad.pz = pad.z;
  if (dist > 1e-9) {
    pad.x += (dx / dist) * len;
    pad.z += (dz / dist) * len;
  }
  pad.vx = lerp(pad.vx, (pad.x - pad.px) / dt, 0.5);
  pad.vz = lerp(pad.vz, (pad.z - pad.pz) / dt, 0.5);
}

// ---- 한 판 ----

// 새 경기 상태
export function createMatch({ level = 1, seed = 1, first = ME, bots = {} } = {}) {
  const s = {
    level,
    rng: makeRng(seed),
    score: { me: 0, ai: 0 },
    first,
    server: first,
    phase: "serve",                 // serve → rally → dead → serve ...
    timer: 0,
    ball: newBall(),
    pads: { me: newPaddle(ME), ai: newPaddle(AI) },
    bots: { me: bots.me ?? null, ai: "ai" in bots ? bots.ai : level },   // 난이도 번호면 컴퓨터가 친다 (null 이면 사람)
    brain: { me: {}, ai: {} },
    hitter: null,
    serving: false,
    serveStage: 0,
    bounces: 0,                     // 친 뒤 받는 쪽에 튄 횟수
    netTouch: false,
    flight: 0,
    shotId: 0,
    rally: 0,
    longest: 0,
    stats: { me: { drive: 0, smash: 0, block: 0, cut: 0 }, ai: { drive: 0, smash: 0, block: 0, cut: 0 } },
    over: false,
    winner: null,
    time: 0,
  };
  holdBall(s);
  return s;
}

// 서브할 사람 (2점마다, 10:10 부터는 1점마다 바뀜)
export function serverFor(score, first) {
  const total = score.me + score.ai;
  const swap = total < 2 * (WIN_SCORE - 1) ? Math.floor(total / 2) % 2 : total % 2;
  return swap ? other(first) : first;
}

// 서브 전 공 들고 있기
function holdBall(s) {
  const pad = s.pads[s.server];
  const b = s.ball;
  b.p = { x: clamp(pad.x, 0.05 - HALF_W, HALF_W - 0.05), y: 0.22, z: dirOf(s.server) * Math.max(Math.abs(pad.z) - 0.04, HALF_L + 0.11) };
  b.v = { x: 0, y: 0, z: 0 };
  b.w = { x: 0, y: 0, z: 0 };
}

// 점수 (게임 끝 판정 포함)
function point(s, winner, reason, ev) {
  s.score[winner] += 1;
  s.phase = "dead";
  s.timer = 0;
  s.serving = false;
  ev.push({ type: "point", winner, reason, rally: s.rally });
  const { me, ai } = s.score;
  if (Math.max(me, ai) >= WIN_SCORE && Math.abs(me - ai) >= 2) {
    s.over = true;
    s.winner = winner;
    ev.push({ type: "over", winner });
  }
}

// 다음 서브 준비
function nextServe(s, ev) {
  s.server = serverFor(s.score, s.first);
  s.phase = "serve";
  s.timer = 0;
  s.hitter = null;
  s.rally = 0;
  s.brain = { me: {}, ai: {} };
  holdBall(s);
  ev.push({ type: "ready", server: s.server });
}

// 탁구대에 튐 → 규칙 판정
function onBounce(s, ev) {
  const side = sideOfZ(s.ball.p.z);
  if (s.serving) {
    if (s.serveStage === 0) {
      if (side !== s.hitter) return point(s, other(s.hitter), "serve_fault", ev);
      s.serveStage = 1;
      return;
    }
    if (side === s.hitter) return point(s, other(s.hitter), "serve_fault", ev);
    s.serving = false;
    s.bounces = 1;
    return;
  }
  if (side === s.hitter) return point(s, other(s.hitter), s.netTouch ? "net" : "own_side", ev);
  s.bounces += 1;
  if (s.bounces >= 2) point(s, s.hitter, "missed", ev);
}

// 바닥에 떨어짐 → 규칙 판정
function onDrop(s, ev) {
  if (!s.serving && s.bounces >= 1) point(s, s.hitter, "missed", ev);
  else point(s, other(s.hitter), s.serving ? "serve_fault" : s.netTouch ? "net" : "out", ev);
}

// 사람 휘두름 → 샷 (앞으로 휘두르면 드라이브, 높은 공을 세게면 스매시, 뒤로 당기면 커트, 가만히 대면 블록)
export function swingIntent(s, side, serve = false) {
  const pad = s.pads[side];
  const fwd = -pad.vz * dirOf(side);
  const tx = clamp(pad.vx * 0.14 - s.ball.p.x * 0.15, -0.68, 0.68);
  if (!serve && s.ball.p.y > SMASH_Y && fwd > 2.6) return { type: "smash", power: clamp((fwd - 2.6) / 3.5, 0, 1), tx };
  if (fwd > 0.9) return { type: "drive", power: clamp((fwd - 0.9) / 4, 0, 1), tx };
  if (fwd < -0.5) return { type: "cut", power: clamp((-fwd - 0.5) / 2.5, 0, 1), tx };
  return { type: "block", power: 0, tx };
}

// 컴퓨터 샷 고르기
function botIntent(s, side) {
  const lv = LEVELS[s.bots[side]];
  const { rng, ball } = s;
  const inTop = topOf(ball.w, heading(ball.v));
  let type = "drive";
  let power = clamp(lv.power + (rng() - 0.5) * 0.4, 0, 1);
  if (ball.p.y > SMASH_Y && rng() < lv.smash) type = "smash";
  else if (inTop < -40 && rng() < 0.45) {
    type = "cut";
    power = rng() * 0.6;
  } else if (rng() < 0.12) type = "block";
  const opp = s.pads[other(side)];
  const edge = Math.min(lv.aim, HALF_W - 0.1 - lv.error * 1.5);                                 // 실수해도 덜 나가게
  let tx = (rng() * 2 - 1) * edge;
  if (rng() < lv.aim) tx = -Math.sign(opp.x || rng() - 0.5) * edge * (0.6 + 0.4 * rng());        // 상대 라켓 반대쪽
  return { type, power, tx, error: lv.error };
}

// 컴퓨터 서브 고르기 (보통 긴 서브, 난이도에 따라 가끔 짧은 서브)
function botServeIntent(s) {
  const r = s.rng();
  const lv = LEVELS[s.bots[s.server]];
  return { type: r < 0.4 ? "drive" : r < 0.75 ? "cut" : "block", power: s.rng(), tx: (s.rng() * 2 - 1) * 0.5, short: s.rng() < lv.short };
}

// 샷 → 공 속도·회전 (타이밍·들어온 회전에 따라 흔들림, 너무 짧으면 네트)
export function makeShot(s, side, intent, off = 0) {
  const spec = SHOTS[intent.type];
  const dir = dirOf(side);
  const b = s.ball;
  const p = intent.power;
  const inSpeed = Math.hypot(b.v.x, b.v.z);
  const inTop = topOf(b.w, heading(b.v));
  let speed = lerp(spec.speed[0], spec.speed[1], p);
  let top = lerp(spec.top[0], spec.top[1], p);
  let depth = lerp(spec.depth[0], spec.depth[1], p);
  if (intent.type === "block") {
    speed = clamp(inSpeed * 0.7, 4.2, 7.5);
    top = clamp(inTop * 0.25, -40, 50);
  }
  if (intent.type === "block" || intent.type === "cut") depth += Math.max(0, inTop) * 0.0025;      // 탑스핀을 막으면 길게
  if (intent.type === "drive" || intent.type === "block") depth += Math.min(0, inTop) * 0.004 * (1 - p * 0.7);   // 백스핀을 약하게 치면 짧게
  if (b.p.y < 0.05) depth -= (0.05 - b.p.y) * 1.5;                                                 // 너무 낮게 친 공
  const err = (intent.error ?? PLAYER_ERROR) + 0.3 * (off / REACH) ** 2 + 0.08 * p * p + (intent.type === "smash" ? 0.04 : 0);
  const tx = intent.tx + gauss(s.rng) * err;
  depth += gauss(s.rng) * err * 0.8;
  if (depth < 0.12) return aimVelocity(b.p, { x: tx, z: dir * 0.05 }, speed, top);                // 네트에 걸림
  const target = { x: tx, z: -dir * depth };
  let sol = aimVelocity(b.p, target, speed, top);
  while (sol.netY < NET_H + BALL_R + 0.01 && speed > 3.2) {                                       // 네트를 넘길 만큼 느리게
    speed -= 1;
    sol = aimVelocity(b.p, target, speed, top);
  }
  return sol;
}

// 서브가 규칙대로 튀는지 (내 쪽 한 번, 상대 쪽 한 번) + 짧은 서브인지 (상대 탁구대에서 한 번 더 튐)
function serveCheck(p0, sol, side) {
  const sides = [];
  let net = false;
  simulate({ p: p0, v: sol.v, w: sol.w }, 3, (b, hit) => {
    if (hit === "net") net = true;
    if (hit === "table") sides.push(sideOfZ(b.p.z));
    return net || sides.length >= 3;
  });
  const legal = !net && sides[0] === side && sides[1] === other(side);
  return { legal, short: legal && sides[2] === other(side) };
}

// 서브 속도 찾기 (원하는 회전·방향에 가장 가까운, 규칙에 맞는 서브)
export function serveVelocity(s, side, intent) {
  const dir = dirOf(side);
  const p0 = s.ball.p;
  const p = intent.power;
  const top = intent.type === "drive" ? 40 + 60 * p : intent.type === "cut" ? -(30 + 50 * p) : 0;
  const base = intent.type === "drive" ? 4.5 + p : 4.2;
  const tx = clamp(intent.tx, -0.6, 0.6);
  const depth = intent.type === "cut" ? 0.6 : 0.95;
  // 보통은 상대 끝선 너머로 나가는 긴 서브, intent.short 면 상대 탁구대에서 두 번 튀는 짧은 서브
  let sol = null;
  let fallback = null;
  for (const speed of [0, 0.5, -0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((d) => base + d)) {
    for (const z1 of [0.8, 0.95, 1.1, 0.65, 1.25, 0.5]) {
      const t = (p0.z - dir * z1) / (p0.z + dir * depth);
      const target = { x: p0.x + (tx - p0.x) * t, z: dir * z1 };
      sol = aimVelocity(p0, target, speed, top);
      const check = serveCheck(p0, sol, side);
      if (!check.legal) continue;
      if (check.short === !!intent.short) return sol;
      fallback ??= sol;
    }
  }
  return fallback ?? sol;
}

// 서브 넣기
function serve(s, side, intent, ev) {
  const sol = serveVelocity(s, side, intent);
  Object.assign(s.ball, { v: sol.v, w: sol.w });
  Object.assign(s, { phase: "rally", hitter: side, serving: true, serveStage: 0, bounces: 0, flight: 0, netTouch: false });
  s.shotId += 1;
  ev.push({ type: "serve", side, shot: intent.type });
}

// 공 치기
function hitBall(s, side, off, ev) {
  const bot = s.bots[side] != null;
  const intent = bot ? botIntent(s, side) : swingIntent(s, side);
  const sol = makeShot(s, side, intent, off);
  Object.assign(s.ball, { v: sol.v, w: sol.w });
  Object.assign(s, { hitter: side, bounces: 0, flight: 0, netTouch: false });
  s.shotId += 1;
  s.rally += 1;
  s.longest = Math.max(s.longest, s.rally);
  s.stats[side][intent.type] += 1;
  ev.push({ type: "hit", side, shot: intent.type, power: intent.power, x: s.ball.p.x, y: s.ball.p.y, z: s.ball.p.z });
}

// 받는 사람 라켓을 공이 지나가면 치기 (내 쪽에 튀기 전, 탁구대 위에서 닿으면 반칙)
function tryHit(s, prev, f0, f1, ev) {
  const early = s.serving || s.bounces === 0;
  if (!early && s.bounces !== 1) return;
  const side = other(s.hitter);
  const pad = s.pads[side];
  const dir = dirOf(side);
  const padZ0 = lerp(pad.pz, pad.z, f0);
  const padZ1 = lerp(pad.pz, pad.z, f1);
  const b = s.ball;
  if (!((prev.z - padZ0) * dir < 0 && (b.p.z - padZ1) * dir >= 0)) return;
  const off = Math.abs(b.p.x - lerp(pad.px, pad.x, f1));
  if (off > REACH || b.p.y < -0.45 || b.p.y > 1.3) return;
  if (early) {
    if (Math.abs(padZ1) >= HALF_L) return;                     // 끝선 뒤면 어차피 아웃 공
    return volley(s, side, ev);
  }
  hitBall(s, side, off, ev);
}

// 튀기 전에 라켓에 닿음: 공은 라켓에 맞고 튕기고, 상대 점수
function volley(s, side, ev) {
  const b = s.ball;
  b.v = { x: b.v.x * 0.3, y: 1.6, z: -b.v.z * 0.25 };
  b.w = { x: 0, y: 0, z: 0 };
  ev.push({ type: "hit", side, shot: "block", power: 0, foul: true, x: b.p.x, y: b.p.y, z: b.p.z });
  point(s, other(side), "volley", ev);
}

// 받을 곳 예측 (내 쪽에 한 번 튄 뒤 가장 높이 뜬 곳, 칠 수 있는 구역 안으로)
function predict(s, side) {
  const dir = dirOf(side);
  let bounced = false;
  let spot = null;
  simulate(s.ball, 2.5, (b, hit) => {
    if (hit === "table") {
      if (sideOfZ(b.p.z) !== side) return bounced;            // 서브는 상대 쪽에 먼저 튐
      if (bounced) return true;
      bounced = true;
      return false;
    }
    if (bounced && (b.v.y <= 0 || b.p.z * dir >= ZONE.far)) {
      spot = { x: b.p.x, z: dir * clamp(b.p.z * dir, ZONE.near, ZONE.far) };
      return true;
    }
    return false;
  });
  return spot;
}

// 컴퓨터 라켓 움직이기
function think(s, side, dt) {
  const lv = LEVELS[s.bots[side]];
  const pad = s.pads[side];
  const br = s.brain[side];
  const dir = dirOf(side);
  let tx = 0;
  let tz = dir * ZONE.home;
  if (s.phase === "serve" && s.server === side) {
    br.serveX ??= (s.rng() * 2 - 1) * 0.5;
    tx = br.serveX;
  } else if (s.phase === "rally" && s.hitter !== side) {
    if (br.shot !== s.shotId) Object.assign(br, { shot: s.shotId, wait: lv.reaction, plan: undefined, slop: gauss(s.rng) * lv.error * 0.4 });
    br.wait -= dt;
    if (br.wait <= 0 && br.plan === undefined) br.plan = predict(s, side);
    if (br.plan) {
      tx = br.plan.x + br.slop;
      tz = br.plan.z;
    } else {
      tx = pad.x;
      tz = pad.z;
    }
  } else if (s.phase === "rally") {
    tx = pad.x * 0.5;
  }
  const [x, z] = clampZone(side, tx, tz);
  movePaddle(pad, x, z, lv.speed, dt);
}

// 시간 흘리기: input = { x, z (내 라켓 목표), serve (서브 누름) }
export function step(s, dt, input = {}) {
  const ev = [];
  if (s.over) return ev;
  s.time += dt;
  for (const side of [ME, AI]) {
    if (s.bots[side] != null) think(s, side, dt);
    else {
      const pad = s.pads[side];
      const serving = s.phase === "serve" && s.server === side;
      const [x, z] = clampZone(side, input.x ?? pad.x, input.z ?? pad.z, serving);
      movePaddle(pad, x, z, PAD_SPEED, dt);
    }
  }
  if (s.phase === "serve") {
    holdBall(s);
    s.timer += dt;
    const bot = s.bots[s.server] != null;
    if (bot ? s.timer >= BOT_SERVE_WAIT : input.serve) serve(s, s.server, bot ? botServeIntent(s) : swingIntent(s, s.server, true), ev);
    return ev;
  }
  if (s.phase === "dead") {
    s.timer += dt;
    if (s.timer >= DEAD_TIME) {
      nextServe(s, ev);
      return ev;
    }
  }
  const n = Math.max(1, Math.round(dt / SUB));
  for (let i = 0; i < n; i++) {
    const b = s.ball;
    const prev = { ...b.p };
    fly(b, dt / n);
    const hit = collide(b, prev);
    if (hit === "table" || hit === "net" || hit === "floor") ev.push({ type: hit, x: b.p.x, y: b.p.y, z: b.p.z, speed: Math.hypot(b.v.x, b.v.y, b.v.z) });
    if (s.phase !== "rally") continue;
    s.flight += dt / n;
    if (hit === "net") s.netTouch = true;
    else if (hit === "table") onBounce(s, ev);
    else if (hit === "floor" || hit === "away") onDrop(s, ev);
    if (s.phase === "rally") tryHit(s, prev, i / n, (i + 1) / n, ev);
    if (s.phase === "rally" && s.flight > MAX_FLIGHT) point(s, s.bounces >= 1 ? s.hitter : other(s.hitter), "slow", ev);
  }
  return ev;
}
