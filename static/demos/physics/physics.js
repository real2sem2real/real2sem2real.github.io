// Live MuJoCo demo: one of our generated xArm7 episodes (mug onto coffee machine) re-simulated with contact physics in
// the page, on the official MuJoCo WebAssembly build. The robot replays the episode's recorded joint targets open loop;
// everything else (mug, table, machine, the grasp) is simulated live.
import { createViewer, THREE, loadingOverlay, onTheme, reducedMotion } from '../core/viewer.js';
import { getObject, url, fetchJSON } from '../core/assets.js';
import { loadXArm } from '../core/robot.js';
import { EpisodeSim } from './sim.js';

const PAIRS = {
  demo_mug__demo_cm: 'Demo mug · demo machine',
  mug1__keurig_mint: 'Blue mug · mint machine',
  y3__keurig_silver: 'Striped mug · silver machine',
  mug6__holstein_cm: 'Brown mug · blue machine',
  mug8__bella_cm: 'Red mug · white machine',
  mug2__black_cm: 'Cream mug · black machine',
};
const PHASE = { HOME: 'Reach', PREGRASP_SLEW: 'Reach', APPROACH: 'Approach', GRASP_HOLD: 'Grasp', EXEC: 'Carry',
                PLACE_HOLD: 'Place', RETREAT: 'Release', SETTLE: 'Settle', DONE: 'Done' };
const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  restart: '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.5.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>',
};

export async function mount(el) {
  let stage = el.querySelector('.demo-stage');
  if (!stage) { stage = document.createElement('div'); stage.className = 'demo-stage'; el.prepend(stage); }
  const poster = stage.querySelector('.demo-poster');
  const gate = document.createElement('div');
  gate.className = 'demo-gate';
  gate.setAttribute('role', 'button'); gate.tabIndex = 0;
  gate.innerHTML = `<div class="go"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>Run live physics</div>`;
  stage.appendChild(gate);
  const start = () => { gate.remove(); run(el, stage, poster).catch(err => { console.error(err); }); };
  gate.addEventListener('click', start, { once: true });
  gate.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
}

async function fetchProgress(u, onFrac) {
  const r = await fetch(u); if (!r.ok) throw new Error(u + ': ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onFrac(got / total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function run(el, stage, poster) {
  const load = loadingOverlay(stage, 'Loading MuJoCo');
  let mujoco, index, robot;
  try {
    const [mod, wasm, idx] = await Promise.all([
      import('../vendor/mujoco/mujoco.js'),
      fetchProgress(url('vendor/mujoco/mujoco.wasm'), f => load.set(0.8 * f)),
      fetchJSON('physics/scenes/index.json'),
    ]);
    index = idx;
    load.set(0.82, 'Starting the physics engine');
    mujoco = await mod.default({ wasmBinary: wasm.buffer });
    load.set(0.88, 'Loading the robot');
    robot = await loadXArm();
  } catch (err) {
    load.error('Could not start MuJoCo in this browser.'); throw err;
  }
  const robotFiles = Object.fromEntries(await Promise.all(index.robot.map(async f =>
    [f, new Uint8Array(await (await fetch(url('physics/scenes/robot/' + f))).arrayBuffer())])));

  // ---- three.js stage ------------------------------------------------------------------------------------------
  const TARGET = new THREE.Vector3(0.22, 0.16, 0.17), VIEW = new THREE.Vector3(1.0, -0.72, 0.58).normalize(), RADIUS = 0.43;
  const V = createViewer(stage, { position: TARGET.clone().addScaledVector(VIEW, 2).toArray(), target: TARGET.toArray(), fov: 30 });
  V.controls.minDistance = 0.45; V.controls.maxDistance = 3.2;
  V.renderer.domElement.style.touchAction = 'pan-y';     // let the page scroll on phones; horizontal drags orbit
  V.fitShadow(new THREE.Vector3(0.3, 0.22, 0.1), 0.8);
  V.ground.visible = false;
  // frame the robot and the machine for the stage's aspect, until the visitor moves the camera themselves
  let userCam = false;
  V.controls.addEventListener('start', () => { userCam = true; });
  V.onResize = (w, h) => {
    el.classList.toggle('phys-narrow', w < 560);
    if (userCam) return;
    const vf = THREE.MathUtils.degToRad(V.camera.fov) / 2, hf = Math.atan(Math.tan(vf) * w / h);
    V.camera.position.copy(TARGET).addScaledVector(VIEW, (w < 560 ? 1.2 : 1) * RADIUS / Math.sin(Math.min(vf, hf)));
    V.controls.target.copy(TARGET); V.controls.update();
  };
  V.onResize(...V.size);
  // table: a disc that fades into the card background
  const fade = document.createElement('canvas'); fade.width = fade.height = 256;
  const g2 = fade.getContext('2d'), grd = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.55, '#fff'); grd.addColorStop(1, '#000');
  g2.fillStyle = grd; g2.fillRect(0, 0, 256, 256);
  const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, transparent: true, alphaMap: new THREE.CanvasTexture(fade), depthWrite: false });
  const table = new THREE.Mesh(new THREE.CircleGeometry(1.25, 96), tableMat);
  table.position.set(0.28, 0.2, 0); table.receiveShadow = true; table.renderOrder = -1;
  V.scene.add(table);
  onTheme(dark => tableMat.color.set(dark ? 0x1a2232 : 0xf1f4f9));
  V.scene.add(robot.root);

  if (!document.getElementById('phys-style')) {
    const st = document.createElement('style'); st.id = 'phys-style';
    st.textContent = '.phys-narrow .hud .phys-lg{display:none} .phys-narrow [data-k="weld"]{display:none}'
      + '.demo-hud.tr{flex-direction:column; align-items:flex-end}'
      + '.phys-forces{display:grid; grid-template-columns:auto auto 52px auto; gap:4px 7px; align-items:center; border-radius:12px; padding:8px 10px 9px; white-space:normal}'
      + '.phys-forces .pf-t{grid-column:1/-1; font-size:11px; font-weight:600; color:var(--muted); margin-bottom:1px}'
      + '.phys-forces .pf-d{width:8px; height:8px; border-radius:50%}'
      + '.phys-forces .pf-n{font-size:11.5px}'
      + '.phys-forces .pf-b{height:5px; border-radius:3px; background:color-mix(in srgb, var(--line) 70%, transparent); overflow:hidden}'
      + '.phys-forces .pf-b i{display:block; height:100%; border-radius:3px; transition:width .15s}'
      + '.phys-forces .pf-v{font-size:11.5px; font-variant-numeric:tabular-nums; text-align:right; min-width:42px}'
      + '.phys-forces.off{display:none}'
      + '.phys-narrow .phys-forces{grid-template-columns:auto auto auto} .phys-narrow .phys-forces .pf-b, .phys-narrow .phys-forces .pf-t{display:none}'
      + '.dbtn.ghost[aria-pressed="true"]{border-color:var(--accent); color:var(--accent)}';
    document.head.appendChild(st);
  }

  // contact forces on the mug: an arrow per contact pointing in the direction of the force, ending at the contact,
  // its length growing with the normal force; coloured by what the mug touches. While the hand carries the mug the
  // finger pads do not collide (the grasp is held as in the data generator), so the holding force is drawn at the two
  // finger pads instead, in the fingers' colour.
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const KINDS = { grip: ['--ours', 'Fingers'], table: ['--teleop', 'Table'], machine: ['--orange', 'Machine'], other: ['--muted', 'Robot'] };
  const cMat = {};
  for (const k of Object.keys(KINDS)) cMat[k] = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  onTheme(() => { for (const [k, [c]] of Object.entries(KINDS)) cMat[k].color.set(css(c) || '#888'); });
  const shaftGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 10), headGeo = new THREE.ConeGeometry(0.0068, 1, 18), dotGeo = new THREE.SphereGeometry(1, 18, 12);
  const Y = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3();
  function makeArrow(mat) {
    const g = new THREE.Group(), shaft = new THREE.Mesh(shaftGeo, mat), head = new THREE.Mesh(headGeo, mat), dot = new THREE.Mesh(dotGeo, mat);
    for (const m of [shaft, head, dot]) { m.renderOrder = 11; g.add(m); }
    g.visible = false; g.userData = { shaft, head, dot }; V.scene.add(g); return g;
  }
  function setArrow(g, mat, p, d, f, dotR = true) {        // tip at p, pointing along unit d, length from force f (N)
    const L = Math.min(0.13, 0.02 + 0.02 * Math.sqrt(f)), h = Math.min(0.016, 0.38 * L), u = g.userData;
    u.shaft.material = u.head.material = u.dot.material = mat;
    tmpD.set(d[0], d[1], d[2]).normalize();
    g.position.set(p[0], p[1], p[2]).addScaledVector(tmpD, -L);
    g.quaternion.setFromUnitVectors(Y, tmpD);
    u.shaft.position.y = (L - h) / 2; u.shaft.scale.y = L - h;
    u.head.position.y = L - h / 2; u.head.scale.y = h;
    u.dot.visible = dotR; u.dot.position.y = L; u.dot.scale.setScalar(0.0034 + 0.0022 * Math.min(1, f / 10));
    g.visible = true;
  }
  const pool = Array.from({ length: 32 }, () => makeArrow(cMat.table));
  const holdArrows = [makeArrow(cMat.grip), makeArrow(cMat.grip)];
  let showContacts = true;

  // ---- HUD + controls -------------------------------------------------------------------------------------------
  const hud = (cls, html) => { const d = document.createElement('div'); d.className = 'demo-hud ' + cls; d.innerHTML = html; stage.appendChild(d); return d; };
  hud('tl', '<span class="hud dot" style="--c:var(--green)"><b>Live MuJoCo</b> <span class="mut phys-lg">contact physics in your browser</span></span>');
  const hudTR = hud('tr', '<span class="hud" data-k="clock"></span><div class="hud phys-forces" data-k="forces"></div>');
  const hudBL = hud('bl', '<span class="hud" data-k="phase"></span><span class="hud" data-k="weld" hidden>Grasp held</span>');
  const $ = (root, k) => root.querySelector(`[data-k="${k}"]`);

  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  const opts = index.pairs.map(p => `<option value="${p.id}">${PAIRS[p.id] || p.id}</option>`).join('');
  bar.innerHTML = `
    <button class="dbtn" data-k="play" type="button" aria-label="Pause">${ICON.pause}Pause</button>
    <button class="dbtn ghost" data-k="restart" type="button">${ICON.restart}Restart</button>
    <div class="seg" role="group" aria-label="Speed">
      <button type="button" data-speed="1" aria-pressed="true">1&times;</button>
      <button type="button" data-speed="0.5" aria-pressed="false">&frac12;&times;</button>
    </div>
    <button class="dbtn ghost" data-k="contacts" type="button" aria-pressed="true">Contacts</button>
    <span class="sp"></span>
    <label class="dlabel" for="phys-pair">Objects</label>
    <select class="dselect" id="phys-pair" data-k="pair">${opts}</select>`;
  el.appendChild(bar);
  const btnPlay = $(bar, 'play'), sel = $(bar, 'pair');

  let sim = null, mugObj = null, cmObj = null, playing = !reducedMotion(), speed = 1, acc = 0, loading = false;
  let doneAt = null, rtfWall = 0, rtfSim = 0, rtf = 1;
  const setPlay = p => {
    playing = p;
    btnPlay.innerHTML = p ? `${ICON.pause}Pause` : `${ICON.play}Play`;
    btnPlay.setAttribute('aria-label', p ? 'Pause' : 'Play');
  };
  setPlay(playing);
  btnPlay.addEventListener('click', () => setPlay(!playing));
  $(bar, 'restart').addEventListener('click', () => { if (sim) { sim.reset(); doneAt = null; setPlay(true); } });
  bar.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    speed = +b.dataset.speed;
    bar.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  sel.addEventListener('change', () => loadPair(sel.value));
  $(bar, 'contacts').addEventListener('click', e => {
    showContacts = !showContacts; e.currentTarget.setAttribute('aria-pressed', String(showContacts));
    $(hudTR, 'forces').classList.toggle('off', !showContacts); drawContacts(true);
  });

  async function loadPair(id) {
    if (loading) return; loading = true; sel.disabled = true;
    const ov = sim ? loadingOverlay(stage, 'Loading scene') : null;
    try {
      const pair = index.pairs.find(p => p.id === id);
      const base = 'physics/scenes/' + id + '/';
      const [ep, files, mug, cm] = await Promise.all([
        fetchJSON(base + 'episode.json'),
        Promise.all(pair.files.map(async f => [f, new Uint8Array(await (await fetch(url(base + f))).arrayBuffer())])),
        getObject(base + 'mug.glb'), getObject(base + 'cm.glb'),
      ]);
      ov && ov.set(0.7, 'Compiling the scene');
      if (sim) sim.dispose();
      sim = new EpisodeSim(mujoco, { ...robotFiles, ...Object.fromEntries(files) }, ep);
      if (mugObj) V.scene.remove(mugObj); if (cmObj) V.scene.remove(cmObj);
      mugObj = mug; cmObj = cm; V.scene.add(mugObj, cmObj);
      doneAt = null; acc = 0; setPlay(!reducedMotion() || playing);
      sync();
    } finally { ov && ov.done(); loading = false; sel.disabled = false; }
  }

  const tmpQ = new THREE.Quaternion();
  function bodyPose(obj, b) {
    const d = sim.data;
    obj.position.set(d.xpos[3 * b], d.xpos[3 * b + 1], d.xpos[3 * b + 2]);
    tmpQ.set(d.xquat[4 * b + 1], d.xquat[4 * b + 2], d.xquat[4 * b + 3], d.xquat[4 * b]);   // MuJoCo w,x,y,z -> three x,y,z,w
    obj.quaternion.copy(tmpQ);
  }
  const qArm = new Array(7);
  function sync() {
    const d = sim.data;
    for (let k = 0; k < 7; k++) qArm[k] = d.qpos[sim.armQ[k]];
    robot.setQ(qArm); robot.setGrip(Math.max(0, d.qpos[sim.gripQ]));
    bodyPose(mugObj, sim.mugBody); bodyPose(cmObj, sim.cmBody);
    // HUD
    $(hudTR, 'clock').innerHTML = `t = ${sim.time.toFixed(1)} s <span class="mut phys-lg">&middot; ${rtf.toFixed(1)}&times; real time</span>`;
    const phase = $(hudBL, 'phase');
    if (sim.done) {
      const o = sim.outcome();
      phase.innerHTML = o.ok ? `<b style="color:var(--green)">On the tray</b> <span class="mut">${(o.xy * 1000).toFixed(0)} mm from the goal</span>`
                             : `<b style="color:var(--red)">Missed</b> <span class="mut">${o.xy > 0.03 ? (o.xy * 1000).toFixed(0) + ' mm from the goal' : 'tilted ' + o.tilt.toFixed(0) + '°'}</span>`;
    } else phase.innerHTML = `<b>${PHASE[sim.phase] || sim.phase}</b> <span class="mut">frame ${sim.frame + 1} / ${sim.ep.n}</span>`;
    $(hudBL, 'weld').hidden = !sim.welded;
    drawContacts();
  }

  // contact glyphs + the force panel (smoothed sums of the normal forces on the mug, per kind)
  const ema = { grip: 0, table: 0, machine: 0, other: 0 };
  let lastStep = -1, lastPanel = 0;
  function drawContacts(force) {
    const stepNo = sim.frame * 1000 + sim.sub;
    if (!force && stepNo === lastStep) return;
    lastStep = stepNo;
    for (const g of pool) g.visible = false;
    for (const g of holdArrows) g.visible = false;
    if (!showContacts) return;
    const cs = sim.contacts(), sum = { grip: 0, table: 0, machine: 0, other: 0 };
    cs.sort((a, b) => b.f - a.f);
    cs.forEach((c, i) => {
      sum[c.kind] = (sum[c.kind] || 0) + c.f;
      if (i < pool.length && c.f > 0.02) setArrow(pool[i], cMat[c.kind] || cMat.other, c.pos, c.dir, c.f);
    });
    const hold = sim.holdForce();
    if (hold) {
      const hf = Math.hypot(hold.f[0], hold.f[1], hold.f[2]);
      sum.grip += hf;
      if (hf > 0.05) { setArrow(holdArrows[0], cMat.grip, hold.left, hold.f, hf / 2); setArrow(holdArrows[1], cMat.grip, hold.right, hold.f, hf / 2); }
    }
    for (const k of Object.keys(sum)) ema[k] += 0.25 * (sum[k] - ema[k]);
    const now = performance.now();
    if (now - lastPanel < 90 && !force) return;
    lastPanel = now;
    const row = (k, label, v) => `<span class="pf-d" style="background:var(${KINDS[k] ? KINDS[k][0] : '--ours'})"></span>`
      + `<span class="pf-n">${label}</span><span class="pf-b"><i style="width:${Math.min(100, 100 * Math.sqrt(v / 40)).toFixed(0)}%;background:var(${KINDS[k] ? KINDS[k][0] : '--ours'})"></i></span>`
      + `<span class="pf-v">${v < 0.05 ? '&ndash;' : v.toFixed(v < 10 ? 1 : 0) + ' N'}</span>`;
    $(hudTR, 'forces').innerHTML = '<span class="pf-t">Forces on the mug</span>'
      + row('grip', 'Fingers', ema.grip) + row('table', 'Table', ema.table) + row('machine', 'Machine', ema.machine)
      + (ema.other > 0.05 ? row('other', 'Robot', ema.other) : '');
  }

  // ---- simulation clock: real time x speed, at most 0.1 s of physics per rendered frame ----------------------
  V.add(dt => {
    if (!sim || loading) return;
    if (playing) {
      acc += dt * speed / sim.ts;
      let n = Math.min(Math.floor(acc), 50); acc -= n; if (acc > 50) acc = 0;
      const t0 = performance.now();
      while (n-- > 0) sim.step();
      rtfWall += dt; rtfSim += Math.min(dt * speed, 0.1);
      if (rtfWall > 0.5) { rtf = rtfSim / rtfWall; rtfWall = rtfSim = 0; }
      if (sim.done && doneAt === null) doneAt = performance.now();
      // loop: 5 s after the episode ends, start again
      if (doneAt !== null && performance.now() - doneAt > 5000) { sim.reset(); doneAt = null; }
      void t0;
    }
    sync();
  });

  el._demo = { V, get sim() { return sim; }, get mug() { return mugObj; } };   // handle for automated checks
  load.set(0.94, 'Loading the scene');
  await loadPair(index.pairs[0].id);
  V.start();
  load.done();
  if (poster) poster.classList.add('gone');
}
