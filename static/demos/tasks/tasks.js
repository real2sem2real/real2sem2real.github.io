// The four tasks: for each one, the single human demonstration and real rollouts on the xArm7 and the Franka Panda,
// looping in sync (robot clips are sped up to the length of the human video). Clips are listed in manifest.json.
import { REDUCED, PLAY, PAUSE, esc, ensureCss, video, SyncGroup, whenVisible, seg } from './loopkit.js';

const BASE = new URL('./', import.meta.url);
const COLS = { human: 'Human demonstration', xarm7: 'xArm7', panda: 'Franka Panda' };
const SHORT = { human: 'Human', xarm7: 'xArm7', panda: 'Panda' };
const NAMES = { place: 'Place', pour: 'Pour', hang: 'Hang', drill: 'Drill' };
const phone = () => matchMedia('(max-width:620px)').matches;
const url = p => new URL(p, BASE).href;

function tile(c, modal = false) {
  const fig = document.createElement('figure');
  fig.className = 'lk-tile tk-tile'; fig.style.aspectRatio = c.aspect;
  if (!c.src) {
    fig.classList.add('lk-empty');
    fig.innerHTML = `<div><b>${COLS[c.col]}</b>Real-robot clip of this task to come.</div>`;
    return [fig, null];
  }
  const v = video(url(c.src), url(c.poster));
  fig.appendChild(v);
  fig.insertAdjacentHTML('beforeend',
    `<div class="demo-hud tl"><span class="hud col">${SHORT[c.col]}</span></div>
     <div class="demo-hud tr"><span class="hud">${c.speed === 1 ? 'real time' : `${c.speed.toFixed(1)}&times;`}</span></div>`);
  if (!modal) fig.setAttribute('aria-label', `${COLS[c.col]}, enlarge`);
  return [fig, v];
}

export async function mount(el) {
  ensureCss(url('loopkit.css'));
  const { tasks } = await (await fetch(url('manifest.json'))).json();
  el.classList.add('tk');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top tk-top"><div class="seg tk-seg" role="group" aria-label="Task"></div></div>
    <div class="lk-stage">
      <div class="tk-head">${Object.values(COLS).map(c => `<span>${c}</span>`).join('')}</div>
      <div class="tk-rows"></div>
    </div>
    <div class="demo-bar">
      <button class="dbtn lk-play" type="button" aria-label="Pause">${PAUSE}</button>
      <span class="dlabel tk-note">Each row loops in sync; robot clips are sped up to the length of the human video.<span class="tk-enl"> Click a clip to enlarge its row.</span></span>
    </div>
`;
  // the enlarged row lives on <body>: the demo box is transformed and clips, which would trap a fixed overlay inside it
  const modal = document.createElement('div');
  modal.className = 'tk-modal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `<div class="tk-modal-in">
      <div class="demo-bar lk-bar-top"><b class="tk-mtitle" style="font-size:13.5px"></b><span class="sp"></span>
        <button class="dbtn ghost tk-close" type="button">Close</button></div>
      <div class="lk-stage"><div class="tk-tiles tk-mtiles"></div></div></div>`;
  document.body.appendChild(modal);
  const $m = s => modal.querySelector(s);
  const $ = s => el.querySelector(s);
  const rowsEl = $('.tk-rows'), playBtn = $('.lk-play');
  const st = { active: tasks[0].key, playing: !REDUCED, visible: false, modalGroup: null };

  const rows = tasks.map(t => {
    const row = document.createElement('div'); row.className = 'tk-row'; row.dataset.k = t.key;
    row.innerHTML = `<div class="tk-label">${esc(t.task)}</div><div class="tk-tiles"></div>`;
    const vids = [];
    t.clips.forEach(c => {
      const [fig, v] = tile(c); row.querySelector('.tk-tiles').appendChild(fig); if (v) vids.push(v);
      fig.addEventListener('click', () => { if (!phone()) openModal(t); });
    });
    rowsEl.appendChild(row);
    return { t, row, group: new SyncGroup(vids, { hold: 0.8 }) };
  });

  seg($('.tk-seg'), tasks.map(t => [t.key, NAMES[t.key] || esc(t.task)]), st.active, k => { st.active = k; refresh(); });

  const shown = () => rows.filter(r => !phone() || r.t.key === st.active);
  function refresh() {
    rows.forEach(r => r.row.classList.toggle('on', r.t.key === st.active));
    const on = st.visible && modal.hidden ? shown() : [];
    rows.forEach(r => {
      if (on.includes(r)) { r.group.load(); if (st.playing) r.group.play(); else r.group.pause(); }
      else if (r.group.loaded) r.group.unload();
    });
  }
  function setPlaying(p) {
    st.playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (st.modalGroup) { p ? st.modalGroup.play() : st.modalGroup.pause(); } else refresh();
  }
  playBtn.addEventListener('click', () => setPlaying(!st.playing));
  if (!st.playing) setPlaying(false);

  function openModal(t) {
    const box = $m('.tk-mtiles'); box.innerHTML = ''; $m('.tk-mtitle').textContent = t.task;
    const vids = [];
    t.clips.forEach(c => { const [fig, v] = tile(c, true); box.appendChild(fig); if (v) vids.push(v); });
    modal.hidden = false; refresh();
    st.modalGroup = new SyncGroup(vids, { hold: 0.8 });
    st.modalGroup.load(); if (st.playing) st.modalGroup.play();
    $m('.tk-close').focus();
  }
  function closeModal() {
    if (modal.hidden) return;
    if (st.modalGroup) { st.modalGroup.unload(); st.modalGroup.stop(); st.modalGroup = null; }
    $m('.tk-mtiles').innerHTML = ''; modal.hidden = true; refresh();
  }
  $m('.tk-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  matchMedia('(max-width:620px)').addEventListener('change', () => { closeModal(); refresh(); });

  whenVisible(el, () => { st.visible = true; refresh(); }, () => { st.visible = false; refresh(); });
  refresh();
}
