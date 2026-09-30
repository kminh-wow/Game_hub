// 팩맨 게임 진행과 그리기. 규칙은 logic.js 에 있다.
import {
  W, H, MAZE, PAC_START, HOUSE_EXIT, HOUSE_CENTER, DIRS, OPPOSITE,
  isOpen, createPellets, createEntity, position, step, reverse, nextTile,
  chooseGhostDir, ghostTarget, modeAt, inTunnel, wrapX, MODE_SCHEDULE,
} from "./logic.js";

const TILE = 20;
const BASE_SPEED = 9.5;          // 타일/초
const DOT_SCORE = 10;
const POWER_SCORE = 50;
const GHOST_SCORES = [200, 400, 800, 1600];
const EXTRA_LIFE_SCORE = 10000;

// 난이도. "중상"이 처음 만든 기본값이다.
//   ghost: 유령 속도(팩맨 기본 속도 대비), fright: 1레벨 겁먹는 시간(초), lives: 목숨,
//   randomTurn: 갈림길에서 엉뚱한 길로 갈 확률, schedule: 흩어지기/쫓기 시간표, release: 집에서 나오는 조건 배율
const DIFFICULTIES = {
  easy:    { label: "쉬움",   ghost: 0.60, fright: 10, lives: 5, randomTurn: 0.30, schedule: [10, 15, 10, 15, 8, 15, 8, Infinity], release: 2 },
  normal:  { label: "보통",   ghost: 0.68, fright: 8,  lives: 4, randomTurn: 0.15, schedule: [8, 20, 8, 20, 6, 20, 6, Infinity], release: 1.5 },
  midhigh: { label: "중상",   ghost: 0.75, fright: 6,  lives: 3, randomTurn: 0,    schedule: MODE_SCHEDULE, release: 1 },
  hard:    { label: "어려움", ghost: 0.85, fright: 4,  lives: 3, randomTurn: 0,    schedule: [5, 25, 5, 25, 3, 25, 3, Infinity], release: 0.6 },
};
const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);

const GHOSTS = [
  // name, 색, 시작 위치, 시작 상태, 집에서 나오는 조건(먹은 점 수 / 경과 초)
  { name: "blinky", color: "#ff0000", start: HOUSE_EXIT, state: "normal", dots: 0, time: 0 },
  { name: "pinky", color: "#ffb8ff", start: { x: 13, y: 14 }, state: "house", dots: 0, time: 1 },
  { name: "inky", color: "#00ffff", start: { x: 11, y: 14 }, state: "house", dots: 30, time: 5 },
  { name: "clyde", color: "#ffb852", start: { x: 15, y: 14 }, state: "house", dots: 60, time: 10 },
];

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
canvas.width = W * TILE;
canvas.height = H * TILE;

const $score = document.getElementById("score");
const $high = document.getElementById("high");
const $lives = document.getElementById("lives");
const $level = document.getElementById("level");
const $difficulty = document.getElementById("difficulty-label");

// ---- 상태 ----

let game;          // 한 판 전체 (점수, 목숨, 레벨)
let pac;           // 팩맨
let ghosts;        // 유령 4마리
let want = null;   // 입력된 방향 (다음 갈림길에서 꺾을 방향)

let difficulty = (() => {
  try {
    const saved = localStorage.getItem("pacman-difficulty");
    if (saved in DIFFICULTIES) return saved;
  } catch {}
  return "midhigh";
})();
const diff = () => DIFFICULTIES[difficulty];

// 최고 점수는 난이도별로 따로 저장한다. (난이도가 생기기 전 기록은 "중상"으로 본다)
function loadHigh() {
  try {
    const v = localStorage.getItem(`pacman-high-${difficulty}`) ?? (difficulty === "midhigh" ? localStorage.getItem("pacman-high") : null);
    return Number(v) || 0;
  } catch { return 0; }
}
function saveHigh(v) {
  try { localStorage.setItem(`pacman-high-${difficulty}`, String(v)); } catch {}
}

function setDifficulty(key) {
  if (!(key in DIFFICULTIES) || (game.phase !== "start" && game.phase !== "over")) return;
  difficulty = key;
  try { localStorage.setItem("pacman-difficulty", key); } catch {}
  newGame();
}

function newGame() {
  game = {
    phase: "start",      // start → ready → playing → dying / clear → … → over
    phaseTime: 0,
    score: 0,
    high: loadHigh(),
    lives: diff().lives,
    level: 1,
    pellets: createPellets(),
    dotsEaten: 0,        // 이번 목숨에서 먹은 점 (유령 집 출발 조건)
    lifeTime: 0,         // 이번 목숨에서 흐른 시간
    modeTime: 0,         // 흩어지기/쫓기 일정용 시간 (겁먹은 동안은 멈춤)
    mode: "scatter",
    frightLeft: 0,
    ghostCombo: 0,
    extraLifeGiven: false,
    paused: false,
  };
  resetActors();
}

function resetActors() {
  pac = { ...createEntity(PAC_START.x, PAC_START.y, null), face: "left" };
  want = "left";
  ghosts = GHOSTS.map((g) => ({
    ...createEntity(g.start.x, g.start.y, g.state === "normal" ? "left" : null),
    ...g,
    dots: g.dots * diff().release,
    time: g.time * diff().release,
    frightened: false,
  }));
  game.dotsEaten = 0;
  game.lifeTime = 0;
  game.modeTime = 0;
  game.mode = "scatter";
  game.frightLeft = 0;
}

function setPhase(phase) {
  game.phase = phase;
  game.phaseTime = 0;
}

function speedFactor() {
  return BASE_SPEED * (1 + 0.05 * Math.min(game.level - 1, 4));
}

function frightDuration() {
  return Math.max(1, diff().fright - (game.level - 1));
}

function addScore(n) {
  game.score += n;
  if (!game.extraLifeGiven && game.score >= EXTRA_LIFE_SCORE) {
    game.extraLifeGiven = true;
    game.lives += 1;
  }
  if (game.score > game.high) {
    game.high = game.score;
    saveHigh(game.high);
  }
}

// ---- 업데이트 ----

function update(dt) {
  game.phaseTime += dt;
  switch (game.phase) {
    case "ready":
      if (game.phaseTime > 2) setPhase("playing");
      return;
    case "dying":
      if (game.phaseTime > 1.5) {
        game.lives -= 1;
        if (game.lives <= 0) {
          setPhase("over");
        } else {
          resetActors();
          setPhase("ready");
        }
      }
      return;
    case "clear":
      if (game.phaseTime > 2) {
        game.level += 1;
        game.pellets = createPellets();
        resetActors();
        setPhase("ready");
      }
      return;
    case "playing":
      if (!game.paused) updatePlaying(dt);
      return;
    default:
      return;
  }
}

function updatePlaying(dt) {
  game.lifeTime += dt;

  if (game.frightLeft > 0) {
    game.frightLeft = Math.max(0, game.frightLeft - dt);
    if (game.frightLeft === 0) ghosts.forEach((g) => (g.frightened = false));
  } else {
    game.modeTime += dt;
    const mode = modeAt(game.modeTime, diff().schedule);
    if (mode !== game.mode) {
      game.mode = mode;
      ghosts.forEach((g) => g.state === "normal" && reverse(g));
    }
  }

  updatePac(dt);
  ghosts.forEach((g) => updateGhost(g, dt));
  checkCollisions();

  if (game.pellets.size === 0) setPhase("clear");
}

function updatePac(dt) {
  // 반대 방향 입력은 타일 중간에서도 바로 돌아선다.
  if (want && pac.dir && want === OPPOSITE[pac.dir]) reverse(pac);

  const speed = speedFactor() * (game.frightLeft > 0 ? 0.9 : 0.8);
  step(pac, speed * dt, (e) => {
    eatAt(e.x, e.y);
    for (const dir of [want, e.dir]) {
      if (!dir) continue;
      const n = nextTile(e, dir);
      if (isOpen(n.x, n.y)) return dir;
    }
    return null;
  });
  if (pac.dir) pac.face = pac.dir;
}

function eatAt(x, y) {
  const key = `${x},${y}`;
  const kind = game.pellets.get(key);
  if (!kind) return;
  game.pellets.delete(key);
  game.dotsEaten += 1;
  if (kind === "dot") {
    addScore(DOT_SCORE);
  } else {
    addScore(POWER_SCORE);
    game.frightLeft = frightDuration();
    game.ghostCombo = 0;
    for (const g of ghosts) {
      if (g.state === "eaten" || g.state === "entering") continue;
      g.frightened = true;
      if (g.state === "normal") reverse(g);
    }
  }
}

/** 유령 집 안에서는 벽을 무시하고 목표까지 가로 → 세로 순으로 움직인다. 도착하면 true. */
function moveInHouse(g, target, dist) {
  for (const axis of ["x", "y"]) {
    const diff = target[axis] - g[axis];
    if (Math.abs(diff) < 1e-6) continue;
    const m = Math.min(Math.abs(diff), dist);
    g[axis] += Math.sign(diff) * m;
    dist -= m;
    if (dist <= 0 && Math.abs(target[axis] - g[axis]) > 1e-6) return false;
  }
  g.x = target.x;
  g.y = target.y;
  return true;
}

function updateGhost(g, dt) {
  const base = speedFactor();

  if (g.state === "house") {
    if (game.dotsEaten >= g.dots || game.lifeTime >= g.time) g.state = "leaving";
    else return;
  }
  if (g.state === "leaving") {
    if (moveInHouse(g, HOUSE_EXIT, base * 0.5 * dt)) {
      g.state = "normal";
      g.dir = "left";
      g.p = 0;
    }
    return;
  }
  if (g.state === "entering") {
    if (moveInHouse(g, HOUSE_CENTER, base * 1.5 * dt)) g.state = "leaving";
    return;
  }

  let speed = base * diff().ghost;
  if (g.state === "eaten") speed = base * 2;
  else if (g.frightened) speed = base * 0.5;
  else if (inTunnel(g)) speed = base * 0.4;

  step(g, speed * dt, (e) => {
    if (g.state === "eaten") {
      if (e.x === HOUSE_EXIT.x && e.y === HOUSE_EXIT.y) {
        g.state = "entering";
        return null;
      }
      return chooseGhostDir(e, HOUSE_EXIT);
    }
    if (g.frightened) return chooseGhostDir(e, HOUSE_EXIT, Math.random);
    const blinky = ghosts[0];
    const target = ghostTarget(g.name, game.mode, {
      pac: { x: pac.x, y: pac.y },
      pacDir: pac.face,
      self: { x: e.x, y: e.y },
      blinky: { x: blinky.x, y: blinky.y },
    });
    // 쉬운 난이도에서는 가끔 엉뚱한 길로 간다.
    const wander = diff().randomTurn > 0 && Math.random() < diff().randomTurn;
    return chooseGhostDir(e, target, wander ? Math.random : null);
  });
}

function checkCollisions() {
  const p = position(pac);
  for (const g of ghosts) {
    if (g.state !== "normal") continue;
    const q = position(g);
    if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 0.8) continue;
    if (g.frightened) {
      g.frightened = false;
      g.state = "eaten";
      addScore(GHOST_SCORES[Math.min(game.ghostCombo, GHOST_SCORES.length - 1)]);
      game.ghostCombo += 1;
    } else {
      setPhase("dying");
      return;
    }
  }
}

// ---- 그리기 (디자인은 나중에 교체) ----

function draw() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMaze();
  drawPellets();
  if (game.phase !== "start" && game.phase !== "over") {
    drawPac();
    if (game.phase !== "dying" || game.phaseTime < 0.3) ghosts.forEach(drawGhost);
  }
  drawMessage();

  $score.textContent = game.score;
  $high.textContent = game.high;
  $lives.textContent = "●".repeat(Math.max(game.lives, 0));
  $level.textContent = game.level;
  $difficulty.textContent = diff().label;
  const choosing = game.phase === "start" || game.phase === "over";
  for (const btn of document.querySelectorAll("#difficulty button")) {
    btn.disabled = !choosing;
    btn.classList.toggle("on", btn.dataset.level === difficulty);
  }
}

function drawMaze() {
  const flash = game.phase === "clear" && Math.floor(game.phaseTime * 4) % 2 === 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = MAZE[y][x];
      if (c === "#") {
        ctx.fillStyle = flash ? "#fff" : "#2121de";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      } else if (c === "-") {
        ctx.fillStyle = "#ffb8de";
        ctx.fillRect(x * TILE, y * TILE + TILE / 2 - 2, TILE, 4);
      }
    }
  }
}

function drawPellets() {
  const blink = Math.floor(performance.now() / 250) % 2 === 0;
  ctx.fillStyle = "#ffb8ae";
  for (const [key, kind] of game.pellets) {
    const [x, y] = key.split(",").map(Number);
    const r = kind === "power" ? 6 : 2;
    if (kind === "power" && !blink && game.phase === "playing") continue;
    ctx.beginPath();
    ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function screen(e) {
  const p = position(e);
  return { x: wrapX(p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
}

const FACE_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

function drawPac() {
  const { x, y } = screen(pac);
  let mouth;
  if (game.phase === "dying") {
    mouth = Math.min(1, game.phaseTime / 1.2) * Math.PI;       // 점점 사라짐
  } else {
    mouth = (Math.abs(Math.sin(performance.now() / 80)) * 0.35 + 0.05) * Math.PI;
    if (!pac.dir || game.phase !== "playing") mouth = 0.25 * Math.PI;
  }
  const a = FACE_ANGLE[pac.face];
  ctx.fillStyle = "#ffff00";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, TILE * 0.8, a + mouth, a + Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();
}

function drawGhost(g) {
  let { x, y } = screen(g);
  if (g.state === "house") y += Math.sin(performance.now() / 150) * 3;
  const r = TILE * 0.8;

  if (g.state !== "eaten" && g.state !== "entering") {
    const ending = game.frightLeft > 0 && game.frightLeft < 2 && Math.floor(game.frightLeft * 5) % 2 === 0;
    ctx.fillStyle = g.frightened ? (ending ? "#fff" : "#2121ff") : g.color;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
    ctx.closePath();
    ctx.fill();
  }
  if (g.frightened && g.state !== "eaten") return;

  // 눈 (먹힌 유령은 눈만 남는다)
  const look = DIRS[g.dir] || { x: 0, y: 0 };
  for (const side of [-1, 1]) {
    const ex = x + side * r * 0.4;
    const ey = y - r * 0.2;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#22f";
    ctx.beginPath();
    ctx.arc(ex + look.x * 3, ey + look.y * 3, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMessage() {
  let text = null;
  let color = "#ffff00";
  if (game.phase === "start") text = `난이도 ${diff().label} · Enter로 시작`;
  if (game.phase === "ready") text = "READY!";
  if (game.phase === "over") {
    text = "GAME OVER  (Enter로 다시)";
    color = "#ff0000";
  }
  if (game.phase === "playing" && game.paused) text = "일시정지 (P)";
  if (!text) return;
  ctx.fillStyle = color;
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, 17.5 * TILE);
}

// ---- 입력 ----

const KEY_DIRS = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};

function startOrRestart() {
  if (game.phase === "start") setPhase("ready");
  else if (game.phase === "over") {
    newGame();
    setPhase("ready");
  }
}

window.addEventListener("keydown", (e) => {
  const dir = KEY_DIRS[e.key];
  if (dir) {
    want = dir;
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    startOrRestart();
    e.preventDefault();
  }
  if ((e.key === "p" || e.key === "P") && game.phase === "playing") game.paused = !game.paused;
  if (e.key >= "1" && e.key <= "4") setDifficulty(DIFFICULTY_KEYS[Number(e.key) - 1]);
});

// 모바일: 화면을 쓸어서 방향 입력, 탭으로 시작
let touchStart = null;
canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
    startOrRestart();
    return;
  }
  want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
});

for (const btn of document.querySelectorAll("#difficulty button")) {
  btn.addEventListener("click", () => {
    setDifficulty(btn.dataset.level);
    btn.blur();   // 버튼에 포커스가 남아 스페이스가 버튼을 누르지 않게
  });
}

// ---- 루프 ----

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);

// 테스트·디버그용
window.__pacman = { get difficulty() { return difficulty; }, get game() { return game; }, get pac() { return pac; }, get ghosts() { return ghosts; } };
