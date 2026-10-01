"use strict";

// 오목 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고, 여기서는 판만 그린다.

const $ = (sel) => document.querySelector(sel);

const SIZE = 15;
const CELL = 34;
const PAD = 26;
const STARS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];
const REASONS = {
  five: "오목 완성",
  timeout: "시간 초과",
  resign: "기권",
  leave: "상대가 나감",
  draw: "무승부",
  abort: "중단",
};

const canvas = $("#board");
const ctx = canvas.getContext("2d");
const boardHost = canvas.parentElement;
let boardView = null;
canvas.width = canvas.height = PAD * 2 + CELL * (SIZE - 1);

let deadline = 0;
let hover = null;   // 마우스가 올라간 교차점 [x, y]

const lobby = GameLobby.init({
  storageKey: "omok",
  showLastGame: true,
  handlers: {
    game(msg) {
      deadline = performance.now() + msg.game.time_left_ms;
      lobby.setGame(msg.game);
    },
    game_over(msg) {
      const g = lobby.state.game;
      const reason = REASONS[msg.reason] || msg.reason;
      let title = "무승부";
      if (msg.winner) title = lobby.isMe(msg.winner.id) ? "승리!" : `${msg.winner.name} 승리`;
      lobby.logSystem(msg.winner ? `${msg.winner.name}님 승리 (${reason})` : `무승부 (${reason})`);
      const rows = g ? [["흑", g.black.name], ["백", g.white.name], ["결과", reason], ["수", `${g.move_count}수`]] : [["결과", reason]];
      lobby.showResult(title, rows);
    },
  },
  renderGame,
  playerRight: (p, room) => `${room.wins?.[p.id] || 0}승`,
  isTurn: (p, room) => room.playing && lobby.state.game?.current_id === p.id,
  // 혼자면 AI 와 대결하므로 상대가 없어도 시작할 수 있다.
  canStart: (room, others) => others.every((p) => p.ready),
  waitingNote(room, amHost, others) {
    if (others.length === 0) return amHost ? "혼자 시작하면 AI와 대결해요. 친구가 들어오면 1:1 대전이에요." : "";
    if (amHost) return others.every((p) => p.ready) ? "상대가 준비됐어요!" : "상대가 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

function myColor(g) {
  if (lobby.isMe(g.black.id)) return "black";
  if (lobby.isMe(g.white.id)) return "white";
  return null;
}

function isMyTurn(g) {
  return !!lobby.state.room?.playing && !g.winner_id && !!g.current_id && lobby.isMe(g.current_id);
}

function renderGame(g, room) {
  const el = lobby.el;
  const finished = !room.playing || g.reason;
  const aiWins = room.wins?.ai;

  $("#side-info").replaceChildren(
    ...[["black", "⚫ 흑", g.black], ["white", "⚪ 백", g.white]].map(([color, label, p]) =>
      el("span", {
        className: [g.turn === color && !finished && "turn", lobby.isMe(p.id) && "me"].filter(Boolean).join(" "),
        textContent: `${label} ${p.name}${lobby.isMe(p.id) ? " (나)" : ""}${p.id === "ai" && aiWins ? ` · ${aiWins}승` : ""}`,
      })
    )
  );

  let turnText = "";
  let status = "";
  let cls = "";
  if (finished) {
    const reason = REASONS[g.reason] || "";
    if (!g.winner_id) status = `무승부 · ${reason}`;
    else {
      const winnerName = g.winner_id === g.black.id ? g.black.name : g.white.name;
      status = `${lobby.isMe(g.winner_id) ? "내가" : winnerName + "님이"} 이겼어요 · ${reason}`;
      cls = lobby.isMe(g.winner_id) ? "ok" : myColor(g) ? "fail" : "";
    }
    turnText = room.playing ? "" : "지난 판";
  } else {
    turnText = isMyTurn(g) ? "내 차례!" : `${g.current_id === g.black.id ? g.black.name : g.white.name}님 차례`;
    status = `${g.move_count}수째`;
  }
  $("#turn-info").textContent = turnText;
  const s = $("#game-status");
  s.textContent = status;
  s.className = `game-status ${cls}`;

  $("#btn-resign").classList.toggle("hidden", !(room.playing && myColor(g) && !g.reason));
  $("#game-view .bar-row").classList.toggle("hidden", !!finished);
  boardHost.style.cursor = isMyTurn(g) ? "pointer" : "default";
  drawBoard(g);
}

// ---------- 그리기 (디자인은 나중에 교체) ----------

const pos = (i) => PAD + i * CELL;

function drawBoard(g) {
  if (boardView) {
    boardView.draw(g, hover, isMyTurn(g) ? myColor(g) : null);
    return;
  }
  ctx.fillStyle = "#dcb35c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#5a4520";
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(pos(0), pos(i));
    ctx.lineTo(pos(SIZE - 1), pos(i));
    ctx.moveTo(pos(i), pos(0));
    ctx.lineTo(pos(i), pos(SIZE - 1));
    ctx.stroke();
  }
  ctx.fillStyle = "#5a4520";
  for (const [x, y] of STARS) {
    ctx.beginPath();
    ctx.arc(pos(x), pos(y), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (g.board[y][x]) drawStone(x, y, g.board[y][x] === 1 ? "black" : "white");
    }
  }

  // 놓을 자리 미리 보기
  if (hover && isMyTurn(g) && !g.board[hover[1]][hover[0]]) {
    ctx.globalAlpha = 0.45;
    drawStone(hover[0], hover[1], myColor(g));
    ctx.globalAlpha = 1;
  }

  // 마지막 수 표시
  if (g.last) {
    ctx.fillStyle = "#e0474c";
    ctx.beginPath();
    ctx.arc(pos(g.last[0]), pos(g.last[1]), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 이긴 줄
  if (g.win_line) {
    const [a, b] = [g.win_line[0], g.win_line[g.win_line.length - 1]];
    ctx.strokeStyle = "rgba(224, 71, 76, 0.85)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pos(a[0]), pos(a[1]));
    ctx.lineTo(pos(b[0]), pos(b[1]));
    ctx.stroke();
  }
}

function drawStone(x, y, color) {
  const r = CELL * 0.44;
  ctx.beginPath();
  ctx.arc(pos(x), pos(y), r, 0, Math.PI * 2);
  ctx.fillStyle = color === "black" ? "#1b1b1b" : "#f7f7f2";
  ctx.fill();
  ctx.strokeStyle = color === "black" ? "#000" : "#999";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------- 입력 ----------

function cellFromEvent(e) {
  if (boardView) return boardView.cellFromEvent(e);
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = Math.round(((e.clientX - rect.left) * scale - PAD) / CELL);
  const y = Math.round(((e.clientY - rect.top) * scale - PAD) / CELL);
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? [x, y] : null;
}

boardHost.addEventListener("mousemove", (e) => {
  const cell = cellFromEvent(e);
  if (String(cell) === String(hover)) return;
  hover = cell;
  if (lobby.state.game) drawBoard(lobby.state.game);
});
boardHost.addEventListener("mouseleave", () => {
  hover = null;
  if (lobby.state.game) drawBoard(lobby.state.game);
});
boardHost.addEventListener("click", (e) => {
  const g = lobby.state.game;
  const cell = cellFromEvent(e);
  if (!g || !cell || !isMyTurn(g) || g.board[cell[1]][cell[0]]) return;
  lobby.send("place", { x: cell[0], y: cell[1] });
});

$("#btn-resign").onclick = () => {
  if (confirm("기권할까요?")) lobby.send("resign");
};

// ---------- 타이머 ----------

function tick() {
  const g = lobby.state.game;
  const bar = $("#time-bar");
  if (g && lobby.state.room?.playing && !g.reason && g.time_total_ms) {
    const left = Math.max(0, deadline - performance.now());
    bar.style.width = `${(left / g.time_total_ms) * 100}%`;
    bar.classList.toggle("low", left < 5000);
    $("#time-sec").textContent = Math.ceil(left / 1000);
  } else {
    bar.style.width = "0";
    $("#time-sec").textContent = "";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Keep the existing 2D board usable if WebGL or asset loading is unavailable.
import('./board3d.js?v=wood-stones').then(({ createBoardView }) => createBoardView(boardHost)).then((view) => {
  boardView = view;
  canvas.classList.add('hidden');
  if (lobby.state.game) drawBoard(lobby.state.game);
}).catch((error) => console.warn('3D board unavailable; using 2D board.', error));
