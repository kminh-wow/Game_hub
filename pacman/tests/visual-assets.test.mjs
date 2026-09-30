import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as logic from '../web/logic.js';

test('Blender kit contains both animated Pacman variants and all board assets', async () => {
  const bytes = await readFile(new URL('../web/assets/arcade-kit.glb', import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  const length=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.subarray(20,20+length));
  const binStart=20+length+8;
  for(const name of ['Pacman','PacmanPower','GhostBody','EyeWhite','EyePupil','Pellet','PowerPellet','WallTile']) {
    assert.ok(gltf.nodes.some(node=>node.name===name),name);
  }
  assert.equal(gltf.nodes.length,8,'No default Blender cube or unrelated scene exported');
  for(const name of ['Pacman','PacmanPower']) {
    const index=gltf.nodes.findIndex(node=>node.name===name);
    const animation=gltf.animations.find(a=>a.channels.some(c=>c.target.node===index&&c.target.path==='weights'));
    assert.ok(animation,`${name} has a mouth animation`);
    const channel=animation.channels.find(c=>c.target.node===index);
    const sampler=animation.samplers[channel.sampler];
    const accessor=gltf.accessors[sampler.output];
    const bufferView=gltf.bufferViews[accessor.bufferView];
    const offset=binStart+(bufferView.byteOffset||0)+(accessor.byteOffset||0);
    const values=Array.from({length:accessor.count},(_,i)=>bytes.readFloatLE(offset+i*4));
    assert.ok(Math.min(...values)<.01,'Mouth closes');
    assert.ok(Math.max(...values)>.99,'Mouth opens');
    assert.ok(Math.abs(values[0]-values.at(-1))<.001,'Animation loops continuously');
  }
});

test('Power pickup, pause, expiry and restart pass correct states to the new renderer', async () => {
  const source=(await readFile(new URL('../web/game.js',import.meta.url),'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g,'');
  const nodes=new Map();
  let lastDraw;
  const context=vm.createContext({
    ...logic,console,performance:{now:()=>0},
    localStorage:{getItem:()=>null,setItem:()=>{}},
    requestAnimationFrame:()=>{},
    window:{addEventListener:()=>{}},
    document:{getElementById:id=>{
      if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener:()=>{}});
      return nodes.get(id);
    }},
    createRenderer:async()=>({draw:(game)=>{lastDraw={phase:game.phase,power:game.frightLeft,paused:game.paused};}}),
  });
  vm.runInContext(source,context);
  await Promise.resolve();
  vm.runInContext('setPhase("playing"); eatAt(1,3); draw(.016)',context);
  assert.equal(lastDraw.power,6);
  assert.ok(context.window.__pacman.ghosts.every(g=>g.frightened));
  vm.runInContext('game.paused=true; update(1); draw(.016)',context);
  assert.equal(lastDraw.power,6);
  assert.equal(lastDraw.paused,true);
  vm.runInContext('game.paused=false; game.frightLeft=.01; update(.02); draw(.016)',context);
  assert.equal(lastDraw.power,0);
  assert.ok(context.window.__pacman.ghosts.every(g=>!g.frightened));
  vm.runInContext('setPhase("over"); startOrRestart(); draw(.016)',context);
  assert.equal(lastDraw.phase,'ready');
  assert.equal(lastDraw.power,0);
  assert.equal(nodes.get('score').textContent,0);
});
