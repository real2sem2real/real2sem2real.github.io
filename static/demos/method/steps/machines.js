// Method step "Align the coffee machines by the tray". Every machine the data generation uses, in the demonstrated machine's
// body frame, where the alignment put it (task-weighted ICP on the tray region, then set on the same table): the cousins are
// shown exactly as the generated episodes spawn them. The demonstrated mug rests where the generated episodes on that machine
// end (median over them), in the demonstrated end orientation. Pink = the weighted region: 8 cm around the mug's end pose.
//
// Data (method/data/machines/machines.json, built offline): per machine the mug's 4x4 (row-major, scaled-mug body frame ->
// shared frame), its end anchor, tray height vs the demonstrated machine, episode count, and whether the xArm recipe's
// nine-machine pool uses it. Machine and mug meshes are the site's simulation GLBs (assets/objects).
import { THREE, createViewer, onTheme, mat4, loadingOverlay, reducedMotion, ease } from '../../core/viewer.js';
import { keepWidth } from './fitfov.js';
import { getObject, objectPath, fetchJSON, robustMinZ } from '../../core/assets.js';

const CYCLE = 2.9, FADE = 0.55, HOP = 0.7;              // seconds per machine, crossfade, mug hop between trays
const GHOST = 0.11;                                     // opacity of the machines not in focus
const PINK = 0xe8007d;
const css = `
.mstep{position:absolute; inset:0; overflow:hidden; border-radius:inherit;
  background:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 62%),
             linear-gradient(180deg, color-mix(in srgb, var(--surface) 70%, var(--bg)), var(--surface))}
.mstep .demo-hud{pointer-events:none}
.mstep-bar{position:absolute; z-index:4; left:50%; bottom:12px; transform:translateX(-50%); display:flex; gap:8px; align-items:center;
  flex-wrap:nowrap; padding:5px; border-radius:40px; max-width:calc(100% - 20px);
  background:color-mix(in srgb, var(--surface) 80%, transparent); border:1px solid color-mix(in srgb, var(--line) 80%, transparent);
  -webkit-backdrop-filter:blur(10px) saturate(1.4); backdrop-filter:blur(10px) saturate(1.4)}
.mstep-bar .seg{background:transparent; padding:0}
.mstep-nav{display:inline-flex; align-items:center; gap:2px}
.mstep-nav button{font:inherit; border:0; background:transparent; color:var(--muted); width:30px; height:30px; border-radius:50%;
  cursor:pointer; display:grid; place-items:center}
.mstep-nav button:hover{color:var(--ink); background:color-mix(in srgb, var(--line) 55%, transparent)}
.mstep-nav svg{width:13px; height:13px}
.mstep-sep{width:1px; height:20px; background:color-mix(in srgb, var(--line) 90%, transparent)}
.mstep .hud .tag{display:inline-block; font-size:10.5px; font-weight:600; letter-spacing:.04em; color:var(--accent);
  border:1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius:20px; padding:1px 7px; margin-left:6px}
@media (max-width:700px){ .mstep-bar .lg{display:none} .mstep-bar .seg button{padding:6px 9px} .mstep .demo-hud.tr{display:none} }
`;
function ensureCss() {
  if (document.getElementById('mstep-machines-css')) return;
  const s = document.createElement('style'); s.id = 'mstep-machines-css'; s.textContent = css; document.head.appendChild(s);
}
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ARROW_L = '<svg viewBox="0 0 16 16"><path d="M10.5 2.5 5 8l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const ARROW_R = '<svg viewBox="0 0 16 16"><path d="M5.5 2.5 11 8l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z" fill="currentColor"/></svg>';

// Own copies of every material (the GLB cache shares materials with the other demos on the page), with a world-space tint
// inside a sphere (the weighted region) and an opacity for the ghosted machines.
function prepare(obj) {
  const mats = [];
  obj.traverse(m => {
    if (!m.isMesh) return;
    const mat = m.material.clone();
    const u = { uC: { value: new THREE.Vector3() }, uR: { value: 0.08 }, uK: { value: 0 }, uCol: { value: new THREE.Color(PINK) } };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uC; uniform float uR; uniform float uK; uniform vec3 uCol;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          { float d = distance(vWP, uC); float w = (1.0 - smoothstep(uR - 0.014, uR, d)) * uK;
            diffuseColor.rgb = mix(diffuseColor.rgb, uCol, 0.5 * w); }`);
    };
    mat.customProgramCacheKey = () => 'mstep-region';
    mat.userData.u = u;
    m.material = mat; mats.push(mat);
  });
  return mats;
}
function setOpacity(mats, a, meshes) {
  for (const m of mats) { m.opacity = a; m.transparent = a < 0.999; m.depthWrite = a > 0.6; }
  for (const m of meshes) { m.castShadow = a > 0.6; m.renderOrder = a > 0.6 ? 0 : 1; }
}

export async function mount(el) {
  ensureCss();
  const root = h('div', 'mstep'); el.appendChild(root);
  const load = loadingOverlay(root, 'Loading the machines');
  const v = createViewer(root, { fov: 30, position: [0.95, 1.05, 0.62], target: [0.02, 0.02, 0.14], groundSize: 8, maxDpr: 1.75 });
  const { scene, camera, controls } = v;
  keepWidth(root, camera, 30);
  controls.minDistance = 0.4; controls.maxDistance = 7; controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotateSpeed = 0.55;
  let D;
  try { D = await fetchJSON('method/data/machines/machines.json'); } catch (e) { load.error('Could not load the machines.'); throw e; }

  // ---------------------------------------------------------------- objects
  const world = new THREE.Group(); scene.add(world);              // shared frame, lowered so the table is at z = 0
  const ids = D.machines.map(m => m.id);
  let done = 0;
  const objs = await Promise.all([...ids, D.mug].map(id => getObject(objectPath(id)).then(o => { load.set(++done / (ids.length + 1)); return o; })));
  const mugProto = objs.pop();
  const M = D.machines.map((m, i) => {
    const g = new THREE.Group(); const o = objs[i]; g.add(o);
    const meshes = []; o.traverse(x => x.isMesh && meshes.push(x));
    const mats = prepare(o);
    return Object.assign({}, m, { g, o, mats, meshes, a: 1, aT: 1, k: 0, kT: 0, T: mat4(m.mug), anchor: new THREE.Vector3(...m.anchor) });
  });
  world.position.z = -robustMinZ(M[0].o);
  const makeMug = () => { const n = new THREE.Group(); const c = mugProto.clone(true); c.scale.setScalar(D.mug_scale); n.add(c); n.matrixAutoUpdate = false; return n; };

  const st = { layout: 'overlay', pool: 'recipe', cur: 0, t: 0, playing: !reducedMotion(), hop: null, dragged: false };
  const poolIdx = () => M.map((m, i) => i).filter(i => st.pool === 'all' || M[i].recipe);
  const mainMug = makeMug(); world.add(mainMug);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.162, 64), new THREE.MeshBasicMaterial({ color: 0x2f92ff, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.visible = false; scene.add(ring);
  const OV_T = new THREE.Vector3(0.03, 0.03, 0.19), OV_D = 1.4, OV_E = 0.42, OV_A = 0.72;
  const gridMugs = new Map();

  // ---------------------------------------------------------------- UI
  const hudTL = h('div', 'demo-hud tl'); const hName = h('span', 'hud'); const hInfo = h('span', 'hud'); hudTL.append(hName, hInfo);
  const hudBL = h('div', 'demo-hud tr'); const hReg = h('span', 'hud dot');
  hReg.style.setProperty('--c', '#e8007d');
  hReg.innerHTML = `<b>Weighted region</b> <span class="mut">&middot; ${Math.round(D.region_radius * 100)} cm around the mug's end pose</span>`;
  hudBL.append(hReg);
  const bar = h('div', 'mstep-bar');
  const gLay = h('div', 'seg'), bOver = h('button', '', 'Overlaid'), bSide = h('button', '', 'Side by side'); gLay.append(bOver, bSide);
  const nRec = M.filter(m => m.recipe).length;
  const gPool = h('div', 'seg'), bRec = h('button', '', `<span class="lg">xArm recipe </span>${nRec}`), bAll = h('button', '', `<span class="lg">All </span>${M.length}`);
  bRec.title = `The ${nRec} machines of the xArm mug-to-machine recipe`; bAll.title = 'Every machine cousin with a simulation asset';
  gPool.append(bRec, bAll);
  const nav = h('div', 'mstep-nav'), bPrev = h('button', '', ARROW_L), bPlay = h('button', '', PAUSE), bNext = h('button', '', ARROW_R);
  bPrev.setAttribute('aria-label', 'Previous machine'); bNext.setAttribute('aria-label', 'Next machine');
  nav.append(bPrev, bPlay, bNext);
  bar.append(gLay, h('span', 'mstep-sep'), gPool, h('span', 'mstep-sep'), nav);
  root.append(hudTL, hudBL, bar);
  const press = (b, on) => b.setAttribute('aria-pressed', on ? 'true' : 'false');

  function refresh() {
    press(bOver, st.layout === 'overlay'); press(bSide, st.layout === 'side');
    press(bRec, st.pool === 'recipe'); press(bAll, st.pool === 'all');
    bPlay.innerHTML = st.playing ? PAUSE : PLAY; bPlay.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    const m = M[st.cur];
    hName.innerHTML = `<b>${m.label}</b>${m.recipe ? '<span class="tag">xArm recipe</span>' : ''}`;
    const dz = m.tray_dz_mm / 10;
    hInfo.innerHTML = m.id === 'demo_cm'
      ? `<span class="mut">the demonstration's machine &middot; ${m.episodes} episodes shown</span>`
      : `<span class="mut">tray ${dz >= 0 ? '+' : '&minus;'}${Math.abs(dz).toFixed(1)} cm vs the demonstrated &middot; ${m.episodes} episodes</span>`;
  }

  // ---------------------------------------------------------------- layouts
  const _v = new THREE.Vector3();
  function regionCentre(m, out) { return out.copy(m.anchor).applyMatrix4(m.g.matrixWorld); }
  function gridSlots(n) {                                // rows along x, facing +y; rows step back in -y
    const cols = n <= 9 ? Math.min(n, 5) : Math.ceil(n / 2), rows = Math.ceil(n / cols), dx = 0.34, dy = 0.5;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), c = i - r * cols;
      out.push(new THREE.Vector3((c - (inRow - 1) / 2) * dx, -r * dy + (rows - 1) * dy / 2, 0));
    }
    return { out, w: (cols - 1) * dx + 0.4, d: (rows - 1) * dy + 0.4 };
  }
  let camGoal = null;                                    // eased camera move between layouts
  function frame(target, dist, elev = 0.5, az = 0.72) {
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.cos(az) * Math.cos(elev), Math.sin(elev));
    camGoal = { t0: v.clock.t, p0: camera.position.clone(), q0: controls.target.clone(), p1: target.clone().addScaledVector(dir, dist), q1: target.clone() };
  }
  function applyLayout(first = false) {
    const idx = poolIdx();
    if (!idx.includes(st.cur)) st.cur = idx[0];
    for (const [, n] of gridMugs) n.removeFromParent();
    gridMugs.clear();
    M.forEach((m, i) => { m.g.removeFromParent(); m.g.position.set(0, 0, 0); m.kT = 0; });
    if (st.layout === 'overlay') {
      for (const i of idx) { world.add(M[i].g); M[i].aT = i === st.cur ? 1 : GHOST; M[i].kT = i === st.cur ? 1 : 0; }
      mainMug.visible = true; mainMug.matrix.copy(M[st.cur].T);
      if (!first) frame(OV_T, OV_D, OV_E, OV_A);
      ring.visible = false;
      fitShadow(0.6);
    } else {
      const { out, w, d } = gridSlots(idx.length);
      idx.forEach((i, k) => {
        const m = M[i]; m.g.position.copy(out[k]); world.add(m.g); m.aT = 1; m.kT = 1;
        const mug = makeMug(); mug.matrix.copy(m.T).premultiply(new THREE.Matrix4().makeTranslation(out[k])); world.add(mug); gridMugs.set(i, mug);
      });
      mainMug.visible = false;
      const span = Math.max(w, d * 1.3);
      frame(new THREE.Vector3(0, -0.08, 0.15), 0.55 + 1.25 * span, 0.58, 0.0);
      ring.visible = true;
      fitShadow(Math.max(w, d) * 0.75 + 0.3);
    }
    st.t = 0; refresh();
  }
  function fitShadow(s) { v.fitShadow(new THREE.Vector3(0, 0, 0), s); }

  function goTo(i, user = false) {
    if (i === st.cur) return;
    const from = M[st.cur], to = M[i];
    st.cur = i; st.t = 0;
    if (st.layout === 'overlay') {
      M.forEach((m, j) => { if (m.g.parent) { m.aT = j === i ? 1 : GHOST; m.kT = j === i ? 1 : 0; } });
      st.hop = { t: 0, A: from.T.clone(), B: to.T.clone() };
    }
    if (user) { st.playing = false; }
    refresh();
  }
  const step = d => { const idx = poolIdx(); const k = idx.indexOf(st.cur); goTo(idx[(k + d + idx.length) % idx.length], true); };
  bPrev.onclick = () => step(-1); bNext.onclick = () => step(1);
  bPlay.onclick = () => { st.playing = !st.playing; st.t = 0; refresh(); };
  bOver.onclick = () => { if (st.layout !== 'overlay') { st.layout = 'overlay'; applyLayout(); } };
  bSide.onclick = () => { if (st.layout !== 'side') { st.layout = 'side'; applyLayout(); } };
  bRec.onclick = () => { if (st.pool !== 'recipe') { st.pool = 'recipe'; applyLayout(); } };
  bAll.onclick = () => { if (st.pool !== 'all') { st.pool = 'all'; applyLayout(); } };
  controls.addEventListener('start', () => { st.dragged = true; controls.autoRotate = false; camGoal = null; });

  // ---------------------------------------------------------------- per frame
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), sc = new THREE.Vector3();
  v.add((dt, t) => {
    if (camGoal) {
      const u = ease((t - camGoal.t0) / 1.1);
      camera.position.lerpVectors(camGoal.p0, camGoal.p1, u); controls.target.lerpVectors(camGoal.q0, camGoal.q1, u);
      if (u >= 1) camGoal = null;
    }
    controls.autoRotate = !st.dragged && !reducedMotion() && !camGoal;
    const k = Math.min(1, dt / (FADE / 4));
    world.updateMatrixWorld(true);
    for (const m of M) {
      if (!m.g.parent) continue;
      m.a += (m.aT - m.a) * k; if (Math.abs(m.aT - m.a) < 0.004) m.a = m.aT;
      m.k += (m.kT - m.k) * k;
      setOpacity(m.mats, m.a, m.meshes);
      regionCentre(m, _v);
      for (const mat of m.mats) { mat.userData.u.uC.value.copy(_v); mat.userData.u.uK.value = m.k; mat.userData.u.uR.value = D.region_radius; }
    }
    if (st.hop) {                                        // the mug hops from one tray to the next
      st.hop.t += dt; const u = ease(st.hop.t / HOP);
      st.hop.A.decompose(pA, qA, sc); st.hop.B.decompose(pB, qB, sc);
      pA.lerp(pB, u); pA.z += 0.05 * Math.sin(Math.PI * u); qA.slerp(qB, u);
      mainMug.matrix.compose(pA, qA, sc);
      if (u >= 1) { mainMug.matrix.copy(st.hop.B); st.hop = null; }
    }
    if (st.playing && st.layout === 'overlay') {
      st.t += dt;
      if (st.t > CYCLE) { const idx = poolIdx(); goTo(idx[(idx.indexOf(st.cur) + 1) % idx.length]); }
    } else if (st.playing && st.layout === 'side') {
      st.t += dt;
      if (st.t > CYCLE) { const idx = poolIdx(); st.cur = idx[(idx.indexOf(st.cur) + 1) % idx.length]; st.t = 0; refresh(); }
    }
    if (st.layout === 'side') {
      for (const [i, m] of M.entries()) if (m.g.parent) m.kT = i === st.cur ? 1 : 0.35;
      const g = M[st.cur].g; ring.position.lerp(_v.set(g.position.x + 0.02, g.position.y + 0.02, 0.0015), Math.min(1, dt * 8));
      controls.autoRotateSpeed = 0.3;
    } else controls.autoRotateSpeed = 0.55;
  });

  onTheme(dark => { v.ground.material.opacity = dark ? 0.4 : 0.22; });
  applyLayout(true);
  camera.position.copy(OV_T).add(new THREE.Vector3(Math.sin(OV_A) * Math.cos(OV_E), Math.cos(OV_A) * Math.cos(OV_E), Math.sin(OV_E)).multiplyScalar(OV_D));
  controls.target.copy(OV_T); controls.update();
  load.done();
  v.start();
  return {
    pause() { v.stop(); },
    resume() { v.start(); },
    dispose() { v.dispose(); root.remove(); },
  };
}
