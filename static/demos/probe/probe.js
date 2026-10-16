// "Click a part, see where every cousin has it": the demonstrated object and its cousins as Gaussian splats, side by side
// in their aligned poses. Click or tap a point on any object; every Gaussian of every object is coloured by the cosine
// similarity of its distilled DINOv3 feature to the clicked one, so the matching part lights up on each cousin.
//
// Data (built offline): the align demo's splats and transforms (align/<obj>.spz, align/<obj>.bin, align.json; the last
// transform of each object is its final aligned pose) and, per object, probe/<obj>.f8 = n x k int8 features in splat order:
// the DINOv3 feature of each Gaussian (decoded by the splat's own MLP), centred per object, projected onto one PCA basis per
// task and L2-normalised, so a dot product is the cosine similarity. probe.json lists k, the objects and the presets.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createViewer, loadingOverlay, mat4 } from '../core/viewer.js';
import { url, fetchJSON, fetchBin } from '../core/assets.js';

const GREY = new THREE.Color(0.6, 0.62, 0.66);
// plasma, 9 stops (matplotlib), for the similarity heatmap
const PLASMA = [[13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150], [203, 70, 121], [229, 107, 93], [248, 148, 65],
                [253, 195, 40], [240, 249, 33]].map(c => c.map(x => x / 255));
const DEFAULT_SHARP = 85;              // percentile of each object's own similarities that maps to "no match"
const TEXT = {
  match: 'Every Gaussian is coloured by the cosine similarity of its DINOv3 feature to the clicked point (the white marker), '
    + 'relative to that object\'s own best match: <b>yellow</b> is the closest part on each object, grey is everything below '
    + 'the sharpness cut. The features are distilled into each splat from DINOv3 and compared in one 16-dimensional PCA basis per '
    + 'task; this is the signal the semantic ICP clusters on to pair a handle with a handle and a tray with a tray. '
    + 'Click or tap any part of any object.',
  dino: 'The first three principal components of the DINOv3 features distilled into each splat, one basis per task, so the same '
    + 'part gets a similar colour on every object. Switch to <b>Match</b> and click a part to see the similarity itself.',
  rgb: 'The splats as scanned (the demonstrated objects) or generated from photographs (the cousins), shown in their aligned '
    + 'poses. Switch to <b>Match</b> and click a part to see where every cousin has it.',
};

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function plasma(u, out) {
  const x = Math.min(1, Math.max(0, u)) * (PLASMA.length - 1), i = Math.min(PLASMA.length - 2, Math.floor(x)), f = x - i;
  const a = PLASMA[i], b = PLASMA[i + 1];
  return out.setRGB(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), THREE.SRGBColorSpace);
}
const smooth = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

// One object: the splat, its colourings (as loaded, DINOv3) packed once, its features and its Gaussian centres.
async function loadObject(id, k) {
  const mesh = new SplatMesh({ url: url(`align/${id}.spz`) });
  const [bin, f8] = await Promise.all([fetchBin(`align/${id}.bin`), fetchBin(`probe/${id}.f8`), mesh.initialized]);
  const ps = mesh.packedSplats, n = ps.numSplats, b = new Uint8Array(bin), q = new Int8Array(f8);
  if (b.length !== 4 * n || q.length !== k * n) throw new Error(`probe/${id}: data for ${b.length / 4}, ${q.length / k} splats, splat has ${n}`);
  const base = ps.packedArray.slice();
  for (let i = 0; i < n; i++) {
    const g = ps.getSplat(i);
    g.color.setRGB(b[3 * i] / 255, b[3 * i + 1] / 255, b[3 * i + 2] / 255);
    ps.setSplat(i, g.center, g.scales, g.quaternion, g.opacity, g.color);
  }
  const dino = ps.packedArray.slice(); ps.packedArray.set(base);
  const local = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { const c = ps.getSplat(i).center; local[3 * i] = c.x; local[3 * i + 1] = c.y; local[3 * i + 2] = c.z; }
  const show = arr => { ps.packedArray.set(arr); ps.needsUpdate = true; if (mesh.updateVersion) mesh.updateVersion(); };
  return {
    mesh, n, q, local, world: new Float32Array(3 * n),
    showRgb() { show(base); }, showDino() { show(dino); },
    showMatch(sim, cut) {                                   // sim: cosine per Gaussian; cut: the object's "no match" level
      ps.packedArray.set(base);
      let hi = -Infinity; for (let i = 0; i < n; i++) if (sim[i] > hi) hi = sim[i];
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const g = ps.getSplat(i), u = (sim[i] - cut) / Math.max(1e-6, hi - cut), w = smooth(u / 0.15);
        if (u > 0) plasma(0.08 + 0.92 * u, col); else col.copy(GREY);
        g.color.lerpColors(GREY, col, w);
        ps.setSplat(i, g.center, g.scales, g.quaternion, g.opacity * (0.3 + 0.7 * w), g.color);
      }
      show(ps.packedArray.slice());
    },
  };
}

export async function mount(root) {
  if (!document.querySelector('link[data-demo-css="probe"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url('probe/probe.css'); l.dataset.demoCss = 'probe';
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
  controls.maxPolarAngle = Math.PI * 0.6;
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  let A, P;
  try { [A, P] = await Promise.all([fetchJSON('align/align.json'), fetchJSON('probe/probe.json')]); }
  catch (e) { load.error('Could not load the probe data.'); throw e; }
  const meta = Object.fromEntries(A.tasks.map(t => [t.id, Object.fromEntries(t.objects.map(o => [o.id, o]))]));
  const tasks = P.tasks.map(t => ({ ...t, label: A.tasks.find(a => a.id === t.id).label,
                                   objects: t.objects.map(o => ({ ...o, ...meta[t.id][o.id] })) }));

  // ── UI ──
  const bar = el('div', 'demo-bar probe-bar');
  const gTask = el('div', 'seg'); gTask.setAttribute('role', 'group'); gTask.setAttribute('aria-label', 'Task');
  const taskBtns = tasks.map((t, i) => { const b = el('button', '', t.label); b.onclick = () => setTask(i); gTask.append(b); return b; });
  const gCol = el('div', 'seg'); gCol.setAttribute('role', 'group'); gCol.setAttribute('aria-label', 'Colour');
  const colBtns = [['rgb', 'Colour'], ['dino', 'DINOv3'], ['match', 'Match']].map(([k, lab]) => {
    const b = el('button', '', lab); b.dataset.v = k; b.onclick = () => setMode(k); gCol.append(b); return b; });
  const gPre = el('div', 'seg probe-presets'); gPre.setAttribute('role', 'group'); gPre.setAttribute('aria-label', 'Part');
  const sharp = el('label', 'probe-sharp');
  const range = el('input', 'drange'); range.type = 'range'; range.min = 50; range.max = 97; range.value = DEFAULT_SHARP;
  range.setAttribute('aria-label', 'Sharpness');
  sharp.append(el('span', 'dlabel', 'Sharpness'), range);
  const r1 = el('div', 'probe-row'), r2 = el('div', 'probe-row');
  r1.append(gTask, gCol); r2.append(gPre, sharp);
  bar.append(r1, r2);
  const note = el('div', 'demo-note');
  root.append(bar, note);

  const hudTL = el('div', 'demo-hud tl'); const modeHud = el('span', 'hud'); hudTL.append(modeHud);
  const hudBL = el('div', 'demo-hud bl'); const demoHud = el('span', 'hud dot'); demoHud.style.setProperty('--c', '#6ba8ff'); hudBL.append(demoHud);
  const hudBR = el('div', 'demo-hud br'); const legend = el('span', 'hud probe-legend', '<span class="mut">no match</span><i></i><span class="mut">best</span>');
  hudBR.append(legend);
  stage.append(hudTL, hudBL, hudBR);

  // ── scene ──
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: 0x6ba8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ring.renderOrder = -1; scene.add(ring);
  const marker = new THREE.Group();
  marker.add(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })),
             new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 14), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.55 })));
  marker.children[0].renderOrder = 11; marker.children[1].renderOrder = 10; marker.visible = false; scene.add(marker);

  const cache = new Map();
  const st = { task: -1, mode: 'match', anchor: null, shown: [], token: 0, size: 0.2, sims: null };
  const getObj = (t, o) => { if (!cache.has(o.id)) cache.set(o.id, loadObject(o.id, t.k)); return cache.get(o.id); };
  const T = () => tasks[st.task];
  function setPressed(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }

  function refreshUI() {
    const t = T();
    taskBtns.forEach((b, i) => setPressed(b, i === st.task));
    colBtns.forEach(b => setPressed(b, b.dataset.v === st.mode));
    [...gPre.children].forEach(b => setPressed(b, st.anchor && st.anchor.preset === +b.dataset.i));
    const demo = t.objects.find(o => o.role === 'demo');
    demoHud.innerHTML = `<b>${demo.label}</b> <span class="mut">&middot; blue ring</span>`;
    const a = st.anchor;
    modeHud.innerHTML = st.mode === 'match'
      ? (a ? `<b>Match</b> <span class="mut">&middot; ${a.preset != null ? t.presets[a.preset].label.toLowerCase() : 'clicked point'}</span>` : '<b>Match</b> <span class="mut">&middot; click a part</span>')
      : st.mode === 'dino' ? '<b>DINOv3 features</b> <span class="mut">&middot; first 3 principal components</span>'
      : '<b>Splats</b> <span class="mut">&middot; as scanned or generated</span>';
    legend.style.display = st.mode === 'match' ? '' : 'none';
    sharp.style.visibility = st.mode === 'match' ? '' : 'hidden';
    note.innerHTML = TEXT[st.mode];
  }

  // layout: every object at its final aligned pose, then spread on a grid facing the camera (demonstrated object first)
  function layout(t, objs) {
    const demo = objs.find(d => d.o.role === 'demo'), M0 = mat4(demo.o.M[demo.o.M.length - 1]);
    const b = new THREE.Box3(), p = new THREE.Vector3();
    for (let i = 0; i < demo.obj.n; i += 7) b.expandByPoint(p.set(demo.obj.local[3 * i], demo.obj.local[3 * i + 1], demo.obj.local[3 * i + 2]).applyMatrix4(M0));
    const size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
    const r = 0.5 * Math.max(size.x, size.y), wide = v.size[0] / Math.max(1, v.size[1]) > 1.25;
    const main = objs.filter(d => d.o.role !== 'context'), n = main.length;
    const cols = wide ? (n <= 4 ? n : Math.ceil(n / 2)) : 2, rows = Math.ceil(n / cols);
    const f = new THREE.Vector3(Math.cos(t.view), Math.sin(t.view), 0), e = new THREE.Vector3(0, 0, 1).cross(f);   // f: towards the camera
    const sx = (t.id === 'place' ? 2.6 : 2.25) * r, sy = (wide ? 1.9 : 2.7) * r;
    main.forEach((d, k) => {                                // rows staggered by half a column, so the back row shows between
      const row = Math.floor(k / cols), inRow = Math.min(cols, n - row * cols), c = k % cols + (row % 2 ? 0.5 : 0) - (inRow - cols) / 2;
      d.offset = e.clone().multiplyScalar((c - (cols - 1) / 2 - (rows > 1 ? 0.25 : 0)) * sx).addScaledVector(f, ((rows - 1) / 2 - row) * sy);
    });
    for (const d of objs) if (d.o.role === 'context') d.offset = demo.offset;
    for (const d of objs) {
      const M = new THREE.Matrix4().makeTranslation(d.offset.x, d.offset.y, d.offset.z).multiply(mat4(d.o.M[d.o.M.length - 1]));
      d.obj.mesh.matrixAutoUpdate = false; d.obj.mesh.matrix.copy(M); d.obj.mesh.matrixWorldNeedsUpdate = true;
      const W = d.obj.world, L = d.obj.local, q = new THREE.Vector3();
      for (let i = 0; i < d.obj.n; i++) { q.set(L[3 * i], L[3 * i + 1], L[3 * i + 2]).applyMatrix4(M); W[3 * i] = q.x; W[3 * i + 1] = q.y; W[3 * i + 2] = q.z; }
    }
    ring.position.set(ctr.x + demo.offset.x, ctr.y + demo.offset.y, 0.001); ring.scale.setScalar(1.1 * r);
    st.size = Math.max(size.x, size.y, size.z);
    marker.scale.setScalar(0.022 * st.size);
    // camera: from the front, a little from above, at the distance that fits every Gaussian in view
    camera.aspect = v.size[0] / Math.max(1, v.size[1]); camera.updateProjectionMatrix();
    const elev = wide ? 0.42 : 0.62, back = f.clone().multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, 0, Math.sin(elev)));
    const right = e.clone(), upv = new THREE.Vector3().crossVectors(back, right).negate().normalize();
    const pts = [], gc = new THREE.Vector3();
    for (const d of objs) for (let i = 0; i < d.obj.n; i += 9) { const w = d.obj.world; pts.push(new THREE.Vector3(w[3 * i], w[3 * i + 1], w[3 * i + 2])); }
    pts.forEach(q => gc.add(q)); gc.multiplyScalar(1 / pts.length);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), th = tv * camera.aspect;
    let dist = 0;
    for (const q of pts) {
      const rel = q.clone().sub(gc), x = Math.abs(rel.dot(right)), y = Math.abs(rel.dot(upv)), z = rel.dot(back);
      dist = Math.max(dist, z + x / (0.88 * th), z + y / (0.84 * tv));
    }
    camera.position.copy(gc).addScaledVector(back, dist);
    controls.target.copy(gc); controls.minDistance = dist * 0.35; controls.maxDistance = dist * 2; controls.update();
  }

  function colour() {
    const objs = st.shown;
    if (st.mode === 'rgb') { objs.forEach(d => d.obj.showRgb()); return; }
    if (st.mode === 'dino' || !st.anchor) { objs.forEach(d => d.obj.showDino()); return; }
    const pct = +range.value / 100;
    for (const d of objs) {
      const sim = st.sims.get(d.o.id), sorted = Float32Array.from(sim).sort();
      d.obj.showMatch(sim, sorted[Math.min(sorted.length - 1, Math.floor(pct * sorted.length))]);
    }
  }

  function setAnchor(d, i, preset) {
    const t = T(), k = t.k, a = d.obj.q.subarray(k * i, k * i + k);
    st.anchor = { id: d.o.id, i, preset };
    st.sims = new Map();
    for (const e of st.shown) {
      const q = e.obj.q, n = e.obj.n, s = new Float32Array(n);
      for (let j = 0; j < n; j++) { let acc = 0; const o = k * j; for (let c = 0; c < k; c++) acc += q[o + c] * a[c]; s[j] = acc / 16129; }
      st.sims.set(e.o.id, s);
    }
    const W = d.obj.world; marker.position.set(W[3 * i], W[3 * i + 1], W[3 * i + 2]); marker.visible = true;
    if (st.mode !== 'match') st.mode = 'match';
    colour(); refreshUI();
  }

  function buildPresets() {
    gPre.innerHTML = '';
    T().presets.forEach((p, i) => {
      const b = el('button', '', p.label); b.dataset.i = i;
      b.onclick = () => { const d = st.shown.find(e => e.o.id === p.obj); if (d) setAnchor(d, p.i, i); };
      gPre.append(b);
    });
  }

  async function setTask(i) {
    if (i === st.task) return;
    const tok = ++st.token; st.task = i; st.anchor = null; marker.visible = false;
    buildPresets(); refreshUI();
    const t = T(); load.set(0, 'Loading the splats');
    let done = 0;
    const objs = await Promise.all(t.objects.map(o => getObj(t, o).then(obj => { load.set(++done / t.objects.length); return { o, obj }; })));
    if (tok !== st.token) return;
    for (const d of st.shown) scene.remove(d.obj.mesh);
    st.shown = objs; for (const d of objs) scene.add(d.obj.mesh);
    t.view = t.view != null ? t.view : viewAngle(t, objs);
    layout(t, objs);
    const p0 = t.presets[0], d0 = objs.find(d => d.o.id === p0.obj);
    setAnchor(d0, p0.i, 0);
    load.done(); if (poster) poster.remove();
  }

  // view direction: towards the machine's tray, the mug's handle side, the drill side-on (across its barrel), turned a little
  function viewAngle(t, objs) {
    const d = objs.find(e => e.o.id === t.presets[0].obj), M = mat4(d.o.M[d.o.M.length - 1]), L = d.obj.local;
    const at = j => new THREE.Vector3(L[3 * j], L[3 * j + 1], L[3 * j + 2]).applyMatrix4(M);
    const c = new THREE.Vector3(); for (let i = 0; i < d.obj.n; i++) c.add(at(i)); c.multiplyScalar(1 / d.obj.n);
    if (t.id === 'drill') { const b = at(t.presets[1].i).sub(at(t.presets[0].i)); return Math.atan2(b.y, b.x) - Math.PI / 2 + 0.3; }
    const p = at(t.presets[0].i).sub(c);
    return Math.atan2(p.y, p.x) + (t.id === 'hang' ? 1.1 : 0.45);
  }

  function setMode(k) { st.mode = k; marker.visible = k === 'match' && !!st.anchor; colour(); refreshUI(); }

  // click or tap (not a drag): the front-most Gaussian within a small radius of the ray
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 500) { down = null; return; }
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, dir = ray.ray.direction, rr = (0.02 * st.size) ** 2;
    let best = null, bt = Infinity;
    for (const d of st.shown) {
      const W = d.obj.world;
      for (let i = 0; i < d.obj.n; i++) {
        const px = W[3 * i] - o.x, py = W[3 * i + 1] - o.y, pz = W[3 * i + 2] - o.z, tt = px * dir.x + py * dir.y + pz * dir.z;
        if (tt <= 0 || tt >= bt) continue;
        const qx = px - tt * dir.x, qy = py - tt * dir.y, qz = pz - tt * dir.z;
        if (qx * qx + qy * qy + qz * qz < rr) { bt = tt; best = { d, i }; }
      }
    }
    if (best) setAnchor(best.d, best.i, null);
  });
  let pending = 0;
  range.addEventListener('input', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; colour(); }); });
  // re-lay the grid only when the stage flips between wide and narrow (a phone rotating), not on every resize
  let wideNow = null;
  v.onResize = (w, h) => {
    const wide = w / Math.max(1, h) > 1.25; if (wide === wideNow || !st.shown.length) { wideNow = wide; return; }
    wideNow = wide; layout(T(), st.shown);
    if (st.anchor) { const d = st.shown.find(e => e.o.id === st.anchor.id), W = d.obj.world, i = st.anchor.i; marker.position.set(W[3 * i], W[3 * i + 1], W[3 * i + 2]); }
  };

  if (new URLSearchParams(location.search).has('debug')) window.__probe = { st, setTask, setAnchor, setMode, camera, v };
  try { await setTask(0); } catch (e) { load.error('Could not load the splats.'); throw e; }
  v.start();
  refreshUI();
}
