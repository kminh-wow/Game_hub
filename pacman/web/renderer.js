import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { W, H, MAZE, position, wrapX } from './logic.js';

const PACMAN_SCALE = 1.4;
const GHOST_SCALE = 1.15;

// Visuals only: movement, collisions and power timing remain in game.js.
export async function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-16,16,18,-18,.1,150);
  camera.position.set(0,40,30);
  camera.lookAt(0,0,0);
  // Present the mouth plane toward the camera; yaw still follows the grid.
  const pacmanViewTilt = Math.atan2(camera.position.z, camera.position.y);
  scene.add(new THREE.HemisphereLight(0xeaf1ff,0x6e7793,1.5));
  const sun = new THREE.DirectionalLight(0xfff1d6,2.5);
  sun.position.set(-12,30,10);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera,{left:-20,right:20,top:22,bottom:-22,near:1,far:80});
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.bias=-.0005;
  scene.add(sun);
  const kit = await new GLTFLoader().loadAsync(new URL('./assets/arcade-kit.glb?v=magenta-stars',import.meta.url).href);
  function asset(name) {
    const source = kit.scene.getObjectByName(name);
    if (!source) throw new Error(`Missing asset: ${name}`);
    const result = source.clone();
    result.position.set(0,0,0);
    // Pacman's dark mouth and yellow shell are separate glTF primitives.
    result.traverse((part) => {
      if (!part.isMesh) return;
      part.material = part.material.clone();
      part.castShadow = true;
      part.receiveShadow = true;
    });
    return result;
  }
  // 미로 바닥
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W+1,.45,H+1),new THREE.MeshStandardMaterial({color:0xe3eacb,roughness:.65}));
  floor.position.y=-.32;
  floor.receiveShadow=true;
  scene.add(floor);
  const theme = matchMedia('(prefers-color-scheme: dark)');
  // 바닥 팔레트
  function applyTheme() { floor.material.color.set(theme.matches?0x35473f:0xe3eacb); }
  applyTheme(); theme.addEventListener('change',applyTheme);
  const tile = asset('WallTile');
  tile.material.color.setHex(0x4b6bdb);
  const cells=[];
  MAZE.forEach((row,y)=>[...row].forEach((c,x)=>{if(c==='#')cells.push([x,y]);}));
  const walls = new THREE.InstancedMesh(tile.geometry,tile.material,cells.length);
  const transform=new THREE.Object3D();
  cells.forEach(([x,y],i)=>{
    transform.position.set(x-(W-1)/2,.25,y-(H-1)/2);transform.updateMatrix();walls.setMatrixAt(i,transform.matrix);
  });
  walls.castShadow=walls.receiveShadow=true; scene.add(walls);
  const gate = new THREE.Mesh(new THREE.BoxGeometry(2,.10,.10),new THREE.MeshStandardMaterial({color:0xe69cb9}));
  gate.position.set(0,.22,12-(H-1)/2);scene.add(gate);
  const pellets=new Map();
  MAZE.forEach((row,y)=>[...row].forEach((c,x)=>{
    if(c!=='.'&&c!=='o')return;
    const dot=asset(c==='o'?'PowerPellet':'Pellet');
    if(c==='.') { dot.material.color.setHex(0xbf872b); dot.material.emissive.setHex(0); dot.scale.setScalar(1.25); }
    dot.position.set(x-(W-1)/2,c==='o'?.30:.16,y-(H-1)/2);
    dot.castShadow=false; scene.add(dot);pellets.set(`${x},${y}`,dot);
  }));
  const pacRoot=new THREE.Group();scene.add(pacRoot);
  const normal=asset('Pacman'), powered=asset('PacmanPower');
  pacRoot.add(normal,powered);
  const mixer=new THREE.AnimationMixer(pacRoot);
  for(const clip of kit.animations) mixer.clipAction(clip).play();
  for(const z of [-.24,.24]) {
    const eye=asset('EyePupil');eye.position.set(-.12,.40,z);eye.scale.setScalar(.70);pacRoot.add(eye);
  }
  const aura=new THREE.Mesh(new THREE.RingGeometry(.63,.73,48),new THREE.MeshBasicMaterial({color:0xffd85a,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));
  aura.rotation.x=-Math.PI/2; scene.add(aura);
  const glow=new THREE.PointLight(0xffd451,0,5);scene.add(glow);
  const colors=[0xf06d78,0xe6a0d7,0x6fc9d0,0xf3b568];
  const ghostModels=colors.map(color=>{
    const root=new THREE.Group(),body=asset('GhostBody');
    root.scale.setScalar(GHOST_SCALE);
    body.material.color.setHex(color);root.add(body);
    const eyes=[];
    for(const x of [-.19,.19]) {
      const white=asset('EyeWhite'),pupil=asset('EyePupil');
      white.position.set(x,.50,.40);white.scale.set(1.12,1.35,.65);
      pupil.position.set(x,.49,.505);pupil.scale.setScalar(.95);
      root.add(white,pupil);eyes.push({white,pupil,x});
    }
    scene.add(root);return {root,body,eyes,color,lastPosition:null};
  });
  const facing={right:0,down:-Math.PI/2,left:Math.PI,up:Math.PI/2};
  // Ghost eyes face +Z in the source, whereas Pacman faces +X.
  const ghostFacing={right:Math.PI/2,down:0,left:-Math.PI/2,up:Math.PI};
  let visualTime=0;
  function locate(root,entity,height) {
    const p=position(entity);root.position.set(wrapX(p.x+.5)-W/2,height,p.y-(H-1)/2);
  }
  function resize() {
    const {width,height}=canvas.parentElement.getBoundingClientRect();
    renderer.setSize(width,height,false);
    const aspect=width/height;
    const halfY=Math.max(13.6,14.8/aspect);
    camera.left=-halfY*aspect;camera.right=halfY*aspect;camera.top=halfY;camera.bottom=-halfY;camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas.parentElement);resize();
  const message=document.getElementById('message');
  return {
    draw(game,pac,ghosts,dt) {
      const animated=!game.paused;
      if(animated)visualTime+=dt;
      const moving=game.phase==='playing'&&pac.dir&&animated;
      if(moving)mixer.update(dt*(game.frightLeft>0?1.35:1));
      else if(game.phase!=='playing')mixer.setTime(.14);
      const powerOn=game.frightLeft>0;
      const powerVisible=powerOn&&(game.frightLeft>=2||Math.floor(game.frightLeft*5)%2===0);
      normal.visible=!powerVisible;powered.visible=powerVisible;
      canvas.parentElement.classList.toggle('powered',powerOn);
      pacRoot.visible=game.phase!=='over';
      // Lift by the increased radius so the enlarged mesh stays above the floor.
      locate(pacRoot,pac,.59+.49*(PACMAN_SCALE-1));
      pacRoot.rotation.set(pacmanViewTilt,facing[pac.face],0);
      const death=game.phase==='dying'?Math.max(0,1-game.phaseTime/1.2):1;
      pacRoot.scale.setScalar(PACMAN_SCALE*death);
      aura.visible=powerVisible&&pacRoot.visible&&death>0;
      aura.position.set(pacRoot.position.x,.05,pacRoot.position.z);
      aura.scale.setScalar(1+.12*Math.sin(visualTime*9));
      glow.position.copy(pacRoot.position);glow.position.y=1.5;glow.intensity=aura.visible?4:0;
      walls.material.emissive.setHex(game.phase==='clear'&&Math.floor(game.phaseTime*4)%2?0x647ccf:0);
      for(const [key,dot] of pellets) {
        dot.visible=game.pellets.has(key);
        if(game.pellets.get(key)==='power')dot.scale.setScalar(1+.12*Math.sin(visualTime*5));
      }
      ghosts.forEach((g,i)=>{
        const model=ghostModels[i];
        model.root.visible=game.phase!=='over'&&(game.phase!=='dying'||game.phaseTime<.3);
        locate(model.root,g,.46*GHOST_SCALE+.10+.035*Math.sin(visualTime*5+i));
        const current=position(g);
        let direction=g.state==='house'?'down':g.dir;
        // House entry/exit movement does not update the logical direction.
        if((g.state==='entering'||g.state==='leaving')&&model.lastPosition) {
          const dx=current.x-model.lastPosition.x, dy=current.y-model.lastPosition.y;
          if(Math.abs(dx)+Math.abs(dy)>1e-6) {
            direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
          } else direction=null;
        }
        if(direction)model.root.rotation.y=ghostFacing[direction];
        model.lastPosition={x:current.x,y:current.y};
        const eaten=g.state==='eaten'||g.state==='entering';model.body.visible=!eaten;
        const flash=g.frightened&&game.frightLeft<2&&Math.floor(game.frightLeft*5)%2===0;
        model.body.material.color.setHex(g.frightened?(flash?0xeaf0ff:0x5266ca):model.color);
        for(const {white,pupil,x} of model.eyes) {
          white.scale.set(g.frightened?.80:1.12,g.frightened?.80:1.35,.65);
          pupil.position.x=x;
          pupil.visible=!g.frightened;
        }
      });
      let text='';
      if(game.phase==='start')text=matchMedia('(pointer: coarse)').matches?'화면을 탭해서 시작':'Enter 또는 스페이스로 시작';
      if(game.phase==='ready')text='READY!';
      if(game.phase==='over')text=matchMedia('(pointer: coarse)').matches?'GAME OVER · 탭해서 다시':'GAME OVER · Enter로 다시';
      if(game.phase==='playing'&&game.paused)text='일시정지 (P)';
      if(message.textContent!==text)message.textContent=text;
      renderer.render(scene,camera);
    },
  };
}
