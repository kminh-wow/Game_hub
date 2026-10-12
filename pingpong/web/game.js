// 탁구 화면: 게임 진행(난이도 고르기·시작·일시정지·끝), 입력(마우스·터치·키), three.js 그리기, 소리.
// 규칙과 공 물리는 logic.js 에 있고, 여기서는 그 상태를 매 프레임 그린다.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import {
  AI, BALL_R, FLOOR_Y, HALF_L, HALF_W, LEVELS, ME, NET_H, NET_OUT, REASONS, SHOTS, WIN_SCORE, createMatch, dirOf, sideOfZ, simulate, step,
} from "./logic.js";

const $ = (sel) => document.querySelector(sel);
const DT = 1 / 60;
const RECORD_KEY = "pingpong-record";
const LEVEL_KEY = "pingpong-level";
const GHOSTS = 9;                 // 공 잔상 수
const HIT_Y = 0.12;               // 손 위치를 읽는 높이 (탁구대 위)
const MOBILE = matchMedia("(pointer: coarse)").matches;
const ORANGE = 0xff9f2e;

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
let shake = 0;

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1726);
scene.fog = new THREE.Fog(0x0d1726, 9, 22);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);

// 캔버스 텍스처 만들기
function canvasTexture(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  return tex;
}

// 고정 난수 (텍스처 무늬용)
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 둥근 빛 텍스처 (공 빛, 그림자, 타격 번쩍임)
const glowTex = canvasTexture(128, 128, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
});

// 반사용 주변 환경 (조명이 달린 어두운 방)
function buildEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x1a2638, side: THREE.BackSide })));
  const panel = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]]) {
    const light = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1), panel);
    light.position.set(x, 4.8, z);
    light.rotation.x = Math.PI / 2;
    env.add(light);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.55;

// 조명: 위에서 비추는 큰 조명(그림자), 하늘빛, 뒤쪽 테두리 빛
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a1d1a, 0.55));
const keyLight = new THREE.DirectionalLight(0xfff6ea, 2.4);
keyLight.position.set(0.6, 5, 1.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(keyLight.shadow.camera, { left: -2.6, right: 2.6, top: 3.2, bottom: -3.2, near: 1, far: 12 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8fb4ff, 0.7);
rimLight.position.set(-1, 2.5, -6);
scene.add(rimLight);

// ---------- 경기장 ----------

// 바닥 (어두운 나무)
const floorTex = canvasTexture(512, 512, (ctx, w, h) => {
  for (let y = 0; y < h; y += 32) {
    for (let x = (y / 32) % 2 ? -96 : 0; x < w; x += 192) {
      ctx.fillStyle = `hsl(215, 18%, ${16 + rand() * 8}%)`;
      ctx.fillRect(x, y, 190, 30);
    }
  }
}, { repeat: [8, 8] });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = FLOOR_Y;
floor.receiveShadow = true;
scene.add(floor);

// 경기 매트 (붉은 고무 바닥, 흰 테두리)
const matTex = canvasTexture(256, 512, (ctx, w, h) => {
  ctx.fillStyle = "#a63a32";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + rand() * 0.04})`;
    ctx.fillRect(rand() * w, rand() * h, 2, 2);
  }
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
});
const mat = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.85 }));
mat.rotation.x = -Math.PI / 2;
mat.position.y = FLOOR_Y + 0.003;
mat.receiveShadow = true;
scene.add(mat);

// 펜스 광고판
const fenceTex = canvasTexture(1024, 128, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1b3156");
  g.addColorStop(1, "#0f1d36");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ff9f2e";
  ctx.fillRect(0, h - 10, w, 10);
  ctx.font = "italic 900 58px Pretendard, 'Malgun Gothic', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("DDAN JIT", 40, h / 2 - 4);
  ctx.fillStyle = "#ff9f2e";
  ctx.fillText("●", 330, h / 2 - 4);
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "800 44px Pretendard, 'Malgun Gothic', sans-serif";
  ctx.fillText("TABLE TENNIS  탁구", 400, h / 2 - 4);
});
const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.6 });
const fenceBack = new THREE.MeshStandardMaterial({ color: 0x0f1d36, roughness: 0.8 });
const FENCE_H = 0.7;
// 펜스 한 줄 (판 2m씩)
function fenceLine(x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(len / 2);
  const angle = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const board = new THREE.Mesh(new THREE.BoxGeometry(len / n - 0.04, FENCE_H, 0.05), [fenceBack, fenceBack, fenceBack, fenceBack, fenceMat, fenceBack]);
    board.position.set(x0 + (x1 - x0) * t, FLOOR_Y + FENCE_H / 2, z0 + (z1 - z0) * t);
    board.rotation.y = angle - Math.PI / 2;
    scene.add(board);
  }
}
fenceLine(-3, -5.5, 3, -5.5);
fenceLine(3, -5.5, 3, 5.5);
fenceLine(-3, 5.5, -3, -5.5);

// 관중석·조명 배경 (둘러싼 원통)
const standTex = canvasTexture(2048, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#060b14");
  g.addColorStop(0.45, "#13213a");
  g.addColorStop(1, "#0b1424");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {                                  // 천장 조명
    const x = (i + 0.5) * (w / 14);
    const lg = ctx.createRadialGradient(x, 70, 0, x, 70, 90);
    lg.addColorStop(0, "rgba(255,250,235,.95)");
    lg.addColorStop(0.15, "rgba(255,240,210,.5)");
    lg.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(x - 90, 0, 180, 180);
  }
  for (let row = 0; row < 9; row++) {                             // 관중
    const y = 230 + row * 26;
    for (let x = rand() * 12; x < w; x += 13 + rand() * 6) {
      const hue = [210, 20, 0, 45, 200, 140][Math.floor(rand() * 6)];
      ctx.fillStyle = `hsla(${hue}, ${20 + rand() * 40}%, ${18 + rand() * 22}%, ${0.55 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 6, y + 5, 12, 12);
    }
  }
  ctx.fillStyle = "rgba(255,159,46,.85)";                         // 전광판 띠
  ctx.fillRect(0, 196, w, 6);
});
standTex.wrapS = THREE.RepeatWrapping;
standTex.repeat.set(2, 1);
const stands = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 9, 48, 1, true), new THREE.MeshBasicMaterial({ map: standTex, side: THREE.BackSide, fog: false }));
stands.position.y = 2.6;
scene.add(stands);

// ---------- 탁구대 ----------

// 탁구대 윗면 (파란 판, 흰 테두리·가운데 줄, 살짝 얼룩)
const tableTex = canvasTexture(512, 920, (ctx, w, h) => {
  ctx.fillStyle = "#1d5aa6";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.025})`;
    ctx.fillRect(rand() * w, rand() * h, 2, 2);
  }
  ctx.fillStyle = "#f4f6f8";
  const edge = Math.round((0.02 / (HALF_W * 2)) * w);
  ctx.fillRect(0, 0, w, edge);
  ctx.fillRect(0, h - edge, w, edge);
  ctx.fillRect(0, 0, edge, h);
  ctx.fillRect(w - edge, 0, edge, h);
  ctx.fillRect(w / 2 - 2, 0, 4, h);
});
const table = new THREE.Group();
const sideMat = new THREE.MeshStandardMaterial({ color: 0x174a8a, roughness: 0.5 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 });
const topMat = new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.55 });
const top = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.03, HALF_L * 2), [sideMat, sideMat, topMat, sideMat, edgeMat, edgeMat]);
top.position.y = -0.015;
top.castShadow = top.receiveShadow = true;
table.add(top);
const frameMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.45, metalness: 0.6 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
// 탁구대 아래 틀·다리·바퀴
for (const z of [-1, 1]) {
  const apron = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 - 0.2, 0.06, 0.04), frameMat);
  apron.position.set(0, -0.06, z * (HALF_L - 0.3));
  table.add(apron);
  for (const x of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, -FLOOR_Y - 0.1, 0.045), frameMat);
    leg.position.set(x * (HALF_W - 0.15), FLOOR_Y / 2 - 0.02, z * (HALF_L - 0.3));
    leg.castShadow = true;
    table.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x * (HALF_W - 0.15), FLOOR_Y + 0.035, z * (HALF_L - 0.3));
    table.add(wheel);
  }
}
for (const x of [-1, 1]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, HALF_L * 2 - 0.5), frameMat);
  rail.position.set(x * (HALF_W - 0.15), -0.06, 0);
  table.add(rail);
}
// 네트 (그물 무늬, 흰 테이프, 기둥)
const netTex = canvasTexture(512, 64, (ctx, w, h) => {
  ctx.strokeStyle = "rgba(20,28,40,.9)";
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= w; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#1a2433";
  ctx.fillRect(0, h - 6, w, 6);
}, { repeat: [3, 1] });
const net = new THREE.Mesh(new THREE.PlaneGeometry((HALF_W + NET_OUT) * 2, NET_H), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false }));
net.position.y = NET_H / 2;
table.add(net);
const tape = new THREE.Mesh(new THREE.BoxGeometry((HALF_W + NET_OUT) * 2, 0.015, 0.008), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
tape.position.y = NET_H;
tape.castShadow = true;
table.add(tape);
for (const x of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.02, 10), frameMat);
  post.position.set(x * (HALF_W + NET_OUT), NET_H / 2, 0);
  table.add(post);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.06), frameMat);
  clamp.position.set(x * (HALF_W + NET_OUT - 0.02), 0.005, 0);
  table.add(clamp);
}
scene.add(table);

// ---------- 공 ----------

const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.8, 24, 16), new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.35, emissive: 0x3a1c00 }));
ball.castShadow = true;
scene.add(ball);
const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc27a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
ballGlow.scale.setScalar(0.15);
scene.add(ballGlow);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

// 공 잔상 (지나온 자리)
const ghostGeo = new THREE.SphereGeometry(BALL_R * 1.6, 12, 8);
const ghosts = Array.from({ length: GHOSTS }, (_, i) => {
  const m = new THREE.Mesh(ghostGeo, new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.45 * (1 - i / GHOSTS), depthWrite: false }));
  m.scale.setScalar(1 - (i / GHOSTS) * 0.6);
  m.visible = false;
  scene.add(m);
  return m;
});
const history = [];

// 떨어질 자리 표시 (내 쪽으로 오는 공)
const marker = new THREE.Group();
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.7, depthWrite: false });
marker.add(new THREE.Mesh(new THREE.RingGeometry(0.04, 0.052, 32), markerMat), new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), markerMat));
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.002;
marker.visible = false;
scene.add(marker);
let markerShot = -1;

// 공·잔상·그림자 그리기
function drawBall(s, now) {
  const p = s.ball.p;
  ball.position.set(p.x, p.y, p.z);
  ballGlow.position.copy(ball.position);
  ballGlow.material.opacity = 0.35 + Math.sin(now / 120) * 0.08;
  const overTable = Math.abs(p.x) <= HALF_W && Math.abs(p.z) <= HALF_L && p.y >= 0;
  const groundY = overTable ? 0.0015 : FLOOR_Y + 0.006;
  const h = Math.max(0, p.y - groundY);
  blob.position.set(p.x, groundY, p.z);
  blob.scale.setScalar(0.07 + h * 0.1);
  blob.material.opacity = Math.max(0.1, 0.55 - h * 0.4);
  if (s.phase === "serve") history.length = 0;
  else {
    history.unshift([p.x, p.y, p.z]);
    history.length = Math.min(history.length, GHOSTS * 2 + 1);
  }
  ghosts.forEach((g, i) => {
    const q = history[(i + 1) * 2];
    g.visible = !!q;
    if (q) g.position.set(...q);
  });
}

// 내 쪽 떨어질 자리 예측
function drawMarker(s, now) {
  if (s.phase !== "rally" || s.hitter !== AI || s.bounces > 0) {
    marker.visible = false;
    return;
  }
  if (markerShot !== s.shotId) {
    markerShot = s.shotId;
    marker.visible = false;
    simulate(s.ball, 2, (b, hit) => {
      if (hit !== "table") return false;
      if (sideOfZ(b.p.z) !== ME) return !s.serving;
      marker.position.x = b.p.x;
      marker.position.z = b.p.z;
      marker.visible = true;
      return true;
    });
  }
  marker.scale.setScalar(1 + Math.sin(now / 90) * 0.12);
}

// ---------- 라켓 ----------

const bladeShape = new THREE.Shape();
bladeShape.absellipse(0, 0, 0.076, 0.082, 0, Math.PI * 2);
const woodMat = new THREE.MeshStandardMaterial({ color: 0xd9b27a, roughness: 0.65 });
const rubberGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.0024, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 40 });
const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: false, curveSegments: 40 });
bladeGeo.translate(0, 0, -0.003);
const capMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4 });

// 라켓 (나무 판, 양면 고무, 손잡이) — 카메라 쪽 면 색, 반대쪽 면 색
function paddleMesh(towardCamera, away) {
  const g = new THREE.Group();
  const rubber = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  g.add(new THREE.Mesh(bladeGeo, woodMat));
  const front = new THREE.Mesh(rubberGeo, rubber(towardCamera));
  front.position.z = 0.003;
  const back = new THREE.Mesh(rubberGeo, rubber(away));
  back.position.z = -0.0054;
  g.add(front, back);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.024), woodMat);
  handle.position.y = -0.13;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.012, 16), capMat);
  cap.position.y = -0.185;
  g.add(handle, cap);
  g.traverse((o) => (o.castShadow = true));
  scene.add(g);
  return g;
}

const myPaddle = paddleMesh(0xc81e2a, 0x151515);
const aiPaddle = paddleMesh(0x151515, 0xc81e2a);           // 뒤집어 놓으니 우리 쪽에는 빨간 면

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

// ---------- 상대 선수 ----------

// 도형으로 만든 선수 (에셋을 못 불러오면 이걸 씀)
const procBody = new THREE.Group();
scene.add(procBody);

// 팔다리 (두 점을 잇는 캡슐)
function limb(radius, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, 1, 4, 10), material);
  m.castShadow = true;
  procBody.add(m);
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
// 캡슐을 a 에서 b 까지 걸치기
function span(m, a, b) {
  vb.subVectors(b, a);
  const len = vb.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, vb.normalize());
  m.scale.set(1, Math.max(0.01, len - m.geometry.parameters.radius * 2), 1);
}

const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c29a, roughness: 0.7 });
const jerseyMat = new THREE.MeshStandardMaterial({ color: 0x1f9e78, roughness: 0.6 });
const shortsMat = new THREE.MeshStandardMaterial({ color: 0x15233b, roughness: 0.7 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x1d1612, roughness: 0.8 });

// 가슴 글자
const chestTex = canvasTexture(256, 256, (ctx) => {
  ctx.fillStyle = "#ffffff";
  ctx.font = "italic 900 120px Pretendard, 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AI", 128, 120);
  ctx.fillStyle = "#ff9f2e";
  ctx.fillRect(60, 196, 136, 12);
});

// 상대 선수 몸 만들기 (몸통·머리는 한 덩어리, 팔다리는 매 프레임 관절 계산)
const player = (() => {
  const root = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 6, 14), jerseyMat);
  torso.scale.z = 0.72;
  torso.position.y = 1.18;
  const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: chestTex, transparent: true }));
  chest.position.set(0, 1.24, 0.125);
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.08, 4, 12), shortsMat);
  hips.scale.z = 0.75;
  hips.position.y = 0.86;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skinMat);
  neck.position.y = 1.47;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), skinMat);
  head.position.y = 1.6;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.117, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat);
  hair.position.set(0, 1.605, -0.008);
  hair.rotation.x = -0.45;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const eyes = [-1, 1].map((sx) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeMat);
    e.position.set(sx * 0.038, 1.615, 0.098);
    return e;
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), eyeMat);
  mouth.position.set(0, 1.56, 0.1);
  eyes.push(mouth);
  root.add(torso, chest, hips, neck, head, hair, ...eyes);
  root.traverse((o) => (o.castShadow = true));
  procBody.add(root);
  return {
    root,
    upperArm: limb(0.045, jerseyMat),
    foreArm: limb(0.038, skinMat),
    otherUpper: limb(0.045, jerseyMat),
    otherFore: limb(0.038, skinMat),
    thighs: [limb(0.07, shortsMat), limb(0.07, shortsMat)],
    shins: [limb(0.055, skinMat), limb(0.055, skinMat)],
    shoes: [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), shoeMat);
      m.castShadow = true;
      procBody.add(m);
      return m;
    }),
    lean: 0,
  };
})();

const shoulder = new THREE.Vector3();
const hand = new THREE.Vector3();
const elbow = new THREE.Vector3();
const hip = new THREE.Vector3();
const knee = new THREE.Vector3();
const foot = new THREE.Vector3();
const bendArm = new THREE.Vector3(1, -0.6, -0.4);
const bendOther = new THREE.Vector3(1, -1, -0.6);
const bendLeg = new THREE.Vector3(0, 0, 1);
const bendOut = new THREE.Vector3();

// 두 마디 팔다리 관절 자리 (bend 쪽으로 굽힘)
function twoBone(a, b, len, bend, joint) {
  va.subVectors(b, a);
  const d = Math.min(va.length(), len * 2 - 0.001);
  va.normalize();
  joint.copy(a).addScaledVector(va, d / 2);
  bendOut.copy(bend).addScaledVector(va, -bend.dot(va)).normalize();
  joint.addScaledVector(bendOut, Math.sqrt(Math.max(0, len * len - (d / 2) ** 2)));
}

// 상대 선수 그리기 (몸은 라켓을 따라 옆으로, 오른팔은 라켓 손잡이까지)
function drawPlayer(s, now, frame) {
  const pad = s.pads.ai;
  const bodyX = pad.x + 0.34;
  const bodyZ = pad.z - 0.36;
  const crouch = 0.1 + Math.sin(now / 260) * 0.012;
  player.lean += (Math.max(-0.25, Math.min(0.25, -pad.vx * 0.08)) - player.lean) * Math.min(1, frame * 8);
  const root = player.root;
  root.position.set(bodyX, FLOOR_Y - crouch, bodyZ);
  root.rotation.set(0.12, 0, player.lean);
  root.updateMatrixWorld();
  root.localToWorld(shoulder.set(-0.2, 1.36, 0.02));
  hand.copy(aiPaddle.position).add(va.set(0, -0.15, 0).applyEuler(aiPaddle.rotation));
  twoBone(shoulder, hand, 0.28, bendArm, elbow);
  span(player.upperArm, shoulder, elbow);
  span(player.foreArm, elbow, hand);
  root.localToWorld(shoulder.set(0.2, 1.36, 0.02));
  root.localToWorld(hand.set(0.26, 1.02, 0.22));
  twoBone(shoulder, hand, 0.27, bendOther, elbow);
  span(player.otherUpper, shoulder, elbow);
  span(player.otherFore, elbow, hand);
  [-1, 1].forEach((sx, i) => {
    root.localToWorld(hip.set(sx * 0.1, 0.84, 0));
    foot.set(bodyX + sx * 0.22, FLOOR_Y + 0.05, bodyZ + (i ? -0.06 : 0.08));
    twoBone(hip, foot, 0.44, bendLeg, knee);
    span(player.thighs[i], hip, knee);
    span(player.shins[i], knee, foot);
    player.shoes[i].position.set(foot.x, FLOOR_Y + 0.03, foot.z + 0.05);
  });
}

// ---------- 에셋 (경기장 사진·조명, 나무 바닥, Kenney 선수) ----------

const ARENA_TURN = 0;             // 경기장 사진 돌리기 (관중석이 상대 뒤로 오게)
const PLAYER_HEIGHT = 1.7;        // Kenney 선수 키(m)
const rig = { model: null, mixer: null, actions: {}, current: null, arm: null, tipDir: null, armLen: 1, base: 0, lockUntil: 0, swing: 0 };

// 경기장 사진 배경과 HDRI 조명
function loadArena() {
  new HDRLoader().load("assets/arena.hdr", (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.environmentIntensity = 0.8;
    scene.environmentRotation.y = ARENA_TURN;
  }, undefined, (err) => console.warn("arena.hdr", err));
  new THREE.TextureLoader().load("assets/arena.jpg", (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.backgroundIntensity = 0.55;
    scene.backgroundRotation.y = ARENA_TURN;
    scene.fog = new THREE.Fog(0x3a2a26, 14, 30);
    stands.visible = false;
  }, undefined, (err) => console.warn("arena.jpg", err));
}

// 나무 바닥 (색·요철·거칠기, 다 불러오면 바꿈)
async function loadFloor() {
  const loader = new THREE.TextureLoader();
  try {
    const [map, normalMap, roughnessMap] = await Promise.all(["color", "normal", "rough"].map((k) => loader.loadAsync(`assets/wood-${k}.jpg`)));
    for (const t of [map, normalMap, roughnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(12, 12);
      t.anisotropy = 8;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    Object.assign(floor.material, { map, normalMap, roughnessMap, roughness: 1 });
    floor.material.normalScale.set(0.6, 0.6);
    floor.material.needsUpdate = true;
  } catch (err) {
    console.warn("wood", err);
  }
}

// 팔 끝 자리 (팔 뼈에 붙은 꼭짓점 중 어깨에서 가장 먼 곳, 뼈 기준 좌표)
function armTip(model, bone) {
  const tip = new THREE.Vector3();
  const v = new THREE.Vector3();
  const toBone = new THREE.Matrix4().copy(bone.matrixWorld).invert();
  bone.traverse((o) => {                                          // 뼈에 바로 붙은 조각 모델
    if (!o.isMesh || o.isSkinnedMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(toBone, o.matrixWorld);
    const { position } = o.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      if (v.lengthSq() > tip.lengthSq()) tip.copy(v);
    }
  });
  model.traverse((o) => {                                         // 뼈대로 휘는 모델
    if (!o.isSkinnedMesh) return;
    const k = o.skeleton.bones.indexOf(bone);
    if (k < 0) return;
    const { position, skinIndex, skinWeight } = o.geometry.attributes;
    const toBone = new THREE.Matrix4().multiplyMatrices(o.skeleton.boneInverses[k], o.bindMatrix);
    for (let i = 0; i < position.count; i++) {
      let best = 0;
      for (let j = 1; j < 4; j++) if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, best)) best = j;
      if (skinIndex.getComponent(i, best) !== k) continue;
      v.fromBufferAttribute(position, i).applyMatrix4(toBone);
      if (v.lengthSq() > tip.lengthSq()) tip.copy(v);
    }
  });
  return tip;
}

// Kenney 선수 불러오기 (오른팔 길이·방향을 재 둠)
function loadPlayer() {
  new GLTFLoader().load("assets/kenney/player.glb", (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const scale = PLAYER_HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    rig.base = FLOOR_Y - box.min.y * scale;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    scene.add(model);
    rig.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) rig.actions[clip.name] = rig.mixer.clipAction(clip);
    rig.arm = model.getObjectByName("arm-right");
    if (rig.arm) {
      model.updateMatrixWorld(true);
      const tip = armTip(model, rig.arm);
      rig.tipDir = tip.clone().normalize();
      rig.armLen = tip.length() * rig.arm.getWorldScale(new THREE.Vector3()).x;
    }
    act("idle");
    rig.model = model;
    procBody.visible = false;
  }, undefined, (err) => console.warn("player.glb", err));
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

// 오른팔을 라켓 손잡이 쪽으로 뻗기 (모자라면 팔을 조금 늘림)
function aimArm() {
  const arm = rig.arm;
  if (!arm || !rig.tipDir) return;
  rig.model.updateMatrixWorld(true);
  arm.getWorldPosition(shoulder);
  hand.copy(aiPaddle.position).add(va.set(0, -0.16, 0).applyEuler(aiPaddle.rotation));
  arm.getWorldQuaternion(qa);
  vb.copy(rig.tipDir).applyQuaternion(qa);
  va.subVectors(hand, shoulder);
  const dist = va.length();
  qb.setFromUnitVectors(vb, va.normalize()).multiply(qa);
  arm.parent.getWorldQuaternion(qa).invert();
  arm.quaternion.copy(qa.multiply(qb));
  arm.scale.set(1, Math.max(0.8, Math.min(1.7, dist / rig.armLen)), 1);
}

// 선수 동작 바꾸기 (once 면 한 번 하고, lock 동안은 다른 동작으로 안 바꿈)
function act(name, { once = false, speed = 1, lock = 0 } = {}) {
  const next = rig.actions[name];
  if (!next || (rig.current === next && !once)) return;
  next.reset();
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
  next.clampWhenFinished = true;
  next.timeScale = speed;
  next.fadeIn(0.12).play();
  if (rig.current && rig.current !== next) rig.current.fadeOut(0.12);
  rig.current = next;
  rig.lockUntil = performance.now() + lock;
}

// Kenney 선수 그리기 (라켓 옆에서 걷고, 몸은 끝선 뒤에, 칠 때 몸을 비틂)
function drawRig(s, now, frame) {
  const pad = s.pads.ai;
  rig.model.position.set(pad.x + 0.38, rig.base, Math.min(pad.z - 0.32, -(HALF_L + 0.3)));
  rig.swing = Math.max(0, rig.swing - frame);
  rig.model.rotation.y = -Math.sin((rig.swing / 0.3) * Math.PI) * 0.45;
  if (now >= rig.lockUntil) act(Math.hypot(pad.vx, pad.vz) > 0.6 ? "walk" : "idle");
  rig.mixer.update(frame);
  aimArm();
}

// 사건 → 선수 동작 (치기·서브는 휘두르기, 점수 나면 좋아하거나 아쉬워함)
function animateEvents(events) {
  if (!rig.model) return;
  for (const e of events) {
    if ((e.type === "hit" || e.type === "serve") && e.side === AI) rig.swing = 0.3;
    else if (e.type === "point") act(e.winner === AI ? "emote-yes" : "emote-no", { once: true, lock: 1000 });
  }
}

loadArena();
loadFloor();
loadPlayer();

// ---------- 효과 ----------

const effects = [];
const ringGeo = new THREE.RingGeometry(0.02, 0.032, 24);

// 튄 자리 물결
function ripple(x, y, z, color = 0xffffff) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.003, z);
  scene.add(m);
  const born = performance.now();
  effects.push((now) => {
    const t = (now - born) / 420;
    m.scale.setScalar(1 + t * 3.5);
    m.material.opacity = 0.85 * (1 - t);
    if (t < 1) return false;
    scene.remove(m);
    m.material.dispose();
    return true;
  });
}

// 타격 번쩍임 (스매시는 크게, 불꽃 튐)
function flash(x, y, z, hot) {
  const glow = (color) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const sprite = glow(hot ? 0xffa040 : 0xffffff);
  sprite.position.set(x, y, z);
  scene.add(sprite);
  const sparks = [];
  for (let i = 0; i < (hot ? 14 : 5); i++) {
    const sp = glow(0xffd28a);
    sp.position.set(x, y, z);
    sp.scale.setScalar(0.03);
    const a = Math.random() * Math.PI * 2;
    const speed = (hot ? 1.6 : 0.8) * (0.5 + Math.random());
    sp.userData.v = new THREE.Vector3(Math.cos(a) * speed, Math.random() * speed, Math.sin(a) * speed);
    scene.add(sp);
    sparks.push(sp);
  }
  const born = performance.now();
  let prev = born;
  effects.push((now) => {
    const t = (now - born) / (hot ? 380 : 240);
    const dt = (now - prev) / 1000;
    prev = now;
    sprite.scale.setScalar((hot ? 0.45 : 0.22) * (0.4 + t));
    sprite.material.opacity = Math.max(0, 1 - t);
    for (const sp of sparks) {
      sp.position.addScaledVector(sp.userData.v, dt);
      sp.userData.v.y -= 4 * dt;
      sp.material.opacity = Math.max(0, 1 - t);
    }
    if (t < 1) return false;
    for (const o of [sprite, ...sparks]) {
      scene.remove(o);
      o.material.dispose();
    }
    return true;
  });
}

// 알림 글자 (튀어나오는 글자)
let bannerTimer = 0;
function banner(text, cls = "") {
  const el = $("#banner");
  el.textContent = text;
  el.className = "banner";
  void el.offsetWidth;
  el.className = `banner show ${cls}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove("show"), 1200);
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

// 매치 포인트·듀스 글자
function status(s) {
  const { me, ai } = s.score;
  if (s.over || Math.max(me, ai) < WIN_SCORE - 1) return "";
  if (me === ai) return "듀스";
  return me > ai ? "매치 포인트 · 나" : "매치 포인트 · AI";
}

// 점수판
function drawHud(s) {
  setText("my-score", String(s.score.me));
  setText("ai-score", String(s.score.ai));
  setText("level", LEVELS[s.bots.ai].name);
  setText("rally", String(s.rally));
  setText("longest", String(s.longest));
  const st = status(s);
  setText("status", st);
  $("#status").classList.toggle("hidden", !st);
  $("#my-serve").classList.toggle("on", s.server === ME && !s.over);
  $("#ai-serve").classList.toggle("on", s.server === AI && !s.over);
  $("#hud .me").classList.toggle("lead", s.score.me > s.score.ai);
  $("#hud .ai").classList.toggle("lead", s.score.ai > s.score.me);
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
  $("#guide").classList.toggle("hidden", !levels);
  for (const btn of document.querySelectorAll("#levels button")) {
    const lv = Number(btn.dataset.level);
    btn.classList.toggle("on", lv === level);
    btn.querySelector(".rec").textContent = recordText(lv);
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
  history.length = 0;
  mode = "play";
  $("#panel").classList.add("hidden");
  banner(game.server === ME ? "내 서브! 클릭 · 스페이스" : "AI 서브", "info");
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
  showPanel(win ? "🏆 승리!" : "아쉬운 패배",
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
      const hot = e.shot === "smash";
      if (e.type === "hit") flash(e.x, e.y, e.z, hot);
      if (hot) shake = 0.25;
      tok(hot ? 520 : 820, hot ? 0.45 : 0.3, 0.06);
      if (e.side === ME && e.type === "hit" && !e.foul) {
        const pct = e.shot === "drive" || e.shot === "smash" ? ` ${Math.round(e.power * 100)}%` : "";
        banner(`${SHOTS[e.shot].name}!${pct}`, hot ? "hot" : "shot");
      }
    } else if (e.type === "point") {
      const mine = e.winner === ME;
      banner(`${mine ? "득점" : "실점"} · ${REASONS[e.reason]}`, mine ? "good" : "warn");
      tok(mine ? 990 : 330, 0.15, 0.12);
    } else if (e.type === "ready" && e.server === ME) banner("내 서브! 클릭 · 스페이스", "info");
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
    banner(muted ? "소리 끔" : "소리 켬", "info");
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
    camera.fov = w / h < 1 ? 66 : 48;              // 세로 화면은 넓게
    camera.updateProjectionMatrix();
  }
}

// 카메라: 내 라켓 뒤 위쪽, 라켓·공을 살짝 따라감 (스매시 때 흔들림)
const camX = { v: 0 };
function updateCamera(s, frame) {
  const portrait = camera.aspect < 1;
  const target = (s.pads.me.x || 0) * 0.22 + s.ball.p.x * 0.08;
  camX.v += (target - camX.v) * Math.min(1, frame * 3);
  shake = Math.max(0, shake - frame);
  const j = shake * 0.05;
  const [y, z, lookY, lookZ] = portrait ? [1.7, 3.55, -0.12, -0.5] : [1.28, 3.15, -0.04, -0.5];
  camera.position.set(camX.v + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z);
  camera.lookAt(camX.v * 0.4, lookY, lookZ);
}

// 화질 자동 조절 (느리면 해상도 → 그림자 순으로 낮춤)
const perf = { frames: 0, time: 0, step: 0 };
function adaptQuality(frame) {
  if (perf.step >= 2 || document.hidden) return;
  perf.frames += 1;
  perf.time += frame;
  if (perf.time < 2 || perf.frames < 20) return;
  const slow = perf.time / perf.frames > 1 / 40;
  perf.frames = perf.time = 0;
  if (!slow) return;
  perf.step += 1;
  if (perf.step === 1 && renderer.getPixelRatio() > 1) renderer.setPixelRatio(1);
  else {
    perf.step = 2;
    renderer.shadowMap.enabled = false;
    scene.traverse((o) => o.material && [].concat(o.material).forEach((m) => (m.needsUpdate = true)));
  }
}

// 매 프레임 진행·그리기
function tick(now) {
  const frame = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    adaptQuality(frame);
    resize();
    if (game && mode === "play") {
      acc += frame;
      while (acc >= DT) {
        acc -= DT;
        const events = step(game, DT, input());
        onEvents(events);
        animateEvents(events);
        if (game.over) break;
      }
    } else if (!game || mode === "ready") {
      acc += frame;
      while (acc >= DT) {
        acc -= DT;
        animateEvents(step(demo, DT));
        if (demo.over) demo = makeDemo();
      }
    }
    const s = mode === "ready" ? demo : game;
    drawBall(s, now);
    drawMarker(s, now);
    drawPaddle(s, ME, myPaddle, frame);
    drawPaddle(s, AI, aiPaddle, frame);
    if (rig.model) drawRig(s, now, frame);
    else drawPlayer(s, now, frame);
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
showPanel("탁구", "라켓을 움직여 공을 받아치세요", "시작하기");
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
