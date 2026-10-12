// 탁구 화면: 게임 진행(난이도 고르기·시작·일시정지·끝), 입력(마우스·터치·키), three.js 그리기, 소리.
// 규칙과 공 물리는 logic.js 에 있고, 여기서는 그 상태를 매 프레임 그린다.
import * as THREE from "three";
import {
  AI, BALL_R, FLOOR_Y, HALF_L, HALF_W, LEVELS, ME, NET_H, NET_OUT, REASONS, SHOTS, createMatch, dirOf, sideOfZ, simulate, step,
} from "./logic.js";

const $ = (sel) => document.querySelector(sel);
const DT = 1 / 60;
const RECORD_KEY = "pingpong-record";
const LEVEL_KEY = "pingpong-level";
const TRAIL = 16;
const HIT_Y = 0.12;               // 손 위치를 읽는 높이 (탁구대 위)

// ---------- 상태 ----------

let game = null;
let mode = "ready";               // ready → play ↔ pause → over
let acc = 0;
let last = performance.now();
let level = readLevel();
let record = readRecord();
let aim = null;                   // 손이 가리키는 탁구대 위 자리 {x, z}
let serveQueued = false;
let muted = false;

// 저장된 난이도
function readLevel() {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    return v !== null && Number(v) >= 0 && Number(v) < LEVELS.length ? Number(v) : 1;
  } catch {
    return 1;
  }
}

// 저장된 전적
function readRecord() {
  try {
    const v = JSON.parse(localStorage.getItem(RECORD_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// 전적 저장
function saveResult(win) {
  const r = (record[level] ||= { win: 0, lose: 0 });
  r[win ? "win" : "lose"] += 1;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {}
}

// ---------- 3D 기본 ----------

const canvas = $("#board");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2f45);
scene.fog = new THREE.Fog(0x1d2f45, 7, 16);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 40);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
const lamp = new THREE.DirectionalLight(0xffffff, 1.6);
lamp.position.set(1.5, 4, 2);
scene.add(lamp);

// 바닥 (경기장 매트)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), new THREE.MeshLambertMaterial({ color: 0x8a3b32 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = FLOOR_Y;
scene.add(floor);
const court = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 9), new THREE.MeshLambertMaterial({ color: 0xa8483d }));
court.rotation.x = -Math.PI / 2;
court.position.y = FLOOR_Y + 0.002;
scene.add(court);

// 탁구대 윗면 그림 (파란 판, 흰 테두리·가운데 줄)
function tableTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 920;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1f5fa8";
  ctx.fillRect(0, 0, 512, 920);
  ctx.strokeStyle = "#f4f6f8";
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 500, 908);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 920);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 탁구대·다리·네트
const table = new THREE.Group();
const top = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.03, HALF_L * 2), [
  new THREE.MeshLambertMaterial({ color: 0x184c86 }), new THREE.MeshLambertMaterial({ color: 0x184c86 }),
  new THREE.MeshLambertMaterial({ map: tableTexture() }), new THREE.MeshLambertMaterial({ color: 0x184c86 }),
  new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }), new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }),
]);
top.position.y = -0.015;
table.add(top);
const legMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
for (const x of [-1, 1]) {
  for (const z of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, -FLOOR_Y - 0.03, 0.05), legMat);
    leg.position.set(x * (HALF_W - 0.12), FLOOR_Y / 2 - 0.015, z * (HALF_L - 0.25));
    table.add(leg);
  }
}
const net = new THREE.Mesh(new THREE.PlaneGeometry((HALF_W + NET_OUT) * 2, NET_H), new THREE.MeshLambertMaterial({ color: 0x111820, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
net.position.y = NET_H / 2;
table.add(net);
const netTop = new THREE.Mesh(new THREE.BoxGeometry((HALF_W + NET_OUT) * 2, 0.012, 0.006), new THREE.MeshLambertMaterial({ color: 0xffffff }));
netTop.position.y = NET_H;
table.add(netTop);
for (const x of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, NET_H + 0.02, 0.03), legMat);
  post.position.set(x * (HALF_W + NET_OUT), NET_H / 2, 0);
  table.add(post);
}
scene.add(table);

// ---------- 공 ----------

const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.4, 16, 12), new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0x553300 }));
scene.add(ball);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.45 }));
trail.frustumCulled = false;
scene.add(trail);
const trailPts = [];

// 떨어질 자리 표시 (내 쪽으로 오는 공)
const marker = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.002;
marker.visible = false;
scene.add(marker);
let markerShot = -1;

// 공·그림자·꼬리 그리기
function drawBall(s) {
  const p = s.ball.p;
  ball.position.set(p.x, p.y, p.z);
  const overTable = Math.abs(p.x) <= HALF_W && Math.abs(p.z) <= HALF_L && p.y >= 0;
  const groundY = overTable ? 0.001 : FLOOR_Y + 0.004;
  shadow.position.set(p.x, groundY, p.z);
  const h = Math.max(0, p.y - groundY);
  shadow.material.opacity = Math.max(0.08, 0.45 - h * 0.35);
  shadow.scale.setScalar(1 + h * 1.5);
  if (s.phase === "serve") trailPts.length = 0;
  else {
    trailPts.push(p.x, p.y, p.z);
    if (trailPts.length > TRAIL * 3) trailPts.splice(0, 3);
  }
  const arr = trailGeo.attributes.position.array;
  for (let i = 0; i < TRAIL; i++) {
    const k = Math.min(i, trailPts.length / 3 - 1);
    for (let j = 0; j < 3; j++) arr[i * 3 + j] = k >= 0 ? trailPts[k * 3 + j] : p[["x", "y", "z"][j]];
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.setDrawRange(0, Math.max(0, trailPts.length / 3));
}

// 내 쪽 떨어질 자리 예측
function drawMarker(s) {
  if (s.phase !== "rally" || s.hitter !== AI || s.bounces > 0) {
    marker.visible = false;
    return;
  }
  if (markerShot !== s.shotId) {
    markerShot = s.shotId;
    marker.visible = false;
    simulate(s.ball, 2, (b, hit) => {
      if (hit !== "table") return false;
      if (sideOfZ(b.p.z) !== ME) return s.serving ? false : true;
      marker.position.x = b.p.x;
      marker.position.z = b.p.z;
      marker.visible = true;
      return true;
    });
  }
}

// ---------- 라켓·상대 ----------

// 라켓 (빨간 면, 손잡이)
function paddleMesh(face, opacity = 1) {
  const g = new THREE.Group();
  const mat = (color) => new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 28), [mat(0xdedede), mat(face), mat(0x1b1b1b)]);
  blade.rotation.x = Math.PI / 2;
  g.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.022), mat(0xc79a62));
  handle.position.y = -0.12;
  g.add(handle);
  scene.add(g);
  return g;
}

const myPaddle = paddleMesh(0xd8262c, 0.88);
const aiPaddle = paddleMesh(0x1d1d1d);

// 상대 몸 (도형 사람)
const aiBody = new THREE.Group();
const shirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), new THREE.MeshLambertMaterial({ color: 0x2f9e6f }));
shirt.position.y = 0.05;
aiBody.add(shirt);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }));
head.position.y = 0.55;
aiBody.add(head);
const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.75, 0.18), new THREE.MeshLambertMaterial({ color: 0x24303f }));
legs.position.y = -0.55;
aiBody.add(legs);
scene.add(aiBody);

// 라켓 높이: 공이 가까우면 공 높이, 아니면 허리 높이
function paddleY(s, side) {
  const pad = s.pads[side];
  const b = s.ball.p;
  if (s.phase === "serve" && s.server === side) return 0.1;
  const near = Math.abs(b.z - pad.z) < 0.6 && sideOfZ(b.z) === side;
  return near ? Math.max(-0.3, Math.min(0.9, b.y)) : 0.18;
}

const shownY = { me: 0.18, ai: 0.18 };

// 라켓 그리기 (앞으로 휘두르면 면을 덮음)
function drawPaddle(s, side, mesh, frame) {
  const pad = s.pads[side];
  const dir = dirOf(side);
  shownY[side] += (paddleY(s, side) - shownY[side]) * Math.min(1, frame * 18);
  mesh.position.set(pad.x, shownY[side], pad.z);
  const fwd = Math.max(-1, Math.min(1, (-pad.vz * dir) / 4));
  mesh.rotation.set(-dir * (0.25 + fwd * 0.6), side === ME ? 0 : Math.PI, Math.max(-0.6, Math.min(0.6, -pad.vx * 0.12)));
}

// ---------- 효과 ----------

const effects = [];
const ringGeo = new THREE.RingGeometry(0.02, 0.035, 20);

// 튄 자리 물결
function ripple(x, y, z, color = 0xffffff) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.003, z);
  scene.add(m);
  const born = performance.now();
  effects.push((now) => {
    const t = (now - born) / 400;
    m.scale.setScalar(1 + t * 3);
    m.material.opacity = 0.8 * (1 - t);
    if (t < 1) return false;
    scene.remove(m);
    m.material.dispose();
    return true;
  });
}

// 알림 글자
let bannerTimer = 0;
function banner(text, cls = "") {
  const el = $("#banner");
  el.textContent = text;
  el.className = `banner ${cls}`;
  el.style.opacity = 1;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (el.style.opacity = 0), 1100);
}

// ---------- 소리 ----------

let audio = null;
// 소리 켜기 (첫 입력 때)
function unlockAudio() {
  if (audio) return;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  } catch {}
}

// 똑 소리 (높이·세기)
function tok(freq, gain = 0.25, len = 0.05) {
  if (!audio || muted) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  osc.connect(g).connect(audio.destination);
  osc.start(t);
  osc.stop(t + len + 0.01);
}

// ---------- 화면 글자 ----------

// 글자 바꾸기 (같으면 건너뜀)
const setText = (id, v) => {
  const el = document.getElementById(id);
  if (el.textContent !== v) el.textContent = v;
};

// 점수판
function drawHud(s) {
  setText("my-score", String(s.score.me));
  setText("ai-score", String(s.score.ai));
  setText("level", LEVELS[s.bots.ai].name);
  setText("rally", String(s.rally));
  setText("longest", String(s.longest));
  $("#my-serve").classList.toggle("on", s.server === ME && !s.over);
  $("#ai-serve").classList.toggle("on", s.server === AI && !s.over);
}

// 전적 글자
function recordText(lv) {
  const r = record[lv] || { win: 0, lose: 0 };
  return `${r.win}승 ${r.lose}패`;
}

// 시작·끝 화면 (난이도 고르기)
function showPanel(title, text, button, levels = true) {
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  $("#panel-btn").textContent = button;
  $("#levels").classList.toggle("hidden", !levels);
  for (const btn of document.querySelectorAll("#levels button")) {
    const lv = Number(btn.dataset.level);
    btn.classList.toggle("on", lv === level);
    btn.querySelector("small").textContent = recordText(lv);
  }
  $("#panel").classList.remove("hidden");
}

for (const btn of document.querySelectorAll("#levels button")) {
  btn.onclick = () => {
    level = Number(btn.dataset.level);
    try {
      localStorage.setItem(LEVEL_KEY, String(level));
    } catch {}
    for (const b of document.querySelectorAll("#levels button")) b.classList.toggle("on", b === btn);
  };
}

// ---------- 진행 ----------

// 새 판
function start() {
  unlockAudio();
  game = createMatch({ level, seed: Date.now() >>> 0, first: Math.random() < 0.5 ? ME : AI });
  acc = 0;
  serveQueued = false;
  trailPts.length = 0;
  mode = "play";
  $("#panel").classList.add("hidden");
  banner(game.server === ME ? "내 서브! 클릭하거나 스페이스" : "AI 서브");
}

// 일시정지·계속
function pause(on) {
  if (mode !== "play" && mode !== "pause") return;
  mode = on ? "pause" : "play";
  if (on) showPanel("일시정지", `나 ${game.score.me} : ${game.score.ai} AI`, "계속하기", false);
  else $("#panel").classList.add("hidden");
}

// 경기 끝 (전적 저장)
function gameOver(s) {
  mode = "over";
  const win = s.winner === ME;
  saveResult(win);
  const st = s.stats.me;
  showPanel(win ? "🏆 승리!" : "패배",
    `나 ${s.score.me} : ${s.score.ai} AI (${LEVELS[level].name})\n가장 긴 랠리 ${s.longest}번\n드라이브 ${st.drive} · 스매시 ${st.smash} · 커트 ${st.cut} · 블록 ${st.block}`,
    "다시 하기");
}

$("#panel-btn").onclick = () => {
  if (mode === "pause") pause(false);
  else start();
};

// 사건 → 효과·소리·알림
function onEvents(events) {
  for (const e of events) {
    if (e.type === "table") {
      ripple(e.x, 0, e.z);
      tok(1250, Math.min(0.3, 0.05 + e.speed * 0.02));
    } else if (e.type === "net") tok(260, 0.25, 0.08);
    else if (e.type === "floor") tok(700, 0.08);
    else if (e.type === "hit" || e.type === "serve") {
      tok(e.shot === "smash" ? 520 : 820, e.shot === "smash" ? 0.45 : 0.3, 0.06);
      if (e.side === ME && e.type === "hit") {
        const pct = e.shot === "drive" || e.shot === "smash" ? ` ${Math.round(e.power * 100)}%` : "";
        banner(`${SHOTS[e.shot].name}!${pct}`, e.shot === "smash" ? "hot" : "");
      }
    } else if (e.type === "point") {
      const mine = e.winner === ME;
      banner(`${mine ? "득점" : "실점"} · ${REASONS[e.reason]}`, mine ? "good" : "warn");
      tok(mine ? 990 : 330, 0.15, 0.12);
    } else if (e.type === "ready" && e.server === ME) banner("내 서브! 클릭하거나 스페이스");
    else if (e.type === "over") gameOver(game);
  }
}

// ---------- 입력 ----------

const raycaster = new THREE.Raycaster();
const handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HIT_Y);
const hit = new THREE.Vector3();

// 화면 위치 → 탁구대 위 자리 (손가락은 라켓을 가리지 않게 조금 위로)
function readAim(e) {
  const rect = canvas.getBoundingClientRect();
  const lift = e.pointerType === "touch" ? 60 : 0;
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - lift - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  if (raycaster.ray.intersectPlane(handPlane, hit)) aim = { x: hit.x, z: hit.z };
  else if (ny > 0) aim = { x: aim?.x ?? 0, z: 0 };
}

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" || e.buttons) readAim(e);
});
canvas.addEventListener("pointerdown", (e) => {
  unlockAudio();
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {}
  readAim(e);
});
canvas.addEventListener("pointerup", () => {
  if (mode === "play" && game?.phase === "serve" && game.server === ME) serveQueued = true;
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    unlockAudio();
    if (mode === "ready" || mode === "over") start();
    else if (mode === "pause") pause(false);
    else if (game?.phase === "serve" && game.server === ME) serveQueued = true;
    e.preventDefault();
  } else if (e.code === "KeyP" || e.code === "Escape") pause(mode === "play");
  else if (e.code === "KeyM") {
    muted = !muted;
    banner(muted ? "소리 끔" : "소리 켬");
  }
});
window.addEventListener("blur", () => pause(true));
document.addEventListener("visibilitychange", () => document.hidden && pause(true));

// 이번 틱 입력
function input() {
  const out = { x: aim?.x, z: aim?.z, serve: serveQueued };
  serveQueued = false;
  return out;
}

// ---------- 매 프레임 ----------

// 화면 크기 맞추기
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 68 : 50;              // 세로 화면은 넓게
    camera.updateProjectionMatrix();
  }
}

// 카메라: 내 라켓 뒤 위쪽, 라켓을 살짝 따라감
const camX = { v: 0 };
function updateCamera(s, frame) {
  const portrait = camera.aspect < 1;
  const target = (s.pads.me.x || 0) * 0.25;
  camX.v += (target - camX.v) * Math.min(1, frame * 3);
  const [y, z, lookY, lookZ] = portrait ? [1.75, 3.6, -0.15, -0.5] : [1.3, 3.2, -0.05, -0.45];
  camera.position.set(camX.v, y, z);
  camera.lookAt(camX.v * 0.4, lookY, lookZ);
}

// 상대 몸 그리기
function drawOpponent(s, now) {
  const pad = s.pads.ai;
  aiBody.position.set(pad.x + 0.28, 0.35 + Math.sin(now / 300) * 0.01, pad.z - 0.3);
}

// 매 프레임 진행·그리기
function tick(now) {
  const frame = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    resize();
    if (game && mode === "play") {
      acc += frame;
      while (acc >= DT) {
        acc -= DT;
        onEvents(step(game, DT, input()));
        if (game.over) break;
      }
    } else if (!game || mode === "ready") {
      acc += frame;
      while (acc >= DT) {
        acc -= DT;
        step(demo, DT);
        if (demo.over) demo = makeDemo();
      }
    }
    const s = mode === "ready" ? demo : game;
    drawBall(s);
    drawMarker(s);
    drawPaddle(s, ME, myPaddle, frame);
    drawPaddle(s, AI, aiPaddle, frame);
    drawOpponent(s, now);
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
    drawHud(s);
    updateCamera(s, frame);
    renderer.render(scene, camera);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(tick);
}

// 시작 전 화면용 (컴퓨터끼리 치는 시범 경기)
function makeDemo() {
  return createMatch({ level: 2, seed: (Math.random() * 1e9) >>> 0, bots: { me: 2, ai: 2 } });
}
let demo = makeDemo();
showPanel("탁구", "라켓을 움직여 공을 받아치세요.\n앞으로 휘두르면 드라이브!", "시작하기");
requestAnimationFrame(tick);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__pingpong = {
  get game() { return game; },
  get mode() { return mode; },
  start,
  setAim: (x, z) => (aim = { x, z }),
  serve: () => (serveQueued = true),
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  },
};
