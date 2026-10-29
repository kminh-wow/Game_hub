"use strict";

// 고스톱 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고,
// 여기서는 위에서 본 판(상대 자리, 바닥, 더미, 내 패, 먹은 패)을 그리고 카드 내기·고르기·고스톱·판 결과를 띄운다.

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n || 0).toLocaleString();
const KINDS = {
  1: ["gwang", "hong", "pi", "pi"], 2: ["yeol", "hong", "pi", "pi"], 3: ["gwang", "hong", "pi", "pi"],
  4: ["yeol", "cho", "pi", "pi"], 5: ["yeol", "cho", "pi", "pi"], 6: ["yeol", "cheong", "pi", "pi"],
  7: ["yeol", "cho", "pi", "pi"], 8: ["gwang", "yeol", "pi", "pi"], 9: ["yeol", "cheong", "pi", "pi"],
  10: ["yeol", "cheong", "pi", "pi"], 11: ["gwang", "ssangpi", "pi", "pi"], 12: ["gwang", "yeol", "tti", "ssangpi"],
};
const GROUPS = [["광", ["gwang"]], ["열끗", ["yeol"]], ["띠", ["hong", "cheong", "cho", "tti"]], ["피", ["pi", "ssangpi"]]];

const month = (c) => Number(c.slice(0, -1));
const kindOf = (c) => KINDS[month(c)]["abcd".indexOf(c.slice(-1))];

let deadline = 0;
let lastSeq = -1;
let lastTurn = null;
let floorBefore = new Set();
let picking = null;             // 고르는 중인 카드 (바닥 두 장 중 고르기·흔들기·폭탄)

const lobby = GameLobby.init({
  storageKey: "gostop",
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
      const title = meAt === 0 ? "🏆 내가 1등!" : meAt > 0 ? `${meAt + 1}등` : msg.winner ? `🏆 ${msg.winner.name} 1등!` : "게임 끝";
      lobby.logSystem(`게임 끝 · ${msg.rounds}판`);
      lobby.showResult(title, ranking.map((p, i) => [`${i + 1}등`, `${p.name}${lobby.isMe(p.id) ? " (나)" : ""} · ${fmt(p.score)}칩`]));
      $("#result-title").className = meAt === 0 ? "win" : meAt > 0 ? "lose" : "";
    },
  },
  renderGame,
  playerRight: (p, room) => {
    const seat = lobby.state.game?.players?.find((s) => s.id === p.id);
    if (room.playing && seat) return `${fmt(seat.chips)} 칩`;
    return `${room.wins?.[p.id] || 0}번 1등`;
  },
  isTurn: (p, room) => room.playing && lobby.state.game?.turn_id === p.id,
  canStart: (room, others) => others.every((p) => p.ready),
  waitingNote(room, amHost, others) {
    const ai = Math.max(0, room.settings.size - room.players.length);
    const aiText = ai ? ` 모자란 ${ai}자리는 AI가 채워요.` : "";
    if (amHost) return (others.length && !others.every((p) => p.ready) ? "모두 준비하면 시작할 수 있어요." : "시작할 수 있어요.") + aiText;
    return "방장이 게임을 시작할 때까지 기다려 주세요." + aiText;
  },
});

// ---------- 카드 ----------

// 같은 월·같은 종류 중 몇 번째 카드인지 (피 두 장 그림 구분)
function kindNo(code) {
  const at = "abcd".indexOf(code.slice(-1));
  return [..."abcd".slice(0, at)].filter((l) => kindOf(month(code) + l) === kindOf(code)).length;
}

function cardEl(code, cls = "") {
  const el = document.createElement("div");
  el.className = `card ${cls}`.trim();
  el.innerHTML = code ? Hwatu.svg(month(code), kindOf(code), kindNo(code)) : Hwatu.back();
  if (code) el.dataset.card = code;
  return el;
}

// 먹은 패를 광·열끗·띠·피로 묶어서
function capturedEl(cards, box) {
  const el = lobby.el;
  box.replaceChildren(...GROUPS.map(([name, kinds]) => {
    const list = cards.filter((c) => kinds.includes(kindOf(c)));
    if (!list.length) return "";
    const pi = name === "피" ? list.reduce((a, c) => a + (kindOf(c) === "ssangpi" ? 2 : 1), 0) : list.length;
    return el("div", { className: "cap-group", title: name }, ...list.map((c) => cardEl(c)), el("span", { className: "n", textContent: `${name} ${pi}` }));
  }).filter(Boolean));
}

// ---------- 그리기 ----------

function renderGame(g, room) {
  const meSeat = g.players.find((p) => lobby.isMe(p.id));
  renderOpponents(g, meSeat);
  renderFloor(g);
  renderMine(g, room, meSeat);
  renderBanner(g);
  renderPrompt(g, room, meSeat);
  renderResult(g);
  const limit = g.max_rounds ? ` / ${g.max_rounds}` : "";
  const mode = g.players.length === 2 ? "맞고" : "고스톱";
  $("#table-info").textContent = `${mode} · ${g.round_no}${limit}번째 판 · ${g.threshold}점부터 · 점당 ${fmt(g.point_value)}${g.nagari > 1 ? ` · 나가리 ×${g.nagari}` : ""}`;
}

// 상대 자리 (내 다음 사람부터)
function renderOpponents(g, meSeat) {
  const el = lobby.el;
  const at = Math.max(0, g.players.findIndex((p) => p === meSeat));
  const others = meSeat ? g.players.slice(at + 1).concat(g.players.slice(0, at)) : g.players;
  $("#opponents").replaceChildren(...others.map((p) => {
    const hand = el("div", { className: "opp-hand" });
    for (let i = 0; i < p.hand_count; i++) hand.append(cardEl(null));
    const cap = el("div", { className: "captured" });
    capturedEl(p.captured, cap);
    const tags = [p.bot && "AI", p.gos && `${p.gos}고`, p.shakes && `흔들기 ${p.shakes}`, p.bombs && `폭탄 ${p.bombs}`, p.ppeok && `뻑 ${p.ppeok}`, p.away && "자리 비움"].filter(Boolean).join(" · ");
    return el("div", { className: `opp ${g.turn_id === p.id ? "turn" : ""}` },
      el("div", { className: "opp-head" }, el("b", { textContent: p.name }), el("span", { className: "ch", textContent: `${fmt(p.chips)}칩` }),
        tags ? el("small", { textContent: tags }) : "", el("span", { className: "sc", textContent: `${p.score}점` })),
      hand, cap);
  }));
}

// 바닥 (같은 월끼리 겹쳐서) + 더미
function renderFloor(g) {
  const el = lobby.el;
  const groups = new Map();
  for (const c of g.floor) {
    if (!groups.has(month(c))) groups.set(month(c), []);
    groups.get(month(c)).push(c);
  }
  const matchMonths = picking ? new Set([month(picking.card)]) : new Set();
  const now = new Set(g.floor);
  $("#floor").replaceChildren(...[...groups.entries()].sort((a, b) => a[0] - b[0]).map(([m, cards]) => {
    const st = el("div", { className: `stack ${matchMonths.has(m) && picking?.choose ? "match" : ""}` });
    for (const c of cards) {
      const ce = cardEl(c, floorBefore.has(c) ? "" : "fresh");
      if (picking?.choose && month(c) === month(picking.card)) ce.onclick = () => send(picking.card, { target: c, shake: picking.shake });
      st.append(ce);
    }
    return st;
  }));
  floorBefore = now;
  $("#pile-card").innerHTML = g.pile ? Hwatu.back() : "";
  $("#pile-count").textContent = g.pile ? `더미 ${g.pile}` : "";
}

// 내 패·먹은 패·상태
let opts = null;
function renderMine(g, room, me) {
  $("#my-area").classList.toggle("hidden", !me);
  if (!me) return;
  opts = room.playing && g.options?.cards && g.turn_id === me.id && g.phase === "play" ? g.options : null;
  capturedEl(me.captured, $("#my-captured"));
  const hand = $("#my-hand");
  hand.classList.toggle("off", !opts);
  hand.replaceChildren(...(me.hand || []).map((c) => {
    const o = opts?.cards?.[c];
    const tag = o?.bomb ? "폭탄" : o?.shake ? "흔들기" : "";
    const ce = cardEl(c, [o?.matches?.length && "can", tag && "special"].filter(Boolean).join(" "));
    if (tag) ce.dataset.tag = tag;
    ce.onclick = () => clickHand(c);
    return ce;
  }));
  const tags = [me.gos && `${me.gos}고`, me.shakes && `흔들기 ${me.shakes}`, me.bombs && `폭탄 ${me.bombs}`].filter(Boolean).join(" · ");
  let status = `${me.score}점 · ${fmt(me.chips)}칩${tags ? ` · ${tags}` : ""}`;
  if (room.playing && g.turn_id === me.id && g.phase === "play") status = `내 차례! 낼 카드를 고르세요 · ${status}`;
  $("#my-status").textContent = status;
}

// 크게 뜨는 알림 (차례가 바뀔 때마다 한 번)
let bannerTimer = null;
function renderBanner(g) {
  if (g.seq === lastSeq) return;
  lastSeq = g.seq;
  const ev = g.last?.events || [];
  if (!ev.length) return;
  const b = $("#banner");
  b.textContent = `${g.last.name}: ${ev.join(" · ")}!`;
  b.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove("on"), 1600);
}

// 고르기 창: 바닥 두 장 중 고르기·흔들기·폭탄, 그리고 고·스톱
function renderPrompt(g, room, me) {
  const box = $("#prompt");
  const el = lobby.el;
  if (room.playing && me && g.turn_id === me.id && g.phase === "gostop" && g.options?.gostop) {
    const { score, gos } = g.options.gostop;
    $("#prompt-text").textContent = `${score}점 났어요! ${gos ? `(지금 ${gos}고) ` : ""}고 할까요?`;
    $("#prompt-buttons").replaceChildren(
      el("button", { className: "go", textContent: `${gos + 1}고!`, onclick: () => lobby.send("gostop", { go: true }) }),
      el("button", { className: "stop", textContent: "스톱", onclick: () => lobby.send("gostop", { go: false }) }));
    box.classList.remove("hidden");
    return;
  }
  if (picking && opts) {
    const p = picking;
    if (p.ask === "special") {
      $("#prompt-text").textContent = p.bomb ? `${month(p.card)}월 세 장으로 폭탄할까요? (4장 먹고 피 뺏기, 점수 ×2)` : `${month(p.card)}월 세 장으로 흔들까요? (점수 ×2)`;
      $("#prompt-buttons").replaceChildren(
        el("button", { className: "go", textContent: p.bomb ? "폭탄!" : "흔들기!", onclick: () => decideSpecial(true) }),
        el("button", { className: "ghost", textContent: "그냥 내기", onclick: () => decideSpecial(false) }),
        el("button", { className: "ghost", textContent: "취소", onclick: cancelPick }));
    } else {
      $("#prompt-text").textContent = "바닥의 두 장 중 먹을 카드를 고르세요";
      $("#prompt-buttons").replaceChildren(
        ...opts.cards[p.card].matches.map((c) => {
          const ce = cardEl(c);
          ce.onclick = () => send(p.card, { target: c, shake: p.shake });
          return ce;
        }),
        el("button", { className: "ghost", textContent: "취소", onclick: cancelPick }));
    }
    box.classList.remove("hidden");
    return;
  }
  box.classList.add("hidden");
}

// 판 결과
let closedRound = 0;
function renderResult(g) {
  const box = $("#round-result");
  const r = g.result;
  if (!r || closedRound === g.round_no) {
    box.classList.add("hidden");
    return;
  }
  const el = lobby.el;
  if (r.type === "nagari") {
    $("#rr-title").textContent = `${g.round_no}번째 판 · 나가리`;
    $("#rr-body").replaceChildren(el("p", { textContent: `아무도 못 났어요. 다음 판은 ×${r.nagari}!` }));
  } else {
    const mine = lobby.isMe(r.winner_id);
    $("#rr-title").textContent = `${g.round_no}번째 판 · 🏆 ${r.name}${mine ? " (나)" : ""} 승리`;
    const parts = r.chongtong ? [`총통 (${r.chongtong}월 네 장) ${r.score}점`] : Object.entries(r.parts).map(([k, v]) => `${k} ${v}점`);
    const mults = [r.gos && `${r.gos}고 → ${r.points}점`, r.shakes && `흔들기 ×${2 ** r.shakes}`, r.bombs && `폭탄 ×${2 ** r.bombs}`, r.nagari > 1 && `나가리 ×${r.nagari}`].filter(Boolean);
    $("#rr-body").replaceChildren(el("div", { className: "rr-body-win" },
      el("div", { className: "rr-parts" }, ...parts.map((t) => el("span", { textContent: t }))),
      mults.length ? el("div", { textContent: mults.join(" · ") }) : "",
      el("div", { textContent: `점수 ${r.points}점 × 배수 ${r.mult} × 점당 ${fmt(g.point_value)}칩` }),
      ...r.pays.map((p) => el("div", { className: "rr-pay" },
        el("span", {}, `${p.name}${lobby.isMe(p.id) ? " (나)" : ""} `, p.baks.length ? el("small", { textContent: p.baks.join(" · ") }) : ""),
        el("em", { textContent: `-${fmt(p.amount)}` }))),
      el("div", { className: "rr-pay" }, el("b", { textContent: r.name }), el("b", { textContent: `+${fmt(r.won)}` }))));
  }
  box.classList.remove("hidden");
}

// ---------- 입력 ----------

function send(card, extra = {}) {
  picking = null;
  lobby.send("play", { card, ...extra });
}

function clickHand(card) {
  if (!opts) return;
  const o = opts.cards[card];
  if (o.bomb || o.shake) {
    picking = { card, ask: "special", bomb: o.bomb, shake: false, choose: o.choose };
  } else if (o.choose) {
    picking = { card, ask: "target", choose: true, shake: false };
  } else {
    send(card);
    return;
  }
  lobby.render();
}

function decideSpecial(yes) {
  const p = picking;
  if (p.bomb) {
    if (yes) return send(p.card, { bomb: true });
  } else if (yes) {
    p.shake = true;
  }
  if (p.choose) {
    picking = { card: p.card, ask: "target", choose: true, shake: p.shake };
    lobby.render();
  } else send(p.card, { shake: p.shake });
}

function cancelPick() {
  picking = null;
  lobby.render();
}

$("#rr-close").onclick = () => {
  closedRound = lobby.state.game?.round_no || 0;
  $("#round-result").classList.add("hidden");
};

// ---------- 타이머 ----------

function tick() {
  const g = lobby.state.game;
  const left = Math.max(0, deadline - performance.now());
  const total = g?.time_total_ms || 0;
  const mine = g && lobby.isMe(g.turn_id);
  const on = g && lobby.state.room?.playing && mine && total && g.time_left_ms !== 0;
  const pct = on ? (left / total) * 100 : 0;
  const bar = $("#time-bar");
  bar.style.width = `${pct}%`;
  bar.classList.toggle("low", !!on && left < 5000);
  $("#time-sec").textContent = on ? `${Math.ceil(left / 1000)}초` : "";
  if (picking && !(g && lobby.state.room?.playing && mine && g.phase === "play")) picking = null;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
Hwatu.preload();
