// Real-robot rollouts of the R2R2R+ and R2Sem2R policies, side by side and in sync, with the success rates of every
// method for the selected robot and task underneath. The clips and their selection are listed in manifest.json;
// every number comes from window.R2Sem2R_RESULTS (the results table of the page).
const BASE = new URL('./', import.meta.url);
const ASPECT = { xarm7: '640 / 368', panda: '640 / 452' };
const ROBOTS = ['xarm7', 'panda'];
const SPEEDS = [1, 2, 4];
const HOLD = 1.6;                   // seconds both clips hold their last frame before the pair loops
const LABEL = {
  r2r2r: ['R2R2R+', 'one object pair'],
  ours: ['R2Sem2R', 'digital cousins'],
};
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
// same rounding as the page's results charts (exact halves round to even)
function pct(c) { const x = 100 * c[0] / c[1], f = Math.floor(x); if (Math.abs(x - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); }

function ensureCss() {
  if (document.querySelector('link[data-ro-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('rollouts.css', BASE).href; l.dataset.roCss = '1';
  document.head.appendChild(l);
}

export async function mount(el) {
  ensureCss();
  const manifest = await (await fetch(new URL('manifest.json', BASE))).json();
  const RES = window.R2Sem2R_RESULTS || { methods: [], results: {}, robots: { xarm7: 'xArm7', panda: 'Franka Panda' } };
  const robots = ROBOTS.filter(r => manifest.tasks.some(t => t.robot === r));
  const st = { robot: robots[0], task: null, trial: 0, speed: 2, playing: true, loaded: false, visible: false,
               holdUntil: 0, scrubbing: false, wasPlaying: false };
  st.task = manifest.tasks.find(t => t.robot === st.robot);

  el.classList.add('ro');
  el.innerHTML = `
    <div class="demo-bar ro-top">
      <span class="dlabel">Robot</span><div class="seg ro-robot" role="group" aria-label="Robot"></div>
      <span class="dlabel">Task</span><div class="seg ro-task" role="group" aria-label="Task"></div>
    </div>
    <div class="ro-stage">${['r2r2r', 'ours'].map(m => `
      <figure class="ro-player" data-m="${m}">
        <div class="ro-frame">
          <video muted playsinline preload="none" disablepictureinpicture></video>
          <div class="demo-hud tl"><span class="hud dot" style="--c:var(--${m})"><b>${LABEL[m][0]}</b> <span class="mut">${LABEL[m][1]}</span></span></div>
          <div class="demo-hud tr"><span class="hud ro-out"></span></div>
          <div class="ro-prog" style="--c:var(--${m})"><i></i></div>
        </div>
      </figure>`).join('')}
    </div>
    <div class="demo-bar ro-ctrl">
      <button class="dbtn ro-play" type="button" aria-label="Pause">${PAUSE}</button>
      <input class="drange ro-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Scrub both videos">
      <span class="ro-time">0:00 / 0:00</span>
      <div class="seg ro-speed" role="group" aria-label="Playback speed">${SPEEDS.map(s => `<button type="button" data-s="${s}">${s}&times;</button>`).join('')}</div>
      <div class="seg ro-trials" role="group" aria-label="Trial"></div>
    </div>
    <div class="ro-results"></div>
    <div class="demo-note"></div>`;

  const $ = s => el.querySelector(s);
  const players = ['r2r2r', 'ours'].map(m => {
    const fig = el.querySelector(`.ro-player[data-m="${m}"]`);
    return { m, fig, v: fig.querySelector('video'), out: fig.querySelector('.ro-out'), bar: fig.querySelector('.ro-prog i'),
             frame: fig.querySelector('.ro-frame'), dur: 1, clip: null };
  });
  const playBtn = $('.ro-play'), scrub = $('.ro-scrub'), time = $('.ro-time');

  function seg(container, items, active, onPick) {
    container.innerHTML = items.map(([k, label]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === active}">${label}</button>`).join('');
    container.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onPick(b.dataset.k)));
  }
  function renderTabs() {
    seg($('.ro-robot'), robots.map(r => [r, esc(RES.robots[r] || r)]), st.robot, r => {
      if (r === st.robot) return;
      st.robot = r; st.task = manifest.tasks.find(t => t.robot === r); st.trial = 0; setPair();
    });
    const tasks = manifest.tasks.filter(t => t.robot === st.robot);
    seg($('.ro-task'), tasks.map(t => [t.key, esc(t.task)]), st.task.key, k => {
      if (k === st.task.key) return;
      st.task = tasks.find(t => t.key === k); st.trial = 0; setPair();
    });
    seg($('.ro-trials'), st.task.pairs.map((_, i) => [String(i), st.task.pairs.length > 1 ? `Trial ${i + 1}` : 'Trial 1']), String(st.trial), k => {
      if (+k === st.trial) return;
      st.trial = +k; setPair();
    });
    seg($('.ro-speed'), SPEEDS.map(s => [String(s), `${s}&times;`]), String(st.speed), k => {
      st.speed = +k; renderTabs(); players.forEach(p => { p.v.playbackRate = st.speed; });
    });
  }

  function renderResults() {
    const rows = (RES.results[st.robot] || []).find(r => r[0] === st.task.task);
    const methods = RES.methods.length ? RES.methods : [['teleop', 'Teleoperation'], ['r2r2r', 'R2R2R+'], ['ours', 'R2Sem2R']];
    let h = `<div class="rh">Real-robot success, ${esc(RES.robots[st.robot] || st.robot)} &middot; ${esc(st.task.task)}<span>all trials</span></div><div class="rows">`;
    methods.forEach(([k, name], i) => {
      const c = rows ? rows[i + 1] : null, short = name.split(' (')[0], vid = k !== 'teleop' ? ' vid' : '';
      if (!c) { h += `<div class="row pending${vid}"><div class="rl">${esc(short)}<span>running</span></div><div class="track"></div></div>`; return; }
      h += `<div class="row${vid}"><div class="rl">${esc(short)}<span>${pct(c)}% &middot; ${c[0]}/${c[1]}</span></div>` +
           `<div class="track"><div class="fill ${k}" style="width:${pct(c)}%"></div></div></div>`;
    });
    $('.ro-results').innerHTML = h + '</div>';
    const n = st.task.pairs.length;
    $('.demo-note').innerHTML = `${n > 1 ? `Trial ${st.trial + 1} of ${n} shown` : 'One trial shown'} for each policy, played in sync from
      the start of the trial at ${st.speed}&times; speed. The bars give the success rate over every real-robot trial;
      ${st.task.pairs.some(p => p.r2r2r.outcome || p.ours.outcome) ? 'a badge marks the outcome where the clip shows it unambiguously.' : 'outcomes are not marked for this task.'}`;
  }

  function setOutcome(p) {
    const o = p.clip.outcome;
    p.out.className = 'hud ro-out' + (o === 'success' ? ' s' : o === 'fail' ? ' f' : '');
    p.out.textContent = o === 'success' ? 'Success' : o === 'fail' ? 'Failure' : '';
    p.out.style.display = o ? '' : 'none';
  }

  // the longer clip drives the clock; the other follows and holds its last frame when it ends
  const master = () => (players[0].dur >= players[1].dur ? players[0] : players[1]);
  const total = () => Math.max(players[0].dur, players[1].dur);

  function load() {
    players.forEach(p => {
      if (p.v.getAttribute('src') !== p.src) { p.v.src = p.src; p.v.load(); }
      p.v.playbackRate = st.speed;
    });
    st.loaded = true;
  }
  function unload() {
    players.forEach(p => { p.v.pause(); p.v.removeAttribute('src'); p.v.load(); });
    st.loaded = false;
  }

  function setPair() {
    const pair = st.task.pairs[st.trial];
    players.forEach(p => {
      p.clip = pair[p.m]; p.dur = p.clip.dur; p.src = new URL(p.clip.src, BASE).href;
      p.v.pause(); p.v.poster = new URL(p.clip.poster, BASE).href;
      p.v.removeAttribute('src'); p.v.load();
      p.frame.style.aspectRatio = ASPECT[st.robot] || '16 / 9';
      p.fig.classList.remove('done'); p.bar.style.width = '0%';
      setOutcome(p);
    });
    st.loaded = false; st.holdUntil = 0;
    renderTabs(); renderResults(); setTime(0);
    if (st.visible) { load(); seekAll(0); if (st.playing) playAll(); }
  }

  function playAll() {
    st.playing = true; playBtn.innerHTML = PAUSE; playBtn.setAttribute('aria-label', 'Pause');
    if (!st.loaded) return;
    const t = master().v.currentTime || 0;
    players.forEach(p => {
      p.v.playbackRate = st.speed;
      if (t < p.dur - 0.05) p.v.play().catch(() => { pauseAll(); });
    });
  }
  function pauseAll() {
    st.playing = false; playBtn.innerHTML = PLAY; playBtn.setAttribute('aria-label', 'Play');
    players.forEach(p => p.v.pause());
  }
  function seekAll(t) {
    players.forEach(p => {
      const tt = Math.min(t, Math.max(0, p.dur - 0.05));
      try { p.v.currentTime = tt; } catch (e) { /* not loaded yet */ }
      p.fig.classList.toggle('done', t >= p.dur - 0.06);
    });
  }
  function setTime(t) {
    const T = total();
    if (!st.scrubbing) scrub.value = String(Math.round(1000 * Math.min(1, t / T)));
    time.textContent = `${fmt(t)} / ${fmt(T)}`;
    players.forEach(p => { p.bar.style.width = (100 * Math.min(1, t / p.dur)).toFixed(2) + '%'; });
  }

  playBtn.addEventListener('click', () => {
    if (st.playing) { pauseAll(); return; }
    if (!st.loaded) load();
    if (master().v.currentTime >= master().dur - 0.06) { seekAll(0); players.forEach(p => p.fig.classList.remove('done')); }
    st.holdUntil = 0; playAll();
  });
  scrub.addEventListener('input', () => {
    if (!st.scrubbing) { st.scrubbing = true; st.wasPlaying = st.playing; pauseAll(); }
    if (!st.loaded) load();
    const t = (+scrub.value / 1000) * total();
    seekAll(t); setTime(t); st.holdUntil = 0;
  });
  scrub.addEventListener('change', () => { st.scrubbing = false; if (st.wasPlaying) playAll(); });

  let raf = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!st.loaded) return;
    const M = master(), F = M === players[0] ? players[1] : players[0];
    const t = M.v.currentTime || 0;
    if (!st.scrubbing) setTime(t);
    if (!st.playing) return;
    // follower: hold its last frame once done, otherwise stay within 0.08 s of the master
    if (t >= F.dur - 0.05) {
      if (!F.v.paused) F.v.pause();
      F.fig.classList.add('done');
    } else {
      F.fig.classList.remove('done');
      const d = t - F.v.currentTime;
      if (Math.abs(d) > 0.6) { F.v.currentTime = t; F.v.playbackRate = st.speed; }
      else if (Math.abs(d) > 0.08) F.v.playbackRate = st.speed * (1 + Math.max(-0.25, Math.min(0.25, d)));
      else F.v.playbackRate = st.speed;
      if (F.v.paused && !M.v.paused) F.v.play().catch(() => {});
    }
    // master at its end: hold both last frames, then loop
    if (M.v.ended || t >= M.dur - 0.05) {
      M.fig.classList.add('done');
      if (!st.holdUntil) st.holdUntil = now + HOLD * 1000;
      else if (now >= st.holdUntil) {
        st.holdUntil = 0; seekAll(0); players.forEach(p => p.fig.classList.remove('done')); playAll();
      }
    } else {
      M.fig.classList.remove('done');
      if (M.v.paused && !M.v.seeking && M.v.readyState >= 2) M.v.play().catch(() => pauseAll());
    }
  }

  // only the demo on screen plays; clips are dropped when the demo scrolls far away
  const io = new IntersectionObserver(es => {
    const vis = es[0].isIntersecting;
    if (vis === st.visible) return;
    st.visible = vis;
    if (vis) {
      const t = st.resumeAt || 0;
      load(); seekAll(t);
      if (st.playing) playAll();
      if (!raf) raf = requestAnimationFrame(tick);
    } else {
      st.resumeAt = master().v.currentTime || 0;
      const keep = st.playing;
      players.forEach(p => p.v.pause()); unload(); st.playing = keep;
      cancelAnimationFrame(raf); raf = 0;
    }
  }, { rootMargin: '150px 0px' });
  io.observe(el);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) players.forEach(p => p.v.pause());
    else if (st.visible && st.playing) playAll();
  });

  setPair();
}
