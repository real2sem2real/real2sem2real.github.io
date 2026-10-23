// Shared pieces of the Method steps 3 and 4: the data-generation grasp (grasp 55 of the demonstrated mug, transferred to every
// cousin), the xArm gripper of the site's robot model cut off the arm, the tabletop, a mug placed in its body frame, and the
// stage/auto-orbit plumbing.
//
// data/grasp55.json (built offline): per mug, T = the TCP pose in the mug's body frame from the IK table the generator loads
// at the 0.9 mug scale (row-major 4x4, metres of the scaled mug; in the generated episodes FK(TCP) relative to the mug equals
// it within 2 mm and 0.5 deg), drive = the gripper drive angle the generator commands for that mug, zmin = the mug's bottom
// in its body frame. Every mug shares one body frame (same bottom, handle on the same side).
import { THREE, createViewer, onTheme, reducedMotion, loadingOverlay, mat4 } from '../../core/viewer.js';
import { getObject, objectPath, fetchJSON } from '../../core/assets.js';
import { loadXArm } from '../../core/robot.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

import { keepWidth } from './fitfov.js';
export { THREE, createViewer, onTheme, reducedMotion, loadingOverlay, mat4, getObject, objectPath };

let dataP = null;
export const loadGrasp55 = () => dataP || (dataP = fetchJSON('method/data/grasp55.json'));

export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const ease = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

const CSS = `
.m55{position:relative; width:100%; height:100%; overflow:hidden; border-radius:inherit;
  background:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 62%),
             linear-gradient(180deg, color-mix(in srgb, var(--surface) 70%, var(--bg)), var(--surface))}
.m55 .demo-hud.bl{right:12px; bottom:56px}
.m55-ctl{position:absolute; z-index:4; left:12px; right:12px; bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:nowrap;
  pointer-events:none}
.m55-ctl > *{pointer-events:auto}
.m55-ctl .seg{background:color-mix(in srgb, var(--surface) 70%, transparent); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border:1px solid color-mix(in srgb, var(--line) 80%, transparent)}
.m55-chips{display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; padding:3px; border-radius:40px; min-width:0; flex:0 1 auto;
  background:color-mix(in srgb, var(--surface) 70%, transparent); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border:1px solid color-mix(in srgb, var(--line) 80%, transparent)}
.m55-chips::-webkit-scrollbar{display:none}
.m55-chips button{font:inherit; font-size:12px; font-weight:500; min-width:30px; height:28px; padding:0 9px; border:0; border-radius:30px;
  background:transparent; color:var(--muted); cursor:pointer; white-space:nowrap; flex:none; transition:background .2s, color .2s}
.m55-chips button:hover{color:var(--ink)}
.m55-chips button[aria-pressed="true"]{background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.14)}
.m55-sp{flex:1 1 auto}
.m55-hint{font-size:11.5px; color:var(--muted); white-space:nowrap; transition:opacity .4s}
.m55-hint.off{opacity:0}
@media (max-width:620px){
  .m55 .demo-hud.bl{display:none}
  .m55 .demo-hud.tl .mut{display:none}
  .m55-ctl{left:8px; right:8px; bottom:8px; gap:6px}
  .m55-chips button{height:26px; min-width:26px; padding:0 7px; font-size:11.5px}
  .m55-hint{display:none}
}`;
export function ensureCss() {
  if (document.getElementById('m55-css')) return;
  const s = el('style'); s.id = 'm55-css'; s.textContent = CSS; document.head.appendChild(s);
}

// Faint round tabletop with a 5 cm grid (as in the grasp demo).
export function makeTable(radius) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x9fb3d1) }, uGrid: { value: new THREE.Color(0x4f78b5) }, uAlpha: { value: 0.5 }, uR: { value: radius } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec3 uGrid; uniform float uAlpha; uniform float uR; varying vec2 vP;
      void main(){
        float r = length(vP) / uR;
        float fall = smoothstep(1.0, 0.15, r);
        vec2 g = abs(fract(vP / 0.05 - 0.5) - 0.5) / fwidth(vP / 0.05);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        gl_FragColor = vec4(mix(uColor, uGrid, line * 0.55), uAlpha * fall * (0.34 + 0.22 * line));
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * radius, 2 * radius), mat);
  m.renderOrder = -2; m.position.z = -0.0006;
  m.setTheme = dark => {
    const u = mat.uniforms;
    u.uColor.value.set(dark ? 0x2a3d5e : 0x9fb3d1); u.uGrid.value.set(dark ? 0x5ac8fa : 0x4f78b5); u.uAlpha.value = dark ? 0.55 : 0.5;
  };
  return m;
}

// The xArm parallel-jaw gripper of the site's robot model: root = the TCP frame (z = approach, y = closing axis); the gripper
// base sits tcp_offset behind it along -z, exactly as joint_tcp in the robot model.
export async function makeGripper(tcpOffset, { ghost = false } = {}) {
  const arm = await loadXArm({ shadows: !ghost });
  const base = arm.links.xarm_gripper_base_link;
  base.removeFromParent();
  const root = new THREE.Group(), off = new THREE.Group();
  off.position.z = -tcpOffset; off.add(base); root.add(off);
  const mats = [];
  base.traverse(m => {
    if (!m.isMesh) return;
    m.geometry = smoothed(m.geometry);                        // softer shading of the decimated housing (own copy, cached)
    m.material = m.material.clone();                         // own materials: tints must not reach other demos' robots
    mats.push({ m: m.material, c: m.material.color.clone() });
    if (ghost) { m.castShadow = false; m.receiveShadow = false; }
  });
  const g = {
    root, setGrip: d => arm.setGrip(d),
    opacity(a, tint = null) {
      for (const { m, c } of mats) {
        m.color.copy(c); if (tint) m.color.lerp(tint, 0.55);
        m.transparent = a < 1; m.opacity = a; m.depthWrite = a >= 1; m.needsUpdate = true;
      }
    },
  };
  if (ghost) g.opacity(0.28);
  return g;
}

const smoothCache = new WeakMap();
function smoothed(geo) {
  if (!smoothCache.has(geo)) smoothCache.set(geo, toCreasedNormals(geo.clone(), Math.PI * 0.36));
  return smoothCache.get(geo);
}

// Thin "U" glyph of a parallel-jaw grasp in the TCP frame: two fingers spanning the jaw opening and the bar behind them.
export function graspGlyph(jawMm, padZ, color) {
  const hw = jawMm / 2000 + 0.004, z0 = padZ - 0.024, z1 = padZ + 0.006, r = 0.0008;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false });
  const g = new THREE.Group();
  const seg = (a, b) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
    m.position.copy(A).lerp(B, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.renderOrder = 4;
    g.add(m);
  };
  seg([0, hw, z0], [0, hw, z1]); seg([0, -hw, z0], [0, -hw, z1]); seg([0, hw, z0], [0, -hw, z0]); seg([0, 0, z0], [0, 0, z0 - 0.018]);
  g.material = mat;
  return g;
}

// A mug in its body frame, scaled about the body origin, standing on z = 0: group (z lift) > mesh (scale) + grasp frame.
export async function makeMug(m, scale, { ghost = false } = {}) {
  const obj = await getObject(objectPath(m.id), { shadows: !ghost });
  if (ghost) obj.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.16; o.material.depthWrite = false;
    o.renderOrder = 1;
  });
  const g = new THREE.Group(); g.position.z = -m.zmin;
  obj.scale.setScalar(scale); g.add(obj);
  const grasp = new THREE.Group(); grasp.matrixAutoUpdate = false; grasp.matrix.copy(mat4(m.T)); g.add(grasp);
  return { group: g, obj, grasp };
}

// Camera on the grasp: above and to the side of the approach, so both fingers, the handle and the whole mug show.
export function aimAtGrasp(v, graspFrame, mugHeight, { dist = 0.6, toward = 0.25, back = 0.07 } = {}) {
  v.scene.updateMatrixWorld(true);
  const tcp = new THREE.Vector3().setFromMatrixPosition(graspFrame.matrixWorld);
  const app = new THREE.Vector3(0, 0, 1).transformDirection(graspFrame.matrixWorld);
  const target = new THREE.Vector3(0, 0, mugHeight / 2).lerp(tcp, toward).addScaledVector(app, -back);
  target.z = mugHeight * 0.45;
  const side = new THREE.Vector3(-app.y, app.x, 0).normalize();
  const dir = new THREE.Vector3(0, 0, 0.62).addScaledVector(app, -0.3).addScaledVector(side, 0.58).normalize();
  v.camera.position.copy(target).addScaledVector(dir, dist);
  v.controls.target.copy(target); v.controls.update();
  v.fitShadow(target, 0.35);
  return target;
}

// Gentle sway of the camera about the target (+-amp radians around the framed view) until the visitor drags; the framed view
// keeps the grasp in front, a full turn would pass behind the gripper. reframe() re-reads the view after an aim change.
export function autoOrbit(v, { amp = 0.55, period = 16 } = {}) {
  const st = { touched: reducedMotion(), t: 0, base: null };
  v.controls.addEventListener('start', () => { st.touched = true; });
  st.reframe = () => { st.base = v.camera.position.clone().sub(v.controls.target); st.t = 0; };
  const z = new THREE.Vector3(0, 0, 1), off = new THREE.Vector3();
  v.add(dt => {
    if (st.touched || !dt) return;
    if (!st.base) st.reframe();
    st.t += dt;
    off.copy(st.base).applyAxisAngle(z, amp * Math.sin(2 * Math.PI * st.t / period));
    v.camera.position.copy(v.controls.target).add(off);
  });
  return st;
}

// A stage that fills the step box, with a viewer, theme-aware table and the pause/resume contract.
export function makeStage(host, opts) {
  ensureCss();
  host.querySelectorAll('.m55').forEach(e => e.remove());
  const stage = el('div', 'm55');
  host.appendChild(stage);
  const v = createViewer(stage, opts);
  keepWidth(stage, v.camera, opts.fov);
  let paused = false;
  return {
    stage, v,
    api: {
      pause() { paused = true; v.stop(); },
      resume() { if (paused) { paused = false; v.start(); } },
      dispose() { v.dispose(); stage.remove(); },
    },
  };
}
