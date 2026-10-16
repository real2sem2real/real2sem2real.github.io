// Shared helpers for the looping-video widgets (tasks, sims, failures, trackinit): a stylesheet loader, a group of
// muted inline videos played in sync from one clock, and a visibility gate so only widgets on screen decode video.
export const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
export const PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

// A <video> that loads only when asked (src kept in data-src), muted, inline, no controls.
export function video(src, poster) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'none';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', '');
  if (poster) v.poster = poster;
  v.dataset.src = src;
  return v;
}

// Several videos of (nearly) the same length played from one clock: the longest one leads, the others are nudged back
// within 0.12 s of it, each holds its last frame when it ends early, and the group loops after `hold` seconds.
export class SyncGroup {
  constructor(videos, { hold = 0.9, speed = 1, onTime = null } = {}) {
    this.v = videos.filter(Boolean); this.hold = hold; this.speed = speed; this.onTime = onTime;
    this.playing = false; this.loaded = false; this.holdUntil = 0; this.raf = 0; this.scrubbing = false;
    this.tick = this.tick.bind(this);
  }
  get master() { return this.v.reduce((a, b) => ((b.duration || 0) > (a.duration || 0) ? b : a), this.v[0]); }
  get duration() { return Math.max(...this.v.map(v => v.duration || 0)) || 0; }
  get time() { return this.master.currentTime || 0; }
  load() {
    if (this.loaded) return;
    this.v.forEach(v => { if (!v.getAttribute('src')) { v.src = v.dataset.src; v.load(); } v.playbackRate = this.speed; });
    this.loaded = true;
  }
  unload() {
    this.pause(true); this.stop();
    this.v.forEach(v => { v.removeAttribute('src'); v.load(); });
    this.loaded = false;
  }
  setSpeed(s) { this.speed = s; this.v.forEach(v => { v.playbackRate = s; }); }
  play() {
    this.load(); this.playing = true; this.holdUntil = 0;
    const t = this.time;
    this.v.forEach(v => { v.playbackRate = this.speed; if (t < (v.duration || 1e9) - 0.05) v.play().catch(() => {}); });
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }
  pause(keepState = false) {
    if (!keepState) this.playing = false;
    this.v.forEach(v => v.pause());
  }
  seek(t) {
    this.load(); this.holdUntil = 0;
    this.v.forEach(v => { try { v.currentTime = Math.min(t, Math.max(0, (v.duration || t + 1) - 0.04)); } catch (e) { /* metadata not loaded yet */ } });
    if (this.onTime) this.onTime(t, this.duration);
  }
  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.loaded) return;
    const M = this.master, t = M.currentTime || 0;
    if (this.onTime && !this.scrubbing) this.onTime(t, this.duration);
    if (!this.playing) return;
    for (const v of this.v) {
      if (v === M) continue;
      if (t >= (v.duration || 0) - 0.05) { if (!v.paused) v.pause(); continue; }
      const d = t - v.currentTime;
      if (Math.abs(d) > 0.5) v.currentTime = t;
      else if (Math.abs(d) > 0.12) v.playbackRate = this.speed * (1 + Math.max(-0.2, Math.min(0.2, d)));
      else v.playbackRate = this.speed;
      if (v.paused && !M.paused) v.play().catch(() => {});
    }
    if (M.ended || (M.duration && t >= M.duration - 0.05)) {
      if (!this.holdUntil) this.holdUntil = now + this.hold * 1000;
      else if (now >= this.holdUntil) { this.holdUntil = 0; this.seek(0); this.play(); }
    } else if (M.paused && !M.seeking && M.readyState >= 2) M.play().catch(() => {});
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
}

// Calls onShow / onHide as `el` scrolls into or far out of view, and pauses on hidden tabs.
export function whenVisible(el, onShow, onHide, margin = '120px 0px') {
  let vis = false;
  const io = new IntersectionObserver(es => {
    const v = es[es.length - 1].isIntersecting; if (v === vis) return; vis = v; (v ? onShow : onHide)();   // latest entry wins
  }, { rootMargin: margin });
  io.observe(el);
  document.addEventListener('visibilitychange', () => { if (!vis) return; document.hidden ? onHide() : onShow(); });
  return () => vis;
}

// Segmented control in the style of core/ui.css.
export function seg(container, items, active, onPick) {
  container.innerHTML = items.map(([k, label]) =>
    `<button type="button" data-k="${esc(k)}" aria-pressed="${k === active}">${label}</button>`).join('');
  container.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    container.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.k);
  }));
}
