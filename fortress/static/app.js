"use strict";

// 포트리스 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고, 여기서는 전장과 조작만 다룬다.
// 포탄 궤적·폭발·피해는 서버가 계산해 보내고, 화면은 그대로 재생한다.

const $ = (sel) => document.querySelector(sel);

const COLORS = ["#d64545", "#2f6fd6", "#e0a020", "#3a9a5a"];
const DUMMY_COLOR = "#8b8b8b";
const TANK_CENTER = 8;
const BARREL = 22;
const ART_PIVOT = 18;          // 포탑 회전축
const GAUGE_MS = 1500;          // 파워 게이지가 0에서 100까지 가는 시간
const MOVE_EVERY = 60;          // 이동 키를 누르고 있을 때 서버로 보내는 간격(ms)
const ANGLE_EVERY = 40;
const FALL_MS = 450;
const REASONS = { hit: "격파", sea: "바다에 빠짐" };

const canvas = $("#field");
const ctx = canvas.getContext("2d");
let W = 1200;
let H = 700;

let deadline = 0;
let anim = null;                // 재생 중인 포탄 {prev, shot, start}
let popups = [];                // 피해 숫자 {x, y, text, start}
let aim = null;                 // 내 차례에 화면에서 바꾸는 각도·방향 {angle, facing}
let weapon = "normal";
let charging = null;            // 파워를 모으는 중이면 시작 시각
let lastPower = null;
let lastAimSent = 0;
let grassTops = null;           // 판이 시작될 때의 땅 높이 (파이지 않은 곳에만 잔디)
let aimTimer = null;
const holds = {};               // 누르고 있는 키 -> 반복 타이머

const lobby = GameLobby.init({
  storageKey: "fortress",
  showLastGame: true,
  handlers: {
    game(msg) {
      const prev = lobby.state.game;
      const shot = msg.events.find((e) => e.kind === "shot");
      deadline = performance.now() + msg.game.time_left_ms;
      // 연출 준비가 실패해도 상태는 항상 새로 반영
      try {
        if (shot && prev) startShot(prev, shot);
        for (const e of msg.events) logEvent(e, msg.game);
        if (msg.events.some((e) => e.kind === "turn")) resetAim(msg.game);
        if (msg.game.turn === 1 && !shot) grassTops = columns(msg.game.terrain).map((c) => c[c.length - 1]?.[1]);
      } catch (err) {
        reportError(err);
      }
      lobby.setGame(msg.game);
    },
    aim(msg) {
      const t = tankOf(lobby.state.game, msg.id);
      if (t) Object.assign(t, { angle: msg.angle, facing: msg.facing });
    },
    tank(msg) {
      const g = lobby.state.game;
      if (!g) return;
      g.tanks = g.tanks.map((t) => (t.id === msg.tank.id ? msg.tank : t));
      g.fuel = msg.fuel;
      if (aim && lobby.isMe(msg.tank.id)) aim.facing = msg.tank.facing;
      renderControls(g);
    },
    game_over(msg) {
      stopAll();
      const solo = msg.ranking.some((r) => r.id === "dummy");
      let title = "무승부";
      if (msg.winner) title = lobby.isMe(msg.winner.id) ? (solo ? "연습 완료!" : "승리!") : `${msg.winner.name} 승리`;
      lobby.logSystem(msg.winner ? `${msg.winner.name}님이 끝까지 살아남았어요.` : "모두 탈락했어요. 무승부!");
      lobby.showResult(title, msg.ranking.map((r, i) => [`${i + 1}. ${r.name}`, r.alive ? `생존 · HP ${r.hp}` : "탈락"]));
    },
  },
  renderGame,
  playerRight(p) {
    const t = tankOf(lobby.state.game, p.id);
    if (!t || !lobby.state.room?.playing) return "";
    return t.alive ? `HP ${t.hp}` : "탈락";
  },
  isTurn: (p, room) => room.playing && lobby.state.game?.current_id === p.id,
  canStart: (room, others) => others.every((p) => p.ready),
  waitingNote(room, amHost, others) {
    // 혼자일 때 상대 고르기
    $("#solo-row").classList.toggle("hidden", others.length > 0);
    if (others.length === 0) {
      if (!amHost) return "";
      return room.settings.solo_opponent
        ? "혼자 시작하면 AI와 번갈아 쏘며 대결해요. 친구가 들어오면 함께 싸워요."
        : "혼자 시작하면 허수아비를 상대로 연습해요(허수아비는 쏘지 않아요). 친구가 들어오면 함께 싸워요.";
    }
    if (amHost) return others.every((p) => p.ready) ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

// ---------- 조회 ----------

function tankOf(g, id) {
  return g?.tanks.find((t) => t.id === id) || null;
}

function myTurn(g) {
  return !!g && !!lobby.state.room?.playing && !g.flying && !anim && !!g.current_id && lobby.isMe(g.current_id);
}

function colorOf(t) {
  return t.dummy ? DUMMY_COLOR : COLORS[t.color % COLORS.length];
}

// 채팅창 알림
function logEvent(e, g) {
  const name = tankOf(g, e.player_id)?.name || "";
  if (e.kind === "timeout") {
    const solo = g.tanks.some((t) => t.dummy);
    const text = lobby.isMe(e.player_id) ? (solo ? "시간 초과! 다시 내 차례예요." : "시간 초과! 차례가 넘어갔어요.") : `${name}님 시간 초과`;
    lobby.logSystem(text);
    lobby.toast(text);
  }
  if (e.kind === "left") lobby.logSystem(`${name}님이 나가서 탈락했어요.`);
  if (e.kind === "shot") {
    for (const r of e.results) {
      if (r.cause) lobby.logSystem(`${tankOf(g, r.id)?.name}님 ${REASONS[r.cause]}!`, "fail");
    }
  }
}

// ---------- 게임 화면 ----------

function renderGame(g, room) {
  W = g.width;
  H = g.height;
  const finished = !room.playing;
  $("#tank-chips").replaceChildren(
    ...g.tanks.map((t) => {
      const chip = lobby.el("span", {
        className: [t.id === g.current_id && !finished && "turn", !t.alive && "dead"].filter(Boolean).join(" "),
        title: `HP ${t.hp}`,
      }, lobby.el("i"), `${t.name}${lobby.isMe(t.id) ? " (나)" : ""} ${t.hp}`);
      chip.firstChild.style.background = colorOf(t);
      return chip;
    })
  );

  let turnText = "";
  let status = "";
  if (finished) {
    turnText = "지난 판";
  } else if (g.flying || anim) {
    status = "포탄이 날아가는 중…";
  } else if (myTurn(g)) {
    turnText = "내 차례!";
    status = "움직이고, 각도를 맞추고, 파워를 모아 쏘세요.";
  } else {
    turnText = `${tankOf(g, g.current_id)?.name || ""}님 차례`;
    status = lobby.state.room?.spectators?.some((s) => lobby.isMe(s.id)) ? "관전 중" : "상대가 조준하는 중…";
  }
  $("#turn-info").textContent = turnText;
  $("#game-status").textContent = status;
  $("#game-view .bar-row").classList.toggle("hidden", finished);
  const playing = room.playing && !!tankOf(g, lobby.state.me?.id);
  for (const id of ["#controls", "#pad", "#help"]) $(id).classList.toggle("hidden", !playing);
  renderControls(g);
}

// 조작 패널
function renderControls(g) {
  const me = tankOf(g, lobby.state.me?.id);
  if (!me) return;
  const mine = myTurn(g);
  const angle = mine && aim ? aim.angle : me.angle;
  $("#angle-val").textContent = `${Math.round(angle)}°`;
  $("#fuel-bar").style.width = `${mine ? (g.fuel / g.fuel_max) * 100 : 0}%`;
  const last = $("#power-last");
  last.style.display = lastPower === null ? "none" : "block";
  if (lastPower !== null) last.style.left = `${lastPower}%`;
  for (const b of document.querySelectorAll("#pad button")) b.disabled = !mine;
  if (me.stock[weapon] === 0) weapon = "normal";

  $("#weapons").replaceChildren(
    ...Object.entries(g.weapons).map(([id, w]) => {
      const left = me.stock[id];
      const b = lobby.el("button", {
        type: "button",
        className: weapon === id ? "on" : "",
        textContent: left === undefined ? w.name : `${w.name} ${left}`,
        disabled: !mine || left === 0,
      });
      // 포탄 선택 아이콘
      const icon = document.createElement("img");
      icon.src = `static/assets/${id === "normal" ? "normal" : "heavy"}.png`;
      icon.alt = "";
      b.prepend(icon);
      b.setAttribute("aria-pressed", String(weapon === id));
      b.onclick = () => {
        weapon = id;
        renderControls(g);
      };
      return b;
    })
  );
}

function resetAim(g) {
  stopAll();
  const me = tankOf(g, lobby.state.me?.id);
  aim = me && lobby.isMe(g.current_id) ? { angle: me.angle, facing: me.facing } : null;
  weapon = "normal";
}

// ---------- 입력 ----------

function sendAim(force = false) {
  if (!aim) return;
  const now = performance.now();
  clearTimeout(aimTimer);
  if (force || now - lastAimSent > 100) {
    lastAimSent = now;
    lobby.send("aim", { angle: aim.angle, facing: aim.facing });
  } else {
    aimTimer = setTimeout(() => sendAim(true), 100);
  }
}

function powerAt(now) {
  const p = (Math.max(0, now - charging) / GAUGE_MS) * 100 % 200;
  return p > 100 ? 200 - p : p;
}

// 키 누름 시작
function press(key) {
  const g = lobby.state.game;
  if (!myTurn(g) || holds[key] !== undefined) return;
  if (key === "Space") {
    charging = performance.now();
    holds[key] = null;
    return;
  }
  const moving = key === "ArrowLeft" || key === "ArrowRight";
  const step = () => {
    const g2 = lobby.state.game;
    if (!myTurn(g2)) return release(key);
    if (moving) {
      const dir = key === "ArrowLeft" ? -1 : 1;
      aim.facing = dir;
      lobby.send("move", { dir });
    } else {
      aim.angle = Math.max(0, Math.min(90, aim.angle + (key === "ArrowUp" ? 1 : -1)));
      sendAim();
      renderControls(g2);
    }
  };
  step();
  holds[key] = setInterval(step, moving ? MOVE_EVERY : ANGLE_EVERY);
}

// 키 뗌
function release(key) {
  if (!(key in holds)) return;
  clearInterval(holds[key]);
  delete holds[key];
  if (key === "Space" && charging !== null) {
    const power = Math.round(powerAt(performance.now()) * 10) / 10;
    charging = null;
    $("#power-bar").style.width = "0";
    if (myTurn(lobby.state.game)) {
      sendAim(true);
      lastPower = power;
      lobby.send("fire", { power, weapon });
    }
  }
}

function stopAll() {
  for (const key of Object.keys(holds)) {
    clearInterval(holds[key]);
    delete holds[key];
  }
  charging = null;
  $("#power-bar").style.width = "0";
}

// 키 배치 (WASD + 스페이스, 한글 입력 상태에서도 자리로 판별)
const KEYS = { KeyA: "ArrowLeft", KeyD: "ArrowRight", KeyW: "ArrowUp", KeyS: "ArrowDown", Space: "Space" };
const typing = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

document.addEventListener("keydown", (e) => {
  if (!KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey || typing(e) || $("#game-view").classList.contains("hidden")) return;
  if (!lobby.state.room?.playing) return;
  e.preventDefault();
  press(KEYS[e.code]);           // 누른 채로 차례가 바뀌어도 이어서 동작
});
document.addEventListener("keyup", (e) => {
  if (KEYS[e.code]) release(KEYS[e.code]);
});
window.addEventListener("blur", stopAll);

for (const b of document.querySelectorAll("#pad button")) {
  const key = b.dataset.key;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    press(key);
  });
  for (const ev of ["pointerup", "pointercancel"]) b.addEventListener(ev, () => release(key));
}

// ---------- 포탄 재생 ----------

function startShot(prev, shot) {
  stopAll();
  const flight = (shot.frames.length - 1) * shot.frame_ms;
  anim = { prev: JSON.parse(JSON.stringify(prev)), shot, start: performance.now(), flight };
}

// 지금 그릴 지형과 탱크 (재생 중이면 터지기 전 모습)
function scene(g, now) {
  if (!anim) return { terrain: g.terrain, tanks: g.tanks, shell: null, blast: null };
  const t = Math.max(0, now - anim.start);
  const { prev, shot, flight } = anim;
  if (t < flight) {
    const f = t / shot.frame_ms;
    const i = Math.min(Math.floor(f), shot.frames.length - 1);
    const a = shot.frames[i];
    const b = shot.frames[Math.min(i + 1, shot.frames.length - 1)];
    const k = f - i;
    const trail = shot.frames.slice(Math.max(0, i - 10), i + 1);
    const tanks = prev.tanks.map((pt) => ({ ...pt, ...pick(tankOf(g, pt.id), ["angle", "facing"], pt.id === shot.player_id) }));
    return { terrain: prev.terrain, tanks, shell: { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, trail }, blast: null };
  }
  if (!anim.popped) {
    anim.popped = true;
    for (const r of shot.results) {
      const pt = tankOf(prev, r.id);
      if (!pt) continue;
      const text = r.cause === "sea" ? "풍덩!" : r.damage ? `-${r.damage}` : "";
      if (text) popups.push({ x: pt.x, y: pt.y + 40, text, start: now });
    }
  }
  if (t > shot.duration_ms) {
    anim = null;
    lobby.render();
    return scene(g, now);
  }
  const k = Math.min(1, (t - flight) / FALL_MS);
  const tanks = g.tanks.map((nt) => {
    const pt = tankOf(prev, nt.id);
    return pt ? { ...nt, y: pt.y + (nt.y - pt.y) * k } : nt;
  });
  return { terrain: g.terrain, tanks, shell: null, blast: shot.hit ? { ...shot.hit, t: t - flight } : null };
}

function pick(obj, keys, use) {
  if (!obj || !use) return {};
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

// ---------- 전장 그리기 ----------

const sy = (y) => H - y;
let ui = 1;                     // 화면이 작을 때 글자·표시를 키우는 배율
const font = (weight, px) => `${weight} ${Math.round(px * ui)}px 'Malgun Gothic', sans-serif`;

// 먼 산 배경
const FAR = Array.from({ length: 61 }, (_, i) => {
  const x = i * 20;
  return [x, 330 + 70 * Math.sin(x / 140) + 40 * Math.sin(x / 53 + 1.3)];
});

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#8ccaf2");
  sky.addColorStop(1, "#eaf6ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(120, 150, 180, .35)";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const [x, y] of FAR) ctx.lineTo(x, sy(y));
  ctx.lineTo(W, H);
  ctx.fill();
}

// 지형 구간 (서버는 구간이 하나뿐인 열을 높이 숫자로 줄여 보낸다)
const columnCache = new WeakMap();
function columns(terrain) {
  let cols = columnCache.get(terrain);
  if (!cols) {
    cols = terrain.map((c) => (typeof c === "number" ? [[0, c]] : c));
    columnCache.set(terrain, cols);
  }
  return cols;
}

// 지형 렌더링
function drawTerrain(terrain, sea) {
  FortressTerrain.draw(ctx, terrain, grassTops, W, H);

  ctx.fillStyle = "rgba(37, 105, 190, .78)";
  ctx.fillRect(0, sy(sea), W, sea);
}

// 탱크 렌더링
function drawTank(t, current, now) {
  if (!t.alive) {
    ctx.globalAlpha = .35;
  }
  const x = t.x;
  const y = sy(t.y);
  const color = colorOf(t);
  const k = Math.min(ui, 1.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-x, -y);
  const mine = aim && lobby.isMe(t.id) && myTurn(lobby.state.game);
  const angle = mine ? aim.angle : t.angle;
  const facing = mine ? aim.facing : t.facing;

  // 포신
  const rad = (angle * Math.PI) / 180;
  const cx = x;
  const cy = y - (FortressArt.ready() ? ART_PIVOT : TANK_CENTER + 4);
  if (FortressArt.ready()) {
    // 차체와 플레이어 표식
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    FortressArt.sprite(ctx, FortressArt.body(t.color, t.dummy), -24, -23, 48, 25);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#173d33";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-7, -11, 14, 5, 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // 포신 반동과 포구 섬광
    const age = anim && anim.shot.player_id === t.id ? now - anim.start : Infinity;
    const recoil = !FortressArt.reduced.matches && age < 180 ? 3 * Math.sin(age / 180 * Math.PI) : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing, 1);
    ctx.rotate(-rad);
    FortressArt.sprite(ctx, "tank-barrel", -5 - recoil, -4.5, BARREL + 5, 9);
    if (age < 280 && !FortressArt.reduced.matches) {
      FortressArt.effect(ctx, "muzzle", Math.min(3, Math.floor(age / 70)), BARREL + 11, -3, 44);
    }
    ctx.restore();
  } else {
  // 기본 탱크 대체 표시
  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * facing * BARREL, cy - Math.sin(rad) * BARREL);
  ctx.stroke();

  // 몸통
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x - 15, y - 12, 30, 9, 4);
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.roundRect(x - 16, y - 5, 32, 6, 3);
  ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (!t.alive) return;

  // 이름과 체력
  const top = y - 30 * k;
  ctx.font = font(700, 15);
  ctx.textAlign = "center";
  ctx.lineWidth = 3 * ui;
  ctx.strokeStyle = "rgba(255,255,255,.8)";
  const label = t.name + (lobby.isMe(t.id) ? " (나)" : "");
  ctx.strokeText(label, x, top - 12 * ui);
  ctx.fillStyle = "#173d33";
  ctx.fillText(label, x, top - 12 * ui);
  const bw = 40 * ui;
  const bh = 6 * ui;
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(x - bw / 2, top - 6 * ui, bw, bh);
  ctx.fillStyle = t.hp > 50 ? "#3fae5a" : t.hp > 25 ? "#e0a020" : "#d64545";
  ctx.fillRect(x - bw / 2, top - 6 * ui, bw * (t.hp / 100), bh);

  if (current) {
    const bob = FortressArt.reduced.matches ? 0 : Math.sin(now / 180) * 3 * ui;
    const ty = top - 46 * ui + bob;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 8 * ui, ty);
    ctx.lineTo(x + 8 * ui, ty);
    ctx.lineTo(x, ty + 11 * ui);
    ctx.fill();
  }
}

// 조준선 (내 차례)
function drawAimGuide(t) {
  const rad = (aim.angle * Math.PI) / 180;
  const scale = Math.min(ui, 1.5);
  const cx = t.x;
  const cy = sy(t.y) - (FortressArt.ready() ? ART_PIVOT : TANK_CENTER + 4) * scale;
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(23, 61, 51, .55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(rad) * aim.facing * (BARREL + 6) * scale, cy - Math.sin(rad) * (BARREL + 6) * scale);
  ctx.lineTo(cx + Math.cos(rad) * aim.facing * 80, cy - Math.sin(rad) * 80);
  ctx.stroke();
  ctx.setLineDash([]);
}

// 바람 표시
function drawWind(wind) {
  const x = W / 2;
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.beginPath();
  ctx.roundRect(x - 100 * ui, 12, 200 * ui, 36 * ui, 18 * ui);
  ctx.fill();
  ctx.fillStyle = "#173d33";
  ctx.font = font(700, 18);
  ctx.textAlign = "center";
  const arrow = wind === 0 ? "－" : (wind < 0 ? "◀".repeat(Math.ceil(Math.abs(wind) / 4)) : "▶".repeat(Math.ceil(wind / 4)));
  ctx.fillText(`바람 ${arrow} ${Math.abs(wind)}`, x, 12 + 24 * ui);
}

function drawShell(shell) {
  // 포탄 궤적
  ctx.strokeStyle = "rgba(255, 236, 186, .8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  shell.trail.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, sy(y)));
  ctx.lineTo(shell.x, sy(shell.y));
  ctx.stroke();
  if (shell.y > H) {
    // 화면 위로 나간 포탄
    ctx.fillStyle = "#d64545";
    ctx.beginPath();
    ctx.moveTo(shell.x, 4);
    ctx.lineTo(shell.x - 7, 16);
    ctx.lineTo(shell.x + 7, 16);
    ctx.fill();
    return;
  }
  ctx.fillStyle = "#ffbd57";
  ctx.strokeStyle = "#173d33";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(shell.x, sy(shell.y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawBlast(b) {
  // 폭발 프레임과 흙 파편
  if (b.t < 720 && !FortressArt.reduced.matches) {
    const frame = Math.min(7, Math.floor(b.t / 90));
    if (FortressArt.effect(ctx, "explosion", frame, b.x, sy(b.y), b.radius * 3.2)) {
      const seconds = b.t / 1000;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - b.t / 720);
      for (let i = 0; i < 12; i++) {
        const angle = Math.PI * (0.12 + i / 14);
        const speed = 65 + (i * 31 % 90);
        const px = b.x + Math.cos(angle) * speed * seconds;
        const py = sy(b.y) - Math.sin(angle) * speed * seconds + 160 * seconds * seconds;
        ctx.fillStyle = i % 2 ? "#714a2d" : "#b88b53";
        if (!FortressArt.decoration(ctx, "rocks", i % 3, px, py, 5 + i % 4, seconds * (i % 2 ? 3 : -3))) {
          ctx.fillRect(px, py, 3 + i % 3, 3 + i % 2);
        }
      }
      ctx.restore();
      return;
    }
  }
  if (b.t >= 720) return;
  // 기본 폭발 대체 표시
  if (FortressArt.reduced.matches) {
    ctx.fillStyle = "rgba(255, 190, 80, .25)";
    ctx.beginPath();
    ctx.arc(b.x, sy(b.y), b.radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const grow = Math.min(1, b.t / 220);
  const fade = Math.max(0, 1 - b.t / 750);
  if (fade <= 0) return;
  const g = ctx.createRadialGradient(b.x, sy(b.y), 0, b.x, sy(b.y), b.radius * grow);
  g.addColorStop(0, `rgba(255, 245, 180, ${fade})`);
  g.addColorStop(.5, `rgba(255, 160, 40, ${fade * .9})`);
  g.addColorStop(1, `rgba(200, 60, 20, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, sy(b.y), b.radius * grow, 0, Math.PI * 2);
  ctx.fill();
}

function drawPopups(now) {
  popups = popups.filter((p) => now - p.start < 1300);
  ctx.font = font(800, 24);
  ctx.textAlign = "center";
  for (const p of popups) {
    const t = (now - p.start) / 1300;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = "#d63030";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3 * ui;
    const rise = FortressArt.reduced.matches ? 0 : t * 30;
    ctx.strokeText(p.text, p.x, sy(p.y + rise));
    ctx.fillText(p.text, p.x, sy(p.y + rise));
  }
  ctx.globalAlpha = 1;
}

// 전장 렌더링
function draw(now) {
  const g = lobby.state.game;
  if (!g || $("#game-view").classList.contains("hidden")) return;
  const s = scene(g, now);
  ui = Math.max(1, Math.min(2.6, W / (canvas.clientWidth || W)));
  drawSky();
  drawTerrain(s.terrain, g.sea);
  const current = lobby.state.room?.playing && !anim && !g.flying ? g.current_id : null;
  for (const t of s.tanks) drawTank(t, t.id === current, now);
  const me = tankOf(g, lobby.state.me?.id);
  if (me && aim && myTurn(g)) drawAimGuide(s.tanks.find((t) => t.id === me.id) || me);
  if (lobby.state.room?.playing) drawWind(g.wind);
  if (s.shell) drawShell(s.shell);
  if (s.blast) drawBlast(s.blast);
  drawPopups(now);
}

// ---------- 매 프레임 ----------

function tick() {
  // 프레임 시각 대신 지금 시각 (프레임 시각은 메시지를 받은 시각보다 앞설 수 있다)
  const now = performance.now();
  const g = lobby.state.game;
  const bar = $("#time-bar");
  if (g && lobby.state.room?.playing && !g.flying && !anim && g.time_total_ms) {
    const left = Math.max(0, deadline - now);
    bar.style.width = `${(left / g.time_total_ms) * 100}%`;
    bar.classList.toggle("low", left < 5000);
    $("#time-sec").textContent = Math.ceil(left / 1000);
  } else {
    bar.style.width = "0";
    $("#time-sec").textContent = "";
  }
  // 시간 끝나기 직전이면 모으던 파워로 발사
  if (charging !== null && g && myTurn(g) && deadline - now < 200) release("Space");
  if (charging !== null) {
    const p = powerAt(now);
    $("#power-bar").style.width = `${p}%`;
    $("#power-val").textContent = Math.round(p);
  }
  // 그리기 오류가 나도 다음 프레임은 계속
  try {
    draw(now);
  } catch (err) {
    anim = null;
    reportError(err);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 화면 오류 알림 (한 번만)
let reported = false;
function reportError(err) {
  console.error(err);
  lobby.reportError(err, "화면");
  if (reported) return;
  reported = true;
  lobby.toast(`화면 오류: ${err?.message || err}`);
  lobby.logSystem(`화면 오류: ${err?.message || err}`, "fail");
}
