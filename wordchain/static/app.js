"use strict";

const $ = (sel) => document.querySelector(sel);

const state = {
  ws: null,
  me: null,
  rooms: [],
  users: [],
  room: null,
  game: null, // { round, rounds, chain, chars, scores, current, turnLimit, turnDeadline, roundTime, roundDeadline }
};

// ---------- 공통 ----------

function show(name) {
  for (const el of document.querySelectorAll(".screen")) {
    el.classList.toggle("hidden", el.id !== `screen-${name}`);
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

function isMyTurn() {
  return !!(state.game && state.me && state.game.current === state.me.id);
}

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

// ---------- 연결 ----------

function connect(name) {
  // 페이지 위치 기준 상대 주소라서 /wordchain/ 처럼 하위 경로에 붙어도 동작한다.
  const url = new URL("ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ name }).toString();
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (state.ws !== ws) return;
    Object.assign(state, { ws: null, me: null, room: null, game: null });
    show("login");
    $("#login-error").textContent = e.code === 4000 ? "닉네임을 확인해 주세요." : "서버와 연결이 끊겼어요.";
  };
}

const handlers = {
  welcome(msg) {
    state.me = msg.player;
    $("#me-name").textContent = msg.player.name;
    $("#word-count").textContent = msg.word_count.toLocaleString();
    $("#login-error").textContent = "";
    try { localStorage.setItem("wco-name", msg.player.name); } catch {}
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

  game_start(msg) {
    state.game = { round: 0, rounds: 0, chain: [], chars: [], scores: msg.scores, current: null };
    $("#result-modal").classList.add("hidden");
    logSystem($("#room-chat-log"), "게임이 시작됐어요!");
    renderRoom();
  },

  round_start(msg) {
    Object.assign(state.game, {
      round: msg.round,
      rounds: msg.rounds,
      chain: [msg.start_word],
      chars: msg.chars,
      current: null,
    });
    setStatus(`${msg.round}라운드 · 제시어 「${msg.start_word}」`);
    renderRoom();
  },

  turn(msg) {
    const now = performance.now();
    Object.assign(state.game, {
      current: msg.player_id,
      chars: msg.chars,
      turnLimit: msg.turn_limit_ms,
      turnDeadline: now + msg.turn_limit_ms,
      roundTime: msg.round_time_ms,
      roundDeadline: now + msg.round_left_ms,
    });
    renderRoom();
    if (isMyTurn()) $("#room-chat-input").focus();
  },

  word_ok(msg) {
    state.game.chain.push(msg.word);
    state.game.scores = msg.scores;
    setStatus(`${playerName(msg.player_id)} 「${msg.word}」 +${msg.gain}`, "ok");
  },

  word_fail(msg) {
    setStatus(`${playerName(msg.player_id)}: ${msg.word} — ${msg.reason}`, "fail");
    logSystem($("#room-chat-log"), `${playerName(msg.player_id)}: ${msg.word} (${msg.reason})`, "fail");
    if (msg.player_id === state.me.id) shake($("#room-chat-form"));
  },

  round_end(msg) {
    state.game.current = null;
    state.game.scores = msg.scores;
    setStatus(`${playerName(msg.loser_id)}님이 '${msg.chars.join("/")}'(을)를 잇지 못했어요! -${msg.penalty}`, "fail");
    renderRoom();
  },

  game_over(msg) {
    const list = $("#result-list");
    list.replaceChildren(
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

// ---------- 로비 렌더링 ----------

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
            el("span", {
              className: `badge${r.playing ? " playing" : ""}`,
              textContent: r.playing ? "게임 중" : "대기 중",
            })
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
        el("span", { textContent: u.name + (u.id === state.me?.id ? " (나)" : "") }),
        el("span", { className: "where", textContent: u.room_id ? `#${u.room_id}번 방` : "로비" })
      )
    )
  );
}

// ---------- 방 렌더링 ----------

function renderRoom() {
  const room = state.room;
  if (!room) return;
  const amHost = room.host_id === state.me.id;
  const game = state.game;

  $("#room-title").textContent = `#${room.id} ${room.title}`;
  $("#room-info").textContent = `${room.players.length}/${room.max_players}명`;

  // 참가자 목록
  $("#player-list").replaceChildren(
    ...room.players.map((p) => {
      const right = game
        ? el("span", { className: "score", textContent: game.scores[p.id] ?? 0 })
        : el("span", { className: "ready", textContent: p.id === room.host_id ? "" : p.ready ? "준비 완료" : "" });
      const tags = [];
      if (p.id === room.host_id) tags.push("방장");
      if (p.id === state.me.id) tags.push("나");
      return el(
        "li",
        { className: game && game.current === p.id ? "turn" : "" },
        el("span", {}, el("span", { className: "name", textContent: p.name }), el("span", { className: "tag", textContent: tags.join(" · ") })),
        right
      );
    })
  );

  $("#waiting-view").classList.toggle("hidden", !!game);
  $("#game-view").classList.toggle("hidden", !game);

  if (game) renderGame();
  else renderWaiting(room, amHost);

  // 입력창: 내 차례면 단어 입력, 아니면 채팅
  const form = $("#room-chat-form");
  const input = $("#room-chat-input");
  const myTurn = isMyTurn();
  form.classList.toggle("my-turn", myTurn);
  input.placeholder = myTurn ? `내 차례! '${game.chars.join("/")}'(으)로 시작하는 단어` : "채팅";
}

function renderWaiting(room, amHost) {
  const form = $("#settings-form");
  const values = { ...room.settings, max_players: room.max_players };
  for (const input of form.elements) {
    input.disabled = !amHost;
    if (document.activeElement === input) continue;
    if (input.type === "checkbox") input.checked = !!values[input.name];
    else input.value = values[input.name];
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
    const me = room.players.find((p) => p.id === state.me.id);
    btn.textContent = me?.ready ? "준비 취소" : "준비";
    btn.disabled = false;
    $("#settings-note").textContent = "방장이 게임을 시작할 때까지 기다려 주세요.";
  }
}

function renderGame() {
  const game = state.game;
  $("#round-info").textContent = game.round ? `라운드 ${game.round} / ${game.rounds}` : "";
  $("#turn-info").textContent = game.current ? `${playerName(game.current)}님 차례` : "";

  const last = game.chain[game.chain.length - 1] || "";
  $("#last-word").replaceChildren(
    last.slice(0, -1),
    el("span", { className: "tail", textContent: last.slice(-1) })
  );
  $("#need-chars").textContent = game.chars.join(" / ");

  $("#chain-list").replaceChildren(
    ...[...game.chain].reverse().slice(0, 30).map((w) => el("li", { textContent: w }))
  );
}

function setStatus(text, cls = "") {
  const s = $("#game-status");
  s.textContent = text;
  s.className = `game-status ${cls}`;
}

function shake(node) {
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
}

// ---------- 타이머 ----------

function tick() {
  const game = state.game;
  if (game && game.current) {
    const now = performance.now();
    const turnLeft = Math.max(0, game.turnDeadline - now);
    const roundLeft = Math.max(0, game.roundDeadline - now);
    const turnBar = $("#turn-bar");
    turnBar.style.width = `${(turnLeft / game.turnLimit) * 100}%`;
    turnBar.classList.toggle("low", turnLeft < 3000);
    $("#turn-sec").textContent = (turnLeft / 1000).toFixed(1);
    $("#round-bar").style.width = `${(roundLeft / game.roundTime) * 100}%`;
    $("#round-sec").textContent = Math.ceil(roundLeft / 1000);
  } else if (game) {
    $("#turn-bar").style.width = "0";
    $("#turn-sec").textContent = "";
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

try { $("#login-name").value = localStorage.getItem("wco-name") || ""; } catch {}

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
  if (!text) return;
  if (isMyTurn()) send("submit_word", { word: text });
  else send("chat", { text });
  input.value = "";
};

$("#btn-leave").onclick = () => send("leave_room");

$("#btn-ready").onclick = () => {
  if (!state.room) return;
  send(state.room.host_id === state.me.id ? "start" : "ready");
};

$("#settings-form").onchange = () => {
  const form = $("#settings-form");
  send("update_settings", {
    settings: {
      rounds: Number(form.rounds.value),
      turn_time: Number(form.turn_time.value),
      round_time: Number(form.round_time.value),
      max_players: Number(form.max_players.value),
      no_killer: form.no_killer.checked,
    },
  });
};

$("#btn-close-result").onclick = () => $("#result-modal").classList.add("hidden");
