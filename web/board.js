const CELL = 50;
const GAP = 14;
const BOARD_PX = 9 * CELL + 8 * GAP;

const EVAL_CLASSES = ["eval-best", "eval-good", "eval-ok", "eval-bad"];
const LABEL_CLASS = {
  "최선의 수": "eval-best",
  "좋은 수": "eval-good",
  "괜찮은 수": "eval-ok",
  "안좋은 수": "eval-bad",
};
const DIFFICULTY_LABEL = { easy: "하", medium: "중", hard: "상" };

let myPlayer = null;
let currentState = null;
let cellEls = [];
let hWallEls = [];
let vWallEls = [];
let pawnEls = {};
let moveAnalysis = new Map();
let wallAnalysis = new Map();

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

function attachHoverAnalysis(node, getEntry) {
  node.addEventListener("mouseenter", (e) => {
    if (!currentState || currentState.turn !== myPlayer) return;
    const entry = getEntry();
    showTip(entry, e.clientX, e.clientY);
    showTrace(entry);
  });
  node.addEventListener("mousemove", (e) => {
    const tip = el("hover-tip");
    if (tip.classList.contains("hidden")) return;
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  node.addEventListener("mouseleave", () => {
    hideTip();
    resetTrace();
  });
}

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
      attachHoverAnalysis(cell, () => moveAnalysis.get(`${r},${c}`));
      wrap.appendChild(cell);
      cellEls[r].push(cell);
    }
  }

  for (let r = 0; r < 8; r++) {
    hWallEls.push([]);
    vWallEls.push([]);
    for (let c = 0; c < 8; c++) {
      const h = document.createElement("div");
      h.className = "wall-slot h-wall";
      h.style.left = `${c * (CELL + GAP)}px`;
      h.style.top = `${r * (CELL + GAP) + CELL}px`;
      h.style.width = `${2 * CELL + GAP}px`;
      h.style.height = `${GAP}px`;
      h.appendChild(makeWallTexture());
      h.addEventListener("click", () => handleWallClick(r, c, "H"));
      attachHoverAnalysis(h, () => wallAnalysis.get(`${r},${c},H`));
      wrap.appendChild(h);
      hWallEls[r].push(h);

      const v = document.createElement("div");
      v.className = "wall-slot v-wall";
      v.style.left = `${c * (CELL + GAP) + CELL}px`;
      v.style.top = `${r * (CELL + GAP)}px`;
      v.style.width = `${GAP}px`;
      v.style.height = `${2 * CELL + GAP}px`;
      v.appendChild(makeWallTexture());
      v.addEventListener("click", () => handleWallClick(r, c, "V"));
      attachHoverAnalysis(v, () => wallAnalysis.get(`${r},${c},V`));
      wrap.appendChild(v);
      vWallEls[r].push(v);
    }
  }

  pawnEls = {};
  for (const p of [1, 2]) {
    const pawn = document.createElement("div");
    pawn.className = `pawn p${p}`;
    pawn.style.width = `${CELL * 0.8}px`;
    pawn.style.height = `${CELL * 0.8}px`;
    wrap.appendChild(pawn);
    pawnEls[p] = pawn;
  }

  const coordLabels = document.createElement("div");
  coordLabels.id = "coord-labels";
  coordLabels.classList.add("hidden");
  for (let c = 0; c < 9; c++) {
    const lbl = document.createElement("div");
    lbl.className = "coord-label col-label";
    lbl.textContent = c;
    lbl.style.left = `${c * (CELL + GAP) + CELL / 2}px`;
    coordLabels.appendChild(lbl);
  }
  for (let r = 0; r < 9; r++) {
    const lbl = document.createElement("div");
    lbl.className = "coord-label row-label";
    lbl.textContent = r;
    lbl.style.top = `${r * (CELL + GAP) + CELL / 2}px`;
    coordLabels.appendChild(lbl);
  }
  wrap.appendChild(coordLabels);
}

function makeWallTexture() {
  const tex = document.createElement("div");
  tex.className = "wall-texture";
  tex.style.width = `${2 * CELL + GAP}px`;
  tex.style.height = `${GAP}px`;
  return tex;
}

function positionPawn(p, r, c) {
  const pawn = pawnEls[p];
  const size = CELL * 0.8;
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
  el("chat-panel").classList.toggle("hidden", state.mode !== "pvp");
  el("algo-info").classList.toggle("hidden", state.mode !== "learn");
  el("trace-panel").classList.toggle("hidden", state.mode !== "learn");
  el("pseudocode-panel").classList.toggle("hidden", state.mode !== "learn");
  el("coord-labels").classList.toggle("hidden", state.mode !== "learn");
  if (state.mode !== "learn" || state.turn !== myPlayer) {
    hideTip();
    resetTrace();
  }

  for (const p of [1, 2]) {
    const [r, c] = state.pawns[String(p)];
    positionPawn(p, r, c);
  }

  moveAnalysis = new Map();
  wallAnalysis = new Map();

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) cellEls[r][c].classList.remove("movable", ...EVAL_CLASSES);
  }
  if (state.turn === myPlayer) {
    for (const [r, c] of state.legalMoves) cellEls[r][c].classList.add("movable");
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      hWallEls[r][c].classList.remove("placed", ...EVAL_CLASSES);
      vWallEls[r][c].classList.remove("placed", ...EVAL_CLASSES);
    }
  }
  for (const w of state.walls) {
    const target = w.orientation === "H" ? hWallEls[w.r][w.c] : vWallEls[w.r][w.c];
    target.classList.add("placed");
  }

  for (const entry of state.analysis || []) {
    const cls = LABEL_CLASS[entry.label];
    if (entry.kind === "move") {
      moveAnalysis.set(`${entry.to[0]},${entry.to[1]}`, entry);
      cellEls[entry.to[0]][entry.to[1]].classList.add(cls);
    } else {
      wallAnalysis.set(`${entry.r},${entry.c},${entry.orientation}`, entry);
      const target = entry.orientation === "H" ? hWallEls[entry.r][entry.c] : vWallEls[entry.r][entry.c];
      target.classList.add(cls);
    }
  }

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
