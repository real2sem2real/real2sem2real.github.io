// What the data costs: demonstrations produced against wall-clock time, with the model and rates of the paper's
// throughput figure (results/make_figures.py): teleoperation 35.1 s per demonstration per operator; R2R2R+ and R2Sem2R
// a one-time 10-minute setup, then 1.3 s and 1.5 s per episode per GPU. Set operators, GPUs and a time, or drag on
// the plot; the chips read off the number of completed demonstrations at that time.
import { h, s, log, onResize, swatch, injectCSS, fmt } from '../scaling/charts.js';

const TELEOP_S = 35.1, R2R2R_S = 1.3, OURS_S = 1.5, SETUP_S = 600;
const T0 = 60, T1 = 86400, Y0 = 1, Y1 = 1e7;
const GUIDES = [[600, '10 min', '10 min'], [3600, '1 hour', '1 h'], [43200, '12 hours', '12 h']];

const LINES = [
  { id: 'teleop', name: 'Teleop', count: (t, st) => st.ops * t / TELEOP_S,
    desc: st => `${st.ops} operator${st.ops > 1 ? 's' : ''} · ${TELEOP_S} s per demo` },
  { id: 'r2r2r', name: 'R2R2R+', count: (t, st) => st.gpus * Math.max(0, t - SETUP_S) / R2R2R_S,
    desc: st => `${st.gpus} GPU${st.gpus > 1 ? 's' : ''} · ${R2R2R_S} s per episode` },
  { id: 'ours', name: 'R2Sem2R', count: (t, st) => st.gpus * Math.max(0, t - SETUP_S) / OURS_S,
    desc: st => `${st.gpus} GPU${st.gpus > 1 ? 's' : ''} · ${OURS_S} s per episode` },
];

injectCSS('cost-css', `
.cost-wrap{padding:14px 12px 4px 4px}
.cost-ctl{display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:4px 18px; padding:12px 16px; border-top:1px solid var(--line)}
.cost-ctl label{display:flex; flex-direction:column; gap:2px; min-width:0}
.cost-ctl .top{display:flex; justify-content:space-between; gap:8px; font-size:12px; color:var(--muted)}
.cost-ctl .top b{color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums}
.cost-ctl .drange{flex:none; width:100%; min-width:0}
@media (max-width:620px){
  .cost-ctl{grid-template-columns:1fr; padding:10px 12px}
  .cost-chips{grid-template-columns:repeat(3, minmax(0,1fr))}
  .cost-chips .rc-chip:nth-child(3){border-left:1px solid var(--line)}
  .cost-chips .rc-chip:nth-child(n+3){border-top:0}
}
`);

// 0..100 slider <-> 1..100 on a log scale; time slider 0..1000 <-> 1 min .. 24 h on a log scale
const countOf = v => Math.round(Math.pow(10, v / 50));
const sliderOfCount = n => Math.round(50 * Math.log10(n));
const timeOf = v => T0 * Math.pow(T1 / T0, v / 1000);
const sliderOfTime = t => Math.round(1000 * Math.log(t / T0) / Math.log(T1 / T0));
function dur(t) {
  if (t < 3600) return `${Math.round(t / 60)} min`;
  const hh = Math.floor(t / 3600), mm = Math.round((t - hh * 3600) / 60);
  return mm === 60 ? `${hh + 1} h` : mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export function mount(el) {
  el.innerHTML = '';
  const st = { ops: 1, gpus: 1, t: 2 * 3600 };
  const plot = h('div', { class: 'rc-plot', role: 'img',
    'aria-label': 'Log-log chart of demonstrations produced against wall-clock time for teleoperation, R2R2R+ and R2Sem2R.' });
  const chips = h('div', { class: 'rc-chips cost-chips', style: '--n:3' });
  const ui = LINES.map(L => {
    const u = { L, v: h('div', { class: 'v' }), sub: h('div', { class: 'sub' }) };
    chips.append(h('div', { class: 'rc-chip' }, [
      h('div', { class: 'nm' }, [swatch(L.id, { marker: 'none' }), h('span', { text: L.name })]), u.v, u.sub]));
    return u;
  });
  const slider = (label, min, max, value, onInput) => {
    const r = h('input', { type: 'range', class: 'drange', min, max, step: 1, value, 'aria-label': label });
    const b = h('b');
    r.addEventListener('input', () => { onInput(+r.value); draw(); });
    return { r, b, node: h('label', {}, [h('span', { class: 'top' }, [h('span', { text: label }), b]), r]) };
  };
  const sOps = slider('Teleoperators', 0, 100, sliderOfCount(st.ops), v => { st.ops = countOf(v); });
  const sGpu = slider('GPUs', 0, 100, sliderOfCount(st.gpus), v => { st.gpus = countOf(v); });
  const sT = slider('Wall-clock time', 0, 1000, sliderOfTime(st.t), v => { st.t = timeOf(v); });
  const ctl = h('div', { class: 'cost-ctl' }, [sOps.node, sGpu.node, sT.node]);
  el.append(h('div', { class: 'cost-wrap' }, plot), chips, ctl);

  let W = 0;
  function draw() {
    if (!W) return;
    const narrow = W < 520;
    const H = Math.round(Math.min(330, Math.max(230, W * 0.44)));
    const m = { l: narrow ? 40 : 46, r: 14, t: 26, b: 40 };
    const X = log(T0, T1, m.l, W - m.r), Y = log(Y0, Y1, H - m.b, m.t);
    plot.innerHTML = '';
    const sv = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
    for (let e = 0; e <= 7; e++) {
      const v = Math.pow(10, e);
      s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: e ? 'grid' : 'axis' }, sv);
      if (!narrow || e % 2 === 0)
        s('text', { x: m.l - 7, y: Y(v) + 4, 'text-anchor': 'end' }, sv).textContent = e < 4 ? fmt(v) : `10${'⁰¹²³⁴⁵⁶⁷'[e]}`;
    }
    for (const [t, lab, short] of [[60, '1 min', '1 min'], ...GUIDES, [86400, '24 h', '']]) {
      s('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: t === 60 ? 'axis' : 'guide' }, sv);
      const txt = narrow ? short : lab;       // phones: short labels, and 24 h would collide with 12 h
      if (txt) s('text', { x: X(t), y: H - m.b + 17, 'text-anchor': t === 60 ? 'start' : t === 86400 ? 'end' : 'middle' }, sv).textContent = txt;
    }
    s('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, sv).textContent = 'Wall-clock time (log scale)';
    s('text', { x: m.l - 7, y: m.t - 12 }, sv).textContent = 'Demonstrations (log scale)';
    const N = 160;
    for (const L of LINES) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const t = T0 * Math.pow(T1 / T0, i / N), c = L.count(t, st);
        if (c >= Y0) pts.push([X(t), Y(Math.min(c, Y1))]);
      }
      if (L.id !== 'teleop') {    // generation starts after the setup: begin the curve exactly where it reaches 1
        const tStart = SETUP_S + (L.id === 'r2r2r' ? R2R2R_S : OURS_S) / st.gpus;
        pts.unshift([X(tStart), Y(1)]);
      }
      s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(''), fill: 'none',
                  style: `stroke:var(--${L.id})`, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, sv);
    }
    const cx = X(st.t);
    s('line', { x1: cx, x2: cx, y1: m.t, y2: H - m.b, class: 'cross' }, sv);
    for (const L of LINES) {
      const c = L.count(st.t, st);
      if (c >= Y0) s('circle', { cx, cy: Y(Math.min(c, Y1)), r: 5, style: `fill:var(--${L.id}); stroke:var(--surface)`, 'stroke-width': 2 }, sv);
    }
    const hit = s('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H - m.b, class: 'hit' }, sv);
    const pick = e => {
      const r = sv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width;
      const u = Math.min(1, Math.max(0, (x - m.l) / (W - m.r - m.l)));
      st.t = T0 * Math.pow(T1 / T0, u); sT.r.value = sliderOfTime(st.t); draw();
    };
    hit.addEventListener('pointerdown', e => { pick(e); hit.setPointerCapture(e.pointerId); });
    hit.addEventListener('pointermove', e => { if (hit.hasPointerCapture(e.pointerId)) pick(e); });
    plot.append(sv);

    sOps.b.textContent = st.ops; sGpu.b.textContent = st.gpus; sT.b.textContent = dur(st.t);
    for (const { L, v, sub } of ui) {
      const c = Math.floor(L.count(st.t, st));
      v.innerHTML = L.id !== 'teleop' && st.t < SETUP_S ? '0<small>setting up</small>' : `${fmt(c)}<small>in ${dur(st.t)}</small>`;
      sub.textContent = L.desc(st);
    }
  }
  onResize(plot, w => { W = w; draw(); });
}
