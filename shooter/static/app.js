// 턴제 FPS 화면. 로그인·로비·대기실·채팅은 공통 로비(../common/lobby.js)가 맡고, 여기서는 3D 전장과 조작을 다룬다.
// 판정(이동 충돌, 사격, 수류탄)은 서버가 하고, 화면은 그 결과를 그린다. 그래픽은 도형으로 대충 만든 것 (디자인은 나중에 교체).
import * as THREE from "three";

const $ = (sel) => document.querySelector(sel);

const COLORS = [0xd64545, 0x2f6fd6, 0xe0a020, 0x3a9a5a];
const DUMMY_COLOR = 0x8b8b8b;
const EYE = 1.6;
const SPEED = 4.5;              // 걷는 속도(m/s)
const MOVE_EVERY = 50;          // 이동 메시지 간격(ms)
const LOOK_EVERY = 120;         // 시선 메시지 간격(ms)
const SENS = 0.0022;            // 마우스 감도
const FOV = 75;
const ZOOM_FOV = { rifle: 45, sniper: 14, grenade: 60 };
const WEAPON_KEYS = { Digit1: "rifle", Digit2: "sniper", Digit3: "grenade" };
const GRAVITY = 9.8;            // 수류탄 궤적 미리보기 (서버와 같은 값)

const lobby = GameLobby.init({
  storageKey: "shooter",
  showLastGame: true,
  handlers: {
    game(msg) {
      const prev = lobby.state.game;
      lobby.setGame(msg.game);
      try {
        if (!prev || prev.turn > msg.game.turn || boxesKey(prev) !== boxesKey(msg.game)) buildArena(msg.game);
        for (const e of msg.events) onEvent(e, msg.game);
      } catch (err) {
        lobby.reportError?.(err, "화면");
        console.error(err);
      }
      deadline = performance.now() + msg.game.time_left_ms;
    },
    look(msg) {
      const s = soldierOf(lobby.state.game, msg.id);
      if (s && !isMe(s.id)) Object.assign(s, { yaw: msg.yaw, pitch: msg.pitch });
    },
    soldier(msg) {
      const g = lobby.state.game;
      if (!g) return;
      g.soldiers = g.soldiers.map((s) => (s.id === msg.soldier.id ? { ...msg.soldier, yaw: isMe(s.id) ? s.yaw : msg.soldier.yaw } : s));
      g.move_left = msg.move_left;
      renderHud(g);
    },
    game_over(msg) {
      releasePointer();
      const solo = msg.ranking.some((r) => r.id === "dummy");
      let title = "무승부";
      if (msg.winner) title = isMe(msg.winner.id) ? (solo ? "연습 완료!" : "🏆 내가 살아남았어요!") : `🏆 ${msg.winner.name} 승리`;
      lobby.logSystem(msg.winner ? `${msg.winner.name}님이 끝까지 살아남았어요.` : "모두 쓰러졌어요. 무승부!");
      lobby.showResult(title, msg.ranking.map((r, i) => [`${i + 1}. ${r.name}`, r.alive ? `생존 · HP ${r.hp}` : "탈락"]));
    },
  },
  renderGame,
  playerRight(p) {
    const s = soldierOf(lobby.state.game, p.id);
    if (!s || !lobby.state.room?.playing) return "";
    return s.alive ? `HP ${s.hp}` : "탈락";
  },
  isTurn: (p, room) => room.playing && lobby.state.game?.current_id === p.id,
  canStart: (room, others) => others.every((p) => p.ready),
  waitingNote(room, amHost, others) {
    // 혼자일 때 상대·말투 고르기
    $("#solo-row").classList.toggle("hidden", others.length > 0);
    $("#ai-talk-row").classList.toggle("hidden", others.length > 0 || !room.settings.solo_opponent || !room.spicy);
    if (others.length === 0) {
      if (!amHost) return "";
      return room.settings.solo_opponent
        ? "혼자 시작하면 AI 와 번갈아 쏘며 대결해요."
        : "혼자 시작하면 허수아비를 상대로 연습해요(허수아비는 쏘지 않아요).";
    }
    if (amHost) return others.every((p) => p.ready) ? "모두 준비됐어요!" : "모두 준비하면 시작할 수 있어요.";
    return "방장이 게임을 시작할 때까지 기다려 주세요.";
  },
});

// ---------- 조회 ----------

const isMe = (id) => lobby.isMe(id);
const soldierOf = (g, id) => g?.soldiers.find((s) => s.id === id) || null;
const me = (g) => soldierOf(g, lobby.state.me?.id);
const boxesKey = (g) => JSON.stringify(g.boxes);

function myTurn(g) {
  return !!g && !!lobby.state.room?.playing && !g.acting && !!g.current_id && isMe(g.current_id) && !!me(g)?.alive;
}

// ---------- 상태 ----------

let deadline = 0;
let weapon = "rifle";
let zoom = false;
let view = { yaw: 0, pitch: 0 };        // 내 시선 (마우스로 돌림)
let viewReady = false;
let lastLookSent = 0;
const keys = new Set();
let lastMove = 0;
const effects = [];                      // 재생 중인 효과 {update(now) -> 끝났으면 true}

// ---------- 3D ----------

const stage = $("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc8e8);
scene.fog = new THREE.Fog(0x9cc8e8, 40, 90);
const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 200);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6b55, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(20, 40, 10);
scene.add(sun);

const arena = new THREE.Group();
scene.add(arena);
const soldierMeshes = new Map();

// 전장 만들기 (바닥 + 상자)
function buildArena(g) {
  arena.clear();
  for (const m of soldierMeshes.values()) scene.remove(m.group);
  soldierMeshes.clear();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(g.size, g.size), new THREE.MeshLambertMaterial({ color: 0x8a9a6b }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(g.size / 2, 0, g.size / 2);
  arena.add(floor);
  const grid = new THREE.GridHelper(g.size, g.size / 2, 0x6b7a52, 0x6b7a52);
  grid.position.set(g.size / 2, 0.01, g.size / 2);
  arena.add(grid);
  for (const [x0, z0, x1, z1, h] of g.boxes) {
    const color = h >= 3.9 ? 0x6e7376 : h >= 2.5 ? 0x9a8f7f : h >= 1.5 ? 0x7d6a4f : 0xa5824f;
    const box = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), new THREE.MeshLambertMaterial({ color }));
    box.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    arena.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
    edges.position.copy(box.position);
    arena.add(edges);
  }
  viewReady = false;
}

// 사람 모형 (캡슐 몸 + 머리 + 총 + 이름표)
function soldierMesh(s) {
  let m = soldierMeshes.get(s.id);
  if (m) return m;
  const color = s.dummy ? DUMMY_COLOR : COLORS[s.color % COLORS.length];
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.6, 4, 10), mat);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshLambertMaterial({ color: 0xf0c9a0 }));
  head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  visor.position.set(0, 1.66, -0.2);
  const arm = new THREE.Group();
  arm.position.set(0.22, 1.35, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), new THREE.MeshLambertMaterial({ color: 0x1d1d1d }));
  gun.position.z = -0.35;
  arm.add(gun);
  const label = makeLabel();
  label.sprite.position.y = 2.25;
  group.add(body, head, visor, arm, label.sprite);
  scene.add(group);
  m = { group, arm, label, shown: { x: s.x, z: s.z }, hp: null, name: s.name };
  soldierMeshes.set(s.id, m);
  return m;
}

// 이름표 (이름 + 체력 막대)
function makeLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return { canvas, texture, sprite };
}

function drawLabel(m, s) {
  if (m.hp === s.hp && m.alive === s.alive) return;
  m.hp = s.hp;
  m.alive = s.alive;
  const c = m.label.canvas.getContext("2d");
  c.clearRect(0, 0, 256, 64);
  c.font = "bold 26px 'Malgun Gothic', sans-serif";
  c.textAlign = "center";
  c.lineWidth = 5;
  c.strokeStyle = "rgba(0,0,0,.7)";
  c.strokeText(s.name, 128, 28);
  c.fillStyle = "#fff";
  c.fillText(s.name, 128, 28);
  c.fillStyle = "rgba(0,0,0,.5)";
  c.fillRect(48, 40, 160, 14);
  c.fillStyle = s.hp > 50 ? "#3fae5a" : s.hp > 25 ? "#e0a020" : "#d64545";
  c.fillRect(48, 40, 160 * (s.hp / 100), 14);
  m.label.texture.needsUpdate = true;
}

// 매 프레임 사람 모형 옮기기
function updateSoldiers(g, viewerId) {
  for (const s of g.soldiers) {
    const m = soldierMesh(s);
    m.shown.x += (s.x - m.shown.x) * 0.35;
    m.shown.z += (s.z - m.shown.z) * 0.35;
    m.group.position.set(m.shown.x, 0, m.shown.z);
    const yaw = isMe(s.id) && myTurn(g) ? view.yaw : s.yaw;
    const pitch = isMe(s.id) && myTurn(g) ? view.pitch : s.pitch;
    m.group.rotation.y = yaw;
    m.arm.rotation.x = pitch;
    m.group.visible = s.id !== viewerId;
    m.group.rotation.z = s.alive ? 0 : Math.PI / 2;      // 쓰러짐
    m.group.position.y = s.alive ? 0 : 0.4;
    drawLabel(m, s);
  }
}

// ---------- 카메라 ----------

// 누구 눈으로 볼지: 살아 있으면 내 눈, 아니면(관전·탈락) 지금 차례인 사람 눈
function viewer(g) {
  const mine = me(g);
  if (mine && mine.alive) return mine;
  return soldierOf(g, g.current_id) || g.soldiers.find((s) => s.alive) || g.soldiers[0];
}

function updateCamera(g) {
  const v = viewer(g);
  if (!v) return;
  const m = soldierMeshes.get(v.id);
  const pos = m ? m.shown : v;
  camera.position.set(pos.x, EYE, pos.z);
  if (isMe(v.id)) {
    if (!viewReady) {
      view = { yaw: v.yaw, pitch: v.pitch };
      viewReady = true;
    }
    camera.rotation.set(view.pitch, view.yaw, 0);
  } else {
    camera.rotation.set(v.pitch, v.yaw, 0);
  }
  const fov = zoom ? ZOOM_FOV[weapon] : FOV;
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  $("#scope").classList.toggle("hidden", !(zoom && weapon === "sniper"));
  return v;
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  const dpr = renderer.getPixelRatio();
  if (renderer.domElement.width !== Math.floor(w * dpr) || renderer.domElement.height !== Math.floor(h * dpr)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// ---------- 효과 (총알 궤적, 수류탄, 폭발) ----------

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

function tracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([v3(from), v3(to)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  scene.add(line);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true }));
  spark.position.copy(v3(to));
  scene.add(spark);
  const start = performance.now();
  effects.push((now) => {
    const t = (now - start) / 500;
    line.material.opacity = spark.material.opacity = Math.max(0, 1 - t);
    if (t < 1) return false;
    scene.remove(line, spark);
    return true;
  });
}

// 총구 위치 (내가 쏜 거면 화면 오른쪽 아래에서 나가 보이게)
function muzzle(e) {
  if (!isMe(e.player_id)) return e.from;
  const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation).multiplyScalar(0.25);
  const down = new THREE.Vector3(0, -1, 0).applyEuler(camera.rotation).multiplyScalar(0.18);
  return v3(e.from).add(right).add(down).toArray();
}

function grenadeFlight(e) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2f4f2f }));
  scene.add(ball);
  const start = performance.now();
  effects.push((now) => {
    const f = (now - start) / e.frame_ms;
    const i = Math.min(Math.floor(f), e.frames.length - 1);
    const a = e.frames[i];
    const b = e.frames[Math.min(i + 1, e.frames.length - 1)];
    const k = Math.min(1, f - i);
    ball.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    if (i < e.frames.length - 1) return false;
    scene.remove(ball);
    explosion(e.at, e.radius);
    return true;
  });
}

function explosion(at, radius) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true }));
  ball.position.copy(v3(at));
  scene.add(ball);
  const start = performance.now();
  effects.push((now) => {
    const t = (now - start) / 700;
    ball.scale.setScalar(Math.max(0.01, radius * Math.min(1, t * 2.5)));
    ball.material.opacity = Math.max(0, 0.85 * (1 - t));
    if (t < 1) return false;
    scene.remove(ball);
    return true;
  });
}

function flash() {
  const el = $("#hit-flash");
  el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), 60);
}

let msgTimer = null;
function centerMessage(text) {
  $("#center-msg").textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ($("#center-msg").textContent = ""), 1800);
}

// 서버 사건 처리
function onEvent(e, g) {
  const name = (id) => soldierOf(g, id)?.name || "";
  if (e.kind === "turn") {
    zoom = false;
    if (isMe(e.player_id)) {
      lastLookSent = 0;                    // 보고 있던 방향 그대로, 바로 서버에 알림
      centerMessage("내 차례! 움직이고, 조준하고, 쏘세요");
    } else {
      centerMessage(`${name(e.player_id)}님 차례`);
    }
  }
  if (e.kind === "timeout") lobby.logSystem(`${name(e.player_id)}님 시간 초과`);
  if (e.kind === "pass") lobby.logSystem(`${name(e.player_id)}님 차례 끝`);
  if (e.kind === "left") lobby.logSystem(`${name(e.player_id)}님이 나가서 탈락했어요.`);
  if (e.kind !== "shot") return;
  const shooter = soldierOf(g, e.player_id);
  if (shooter && !isMe(shooter.id)) Object.assign(shooter, { yaw: e.yaw, pitch: e.pitch });
  if (e.weapon === "grenade") grenadeFlight(e);
  else tracer(muzzle(e), e.to, e.weapon === "sniper" ? 0xff5050 : 0xfff3b0);
  setTimeout(() => {
    for (const r of e.results) {
      const what = r.part === "head" ? "헤드샷" : r.part === "blast" ? "폭발" : "명중";
      lobby.logSystem(`${name(e.player_id)} → ${name(r.id)} ${what} -${r.damage}${r.dead ? " (탈락)" : ""}`, r.dead ? "fail" : "sys");
      if (isMe(r.id)) flash();
      if (isMe(e.player_id) && r.id !== e.player_id) centerMessage(r.dead ? "처치!" : r.part === "head" ? "헤드샷!" : `명중 -${r.damage}`);
      if (isMe(r.id) && r.dead) centerMessage("쓰러졌어요… 관전으로 바뀝니다");
    }
    if (!e.results.length && isMe(e.player_id)) centerMessage("빗나감");
  }, e.landed_ms);
}

// ---------- 화면 (DOM) ----------

function renderGame(g, room) {
  const finished = !room.playing;
  $("#chips").replaceChildren(
    ...g.soldiers.map((s) => {
      const chip = lobby.el("span", {
        className: [s.id === g.current_id && !finished && "turn", !s.alive && "dead"].filter(Boolean).join(" "),
      }, lobby.el("i"), `${s.name}${isMe(s.id) ? " (나)" : ""} ${s.hp}`);
      chip.firstChild.style.background = `#${(s.dummy ? DUMMY_COLOR : COLORS[s.color % COLORS.length]).toString(16).padStart(6, "0")}`;
      return chip;
    })
  );
  let text = "";
  if (finished) text = "지난 판";
  else if (g.acting) text = "사격 중…";
  else if (myTurn(g)) text = "내 차례!";
  else text = `${soldierOf(g, g.current_id)?.name || ""}님 차례`;
  $("#turn-info").textContent = text;
  $("#game-view .bar-row").classList.toggle("hidden", finished);
  renderHud(g);
}

function renderHud(g) {
  const mine = me(g);
  const playing = !!mine && !!lobby.state.room?.playing;
  $("#help").classList.toggle("hidden", !playing);
  $("#hp-val").textContent = mine ? mine.hp : "-";
  $("#move-bar").style.width = `${myTurn(g) ? (g.move_left / g.move_max) * 100 : 0}%`;
  const mineTurn = myTurn(g) || (!!g.acting && isMe(g.current_id));
  if (g.turn_weapon && isMe(g.current_id)) weapon = g.turn_weapon;     // 한 차례에 한 종류
  else if (mine && mine.stock?.[weapon] === 0) weapon = Object.keys(g.weapons).find((id) => mine.stock[id] > 0) || weapon;
  // 이번 차례 남은 발
  const spec = g.weapons[weapon] || {};
  const used = isMe(g.current_id) && g.turn_weapon === weapon ? g.shots : 0;
  $("#shots-info").textContent = mineTurn ? `이번 차례 ${spec.name} ${spec.per_turn - used}/${spec.per_turn}발` : "";
  $("#btn-end-turn").classList.toggle("hidden", !myTurn(g));
  $("#weapons").replaceChildren(
    ...Object.entries(g.weapons).map(([id, w], i) => {
      const left = mine?.stock?.[id];
      const locked = isMe(g.current_id) && g.turn_weapon && g.turn_weapon !== id;
      const b = lobby.el("button", {
        type: "button",
        className: weapon === id ? "on" : "",
        textContent: `${i + 1} ${w.name} ${left ?? "∞"}`,
        title: `${w.name}: 남은 탄 ${left ?? "∞"} · 한 차례에 ${w.per_turn}발`,
        disabled: !playing || left === 0 || !!locked,
      });
      b.onclick = () => selectWeapon(id);
      return b;
    })
  );
}

function selectWeapon(id) {
  const g = lobby.state.game;
  if (me(g)?.stock?.[id] === 0) return;
  if (g?.turn_weapon && isMe(g.current_id) && g.turn_weapon !== id) return;
  weapon = id;
  if (g) renderHud(g);
}

// ---------- 입력 ----------

const locked = () => document.pointerLockElement === stage;
const typing = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

function releasePointer() {
  if (locked()) document.exitPointerLock();
  keys.clear();
  zoom = false;
}

stage.addEventListener("click", () => {
  if (!locked() && lobby.state.room?.playing) stage.requestPointerLock?.();
});
stage.addEventListener("contextmenu", (e) => e.preventDefault());
stage.addEventListener("mousedown", (e) => {
  if (!locked()) return;
  const g = lobby.state.game;
  if (e.button === 2) zoom = true;
  if (e.button === 0 && myTurn(g)) fire(g);
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 2) zoom = false;
});
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const k = zoom ? (weapon === "sniper" ? 0.2 : 0.5) : 1;
  view.yaw -= e.movementX * SENS * k;
  view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch - e.movementY * SENS * k));
});
document.addEventListener("pointerlockchange", () => {
  if (!locked()) {
    keys.clear();
    zoom = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (typing(e) || $("#game-view").classList.contains("hidden")) return;
  if (WEAPON_KEYS[e.code]) return selectWeapon(WEAPON_KEYS[e.code]);
  if (e.code === "KeyE" && myTurn(lobby.state.game)) return endTurn();
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code) && lobby.state.room?.playing) {
    keys.add(e.code);
    e.preventDefault();
  }
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

function fire(g) {
  lobby.send("fire", { weapon, yaw: view.yaw, pitch: view.pitch });
  if (weapon !== "rifle") zoom = false;
}

// 차례 끝내기
function endTurn() {
  lobby.send("end_turn");
  zoom = false;
}
$("#btn-end-turn").onclick = endTurn;

// 이동과 시선 보내기
function sendInput(g, now) {
  if (!myTurn(g) || !viewReady) return;
  if (now - lastLookSent > LOOK_EVERY) {
    const mine = me(g);
    if (Math.abs(mine.yaw - view.yaw) > 0.002 || Math.abs(mine.pitch - view.pitch) > 0.002) {
      lastLookSent = now;
      mine.yaw = view.yaw;
      mine.pitch = view.pitch;
      lobby.send("look", { yaw: view.yaw, pitch: view.pitch });
    }
  }
  if (!keys.size || now - lastMove < MOVE_EVERY || g.move_left <= 0) return;
  lastMove = now;
  const f = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const r = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  if (!f && !r) return;
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  let dx = -sin * f + cos * r;
  let dz = -cos * f - sin * r;
  const len = Math.hypot(dx, dz);
  const stepLen = (SPEED * MOVE_EVERY) / 1000;
  dx = (dx / len) * stepLen;
  dz = (dz / len) * stepLen;
  lobby.send("move", { dx, dz });
}

// ---------- 조준선 ----------

const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

// 탄 퍼짐을 화면 픽셀로 (퍼짐 각도 → 시야각 대비 비율)
function spreadPx(deg) {
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  return Math.tan(THREE.MathUtils.degToRad(deg)) / Math.tan(half) * (stage.clientHeight / 2);
}

// 조준선 모양, 겨눈 대상(이름·거리), 수류탄 궤적
function updateAim(g, v) {
  const cross = $("#crosshair");
  const info = $("#aim-info");
  const alive = !!me(g)?.alive && isMe(v?.id);
  const scoped = zoom && weapon === "sniper";
  cross.classList.toggle("hidden", !alive || scoped);
  info.classList.toggle("hidden", !alive);
  arc.visible = ring.visible = false;
  if (!alive) return;
  const spec = g.weapons[weapon] || {};
  cross.classList.toggle("grenade", weapon === "grenade");
  cross.style.setProperty("--gap", `${Math.max(3, spreadPx(spec.spread || 0) * 1.2)}px`);

  // 화면 가운데가 가리키는 것
  raycaster.setFromCamera(center, camera);
  const targets = [...arena.children.filter((o) => o.isMesh)];
  for (const [id, m] of soldierMeshes) if (id !== v.id && m.group.visible) targets.push(m.group);
  const hit = raycaster.intersectObjects(targets, true)[0];
  let enemy = null;
  if (hit) {
    for (const [id, m] of soldierMeshes) {
      let o = hit.object;
      while (o && o !== m.group) o = o.parent;
      if (o) enemy = soldierOf(g, id);
    }
  }
  const live = enemy && enemy.alive;
  cross.classList.toggle("enemy", !!live && weapon !== "grenade");
  info.classList.toggle("enemy", !!live);
  if (weapon === "grenade") {
    const land = myTurn(g) ? drawArc(g, spec) : null;
    info.textContent = land ? `착지 ${land.toFixed(1)}m` : "";
  } else if (hit) {
    info.textContent = live ? `${enemy.name} · ${hit.distance.toFixed(1)}m` : `${hit.distance.toFixed(1)}m`;
  } else {
    info.textContent = "";
  }
}

// 수류탄 궤적 미리보기 (서버와 같은 방식으로 날려 보고, 처음 닿는 곳까지 선을 그림)
const arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xfff3b0, dashSize: 0.3, gapSize: 0.2 }));
arc.frustumCulled = false;
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2;
scene.add(arc, ring);

function solidAt(g, p) {
  if (p.y <= 0) return true;
  return g.boxes.some(([x0, z0, x1, z1, h]) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y <= h);
}

function drawArc(g, spec) {
  if (!spec.speed) return null;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(view.pitch, view.yaw, 0, "YXZ"));
  const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.6));
  pos.y -= 0.1;
  const vel = dir.multiplyScalar(spec.speed);
  const pts = [pos.clone()];
  const dt = 1 / 60;
  for (let t = 0; t < (spec.fuse || 4); t += dt) {
    vel.y -= GRAVITY * dt;
    pos.addScaledVector(vel, dt);
    pts.push(pos.clone());
    if (solidAt(g, pos)) break;
  }
  arc.geometry.setFromPoints(pts);
  arc.computeLineDistances();
  arc.visible = true;
  const end = pts[pts.length - 1];
  ring.position.set(end.x, Math.max(0.03, end.y + 0.03), end.z);
  ring.scale.setScalar(spec.radius || 4.5);
  ring.visible = true;
  return camera.position.distanceTo(end);
}

// ---------- 매 프레임 ----------

function tick(now) {
  const g = lobby.state.game;
  try {
    const bar = $("#time-bar");
    if (g && lobby.state.room?.playing && !g.acting && g.time_total_ms) {
      const left = Math.max(0, deadline - now);
      bar.style.width = `${(left / g.time_total_ms) * 100}%`;
      bar.classList.toggle("low", left < 5000);
      $("#time-sec").textContent = Math.ceil(left / 1000);
    } else {
      bar.style.width = "0";
      $("#time-sec").textContent = "";
    }
    if (g && !$("#game-view").classList.contains("hidden")) {
      resize();
      const v = updateCamera(g);
      sendInput(g, now);
      updateSoldiers(g, v?.id);
      for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
      updateAim(g, v);
      renderer.render(scene, camera);
    }
  } catch (err) {
    console.error(err);
    lobby.reportError?.(err, "화면");
  }
  requestAnimationFrame(tick);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__shooter = { lobby, fire: () => fire(lobby.state.game), setView: (yaw, pitch) => (view = { yaw, pitch }), setZoom: (on) => (zoom = on) };
}
requestAnimationFrame(tick);

// 점검용 손잡이 (자동 테스트·디버깅)
window.__shooter = { lobby, fire: () => fire(lobby.state.game), setView: (yaw, pitch) => (view = { yaw, pitch }), setZoom: (on) => (zoom = on) };
