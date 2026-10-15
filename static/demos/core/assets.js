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
