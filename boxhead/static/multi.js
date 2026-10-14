// 박스헤드 같이 하기. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡는다.
// 방장의 브라우저가 규칙(logic.js)을 돌리고 20번/초 화면 값을 보내며, 나머지는 입력을 방장에게 보내고 받은 값을 그린다.
import { DT, createGame, removePlayer, snapshot, step } from "./logic.js";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";

const $ = (sel) => document.querySelector(sel);
const SEND_GAP = 50;                         // 화면 값 보내는 간격(ms)
const INPUT_GAP = 100;                       // 입력이 그대로여도 다시 알리는 간격(ms)
const IDLE_INPUT = 1500;                     // 이 시간 입력이 없으면 가만히 서 있는 걸로

const board = $("#board");
const input = createInput({ board });
const guestView = createRenderer(board, { smooth: true });
const hostView = createRenderer(board);

let session = null;                          // { meta, host, sim, names, ... } (게임 중일 때)
let view = hostView;
let acc = 0;
let last = performance.now();
let lastSend = 0;
let lastInput = { text: "", at: 0 };
let pending = [];                            // 아직 못 보낸 사건
const remote = new Map();                    // 참가자 id → { input, at } (방장만)

const lobby = GameLobby.init({
  storageKey: "boxhead",
  showLastGame: true,
  handlers: {
    game(msg) {
      start(msg.game);
    },
    snap(msg) {
      if (session && !session.host) {
        view.push(msg.snap);
        const me = msg.snap.p.find((p) => p.id === lobby.state.me.id);
        if (me) input.setCurrent(me.w);
      }
    },
    input(msg) {
      if (session?.host) remote.set(msg.id, { input: msg.input, at: performance.now() });
    },
    game_over(msg) {
      showOver(msg);
    },
  },
  renderGame,
  playerRight: (p, room) => (room.playing ? "" : room.best ? `방 최고 ${room.best.toLocaleString()}` : ""),
  isTurn: () => false,
  waitingNote(room, amHost, others) {
    if (others.length === 0) return "2명 이상 모여야 시작할 수 있어요. 혼자 하려면 위의 '혼자 하기'로 가세요.";
    if (amHost) return others.every((p) => p.ready) ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

// 새 판 시작 (방장이면 계산을 시작함)
function start(meta) {
  const host = lobby.isMe(meta.host_id);
  const names = Object.fromEntries(meta.players.map((p) => [p.id, p.name]));
  session = { meta, host, names, playing: meta.players.some((p) => lobby.isMe(p.id)), sim: null, reported: false };
  view = host ? hostView : guestView;
  view.clear();
  input.reset();
  pending = [];
  remote.clear();
  acc = 0;
  last = performance.now();
  if (host) session.sim = createGame(meta.seed, meta.players, { difficulty: meta.difficulty });
  lobby.setGame(meta);
  $("#result-modal").classList.add("hidden");
}

// 방 정보 줄
function renderGame(game, room) {
  $("#coop-info").textContent = `${room.players.length}명 협동${room.best ? ` · 방 최고 ${room.best.toLocaleString()}점` : ""}${session?.host ? " · 내 화면에서 계산 중" : ""}`;
}

// 결과 창
function showOver(msg) {
  if (session) session.sim = null;
  const names = msg.players?.map((p) => p.name).join(", ") || "";
  const rows = [
    ["점수", msg.score.toLocaleString()],
    ["도달 레벨", String(msg.level)],
    ["처치", String(msg.kills)],
    ["버틴 시간", `${Math.floor(msg.time / 60)}분 ${msg.time % 60}초`],
  ];
  if (names) rows.push(["함께한 사람", names]);
  if (msg.reason === "host_left") {
    lobby.showResult("방장이 나가서 끝났어요", rows.slice(0, 1).concat([["이유", "방장이 나감"]]));
    $("#result-title").className = "lose";
  } else {
    lobby.showResult("쓰러졌어요", rows);
    $("#result-title").className = "";
  }
  lobby.logSystem(`게임 끝 · ${msg.score.toLocaleString()}점 · 레벨 ${msg.level}`);
}

// 방장: 규칙을 흘리고 화면 값을 보냄
function hostTick(dtSec, now) {
  const sim = session.sim;
  const myId = lobby.state.me.id;
  acc += dtSec;
  const mine = input.read();
  const mouse = input.mouse();
  if (mouse) mine.aim = hostView.aimAngle(mouse.x, mouse.y);
  const inputs = { [myId]: mine };
  for (const [id, r] of remote) inputs[id] = now - r.at > IDLE_INPUT ? {} : { ...r.input };
  let first = true;
  while (acc >= DT && !sim.over) {
    acc -= DT;
    const frameInputs = {};
    for (const id of Object.keys(inputs)) frameInputs[id] = first ? inputs[id] : { ...inputs[id], weapon: undefined };
    first = false;
    step(sim, DT, frameInputs);
  }
  for (const r of remote.values()) if (r.input) r.input.weapon = undefined;
  const me = sim.players.find((p) => p.id === myId);
  if (me) input.setCurrent(me.weapon);
  // 나간 사람 정리
  const here = new Set(lobby.state.room?.players.map((p) => p.id));
  for (const p of sim.players) if (!p.gone && !here.has(p.id)) removePlayer(sim, p.id);
  const snap = snapshot(sim);
  pending.push(...snap.ev);
  hostView.push(snap);
  const over = snap.ev.find((e) => e.type === "over");
  if (over || now - lastSend >= SEND_GAP) {
    lastSend = now;
    lobby.send("snap", { snap: { ...snap, ev: pending } });
    pending = [];
  }
  if (over && !session.reported) {
    session.reported = true;
    lobby.send("over", { result: { score: over.score, level: over.level, kills: over.kills, time: Math.floor(over.time) } });
  }
}

// 참가자: 입력을 방장에게 보냄 (바뀌었거나 일정 시간마다)
function guestTick(now) {
  if (!session.playing) return;
  const cur = input.read();
  const mouse = input.mouse();
  if (mouse) cur.aim = Math.round(view.aimAngle(mouse.x, mouse.y) * 30) / 30;       // 마우스 조준 (잘게 바뀌어도 너무 자주 안 보내려고 반올림)
  const text = JSON.stringify([cur.dx, cur.dy, cur.fire, cur.lock, cur.aim]);
  if (cur.weapon !== undefined || (text !== lastInput.text && now - lastInput.at > 33) || now - lastInput.at > INPUT_GAP) {
    lastInput = { text, at: now };
    lobby.send("input", { input: cur });
  }
}

// 매 프레임
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    const playing = !!lobby.state.room?.playing && session;
    $("#touch").classList.toggle("on", !!playing && session.playing);
    if (playing) {
      if (session.host && session.sim && !session.sim.over) hostTick(dt, now);
      else if (!session.host) guestTick(now);
    }
    const mouse = playing && session.playing ? input.mouse() : null;
    board.style.cursor = mouse ? "none" : "crosshair";
    view.draw({ localId: lobby.state.me?.id, names: session?.names || {}, cursor: mouse });
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__boxhead = {
  get session() { return session; },
};
