// Shared three.js stage for the interactive demos: a transparent WebGL canvas over the card's CSS background (so light
// and dark themes need no extra work), studio lighting with a soft shadow catcher, orbit controls, and a render loop
// that only runs while the stage is on screen and the tab is visible.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export { THREE };

export const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// Calls fn(dark) now and whenever the page theme toggles.
export function onTheme(fn) {
  fn(isDark());
  const mo = new MutationObserver(() => fn(isDark()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createViewer(stage, opts = {}) {
  const o = Object.assign({ fov: 32, near: 0.01, far: 50, shadows: true, ground: true, groundSize: 4, controls: true,
                            target: [0, 0, 0], position: [1.4, -1.2, 0.9], up: [0, 0, 1], maxDpr: 2, exposure: 1.0 }, opts);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = o.exposure;
  renderer.shadowMap.enabled = o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'demo-canvas';
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(o.fov, 1, o.near, o.far);
  camera.up.set(...o.up);
  camera.position.set(...o.position);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8d96a8, 1.1);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(1.2, -0.8, 2.4);
  key.castShadow = o.shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.0;
  key.shadow.camera.right = key.shadow.camera.top = 1.0;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 6;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01; key.shadow.radius = 5;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xcfe3ff, 0.7);
  rim.position.set(-1.5, 1.6, 1.2);
  scene.add(rim);

  let ground = null;
  if (o.ground) {
    ground = new THREE.Mesh(new THREE.PlaneGeometry(o.groundSize, o.groundSize),
                            new THREE.ShadowMaterial({ opacity: 0.22, transparent: true }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  let controls = null;
  if (o.controls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...o.target);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.3; controls.maxDistance = 4;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.rotateSpeed = 0.7;
    controls.update();
    // OrbitControls sets touch-action:none; let vertical swipes scroll the page on phones (horizontal drags still orbit)
    renderer.domElement.style.touchAction = 'pan-y';
  } else {
    camera.lookAt(...o.target);
  }

  const tickers = new Set();
  let running = false, visible = false, raf = 0, last = 0, w = 0, h = 0;
  const clock = { t: 0, dt: 0 };

  function resize() {
    const r = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    api.onResize && api.onResize(w, h);
  }
  const ro = new ResizeObserver(resize); ro.observe(stage);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    clock.dt = dt; clock.t += dt;
    for (const f of tickers) f(dt, clock.t);
    controls && controls.update();
    if (api.render) api.render(); else renderer.render(scene, camera);
  }
  function sync() {
    const want = running && visible && !document.hidden;
    if (want && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; sync(); }, { rootMargin: '120px' });
  io.observe(stage);
  document.addEventListener('visibilitychange', sync);

  const api = {
    THREE, renderer, scene, camera, controls, key, hemi, rim, ground, clock, stage,
    add(fn) { tickers.add(fn); return () => tickers.delete(fn); },
    start() { running = true; resize(); sync(); },
    stop() { running = false; sync(); },
    get size() { return [w, h]; },
    renderOnce() { controls && controls.update(); if (api.render) api.render(); else renderer.render(scene, camera); },
    // aim the shadow-casting key light at a point, with a frustum of half-size s
    fitShadow(center, s = 0.8) {
      key.target.position.copy(center);
      key.position.copy(center).add(new THREE.Vector3(1.0, -0.7, 2.2));
      key.shadow.camera.left = key.shadow.camera.bottom = -s;
      key.shadow.camera.right = key.shadow.camera.top = s;
      key.shadow.camera.updateProjectionMatrix();
    },
    dispose() {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      controls && controls.dispose(); renderer.dispose(); pmrem.dispose();
      renderer.domElement.remove();
    },
  };
  resize();
  return api;
}

// Smoothstep-style easing used across the demos.
export const ease = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
export const easeInOutCubic = u => { u = Math.min(1, Math.max(0, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };

// A row-major 4x4 (as stored in the JSON files) to a THREE.Matrix4.
export function mat4(rowMajor16) { return new THREE.Matrix4().fromArray(rowMajor16).transpose(); }

// Loading overlay with a progress bar; returns {set(frac, label), done()}.
export function loadingOverlay(stage, label = 'Loading') {
  const el = document.createElement('div');
  el.className = 'demo-load';
  el.innerHTML = '<div class="demo-load-in"><div class="demo-load-l"></div><div class="demo-load-bar"><i></i></div></div>';
  stage.appendChild(el);
  const l = el.querySelector('.demo-load-l'), bar = el.querySelector('i');
  l.textContent = label;
  return {
    set(frac, text) { bar.style.width = (100 * Math.max(0, Math.min(1, frac))).toFixed(1) + '%'; if (text) l.textContent = text; },
    done() { el.classList.add('gone'); setTimeout(() => el.remove(), 450); },
    error(text) { el.classList.add('err'); l.textContent = text; },
  };
}
