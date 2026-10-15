// Mug from one side-view photo: silhouette -> body profile + handle centreline (pure functions, no three.js).
//
//   mask (Uint8Array, 1 = mug) at image resolution  ->  {
//     side (+1 handle on the image right, -1 left), xc (axis column, px), yTop, yBot (px), s (m per px),
//     profile: [{z, r}] in metres (bottom -> top), handle: {pts: [[x, z]] metres in the handle plane, thick (m)},
//     bodyColor, rimColor: [r, g, b] }
// Assumptions: the mug stands upright and the handle points left or right in the photo. The body is what survives a
// morphological opening (the handle is thinner than the opening radius); the handle is the largest remaining part.

// exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher) to the pixels where sites[i] = 1
export function edt(sites, W, H) {
  const INF = 1e20, out = new Float32Array(W * H), f = new Float32Array(Math.max(W, H));
  const d = new Float32Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float32Array(Math.max(W, H) + 1);
  const pass = n => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) {                                        // columns
    for (let y = 0; y < H; y++) f[y] = sites[y * W + x] ? 0 : INF;
    pass(H);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {                                        // rows
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    pass(W);
    for (let x = 0; x < W; x++) out[y * W + x] = d[x];
  }
  return out;
}

// connected components (4-connected); returns {labels, sizes}
export function components(m, W, H) {
  const lab = new Int32Array(W * H).fill(-1), sizes = [], st = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    const id = sizes.length; let n = 0, sp = 0; st[sp++] = i; lab[i] = id;
    while (sp) {
      const p = st[--sp]; n++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && m[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; st[sp++] = p - 1; }
      if (x < W - 1 && m[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; st[sp++] = p + 1; }
      if (y > 0 && m[p - W] && lab[p - W] < 0) { lab[p - W] = id; st[sp++] = p - W; }
      if (y < H - 1 && m[p + W] && lab[p + W] < 0) { lab[p + W] = id; st[sp++] = p + W; }
    }
    sizes.push(n);
  }
  return { labels: lab, sizes };
}

const median = a => { const b = Float64Array.from(a).sort(); return b.length ? b[b.length >> 1] : NaN; };

// handle centreline by angular bins around a point inside the handle's loop: for every bin (from just above the body,
// over the top, out, and down to just below it) the mean radius of the handle pixels in that bin gives a centreline
// point and their radial spread its thickness. pix: [[u, v], ...] handle pixels (u outward, v up). Same construction as
// the offline reference for the demonstrated mug (build_mymug.py).
export function handleCenterline(pix, origin, a0 = 175, a1 = -175, nBins = 70) {
  const S = new Float64Array(nBins), N = new Float64Array(nBins), lo = new Float64Array(nBins).fill(1e9), hi = new Float64Array(nBins).fill(-1e9);
  const span = a0 - a1;
  for (const [u, v] of pix) {
    const du = u - origin[0], dv = v - origin[1], a = Math.atan2(dv, du) * 180 / Math.PI;
    const k = Math.floor((a0 - a) / span * nBins); if (k < 0 || k >= nBins) continue;
    const r = Math.hypot(du, dv); S[k] += r; N[k]++; if (r < lo[k]) lo[k] = r; if (r > hi[k]) hi[k] = r;
  }
  const pts = [], th = [];
  for (let k = 0; k < nBins; k++) {
    if (N[k] < 3) continue;
    const a = (a0 - (k + 0.5) / nBins * span) * Math.PI / 180, r = S[k] / N[k];
    pts.push([origin[0] + r * Math.cos(a), origin[1] + r * Math.sin(a)]); th.push(hi[k] - lo[k]);
  }
  return { pts, th };
}

export function reconstruct(mask, W, H, img, { height = 0.09 } = {}) {
  // bounding box + work grid (long side <= 360 px)
  let x0 = W, x1 = -1, y0 = H, y1 = -1, area = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (area < 400) return { error: 'The mask is too small. Tap the middle of the mug.' };
  const pad = 6, bw = x1 - x0 + 1 + 2 * pad, bh = y1 - y0 + 1 + 2 * pad;
  const f = Math.min(1, 360 / Math.max(bw, bh)), w = Math.max(8, Math.round(bw * f)), h = Math.max(8, Math.round(bh * f));
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(W - 1, Math.max(0, Math.round(x0 - pad + (x + 0.5) / f - 0.5))), sy = Math.min(H - 1, Math.max(0, Math.round(y0 - pad + (y + 0.5) / f - 0.5)));
    M[y * w + x] = mask[sy * W + sx];
  }
  // keep the largest component and fill its holes (the handle's hole stays: it touches the outside)
  { const c = components(M, w, h); let best = 0; c.sizes.forEach((s, i) => { if (s > c.sizes[best]) best = i; });
    for (let i = 0; i < w * h; i++) M[i] = c.labels[i] === best ? 1 : 0; }
  // opening: erode by r, dilate by r
  const mw = (x1 - x0 + 1) * f, r = Math.max(3, 0.1 * mw), r2 = r * r;
  const bg = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) bg[i] = M[i] ? 0 : 1;
  const dBg = edt(bg, w, h), E = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) E[i] = dBg[i] > r2 ? 1 : 0;
  const dE = edt(E, w, h), O = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) O[i] = M[i] && dE[i] <= r2 ? 1 : 0;
  { const c = components(O, w, h); if (!c.sizes.length) return { error: 'Could not find the mug body in the mask.' };
    let best = 0; c.sizes.forEach((s, i) => { if (s > c.sizes[best]) best = i; });
    for (let i = 0; i < w * h; i++) O[i] = c.labels[i] === best ? 1 : 0; }
  // axis: median of the opened body's row centres (middle 80 % of its rows)
  const rowsO = []; for (let y = 0; y < h; y++) { let a = -1, b = -1; for (let x = 0; x < w; x++) if (O[y * w + x]) { if (a < 0) a = x; b = x; } if (a >= 0) rowsO.push([y, a, b]); }
  const n0 = rowsO.length, mid = rowsO.slice(Math.floor(n0 * 0.1), Math.ceil(n0 * 0.9));
  const xc = median(mid.map(r_ => 0.5 * (r_[1] + r_[2])));
  // handle = mug minus the (slightly grown) body, largest part
  const dO = edt(O, w, h), Hm = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) Hm[i] = M[i] && dO[i] > 4 ? 1 : 0;
  let side = 0, hArea = 0;
  { const c = components(Hm, w, h); let best = -1; c.sizes.forEach((s, i) => { if (best < 0 || s > c.sizes[best]) best = i; });
    if (best >= 0) { hArea = c.sizes[best]; let sx = 0; for (let i = 0; i < w * h; i++) { Hm[i] = c.labels[i] === best ? 1 : 0; if (Hm[i]) sx += i % w; } side = sx / hArea > xc ? 1 : -1; } }
  const mArea = M.reduce((a, b) => a + b, 0);
  if (!side || hArea < 0.015 * mArea) return { error: 'No handle found. Use a side view with the handle on the left or right.' };
  // body radius per row: the clean side (away from the handle), capped by the handle side up to its first gap (so a
  // stray bit of background on the clean side cannot widen the mug); rows outside the mug get NaN
  let yTop = h, yBot = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M[y * w + x] && !Hm[y * w + x]) { if (y < yTop) yTop = y; if (y > yBot) yBot = y; }
  const rad = new Float64Array(h).fill(NaN), xcR = Math.round(xc);
  for (let y = yTop; y <= yBot; y++) {
    let clean = NaN, gap = NaN;
    if (side > 0) { for (let x = 0; x < w; x++) if (M[y * w + x]) { clean = xc - x + 0.5; break; } }
    else { for (let x = w - 1; x >= 0; x--) if (M[y * w + x]) { clean = x - xc + 0.5; break; } }
    if (M[y * w + xcR]) for (let x = xcR; x >= 0 && x < w; x += side) if (!M[y * w + x]) { gap = side * (x - xc) - 0.5; break; }
    rad[y] = gap > 0 ? Math.min(clean, gap) : clean;
  }
  // smooth with a running median (5 % of the height)
  { const r0 = Float64Array.from(rad), hw = Math.max(2, Math.round(0.025 * (yBot - yTop)));
    for (let y = yTop; y <= yBot; y++) { const a2 = []; for (let k = y - hw; k <= y + hw; k++) if (k >= yTop && k <= yBot && r0[k] > 0) a2.push(r0[k]); rad[y] = a2.length ? median(a2) : NaN; } }
  // the handle: mug pixels beyond the body edge on the handle side, largest part
  Hm.fill(0);
  for (let y = yTop; y <= yBot + 2 && y < h; y++) {
    const r_ = rad[Math.min(yBot, y)]; if (!(r_ > 0)) continue;
    for (let x = 0; x < w; x++) if (M[y * w + x] && side * (x - xc) > r_ + 1.5) Hm[y * w + x] = 1;
  }
  { const c = components(Hm, w, h); let best = -1; c.sizes.forEach((s2, i) => { if (best < 0 || s2 > c.sizes[best]) best = i; });
    hArea = best >= 0 ? c.sizes[best] : 0; for (let i = 0; i < w * h; i++) Hm[i] = best >= 0 && c.labels[i] === best ? 1 : 0; }
  if (hArea < 0.015 * mArea) return { error: 'No handle found. Use a side view with the handle on the left or right.' };
  const Hpx = yBot - yTop + 1, s = height / Hpx;                       // metres per work pixel
  const K = 36, profile = [];
  for (let k = 0; k < K; k++) {
    const y = yBot - (k / (K - 1)) * (Hpx - 1), acc = [];
    for (let dy = -2; dy <= 2; dy++) { const yy = Math.round(y + dy); if (yy >= yTop && yy <= yBot && rad[yy] > 0) acc.push(rad[yy]); }
    profile.push({ z: (k / (K - 1)) * height, r: Math.max(0.004, (acc.length ? median(acc) : NaN) * s) });
  }
  for (let k = 0; k < K; k++) if (!(profile[k].r > 0)) profile[k].r = profile[Math.max(0, k - 1)].r || 0.035;
  for (let k = 0; k < 2; k++) profile[k].r = 0.95 * profile[2].r;                 // the silhouette's first and last rows are
  for (let k = K - 2; k < K; k++) profile[k].r = profile[K - 3].r;                // the foot's and the rim's ellipse edges
  // handle centreline in the handle plane: u = outward from the axis, v = up from the bottom (work pixels)
  // the loop's hole: background pixels inside the handle's bounding box, beyond the body edge, not touching the box's
  // outer edge; its centroid is the ray origin (fallback: 40 % of the way from the wall to the handle's outer edge)
  let hx0 = w, hx1 = -1, hy0 = h, hy1 = -1;
  for (let i = 0; i < w * h; i++) if (Hm[i]) { const x = i % w, y = (i / w) | 0; if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y; }
  const hole = new Uint8Array(w * h);
  for (let y = hy0; y <= hy1; y++) for (let x = hx0; x <= hx1; x++) { const r_ = rad[y]; if (!M[y * w + x] && r_ > 0 && side * (x - xc) > r_) hole[y * w + x] = 1; }
  let origin = null;
  { const c = components(hole, w, h), sx = new Float64Array(c.sizes.length), sy = new Float64Array(c.sizes.length), open = new Uint8Array(c.sizes.length);
    for (let i = 0; i < w * h; i++) { const l = c.labels[i]; if (l < 0) continue; const x = i % w, y = (i / w) | 0; sx[l] += x; sy[l] += y;
      if (y === hy0 || y === hy1 || x === (side > 0 ? hx1 : hx0)) open[l] = 1; }
    let best = -1; c.sizes.forEach((s2, l) => { if (!open[l] && s2 > 12 && (best < 0 || s2 > c.sizes[best])) best = l; });
    if (best >= 0) origin = [side * (sx[best] / c.sizes[best] - xc), yBot - sy[best] / c.sizes[best]]; }
  if (!origin) { const yM = Math.round(0.5 * (hy0 + hy1)), rw = rad[yM] || 0, uo = side > 0 ? hx1 - xc : xc - hx0; origin = [rw + 0.4 * (uo - rw), yBot - yM]; }
  const pix = []; for (let i = 0; i < w * h; i++) if (Hm[i]) pix.push([side * ((i % w) - xc), yBot - ((i / w) | 0)]);
  const cl = handleCenterline(pix, origin);
  if (cl.pts.length < 8) return { error: 'The handle is too small or not to the side. Try another photo.' };
  // light smoothing, then metres
  const sm = cl.pts.map((p, i, a) => { let u = 0, v = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(a.length - 1, i + 2); j++) { u += a[j][0]; v += a[j][1]; n++; } return [u / n * s, v / n * s]; });
  const thick = Math.min(0.016, Math.max(0.005, median(cl.th) * s));
  // colours: body front (upper middle) and a darker inside tone
  const ctx = img.getContext('2d'), sample = (cx, cy, rr) => {
    const d = ctx.getImageData(Math.round(cx - rr), Math.round(cy - rr), Math.max(1, Math.round(2 * rr)), Math.max(1, Math.round(2 * rr))).data;
    let R = 0, G = 0, B = 0, n = 0; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return [R / n, G / n, B / n];
  };
  const toImg = (xw, yw) => [x0 - pad + (xw + 0.5) / f - 0.5, y0 - pad + (yw + 0.5) / f - 0.5];
  const rMid = rad[Math.round(yBot - 0.55 * Hpx)] || rad[Math.round(0.5 * (yTop + yBot))];
  const [bcx, bcy] = toImg(xc - side * 0.35 * rMid, yBot - 0.55 * Hpx);
  const bodyColor = sample(bcx, bcy, Math.max(2, 0.08 * rMid / f));
  // image-space mapping for textures and overlays (full-resolution pixels)
  const map = { x0, y0, pad, f, xc, yBot, side, s,
    toPhoto: (xm, zm) => toImg(xc + side * xm / s, yBot - zm / s) };
  return { side, xc, yTop, yBot, s, height, profile, handle: { pts: sm, thick }, bodyColor, map,
           debug: { w, h, M, O, Hm } };
}

// largest 4-connected component of a full-resolution mask (drops speckles SAM leaves along strong edges)
export function largestComponent(mask, W, H) {
  const c = components(mask, W, H); if (!c.sizes.length) return mask;
  let best = 0; c.sizes.forEach((s, i) => { if (s > c.sizes[best]) best = i; });
  const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) out[i] = c.labels[i] === best ? 1 : 0;
  return out;
}
