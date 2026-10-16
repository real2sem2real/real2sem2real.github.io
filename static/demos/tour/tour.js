// Guided tour of the pipeline: one short clip per step, cut from real pipeline outputs (manifest.json, built by the
// private build_tour.py), with a step bar, a "Tour" control that plays the steps in order, and a link from every step
// to the detailed demo further down the page. Clips load only when their step is shown. Placement success rates come
// from window.R2Sem2R_RESULTS (the page's results table), the other numbers from the paper.
const BASE = new URL('./', import.meta.url);
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// same rounding as the page's results charts (exact halves round to even)
function pct(c) { const x = 100 * c[0] / c[1], f = Math.floor(x); if (Math.abs(x - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); }

function placement() {
  const R = (window.R2Sem2R_RESULTS || {}).results || {};
  const cell = (robot, i) => { const row = (R[robot] || []).find(r => /coffee machine/i.test(r[0])); return row && row[i] ? pct(row[i]) + '%' : null; };
  const [xo, po, xt, pt] = [cell('xarm7', 3), cell('panda', 3), cell('xarm7', 1), cell('panda', 1)];
  return xo && po && xt && pt
    ? ` On mug placement it succeeds in <b>${xo}</b> of real trials on the xArm7 and <b>${po}</b> on the Panda, against ${xt} and ${pt} for 150 teleoperated demonstrations.`
    : '';
}

const STEPS = [
  { key: 'video', tab: 'Video', title: 'One human video',
    text: () => 'A person performs the task once in front of a phone. That monocular RGB video and a phone scan of the objects are the only inputs: no depth sensor and no teleoperation.',
    go: 'splat', goText: 'See the demonstration in 3D' },
  { key: 'track', tab: 'Track', title: 'Track every object',
    text: () => 'Each object is a Gaussian splat with distilled DINOv3 features. Its 6-DoF pose is found in every frame by rendering the splat and comparing it with the video; the mug splat is drawn in green at its tracked pose (mask IoU 0.949 on this video).',
    go: 'tracking', goText: 'Compare trackers frame by frame' },
  { key: 'grasp', tab: 'Grasp', title: 'From the hand to a gripper',
    text: () => 'HaMeR recovers the demonstrator’s hand, which is registered in metric scale to the tracked mug. The thumb and index fingertips become the gripper’s jaws, and the collision-free grasp closest to the human’s is kept.',
    go: 'grasp', goText: 'Explore the grasp' },
  { key: 'cousins', tab: 'Cousins', title: 'Cousins from photographs',
    text: () => 'A digital cousin needs one or a few photographs. SAM3 segments the object and SAM3D, or MV-SAM3D for several views, generates a splat and a textured mesh, here from four phone photos of a coffee machine. Ten cousins take about seven minutes on one GPU.',
    go: 'mymug', goText: 'Make a cousin of your own mug' },
  { key: 'align', tab: 'Align', title: 'Aligned by semantics',
    text: () => 'Distilled DINOv3 features give the same part the same color on every cousin, so the mugs align handle to handle and rim to rim, and the coffee machines align on the tray where the mug is placed.',
    go: 'align', goText: 'Explore the alignment' },
  { key: 'generate', tab: 'Generate', title: 'Thousands of episodes',
    text: () => 'The demonstration is replayed for every cousin pairing, with a new start pose in every episode, in IsaacSim with kinematic replay or in MuJoCo with contact physics: over 2,000 episodes in about two hours.',
    go: 'physics', goText: 'Run a MuJoCo episode live' },
  { key: 'deploy', tab: 'Deploy', title: 'On two real robots',
    text: () => 'A π<sub>0.5</sub> policy fine-tuned on the generated episodes runs on the real xArm7 and Franka Panda.' + placement(),
    go: 'rollouts', goText: 'Watch more real rollouts' },
];

function ensureCss() {
  if (document.querySelector('link[data-tour-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('tour.css', BASE).href; l.dataset.tourCss = '1';
  document.head.appendChild(l);
}

export async function mount(el) {
  ensureCss();
  const man = await (await fetch(new URL('manifest.json', BASE))).json();
  const st = { i: 0, tour: false, visible: false, wantPlay: !REDUCED, cue: -1 };

  el.classList.add('tour');
  el.innerHTML = `
    <div class="demo-bar tour-top">
      <div class="tour-steps" role="tablist" aria-label="Pipeline steps">${STEPS.map((s, i) => `
        <button type="button" role="tab" id="tour-tab-${i}" aria-controls="tour-panel" aria-selected="false" tabindex="-1" data-i="${i}">
          <span class="n">${i + 1}</span><span class="t">${s.tab}</span><i class="p"></i></button>`).join('')}
      </div>
      <button class="dbtn tour-run" type="button">${PLAY}Tour</button>
    </div>
    <div class="demo-stage keep tour-stage" id="tour-panel" role="tabpanel">
      <video muted playsinline preload="none" disablepictureinpicture></video>
      <div class="demo-hud tl"><span class="hud dot tour-cue"></span></div>
      <div class="demo-hud tr"><span class="hud tour-count"></span></div>
      <button class="tour-nav prev" type="button" aria-label="Previous step"><svg viewBox="0 0 16 16"><path d="M10.5 2.5 5 8l5.5 5.5"/></svg></button>
      <button class="tour-nav next" type="button" aria-label="Next step"><svg viewBox="0 0 16 16"><path d="M5.5 2.5 11 8l-5.5 5.5"/></svg></button>
      <button class="tour-hold" type="button" aria-label="Play clip">${PLAY}</button>
      <div class="tour-prog"><i></i></div>
    </div>
    <div class="tour-text" aria-live="polite">
      <div class="tour-h"></div>
      <p class="tour-p"></p>
      <div class="tour-foot"><a class="tour-x" href="#"></a></div>
    </div>`;

  const $ = s => el.querySelector(s);
  const tabs = [...el.querySelectorAll('.tour-steps button')];
  const v = $('video'), stage = $('.tour-stage'), run = $('.tour-run'), hold = $('.tour-hold');
  const cueEl = $('.tour-cue'), countEl = $('.tour-count'), bar = $('.tour-prog i');

  // phones: the Tour button sits next to the step's link under the text instead of taking a row above the clip
  const narrow = matchMedia('(max-width:620px)'), top = $('.tour-top'), foot = $('.tour-foot');
  const placeRun = () => (narrow.matches ? foot.prepend(run) : top.appendChild(run));
  narrow.addEventListener('change', placeRun); placeRun();

  function setRun() {
    run.innerHTML = st.tour ? `${PAUSE}Stop tour` : `${PLAY}Tour`;
    run.setAttribute('aria-pressed', String(st.tour));
  }
  function playIfWanted() {
    hold.classList.toggle('on', !st.wantPlay);
    if (st.visible && st.wantPlay) v.play().catch(() => { st.wantPlay = false; hold.classList.add('on'); });
    else v.pause();
  }

  function show(i, { focus = false } = {}) {
    st.i = (i + STEPS.length) % STEPS.length;
    const s = STEPS[st.i], m = man[s.key];
    tabs.forEach((b, k) => {
      const on = k === st.i;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      b.classList.toggle('done', st.tour && k < st.i);
      b.querySelector('.p').style.width = st.tour && k < st.i ? '100%' : '0%';
    });
    if (focus) tabs[st.i].focus();
    stage.setAttribute('aria-labelledby', `tour-tab-${st.i}`);
    v.loop = !st.tour;
    v.poster = new URL(m.poster, BASE).href;
    v.src = new URL(m.src, BASE).href;
    v.load();
    st.cue = -1; setCue(0);
    countEl.textContent = `${st.i + 1} / ${STEPS.length}`;
    $('.tour-h').innerHTML = `<span>Step ${st.i + 1}</span>${esc(s.title)}`;
    $('.tour-p').innerHTML = s.text();
    const target = document.querySelector(`[data-demo="${s.go}"]`);
    const x = $('.tour-x');
    x.hidden = !target;
    x.innerHTML = `${esc(s.goText)} <span aria-hidden="true">&darr;</span>`;
    x.onclick = e => {
      e.preventDefault(); stopTour();
      target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    };
    bar.style.width = '0%';
    playIfWanted();
    if (st.tour) prefetch(st.i + 1);
  }

  function setCue(t) {
    const cues = man[STEPS[st.i].key].cues || [];
    let k = 0;
    cues.forEach((c, j) => { if (t >= c.t) k = j; });
    if (k === st.cue || !cues.length) return;
    st.cue = k;
    cueEl.textContent = cues[k].label;
  }

  const warmed = new Set();
  function prefetch(i) {   // only during the tour: warm the next clip so the step change is seamless
    if (i >= STEPS.length) return;
    const m = man[STEPS[i].key];
    [m.poster, m.src].forEach(u => { const h = new URL(u, BASE).href; if (!warmed.has(h)) { warmed.add(h); fetch(h).catch(() => {}); } });
  }

  function startTour() { st.tour = true; st.wantPlay = true; setRun(); show(st.i === STEPS.length - 1 ? 0 : st.i); }
  function stopTour() {
    if (!st.tour) return;
    st.tour = false; v.loop = true; setRun();
    tabs.forEach(b => { b.classList.remove('done'); b.querySelector('.p').style.width = '0%'; });
  }

  v.addEventListener('timeupdate', () => {
    const d = v.duration || man[STEPS[st.i].key].dur || 1;
    const f = Math.min(1, v.currentTime / d);
    bar.style.width = (100 * f).toFixed(1) + '%';
    if (st.tour) tabs[st.i].querySelector('.p').style.width = (100 * f).toFixed(1) + '%';
    setCue(v.currentTime);
  });
  v.addEventListener('ended', () => {
    if (!st.tour) return;
    if (st.i < STEPS.length - 1) show(st.i + 1);
    else { stopTour(); v.loop = true; v.play().catch(() => {}); }
  });

  tabs.forEach((b, k) => b.addEventListener('click', () => { stopTour(); st.wantPlay = st.wantPlay || !REDUCED; show(k); }));
  el.querySelector('.tour-steps').addEventListener('keydown', e => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (k) { e.preventDefault(); stopTour(); show(st.i + k, { focus: true }); }
    else if (e.key === 'Home') { e.preventDefault(); stopTour(); show(0, { focus: true }); }
    else if (e.key === 'End') { e.preventDefault(); stopTour(); show(STEPS.length - 1, { focus: true }); }
  });
  $('.tour-nav.prev').addEventListener('click', () => { stopTour(); show(st.i - 1); });
  $('.tour-nav.next').addEventListener('click', () => { stopTour(); show(st.i + 1); });
  run.addEventListener('click', () => (st.tour ? stopTour() : startTour()));
  hold.addEventListener('click', () => { st.wantPlay = true; playIfWanted(); });
  v.addEventListener('click', () => {   // tap the clip to pause or resume it
    st.wantPlay = v.paused; if (!st.wantPlay) stopTour(); playIfWanted();
  });

  // swipe left / right on the stage (vertical scrolling stays with the page: touch-action pan-y)
  let sx = null, sy = 0;
  stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  stage.addEventListener('pointerup', e => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) { stopTour(); show(st.i + (dx < 0 ? 1 : -1)); }
  });
  stage.addEventListener('pointercancel', () => { sx = null; });

  // play only while on screen
  new IntersectionObserver(es => es.forEach(e => { st.visible = e.isIntersecting; playIfWanted(); }), { threshold: 0.25 }).observe(stage);

  setRun();
  show(0);
}
