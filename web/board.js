const CELL = 50;
const GAP = 14;
const BOARD_PX = 9 * CELL + 8 * GAP;

let myPlayer = null;
let currentState = null;
let cellEls = [];
let hWallEls = [];
let vWallEls = [];
let pawnEls = {};

const el = (id) => document.getElementById(id);

function showScreen(name) {
  ["menu", "waiting", "game"].forEach((s) => el(s).classList.toggle("hidden", s !== name));
  if (name !== "game") el("result-modal").classList.add("hidden");
}

function buildBoardSkeleton() {
  const wrap = el("board-wrap");
  wrap.style.width = `${BOARD_PX}px`;
  wrap.style.height = `${BOARD_PX}px`;
  wrap.innerHTML = "";
  cellEls = [];
  hWallEls = [];
  vWallEls = [];
  el("chat-log").innerHTML = "";

  for (let r = 0; r < 9; r++) {
    cellEls.push([]);
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.style.left = `${c * (CELL + GAP)}px`;
      cell.style.top = `${r * (CELL + GAP)}px`;
      cell.style.width = `${CELL}px`;
      cell.style.height = `${CELL}px`;
      cell.addEventListener("click", () => handleCellClick(r, c));
      wrap.appendChild(cell);
      cellEls[r].push(cell);
    }
  }

  for (let r = 0; r < 8; r++) {
    hWallEls.push([]);
    vWallEls.push([]);
    for (let c = 0; c < 8; c++) {
      const h = document.createElement("div");
      h.className = "wall-slot";
      h.style.left = `${c * (CELL + GAP)}px`;
      h.style.top = `${r * (CELL + GAP) + CELL}px`;
      h.style.width = `${2 * CELL + GAP}px`;
      h.style.height = `${GAP}px`;
      h.addEventListener("click", () => handleWallClick(r, c, "H"));
      wrap.appendChild(h);
      hWallEls[r].push(h);

      const v = document.createElement("div");
      v.className = "wall-slot";
      v.style.left = `${c * (CELL + GAP) + CELL}px`;
      v.style.top = `${r * (CELL + GAP)}px`;
      v.style.width = `${GAP}px`;
      v.style.height = `${2 * CELL + GAP}px`;
      v.addEventListener("click", () => handleWallClick(r, c, "V"));
      wrap.appendChild(v);
      vWallEls[r].push(v);
    }
  }

  pawnEls = {};
  for (const p of [1, 2]) {
    const pawn = document.createElement("div");
    pawn.className = `pawn p${p}`;
    pawn.style.width = `${CELL * 0.6}px`;
    pawn.style.height = `${CELL * 0.6}px`;
    wrap.appendChild(pawn);
    pawnEls[p] = pawn;
  }
}

function positionPawn(p, r, c) {
  const pawn = pawnEls[p];
  const size = CELL * 0.6;
  pawn.style.left = `${c * (CELL + GAP) + (CELL - size) / 2}px`;
  pawn.style.top = `${r * (CELL + GAP) + (CELL - size) / 2}px`;
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
  el("chat-panel").classList.toggle("hidden", state.mode === "ai");

  for (const p of [1, 2]) {
    const [r, c] = state.pawns[String(p)];
    positionPawn(p, r, c);
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) cellEls[r][c].classList.remove("movable");
  }
  if (state.turn === myPlayer) {
    for (const [r, c] of state.legalMoves) cellEls[r][c].classList.add("movable");
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      hWallEls[r][c].classList.remove("placed");
      vWallEls[r][c].classList.remove("placed");
    }
  }
  for (const w of state.walls) {
    const target = w.orientation === "H" ? hWallEls[w.r][w.c] : vWallEls[w.r][w.c];
    target.classList.add("placed");
  }

  const turnText = state.turn === myPlayer ? "당신의 차례입니다" : "상대의 차례를 기다리는 중...";
  el("turn-indicator").textContent = state.winner ? "" : turnText;
  el("walls-left").textContent = `남은 벽 — 나: ${state.wallsLeft[myPlayer]} / 상대: ${state.wallsLeft[myPlayer === 1 ? 2 : 1]}`;

  if (state.winner) {
    const won = state.winner === myPlayer;
    el("result-text").textContent = won ? "승리했습니다!" : "패배했습니다.";
    el("result-modal").classList.remove("hidden");
  }
}

function handleCellClick(r, c) {
  if (!currentState || currentState.turn !== myPlayer || currentState.winner) return;
  const isLegal = currentState.legalMoves.some(([lr, lc]) => lr === r && lc === c);
  if (!isLegal) return;
  el("game-error").textContent = "";
  Net.send({ type: "move", to: [r, c] });
}

function handleWallClick(r, c, orientation) {
  if (!currentState || currentState.turn !== myPlayer || currentState.winner) return;
  el("game-error").textContent = "";
  Net.send({ type: "place_wall", r, c, orientation });
}

function resetToMenu() {
  myPlayer = null;
  currentState = null;
  el("menu-error").textContent = "";
  el("join-code").value = "";
  el("chat-log").innerHTML = "";
  showScreen("menu");
}

Net.on("room_created", (msg) => {
  myPlayer = msg.player;
  if (msg.mode !== "ai") {
    el("waiting-code").textContent = msg.code;
    showScreen("waiting");
  }
});

Net.on("joined", (msg) => {
  myPlayer = msg.player;
});

Net.on("state", (msg) => {
  if (!cellEls.length) buildBoardSkeleton();
  showScreen("game");
  render(msg);
});

Net.on("error", (msg) => {
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

el("btn-ai").addEventListener("click", async () => {
  el("menu-error").textContent = "";
  try {
    await Net.connect();
    Net.send({ type: "start_ai_game" });
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
