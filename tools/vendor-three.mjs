import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
await mkdir('web/vendor/three', { recursive: true });
for (const path of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'LICENSE']) {
  await mkdir(dirname(`web/vendor/three/${path}`), { recursive: true });
  await cp(`node_modules/three/${path}`, `web/vendor/three/${path}`, { recursive: true });
}
