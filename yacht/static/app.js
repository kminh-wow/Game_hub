"use strict";

// 요트 다이스 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡는다.

const $ = (sel) => document.querySelector(sel);

const UPPER = [["aces", "에이스"], ["deuces", "듀스"], ["threes", "트레이"], ["fours", "포"], ["fives", "파이브"], ["sixes", "식스"]];
const LOWER = [["choice", "초이스"], ["four_kind", "포 카인드"], ["full_house", "풀 하우스"],
               ["small_straight", "S. 스트레이트"], ["large_straight", "L. 스트레이트"], ["yacht", "요트"]];
const LABELS = Object.fromEntries([...UPPER, ...LOWER]);
// 주사위 눈 위치 (3×3 칸 번호)
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };


let deadline = 0;
let rolling = null;        // 굴러가는 중: { rolled: [bool], timer }
let trayView = null;
let lastWrite = null;      // 방금 적은 칸 (반짝임 표시): "playerId:category"

const lobby = GameLobby.init({
  storageKey: "yacht",
  showLastGame: true,
  handlers: {
    game(msg) {
      deadline = performance.now() + msg.game.time_left_ms;
      for (const ev of msg.events) showEvent(ev);
      const roll = msg.events.find((ev) => ev.kind === "roll");
      lobby.state.game = msg.game;
      if (roll) startRolling(roll);
      if (!msg.game.rolling) stopRolling();
      lobby.render();
    },
    game_over(msg) {
      lobby.logSystem("게임이 끝났어요.");
      lobby.showResult("게임 결과", msg.ranking.map((r, i) => [`${i + 1}. ${r.name}`, `${r.score}점`]));
    },
  },
  renderGame,
  playerRight: (p) => {
    const g = lobby.state.game;
    return g?.totals[p.id] ? `${g.totals[p.id].total}점` : "";
  },
  isTurn: (p, room) => room.playing && lobby.state.game?.current_id === p.id,
  canStart: (room, others) => others.every((p) => p.ready),
  waitingNote(room, amHost, others) {
    if (others.length === 0) return amHost ? "혼자 시작하면 연습 모드예요. 친구가 들어오면 함께 해요 (최대 5명)." : "";
    return undefined;
  },
});

const isMyTurn = (g) => !!lobby.state.room?.playing && !!g.current_id && lobby.isMe(g.current_id);

function showEvent(ev) {
  const name = lobby.state.game?.names?.[ev.player_id] || lobby.playerName(ev.player_id);
  if (ev.kind === "write") {
    lastWrite = `${ev.player_id}:${ev.category}`;
    lobby.logSystem(`${name}: ${LABELS[ev.category]} ${ev.points}점`);
  } else if (ev.kind === "timeout") {
    lobby.logSystem(`${name}님 시간 초과 — 자동으로 적었어요.`, "fail");
  }
}

// ---------- 주사위 굴리기 연출 ----------
// 서버가 계산한 물리 궤적을 재생하고 정지한 자세로 결과를 표시한다.
function stopRolling() {
  clearTimeout(rolling?.timer);
  rolling = null;
}
function startRolling(event) {
  stopRolling();
  rolling = {...event, start: performance.now()};
  rolling.timer = setTimeout(() => {
    stopRolling();
    lobby.render();
  }, event.duration_ms);
}

// ---------- 그리기 (디자인은 나중에 교체) ----------

function dieNode(face, cls) {
  const die = lobby.el("button", { type: "button", className: `die ${cls}` });
  for (let i = 0; i < 9; i++) die.append(lobby.el("i", { className: PIPS[face]?.includes(i) ? "on" : "" }));
  return die;
}

function renderTray(g) {
  const mine = isMyTurn(g);
  const canHold = mine && g.rolled && g.rolls_left > 0 && !rolling && !g.rolling;
  $("#tray").replaceChildren(
    ...g.dice.map((face, i) => {
      const spinning = rolling?.rolled[i];
      const shown = spinning ? 0 : face;
      const cls = [!g.rolled && "blank", g.held[i] && g.rolled && "held", spinning && "rolling"].filter(Boolean).join(" ");
      const die = dieNode(shown, cls);
      die.disabled = !canHold;
      die.setAttribute('aria-label', `주사위 ${i+1}: ${g.rolling ? '굴러가는 중' : g.rolled ? face+'눈' : '굴리기 전'}`);
      die.setAttribute('aria-pressed', String(!!(g.held[i] && g.rolled)));
      die.onclick = () => {
        const held = [...g.held];
        held[i] = !held[i];
        lobby.send("hold", { held });
      };
      return die;
    })
  );
  if (trayView) trayView.update(g, rolling);
  $("#held-labels").replaceChildren(...g.held.map((h) => lobby.el("span", { textContent: h && g.rolled ? "고정" : "" })));
}

function renderGame(g, room) {
  const finished = !room.playing;
  const currentName = g.names[g.current_id] || "";
  $("#round-info").textContent = finished ? "지난 판" : `라운드 ${g.round} / ${g.rounds}`;
  $("#turn-info").textContent = finished ? "" : isMyTurn(g) ? "내 차례!" : `${currentName}님 차례`;
  $("#game-view .bar-row").classList.toggle("hidden", finished);

  renderTray(g);

  const btn = $("#btn-roll");
  const mine = isMyTurn(g);
  btn.classList.toggle("hidden", finished);
  btn.disabled = !mine || g.rolls_left <= 0 || (g.rolled && g.held.every(Boolean)) || !!rolling || g.rolling;
  btn.textContent = g.rolled ? `다시 굴리기 (${g.rolls_left}번 남음)` : "굴리기";

  let status = "";
  if (!finished) {
    if (mine) status = !g.rolled ? "주사위를 굴려 주세요." : g.rolls_left ? "고정할 주사위를 누르거나, 점수판에서 적을 칸을 고르세요." : "적을 칸을 고르세요.";
    else status = g.rolled ? `${currentName}님이 고민 중…` : `${currentName}님이 굴릴 차례예요.`;
  }
  $("#game-status").textContent = g.rolling ? "주사위가 떨어지고 있어요…" : status;

  renderSheet(g, finished);
}

function renderSheet(g, finished) {
  const el = lobby.el;
  const mine = g.order.find(id => lobby.isMe(id));
  const ids = mine ? [mine, ...g.order.filter(id => id !== mine)] : [...g.order];
  const head = el("tr", {}, el("th", { textContent: "족보" }),
    ...ids.map((id) => el("th", { className: id === g.current_id && !finished ? "turn" : "", textContent: g.names[id] + (lobby.isMe(id) ? " (나)" : "") })));

  const cell = (id, cat) => {
    const written = g.sheets[id][cat];
    const td = el("td");
    if (written !== null) {
      td.textContent = written;
      td.className = "written" + (lastWrite === `${id}:${cat}` ? " just" : "");
    } else if (!finished && id === g.current_id && g.preview && !rolling && !g.rolling) {
      const pts = g.preview[cat];
      if (isMyTurn(g)) {
        const b = el("button", { type: "button", className: `pick${pts ? "" : " zero"}`, textContent: pts });
        b.onclick = () => lobby.send("write", { category: cat });
        td.append(b);
      } else {
        td.textContent = pts;
        td.className = `preview${pts ? "" : " zero"}`;
      }
    }
    return td;
  };
  const row = (label, cat) => el("tr", {}, el("td", { textContent: label }), ...ids.map((id) => cell(id, cat)));
  const sumRow = (label, fn, cls) => el("tr", { className: cls }, el("td", { textContent: label }), ...ids.map((id) => el("td", { textContent: fn(g.totals[id]) })));

  $("#sheet").replaceChildren(
    el("thead", {}, head),
    el("tbody", {},
      ...UPPER.map(([c, l]) => row(l, c)),
      sumRow("소계 (63점 이상 보너스)", (t) => `${t.upper} / 63`, "sum"),
      sumRow("보너스", (t) => (t.bonus ? `+${t.bonus}` : "0"), "sum"),
      ...LOWER.map(([c, l]) => row(l, c)),
      sumRow("합계", (t) => t.total, "total"),
    )
  );
  for (const row of $("#sheet").rows) {
    ids.forEach((id,i) => {
      row.cells[i+1].classList.toggle('mine', lobby.isMe(id));
      row.cells[i+1].classList.toggle('current', id===g.current_id && !finished);
    });
  }
  lastWrite = null;
}

$("#btn-roll").onclick = () => lobby.send("roll");

// ---------- 타이머 ----------

function tick() {
  const g = lobby.state.game;
  const bar = $("#time-bar");
  if (g && lobby.state.room?.playing && g.time_total_ms) {
    const left = Math.max(0, deadline - performance.now());
    bar.style.width = `${(left / g.time_total_ms) * 100}%`;
    bar.classList.toggle("low", left < 10000);
    $("#time-sec").textContent = Math.ceil(left / 1000);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Native buttons remain the accessible controls; 3D supplies their visual dice.
import('./tray3d.js?v=physics-rounded').then(({createTrayView})=>createTrayView($('#dice-stage'))).then(view=>{
  trayView=view;
  $('#held-labels').classList.add('hidden');
  if(lobby.state.game)renderTray(lobby.state.game);
}).catch(error=>console.warn('3D tray unavailable; using standard dice.',error));
