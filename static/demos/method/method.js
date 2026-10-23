// "How it works": the pipeline as a numbered stepper, one stage per step, interactive 3D wherever we have it.
// Steps reuse the page's demos (the splat scene, the episode replay) and the method's own viewers in steps/*.js
// (each exports mount(el) -> { pause(), resume() }). A step is mounted the first time it is shown; hidden steps are
// paused and their videos stopped, so only the visible step renders or decodes anything.
const BASE = new URL('./', import.meta.url);
const ROOT = new URL('../../../', import.meta.url);                 // site root, for the shared rollout clips
const url = p => new URL(p, BASE).href;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const STEPS = [
  { short: 'Input', title: 'One human video and a phone scan',
    cap: 'A person does the task once in front of a phone: RGB only, no depth sensor, no robot. A short phone scan of the ' +
         'mug and the coffee machine gives their shape. (The room around the objects is blurred here.)',
    mount: inputStep },
  { short: 'Splats & tracking', title: 'Gaussian splats, tracked from RGB alone',
    cap: 'Each scanned object becomes a metric Gaussian splat with DINOv3 features distilled into it. We track the mug ' +
         'through the human video by rendering its splat, comparing with the frame (colour, features, silhouette) and ' +
         'updating its 6-DoF pose. Drag to orbit; the inset plays the human video in sync.',
    demo: 'splat' },
  { short: 'Grasp', title: 'The human grasp, on a robot gripper',
    cap: 'The grasp is retargeted from the human hand to a parallel-jaw gripper on the demonstrated mug. This is the grasp ' +
         'every generated episode uses, shown with the xArm7 gripper.',
    module: 'steps/grasp.js' },
  { short: 'Other mugs', title: 'Cousin mugs, aligned by their semantics',
    cap: 'Digital cousins of the mug, each built from a few photos, are aligned to the demonstrated mug by semantic ICP on ' +
         'DINOv3 features, so the handles line up and the grasp carries over to every cousin.',
    module: 'steps/mugs.js' },
  { short: 'Machines', title: 'Coffee machines, aligned on the tray',
    cap: 'Machines differ in size and shape, so they are aligned on the part the task depends on: task-weighted ICP ' +
         'around where the mug lands. The demonstrated placement then holds on every machine.',
    module: 'steps/machines.js' },
  { short: 'Episodes', title: 'Thousands of generated episodes',
    cap: 'Every generated episode swaps in a mug and a machine, new start poses, lighting and textures, and replays the ' +
         'carry tracked from the human video. Generated IsaacSim episodes, replayed in your browser in nine environments.',
    demo: 'hero', after: el => el.querySelector('[data-view="9"]')?.click() },
  { short: 'Real robots', title: 'On real robots',
    cap: 'The vision-language-action model π<sub>0.5</sub>, fine-tuned on the generated episodes, on a real xArm7 and a ' +
         'real Franka Panda: the demonstrated mug and machine, and cousin mugs on cousin machines. Clips are sped up.',
    mount: deployStep },
];

const CLIPS = [
  ['xArm7', [['x_ours_white_black', 'Demonstrated pair · 3×', 640, 368], ['x_cous_red_navy', 'Navy machine · red mug · 4×', 640, 368],
             ['x_cous_pink_white', 'Cream machine · pink mug · 3×', 640, 368]]],
  ['Franka Panda', [['p_ours_white_black', 'Demonstrated pair · 3×', 640, 452], ['p_cous_orange_black', 'Keurig · orange mug · 3×', 640, 452],
                    ['p_cous_white_teal', 'Teal machine · white mug · 3×', 640, 452]]],
];

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function video(src, poster, { w, hgt } = {}) {
  const v = h('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  if (poster) v.poster = poster; v.dataset.src = src;
  if (w) { v.width = w; v.height = hgt; }
  return v;
}

function playAll(el) {
  el.querySelectorAll('video').forEach(v => {
    if (!v.src && v.dataset.src) v.src = v.dataset.src;
    if (!REDUCED) v.play().catch(() => {});
  });
}
const pauseAll = el => el.querySelectorAll('video').forEach(v => v.pause());

function inputStep(el) {
  const row = h('div', 'mt-input');
  const a = h('figure', 'mt-vid mt-wide');
  a.append(video(url('media/human.mp4'), url('media/human.webp')));
  a.append(h('figcaption', '', '<b>Human demonstration</b> · phone RGB video, 10 s'));
  const b = h('figure', 'mt-vid mt-square');
  b.append(video(url('media/scan.mp4'), url('media/scan.webp')));
  b.append(h('figcaption', '', '<b>Phone scan</b> of the mug and the machine'));
  row.append(a, b); el.append(row);
  return { pause: () => pauseAll(el), resume: () => playAll(el) };
}

function deployStep(el) {
  const wrap = h('div', 'mt-deploy');
  for (const [robot, clips] of CLIPS) {
    const r = h('div', 'mt-robot'); r.append(h('div', 'mt-robot-l', robot));
    const g = h('div', 'mt-clips');
    for (const [name, label, w, hgt] of clips) {
      const f = h('figure', 'mt-vid');
      f.append(video(new URL(`static/slides_rollouts/${name}.mp4`, ROOT).href, new URL(`static/slides_rollouts/${name}.jpg`, ROOT).href, { w, hgt }));
      f.append(h('figcaption', '', label)); g.append(f);
    }
    r.append(g); wrap.append(r);
  }
  el.append(wrap);
  return { pause: () => pauseAll(el), resume: () => playAll(el) };
}

async function mountStep(step, panel) {
  if (step.mount) return step.mount(panel);
  if (step.demo) {                                                  // one of the page's demos, as on the page
    const box = h('div', 'demo wide mt-demo'); box.dataset.demo = step.demo; panel.append(box);
    const m = await import(new URL(`../${step.demo}/${step.demo}.js`, BASE).href);
    const ret = await m.mount(box);
    if (step.after) setTimeout(() => step.after(box), 600);
    return ret && ret.pause ? ret : null;                           // these pause themselves when off screen
  }
  const box = h('div', 'demo wide mt-box'); const stage = h('div', 'mt-stage'); box.append(stage); panel.append(box);
  const m = await import(url(step.module));
  return m.mount(stage);
}

export async function mount(el) {
  if (!document.querySelector('link[data-demo-css="method"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url('method.css'); l.dataset.demoCss = 'method';
    document.head.appendChild(l);
  }
  el.innerHTML = '';
  el.classList.add('mt');
  const nav = h('div', 'mt-steps'); nav.setAttribute('role', 'tablist');
  const panels = h('div', 'mt-panels');
  const text = h('div', 'mt-text');
  const ttl = h('h3', 'mt-title'), cap = h('p', 'mt-cap'), ctr = h('div', 'mt-ctr');
  const prev = h('button', 'dbtn ghost mt-prev', '&larr; Back'), next = h('button', 'dbtn mt-next', 'Next &rarr;');
  const count = h('span', 'mt-count');
  ctr.append(prev, count, next); text.append(ttl, cap, ctr);
  el.append(nav, panels, text);

  const st = { i: -1, panels: [], handles: [], visible: false };   // set by the observer below, so nothing plays off screen
  STEPS.forEach((s, i) => {
    const b = h('button', 'mt-step', `<i>${i + 1}</i><span>${s.short}</span>`);
    b.setAttribute('role', 'tab'); b.addEventListener('click', () => show(i)); nav.append(b);
    const p = h('div', 'mt-panel'); p.hidden = true; panels.append(p); st.panels.push(p);
  });

  async function show(i) {
    if (i === st.i || i < 0 || i >= STEPS.length) return;
    const old = st.i; st.i = i;
    if (old >= 0) { st.panels[old].hidden = true; st.handles[old]?.pause?.(); pauseAll(st.panels[old]); }
    nav.querySelectorAll('.mt-step').forEach((b, k) => { b.setAttribute('aria-selected', k === i); b.classList.toggle('done', k < i); });
    const pill = nav.children[i];                                    // keep the active pill in view on narrow screens
    nav.scrollTo({ left: pill.offsetLeft - (nav.clientWidth - pill.offsetWidth) / 2, behavior: REDUCED ? 'auto' : 'smooth' });
    const s = STEPS[i];
    ttl.textContent = s.title; cap.innerHTML = s.cap; count.textContent = `${i + 1} / ${STEPS.length}`;
    prev.disabled = i === 0; next.disabled = i === STEPS.length - 1;
    const p = st.panels[i]; p.hidden = false;
    if (!p.dataset.mounted) {
      p.dataset.mounted = '1';
      try { st.handles[i] = await mountStep(s, p); }
      catch (err) { console.error('method step ' + (i + 1), err); p.append(h('p', 'mt-fail', 'This step could not load in this browser.')); }
    }
    if (st.i === i && st.visible) { st.handles[i]?.resume?.(); playAll(p); }
  }
  prev.addEventListener('click', () => show(st.i - 1));
  next.addEventListener('click', () => show(st.i + 1));
  el.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') { show(st.i + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { show(st.i - 1); e.preventDefault(); }
  });
  new IntersectionObserver(es => {                                  // stop the visible step when scrolled away
    st.visible = es[0].isIntersecting; const p = st.panels[st.i]; if (!p) return;
    if (st.visible) { st.handles[st.i]?.resume?.(); playAll(p); } else { st.handles[st.i]?.pause?.(); pauseAll(p); }
  }, { threshold: 0.05 }).observe(el);
  show(0);
}
