// 길건너기 화면: 게임 진행(시작·끝·최고 기록), 입력(키보드·탭·밀기), three.js 복셀 그리기.
// 규칙은 logic.js 에 있고, 여기서는 그 상태를 매 프레임 그린다. 그래픽은 상자 도형으로 만든 복셀 스타일.
import * as THREE from "three";
import { HOP_TIME, SPAN, W, EDGE_LAG, createGame, move, rowAt, step, traffic } from "./logic.js";

const $ = (sel) => document.querySelector(sel);
const DT = 1 / 60;
const BEST_KEY = "crossy-best";
const COIN_KEY = "crossy-coins";
const CAUSES = {
  car: "차에 치였어요",
  train: "기차에 치였어요",
  water: "물에 빠졌어요",
  river: "떠내려갔어요",
  eagle: "독수리가 잡아갔어요",
};

// ---------- 상태 ----------

let game = null;
let mode = "ready";                 // ready → play → over
let acc = 0;
let last = performance.now();
let best = readNum(BEST_KEY);
let bank = readNum(COIN_KEY);

function readNum(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNum(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch {}
}

// ---------- 3D 기본 ----------

const canvas = $("#board");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3f5);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x7a9a6a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

const mats = new Map();
// 단색 재질 (같은 색은 하나로 나눠 씀)
function mat(color) {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return mats.get(color);
}
const unit = new THREE.BoxGeometry(1, 1, 1);

// 상자 하나 (가운데 아래 기준이 아니라 가운데 기준)
function box(w, h, d, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(unit, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ---------- 줄 모형 ----------

const rowMeshes = new Map();          // z → { group, cars, logs, train, light, coins }
const GROUND_W = SPAN * 2 + 1;

function makeTree(x, h) {
  const g = new THREE.Group();
  g.add(box(0.3, 0.4, 0.3, 0x8a5a2b, 0, 0.2, 0));
  g.add(box(0.8, h, 0.8, 0x3f9e3a, 0, 0.4 + h / 2, 0));
  if (h > 0.9) g.add(box(0.6, 0.35, 0.6, 0x57b84a, 0, 0.4 + h + 0.17, 0));
  g.position.x = x;
  return g;
}

function makeCar(c, truck) {
  const g = new THREE.Group();
  if (truck) {
    g.add(box(c.len * 0.68, 0.75, 0.78, 0xdedede, -0.15 * c.len, 0.55, 0));
    g.add(box(c.len * 0.3, 0.6, 0.78, c.color, 0.36 * c.len, 0.47, 0));
    g.add(box(c.len * 0.06, 0.3, 0.6, 0x9fd9ff, 0.5 * c.len - 0.03, 0.6, 0, false));
  } else {
    g.add(box(c.len, 0.38, 0.78, c.color, 0, 0.36, 0));
    g.add(box(c.len * 0.55, 0.3, 0.68, 0xffffff, -0.05, 0.7, 0));
    g.add(box(c.len * 0.56, 0.18, 0.7, 0x9fd9ff, -0.05, 0.7, 0, false));
  }
  for (const [wx, wz] of [[-0.3, 0.4], [0.3, 0.4], [-0.3, -0.4], [0.3, -0.4]]) g.add(box(0.28, 0.28, 0.12, 0x222222, wx * c.len, 0.14, wz));
  scene.add(g);
  return g;
}

function makeLog(l) {
  const g = new THREE.Group();
  g.add(box(l.len - 0.06, 0.32, 0.8, 0x9b6a3c));
  for (const s of [-1, 1]) g.add(box(0.04, 0.26, 0.66, 0xc49461, s * (l.len / 2 - 0.03), 0, 0, false));   // 나이테 쪽 끝
  scene.add(g);
  return g;
}

function makeTrain(len, dir) {
  const g = new THREE.Group();
  for (let i = 0; i < len; i += 3) {
    const head = i === 0;
    g.add(box(2.8, 1.1, 0.86, head ? 0xd93c3c : 0x3c6fd9, -dir * (i + 1.4) + dir * len / 2, 0.65, 0));
    g.add(box(2.4, 0.3, 0.7, 0xffffff, -dir * (i + 1.4) + dir * len / 2, 1.0, 0, false));
  }
  scene.add(g);
  return g;
}

function makeCoin(x) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 14), mat(0xffd23f));
  c.rotation.x = Math.PI / 2;
  c.position.set(x, 0.45, 0);
  c.castShadow = true;
  return c;
}

// 줄 하나 만들기
function buildRow(row, prev, next) {
  const group = new THREE.Group();
  group.position.z = -row.z;
  const entry = { group, cars: [], logs: [], train: null, light: null, coins: new Map(), row };
  if (row.type === "grass") {
    const light = row.z % 2 === 0;
    group.add(box(GROUND_W, 0.3, 1, light ? 0x9ddc6f : 0x93d266, 0, -0.15, 0, false));
    for (const side of [-1, 1]) group.add(box(SPAN - W, 0.31, 1, light ? 0x7cbf55 : 0x74b64f, side * (W + 0.5 + (SPAN - W) / 2), -0.15, 0, false));
    for (const x of row.blocks) {
      if (row.kinds[x] === "rock") group.add(box(0.7, 0.45, 0.7, 0x9aa0a6, x, 0.22, 0));
      else group.add(makeTree(x, 0.6 + ((x * 7 + row.z * 13) % 3) * 0.35));
    }
  } else if (row.type === "road") {
    group.add(box(GROUND_W, 0.3, 1, 0x4b4f57, 0, -0.17, 0, false));
    if (next?.type === "road") for (let x = -SPAN; x <= SPAN; x += 2) group.add(box(0.8, 0.02, 0.08, 0xe9e9e9, x, -0.01, -0.5, false));
    entry.cars = row.cars.map((c) => makeCar(c, row.truck));
  } else if (row.type === "rail") {
    group.add(box(GROUND_W, 0.3, 1, 0x8c7d6b, 0, -0.17, 0, false));
    for (let x = -SPAN; x <= SPAN; x++) group.add(box(0.25, 0.06, 0.9, 0x6b4a2b, x, 0, 0, false));
    for (const z of [-0.28, 0.28]) group.add(box(GROUND_W, 0.08, 0.08, 0xb8bcc2, 0, 0.06, z, false));
    const pole = box(0.12, 1.2, 0.12, 0x555555, W + 0.8, 0.6, -0.4);
    entry.light = box(0.3, 0.3, 0.1, 0x552222, W + 0.8, 1.25, -0.4, false);
    entry.light.material = new THREE.MeshBasicMaterial({ color: 0x552222 });
    // 경고 중에는 철길 전체가 빨갛게 깜빡임
    entry.alarm = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false }));
    entry.alarm.scale.set(GROUND_W, 0.02, 0.96);
    entry.alarm.position.y = 0.12;
    group.add(pole, entry.light, entry.alarm);
  } else if (row.type === "river") {
    group.add(box(GROUND_W, 0.2, 1, 0x4fb3e8, 0, -0.32, 0, false));
    for (const x of row.pads) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 12), mat(0x4caf50));
      pad.position.set(x, -0.18, 0);
      pad.receiveShadow = true;
      group.add(pad);
    }
    entry.logs = row.logs.map((l) => makeLog(l));
  }
  for (const x of row.coins || []) {
    const c = makeCoin(x);
    group.add(c);
    entry.coins.set(x, c);
  }
  scene.add(group);
  return entry;
}

function dropRow(entry) {
  scene.remove(entry.group);
  for (const m of [...entry.cars, ...entry.logs]) scene.remove(m);
  if (entry.train) scene.remove(entry.train);
}

// 줄 모형 맞추기 (생긴 줄은 만들고, 지나간 줄은 치움) + 움직이는 것 옮기기
function syncRows(s, now) {
  const live = new Set();
  s.rows.forEach((row, i) => {
    live.add(row.z);
    let e = rowMeshes.get(row.z);
    if (!e || e.row !== row) {
      if (e) dropRow(e);
      rowMeshes.set(row.z, (e = buildRow(row, s.rows[i - 1], s.rows[i + 1])));
    }
    if (row.type === "road") {
      row.cars.forEach((c, k) => {
        e.cars[k].position.set(c.x, 0, -row.z);
        e.cars[k].rotation.y = row.dir > 0 ? 0 : Math.PI;
      });
    } else if (row.type === "river") {
      row.logs.forEach((l, k) => {
        e.logs[k].position.set(l.x, -0.12 + Math.sin(now / 400 + k) * 0.015, -row.z);
      });
    } else if (row.type === "rail") {
      if (row.train && !e.train) e.train = makeTrain(row.train.len, row.dir);
      if (!row.train && e.train) {
        scene.remove(e.train);
        e.train = null;
      }
      if (e.train) e.train.position.set(row.train.x, 0, -row.z);
      const on = row.warn && Math.floor(now / 180) % 2 === 0;
      e.light.material.color.setHex(on ? 0xff3030 : row.train ? 0xff3030 : 0x552222);
      e.alarm.material.opacity = on ? 0.38 : 0;
    }
    for (const [x, c] of e.coins) {
      if (!row.coins.has(x)) {
        e.group.remove(c);
        e.coins.delete(x);
      } else c.rotation.z = now / 300;
    }
  });
  for (const [z, e] of rowMeshes) {
    if (!live.has(z)) {
      dropRow(e);
      rowMeshes.delete(z);
    }
  }
}

// ---------- 닭 ----------

const chicken = new THREE.Group();
{
  const body = new THREE.Group();
  body.add(box(0.5, 0.5, 0.55, 0xffffff, 0, 0.35, 0));
  body.add(box(0.36, 0.3, 0.3, 0xffffff, 0, 0.72, -0.1));          // 머리
  body.add(box(0.12, 0.12, 0.2, 0xe23b3b, 0, 0.92, -0.08));        // 볏
  body.add(box(0.14, 0.08, 0.12, 0xff9a1f, 0, 0.66, -0.3));        // 부리
  body.add(box(0.08, 0.1, 0.06, 0xe23b3b, 0, 0.56, -0.27));        // 턱볏
  for (const s of [-1, 1]) {
    body.add(box(0.06, 0.06, 0.02, 0x111111, s * 0.1, 0.78, -0.26, false));   // 눈
    body.add(box(0.08, 0.26, 0.34, 0xf2f2f2, s * 0.29, 0.36, 0.02));         // 날개
    body.add(box(0.06, 0.12, 0.06, 0xff9a1f, s * 0.12, 0.05, 0));            // 다리
  }
  body.add(box(0.2, 0.16, 0.12, 0xffffff, 0, 0.5, 0.32));            // 꼬리
  chicken.add(body);
  chicken.userData.body = body;
}
scene.add(chicken);
const shown = { fromX: 0, fromZ: 0, t: 1, face: 0 };
const pending = [];                  // 키·터치로 움직일 때 생긴 사건 (다음 프레임에 처리)

// 한 칸 뛰기 시작 (지금 보이는 자리에서 출발)
function onHop() {
  shown.fromX = chicken.position.x;
  shown.fromZ = -chicken.position.z;
  shown.t = 0;
}
const FACE = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

// 독수리 (잡아갈 때만)
const eagle = new THREE.Group();
{
  eagle.add(box(0.9, 0.5, 1.4, 0x6b4a2b, 0, 0, 0));
  eagle.add(box(0.5, 0.45, 0.5, 0xffffff, 0, 0.15, -0.85));
  eagle.add(box(0.2, 0.15, 0.3, 0xf2c14e, 0, 0.1, -1.2));
  for (const s of [-1, 1]) eagle.add(box(2.2, 0.12, 0.8, 0x5a3d22, s * 1.4, 0.1, 0.1));
  eagle.visible = false;
  scene.add(eagle);
}

const effects = [];

// 물 튀김
function splash(x, z) {
  for (let i = 0; i < 10; i++) {
    const d = box(0.12, 0.12, 0.12, 0xdff4ff, x, 0, -z, false);
    scene.add(d);
    const v = { x: (Math.random() - 0.5) * 3, y: 3 + Math.random() * 2, z: (Math.random() - 0.5) * 3 };
    const start = performance.now();
    effects.push((now) => {
      const t = (now - start) / 1000;
      d.position.set(x + v.x * t, v.y * t - 6 * t * t, -z + v.z * t);
      if (t < 0.9) return false;
      scene.remove(d);
      return true;
    });
  }
}

// 동전 반짝
function coinPop(x, z) {
  const c = makeCoin(0);
  c.position.set(x, 0.5, -z);
  scene.add(c);
  const start = performance.now();
  effects.push((now) => {
    const t = (now - start) / 500;
    c.position.y = 0.5 + t * 1.2;
    c.rotation.z = t * 10;
    c.scale.setScalar(1 - t * 0.6);
    if (t < 1) return false;
    scene.remove(c);
    return true;
  });
}

// 죽는 모습
let deathAt = 0;
const deathPos = { x: 0, z: 0 };        // 죽은 자리
function deathAnim(cause, now) {
  deathAt = now;
  deathPos.x = chicken.position.x;
  deathPos.z = -chicken.position.z;
  const body = chicken.userData.body;
  if (cause === "car" || cause === "train") {
    chicken.position.y = 0.02;                                       // 땅에 붙어서 깔림
  } else if (cause === "water" || cause === "river") {
    splash(deathPos.x, deathPos.z);
  } else if (cause === "eagle") {
    eagle.visible = true;
  }
}

function animateDeath(s, now) {
  const t = (now - deathAt) / 1000;
  if (s.cause === "water" || s.cause === "river") chicken.position.y = -Math.min(1, t * 2);
  if (s.cause === "car" || s.cause === "train") {
    const k = Math.min(1, t / 0.08);                                 // 순식간에 납작
    chicken.userData.body.scale.set(1 + 0.6 * k, 1 - 0.92 * k, 1 + 0.6 * k);
  }
  if (s.cause === "eagle") {
    const k = Math.min(1, t / 0.6);
    eagle.position.set(deathPos.x, 6 - 5.4 * k, -deathPos.z - 8 + 8 * k);
    if (t > 0.6) {
      const u = t - 0.6;
      eagle.position.set(deathPos.x, 0.6 + u * 4, -deathPos.z - u * 10);
      chicken.position.set(deathPos.x, eagle.position.y - 0.6, eagle.position.z);
    }
  }
}

// ---------- 화면 정보 ----------

let bannerTimer = null;
// 잠깐 띄우는 알림
function banner(text) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove("on"), 1200);
}

const hud = {};
function setText(id, text) {
  if (hud[id] === text) return;
  hud[id] = text;
  $(`#${id}`).textContent = text;
}

function showPanel(title, text, button, board = false) {
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  $("#panel-btn").textContent = button;
  $("#panel").classList.remove("hidden");
  $("#lb").replaceChildren();
  if (board) window.Leaderboard?.mount($("#lb"), "crossy", { unit: "칸" });
}

// ---------- 진행 ----------

// 새 판 (지난 판 모형 정리)
function start() {
  for (const e of rowMeshes.values()) dropRow(e);
  rowMeshes.clear();
  game = createGame(Date.now() >>> 0);
  Object.assign(shown, { fromX: 0, fromZ: 0, t: 1, face: 0 });
  pending.length = 0;
  chicken.userData.body.scale.set(1, 1, 1);
  chicken.rotation.set(0, 0, 0);
  chicken.position.set(0, 0, 0);
  eagle.visible = false;
  acc = 0;
  mode = "play";
  $("#panel").classList.add("hidden");
}

function gameOver(s, now) {
  mode = "over";
  deathAnim(s.cause, now);
  bank += s.coins;
  writeNum(COIN_KEY, bank);
  const isBest = s.score > best;
  best = Math.max(best, s.score);
  writeNum(BEST_KEY, best);
  const posted = window.Leaderboard?.submit("crossy", s.score, s.t);          // 순위에 올리기
  setTimeout(async () => {
    if (mode !== "over") return;
    showPanel(isBest ? "🏆 최고 기록!" : CAUSES[s.cause] || "끝", `${s.score}칸 건넜어요 · 최고 ${best}\n이번 판 동전 ${s.coins} · 모은 동전 ${bank}`, "다시 하기");
    if (posted) window.Leaderboard.mount($("#lb"), "crossy", { unit: "칸", result: await posted });
  }, 900);
}

$("#panel-btn").onclick = () => start();

// ---------- 입력 ----------

const KEYS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };

document.addEventListener("keydown", (e) => {
  if (KEYS[e.code]) {
    e.preventDefault();
    if (mode === "play" && !e.repeat) move(game, KEYS[e.code], pending);
    else if (mode === "ready" && !e.repeat) start();
  } else if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (mode !== "play") start();
    else move(game, "up", pending);
  }
});

// 탭은 앞으로, 밀면 그 방향
let touch = null;
canvas.addEventListener("pointerdown", (e) => {
  touch = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (!touch) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  touch = null;
  if (mode !== "play") return;
  if (Math.hypot(dx, dy) < 25) return void move(game, "up", pending);
  if (Math.abs(dx) > Math.abs(dy)) move(game, dx > 0 ? "right" : "left", pending);
  else move(game, dy < 0 ? "up" : "down", pending);
});

// ---------- 매 프레임 ----------

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 46 : 32;                           // 세로 화면은 넓게
    camera.updateProjectionMatrix();
  }
}

const camPos = new THREE.Vector3(0, 0, 0);

// 닭 위치·뛰는 모습
function drawChicken(s, now, frame) {
  if (mode === "over") return animateDeath(s, now);
  shown.t = Math.min(1, shown.t + frame / HOP_TIME);
  const k = shown.t;
  const x = shown.fromX + (s.x - shown.fromX) * k;
  const z = shown.fromZ + (s.z - shown.fromZ) * k;
  const onRiver = rowAt(s, s.z)?.type === "river";
  chicken.position.set(x, Math.sin(k * Math.PI) * 0.35 + (onRiver ? 0.02 : 0), -z);
  const body = chicken.userData.body;
  body.scale.set(1, k < 1 ? 1.1 : 1, 1);
  shown.face += ((FACE[s.facing] - shown.face + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.4;
  chicken.rotation.y = shown.face;
}

// 카메라: 닭을 따라가되, 화면 아래 끝이 올라오면 같이 올라감
function updateCamera(s, frame) {
  const tz = Math.max(s.z, s.edge + EDGE_LAG - 2);
  const tx = Math.max(-2, Math.min(2, s.x * 0.5));
  camPos.x += (tx - camPos.x) * Math.min(1, frame * 4);
  camPos.z += (tz - camPos.z) * Math.min(1, frame * 4);
  camera.position.set(camPos.x + 3.4, 13, -camPos.z + 9.5);
  camera.lookAt(camPos.x, 0, -camPos.z - 2.2);
  sun.position.set(camPos.x + 6, 14, -camPos.z + 6);
  sun.target.position.set(camPos.x, 0, -camPos.z - 2);
}

function tick(now) {
  const frame = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    resize();
    const s = game || idle;
    if (game && mode === "play") {
      acc += frame;
      const events = pending.splice(0);
      while (acc >= DT && !game.over) {
        acc -= DT;
        events.push(...step(game, DT));
      }
      for (const e of events) {
        if (e.type === "hop") onHop();
        if (e.type === "coin") coinPop(e.x, e.z);
        if (e.type === "warn" && Math.abs(e.z - game.z) <= 3) banner("🚂 기차!");
        if (e.type === "over") gameOver(game, now);
      }
    } else if (game && mode === "over") {
      traffic(game, frame);                                        // 죽은 뒤에도 차는 계속 지나감
    }
    syncRows(s, now);
    drawChicken(s, now, frame);
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
    if (mode !== "over") updateCamera(s, frame);
    setText("score", String(s.score));
    setText("best", `최고 ${Math.max(best, s.score)}`);
    setText("coins", String(bank + (game && mode === "play" ? game.coins : 0)));
    renderer.render(scene, camera);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(tick);
}

// 시작 전 화면용 (출발점 풍경)
const idle = createGame(7);
showPanel("길건너기", "차와 기차를 피하고, 통나무를 타고 강을 건너\n최대한 멀리 가세요!", "시작하기", true);
requestAnimationFrame(tick);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__crossy = {
  get game() { return game; },
  get mode() { return mode; },
  start,
  move: (d) => move(game, d, pending),
};
