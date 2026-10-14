// 박스헤드 규칙 (화면과 분리된 순수 로직, DOM 없음, 시드 난수).
// 좌표: x 는 오른쪽, y 는 아래쪽, 한 칸 = 1. 아레나는 COLS × ROWS.
// 혼자 하기는 내 브라우저에서, 같이 하기는 방장 브라우저에서 이 코드를 돌린다.
//   createGame(seed, players, { difficulty }) → 상태, step(s, dt, inputs) → 시간 흘리기, snapshot(s) → 그리기용 값
// inputs 는 { 플레이어id: { dx, dy, fire, lock, weapon } }. dx·dy 는 -1/0/1 (8방향), lock 은 제자리 방향 바꾸기.

export const COLS = 24;
export const ROWS = 16;
export const DT = 1 / 60;
export const MAX_HP = 100;
export const PLAYER_R = 0.32;
export const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];   // 0=오른쪽, 시계 방향
export const BLOCKS = [{ x: 5, y: 4, w: 2, h: 2 }, { x: 17, y: 4, w: 2, h: 2 }, { x: 5, y: 10, w: 2, h: 2 }, { x: 17, y: 10, w: 2, h: 2 }];

export const WEAPONS = [
  { id: "pistol", name: "권총", interval: 0.26, dmg: 1, pellets: 1, spread: 0.03, range: 13, stun: 0.12, knock: 1.2 },
  { id: "shotgun", name: "샷건", interval: 0.75, dmg: 1, pellets: 7, spread: 0.3, range: 6.5, stun: 0.3, knock: 3.5 },
  { id: "uzi", name: "기관총", interval: 0.065, dmg: 0.55, pellets: 1, spread: 0.08, range: 11, stun: 0.08, knock: 0.6 },
];
export const AMMO_MAX = [Infinity, 50, 300];
export const AMMO_CRATE = [0, 10, 60];
export const AMMO_START = [Infinity, 0, 0];

const PLAYER_SPEED = 4.2;
const ZOMBIE_R = 0.34;
const DEVIL_R = 0.45;
const ZOMBIE_DMG = 8;
const FIREBALL_DMG = 14;
const REGEN_DELAY = 3;
const REGEN_RATE = 2;
const COMBO_TIME = 3;
const INTERMISSION = 6;
const FIRST_WAIT = 3;
const SPAWNS = [[0.9, 2], [0.9, 8], [0.9, 14], [23.1, 2], [23.1, 8], [23.1, 14], [8, 0.9], [16, 0.9], [8, 15.1], [16, 15.1]];

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
  return { next, range: (lo, hi) => lo + (hi - lo) * next(), int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()) };
}

// 방향 (dx, dy: -1/0/1) → 0~7, 0,0 이면 -1
export function dirIndex(dx, dy) {
  return DIRS.findIndex(([x, y]) => x === Math.sign(dx) && y === Math.sign(dy));
}

// 레벨별 값
export function levelInfo(n, count = 1, difficulty = 1) {
  const hard = [0.8, 1, 1.25][difficulty] ?? 1;
  const crowd = 1 + 0.6 * (count - 1);
  return {
    zombies: Math.min(120, Math.round((6 + 3 * n) * crowd * hard)),
    alive: Math.min(55, 10 + 3 * n),
    gap: Math.max(0.22, (1.5 - 0.05 * n) / Math.sqrt(crowd) / hard),
    zSpeed: Math.min(2.6, (0.9 + 0.055 * n) * (0.9 + 0.1 * hard)),
    zHp: 2 + Math.floor(n / 5),
    devils: n < 2 ? 0 : Math.min(12, Math.round((1 + Math.floor((n - 1) / 2)) * (1 + 0.5 * (count - 1)) * hard)),
    dHp: 12 + 2 * n,
    dGap: Math.max(1.4, 3 - 0.05 * n),
  };
}

// ---- 새 판 ----

export function createGame(seed, players = [{ id: "me", name: "나" }], opts = {}) {
  const s = {
    t: 0, rng: makeRng(seed), over: false, difficulty: opts.difficulty ?? 1, events: [], nextId: 1,
    level: 0, phase: "intermission", phaseT: FIRST_WAIT, zLeft: 0, dLeft: 0, spawnT: 0, dSpawnT: 0, info: null,
    players: [], zs: [], devils: [], balls: [], crates: [],
    score: 0, kills: 0, combo: 0, comboT: 0, mult: 1,
  };
  players.forEach((p, i) => {
    s.players.push({
      id: p.id, name: p.name, x: 11.2 + (i % 2) * 1.6, y: 7.4 + Math.floor(i / 2) * 1.2, face: 0, hp: MAX_HP, weapon: 0,
      has: [true, false, false], ammo: [...AMMO_START], cd: 0, stun: 0, calm: 0, alive: true, gone: false, kills: 0,
    });
  });
  return s;
}

export function removePlayer(s, id) {
  const p = s.players.find((q) => q.id === id);
  if (p) {
    p.gone = true;
    p.alive = false;
  }
  if (!s.players.some((q) => q.alive) && !s.over) endGame(s);
}

// ---- 부딪힘 ----

function hitsBlock(x, y, r) {
  if (x < r || y < r || x > COLS - r || y > ROWS - r) return true;
  for (const b of BLOCKS) if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return true;
  return false;
}

// 한 축씩 움직여서 벽을 따라 미끄러짐. 실제로 움직인 거리를 돌려준다.
function slide(e, dx, dy, r) {
  const ox = e.x;
  const oy = e.y;
  if (!hitsBlock(e.x + dx, e.y, r)) e.x += dx;
  if (!hitsBlock(e.x, e.y + dy, r)) e.y += dy;
  return Math.hypot(e.x - ox, e.y - oy);
}

// 광선이 벽(블록·가장자리)에 닿는 거리
function wallDistance(x, y, dx, dy, max) {
  let best = max;
  const edge = (lo, hi, p, d) => {
    if (d > 0) return (hi - p) / d;
    if (d < 0) return (lo - p) / d;
    return Infinity;
  };
  best = Math.min(best, edge(0, COLS, x, dx), edge(0, ROWS, y, dy));
  for (const b of BLOCKS) {
    let t0 = 0;
    let t1 = best;
    for (const [p, d, lo, hi] of [[x, dx, b.x, b.x + b.w], [y, dy, b.y, b.y + b.h]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) {
          t0 = Infinity;
          break;
        }
      } else {
        let a = (lo - p) / d;
        let c = (hi - p) / d;
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
        if (t0 > t1) {
          t0 = Infinity;
          break;
        }
      }
    }
    if (t0 !== Infinity && t0 < best) best = t0;
  }
  return Math.max(0, best);
}

// ---- 길찾기: 플레이어에게서 퍼져 나가는 거리표 (0.5칸 격자) ----

const G = 0.5;
const GW = COLS / G;
const GH = ROWS / G;
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const OPEN = (() => {
  const open = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) open[gy * GW + gx] = hitsBlock((gx + 0.5) * G, (gy + 0.5) * G, 0.36) ? 0 : 1;
  return open;
})();

// 그 플레이어까지의 걸음 수 표 (0.3초마다 다시 계산)
function flowFor(s, p) {
  s.flow ||= {};
  const old = s.flow[p.id];
  if (old && s.t - old.t < 0.3) return old.dist;
  const dist = old ? old.dist.fill(-1) : new Int16Array(GW * GH).fill(-1);
  const sx = Math.max(0, Math.min(GW - 1, Math.floor(p.x / G)));
  const sy = Math.max(0, Math.min(GH - 1, Math.floor(p.y / G)));
  const queue = [sy * GW + sx];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cx = c % GW;
    const cy = (c - cx) / GW;
    for (const [dx, dy] of NEIGH) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (dist[n] >= 0 || !OPEN[n]) continue;
      if (dx && dy && (!OPEN[cy * GW + nx] || !OPEN[ny * GW + cx])) continue;       // 모서리를 파고들지 않게
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
  s.flow[p.id] = { t: s.t, dist };
  return dist;
}

// 몸 폭만큼 넓게 봐도 사이에 벽이 없는지 (가운데와 양옆 세 줄)
function clearLine(x, y, tx, ty, r) {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = (-dy / d) * r;
  const ny = (dx / d) * r;
  for (const k of [0, -1, 1]) if (wallDistance(x + nx * k, y + ny * k, dx / d, dy / d, d) < d - 0.01) return false;
  return true;
}

// 다음에 향할 곳: 사이에 벽이 없으면 곧장, 있으면 거리표를 따라 한 칸씩
function waypoint(s, e, target, r = ZOMBIE_R) {
  if (e.flowT > 0) e.flowT -= 1 / 60;
  if (!(e.flowT > 0) && clearLine(e.x, e.y, target.x, target.y, r)) return [target.x, target.y];
  const dist = flowFor(s, target);
  const cx = Math.max(0, Math.min(GW - 1, Math.floor(e.x / G)));
  const cy = Math.max(0, Math.min(GH - 1, Math.floor(e.y / G)));
  let best = dist[cy * GW + cx];
  let to = null;
  for (const [ox, oy] of NEIGH) {
    const nx = cx + ox;
    const ny = cy + oy;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const v = dist[ny * GW + nx];
    if (v >= 0 && (best < 0 || v < best)) {
      best = v;
      to = [(nx + 0.5) * G, (ny + 0.5) * G];
    }
  }
  return to || [target.x, target.y];
}

// 비어 있는 자리 찾기 (플레이어에게서 떨어진 곳)
function freeSpot(s, minDist = 5) {
  for (let i = 0; i < 40; i++) {
    const x = s.rng.range(1.5, COLS - 1.5);
    const y = s.rng.range(1.5, ROWS - 1.5);
    if (hitsBlock(x, y, 0.6)) continue;
    if (s.players.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < minDist)) continue;
    return [x, y];
  }
  return [12, 8];
}

function nearestPlayer(s, x, y) {
  let best = null;
  let bd = Infinity;
  for (const p of s.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return [best, bd];
}

// ---- 레벨 진행 ----

function startLevel(s) {
  s.level++;
  const alive = s.players.filter((p) => !p.gone).length;
  s.info = levelInfo(s.level, alive, s.difficulty);
  s.phase = "wave";
  s.zLeft = s.info.zombies;
  s.dLeft = s.info.devils;
  s.spawnT = 0.5;
  s.dSpawnT = 0;
  s.events.push({ type: "level", level: s.level });
}

function clearLevel(s) {
  s.phase = "intermission";
  s.phaseT = INTERMISSION;
  const bonus = 500 * s.level;
  s.score += bonus;
  s.events.push({ type: "clear", level: s.level, bonus });
  for (const p of s.players) {
    if (p.gone) continue;
    if (!p.alive) {
      p.alive = true;                                         // 쓰러진 동료는 다시 일어남
      p.hp = MAX_HP * 0.6;
      p.stun = 0;
    }
    const [x, y] = freeSpot(s, 2);
    s.crates.push({ id: s.nextId++, x, y, kind: "supply", ttl: 999 });
  }
}

function spawnZombie(s) {
  const info = s.info;
  const pts = SPAWNS.filter(([x, y]) => !s.players.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < 6));
  const [x, y] = (pts.length ? pts : SPAWNS)[s.rng.int(0, (pts.length || SPAWNS.length) - 1)];
  s.zs.push({
    id: s.nextId++, x: x + s.rng.range(-0.3, 0.3), y: y + s.rng.range(-0.3, 0.3), hp: info.zHp, max: info.zHp, face: 0,
    speed: info.zSpeed * s.rng.range(0.85, 1.15), stun: 0, cd: 0, kx: 0, ky: 0,
  });
}

function spawnDevil(s) {
  const [x, y] = SPAWNS[s.rng.int(0, SPAWNS.length - 1)];
  s.devils.push({
    id: s.nextId++, x, y, hp: s.info.dHp, max: s.info.dHp, face: 0, speed: Math.min(2.6, 1.9 + 0.03 * s.level), stun: 0,
    cd: s.rng.range(0.8, 1.6), wind: 0, kx: 0, ky: 0, side: s.rng.next() < 0.5 ? 1 : -1,
  });
}

// ---- 죽임 ----

function killEnemy(s, e, by, devil) {
  e.hp = 0;
  const list = devil ? s.devils : s.zs;
  list.splice(list.indexOf(e), 1);
  s.kills++;
  if (by) by.kills++;
  s.combo++;
  s.comboT = COMBO_TIME;
  s.mult = Math.min(30, 1 + Math.floor(s.combo / 4));
  const gain = (devil ? 250 : 10) * s.mult;
  s.score += gain;
  s.events.push({ type: "kill", x: r2(e.x), y: r2(e.y), devil: devil ? 1 : 0, gain });
  if (devil || s.rng.next() < 0.08) {
    s.crates.push({ id: s.nextId++, x: e.x, y: e.y, kind: "ammo", ttl: 25 });
    if (s.crates.length > 12) s.crates.shift();
  }
}

function damage(s, e, amount, by, devil, weapon, dirx, diry) {
  e.hp -= amount;
  e.stun = Math.max(e.stun, weapon.stun);
  e.kx += dirx * weapon.knock * (devil ? 0.35 : 1);
  e.ky += diry * weapon.knock * (devil ? 0.35 : 1);
  s.events.push({ type: "hit", x: r2(e.x), y: r2(e.y) });
  if (e.hp <= 0) killEnemy(s, e, by, devil);
}

function hurt(s, p, amount) {
  if (!p.alive) return;
  p.hp -= amount;
  p.calm = 0;
  p.stun = 0.22;
  s.events.push({ type: "hurt", id: p.id, x: r2(p.x), y: r2(p.y) });
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    s.events.push({ type: "down", id: p.id, x: r2(p.x), y: r2(p.y) });
    if (!s.players.some((q) => q.alive)) endGame(s);
  }
}

function endGame(s) {
  s.over = true;
  s.events.push({ type: "over", score: s.score, level: s.level, kills: s.kills, time: r2(s.t) });
}

const r2 = (v) => Math.round(v * 100) / 100;

// ---- 쏘기 ----

function fire(s, p) {
  const w = WEAPONS[p.weapon];
  if (p.weapon > 0) {
    if (p.ammo[p.weapon] <= 0) {
      p.weapon = 0;
      return;
    }
    p.ammo[p.weapon]--;
  }
  p.cd = w.interval;
  const base = Math.atan2(DIRS[p.face][1], DIRS[p.face][0]);
  const mx = p.x + Math.cos(base) * 0.45;
  const my = p.y + Math.sin(base) * 0.45;
  const rays = [];
  for (let i = 0; i < w.pellets; i++) {
    const a = base + (s.rng.next() - 0.5) * 2 * w.spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const wall = wallDistance(mx, my, dx, dy, w.range);
    let best = null;
    let bt = wall;
    let devil = false;
    for (const [list, isDevil, r] of [[s.zs, false, ZOMBIE_R + 0.14], [s.devils, true, DEVIL_R + 0.12]]) {
      for (const e of list) {
        const ex = e.x - mx;
        const ey = e.y - my;
        const t = ex * dx + ey * dy;
        if (t < 0 || t > bt) continue;
        if (Math.abs(ex * dy - ey * dx) > r) continue;
        best = e;
        bt = t;
        devil = isDevil;
      }
    }
    if (best) damage(s, best, w.dmg, p, devil, w, dx, dy);
    rays.push([r2(a), r2(bt)]);
  }
  s.events.push({ type: "shot", id: p.id, w: p.weapon, x: r2(mx), y: r2(my), rays });
}

// ---- 시간 흘리기 ----

export function step(s, dt, inputs = {}) {
  if (s.over) return;
  s.t += dt;
  if (s.comboT > 0) {
    s.comboT -= dt;
    if (s.comboT <= 0) {
      s.combo = 0;
      s.mult = 1;
    }
  }
  for (const p of s.players) updatePlayer(s, p, inputs[p.id] || {}, dt);
  updatePhase(s, dt);
  for (const z of [...s.zs]) updateZombie(s, z, dt);
  for (const d of [...s.devils]) updateDevil(s, d, dt);
  separate(s.zs, ZOMBIE_R);
  updateBalls(s, dt);
  for (let i = s.crates.length - 1; i >= 0; i--) {
    const c = s.crates[i];
    c.ttl -= dt;
    if (c.ttl <= 0) s.crates.splice(i, 1);
  }
  if (s.events.length > 300) s.events.splice(0, s.events.length - 300);
}

function updatePlayer(s, p, input, dt) {
  if (!p.alive) return;
  p.calm += dt;
  if (p.calm > REGEN_DELAY && p.hp < MAX_HP) p.hp = Math.min(MAX_HP, p.hp + REGEN_RATE * dt);
  if (p.stun > 0) p.stun -= dt;
  p.cd -= dt;
  const dx = Math.sign(input.dx || 0);
  const dy = Math.sign(input.dy || 0);
  const dir = dirIndex(dx, dy);
  if (dir >= 0) p.face = dir;
  if (dir >= 0 && !input.lock) {
    const len = Math.hypot(dx, dy);
    const v = (PLAYER_SPEED * (p.stun > 0 ? 0.35 : 1) * dt) / len;
    slide(p, dx * v, dy * v, PLAYER_R);
  }
  if (input.weapon !== undefined && input.weapon >= 0 && input.weapon < WEAPONS.length && p.has[input.weapon] && (input.weapon === 0 || p.ammo[input.weapon] > 0)) p.weapon = input.weapon;
  if (input.fire && p.cd <= 0 && p.stun <= 0) fire(s, p);
  for (let i = s.crates.length - 1; i >= 0; i--) {
    const c = s.crates[i];
    if (Math.hypot(c.x - p.x, c.y - p.y) < 0.8) pickUp(s, p, c, i);
  }
}

// 상자 줍기: 안 가진 무기가 있으면 먼저 얻고, 다 있으면 탄약을 채움. 보급 상자는 체력도 가득
function pickUp(s, p, c, i) {
  s.crates.splice(i, 1);
  const locked = [1, 2].find((k) => !p.has[k]);
  if (locked) {
    p.has[locked] = true;
    p.ammo[locked] = AMMO_CRATE[locked];
    if (p.weapon === 0) p.weapon = locked;
  } else {
    for (const k of [1, 2]) p.ammo[k] = Math.min(AMMO_MAX[k], p.ammo[k] + AMMO_CRATE[k] * (c.kind === "supply" ? 2 : 1));
  }
  if (c.kind === "supply") p.hp = MAX_HP;
  s.events.push({ type: "pickup", id: p.id, x: r2(c.x), y: r2(c.y), kind: c.kind, weapon: locked || 0 });
}

function updatePhase(s, dt) {
  if (s.phase === "intermission") {
    s.phaseT -= dt;
    if (s.phaseT <= 0) startLevel(s);
    return;
  }
  const info = s.info;
  if (s.zLeft > 0) {
    s.spawnT -= dt;
    if (s.spawnT <= 0 && s.zs.length < info.alive) {
      s.spawnT = info.gap;
      s.zLeft--;
      spawnZombie(s);
    }
  } else if (s.zs.length === 0 && s.dLeft > 0) {
    if (s.dSpawnT <= 0 && s.devils.length === 0) s.events.push({ type: "devils" });
    s.dSpawnT -= dt;
    if (s.dSpawnT <= 0) {
      s.dSpawnT = 0.9;
      s.dLeft--;
      spawnDevil(s);
    }
  } else if (s.zLeft === 0 && s.dLeft === 0 && s.zs.length === 0 && s.devils.length === 0) {
    clearLevel(s);
  }
}

// 목적지를 향해 걷기. 막혀서 거의 못 움직이면 잠깐 길찾기 표를 따름
function walk(s, e, tx, ty, speed, r, dt) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = speed * dt;
  const moved = slide(e, (dx / d) * want, (dy / d) * want, r);
  if (moved < want * 0.3) e.flowT = 0.6;
}

// 맞아서 밀려남 (속도는 점점 줄어듦)
function knockback(e, r, dt) {
  if (Math.abs(e.kx) + Math.abs(e.ky) < 0.05) return;
  slide(e, e.kx * dt, e.ky * dt, r);
  const f = Math.exp(-9 * dt);
  e.kx *= f;
  e.ky *= f;
}

function updateZombie(s, z, dt) {
  knockback(z, ZOMBIE_R, dt);
  if (z.cd > 0) z.cd -= dt;
  const [target, dist] = nearestPlayer(s, z.x, z.y);
  if (!target) return;
  z.face = Math.atan2(target.y - z.y, target.x - z.x);
  if (z.stun > 0) {
    z.stun -= dt;
    return;
  }
  if (dist > 0.62) {
    const [wx, wy] = waypoint(s, z, target);
    walk(s, z, wx, wy, z.speed, ZOMBIE_R, dt);
  }
  else if (z.cd <= 0) {
    z.cd = 1;
    hurt(s, target, ZOMBIE_DMG);
  }
}

function updateDevil(s, d, dt) {
  knockback(d, DEVIL_R, dt);
  if (d.cd > 0) d.cd -= dt;
  const [target, dist] = nearestPlayer(s, d.x, d.y);
  if (!target) return;
  d.face = Math.atan2(target.y - d.y, target.x - d.x);
  if (d.stun > 0) {
    d.stun -= dt;
    return;
  }
  if (d.wind > 0) {
    d.wind -= dt;
    if (d.wind <= 0) {
      const a = Math.atan2(target.y - d.y, target.x - d.x);
      s.balls.push({ x: d.x, y: d.y, vx: Math.cos(a) * 6.5, vy: Math.sin(a) * 6.5, life: 3 });
      s.events.push({ type: "fireball", x: r2(d.x), y: r2(d.y) });
      d.cd = s.info.dGap;
    }
    return;
  }
  const sees = clearLine(d.x, d.y, target.x, target.y, DEVIL_R);
  if (dist > 6 || !sees) {                                        // 멀거나 벽에 가리면 다가감
    const [wx, wy] = waypoint(s, d, target, DEVIL_R);
    walk(s, d, wx, wy, d.speed, DEVIL_R, dt);
  }
  else if (dist < 3.2) walk(s, d, d.x - (target.x - d.x), d.y - (target.y - d.y), d.speed * 0.8, DEVIL_R, dt);
  else {
    const a = d.face + (Math.PI / 2) * d.side;
    slide(d, Math.cos(a) * d.speed * 0.5 * dt, Math.sin(a) * d.speed * 0.5 * dt, DEVIL_R);
  }
  if (d.cd <= 0 && dist < 11 && sees) d.wind = 0.55;
}

// 좀비끼리 겹치지 않게 밀어내기
function separate(list, r) {
  const min = r * 1.7;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x;
      if (dx > min || dx < -min) continue;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= min || d === 0) continue;
      const push = (min - d) * 0.3 / d;
      slide(a, -dx * push, -dy * push, r);
      slide(b, dx * push, dy * push, r);
    }
  }
}

function updateBalls(s, dt) {
  for (let i = s.balls.length - 1; i >= 0; i--) {
    const b = s.balls[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let gone = b.life <= 0 || hitsBlock(b.x, b.y, 0.05);
    if (!gone) {
      const p = s.players.find((q) => q.alive && Math.hypot(q.x - b.x, q.y - b.y) < PLAYER_R + 0.2);
      if (p) {
        hurt(s, p, FIREBALL_DMG);
        gone = true;
      }
    }
    if (!gone) {
      const z = s.zs.find((q) => Math.hypot(q.x - b.x, q.y - b.y) < ZOMBIE_R + 0.2);
      if (z) {
        z.hp -= 4;
        s.events.push({ type: "hit", x: r2(z.x), y: r2(z.y) });
        if (z.hp <= 0) {
          s.zs.splice(s.zs.indexOf(z), 1);                    // 악마 불덩이에 죽은 좀비는 점수 없음
          s.events.push({ type: "kill", x: r2(z.x), y: r2(z.y), devil: 0, gain: 0 });
        }
        gone = true;
      }
    }
    if (gone) s.balls.splice(i, 1);
  }
}

// ---- 그리기용 값 (소수점 줄여서 작게) ----

export function snapshot(s, drain = true) {
  const snap = {
    t: r2(s.t), lv: s.level, ph: s.phase, pt: r2(Math.max(0, s.phaseT)), sc: s.score, kl: s.kills, cb: s.combo, mu: s.mult,
    cbt: r2(Math.max(0, s.comboT) / COMBO_TIME), over: s.over ? 1 : 0, left: s.zLeft + s.zs.length + s.dLeft + s.devils.length,
    p: s.players.filter((p) => !p.gone).map((p) => ({
      id: p.id, x: r2(p.x), y: r2(p.y), f: p.face, hp: Math.ceil(p.hp), w: p.weapon, a: p.alive ? 1 : 0, st: p.stun > 0 ? 1 : 0,
      am: [p.ammo[1], p.ammo[2]], has: p.has.map((h) => (h ? 1 : 0)),
    })),
    z: s.zs.map((z) => [z.id, r2(z.x), r2(z.y), r2(z.face), r2(z.hp / z.max), z.stun > 0 ? 1 : 0]),
    d: s.devils.map((d) => [d.id, r2(d.x), r2(d.y), r2(d.face), r2(d.hp / d.max), d.wind > 0 ? 1 : 0]),
    b: s.balls.map((b) => [r2(b.x), r2(b.y)]),
    c: s.crates.map((c) => [c.id, r2(c.x), r2(c.y), c.kind === "supply" ? 1 : 0, r2(c.ttl)]),
    ev: s.events,
  };
  if (drain) s.events = [];
  return snap;
}
