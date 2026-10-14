// 박스헤드 혼자 하기: 내 브라우저에서 규칙(logic.js)을 돌리고, 입력(input.js)을 받아 render.js 로 그린다.
import { DT, createGame, snapshot, step } from "./logic.js";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";

const $ = (sel) => document.querySelector(sel);
const BEST_KEY = "boxhead-best";
const board = $("#board");
const renderer = createRenderer(board);
const input = createInput({ board, onPause: () => togglePause() });

let game = null;
let mode = "ready";                  // ready → play ↔ pause → over
let acc = 0;
let last = performance.now();
let best = readNum(BEST_KEY);

function readNum(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

// 창 띄우기 (순위표는 withBoard 일 때)
function showPanel(title, text, button, withBoard = false) {
  $("#panel-title").textContent = title;
  $("#panel-text").textContent = text;
  $("#panel-btn").textContent = button;
  $("#panel").classList.remove("hidden");
  $("#lb").replaceChildren();
  if (withBoard) window.Leaderboard?.mount($("#lb"), "boxhead", { unit: "점" });
  $("#touch").classList.remove("on");
}

// 새 판
function start() {
  window.Leaderboard?.begin("boxhead");                                   // 순위 입장권
  game = createGame(Date.now() >>> 0, [{ id: "me", name: "나" }]);
  renderer.clear();
  input.reset();
  acc = 0;
  mode = "play";
  $("#panel").classList.add("hidden");
  $("#touch").classList.add("on");
}

// 멈춤·계속
function togglePause() {
  if (mode === "play") {
    mode = "pause";
    showPanel("멈춤", "Esc 를 다시 누르거나 버튼으로 계속해요.", "계속하기");
  } else if (mode === "pause") {
    mode = "play";
    last = performance.now();
    $("#panel").classList.add("hidden");
    $("#touch").classList.add("on");
  }
}

// 판 끝: 기록 저장과 순위
function gameOver(e) {
  mode = "over";
  const isBest = e.score > best;
  best = Math.max(best, e.score);
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {}
  const posted = window.Leaderboard?.submit("boxhead", e.score);
  setTimeout(async () => {
    if (mode !== "over") return;
    showPanel(isBest ? "🏆 최고 기록!" : "쓰러졌어요", `${e.score.toLocaleString()}점 · 레벨 ${e.level} · 처치 ${e.kills}\n최고 ${best.toLocaleString()}점`, "다시 하기");
    if (posted) window.Leaderboard.mount($("#lb"), "boxhead", { unit: "점", result: await posted });
  }, 1000);
}

$("#panel-btn").addEventListener("click", () => (mode === "pause" ? togglePause() : start()));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "play") togglePause();
});
window.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && (mode === "ready" || mode === "over") && !$("#panel").classList.contains("hidden")) {
    e.preventDefault();
    start();
  }
});

// 시작 전 화면용 (빈 아레나)
const idle = createGame(7, [{ id: "me", name: "나" }]);
showPanel("박스헤드", "몰려오는 좀비를 총으로 막아요.\n레벨을 깰 때마다 악마가 나오고, 연속으로 잡을수록 점수 배율이 올라요.", "시작하기", true);

// 매 프레임: 규칙을 1/60초씩 흘리고 그리기
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    const mouse = mode === "play" ? input.mouse() : null;                 // 마우스 조준 중이면 { x, y }
    board.style.cursor = mouse ? "none" : "crosshair";
    if (game && mode === "play") {
      acc += dt;
      const read = input.read();
      if (mouse) read.aim = renderer.aimAngle(mouse.x, mouse.y);
      let first = true;
      while (acc >= DT && !game.over) {
        acc -= DT;
        step(game, DT, { me: first ? read : { ...read, weapon: undefined } });
        first = false;
        input.setCurrent(game.players[0].weapon);
      }
      const snap = snapshot(game);
      renderer.push(snap);
      const over = snap.ev.find((e) => e.type === "over");
      if (over) gameOver(over);
    } else if (!game) {
      renderer.push(snapshot(idle));
    }
    renderer.draw({ localId: "me", names: {}, cursor: mouse });
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__boxhead = {
  get game() { return game; },
  get mode() { return mode; },
  start,
};
