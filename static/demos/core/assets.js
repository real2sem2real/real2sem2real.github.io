// GLB loading for the demos (meshopt-compressed, quantized, WebP textures), with a per-URL cache. get() returns a fresh
// clone that shares geometry and materials with the cached original.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export const DEMO_ROOT = new URL('../', import.meta.url).href;   // .../static/demos/
export const url = p => new URL(p, DEMO_ROOT).href;

export function loadGLB(path) {
  const u = url(path);
  if (!cache.has(u)) cache.set(u, loader.loadAsync(u));
  return cache.get(u);
}

export async function getObject(path, { shadows = true } = {}) {
  const gltf = await loadGLB(path);
  const o = gltf.scene.clone(true);   // clones share geometry, so normals computed once below are reused
  o.traverse(m => {
    if (!m.isMesh) return;
    m.castShadow = shadows; m.receiveShadow = shadows;
    const mat = m.material;
    if (mat && mat.map) { mat.map.anisotropy = 4; }
    if (mat) { mat.side = THREE.DoubleSide; }       // scanned meshes have open borders and inconsistent winding
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();   // GLBs ship without normals (smooth shading)
  });
  return o;
}

export const objectPath = id => `assets/objects/${id}.glb`;

export async function fetchJSON(path) { const r = await fetch(url(path)); if (!r.ok) throw new Error(path + ': ' + r.status); return r.json(); }
export async function fetchBin(path) { const r = await fetch(url(path)); if (!r.ok) throw new Error(path + ': ' + r.status); return r.arrayBuffer(); }

// Robust bottom of an object along its local z: the q-quantile of its vertex heights (scanned meshes carry a few stray
// vertices below the real base, so the plain bounding-box minimum sits too low).
export function robustMinZ(obj, q = 0.005) {
  const zs = [], v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse(m => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(M); zs.push(v.z); }
  });
  if (!zs.length) return 0;
  zs.sort((a, b) => a - b);
  return zs[Math.min(zs.length - 1, Math.floor(q * zs.length))];
}

// Centre of an object's base in its local frame: the mean x, y of the vertices within `band` of its robust bottom.
export function baseCenter(obj, band = 0.004) {
  const z0 = robustMinZ(obj), v = new THREE.Vector3(); let sx = 0, sy = 0, n = 0;
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse(m => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); if (v.z < z0 + band) { sx += v.x; sy += v.y; n++; } }
  });
  return new THREE.Vector3(n ? sx / n : 0, n ? sy / n : 0, z0);
}

// Height of the surface under a footprint: rays cast straight down onto `obj` (placed by world matrix T, uniform scale
// s) from the centre and a ring of points of radius r around `c` (world, the bottom of what rests there). Returns the
// highest hit below c.z + 2 cm, or null.
const _ray = new THREE.Raycaster();
export function supportHeight(obj, T, s, c, r) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(T);
  const o = obj.clone(true); o.scale.setScalar(s); g.add(o); g.updateMatrixWorld(true);
  let best = null;
  const pts = [[0, 0]]; for (let k = 0; k < 8; k++) pts.push([0.6 * r * Math.cos(k * Math.PI / 4), 0.6 * r * Math.sin(k * Math.PI / 4)]);
  for (const [dx, dy] of pts) {
    _ray.set(new THREE.Vector3(c.x + dx, c.y + dy, c.z + 0.02), new THREE.Vector3(0, 0, -1));
    _ray.far = 0.08;
    const hit = _ray.intersectObject(g, true)[0];
    if (hit && (best === null || hit.point.z > best)) best = hit.point.z;
  }
  return best;
}
