// Real-robot rollouts as one comparison: pick a robot and a task, and every method with a clip for it plays side by side,
// in sync from the start of the trial, over the success rate of all three methods from the page's results table
// (window.R2Sem2R_RESULTS). The clips are the page's slide rollouts (static/slides_rollouts, already sped up; labels,
// outcomes and speed factors as in their captions), plus one R2R2R+ drill trial recorded at real time
// (../rollouts/media), which is played sped up. Nothing loads until the demo is near the viewport, and only the clips on
// screen are attached; everything pauses when the demo scrolls away.
const ROOT = new URL('../../../', import.meta.url);                 // site root
const BASE = new URL('./', import.meta.url);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOLD = 1.4;                                                    // seconds every clip holds its last frame before all restart
const ASPECT = { xarm7: '640 / 368', panda: '640 / 452' };
const ROBOTS = [['xarm7', 'xArm7'], ['panda', 'Franka Panda']];
const TASKS = [['Mug on coffee machine', 'Place'], ['Pour into bowl', 'Pour'], ['Hang on mug tree', 'Hang'], ['Drill reorient', 'Drill']];
const ORDER = ['teleop', 'r2r2r', 'ours'];
const TAG = { teleop: ['Teleop', ''], r2r2r: ['R2R2R+', ''], ours: ['R2Sem2R', 'ours'] };
const PER_PAGE = 3;                                                  // cousin pairs shown at once
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';

// a slide clip: name, outcome text (null = not stated), speed factor, success?, object label for grids
const S = (name, out, speed, ok, label = null) => ({
  src: new URL(`static/slides_rollouts/${name}.mp4`, ROOT).href, poster: new URL(`static/slides_rollouts/${name}.jpg`, ROOT).href,
  out, speed, ok, label, rate: 1 });
// a real-time clip from the earlier rollout widget, played at `rate`
const RT = (name, out, rate, ok) => ({
  src: new URL(`../rollouts/media/${name}.mp4`, BASE).href, poster: new URL(`../rollouts/media/${name}.jpg`, BASE).href,
  out, speed: rate, ok, label: null, rate });
const C = (name, label, speed) => S(name, 'success', speed, true, label);   // cousin pairs: every clip ends placed and released

const CAP_X_COUS = 'R2Sem2R policies on cousin mugs and coffee machines (labels: machine &middot; mug), trained on 1,320 to 2,000 ' +
                   'generated episodes from IsaacSim and MuJoCo. Every clip ends with the mug upright on the tray and the gripper released.';
const CAP_P_COUS = 'Eight cousin pairs, all from the same R2Sem2R policy (labels: machine &middot; mug). Each ends with the mug upright ' +
                   'on the tray and the gripper released.';
const DATA = {
  xarm7: [
    { teleop: [S('x_teleop_white_black', 'success', 4, true)],
      r2r2r: [S('x_1x1_white_black', 'fails: never places', 3, false), S('x_1x1_red_teal', 'fails: shoves the machine', 3, false)],
      ours: [S('x_ours_white_black', 'success', 3, true)],
      note: 'The demonstrated pair is the white mug and the black Keurig. Each success ends with the mug upright on the tray and ' +
            'the gripper released. Clip 2 shows a second way R2R2R+ fails.',
      cousins: [C('x_cous_white_beige', 'Cream &middot; white', 3), C('x_cous_pink_white', 'Cream &middot; pink', 3),
                C('x_cous_red_navy', 'Navy &middot; red', 4), C('x_cous_brown_navy', 'Navy &middot; brown', 4),
                C('x_cous_red_teal', 'Teal &middot; red', 3), C('x_cous_pink_red', 'Red &middot; pink', 3)],
      cousinNote: CAP_X_COUS },
    { ours: [S('x_pour_teal', null, 3, null, 'Pour into the bowl')],
      note: 'Only an R2Sem2R clip is shown for this task on the xArm7; the bars give every method. The clip comes from an ' +
            'R2Sem2R policy trained on MuJoCo-generated data.' },
    { ours: [S('x_hang_white', 'success', 4, true, 'White mug'), S('x_hang_navy', 'success', 4, true, 'Navy mug'),
             S('x_hang_red', 'success', 3, true, 'Red mug'), S('x_hang_pink', 'success', 3, true, 'Pink mug')],
      note: 'Only R2Sem2R clips are shown for this task on the xArm7; the bars give every method. Success: the mug hangs on the ' +
            'blue branch after the gripper releases it.' },
    { r2r2r: [RT('xarm7_drill_r2r2r_t1', 'fails', 3, false)],
      ours: [S('x_drill_a', 'upright', 5, true), S('x_drill_b', 'upright', 2, true)],
      note: 'Each R2Sem2R clip ends with the drill upright and released. The R2R2R+ trial was filmed at real time and is played ' +
            'at 3&times;.' },
  ],
  panda: [
    { teleop: [S('p_teleop_white_black', 'success', 3, true)],
      r2r2r: [S('p_1x1_white_black', 'fails: never lifts', 3, false), S('p_1x1_red_black', 'fails: knocks it over', 2, false)],
      ours: [S('p_ours_white_black', 'success', 3, true)],
      note: 'The same human video and generation pipeline on a second robot. Clip 2 shows a second way R2R2R+ fails.',
      cousins: [C('p_cous_orange_black', 'Keurig &middot; orange', 3), C('p_cous_pink_black', 'Small black &middot; pink', 3),
                C('p_cous_white_teal', 'Teal &middot; white', 3), C('p_cous_navy_teal', 'Teal &middot; navy', 4),
                C('p_cous_orange_white', 'Cream &middot; orange', 4), C('p_cous_black_white', 'Cream &middot; black', 3),
                C('p_cous_black_navy', 'Navy &middot; black', 3), C('p_cous_pink_navy', 'Navy &middot; pink', 4)],
      cousinNote: CAP_P_COUS },
    { teleop: [S('p_pour_tele_white_cyan', 'pours', 3, true), S('p_pour_tele_navy_pink', 'never lifts it', 2, false)],
      ours: [S('p_pour_white_cyan', 'pours', 2, true), S('p_pour_navy_pink', 'pours', 2, true)],
      trials: ['White mug &middot; light-blue bowl', 'Navy mug &middot; pink bowl'],
      note: 'The same mug and bowl for both methods: the white mug and light-blue bowl from the human video, or a navy mug and a pink bowl.' },
    { teleop: [S('p_tree_tele_white', 'hangs it', 2, true), S('p_tree_tele_brown', 'hangs it', 2, true)],
      ours: [S('p_tree_white', 'on the branch', 4, true), S('p_tree_brown', 'hangs it', 4, true)],
      trials: ['White mug', 'Brown mug'],
      note: 'The same mugs for both methods. Success: the handle hooks over the low blue branch. Our white-mug recording stops ' +
            'with the handle on the branch, before the gripper opens.' },
    { teleop: [S('p_drill_tele_red', 'upright', 4, true), S('p_drill_tele_yellow', 'upright', 2, true)],
      ours: [S('p_drill_red', 'upright', 4, true), S('p_drill_yellow', 'upright', 4, true)],
      trials: ['Red drill (demonstrated)', 'Yellow drill'],
      note: 'The same drills for both methods. Successes end with the drill upright and the gripper released.' },
  ],
};

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// same rounding as the page's results (exact halves round to even: 62.5 -> 62, 37.5 -> 38)
function pct(c) { const x = 100 * c[0] / c[1], f = Math.floor(x); if (Math.abs(x - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); }

function ensureCss() {
  if (document.querySelector('link[data-demo-css="compare"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('compare.css', BASE).href; l.dataset.demoCss = 'compare';
  document.head.appendChild(l);
}

export async function mount(el) {
  ensureCss();
  const RES = window.R2Sem2R_RESULTS || { methods: [], results: {} };
  const st = { robot: 'xarm7', task: 0, mode: 'demo', trial: 0, playing: !REDUCED, visible: false, players: [], hold: 0, gen: 0 };

  el.innerHTML = '';
  el.classList.add('cp');
  const top = h('div', 'demo-bar cp-top');
  const robotSeg = h('div', 'seg'), taskSeg = h('div', 'seg cp-tasks');
  robotSeg.setAttribute('aria-label', 'Robot'); taskSeg.setAttribute('aria-label', 'Task');
  top.append(robotSeg, taskSeg);
  const stage = h('div', 'cp-stage');
  const bar = h('div', 'demo-bar cp-bar');
  const play = h('button', 'dbtn cp-play'); play.type = 'button';
  const modeSeg = h('div', 'seg cp-mode'), trialWrap = h('div', 'cp-trials');
  bar.append(play, modeSeg, trialWrap);
  const res = h('div', 'cp-res'), note = h('div', 'demo-note cp-note');
  el.append(top, stage, bar, res, note);

  function seg(box, items, active, pick) {
    box.innerHTML = '';
    items.forEach(([k, html]) => {
      const b = h('button', '', html); b.type = 'button'; b.setAttribute('aria-pressed', String(k === active));
      b.addEventListener('click', () => { if (k !== active) pick(k); }); box.append(b);
    });
  }
  const spec = () => DATA[st.robot][st.task];

  // the panels for the current selection: [{ m, clip, label }]
  function panels() {
    const d = spec();
    if (st.mode === 'cousins') return d.cousins.slice(st.trial * PER_PAGE, st.trial * PER_PAGE + PER_PAGE).map(c => ({ m: 'ours', clip: c }));
    const ms = ORDER.filter(m => d[m]);
    if (ms.length === 1) return d[ms[0]].map(c => ({ m: ms[0], clip: c }));          // one method: all its clips side by side
    return ms.map(m => ({ m, clip: d[m][st.trial % d[m].length] }));
  }
  const nTrials = () => {
    const d = spec();
    if (st.mode === 'cousins') return Math.ceil(d.cousins.length / PER_PAGE);
    const ms = ORDER.filter(m => d[m]);
    return ms.length === 1 ? 1 : Math.max(...ms.map(m => d[m].length));
  };

  function controls() {
    seg(robotSeg, ROBOTS.map(([k, n]) => [k, n]), st.robot, k => { st.robot = k; st.mode = 'demo'; st.trial = 0; build(); });
    seg(taskSeg, TASKS.map(([n, s], i) => [i, `<span class="cp-l">${n}</span><span class="cp-s">${s}</span>`]), st.task,
        k => { st.task = k; st.mode = 'demo'; st.trial = 0; build(); });
    const d = spec();
    modeSeg.hidden = !d.cousins;
    if (d.cousins) seg(modeSeg, [['demo', 'Demonstrated pair'], ['cousins', 'Cousin pairs']], st.mode, k => { st.mode = k; st.trial = 0; build(); });
    const n = nTrials();
    trialWrap.innerHTML = '';
    if (n > 1) {
      const s = h('div', 'seg'); s.setAttribute('aria-label', st.mode === 'cousins' ? 'Pairs' : 'Trial');
      const lab = i => st.mode === 'cousins' ? `${i * PER_PAGE + 1}&ndash;${Math.min(d.cousins.length, (i + 1) * PER_PAGE)}`
                                              : (d.trials ? d.trials[i] : `Clip ${i + 1}`);
      seg(s, Array.from({ length: n }, (_, i) => [i, lab(i)]), st.trial, k => { st.trial = k; build(); });
      if (st.mode === 'cousins') trialWrap.append(h('span', 'dlabel', 'Pairs'));
      trialWrap.append(s);
    }
    play.innerHTML = st.playing ? PAUSE : PLAY; play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  }

  function results() {
    const row = (RES.results[st.robot] || [])[st.task];
    const methods = RES.methods.length ? RES.methods : ORDER.map(m => [m, TAG[m][0]]);
    const n = row && row[1] ? row[1][1] : null;
    let html = `<div class="cp-rh"><b>Real-robot success</b><span>${ROBOTS.find(r => r[0] === st.robot)[1]} &middot; ${TASKS[st.task][0]}` +
               `${n ? ` &middot; ${n} trials per policy` : ''}</span></div><div class="cp-rows">`;
    methods.forEach(([k, name], i) => {
      const c = row ? row[i + 1] : null, [nm, sub] = name.split(' (');
      const lab = `<div class="cp-rl"><i class="cp-dot"></i><b>${nm}</b>${sub ? ` <small>${sub.replace(')', '')}</small>` : ''}` +
                  `</div>`;
      html += c ? `<div class="cp-row" data-m="${k}">${lab}<div class="cp-track"><i style="width:${pct(c)}%"></i></div>` +
                  `<div class="cp-rv">${c[0]}/${c[1]} &middot; <b>${pct(c)}%</b></div></div>`
                : `<div class="cp-row" data-m="${k}">${lab}<div class="cp-track"></div><div class="cp-rv"><i>running</i></div></div>`;
    });
    res.innerHTML = html + '</div>';
  }

  function makePlayer({ m, clip }, i, all, mixed) {
    const fig = h('figure', 'cp-panel'); fig.dataset.m = m;
    const frame = h('div', 'cp-frame'); frame.style.aspectRatio = ASPECT[st.robot];
    const v = h('video'); v.muted = true; v.playsInline = true; v.preload = 'none'; v.disablePictureInPicture = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.poster = clip.poster;
    const [t1, t2] = TAG[m];
    const tag = clip.label && !mixed ? `<b>${clip.label}</b>` : `<b>${t1}</b>${t2 ? ` <span class="mut">${t2}</span>` : ''}`;
    frame.append(v,
      h('div', 'demo-hud tl', `<span class="hud dot" style="--c:var(--${m})">${tag}</span>`),
      h('div', 'demo-hud tr', `<span class="hud">${clip.speed}&times;</span>`),
      h('div', 'cp-prog', '<i></i>'));
    if (clip.out) frame.append(h('div', 'demo-hud bl', `<span class="hud cp-out ${clip.ok ? 'ok' : 'no'}">${clip.out}</span>`));
    fig.append(frame);
    if (mixed ? m === 'ours' : i === 0 && all % 2 === 1) fig.classList.add('cp-first');   // phones: full width on top
    if (mixed && all === 2) fig.classList.add('cp-full');
    const p = { fig, v, clip, bar: frame.querySelector('.cp-prog i'), done: false };
    v.addEventListener('loadedmetadata', () => { v.playbackRate = clip.rate; });
    v.addEventListener('ended', () => { p.done = true; fig.classList.add('done'); maybeLoop(); });
    return p;
  }

  function detach() {
    clearTimeout(st.hold);
    st.players.forEach(p => { p.v.pause(); p.v.removeAttribute('src'); p.v.load(); });
    st.players = [];
  }
  function attach() { st.players.forEach(p => { if (!p.v.getAttribute('src')) { p.v.src = p.clip.src; p.v.load(); } }); }

  function build() {
    detach(); st.gen++;
    const ps = panels(), mixed = new Set(ps.map(p => p.m)).size > 1;
    stage.innerHTML = '';
    stage.dataset.n = ps.length; stage.classList.toggle('cp-mixed', mixed);
    st.players = ps.map((p, i) => makePlayer(p, i, ps.length, mixed));
    st.players.forEach(p => stage.append(p.fig));
    controls(); results();
    const d = spec();
    note.innerHTML = (st.mode === 'cousins' ? d.cousinNote : d.note) +
      ' Clips are sped up (factor on each clip) and start together; the bars count every real-robot trial of the evaluated policies.';
    if (st.visible) { attach(); restart(); }
  }

  // all clips start together; each holds its last frame when it ends; once all have ended, they restart together
  function restart() {
    clearTimeout(st.hold);
    const gen = st.gen;
    st.players.forEach(p => { p.done = false; p.fig.classList.remove('done'); try { p.v.currentTime = 0; } catch (e) { /* not loaded */ } });
    if (!st.playing || !st.visible) return;
    const ready = st.players.map(p => p.v.readyState >= 3 ? null
      : new Promise(r => { p.v.addEventListener('canplay', r, { once: true }); setTimeout(r, 4000); }));
    Promise.all(ready).then(() => { if (gen === st.gen && st.playing && st.visible) playAll(); });
  }
  function playAll() {
    st.players.forEach(p => { if (!p.done) { p.v.playbackRate = p.clip.rate; p.v.play().catch(() => {}); } });
    tick();
  }
  function maybeLoop() {
    if (!st.players.length || !st.players.every(p => p.done)) return;
    clearTimeout(st.hold);
    st.hold = setTimeout(restart, HOLD * 1000);
  }
  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const step = () => {
      st.players.forEach(p => { const d = p.v.duration; if (d) p.bar.style.width = (100 * Math.min(1, p.v.currentTime / d)).toFixed(1) + '%'; });
      if (st.playing && st.visible) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  play.addEventListener('click', () => {
    st.playing = !st.playing; controls();
    if (!st.playing) { clearTimeout(st.hold); st.players.forEach(p => p.v.pause()); return; }
    attach();
    if (st.players.every(p => p.done)) restart(); else playAll();
  });

  new IntersectionObserver(es => {
    const vis = es[0].isIntersecting;
    if (vis === st.visible) return;
    st.visible = vis;
    if (vis) { attach(); if (st.playing) { if (st.players.every(p => p.done || !p.v.currentTime)) restart(); else playAll(); } }
    else { clearTimeout(st.hold); st.players.forEach(p => p.v.pause()); }
  }, { rootMargin: '100px 0px', threshold: 0.01 }).observe(el);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) st.players.forEach(p => p.v.pause());
    else if (st.visible && st.playing) playAll();
  });

  build();
}
