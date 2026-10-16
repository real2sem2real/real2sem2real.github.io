// A real xArm7 trial, the front-camera footage next to a 3D replay on one timeline. The robot is driven by what the trial
// recorded: the gripper pose (joint angles by inverse kinematics) and the gripper opening, with the policy's predicted
// target as a ghost. The coffee machine and the mug are estimated from the first video frame (their meshes fitted to
// segmentation masks under the calibrated camera); the mug then moves with the recorded gripper while it is closed. The
// dashed path is the demonstrated motion: the carry of a generated episode on the same machine, which replays the
// human's tracked trajectory. Data: manifest.json, <trial>.bin (int16 per 20 fps frame: 7 joints, gripper drive, TCP,
// predicted target, mug position, mug quaternion), <trial>.mp4 (the footage on the same 20 fps clock).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createViewer, mat4, onTheme } from '../core/viewer.js';
import { loadXArm } from '../core/robot.js';
import { getObject, objectPath, robustMinZ } from '../core/assets.js';
import { REDUCED, PLAY, PAUSE, esc, ensureCss, video, whenVisible, seg } from '../tasks/loopkit.js';

const BASE = new URL('./', import.meta.url);
const url = p => new URL(p, BASE).href;
const SPEEDS = [1, 2, 4];
const HOLD = 1.5;                                        // seconds held on the last frame before the trial loops
const fmt = t => { t = Math.max(0, t); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// the recorded gripper path, revealed up to the current frame (as the hero's trails)
function pathTube(points, color) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  const segs = points.length * 2, radial = 6;
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, 0.0024, radial, false),
                              new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
  mesh.renderOrder = 2;
  return { mesh, reveal(u) { mesh.geometry.setDrawRange(0, Math.floor(Math.max(0, Math.min(1, u)) * segs) * radial * 6); } };
}

// a dashed tube along a polyline: one short tube per dash, merged
function dashedTube(points, color, dash = 0.012, gap = 0.008) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2), L = curve.getLength(), parts = [];
  for (let s = 0; s < L; s += dash + gap) {
    const a = s / L, b = Math.min(L, s + dash) / L, pts = [];
    for (let k = 0; k <= 4; k++) pts.push(curve.getPointAt(a + (b - a) * k / 4));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 4, 0.002, 6, false));
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  mesh.renderOrder = 2;
  return mesh;
}

export async function mount(el) {
  ensureCss(new URL('../tasks/loopkit.css', BASE).href);
  ensureCss(url('replay.css'));
  const M = await (await fetch(url('manifest.json'))).json();
  const S = M.scales, fps = M.fps, W = M.stride;
  el.classList.add('rp');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top"><span class="dlabel">Trial</span><div class="seg rp-trial" role="group" aria-label="Trial"></div>
      <span class="sp"></span><div class="seg rp-view" role="group" aria-label="3D view"></div></div>
    <div class="lk-stage"><div class="rp-pair">
      <figure class="lk-tile rp-vid"><div class="demo-hud tl"><span class="hud dot" style="--c:var(--ours)"><b>Real camera</b> <span class="mut">recorded</span></span></div>
        <div class="demo-hud bl"><span class="hud rp-pol"></span></div></figure>
      <figure class="rp-3d"><div class="demo-hud tl"><span class="hud"><b>3D replay</b> <span class="mut">robot base frame</span></span></div>
        <div class="demo-hud bl rp-legend">
          <span class="hud dot" style="--c:var(--ours)">Gripper path <span class="mut">recorded</span></span>
          <span class="hud dot" style="--c:var(--orange)">Demonstrated motion</span></div>
        <div class="demo-hud tr"><span class="hud rp-phase"></span></div></figure>
    </div></div>
    <div class="demo-bar">
      <button class="dbtn lk-play" type="button" aria-label="Pause">${PAUSE}</button>
      <input class="drange rp-scrub" type="range" min="0" max="1000" value="0" aria-label="Scrub the trial">
      <span class="lk-time">0:00 / 0:00</span>
      <div class="seg rp-speed" role="group" aria-label="Playback speed"></div>
    </div>
    <div class="demo-note rp-note"></div>`;
  const $ = s => el.querySelector(s);
  const vidTile = $('.rp-vid'), stage3 = $('.rp-3d'), scrub = $('.rp-scrub'), timeEl = $('.lk-time'), playBtn = $('.lk-play');
  const st = { trial: null, data: null, f: 0, speed: 2, playing: !REDUCED, scrubbing: false, view: 'orbit', hold: 0, vid: null };

  // ---- 3D scene: robot, table, machine, mug, paths, camera frustum ----
  const v = createViewer(stage3, { fov: 32, target: [0.40, 0.13, 0.14], position: [1.0, -0.62, 0.55], maxDpr: 1.75 });
  v.fitShadow(new THREE.Vector3(0.4, 0.15, 0), 0.7);
  v.controls.minDistance = 0.45; v.controls.maxDistance = 2.6;
  const home = { p: v.camera.position.clone(), t: v.controls.target.clone() };
  const robot = await loadXArm(); v.scene.add(robot.root);
  const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.05), tableMat);
  table.receiveShadow = true; table.position.set(0.38, 0.12, 0); v.scene.add(table);
  const paint = () => { tableMat.color.set(document.documentElement.getAttribute('data-theme') === 'dark' ? 0x3a352d : 0xe9dcc6); };
  paint(); onTheme(paint);
  const holder = new THREE.Group(); v.scene.add(holder);
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.009, 18, 12),
                               new THREE.MeshBasicMaterial({ color: css('--accent') || '#0062d6', transparent: true, opacity: 0.35, depthWrite: false }));
  ghost.renderOrder = 3; v.scene.add(ghost);
  let trail = null;

  // the real camera: a frustum, and a view from it (its intrinsics give the vertical field of view)
  const C = M.camera, Rc = C.R, cc = new THREE.Vector3(...C.center);
  const ax = i => new THREE.Vector3(Rc[3 * i], Rc[3 * i + 1], Rc[3 * i + 2]);   // camera x (right), y (down), z (forward) in the base frame
  const [fx, fy, cx, cy] = C.K, [iw, ih] = C.size, depth = 0.11;
  const corner = (u, w) => cc.clone().add(ax(2).multiplyScalar(depth)).add(ax(0).multiplyScalar((u - cx) / fx * depth)).add(ax(1).multiplyScalar((w - cy) / fy * depth));
  const cs = [corner(0, 0), corner(iw, 0), corner(iw, ih), corner(0, ih)];
  const fr = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([cc, cs[0], cc, cs[1], cc, cs[2], cc, cs[3], cs[0], cs[1], cs[1], cs[2], cs[2], cs[3], cs[3], cs[0]]),
                                    new THREE.LineBasicMaterial({ color: 0x7a8496, transparent: true, opacity: 0.8 }));
  v.scene.add(fr);
  const vfov = 2 * Math.atan(ih / 2 / fy) * 180 / Math.PI;
  function setView(k) {
    st.view = k;
    if (k === 'camera') {
      v.controls.enabled = false; fr.visible = false;
      v.camera.up.copy(ax(1)).negate(); v.camera.position.copy(cc); v.camera.fov = vfov;
      v.camera.lookAt(cc.clone().add(ax(2))); v.camera.updateProjectionMatrix();
    } else {
      v.controls.enabled = true; fr.visible = true; v.camera.up.set(0, 0, 1); v.camera.fov = 32;
      v.camera.position.copy(home.p); v.controls.target.copy(home.t); v.camera.updateProjectionMatrix(); v.controls.update();
    }
    v.renderOnce();
  }

  // ---- one trial ----
  async function setTrial(tr) {
    st.trial = tr; st.f = 0; st.hold = 0;
    $('.rp-pol').innerHTML = `<b>R2Sem2R</b> <span class="mut">${esc(tr.policy.replace(/^R2Sem2R policy, /, ''))}</span>`;
    // footage
    vidTile.querySelector('video')?.remove();
    const vid = video(url(tr.video), url(tr.poster)); vid.preload = 'auto'; vid.src = vid.dataset.src; vidTile.prepend(vid); st.vid = vid;
    vid.addEventListener('loadedmetadata', () => { vid.playbackRate = st.speed; if (st.playing && visible()) vid.play().catch(() => {}); });
    // data + objects
    const [buf, cm, mug] = await Promise.all([fetch(url(tr.bin)).then(r => r.arrayBuffer()), getObject(objectPath(tr.machine.asset)), getObject(objectPath(tr.mug.asset))]);
    if (st.trial !== tr) return;
    st.data = new Int16Array(buf);
    holder.clear();
    cm.matrixAutoUpdate = false; cm.matrix.copy(mat4(tr.machine.T)); holder.add(cm);
    table.position.z = tr.machine.T[11] + robustMinZ(cm);
    const mugPivot = new THREE.Group(); mug.scale.setScalar(tr.mug.scale); mugPivot.add(mug); holder.add(mugPivot); st.mug = mugPivot;
    const n = tr.n, pts = [];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(st.data[i * W + 8] / S.p, st.data[i * W + 9] / S.p, st.data[i * W + 10] / S.p));
    trail = pathTube(pts, css('--ours') || '#c51d38'); holder.add(trail.mesh);
    const H = tr.human, hp = []; for (let i = 0; i < H.length; i += 3) hp.push(new THREE.Vector3(H[i], H[i + 1], H[i + 2]));
    holder.add(dashedTube(hp, css('--orange') || '#e07b00'));
    $('.rp-note').innerHTML = `<b>Recorded</b> in this trial: the footage, the gripper pose and opening (the arm's joint angles
      by inverse kinematics, within 0.2&nbsp;mm), and the policy's predicted target (faint sphere). <b>Estimated</b> from the first
      frame: the coffee machine and the mug, their meshes fitted to segmentation masks with the calibrated camera (silhouette
      IoU ${tr.machine.iou.toFixed(2)} and ${tr.mug.iou.toFixed(2)}); the mug then moves with the recorded gripper while it is closed.
      <b>Dashed</b>: the demonstrated motion, the carry of a generated episode on the same machine, which replays the human's
      tracked trajectory; the real gripper lets go ${tr.release_gap_cm.toFixed(1)}&nbsp;cm from its end. The robot-base frame and the
      camera are the ones the policy ran with; <i>Camera view</i> looks through the real camera.`;
    scrub.max = String(n - 1);
    show(0); v.renderOnce();
  }

  const q7 = new Array(7), quat = new THREE.Quaternion();
  function show(f) {
    const d = st.data, tr = st.trial; if (!d || !tr) return;
    const i = Math.max(0, Math.min(tr.n - 1, Math.round(f))), o = i * W;
    for (let k = 0; k < 7; k++) q7[k] = d[o + k] / S.q;
    robot.setQ(q7); robot.setGrip(d[o + 7] / S.g);
    ghost.position.set(d[o + 11] / S.p, d[o + 12] / S.p, d[o + 13] / S.p);
    st.mug.position.set(d[o + 14] / S.p, d[o + 15] / S.p, d[o + 16] / S.p);
    st.mug.quaternion.copy(quat.set(d[o + 17] / S.r, d[o + 18] / S.r, d[o + 19] / S.r, d[o + 20] / S.r).normalize());
    trail.reveal(i / Math.max(1, tr.n - 1));
    const ph = i < tr.grasp ? 'Reach and grasp' : i <= tr.release ? 'Carry to the tray' : 'Release';
    $('.rp-phase').innerHTML = `<b>${ph}</b>`;
    const T = (tr.n - 1) / fps, t = i / fps;
    if (!st.scrubbing) scrub.value = String(i);
    timeEl.textContent = `${fmt(t)} / ${fmt(T)}`;
  }

  // ---- clock: the video leads; the 3D follows its current time ----
  v.add(dt => {
    const vid = st.vid, tr = st.trial; if (!vid || !tr || !st.data) return;
    if (st.scrubbing) return;
    if (st.playing) {
      if (vid.ended || vid.currentTime >= (tr.n - 1) / fps - 0.03) {
        st.hold += dt;
        if (st.hold > HOLD) { st.hold = 0; vid.currentTime = 0; vid.play().catch(() => {}); }
      } else if (vid.paused && vid.readyState >= 2) vid.play().catch(() => {});
    }
    show(vid.currentTime * fps);
  });
  function setPlaying(p) {
    st.playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (st.vid) { if (p) st.vid.play().catch(() => {}); else st.vid.pause(); }
  }
  playBtn.addEventListener('click', () => setPlaying(!st.playing));
  scrub.addEventListener('input', () => {
    st.scrubbing = true; if (st.vid) { st.vid.pause(); st.vid.currentTime = Number(scrub.value) / fps; }
    show(Number(scrub.value)); v.renderOnce();
  });
  scrub.addEventListener('change', () => { st.scrubbing = false; if (st.playing && st.vid) st.vid.play().catch(() => {}); });
  seg($('.rp-speed'), SPEEDS.map(s => [String(s), s + '&times;']), String(st.speed), k => { st.speed = Number(k); if (st.vid) st.vid.playbackRate = st.speed; });
  seg($('.rp-view'), [['orbit', 'Orbit'], ['camera', 'Camera view']], 'orbit', setView);
  seg($('.rp-trial'), M.trials.map(t => [t.id, esc(t.short || t.label)]), M.trials[0].id, id => setTrial(M.trials.find(t => t.id === id)));
  setPlaying(st.playing);

  const visible = whenVisible(el, () => { v.start(); if (st.playing && st.vid) st.vid.play().catch(() => {}); },
                              () => { v.stop(); st.vid && st.vid.pause(); });
  await setTrial(M.trials[0]);
  v.start();
}
