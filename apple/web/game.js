// 사과게임 화면: 게임 진행(시작·끝·최고 기록), 드래그 입력(마우스·터치), 캔버스 그리기.
// 규칙은 logic.js 에 있다. 사과 그림은 외부 이미지 없이 캔버스로 직접 그린다.
// 세로 화면에서는 판을 돌려(10 × 17) 그린다. 네모는 돌려도 네모라 규칙은 그대로.
import { COLS, ROWS, TIME, clear, createGame, hasMove, normRect, select, tick } from "./logic.js";

const $ = (sel) => document.querySelector(sel);
const BEST_KEY = "apple-best";
const LIGHT_KEY = "apple-light";
const canvas = $("#board");
const ctx = canvas.getContext("2d");

// ---------- 상태 ----------

let game = null;
let mode = "ready";                 // ready → play → over
let best = readNum(BEST_KEY);
let light = readNum(LIGHT_KEY) === 1;
let drag = null;                    // { x0, y0, x1, y1 } 화면 좌표
let last = performance.now();
const falling = [];                 // 지워져 떨어지는 사과

function readNum(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNum(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

// ---------- 배치 ----------

const view = { w: 0, h: 0, dpr: 1, S: 40, bx: 0, by: 0, portrait: false, cols: COLS, rows: ROWS };

// 화면 크기에 맞춰 칸 크기·판 위치 계산
function layout() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (w === view.w && h === view.h && dpr === view.dpr) return;
  Object.assign(view, { w, h, dpr });
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  view.portrait = h > w * 1.05;
  view.cols = view.portrait ? ROWS : COLS;
  view.rows = view.portrait ? COLS : ROWS;
  // 판 + 오른쪽 시간 막대(1.3칸) + 위 점수줄(1.1칸) + 여백
  const S = Math.floor(Math.min((w - 16) / (view.cols + 2.0), (h - 16) / (view.rows + 1.9)));
  view.S = Math.max(14, S);
  const total = (view.cols + 1.3) * view.S;
  view.bx = Math.round((w - total) / 2);
  view.by = Math.round((h - (view.rows + 1.1) * view.S) / 2 + 1.1 * view.S);
  sprites.clear();
}

// 판 칸(r, c) → 화면 칸(dr, dc)
const toView = (r, c) => (view.portrait ? [c, r] : [r, c]);
// 화면 칸 중심 좌표
const cellCenter = (dr, dc) => [view.bx + (dc + 0.5) * view.S, view.by + (dr + 0.5) * view.S];

// 드래그 네모 → 중심이 안에 든 칸 범위 (판 좌표)
function dragRect(d) {
  const x0 = Math.min(d.x0, d.x1);
  const x1 = Math.max(d.x0, d.x1);
  const y0 = Math.min(d.y0, d.y1);
  const y1 = Math.max(d.y0, d.y1);
  const c0 = Math.ceil((x0 - view.bx) / view.S - 0.5);
  const c1 = Math.floor((x1 - view.bx) / view.S - 0.5);
  const r0 = Math.ceil((y0 - view.by) / view.S - 0.5);
  const r1 = Math.floor((y1 - view.by) / view.S - 0.5);
  if (c0 > c1 || r0 > r1 || c1 < 0 || r1 < 0 || c0 >= view.cols || r0 >= view.rows) return null;
  return view.portrait ? normRect(c0, r0, c1, r1) : normRect(r0, c0, r1, c1);
}

// ---------- 사과 그림 ----------

const sprites = new Map();

// 사과 한 개 그림 (숫자·선택 여부별로 미리 그려 둠)
function sprite(n, on) {
  const key = `${n}-${on}-${light}`;
  if (sprites.has(key)) return sprites.get(key);
  const S = view.S;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(S * view.dpr);
  const g = c.getContext("2d");
  g.scale(view.dpr, view.dpr);
  const cx = S / 2;
  const cy = S * 0.54;
  const R = S * 0.4;
  // 몸통
  const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
  const [hi, mid, low] = on ? ["#fff3a6", "#ffcf3a", "#e59a00"] : light ? ["#ffc4bd", "#ff8f84", "#f06a5f"] : ["#ff8a7a", "#f2392b", "#b81a12"];
  body.addColorStop(0, hi);
  body.addColorStop(0.45, mid);
  body.addColorStop(1, low);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx, cy - R * 0.72);
  g.bezierCurveTo(cx + R * 0.55, cy - R * 1.12, cx + R * 1.12, cy - R * 0.6, cx + R * 1.02, cy + R * 0.12);
  g.bezierCurveTo(cx + R * 0.94, cy + R * 0.82, cx + R * 0.42, cy + R * 1.04, cx, cy + R * 0.9);
  g.bezierCurveTo(cx - R * 0.42, cy + R * 1.04, cx - R * 0.94, cy + R * 0.82, cx - R * 1.02, cy + R * 0.12);
  g.bezierCurveTo(cx - R * 1.12, cy - R * 0.6, cx - R * 0.55, cy - R * 1.12, cx, cy - R * 0.72);
  g.fill();
  // 꼭지·잎
  g.strokeStyle = "#6b3f1d";
  g.lineWidth = Math.max(1.5, S * 0.055);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx, cy - R * 0.7);
  g.quadraticCurveTo(cx + R * 0.05, cy - R * 1.05, cx + R * 0.22, cy - R * 1.2);
  g.stroke();
  g.fillStyle = "#4caf3c";
  g.beginPath();
  g.ellipse(cx + R * 0.45, cy - R * 1.02, R * 0.32, R * 0.15, -0.5, 0, Math.PI * 2);
  g.fill();
  // 숫자
  g.font = `900 ${Math.round(S * 0.46)}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = Math.max(2, S * 0.08);
  g.strokeStyle = on ? "#9a6200" : light ? "#c2443a" : "#8f130c";
  g.strokeText(String(n), cx, cy + S * 0.03);
  g.fillStyle = "#fff";
  g.fillText(String(n), cx, cy + S * 0.03);
  sprites.set(key, c);
  return c;
}

// ---------- 그리기 ----------

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// 판·사과·드래그 네모·시간 막대·점수
function draw(now) {
  const { S, bx, by, cols, rows } = view;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = "#cfeab4";
  ctx.fillRect(0, 0, view.w, view.h);
  // 판 바탕
  ctx.fillStyle = "#e9f6d9";
  roundRect(bx - S * 0.25, by - S * 0.25, cols * S + S * 0.5, rows * S + S * 0.5, S * 0.35);
  ctx.fill();
  ctx.strokeStyle = "#9fcf7c";
  ctx.lineWidth = 2;
  ctx.stroke();

  const s = game;
  const cells = s ? s.cells : null;
  const rect = drag && mode === "play" ? dragRect(drag) : null;
  const picked = new Set(rect && cells ? select(cells, rect).picked : []);
  if (cells) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = cells[r * COLS + c];
        if (!v) continue;
        const [dr, dc] = toView(r, c);
        ctx.drawImage(sprite(v, picked.has(r * COLS + c)), bx + dc * S, by + dr * S, S, S);
      }
    }
  }
  // 떨어지는 사과
  for (const f of falling) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2);
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    ctx.drawImage(sprite(f.n, false), -S / 2, -S / 2, S, S);
    ctx.restore();
  }
  // 드래그 네모
  if (drag && mode === "play") {
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    ctx.fillStyle = "rgba(70,130,255,.16)";
    ctx.strokeStyle = "rgba(40,90,230,.85)";
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
  }
  // 시간 막대 (오른쪽 세로)
  const tx = bx + cols * S + S * 0.55;
  const tw = S * 0.5;
  const left = s ? s.left / TIME : 1;
  ctx.fillStyle = "#fff";
  roundRect(tx, by, tw, rows * S, tw / 2);
  ctx.fill();
  ctx.strokeStyle = "#9fcf7c";
  ctx.stroke();
  const fillH = rows * S * left;
  if (fillH > 1) {
    ctx.fillStyle = s && s.left <= 10 ? (Math.floor(now / 250) % 2 ? "#ff6b5b" : "#ff9a8f") : "#58c24a";
    roundRect(tx + 3, by + rows * S - fillH + 3, tw - 6, Math.max(0, fillH - 6), (tw - 6) / 2);
    ctx.fill();
  }
  // 점수 (판 위 오른쪽)
  ctx.fillStyle = "#2f6b2a";
  ctx.font = `900 ${Math.round(S * 0.62)}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(s ? s.score : 0), tx + tw, by - S * 0.38);
  ctx.textAlign = "left";
  ctx.font = `800 ${Math.round(S * 0.36)}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;
  ctx.fillStyle = "#5c8a4f";
  ctx.fillText(`최고 ${Math.max(best, s ? s.score : 0)}`, bx, by - S * 0.42);
}

// 지운 사과가 튀어 올랐다 떨어지기
function drop(indices, nums) {
  for (const i of indices) {
    const [dr, dc] = toView(Math.floor(i / COLS), i % COLS);
    const [x, y] = cellCenter(dr, dc);
    falling.push({ n: nums.get(i), x, y, vx: (Math.random() - 0.5) * view.S * 6, vy: -view.S * (5 + Math.random() * 4), rot: 0, vr: (Math.random() - 0.5) * 8, t: 0 });
  }
}

function animate(dt) {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.t += dt;
    f.vy += view.S * 28 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
    if (f.t > 1.2 || f.y > view.h + view.S) falling.splice(i, 1);
  }
}

// ---------- 진행 ----------

function showPanel(title, text, button, board) {
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  $("#panel-btn").textContent = button;
  $("#panel").classList.remove("hidden");
  $("#lb").replaceChildren();
  if (board) window.Leaderboard?.mount($("#lb"), "apple", { unit: "개" });
}

// 새 판
function start() {
  window.Leaderboard?.begin("apple");                                     // 순위 입장권
  game = createGame(Date.now() >>> 0);
  falling.length = 0;
  drag = null;
  mode = "play";
  $("#panel").classList.add("hidden");
}

// 판 끝 (시간 끝·다 지움·더 지울 게 없음)
function finish(reason) {
  mode = "over";
  drag = null;
  const isBest = game.score > best;
  best = Math.max(best, game.score);
  writeNum(BEST_KEY, best);
  const posted = window.Leaderboard?.submit("apple", game.score);
  const title = game.score === ROWS * COLS ? "🍎 다 땄어요!" : isBest ? "🏆 최고 기록!" : reason;
  setTimeout(async () => {
    if (mode !== "over") return;
    showPanel(title, `사과 ${game.score}개 땄어요 · 최고 ${best}`, "다시 하기");
    if (posted) window.Leaderboard.mount($("#lb"), "apple", { unit: "개", result: await posted });
  }, 700);
}

// 손을 뗐을 때 지우기
function release() {
  if (!drag || mode !== "play") return;
  const rect = dragRect(drag);
  drag = null;
  if (!rect) return;
  const nums = new Map(select(game.cells, rect).picked.map((i) => [i, game.cells[i]]));   // 지우기 전 숫자
  const cleared = clear(game, rect);
  if (!cleared.length) return;
  drop(cleared, nums);
  if (game.over) finish("🍎 다 땄어요!");
  else if (!hasMove(game.cells)) {
    game.over = true;
    finish("더 지울 사과가 없어요");
  }
}

// ---------- 입력 ----------

function point(e) {
  const b = canvas.getBoundingClientRect();
  return [e.clientX - b.left, e.clientY - b.top];
}

canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "play") return;
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = point(e);
  drag = { x0: x, y0: y, x1: x, y1: y };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  [drag.x1, drag.y1] = point(e);
});
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", () => (drag = null));

$("#panel-btn").addEventListener("click", start);
$("#reset").addEventListener("click", () => {
  if (mode === "play") start();
});
const lightBox = $("#light");
lightBox.checked = light;
lightBox.addEventListener("change", () => {
  light = lightBox.checked;
  writeNum(LIGHT_KEY, light ? 1 : 0);
});

// ---------- 매 프레임 ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    layout();
    if (mode === "play") {
      tick(game, dt);
      if (game.over) finish("⏰ 시간 끝!");
    }
    animate(dt);
    draw(now);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

game = createGame(1);                // 시작 전 화면용
showPanel("사과게임", "드래그로 네모를 그려서\n안에 든 숫자 합이 딱 10이면 사과가 사라져요.\n2분 동안 최대한 많이!", "시작하기", true);
requestAnimationFrame(frame);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__apple = {
  get game() { return game; },
  get mode() { return mode; },
  get view() { return view; },
  start,
};
