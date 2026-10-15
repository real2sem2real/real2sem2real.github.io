// Tracking scrubber: the human demonstration video with every tracker's silhouette drawn over each frame, and the
// per-frame mask IoU of each method against the SAM2 reference mask. The silhouettes and IoUs in data.json were
// re-rendered from each method's poses with the scoring code behind the paper's tracking table (their means equal the
// table), so this is the same measurement, frame by frame.
import { loadingOverlay, onTheme, reducedMotion } from '../core/viewer.js';

const HERE = new URL('./', import.meta.url);
const FRAME_SCALE = 1.5;                       // frames are 960x540, masks/polygons are in 640x360 pixels

const METHODS = {
  ours:   { label: 'Ours', sub: '', dash: [], width: 2.4 },
  warped: { label: 'WARPED', sub: '', dash: [], width: 1.8 },
  fp:     { label: 'FoundationPose', sub: 'monocular depth', dash: [7, 4], width: 1.8 },
  rsrd:   { label: 'RSRD', sub: 're-implemented', dash: [2, 3], width: 1.8 },
};
const ORDER = ['rsrd', 'fp', 'warped', 'ours'];                       // drawing order: ours on top
const OBJECTS = { mug: 'Mug', cm: 'Coffee machine' };
const ZOOM = { mug: { margin: 2.4, minW: 230 }, cm: { margin: 1.6, minW: 300 } };   // follow window: object size x margin

function palette(el, dark) {
  const cs = getComputedStyle(el);
  const v = (n, f) => (cs.getPropertyValue(n) || '').trim() || f;
  return {
    ours: v('--ours', '#c51d38'),
    warped: v('--orange', '#d98324'),
    fp: dark ? '#3cc4ad' : '#1a9a86',
    rsrd: dark ? '#a3abb8' : '#7d8592',
    ink: v('--ink', '#2e2d29'), muted: v('--muted', '#5d6370'), line: v('--line', '#cfdcef'),
  };
}

const CSS = `
.trk-stage{cursor:ew-resize; outline:none}
.trk-stage:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.trk-canvas{position:absolute; inset:0; width:100%; height:100%; display:block}
.trk-bar .drange{flex:1 1 180px}
.trk-segs{display:flex; gap:8px 10px; flex-wrap:wrap}
.trk-play{min-width:86px}
.trk-frame{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; min-width:62px; text-align:right}
.trk-chips{display:grid; grid-template-columns:repeat(var(--n,4), minmax(0,1fr)); border-top:1px solid var(--line)}
.trk-chip{font:inherit; text-align:left; background:transparent; border:0; border-left:1px solid var(--line); padding:10px 14px 11px;
  cursor:pointer; color:var(--ink); transition:background .2s, opacity .2s; min-width:0}
.trk-chip:first-child{border-left:0}
.trk-chip:hover{background:color-mix(in srgb, var(--line) 30%, transparent)}
.trk-chip[aria-pressed="false"]{opacity:.42}
.trk-chip .nm{display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.trk-chip .nm svg{flex:none; width:18px; height:8px}
.trk-chip .v{font-size:20px; font-weight:500; letter-spacing:-.02em; line-height:1.2; margin-top:3px; font-variant-numeric:tabular-nums}
.trk-chip .v small{font-size:11.5px; color:var(--muted); font-weight:400; letter-spacing:0; margin-left:4px}
.trk-chip .s{font-size:11px; color:var(--muted); line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.trk-chart{position:relative; height:150px; border-top:1px solid var(--line); cursor:ew-resize; touch-action:pan-y}
.trk-chart canvas{position:absolute; inset:0; width:100%; height:100%; display:block}
.trk-hint{transition:opacity .6s}
.trk-hint.gone{opacity:0}
@media (max-width:620px){
  .trk-chips{grid-template-columns:repeat(2, minmax(0,1fr))}
  .trk-chip:nth-child(3){border-left:0}
  .trk-chip:nth-child(n+3){border-top:1px solid var(--line)}
  .trk-chip{padding:8px 10px 9px}
  .trk-chip .v{font-size:17px}
  .trk-chart{height:124px}
  .trk-frame{display:none}
  .trk-segs{width:100%; flex-wrap:nowrap}
  .trk-segs .seg button{padding:6px 9px}
}`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

// delta-coded int polygons at 2x pixel precision -> one Path2D per frame in 640x360 pixel coordinates
function buildPath(polys) {
  const p = new Path2D();
  for (const d of polys) {
    let x = d[0], y = d[1];
    p.moveTo(x / 2, y / 2);
    for (let k = 2; k < d.length; k += 2) { x += d[k]; y += d[k + 1]; p.lineTo(x / 2, y / 2); }
    p.closePath();
  }
  return p;
}
function bbox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of polys) {
    let x = d[0], y = d[1];
    for (let k = 0; k < d.length; k += 2) {
      if (k) { x += d[k]; y += d[k + 1]; }
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0 / 2, y0 / 2, x1 / 2, y1 / 2];
}
const fmt = v => v.toFixed(3).replace(/^0/, '');

// per-frame zoom window (16:9, in 640x360 pixels) around the reference mask, smoothed over time so it glides
function zoomTrack(gt, W, H, { margin, minW }) {
  const n = gt.length, raw = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const b = gt[i].length ? bbox(gt[i]) : last;
    last = b || [0, 0, W, H];
    raw.push(last);
  }
  const g = (arr, s) => arr.map((_, i) => {                                 // gaussian smoothing, sigma s frames
    let a = 0, w = 0;
    for (let k = -3 * s; k <= 3 * s; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k)), ww = Math.exp(-k * k / (2 * s * s));
      a += arr[j] * ww; w += ww;
    }
    return a / w;
  });
  const cx = g(raw.map(b => (b[0] + b[2]) / 2), 4), cy = g(raw.map(b => (b[1] + b[3]) / 2), 4);
  const sz = g(raw.map(b => Math.max((b[2] - b[0]) * margin, (b[3] - b[1]) * margin * 16 / 9, minW)), 6);
  return cx.map((x, i) => {
    const w = Math.min(W, sz[i]), h = w * 9 / 16;
    return [Math.min(W - w, Math.max(0, x - w / 2)), Math.min(H - h, Math.max(0, cy[i] - h / 2)), w, h];
  });
}

export async function mount(root) {
  if (!document.getElementById('trk-css')) { const s = el('style'); s.id = 'trk-css'; s.textContent = CSS; document.head.appendChild(s); }
  let stage = root.querySelector('.demo-stage');
  if (!stage) { stage = el('div', 'demo-stage keep'); root.prepend(stage); }
  stage.classList.add('keep', 'trk-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'slider');
  stage.setAttribute('aria-label', 'Video frame. Drag sideways or use the arrow keys to scrub.');
  const poster = stage.querySelector('.demo-poster');
  const canvas = el('canvas', 'trk-canvas'); stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const hudTL = el('div', 'demo-hud tl', '<span class="hud"><b class="trk-f">Frame 0</b> <span class="mut trk-t">0.0 s</span></span>');
  const hudBL = el('div', 'demo-hud bl', '<span class="hud"><svg width="18" height="8" style="vertical-align:0;margin-right:6px"><line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 3"/></svg>SAM2 reference mask</span>');
  const hudTR = el('div', 'demo-hud tr', '<span class="hud trk-hint"><span class="mut">Drag to scrub</span></span>');
  stage.append(hudTL, hudBL, hudTR);
  const fEl = hudTL.querySelector('.trk-f'), tEl = hudTL.querySelector('.trk-t'), hint = hudTR.querySelector('.trk-hint');

  const bar = el('div', 'demo-bar trk-bar');
  const play = el('button', 'dbtn trk-play', '');
  play.type = 'button';
  const slider = el('input', 'drange'); slider.type = 'range'; slider.min = 0; slider.step = 1; slider.value = 0;
  slider.setAttribute('aria-label', 'Frame');
  const frameLbl = el('span', 'trk-frame');
  const objSeg = el('div', 'seg'); objSeg.setAttribute('role', 'group'); objSeg.setAttribute('aria-label', 'Object');
  const viewSeg = el('div', 'seg'); viewSeg.setAttribute('role', 'group'); viewSeg.setAttribute('aria-label', 'View');
  const segs = el('div', 'trk-segs'); segs.append(objSeg, viewSeg);
  bar.append(play, slider, frameLbl, segs);
  const chips = el('div', 'trk-chips');
  const chart = el('div', 'trk-chart'); const ccv = el('canvas'); chart.appendChild(ccv); const cctx = ccv.getContext('2d');
  chart.setAttribute('aria-hidden', 'true');
  const note = el('div', 'demo-note');
  note.innerHTML = 'Each outline is the object rendered at that method&rsquo;s estimated pose; the number is its mask IoU '
    + 'against the SAM2 mask in this frame. The silhouettes are re-rendered with the scoring code behind the tracking table, '
    + 'so the means match it. FoundationPose gets raw monocular metric depth (SpatialTrackerV2). RSRD was run on the mug only.'
    + (window.matchMedia && window.matchMedia('(hover: hover)').matches ? ' Hover a method to highlight it; click to hide it.' : ' Tap a method to hide it.');
  root.append(bar, chips, chart, note);

  const lo = loadingOverlay(stage, 'Loading video frames');
  let data;
  try {
    data = await (await fetch(new URL('data.json', HERE))).json();
  } catch (e) { lo.error('Could not load the tracking data.'); throw e; }
  const N = data.n, W = data.w, H = data.h;
  const frames = new Array(N);
  let loaded = 0;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise(res => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => { frames[i] = im; lo.set(++loaded / N); res(); }); };
    im.onerror = () => { lo.set(++loaded / N); res(); };
    im.src = new URL(`frames/${String(i).padStart(3, '0')}.webp`, HERE).href;
  })));
  lo.done();
  poster && poster.classList.add('gone');

  // per object: Path2D cache, zoom track
  const objs = {};
  for (const [k, o] of Object.entries(data.objects)) {
    objs[k] = {
      gt: o.gt.map(buildPath),
      methods: Object.fromEntries(Object.entries(o.methods).map(([m, v]) => [m, { ...v, paths: v.polys.map(buildPath) }])),
      zoom: zoomTrack(o.gt, W, H, ZOOM[k] || ZOOM.cm),
    };
  }

  const state = { obj: 'mug', f: 0, playing: false, zoom: true, zt: 1, on: { ours: true, warped: true, fp: true, rsrd: true }, focus: null };
  slider.max = N - 1;
  let colors = palette(root, false), dpr = 1, cw = 1, ch = 1, chw = 1, chh = 1;

  function setPressed(seg, val) { seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === val))); }
  for (const [k, lab] of Object.entries(OBJECTS)) if (data.objects[k]) {
    const b = el('button', '', lab); b.type = 'button'; b.dataset.v = k; objSeg.appendChild(b);
    b.onclick = () => { state.obj = k; setPressed(objSeg, k); buildChips(); draw(); drawChart(); };
  }
  if (objSeg.children.length < 2) objSeg.remove();
  for (const [k, lab] of [['zoom', 'Zoom in'], ['full', 'Full frame']]) {
    const b = el('button', '', lab); b.type = 'button'; b.dataset.v = k; viewSeg.appendChild(b);
    b.onclick = () => { state.zoom = k === 'zoom'; setPressed(viewSeg, k); animateZoom(); };
  }
  setPressed(objSeg, state.obj); setPressed(viewSeg, 'zoom');

  function swatch(m) {
    const d = METHODS[m].dash.join(' ');
    return `<svg viewBox="0 0 18 8"><line x1="1" y1="4" x2="17" y2="4" stroke="${colors[m]}" stroke-width="${m === 'ours' ? 3 : 2.2}" stroke-linecap="round"${d ? ` stroke-dasharray="${d}"` : ''}/></svg>`;
  }
  let chipEls = {};
  function buildChips() {
    chips.innerHTML = ''; chipEls = {};
    const ms = ['ours', 'warped', 'fp', 'rsrd'].filter(m => objs[state.obj].methods[m]);
    chips.style.setProperty('--n', ms.length);
    for (const m of ms) {
      const c = el('button', 'trk-chip');
      c.type = 'button';
      c.setAttribute('aria-pressed', String(state.on[m]));
      const mean = objs[state.obj].methods[m].mean;
      c.innerHTML = `<div class="nm">${swatch(m)}<span>${METHODS[m].label}</span></div>`
        + `<div class="v"><span class="cur">–</span><small>mean ${fmt(mean)}</small></div>`
        + `<div class="s">${METHODS[m].sub || '&nbsp;'}</div>`;
      c.onclick = () => { state.on[m] = !state.on[m]; c.setAttribute('aria-pressed', String(state.on[m])); draw(); drawChart(); };
      c.onpointerenter = e => { if (e.pointerType === 'mouse') { state.focus = m; draw(); drawChart(); } };
      c.onpointerleave = () => { if (state.focus) { state.focus = null; draw(); drawChart(); } };
      chipEls[m] = c.querySelector('.cur');
      chips.appendChild(c);
    }
    updateReadout();
  }
  function updateReadout() {
    const o = objs[state.obj];
    for (const [m, e] of Object.entries(chipEls)) e.textContent = fmt(o.methods[m].iou[state.f]);
    fEl.textContent = `Frame ${state.f}`;
    tEl.textContent = `${(state.f / data.fps).toFixed(1)} s`;
    frameLbl.textContent = `${state.f} / ${N - 1}`;
    slider.value = state.f;
    stage.setAttribute('aria-valuenow', state.f);
    stage.setAttribute('aria-valuetext', `Frame ${state.f} of ${N - 1}`);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = stage.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const rc = chart.getBoundingClientRect(); chw = Math.max(1, rc.width); chh = Math.max(1, rc.height);
    ccv.width = Math.round(chw * dpr); ccv.height = Math.round(chh * dpr);
    draw(); drawChart();
  }

  // view rect: lerp between the full frame and the smoothed follow window
  function viewRect() {
    const z = objs[state.obj].zoom[state.f], t = state.zt;
    const full = [0, 0, W, H];
    return full.map((v, i) => v + (z[i] - v) * t);
  }
  let zAnim = 0;
  function animateZoom() {
    const target = state.zoom ? 1 : 0, from = state.zt, t0 = performance.now(), dur = reducedMotion() ? 1 : 450;
    cancelAnimationFrame(zAnim);
    const step = now => {
      const u = Math.min(1, (now - t0) / dur), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      state.zt = from + (target - from) * e; draw();
      if (u < 1) zAnim = requestAnimationFrame(step);
    };
    zAnim = requestAnimationFrame(step);
  }

  function draw() {
    const img = frames[state.f];
    const [vx, vy, vw, vh] = viewRect();
    const s = cw / vw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, vx * FRAME_SCALE, vy * FRAME_SCALE, vw * FRAME_SCALE, vh * FRAME_SCALE, 0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -vx * dpr * s, -vy * dpr * s);
    const px = 1 / s;                                                    // one CSS pixel in mask pixels
    const o = objs[state.obj];
    for (const m of ORDER) {
      const mm = o.methods[m];
      if (!mm || !state.on[m]) continue;
      const dim = state.focus && state.focus !== m;
      const path = mm.paths[state.f];
      // fill only the highlighted method (or ours, faintly, when nothing is highlighted) so the outlines stay readable
      const fill = state.focus ? (state.focus === m ? 0.28 : 0) : (m === 'ours' ? 0.10 : 0);
      if (fill) { ctx.globalAlpha = fill; ctx.fillStyle = colors[m]; ctx.fill(path, 'evenodd'); }
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,.42)';
      ctx.lineWidth = (METHODS[m].width + 2) * px;
      ctx.stroke(path);
      ctx.setLineDash(METHODS[m].dash.map(v => v * px));
      ctx.strokeStyle = colors[m];
      ctx.lineWidth = METHODS[m].width * px;
      ctx.stroke(path);
    }
    // reference mask: dashed white over a dark halo
    ctx.globalAlpha = 1;
    const gp = o.gt[state.f];
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2.6 * px; ctx.stroke(gp);
    ctx.setLineDash([4 * px, 3 * px]); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3 * px; ctx.stroke(gp);
    ctx.setLineDash([]);
  }

  // IoU timeline
  const PAD = { l: 44, r: 12, t: 12, b: 22 };
  function drawChart() {
    const g = cctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, chw, chh);
    const x0 = PAD.l, x1 = chw - PAD.r, y0 = PAD.t, y1 = chh - PAD.b;
    const X = i => x0 + (x1 - x0) * i / (N - 1), Y = v => y1 - (y1 - y0) * v;
    g.font = '11px ' + getComputedStyle(root).fontFamily;
    g.fillStyle = colors.muted; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.strokeStyle = colors.line; g.lineWidth = 1;
    for (const v of [0, 0.5, 1]) {
      g.beginPath(); g.moveTo(x0, Math.round(Y(v)) + .5); g.lineTo(x1, Math.round(Y(v)) + .5); g.stroke();
      g.fillText(v.toFixed(1), x0 - 7, Y(v));
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const i of [0, 25, 50, 75, 100]) if (i < N) g.fillText(String(i), X(i), y1 + 6);
    g.save(); g.translate(9, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle';
    g.fillText('IoU', 0, 0); g.restore();
    const o = objs[state.obj];
    for (const m of ORDER) {
      const mm = o.methods[m]; if (!mm || !state.on[m]) continue;
      const dim = state.focus && state.focus !== m;
      g.globalAlpha = dim ? 0.2 : 1;
      g.strokeStyle = colors[m]; g.lineWidth = m === 'ours' ? 2.2 : 1.6; g.lineJoin = 'round';
      g.setLineDash(METHODS[m].dash);
      g.beginPath();
      mm.iou.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
    // cursor
    const cx = X(state.f);
    g.strokeStyle = colors.ink; g.globalAlpha = 0.35; g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(cx) + .5, y0 - 4); g.lineTo(Math.round(cx) + .5, y1); g.stroke();
    g.globalAlpha = 1;
    for (const m of ORDER) {
      const mm = o.methods[m]; if (!mm || !state.on[m]) continue;
      if (state.focus && state.focus !== m) continue;
      g.fillStyle = colors[m]; g.strokeStyle = getComputedStyle(root).getPropertyValue('--surface').trim() || '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, Y(mm.iou[state.f]), m === 'ours' ? 4 : 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  function setFrame(f, fromUser) {
    f = Math.max(0, Math.min(N - 1, Math.round(f)));
    if (fromUser) { stopPlay(); hint.classList.add('gone'); }
    if (f === state.f) return;
    state.f = f; updateReadout(); draw(); drawChart();
  }

  // playback at the video's own 10 fps, looping
  let raf = 0, acc = 0, last = 0;
  const playIcon = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>Play', pauseIcon = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>Pause';
  play.innerHTML = playIcon;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = last ? (now - last) / 1000 : 0; last = now; acc += dt * data.fps;
    if (acc >= 1) { const k = Math.floor(acc); acc -= k; state.f = (state.f + k) % N; updateReadout(); draw(); drawChart(); }
  }
  function startPlay() { if (state.playing) return; state.playing = true; play.innerHTML = pauseIcon; last = 0; acc = 0; if (state.f >= N - 1) state.f = 0; raf = requestAnimationFrame(tick); }
  function stopPlay() { if (!state.playing) return; state.playing = false; play.innerHTML = playIcon; cancelAnimationFrame(raf); raf = 0; }
  play.onclick = () => { hint.classList.add('gone'); state.playing ? stopPlay() : startPlay(); };
  slider.oninput = () => setFrame(+slider.value, true);

  // drag-to-scrub on the frame (sideways) and on the chart (absolute)
  function dragScrub(target, absolute) {
    let id = null, sx = 0, sf = 0;
    target.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      id = e.pointerId; sx = e.clientX; sf = state.f;
      if (absolute) { const r = target.getBoundingClientRect(); setFrame((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r) * (N - 1), true); }
      else stopPlay();
      if (e.pointerType === 'mouse') target.setPointerCapture(id);
    });
    target.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const r = target.getBoundingClientRect();
      if (absolute) setFrame((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r) * (N - 1), true);
      else if (Math.abs(e.clientX - sx) > 2) setFrame(sf + (e.clientX - sx) / r.width * (N - 1) * 1.15, true);
    });
    const end = e => { if (e.pointerId === id) id = null; };
    target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  }
  dragScrub(stage, false);
  dragScrub(chart, true);
  stage.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') { setFrame(state.f + step, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setFrame(state.f - step, true); e.preventDefault(); }
    else if (e.key === 'Home') { setFrame(0, true); e.preventDefault(); }
    else if (e.key === 'End') { setFrame(N - 1, true); e.preventDefault(); }
    else if (e.key === ' ') { state.playing ? stopPlay() : startPlay(); e.preventDefault(); }
  });

  // pause when scrolled away
  new IntersectionObserver(es => { if (!es[0].isIntersecting) stopPlay(); }).observe(stage);

  onTheme(dark => { colors = palette(root, dark); buildChips(); draw(); drawChart(); });
  new ResizeObserver(resize).observe(stage);
  new ResizeObserver(resize).observe(chart);
  resize();
}
