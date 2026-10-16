// Small helpers shared by the scaling, diversity and cost charts: DOM/SVG builders, scales, resize and theme hooks,
// and the readout chips. Charts are inline SVG drawn at the element's pixel size, so text stays 12 px at any width,
// and every colour is a page token (var(--teleop) etc.), so light and dark mode follow the header toggle.

export const SVGNS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) e.append(c);
  return e;
}

export function s(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export const lin = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
export const log = (d0, d1, r0, r1) => v => r0 + (Math.log(v) - Math.log(d0)) / (Math.log(d1) - Math.log(d0)) * (r1 - r0);
export const fmt = v => Math.round(v).toLocaleString('en-US');
export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function injectCSS(id, css) {
  if (document.getElementById(id)) return;
  document.head.appendChild(h('style', { id, text: css }));
}

// call fn(width) now and whenever the element's width changes
export function onResize(el, fn) {
  let w = 0;
  const run = () => { const nw = Math.round(el.getBoundingClientRect().width); if (nw && nw !== w) { w = nw; fn(w); } };
  if ('ResizeObserver' in window) new ResizeObserver(run).observe(el); else window.addEventListener('resize', run);
  run();
}

// method swatch for a legend/chip: a short line (solid or dashed) with a marker (filled or hollow)
export function swatch(method, { dashed = false, hollow = false, marker = 'circle', w = 26 } = {}) {
  const sv = s('svg', { width: w, height: 12, viewBox: `0 0 ${w} 12`, 'aria-hidden': 'true' });
  s('line', { x1: 1, y1: 6, x2: w - 1, y2: 6, style: `stroke:var(--${method})`, 'stroke-width': 2,
              'stroke-dasharray': dashed ? '4 3' : null }, sv);
  if (marker !== 'none') markerAt(sv, marker, w / 2, 6, 4, method, hollow);
  return sv;
}

export function markerAt(parent, kind, x, y, r, method, hollow) {
  const style = `stroke:var(--${method}); fill:${hollow ? 'var(--surface)' : `var(--${method})`}`;
  if (kind === 'diamond') return s('path', { d: `M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}Z`,
                                            style, 'stroke-width': 1.6 }, parent);
  if (kind === 'square') return s('rect', { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, rx: 1, style,
                                            'stroke-width': 1.6 }, parent);
  return s('circle', { cx: x, cy: y, r, style, 'stroke-width': 1.6 }, parent);
}

// shared CSS for the three charts (scoped by the .rc- prefix)
injectCSS('rc-css', `
.rc-plot{position:relative; touch-action:pan-y; user-select:none; -webkit-user-select:none}
.rc-plot svg{display:block; width:100%; overflow:visible}
.rc-plot text{font-family:var(--sans); font-size:12px; fill:var(--muted); font-variant-numeric:tabular-nums}
.rc-plot .ink{fill:var(--ink)}
.rc-plot .grid{stroke:var(--line); stroke-width:1}
.rc-plot .axis{stroke:color-mix(in srgb, var(--muted) 55%, transparent); stroke-width:1}
.rc-plot .guide{stroke:var(--muted); stroke-width:1; stroke-dasharray:1 3}
.rc-plot .cross{stroke:var(--ink); stroke-width:1; opacity:.55}
.rc-plot .hit{fill:transparent; cursor:crosshair}
.rc-chips{display:grid; grid-template-columns:repeat(var(--n,4), minmax(0,1fr)); border-top:1px solid var(--line)}
.rc-chip{font:inherit; text-align:left; background:transparent; border:0; border-left:1px solid var(--line); padding:10px 14px 11px;
  color:var(--ink); min-width:0; transition:background .2s, opacity .2s}
button.rc-chip{cursor:pointer}
button.rc-chip:hover{background:color-mix(in srgb, var(--line) 30%, transparent)}
.rc-chip:first-child{border-left:0}
.rc-chip[aria-pressed="false"]{opacity:.42}
.rc-chip .nm{display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; line-height:1.3; min-width:0}
.rc-chip .nm span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.rc-chip .nm svg{flex:none}
.rc-chip .v{font-size:20px; font-weight:500; letter-spacing:-.02em; line-height:1.2; margin-top:3px; font-variant-numeric:tabular-nums}
.rc-chip .v small{font-size:12px; color:var(--muted); font-weight:400; letter-spacing:0; margin-left:4px}
.rc-chip .obj{font-size:12px; color:var(--muted); line-height:1.35; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.rc-chip .sub{font-size:12px; color:var(--muted); line-height:1.4; font-variant-numeric:tabular-nums}
.rc-hint{font-size:12px; color:var(--muted)}
@media (max-width:620px){
  .rc-chips{grid-template-columns:repeat(2, minmax(0,1fr))}
  .rc-chip:nth-child(3){border-left:0}
  .rc-chip:nth-child(n+3){border-top:1px solid var(--line)}
  .rc-chip{padding:8px 10px 9px}
  .rc-chip .v{font-size:17px}
}
@media (pointer:coarse){ button.rc-chip{min-height:44px} }
`);
