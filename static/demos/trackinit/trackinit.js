// Track initialisation on the first video frame: every seed pose of the object, before and after refinement, then
// ranked. Upright seeds about the table normal (ours) against a blind rotation sweep, for the seven tracked objects.
// Renders and scores are real per-seed outputs (manifest.json); a seed counts as converged within 20 deg of the
// full track's frame-0 pose (the bowl: its axis only, since it is a surface of revolution).
import { REDUCED, esc, ensureCss, whenVisible, seg } from '../tasks/loopkit.js';

const BASE = new URL('./', import.meta.url);
const url = p => new URL(p, BASE).href;
const STEPS = [['seeds', '1 · Seeds'], ['refine', '2 · Refine'], ['rank', '3 · Rank']];
const MODES = [['tabletop', 'Upright seeds (ours)'], ['blind', 'Blind sweep']];
const DWELL = 2600;

export async function mount(el) {
  ensureCss(new URL('../tasks/loopkit.css', BASE).href);
  const man = await (await fetch(url('manifest.json'))).json();
  el.classList.add('ti');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top">
      <select class="dselect ti-obj" aria-label="Object">${man.objects.map(o => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}</select>
      <div class="seg ti-mode" role="group" aria-label="Seeds"></div>
    </div>
    <div class="lk-stage"><div class="ti-wrap">
      <div class="ti-grid" aria-live="polite"></div>
      <div class="ti-side">
        <figure class="ti-big"><div class="ti-img ti-frame"></div><figcaption class="demo-hud"><span class="hud">First frame</span></figcaption></figure>
        <figure class="ti-big"><div class="ti-img ti-res"></div><figcaption class="demo-hud"><span class="hud">Selected pose</span></figcaption></figure>
      </div>
    </div></div>
    <div class="demo-bar">
      <div class="seg ti-steps" role="group" aria-label="Step"></div>
      <span class="sp"></span>
      <span class="ti-count"></span>
    </div>
    <div class="demo-note ti-note"></div>`;
  const $ = s => el.querySelector(s);
  const grid = $('.ti-grid');
  const st = { obj: man.objects[0], mode: 'tabletop', step: 'seeds', auto: !REDUCED, timer: 0, visible: false };

  function bg(node, sprite, n, col, row) {
    node.style.backgroundImage = `url("${url(sprite)}")`;
    node.style.backgroundSize = `${(n + 1) * 100}% 200%`;
    node.style.backgroundPosition = `${(100 * col / n).toFixed(4)}% ${row ? 100 : 0}%`;
  }
  function build() {
    const m = st.obj.modes[st.mode];
    grid.innerHTML = m.seeds.map(s => `
      <figure class="ti-seed ${s.ok ? 'ok' : 'no'}${s.seed === m.best ? ' best' : ''}" data-seed="${s.seed}" data-rank="${s.rank}"
              title="Seed ${s.seed}: ${s.ok ? 'converges' : `ends ${Math.round(s.rot)}° off`}, IoU ${s.iou.toFixed(2)}, rank ${s.rank}">
        <div class="ti-img before"></div><div class="ti-img after"></div>
        <span class="ti-tag">${s.ok ? '&check;' : '&times;'} IoU ${s.iou.toFixed(2)}</span><span class="ti-rank">#${s.rank}</span>
      </figure>`).join('');
    grid.querySelectorAll('.ti-seed').forEach((f, i) => {
      const s = m.seeds[i];
      bg(f.querySelector('.before'), m.sprite, m.n, s.col, 0); bg(f.querySelector('.after'), m.sprite, m.n, s.col, 1);
    });
    bg($('.ti-frame'), m.sprite, m.n, m.n, 0); bg($('.ti-res'), m.sprite, m.n, m.n, 1);
    $('.ti-count').innerHTML = `<b>${m.n_ok} of ${m.n}</b> seeds converge`;
    const other = st.obj.modes[st.mode === 'tabletop' ? 'blind' : 'tabletop'];
    $('.ti-note').innerHTML = `${esc(st.obj.label)}, first frame. <b>Seeds:</b> the object rendered at each starting pose.
      <b>Refine:</b> each seed after gradient steps on the tracking losses; green ends within 20&deg; of the full track's pose,
      red in a wrong basin. <b>Rank:</b> the seeds sorted by how well they explain the frame; the best one (outlined) starts
      the track. ${st.mode === 'tabletop' ? `Upright seeds: ${m.n_ok} of ${m.n} converge, against ${other.n_ok} of ${other.n} for a blind sweep.`
      : `Blind sweep: ${m.n_ok} of ${m.n} converge, against ${other.n_ok} of ${other.n} for upright seeds.`}
      Selected pose: IoU ${m.best_iou.toFixed(3)}.`;
    show(st.step, false);
  }
  function order(byRank, animate) {
    const items = [...grid.children];
    const first = new Map(items.map(n => [n, n.getBoundingClientRect()]));
    items.forEach(n => { n.style.order = byRank ? n.dataset.rank : ''; });
    if (REDUCED || !animate) return;
    items.forEach(n => {
      const a = first.get(n), b = n.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      n.style.transition = 'none'; n.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { n.style.transition = ''; n.style.transform = ''; });
    });
  }
  function show(step, animate = true) {
    st.step = step;
    el.classList.toggle('st-refine', step === 'refine'); el.classList.toggle('st-rank', step === 'rank');
    grid.querySelectorAll('.ti-seed').forEach(f => f.classList.toggle('refined', step !== 'seeds'));
    order(step === 'rank', animate);
    $('.ti-steps').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === step)));
  }
  function loop() {
    clearTimeout(st.timer);
    if (!st.auto || !st.visible) return;
    st.timer = setTimeout(() => {
      const i = STEPS.findIndex(s => s[0] === st.step);
      show(STEPS[(i + 1) % STEPS.length][0]); loop();
    }, st.step === 'rank' ? DWELL * 1.6 : DWELL);
  }
  seg($('.ti-steps'), STEPS, st.step, k => { st.auto = false; clearTimeout(st.timer); show(k); });
  seg($('.ti-mode'), MODES, st.mode, k => { st.mode = k; st.step = 'seeds'; build(); loop(); });
  $('.ti-obj').addEventListener('change', e => { st.obj = man.objects.find(o => o.key === e.target.value); st.step = 'seeds'; build(); loop(); });
  build();
  whenVisible(el, () => { st.visible = true; loop(); }, () => { st.visible = false; clearTimeout(st.timer); });
}
