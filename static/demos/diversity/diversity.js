// Object diversity versus data source on mug placement, both robots: for teleoperation (150 demos) and generated data
// (2,000 episodes), success when training on the single demonstrated pair and on several objects. The same eight
// tracker rows as the paper's diversity figure (data.js is generated from the tracker). Each row is a dumbbell from
// one pair (hollow) to several objects (filled); the toggle shows one end at a time, and tapping a point reads it out.
import DATA from './data.js';
import { h, s, lin, onResize, markerAt, injectCSS } from '../scaling/charts.js';

const MARK = { teleop: 'circle', r2r2r: 'square', ours: 'diamond' };
const NAME = { teleop: 'Teleoperation', r2r2r: 'R2R2R', ours: 'R2Sem2R' };
const ROWS = [{ id: 'teleop', label: 'Teleoperation', sub: '150 demos' }, { id: 'gen', label: 'Generated', sub: '2k episodes' }];
const GROUP_TXT = { 'One pair': 'the demonstrated mug and machine', 'Several objects': 'several mugs and machines' };

injectCSS('dv-css', `
.dv-legend{display:flex; flex-wrap:wrap; gap:6px 16px; padding:14px 16px 0; font-size:12px; color:var(--muted)}
.dv-legend span{display:inline-flex; align-items:center; gap:6px}
.dv-panels{display:grid; grid-template-columns:1fr; gap:2px; padding:4px 16px 6px}
.dv-panel h4{margin:10px 0 0; font-size:13px; font-weight:600; color:var(--ink)}
.dv-plot .end{transition:opacity .35s}
.dv-plot .end.off{opacity:0}
.dv-plot .gain{transition:opacity .35s}
.dv-plot .gain.off{opacity:0}
.dv-plot .pt{cursor:pointer; outline:none}
.dv-plot .pt:focus-visible circle.ring, .dv-plot .pt.sel circle.ring{stroke:var(--ink); stroke-width:1.5}
.dv-plot .ci{stroke-linecap:round}
.dv-read{font-size:12.5px; color:var(--ink); padding:10px 16px; border-top:1px solid var(--line); min-height:44px; line-height:1.5;
  font-variant-numeric:tabular-nums}
.dv-read .mut{color:var(--muted)}
@media (max-width:620px){ .dv-legend{padding:12px 12px 0} .dv-panels{padding:4px 12px} }
@media (prefers-reduced-motion: reduce){ .dv-plot .end, .dv-plot .gain{transition:none} }
`);

export function mount(el) {
  el.innerHTML = '';
  const legend = h('div', { class: 'dv-legend' });
  const item = (method, hollow, text) => {
    const sv = s('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' });
    markerAt(sv, MARK[method], 7, 7, 4.5, method, hollow);
    return h('span', {}, [sv, text]);
  };
  legend.append(item('teleop', true, 'Teleop, one pair'), item('teleop', false, 'Teleop, several objects'),
                item('r2r2r', true, 'R2R2R, one pair'), item('ours', false, 'R2Sem2R, cousins'));
  const panels = h('div', { class: 'dv-panels' });
  const read = h('div', { class: 'dv-read', 'aria-live': 'polite' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Objects in the training data' });
  const MODES = [['one', 'One pair'], ['both', 'Both'], ['several', 'Several objects']];
  for (const [v, t] of MODES) seg.append(h('button', { 'data-v': v, text: t }));
  const bar = h('div', { class: 'demo-bar' }, [h('span', { class: 'dlabel', text: 'Training objects' }), seg]);
  el.append(legend, panels, read, bar);

  let mode = 'both', selKey = null;
  const plots = DATA.robots.map(rb => {
    const plot = h('div', { class: 'rc-plot dv-plot' });
    panels.append(h('div', { class: 'dv-panel' }, [h('h4', { text: rb.name }), plot]));
    return { rb, plot };
  });

  function describe(rb, g, bar) {
    const c = bar.cell;
    if (!c) return `<b>${rb.name}</b> · ${NAME[bar.method]}, ${g.name.toLowerCase()}: <span class="mut">evaluation running</span>`;
    const src = bar.method === 'teleop' ? '150 teleoperated demos' : '2,000 generated episodes';
    return `<b>${rb.name} · ${NAME[bar.method]}</b>, ${src} of ${GROUP_TXT[g.name]}: <b>${c.pct}%</b> ` +
           `<span class="mut">(${c.k}/${c.n} trials, 95% CI ${Math.round(c.lo)}–${Math.round(c.hi)}%)</span>`;
  }

  function drawPlot({ rb, plot }) {
    const W = Math.round(plot.getBoundingClientRect().width);
    if (!W) return;
    const narrow = W < 480;       // phones: row labels above the row, so the axis gets the full width
    const m = { l: narrow ? 8 : 112, r: 22, t: 6, b: 30 }, rowH = narrow ? 90 : 74;
    const H = m.t + rowH * ROWS.length + m.b;
    const X = lin(0, 100, m.l, W - m.r);
    plot.innerHTML = '';
    const sv = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
                          'aria-label': `${rb.name}: success when training on one pair and on several objects` });
    for (const v of [0, 25, 50, 75, 100]) {
      s('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b + 4, class: v ? 'grid' : 'axis' }, sv);
      s('text', { x: X(v), y: H - m.b + 19, 'text-anchor': v ? (v === 100 ? 'end' : 'middle') : 'start' }, sv).textContent = `${v}%`;
    }
    ROWS.forEach((row, i) => {
      const top = m.t + rowH * i, y = top + (narrow ? 58 : 44);
      if (narrow) {
        const t = s('text', { x: m.l, y: top + 15, class: 'ink' }, sv);
        t.textContent = row.label;
        s('tspan', { dx: 6, style: 'fill:var(--muted)' }, t).textContent = row.sub;
      } else {
        s('text', { x: 0, y: y - 2, class: 'ink' }, sv).textContent = row.label;
        s('text', { x: 0, y: y + 14 }, sv).textContent = row.sub;
      }
      // row i: teleop bars are index 0 in each group; generated bars are index 1
      const [a, b] = rb.groups.map(g => ({ g, bar: g.bars[i] }));
      if (a.bar.cell && b.bar.cell) {   // the gain from one pair to several objects, drawn above the row
        const x0 = X(a.bar.cell.pct), x1 = X(b.bar.cell.pct), dir = Math.sign(x1 - x0) || 1, ya = y - 17;
        const gg = s('g', { class: 'gain' + (mode === 'both' ? '' : ' off') }, sv);
        s('line', { x1: x0, x2: x1 - dir * 2, y1: ya, y2: ya, style: 'stroke:var(--muted)', 'stroke-width': 1.5 }, gg);
        s('path', { d: `M${x1 - dir * 6} ${ya - 4}L${x1} ${ya}L${x1 - dir * 6} ${ya + 4}`, fill: 'none',
                    style: 'stroke:var(--muted)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, gg);
        const d = b.bar.cell.pct - a.bar.cell.pct;
        s('text', { x: (x0 + x1) / 2, y: ya - 6, 'text-anchor': 'middle', class: 'ink' }, gg).textContent =
          `${d >= 0 ? '+' : '−'}${Math.abs(d)} pts`;
      }
      for (const [j, { g, bar }] of [a, b].entries()) {
        const one = j === 0, show = mode === 'both' || (mode === 'one') === one;
        const grp = s('g', { class: `end ${show ? '' : 'off'}`, 'data-one': one ? 1 : 0 }, sv);
        const c = bar.cell;
        if (!c) {
          s('text', { x: X(one ? 2 : 60), y: y + 4 }, grp).textContent = 'running';
          continue;
        }
        const key = `${rb.id}:${i}:${j}`, cx = X(c.pct);
        const pt = s('g', { class: 'pt' + (key === selKey ? ' sel' : ''), tabindex: show ? 0 : -1, role: 'button',
                            'aria-label': `${rb.name}, ${NAME[bar.method]}, ${g.name}: ${c.pct} percent` }, grp);
        const ci = `stroke:var(--${bar.method}); stroke-opacity:.6`;     // Wilson 95% interval as a whisker
        s('line', { x1: X(c.lo), x2: X(c.hi), y1: y, y2: y, style: ci, 'stroke-width': 2 }, pt);
        for (const v of [c.lo, c.hi]) s('line', { x1: X(v), x2: X(v), y1: y - 4, y2: y + 4, style: ci, 'stroke-width': 2 }, pt);
        s('rect', { x: cx - 22, y: y - 14, width: 44, height: 44, fill: 'transparent' }, pt);   // 44 px tap target
        s('circle', { cx, cy: y, r: 10, class: 'ring', fill: 'transparent', stroke: 'none' }, pt);
        markerAt(pt, MARK[bar.method], cx, y, 5.5, bar.method, one);
        s('text', { x: cx, y: y + 22, 'text-anchor': 'middle', class: 'ink' }, pt).textContent = `${c.pct}%`;
        const pick = () => {
          selKey = key; read.innerHTML = describe(rb, g, bar);
          for (const q of panels.querySelectorAll('.pt')) q.classList.toggle('sel', q === pt);
        };
        pt.addEventListener('click', pick);
        pt.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        pt.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') read.innerHTML = describe(rb, g, bar); });
      }
    });
    plot.append(sv);
  }
  function drawAll() { plots.forEach(drawPlot); }
  function setMode(v) {        // fade the ends in and out rather than redrawing, so the change animates
    mode = v;
    for (const b of seg.children) b.setAttribute('aria-pressed', b.dataset.v === mode);
    for (const g of panels.querySelectorAll('.end')) {
      const show = mode === 'both' || (mode === 'one') === (g.dataset.one === '1');
      g.classList.toggle('off', !show);
      for (const q of g.querySelectorAll('.pt')) q.setAttribute('tabindex', show ? 0 : -1);
    }
    for (const g of panels.querySelectorAll('.gain')) g.classList.toggle('off', mode !== 'both');
  }
  seg.addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v) setMode(v); });
  read.innerHTML = '<span class="mut">Hover or tap a point for its trials and 95% interval.</span>';
  onResize(panels, () => drawAll());
  setMode('both');
}
