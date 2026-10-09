// 숫자러너 규칙 (화면과 분리된 순수 로직, DOM 없음).
// 좌표: x 는 도로 가로(-8 ~ 8, 왼쪽이 -), d 는 내 무리 맨 앞에서부터 앞쪽 거리(m). 무리는 늘 d=0 에 있고 세상이 다가온다.
// 한 판 상태는 createGame() 이 만들고, step(state, dt, input) 이 시간을 흘리며 사건 목록을 돌려준다.

export const LANES = 4;              // 도로 칸 수 (칸마다 숫자 문 하나)
export const LANE_W = 4;
export const ROAD_W = LANES * LANE_W;
export const HALF = ROAD_W / 2;
export const SPAWN_D = 62;          // 새 물체가 나타나는 거리
export const MAX_SQUAD = 9999999;       // 사실상 무제한 (값이 터지지 않게만)
export const START_SQUAD = 10;
export const BOSS_EVERY = 1000;     // 이 거리마다 보스
export const REST_EVERY = 700;      // 이 거리마다 적 없는 정비 구간
export const REST_LEN = 90;
export const MAX_LEVEL = 5;
const MOVE_SPEED = 15;              // 좌우 이동 속도(m/s)
const CLASH_RATE = 30;              // 맞붙었을 때 1초에 쓰러지는 적 수 (기본)
const GATE_RATE = 7;                // 문을 계속 쏘면 1초에 오르는 숫자
const SPLASH_MUL = 3;               // 폭발은 무리 여럿을 함께 맞힘
export const GROUP_MAX_R = 2.0;     // 적 무리 가로 반지름 한도 (큰 무리는 앞뒤로 길어짐)

// 무기: 1초 발사 횟수, 병사 1명당 초당 피해, 탄속, 퍼짐, 사거리, 한 번에 보이는 탄 수, 산탄·관통·폭발
export const WEAPONS = {
  pistol: { name: "권총", rate: 2.5, dps: 1, speed: 38, spread: 0.03, range: 42, bullets: 6, color: 0xfff1a8 },
  smg: { name: "기관총", rate: 8, dps: 1.25, speed: 42, spread: 0.07, range: 40, bullets: 4, color: 0xffd36b },
  shotgun: { name: "샷건", rate: 1.4, dps: 1.7, speed: 30, spread: 0.3, range: 20, bullets: 3, pellets: 5, color: 0xffb36b },
  sniper: { name: "저격총", rate: 0.9, dps: 1.3, speed: 75, spread: 0, range: 70, bullets: 3, pierce: 8, color: 0xff7a7a },
  rocket: { name: "로켓", rate: 0.8, dps: 1.0, speed: 24, spread: 0.02, range: 50, bullets: 2, splash: 2.8, color: 0xff9a3d },
  flame: { name: "화염방사기", rate: 12, dps: 1.9, speed: 16, spread: 0.2, range: 14, bullets: 3, pierce: 4, color: 0xff6a2a },
};

// 동료 (동료 문으로 합류, 다시 얻으면 레벨 업)
export const ALLIES = {
  shield: { name: "방패병" },     // 맞붙을 때 잃는 병사를 절반 대신 막음 (체력이 있음)
  medic: { name: "의무병" },      // 2초마다 병사 회복
  artillery: { name: "포병" },    // 3초마다 가장 큰 적 무리에 포격
};

// 적: 1명 체력, 다가오는 속도, 내 쪽으로 꺾는 속도, 맞붙을 때 1명이 쓰러뜨리는 병사 수, 크기, 방패(정면 총알 피해 배율)
export const ENEMIES = {
  mob: { name: "졸병", hp: 1, speed: 1.2, homing: 0.8, power: 1, size: 0.3 },
  rusher: { name: "돌격병", hp: 1, speed: 4.5, homing: 2.2, power: 2, size: 0.3 },
  shield: { name: "방패병", hp: 2, speed: 0.8, homing: 0.6, power: 1, size: 0.34, armor: 0.3 },
  brute: { name: "거인", hp: 30, speed: 0.6, homing: 0.5, power: 10, size: 1.0 },
};

// 일회용 아이템 상자
export const ITEMS = {
  grenade: { name: "수류탄" },    // 앞쪽 적을 크게 날림
  shield: { name: "보호막" },     // 5초 동안 병사를 안 잃음
  slow: { name: "느리게" },       // 6초 동안 적이 느려짐
};

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
    gauss: () => (next() + next() + next() - 1.5) / 0.5,
  };
}

// ---- 계산 도우미 ----

// 처음 400m는 적을 조금 줄여서 시작 (0.7 → 1)
function warmup(dist) {
  return Math.min(1, 0.7 + dist / 1300);
}

// 칸 번호 (0 = 맨 왼쪽)와 칸 가운데 x
export function laneOf(x) {
  return Math.max(0, Math.min(LANES - 1, Math.floor((x + HALF) / LANE_W)));
}

export function laneX(i) {
  return -HALF + LANE_W * (i + 0.5);
}

// 거리별 난이도 배율 (끝없이 커짐)
export function difficulty(dist) {
  const d = Math.max(0, dist);
  // 1500m까지 가파르게, 3500m까지 완만하게, 그 뒤로는 아주 천천히
  return Math.pow(1.0025, Math.min(d, 1500)) * Math.pow(1.0013, Math.min(Math.max(0, d - 1500), 2000))
    * Math.pow(1.0015, Math.max(0, d - 3500));
}

// 무리 반지름 (병사가 많을수록 넓게)
export function squadRadius(count) {
  return Math.min(2.4, 0.35 + 0.11 * Math.sqrt(Math.max(0, count)));
}

export function groupRadius(type, n) {
  const spec = ENEMIES[type];
  return type === "brute" ? spec.size : Math.min(GROUP_MAX_R, spec.size + 0.2 * Math.sqrt(Math.max(1, n)));   // 한 칸 폭까지만
}

// 한 번 발사 주기에 나가는 탄 수 (병사가 많을수록 많이, 피해 총량은 같음)
export function shotsPerVolley(w, count) {
  return Math.max(1, Math.round(w.bullets * Math.min(20, 1 + Math.sqrt(Math.max(0, count)) / 3)));   // 약 3200명부터는 그대로
}

export function levelMul(level) {
  return 1 + 0.3 * (level - 1);
}

export function runSpeed(dist) {
  return 8 + Math.min(2, dist / 1500);
}

// 문 적용 결과
export function applyGate(count, gate) {
  let next = count;
  if (gate.op === "num") next = count + gate.v;
  else if (gate.op === "mul") next = count * gate.v;
  else if (gate.op === "div") next = Math.ceil(count / gate.v);
  return Math.max(0, Math.min(MAX_SQUAD, Math.round(next)));
}

// 문 글자 (+20, -10, ×2, ÷2, ?, 동료 이름)
export function gateLabel(gate) {
  if (gate.op === "ally") return `${ALLIES[gate.ally].name}`;
  if (gate.hidden) return "?";
  if (gate.op === "num") return gate.v >= 0 ? `+${gate.v}` : `${gate.v}`;
  if (gate.op === "mul") return `×${gate.v}`;
  return `÷${gate.v}`;
}

// 좋은 문인지 (색 고르기용)
export function gateGood(gate) {
  if (gate.op === "ally" || gate.op === "mul") return true;
  if (gate.op === "div") return false;
  return gate.v >= 0;
}

// ---- 한 판 ----

export function createGame(seed = Date.now()) {
  return {
    seed,
    rng: makeRng(seed),
    t: 0,
    dist: 0,
    count: START_SQUAD,
    x: -LANE_W / 2,           // 두 번째 칸 가운데에서 시작
    weapon: "pistol",
    level: 1,
    allies: {},               // 종류 → 레벨
    shieldHp: 0,              // 방패병 남은 체력
    invuln: 0,                // 보호막 남은 시간
    slow: 0,                  // 느리게 남은 시간
    kills: 0,
    bossKills: 0,
    bonus: 0,
    over: false,
    nextSpawn: 30,            // 다음 사건을 놓을 거리
    nextTrickle: 70,          // 다음 작은 무리를 놓을 거리
    nextBoss: BOSS_EVERY,
    sinceGate: 3,             // 첫 사건은 문
    boss: null,
    groups: [],               // 적 무리
    gates: [],                // 문 한 쌍씩
    crates: [],               // 무기·아이템 상자
    cages: [],                // 포로 철창
    bullets: [],
    bombs: [],                // 보스 폭탄 (떨어질 자리)
    fireAcc: 0,
    medicAcc: 0,
    artAcc: 0,
    seq: 0,
  };
}

// 점수: 달린 거리 + 보스 보너스 (처치 수는 따로 보여 줌)
export function score(s) {
  return Math.floor(s.dist) + s.bonus;
}

// 시간 흘리기. input: { dir: -1|0|1 (키보드), targetX: 숫자 또는 null (끌기) }
export function step(s, dt, input = {}) {
  const events = [];
  if (s.over) return events;
  s.t += dt;
  const run = runSpeed(s.dist);
  s.dist += run * dt;
  moveSquad(s, dt, input);
  s.invuln = Math.max(0, s.invuln - dt);
  s.slow = Math.max(0, s.slow - dt);
  direct(s, events);
  moveWorld(s, dt, run, events);
  passGates(s, events);
  allies(s, dt, events);
  fire(s, dt);
  moveBullets(s, dt, events);
  clash(s, dt, events);
  cleanup(s);
  if (s.count <= 0 && !s.over) {
    s.count = 0;
    s.over = true;
    events.push({ type: "over" });
  }
  return events;
}

function moveSquad(s, dt, input) {
  if (input.dir) s.x += input.dir * MOVE_SPEED * dt;
  else if (input.targetX != null && Number.isFinite(input.targetX)) {
    const diff = input.targetX - s.x;
    s.x += Math.sign(diff) * Math.min(Math.abs(diff), MOVE_SPEED * 1.4 * dt);
  }
  const lim = HALF - 0.3 - squadRadius(s.count) * 0.7;
  s.x = Math.max(-lim, Math.min(lim, s.x));
}

// ---- 사건 배치 ----

function direct(s, events) {
  const r = s.rng;
  if (s.boss) return;
  if (s.dist >= s.nextTrickle) {                     // 큰 사건 사이에도 작은 무리가 쉬지 않고 옴
    s.nextTrickle = s.dist + r.range(6, 10);
    spawnTrickle(s);
  }
  if (s.dist >= s.nextBoss) {
    spawnBoss(s, events);
    return;
  }
  if (s.dist < s.nextSpawn) return;
  s.nextSpawn = s.dist + r.range(28, 38);
  const rest = s.dist > 300 && s.dist % REST_EVERY < REST_LEN;
  const roll = r.next();
  if (s.sinceGate >= 3 || roll < 0.28) spawnGates(s);
  else if (!rest && roll < 0.78) spawnWave(s);
  else if (roll < 0.88 || rest) spawnCrate(s);
  else spawnCage(s);
}

function id(s) {
  s.seq += 1;
  return s.seq;
}

function makeGate(s, good) {
  const r = s.rng;
  const diff = difficulty(s.dist);
  const roll = r.next();
  if (good) {
    const mulChance = s.count > 10000 ? 0 : s.count > 1000 ? 0.05 : 0.14;   // 많아지면 곱하기 문은 드물게
    if (roll < mulChance) return { op: "mul", v: s.dist > 1500 && r.next() < 0.3 ? 3 : 2 };
    return { op: "num", v: Math.round(r.range(6, 16) * Math.pow(diff, 0.8)) };
  }
  if (roll < 0.28) return { op: "div", v: s.dist > 1200 && r.next() < 0.35 ? 3 : 2 };
  return { op: "num", v: -Math.round(r.range(10, 24) * Math.pow(diff, 0.82)) };
}

function spawnGates(s) {
  const r = s.rng;
  s.sinceGate = 0;
  // 좋은 문 1개 + 나쁜 문 2개 + (좋은 문 / 동료 / 나쁜 문 중 하나), 칸에 무작위로
  const roll = r.next();
  const extra = roll < 0.45 ? makeGate(s, true) : roll < 0.7 ? { op: "ally", ally: r.pick(Object.keys(ALLIES)) } : makeGate(s, false);
  const lanes = shuffle(r, [makeGate(s, true), makeGate(s, false), makeGate(s, false), extra]);
  for (const g of lanes) {
    g.acc = 0;
    if (g.op === "num" && r.next() < 0.12) g.hidden = true;                      // 미스터리 문
  }
  s.gates.push({ id: id(s), d: SPAWN_D, lanes, passed: false });
}

function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function enemyTypes(dist) {
  const out = [["mob", 6]];
  if (dist > 200) out.push(["rusher", 2]);
  if (dist > 400) out.push(["shield", 2]);
  if (dist > 550) out.push(["brute", 1.5]);
  return out;
}

function weighted(r, pairs) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let roll = r.next() * total;
  for (const [v, w] of pairs) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

export function makeGroup(s, type, x, d, n) {
  const diff = difficulty(s.dist);
  const unitHp = ENEMIES[type].hp * Math.pow(diff, 0.3);
  return { id: id(s), type, x, d, n, unitHp, pool: n * unitHp, r: groupRadius(type, n), engaged: false, clashAcc: 0 };
}

function spawnWave(s) {
  const r = s.rng;
  s.sinceGate += 1;
  const diff = difficulty(s.dist);
  const lanes = 1 + (s.dist > 250 ? 1 : 0) + (s.dist > 1000 && r.next() < 0.5 ? 1 : 0) + (s.dist > 2000 && r.next() < 0.5 ? 1 : 0);
  const xs = shuffle(r, [0, 1, 2, 3]).slice(0, lanes).map(laneX);
  for (const x of xs) {
    const type = weighted(r, enemyTypes(s.dist));
    const base = type === "brute" ? 1 : type === "rusher" ? r.range(5, 10) : r.range(10, 17);
    const n = type === "brute" ? 1 : Math.max(1, Math.round(base * Math.pow(diff, 0.8) * warmup(s.dist) / lanes ** 0.3));
    s.groups.push(makeGroup(s, type, x + r.range(-0.8, 0.8), SPAWN_D + r.range(0, 4), n));
  }
}

// 작은 무리 (졸병, 400m부터 가끔 돌격병)
function spawnTrickle(s) {
  const r = s.rng;
  const diff = difficulty(s.dist);
  const type = s.dist > 400 && r.next() < 0.3 ? "rusher" : "mob";
  const n = Math.max(1, Math.round(r.range(2, 5) * Math.pow(diff, 0.8) * warmup(s.dist)));
  s.groups.push(makeGroup(s, type, laneX(r.int(0, LANES - 1)) + r.range(-1, 1), SPAWN_D + r.range(0, 8), n));
}

function spawnCrate(s) {
  const r = s.rng;
  s.sinceGate += 1;
  const diff = difficulty(s.dist);
  let kind;
  let what;
  if (r.next() < 0.7) {
    kind = "weapon";
    const others = Object.keys(WEAPONS).filter((w) => w !== "pistol" && w !== s.weapon);
    what = r.next() < 0.3 && s.weapon !== "pistol" ? s.weapon : r.pick(others);
  } else {
    kind = "item";
    what = r.pick(Object.keys(ITEMS));
  }
  const hp = Math.round(14 * Math.pow(diff, 0.8));
  s.crates.push({ id: id(s), kind, what, x: laneX(r.int(0, LANES - 1)), d: SPAWN_D, hp, maxHp: hp });
}

function spawnCage(s) {
  const r = s.rng;
  s.sinceGate += 1;
  const diff = difficulty(s.dist);
  const hp = Math.round(10 * Math.pow(diff, 0.8));
  const n = Math.round(r.range(5, 12) * Math.pow(diff, 0.75));
  s.cages.push({ id: id(s), x: laneX(r.int(0, LANES - 1)), d: SPAWN_D, hp, maxHp: hp, n });
}

function spawnBoss(s, events) {
  const idx = s.bossKills + 1;
  const hp = Math.round(900 * difficulty(s.dist));
  // 보스는 12m 앞에 머묾 (화염방사기 사거리 14m 안)
  s.boss = { idx, hp, maxHp: hp, x: 0, d: SPAWN_D, hold: 12, state: "enter", t: 0, tx: 0, hitCd: 0 };
  events.push({ type: "boss", idx });
}

// ---- 움직임 ----

function moveWorld(s, dt, run, events) {
  for (const list of [s.gates, s.crates, s.cages]) for (const o of list) o.d -= run * dt;
  const slow = s.slow > 0 ? 0.35 : 1;
  for (const g of s.groups) {
    if (g.engaged) continue;
    const spec = ENEMIES[g.type];
    g.d -= (run + spec.speed * slow) * dt;
    if (g.d > 0) {
      const dx = s.x - g.x;
      g.x += Math.sign(dx) * Math.min(Math.abs(dx), spec.homing * slow * dt);
    }
  }
  if (s.boss) moveBoss(s, dt, events);
  for (const b of s.bombs) b.t -= dt;
  const landed = s.bombs.filter((b) => b.t <= 0);
  s.bombs = s.bombs.filter((b) => b.t > 0);
  for (const b of landed) {
    const hit = Math.abs(b.x - s.x) < b.r + squadRadius(s.count) * 0.4;
    const lost = hit ? lose(s, Math.max(4, Math.round(s.count * 0.15))) : 0;
    events.push({ type: "bomb", x: b.x, r: b.r, lost });
  }
}

// 보스: 들어와서 일정 거리에 머물며 폭탄·부하 소환·돌진을 번갈아 함
function moveBoss(s, dt, events) {
  const b = s.boss;
  const r = s.rng;
  b.t -= dt;
  if (b.state === "enter") {
    b.d -= 10 * dt;
    if (b.d <= b.hold) {
      b.d = b.hold;
      b.state = "idle";
      b.t = 1.5;
    }
  } else if (b.state === "idle" && b.t <= 0) {
    const roll = r.next();
    if (roll < 0.4) {
      for (const x of [s.x, s.x + r.range(2.5, 4.5), s.x - r.range(2.5, 4.5), r.range(-HALF + 1, HALF - 1)]) {
        if (Math.abs(x) < HALF) s.bombs.push({ x, r: 1.5, t: 1.3, total: 1.3 });
      }
      events.push({ type: "boss_bombs" });
      b.state = "idle";
      b.t = 2.6;
    } else if (roll < 0.65) {
      const n = Math.round(8 * Math.pow(difficulty(s.dist), 0.65));
      s.groups.push(makeGroup(s, "mob", b.x, b.d - 2.5, n));
      events.push({ type: "boss_summon" });
      b.state = "idle";
      b.t = 2.4;
    }
    if (b.state === "idle" && b.t <= 0) {
      b.state = "windup";
      b.t = 0.9;
      b.tx = Math.max(-HALF + 2, Math.min(HALF - 2, s.x));
      events.push({ type: "boss_windup" });
    }
  } else if (b.state === "windup") {
    b.x += (b.tx - b.x) * Math.min(1, dt * 6);
    if (b.t <= 0) b.state = "charge";
  } else if (b.state === "charge") {
    b.d -= 22 * dt;
    if (b.d <= 1.5) {
      const hit = Math.abs(b.x - s.x) < 1.8 + squadRadius(s.count);
      const lost = hit ? lose(s, Math.max(8, Math.round(s.count * 0.25))) : 0;
      events.push({ type: "boss_charge", lost });
      b.state = "back";
    }
  } else if (b.state === "back") {
    b.d += 12 * dt;
    b.x += (0 - b.x) * Math.min(1, dt * 2);
    if (b.d >= b.hold) {
      b.d = b.hold;
      b.state = "idle";
      b.t = 1.8;
    }
  }
}

// 병사 잃기 (보호막·방패병 반영). 실제로 잃은 수
function lose(s, n) {
  if (s.invuln > 0 || n <= 0) return 0;
  let take = n;
  if (s.allies.shield && s.shieldHp > 0) {
    const absorbed = Math.min(Math.ceil(n / 2), s.shieldHp);
    s.shieldHp -= absorbed;
    take -= absorbed;
    if (s.shieldHp <= 0) delete s.allies.shield;
  }
  take = Math.min(take, s.count);
  s.count -= take;
  return take;
}

// 문 지나기 (무리 가운데가 있는 칸의 문)
function passGates(s, events) {
  for (const g of s.gates) {
    if (g.passed || g.d > 0) continue;
    g.passed = true;
    const lane = laneOf(s.x);
    const gate = g.lanes[lane];
    const before = s.count;
    if (gate.op === "ally") {
      s.allies[gate.ally] = Math.min(MAX_LEVEL, (s.allies[gate.ally] || 0) + 1);
      if (gate.ally === "shield") s.shieldHp = Math.round(30 * Math.pow(difficulty(s.dist), 0.6)) * s.allies.shield;
    } else {
      s.count = applyGate(s.count, gate);
    }
    events.push({ type: "gate", lane, gate: { ...gate, hidden: false }, before, after: s.count, id: g.id });
  }
}

// 동료 효과
function allies(s, dt, events) {
  if (s.allies.medic) {
    s.medicAcc += dt;
    if (s.medicAcc >= 2) {
      s.medicAcc -= 2;
      const add = Math.min(MAX_SQUAD - s.count, Math.max(1, Math.round(s.count * 0.02 * s.allies.medic)));
      if (add > 0) {
        s.count += add;
        events.push({ type: "heal", n: add });
      }
    }
  }
  if (s.allies.artillery) {
    s.artAcc += dt;
    if (s.artAcc >= 3) {
      s.artAcc -= 3;
      const target = s.groups.filter((g) => g.d < 50 && g.d > -1).sort((a, b) => b.pool - a.pool)[0];
      const boss = s.boss && s.boss.state !== "enter" ? s.boss : null;
      const dmg = 10 * Math.pow(difficulty(s.dist), 0.9) * s.allies.artillery;
      if (target) {
        splash(s, target.x, target.d, 3, dmg * SPLASH_MUL, events);
        events.push({ type: "explode", x: target.x, d: target.d, r: 3 });
      } else if (boss) {
        hurtBoss(s, dmg * 2, events);
        events.push({ type: "explode", x: boss.x, d: boss.d, r: 3 });
      }
    }
  }
}

// ---- 사격 ----

function fire(s, dt) {
  if (s.count <= 0) return;
  const w = WEAPONS[s.weapon];
  const r = s.rng;
  const radius = squadRadius(s.count);
  const shooters = Math.min(s.count, shotsPerVolley(w, s.count));
  const pellets = w.pellets || 1;
  const nb = shooters * pellets;
  const dmg = (s.count * w.dps * levelMul(s.level)) / (w.rate * nb);
  const gate = GATE_RATE / (w.rate * nb);
  const gap = 1 / (w.rate * shooters);              // 병사들이 번갈아 한 발씩 (같은 총량)
  s.fireAcc += dt;
  while (s.fireAcc >= gap) {
    s.fireAcc -= gap;
    const x = s.x + r.range(-radius, radius) * 0.8;
    for (let p = 0; p < pellets; p++) {
      const angle = pellets > 1 ? (p / (pellets - 1) - 0.5) * w.spread * 2 + r.gauss() * 0.03 : r.gauss() * w.spread;
      s.bullets.push({
        x, d: 0.6, vx: Math.sin(angle) * w.speed, vd: Math.cos(angle) * w.speed, dmg, gate,
        ttl: w.range / w.speed, pierce: w.pierce || 0, splash: w.splash || 0, hit: null,
      });
    }
  }
}

function moveBullets(s, dt, events) {
  const keep = [];
  for (const b of s.bullets) {
    const steps = Math.max(1, Math.ceil((b.vd * dt) / 0.45));
    let alive = true;
    for (let k = 0; k < steps && alive; k++) {
      const d0 = b.d;
      b.d += (b.vd * dt) / steps;
      b.x += (b.vx * dt) / steps;
      alive = collide(s, b, d0, events);
    }
    b.ttl -= dt;
    if (alive && b.ttl > 0 && Math.abs(b.x) < HALF + 1) keep.push(b);
  }
  s.bullets = keep;
}

// 총알 한 발이 닿는 것 처리. 총알이 남으면 true
function collide(s, b, d0, events) {
  // 문 (앞쪽 문만, 닿으면 총알은 사라짐)
  for (const g of s.gates) {
    if (g.passed || !(d0 < g.d && b.d >= g.d)) continue;
    const gate = g.lanes[laneOf(b.x)];
    if (gate.op === "num") {
      gate.acc += b.gate;
      const up = Math.floor(gate.acc);
      if (up > 0) {
        gate.acc -= up;
        gate.v += up;
      }
    }
    return false;
  }
  // 상자·철창
  for (const list of [s.crates, s.cages]) {
    for (const c of list) {
      if (c.hp <= 0 || Math.abs(b.x - c.x) > 0.8 || b.d < c.d - 0.6 || b.d > c.d + 0.6) continue;
      if (b.splash) splash(s, b.x, b.d, b.splash, b.dmg * SPLASH_MUL, events);
      else hurtBox(s, list, c, b.dmg, events);
      return false;
    }
  }
  // 보스
  const boss = s.boss;
  if (boss && boss.hp > 0 && Math.hypot(b.x - boss.x, b.d - boss.d) < 2.2 && b.hit !== "boss") {
    hurtBoss(s, b.splash ? b.dmg * SPLASH_MUL : b.dmg, events);
    if (b.splash) events.push({ type: "explode", x: b.x, d: b.d, r: b.splash });
    if (b.pierce > 0) {
      b.pierce -= 1;
      b.hit = "boss";
      return true;
    }
    return false;
  }
  // 적 무리
  for (const g of s.groups) {
    if (g.pool <= 0 || g.id === b.hit || Math.hypot(b.x - g.x, b.d - g.d) > g.r + 0.15) continue;
    if (b.splash) {
      splash(s, b.x, b.d, b.splash, b.dmg * SPLASH_MUL, events);
      events.push({ type: "explode", x: b.x, d: b.d, r: b.splash });
      return false;
    }
    const armor = ENEMIES[g.type].armor && !b.pierce ? ENEMIES[g.type].armor : 1;
    hurtGroup(s, g, b.dmg * armor, events);
    if (b.pierce > 0) {
      b.pierce -= 1;
      b.hit = g.id;
      return true;
    }
    return false;
  }
  return true;
}

function hurtGroup(s, g, dmg, events) {
  const before = g.n;
  g.pool = Math.max(0, g.pool - dmg);
  g.n = Math.ceil(g.pool / g.unitHp - 1e-9);
  const dead = before - g.n;
  if (dead > 0) {
    s.kills += dead;
    events.push({ type: "kill", x: g.x, d: g.d, n: dead, group: g.type });
  }
}

function hurtBoss(s, dmg, events) {
  const b = s.boss;
  if (!b || b.hp <= 0) return;
  b.hp = Math.max(0, b.hp - dmg);
  if (b.hp > 0) return;
  s.bossKills += 1;
  s.bonus += 500 * b.idx;
  s.count = Math.min(MAX_SQUAD, s.count + 20);
  s.level = Math.min(MAX_LEVEL, s.level + 1);
  s.nextBoss = s.dist + BOSS_EVERY;
  s.nextSpawn = s.dist + 25;
  s.bombs = [];
  events.push({ type: "boss_down", idx: b.idx, x: b.x, d: b.d });
  s.boss = null;
}

function hurtBox(s, list, c, dmg, events) {
  c.hp = Math.max(0, c.hp - dmg);
  if (c.hp > 0) return;
  if (list === s.cages) {
    const add = Math.min(MAX_SQUAD - s.count, c.n);
    s.count += add;
    events.push({ type: "cage", n: add, x: c.x, d: c.d });
  } else if (c.kind === "weapon") {
    if (c.what === s.weapon) s.level = Math.min(MAX_LEVEL, s.level + 1);
    else s.weapon = c.what;
    events.push({ type: "weapon", weapon: s.weapon, level: s.level, x: c.x, d: c.d });
  } else {
    useItem(s, c.what, events);
    events.push({ type: "item", item: c.what, x: c.x, d: c.d });
  }
}

function useItem(s, item, events) {
  if (item === "shield") s.invuln = 5;
  else if (item === "slow") s.slow = 6;
  else if (item === "grenade") {
    for (const g of s.groups) {
      if (g.d < 32 && g.d > -1) hurtGroup(s, g, Math.max(g.pool * 0.7, 10), events);
    }
    if (s.boss) hurtBoss(s, s.boss.maxHp * 0.1, events);
    events.push({ type: "explode", x: s.x, d: 14, r: 7 });
  }
}

// 폭발 (범위 안 적 무리, 상자, 철창)
function splash(s, x, d, radius, dmg, events) {
  for (const g of s.groups) {
    if (g.pool > 0 && Math.hypot(g.x - x, g.d - d) < radius + g.r) hurtGroup(s, g, dmg, events);
  }
  for (const list of [s.crates, s.cages]) {
    for (const c of list) {
      if (c.hp > 0 && Math.hypot(c.x - x, c.d - d) < radius + 0.6) hurtBox(s, list, c, dmg / SPLASH_MUL, events);
    }
  }
}

// ---- 맞붙기 ----

function clash(s, dt, events) {
  const radius = squadRadius(s.count);
  let lostTotal = 0;
  let killed = 0;
  for (const g of s.groups) {
    if (g.pool <= 0) continue;
    const touching = g.d - g.r <= radius * 0.5 && g.d > -radius && Math.abs(g.x - s.x) < g.r + radius * 0.8;
    if (!touching) {
      g.engaged = false;
      continue;
    }
    g.engaged = true;
    g.d = Math.max(g.d, radius * 0.5 + g.r * 0.4);
    const spec = ENEMIES[g.type];
    g.clashAcc += (CLASH_RATE + 0.6 * Math.min(s.count, g.n)) * dt * (g.type === "brute" ? 0.25 : 1);
    const k = Math.min(g.n, Math.floor(g.clashAcc));
    if (k <= 0) continue;
    g.clashAcc -= k;
    const before = g.n;
    g.pool = Math.max(0, g.pool - k * g.unitHp);
    g.n = Math.ceil(g.pool / g.unitHp - 1e-9);
    s.kills += before - g.n;
    killed += before - g.n;
    lostTotal += lose(s, k * spec.power);
    if (s.count <= 0) break;
  }
  if (lostTotal || killed) events.push({ type: "clash", lost: lostTotal, killed });
}

function cleanup(s) {
  s.groups = s.groups.filter((g) => g.pool > 0 && g.d > -6);
  s.gates = s.gates.filter((g) => g.d > -4);
  s.crates = s.crates.filter((c) => c.hp > 0 && c.d > -3);
  s.cages = s.cages.filter((c) => c.hp > 0 && c.d > -3);
}
