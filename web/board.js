import { Board3D } from './board3d.js';

const LABEL_CLASS = {
  "최선의 수": "eval-best",
  "좋은 수": "eval-good",
  "괜찮은 수": "eval-ok",
  "안좋은 수": "eval-bad",
};
const DIFFICULTY_LABEL = { easy: "하", medium: "중", hard: "상" };

let myPlayer = null;
let currentState = null;
let board;
let pending = false;
let processing = false;
let session = 0;
let queue = [];
let orientation = "H";

const el = (id) => document.getElementById(id);

function showTip(entry, x, y) {
  if (!entry) return;
  const tip = el("hover-tip");
  tip.className = LABEL_CLASS[entry.label];
  tip.innerHTML = "";
  const label = document.createElement("span");
  label.className = "tip-label";
  label.textContent = entry.label;
  tip.appendChild(label);
  for (const reason of entry.reasons) {
    const line = document.createElement("div");
    line.textContent = reason;
    tip.appendChild(line);
  }
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
}

function hideTip() {
  el("hover-tip").classList.add("hidden");
}

function showTrace(entry) {
  if (!entry) return;
  el("trace-content").textContent = entry.trace.join("\n");
}

function resetTrace() {
  el("trace-content").textContent = "칸이나 벽에 마우스를 올려보세요";
}

function showScreen(name) {
  ["menu", "waiting", "game"].forEach((s) => el(s).classList.toggle("hidden", s !== name));
  if (name !== "game") el("result-modal").classList.add("hidden");
}

function updateInput() {
  board?.setInteractive(!pending && !processing && currentState?.turn === myPlayer && !currentState?.winner);
}

async function consumeStates() {
  if (processing) return;
  processing = true; updateInput();
  const token = session;
  try {
    await board.ready;
    while (queue.length && token === session) {
      const state = queue.shift();
      await board.apply(state, myPlayer);
      if (token !== session) return;
      render(state);
    }
  } catch (error) {
    console.error(error);
    el('board-status').textContent = '3D 화면을 불러오지 못했습니다. 새로고침해 다시 시도하세요.';
    queue = [];
  } finally {
    if (token === session) { processing = false; updateInput(); }
  }
}

function appendChatMessage(kind, text) {
  const log = el("chat-log");
  const msg = document.createElement("div");
  msg.className = `chat-msg ${kind}`;
  msg.textContent = text;
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
}

function render(state) {
  currentState = state;
  el("chat-panel").classList.toggle("hidden", state.mode !== "pvp");
  el("algo-info").classList.toggle("hidden", state.mode !== "learn");
  el("trace-panel").classList.toggle("hidden", state.mode !== "learn");
  el("pseudocode-panel").classList.toggle("hidden", state.mode !== "learn");
  hideTip(); resetTrace();
  const turnText = state.turn === myPlayer ? "당신의 차례입니다" : "상대의 차례를 기다리는 중...";
  el("turn-indicator").textContent = state.winner ? "" : turnText;
  el("walls-left").textContent = `남은 벽 — 나: ${state.wallsLeft[myPlayer]} / 상대: ${state.wallsLeft[myPlayer === 1 ? 2 : 1]}`;
  el("difficulty-indicator").textContent =
    state.mode === "ai" || state.mode === "learn" ? `난이도: ${DIFFICULTY_LABEL[state.difficulty] || state.difficulty}` : "";

  if (state.winner) {
    const won = state.winner === myPlayer;
    el("result-text").textContent = won ? "승리했습니다!" : "패배했습니다.";
    el("result-modal").classList.remove("hidden");
  }
}

function handleCellClick(r, c) {
  if (!currentState || pending || processing || currentState.turn !== myPlayer || currentState.winner) return;
  const isLegal = currentState.legalMoves.some(([lr, lc]) => lr === r && lc === c);
  if (!isLegal) return;
  el("game-error").textContent = "";
  pending = true; updateInput();
  Net.send({ type: "move", to: [r, c] });
}

function handleWallClick(r, c, orientation) {
  if (!currentState || pending || processing || currentState.turn !== myPlayer || currentState.winner) return;
  el("game-error").textContent = "";
  pending = true; updateInput();
  Net.send({ type: "place_wall", r, c, orientation });
}

function resetToMenu() {
  session++; queue = []; pending = false; processing = false; board?.reset();
  myPlayer = null;
  currentState = null;
  el("menu-error").textContent = "";
  el("join-code").value = "";
  el("chat-log").innerHTML = "";
  hideTip();
  resetTrace();
  showScreen("menu");
}

Net.on("room_created", (msg) => {
  myPlayer = msg.player;
  if (msg.mode !== "ai" && msg.mode !== "learn") {
    el("waiting-code").textContent = msg.code;
    showScreen("waiting");
  }
});

Net.on("joined", (msg) => {
  myPlayer = msg.player;
});

Net.on("state", (msg) => {
  pending = false;
  showScreen("game");
  queue.push(msg);
  consumeStates();
});

Net.on("error", (msg) => {
  pending = false; updateInput();
  const target = el("game").classList.contains("hidden") ? "menu-error" : "game-error";
  el(target).textContent = msg.message;
});

Net.on("chat", (msg) => {
  appendChatMessage(msg.player === myPlayer ? "me" : "opponent", msg.text);
});

Net.on("opponent_left", () => {
  alert("상대가 게임을 떠났습니다.");
  resetToMenu();
});

Net.on("disconnected", () => {
  if (!el("menu").classList.contains("hidden")) return;
  alert("서버와의 연결이 끊어졌습니다.");
  resetToMenu();
});

el("btn-create").addEventListener("click", async () => {
  el("menu-error").textContent = "";
  try {
    await Net.connect();
    Net.send({ type: "create_room" });
  } catch {
    el("menu-error").textContent = "서버에 연결할 수 없습니다.";
  }
});

el("btn-join").addEventListener("click", async () => {
  const code = el("join-code").value.trim().toUpperCase();
  if (!code) return;
  el("menu-error").textContent = "";
  try {
    await Net.connect();
    Net.send({ type: "join_room", code });
  } catch {
    el("menu-error").textContent = "서버에 연결할 수 없습니다.";
  }
});

document.querySelectorAll(".btn-ai-diff").forEach((btn) => {
  btn.addEventListener("click", async () => {
    el("menu-error").textContent = "";
    try {
      await Net.connect();
      Net.send({ type: "start_ai_game", difficulty: btn.dataset.difficulty });
    } catch {
      el("menu-error").textContent = "서버에 연결할 수 없습니다.";
    }
  });
});

el("btn-learn").addEventListener("click", async () => {
  el("menu-error").textContent = "";
  try {
    await Net.connect();
    Net.send({ type: "start_learn_game" });
  } catch {
    el("menu-error").textContent = "서버에 연결할 수 없습니다.";
  }
});

el("btn-restart").addEventListener("click", () => {
  location.reload();
});

function sendChat() {
  const input = el("chat-input");
  const text = input.value.trim();
  if (!text) return;
  Net.send({ type: "chat", text });
  input.value = "";
}

el("chat-send").addEventListener("click", sendChat);
el("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

showScreen("menu");

function setMode(mode) {
  board.setMode(mode, orientation);
  el('mode-move').setAttribute('aria-pressed', mode === 'move');
  el('mode-wall').setAttribute('aria-pressed', mode === 'wall');
  el('rotate-wall').disabled = mode !== 'wall';
  el('board-help').textContent = mode === 'move' ? '빛나는 칸을 누르면 이동합니다. 빨강: 1P · 파랑: 2P' : '설치할 위치를 누르세요. R 또는 방향 버튼으로 회전합니다. 설치 가능 여부는 서버가 확인합니다.';
}
function rotateWall() {
  if (board.mode !== 'wall') return;
  orientation = orientation === 'H' ? 'V' : 'H'; board.setMode('wall', orientation);
  el('rotate-wall').textContent = (orientation === 'H' ? '가로' : '세로') + ' ↔ 전환 (R)';
}
try {
  board = new Board3D(el('board-wrap'), {
    move: handleCellClick, wall: handleWallClick,
    hover: (entry, x, y) => { hideTip(); resetTrace(); if (entry) { showTip(entry, x, y); showTrace(entry); } }
  });
  board.ready.then(() => { el('board-status').textContent = '3D 준비 완료'; }).catch(error => {
    console.error(error); el('board-status').textContent = '모델을 불러오지 못했습니다. 새로고침해 다시 시도하세요.';
  });
  el('mode-move').onclick = () => setMode('move'); el('mode-wall').onclick = () => setMode('wall');
  el('rotate-wall').onclick = rotateWall;
  el('reset-camera').onclick = () => board.resetCamera();
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'r' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) rotateWall(); });
} catch (error) {
  console.error(error); el('menu-error').textContent = '3D 그래픽을 시작하지 못했습니다. WebGL을 지원하는 브라우저를 사용하세요.';
  document.querySelectorAll('#menu button').forEach(b => b.disabled = true);
}
