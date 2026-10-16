// Camera alignment: the one real frame of the xArm7 at its home pose, and the simulated robot rendered at the same
// home pose from the initial and from the optimized camera (the images behind the paper's camera-optimization
// figure). Drag the divider to wipe between the real frame and the render, or overlay the render at half opacity.
const HERE = new URL('./', import.meta.url);
const GRIPPER = { x: 0.57, y: 0.30 };         // gripper in the real frame (fractions), the zoom target

const CSS = `
.cam-stage{cursor:ew-resize; outline:none; background:#000}
.cam-stage:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.cam-view{position:absolute; inset:0; transform-origin:${GRIPPER.x * 100}% ${GRIPPER.y * 100}%; transition:transform .45s ease}
.cam-view.zoom{transform:scale(2.3)}
.cam-view img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; user-select:none}
.cam-sim{clip-path:inset(0 0 0 var(--wipe,50%))}
.cam-stage.over .cam-sim{clip-path:none; opacity:.5}
.cam-line{position:absolute; top:0; bottom:0; left:var(--line,50%); transition:left .45s ease; width:2px; margin-left:-1px; background:#fff; z-index:2;
  box-shadow:0 0 0 1px rgba(0,0,0,.18); pointer-events:none}
.cam-knob{position:absolute; top:50%; left:50%; width:40px; height:40px; margin:-20px 0 0 -20px; border-radius:50%; background:#fff;
  box-shadow:0 4px 14px rgba(0,0,0,.35); display:grid; place-items:center}
.cam-knob svg{width:22px; height:22px; fill:none; stroke:#2e2d29; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.cam-stage.over .cam-line, .cam-stage.over .cam-side{display:none}
.cam-bar .drange{flex:1 1 140px}
.cam-stage .hud.dot{--c:var(--red)}
.cam-stage.ok .hud.dot{--c:var(--green)}
@media (max-width:620px){ .cam-knob{width:34px; height:34px; margin:-17px 0 0 -17px} }
@media (prefers-reduced-motion: reduce){ .cam-view, .cam-line{transition:none} }
.cam-stage.dragging .cam-line{transition:none}
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export function mount(root) {
  if (!document.getElementById('cam-css')) {
    const st = el('style'); st.id = 'cam-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  root.innerHTML = '';
  const stage = el('div', 'demo-stage keep cam-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'slider');
  stage.setAttribute('aria-label', 'Divider between the real frame and the simulated render');
  const view = el('div', 'cam-view');
  const real = el('img'); real.src = new URL('real.jpg', HERE); real.alt = 'Real camera frame of the xArm7 at its home pose.';
  const sim = el('img', 'cam-sim'); sim.alt = '';
  const imgs = { initial: new URL('initial.jpg', HERE).href, optimized: new URL('optimized.jpg', HERE).href };
  new Image().src = imgs.optimized;           // preload the second render
  view.append(real, sim);
  const line = el('div', 'cam-line', '<div class="cam-knob"><svg viewBox="0 0 24 24"><path d="M9 6l-5 6 5 6M15 6l5 6-5 6"/></svg></div>');
  const tl = el('div', 'demo-hud tl cam-side', '<span class="hud">Real frame</span>');
  const tr = el('div', 'demo-hud tr cam-side', '<span class="hud">Simulated robot</span>');
  const bl = el('div', 'demo-hud bl'); const status = el('span', 'hud dot'); bl.append(status);
  stage.append(view, line, tl, tr, bl);

  const bar = el('div', 'demo-bar cam-bar');
  const camSeg = el('div', 'seg', '<button data-v="initial">Initial camera</button><button data-v="optimized">Optimized camera</button>');
  const modeSeg = el('div', 'seg', '<button data-v="wipe">Wipe</button><button data-v="over">Overlay</button>');
  const zoom = el('button', 'dbtn ghost', 'Zoom on gripper');
  zoom.setAttribute('aria-pressed', 'false');
  const range = el('input', 'drange');
  Object.assign(range, { type: 'range', min: 0, max: 100, step: 1, value: 57 });
  range.setAttribute('aria-label', 'Divider position');
  bar.append(camSeg, modeSeg, zoom, range);
  root.append(stage, bar);

  const st = { cam: 'initial', mode: 'wipe', wipe: 57, zoom: false };
  function render() {
    sim.src = imgs[st.cam];
    stage.style.setProperty('--wipe', st.wipe + '%');
    const lx = st.zoom ? GRIPPER.x * 100 + (st.wipe - GRIPPER.x * 100) * 2.3 : st.wipe;   // the clip edge on screen
    stage.style.setProperty('--line', lx + '%');
    line.style.visibility = lx < 0 || lx > 100 ? 'hidden' : '';
    range.value = st.wipe;
    range.disabled = st.mode === 'over';
    stage.setAttribute('aria-valuenow', st.wipe);
    stage.classList.toggle('over', st.mode === 'over');
    stage.classList.toggle('ok', st.cam === 'optimized');
    view.classList.toggle('zoom', st.zoom);
    zoom.setAttribute('aria-pressed', st.zoom);
    zoom.textContent = st.zoom ? 'Full frame' : 'Zoom on gripper';
    status.innerHTML = st.cam === 'optimized' ? '<b>Optimized camera</b> <span class="mut">· render lines up</span>'
                                              : '<b>Initial camera</b> <span class="mut">· render is offset</span>';
    for (const b of camSeg.children) b.setAttribute('aria-pressed', b.dataset.v === st.cam);
    for (const b of modeSeg.children) b.setAttribute('aria-pressed', b.dataset.v === st.mode);
  }
  camSeg.addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v) { st.cam = v; render(); } });
  modeSeg.addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v) { st.mode = v; render(); } });
  zoom.addEventListener('click', () => { st.zoom = !st.zoom; render(); });
  range.addEventListener('input', () => { st.wipe = +range.value; render(); });

  // drag on the stage moves the divider (in zoom, the divider follows the zoomed image)
  const toWipe = e => {
    const r = stage.getBoundingClientRect();
    let u = (e.clientX - r.left) / r.width;
    if (st.zoom) u = GRIPPER.x + (u - GRIPPER.x) / 2.3;
    st.wipe = Math.round(Math.min(100, Math.max(0, u * 100)));
    if (st.mode === 'over') st.mode = 'wipe';
    render();
  };
  stage.addEventListener('pointerdown', e => { stage.classList.add('dragging'); toWipe(e); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointerup', () => stage.classList.remove('dragging'));
  stage.addEventListener('pointercancel', () => stage.classList.remove('dragging'));
  stage.addEventListener('pointermove', e => { if (stage.hasPointerCapture(e.pointerId)) toWipe(e); });
  stage.addEventListener('keydown', e => {
    const d = { ArrowLeft: -2, ArrowRight: 2 }[e.key];
    if (d) { st.wipe = Math.min(100, Math.max(0, st.wipe + d)); render(); e.preventDefault(); }
  });
  render();
}
