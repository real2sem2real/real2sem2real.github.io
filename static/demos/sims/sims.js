// One generated episode in both simulators: IsaacSim replays the planned motion kinematically, MuJoCo re-simulates the
// same plan with contact physics. Both play in sync; the phase markers come from the episode record (manifest.json).
import { REDUCED, PLAY, PAUSE, esc, ensureCss, video, SyncGroup, whenVisible, seg } from '../tasks/loopkit.js';

const BASE = new URL('./', import.meta.url);
const url = p => new URL(p, BASE).href;
const SPEEDS = [1, 2, 4];
const fmt = t => { t = Math.max(0, t); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const SHORT = l => l.replace('Demonstrated pair', 'Demonstrated').replace('Cousin pair ', 'Cousin ');

export async function mount(el) {
  ensureCss(new URL('../tasks/loopkit.css', BASE).href);
  const { pairs } = await (await fetch(url('manifest.json'))).json();
  el.classList.add('sm');
  el.innerHTML = `
    <div class="demo-bar lk-bar-top"><span class="dlabel">Mug and machine</span><div class="seg sm-seg" role="group" aria-label="Object pair"></div></div>
    <div class="lk-stage"><div class="sm-pair">
      <figure class="lk-tile" data-s="isaac"><div class="demo-hud tl"><span class="hud dot" style="--c:var(--accent)"><b>IsaacSim</b> <span class="mut">kinematic replay</span></span></div>
        <div class="demo-hud tr"><span class="hud sm-ph"></span></div></figure>
      <figure class="lk-tile" data-s="mujoco"><div class="demo-hud tl"><span class="hud dot" style="--c:var(--orange)"><b>MuJoCo</b> <span class="mut">contact physics</span></span></div>
        <div class="demo-hud tr"><span class="hud sm-ph"></span></div></figure>
    </div></div>
    <div class="demo-bar">
      <button class="dbtn lk-play" type="button" aria-label="Pause">${PAUSE}</button>
      <div class="sm-scrub"><input class="drange" type="range" min="0" max="1000" value="0" aria-label="Scrub both simulators"><div class="sm-ticks"></div></div>
      <span class="lk-time">0:00 / 0:00</span>
      <div class="seg sm-speed" role="group" aria-label="Playback speed"></div>
    </div>
    <div class="sm-phases" role="group" aria-label="Jump to a phase"></div>
    <div class="demo-note">The same plan in both: the robot follows identical joint targets, the camera and the objects start
      at the same poses. IsaacSim carries the mug with the gripper; MuJoCo simulates the grasp, the carry and the release
      under gravity, and the episode is kept only if the mug comes to rest on the tray.</div>`;
  const $ = s => el.querySelector(s);
  const tiles = { isaac: $('[data-s="isaac"]'), mujoco: $('[data-s="mujoco"]') };
  const scrub = $('.sm-scrub input'), time = $('.lk-time'), playBtn = $('.lk-play');
  const st = { pair: pairs[0], speed: 2, playing: !REDUCED, visible: false, group: null };

  function phaseAt(t) {
    const f = t * st.pair.fps; let cur = st.pair.phases[0];
    for (const p of st.pair.phases) if (f >= p.frame - 0.5) cur = p;
    return cur;
  }
  function onTime(t, T) {
    T = T || st.pair.frames / st.pair.fps;
    if (!st.scrubbing) scrub.value = String(Math.round(1000 * Math.min(1, t / T)));
    time.textContent = `${fmt(t)} / ${fmt(T)}`;
    const ph = phaseAt(t);
    el.querySelectorAll('.sm-ph').forEach(h => { h.textContent = ph.name; });
    el.querySelectorAll('.sm-phases button').forEach(b => b.classList.toggle('on', b.dataset.n === ph.name));
  }
  function setPair(p) {
    if (st.group) { st.group.unload(); }
    st.pair = p;
    const vids = ['isaac', 'mujoco'].map(s => {
      tiles[s].querySelector('video')?.remove();
      const v = video(url(p[s].src), url(p[s].poster)); tiles[s].prepend(v); return v;
    });
    st.group = new SyncGroup(vids, { hold: 1.2, speed: st.speed, onTime });
    const T = p.frames / p.fps;
    $('.sm-ticks').innerHTML = p.phases.slice(1).map(ph => `<i style="left:${(100 * ph.frame / p.fps / T).toFixed(2)}%" title="${esc(ph.name)}"></i>`).join('');
    $('.sm-phases').innerHTML = p.phases.map(ph => `<button type="button" data-n="${esc(ph.name)}" data-f="${ph.frame}">${esc(ph.name)}</button>`).join('');
    $('.sm-phases').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      st.group.seek(+b.dataset.f / p.fps + 0.05); onTime(+b.dataset.f / p.fps, T);
    }));
    onTime(0, T);
    if (st.visible) { st.group.load(); st.playing ? st.group.play() : st.group.seek(0); }
  }
  function setPlaying(p) {
    st.playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (!st.group) return;
    if (p) st.group.play(); else st.group.pause();
  }
  playBtn.addEventListener('click', () => setPlaying(!st.playing));
  scrub.addEventListener('input', () => {
    if (!st.scrubbing) { st.scrubbing = true; st.wasPlaying = st.playing; st.group.pause(); st.group.scrubbing = true; }
    const T = st.pair.frames / st.pair.fps, t = (+scrub.value / 1000) * T;
    st.group.seek(t); onTime(t, T);
  });
  scrub.addEventListener('change', () => { st.scrubbing = false; st.group.scrubbing = false; if (st.wasPlaying) st.group.play(); });

  seg($('.sm-seg'), pairs.map(p => [p.key, esc(SHORT(p.label))]), st.pair.key, k => setPair(pairs.find(p => p.key === k)));
  seg($('.sm-speed'), SPEEDS.map(s => [String(s), `${s}&times;`]), String(st.speed), k => { st.speed = +k; st.group.setSpeed(st.speed); });
  setPlaying(st.playing);
  setPair(st.pair);
  whenVisible(el, () => { st.visible = true; st.group.load(); if (st.playing) st.group.play(); else st.group.seek(st.group.time); },
              () => { st.visible = false; st.group.pause(true); });
}
