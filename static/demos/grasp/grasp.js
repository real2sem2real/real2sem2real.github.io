// From the human hand to the robot grasp, on the placement demonstration. Three views of one pipeline stage:
//   Hand     the HaMeR hand mesh on the tracked mug, frame by frame, with the three gates that pick the carry frames
//            (pinch closed, wrist rigid in the mug's frame, mug lifted more than 2 cm above its rest height);
//   Gripper  the parallel-jaw gripper retargeted from the hand, and the best-grasp search of every qualifying frame:
//            the closest candidates around the hand's pose, coloured by the checks they pass, and the first valid one;
//   Cousins  the selected grasp carried to cousin mugs by their semantic alignment, closing on every handle.
// Everything is a real pipeline output (grasp.json / hand.bin, built offline from the tracked poses, the aligned HaMeR
// meshes and the grasp code; gates and search reproduce the pipeline's own runs). The xArm gripper is the site's robot
// model; the mugs are the site's shared object meshes.
import { THREE, createViewer, onTheme, reducedMotion, loadingOverlay, mat4 } from '../core/viewer.js';
import { getObject, objectPath, url, fetchJSON, fetchBin } from '../core/assets.js';
import { loadXArm } from '../core/robot.js';

const HAND_COLOR = 0xff7a45, HAND_GHOST = 0x9aa3ad;
const ST = { VALID: 2, COLLIDES: 1, NOT_ANTIPODAL: 0 };

const CSS = `
.gr-pip{position:absolute; z-index:3; top:12px; right:12px; width:min(28%, 240px); margin:0; border-radius:10px; overflow:hidden;
  border:1px solid color-mix(in srgb, var(--line) 80%, transparent); background:#000; box-shadow:0 10px 26px -12px rgba(0,30,80,.55);
  transition:opacity .35s}
.gr-pip video{display:block; width:100%; height:auto; aspect-ratio:16/9; object-fit:cover; border:0; border-radius:0; background:#000}
.gr-pip figcaption{position:absolute; left:0; right:0; bottom:0; margin:0; padding:14px 8px 5px; font-size:11px; line-height:1.2;
  color:#fff; background:linear-gradient(transparent, rgba(0,0,0,.6)); font-variant-numeric:tabular-nums}
.gr-pip.off{opacity:0; pointer-events:none}
.gr-time{display:flex; align-items:center; gap:12px; flex:1 1 300px; min-width:0}
.gr-time .drange{flex:1 1 auto; min-width:60px}
.gr-f{min-width:64px; font-variant-numeric:tabular-nums; text-align:right}
.gr-cous{display:none; align-items:center; gap:10px; flex:1 1 300px; min-width:0}
.gr-cous .seg{overflow-x:auto; scrollbar-width:none}
.gr-cous .seg::-webkit-scrollbar{display:none}
[data-gr-mode="cousins"] .gr-time{display:none}
[data-gr-mode="cousins"] .gr-cous{display:flex}
[data-gr-mode="cousins"] .gr-strip{display:none}
.gr-strip{position:relative; height:108px; border-top:1px solid var(--line); cursor:ew-resize; touch-action:pan-y; outline:none}
.gr-strip:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.gr-strip canvas{position:absolute; inset:0; width:100%; height:100%; display:block}
.gr-legend{display:flex; flex-wrap:wrap; gap:4px 14px; padding:9px 14px 11px; border-top:1px solid var(--line); font-size:12px;
  color:var(--muted); line-height:1.45}
.gr-legend span{white-space:nowrap}
.gr-legend span.w{white-space:normal}
.gr-legend i{display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:0}
.gr-legend b{color:var(--ink); font-weight:600}
.gr-hud-res{white-space:normal !important; max-width:min(440px, calc(100vw - 80px))}
.gr-ok{color:var(--green); font-weight:600} .gr-no{color:var(--red); font-weight:600}
@media (max-width:620px){
  .gr-pip{top:8px; right:8px; width:40%}
  .gr-pip figcaption{font-size:10px; padding:10px 6px 4px}
  .gr-time{flex-basis:100%}
  .gr-cous{flex-basis:100%}
  .gr-cous > .dbtn{display:none}                       /* the numbered buttons suffice on a phone; all six fit in one row */
  .gr-cous .seg{width:100%; display:flex} .gr-cous .seg button{flex:1 1 0; min-width:40px; padding-left:6px; padding-right:6px}
  .gr-opts{flex-basis:100%}
  .gr-opts .seg{width:100%; display:flex} .gr-opts .seg button{flex:1 1 0}
  .gr-strip{height:104px}
  .gr-legend{padding:8px 12px 10px; font-size:11.5px}
  .gr-hud-res{max-width:calc(100vw - 64px)}
}
@media (max-width:400px){ [data-demo="grasp"] .demo-hud .mut{display:none} }
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || f;

// soft round "tabletop" with a faint 5 cm grid, centred under the action
function makeTable(radius) {
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
  m.renderOrder = -2;
  return m;
}

const P7 = a => ({ p: new THREE.Vector3(a[0], a[1], a[2]), q: new THREE.Quaternion(a[3], a[4], a[5], a[6]) });

// The xArm parallel-jaw gripper of the site's robot model, cut off the arm: root = TCP frame (z = approach, y = closing axis).
async function makeGripper(tcpOffset) {
  const arm = await loadXArm({ shadows: true });
  const base = arm.links.xarm_gripper_base_link;
  base.removeFromParent();
  const root = new THREE.Group(), off = new THREE.Group();
  off.position.z = -tcpOffset; off.add(base); root.add(off);
  const mats = [];
  base.traverse(m => {
    if (!m.isMesh) return;
    m.material = m.material.clone();                       // own materials: the tint must not reach the other demos' robots
    mats.push({ m: m.material, c: m.material.color.clone() });
  });
  const tint = new THREE.Color();
  return {
    root, setGrip: g => arm.setGrip(g),
    // state: 'ok' (normal), 'bad' (red, see-through), 'human' (neutral, slightly see-through)
    look(state) {
      for (const { m, c } of mats) {
        if (state === 'bad') { tint.set(0xe0412f); m.color.copy(c).lerp(tint, 0.7); m.transparent = true; m.opacity = 0.55; m.depthWrite = false; }
        else if (state === 'human') { m.color.copy(c); m.transparent = true; m.opacity = 0.8; m.depthWrite = true; }
        else { m.color.copy(c); m.transparent = false; m.opacity = 1; m.depthWrite = true; }
        m.needsUpdate = true;
      }
    },
  };
}

// jaw opening -> drive angle, interpolated from the build's table (the URDF's finger kinematics)
function driveFor(table, mm) {
  mm = Math.max(table[0][0], Math.min(table[table.length - 1][0], mm));
  for (let i = 1; i < table.length; i++) if (table[i][0] >= mm) {
    const [a, da] = table[i - 1], [b, db] = table[i];
    return da + (db - da) * (mm - a) / (b - a);
  }
  return table[table.length - 1][1];
}

export async function mount(root) {
  if (!document.getElementById('gr-css')) { const s = el('style'); s.id = 'gr-css'; s.textContent = CSS; document.head.appendChild(s); }
  let stage = root.querySelector('.demo-stage');
  if (!stage) { stage = el('div', 'demo-stage'); root.prepend(stage); }
  const poster = stage.querySelector('.demo-poster');
  root.querySelectorAll('.demo-fallback').forEach(e => e.remove());
  const load = loadingOverlay(stage, 'Loading the hand and the grasp search');

  let D, bin;
  try { [D, bin] = await Promise.all([fetchJSON('grasp/grasp.json'), fetchBin('grasp/hand.bin')]); }
  catch (e) { load.error('Could not load the grasp data.'); throw e; }
  load.set(0.3);
  const N = D.n, FPS = D.fps, T_END = (N - 1) / FPS, SEL = D.selected;

  const v = createViewer(stage, { fov: 30, maxDpr: 1.75, groundSize: 1.6 });
  const { scene, camera, controls, renderer } = v;
  controls.minDistance = 0.18; controls.maxDistance = 1.6;
  controls.maxPolarAngle = Math.PI * 0.47;

  // ── hand-scene objects ──
  const hand0 = P7(D.mug.poses[0]);
  const table = makeTable(0.42); table.position.set(hand0.p.x, hand0.p.y, -0.0006); scene.add(table);
  v.ground.position.set(hand0.p.x, hand0.p.y, 0);
  const handScene = new THREE.Group(); scene.add(handScene);

  const mugPose = new THREE.Group(); handScene.add(mugPose);
  const mugInner = new THREE.Group(); mugInner.matrixAutoUpdate = false; mugInner.matrix.copy(mat4(D.mug.A)); mugPose.add(mugInner);

  // hand meshes: int16 vertices (offset + q * value) per hand frame, MANO faces once
  const H = D.hand, NV = H.nv, slots = new Map(H.frames.map((f, k) => [f, k]));
  const vi = new Int16Array(bin, 0, H.frames.length * NV * 3), fi = new Uint16Array(bin, H.frames.length * NV * 3 * 2, H.nf * 3);
  const handPos = H.frames.map((_, k) => {
    const a = new Float32Array(NV * 3);
    for (let j = 0; j < NV * 3; j++) a[j] = H.off[j % 3] + H.q * vi[k * NV * 3 + j];
    return a;
  });
  const handGeo = new THREE.BufferGeometry();
  handGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
  handGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(fi), 1));
  const handMat = new THREE.MeshStandardMaterial({ color: HAND_COLOR, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.92,
                                                   side: THREE.DoubleSide, emissive: HAND_COLOR, emissiveIntensity: 0.12 });
  const handMesh = new THREE.Mesh(handGeo, handMat); handMesh.castShadow = true; handMesh.frustumCulled = false; handScene.add(handMesh);

  // candidate grasps: each a thin "U" (two fingers and the bar between them) in its colour, as instanced cylinders
  const K = D.k_show, GL = D.gripper, HW = D.width_mm / 2000 + 0.003, ZP = GL.pad_z;
  const glyphGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 6, 1);
  const glyphs = new THREE.InstancedMesh(glyphGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }), (K + 1) * 3);
  glyphs.frustumCulled = false; glyphs.renderOrder = 3; handScene.add(glyphs);
  const SEGS = [[[0, HW, ZP + 0.008], [0, HW, ZP - 0.03]], [[0, -HW, ZP + 0.008], [0, -HW, ZP - 0.03]], [[0, HW, ZP - 0.03], [0, -HW, ZP - 0.03]]];

  const grip = await makeGripper(GL.tcp_offset); load.set(0.6);
  handScene.add(grip.root); grip.root.traverse(m => { if (m.isMesh) m.castShadow = true; });

  // ── cousins scene ──
  const cousScene = new THREE.Group(); cousScene.visible = false; scene.add(cousScene);
  cousScene.position.set(hand0.p.x, hand0.p.y, 0);
  const cGrip = await makeGripper(GL.tcp_offset); cousScene.add(cGrip.root);
  const cMug = new THREE.Group(); cousScene.add(cMug);
  const cMugCache = new Map();
  function cousinObject(i) {
    const c = D.cousins[i];
    if (!cMugCache.has(i)) cMugCache.set(i, getObject(objectPath(c.glb)).then(o => {
      const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(mat4(c.S)); g.add(o); return g;
    }));
    return cMugCache.get(i);
  }

  const mugObj = await getObject(objectPath(D.mug.glb)); mugInner.add(mugObj);
  cousinObject(0); load.set(0.85);

  // ── UI ──
  const bar = el('div', 'demo-bar');
  const play = el('button', 'dbtn ghost gr-play');
  const range = el('input', 'drange'); range.type = 'range'; range.min = 0; range.max = N - 1; range.step = 1; range.value = 0;
  range.setAttribute('aria-label', 'Frame of the human video');
  const flab = el('span', 'dlabel gr-f');
  const gTime = el('div', 'gr-time'); gTime.append(play, range, flab);
  const cPrev = el('button', 'dbtn ghost', '&#8249;'), cNext = el('button', 'dbtn ghost', '&#8250;');
  cPrev.setAttribute('aria-label', 'Previous mug'); cNext.setAttribute('aria-label', 'Next mug');
  const cSeg = el('div', 'seg'); cSeg.setAttribute('role', 'group'); cSeg.setAttribute('aria-label', 'Mug');
  const cBtns = D.cousins.map((c, i) => { const b = el('button', '', i === 0 ? 'Demo mug' : String(i)); b.onclick = () => showCousin(i, true); cSeg.append(b); return b; });
  const gCous = el('div', 'gr-cous'); gCous.append(cPrev, cSeg, cNext);
  const mSeg = el('div', 'seg'); mSeg.setAttribute('role', 'group'); mSeg.setAttribute('aria-label', 'View');
  const bHand = el('button', '', 'Human hand'), bGrip = el('button', '', 'Robot grasp'), bCous = el('button', '', 'Cousins');
  mSeg.append(bHand, bGrip, bCous);
  const gOpts = el('div', 'gr-opts'); gOpts.append(mSeg);
  bar.append(gOpts, gTime, gCous);
  const strip = el('div', 'gr-strip'); const scv = el('canvas'); strip.appendChild(scv); const sctx = scv.getContext('2d');
  strip.tabIndex = 0; strip.setAttribute('role', 'slider'); strip.setAttribute('aria-label', 'Gates and grasp search per frame; drag to scrub');
  const legend = el('div', 'gr-legend');
  root.append(bar, strip, legend);

  const hudTL = el('div', 'demo-hud tl'), modeHud = el('span', 'hud dot'); hudTL.append(modeHud);
  const hudBL = el('div', 'demo-hud bl'), resHud = el('span', 'hud gr-hud-res'); hudBL.append(resHud);
  stage.append(hudTL, hudBL);

  const video = document.createElement('video');
  video.src = url('splat/demo.mp4'); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  video.setAttribute('aria-label', 'The human demonstration video, synchronised with the 3D view');
  const pipCap = el('figcaption');
  const pip = el('figure', 'gr-pip'); pip.append(video, pipCap); stage.appendChild(pip);

  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>Play';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>Pause';

  const st = { mode: 'hand', playing: !reducedMotion(), t: 0, f: -1, scrubbing: false, visible: false, cousin: 0, cT: 0, touched: false };
  root.dataset.grMode = st.mode;
  let C = {};
  function colors() {
    C = { green: cssVar('--green', '#2f8f5b'), red: cssVar('--red', '#c0392b'), orange: cssVar('--orange', '#d98324'),
          accent: cssVar('--accent', '#0062d6'), ink: cssVar('--ink', '#2e2d29'), muted: cssVar('--muted', '#5d6370'),
          line: cssVar('--line', '#cfdcef'), surface: cssVar('--surface', '#fbfdff'), ours: cssVar('--ours', '#c51d38') };
  }
  colors();

  const setPressed = (b, on) => b.setAttribute('aria-pressed', on ? 'true' : 'false');
  const sig = D.signals;
  const fmt = (x, d, u) => x == null ? '&ndash;' : `${x.toFixed(d)}&nbsp;${u}`;
  function legendHTML() {
    if (st.mode === 'hand') return `<span><i style="background:${C.accent}"></i>Gate passed</span>` +
      `<span><i style="background:${C.green}"></i><b>Qualifies:</b> all three, the carry</span>` +
      `<span><i style="background:${C.line}"></i>Hand seen, gate not passed</span>`;
    if (st.mode === 'grasp') return `<span class="w">Candidates, ${K} of the ${D.n_candidates} searched per carry frame:</span>` +
      `<span><i style="background:${C.green}"></i>Antipodal, collision free</span>` +
      `<span><i style="background:${C.orange}"></i>Antipodal, collides</span>` +
      `<span><i style="background:${C.red}"></i>Not antipodal</span>` +
      `<span class="w"><b>Valid grasp</b> row: filled, the hand's own pose is valid; faded, the nearest valid one is shifted; ` +
      `ring, none within ${D.jitter.pos_cm.toFixed(0)}&nbsp;cm and ${D.jitter.rot_deg.toFixed(0)}&deg;. Circled: the selected grasp.</span>`;
    return `<span class="w">Each mug is shown at its real size; the grasp follows it through its semantic alignment and is checked for ` +
      `<b>force closure</b> and <b>collision</b> on its own mesh.</span>`;
  }
  function refreshUI() {
    play.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
    play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    setPressed(bHand, st.mode === 'hand'); setPressed(bGrip, st.mode === 'grasp'); setPressed(bCous, st.mode === 'cousins');
    cBtns.forEach((b, i) => setPressed(b, i === st.cousin));
    root.dataset.grMode = st.mode;
    pip.classList.toggle('off', st.mode === 'cousins');
    legend.innerHTML = legendHTML();
    modeHud.style.setProperty('--c', st.mode === 'hand' ? '#ff7a45' : st.mode === 'grasp' ? C.green : C.accent);
    modeHud.innerHTML = st.mode === 'hand' ? '<b>Human hand</b> <span class="mut">&middot; HaMeR mesh on the tracked mug</span>'
      : st.mode === 'grasp' ? '<b>Robot grasp</b> <span class="mut">&middot; retargeted from the hand</span>'
      : '<b>Grasp transfer</b> <span class="mut">&middot; to cousin mugs</span>';
  }

  // ── frame state ──
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1), A3 = new THREE.Vector3(), B3 = new THREE.Vector3(), col = new THREE.Color();
  function mugPoseAt(t, outP, outQ) {
    const f = Math.min(N - 1, Math.max(0, t * FPS)), i = Math.min(N - 2, Math.floor(f)), a = f - i;
    const p0 = D.mug.poses[i], p1 = D.mug.poses[i + 1];
    outP.set(p0[0] + a * (p1[0] - p0[0]), p0[1] + a * (p1[1] - p0[1]), p0[2] + a * (p1[2] - p0[2]));
    outQ.set(p0[3], p0[4], p0[5], p0[6]).slerp(tmpQ.set(p1[3], p1[4], p1[5], p1[6]), a);
  }
  function setHand(t) {
    const f = Math.min(N - 1, Math.max(0, t * FPS)), i = Math.floor(f), a = f - i;
    const k0 = slots.get(i), k1 = slots.get(Math.min(N - 1, i + 1));
    const A = k0 != null ? handPos[k0] : null, B = k1 != null ? handPos[k1] : null;
    const pos = handGeo.attributes.position.array;
    if (A && B) for (let j = 0; j < pos.length; j++) pos[j] = A[j] + a * (B[j] - A[j]);
    else if (A || B) pos.set(A && (a < 0.5 || !B) ? A : B);
    else return false;
    handGeo.attributes.position.needsUpdate = true; handGeo.computeVertexNormals(); handGeo.computeBoundingSphere();
    return true;
  }
  function placeGlyph(idx, pose, color) {
    const { p, q } = P7(pose);
    m4.compose(p, q, one);
    for (let s = 0; s < 3; s++) {
      A3.fromArray(SEGS[s][0]).applyMatrix4(m4); B3.fromArray(SEGS[s][1]).applyMatrix4(m4);
      tmpV.subVectors(B3, A3); const L = tmpV.length();
      tmpQ.setFromUnitVectors(up, tmpV.normalize());
      const M = new THREE.Matrix4().compose(A3.clone().lerp(B3, 0.5), tmpQ, new THREE.Vector3(1, L, 1));
      glyphs.setMatrixAt(idx * 3 + s, M); glyphs.setColorAt(idx * 3 + s, color);
    }
  }
  function frameResult(f) {
    const r = D.search[String(f)], qual = !!sig.valid[f];
    return { r, qual };
  }
  function updateFrame(f) {
    // mug and hand follow the continuous time; gripper, glyphs and readouts follow the integer frame
    const hasHand = slots.has(f);
    const { r, qual } = frameResult(f);
    // gripper
    if (st.mode === 'grasp' && hasHand) {
      grip.root.visible = true;
      const searched = r && qual;
      let pose = D.tcp[String(f)], jaw = Math.min(85, Math.max(0, pose[7])), look = 'human';
      if (searched && r.first) { pose = r.poses[String(r.first.k)]; jaw = D.width_mm; look = 'ok'; }
      else if (searched) { jaw = D.width_mm; look = 'bad'; }
      const { p, q } = P7(pose); grip.root.position.copy(p); grip.root.quaternion.copy(q);
      grip.setGrip(driveFor(GL.drive, jaw)); grip.look(look);
      // candidate glyphs
      if (searched) {
        let n = 0;
        r.status.forEach((s, j) => {
          const k = r.ranks[j];
          if (r.first && k === r.first.k) return;                  // the winner is the full gripper
          col.set(s === ST.VALID ? C.green : s === ST.COLLIDES ? C.orange : C.red);
          placeGlyph(n++, r.poses[String(k)], col);
        });
        glyphs.count = n * 3; glyphs.instanceMatrix.needsUpdate = true; if (glyphs.instanceColor) glyphs.instanceColor.needsUpdate = true;
        glyphs.visible = n > 0;
      } else glyphs.visible = false;
    } else { grip.root.visible = false; glyphs.visible = false; }

    // readouts
    const ok = b => b ? '<span class="gr-ok">&#10003;</span>' : '<span class="gr-no">&#10005;</span>';
    if (!hasHand) resHud.innerHTML = '<span class="mut">No hand in this frame</span>';
    else if (st.mode === 'hand') {
      resHud.innerHTML = `Pinch ${ok(sig.closed[f])} <span class="mut">${fmt(sig.pinch_mm[f], 0, 'mm')}</span> &nbsp; ` +
        `Rigid ${ok(sig.rigid[f])} <span class="mut">${fmt(sig.wrist_mm[f], 1, 'mm')}</span> &nbsp; ` +
        `Lifted ${ok(sig.lifted[f])} <span class="mut">${fmt(sig.lift_cm[f], 1, 'cm')}</span>`;
    } else if (!qual) {
      resHud.innerHTML = '<span class="mut">Not a carry frame: no search here. The gripper follows the hand.</span>';
    } else if (r && r.first) {
      const zero = r.first.pos_mm < 0.05 && r.first.rot_deg < 0.05;
      resHud.innerHTML = (f === SEL ? '<b>Selected grasp.</b> ' : '') + (zero
        ? `<span class="gr-ok">&#10003;</span> The hand's own pose is valid <span class="mut">&middot; score ${r.first.score.toFixed(2)}</span>`
        : `<span class="gr-ok">&#10003;</span> Nearest valid: <b>${r.first.pos_mm.toFixed(1)}&nbsp;mm, ${r.first.rot_deg.toFixed(1)}&deg;</b> away <span class="mut">&middot; candidate ${r.first.k + 1} of ${D.n_candidates}</span>`);
    } else {
      resHud.innerHTML = `<span class="gr-no">&#10005;</span> No valid grasp within ${D.jitter.pos_cm.toFixed(0)}&nbsp;cm and ${D.jitter.rot_deg.toFixed(0)}&deg;`;
    }
    flab.innerHTML = `Frame <b>${String(f).padStart(3, '0')}</b>`;
    pipCap.textContent = `Human video · frame ${f}`;
    strip.setAttribute('aria-valuenow', String(f)); strip.setAttribute('aria-valuetext', `Frame ${f}`);
  }

  // ── gate / search strip ──
  let sw = 0, sh = 0, sdpr = 1;
  const ROWS = [['Pinch closed', 'closed'], ['Wrist rigid', 'rigid'], ['Lifted > 2 cm', 'lifted'], ['Qualifies', 'valid'], ['Valid grasp', 'grasp']];
  const SP = { t: 8, b: 18, r: 10 };
  const labW = () => (sw < 480 ? 74 : 92);
  function resizeStrip() {
    const r = strip.getBoundingClientRect(); sdpr = Math.min(2, window.devicePixelRatio || 1);
    sw = Math.max(1, r.width); sh = Math.max(1, r.height);
    scv.width = Math.round(sw * sdpr); scv.height = Math.round(sh * sdpr); drawStrip();
  }
  function drawStrip() {
    const g = sctx; g.setTransform(sdpr, 0, 0, sdpr, 0, 0); g.clearRect(0, 0, sw, sh);
    const x0 = labW(), x1 = sw - SP.r, y0 = SP.t, y1 = sh - SP.b, rh = (y1 - y0) / ROWS.length, cw = (x1 - x0) / N;
    const X = i => x0 + cw * i;
    g.font = `${sw < 480 ? 10.5 : 11}px ` + getComputedStyle(root).fontFamily;
    g.textBaseline = 'middle'; g.textAlign = 'right';
    ROWS.forEach(([lab, key], ri) => {
      const yc = y0 + rh * (ri + 0.5);
      g.fillStyle = ri === 4 && st.mode !== 'grasp' ? C.muted : C.ink; g.globalAlpha = ri === 4 && st.mode !== 'grasp' ? 0.6 : 1;
      g.fillText(lab, x0 - 8, yc); g.globalAlpha = 1;
      for (let i = 0; i < N; i++) {
        if (!slots.has(i)) continue;
        if (key === 'grasp') {
          const r = D.search[String(i)];
          if (!r || !sig.valid[i]) continue;
          const cx = X(i) + cw / 2, rad = Math.max(1.6, Math.min(cw * 0.42, 3.6));
          g.beginPath(); g.arc(cx, yc, rad, 0, Math.PI * 2);
          if (r.first) {
            const zero = r.first.pos_mm < 0.05 && r.first.rot_deg < 0.05;
            g.fillStyle = C.green; g.globalAlpha = zero ? 1 : 0.45; g.fill(); g.globalAlpha = 1;
          } else { g.strokeStyle = C.red; g.lineWidth = 1.2; g.globalAlpha = 0.75; g.stroke(); g.globalAlpha = 1; }
          continue;
        }
        const on = !!sig[key][i];
        g.fillStyle = on ? (key === 'valid' ? C.green : C.accent) : C.line;
        g.globalAlpha = on ? (key === 'valid' ? 0.95 : 0.75) : 0.9;
        g.fillRect(X(i) + 0.4, yc - rh * 0.3, Math.max(1, cw - 0.8), rh * 0.6);
        g.globalAlpha = 1;
      }
    });
    // selected frame marker
    const sx = X(SEL) + cw / 2;
    g.strokeStyle = C.ink; g.lineWidth = 1.4;
    g.beginPath(); g.arc(sx, y0 + rh * 4.5, Math.max(4, Math.min(cw * 0.7, 6)), 0, Math.PI * 2); g.stroke();
    // frame axis
    g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'top';
    for (const i of [0, 25, 50, 75, 100]) if (i < N) g.fillText(String(i), X(i) + cw / 2, y1 + 4);
    // cursor
    const f = Math.max(0, st.f), cx = X(f) + cw / 2;
    g.strokeStyle = C.ink; g.globalAlpha = 0.5; g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(cx) + 0.5, y0 - 4); g.lineTo(Math.round(cx) + 0.5, y1 + 2); g.stroke(); g.globalAlpha = 1;
  }

  // ── time & video ──
  function syncVideo() {
    if (!st.visible || st.mode === 'cousins') { video.pause(); return; }
    if (st.playing && !st.scrubbing) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
    else video.pause();
  }
  function seekVideo() { if (video.readyState >= 1) video.currentTime = Math.min(video.duration || T_END, st.t + 0.017); }
  function setT(t, user) {
    st.t = Math.max(0, Math.min(T_END, t));
    if (user) { st.playing = false; refreshUI(); seekVideo(); syncVideo(); }
  }
  play.onclick = () => { st.playing = !st.playing; if (st.playing && st.t >= T_END - 0.05) { st.t = 0; seekVideo(); } refreshUI(); syncVideo(); };
  range.addEventListener('input', () => { st.scrubbing = true; setT(+range.value / FPS, true); });
  const endScrub = () => { st.scrubbing = false; };
  range.addEventListener('change', endScrub); range.addEventListener('pointerup', endScrub);
  // drag on the strip = absolute scrub
  let sid = null;
  const stripF = e => { const r = strip.getBoundingClientRect(); return (e.clientX - r.left - labW()) / (r.width - labW() - SP.r) * N - 0.5; };
  strip.addEventListener('pointerdown', e => { if (e.button !== 0) return; sid = e.pointerId; st.scrubbing = true; setT(Math.round(stripF(e)) / FPS, true); if (e.pointerType === 'mouse') strip.setPointerCapture(sid); });
  strip.addEventListener('pointermove', e => { if (e.pointerId === sid) setT(Math.round(stripF(e)) / FPS, true); });
  const endS = e => { if (e.pointerId === sid) { sid = null; st.scrubbing = false; } };
  strip.addEventListener('pointerup', endS); strip.addEventListener('pointercancel', endS);
  strip.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 1, f = Math.round(st.t * FPS);
    if (e.key === 'ArrowRight') { setT((f + step) / FPS, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setT((f - step) / FPS, true); e.preventDefault(); }
  });

  // ── modes ──
  const camGoal = { target: null, dist: null, k: 0 };
  function setMode(m) {
    const prev = st.mode; st.mode = m;
    handScene.visible = m !== 'cousins'; cousScene.visible = m === 'cousins';
    table.position.set(hand0.p.x, hand0.p.y, -0.0006);
    handMat.opacity = m === 'grasp' ? 0.25 : 0.92; handMat.depthWrite = m !== 'grasp'; handMesh.castShadow = m !== 'grasp';
    handMat.color.set(m === 'grasp' ? HAND_GHOST : HAND_COLOR); handMat.emissive.set(m === 'grasp' ? HAND_GHOST : HAND_COLOR);   // grey ghost: orange marks colliding candidates
    if (m === 'grasp' && prev !== 'grasp') { st.playing = false; setT(SEL / FPS, false); seekVideo(); }
    if (m === 'cousins') { st.cT = 0; showCousin(st.cousin, false); }
    st.f = -1; refreshUI(); syncVideo(); drawStrip();
    if (!st.touched || prev === 'cousins' || m === 'cousins') aimCamera(true);
  }
  bHand.onclick = () => setMode('hand'); bGrip.onclick = () => setMode('grasp'); bCous.onclick = () => setMode('cousins');

  async function showCousin(i, user) {
    st.cousin = (i + D.cousins.length) % D.cousins.length; st.cT = 0;
    if (user) { st.playing = false; }
    refreshUI();
    const g = await cousinObject(st.cousin);
    if (st.mode !== 'cousins') return;
    cMug.clear(); cMug.add(g);
    const c = D.cousins[st.cousin];
    cousScene.updateMatrixWorld(true);                                 // body centre -> grasp point = the handle's side
    const bc = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    st.cH = P7(c.T).p.add(cousScene.position).sub(bc);
    resHud.innerHTML = `<b>${st.cousin === 0 ? 'Demonstrated mug' : `Cousin ${st.cousin} of ${D.cousins.length - 1}`}</b> ` +
      `<span class="mut">&middot; ${c.height_cm.toFixed(1)}&nbsp;cm tall &middot; jaws ${c.width_mm.toFixed(1)}&nbsp;mm</span> &nbsp;` +
      (c.valid ? '<span class="gr-ok">&#10003; force closure, no collision</span>' : '<span class="gr-no">&#10005; invalid</span>');
    if (st.mode === 'cousins') aimCamera(false);
  }
  cPrev.onclick = () => showCousin(st.cousin - 1, true); cNext.onclick = () => showCousin(st.cousin + 1, true);

  // ── camera: from the side of the approach, on the handle's side and above, so neither the mug body nor the gripper hides
  //    the handle (as in the paper's grasp-transfer figure); the hand scene follows the mug, the cousins are framed one at a
  //    time ──
  const camC = new THREE.Vector3(...D.camera.center);
  const viewDir = new THREE.Vector3();
  function sideView(q, handle, ref) {
    const a = new THREE.Vector3(0, 0, 1).applyQuaternion(q); a.z = 0; a.normalize();
    const n = new THREE.Vector3(-a.y, a.x, 0), h = handle.clone(); h.z = 0; h.normalize();
    const s = n.dot(h);
    if (Math.abs(s) > 0.15 ? s < 0 : n.dot(ref) < 0) n.negate();
    const d = n.addScaledVector(h, 0.35); d.normalize(); d.z = 0.62;
    return d.normalize();
  }
  const selG = P7(D.search[String(SEL)].poses[String(D.search[String(SEL)].first.k)]), selQ = selG.q;
  const selM = P7(D.mug.poses[SEL]);                                  // the selected grasp point in the mug's frame
  const selHandle = selG.p.clone().sub(selM.p);                        // mug origin -> grasp point: the handle's side
  const selLocal = selHandle.clone().applyQuaternion(selM.q.clone().invert());
  const focusAt = (t, out) => { mugPoseAt(t, out, tmpQ); return out.add(selLocal.clone().multiplyScalar(0.5).applyQuaternion(tmpQ)); };
  function aimCamera(snap) {
    const tgt = new THREE.Vector3(); let dist;
    const ref = new THREE.Vector3().subVectors(camC, P7(D.mug.poses[SEL]).p); ref.z = 0; ref.normalize();
    if (st.mode === 'cousins') {
      const c = D.cousins[st.cousin], T = P7(c.T);
      tgt.set(cousScene.position.x + 0.35 * T.p.x, cousScene.position.y + 0.35 * T.p.y, c.height_cm / 200 + 0.008);
      dist = 0.3 + 1.1 * c.height_cm / 100;
      viewDir.copy(sideView(T.q, st.cH || T.p, ref));
    } else {
      focusAt(st.t, tgt); tgt.z = Math.max(0.05, tgt.z);
      dist = st.mode === 'grasp' ? 0.52 : 0.58;
      viewDir.copy(sideView(selQ, selHandle, ref));
    }
    const aspect = v.size[0] / Math.max(1, v.size[1]);
    const d = dist * (aspect < 1 ? 1.5 : 1);
    camGoal.target = tgt; camGoal.pos = tgt.clone().addScaledVector(viewDir, d); camGoal.k = snap ? 1 : 0.0001;
    if (snap) { controls.target.copy(tgt); camera.position.copy(camGoal.pos); }
  }
  controls.addEventListener('start', () => { st.touched = true; camGoal.k = 1; });

  // ── per-frame loop ──
  const mp = new THREE.Vector3(), mq = new THREE.Quaternion(), follow = new THREE.Vector3();
  v.add(dt => {
    if (st.mode !== 'cousins') {
      if (st.playing && !st.scrubbing) {
        if (!video.paused && video.readyState >= 2) st.t = Math.min(T_END, video.currentTime);
        else st.t = (st.t + dt) % (T_END + 0.07);
      }
      const t = Math.min(T_END, st.t);
      mugPoseAt(t, mp, mq); mugPose.position.copy(mp); mugPose.quaternion.copy(mq);
      handMesh.visible = setHand(t);
      const f = Math.round(t * FPS);
      if (f !== st.f) { st.f = f; if (!st.scrubbing) range.value = f; updateFrame(f); drawStrip(); }
      // follow the mug gently once the visitor has not taken the camera
      if (!st.touched) {
        focusAt(t, follow); follow.z = Math.max(0.05, follow.z);
        controls.target.lerp(follow, 1 - Math.exp(-dt * 2.5));
        const off = viewDir.clone().multiplyScalar(camera.position.distanceTo(controls.target));
        camera.position.lerp(controls.target.clone().add(off), 1 - Math.exp(-dt * 2.5));
      }
    } else {
      // approach along the approach axis with open jaws, then close, hold; next mug when playing
      const c = D.cousins[st.cousin];
      st.cT += dt;
      const T = P7(c.T), app = new THREE.Vector3(0, 0, 1).applyQuaternion(T.q);
      const u = Math.min(1, st.cT / 0.9), e = 1 - Math.pow(1 - u, 3);
      cGrip.root.position.copy(T.p).addScaledVector(app, -0.06 * (1 - e)); cGrip.root.quaternion.copy(T.q);
      const cu = Math.min(1, Math.max(0, (st.cT - 0.95) / 0.45));
      cGrip.setGrip(c.drive_open + (c.drive_closed - c.drive_open) * cu * cu * (3 - 2 * cu));
      if (st.playing && st.cT > 3.2) showCousin(st.cousin + 1, false);
      if (camGoal.k < 1) {
        camGoal.k = Math.min(1, camGoal.k + dt * 1.6);
        const w = 1 - Math.pow(1 - camGoal.k, 3);
        controls.target.lerp(camGoal.target, w); camera.position.lerp(camGoal.pos, w);
      }
    }
  });

  onTheme(dark => {
    colors();
    const u = table.material.uniforms;
    u.uColor.value.set(dark ? 0x2a3d5e : 0x9fb3d1); u.uGrid.value.set(dark ? 0x5ac8fa : 0x4f78b5); u.uAlpha.value = dark ? 0.55 : 0.5;
    v.ground.material.opacity = dark ? 0.35 : 0.22;
    refreshUI(); st.f = -1; drawStrip();
  });

  // pause the video when off screen (the viewer pauses its own loop)
  new IntersectionObserver(es => { st.visible = es[0].isIntersecting; syncVideo(); }, { threshold: 0.05 }).observe(stage);
  new ResizeObserver(resizeStrip).observe(strip);
  v.onResize = () => { if (!st.touched) aimCamera(true); };

  const videoReady = new Promise(res => {
    if (video.readyState >= 2) res(); else { video.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 6000); }
  });
  await videoReady;
  refreshUI(); resizeStrip(); aimCamera(true);
  v.fitShadow(new THREE.Vector3(hand0.p.x, hand0.p.y, 0), 0.45);
  load.done();
  v.start();
  if (poster) requestAnimationFrame(() => { poster.classList.add('gone'); setTimeout(() => poster.remove(), 600); });
  syncVideo();
  root.__demo = { v, st, setMode, setT: t => setT(t, true), showCousin };   // handle for automated screenshots
  return v;
}
