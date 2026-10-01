import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const NORMALS = {1:[0,1,0], 6:[0,-1,0], 2:[0,0,1], 5:[0,0,-1], 3:[1,0,0], 4:[-1,0,0]};
export async function createTrayView(host) {
  const kit = await new GLTFLoader().loadAsync(new URL('./assets/yacht-kit.glb?v=rounded-restored',import.meta.url).href);
  const canvas = document.createElement('canvas');
  canvas.className = 'tray-canvas';
  canvas.setAttribute('aria-hidden','true');
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.1;
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-6,6,3,-3,.1,50);
  camera.position.set(0,13,9);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  scene.add(new THREE.HemisphereLight(0xffffff,0x7889b2,2.6));
  const light=new THREE.DirectionalLight(0xfff6e8,3);
  light.position.set(-4,10,5);light.castShadow=true;
  light.shadow.mapSize.set(2048,2048);
  Object.assign(light.shadow.camera,{left:-7,right:7,top:5,bottom:-5,near:1,far:25});
  light.shadow.normalBias=.006;scene.add(light);
  for(const name of ['TrayBase','TrayFelt','TrayRim']) {
    const mesh=kit.scene.getObjectByName(name).clone();
    mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  }
  // Softbox reflections give the resin a broad highlight instead of a flat white face.
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x858994);
  for(const [x,y,z,w,h,power] of [[-4,7,3,5,3,3],[5,3,-4,3,5,1.8]]) {
    const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power,power),side:THREE.DoubleSide}));
    card.position.set(x,y,z);card.lookAt(0,0,0);studio.add(card);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(studio,.025);
  pmrem.dispose();
  studio.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
  const dice=Array.from({length:5},(_,i)=>{
    const root=new THREE.Group();
    const asset=kit.scene.getObjectByName('Die').clone(true);asset.position.set(0,0,0);
    asset.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;mesh.material=mesh.material.clone();mesh.material.envMap=environment.texture;mesh.material.envMapIntensity=.65;}});
    root.add(asset);root.scale.setScalar(1.12);root.position.set((i-2)*1.7,.66,0);scene.add(root);return root;
  });
  let state=null, roll=null, frame=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const up=new THREE.Vector3(0,1,0);
  function target(face){return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...NORMALS[face]),up);}
  function positionButtons() {
    const width=host.clientWidth,height=host.clientHeight;
    host.querySelectorAll('.die').forEach((btn,i)=>{
      // Hit targets follow the simulated dice, including their resting positions.
      const p=dice[i].position.clone().project(camera);
      const size=Math.max(32,width/(camera.right-camera.left)*1.24);
      Object.assign(btn.style,{left:`${(p.x+1)*width/2}px`,top:`${(1-p.y)*height/2}px`,width:`${size}px`,height:`${size}px`});
    });
  }
  function draw(now=performance.now()) {
    frame=null;
    let animating=false;
    const elapsed=roll ? Math.max(0,now-roll.start) : 0;
    const samples=roll?.frames;
    const at=samples ? Math.min(samples.length-1,elapsed/roll.frame_ms) : 0;
    dice.forEach((die,i)=>{
      if(samples && elapsed<roll.duration_ms && !reduced.matches) {
        const a=samples[Math.floor(at)][i];
        const b=samples[Math.min(samples.length-1,Math.floor(at)+1)][i];
        die.position.fromArray(a).lerp(new THREE.Vector3().fromArray(b),at%1);
        die.quaternion.fromArray(a,3).slerp(new THREE.Quaternion().fromArray(b,3),at%1);
        animating=true;
      } else if(state?.poses) {
        die.position.fromArray(state.poses[i]);
        die.quaternion.fromArray(state.poses[i],3);
      } else {
        die.position.set((i-2)*1.7,.66,0);
        die.quaternion.copy(target(state?.dice[i]||1));
      }
    });
    positionButtons();
    renderer.render(scene,camera);
    if(animating)frame=requestAnimationFrame(draw);
  }
  function resize(){
    const width=host.clientWidth,height=host.clientHeight;
    if(!width||!height)return;
    const halfX=Math.max(5.7,3.0*width/height),halfY=halfX*height/width;
    Object.assign(camera,{left:-halfX,right:halfX,top:halfY,bottom:-halfY});camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);positionButtons();
    if(frame===null)draw();
  }
  host.prepend(canvas);host.classList.add('has-3d');
  new ResizeObserver(resize).observe(host);resize();
  return {update(g,animation){state=g;roll=animation;positionButtons();if(frame!==null)cancelAnimationFrame(frame);draw();}};
}
