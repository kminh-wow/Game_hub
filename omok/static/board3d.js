import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The board and both stones come from Blender. Server coordinates stay unchanged.
export async function createBoardView(host) {
  const kit = await new GLTFLoader().loadAsync(new URL('./assets/omok-kit.glb?v=wood-stones', import.meta.url).href);
  const canvas = document.createElement('canvas');
  canvas.className = 'board-3d';
  canvas.setAttribute('aria-label', '오목 3D 바둑판');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 9, -9, .1, 70);
  camera.position.set(0, 24, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9298ae, 1.6));
  const light = new THREE.DirectionalLight(0xfff6e8, 2.4);
  light.position.set(-8, 17, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left:-11, right:11, top:11, bottom:-11, near:1, far:40 });
  light.shadow.bias = -.0003;
  light.shadow.normalBias = .015;
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xe3edff, .7);
  fill.position.set(8, 12, -10);
  scene.add(fill);

  for (const name of ['BoardBase', 'BoardRim', 'BoardTop', 'BoardGrid']) {
    const mesh = kit.scene.getObjectByName(name).clone();
    mesh.receiveShadow = name !== 'BoardGrid';
    mesh.castShadow = name === 'BoardBase';
    scene.add(mesh);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShadowMaterial({ opacity:.15 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -.72;
  shadow.receiveShadow = true;
  scene.add(shadow);

  const templates = { black:kit.scene.getObjectByName('BlackStone'), white:kit.scene.getObjectByName('WhiteStone') };
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x767981);
  for (const [x,y,z,w,h,strength] of [[-5,8,4,6,4,2.8],[5,6,-3,3,5,1.3]]) {
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({color:new THREE.Color(strength,strength,strength),side:THREE.DoubleSide}));
    softbox.position.set(x,y,z);softbox.lookAt(0,0,0);studio.add(softbox);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio,.025);pmrem.dispose();
  studio.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
  for(const stone of Object.values(templates)) {
    stone.material=stone.material.clone();
    stone.material.envMap=environment.texture;stone.material.envMapIntensity=.8;
  }
  const stones = new Map();
  const ghosts = {};
  for (const color of ['black', 'white']) {
    const mesh = templates[color].clone();
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = .38;
    mesh.material.depthWrite = false;
    mesh.visible = false;
    scene.add(mesh);
    ghosts[color] = mesh;
  }
  const mark = new THREE.Mesh(new THREE.RingGeometry(.085, .125, 32), new THREE.MeshBasicMaterial({color:0xe0474c}));
  mark.rotation.x = -Math.PI / 2;
  mark.visible = false;
  scene.add(mark);
  const win = new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1,12), new THREE.MeshBasicMaterial({color:0xe0474c}));
  win.visible = false;
  scene.add(win);
  const draw = () => renderer.render(scene, camera);
  const resize = () => {
    const width = host.clientWidth;
    if (!width) return;
    // Square viewport keeps intersection hit testing stable on mobile and desktop.
    renderer.setSize(width, width, false);
    draw();
  };
  host.append(canvas);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.30);
  const hit = new THREE.Vector3();

  return {
    cellFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      const x = Math.round(hit.x + 7), y = Math.round(hit.z + 7);
      return x>=0 && x<15 && y>=0 && y<15 ? [x,y] : null;
    },
    draw(g, hover, color) {
      const occupied = new Set();
      for (let y=0;y<15;y++) for (let x=0;x<15;x++) {
        const value = g.board[y][x];
        if (!value) continue;
        const key = `${x},${y}`;
        occupied.add(key);
        let mesh = stones.get(key);
        if (mesh && mesh.userData.value !== value) { scene.remove(mesh); stones.delete(key); mesh=null; }
        if (!mesh) {
          mesh = templates[value===1?'black':'white'].clone();
          mesh.userData.value = value;
          mesh.position.set(x-7, .485, y-7);
          mesh.castShadow = mesh.receiveShadow = true;
          stones.set(key, mesh);
          scene.add(mesh);
        }
      }
      for (const [key,mesh] of stones) if (!occupied.has(key)) { scene.remove(mesh); stones.delete(key); }
      ghosts.black.visible = ghosts.white.visible = false;
      if (hover && color && !g.board[hover[1]][hover[0]]) {
        ghosts[color].position.set(hover[0]-7,.485,hover[1]-7);
        ghosts[color].visible = true;
      }
      mark.visible = !!g.last;
      if (g.last) mark.position.set(g.last[0]-7,.68,g.last[1]-7);
      win.visible = !!g.win_line?.length;
      if (win.visible) {
        const a = g.win_line[0], b = g.win_line.at(-1);
        const direction = new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]);
        win.scale.set(1,direction.length(),1);
        win.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), direction.normalize());
        win.position.set((a[0]+b[0])/2-7,.71,(a[1]+b[1])/2-7);
      }
      draw();
    },
  };
}
