// "Try it with your mug": a simplified, fully in-browser version of the cousin idea. A photo of a mug is segmented with
// SlimSAM (transformers.js, runs locally), rebuilt as a surface of revolution with a tube handle (recon.js), placed in the
// demonstrated mug's handle frame, and the xArm7 replays the demonstrated episode with the grasp moved onto the new
// handle (inverse kinematics solved here, per frame). Nothing is simulated physically; nothing leaves the device.
import { THREE, createViewer, onTheme, ease, mat4, loadingOverlay, reducedMotion } from '../core/viewer.js';
import { loadXArm, makeFK } from '../core/robot.js';
import { getObject, objectPath, fetchJSON, url, robustMinZ, supportHeight } from '../core/assets.js';
import { reconstruct, largestComponent } from './recon.js';

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';
const SAM_ID = 'Xenova/slimsam-77-uniform';
const SPEED = 2.2;
export const SAMPLES = [
  { id: 'ay_mug2', pts: [[312, 324], [504, 396]] },
  { id: 'elevated_mug', pts: [[216, 384], [504, 456]] },
  { id: 'cloud_mug', pts: [[216, 360], [480, 336]] },
  { id: 'ay_mug1', pts: [[276, 360], [492, 432]], neg: [[110, 620], [60, 520]] },
];
const PHASE_LABEL = ['Reach', 'Reach', 'Approach', 'Grasp', 'Carry', 'Release'];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ segmentation (lazy, only for uploaded photos)
let samP = null;
export function loadSAM(onProgress) {
  if (samP) return samP;
  samP = (async () => {
    const T = await import(TJS);
    T.env.allowLocalModels = false;
    const files = {};
    const prog = p => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file] = [p.loaded, p.total];
      let a = 0, b = 0; for (const k in files) { a += files[k][0]; b += files[k][1]; }
      onProgress && onProgress(a, b);
    };
    const [model, processor] = await Promise.all([
      T.SamModel.from_pretrained(SAM_ID, { dtype: 'q8', progress_callback: prog }),
      T.AutoProcessor.from_pretrained(SAM_ID, { progress_callback: prog }),
    ]);
    return { T, model, processor };
  })();
  samP.catch(() => { samP = null; });
  return samP;
}
export async function embed(sam, canvas) {
  const raw = sam.T.RawImage.fromCanvas(canvas).rgb();
  const inputs = await sam.processor(raw);
  const emb = await sam.model.get_image_embeddings(inputs);
  return { inputs, emb };
}
export async function segment(sam, E, points, neg = []) {      // points / neg: [[x, y], ...] in canvas pixels
  const { T, model, processor } = sam;
  const all = [...points, ...neg];
  const input_points = processor.reshape_input_points([all], E.inputs.original_sizes, E.inputs.reshaped_input_sizes);
  const input_labels = new T.Tensor('int64', BigInt64Array.from(all.map((_, i) => i < points.length ? 1n : 0n)), [1, 1, all.length]);
  const out = await model({ ...E.emb, input_points, input_labels });
  const masks = await processor.post_process_masks(out.pred_masks, E.inputs.original_sizes, E.inputs.reshaped_input_sizes);
  const m = masks[0], [, , Hh, Ww] = m.dims, sc = out.iou_scores.data, N = Hh * Ww;
  let best = -1, bestS = -1;
  for (let k = 0; k < 3; k++) {                         // best-scored of the three, unless it covers most of the photo
    let a = 0; for (let i = k * N; i < (k + 1) * N; i++) a += m.data[i];
    if (a > 0.7 * N) continue;
    if (sc[k] > bestS) { bestS = sc[k]; best = k; }
  }
  if (best < 0) best = 0;
  return { mask: m.data.slice(best * N, (best + 1) * N), W: Ww, H: Hh, score: bestS };
}

// ------------------------------------------------------------------ geometry
// Surface of revolution in the handle frame B (z up, handle towards +x), indexed angle-major so a draw range sweeps it.
function revolve(rings, N, uvOf) {                       // rings: [{r, z}] in order; returns BufferGeometry
  const K = rings.length, pos = [], uv = [], idx = [];
  for (let j = 0; j <= N; j++) {
    const th = (j / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < K; k++) {
      const { r, z } = rings[k]; pos.push(r * c, r * s, z);
      const t = uvOf ? uvOf(r * c, r * s, z) : [0, 0]; uv.push(t[0], t[1]);
    }
  }
  for (let j = 0; j < N; j++) for (let k = 0; k < K - 1; k++) {
    const a = j * K + k, b = (j + 1) * K + k;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.sweep = N * (K - 1) * 6;
  return g;
}

export function buildMug(rec, photo) {
  const group = new THREE.Group();
  const W = photo.width, H = photo.height, P = rec.map;
  // The handle always points at the robot, so the photographed side faces the scene camera only for photos with the
  // handle on the left. For the others, turn the print half a turn about the axis: it still reads the right way round
  // (not mirrored) and now faces the camera, like a mug printed on that side.
  const turn = rec.side > 0 ? -1 : 1;
  const uvOf = (x, y, z) => { const [px, py] = P.texAt(turn * x, z, turn * y); return [px / W, 1 - py / H]; };

  const tex = new THREE.CanvasTexture(photo); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const prof = rec.profile, Hm = rec.height, wall = 0.0035, base = 0.006;
  // outer wall (photo texture), with a slight rounded foot
  const outer = prof.map(p => ({ r: p.r, z: p.z }));
  outer.unshift({ r: Math.max(0.002, prof[0].r - 0.003), z: 0 }); outer[1].z = Math.max(outer[1].z, 0.002);
  const body = new THREE.Mesh(revolve(outer, 120, uvOf),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0, side: THREE.DoubleSide }));
  // rim, inner wall and the two bottoms in the body colour
  const c = new THREE.Color().setRGB(...(rec.innerColor || rec.bodyColor).map(v => v / 255), THREE.SRGBColorSpace);
  const top = prof[prof.length - 1].r;
  const inner = [{ r: 0.0005, z: 0 }, { r: Math.max(0.002, prof[0].r - 0.003), z: 0 }];
  const lining = [{ r: top, z: Hm }, { r: top - wall, z: Hm }];
  for (let k = prof.length - 1; k >= 0; k--) { const p = prof[k]; if (p.z < base) break; lining.push({ r: Math.max(0.003, p.r - wall), z: p.z }); }
  lining.push({ r: 0.0005, z: base });
  const inMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, side: THREE.DoubleSide });
  const lin = new THREE.Mesh(revolve(lining, 72), inMat);
  const foot = new THREE.Mesh(revolve(inner, 72), inMat);
  // handle: a tube along the centreline (in the x-z plane), its ends pushed into the wall
  const pts = rec.handle.pts.map(p => new THREE.Vector3(p[0], 0, p[1]));
  const rAt = z => { const k = Math.min(prof.length - 1, Math.max(0, Math.round(z / Hm * (prof.length - 1)))); return prof[k].r; };
  const a = pts[0], b = pts[pts.length - 1];
  pts.unshift(new THREE.Vector3(rAt(a.z) - 0.004, 0, a.z)); pts.push(new THREE.Vector3(rAt(b.z) - 0.004, 0, b.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const TUB = 80, RAD = 14, tg = new THREE.TubeGeometry(curve, TUB, rec.handle.thick * 0.5, RAD, false);

  tg.scale(1, 0.85, 1);                                  // handles are a little flatter than they are wide
  tg.userData.sweep = TUB * RAD * 6;
  const hc = new THREE.Color().setRGB(...rec.handleColor.map(v => v / 255), THREE.SRGBColorSpace);
  const handle = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: hc, roughness: 0.3, metalness: 0 }));
  for (const m of [body, lin, foot, handle]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  group.userData.sweepers = [body, lin, foot];
  group.userData.handle = handle;
  group.userData.dispose = () => { tex.dispose(); for (const m of [body, lin, foot, handle]) { m.geometry.dispose(); m.material.dispose(); } };
  return group;
}

function setBuild(group, u) {                            // 0..1: the profile sweeps around, then the handle grows
  const sw = ease(Math.min(1, u / 0.7)), hd = ease(Math.max(0, (u - 0.45) / 0.55));
  for (const m of group.userData.sweepers) m.geometry.setDrawRange(0, Math.ceil(sw * m.geometry.userData.sweep / 6) * 6);
  const h = group.userData.handle; h.geometry.setDrawRange(0, Math.ceil(hd * h.geometry.userData.sweep / 6) * 6);
}

// ------------------------------------------------------------------ grasp transfer + IK
// The visitor's mug is built in the demonstrated mug's handle frame B, so it follows the demonstrated mug trajectory
// T_world_B(t). The grasp keeps its relative height on the handle and its distance from the body wall; the TCP path is
// the demonstrated one shifted by that offset in the TCP frame, solved per frame with damped least squares.
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1; while (xs[i] < x) i++; const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}
function graspShift(demo, rec) {
  const G = mat4(demo.grasp.T_B), pg = new THREE.Vector3().setFromMatrixPosition(G);
  const dcl = demo.demo_mug.handle.centerline, dz = dcl.map(p => p[1]);
  const zd0 = Math.min(...dz), zd1 = Math.max(...dz), rel = (pg.z - zd0) / (zd1 - zd0);
  const wallOff = pg.x - interp(demo.demo_mug.profile_z, demo.demo_mug.profile_r, pg.z);
  const uz = rec.handle.pts.map(p => p[1]), zu0 = Math.min(...uz), zu1 = Math.max(...uz);
  const zU = zu0 + rel * (zu1 - zu0);
  const rU = interp(rec.profile.map(p => p.z), rec.profile.map(p => p.r), zU);
  const delta = new THREE.Vector3(rU + wallOff - pg.x, 0, zU - pg.z);
  if (delta.length() > 0.06) delta.setLength(0.06);
  const local = delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(G).transpose());   // in the TCP frame
  // where the jaws meet the handle: the centreline point nearest the approach line through the shifted TCP
  const tcpB = new THREE.Vector3(pg.x + delta.x, pg.y, pg.z + delta.z), ap = new THREE.Vector3().setFromMatrixColumn(G, 2);
  let pinch = null, best = 1e9;
  for (const [x, z] of rec.handle.pts) {
    const d = new THREE.Vector3(x - tcpB.x, 0, z - tcpB.z), t = d.x * ap.x + d.z * ap.z;
    if (t > 0.01) continue;                                // behind the TCP, towards the gripper
    const e = Math.hypot(d.x - t * ap.x, d.z - t * ap.z); if (e < best) { best = e; pinch = [x, z]; }
  }
  return { delta, local, tcpB, pinch: pinch || [tcpB.x, tcpB.z] };
}

function solveIK(spec, demo, local) {
  const fk = makeFK(spec), n = demo.n, out = new Float64Array(n * 7);
  const lo = [], hi = [];
  for (const nm of ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'joint7']) {
    const j = spec.joints.find(x => x.name === nm); lo.push(j.lower ?? -6.28); hi.push(j.upper ?? 6.28);
  }
  const q = new Float64Array(7), tgtP = new THREE.Vector3(), tgtR = new THREE.Matrix4(), p = new THREE.Vector3();
  const J = Array.from({ length: 6 }, () => new Float64Array(7)), z = new THREE.Vector3(), o = new THREE.Vector3(), cr = new THREE.Vector3();
  const Rcur = new THREE.Matrix4(), Rerr = new THREE.Matrix4(), qerr = new THREE.Quaternion();
  let worst = 0;
  for (let t = 0; t < n; t++) {
    const qd = demo.q[t];
    const T0 = fk.run(qd).tcp;
    tgtP.copy(local).applyMatrix4(T0);                   // T0 * [local, 1]
    tgtR.extractRotation(T0);
    for (let i = 0; i < 7; i++) q[i] = t ? out[(t - 1) * 7 + i] + (qd[i] - demo.q[t - 1][i]) : qd[i];
    let err = 1;
    for (let it = 0; it < 40; it++) {
      const { frames, tcp } = fk.run(q);
      p.setFromMatrixPosition(tcp);
      const ep = tgtP.clone().sub(p);
      Rcur.extractRotation(tcp); Rerr.copy(tgtR).multiply(Rcur.clone().transpose());
      qerr.setFromRotationMatrix(Rerr); if (qerr.w < 0) { qerr.x *= -1; qerr.y *= -1; qerr.z *= -1; qerr.w *= -1; }
      const s = Math.sqrt(qerr.x * qerr.x + qerr.y * qerr.y + qerr.z * qerr.z), ang = 2 * Math.atan2(s, qerr.w), k = s > 1e-9 ? ang / s : 2;
      const ew = [qerr.x * k, qerr.y * k, qerr.z * k];
      err = ep.length() + 0.05 * Math.abs(ang);
      if (ep.length() < 2e-4 && Math.abs(ang) < 2e-3) break;
      // analytic Jacobian
      let col = 0;
      for (let c = 0; c < fk.chain.length; c++) {
        const ji = fk.idx[c]; if (ji < 0) continue;
        o.setFromMatrixPosition(frames[c]); z.copy(fk.axes[c]).transformDirection(frames[c]);
        cr.copy(p).sub(o); cr.crossVectors(z, cr);
        J[0][ji] = cr.x; J[1][ji] = cr.y; J[2][ji] = cr.z; J[3][ji] = z.x; J[4][ji] = z.y; J[5][ji] = z.z; col++;
      }
      const e = [ep.x, ep.y, ep.z, ew[0] * 0.5, ew[1] * 0.5, ew[2] * 0.5];
      for (let r = 3; r < 6; r++) for (let i = 0; i < 7; i++) J[r][i] *= 0.5;
      // dq = J^T (J J^T + l^2 I)^-1 e
      const A = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c2) => { let s2 = 0; for (let i = 0; i < 7; i++) s2 += J[r][i] * J[c2][i]; return s2 + (r === c2 ? 1e-4 : 0); }));
      const y = solve6(A, e);
      for (let i = 0; i < 7; i++) { let d = 0; for (let r = 0; r < 6; r++) d += J[r][i] * y[r]; q[i] = Math.min(hi[i], Math.max(lo[i], q[i] + d)); }
    }
    worst = Math.max(worst, err);
    out.set(q, t * 7);
  }
  return { q: out, worst };
}
function solve6(A, b) {                                   // Gaussian elimination with partial pivoting
  const n = 6, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

// ------------------------------------------------------------------ the demo
export async function mount(el) {
  el.innerHTML = '';
  el.classList.add('mm');
  const grid = div('mm-grid'); el.appendChild(grid);
  const photoPane = div('mm-photo'); const stage = div('demo-stage mm-stage');
  grid.append(photoPane, stage);
  const pc = document.createElement('canvas'); pc.className = 'mm-canvas'; photoPane.appendChild(pc);
  const hint = div('mm-hint'); photoPane.appendChild(hint);
  const pctx = pc.getContext('2d');
  const bar = div('demo-bar mm-bar');
  bar.innerHTML = `<span class="dlabel">Try a mug:</span><div class="mm-samples"></div>
    <label class="dbtn ghost mm-up"><svg viewBox="0 0 24 24"><path d="M12 3l5 5h-3v6h-4V8H7zM5 17h14v3H5z"/></svg>Your photo<input type="file" accept="image/*" hidden></label>
    <span class="sp"></span><span class="mm-status dlabel"></span>`;
  const note = div('demo-note');
  note.innerHTML = `<span class="demo-badge">Simplified in-browser version</span>Your mug is rebuilt as a surface of
    revolution from one side-view photo, and the demonstrated grasp moves with its handle; the robot follows the
    demonstration kinematically, with inverse kinematics solved in your browser. The full pipeline instead generates a
    mesh and splat with SAM3D, aligns them with distilled DINOv3 features, and replays in IsaacSim or MuJoCo.
    Uploaded photos never leave your device; segmenting them downloads SlimSAM (about 14&nbsp;MB) once.`;
  el.append(bar, note);
  const status = bar.querySelector('.mm-status');
  const setStatus = t => { status.innerHTML = t; };
  const samplesEl = bar.querySelector('.mm-samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button'); b.className = 'mm-thumb'; b.title = 'Use this mug';
    b.innerHTML = `<img src="${url('mymug/samples/' + s.id + '.jpg')}" alt="Sample mug photo" loading="lazy">`;
    b.addEventListener('click', () => useSample(s, b)); samplesEl.appendChild(b);
  }

  // 3D scene --------------------------------------------------------------------------------------------------------
  const load = loadingOverlay(stage, 'Loading the robot');
  const v = createViewer(stage, { ground: true, groundSize: 8, fov: 30, target: [0.33, 0.14, 0.12], position: [1.08, -0.62, 0.56] });
  v.ground.position.z = -0.05; v.ground.material.opacity = 0.16;
  v.controls.minDistance = 0.4; v.controls.maxDistance = 3;
  const hudTL = div('demo-hud tl'), hudBL = div('demo-hud bl'); stage.append(hudTL, hudBL);
  const whoPill = div('hud dot'), phasePill = div('hud'); hudTL.append(whoPill); hudBL.append(phasePill);
  const [demo, spec, robot, cmObj, demoMugObj] = await Promise.all([
    fetchJSON('mymug/demo.json'), fetchJSON('assets/robot/xarm7.json'), loadXArm(),
    getObject(objectPath('demo_cm')), getObject(objectPath('demo_mug'))]);
  const n = demo.n;
  const Tcm = mat4(demo.T_cm);
  const cmNode = new THREE.Group(); cmNode.add(cmObj); cmObj.scale.setScalar(demo.cm_scale);
  cmNode.position.setFromMatrixPosition(Tcm); cmNode.quaternion.setFromRotationMatrix(Tcm);
  v.scene.add(robot.root, cmNode);
  // a level table at the machine's robust base (as the hero demo); the mug starts resting on it and the small offset to
  // the generated start height fades out during the carry
  const tableTop = new THREE.Vector3(0, 0, robustMinZ(cmObj) * demo.cm_scale).applyMatrix4(Tcm).z;
  const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.78 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.86, 0.026), tableMat); table.receiveShadow = true;
  table.position.set(0.27, 0.17, tableTop - 0.013);
  v.scene.add(table);
  onTheme(dark => { tableMat.color.set(dark ? '#a8977f' : '#e9dcc8'); });
  // the mug slot: B frame node, holding either the demonstrated mug (via T_B_body) or the visitor's mug
  const mugB = new THREE.Group(); v.scene.add(mugB);
  const demoMug = new THREE.Group(); demoMug.add(demoMugObj); demoMugObj.scale.setScalar(demo.demo_mug.scale);
  const TbB = mat4(demo.demo_mug.T_body_B), TBb = TbB.clone().invert();
  demoMug.matrixAutoUpdate = false; demoMug.matrix.copy(TBb);
  mugB.add(demoMug);
  const Bpos = demo.B_pos.map(p => new THREE.Vector3(...p)), Bq = demo.B_quat.map(q => new THREE.Quaternion(q[0], q[1], q[2], q[3]));
  const lift0 = Math.max(-0.03, Math.min(0.03, tableTop - Bpos[0].z));             // B's origin is the mug's bottom centre
  const ex0 = demo.phase.indexOf(4), ex1 = demo.phase.lastIndexOf(4);
  // as in the hero: the kinematic replay can end the mug above (or slightly in) the tray; find the tray under the mug's
  // final base, raise a sinking mug during the carry, and let a floating one drop after the gripper opens
  const gmax = Math.max(...demo.g); let release = n - 1;
  for (let f = ex1; f < n; f++) if (demo.g[f] < 0.5 * gmax) { release = f; break; }
  const settle = { end: 0, drop: 0 };
  const setSettle = r => {
    const sup = supportHeight(cmObj, Tcm, demo.cm_scale, Bpos[n - 1], r);
    const gap = sup === null ? 0 : Math.max(-0.02, Math.min(0.03, Bpos[n - 1].z - sup));
    settle.end = Math.max(0, -gap); settle.drop = Math.max(0, gap);
  };
  setSettle(0.035);
  const liftAt = f => {
    const u = ease((f - ex0) / Math.max(1, ex1 - ex0));
    let z = lift0 * (1 - u) + settle.end * u;
    if (settle.drop > 0 && f > release) z -= settle.drop * Math.min(1, ((f - release) / (10 * SPEED) / 0.28) ** 2);
    return z;
  };
  v.fitShadow(new THREE.Vector3(0.27, 0.15, 0), 0.7);
  load.done(); v.start();

  // playback state
  const st = { qTraj: null, t: 0, mode: 'demo', hold: 0, build: 1, userMug: null, rec: null, photo: null, grasp: null, outgoing: null, outU: 0 };
  const qd = new Float64Array(7);
  function poseAt(f, qsrc) {
    f = Math.max(0, Math.min(n - 1, f)); const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), a = f - i0;
    for (let j = 0; j < 7; j++) qd[j] = qsrc ? lerp(qsrc[i0 * 7 + j], qsrc[i1 * 7 + j], a) : lerp(demo.q[i0][j], demo.q[i1][j], a);
    robot.setQ(qd); robot.setGrip(Math.max(0, lerp(demo.g[i0], demo.g[i1], a)));
    mugB.position.lerpVectors(Bpos[i0], Bpos[i1], a); mugB.position.z += liftAt(f); mugB.quaternion.slerpQuaternions(Bq[i0], Bq[i1], a);
    return demo.phase[a < 0.5 ? i0 : i1];
  }
  function setWho() {
    whoPill.style.setProperty('--c', st.userMug ? 'var(--ours)' : 'var(--r2r2r)');
    whoPill.innerHTML = st.userMug ? '<b>Your mug</b> <span class="mut">· rebuilt from your photo</span>' : '<b>Demonstrated mug</b> <span class="mut">· pick a mug below</span>';
  }
  setWho();
  let shown = -1;
  v.add(dt => {
    if (st.mode === 'build') {
      st.build = Math.min(1, st.build + dt / (reducedMotion() ? 0.01 : 1.6));
      if (st.outgoing) { st.outU = Math.min(1, st.outU + dt / 0.45); st.outgoing.scale.setScalar(Math.max(0.001, 1 - ease(st.outU))); if (st.outU >= 1) { st.outgoing.removeFromParent(); st.outgoing = null; } }
      setBuild(st.userMug, st.build);
      poseAt(0, st.qTraj);
      const drop = 1 - ease(Math.min(1, st.build / 0.9));
      mugB.position.z += 0.06 * drop;
      if (st.build >= 1) { st.mode = 'play'; st.t = 0; }
    } else if (st.mode === 'play') {
      st.t += dt * 10 * SPEED;
      const ph = poseAt(st.t, st.qTraj);
      if (ph !== shown) { shown = ph; phasePill.innerHTML = `<b>${PHASE_LABEL[ph]}</b>${ph === 4 ? ' <span class="mut">· the human trajectory</span>' : ''}`; }
      if (st.t >= n - 1) { st.mode = 'hold'; st.hold = 0; }
    } else if (st.mode === 'hold') {
      st.hold += dt; if (st.hold > 1.6) { st.mode = 'play'; st.t = 0; }
    }
  });
  st.mode = 'play';

  // photo pane ------------------------------------------------------------------------------------------------------
  const view = { img: null, W: 0, H: 0, mask: null, rec: null, pts: [], anim: 0 };
  function fitRect() {
    const r = photoPane.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    pc.width = Math.round(r.width * dpr); pc.height = Math.round(r.height * dpr);
    if (!view.img) return null;
    const s = Math.min(pc.width / view.W, pc.height / view.H);
    return { s, ox: (pc.width - view.W * s) / 2, oy: (pc.height - view.H * s) / 2, dpr };
  }
  let maskCanvas = null;
  function draw() {
    const R = fitRect(); pctx.clearRect(0, 0, pc.width, pc.height);
    if (!R) return;
    pctx.drawImage(view.img, R.ox, R.oy, view.W * R.s, view.H * R.s);
    const X = x => R.ox + x * R.s, Y = y => R.oy + y * R.s;
    if (maskCanvas) pctx.drawImage(maskCanvas, R.ox, R.oy, view.W * R.s, view.H * R.s);
    const rec = view.rec, u = view.anim;
    if (rec) {
      const P = rec.map.toPhoto, accent = css('--accent') || '#0062d6', ours = css('--ours') || '#c51d38';
      // fitted body: side walls, the rim ellipse and the foot ellipse (far half dashed), and the axis
      const k1 = ease(Math.min(1, u * 1.6)), prof = rec.profile, Hh = rec.height;
      pctx.lineWidth = 2 * R.dpr; pctx.strokeStyle = accent; pctx.setLineDash([]);
      for (const sgn of [1, -1]) {
        pctx.beginPath();
        prof.slice(0, Math.ceil(k1 * prof.length)).forEach((p, i) => { const [x, y] = P(sgn * p.r, p.z); i ? pctx.lineTo(X(x), Y(y)) : pctx.moveTo(X(x), Y(y)); });
        pctx.stroke();
      }
      const ell = (z, r, from, to, dash) => {
        pctx.setLineDash(dash ? [4 * R.dpr, 4 * R.dpr] : []); pctx.beginPath();
        for (let i = 0; i <= 48; i++) { const t = from + (to - from) * i / 48, [x, y] = rec.map.project(r * Math.cos(t), z, r * Math.sin(t)); i ? pctx.lineTo(X(x), Y(y)) : pctx.moveTo(X(x), Y(y)); }
        pctx.stroke();
      };
      if (k1 > 0.02) { const front = rec.side > 0 ? [Math.PI, 2 * Math.PI] : [0, Math.PI], back = rec.side > 0 ? [0, Math.PI] : [Math.PI, 2 * Math.PI];
        ell(0, prof[0].r, front[0], front[0] + (front[1] - front[0]) * k1, false); ell(0, prof[0].r, back[0], back[0] + (back[1] - back[0]) * k1, true); }
      if (k1 > 0.98) ell(Hh, prof[prof.length - 1].r, 0, 2 * Math.PI, false);
      pctx.setLineDash([5 * R.dpr, 5 * R.dpr]); pctx.lineWidth = 1.2 * R.dpr;
      const [ax0, ay0] = P(0, 0), [ax1, ay1] = P(0, Hh); pctx.beginPath(); pctx.moveTo(X(ax0), Y(ay0)); pctx.lineTo(X(ax1), Y(ay1)); pctx.stroke();
      pctx.setLineDash([]);
      // handle centreline
      const hp = rec.handle.pts, k2 = Math.ceil(ease(Math.max(0, Math.min(1, u * 1.6 - 0.4))) * hp.length);
      pctx.strokeStyle = ours; pctx.lineWidth = Math.max(2.5 * R.dpr, 0.3 * rec.handle.thick / rec.map.s / rec.map.f * R.s);
      pctx.lineCap = 'round'; pctx.beginPath();
      hp.slice(0, k2).forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? pctx.lineTo(X(x), Y(y)) : pctx.moveTo(X(x), Y(y)); });
      pctx.stroke();
      // grasp marker
      if (st.grasp && u > 0.85) {
        const g = st.grasp.pinch, [gx, gy] = P(g[0], g[1]), a = Math.min(1, (u - 0.85) / 0.15);
        pctx.globalAlpha = a; pctx.strokeStyle = '#fff'; pctx.lineWidth = 4 * R.dpr; pctx.beginPath(); pctx.arc(X(gx), Y(gy), 9 * R.dpr, 0, 7); pctx.stroke();
        pctx.strokeStyle = ours; pctx.lineWidth = 2.2 * R.dpr; pctx.beginPath(); pctx.arc(X(gx), Y(gy), 9 * R.dpr, 0, 7); pctx.stroke();
        pctx.fillStyle = ours; pctx.beginPath(); pctx.arc(X(gx), Y(gy), 2.6 * R.dpr, 0, 7); pctx.fill();
        pctx.font = `600 ${11 * R.dpr}px DM Sans, sans-serif`; pctx.fillStyle = '#fff'; pctx.strokeStyle = 'rgba(0,0,0,.55)'; pctx.lineWidth = 3 * R.dpr;
        const lx = X(gx) + rec.side * 14 * R.dpr, ta = rec.side > 0 ? 'left' : 'right'; pctx.textAlign = ta;
        pctx.strokeText('grasp', lx, Y(gy) + 4 * R.dpr); pctx.fillText('grasp', lx, Y(gy) + 4 * R.dpr);
        pctx.textAlign = 'left'; pctx.globalAlpha = 1;
      }
    }
    for (const p of view.pts) {                           // tap points
      pctx.fillStyle = '#fff'; pctx.beginPath(); pctx.arc(X(p[0]), Y(p[1]), 6 * R.dpr, 0, 7); pctx.fill();
      pctx.fillStyle = css('--accent') || '#0062d6'; pctx.beginPath(); pctx.arc(X(p[0]), Y(p[1]), 3.6 * R.dpr, 0, 7); pctx.fill();
    }
  }
  new ResizeObserver(draw).observe(photoPane);
  let animRaf = 0;
  function animateOverlay() {
    cancelAnimationFrame(animRaf); view.anim = 0; const t0 = performance.now();
    const step = now => { view.anim = Math.min(1, (now - t0) / 1400); draw(); if (view.anim < 1) animRaf = requestAnimationFrame(step); };
    animRaf = requestAnimationFrame(step);
  }
  hint.innerHTML = '<div class="mm-drop"><b>Pick a mug below</b><span>or use a side-view photo of your own, handle to the left or right</span></div>';

  function setPhoto(img) {
    const max = 1024, s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas'); c.width = Math.round((img.naturalWidth || img.width) * s); c.height = Math.round((img.naturalHeight || img.height) * s);
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);   // the reconstruction reads pixels back
    view.img = c; view.W = c.width; view.H = c.height; view.mask = null; view.rec = null; view.pts = []; maskCanvas = null;
    hint.innerHTML = ''; draw();
    return c;
  }
  function showMask(mask, W, H) {
    maskCanvas = document.createElement('canvas'); maskCanvas.width = W; maskCanvas.height = H;
    const g = maskCanvas.getContext('2d'), id = g.createImageData(W, H), col = new THREE.Color(css('--accent') || '#0062d6');
    for (let i = 0; i < W * H; i++) if (mask[i]) {
      const x = i % W, edge = x === 0 || x === W - 1 || i < W || i >= W * (H - 1) || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W];
      id.data[4 * i] = edge ? 255 : col.r * 255; id.data[4 * i + 1] = edge ? 255 : col.g * 255; id.data[4 * i + 2] = edge ? 255 : col.b * 255; id.data[4 * i + 3] = edge ? 255 : 70;
    }
    g.putImageData(id, 0, 0); draw();
  }

  // build + run -----------------------------------------------------------------------------------------------------
  function build(mask, W, H) {
    const rec = reconstruct(mask, W, H, view.img, { height: demo.demo_mug.height });
    if (rec.error) { setStatus(rec.error); view.rec = null; draw(); return false; }
    view.rec = rec;
    st.grasp = graspShift(demo, rec);
    const ik = solveIK(spec, demo, st.grasp.local);
    animateOverlay();
    // swap the mug in the 3D scene
    const g = buildMug(rec, view.img);
    if (st.userMug) { st.outgoing = st.userMug; } else { st.outgoing = demoMug; }
    st.outU = 0;
    if (st.outgoing === demoMug) { /* keep the demonstrated mug object for later */ }
    mugB.add(g);
    if (st.prevMug && st.prevMug !== demoMug) { const pm = st.prevMug; setTimeout(() => { pm.removeFromParent(); pm.userData.dispose(); }, 600); }
    st.prevMug = st.userMug; st.userMug = g; st.qTraj = ik.q; st.build = 0; st.mode = 'build';
    setSettle(Math.min(0.05, rec.profile[0].r));

    setWho();
    const d = st.grasp.delta;
    setStatus(`Grasp moved ${(Math.abs(d.x) * 100).toFixed(1)} cm ${d.x >= 0 ? 'out' : 'in'}, ${(Math.abs(d.z) * 100).toFixed(1)} cm ${d.z >= 0 ? 'up' : 'down'}`
      + (ik.worst > 0.004 ? ' <span class="mut">(reach limited)</span>' : ''));
    return true;
  }

  async function useSample(s, btn) {
    samplesEl.querySelectorAll('.mm-thumb').forEach(b => b.classList.toggle('on', b === btn));
    setStatus('Loading the photo');
    const [img, mimg] = await Promise.all([loadImage(url('mymug/samples/' + s.id + '.jpg')), loadImage(url('mymug/samples/' + s.id + '_mask.png'))]);
    setPhoto(img);
    view.pts = s.pts.map(p => [p[0] * view.W / 720, p[1] * view.H / 720]);
    const m = largestComponent(maskFromImage(mimg, view.W, view.H), view.W, view.H);
    showMask(m, view.W, view.H);
    setTimeout(() => build(m, view.W, view.H), reducedMotion() ? 0 : 350);
  }

  // uploads: tap to segment with SlimSAM in the browser
  let embedding = null, embedFor = null;
  bar.querySelector('input[type=file]').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = '';
    samplesEl.querySelectorAll('.mm-thumb').forEach(b => b.classList.remove('on'));
    const img = await loadImage(URL.createObjectURL(f));
    const c = setPhoto(img); embedding = null; embedFor = c;
    hint.innerHTML = '<div class="mm-tapme">Tap your mug</div>';
    setStatus('Loading the segmentation model');
    try {
      const sam = await loadSAM((a, b) => setStatus(`Loading the segmentation model · ${(a / 1e6).toFixed(1)} / ${(b / 1e6).toFixed(1)} MB`));
      setStatus('Reading the photo');
      const E = await embed(sam, c);
      if (embedFor === c) { embedding = E; setStatus('Tap your mug'); }
    } catch (err) { console.error(err); setStatus('The segmentation model could not load here. Try a sample mug.'); }
  });
  pc.addEventListener('click', async e => {
    if (!view.img || !embedFor || embedFor !== view.img) return;
    const R = fitRect(), r = pc.getBoundingClientRect();
    const x = ((e.clientX - r.left) * R.dpr - R.ox) / R.s, y = ((e.clientY - r.top) * R.dpr - R.oy) / R.s;
    if (x < 0 || y < 0 || x >= view.W || y >= view.H) return;
    view.pts = [...view.pts, [x, y]].slice(-3); hint.innerHTML = ''; draw();
    if (!embedding) { setStatus('Still reading the photo, one moment'); return; }
    setStatus('Segmenting');
    const sam = await loadSAM();
    const seg = await segment(sam, embedding, view.pts);
    const m = largestComponent(seg.mask, seg.W, seg.H);
    showMask(m, seg.W, seg.H);
    if (build(m, seg.W, seg.H) === false) view.pts = view.pts.slice(-1);
  });
  // drop a photo onto the pane
  photoPane.addEventListener('dragover', e => { e.preventDefault(); photoPane.classList.add('drag'); });
  photoPane.addEventListener('dragleave', () => photoPane.classList.remove('drag'));
  photoPane.addEventListener('drop', e => {
    e.preventDefault(); photoPane.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
    const inp = bar.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  });

  // start with the first sample once the demo is on screen
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); useSample(SAMPLES[0], samplesEl.firstChild); } }, { threshold: 0.35 });
  io.observe(el);
}

function maskFromImage(img, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.drawImage(img, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = d[4 * i] > 127 ? 1 : 0;
  return m;
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
