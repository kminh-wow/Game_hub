// 실행: node --test pingpong/tests
import test from "node:test";
import assert from "node:assert/strict";
import {
  AI, BALL_R, HALF_L, HALF_W, LEVELS, ME, NET_H, ZONE, aimVelocity, createMatch, dirOf, makeShot, other, serveVelocity, serverFor,
  sideOfZ, simulate, spinVec, step, swingIntent, topOf,
} from "../web/logic.js";

// 공을 끝까지 날려서 탁구대에 튄 쪽 목록
function bounces(p0, sol, n = 2) {
  const sides = [];
  let net = false;
  simulate({ p: p0, v: sol.v, w: sol.w }, 3, (b, hit) => {
    if (hit === "net") net = true;
    if (hit === "table") sides.push({ side: sideOfZ(b.p.z), x: b.p.x, z: b.p.z });
    return net || sides.length >= n;
  });
  return { sides, net };
}

// 경기 진행 (사건 모으기)
function run(s, seconds, input = () => ({})) {
  const events = [];
  for (let t = 0; t < seconds && !s.over; t += 1 / 60) events.push(...step(s, 1 / 60, input(s)));
  return events;
}

// 랠리 중인 상태 만들기 (hitter 가 방금 친 공)
function rally(s, hitter, p, v, w = { x: 0, y: 0, z: 0 }) {
  Object.assign(s, { phase: "rally", hitter, serving: false, bounces: 0, flight: 0, netTouch: false });
  s.ball = { p: { ...p }, v: { ...v }, w: { ...w } };
  s.shotId += 1;
}

test("회전: 탑스핀은 아래로, 백스핀은 위로 휜다", () => {
  const p0 = { x: 0, y: 0.3, z: 1.5 };
  const d = { x: 0, z: -1 };
  const fall = (top) => {
    let y = 0;
    simulate({ p: p0, v: { x: 0, y: 1, z: -8 }, w: spinVec(d, top) }, 0.25, (b) => ((y = b.p.y), false), true);
    return y;
  };
  assert.ok(fall(150) < fall(0) - 0.05);
  assert.ok(fall(-150) > fall(0) + 0.05);
  assert.equal(Math.round(topOf(spinVec(d, 120), d)), 120);
});

test("탑스핀은 튄 뒤 앞으로 뻗고, 백스핀은 멈칫한다", () => {
  const after = (top) => {
    let vz = 0;
    simulate({ p: { x: 0, y: 0.2, z: -0.3 }, v: { x: 0, y: -1, z: -5 }, w: spinVec({ x: 0, z: -1 }, top) }, 1, (b, hit) => {
      if (hit === "table") {
        vz = b.v.z;
        return true;
      }
      return false;
    });
    return -vz;
  };
  assert.ok(after(150) > after(0) && after(0) > after(-150));
});

test("겨냥: 드라이브·스매시·커트 모두 노린 곳 근처에 떨어지고 네트를 넘는다", () => {
  for (const [speed, top, y] of [[10, 110, 0.25], [16, 20, 0.5], [6, -90, 0.2]]) {
    const sol = aimVelocity({ x: 0.2, y, z: 1.6 }, { x: -0.3, z: -1.0 }, speed, top);
    assert.ok(Math.abs(sol.land.x + 0.3) < 0.05 && Math.abs(sol.land.z + 1.0) < 0.05, `${speed} ${top}`);
    assert.ok(sol.netY > NET_H + BALL_R, `${speed} ${top} 네트`);
  }
});

test("서브는 어디서 어떻게 넣어도 내 쪽 한 번, 상대 쪽 한 번 튄다", () => {
  const s = createMatch({ seed: 3 });
  let k = 0;
  for (const side of [ME, AI]) {
    for (const x of [-0.7, 0, 0.7]) {
      for (const z of [HALF_L + 0.15, ZONE.far]) {
        for (const type of ["drive", "cut", "block"]) {
          for (const power of [0, 1]) {
            s.ball.p = { x, y: 0.22, z: dirOf(side) * z };
            const { sides, net } = bounces(s.ball.p, serveVelocity(s, side, { type, power, tx: [-0.6, 0.6][k++ % 2] }));
            assert.ok(!net && sides[0]?.side === side && sides[1]?.side === other(side), `${side} ${x} ${z} ${type} ${power}`);
          }
        }
      }
    }
  }
});

test("휘두르는 방향으로 샷이 정해진다", () => {
  const s = createMatch({ seed: 1 });
  const pad = s.pads.me;
  s.ball.p = { x: 0, y: 0.2, z: 1.6 };
  Object.assign(pad, { vx: 0, vz: -3 });
  assert.equal(swingIntent(s, ME).type, "drive");
  Object.assign(pad, { vz: 0.2 });
  assert.equal(swingIntent(s, ME).type, "block");
  Object.assign(pad, { vz: 1.5 });
  assert.equal(swingIntent(s, ME).type, "cut");
  s.ball.p.y = 0.5;
  Object.assign(pad, { vz: -5 });
  assert.equal(swingIntent(s, ME).type, "smash");
  Object.assign(pad, { vx: 4, vz: -3 });
  assert.ok(swingIntent(s, ME).tx > 0.3);                             // 오른쪽으로 휘두르면 오른쪽
  const drive = makeShot(s, ME, { type: "drive", power: 1, tx: 0, error: 0 });
  const cut = makeShot(s, ME, { type: "cut", power: 1, tx: 0, error: 0 });
  const d = { x: 0, z: -1 };
  assert.ok(topOf(drive.w, d) > 100 && topOf(cut.w, d) < -80);
  assert.ok(Math.abs(drive.v.z) > Math.abs(cut.v.z));
});

test("받는 쪽에 두 번 튀면 친 사람 점수", () => {
  const s = createMatch({ seed: 1, bots: { me: null, ai: null } });
  s.pads.ai.x = 1.2;                                                  // 라켓이 멀리 있음
  const sol = aimVelocity({ x: 0, y: 0.25, z: 1.6 }, { x: -0.4, z: -0.5 }, 5, 0);
  rally(s, ME, { x: 0, y: 0.25, z: 1.6 }, sol.v, sol.w);
  const point = run(s, 3).find((e) => e.type === "point");
  assert.deepEqual([point.winner, point.reason], [ME, "missed"]);
  assert.equal(s.score.me, 1);
});

test("상대 쪽에 안 튀고 나가면 아웃, 네트에 걸리면 네트", () => {
  const s = createMatch({ seed: 1, bots: { me: null, ai: null } });
  const long = aimVelocity({ x: 0, y: 0.25, z: 1.6 }, { x: 0, z: -2.2 }, 10, 0);
  rally(s, ME, { x: 0, y: 0.25, z: 1.6 }, long.v, long.w);
  let point = run(s, 3).find((e) => e.type === "point");
  assert.deepEqual([point.winner, point.reason], [AI, "out"]);
  const s2 = createMatch({ seed: 1, bots: { me: null, ai: null } });
  rally(s2, ME, { x: 0, y: 0.16, z: 0.5 }, { x: 0, y: 0, z: -8 });
  const events = run(s2, 3);
  point = events.find((e) => e.type === "point");
  assert.ok(events.some((e) => e.type === "net"));
  assert.deepEqual([point.winner, point.reason], [AI, "net"]);
});

test("서브 순서: 2점마다 바뀌고 10:10부터는 1점마다", () => {
  assert.equal(serverFor({ me: 0, ai: 0 }, ME), ME);
  assert.equal(serverFor({ me: 1, ai: 0 }, ME), ME);
  assert.equal(serverFor({ me: 1, ai: 1 }, ME), AI);
  assert.equal(serverFor({ me: 3, ai: 1 }, ME), ME);
  assert.equal(serverFor({ me: 10, ai: 10 }, ME), ME);
  assert.equal(serverFor({ me: 11, ai: 10 }, ME), AI);
  assert.equal(serverFor({ me: 11, ai: 11 }, AI), AI);
});

test("11점 먼저, 듀스면 2점 차", () => {
  const s = createMatch({ seed: 1, bots: { me: null, ai: null } });
  s.score = { me: 10, ai: 10 };
  s.pads.ai.x = 1.2;
  const sol = aimVelocity({ x: 0, y: 0.25, z: 1.6 }, { x: -0.4, z: -0.5 }, 5, 0);
  rally(s, ME, { x: 0, y: 0.25, z: 1.6 }, sol.v, sol.w);
  run(s, 3);
  assert.ok(!s.over && s.score.me === 11);
  run(s, 1.3);                                                        // 다음 서브 준비 (11:10 이라 AI 서브)
  assert.deepEqual([s.phase, s.server], ["serve", AI]);
  rally(s, ME, { x: 0, y: 0.25, z: 1.6 }, sol.v, sol.w);
  const events = run(s, 3);
  assert.ok(s.over && s.winner === ME && events.some((e) => e.type === "over"));
});

test("사람 서브: 누르면 나가고, 컴퓨터는 혼자 받아친다", () => {
  const s = createMatch({ seed: 5, first: ME, level: 2 });
  run(s, 0.5, () => ({ x: 0.2, z: 1.8 }));
  assert.equal(s.phase, "serve");
  const events = run(s, 3, (st) => ({ x: 0.2, z: 1.8, serve: st.phase === "serve" }));
  assert.ok(events.some((e) => e.type === "serve" && e.side === ME));
  assert.ok(events.some((e) => e.type === "hit" && e.side === AI));
});

test("같은 시드면 같은 경기, 컴퓨터끼리 끝까지 친다", () => {
  const play = () => {
    const s = createMatch({ seed: 11, bots: { me: 1, ai: 1 } });
    run(s, 600);
    return s;
  };
  const a = play();
  const b = play();
  assert.ok(a.over && a.winner);
  assert.deepEqual(a.score, b.score);
  assert.ok(a.longest >= 3);
});

test("난이도가 높을수록 이긴다", () => {
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const s = createMatch({ seed, bots: { me: 0, ai: 2 } });
    run(s, 900);
    if (s.winner === AI) wins += 1;
  }
  assert.ok(wins >= 5);
  assert.equal(LEVELS.length, 3);
});

test("라켓은 구역 밖으로 못 나가고, 서브할 때는 끝선 뒤에 있다", () => {
  const s = createMatch({ seed: 1, first: ME });
  run(s, 1, () => ({ x: 3, z: -2 }));
  assert.ok(s.pads.me.x <= HALF_W && s.pads.me.z >= HALF_L + 0.15);
  s.phase = "dead";
  s.timer = -10;
  run(s, 1, () => ({ x: 3, z: -2 }));
  assert.ok(s.pads.me.x <= ZONE.x + 1e-9 && s.pads.me.z >= ZONE.near - 1e-9);
});
