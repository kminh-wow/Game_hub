// 홀덤 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고,
// 여기서는 3D 테이블(table3d.js) 위에 이름표·베팅 칩 금액·조작 버튼·족보를 얹는다.
import { createTable } from "./table3d.js?v=1";

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n || 0).toLocaleString();
const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const HANDS_KEY = "holdem-hands-open";

// 족보 (센 것부터, 예시 카드)
const HANDS = [
  ["로열 플러시", "같은 무늬 10·J·Q·K·A", "Ts Js Qs Ks As"],
  ["스트레이트 플러시", "같은 무늬로 숫자 5장 연속", "5h 6h 7h 8h 9h"],
  ["포카드", "같은 숫자 4장", "9s 9h 9d 9c Kd"],
  ["풀하우스", "같은 숫자 3장 + 2장", "Qs Qh Qd 4c 4s"],
  ["플러시", "같은 무늬 5장", "2d 7d 9d Jd Kd"],
  ["스트레이트", "숫자 5장 연속 (A-2-3-4-5도 됨)", "6c 7d 8s 9h Tc"],
  ["트리플", "같은 숫자 3장", "7s 7h 7d Ks 2c"],
  ["투페어", "같은 숫자 2장이 두 쌍", "Js Jd 5c 5h As"],
  ["원페어", "같은 숫자 2장", "Ah Ad 9c 6s 3d"],
  ["하이카드", "아무것도 없으면 가장 높은 카드", "Ac Jd 8s 5h 2c"],
];

let table = null;
let deadline = 0;
let lastTurn = null;

const lobby = GameLobby.init({
  storageKey: "holdem",
  showLastGame: true,
  handlers: {
    game(msg) {
      const g = msg.game;
      deadline = performance.now() + g.time_left_ms;
      if (g.turn_id && g.turn_id !== lastTurn && lobby.isMe(g.turn_id)) navigator.vibrate?.(60);
      lastTurn = g.turn_id;
      lobby.setGame(g);
    },
    game_over(msg) {
      const ranking = msg.ranking || [];
      const meAt = ranking.findIndex((p) => lobby.isMe(p.id));
      const title = meAt === 0 ? "🏆 내가 우승!" : meAt > 0 ? `${meAt + 1}위` : msg.winner ? `🏆 ${msg.winner.name} 우승!` : "게임 끝";
      lobby.logSystem(msg.winner ? `${msg.winner.name}님 우승! (${msg.hands}판)` : "게임이 끝났어요.");
      lobby.showResult(title, ranking.map((p, i) => [`${i + 1}위`, `${p.name}${lobby.isMe(p.id) ? " (나)" : ""}`]));
      $("#result-title").className = meAt === 0 ? "win" : meAt > 0 ? "lose" : "";
    },
  },
  renderGame,
  playerRight: (p, room) => {
    const seat = lobby.state.game?.seats.find((s) => s.id === p.id);
    if (room.playing && seat) return seat.out ? "탈락" : `${fmt(seat.chips)} 칩`;
    return `${room.wins?.[p.id] || 0}승`;
  },
  isTurn: (p, room) => room.playing && lobby.state.game?.turn_id === p.id,
  waitingNote(room, amHost, others) {
    if (others.length === 0) return "2명 이상 모이면 시작할 수 있어요. (AI는 없어요)";
    if (amHost) return others.every((p) => p.ready) ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

// ---------- 카드 글자 ----------

function cardChip(card) {
  const rank = card[0] === "T" ? "10" : card[0];
  return lobby.el("span", { className: `pc ${"hd".includes(card[1]) ? "red" : ""}`, textContent: rank + SUIT[card[1]] });
}

// ---------- 그리기 ----------

function myIndex(g) {
  return Math.max(0, g.seats.findIndex((s) => lobby.isMe(s.id)));
}

// 보이는 순서(내 자리부터)의 자리
function ordered(g) {
  const at = myIndex(g);
  return g.seats.map((_, k) => g.seats[(at + k) % g.seats.length]);
}

function renderGame(g, room) {
  table?.update(g, lobby.state.me?.id);
  renderLabels(g);
  renderInfo(g, room);
  renderActions(g, room);
  renderHands(g);
}

// 이름표·베팅 금액·팟 (자리는 매 프레임 table 이 옮김)
function renderLabels(g) {
  const el = lobby.el;
  const box = $("#labels");
  const nodes = [];
  ordered(g).forEach((s, k) => {
    const badges = [s.dealer && "D", s.sb && "SB", s.bb && "BB"].filter(Boolean).join(" ");
    const state = s.out ? "탈락" : s.away ? "자리 비움" : s.allin ? "올인" : "";
    const cls = ["seat-tag", g.turn_id === s.id && "turn", s.folded && "folded", s.out && "out", lobby.isMe(s.id) && "me",
      g.results?.some((r) => r.id === s.id && r.amount > 0) && "won"].filter(Boolean).join(" ");
    const tag = el("div", { className: cls },
      el("div", { className: "nm" }, el("b", { textContent: s.name }), badges ? el("i", { textContent: badges }) : ""),
      el("div", { className: "ch", textContent: `${fmt(s.chips)}` }),
      s.last || state ? el("div", { className: "la", textContent: [s.last, state].filter(Boolean).join(" · ") }) : "",
      s.cards && !lobby.isMe(s.id) ? el("div", { className: "cards" }, ...s.cards.map(cardChip)) : "",
      g.turn_id === s.id ? el("div", { className: "tbar" }, el("div", { className: "tfill" })) : "");
    tag.dataset.k = k;
    nodes.push(tag);
    if (s.bet > 0) {
      const bet = el("div", { className: "bet-tag", textContent: fmt(s.bet) });
      bet.dataset.bet = k;
      nodes.push(bet);
    }
  });
  const inBets = g.seats.reduce((a, s) => a + s.bet, 0);
  if (g.pot - inBets > 0 && !g.results?.length) {
    const pot = el("div", { className: "pot-tag", textContent: `팟 ${fmt(g.pot - inBets)}` });
    pot.dataset.pot = "1";
    nodes.push(pot);
  }
  box.replaceChildren(...nodes);
  place();
}

// 이름표를 3D 자리에 맞춰 옮기기
function place() {
  if (!table) return;
  for (const node of $("#labels").children) {
    const p = node.dataset.k !== undefined ? table.seatScreen(Number(node.dataset.k))
      : node.dataset.bet !== undefined ? table.betScreen(Number(node.dataset.bet)) : table.potScreen();
    node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
  }
}

// 위쪽 정보 (블라인드·판·결과)
function renderInfo(g, room) {
  const next = g.next_blinds ? ` · ${g.hands_to_next}판 뒤 ${fmt(g.next_blinds[0])}/${fmt(g.next_blinds[1])}` : "";
  $("#table-info").textContent = `${g.hand_no}번째 판 · ${g.street_name || ""} · 블라인드 ${fmt(g.blinds[0])}/${fmt(g.blinds[1])}${next}`;
  const msg = $("#table-msg");
  const win = (g.results || []).filter((r) => r.amount > 0);
  if (!room.playing && g.finished) {
    const w = g.seats.find((s) => s.id === g.winner_id);
    msg.textContent = w ? `🏆 ${w.name} 우승!` : "게임 끝";
  } else if (win.length) {
    msg.replaceChildren(...win.map((r) => lobby.el("div", {},
      lobby.el("b", { textContent: r.name }), ` ${r.hand ? r.hand + "(으)로 " : ""}+${fmt(r.amount)}`,
      ...(r.best ? [" ", ...r.best.map(cardChip)] : []))));
  } else msg.textContent = "";
  msg.classList.toggle("on", !!msg.textContent);
}

// 조작 버튼 (내 차례일 때만)
let opts = null;
function renderActions(g, room) {
  const me = g.me;
  opts = room.playing && me?.options ? me.options : null;
  $("#action-bar").classList.toggle("hidden", !me);
  $("#my-hand").replaceChildren();
  if (me) {
    const seat = g.seats.find((s) => lobby.isMe(s.id));
    if (seat?.cards) $("#my-hand").append(...seat.cards.map(cardChip), " ", lobby.el("b", { textContent: me.hand }));
    else $("#my-hand").textContent = seat?.out ? "탈락했어요 · 구경 중" : "";
  }
  $("#actions").classList.toggle("off", !opts);
  for (const b of $("#actions").children) b.disabled = !opts;
  if (!opts) {
    $("#raise-box").classList.add("hidden");
    $("#btn-call").textContent = "체크";
    $("#btn-raise").textContent = "레이즈";
    return;
  }
  const myBet = g.seats.find((s) => lobby.isMe(s.id))?.bet || 0;
  const callAll = opts.to_call >= opts.max_to - myBet;             // 콜하면 올인
  $("#btn-call").textContent = opts.can_check ? "체크" : `${callAll ? "올인 콜" : "콜"} ${fmt(opts.to_call)}`;
  $("#btn-raise").textContent = opts.bet_word;
  $("#btn-raise").disabled = !opts.can_raise;
  const range = $("#raise-range");
  range.min = opts.min_to;
  range.max = opts.max_to;
  range.step = Math.max(1, Math.round(g.blinds[1] / 2));
  if (!(Number(range.value) >= opts.min_to && Number(range.value) <= opts.max_to)) setRaise(opts.min_to);
}

function setRaise(value) {
  if (!opts) return;
  const v = Math.max(opts.min_to, Math.min(opts.max_to, Math.round(value)));
  $("#raise-range").value = v;
  $("#raise-num").value = v;
  $("#btn-raise-go").textContent = v >= opts.max_to ? `올인 ${fmt(v)}` : `${opts.bet_word} ${fmt(v)}`;
}

// 족보 펼치기·접기 (내 지금 족보는 강조)
function renderHands(g) {
  const panel = $("#hands-panel");
  const open = !panel.classList.contains("hidden");
  $("#btn-hands").textContent = open ? "📖 족보 접기" : "📖 족보 펼치기";
  $("#btn-hands").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const mine = g?.me?.hand;
  panel.replaceChildren(...HANDS.map(([name, desc, cards], i) => lobby.el("div", { className: `hand-row ${name === mine ? "mine" : ""}` },
    lobby.el("span", { className: "rk", textContent: String(i + 1) }),
    lobby.el("div", {}, lobby.el("b", { textContent: name }), lobby.el("small", { textContent: desc })),
    lobby.el("span", { className: "ex" }, ...cards.split(" ").map(cardChip)))));
}

function toggleHands(open) {
  $("#hands-panel").classList.toggle("hidden", !open);
  try {
    localStorage.setItem(HANDS_KEY, open ? "1" : "0");
  } catch {}
  renderHands(lobby.state.game);
}

// ---------- 입력 ----------

const act = (action, amount = 0) => {
  if (!opts) return;
  lobby.send("act", { action, amount });
  $("#raise-box").classList.add("hidden");
};
$("#btn-fold").onclick = () => {
  if (opts?.can_check && !confirm("체크할 수 있는데 폴드할까요?")) return;
  act("fold");
};
$("#btn-call").onclick = () => act(opts?.can_check ? "check" : "call");
$("#btn-raise").onclick = () => {
  const box = $("#raise-box");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) setRaise(Number($("#raise-range").value) || opts.min_to);
};
$("#raise-range").oninput = (e) => setRaise(Number(e.target.value));
$("#raise-num").onchange = (e) => setRaise(Number(e.target.value));
$("#btn-raise-go").onclick = () => {
  const v = Number($("#raise-num").value);
  act(v >= opts.max_to ? "allin" : "raise", v);
};
document.querySelector(".quick").onclick = (e) => {
  const q = e.target.dataset.q;
  const g = lobby.state.game;
  if (!q || !opts || !g) return;
  const myBet = g.seats.find((s) => lobby.isMe(s.id))?.bet || 0;
  const potAfterCall = g.pot + opts.to_call;
  const to = { min: opts.min_to, half: myBet + opts.to_call + potAfterCall / 2, pot: myBet + opts.to_call + potAfterCall, all: opts.max_to }[q];
  setRaise(to);
};
$("#btn-hands").onclick = () => toggleHands($("#hands-panel").classList.contains("hidden"));
$("#btn-view").onclick = () => {
  if (!table) return;
  const top = table.toggleView();
  $("#btn-view").textContent = top ? "🪑 내 자리에서 보기" : "🔭 위에서 보기";
};
try {
  if (localStorage.getItem(HANDS_KEY) === "1") toggleHands(true);
} catch {}

// 키보드 (F 폴드, C 체크·콜, R 레이즈 열기)
document.addEventListener("keydown", (e) => {
  if (!opts || e.target.closest("input, textarea, select")) return;
  if (e.key === "f" || e.key === "F") $("#btn-fold").click();
  else if (e.key === "c" || e.key === "C") $("#btn-call").click();
  else if ((e.key === "r" || e.key === "R") && opts.can_raise) $("#btn-raise").click();
});

// ---------- 타이머 ----------

function tick() {
  const g = lobby.state.game;
  const bar = $("#time-bar");
  const left = Math.max(0, deadline - performance.now());
  const total = g?.time_total_ms || 0;
  const on = g && lobby.state.room?.playing && g.turn_id && total;
  const pct = on ? (left / total) * 100 : 0;
  bar.style.width = `${pct}%`;
  bar.classList.toggle("low", on && left < 5000);
  $("#time-sec").textContent = on && lobby.isMe(g.turn_id) ? Math.ceil(left / 1000) : "";
  const fill = document.querySelector(".seat-tag.turn .tfill");
  if (fill) fill.style.width = `${pct}%`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- 3D 테이블 ----------

createTable($("#table-host")).then((view) => {
  table = view;
  table.onFrame(place);
  if (lobby.state.game) renderGame(lobby.state.game, lobby.state.room);
}).catch((err) => {
  console.warn("3D 테이블을 띄우지 못했어요", err);
  $("#table-msg").textContent = "이 브라우저에서는 3D 화면을 띄우지 못했어요.";
  $("#table-msg").classList.add("on");
});
