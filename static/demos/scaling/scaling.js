// Success against training-set size on xArm7 mug placement: every evaluation in the results tracker for the four
// training sets of the paper's data-scaling figure, with the paper's Wilson 95% intervals as bands. data.js is
// generated from the tracker, so the chart follows it. Drag across the plot (or use the slider) to read every series
// at one training-set size; the chips toggle series.
import DATA from './data.js';
import { h, s, log, lin, onResize, swatch, markerAt, injectCSS } from './charts.js';

const MARK = { teleop: 'circle', ours: 'diamond', r2r2r: 'square' };
const SHORT = { 'teleop:true': ['Teleop', '4 mugs × 4 machines'], 'ours:true': ['R2Sem2R', 'cousins'],
                'teleop:false': ['Teleop', '1 mug × 1 machine'], 'r2r2r:false': ['R2R2R+', '1 mug × 1 machine'] };
const TELEOP_MAX = 150;                       // the largest teleoperated set

injectCSS('sc-css', `
.sc-wrap{padding:14px 12px 4px 4px}
.sc-x{font-size:12.5px; font-weight:600; font-variant-numeric:tabular-nums; min-width:96px}
.sc-bar .drange{flex:1 1 120px}
`);

export function mount(el) {
  el.innerHTML = '';
  const series = DATA.series.map(d => ({ ...d, key: `${d.method}:${d.several}`, on: true }));
  const xs = [...new Set(series.flatMap(d => d.points.map(p => p.episodes)))].sort((a, b) => a - b);
  let sel = xs.indexOf(TELEOP_MAX) >= 0 ? xs.indexOf(TELEOP_MAX) : xs.length - 1;

  const plot = h('div', { class: 'rc-plot sc-plot', role: 'img',
    'aria-label': 'Line chart of xArm7 placement success against the number of training episodes, log scale, for four training sets.' });
  const wrap = h('div', { class: 'sc-wrap' }, plot);

  const chips = h('div', { class: 'rc-chips', style: `--n:${series.length}` });
  for (const d of series) {
    const [nm, sub] = SHORT[d.key];
    d.chip = h('button', { class: 'rc-chip', 'aria-pressed': 'true', title: `Show or hide ${d.label}`,
      onclick: () => { d.on = !d.on; d.chip.setAttribute('aria-pressed', d.on); draw(); } }, [
      h('div', { class: 'nm' }, [swatch(d.method, { dashed: !d.several, hollow: !d.several, marker: MARK[d.method] }),
                                 h('span', { text: nm })]),
      h('div', { class: 'obj', text: sub }),
      d.v = h('div', { class: 'v' }), d.sub = h('div', { class: 'sub' })]);
    chips.append(d.chip);
  }

  const range = h('input', { type: 'range', class: 'drange', min: 0, max: xs.length - 1, step: 1, value: sel,
                             'aria-label': 'Training episodes' });
  const xlab = h('span', { class: 'sc-x' });
  range.addEventListener('input', () => { sel = +range.value; draw(); });
  const bar = h('div', { class: 'demo-bar sc-bar' }, [xlab, range]);
  el.append(wrap, chips, bar);

  let W = 0;
  function draw() {
    if (!W) return;
    const narrow = W < 520;
    const H = Math.round(Math.min(340, Math.max(230, W * 0.46)));
    const m = { l: 40, r: narrow ? 34 : 42, t: 20, b: 40 };
    const X = log(38, 2900, m.l, W - m.r), Y = lin(0, 100, H - m.b, m.t);
    plot.innerHTML = '';
    const sv = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
    for (const v of [0, 25, 50, 75, 100]) {
      s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v ? 'grid' : 'axis' }, sv);
      s('text', { x: m.l - 7, y: Y(v) + 4, 'text-anchor': 'end' }, sv).textContent = `${v}%`;
    }
    const ticks = narrow ? [50, 150, 660, 2000] : xs;
    for (const t of ticks) {
      s('line', { x1: X(t), x2: X(t), y1: H - m.b, y2: H - m.b + 4, class: 'axis' }, sv);
      s('text', { x: X(t), y: H - m.b + 17, 'text-anchor': 'middle' }, sv).textContent = t.toLocaleString('en-US');
    }
    s('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, sv).textContent = 'Training episodes (log scale)';
    s('line', { x1: X(TELEOP_MAX), x2: X(TELEOP_MAX), y1: Y(100), y2: H - m.b, class: 'guide' }, sv);
    s('text', { x: X(TELEOP_MAX) + 5, y: m.t - 6 }, sv).textContent = 'largest teleop set';

    const vis = series.filter(d => d.on);
    for (const d of vis) {          // Wilson bands first, under every line
      const p = d.points;
      const path = p.map((q, i) => `${i ? 'L' : 'M'}${X(q.episodes)} ${Y(q.hi)}`).join('') +
                   p.slice().reverse().map(q => `L${X(q.episodes)} ${Y(q.lo)}`).join('') + 'Z';
      s('path', { d: path, style: `fill:var(--${d.method}); fill-opacity:.11` }, sv);
    }
    const cx = X(xs[sel]);
    s('line', { x1: cx, x2: cx, y1: m.t - 2, y2: H - m.b, class: 'cross' }, sv);
    for (const d of vis) {
      const p = d.points;
      s('path', { d: p.map((q, i) => `${i ? 'L' : 'M'}${X(q.episodes)} ${Y(q.pct)}`).join(''), fill: 'none',
                  style: `stroke:var(--${d.method})`, 'stroke-width': 2, 'stroke-linejoin': 'round',
                  'stroke-dasharray': d.several ? null : '5 4' }, sv);
      for (const q of p) markerAt(sv, MARK[d.method], X(q.episodes), Y(q.pct), q.episodes === xs[sel] ? 5.5 : 4,
                                  d.method, !d.several);
      const last = p[p.length - 1];  // direct label at the end of each series
      s('text', { x: X(last.episodes) + 9, y: Y(last.pct) + 4, class: 'ink' }, sv).textContent = `${last.pct}%`;
    }
    // drag anywhere on the plot to move the crosshair to the nearest evaluated size
    const hit = s('rect', { x: m.l, y: 0, width: W - m.l - m.r + 20, height: H - m.b + 6, class: 'hit' }, sv);
    const pick = e => {
      const r = sv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width;
      let best = 0;
      xs.forEach((v, i) => { if (Math.abs(X(v) - x) < Math.abs(X(xs[best]) - x)) best = i; });
      if (best !== sel) { sel = best; range.value = sel; draw(); }
    };
    hit.addEventListener('pointerdown', e => { pick(e); hit.setPointerCapture(e.pointerId); });
    hit.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || hit.hasPointerCapture(e.pointerId)) pick(e); });
    plot.append(sv);

    const x = xs[sel];
    xlab.textContent = `${x.toLocaleString('en-US')} episodes`;   // the range input carries the label
    for (const d of series) {
      const q = d.points.find(p => p.episodes === x);
      if (q) {
        d.v.innerHTML = `${q.pct}%<small>${q.k}/${q.n}</small>`;
        d.sub.textContent = `95% CI ${Math.round(q.lo)}–${Math.round(q.hi)}%`;
      } else {
        d.v.innerHTML = '–';
        d.sub.textContent = d.method === 'teleop' ? `not collected beyond ${TELEOP_MAX}` : 'not evaluated';
      }
    }
  }
  onResize(plot, w => { W = w; draw(); });
}
