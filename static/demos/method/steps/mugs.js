// Method step 4, "Carry the grasp to other mugs": grasp 55 on every mug the generator uses (the demonstrated mug and 15
// cousins), each at the TCP pose of its own IK table: the demonstrated grasp carried through the cousin's semantic alignment
// to the demonstrated mug and checked on the cousin's mesh. "One mug" steps through them (the gripper re-closes on each);
// "Overlay all" ghosts every mug and gripper in the shared body frame, the current one solid.
import { THREE, el, ease, loadGrasp55, loadingOverlay, onTheme, reducedMotion, makeStage, makeTable, makeGripper, makeMug, autoOrbit, aimAtGrasp, graspGlyph } from './g55common.js';

const DWELL = 2.8, T_CLOSE = 0.55;

export async function mount(host) {
  const { stage, v, api } = makeStage(host, { fov: 26, maxDpr: 1.75, groundSize: 1.2 });
  const load = loadingOverlay(stage, 'Loading the mugs');
  let D;
  try { D = await loadGrasp55(); } catch (e) { load.error('Could not load the grasps.'); throw e; }
  const N = D.mugs.length;
  const { scene, camera, controls } = v;
  controls.minDistance = 0.22; controls.maxDistance = 1.4; controls.maxPolarAngle = Math.PI * 0.48;
  const table = makeTable(0.3); scene.add(table);

  // solid: one mug group per mug (loaded on demand) + one solid gripper moved between them; ghosts: built on first overlay
  const solid = new Array(N).fill(null), ghosts = [];
  const getSolid = i => solid[i] || (solid[i] = makeMug(D.mugs[i], D.scale).then(m => { m.group.visible = false; scene.add(m.group); return m; }));
  const grip = await makeGripper(D.tcp_offset);
  grip.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const first = await getSolid(0); load.set(0.6);

  // camera from the demonstrated grasp, as in step 3 but a little wider
  const M0 = D.mugs[0];
  const aim = overlay => aimAtGrasp(v, first.grasp, M0.height, overlay ? { dist: 0.36, toward: 0.65, back: 0.0 } : { dist: 0.6, toward: 0.2, back: 0.07 });
  aim(false);

  // ── HUD + controls ──
  const hudTL = el('div', 'demo-hud tl'), hudBL = el('div', 'demo-hud bl');
  const title = el('span', 'hud dot'); const sub = el('span', 'hud');
  hudTL.append(title); hudBL.append(sub);
  const ctl = el('div', 'm55-ctl');
  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'View');
  const bOne = el('button', '', 'One mug'), bAll = el('button', '', 'Overlay all');
  seg.append(bOne, bAll);
  const chips = el('div', 'm55-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Mug');
  const chipB = D.mugs.map((m, i) => {
    const b = el('button', '', i === 0 ? 'Demo' : String(i));
    b.title = i === 0 ? 'The demonstrated mug' : `Cousin ${i}`;
    b.onclick = () => { st.auto = false; show(i); };
    chips.append(b); return b;
  });
  ctl.append(seg, chips);
  stage.append(hudTL, hudBL, ctl);

  const st = { i: -1, overlay: false, auto: !reducedMotion(), t: 0, closeT: 0 };
  const orbit = autoOrbit(v);

  // overlay: every mug ghosted, every grasp as a thin glyph (fingers at that mug's commanded jaw opening)
  const glyphColor = new THREE.Color(), hiColor = new THREE.Color();
  async function buildGhosts() {
    if (ghosts.length) return;
    const all = await Promise.all(D.mugs.map(async m => {
      const mug = await makeMug(m, D.scale, { ghost: true });
      mug.glyph = graspGlyph(m.jaw_mm, D.pad_z, glyphColor); mug.grasp.add(mug.glyph);
      mug.group.visible = false; scene.add(mug.group); return mug;
    }));
    ghosts.push(...all);
  }

  let token = 0;
  async function show(i) {
    const my = ++token;
    const m = await getSolid(i);
    if (my !== token) return;
    solid.forEach((p, k) => p && p.then(x => { x.group.visible = k === i; }));
    m.group.visible = true;
    m.grasp.add(grip.root); grip.root.position.set(0, 0, 0);
    st.i = i; st.t = 0; st.closeT = 0;
    ghosts.forEach((g, k) => {                                     // overlay: every grasp as a glyph, the current one highlighted
      g.group.visible = st.overlay; g.obj.visible = k !== i;
      g.glyph.material.color.copy(k === i ? hiColor : glyphColor); g.glyph.material.opacity = k === i ? 1 : 0.7;
      g.glyph.renderOrder = k === i ? 6 : 4; g.glyph.children.forEach(c => { c.renderOrder = g.glyph.renderOrder; });
    });
    grip.root.visible = !st.overlay;
    chipB.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
    const cb = chipB[i];                                           // keep the chip in view without scrolling the page
    chips.scrollTo({ left: cb.offsetLeft - chips.clientWidth / 2 + cb.clientWidth / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    title.innerHTML = i === 0 ? '<b>Demonstrated mug</b> <span class="mut">&middot; grasp 55</span>'
      : `<b>Cousin ${i}</b> <span class="mut">of ${N - 1} &middot; grasp 55 carried over</span>`;
    sub.innerHTML = st.overlay ? `<b>All ${N} mugs</b> <span class="mut">&middot; one body frame, the handle on the same side</span>`
      : i === 0 ? '<span class="mut">The grasp the generator uses for the demonstrated mug</span>'
      : '<span class="mut">Moved by its alignment to the demonstrated mug, checked for force closure and collision</span>';
    getSolid((i + 1) % N);                                         // prefetch the next mug
  }
  async function setOverlay(on) {
    st.overlay = on;
    bOne.setAttribute('aria-pressed', on ? 'false' : 'true'); bAll.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) await buildGhosts();
    if (!orbit.touched) { aim(on); orbit.reframe(); }              // overlay: closer, on the handles
    show(Math.max(0, st.i));
  }
  bOne.onclick = () => setOverlay(false); bAll.onclick = () => setOverlay(true);

  v.add(dt => {
    if (st.i < 0) return;
    st.closeT += dt;
    grip.setGrip(D.mugs[st.i].drive * (reducedMotion() ? 1 : ease(st.closeT / T_CLOSE)));
    if (st.auto) { st.t += dt; if (st.t > DWELL) show((st.i + 1) % N); }
  });

  onTheme(dark => {
    table.setTheme(dark);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0062d6';
    title.style.setProperty('--c', acc);
    glyphColor.set(acc); hiColor.set(getComputedStyle(document.documentElement).getPropertyValue('--ours').trim() || '#c51d38');
    if (st.i >= 0) show(st.i);
    v.ground.material.opacity = dark ? 0.35 : 0.22;
  });

  await setOverlay(false);
  load.set(1); load.done();
  v.start();
  return api;
}
