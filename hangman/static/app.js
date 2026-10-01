"use strict";

// 로그인·로비·대기실은 끝말잇기와 같은 구조. 게임 화면만 행맨용이다.

const $ = (sel) => document.querySelector(sel);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const state = {
  ws: null,
  me: null,
  rooms: [],
  users: [],
  room: null,
  game: null,       // 서버가 보내는 게임 상태 (hangman/app/game.py 의 state_for)
  deadline: 0,      // 이번 타이머가 끝나는 시각 (performance.now 기준)
};

// ---------- 공통 ----------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) {
    s.classList.toggle("hidden", s.id !== `screen-${name}`);
  }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2500);
}

function send(type, data = {}) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, ...data }));
  }
}

function playerName(id) {
  const p = state.room?.players.find((p) => p.id === id);
  return p ? p.name : "?";
}

const isMe = (id) => !!state.me && id === state.me.id;
const isMyGuess = () => !!state.game && state.game.phase === "guessing" && isMe(state.game.guesser_id);
const isMySet = () => !!state.game && state.game.phase === "setting" && isMe(state.game.setter_id);

function chatLog() {
  return state.room ? $("#room-chat-log") : $("#lobby-chat-log");
}

function appendLog(log, node) {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(node);
  while (log.children.length > 200) log.firstChild.remove();
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function logChat(log, name, text) {
  appendLog(log, el("li", {}, el("span", { className: "who", textContent: name }), text));
}

function logSystem(log, text, cls = "sys") {
  appendLog(log, el("li", { className: cls, textContent: text }));
}

function setStatus(text, cls = "") {
  const s = $("#game-status");
  s.textContent = text;
  s.className = `game-status ${cls}`;
}

// ---------- 연결 ----------

// 브라우저별 식별값. 같은 브라우저에서 같은 닉네임으로 다시 들어오면 예전 연결을 이어받는다.
const TOKEN = (() => {
  try {
    const saved = localStorage.getItem("hm-token");
    if (saved) return saved;
  } catch {}
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem("hm-token", token); } catch {}
  return token;
})();

const CLOSE_MESSAGES = {
  4000: "닉네임을 확인해 주세요.",
  4001: "이미 접속 중인 닉네임이에요. 다른 닉네임을 써 주세요.",
  4002: "다른 창에서 같은 닉네임으로 접속해서 연결이 끊겼어요.",
};

function connect(name) {
  const url = new URL("ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ name, token: TOKEN }).toString();
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (state.ws !== ws) return;
    Object.assign(state, { ws: null, me: null, room: null, game: null });
    show("login");
    $("#login-error").textContent = CLOSE_MESSAGES[e.code] || "서버와 연결이 끊겼어요.";
  };
}

const handlers = {
  welcome(msg) {
    state.me = msg.player;
    $("#me-name").textContent = msg.player.name;
    $("#word-count").textContent = msg.word_count.toLocaleString();
    $("#login-error").textContent = "";
    try { localStorage.setItem("hm-name", msg.player.name); } catch {}
    show("lobby");
  },

  lobby(msg) {
    state.rooms = msg.rooms;
    state.users = msg.users;
    renderLobby();
  },

  room(msg) {
    const wasInRoom = !!state.room;
    state.room = msg.room;
    if (!msg.room) {
      state.game = null;
      $("#room-chat-log").replaceChildren();
      show("lobby");
      return;
    }
    if (!msg.room.playing) state.game = null;
    if (!wasInRoom) show("room");
    renderRoom();
  },

  chat(msg) {
    const log = msg.scope === "room" ? $("#room-chat-log") : $("#lobby-chat-log");
    logChat(log, msg.from.name, msg.text);
  },

  system(msg) {
    logSystem(chatLog(), msg.text);
  },

  error(msg) {
    toast(msg.message);
  },

  game(msg) {
    const first = !state.game;
    state.game = msg.game;
    state.deadline = performance.now() + msg.game.time_left_ms;
    if (first) {
      $("#result-modal").classList.add("hidden");
      logSystem($("#room-chat-log"), "게임이 시작됐어요!");
    }
    msg.events.forEach(showEvent);
    renderRoom();
    if (isMySet()) $("#setter-form").word.focus();
  },

  game_over(msg) {
    $("#result-list").replaceChildren(
      ...msg.ranking.map((r, i) =>
        el("li", {}, el("span", { textContent: `${i + 1}. ${r.name}` }), el("b", { textContent: r.score }))
      )
    );
    $("#result-modal").classList.remove("hidden");
    logSystem($("#room-chat-log"), "게임이 끝났어요.");
  },
};

function handle(msg) {
  const fn = handlers[msg.type];
  if (fn) fn(msg);
}

/** 서버 이벤트를 상태 줄과 채팅 로그에 보여 준다. */
function showEvent(ev) {
  const log = $("#room-chat-log");
  const who = playerName(ev.player_id);
  let text = "";
  let cls = "";
  switch (ev.kind) {
    case "round_start":
      text = `${ev.round}라운드: ${playerName(ev.setter_id)}님이 출제할 차례예요.`;
      break;
    case "auto_word":
      text = `${playerName(ev.setter_id)}님이 시간 안에 단어를 못 정해서 자동으로 출제됐어요.`;
      break;
    case "word_set":
      text = `${playerName(ev.setter_id)}님이 ${ev.length}글자 단어를 냈어요.`;
      break;
    case "letter_ok":
      text = `${who}: ${ev.letter} 있어요! (${ev.count}개, +${ev.gain})`;
      cls = "ok";
      break;
    case "letter_fail":
      text = `${who}: ${ev.letter} 없어요. (${ev.strikes}번째 실수)`;
      cls = "fail";
      break;
    case "word_ok":
      text = `${who}님이 ${ev.word}를 맞혔어요! +${ev.gain}`;
      cls = "ok";
      break;
    case "word_fail":
      text = `${who}: ${ev.word} 아니에요. (${ev.strikes}번째 실수)`;
      cls = "fail";
      break;
    case "hanged":
      text = `${who}님의 교수대가 완성됐어요! -${ev.penalty} (출제자 ${playerName(ev.setter_id)}님 +${ev.setter_gain})`;
      cls = "fail";
      break;
    case "timeout":
      text = `${who}님 시간 초과`;
      break;
    case "hint":
      text = `힌트 공개: ${ev.hint}`;
      break;
    case "hint_letter":
      text = `힌트: 글자 ${ev.letter}를 열어 줬어요.`;
      break;
    case "round_end":
      text = ev.solver_id
        ? `정답은 ${ev.word}! ${playerName(ev.solver_id)}님이 맞혔어요.`
        : `모두 탈락! 정답은 ${ev.word}. 출제자 ${playerName(ev.setter_id)}님은 이번 라운드 +${ev.setter_gain}`;
      cls = ev.solver_id ? "ok" : "fail";
      break;
    case "round_cancel":
      text = `출제자 ${who}님이 나가서 이번 라운드는 취소됐어요.`;
      break;
    default:
      return;
  }
  setStatus(text, cls);
  logSystem(log, text, cls === "fail" ? "fail" : "sys");
}

// ---------- 로비 ----------

function renderLobby() {
  const list = $("#room-list");
  if (!state.rooms.length) {
    list.replaceChildren(el("li", { className: "empty", textContent: "아직 방이 없어요. 새로 만들어 보세요!" }));
  } else {
    list.replaceChildren(
      ...state.rooms.map((r) => {
        const blocked = r.playing || r.players >= r.max_players;
        const card = el(
          "li",
          { className: `room-card${blocked ? " disabled" : ""}` },
          el("div", { className: "title", textContent: `#${r.id} ${r.title}` }),
          el(
            "div",
            { className: "meta" },
            el("span", { textContent: `방장 ${r.host} · ${r.players}/${r.max_players}` }),
            el("span", { className: `badge${r.playing ? " playing" : ""}`, textContent: r.playing ? "게임 중" : "대기 중" })
          )
        );
        if (!blocked) card.onclick = () => send("join_room", { room_id: r.id });
        return card;
      })
    );
  }

  $("#user-count").textContent = state.users.length;
  $("#user-list").replaceChildren(
    ...state.users.map((u) =>
      el(
        "li",
        {},
        el("span", { textContent: u.name + (isMe(u.id) ? " (나)" : "") }),
        el("span", { className: "where", textContent: u.room_id ? `#${u.room_id}번 방` : "로비" })
      )
    )
  );
}

// ---------- 방 ----------

function renderRoom() {
  const room = state.room;
  if (!room) return;
  const amHost = room.host_id === state.me.id;
  const game = state.game;

  $("#room-title").textContent = `#${room.id} ${room.title}`;
  $("#room-info").textContent = `${room.players.length}/${room.max_players}명`;

  $("#player-list").replaceChildren(
    ...room.players.map((p) => {
      const tags = [];
      if (p.id === room.host_id) tags.push("방장");
      if (isMe(p.id)) tags.push("나");
      if (game && game.setter_id === p.id) tags.push("출제자");
      if (game && game.hanged.includes(p.id)) tags.push("탈락");
      const right = game
        ? el("span", { className: "score", textContent: game.scores[p.id] ?? 0 })
        : el("span", { className: "ready", textContent: p.id === room.host_id ? "" : p.ready ? "준비 완료" : "" });
      const current = game && (game.guesser_id === p.id || (game.phase === "setting" && game.setter_id === p.id));
      return el(
        "li",
        { className: current ? "turn" : "" },
        el("span", {}, el("span", { className: "name", textContent: p.name }), el("span", { className: "tag", textContent: tags.join(" · ") })),
        right
      );
    })
  );

  $("#waiting-view").classList.toggle("hidden", !!game);
  $("#game-view").classList.toggle("hidden", !game);
  if (game) renderGame(game);
  else renderWaiting(room, amHost);
}

function renderWaiting(room, amHost) {
  const form = $("#settings-form");
  form.classList.toggle("editable", amHost);
  const values = { ...room.settings, max_players: room.max_players };
  for (const input of form.elements) {
    input.disabled = !amHost;
    if (document.activeElement !== input) input.value = values[input.name];
  }

  const btn = $("#btn-ready");
  const others = room.players.filter((p) => p.id !== room.host_id);
  if (amHost) {
    const canStart = others.length >= 1 && others.every((p) => p.ready);
    btn.textContent = "게임 시작";
    btn.disabled = !canStart;
    $("#settings-note").textContent =
      others.length < 1 ? "2명 이상 모이면 시작할 수 있어요." : canStart ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
  } else {
    const me = room.players.find((p) => isMe(p.id));
    btn.textContent = me?.ready ? "준비 취소" : "준비";
    btn.disabled = false;
    $("#settings-note").textContent = "방장이 게임을 시작할 때까지 기다려 주세요.";
  }
}

function renderGame(g) {
  $("#round-info").textContent = `라운드 ${g.round} / ${g.total_rounds} · 출제자 ${playerName(g.setter_id)}`;
  $("#turn-info").textContent =
    g.phase === "setting" ? `${playerName(g.setter_id)}님이 단어를 고르는 중`
    : g.phase === "guessing" ? `${playerName(g.guesser_id)}님 차례`
    : "정답 공개";

  renderGallows(g);

  // 빈칸 단어. 출제자와 정답 공개 때는 전체 단어가 온다.
  // 출제자 화면: 맞힌 글자는 진하게(open), 아직 못 맞힌 글자는 흐리게(closed) 보여서 진행 상황을 알 수 있다.
  const setterView = g.phase === "guessing" && isMe(g.setter_id);
  const letters = g.word ? [...g.word] : g.pattern;
  $("#pattern").replaceChildren(
    ...letters.map((c, i) => {
      const known = g.pattern[i];
      let cls = "";
      if (setterView) cls = known ? "open" : "closed";
      if (known && known === g.hint_letter) cls += " hint";
      else if (!known && g.phase === "break") cls = "miss";
      return el("span", { className: cls.trim(), textContent: known || (g.word ? c : "") });
    })
  );
  if (g.phase === "setting") $("#pattern").replaceChildren();

  const openCount = g.pattern.filter(Boolean).length;
  $("#progress-line").textContent =
    g.phase === "guessing" ? `공개 ${openCount} / ${g.pattern.length}칸` + (setterView ? " · 흐린 글자는 아직 아무도 못 맞힌 글자예요" : "") : "";

  let hintText = "";
  if (g.hint) hintText = `힌트: <b>${escapeHtml(g.hint)}</b>`;
  else if (g.hint_letter) hintText = `힌트로 <b>${g.hint_letter}</b>를 열어 줬어요`;
  else if (g.phase === "guessing") hintText = `힌트까지 틀린 추측 ${g.hint_in}번 남음`;
  $("#hint-line").innerHTML = hintText;

  const wrong = [...g.wrong_letters, ...g.wrong_words];
  $("#wrong-line").textContent = wrong.length ? `없는 글자: ${wrong.join(" ")}` : `각자 목숨 ${g.lives}`;

  // 출제자 입력칸 / 추측 키보드 / 구경 문구
  const mySet = isMySet();
  const myGuess = isMyGuess();
  $("#setter-form").classList.toggle("hidden", !mySet);
  // 키보드는 출제자에게도 보기 전용으로 보여 준다 (나온 글자 확인용).
  $("#guess-area").classList.toggle("hidden", g.phase !== "guessing");
  $("#word-guess").classList.toggle("hidden", isMe(g.setter_id));
  const watch = $("#watch");
  let watchText = "";
  if (g.phase === "setting" && !mySet) watchText = `${playerName(g.setter_id)}님이 단어를 고르고 있어요...`;
  if (setterView) watchText = "내가 낸 문제예요. 다른 사람들이 맞히는 걸 지켜보세요.";
  watch.textContent = watchText;
  watch.classList.toggle("hidden", !watchText);

  renderKeyboard(g, myGuess);
  $("#word-guess-input").disabled = !myGuess;
  $("#word-guess button").disabled = !myGuess;
}

// Each life advances the six strokes fractionally, including games with 4–10 lives.
const GALLOWS_SVG = `<svg class="gallows" viewBox="0 0 170 190" aria-hidden="true">
  <path class="frame" d="M18 178 Q60 176 102 178 M42 177 Q40 94 42 16 Q80 14 120 16 M43 46 L72 16" />
  <path class="rope" d="M120 16 Q118 25 120 35" />
  <g class="figure">
    <path class="part" pathLength="1" d="M120 35 C143 34 144 70 120 70 C97 70 96 36 120 35" />
    <path class="part" pathLength="1" d="M120 70 Q117 95 120 120" />
    <path class="part" pathLength="1" d="M119 82 Q107 92 96 106" />
    <path class="part" pathLength="1" d="M120 82 Q134 92 144 103" />
    <path class="part" pathLength="1" d="M120 120 Q110 136 101 155" />
    <path class="part" pathLength="1" d="M120 120 Q130 139 141 153" />
  </g>
</svg>`;

// 행맨 렌더링
function renderGallows(g) {
  const list = $("#gallows-list");
  const guessers = g.order.filter((id) => id !== g.setter_id);
  const roundKey = `${g.round}:${g.setter_id}`;
  list.classList.toggle("hidden", g.phase === "setting");
  if (list.dataset.round !== roundKey || g.phase === "setting") {
    list.replaceChildren();
    list.dataset.round = roundKey;
  }
  const existing = new Map([...list.children].map((li) => [li.dataset.player, li]));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  guessers.forEach((id, index) => {
    const strikes = g.strikes[id] || 0;
    const dead = g.hanged.includes(id);
    let li = existing.get(String(id));
    const fresh = !li;
    if (fresh) {
      li = el("li");
      li.dataset.player = id;
      li.innerHTML = GALLOWS_SVG;
      li.append(el("div", { className: "name" }), el("div", { className: "count" }));
    }
    existing.delete(String(id));
    const wasDead = li.classList.contains("dead");
    li.className = [dead && "dead", id === g.guesser_id && g.phase === "guessing" && "turn", isMe(id) && "me"].filter(Boolean).join(" ");
    const parts = li.querySelectorAll(".part");
    const progress = Math.min(parts.length, strikes * parts.length / g.lives);
    parts.forEach((part, i) => {
      const amount = Math.max(0, Math.min(1, progress - i));
      const previous = Number(part.dataset.amount || 0);
      part.dataset.amount = amount;
      part.style.strokeDashoffset = String(1 - amount);
      part.style.visibility = amount ? "visible" : "hidden";
      if (!fresh && amount !== previous) {
        part.getAnimations().forEach((animation) => animation.cancel());
        if (!reducedMotion && amount > previous) {
          // 오답 색상 전환
          part.animate([
            { strokeDashoffset: 1 - previous, stroke: getComputedStyle(part).getPropertyValue("--bad").trim() },
            { strokeDashoffset: 1 - amount, stroke: getComputedStyle(part).getPropertyValue("--bad").trim(), offset: .65 },
            { strokeDashoffset: 1 - amount, stroke: getComputedStyle(part).getPropertyValue("--text").trim() },
          ], { duration: 600, easing: "ease-out" });
        }
      }
    });
    if (!fresh && dead && !wasDead && !reducedMotion) {
      li.querySelector(".figure").animate([
        { transform: "rotate(0deg)" }, { transform: "rotate(5deg)" },
        { transform: "rotate(-3deg)" }, { transform: "rotate(1deg)" },
        { transform: "rotate(0deg)" },
      ], { duration: 850, delay: 400, easing: "ease-in-out" });
    }
    li.querySelector(".name").textContent = playerName(id) + (isMe(id) ? " (나)" : "");
    li.querySelector(".count").textContent = dead ? "탈락" : `${strikes} / ${g.lives}`;
    li.setAttribute("aria-label", `${playerName(id)}, ${dead ? "탈락" : `실수 ${strikes}회, 총 ${g.lives}회`}`);
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] || null);
  });
  existing.forEach((li) => li.remove());
}

function renderKeyboard(g, enabled) {
  const kb = $("#keyboard");
  if (!kb.children.length) {
    for (const letter of LETTERS) {
      const btn = el("button", { type: "button", textContent: letter });
      btn.onclick = () => guess(letter);
      kb.append(btn);
    }
  }
  const revealed = new Set(g.pattern.filter(Boolean));
  for (const btn of kb.children) {
    const letter = btn.textContent;
    const ok = revealed.has(letter);
    const bad = g.wrong_letters.includes(letter);
    btn.classList.toggle("ok", ok);
    btn.classList.toggle("bad", bad);
    btn.disabled = !enabled || ok || bad;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function guess(text) {
  if (isMyGuess()) send("guess", { text });
}

// ---------- 타이머 ----------

function tick() {
  const g = state.game;
  if (g && g.phase !== "break" && g.time_total_ms) {
    const left = Math.max(0, state.deadline - performance.now());
    const bar = $("#time-bar");
    bar.style.width = `${(left / g.time_total_ms) * 100}%`;
    bar.classList.toggle("low", left < 5000);
    $("#time-sec").textContent = Math.ceil(left / 1000);
  } else if (g) {
    $("#time-bar").style.width = "0";
    $("#time-sec").textContent = "";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- 이벤트 ----------

$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  const name = $("#login-name").value.trim();
  if (name) connect(name);
};

try { $("#login-name").value = localStorage.getItem("hm-name") || ""; } catch {}

$("#btn-open-create").onclick = () => {
  $("#create-form").classList.remove("hidden");
  $("#create-title").focus();
};
$("#btn-cancel-create").onclick = () => $("#create-form").classList.add("hidden");
$("#create-form").onsubmit = (e) => {
  e.preventDefault();
  send("create_room", { title: $("#create-title").value.trim(), max_players: Number($("#create-max").value) });
  $("#create-form").classList.add("hidden");
  $("#create-title").value = "";
};

$("#lobby-chat-form").onsubmit = (e) => {
  e.preventDefault();
  const input = $("#lobby-chat-input");
  const text = input.value.trim();
  if (text) send("chat", { text });
  input.value = "";
};

$("#room-chat-form").onsubmit = (e) => {
  e.preventDefault();
  const input = $("#room-chat-input");
  const text = input.value.trim();
  if (text) send("chat", { text });
  input.value = "";
};

$("#setter-form").onsubmit = (e) => {
  e.preventDefault();
  const form = e.target;
  send("set_word", { word: form.word.value.trim(), hint: form.hint.value.trim() });
  form.word.value = "";
  form.hint.value = "";
};

$("#word-guess").onsubmit = (e) => {
  e.preventDefault();
  const input = $("#word-guess-input");
  const text = input.value.trim();
  if (text) guess(text);
  input.value = "";
};

// 내 차례에 입력칸 밖에서 알파벳 키를 누르면 바로 추측
window.addEventListener("keydown", (e) => {
  if (!isMyGuess() || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const letter = e.key.toUpperCase();
  if (letter.length === 1 && LETTERS.includes(letter)) guess(letter);
});

$("#btn-leave").onclick = () => send("leave_room");

$("#btn-ready").onclick = () => {
  if (!state.room) return;
  send(state.room.host_id === state.me.id ? "start" : "ready");
};

$("#settings-form").onchange = () => {
  const form = $("#settings-form");
  send("update_settings", {
    settings: Object.fromEntries([...form.elements].map((input) => [input.name, Number(input.value)])),
  });
};

$("#btn-close-result").onclick = () => $("#result-modal").classList.add("hidden");
