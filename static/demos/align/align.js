// "Semantic alignment, stage by stage": the demonstrated object(s) and a cousin as Gaussian splats, with the cousin moved by
// the similarity transform the alignment produced after each stage. Colour shows the splats as scanned or generated (the
// region that anchors the weighted stage in pink once it is used); DINOv3 shows the distilled features in one PCA basis per
// task, so the same part has the same colour on every object.
//
// Data (align.json + <obj>.spz + <obj>.bin, built offline by the private build_align.py): per task, stages and objects;
// per object a row-major 4x4 per stage, mapping the splat's own coordinates to the task frame (metres, z up, table at
// z = 0); <obj>.bin = n x 3 DINOv3 colour bytes then n region bytes, in splat order.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createViewer, reducedMotion, loadingOverlay, mat4, easeInOutCubic } from '../core/viewer.js';
import { url, fetchJSON, fetchBin } from '../core/assets.js';

const PINK = new THREE.Color(232 / 255, 0, 125 / 255);
const GHOST = new THREE.Color(0.42, 0.66, 1.0);
const MOVE_S = 1.25, HOLD_S = 1.9, NEXT_S = 2.6;

const TEXT = {
  start: {
    place: '<b>Generated cousin.</b> A coffee machine generated from photographs, in the pose it came out in. Its scale means nothing until stage 1 learns it, so it is shown at the size of the demonstrated machine.',
    hang: '<b>Generated cousin.</b> A mug generated from photographs, in the pose it came out in. Its scale means nothing until stage 1 learns it, so it is shown at the size of the demonstrated mug.',
    drill: '<b>Generated cousin.</b> A drill generated from photographs, set on its resting face and scaled to the height of the demonstrated drill.',
  },
  s1: '<b>Semantic ICP.</b> DINOv3 features distilled into both splats are clustered, and ICP pairs points only within matching clusters, so a handle pairs with a handle and a rim with a rim. The fit starts from a few orientations and learns the scale.',
  s2: {
    place: '<b>Tray-weighted ICP.</b> The tray, where the demonstrated mug lands, is found on the cousin by DINOv3 similarity and weighted 20&times;, so the alignment anchors the placement to the tray rather than to the machine\'s body.',
    hang: '<b>Handle-weighted ICP.</b> The part of the demonstrated mug that touches the tree when it hangs, the handle and the side beside it, is carried to the cousin through stage 1 and weighted 20&times;.',
    drill: '<b>Handle-weighted ICP.</b> The handle the gripper closes on is found on the cousin by DINOv3 similarity and weighted 20&times;.',
  },
  s3: '<b>Upright projection.</b> The weighted fit buys local accuracy with a few degrees of tilt. The rotation is projected onto a yaw about the table normal and re-translated so the weighted region stays where it was.',
};
const REGION = { place: 'tray', hang: 'handle', drill: 'handle' };

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function decompose(M) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  M.decompose(p, q, s);
  return { p, q, s: (s.x + s.y + s.z) / 3 };
}

// faint table disc with a 5 cm grid at z = 0
function makeTable(r) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x8fa6c8) }, uGrid: { value: new THREE.Color(0x5d7fb0) }, uR: { value: r } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec3 uGrid; uniform float uR; varying vec2 vP;
      void main(){
        float fall = smoothstep(1.0, 0.2, length(vP) / uR);
        vec2 g = abs(fract(vP / 0.05 - 0.5) - 0.5) / fwidth(vP / 0.05);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        gl_FragColor = vec4(mix(uColor, uGrid, line * 0.55), 0.42 * fall * (0.34 + 0.22 * line));
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), mat);
  m.renderOrder = -2;
  return m;
}

// One splat object: the mesh plus three colourings packed once (as loaded, with the region in pink, DINOv3), swapped in
// by copying the packed array.
async function loadObject(id) {
  const mesh = new SplatMesh({ url: url(`align/${id}.spz`) });
  const [bin] = await Promise.all([fetchBin(`align/${id}.bin`), mesh.initialized]);
  const ps = mesh.packedSplats, n = ps.numSplats, b = new Uint8Array(bin);
  if (b.length !== 4 * n) throw new Error(`align/${id}: ${b.length} bytes for ${n} splats`);
  const base = ps.packedArray.slice();
  const recolor = fn => {
    for (let i = 0; i < n; i++) {
      const g = ps.getSplat(i);
      if (fn(i, g.color)) ps.setSplat(i, g.center, g.scales, g.quaternion, g.opacity, g.color);
    }
    const out = ps.packedArray.slice(); ps.packedArray.set(base); return out;
  };
  let nReg = 0;
  const region = recolor((i, c) => { if (!b[3 * n + i]) return false; nReg++; c.lerp(PINK, 0.85); return true; });
  const dino = recolor((i, c) => { c.setRGB(b[3 * i] / 255, b[3 * i + 1] / 255, b[3 * i + 2] / 255); return true; });
  // the demonstrated object as a light-blue ghost, so the cousin reads against it
  const ghost = recolor((i, c) => { c.lerp(GHOST, 0.78); return true; });
  const ghostRegion = recolor((i, c) => { c.lerp(b[3 * n + i] ? PINK : GHOST, b[3 * n + i] ? 0.9 : 0.78); return true; });
  const centers = [];
  for (let i = 0; i < n; i += 3) centers.push(ps.getSplat(i).center.clone());
  const regCenters = [];
  for (let i = 0; i < n; i++) if (b[3 * n + i]) regCenters.push(ps.getSplat(i).center.clone());
  let cur = null;
  return {
    mesh, n, nReg, centers, regCenters,
    show(kind) {                                      // 'rgb' | 'region' | 'dino' | 'ghost' | 'ghostRegion'
      if (kind === cur) return; cur = kind;
      ps.packedArray.set({ region, dino, ghost, ghostRegion }[kind] || base);
      ps.needsUpdate = true;
      if (mesh.updateVersion) mesh.updateVersion();
    },
  };
}

function box(points, M) {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (const c of points) b.expandByPoint(v.copy(c).applyMatrix4(M));
  return b;
}

export async function mount(root) {
  if (!document.querySelector('link[data-demo-css="align"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url('align/align.css'); l.dataset.demoCss = 'align';
    document.head.appendChild(l);
  }
  let stage = root.querySelector('.demo-stage');
  if (!stage) { stage = el('div', 'demo-stage'); root.prepend(stage); }
  const poster = stage.querySelector('.demo-poster');
  root.querySelectorAll('.demo-fallback').forEach(f => f.remove());
  const load = loadingOverlay(stage, 'Loading the splats');

  const v = createViewer(stage, { ground: false, shadows: false, fov: 30, maxDpr: 1.5 });
  const { renderer, scene, camera, controls } = v;
  renderer.toneMapping = THREE.NoToneMapping;
  controls.autoRotate = false;
  controls.maxPolarAngle = Math.PI * 0.62;
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  let A;
  try { A = await fetchJSON('align/align.json'); } catch (e) { load.error('Could not load the alignment data.'); throw e; }
  const tasks = A.tasks;

  // ── UI ──
  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
  const bar = el('div', 'demo-bar align-bar');
  const play = el('button', 'dbtn ghost align-play', '');
  const steps = el('div', 'seg align-steps'); steps.setAttribute('role', 'group'); steps.setAttribute('aria-label', 'Alignment stage');
  const gTask = el('div', 'seg'); gTask.setAttribute('role', 'group'); gTask.setAttribute('aria-label', 'Task');
  const taskBtns = tasks.map((t, i) => { const b = el('button', '', t.label); b.onclick = () => setTask(i, true); gTask.append(b); return b; });
  const gCol = el('div', 'seg'); gCol.setAttribute('role', 'group'); gCol.setAttribute('aria-label', 'Colour');
  const bRgb = el('button', '', 'Colour'), bDino = el('button', '', 'DINOv3');
  gCol.append(bRgb, bDino);
  const cous = el('div', 'align-cousin');
  const prev = el('button', 'dbtn ghost align-arrow', '<svg viewBox="0 0 16 16"><path d="M10.5 2.5 5 8l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>');
  const next = el('button', 'dbtn ghost align-arrow', '<svg viewBox="0 0 16 16"><path d="M5.5 2.5 11 8l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>');
  prev.setAttribute('aria-label', 'Previous cousin'); next.setAttribute('aria-label', 'Next cousin');
  const cLab = el('span', 'dlabel align-clab');
  cous.append(prev, cLab, next);
  const r1 = el('div', 'align-row'), r2 = el('div', 'align-row');
  r1.append(play, steps); r2.append(gTask, cous, gCol);
  bar.append(r1, r2);
  const note = el('div', 'demo-note align-note');
  root.append(bar, note);

  const hudTL = el('div', 'demo-hud tl'); const stageHud = el('span', 'hud'); hudTL.append(stageHud);
  const hudBL = el('div', 'demo-hud bl');
  const demoHud = el('span', 'hud dot'); demoHud.style.setProperty('--c', '#6ba8ff');
  const regHud = el('span', 'hud dot'); regHud.style.setProperty('--c', '#e8007d');
  hudBL.append(demoHud, regHud);
  stage.append(hudTL, hudBL);

  // ── scene ──
  const table = makeTable(0.6); scene.add(table);
  const cache = new Map();
  const getObj = id => { if (!cache.has(id)) cache.set(id, loadObject(id)); return cache.get(id); };
  const st = { task: -1, cousin: tasks.map(() => 0), stage: 0, mode: 'rgb', playing: !reducedMotion(), anim: null, hold: 0,
               shown: [], cur: null, demos: [], token: 0 };

  function setPressed(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  const T = () => tasks[st.task];
  const cousinsOf = t => t.objects.filter(o => o.role === 'cousin');
  const weightedStage = t => t.stages.findIndex(s => s.key === 's2');

  function refreshUI() {
    const t = T(), cs = cousinsOf(t), c = cs[st.cousin[st.task]];
    play.innerHTML = st.playing ? ICON_PAUSE + '<span>Pause</span>' : ICON_PLAY + '<span>Play</span>';
    play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play the stages');
    taskBtns.forEach((b, i) => setPressed(b, i === st.task));
    setPressed(bRgb, st.mode === 'rgb'); setPressed(bDino, st.mode === 'dino');
    [...steps.children].forEach((b, i) => setPressed(b, i === st.stage));
    cLab.innerHTML = `<b>${c.label}</b> <span class="mut">${st.cousin[st.task] + 1}/${cs.length}</span>`;
    const s = t.stages[st.stage];
    stageHud.innerHTML = `<b>${st.stage === 0 ? 'Start' : 'Stage ' + st.stage}</b> <span class="mut">&middot; ${s.label}</span>`;
    const txt = TEXT[s.key]; note.innerHTML = (typeof txt === 'string' ? txt : txt[t.id]) +
      (st.mode === 'dino' ? ' <span class="align-dino-note">Colours: the first three principal components of the DINOv3 features distilled into each splat, one basis per task, so matching parts get similar colours across objects. These are the features the semantic ICP clusters on.</span>' : '');
    const demoLabel = t.objects.filter(o => o.role === 'demo').map(o => o.label)[0];
    demoHud.innerHTML = `<b>${demoLabel}</b>`;
    const showReg = st.mode === 'rgb' && st.stage >= weightedStage(t) && weightedStage(t) > 0;
    regHud.innerHTML = `<b>${REGION[t.id][0].toUpperCase() + REGION[t.id].slice(1)} region</b> <span class="mut">&middot; weighted 20&times;</span>`;
    regHud.style.display = showReg ? '' : 'none';
  }

  function buildSteps() {
    steps.innerHTML = '';
    T().stages.forEach((s, i) => {
      const b = el('button', '', `<span class="n">${i}</span><span class="lg">${s.label}</span><span class="sm">${s.label.split(/[- ]/)[0]}</span>`);
      b.onclick = () => { pause(); goStage(i); };
      steps.append(b);
    });
  }

  function colouring() {
    const t = T(), regOn = st.stage >= weightedStage(t) && weightedStage(t) > 0;
    for (const d of st.demos) {
      const demo = d.o.role === 'demo';
      d.obj.show(st.mode === 'dino' ? 'dino' : !demo ? 'rgb' : regOn ? 'ghostRegion' : 'ghost');
      d.obj.mesh.opacity = demo ? 0.3 : 1;
    }
    if (st.cur) st.cur.obj.show(st.mode === 'dino' ? 'dino' : regOn ? 'region' : 'rgb');
  }

  function poseAt(o, k) { return decompose(mat4(o.M[Math.min(k, o.M.length - 1)])); }
  function place(mesh, P) { mesh.position.copy(P.p); mesh.quaternion.copy(P.q); mesh.scale.setScalar(P.s); }

  function goStage(k, instant) {
    const t = T(); k = Math.max(0, Math.min(t.stages.length - 1, k));
    const c = st.cur; if (!c) { st.stage = k; refreshUI(); return; }
    const from = st.anim ? currentPose() : poseAt(c.o, st.stage), to = poseAt(c.o, k);
    st.stage = k; refreshUI(); colouring();
    if (instant || reducedMotion()) { st.anim = null; place(c.obj.mesh, to); return; }
    st.anim = { from, to, t: 0 };
  }
  function currentPose() {
    const a = st.anim, u = easeInOutCubic(a.t);
    return { p: a.from.p.clone().lerp(a.to.p, u), q: a.from.q.clone().slerp(a.to.q, u), s: Math.exp((1 - u) * Math.log(a.from.s) + u * Math.log(a.to.s)) };
  }

  function fitCamera() {
    const t = T(), b = new THREE.Box3();
    for (const d of st.demos) b.union(box(d.obj.centers, mat4(d.o.M[0])));
    if (st.cur) b.union(box(st.cur.obj.centers, mat4(st.cur.o.M[0])));
    const ctr = b.getCenter(new THREE.Vector3()), rad = b.getSize(new THREE.Vector3()).length() / 2;
    // look at the weighted region from the side, a little from above
    const demo = st.demos.find(d => d.o.role === 'demo');
    const rc = demo.obj.regCenters.length ? box(demo.obj.regCenters, mat4(demo.o.M[0])).getCenter(new THREE.Vector3()) : ctr.clone().add(new THREE.Vector3(0, -1, 0));
    const dir = rc.sub(box(demo.obj.centers, mat4(demo.o.M[0])).getCenter(new THREE.Vector3())); dir.z = 0;
    if (dir.lengthSq() < 1e-8) dir.set(1, -1, 0);
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 0, 1), t.id === 'hang' ? 1.05 : 0.62);
    const elev = 0.42, dist = rad / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * (v.size[0] < 520 ? 1.12 : 0.92) * (t.id === 'hang' ? 1.25 : 1);
    camera.position.copy(ctr).addScaledVector(dir, Math.cos(elev) * dist).add(new THREE.Vector3(0, 0, Math.sin(elev) * dist));
    controls.target.copy(ctr); controls.minDistance = rad * 0.8; controls.maxDistance = dist * 2.2; controls.update();
    table.position.set(ctr.x, ctr.y, -0.0015);
    table.scale.setScalar(Math.max(0.35, rad * 1.6) / 0.6);
  }

  async function setTask(i, user) {
    if (user) pause();
    if (i === st.task) return;
    const tok = ++st.token;
    st.task = i; st.stage = 0; buildSteps(); refreshUI();
    const t = T(), others = t.objects.filter(o => o.role !== 'cousin');
    const objs = await Promise.all(others.map(o => getObj(o.id)));
    if (tok !== st.token) return;
    for (const d of st.demos) scene.remove(d.obj.mesh);
    st.demos = others.map((o, k) => ({ o, obj: objs[k] }));
    for (const d of st.demos) { place(d.obj.mesh, poseAt(d.o, 0)); scene.add(d.obj.mesh); }
    await setCousin(st.cousin[i], true);
  }

  async function setCousin(k, fit) {
    const t = T(), cs = cousinsOf(t); k = (k + cs.length) % cs.length;
    const tok = ++st.token;
    st.cousin[st.task] = k; refreshUI();
    const o = cs[k], obj = await getObj(o.id);
    if (tok !== st.token) return;
    if (st.cur) scene.remove(st.cur.obj.mesh);
    st.cur = { o, obj }; st.anim = null; scene.add(obj.mesh);
    place(obj.mesh, poseAt(o, st.stage));
    colouring(); refreshUI();
    if (fit) fitCamera();
    getObj(cs[(k + 1) % cs.length].id);                       // prefetch the next cousin
    if (poster) poster.remove();
  }

  function pause() { if (st.playing) { st.playing = false; refreshUI(); } }
  play.onclick = () => { st.playing = !st.playing; st.hold = 0; refreshUI(); };
  prev.onclick = () => { pause(); setCousin(st.cousin[st.task] - 1, false); };
  next.onclick = () => { pause(); setCousin(st.cousin[st.task] + 1, false); };
  bRgb.onclick = () => { st.mode = 'rgb'; colouring(); refreshUI(); };
  bDino.onclick = () => { st.mode = 'dino'; colouring(); refreshUI(); };
  controls.addEventListener('start', () => { st.userOrbit = true; });

  v.add(dt => {
    const c = st.cur; if (!c) return;
    if (st.anim) {
      st.anim.t = Math.min(1, st.anim.t + dt / MOVE_S);
      place(c.obj.mesh, currentPose());
      if (st.anim.t >= 1) { st.anim = null; st.hold = 0; }
      return;
    }
    if (!st.playing) return;
    st.hold += dt;
    const last = T().stages.length - 1;
    if (st.stage < last && st.hold > HOLD_S) goStage(st.stage + 1);
    else if (st.stage === last && st.hold > NEXT_S) { st.stage = 0; setCousin(st.cousin[st.task] + 1, false); st.hold = 0; }
  });

  if (new URLSearchParams(location.search).has('debug')) window.__align = { st, setTask, setCousin, goStage, pause, fitCamera };
  try {
    await setTask(0, false);
  } catch (e) { load.error('Could not load the splats.'); throw e; }
  load.set(1); load.done();
  v.start();
  refreshUI();
}
