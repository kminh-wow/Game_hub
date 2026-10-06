"use strict";

// 멀티플레이 게임 공통 화면: 로그인 → 로비 → 방(대기실) → 게임, 채팅, 결과 창.
// 서버 쪽 common/multiplayer 와 짝을 이룬다. 허브에서 /common/lobby.js 로 제공된다.
//
// 사용법 (게임의 app.js):
//   const lobby = GameLobby.init({
//     storageKey: "omok",                    // localStorage 키 앞부분 (닉네임, 브라우저 식별값)
//     renderGame(game, room) { ... },        // 게임 화면(#game-view 안) 그리기
//     handlers: { game(msg) { ... } },       // 게임 전용 서버 메시지
//     playerRight(p, room) { return "3승"; },// (선택) 참가자 목록 오른쪽 글자
//     playerTags(p, room) { return []; },    // (선택) 참가자 이름 옆 태그
//     canStart(room, others) { ... },        // (선택) 방장 시작 버튼 조건
//     waitingNote(room, amHost, others) {},  // (선택) 대기실 안내 문구
//     showLastGame: true,                    // (선택) 게임이 끝난 뒤에도 대기실 아래에 마지막 판을 보여 줌
//   });
//
// 필요한 HTML id 는 omok/static/index.html 을 참고한다.

const GameLobby = (() => {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    ws: null,
    me: null,
    rooms: [],
    users: [],
    room: null,
    game: null,      // 게임이 setGame() 으로 넣는 현재 게임 상태
  };
  let cfg = null;

  // ---------- 도우미 ----------

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.append(c);
    return node;
  }

  function show(name) {
    for (const s of document.querySelectorAll(".screen")) {
      s.classList.toggle("hidden", s.id !== `screen-${name}`);
    }
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

  // 브라우저 오류 보고 (서버 로그에 남는다. 접속 전 오류는 모아 뒀다가 접속하면 보낸다)
  let reportedErrors = 0;
  const pendingErrors = [];
  function reportError(err, where = "") {
    if (++reportedErrors > 10) return;
    const message = (err && (err.message || String(err))) || "알 수 없는 오류";
    const data = { message: where ? `${where}: ${message}` : message, stack: String(err?.stack || ""), ua: navigator.userAgent };
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.me) send("client_error", data);
    else if (pendingErrors.length < 5) pendingErrors.push(data);
  }
  window.addEventListener("error", (e) => reportError(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));

  const isMe = (id) => !!state.me && id === state.me.id;

  function playerName(id) {
    const p = state.room?.players.find((p) => p.id === id);
    return p ? p.name : "?";
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

  function logSystem(text, cls = "sys") {
    appendLog(state.room ? $("#room-chat-log") : $("#lobby-chat-log"), el("li", { className: cls, textContent: text }));
  }

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(`${cfg.storageKey}-${key}`);
      localStorage.setItem(`${cfg.storageKey}-${key}`, value);
    } catch {}
    return null;
  }

  // ---------- 연결 ----------

  const CLOSE_MESSAGES = {
    4000: "닉네임을 확인해 주세요.",
    4001: "이미 접속 중인 닉네임이에요. 다른 닉네임을 써 주세요.",
    4002: "다른 창에서 같은 닉네임으로 접속해서 연결이 끊겼어요.",
  };

  // 브라우저별 식별값. 같은 브라우저에서 같은 닉네임으로 다시 들어오면 예전 연결을 이어받는다.
  function token() {
    let t = storage("token");
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      storage("token", t);
    }
    return t;
  }

  function connect(name) {
    const url = new URL("ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({ name, token: token() }).toString();
    const ws = new WebSocket(url);
    state.ws = ws;
    // 연결 유지 신호 (오래 조용하면 공유기·프록시가 연결을 끊는 것을 막는다)
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25000);
    ws.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
        reportError(err, "메시지 처리");
      }
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      if (state.ws !== ws) return;
      Object.assign(state, { ws: null, me: null, room: null, game: null });
      show("login");
      $("#login-error").textContent = CLOSE_MESSAGES[e.code] || "서버와 연결이 끊겼어요.";
    };
  }

  const baseHandlers = {
    welcome(msg) {
      state.me = msg.player;
      $("#me-name").textContent = msg.player.name;
      $("#login-error").textContent = "";
      storage("name", msg.player.name);
      hubName(msg.player.name);
      show("lobby");
      while (pendingErrors.length) send("client_error", pendingErrors.shift());
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
      if (!wasInRoom) show("room");
      renderRoom();
    },
    chat(msg) {
      logChat(msg.scope === "room" ? $("#room-chat-log") : $("#lobby-chat-log"), msg.from.name + (msg.spectator ? " (관전)" : ""), msg.text);
    },
    system(msg) {
      logSystem(msg.text);
    },
    error(msg) {
      toast(msg.message);
    },
  };

  function handle(msg) {
    const fn = cfg.handlers?.[msg.type] || baseHandlers[msg.type];
    if (fn) fn(msg);
  }

  // ---------- 로비 ----------

  function renderLobby() {
    const list = $("#room-list");
    if (!state.rooms.length) {
      list.replaceChildren(el("li", { className: "empty", textContent: "아직 방이 없어요. 새로 만들어 보세요!" }));
    } else {
      list.replaceChildren(
        ...state.rooms.map((r) => {
          // 게임 중이거나 꽉 찬 방은 들어갈 수 없으므로 눌러서 관전한다
          const blocked = r.playing || r.players >= r.max_players;
          const watching = r.spectators ? ` · 👀 ${r.spectators}` : "";
          const badge = r.playing ? "게임 중 · 관전하기" : blocked ? "꽉 참 · 관전하기" : "대기 중";
          const card = el(
            "li",
            { className: `room-card${blocked ? " watchable" : ""}` },
            el("div", { className: "title", textContent: `#${r.id} ${r.title}` }),
            el(
              "div",
              { className: "meta" },
              el("span", { textContent: `방장 ${r.host} · ${r.players}/${r.max_players}${watching}` }),
              el("span", { className: `badge${r.playing ? " playing" : ""}`, textContent: badge })
            )
          );
          card.onclick = () => send(blocked ? "spectate_room" : "join_room", { room_id: r.id });
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
          el("span", { className: "where", textContent: u.room_id ? `#${u.room_id}번 방${u.spectating ? " 관전" : ""}` : "로비" })
        )
      )
    );
  }

  // ---------- 방 ----------

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    const amHost = room.host_id === state.me.id;
    const watchers = room.spectators || [];
    const amSpectator = watchers.some((s) => isMe(s.id));
    const inGame = room.playing && !!state.game;
    const showGame = !!state.game && (room.playing || !!cfg.showLastGame);

    $("#room-title").textContent = `#${room.id} ${room.title}`;
    $("#room-info").textContent = `${room.players.length}/${room.max_players}명${watchers.length ? ` · 👀 관전 ${watchers.length}` : ""}${amSpectator ? " (내가 관전 중)" : ""}`;
    $("#btn-leave").textContent = amSpectator ? "관전 끝내기" : "나가기";

    // 관전자 목록
    const watchBox = $("#spectator-box");
    if (watchBox) {
      watchBox.classList.toggle("hidden", !watchers.length);
      $("#spectator-count").textContent = watchers.length;
      $("#spectator-list").replaceChildren(
        ...watchers.map((s) => el("li", {}, el("span", { className: "name", textContent: s.name + (isMe(s.id) ? " (나)" : "") })))
      );
    }

    $("#player-list").replaceChildren(
      ...room.players.map((p) => {
        const tags = [];
        if (p.id === room.host_id) tags.push("방장");
        if (isMe(p.id)) tags.push("나");
        tags.push(...(cfg.playerTags?.(p, room) || []));
        const right = cfg.playerRight?.(p, room) ?? "";
        const readyText = !room.playing && p.id !== room.host_id && p.ready ? "준비 완료" : "";
        return el(
          "li",
          { className: cfg.isTurn?.(p, room) ? "turn" : "" },
          el("span", {}, el("span", { className: "name", textContent: p.name }), el("span", { className: "tag", textContent: tags.join(" · ") })),
          el("span", { className: readyText ? "ready" : "score", textContent: readyText || right })
        );
      })
    );

    $("#waiting-view").classList.toggle("hidden", inGame);
    $("#game-view").classList.toggle("hidden", !showGame);
    if (!inGame) renderWaiting(room, amHost);
    if (showGame) cfg.renderGame(state.game, room);
  }

  function renderWaiting(room, amHost) {
    const form = $("#settings-form");
    if (form) {
      form.classList.toggle("editable", amHost);
      const values = { ...room.settings, max_players: room.max_players };
      for (const input of form.elements) {
        input.disabled = !amHost;
        if (document.activeElement === input) continue;
        if (input.type === "checkbox") input.checked = !!values[input.name];
        else input.value = values[input.name];
      }
    }

    const btn = $("#btn-ready");
    const others = room.players.filter((p) => p.id !== room.host_id);
    // 관전자는 준비·시작을 못 하므로 안내만 보여 준다
    const spectating = (room.spectators || []).some((s) => isMe(s.id));
    btn.classList.toggle("hidden", spectating);
    if (spectating) {
      $("#settings-note").textContent = "관전 중이에요. 게임이 시작되면 이 화면에서 바로 볼 수 있어요.";
      return;
    }
    let note;
    if (amHost) {
      const canStart = cfg.canStart ? cfg.canStart(room, others) : others.length >= 1 && others.every((p) => p.ready);
      btn.textContent = "게임 시작";
      btn.disabled = !canStart;
      note = others.length < 1 ? "2명 이상 모이면 시작할 수 있어요." : canStart ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    } else {
      const me = room.players.find((p) => isMe(p.id));
      btn.textContent = me?.ready ? "준비 취소" : "준비";
      btn.disabled = false;
      note = "방장이 게임을 시작할 때까지 기다려 주세요.";
    }
    $("#settings-note").textContent = cfg.waitingNote?.(room, amHost, others) ?? note;
  }

  function showResult(title, rows) {
    $("#result-title").textContent = title;
    $("#result-list").replaceChildren(
      ...rows.map(([name, value]) => el("li", {}, el("span", { textContent: name }), el("b", { textContent: value })))
    );
    $("#result-modal").classList.remove("hidden");
  }

  // ---------- 이벤트 ----------

  // 메인 화면에서 정한 닉네임 (모든 게임 공용)
  function hubName(value) {
    try {
      if (value === undefined) return localStorage.getItem("gamehub-name") || "";
      localStorage.setItem("gamehub-name", value);
    } catch {
      return "";
    }
  }

  function bindEvents() {
    $("#login-form").onsubmit = (e) => {
      e.preventDefault();
      const name = $("#login-name").value.trim();
      if (name) connect(name);
    };
    $("#login-name").value = hubName() || storage("name") || "";

    $("#btn-open-create").onclick = () => {
      $("#create-form").classList.remove("hidden");
      $("#create-title").focus();
    };
    $("#btn-cancel-create").onclick = () => $("#create-form").classList.add("hidden");
    $("#create-form").onsubmit = (e) => {
      e.preventDefault();
      const max = $("#create-max");
      send("create_room", { title: $("#create-title").value.trim(), ...(max ? { max_players: Number(max.value) } : {}) });
      $("#create-form").classList.add("hidden");
      $("#create-title").value = "";
    };

    for (const scope of ["lobby", "room"]) {
      $(`#${scope}-chat-form`).onsubmit = (e) => {
        e.preventDefault();
        const input = $(`#${scope}-chat-input`);
        const text = input.value.trim();
        if (text) send("chat", { text });
        input.value = "";
      };
    }

    $("#btn-leave").onclick = () => send("leave_room");
    $("#btn-ready").onclick = () => {
      if (state.room) send(state.room.host_id === state.me.id ? "start" : "ready");
    };

    const form = $("#settings-form");
    if (form) {
      form.onchange = () => {
        const settings = {};
        for (const input of form.elements) {
          if (!input.name) continue;
          settings[input.name] = input.type === "checkbox" ? input.checked : Number(input.value);
        }
        send("update_settings", { settings });
      };
    }
    $("#btn-close-result").onclick = () => $("#result-modal").classList.add("hidden");
  }

  function init(config) {
    cfg = config;
    bindEvents();
    // 메인 화면에서 닉네임을 정했으면 바로 접속
    if (hubName()) connect(hubName());
    return {
      state,
      send,
      reportError,
      toast,
      el,
      isMe,
      playerName,
      logSystem,
      showResult,
      render: renderRoom,
      setGame(game) {
        state.game = game;
        renderRoom();
      },
    };
  }

  return { init };
})();
