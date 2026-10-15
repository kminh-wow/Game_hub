// 홀덤 3D 테이블: three.js 로 테이블·사람·카드·칩을 그린다. 게임 상태(g)를 받아 모양만 맞춘다.
// 카드·칩·펠트 무늬는 캔버스로 직접 그리고, 사람(Kenney)·나무 질감·조명(HDR)은 CC0 에셋.
// 좌표: 테이블 가운데가 원점, 펠트 윗면이 y=0. 내 자리는 늘 화면 아래(+z) 쪽.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

const A = 3.0;                       // 테이블 반폭 (x)
const B = 1.75;                      // 테이블 반깊이 (z)
const FLOOR_Y = -0.8;
const CARD_W = 0.34;
const CARD_D = 0.48;
const CHIP_R = 0.07;
const CHIP_H = 0.024;
const DECK_POS = new THREE.Vector3(0, 0.02, -B + 0.45);
const RANK_TEXT = { T: "10" };
const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RED = new Set(["h", "d"]);
const TINTS = [0xffffff, 0xffd6d6, 0xd6e4ff, 0xd9ffd6, 0xfff1c9, 0xf0d6ff, 0xd6fff7, 0xffe0c4];
const CHIP_KINDS = [                 // 칩 금액(큰 블라인드 배수)과 색
  [100, 0xe8b520, 0x7a5a00], [25, 0x8e44c9, 0xf2e6ff], [5, 0x222428, 0xe6e6e6],
  [1, 0x2f9e57, 0xffffff], [0.5, 0xd8443a, 0xffffff], [0.1, 0xf2f2f2, 0x2b5fb8],
];

export async function createTable(host) {
  // ---------- 기본 ----------
  const canvas = document.createElement("canvas");
  canvas.className = "table-3d";
  canvas.setAttribute("aria-label", "홀덤 3D 테이블");
  host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2324);
  scene.fog = new THREE.Fog(0x1b2324, 11, 22);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x24302c, 0.9));
  const lamp = new THREE.SpotLight(0xfff0d8, 70, 16, 0.75, 0.55, 1.6);
  lamp.position.set(0, 6.5, 0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.02;
  scene.add(lamp, lamp.target);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  fill.position.set(-5, 6, 6);
  scene.add(fill);

  // ---------- 바닥·테이블 ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  const felt = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.1, 96),
    [new THREE.MeshStandardMaterial({ color: 0x0f4d33, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: 0x0f4d33 })],
  );
  felt.scale.set(A, 1, B);
  felt.position.y = -0.05;
  felt.receiveShadow = true;
  scene.add(felt);

  const railPath = new THREE.CatmullRomCurve3(Array.from({ length: 96 }, (_, i) => {
    const t = (i / 96) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(t) * (A + 0.12), 0, Math.sin(t) * (B + 0.12));
  }), true);
  const rail = new THREE.Mesh(new THREE.TubeGeometry(railPath, 192, 0.2, 16, true), new THREE.MeshStandardMaterial({ color: 0x3a2014, roughness: 0.45, metalness: 0.05 }));
  rail.castShadow = rail.receiveShadow = true;
  scene.add(rail);

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.92, 0.42, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.7, side: THREE.DoubleSide }));
  skirt.scale.set(A + 0.12, 1, B + 0.12);
  skirt.position.y = -0.3;
  scene.add(skirt);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, -FLOOR_Y - 0.4, 24), new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 0.6 }));
  leg.position.y = (FLOOR_Y - 0.4) / 2 - 0.1;
  leg.castShadow = true;
  scene.add(leg);

  loadWood(floor.material);
  loadLight(scene);

  // ---------- 자리 (의자·사람) ----------
  const seats = [];                  // 보이는 자리 (내 자리가 0)
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x5b1f1f, roughness: 0.6 });
  for (let k = 0; k < 8; k++) {
    const chair = new THREE.Group();
    const seatBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.58), chairMat);
    seatBox.position.y = FLOOR_Y + 0.48;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.1), chairMat);
    back.position.set(0, FLOOR_Y + 0.9, 0.3);
    for (const m of [seatBox, back]) m.castShadow = true;
    chair.add(seatBox, back);
    chair.visible = false;
    scene.add(chair);
    seats.push({ chair, person: null, tint: TINTS[k], k });
  }

  const people = await loadPeople(8);
  people.forEach((p, i) => {
    p.model.visible = false;
    scene.add(p.model);
    seats[i].person = p;
    p.model.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.setHex(TINTS[i]);
      }
    });
  });

  // ---------- 카드·칩 ----------
  const cardGeo = new THREE.BoxGeometry(CARD_W, 0.006, CARD_D);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.55 });
  const faceMats = new Map();
  const faceMat = (card) => {
    if (!faceMats.has(card)) faceMats.set(card, new THREE.MeshStandardMaterial({ map: faceTexture(card), roughness: 0.5 }));
    return faceMats.get(card);
  };
  // 카드 한 장 (윗면이 앞면, 뒤집으면 뒷면)
  const makeCard = (card) => {
    const mesh = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, card ? faceMat(card) : backMat, backMat, edgeMat, edgeMat]);
    mesh.castShadow = true;
    mesh.position.copy(DECK_POS);
    mesh.rotation.z = Math.PI;                                        // 처음엔 뒷면
    mesh.userData = { card, to: null };
    scene.add(mesh);
    return mesh;
  };

  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);
  const chipMats = CHIP_KINDS.map(([, color, stripe]) => [
    new THREE.MeshStandardMaterial({ map: chipSide(color, stripe), roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: chipTop(color, stripe), roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
  ]);
  // 칩 더미 (금액을 큰 블라인드 기준 칩으로 나눠 쌓음, 최대 3줄)
  const makeStack = (amount, bb) => {
    const group = new THREE.Group();
    let left = amount;
    const cols = [];
    for (let i = 0; i < CHIP_KINDS.length && left > 0; i++) {
      const value = Math.max(1, Math.round(CHIP_KINDS[i][0] * bb));
      let n = Math.floor(left / value);
      if (i === CHIP_KINDS.length - 1 && left > 0) n = Math.max(n, 1);
      left -= n * value;
      if (n > 0) cols.push([i, Math.min(n, 12)]);
    }
    cols.slice(0, 4).forEach(([kind, n], c) => {
      for (let j = 0; j < n; j++) {
        const chip = new THREE.Mesh(chipGeo, chipMats[kind]);
        chip.position.set((c % 2) * CHIP_R * 2.15 - (cols.length > 1 ? CHIP_R : 0), CHIP_H / 2 + j * CHIP_H, Math.floor(c / 2) * CHIP_R * 2.15);
        chip.rotation.y = j * 0.7;
        chip.castShadow = true;
        group.add(chip);
      }
    });
    group.userData = { amount, to: null };
    scene.add(group);
    return group;
  };

  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 32), [
    new THREE.MeshStandardMaterial({ color: 0xdddddd }), new THREE.MeshStandardMaterial({ map: buttonTexture() }), new THREE.MeshStandardMaterial({ color: 0xdddddd }),
  ]);
  button.castShadow = true;
  button.visible = false;
  button.userData = { to: null };
  scene.add(button);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  // ---------- 배치 ----------
  let count = 2;                     // 앉은 사람 수
  let topView = false;
  let viewChosen = false;            // 시점 버튼을 눌렀으면 자동으로 안 바꿈
  const angleOf = (k) => Math.PI / 2 + (k * Math.PI * 2) / count;
  const onEllipse = (k, dx, dz = dx) => {
    const t = angleOf(k);
    return new THREE.Vector3(Math.cos(t) * (A + dx), 0, Math.sin(t) * (B + dz));
  };
  // 자리 k 의 개인 카드 두 장 자리
  const holeSpot = (k, i) => {
    if (k === 0 && mineBig) return { pos: new THREE.Vector3((i - 0.5) * 0.52, 0.16, B - 0.42), rx: 0.75, ry: 0, scale: 1.4 };
    const t = angleOf(k);
    const c = onEllipse(k, -0.62, -0.5);
    const side = new THREE.Vector3(-Math.sin(t), 0, Math.cos(t)).multiplyScalar((i - 0.5) * 0.3);
    return { pos: c.add(side).setY(0.01 + i * 0.007), rx: 0, ry: -t + Math.PI / 2, scale: 1 };
  };
  const betSpot = (k) => (k === 0 && mineBig ? new THREE.Vector3(0.95, 0, B - 0.5) : onEllipse(k, -1.12, -0.82).setY(0));   // 내 칩은 카드 오른쪽
  const potSpot = new THREE.Vector3(1.05, 0, 0.25);                // 바닥 카드 오른쪽 앞
  const BOARD_SCALE = 1.25;           // 바닥 카드는 조금 크게
  const boardSpot = (i) => new THREE.Vector3((i - 2) * (CARD_W * BOARD_SCALE + 0.07), 0.01, -0.3);
  let mineBig = true;

  function layout() {
    for (const s of seats) {
      const on = s.k < count;
      const t = angleOf(s.k);
      const p = onEllipse(s.k, 0.72, 0.7);
      s.chair.visible = on && (s.k !== 0 || topView || !mineBig);
      s.chair.position.set(p.x, 0, p.z);
      s.chair.rotation.y = Math.PI / 2 - t;                         // 등받이는 바깥쪽
      if (s.person) {
        s.person.model.visible = on && (s.k !== 0 || topView || !mineBig);
        s.person.model.position.set(p.x, s.person.base, p.z);
        s.person.model.rotation.y = -t - Math.PI / 2;
      }
    }
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const narrow = w / h < 1.1;
    camera.fov = narrow ? 50 : 40;
    // 테이블과 양옆 자리가 가로로 다 들어오는 거리
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const fit = (A + 1.15) / Math.tan(half) + (topView ? 0 : 1.2);
    const dist = Math.max(topView ? 8.6 : 7.8, fit);
    const tilt = THREE.MathUtils.degToRad(topView ? 84 : narrow ? 58 : mineBig ? 38 : 52);   // 관전은 조금 위에서
    const target = new THREE.Vector3(0, -0.2, topView ? 0.15 : narrow ? 0.4 : 0.25);
    camera.position.set(0, target.y + Math.sin(tilt) * dist, target.z + Math.cos(tilt) * dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  // ---------- 상태 맞추기 ----------
  const holes = new Map();           // 자리 id → [카드 메쉬 2]
  const boardCards = [];
  const stacks = new Map();          // 자리 id → 베팅 칩 더미
  let pot = null;
  let lastHand = -1;
  let lastResults = "";
  let order = [];                    // 보이는 자리 순서의 자리 정보
  const removeLater = [];

  const tween = (obj, pos, extra = {}) => {
    obj.userData.to = { pos: pos.clone(), ...extra };
  };
  const drop = (obj) => {
    scene.remove(obj);
  };

  function update(g, meId) {
    const n = g.seats.length;
    const mineAt = Math.max(0, g.seats.findIndex((s) => s.id === meId));
    order = g.seats.map((_, k) => g.seats[(mineAt + k) % n]);
    const seated = g.seats.some((s) => s.id === meId);
    if (seated !== mineBig || (!viewChosen && topView === seated)) {
      mineBig = seated;
      if (!viewChosen) topView = !seated;                             // 관전은 위에서 보기로 시작
      layout();
      resize();
    }
    if (count !== n) {
      count = n;
      layout();
    }
    layout();
    const bb = g.blinds[1];

    // 새 판: 카드·칩 정리하고 다시 돌리기
    if (g.hand_no !== lastHand) {
      lastHand = g.hand_no;
      for (const cards of holes.values()) cards.forEach(drop);
      holes.clear();
      boardCards.splice(0).forEach(drop);
      for (const s of stacks.values()) drop(s);
      stacks.clear();
      if (pot) drop(pot);
      pot = null;
      lastResults = "";
      let delay = 0;
      for (let round = 0; round < 2; round++) {
        order.forEach((s, k) => {
          if (!s.has_cards && !s.cards) return;
          if (!holes.has(s.id)) holes.set(s.id, []);
          const mesh = makeCard(null);
          mesh.userData.delay = delay;
          delay += 0.08;
          holes.get(s.id).push(mesh);
        });
      }
    }

    // 개인 카드 (앞면이 보이면 바꿔 끼움, 폴드하면 치움)
    order.forEach((s, k) => {
      const cards = holes.get(s.id);
      if (!cards) return;
      if (!s.has_cards && !s.cards) {
        cards.forEach((c) => {
          tween(c, DECK_POS.clone().setY(0.02), { rz: Math.PI, rx: 0, ry: 0, scale: 1, fade: true });
        });
        holes.delete(s.id);
        removeLater.push(...cards);
        return;
      }
      cards.forEach((c, i) => {
        const card = s.cards?.[i] || null;
        if (card && c.userData.card !== card) {
          c.material[2] = faceMat(card);
          c.userData.card = card;
        }
        const spot = holeSpot(k, i);
        tween(c, spot.pos, { rx: spot.rx, ry: spot.ry, rz: card ? 0 : Math.PI, scale: spot.scale });
      });
    });

    // 바닥 카드
    for (let added = 0; boardCards.length < g.board.length; added++) {
      const i = boardCards.length;
      const mesh = makeCard(g.board[i]);
      mesh.userData.delay = added * 0.14;
      boardCards.push(mesh);
      tween(mesh, boardSpot(i), { rz: 0, rx: 0, ry: 0, scale: BOARD_SCALE });
    }

    // 베팅 칩 (라운드가 끝나 0 이 되면 팟으로)
    order.forEach((s, k) => {
      const have = stacks.get(s.id);
      if (have && have.userData.amount === s.bet) return;
      if (have) {
        stacks.delete(s.id);
        if (s.bet === 0) {
          tween(have, potSpot, { fade: true });
          removeLater.push(have);
        } else drop(have);
      }
      if (s.bet > 0) {
        const st = makeStack(s.bet, bb);
        st.position.copy(have ? have.position : betSpot(k).multiplyScalar(1.35));
        tween(st, betSpot(k));
        stacks.set(s.id, st);
      }
    });

    // 팟 (베팅 칩을 뺀 나머지), 결과가 나오면 이긴 사람 쪽으로
    const potAmount = g.pot - g.seats.reduce((a, s) => a + s.bet, 0);
    const results = JSON.stringify(g.results || []);
    if (g.results?.length && results !== lastResults) {
      lastResults = results;
      if (pot) drop(pot);
      pot = null;
      g.results.filter((r) => r.amount > 0).forEach((r) => {
        const k = order.findIndex((s) => s.id === r.id);
        const st = makeStack(r.amount, bb);
        st.position.copy(potSpot);
        tween(st, betSpot(k).multiplyScalar(1.05));
        removeLater.push(st);
        st.userData.ttl = 4;
      });
    } else if (!g.results?.length && (!pot || pot.userData.amount !== potAmount)) {
      if (pot) drop(pot);
      pot = potAmount > 0 ? makeStack(potAmount, bb) : null;
      if (pot) pot.position.copy(potSpot);
    }

    // 카드 빛내기: 판이 끝나면 이긴 사람의 5장(바닥·손패 모두), 아니면 내 족보를 만드는 카드
    const winners = (g.results || []).filter((r) => r.amount > 0 && r.best);
    const key = new Set(winners.length ? winners.flatMap((r) => r.best) : g.me?.key || []);
    for (const [card, mat] of faceMats) mat.emissive.setHex(key.has(card) ? (winners.length ? 0x8a6a00 : 0x5a4300) : 0x000000);

    // 딜러 버튼·차례 표시
    const dk = order.findIndex((s) => s.dealer);
    button.visible = dk >= 0;
    if (dk >= 0) {
      const t = angleOf(dk);
      const p = onEllipse(dk, -0.62, -0.5).add(new THREE.Vector3(-Math.sin(t), 0, Math.cos(t)).multiplyScalar(-0.42)).setY(0.015);
      if (!button.userData.placed) {
        button.position.copy(p);
        button.userData.placed = true;
      }
      tween(button, p);
    }
    const tk = order.findIndex((s) => s.id === g.turn_id);
    ring.visible = tk >= 0;
    if (tk >= 0) ring.position.copy(onEllipse(tk, -0.62, -0.5).setY(0.004));

    // 사람 동작 (폴드면 고개, 이기면 끄덕)
    order.forEach((s, k) => {
      const p = seats[k].person;
      if (!p) return;
      const won = g.results?.some((r) => r.id === s.id && r.amount > 0);
      p.play(s.out ? "die" : won ? "emote-yes" : s.folded ? "emote-no" : g.turn_id === s.id ? "interact-right" : "sit");
    });
  }

  // ---------- 매 프레임 ----------
  const clock = new THREE.Clock();
  const listeners = [];
  const v = new THREE.Vector3();

  function step() {
    const dt = Math.min(0.2, clock.getDelta());
    const k = 1 - Math.exp(-dt * 9);
    scene.traverse((o) => {
      const to = o.userData?.to;
      if (!to) return;
      if (o.userData.delay > 0) {
        o.userData.delay -= dt;
        return;
      }
      o.position.lerp(to.pos, k);
      if (to.rx !== undefined) o.rotation.x += (to.rx - o.rotation.x) * k;
      if (to.ry !== undefined) o.rotation.y += (to.ry - o.rotation.y) * k;
      if (to.rz !== undefined) o.rotation.z += (to.rz - o.rotation.z) * k;
      if (to.scale !== undefined) o.scale.setScalar(o.scale.x + (to.scale - o.scale.x) * k);
      if (o.userData.ttl !== undefined) o.userData.ttl -= dt;
    });
    for (let i = removeLater.length - 1; i >= 0; i--) {
      const o = removeLater[i];
      const to = o.userData.to;
      const near = !to || o.position.distanceTo(to.pos) < 0.02;
      if ((near && o.userData.ttl === undefined) || o.userData.ttl < 0) {
        drop(o);
        removeLater.splice(i, 1);
      }
    }
    ring.material.opacity = 0.55 + Math.sin(performance.now() / 180) * 0.3;
    for (const s of seats) s.person?.mixer.update(dt);
    renderer.render(scene, camera);
    for (const fn of listeners) fn();
    requestAnimationFrame(step);
  }
  resize();
  layout();
  requestAnimationFrame(step);

  // 화면 좌표 (이름표 자리 잡기용)
  const toScreen = (p) => {
    v.copy(p).project(camera);
    return { x: (v.x * 0.5 + 0.5) * host.clientWidth, y: (-v.y * 0.5 + 0.5) * host.clientHeight, behind: v.z > 1 };
  };

  return {
    update,
    onFrame: (fn) => listeners.push(fn),
    // 보이는 자리 k 의 이름표 자리 (머리 위, 내 자리는 카드 아래)
    seatScreen(k) {
      if (k === 0 && mineBig && !topView) return { ...toScreen(new THREE.Vector3(0, 0.0, B + 0.55)), anchor: "top" };
      const p = onEllipse(k, 0.72, 0.7);
      return { ...toScreen(p.setY(topView ? 0.3 : 1.05)), anchor: "bottom" };     // 머리 위로 자람 (카드를 안 가림)
    },
    betScreen: (k) => toScreen(k === 0 && mineBig ? betSpot(0).add(new THREE.Vector3(0, 0.3, 0)) : betSpot(k).multiplyScalar(0.8).setY(0.05)),   // 칩 위·가운데 쪽 (카드를 안 가림)
    potScreen: () => ({ ...toScreen(potSpot.clone().add(new THREE.Vector3(0, 0.32, 0))), anchor: "bottom" }),
    get topView() {
      return topView;
    },
    toggleView() {
      viewChosen = true;
      topView = !topView;
      layout();
      resize();
      return topView;
    },
  };
}

// ---------- 불러오기 ----------

// 나무 바닥 질감
async function loadWood(material) {
  const loader = new THREE.TextureLoader();
  try {
    const [map, normalMap, roughnessMap] = await Promise.all(["color", "normal", "rough"].map((k) => loader.loadAsync(new URL(`./assets/wood-${k}.jpg`, import.meta.url).href)));
    for (const t of [map, normalMap, roughnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(10, 10);
      t.anisotropy = 8;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    Object.assign(material, { map, normalMap, roughnessMap, roughness: 1, color: new THREE.Color(0xb59a85) });
    material.needsUpdate = true;
  } catch (err) {
    console.warn("wood", err);
  }
}

// 반사·은은한 조명 (HDR)
function loadLight(scene) {
  new HDRLoader().load(new URL("./assets/arena.hdr", import.meta.url).href, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.environmentIntensity = 0.35;
  }, undefined, (err) => console.warn("arena.hdr", err));
}

// Kenney 사람 n 명 (같은 파일을 n 번 풀어 각자 뼈대를 가짐)
async function loadPeople(n) {
  try {
    const url = new URL("./assets/kenney/player.glb", import.meta.url).href;
    const data = await (await fetch(url)).arrayBuffer();
    const loader = new GLTFLoader();
    const base = url.slice(0, url.lastIndexOf("/") + 1);
    const list = [];
    for (let i = 0; i < n; i++) {
      const gltf = await loader.parseAsync(data.slice(0), base);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const scale = 1.55 / (box.max.y - box.min.y);
      model.scale.setScalar(scale);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(model);
      const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
      let current = null;
      const play = (name) => {
        const next = actions[name] || actions.sit;
        if (!next || next === current) return;
        next.reset().fadeIn(0.25).play();
        if (name === "die" || name === "emote-yes" || name === "emote-no") {
          next.setLoop(name === "die" ? THREE.LoopOnce : THREE.LoopRepeat);
          next.clampWhenFinished = true;
        }
        current?.fadeOut(0.25);
        current = next;
      };
      const person = { model, mixer, play, base: FLOOR_Y - box.min.y * scale + 0.08 };
      play("sit");
      list.push(person);
    }
    return list;
  } catch (err) {
    console.warn("player.glb", err);
    return [];
  }
}

// ---------- 캔버스 그림 ----------

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 펠트 (원 모양 위에 그리면 타원으로 늘어남 → 글자는 미리 가로로 줄여 둠)
function feltTexture() {
  return canvasTexture(1024, 1024, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 40, w / 2, w / 2, w / 2);
    grad.addColorStop(0, "#1f8a57");
    grad.addColorStop(0.75, "#157048");
    grad.addColorStop(1, "#0d5235");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
    const img = g.getImageData(0, 0, w, w);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = "rgba(255,240,190,.45)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.save();
    g.translate(w / 2 - 215, w / 2);                                // 원 윗면의 가로가 테이블 앞뒤(z)라 돌려서 씀
    g.rotate(-Math.PI / 2);
    g.scale(B / A, 1);
    g.fillStyle = "rgba(255,240,190,.32)";
    g.font = "900 70px Georgia, serif";
    g.textAlign = "center";
    g.fillText("Ddan Jit HOLD'EM", 0, 0);
    g.restore();
  });
}

function faceTexture(card) {
  const rank = RANK_TEXT[card[0]] || card[0];
  const suit = SUIT[card[1]];
  const color = RED.has(card[1]) ? "#d0262e" : "#1b1d22";
  return canvasTexture(256, 360, (g, w, h) => {
    g.fillStyle = "#fbfaf5";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#d9d6cc";
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${rank.length > 1 ? 74 : 86}px Arial, sans-serif`;
    g.fillText(rank, 58, 62);
    g.font = "72px Arial, sans-serif";
    g.fillText(suit, 58, 140);
    g.font = "170px Arial, sans-serif";
    g.fillText(suit, w / 2 + 26, h / 2 + 52);
    g.save();
    g.translate(w - 40, h - 46);
    g.rotate(Math.PI);
    g.font = "900 48px Arial, sans-serif";
    g.fillText(rank, 0, 0);
    g.restore();
  });
}

function backTexture() {
  return canvasTexture(256, 360, (g, w, h) => {
    g.fillStyle = "#fbfaf5";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#a8232c";
    g.fillRect(14, 14, w - 28, h - 28);
    g.strokeStyle = "rgba(255,255,255,.35)";
    g.lineWidth = 3;
    for (let i = -h; i < w + h; i += 22) {
      g.beginPath();
      g.moveTo(i, 14);
      g.lineTo(i + h, h);
      g.moveTo(i + h, 14);
      g.lineTo(i, h);
      g.stroke();
    }
    g.strokeStyle = "#fbfaf5";
    g.lineWidth = 4;
    g.strokeRect(24, 24, w - 48, h - 48);
  });
}

function hex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function chipSide(color, stripe) {
  return canvasTexture(256, 16, (g, w, h) => {
    g.fillStyle = hex(color);
    g.fillRect(0, 0, w, h);
    g.fillStyle = hex(stripe);
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 8, 2, 14, h - 4);
  });
}

function chipTop(color, stripe) {
  return canvasTexture(128, 128, (g, w) => {
    g.fillStyle = hex(color);
    g.fillRect(0, 0, w, w);
    g.strokeStyle = hex(stripe);
    g.lineWidth = 10;
    g.setLineDash([16, 14]);
    g.beginPath();
    g.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w / 2, w / 2, w * 0.27, 0, Math.PI * 2);
    g.stroke();
  });
}

function buttonTexture() {
  return canvasTexture(128, 128, (g, w) => {
    g.fillStyle = "#f6f6f2";
    g.fillRect(0, 0, w, w);
    g.fillStyle = "#1b1d22";
    g.font = "900 72px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("D", w / 2, w / 2 + 4);
  });
}
