// Common failure modes of real-to-sim pipelines, side by side with the real scene: tracking (looping renders of the
// mug and the machine at each tracker's poses over the faded video), grasping and meshes. Media list: manifest.json.
import { REDUCED, PLAY, PAUSE, esc, ensureCss, video, SyncGroup, whenVisible, seg } from '../tasks/loopkit.js';

const BASE = new URL('./', import.meta.url);
const url = p => new URL(p, BASE).href;
const COLS = [['gt', 'Real'], ['prior', 'Prior'], ['ours', 'R2Sem2R']];

function media(m) {
  if (m.video) return video(url(m.video), url(m.poster));
  const img = new Image(); img.src = url(m.img); img.alt = m.alt || ''; img.loading = 'lazy'; img.decoding = 'async';
  return img;
}

export async function mount(el) {
  ensureCss(new URL('../tasks/loopkit.css', BASE).href);
  const { rows } = await (await fetch(url('manifest.json'))).json();
  el.classList.add('fm');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top">
      <div class="seg fm-rows" role="group" aria-label="Failure mode"></div>
      <div class="seg fm-cols" role="group" aria-label="Column"></div>
    </div>
    <div class="lk-stage"><div class="fm-grid">${COLS.map(([c]) => `<figure class="fm-col" data-c="${c}"><div class="lk-tile"></div><figcaption class="fm-cap"></figcaption></figure>`).join('')}</div></div>
    <div class="demo-bar">
      <button class="dbtn lk-play" type="button" aria-label="Pause">${PAUSE}</button>
      <span class="dlabel fm-note"></span>
    </div>`;
  const $ = s => el.querySelector(s);
  const playBtn = $('.lk-play');
  const st = { row: rows[0], col: 'prior', playing: !REDUCED, visible: false, group: null };

  function setRow(r) {
    if (st.group) { st.group.unload(); st.group = null; }
    st.row = r;
    const vids = [];
    COLS.forEach(([c, name]) => {
      const m = r[c], fig = el.querySelector(`.fm-col[data-c="${c}"]`), box = fig.querySelector('.lk-tile');
      box.innerHTML = ''; const node = media(m); box.appendChild(node); if (m.video) vids.push(node);
      const mark = c === 'prior' ? '<span class="lk-badge no" aria-label="fails">&times;</span>' : c === 'ours' ? '<span class="lk-badge ok" aria-label="works">&check;</span>' : '';
      box.insertAdjacentHTML('beforeend', `<div class="demo-hud tl"><span class="hud">${mark}<b>${esc(m.label || name)}</b></span></div>` +
        (m.stat ? `<div class="demo-hud tr"><span class="hud">${m.stat}</span></div>` : ''));
      fig.querySelector('.fm-cap').innerHTML = m.cap;
    });
    $('.fm-note').innerHTML = r.note || '';
    playBtn.style.display = vids.length ? '' : 'none';
    if (vids.length) {
      st.group = new SyncGroup(vids, { hold: 0.6 });
      if (st.visible) { st.group.load(); if (st.playing) st.group.play(); }
    }
  }
  function setCol(c) { st.col = c; el.querySelectorAll('.fm-col').forEach(f => f.classList.toggle('on', f.dataset.c === c)); }
  function setPlaying(p) {
    st.playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (st.group) { p ? st.group.play() : st.group.pause(); }
  }
  playBtn.addEventListener('click', () => setPlaying(!st.playing));
  seg($('.fm-rows'), rows.map(r => [r.key, esc(r.name)]), st.row.key, k => setRow(rows.find(r => r.key === k)));
  seg($('.fm-cols'), COLS.map(([c, n]) => [c, n]), st.col, setCol);
  setCol(st.col); setPlaying(st.playing); setRow(st.row);
  whenVisible(el, () => { st.visible = true; if (st.group) { st.group.load(); if (st.playing) st.group.play(); } },
              () => { st.visible = false; if (st.group) st.group.pause(true); });
}
