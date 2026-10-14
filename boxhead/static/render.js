// 박스헤드 그리기: logic.snapshot() 값을 받아 캔버스에 비스듬한 탑다운 화면으로 그린다.
// 혼자 하기(내 브라우저에서 계산)와 같이 하기(방장이 보낸 값)가 같은 그림을 쓴다. 그림은 모두 코드로 그린 상자 도형.
import { BLOCKS, COLS, DIRS, MAX_HP, ROWS, WEAPONS } from "./logic.js";

const OBL = 0.68;                         // 위아래를 눌러 비스듬히 보이게 하는 비율
const FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
const SHIRTS = ["#3b6fd8", "#d8453b", "#3bb36a", "#d8a93b"];
const WEAPON_COLORS = ["#ffe9a0", "#ffb04d", "#fff3b0"];

export function createRenderer(canvas, { smooth = false } = {}) {
  const ctx = canvas.getContext("2d");
  const view = { w: 0, h: 0, dpr: 1, T: 30, cx: COLS / 2, cy: ROWS / 2 };
  const pos = new Map();                  // id → 보여 주는 자리 (같이 하기에서 부드럽게)
  const decals = [];                      // 핏자국
  const fx = [];                          // 짧은 효과 (총알 줄, 총구 불꽃, 조각, 글자)
  const tint = { hurt: 0 };
  let snap = null;
  let last = performance.now();
  let shake = 0;
  let msg = { text: "", until: 0 };

  // 화면 크기에 맞춰 칸 크기 정하기
  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== view.w || h !== view.h || dpr !== view.dpr) {
      Object.assign(view, { w, h, dpr });
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const tilesX = w < 560 ? 13 : w < 820 ? 18 : COLS;
    view.T = tilesX === COLS ? Math.min(w / COLS, (h - 28) / (ROWS * OBL + 1.2)) : w / tilesX;
  }

  // 카메라: 내 자리를 따라가되 아레나 밖은 안 보이게
  function camera(me) {
    const hw = view.w / (2 * view.T);
    const hh = view.h / (2 * view.T * OBL);
    const fx0 = me ? me.x : COLS / 2;
    const fy0 = me ? me.y : ROWS / 2;
    view.cx = hw * 2 >= COLS ? COLS / 2 : Math.max(hw, Math.min(COLS - hw, fx0));
    view.cy = hh * 2 >= ROWS + 1 ? ROWS / 2 - 0.3 : Math.max(hh - 0.6, Math.min(ROWS - hh + 0.2, fy0));
  }

  const sx = (x) => (x - view.cx) * view.T + view.w / 2;
  const sy = (y) => (y - view.cy) * view.T * OBL + view.h / 2;

  // 새 값 받기: 효과를 만들고 자리를 갱신
  function push(next) {
    snap = next;
    const now = performance.now();
    for (const e of next.ev || []) {
      if (e.type === "shot") {
        fx.push({ k: "shot", t: now, x: e.x, y: e.y, rays: e.rays, w: e.w, life: 110 });
        fx.push({ k: "flash", t: now, x: e.x, y: e.y, life: 70 });
        if (e.w === 1) shake = Math.max(shake, 2.5);
      } else if (e.type === "hit") {
        splat(e.x, e.y, 1, now);
      } else if (e.type === "kill") {
        splat(e.x, e.y, e.devil ? 3 : 2, now);
        if (e.gain) fx.push({ k: "text", t: now, x: e.x, y: e.y, text: `+${e.gain}`, color: e.devil ? "#ffcf5a" : "#ffffff", life: 700 });
      } else if (e.type === "hurt") {
        if (e.id === view.localId) tint.hurt = 1;
        splat(e.x, e.y, 1, now);
      } else if (e.type === "pickup") {
        const word = e.weapon ? `${WEAPONS[e.weapon].name} 획득!` : e.kind === "supply" ? "체력·탄약 가득!" : "탄약";
        fx.push({ k: "text", t: now, x: e.x, y: e.y - 0.3, text: word, color: "#8fe38f", life: 1100 });
      } else if (e.type === "level") {
        msg = { text: `LEVEL ${e.level}`, until: now + 1800 };
      } else if (e.type === "devils") {
        msg = { text: "악마 등장!", until: now + 2200 };
      } else if (e.type === "clear") {
        msg = { text: `클리어!  보너스 +${e.bonus}`, until: now + 2500 };
      } else if (e.type === "down") {
        splat(e.x, e.y, 3, now);
      }
    }
  }

  // 핏자국과 튀는 조각
  function splat(x, y, size, now) {
    decals.push({ x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.2, r: 0.1 + size * 0.1 + Math.random() * 0.08, a: 0.55 });
    if (decals.length > 160) decals.shift();
    for (let i = 0; i < size * 3; i++) {
      fx.push({ k: "bit", t: now, x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 3, up: 2 + Math.random() * 3, life: 450 + Math.random() * 200 });
    }
  }

  // 보여 줄 자리 (부드럽게 따라감)
  function shown(id, x, y, dt) {
    if (!smooth) return [x, y];
    let p = pos.get(id);
    if (!p) pos.set(id, (p = { x, y }));
    const k = 1 - Math.exp(-dt * 16);
    p.x += (x - p.x) * k;
    p.y += (y - p.y) * k;
    p.seen = true;
    return [p.x, p.y];
  }

  // ---------- 그리기 도구 ----------

  const box = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  function shadow(px, py, r) {
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 네모 머리 사람 (플레이어·좀비·악마가 같은 틀)
  function person(x, y, angle, o) {
    const u = view.T * (o.size || 1);
    const px = sx(x);
    const py = sy(y);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle) * OBL;
    shadow(px, py + u * 0.04, u * 0.34);
    if (o.down) {
      box(px - u * 0.42, py - u * 0.22, u * 0.84, u * 0.3, o.shirt);
      box(px + u * 0.2, py - u * 0.3, u * 0.34, u * 0.34, o.skin);
      return;
    }
    const step = o.walk ? Math.sin(o.phase * 12) * u * 0.08 : 0;
    box(px - u * 0.2, py - u * 0.3 + step, u * 0.15, u * 0.32, o.pants);
    box(px + u * 0.05, py - u * 0.3 - step, u * 0.15, u * 0.32, o.pants);
    const bodyTop = py - u * 0.76;
    box(px - u * 0.27, bodyTop, u * 0.54, u * 0.5, o.shirt);
    // 팔 (보는 쪽으로 뻗음)
    const shx = px;
    const shy = bodyTop + u * 0.14;
    const reach = o.arms || 0.3;
    ctx.strokeStyle = o.skin;
    ctx.lineWidth = Math.max(2, u * 0.11);
    ctx.lineCap = "square";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(shx + (side * u * 0.2) * Math.abs(dy) , shy);
      ctx.lineTo(shx + dx * u * reach * 1.2 + side * u * 0.06, shy + dy * u * reach);
      ctx.stroke();
    }
    if (o.gun !== undefined) {
      ctx.strokeStyle = "#1c1c20";
      ctx.lineWidth = Math.max(3, u * (o.gun === 1 ? 0.13 : 0.1));
      ctx.beginPath();
      ctx.moveTo(shx + dx * u * 0.2, shy + dy * u * 0.2);
      ctx.lineTo(shx + dx * u * (o.gun === 1 ? 0.78 : o.gun === 2 ? 0.7 : 0.55), shy + dy * u * (o.gun === 1 ? 0.78 : o.gun === 2 ? 0.7 : 0.55));
      ctx.stroke();
    }
    // 큰 네모 머리
    const hs = u * 0.58;
    const hx = px - hs / 2;
    const hy = bodyTop - hs + u * 0.06;
    box(hx, hy, hs, hs, o.skin);
    box(hx, hy, hs, Math.max(2, hs * 0.2), o.hair || o.skin);
    if (o.horns) {
      box(hx - u * 0.04, hy - u * 0.16, u * 0.14, u * 0.22, "#2a0d0d");
      box(hx + hs - u * 0.1, hy - u * 0.16, u * 0.14, u * 0.22, "#2a0d0d");
    }
    // 눈 (보는 쪽으로 쏠림)
    const ex = dx * hs * 0.14;
    const ey = Math.max(0, dy) * hs * 0.1;
    box(hx + hs * 0.22 + ex, hy + hs * 0.42 + ey, hs * 0.14, hs * 0.16, o.eye || "#111");
    box(hx + hs * 0.64 + ex, hy + hs * 0.42 + ey, hs * 0.14, hs * 0.16, o.eye || "#111");
    if (o.flash) {
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.fillRect(hx, hy, hs, bodyTop + u * 0.5 - hy);
    }
  }

  function crate(c, now) {
    const u = view.T;
    const px = sx(c.x);
    const py = sy(c.y);
    const bob = Math.sin(now / 260 + c.x) * u * 0.05;
    if (c.ttl < 6 && Math.floor(now / 160) % 2) return;
    shadow(px, py + u * 0.05, u * 0.3);
    const s = c.supply ? 0.62 : 0.5;
    box(px - u * s / 2, py - u * (s + 0.1) + bob, u * s, u * s, "#c4332d");
    box(px - u * s / 2, py - u * (s + 0.1) + bob, u * s, u * 0.1, "#e45a52");
    box(px - u * 0.04, py - u * (s + 0.02) + bob, u * 0.08, u * s * 0.7, "#fff");
    box(px - u * s * 0.35, py - u * (s * 0.55 + 0.1) + bob, u * s * 0.7, u * 0.08, "#fff");
  }

  function block(b) {
    const u = view.T;
    const hgt = u * 0.85;
    const x0 = sx(b.x);
    const x1 = sx(b.x + b.w);
    const y0 = sy(b.y) - hgt;
    const y1 = sy(b.y + b.h);
    box(x0, y0 + (y1 - y0 - hgt) , x1 - x0, hgt, "#5a4430");               // 앞면
    box(x0, y0, x1 - x0, y1 - y0 - hgt, "#8d6e47");                         // 윗면
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1 - hgt);
    ctx.moveTo(x1, y0);
    ctx.lineTo(x0, y1 - hgt);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.strokeRect(x0 + 3, y0 + (y1 - y0 - hgt) + 3, x1 - x0 - 6, hgt - 6);
  }

  // ---------- 바닥과 벽 ----------

  function floor() {
    const T = view.T;
    ctx.fillStyle = "#1b1c1f";
    ctx.fillRect(0, 0, view.w, view.h);
    const x0 = sx(0);
    const y0 = sy(0);
    const x1 = sx(COLS);
    const y1 = sy(ROWS);
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        ctx.fillStyle = (i + j) % 2 ? "#3c3f45" : "#383b41";
        ctx.fillRect(Math.floor(sx(i)), Math.floor(sy(j)), Math.ceil(T) + 1, Math.ceil(T * OBL) + 1);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= COLS; i++) {
      ctx.moveTo(sx(i), y0);
      ctx.lineTo(sx(i), y1);
    }
    for (let j = 0; j <= ROWS; j++) {
      ctx.moveTo(x0, sy(j));
      ctx.lineTo(x1, sy(j));
    }
    ctx.stroke();
    for (const d of decals) {
      ctx.fillStyle = `rgba(120,16,16,${d.a})`;
      ctx.beginPath();
      ctx.ellipse(sx(d.x), sy(d.y), d.r * T, d.r * T * OBL, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 뒤쪽 벽
    const wall = T * 0.9;
    box(x0 - T * 0.3, y0 - wall, x1 - x0 + T * 0.6, wall, "#2a2c31");
    box(x0 - T * 0.3, y0 - wall, x1 - x0 + T * 0.6, 3, "#4a4d55");
    box(x0 - T * 0.3, y0 - wall, T * 0.3, y1 - y0 + wall + T * 0.3, "#222428");
    box(x1, y0 - wall, T * 0.3, y1 - y0 + wall + T * 0.3, "#222428");
    box(x0 - T * 0.3, y1, x1 - x0 + T * 0.6, T * 0.3, "#222428");
    // 출입구 표시 (좀비가 나오는 곳)
    ctx.fillStyle = "rgba(160,30,30,.35)";
    for (const [x, y] of [[0, 8], [COLS, 8]]) ctx.fillRect(sx(x) - (x ? 0 : T * 0.3), sy(y - 1.2), T * 0.3, T * 2.4 * OBL);
  }

  // ---------- 글자와 화면 정보 ----------

  function text(str, x, y, size, color, align = "left", stroke = true) {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    if (stroke) {
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.lineJoin = "round";
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function hud(me, names, now) {
    const w = view.w;
    const compact = w < 560;
    const f = compact ? 12 : 15;
    const pad = compact ? 8 : 12;
    // 체력과 무기
    if (me) {
      const bw = compact ? 110 : 170;
      box(pad, pad, bw, 14, "rgba(0,0,0,.6)");
      const ratio = Math.max(0, me.hp / MAX_HP);
      box(pad + 2, pad + 2, (bw - 4) * ratio, 10, ratio > 0.5 ? "#5fcf5f" : ratio > 0.25 ? "#e8c24a" : "#e0483f");
      if (compact) text(me.a ? String(me.hp) : "쓰러짐", pad + bw / 2, pad + 12, 11, "#fff", "center");
      else text(me.a ? `HP ${me.hp}` : "쓰러짐", pad + bw + 8, pad + 12, f, "#fff");
      let wx = pad;
      const wy = pad + 22;
      WEAPONS.forEach((wp, i) => {
        const have = me.has[i];
        const ammo = i === 0 ? "∞" : String(me.am[i - 1]);
        const sel = me.w === i;
        const label = compact ? `${i + 1} ${ammo}` : `${i + 1} ${wp.name} ${ammo}`;
        ctx.font = `800 ${f}px ${FONT}`;
        const ww = ctx.measureText(label).width + 14;
        box(wx, wy, ww, f + 10, sel ? "rgba(255,200,60,.85)" : "rgba(0,0,0,.55)");
        text(label, wx + 7, wy + f + 3, f, !have ? "#777" : sel ? "#222" : "#fff", "left", false);
        wx += ww + 5;
      });
    }
    // 동료 체력 (같이 하기)
    let ty = pad + 22 + f + 18;
    for (const p of snap.p) {
      if (p.id === view.localId || snap.p.length < 2) continue;
      text(`${names[p.id] || "?"} ${p.a ? p.hp : "쓰러짐"}`, pad, ty, f - 1, p.a ? "#dfe8df" : "#e08080");
      ty += f + 4;
    }
    // 점수·연속 킬
    text(snap.sc.toLocaleString(), w - pad, pad + (compact ? 20 : 26), compact ? 22 : 30, "#fff", "right");
    if (snap.mu > 1) text(`×${snap.mu} 연속`, w - pad, pad + (compact ? 38 : 50), f + 1, "#ffcf5a", "right");
    if (snap.cb > 0) box(w - pad - 90, pad + (compact ? 44 : 58), 90 * snap.cbt, 4, "#ffcf5a");
    // 가운데 위: 레벨과 남은 적
    const mid = snap.lv ? `LEVEL ${snap.lv}` : "준비";
    text(mid, w / 2, pad + f + 2, f + 2, "#fff", "center");
    if (snap.ph === "wave") text(`남은 적 ${snap.left}`, w / 2, pad + f * 2 + 6, f - 1, "#c9d0c9", "center");
    if (snap.ph === "intermission" && snap.lv) text(`다음 레벨까지 ${Math.ceil(snap.pt)}초 · 상자를 먹어요`, w / 2, pad + f * 2 + 6, f - 1, "#8fe38f", "center");
    // 큰 알림
    if (now < msg.until) {
      const a = Math.min(1, (msg.until - now) / 400);
      ctx.globalAlpha = a;
      text(msg.text, w / 2, view.h * 0.3, compact ? 28 : 44, "#ffe27a", "center");
      ctx.globalAlpha = 1;
    }
    if (tint.hurt > 0) {
      const g = ctx.createRadialGradient(w / 2, view.h / 2, Math.min(w, view.h) * 0.3, w / 2, view.h / 2, Math.max(w, view.h) * 0.7);
      g.addColorStop(0, "rgba(200,0,0,0)");
      g.addColorStop(1, `rgba(200,0,0,${0.5 * tint.hurt})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, view.h);
    }
  }

  // ---------- 매 프레임 ----------

  // 한 프레임 그리기 (opts: localId, names)
  function draw(opts = {}) {
    layout();
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    view.localId = opts.localId;
    const names = opts.names || {};
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (!snap) {
      ctx.fillStyle = "#1b1c1f";
      ctx.fillRect(0, 0, view.w, view.h);
      return;
    }
    tint.hurt = Math.max(0, tint.hurt - dt * 2.2);
    shake = Math.max(0, shake - dt * 18);
    for (const p of pos.values()) p.seen = false;
    const me = snap.p.find((p) => p.id === view.localId) || snap.p.find((p) => p.a) || snap.p[0];
    const [mx, my] = me ? shown(me.id, me.x, me.y, dt) : [COLS / 2, ROWS / 2];
    camera(me ? { x: mx, y: my } : null);
    ctx.save();
    if (shake > 0.1) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    floor();

    const items = [];
    for (const b of BLOCKS) items.push([b.y + b.h, () => block(b)]);
    for (const c of snap.c) items.push([c[2], () => crate({ x: c[1], y: c[2], supply: c[3], ttl: c[4] }, now)]);
    for (const z of snap.z) {
      const [x, y] = shown(z[0], z[1], z[2], dt);
      items.push([y, () => person(x, y, z[3], { skin: "#78a857", hair: "#4f7a3a", shirt: "#56634c", pants: "#39402f", arms: 0.5, walk: true, phase: now / 1000 + z[0], flash: z[5], eye: "#3a0a0a" })]);
    }
    for (const d of snap.d) {
      const [x, y] = shown(d[0], d[1], d[2], dt);
      items.push([y, () => {
        if (d[5]) {
          ctx.fillStyle = "rgba(255,120,30,.4)";
          ctx.beginPath();
          ctx.arc(sx(x), sy(y) - view.T * 0.6, view.T * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
        person(x, y, d[3], { skin: "#cc3a2e", hair: "#8e231b", shirt: "#7a1d18", pants: "#3b0f0d", size: 1.3, arms: 0.4, horns: true, walk: true, phase: now / 900 + d[0], flash: d[4] < 1 && false, eye: "#ffe27a" });
      }]);
    }
    snap.p.forEach((p, i) => {
      const [x, y] = p.id === me?.id ? [mx, my] : shown(p.id, p.x, p.y, dt);
      const angle = Math.atan2(DIRS[p.f][1], DIRS[p.f][0]);
      items.push([y, () => {
        person(x, y, angle, { skin: "#e8cfa4", hair: "#3a2a1c", shirt: SHIRTS[i % 4], pants: "#2b2f3a", gun: p.w, arms: 0.3, down: !p.a, flash: p.st, walk: false, phase: now / 1000 });
        const px = sx(x);
        const py = sy(y) - view.T * 1.55;
        const label = names[p.id];
        if (label && snap.p.length > 1) text(label, px, py, Math.max(11, view.T * 0.38), p.id === view.localId ? "#ffe27a" : "#fff", "center");
        else if (p.id === view.localId && p.a) {
          ctx.fillStyle = "#ffe27a";
          ctx.beginPath();
          ctx.moveTo(px, py + view.T * 0.1);
          ctx.lineTo(px - view.T * 0.14, py - view.T * 0.1);
          ctx.lineTo(px + view.T * 0.14, py - view.T * 0.1);
          ctx.fill();
        }
      }]);
    });
    for (const b of snap.b) {
      items.push([b[1], () => {
        const px = sx(b[0]);
        const py = sy(b[1]) - view.T * 0.5;
        const g = ctx.createRadialGradient(px, py, 1, px, py, view.T * 0.38);
        g.addColorStop(0, "#fff7c0");
        g.addColorStop(0.4, "#ff9a2e");
        g.addColorStop(1, "rgba(255,60,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, view.T * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }]);
    }
    items.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of items) fn();

    // 효과
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      const age = now - e.t;
      if (age > e.life) {
        fx.splice(i, 1);
        continue;
      }
      const k = age / e.life;
      if (e.k === "shot") {
        ctx.strokeStyle = WEAPON_COLORS[e.w] || "#fff";
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = e.w === 1 ? 1.5 : 2.5;
        ctx.beginPath();
        for (const [a, len] of e.rays) {
          ctx.moveTo(sx(e.x), sy(e.y) - view.T * 0.55);
          ctx.lineTo(sx(e.x + Math.cos(a) * len), sy(e.y + Math.sin(a) * len) - view.T * 0.55);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.k === "flash") {
        ctx.fillStyle = `rgba(255,230,140,${1 - k})`;
        ctx.beginPath();
        ctx.arc(sx(e.x), sy(e.y) - view.T * 0.55, view.T * (0.22 - k * 0.1), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.k === "bit") {
        const t = age / 1000;
        const x = e.x + e.vx * t;
        const y = e.y + e.vy * t * 0.5;
        const h = e.up * t - 5 * t * t;
        ctx.fillStyle = `rgba(150,20,20,${1 - k})`;
        ctx.fillRect(sx(x) - 2, sy(y) - Math.max(0, h) * view.T * 0.5 - view.T * 0.3, 4, 4);
      } else if (e.k === "text") {
        ctx.globalAlpha = 1 - k * k;
        text(e.text, sx(e.x), sy(e.y) - view.T * (1.2 + k * 0.8), Math.max(12, view.T * 0.42), e.color, "center");
        ctx.globalAlpha = 1;
      }
    }
    for (const [id, p] of pos) if (!p.seen) pos.delete(id);
    ctx.restore();
    hud(me, names, now);
  }

  return {
    push,
    draw,
    clear() {
      snap = null;
      decals.length = 0;
      fx.length = 0;
      pos.clear();
    },
  };
}
