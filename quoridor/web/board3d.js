import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const colors = { '최선의 수': 0xa855f7, '좋은 수': 0x38a169, '괜찮은 수': 0xd69e2e, '안좋은 수': 0xc53030 };
const position = ([r, c]) => new THREE.Vector3(c - 4, .45, r - 4);
const wallKey = w => `${w.r},${w.c},${w.orientation}`;

export class Board3D {
  constructor(host, callbacks) {
    this.host = host; this.callbacks = callbacks; this.mode = 'move'; this.orientation = 'H';
    this.pawns = {}; this.tiles = []; this.walls = new Map(); this.tweens = new Set(); this.generation = 0;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#e8efed');
    this.camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 38;
    this.controls.minPolarAngle = .05;
    this.controls.maxPolarAngle = Math.PI / 2.5;
    this.controls.target.set(0, .2, 0);
    this.pointerStart = null;
    this.dragged = false;
    this.renderer.domElement.addEventListener('pointerdown', e => {
      this.dragged = !!this.pointerStart;
      this.pointerStart = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', () => { this.pointerStart = null; });
    this.renderer.domElement.addEventListener('pointercancel', () => { this.pointerStart = null; this.dragged = true; });
    this.controls.addEventListener('change', () => this.clearHover());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x65757d, 2.4));
    const light = new THREE.DirectionalLight(0xfff2d7, 3); light.position.set(-4, 10, 6); this.scene.add(light);
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.45);
    this.renderer.domElement.addEventListener('pointermove', e => {
      if (this.pointerStart && Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y) > 5) this.dragged = true;
      if (this.pointerStart) this.clearHover(); else this.point(e);
    });
    this.renderer.domElement.addEventListener('pointerleave', () => this.clearHover());
    this.renderer.domElement.addEventListener('click', e => {
      if (this.dragged) return;
      const hit = this.point(e);
      if (!hit || !this.interactive) return;
      if (this.mode === 'move') callbacks.move(hit.r, hit.c);
      else callbacks.wall(hit.r, hit.c, this.orientation);
    });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    let previous;
    this.renderer.setAnimationLoop(now => {
      const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1); previous = now;
      for (const pawn of Object.values(this.pawns)) pawn.mixer.update(dt);
      for (const tween of [...this.tweens]) {
        tween.elapsed += dt; const t = Math.min(tween.elapsed / tween.duration, 1); tween.update(t);
        if (t === 1) { this.tweens.delete(tween); tween.resolve(); }
      }
      if (host.clientWidth && host.clientHeight) this.renderer.render(this.scene, this.camera);
    });
    this.ready = this.load();
  }
  async load() {
    const loader = new GLTFLoader();
    const [base, tile, wall, pawn] = await Promise.all(['board_base', 'tile', 'wall', 'pawn'].map(n => loader.loadAsync(`assets/models/${n}.glb`)));
    this.scene.add(base.scene); this.wallTemplate = wall.scene;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const object = tile.scene.clone(true); object.position.set(c - 4, .35, r - 4);
      object.traverse(n => { if (n.isMesh) { n.material = n.material.clone(); n.userData.baseColor = n.material.color.clone(); } });
      this.tiles.push({ r, c, object }); this.scene.add(object);
    }
    for (const p of [1, 2]) {
      const model = clone(pawn.scene); const root = new THREE.Group(); root.add(model); this.scene.add(root);
      model.traverse(n => { if (n.isMesh) {
        const isArray = Array.isArray(n.material);
        const materials = (isArray ? n.material : [n.material]).map(m => {
          const copy = m.clone();
          if (m.name === 'PawnSolid_Red') copy.color.setRGB(...(p === 1 ? [.7, .018, .027] : [.018, .11, .8]));
          return copy;
        });
        n.material = isArray ? materials : materials[0];
      }});
      const mixer = new THREE.AnimationMixer(model);
      this.pawns[p] = { root, mixer, actions: Object.fromEntries(pawn.animations.map(c => [c.name, mixer.clipAction(c)])) };
      root.visible = false; this.play(p, 'Idle');
    }
    this.ghost = wall.scene.clone(true);
    this.ghost.traverse(n => { if (n.isMesh) {
      n.material = new THREE.MeshStandardMaterial({ color: 0x00bda3, transparent: true, opacity: .45, depthWrite: false });
    }});
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.labels = new THREE.Group();
    for (let n = 0; n < 9; n++) for (const axis of ['r', 'c']) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#123d43'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(n, 32, 47);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
      label.position.set(axis === 'r' ? -4.7 : n - 4, .5, axis === 'r' ? n - 4 : -4.7); label.scale.set(.32, .32, 1); this.labels.add(label);
    }
    this.scene.add(this.labels); this.labels.visible = false; this.resize();
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.cameraInitialized) this.resetCamera();
  }
  resetCamera() {
    const side = this.player === 2 ? 1 : -1;
    this.camera.position.set(6 * side, 12.5, 10.5 * side);
    this.camera.position.multiplyScalar(1.17 * Math.max(1, 1 / this.camera.aspect));
    this.controls.target.set(0, .2, 0);
    this.controls.update();
    this.cameraInitialized = true;
  }
  setMode(mode, orientation) { this.mode = mode; this.orientation = orientation; this.clearHover(); }
  setInteractive(value) { this.interactive = value; if (!value) this.clearHover(); this.highlight(); }
  clearHover() { if (this.ghost) this.ghost.visible = false; this.callbacks.hover(null); }
  point(event) {
    if (!this.interactive || !this.ghost) { this.clearHover(); return null; }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const v = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!v || Math.abs(v.x) > 4.45 || Math.abs(v.z) > 4.45) { this.clearHover(); return null; }
    let r, c;
    if (this.mode === 'move') { r = Math.round(v.z + 4); c = Math.round(v.x + 4); }
    else { r = Math.max(0, Math.min(7, Math.round(v.z + 3.5))); c = Math.max(0, Math.min(7, Math.round(v.x + 3.5))); }
    const hit = { r, c, orientation: this.orientation };
    this.ghost.visible = this.mode === 'wall';
    if (this.ghost.visible) this.placeWall(this.ghost, hit);
    const entry = this.state?.analysis?.find(a => this.mode === 'move' ? a.kind === 'move' && a.to[0] === r && a.to[1] === c : a.kind !== 'move' && a.r === r && a.c === c && a.orientation === this.orientation);
    if (this.ghost.visible) this.ghost.traverse(n => { if (n.isMesh) n.material.color.setHex(colors[entry?.label] || 0x00bda3); });
    this.callbacks.hover(entry, event.clientX, event.clientY);
    return hit;
  }
  placeWall(object, w) { object.position.set(w.c - 3.5, .45, w.r - 3.5); object.rotation.y = w.orientation === 'H' ? 0 : Math.PI / 2; }
  highlight() {
    for (const tile of this.tiles) {
      const legal = this.interactive && this.state?.legalMoves.some(([r, c]) => r === tile.r && c === tile.c);
      const entry = this.state?.analysis?.find(a => a.kind === 'move' && a.to[0] === tile.r && a.to[1] === tile.c);
      tile.object.traverse(n => { if (n.isMesh) {
        if (legal) n.material.color.setHex(colors[entry?.label] || 0x28bf95);
        else n.material.color.copy(n.userData.baseColor);
        n.material.emissive.setHex(legal ? colors[entry?.label] || 0x15a987 : 0); n.material.emissiveIntensity = legal ? .18 : 0;
      } });
    }
  }
  play(p, name) {
    const pawn = this.pawns[p], action = pawn.actions[name]; if (!action) return;
    if (pawn.active === action && action.isRunning()) return;
    const prior = pawn.active; action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    action.setLoop(['Idle', 'Walk'].includes(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true; action.play(); if (prior) action.crossFadeFrom(prior, .12, false); pawn.active = action;
  }
  tween(duration, update) { return new Promise(resolve => this.tweens.add({ duration, update, resolve, elapsed: 0 })); }
  reset() {
    this.generation++; this.state = null; this.setInteractive(false);
    for (const t of this.tweens) t.resolve(); this.tweens.clear();
    for (const w of this.walls.values()) this.scene.remove(w); this.walls.clear();
    for (const p of Object.values(this.pawns)) p.root.visible = false;
  }
  async apply(state, player) {
    const generation = this.generation; const previous = this.state; this.player = player; this.resize();
    if (!previous) this.resetCamera();
    const tasks = [];
    for (const p of [1, 2]) {
      const pawn = this.pawns[p]; pawn.root.visible = true;
      const to = position(state.pawns[p]);
      if (!previous) { pawn.root.position.copy(to); pawn.root.rotation.y = p === 1 ? 0 : Math.PI; this.play(p, 'Idle'); }
      else if (previous.pawns[p].some((v, i) => v !== state.pawns[p][i])) {
        const from = position(previous.pawns[p]); const distance = Math.abs(to.x - from.x) + Math.abs(to.z - from.z); const jump = distance > 1;
        const middle = position(previous.pawns[p === 1 ? 2 : 1]);
        this.play(p, jump ? 'Jump' : 'Walk');
        tasks.push(this.tween(jump ? .7 : .6, t => {
          const smooth = t * t * (3 - 2 * t);
          if (jump && to.x !== from.x && to.z !== from.z) {
            // Diagonal jumps go via the adjacent opponent, not through a wall corner.
            pawn.root.position.copy(t < .5 ? from.clone().lerp(middle, t * 2) : middle.clone().lerp(to, (t - .5) * 2));
          } else pawn.root.position.copy(from).lerp(to, smooth);
          pawn.root.position.y = .45 + (jump ? Math.sin(Math.PI * t) * .85 : 0);
          pawn.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
        }).then(() => { if (generation === this.generation) { pawn.root.position.copy(to); this.play(p, 'Idle'); } }));
      }
    }
    for (const w of state.walls) if (!this.walls.has(wallKey(w))) {
      const object = this.wallTemplate.clone(true); this.placeWall(object, w); this.scene.add(object); this.walls.set(wallKey(w), object);
      if (previous) {
        this.play(w.player, 'PlaceWall');
        tasks.push(this.tween(.7, t => { object.scale.y = Math.max(.01, Math.min(1, t * 2)); }).then(() => { if (generation === this.generation) this.play(w.player, 'Idle'); }));
      }
    }
    await Promise.all(tasks); if (generation !== this.generation) return;
    this.state = state; this.labels.visible = state.mode === 'learn'; this.highlight();
    if (state.winner) {
      this.play(state.winner, 'Win'); this.play(state.winner === 1 ? 2 : 1, 'Lose');
      await this.tween(1.6, () => {});
    }
  }
}
