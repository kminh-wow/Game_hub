// 숫자러너 화면: 게임 진행(시작·일시정지·끝), 입력, three.js 그리기.
// 규칙은 logic.js 에 있고, 여기서는 그 상태를 매 프레임 그린다. 그래픽은 도형으로 대충 만든 것 (디자인은 나중에 교체).
import * as THREE from "three";
import {
  ALLIES, HALF, ITEMS, LANES, LANE_W, ROAD_W, WEAPONS, createGame, gateGood, gateLabel, laneOf, laneX, score, squadRadius, step,
} from "./logic.js";

const $ = (sel) => document.querySelector(sel);
const DT = 1 / 60;
const MAX_SOLDIERS = 260;       // 그리는 병사 수 한도 (숫자는 그대로)
const MAX_ENEMIES = 700;
const MAX_BULLETS = 1200;
const PER_GROUP = 70;           // 적 무리 하나에 그리는 수 한도
const ROAD_LEN = 150;
const BEST_KEY = "runner-best";
const ENEMY_COLORS = { mob: 0xe0453a, rusher: 0xff8a2a, shield: 0x6f7f95, brute: 0x8a1f2a };

// ---------- 상태 ----------

let game = null;
let mode = "ready";             // ready → play ↔ pause → over
let acc = 0;
let last = performance.now();
let targetX = null;
let shake = 0;
let best = readBest();

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  best = Math.max(best, v);
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {}
}

// ---------- 3D 기본 ----------

const canvas = $("#board");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd4ff);
scene.fog = new THREE.Fog(0x9fd4ff, 38, 85);
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f5a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(6, 14, 8);
scene.add(sun);

// 줄무늬 텍스처 (도로·잔디가 흘러가는 느낌)
function stripeTexture(draw, repeatY) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  draw(c.getContext("2d"));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 도로, 잔디, 연석
const roadTex = stripeTexture((c) => {
  c.fillStyle = "#5d6168";
  c.fillRect(0, 0, 128, 256);
  c.fillStyle = "#f2f2f2";
  for (let i = 1; i < LANES; i++) c.fillRect((128 * i) / LANES - 2, 0, 4, 130);   // 칸 구분선
  c.fillStyle = "#e9c46a";
  c.fillRect(0, 0, 5, 256);
  c.fillRect(123, 0, 5, 256);
}, ROAD_LEN / 10);
const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshLambertMaterial({ map: roadTex }));
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -ROAD_LEN / 2 + 15);
scene.add(road);
const grassTex = stripeTexture((c) => {
  c.fillStyle = "#79b85a";
  c.fillRect(0, 0, 128, 256);
  c.fillStyle = "#6aa84d";
  c.fillRect(0, 0, 128, 128);
}, ROAD_LEN / 16);
for (const side of [-1, 1]) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(40, ROAD_LEN), new THREE.MeshLambertMaterial({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(side * (HALF + 20), -0.02, -ROAD_LEN / 2 + 15);
  scene.add(grass);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, ROAD_LEN), new THREE.MeshLambertMaterial({ color: 0xd9d9d9 }));
  curb.position.set(side * (HALF + 0.2), 0.12, -ROAD_LEN / 2 + 15);
  scene.add(curb);
}

// 길가 나무 (지나가는 속도감)
const TREE_GAP = 9;
const treeCount = Math.ceil(ROAD_LEN / TREE_GAP) * 2;
const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), new THREE.MeshLambertMaterial({ color: 0x7a5434 }), treeCount);
const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.2, 7), new THREE.MeshLambertMaterial({ color: 0x3f8a46 }), treeCount);
scene.add(trunks, leaves);

const tmp = new THREE.Object3D();

function drawTrees(dist) {
  let i = 0;
  for (const side of [-1, 1]) {
    for (let k = 0; k < treeCount / 2; k++) {
      const z = 15 - ROAD_LEN + ((k * TREE_GAP + dist + (side > 0 ? TREE_GAP / 2 : 0)) % ROAD_LEN);   // 달릴수록 다가옴
      const x = side * (HALF + 3 + ((k * 7) % 5));
      tmp.position.set(x, 0.6, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      trunks.setMatrixAt(i, tmp.matrix);
      tmp.position.y = 2.2;
      tmp.updateMatrix();
      leaves.setMatrixAt(i, tmp.matrix);
      i++;
    }
  }
  trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
}

// ---------- 글자 스프라이트 ----------

function textSprite(width = 256, height = 96) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  return { c, tex, sprite, key: null };
}

// 글자 그리기 (같은 내용이면 건너뜀)
function paint(label, text, { color = "#fff", bg = null, size = 56 } = {}) {
  const key = `${text}|${color}|${bg}`;
  if (label.key === key) return;
  label.key = key;
  const ctx = label.c.getContext("2d");
  const { width, height } = label.c;
  ctx.clearRect(0, 0, width, height);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(4, 8, width - 8, height - 16, 18);
    ctx.fill();
  }
  ctx.font = `900 ${size}px "Malgun Gothic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.strokeText(text, width / 2, height / 2 + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2 + 2);
  label.tex.needsUpdate = true;
}

// ---------- 내 무리 ----------

const soldierBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8), new THREE.MeshLambertMaterial({ color: 0x2f7bff }), MAX_SOLDIERS);
const soldierHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf2c9a0 }), MAX_SOLDIERS);
soldierBody.frustumCulled = soldierHead.frustumCulled = false;
scene.add(soldierBody, soldierHead);
const countLabel = textSprite(256, 96);
countLabel.sprite.scale.set(1.8, 0.68, 1);
scene.add(countLabel.sprite);
let shownCount = 10;

// 해바라기 배치 (i 번째 점의 원 안 위치)
function sunflower(i, n, radius) {
  const r = radius * Math.sqrt((i + 0.5) / n);
  const a = i * 2.39996;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function drawSquad(s, now) {
  shownCount += (s.count - shownCount) * 0.2;
  const n = Math.min(MAX_SOLDIERS, s.count);
  const radius = squadRadius(shownCount);
  for (let i = 0; i < n; i++) {
    const [ox, oz] = sunflower(i, n, radius);
    const bob = Math.abs(Math.sin(now / 90 + i * 1.7)) * 0.1;
    tmp.position.set(s.x + ox, 0.32 + bob, oz * 0.8 + radius * 0.2);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    soldierBody.setMatrixAt(i, tmp.matrix);
    tmp.position.y += 0.4;
    tmp.updateMatrix();
    soldierHead.setMatrixAt(i, tmp.matrix);
  }
  soldierBody.count = soldierHead.count = n;
  soldierBody.instanceMatrix.needsUpdate = soldierHead.instanceMatrix.needsUpdate = true;
  paint(countLabel, String(s.count), { bg: s.invuln > 0 ? "rgba(80,200,255,.85)" : "rgba(47,123,255,.9)" });
  countLabel.sprite.position.set(s.x, 1.35 + radius * 0.3, radius * 0.5);
}

// ---------- 적 ----------

const enemyBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.16, 0.34, 3, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_ENEMIES);
const enemyHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6a3a2a }), MAX_ENEMIES);
enemyBody.frustumCulled = enemyHead.frustumCulled = false;
scene.add(enemyBody, enemyHead);
const groupLabels = new Map();
const color = new THREE.Color();

function drawEnemies(s, now) {
  let i = 0;
  const seen = new Set();
  for (const g of s.groups) {
    seen.add(g.id);
    const brute = g.type === "brute";
    const m = brute ? 1 : Math.min(PER_GROUP, g.n);
    const scale = brute ? 3 : 1;
    color.setHex(ENEMY_COLORS[g.type]);
    for (let k = 0; k < m && i < MAX_ENEMIES; k++, i++) {
      const [ox, oz] = brute ? [0, 0] : sunflower(k, m, g.r * 0.9);
      const bob = Math.abs(Math.sin(now / 80 + k * 2.1)) * 0.1 * (g.engaged ? 2 : 1);
      tmp.position.set(g.x + ox, (0.32 + bob) * scale, -g.d + oz);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(scale);
      tmp.updateMatrix();
      enemyBody.setMatrixAt(i, tmp.matrix);
      enemyBody.setColorAt(i, color);
      tmp.position.y += 0.4 * scale;
      tmp.updateMatrix();
      enemyHead.setMatrixAt(i, tmp.matrix);
    }
    // 무리 숫자
    let label = groupLabels.get(g.id);
    if (!label) {
      label = textSprite(256, 96);
      label.sprite.scale.set(2, 0.75, 1);
      scene.add(label.sprite);
      groupLabels.set(g.id, label);
    }
    paint(label, String(g.n), { bg: "rgba(200,40,40,.85)" });
    label.sprite.position.set(g.x, brute ? 4.4 : 1.7 + g.r * 0.3, -g.d);
  }
  enemyBody.count = enemyHead.count = i;
  enemyBody.instanceMatrix.needsUpdate = enemyHead.instanceMatrix.needsUpdate = true;
  if (enemyBody.instanceColor) enemyBody.instanceColor.needsUpdate = true;
  for (const [id, label] of groupLabels) {
    if (!seen.has(id)) {
      scene.remove(label.sprite);
      label.tex.dispose();
      groupLabels.delete(id);
    }
  }
}

// ---------- 문 ----------

const gateMeshes = new Map();
const postMat = new THREE.MeshLambertMaterial({ color: 0xdfe6ee });

function gatePanel() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W - 0.3, 2.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  return { c, tex, mesh, key: null };
}

// 문 판 그리기 (좋은 문 파랑, 나쁜 문 빨강, 동료 초록, 미스터리 보라)
function paintGate(panel, gate) {
  const text = gateLabel(gate);
  const fill = gate.op === "ally" ? "rgba(60,190,110,.55)" : gate.hidden ? "rgba(150,90,230,.55)" : gateGood(gate) ? "rgba(50,140,255,.55)" : "rgba(240,60,70,.55)";
  const key = `${text}|${fill}`;
  if (panel.key === key) return;
  panel.key = key;
  const ctx = panel.c.getContext("2d");
  ctx.clearRect(0, 0, 256, 160);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 152);
  ctx.font = `900 ${gate.op === "ally" ? 48 : 76}px "Malgun Gothic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.strokeText(text, 128, 84);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, 128, 84);
  panel.tex.needsUpdate = true;
}

function gateMesh(g) {
  const group = new THREE.Group();
  const panels = [];
  for (let i = 0; i < LANES; i++) {
    const panel = gatePanel();
    panel.mesh.position.set(laneX(i), 1.5, 0);
    group.add(panel.mesh);
    panels.push(panel);
  }
  for (let i = 0; i <= LANES; i++) {
    const x = -HALF + LANE_W * i;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), postMat);
    post.position.set(x, 1.6, 0);
    group.add(post);
  }
  scene.add(group);
  return { group, panels };
}

function drawGates(s) {
  const seen = new Set();
  for (const g of s.gates) {
    seen.add(g.id);
    let m = gateMeshes.get(g.id);
    if (!m) gateMeshes.set(g.id, (m = gateMesh(g)));
    m.panels.forEach((panel, i) => {
      paintGate(panel, g.lanes[i]);
      panel.mesh.material.opacity = g.passed ? 0.25 : 1;
    });
    m.group.position.z = -g.d;
  }
  for (const [id, m] of gateMeshes) {
    if (!seen.has(id)) {
      scene.remove(m.group);
      for (const panel of m.panels) panel.tex.dispose();
      gateMeshes.delete(id);
    }
  }
}

// ---------- 상자, 철창 ----------

const boxMeshes = new Map();

function crateMesh(c, cage) {
  const group = new THREE.Group();
  if (cage) {
    const bars = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 1.5, 1.5, 4, 1, 4)), new THREE.LineBasicMaterial({ color: 0x333333 }));
    bars.position.y = 0.75;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.6), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    group.add(bars, base);
    for (let i = 0; i < 3; i++) {
      const guy = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8), new THREE.MeshLambertMaterial({ color: 0x2f7bff }));
      guy.position.set((i - 1) * 0.42, 0.42, (i % 2) * 0.3 - 0.15);
      group.add(guy);
    }
  } else {
    const item = c.kind === "item";
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: item ? 0x2fa6a0 : 0x9a6b3c }));
    box.position.y = 0.55;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 1.12), new THREE.MeshBasicMaterial({ color: item ? 0xffffff : WEAPONS[c.what].color }));
    band.position.y = 0.55;
    group.add(box, band);
  }
  const label = textSprite(320, 96);
  label.sprite.scale.set(2.6, 0.78, 1);
  label.sprite.position.y = 2.1;
  group.add(label.sprite);
  scene.add(group);
  return { group, label };
}

function drawBoxes(s) {
  const seen = new Set();
  for (const [list, cage] of [[s.crates, false], [s.cages, true]]) {
    for (const c of list) {
      const key = `${cage ? "g" : "c"}${c.id}`;
      seen.add(key);
      let m = boxMeshes.get(key);
      if (!m) boxMeshes.set(key, (m = crateMesh(c, cage)));
      const hp = Math.ceil(c.hp);
      const name = cage ? `+${c.n}명` : c.kind === "weapon" ? WEAPONS[c.what].name : ITEMS[c.what].name;
      paint(m.label, `${name} ${hp}`, { size: 44, bg: cage ? "rgba(47,123,255,.85)" : "rgba(40,40,40,.8)" });
      m.group.position.set(c.x, 0, -c.d);
    }
  }
  for (const [key, m] of boxMeshes) {
    if (!seen.has(key)) {
      scene.remove(m.group);
      m.label.tex.dispose();
      boxMeshes.delete(key);
    }
  }
}

// ---------- 보스 ----------

const bossGroup = new THREE.Group();
const bossMat = new THREE.MeshLambertMaterial({ color: 0x7a3fd0, emissive: 0x000000 });
{
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 1.8, 6, 14), bossMat);
  body.position.y = 2.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), bossMat);
  head.position.y = 4.4;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe14a });
  for (const x of [-0.35, 0.35]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), eyeMat);
    eye.position.set(x, 4.55, 0.8);
    bossGroup.add(eye);
  }
  bossGroup.add(body, head);
  bossGroup.visible = false;
  scene.add(bossGroup);
}
const bombMeshes = [];

function drawBoss(s, now) {
  const b = s.boss;
  bossGroup.visible = !!b;
  $("#boss").classList.toggle("hidden", !b);
  if (b) {
    bossGroup.position.set(b.x, 0, -b.d);
    bossGroup.rotation.z = b.state === "charge" ? 0 : Math.sin(now / 300) * 0.05;
    bossMat.emissive.setHex(b.state === "windup" && Math.floor(now / 90) % 2 ? 0x882222 : 0x000000);
    $("#boss-name").textContent = `보스 ${b.idx}`;
    $("#boss-bar").style.width = `${(b.hp / b.maxHp) * 100}%`;
  }
  // 폭탄 떨어질 자리 (빨간 원 + 떨어지는 공)
  while (bombMeshes.length < s.bombs.length) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    scene.add(ring, ball);
    bombMeshes.push({ ring, ball });
  }
  bombMeshes.forEach((m, i) => {
    const bomb = s.bombs[i];
    m.ring.visible = m.ball.visible = !!bomb;
    if (!bomb) return;
    const k = 1 - bomb.t / bomb.total;
    m.ring.position.set(bomb.x, 0.05, 0);
    m.ring.scale.setScalar(bomb.r * (0.4 + 0.6 * k));
    m.ball.position.set(bomb.x, 9 * (1 - k * k), -3 * (1 - k));
  });
}

// ---------- 총알 ----------

const bulletMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_BULLETS);
bulletMesh.frustumCulled = false;
scene.add(bulletMesh);

function drawBullets(s) {
  const n = Math.min(MAX_BULLETS, s.bullets.length);
  color.setHex(WEAPONS[s.weapon].color);
  for (let i = 0; i < n; i++) {
    const b = s.bullets[i];
    tmp.position.set(b.x, 0.95, -b.d);
    tmp.rotation.set(0, -Math.atan2(b.vx, b.vd), 0);
    tmp.scale.setScalar(s.weapon === "rocket" ? 2.4 : 1);
    tmp.updateMatrix();
    bulletMesh.setMatrixAt(i, tmp.matrix);
    bulletMesh.setColorAt(i, color);
  }
  bulletMesh.count = n;
  bulletMesh.instanceMatrix.needsUpdate = true;
  if (bulletMesh.instanceColor) bulletMesh.instanceColor.needsUpdate = true;
}

// ---------- 효과 ----------

const effects = [];                 // {update(now) → 끝났으면 true}

function explosion(x, d, r, hex = 0xffa040) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: hex, transparent: true }));
  ball.position.set(x, 0.6, -d);
  scene.add(ball);
  const start = performance.now();
  effects.push((now) => {
    const t = (now - start) / 450;
    ball.scale.setScalar(Math.max(0.01, r * Math.min(1, t * 2.2)));
    ball.material.opacity = Math.max(0, 0.8 * (1 - t));
    if (t < 1) return false;
    scene.remove(ball);
    return true;
  });
}

// 떠오르는 글자 (+20, -5 …)
function floatText(text, x, y, d, hex = "#fff") {
  const label = textSprite(320, 110);
  paint(label, text, { color: hex, size: 72 });
  label.sprite.scale.set(3, 1.03, 1);
  label.sprite.position.set(x, y, -d);
  scene.add(label.sprite);
  const start = performance.now();
  effects.push((now) => {
    const t = (now - start) / 1000;
    label.sprite.position.y = y + t * 1.6;
    label.sprite.material.opacity = Math.max(0, 1 - t * t);
    if (t < 1) return false;
    scene.remove(label.sprite);
    label.tex.dispose();
    return true;
  });
}

let bannerTimer = null;
function banner(text, warn = false) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.toggle("warn", warn);
  el.style.opacity = 1;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (el.style.opacity = 0), 1600);
}

let clashLost = 0;
let clashShown = 0;

// 규칙 쪽 사건 → 화면 효과
function onEvents(events, now) {
  let puffs = 0;
  for (const e of events) {
    if (e.type === "gate") {
      const diff = e.after - e.before;
      const text = e.gate.op === "ally" ? `${ALLIES[e.gate.ally].name} 합류!` : diff >= 0 ? `+${diff}` : `${diff}`;
      floatText(text, game.x, 2.6, 0, e.gate.op === "ally" || diff >= 0 ? "#7fd0ff" : "#ff6b6b");
      if (e.gate.op === "ally") banner(`${ALLIES[e.gate.ally].name} 합류! (Lv${game.allies[e.gate.ally] || 1})`);
    } else if (e.type === "weapon") {
      banner(`${WEAPONS[e.weapon].name} Lv${e.level}!`);
      explosion(e.x, e.d, 1.2, 0xfff1a8);
    } else if (e.type === "item") {
      banner({ grenade: "💥 수류탄!", shield: "🛡 보호막 5초", slow: "🐢 적이 느려졌어요" }[e.item]);
    } else if (e.type === "cage") {
      floatText(`+${e.n}`, e.x, 2.2, e.d, "#7fd0ff");
      explosion(e.x, e.d, 1, 0x7fd0ff);
    } else if (e.type === "heal") {
      floatText(`+${e.n}`, game.x + 0.8, 2.2, 0, "#7dffa0");
    } else if (e.type === "explode") {
      explosion(e.x, e.d, e.r);
    } else if (e.type === "kill" && puffs < 4) {
      puffs++;
      explosion(e.x, e.d, e.group === "brute" ? 1.4 : 0.5, 0xff5050);
    } else if (e.type === "clash") {
      clashLost += e.lost;
      shake = Math.max(shake, 0.12);
    } else if (e.type === "bomb") {
      explosion(e.x, 0, e.r * 1.4, 0xff6a2a);
      if (e.lost) {
        floatText(`-${e.lost}`, game.x, 2.6, 0, "#ff6b6b");
        shake = 0.4;
      }
    } else if (e.type === "boss") {
      banner(`⚠ 보스 ${e.idx} 등장!`, true);
    } else if (e.type === "boss_windup") {
      banner("돌진한다! 피해요!", true);
    } else if (e.type === "boss_charge" && e.lost) {
      floatText(`-${e.lost}`, game.x, 2.6, 0, "#ff6b6b");
      shake = 0.6;
    } else if (e.type === "boss_bombs") {
      banner("폭탄! 빨간 원을 피해요", true);
    } else if (e.type === "boss_down") {
      banner(`보스 처치! +${500 * e.idx}점 · 병사 +20 · 무기 레벨 업`);
      explosion(e.x, e.d, 5, 0xc58bff);
    } else if (e.type === "over") {
      gameOver();
    }
  }
  // 맞붙어 잃은 병사는 모아서 보여 줌
  if (clashLost && now - clashShown > 300) {
    floatText(`-${clashLost}`, game.x, 2.6, 0, "#ff6b6b");
    clashLost = 0;
    clashShown = now;
  }
}

// ---------- 화면 정보 (DOM) ----------

const hudCache = {};
function setText(id, text) {
  if (hudCache[id] === text) return;
  hudCache[id] = text;
  $(`#${id}`).textContent = text;
}

function drawHud(s) {
  setText("dist", `${Math.floor(s.dist)}m`);
  setText("score", String(score(s)));
  setText("kills", String(s.kills));
  setText("weapon", `${WEAPONS[s.weapon].name} Lv${s.level}`);
  setText("best", String(Math.max(best, score(s))));
  const buffs = [];
  for (const [id, lv] of Object.entries(s.allies)) buffs.push(`${ALLIES[id].name} Lv${lv}${id === "shield" ? ` (${Math.ceil(s.shieldHp)})` : ""}`);
  if (s.invuln > 0) buffs.push(`🛡 보호막 ${s.invuln.toFixed(1)}초`);
  if (s.slow > 0) buffs.push(`🐢 느리게 ${s.slow.toFixed(1)}초`);
  const key = buffs.join("|");
  if (hudCache.buffs !== key) {
    hudCache.buffs = key;
    $("#buffs").replaceChildren(...buffs.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  }
}

function showPanel(title, text, button) {
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  $("#panel-btn").textContent = button;
  $("#panel").classList.remove("hidden");
}

// ---------- 진행 ----------

// 새 판 (지난 판 물체 정리)
function start() {
  game = createGame(Date.now() >>> 0);
  for (const m of gateMeshes.values()) scene.remove(m.group);
  gateMeshes.clear();
  for (const m of boxMeshes.values()) scene.remove(m.group);
  boxMeshes.clear();
  for (const l of groupLabels.values()) scene.remove(l.sprite);
  groupLabels.clear();
  shownCount = game.count;
  targetX = null;
  acc = 0;
  mode = "play";
  $("#panel").classList.add("hidden");
  banner("숫자 문을 골라 병사를 늘려요!");
}

function pause(on) {
  if (mode !== "play" && mode !== "pause") return;
  mode = on ? "pause" : "play";
  if (on) showPanel("일시정지", `${Math.floor(game.dist)}m 달리는 중`, "계속하기");
  else $("#panel").classList.add("hidden");
}

function gameOver() {
  mode = "over";
  const sc = score(game);
  const isBest = sc > best;
  saveBest(sc);
  showPanel(isBest ? "🏆 최고 기록!" : "게임 오버",
    `거리 ${Math.floor(game.dist)}m · 점수 ${sc}\n처치 ${game.kills} · 보스 ${game.bossKills} · ${WEAPONS[game.weapon].name} Lv${game.level}`,
    "다시 하기");
}

$("#panel-btn").onclick = () => {
  if (mode === "pause") pause(false);
  else start();
};

// ---------- 입력 ----------

const LANE_KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

document.addEventListener("keydown", (e) => {
  if (LANE_KEYS[e.code]) {
    // 한 번 누르면 한 칸 (누르고 있으면 계속)
    if (game && mode === "play") {
      const from = laneOf(targetX ?? game.x);
      targetX = laneX(Math.max(0, Math.min(LANES - 1, from + LANE_KEYS[e.code])));
    }
    e.preventDefault();
  } else if (e.code === "Enter" || e.code === "Space") {
    if (mode === "ready" || mode === "over") start();
    else if (mode === "pause") pause(false);
    e.preventDefault();
  } else if (e.code === "KeyP" || e.code === "Escape") {
    pause(mode === "play");
  }
});
window.addEventListener("blur", () => pause(true));
document.addEventListener("visibilitychange", () => document.hidden && pause(true));

// 끌기: 화면 가로 위치 → 도로 위치
let dragging = false;
function pointerTarget(e) {
  const rect = canvas.getBoundingClientRect();
  targetX = ((e.clientX - rect.left) / rect.width - 0.5) * ROAD_W * 1.1;
}
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  canvas.setPointerCapture?.(e.pointerId);
  pointerTarget(e);
});
canvas.addEventListener("pointermove", (e) => dragging && pointerTarget(e));
canvas.addEventListener("pointerup", () => (dragging = false));
canvas.addEventListener("pointercancel", () => (dragging = false));

function input() {
  return { dir: 0, targetX };
}

// ---------- 매 프레임 ----------

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 80 : 58;            // 세로 화면은 넓게
    camera.updateProjectionMatrix();
  }
}

// 카메라: 무리 머리 뒤 살짝 위
function updateCamera(s, dt) {
  const portrait = camera.aspect < 1;                            // 세로 화면은 더 가까이, 더 따라감
  const x = s ? s.x * (portrait ? 0.85 : 0.55) : 0;
  shake = Math.max(0, shake - dt);
  const j = shake > 0 ? shake * 0.5 : 0;
  const [y, z, look] = portrait ? [5.5, 6.5, -14] : [6.3, 9.5, -16];
  camera.position.set(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z);
  camera.lookAt(x, portrait ? 0 : 0.6, look);
}

function tick(now) {
  const frame = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    resize();
    if (game && mode === "play") {
      acc += frame;
      const events = [];
      while (acc >= DT) {
        acc -= DT;
        events.push(...step(game, DT, input()));
        if (game.over) break;
      }
      onEvents(events, now);
    }
    const s = game || idle;
    const dist = s.dist;
    roadTex.offset.y = dist / 10;
    grassTex.offset.y = dist / 16;
    drawTrees(dist);
    drawSquad(s, now);
    drawEnemies(s, now);
    drawGates(s);
    drawBoxes(s);
    drawBoss(s, now);
    drawBullets(s);
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
    if (game) drawHud(game);
    updateCamera(s, frame);
    renderer.render(scene, camera);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(tick);
}

// 시작 전 화면용 (빈 도로에 내 무리만)
const idle = createGame(1);
idle.gates = [];
setText("best", String(best));
showPanel("숫자러너", "좌우로 움직여 숫자 문을 고르고,\n끝없이 몰려오는 적을 막아라!", "시작하기");
requestAnimationFrame(tick);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__runner = {
  get game() { return game; },
  get mode() { return mode; },
  start,
  setTarget: (x) => (targetX = x),
};
