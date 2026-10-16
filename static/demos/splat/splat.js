// "The real scene": Gaussian splats of the phone-scanned coffee machine and mug, with the mug moving along the 6-DoF
// path our tracker recovered from the single human RGB video. The phone camera (recovered from the machine's track)
// plays that video, the demonstrator's hand is the HaMeR skeleton lifted into the same frame, and "Cousins" carries
// cousin mugs along the same path through their semantic alignment to the scanned mug.
//
// Data (path.json, built offline): stage frame = table under the machine, z up, metres. frames[i] = mug pose at tracked
// frame i (10 fps): position + quaternion (x y z w) of the centred mug splat. hand[i] = 21 keypoints or null.
// usd_to_mug = cousin mesh frame -> centred-mug frame (the demo_mug body frame every cousin is aligned to).
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createViewer, onTheme, reducedMotion, loadingOverlay } from '../core/viewer.js';
import { getObject, objectPath, url, fetchBin } from '../core/assets.js';

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
               [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]];
const HAND_COLOR = 0xff7a45;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

// soft radial "virtual tabletop" with a faint 5 cm grid; the video was shot on a desk at the machine's base plane
function makeTable() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x8fa6c8) }, uGrid: { value: new THREE.Color(0x5d7fb0) }, uAlpha: { value: 0.5 }, uR: { value: 0.78 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec3 uGrid; uniform float uAlpha; uniform float uR; varying vec2 vP;
      void main(){
        float r = length(vP) / uR;
        float fall = smoothstep(1.0, 0.15, r);
        vec2 g = abs(fract(vP / 0.05 - 0.5) - 0.5) / fwidth(vP / 0.05);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec3 c = mix(uColor, uGrid, line * 0.55);
        gl_FragColor = vec4(c, uAlpha * fall * (0.34 + 0.22 * line));
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), mat);
  m.position.set(0.22, -0.12, -0.0015);
  m.renderOrder = -2;
  return m;
}

// blurred contact shadow (a radial-gradient texture on a quad) to ground objects on the virtual table
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.45, 'rgba(0,0,0,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// glowing path: one tube, revealed up to `progress` by a shader (u = arc-length fraction along the tube)
function makePath(points) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segs = 360, geo = new THREE.TubeGeometry(curve, segs, 0.0032, 10, false);
  // u = TIME fraction (tracked frame / last frame) of each tube ring, so revealing up to t/T follows the mug: the tube
  // is sampled by arc length, the frames are not (the mug rests for the first 3 s)
  const cum = [0];
  for (let k = 1; k < points.length; k++) cum.push(cum[k - 1] + points[k].distanceTo(points[k - 1]));
  const Ltot = cum[cum.length - 1], ringT = new Float32Array(segs + 1);
  for (let i = 0, k = 0; i <= segs; i++) {
    const s = i / segs * Ltot;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const a = cum[k + 1] > cum[k] ? (s - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    ringT[i] = Math.min(1, (k + Math.min(1, Math.max(0, a))) / (points.length - 1));
  }
  const n = geo.attributes.position.count, u = new Float32Array(n);
  for (let i = 0; i < n; i++) u[i] = ringT[Math.floor(i / 11)];
  geo.setAttribute('u', new THREE.BufferAttribute(u, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uP: { value: 0 }, uA: { value: new THREE.Color(0x0062d6) }, uB: { value: new THREE.Color(0x00c2ff) }, uDim: { value: 0.22 } },
    vertexShader: 'attribute float u; varying float vU; void main(){ vU = u; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uP; uniform vec3 uA; uniform vec3 uB; uniform float uDim; varying float vU;
      void main(){
        vec3 c = mix(uA, uB, vU);
        float on = step(vU, uP);
        float head = smoothstep(uP - 0.06, uP, vU) * on;
        gl_FragColor = vec4(c + head * 0.35, mix(uDim, 0.95, on));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, curve, mat };
}

// RGB <-> DINOv3 colours for one splat: splat/<name>_dino.bin holds n x 3 colour bytes in splat order, the first three
// principal components of each Gaussian's distilled DINOv3 feature (one basis for the mug and the machine). Both colourings
// are packed once and swapped by copying the packed array, as in the align demo.
async function featureColours(mesh, name) {
  const [bin] = await Promise.all([fetchBin(`splat/${name}_dino.bin`), mesh.initialized]);
  const ps = mesh.packedSplats, n = ps.numSplats, b = new Uint8Array(bin);
  if (b.length !== 3 * n) throw new Error(`splat/${name}: ${b.length} bytes for ${n} splats`);
  const rgb = ps.packedArray.slice();
  for (let i = 0; i < n; i++) {
    const g = ps.getSplat(i);
    g.color.setRGB(b[3 * i] / 255, b[3 * i + 1] / 255, b[3 * i + 2] / 255);
    ps.setSplat(i, g.center, g.scales, g.quaternion, g.opacity, g.color);
  }
  const dino = ps.packedArray.slice(); ps.packedArray.set(rgb);
  return kind => { ps.packedArray.set(kind === 'dino' ? dino : rgb); ps.needsUpdate = true; if (mesh.updateVersion) mesh.updateVersion(); };
}

export async function mount(root) {
  if (!document.querySelector('link[data-demo-css="splat"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url('splat/splat.css'); l.dataset.demoCss = 'splat';
    document.head.appendChild(l);
  }
  let stage = root.querySelector('.demo-stage');
  if (!stage) { stage = el('div', 'demo-stage'); root.prepend(stage); }
  const poster = stage.querySelector('.demo-poster');
  const load = loadingOverlay(stage, 'Loading the scanned scene');

  const v = createViewer(stage, { ground: false, shadows: false, fov: 30, target: [0.24, -0.06, 0.11],
                                  position: [1.032, -0.725, 0.614], maxDpr: 1.5 });
  const { renderer, scene, camera, controls } = v;
  renderer.toneMapping = THREE.NoToneMapping;                     // splat colours as captured
  controls.minDistance = 0.35; controls.maxDistance = 2.4;
  controls.autoRotate = !reducedMotion(); controls.autoRotateSpeed = -0.55;
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  // ── data ──
  let P;
  try {
    P = await (await fetch(url('splat/path.json'))).json();
  } catch (e) { load.error('Could not load the scene.'); throw e; }
  const N = P.n, fps = P.fps, T_END = (N - 1) / fps;
  const pos = P.frames.map(f => new THREE.Vector3(f[0], f[1], f[2]));
  const quat = P.frames.map(f => new THREE.Quaternion(f[3], f[4], f[5], f[6]));

  // ── scene ──
  const table = makeTable(); scene.add(table);
  const blobTex = blobTexture();
  const cmShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.30), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 }));
  cmShadow.position.set(0.0, 0.0, 0.0005); scene.add(cmShadow);
  const mugShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  mugShadow.position.z = 0.0008; scene.add(mugShadow);

  let loaded = 0;
  const tick = () => { loaded++; load.set(loaded / 3); };
  const machine = new SplatMesh({ url: url('splat/scene.spz'), onLoad: tick });
  const mug = new SplatMesh({ url: url('splat/mug.spz'), onLoad: tick });
  scene.add(machine, mug);

  const path = makePath(pos); scene.add(path.mesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 20, 14), new THREE.MeshBasicMaterial({ color: 0x00c2ff, transparent: true, opacity: 0.9 }));
  head.renderOrder = 3; scene.add(head);
  // the 101 tracked poses as small dots
  const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pos),
                                new THREE.PointsMaterial({ color: 0x2f92ff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dots);

  // phone camera frustum + the human video on its image plane
  const cam = P.camera, Rc = cam.R;                                 // columns = camera x (right), y (down), z (forward)
  const C = new THREE.Vector3(...cam.center);
  const ax = i => new THREE.Vector3(Rc[i], Rc[3 + i], Rc[6 + i]);
  const cx = ax(0), cy = ax(1), cz = ax(2);
  const [fx, fy, ppx, ppy] = cam.K, [W, H] = cam.size, D = 0.075;
  const corner = (u, vv) => C.clone().addScaledVector(cx, (u - ppx) / fx * D).addScaledVector(cy, (vv - ppy) / fy * D).addScaledVector(cz, D);
  const c00 = corner(0, 0), c10 = corner(W, 0), c11 = corner(W, H), c01 = corner(0, H);
  const frustum = new THREE.Group(); scene.add(frustum);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x0062d6, transparent: true, opacity: 0.8 });
  frustum.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([C, c00, C, c10, C, c11, C, c01, c00, c10, c10, c11, c11, c01, c01, c00]), lineMat));
  const video = document.createElement('video');
  video.src = url('splat/demo.mp4'); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  video.setAttribute('aria-label', 'The human demonstration video, synchronised with the 3D view');
  const pip = el('figure', 'splat-pip'); pip.append(video, el('figcaption', '', '<span class="lg">Input &middot; one human RGB video</span><span class="sm">Human video</span>'));
  stage.appendChild(pip);                                           // the same <video> also textures the 3D camera's image plane
  const vtex = new THREE.VideoTexture(video); vtex.colorSpace = THREE.SRGBColorSpace;
  const qg = new THREE.BufferGeometry();
  // the image as seen from behind the camera (FrontSide faces the camera centre's back), top-left pixel = c00
  qg.setAttribute('position', new THREE.Float32BufferAttribute([...c00.toArray(), ...c10.toArray(), ...c11.toArray(), ...c01.toArray()], 3));
  qg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  qg.setIndex([0, 2, 1, 0, 3, 2]);
  const screen = new THREE.Mesh(qg, new THREE.MeshBasicMaterial({ map: vtex, side: THREE.DoubleSide, transparent: true, opacity: 0.96, toneMapped: false }));
  frustum.add(screen);
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.008), new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.5 }));
  camBody.position.copy(C).addScaledVector(cz, -0.004);
  camBody.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cx, cy, cz)); frustum.add(camBody);

  // hand skeleton
  const hand = new THREE.Group(); scene.add(hand);
  const handMat = new THREE.MeshStandardMaterial({ color: HAND_COLOR, emissive: HAND_COLOR, emissiveIntensity: 0.35, roughness: 0.4, transparent: true, opacity: 0.95 });
  const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0042, 12, 8), handMat, 21);
  const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 8, 1), handMat, BONES.length);
  hand.add(joints, bones);
  const KP = P.hand.map(h => h ? Array.from({ length: 21 }, (_, j) => new THREE.Vector3(h[3 * j], h[3 * j + 1], h[3 * j + 2])) : null);

  // cousins: textured meshes in the demo_mug body frame, carried like the scanned mug
  const usd2mug = new THREE.Matrix4().fromArray(P.usd_to_mug).transpose();
  const cousinHolder = new THREE.Group(); scene.add(cousinHolder);
  const cousinCache = new Map();
  async function cousinMesh(id) {
    if (!cousinCache.has(id)) cousinCache.set(id, getObject(objectPath(id), { shadows: false }).then(o => {
      const g = new THREE.Group(); o.matrixAutoUpdate = false; o.matrix.copy(usd2mug); g.add(o); return g; }));
    return cousinCache.get(id);
  }

  // ── controls UI ──
  const bar = el('div', 'demo-bar');
  const play = el('button', 'dbtn ghost', '');
  const range = el('input', 'drange'); range.type = 'range'; range.min = 0; range.max = 1000; range.value = 0;
  range.setAttribute('aria-label', 'Time in the human video');
  const lab = el('span', 'dlabel splat-t');
  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Mug');
  const bScan = el('button', '', 'Scanned mug'), bCous = el('button', '', 'Cousins');
  seg.append(bScan, bCous);
  const segCol = el('div', 'seg'); segCol.setAttribute('role', 'group'); segCol.setAttribute('aria-label', 'Colour');
  const bRgb = el('button', '', 'RGB'), bDino = el('button', '', 'DINOv3');
  segCol.append(bRgb, bDino);
  const seg2 = el('div', 'seg'); seg2.setAttribute('role', 'group'); seg2.setAttribute('aria-label', 'Overlays');
  const bHand = el('button', '', 'Hand'), bCam = el('button', '', 'Camera');
  seg2.append(bHand, bCam);
  const gTime = el('div', 'splat-time'), gOpts = el('div', 'splat-opts');
  gTime.append(play, range, lab); gOpts.append(seg, segCol, seg2);
  bar.append(gTime, gOpts);
  root.appendChild(bar);

  const hudTL = el('div', 'demo-hud tl');
  const scanHud = el('span', 'hud dot'); hudTL.append(scanHud);
  const hudBL = el('div', 'demo-hud bl'); const objHud = el('span', 'hud dot'); objHud.style.setProperty('--c', '#00a3e0');
  hudBL.append(objHud);
  const hudBR = el('div', 'demo-hud br'); const frameHud = el('span', 'hud'); hudBR.append(frameHud);
  stage.append(hudTL, hudBL, hudBR);

  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';

  const st = { playing: !reducedMotion(), t: 0, mode: 'scan', cousin: 0, showHand: true, showCam: true, scrubbing: false, colour: 'rgb',
               visible: false, swapT: 1, lastLoopT: 0 };
  function setPressed(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function refreshUI() {
    play.innerHTML = (st.playing ? ICON_PAUSE + 'Pause' : ICON_PLAY + 'Play');
    play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    setPressed(bScan, st.mode === 'scan'); setPressed(bCous, st.mode === 'cousins');
    setPressed(bHand, st.showHand); setPressed(bCam, st.showCam);
    setPressed(bRgb, st.colour === 'rgb'); setPressed(bDino, st.colour === 'dino');
    scanHud.innerHTML = st.colour === 'dino' ? '<b>DINOv3 features</b> <span class="mut">&middot; first 3 principal components</span>'
      : '<b>Real scan</b> <span class="mut">&middot; Gaussian splats</span>';
    objHud.innerHTML = st.mode === 'scan' ? '<b>Scanned mug</b> <span class="mut">&middot; tracked path</span>'
      : `<b>Cousin ${st.cousin + 1} of ${P.cousins.length}</b> <span class="mut">&middot; ${st.colour === 'dino' ? 'textured mesh, RGB' : 'same path'}</span>`;
  }

  // ── time & video ──
  function syncVideo() {
    if (!st.visible) { video.pause(); return; }
    if (st.playing && !st.scrubbing) { const p = video.play(); if (p && p.catch) p.catch(() => { st.videoBlocked = true; }); }
    else video.pause();
  }
  play.onclick = () => { st.playing = !st.playing; refreshUI(); syncVideo(); };
  range.addEventListener('input', () => {
    st.scrubbing = true; video.pause();
    st.t = range.value / 1000 * T_END; if (video.readyState >= 1) video.currentTime = st.t;
  });
  const endScrub = () => { if (!st.scrubbing) return; st.scrubbing = false; syncVideo(); };
  range.addEventListener('change', endScrub); range.addEventListener('pointerup', endScrub); range.addEventListener('touchend', endScrub);

  async function showCousin(i) {
    st.cousin = (i + P.cousins.length) % P.cousins.length;
    const g = await cousinMesh(P.cousins[st.cousin]);
    if (st.mode !== 'cousins') return;
    cousinHolder.clear(); cousinHolder.add(g); st.swapT = 0; refreshUI();
  }
  bScan.onclick = () => { st.mode = 'scan'; cousinHolder.clear(); refreshUI(); };
  // colour: the scanned splats as captured, or their distilled DINOv3 features (the cousin meshes keep their textures)
  const colourers = Promise.all([featureColours(machine, 'scene'), featureColours(mug, 'mug')])
    .catch(e => { console.warn('DINOv3 colours unavailable', e); bDino.disabled = true; return null; });
  async function setColour(k) {
    st.colour = k; refreshUI();
    const c = await colourers;
    if (c && st.colour === k) c.forEach(f => f(k));
  }
  bRgb.onclick = () => setColour('rgb'); bDino.onclick = () => setColour('dino');
  bCous.onclick = () => { if (st.mode === 'cousins') { showCousin(st.cousin + 1); return; } st.mode = 'cousins'; refreshUI(); showCousin(st.cousin); };
  bHand.onclick = () => { st.showHand = !st.showHand; refreshUI(); };
  bCam.onclick = () => { st.showCam = !st.showCam; refreshUI(); };
  // stop the slow auto-orbit as soon as the visitor takes the camera
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  refreshUI();

  // pause video when off screen (the viewer pauses its own loop)
  new IntersectionObserver(es => { st.visible = es[0].isIntersecting; syncVideo(); }, { threshold: 0.05 }).observe(stage);

  // fit the camera distance to the stage aspect until the visitor moves it (portrait phones need more distance)
  const baseDir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const baseDist = baseDir.length(); baseDir.normalize();
  const baseTarget = controls.target.clone();
  v.onResize = (w, h) => {
    if (st.touched) return;
    const a = w / h, u = Math.min(1, Math.max(0, (1.2 - a) / 0.4));   // 0 on landscape, 1 on a 4:5 portrait stage
    controls.target.copy(baseTarget).add(new THREE.Vector3(-0.02 * u, 0, 0.035 * u));
    camera.position.copy(controls.target).addScaledVector(baseDir, baseDist * (1 + 0.32 * u));
  };
  controls.addEventListener('start', () => { st.touched = true; });
  v.onResize(...v.size);

  // ── per-frame update ──
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
  function poseAt(t, outP, outQ) {
    const f = Math.min(N - 1, Math.max(0, t * fps)), i = Math.min(N - 2, Math.floor(f)), a = f - i;
    outP.lerpVectors(pos[i], pos[i + 1], a); outQ.slerpQuaternions(quat[i], quat[i + 1], a);
  }
  function handAt(t) {
    const f = Math.min(N - 1, Math.max(0, t * fps)), i = Math.floor(f), a = f - i;
    const A = KP[i], B = KP[Math.min(N - 1, i + 1)];
    if (A && B) return A.map((p, j) => p.clone().lerp(B[j], a));
    return A || (a > 0.5 ? B : null);
  }
  v.add(dt => {
    if (st.playing && !st.scrubbing) {
      if (!video.paused && video.readyState >= 2) st.t = Math.min(T_END, video.currentTime);
      else st.t = (st.t + dt) % (T_END + 0.07);
    }
    // a new loop in cousin mode brings the next cousin
    if (st.t + 0.5 < st.lastLoopT && st.mode === 'cousins') showCousin(st.cousin + 1);
    st.lastLoopT = st.t;
    const t = Math.min(T_END, st.t);
    if (!st.scrubbing) range.value = Math.round(1000 * t / T_END);
    const fr = Math.round(t * fps);
    lab.textContent = `${t.toFixed(1)} s`;
    frameHud.innerHTML = `Video frame <b>${String(fr).padStart(3, '0')}</b><span class="mut"> / ${N - 1}</span>`;

    const p = mug.position, q = mug.quaternion;
    poseAt(t, p, q);
    mug.visible = st.mode === 'scan';
    cousinHolder.position.copy(p); cousinHolder.quaternion.copy(q);
    st.swapT = Math.min(1, st.swapT + dt * 2.2);
    const x = st.swapT - 1, back = 1 + 2.2 * x * x * x + 1.2 * x * x;            // ease-out-back: a small pop on swap
    cousinHolder.scale.setScalar(st.mode === 'cousins' ? 0.35 + 0.65 * back : 1);
    mugShadow.position.x = p.x; mugShadow.position.y = p.y;
    const hgt = Math.max(0, p.z - 0.045);
    mugShadow.material.opacity = 0.75 * Math.exp(-hgt / 0.06); mugShadow.scale.setScalar(1 + hgt * 4);

    path.mat.uniforms.uP.value = t / T_END;
    head.position.copy(p);

    frustum.visible = st.showCam;
    const kp = st.showHand ? handAt(t) : null;
    hand.visible = !!kp;
    if (kp) {
      for (let j = 0; j < 21; j++) { m4.makeTranslation(kp[j].x, kp[j].y, kp[j].z); joints.setMatrixAt(j, m4); }
      BONES.forEach(([a, b], k) => {
        tmpV.subVectors(kp[b], kp[a]); const L = tmpV.length();
        tmpQ.setFromUnitVectors(up, tmpV.normalize());
        m4.compose(kp[a].clone().lerp(kp[b], 0.5), tmpQ, new THREE.Vector3(1, L, 1)); bones.setMatrixAt(k, m4);
      });
      joints.instanceMatrix.needsUpdate = true; bones.instanceMatrix.needsUpdate = true;
    }
  });

  onTheme(dark => {
    const u = table.material.uniforms;
    u.uColor.value.set(dark ? 0x2a3d5e : 0x9fb3d1); u.uGrid.value.set(dark ? 0x5ac8fa : 0x4f78b5); u.uAlpha.value = dark ? 0.55 : 0.5;
    lineMat.color.set(dark ? 0x5ac8fa : 0x0062d6);
    path.mat.uniforms.uA.value.set(dark ? 0x2997ff : 0x0062d6); path.mat.uniforms.uB.value.set(dark ? 0x64d2ff : 0x00c2ff);
    dots.material.color.set(dark ? 0x5ac8fa : 0x2f92ff);
    cmShadow.material.opacity = dark ? 0.8 : 0.55;
  });

  // wait for the two splats and the first video frame, then reveal
  const videoReady = new Promise(res => {
    if (video.readyState >= 2) res(); else { video.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 6000); }
  }).then(tick);
  await Promise.all([machine.initialized, mug.initialized, videoReady]);
  load.done();
  v.start();
  if (poster) { requestAnimationFrame(() => { poster.classList.add('gone'); setTimeout(() => poster.remove(), 600); }); }
  syncVideo();
  root.__demo = { v, st };                                          // handle for automated screenshots
  return v;
}
