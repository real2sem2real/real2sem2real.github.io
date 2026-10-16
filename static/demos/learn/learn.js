// "Watch it learn": real xArm7 rollouts of R2Sem2R (cousins) and R2R2R+ (the single demonstrated pair) at every
// training-set size of the data-scaling evaluation, side by side and in sync. Every number comes from the scaling
// chart's data.js (generated from the results tracker); the clips are listed in manifest.json, one success per policy
// and size from the evaluation videos of that checkpoint. The dot grid is the evaluator's count (k of n trials), not a
// per-trial record. Builds on rollouts.css for the players.
import DATA from '../scaling/data.js';
import { h, s, log, lin, onResize, markerAt, injectCSS } from '../scaling/charts.js';

const BASE = new URL('./', import.meta.url);
const METHODS = [['r2r2r', 'R2R2R+', 'one object pair', false], ['ours', 'R2Sem2R', 'digital cousins', true]];
const SPEEDS = [2, 4];
const HOLD = 1.4;
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';
const fmtN = n => n.toLocaleString('en-US');
const fmtT = t => { t = Math.max(0, t); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };

injectCSS('ln-css', `
.ln .ln-top{border-top:0; border-bottom:1px solid var(--line); align-items:center}
.ln-size{display:flex; align-items:center; gap:12px; flex:1 1 300px; min-width:0}
.ln-sl .drange{display:block; width:100%; margin:0}
.ln-n{font-size:20px; font-weight:500; letter-spacing:-.02em; font-variant-numeric:tabular-nums; min-width:86px}
.ln-n small{font-size:12px; color:var(--muted); font-weight:400; letter-spacing:0; margin-left:4px}
.ln-ticks{display:flex; justify-content:space-between; font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums;
  margin:4px -6px 0}
.ln-ticks button{font:inherit; background:none; border:0; color:inherit; padding:2px 0; cursor:pointer; min-width:28px}
.ln-ticks button[aria-pressed="true"]{color:var(--ink); font-weight:600}
.ln-sl{flex:1 1 auto; min-width:0}
.ln-res{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.05fr); gap:14px 18px; padding:12px 14px 14px;
  border-top:1px solid var(--line); align-items:start}
.ln-m .nm{display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12.5px; font-weight:600}
.ln-m .nm span{font-weight:400; color:var(--muted); font-variant-numeric:tabular-nums}
.ln-m .pc{font-size:22px; font-weight:500; letter-spacing:-.02em; font-variant-numeric:tabular-nums; margin:2px 0 6px}
.ln-dots{display:grid; grid-template-columns:repeat(25, minmax(0,1fr)); gap:3px; max-width:300px}
.ln-dots i{aspect-ratio:1; border-radius:50%; background:color-mix(in srgb, var(--line) 75%, transparent); transition:background .35s}
.ln-dots i.k{background:var(--c)}
.ln-spark{min-width:0}
.ln-spark .cap{font-size:12px; color:var(--muted); margin-bottom:2px}
.ln-spark svg{display:block; width:100%; overflow:visible}
.ln-spark text{font-family:var(--sans); font-size:11px; fill:var(--muted); font-variant-numeric:tabular-nums}
.ln-spark .grid{stroke:var(--line); stroke-width:1}
.ln-spark .cur{stroke:var(--ink); stroke-width:1; stroke-dasharray:2 3; opacity:.6}
@media (max-width:760px){ .ln-res{grid-template-columns:1fr 1fr} .ln-spark{grid-column:1 / -1} }
@media (max-width:620px){
  .ln-n{font-size:17px; min-width:74px}
  .ln-res{gap:12px 14px; padding:10px 12px 12px}
  .ln-m .pc{font-size:19px}
  .ln-ticks{font-size:11px}
  .ln-dots{grid-template-columns:repeat(10, minmax(0,1fr)); gap:4px}
  .ln-m .nm{flex-direction:column; align-items:flex-start; gap:1px}
}
@media (pointer:coarse){ .ln-ticks button{min-height:40px} }
`);

function ensureCss() {
  if (document.querySelector('link[data-ro-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../rollouts/rollouts.css', BASE).href; l.dataset.roCss = '1';
  document.head.appendChild(l);
}

export async function mount(el) {
  ensureCss();
  const manifest = await (await fetch(new URL('manifest.json', BASE))).json();
  const series = { ours: DATA.series.find(d => d.method === 'ours' && d.several), r2r2r: DATA.series.find(d => d.method === 'r2r2r') };
  const sizes = manifest.sizes.filter(z => METHODS.every(([m]) => series[m].points.some(p => p.episodes === z.episodes)));
  const point = (m, n) => series[m].points.find(p => p.episodes === n);
  const st = { i: sizes.length - 1, speed: 4, playing: true, loaded: false, visible: false, holdUntil: 0, scrubbing: false, wasPlaying: false };

  el.classList.add('ro', 'ln');
  el.innerHTML = `
    <div class="demo-bar ln-top">
      <div class="ln-size">
        <div class="ln-n" aria-live="polite"></div>
        <div class="ln-sl">
          <input class="drange ln-range" type="range" min="0" max="${sizes.length - 1}" step="1" value="${st.i}"
                 aria-label="Training-set size (episodes generated from the one video)">
          <div class="ln-ticks">${sizes.map((z, i) => `<button type="button" data-i="${i}" aria-label="${fmtN(z.episodes)} episodes">${z.episodes >= 1000 ? (z.episodes / 1000).toLocaleString('en-US') + 'k' : z.episodes}</button>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="ro-stage">${METHODS.map(([m, name, sub]) => `
      <figure class="ro-player" data-m="${m}">
        <div class="ro-frame">
          <video muted playsinline preload="none" disablepictureinpicture></video>
          <div class="demo-hud tl"><span class="hud dot" style="--c:var(--${m})"><b>${name}</b> <span class="mut">${sub}</span></span></div>
          <div class="demo-hud tr"><span class="hud ro-out s">Success</span></div>
          <div class="ro-prog" style="--c:var(--${m})"><i></i></div>
        </div>
      </figure>`).join('')}
    </div>
    <div class="demo-bar ro-ctrl">
      <button class="dbtn ro-play" type="button" aria-label="Pause">${PAUSE}</button>
      <input class="drange ro-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Scrub both videos">
      <span class="ro-time">0:00 / 0:00</span>
      <div class="seg ro-speed" role="group" aria-label="Playback speed">${SPEEDS.map(v => `<button type="button" data-s="${v}" aria-pressed="${v === st.speed}">${v}&times;</button>`).join('')}</div>
    </div>
    <div class="ln-res">${METHODS.map(([m, name]) => `
      <div class="ln-m" data-m="${m}"><div class="nm">${name}<span></span></div><div class="pc"></div>
        <div class="ln-dots" style="--c:var(--${m})" role="img"></div></div>`).join('')}
      <div class="ln-spark"><div class="cap">Real success against training-set size</div><div class="pl"></div></div>
    </div>
    <div class="demo-note"></div>`;

  const $ = q => el.querySelector(q);
  const players = METHODS.map(([m]) => {
    const fig = el.querySelector(`.ro-player[data-m="${m}"]`);
    return { m, fig, v: fig.querySelector('video'), bar: fig.querySelector('.ro-prog i'), dur: 1, src: '' };
  });
  const playBtn = $('.ro-play'), scrub = $('.ro-scrub'), time = $('.ro-time'), range = $('.ln-range');

  // ── the small chart: both curves (log x), the current size marked ──
  const spark = $('.ln-spark .pl');
  let sv = null;
  function drawSpark() {
    const W = Math.max(200, Math.round(spark.getBoundingClientRect().width)), H = 112, L = 30, R = 8, T = 6, B = 20;
    const xs = sizes.map(z => z.episodes), x = log(xs[0], xs[xs.length - 1], L, W - R), y = lin(0, 100, H - B, T);
    spark.innerHTML = '';
    sv = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, spark);
    for (const v of [0, 50, 100]) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }, sv);
      s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, sv).textContent = v + '%';
    }
    for (const n of [xs[0], xs[xs.length - 1]]) s('text', { x: x(n), y: H - 4, 'text-anchor': 'middle' }, sv).textContent = n >= 1000 ? (n / 1000) + 'k' : n;
    const n = sizes[st.i].episodes;
    s('line', { x1: x(n), x2: x(n), y1: T, y2: H - B, class: 'cur' }, sv);
    for (const [m, , , several] of METHODS) {
      const pts = series[m].points.filter(p => xs.includes(p.episodes));
      s('polyline', { points: pts.map(p => `${x(p.episodes)},${y(p.pct)}`).join(' '), fill: 'none', style: `stroke:var(--${m})`,
                      'stroke-width': 2, 'stroke-dasharray': several ? null : '4 3' }, sv);
      for (const p of pts) markerAt(sv, m === 'ours' ? 'diamond' : 'square', x(p.episodes), y(p.pct), p.episodes === n ? 5 : 3, m, !several && p.episodes !== n);
    }
  }
  onResize(spark, drawSpark);

  function renderSize() {
    const z = sizes[st.i], n = z.episodes;
    $('.ln-n').innerHTML = `${fmtN(n)}<small>episodes</small>`;
    range.value = String(st.i);
    el.querySelectorAll('.ln-ticks button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === st.i)));
    for (const [m, name] of METHODS) {
      const p = point(m, n), box = el.querySelector(`.ln-m[data-m="${m}"]`);
      box.querySelector('.nm span').textContent = `${p.k} of ${p.n} trials`;
      box.querySelector('.pc').textContent = `${p.pct}%`;
      const dots = box.querySelector('.ln-dots');
      dots.innerHTML = Array.from({ length: p.n }, (_, k) => `<i${k < p.k ? ' class="k"' : ''}></i>`).join('');
      dots.setAttribute('aria-label', `${name}: ${p.k} successes in ${p.n} real trials`);
    }
    drawSpark();
    const ours2k = n === 2000;
    $('.demo-note').innerHTML = `Both policies are trained on <b>${fmtN(n)}</b> episodes generated from the same human video
      (R2Sem2R: ${n === 660 ? '667' : fmtN(n)} episodes across cousin mugs and machines; R2R2R+: the demonstrated pair only).
      Each clip is <b>one successful trial</b> picked by us from that checkpoint's real evaluation videos, so the clips show what
      a success looks like, not how often it happens; the percentages and dots give the evaluator's count over every trial
      (a dot grid of k successes in n trials, not a record of individual trials).${ours2k ? ' The 2,000-episode R2Sem2R clip comes from a 2,000-episode checkpoint whose few recorded trials are not the evaluation behind the 90%.' : ''}
      Played in sync at ${st.speed}&times; speed.`;
  }

  const master = () => (players[0].dur >= players[1].dur ? players[0] : players[1]);
  const total = () => Math.max(players[0].dur, players[1].dur);
  function load() {
    players.forEach(p => { if (p.v.getAttribute('src') !== p.src) { p.v.src = p.src; p.v.load(); } p.v.playbackRate = st.speed; });
    st.loaded = true;
  }
  function unload() { players.forEach(p => { p.v.pause(); p.v.removeAttribute('src'); p.v.load(); }); st.loaded = false; }
  function setSize(i) {
    st.i = i; const z = sizes[i];
    players.forEach(p => {
      const c = z[p.m]; p.dur = c.dur; p.src = new URL(c.src, BASE).href;
      p.v.pause(); p.v.poster = new URL(c.poster, BASE).href; p.v.removeAttribute('src'); p.v.load();
      p.fig.classList.remove('done'); p.bar.style.width = '0%';
    });
    st.loaded = false; st.holdUntil = 0;
    renderSize(); setTime(0);
    if (st.visible) { load(); seekAll(0); if (st.playing) playAll(); }
  }
  function playAll() {
    st.playing = true; playBtn.innerHTML = PAUSE; playBtn.setAttribute('aria-label', 'Pause');
    if (!st.loaded) return;
    const t = master().v.currentTime || 0;
    players.forEach(p => { p.v.playbackRate = st.speed; if (t < p.dur - 0.05) p.v.play().catch(() => pauseAll()); });
  }
  function pauseAll() { st.playing = false; playBtn.innerHTML = PLAY; playBtn.setAttribute('aria-label', 'Play'); players.forEach(p => p.v.pause()); }
  function seekAll(t) {
    players.forEach(p => { try { p.v.currentTime = Math.min(t, Math.max(0, p.dur - 0.05)); } catch (e) { /* not loaded yet */ }
                           p.fig.classList.toggle('done', t >= p.dur - 0.06); });
  }
  function setTime(t) {
    const T = total();
    if (!st.scrubbing) scrub.value = String(Math.round(1000 * Math.min(1, t / T)));
    time.textContent = `${fmtT(t)} / ${fmtT(T)}`;
    players.forEach(p => { p.bar.style.width = (100 * Math.min(1, t / p.dur)).toFixed(2) + '%'; });
  }

  range.addEventListener('input', () => { if (+range.value !== st.i) setSize(+range.value); });
  el.querySelectorAll('.ln-ticks button').forEach(b => b.addEventListener('click', () => { if (+b.dataset.i !== st.i) setSize(+b.dataset.i); }));
  el.querySelectorAll('.ro-speed button').forEach(b => b.addEventListener('click', () => {
    st.speed = +b.dataset.s; el.querySelectorAll('.ro-speed button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    players.forEach(p => { p.v.playbackRate = st.speed; }); renderSize();
  }));
  playBtn.addEventListener('click', () => {
    if (st.playing) { pauseAll(); return; }
    if (!st.loaded) load();
    if (master().v.currentTime >= master().dur - 0.06) { seekAll(0); players.forEach(p => p.fig.classList.remove('done')); }
    st.holdUntil = 0; playAll();
  });
  scrub.addEventListener('input', () => {
    if (!st.scrubbing) { st.scrubbing = true; st.wasPlaying = st.playing; pauseAll(); }
    if (!st.loaded) load();
    const t = (+scrub.value / 1000) * total(); seekAll(t); setTime(t); st.holdUntil = 0;
  });
  scrub.addEventListener('change', () => { st.scrubbing = false; if (st.wasPlaying) playAll(); });

  // the longer clip drives the clock; the other follows and holds its last frame (as in the rollouts player)
  let raf = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!st.loaded) return;
    const M = master(), F = M === players[0] ? players[1] : players[0], t = M.v.currentTime || 0;
    if (!st.scrubbing) setTime(t);
    if (!st.playing) return;
    if (t >= F.dur - 0.05) { if (!F.v.paused) F.v.pause(); F.fig.classList.add('done'); }
    else {
      F.fig.classList.remove('done');
      const d = t - F.v.currentTime;
      if (Math.abs(d) > 0.6) { F.v.currentTime = t; F.v.playbackRate = st.speed; }
      else if (Math.abs(d) > 0.08) F.v.playbackRate = st.speed * (1 + Math.max(-0.25, Math.min(0.25, d)));
      else F.v.playbackRate = st.speed;
      if (F.v.paused && !M.v.paused) F.v.play().catch(() => {});
    }
    if (M.v.ended || t >= M.dur - 0.05) {
      M.fig.classList.add('done');
      if (!st.holdUntil) st.holdUntil = now + HOLD * 1000;
      else if (now >= st.holdUntil) { st.holdUntil = 0; seekAll(0); players.forEach(p => p.fig.classList.remove('done')); playAll(); }
    } else {
      M.fig.classList.remove('done');
      if (M.v.paused && !M.v.seeking && M.v.readyState >= 2) M.v.play().catch(() => pauseAll());
    }
  }
  const io = new IntersectionObserver(es => {
    const vis = es[0].isIntersecting;
    if (vis === st.visible) return;
    st.visible = vis;
    if (vis) { load(); seekAll(st.resumeAt || 0); if (st.playing) playAll(); if (!raf) raf = requestAnimationFrame(tick); }
    else { st.resumeAt = master().v.currentTime || 0; const keep = st.playing; unload(); st.playing = keep; cancelAnimationFrame(raf); raf = 0; }
  }, { rootMargin: '150px 0px' });
  io.observe(el);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) players.forEach(p => p.v.pause()); else if (st.visible && st.playing) playAll();
  });

  setSize(st.i);
}
