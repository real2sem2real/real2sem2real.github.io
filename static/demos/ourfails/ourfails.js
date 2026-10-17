// Where R2Sem2R still fails: the failed real-robot trials of our own policies, grouped by what went wrong, with one clip
// per group and how many of the reviewed failures fall in it. Every failure was labelled by watching its recording; the
// clips stop before any person reaches in. Clips and counts: manifest.json.
import { REDUCED, PLAY, PAUSE, esc, ensureCss, video, SyncGroup, whenVisible, seg } from '../tasks/loopkit.js';

const BASE = new URL('./', import.meta.url);
const url = p => new URL(p, BASE).href;
const ASPECT = { 'Franka Panda': '640 / 452', xArm7: '640 / 360' };
const SHORT = { 'Franka Panda': 'Panda', xArm7: 'xArm7' };
const TASK = { 'Mug on coffee machine': 'place', 'Pour into bowl': 'pour', 'Drill reorient': 'drill' };

export async function mount(el) {
  ensureCss(url('../tasks/loopkit.css')); ensureCss(url('ourfails.css'));
  const { rows } = await (await fetch(url('manifest.json'))).json();
  el.classList.add('of');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top"><div class="seg of-rows" role="group" aria-label="Robot and task"></div></div>
    <div class="lk-stage"><div class="of-grid"></div></div>
    <div class="demo-bar">
      <button class="dbtn lk-play" type="button" aria-label="Pause">${PAUSE}</button>
      <span class="dlabel of-note"></span>
    </div>`;
  const $ = s => el.querySelector(s);
  const grid = $('.of-grid'), playBtn = $('.lk-play');
  const st = { row: rows[0], playing: !REDUCED, visible: false, groups: [] };

  function each(fn) { st.groups.forEach(fn); }
  function setRow(r) {
    each(g => g.unload()); st.groups = []; st.row = r;
    grid.innerHTML = '';
    grid.style.setProperty('--cols', r.cats.length === 5 ? 3 : r.cats.length);
    for (const c of r.cats) {
      const fig = document.createElement('figure'); fig.className = 'of-card';
      const tile = document.createElement('div'); tile.className = 'lk-tile'; tile.style.aspectRatio = ASPECT[r.robot];
      const v = video(url(c.video), url(c.poster)); v.setAttribute('aria-label', `${r.robot}: ${c.title}`);
      tile.appendChild(v);
      tile.insertAdjacentHTML('beforeend',
        `<div class="demo-hud tl"><span class="hud of-count"><b>${c.count}</b> of ${r.failures}</span></div>` +
        `<div class="demo-hud tr"><span class="hud">${c.speed}&times;</span></div>`);
      fig.appendChild(tile);
      fig.insertAdjacentHTML('beforeend',
        `<div class="of-bar" aria-hidden="true"><i style="width:${(100 * c.count / r.failures).toFixed(1)}%"></i></div>` +
        `<figcaption><b>${esc(c.title)}.</b> ${esc(c.cap)}</figcaption>`);
      grid.appendChild(fig);
      st.groups.push(new SyncGroup([v], { hold: 0.9 }));
    }
    $('.of-note').innerHTML = `<b>${r.failures} failures reviewed.</b> ${esc(r.note)}`;
    if (st.visible) each(g => { g.load(); if (st.playing) g.play(); });
  }
  function setPlaying(p) {
    st.playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    each(g => (p ? g.play() : g.pause()));
  }
  playBtn.addEventListener('click', () => setPlaying(!st.playing));
  seg($('.of-rows'), rows.map(r => [r.key, `${SHORT[r.robot]} &middot; ${esc(TASK[r.task] || r.task)}`]),
      st.row.key, k => setRow(rows.find(r => r.key === k)));
  setPlaying(st.playing); setRow(st.row);
  whenVisible(el, () => { st.visible = true; each(g => { g.load(); if (st.playing) g.play(); }); },
              () => { st.visible = false; each(g => g.pause(true)); });
}
