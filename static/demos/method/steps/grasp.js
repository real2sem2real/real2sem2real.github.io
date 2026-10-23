// Method step 3, "Retarget the grasp": the grasp our data generation uses on the demonstrated mug (grasp 55), with the
// site's xArm gripper at the TCP pose of the generator's IK table. The gripper comes in from the pre-grasp pose 9 cm back
// along its approach axis (as the generator does), closes to the drive angle the generator commands, then backs out.
import { THREE, el, ease, loadGrasp55, loadingOverlay, onTheme, reducedMotion, makeStage, makeTable, makeGripper, makeMug, autoOrbit, aimAtGrasp } from './g55common.js';

const T_WAIT = 0.5, T_IN = 1.5, T_CLOSE = 0.6, T_HOLD = 1.9, T_OPEN = 0.45, T_OUT = 1.1, T_REST = 0.4;
const PERIOD = T_WAIT + T_IN + T_CLOSE + T_HOLD + T_OPEN + T_OUT + T_REST;

export async function mount(host) {
  const { stage, v, api } = makeStage(host, { fov: 26, maxDpr: 1.75, groundSize: 1.2 });
  const load = loadingOverlay(stage, 'Loading the grasp');
  let D;
  try { D = await loadGrasp55(); } catch (e) { load.error('Could not load the grasp.'); throw e; }
  const M = D.mugs.find(m => m.id === 'demo_mug');
  load.set(0.3);

  const { scene, camera, controls } = v;
  controls.minDistance = 0.22; controls.maxDistance = 1.4; controls.maxPolarAngle = Math.PI * 0.48;
  const table = makeTable(0.3); scene.add(table);

  const mug = await makeMug(M, D.scale); scene.add(mug.group); load.set(0.6);
  const grip = await makeGripper(D.tcp_offset); load.set(0.9);
  grip.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  mug.grasp.add(grip.root);                                       // root = TCP frame; moved along its own -z for the approach

  // approach axis: dashed line from the pre-grasp TCP to the grasp TCP, plus the TCP point
  const accent = new THREE.Color();
  const lineMat = new THREE.LineDashedMaterial({ color: 0x0062d6, dashSize: 0.006, gapSize: 0.004, transparent: true, opacity: 0.9, depthTest: false });
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -D.backoff), new THREE.Vector3(0, 0, 0)]), lineMat);
  axis.computeLineDistances(); axis.renderOrder = 5; mug.grasp.add(axis);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0062d6, depthTest: false, transparent: true }));
  dot.renderOrder = 6; mug.grasp.add(dot);

  // camera: above and to the side of the approach
  const target = aimAtGrasp(v, mug.grasp, M.height, { dist: 0.58, toward: 0.3, back: 0.09 });
  table.position.x = target.x * 0.5; table.position.y = target.y * 0.5;

  // ── HUD + controls ──
  const hudTL = el('div', 'demo-hud tl'), hudBL = el('div', 'demo-hud bl');
  const title = el('span', 'hud dot', '<b>Grasp 55</b> <span class="mut">&middot; demonstrated mug, xArm gripper</span>');
  const phase = el('span', 'hud'); hudTL.append(title); hudBL.append(phase);
  const ctl = el('div', 'm55-ctl');
  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Animation');
  const bAnim = el('button', '', 'Approach and close'), bHold = el('button', '', 'Grasp only');
  seg.append(bAnim, bHold);
  const hint = el('span', 'm55-hint', 'Drag to orbit, scroll to zoom');
  ctl.append(seg, el('span', 'm55-sp'), hint);
  stage.append(hudTL, hudBL, ctl);

  const st = { anim: !reducedMotion(), t: 0 };
  autoOrbit(v);
  controls.addEventListener('start', () => hint.classList.add('off'));
  const setMode = anim => {
    st.anim = anim; st.t = anim ? 0 : st.t;
    bAnim.setAttribute('aria-pressed', anim ? 'true' : 'false'); bHold.setAttribute('aria-pressed', anim ? 'false' : 'true');
  };
  bAnim.onclick = () => setMode(true); bHold.onclick = () => setMode(false);
  setMode(st.anim);

  const pct = Math.round(100 * D.backoff);
  function pose(t) {
    // returns [backoff 0..1, drive 0..1 of the commanded close, phase label]
    let u = t;
    if ((u -= T_WAIT) < 0) return [1, 0, `<b>Pre-grasp</b> <span class="mut">&middot; ${pct} cm back along the approach axis</span>`];
    if ((u -= T_IN) < 0) return [1 - ease(1 + u / T_IN), 0, '<b>Approach</b> <span class="mut">&middot; straight in along the axis</span>'];
    if ((u -= T_CLOSE) < 0) return [0, ease(1 + u / T_CLOSE), '<b>Close</b> <span class="mut">&middot; fingers on the handle</span>'];
    if ((u -= T_HOLD) < 0) return [0, 1, '<b>Grasp</b> <span class="mut">&middot; the pose every generated episode uses</span>'];
    if ((u -= T_OPEN) < 0) return [0, 1 - ease(1 + u / T_OPEN), '<b>Grasp</b> <span class="mut">&middot; the pose every generated episode uses</span>'];
    if ((u -= T_OUT) < 0) return [ease(1 + u / T_OUT), 0, `<b>Pre-grasp</b> <span class="mut">&middot; ${pct} cm back along the approach axis</span>`];
    return [1, 0, `<b>Pre-grasp</b> <span class="mut">&middot; ${pct} cm back along the approach axis</span>`];
  }
  let lastLabel = '';
  v.add(dt => {
    if (st.anim) st.t = (st.t + dt) % PERIOD;
    const [b, d, label] = st.anim ? pose(st.t) : [0, 1, '<b>Grasp</b> <span class="mut">&middot; the pose every generated episode uses</span>'];
    grip.root.position.set(0, 0, -D.backoff * b);
    grip.setGrip(M.drive * d);
    lineMat.opacity = 0.9 * Math.min(1, 6 * b); dot.material.opacity = 0.95;     // the axis shows while the gripper is off the grasp
    if (label !== lastLabel) { phase.innerHTML = label; lastLabel = label; }
  });

  onTheme(dark => {
    table.setTheme(dark);
    accent.set(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0062d6');
    lineMat.color.copy(accent); dot.material.color.copy(accent);
    title.style.setProperty('--c', accent.getStyle());
    v.ground.material.opacity = dark ? 0.35 : 0.22;
  });

  load.set(1); load.done();
  v.start();
  return api;
}
