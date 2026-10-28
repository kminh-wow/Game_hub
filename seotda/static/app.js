"use strict";

// 섯다 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고,
// 여기서는 위에서 본 테이블에 자리·패·판돈을 그리고, 베팅 버튼과 판 결과를 띄운다. 화투 그림은 ../common/hwatu.js.

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n || 0).toLocaleString();
const GWANG = [1, 3, 8];
const TTI = { 1: "hong", 2: "hong", 3: "hong", 4: "cho", 5: "cho", 7: "cho", 6: "cheong", 9: "cheong", 10: "cheong" };

// 족보 (센 것부터) + 특수패
const RANKING = [
  ["38광땡", "3광 + 8광"], ["18광땡", "1광 + 8광"], ["13광땡", "1광 + 3광"], ["장땡", "10 + 10"],
  ["9땡 ~ 1땡", "같은 월 두 장"], ["알리", "1 + 2"], ["독사", "1 + 4"], ["구삥", "1 + 9"], ["장삥", "1 + 10"],
  ["장사", "4 + 10"], ["세륙", "4 + 6"], ["갑오", "끝자리 9"], ["8끗 ~ 1끗", "합의 끝자리"], ["망통", "끝자리 0"],
  ["암행어사", "4·7 열끗: 13·18광땡을 잡음"], ["땡잡이", "3광·7열끗: 1~9땡을 잡음"],
  ["구사", "4 + 9: 최고가 알리 이하면 재경기"], ["멍텅구리 구사", "4·9 열끗: 최고가 9땡 이하면 재경기"],
];

let deadline = 0;
let lastTurn = null;
const shownBefore = new Map();      // 자리 id → 지난번에 그린 카드 (애니메이션용)

const lobby = GameLobby.init({
  storageKey: "seotda",
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
      lobby.showResult(title, ranking.map((p, i) => [`${i + 1}위`, `${p.name}${lobby.isMe(p.id) ? " (나)" : ""}${p.score !== undefined ? ` · ${fmt(p.score)}칩` : ""}`]));
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
    if (others.length === 0) return "2명 이상 모이면 시작할 수 있어요.";
    if (amHost) return others.every((p) => p.ready) ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

// ---------- 카드 ----------

// 섯다 카드 "3a" → 화투 그림 (a: 광 또는 열끗, b: 띠 또는 피)
function cardSvg(code) {
  const m = Number(code.slice(0, -1));
  const kind = code.endsWith("a") ? (GWANG.includes(m) ? "gwang" : "yeol") : TTI[m] || "pi";
  return Hwatu.svg(m, kind);
}

function cardEl(code, anim = "") {
  const el = document.createElement("div");
  el.className = `card ${anim}`.trim();
  el.innerHTML = code ? cardSvg(code) : Hwatu.back();
  return el;
}

// 카드 두 장 (지난번과 비교해서 새로 받았으면 날아오고, 공개되면 뒤집힘)
function cardsFor(id, cards, count, extraClass = "") {
  const key = cards ? cards.join(",") : count ? `back${count}` : "";
  const prev = shownBefore.get(id) || "";
  shownBefore.set(id, key);
  const box = document.createElement("div");
  box.className = "cards";
  if (!key) return box;
  const anim = prev === key ? "" : prev.startsWith("back") && cards ? "flip" : "deal";
  if (cards) cards.forEach((c, i) => {
    const el = cardEl(c, anim);
    el.style.animationDelay = `${i * 0.08}s`;
    if (extraClass) el.classList.add(extraClass);
    box.append(el);
  });
  else for (let i = 0; i < count; i++) {
    const el = cardEl(null, anim);
    el.style.animationDelay = `${i * 0.08}s`;
    box.append(el);
  }
  return box;
}

// ---------- 그리기 ----------

function ordered(g) {
  const at = Math.max(0, g.seats.findIndex((s) => lobby.isMe(s.id)));
  return g.seats.map((_, k) => g.seats[(at + k) % g.seats.length]);
}

function renderGame(g, room) {
  renderTable(g, room);
  renderMine(g, room);
  renderResult(g);
  renderRanking(g);
}

// 테이블: 내 자리가 아래, 나머지는 타원을 따라
function renderTable(g, room) {
  const el = lobby.el;
  const list = ordered(g);
  const n = list.length;
  const winners = new Set((g.results || []).filter((r) => r.amount > 0).map((r) => r.id));
  $("#seats").replaceChildren(...list.map((s, k) => {
    const t = Math.PI / 2 + (k * Math.PI * 2) / n;
    const x = 50 + Math.cos(t) * 40;
    const y = 50 + Math.sin(t) * (k === 0 ? 40 : 36);
    const mine = lobby.isMe(s.id);
    const state = s.out ? "탈락" : s.away ? "자리 비움" : s.allin ? "올인" : "";
    const seat = el("div", { className: ["seat", g.turn_id === s.id && "turn", s.folded && "folded", s.out && "out", mine && "me", winners.has(s.id) && "won"].filter(Boolean).join(" ") });
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
    const cards = mine ? cardsFor(`${s.id}:mine-small`, null, 0) : cardsFor(s.id, s.cards, s.has_cards ? 2 : 0, winners.has(s.id) ? "win" : "");
    seat.append(
      cards,
      el("div", { className: "tag" },
        el("b", {}, s.name + (mine ? " (나)" : ""), s.dealer ? el("i", { textContent: "선" }) : ""),
        el("div", { className: "ch", textContent: `${fmt(s.chips)}` }),
        s.last || state ? el("div", { className: "la", textContent: [s.last, state].filter(Boolean).join(" · ") }) : "",
        g.turn_id === s.id ? el("div", { className: "tbar" }, el("div", { className: "tfill" })) : ""),
      el("div", { className: "bet", textContent: s.bet > 0 ? fmt(s.bet) : "" }));
    if (k === 0) seat.style.top = "86%";
    return seat;
  }));
  $("#pot").replaceChildren(document.createTextNode(`판돈 ${fmt(g.pot)}`), el("small", { textContent: g.current_bet ? `지금 베팅 ${fmt(g.current_bet)}` : "" }));
  $("#notice").textContent = g.notice || (!room.playing && g.finished ? `🏆 ${g.seats.find((s) => s.id === g.winner_id)?.name || ""} 우승!` : "");
  const limit = g.max_hands ? ` / ${g.max_hands}` : "";
  const next = g.next_ante ? ` · ${g.hands_to_next}판 뒤 ${fmt(g.next_ante)}` : "";
  $("#table-info").textContent = `${g.hand_no}${limit}번째 판 · 판돈 ${fmt(g.ante)}${next}`;
}

// 내 패와 버튼
let opts = null;
function renderMine(g, room) {
  const me = g.me;
  const seat = g.seats.find((s) => lobby.isMe(s.id));
  $("#my-area").classList.toggle("hidden", !seat);
  opts = room.playing && me?.options ? me.options : null;
  const won = (g.results || []).some((r) => r.id === seat?.id && r.amount > 0);
  $("#my-cards").replaceChildren(...(seat?.cards ? Array.from(cardsFor(`${seat.id}:mine`, seat.cards, 0, won ? "win" : "").children) : []));
  $("#my-name-hand").textContent = seat?.out ? "탈락했어요 · 구경 중" : me?.hand ? `내 패: ${me.hand}` : "";
  const labels = {
    die: "다이",
    call: opts ? (opts.can_check ? "체크" : opts.call_allin ? `올인 콜<small>${fmt(opts.to_call)}</small>` : `콜<small>${fmt(opts.to_call)}</small>`) : "체크",
    bbing: opts?.bbing ? `삥<small>${fmt(opts.bbing)}</small>` : "삥",
    half: opts?.half ? `하프<small>${fmt(opts.half)}</small>` : "하프",
    ddadang: opts?.ddadang ? `따당<small>${fmt(opts.ddadang)}</small>` : "따당",
    allin: opts?.can_raise ? `올인<small>${fmt(opts.max_to)}</small>` : "올인",
  };
  for (const b of $("#actions").children) {
    const act = b.dataset.act;
    b.innerHTML = labels[act];
    const ok = opts && (act === "die" || act === "call" || (act === "allin" ? opts.can_raise : opts[act] !== null && opts[act] !== undefined));
    b.disabled = !ok;
  }
  $("#actions").classList.toggle("off", !opts);
}

// 판 결과 카드
let closedHand = 0;
function renderResult(g) {
  const box = $("#round-result");
  const results = g.results || [];
  if (!results.length || closedHand === g.hand_no) {
    box.classList.add("hidden");
    return;
  }
  const el = lobby.el;
  $("#rr-title").textContent = `${g.hand_no}번째 판 결과`;
  $("#rr-rows").replaceChildren(...results.map((r) => {
    const won = r.amount > 0;
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const c of r.cards || []) cards.append(cardEl(c));
    return el("div", { className: `rr-row ${won ? "win" : "lose"}` }, cards,
      el("div", { className: "rr-who" },
        el("b", { textContent: `${won ? "🏆 " : ""}${r.name}${lobby.isMe(r.id) ? " (나)" : ""}` }),
        el("span", { className: "rr-hand", textContent: r.hand || "다른 사람이 모두 다이" })),
      won ? el("span", { className: "rr-gain", textContent: `+${fmt(r.amount)}` }) : "");
  }));
  box.classList.remove("hidden");
}

// 족보 표 (내 패 강조)
function renderRanking(g) {
  const hand = g?.me?.hand || "";
  const group = /^[1-9]땡$/.test(hand) ? "9땡 ~ 1땡" : /^[1-8]끗$/.test(hand) ? "8끗 ~ 1끗" : hand;
  $("#ranking-list").replaceChildren(...RANKING.map(([name, desc]) => lobby.el("div", { className: name === group ? "mine" : "" },
    lobby.el("b", { textContent: name }), lobby.el("small", { textContent: desc }))));
}

// ---------- 입력 ----------

$("#actions").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled || !opts) return;
  const act = b.dataset.act;
  if (act === "die" && opts.can_check && !confirm("체크할 수 있는데 다이할까요?")) return;
  lobby.send("act", { action: act === "call" && opts.can_check ? "check" : act });
});
$("#rr-close").onclick = () => {
  closedHand = lobby.state.game?.hand_no || 0;
  $("#round-result").classList.add("hidden");
};
document.addEventListener("keydown", (e) => {
  if (!opts || e.target.closest("input, textarea, select")) return;
  const map = { d: "die", c: "call", b: "bbing", h: "half", t: "ddadang" };
  const act = map[e.key.toLowerCase()];
  const btn = act && document.querySelector(`#actions [data-act="${act}"]`);
  if (btn && !btn.disabled) btn.click();
});
renderRanking(null);

// ---------- 타이머 ----------

function tick() {
  const g = lobby.state.game;
  const left = Math.max(0, deadline - performance.now());
  const total = g?.time_total_ms || 0;
  const on = g && lobby.state.room?.playing && g.turn_id && total;
  const pct = on ? (left / total) * 100 : 0;
  const bar = $("#time-bar");
  bar.style.width = `${pct}%`;
  bar.classList.toggle("low", !!on && left < 5000);
  $("#time-sec").textContent = on && lobby.isMe(g.turn_id) ? `${Math.ceil(left / 1000)}초` : "";
  const fill = document.querySelector(".seat.turn .tfill");
  if (fill) fill.style.width = `${pct}%`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
