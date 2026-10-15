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
  let bx = 0, xcAt = () => xc;                         // set below, once we know which side the handle is on
  // handle = mug minus the (slightly grown) body, largest part
  const dO = edt(O, w, h), Hm = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) Hm[i] = M[i] && dO[i] > 4 ? 1 : 0;
  let side = 0, hArea = 0;
  { const c = components(Hm, w, h); let best = -1; c.sizes.forEach((s, i) => { if (best < 0 || s > c.sizes[best]) best = i; });
    if (best >= 0) { hArea = c.sizes[best]; let sx = 0; for (let i = 0; i < w * h; i++) { Hm[i] = c.labels[i] === best ? 1 : 0; if (Hm[i]) sx += i % w; } side = sx / hArea > xc ? 1 : -1; } }
  const mArea = M.reduce((a, b) => a + b, 0);
  if (!side || hArea < 0.015 * mArea) return { error: 'No handle found. Use a side view with the handle on the left or right.' };
  // body edges per row: the clean side (away from the handle), and on the handle side the first gap, if there is one
  let yTop = h, yBot = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M[y * w + x] && !Hm[y * w + x]) { if (y < yTop) yTop = y; if (y > yBot) yBot = y; }
  const eClean = new Float64Array(h).fill(NaN), eGap = new Float64Array(h).fill(NaN), xcR = Math.round(xc);
  for (let y = yTop; y <= yBot; y++) {
    if (side > 0) { for (let x = 0; x < w; x++) if (M[y * w + x]) { eClean[y] = x - 0.5; break; } }
    else { for (let x = w - 1; x >= 0; x--) if (M[y * w + x]) { eClean[y] = x + 0.5; break; } }
    if (M[y * w + xcR]) for (let x = xcR; x >= 0 && x < w; x += side) if (!M[y * w + x]) { eGap[y] = x - side * 0.5; break; }
  }
  // the axis column: the median centre of the rows where both edges are body edges (between the handle's arms); the
  // opened body's centres are pulled towards the handle by its arms. A leaning axis is left to the taper fit below.
  { const ys = []; for (let y = yTop; y <= yBot; y++) if (eClean[y] === eClean[y] && eGap[y] === eGap[y]) ys.push(y);
    if (ys.length > 0.15 * (yBot - yTop)) { const x0c = median(ys.map(y => 0.5 * (eClean[y] + eGap[y]))); xcAt = () => x0c; } }
  const rad = new Float64Array(h).fill(NaN);
  for (let y = yTop; y <= yBot; y++) {
    const xcy = xcAt(y), clean = side * (xcy - eClean[y]), gap = side * (eGap[y] - xcy);
    rad[y] = gap > 0 ? Math.min(clean, gap) : clean;
  }
  // ---- camera tilt. Photos are taken from a little above, so the silhouette's top is the far arc of the rim ellipse:
  // its half-width grows from the top row to the ellipse's centre, where the rim is widest, then follows the wall. The
  // rim centre is the first row (from the top) within 1.5 % of the widest near the top; the arc's height over the rim's
  // radius is sin(elevation). The foot's near arc is shadowed or cut off more often, so its centre follows from the tilt.
  const radS = new Float64Array(h).fill(NaN);
  for (let y = yTop; y <= yBot; y++) { const a2 = []; for (let k = y - 2; k <= y + 2; k++) if (rad[k] > 0) a2.push(rad[k]); if (a2.length) radS[y] = median(a2); }
  const topEnd = Math.round(yTop + 0.35 * (yBot - yTop));
  let rMaxTop = 0; for (let y = yTop; y <= topEnd; y++) if (radS[y] > rMaxTop) rMaxTop = radS[y];
  let yR = yTop; for (let y = yTop; y <= topEnd; y++) if (radS[y] >= 0.985 * rMaxTop) { yR = y; break; }
  const sinP = Math.min(0.7, Math.max(0, (yR - yTop) / Math.max(1, radS[yR] || rMaxTop))), cosP = Math.sqrt(1 - sinP * sinP);
  let yB = yBot;
  for (let it = 0; it < 4; it++) { const ref = []; for (let k = 3; k <= 9; k++) { const v = radS[Math.round(yB) - k]; if (v > 0) ref.push(v); } if (ref.length) yB = yBot - median(ref) * sinP; }
  if (yB - yR < 0.3 * (yBot - yTop)) return { error: 'Could not read the mug\'s shape. Try a photo from the side.' };
  const s = height * cosP / (yB - yR);                                         // metres per work pixel
  const zOf = y => (yB - y) * s / cosP;
  // ---- body profile: a Theil-Sen line r(z) through the side-wall rows (robust to stray background, shadows and the
  // handle's arms), so the body is a clean cylinder or cone
  const Z = [], R = [];
  for (let y = Math.ceil(yR + 0.05 * (yB - yR)); y <= yB - 0.05 * (yB - yR); y++) if (rad[y] > 0) { Z.push(zOf(y)); R.push(rad[y] * s); }
  if (Z.length < 8) return { error: 'Could not read the mug\'s shape. Try a photo from the side.' };
  const slopes = [], stp = Math.max(1, Math.floor(Z.length / 80));
  for (let i = 0; i < Z.length; i += stp) for (let j = i + stp; j < Z.length; j += stp) if (Math.abs(Z[j] - Z[i]) > 0.15 * height) slopes.push((R[j] - R[i]) / (Z[j] - Z[i]));
  // the camera is closer to the rim than to the foot, which exaggerates an outward taper; keep 60 % of it, at most
  // a 20 % change in radius over the height
  const rMed0 = median(R), c1 = slopes.length ? Math.max(-0.2 * rMed0 / height, Math.min(0.2 * rMed0 / height, 0.6 * median(slopes))) : 0;
  const c0 = median(R.map((r_, i) => r_ - c1 * Z[i])), rMed = median(R);
  // the wall as it appears in the photo (undamped), to tell the body from the handle
  const c1i = slopes.length ? median(slopes) : 0, c0i = median(R.map((r_, i) => r_ - c1i * Z[i]));
  const rImg = y => Math.max(0.5 * rMed, c0i + c1i * Math.min(height, Math.max(0, zOf(y))));
  const rAt = z => Math.min(1.5 * rMed, Math.max(0.5 * rMed, c0 + c1 * z));
  const K = 36, profile = [];
  for (let k = 0; k < K; k++) { const z = (k / (K - 1)) * height; profile.push({ z, r: rAt(z) }); }
  // ---- the handle: mug pixels beyond the fitted body edge on the handle side, largest part
  Hm.fill(0);
  for (let y = yTop; y <= yBot; y++) {
    const rp = rImg(y) / s;
    const xcy = xcAt(y); for (let x = 0; x < w; x++) if (M[y * w + x] && !O[y * w + x] && side * (x - xcy) > rp + 3) Hm[y * w + x] = 1;
  }
  { const cc = components(Hm, w, h); let best = -1; cc.sizes.forEach((s2, i) => { if (best < 0 || s2 > cc.sizes[best]) best = i; });
    hArea = best >= 0 ? cc.sizes[best] : 0; for (let i = 0; i < w * h; i++) Hm[i] = best >= 0 && cc.labels[i] === best ? 1 : 0; }
  if (hArea < 0.015 * mArea) return { error: 'No handle found. Use a side view with the handle on the left or right.' };
  // the handle lies in the plane through the axis facing the camera: u = outward (px), v = up from the foot centre
  // (px, foreshortened by cos(tilt)). The loop's hole centroid is the origin of the angular bins (fallback: 40 % of the
  // way from the wall to the handle's outer edge).
  let hx0 = w, hx1 = -1, hy0 = h, hy1 = -1;
  for (let i = 0; i < w * h; i++) if (Hm[i]) { const x = i % w, y = (i / w) | 0; if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y; }
  const hole = new Uint8Array(w * h);
  for (let y = hy0; y <= hy1; y++) { const rp = rImg(y) / s;
    const xcy = xcAt(y); for (let x = hx0; x <= hx1; x++) if (!M[y * w + x] && side * (x - xcy) > rp) hole[y * w + x] = 1; }
  let origin = null;
  { const cc = components(hole, w, h), sx = new Float64Array(cc.sizes.length), sy = new Float64Array(cc.sizes.length), open = new Uint8Array(cc.sizes.length);
    for (let i = 0; i < w * h; i++) { const l = cc.labels[i]; if (l < 0) continue; const x = i % w, y = (i / w) | 0; sx[l] += x; sy[l] += y;
      if (y === hy0 || y === hy1 || x === (side > 0 ? hx1 : hx0)) open[l] = 1; }
    let best = -1; cc.sizes.forEach((s2, l) => { if (!open[l] && s2 > 12 && (best < 0 || s2 > cc.sizes[best])) best = l; });
    if (best >= 0) { const oy = sy[best] / cc.sizes[best]; origin = [side * (sx[best] / cc.sizes[best] - xcAt(oy)), yB - oy]; } }
  if (!origin) { const yM = 0.5 * (hy0 + hy1), rw = rImg(yM) / s, uo = side > 0 ? hx1 - xcAt(yM) : xcAt(yM) - hx0; origin = [rw + 0.4 * (uo - rw), yB - yM]; }
  const pix = []; for (let i = 0; i < w * h; i++) if (Hm[i]) { const y = (i / w) | 0; pix.push([side * ((i % w) - xcAt(y)), yB - y]); }
  const cl = handleCenterline(pix, origin);
  if (cl.pts.length < 8) return { error: 'The handle is too small or not to the side. Try another photo.' };
  // smooth (5-point), then metres in the handle plane: x outward, z up
  const sm = cl.pts.map((p, i, a) => { let u = 0, v = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(a.length - 1, i + 2); j++) { u += a[j][0]; v += a[j][1]; n++; } return [u / n * s, v / n * s / cosP]; });
  const thSorted = Float64Array.from(cl.th).sort(), thick = Math.min(0.014, Math.max(0.005, thSorted[Math.floor(0.3 * thSorted.length)] * s));
  // ---- image mapping (full-resolution pixels) for the texture and the overlay. A surface point (x, y, z) in the mug
  // frame (x towards the handle, z up) projects to column xc + side*x/s and row yB - z*cos/s - side*y*sin/s: points on
  // the camera's side of the axis plane appear lower. toPhoto mirrors the far side onto the near one (|y|), which is
  // what the texture wants: the photo only shows the near side.
  const toImg = (xw, yw) => [x0 - pad + (xw + 0.5) / f - 0.5, y0 - pad + (yw + 0.5) / f - 0.5];
  const project = (xm, zm, ym) => { const yw = yB - zm * cosP / s - side * ym * sinP / s; return toImg(xcAt(yw) + side * xm / s, yw); };
  // texture lookup: where the projected point lands on the handle or off the mug, use the mirrored point on the clean
  // side (the photo shows the handle there, not the body behind it)
  const inBody = (xm, zm, ym) => { const yw = Math.round(yB - zm * cosP / s - side * ym * sinP / s), xw = Math.round(xcAt(yw) + side * xm / s);
    return xw >= 0 && yw >= 0 && xw < w && yw < h && M[yw * w + xw] === 1 && Hm[yw * w + xw] === 0; };
  let plain = null;                                     // a texel of plain body colour (set below)
  const texAt = (xm, zm, ym) => {
    const yy = -side * Math.abs(ym), rr = Math.hypot(xm, ym);
    if (side * ym > 0.02 * rr || xm > 0.86 * rr) return plain;   // the far side (not in the photo) and the strip beside the handle
    if (xm <= 0 || inBody(xm, zm, yy)) return project(xm, zm, yy);
    for (const k of [1, 0.85, 0.7]) if (inBody(-xm * k, zm, yy)) return project(-xm * k, zm, yy);
    return project(-xm * 0.6, zm, yy);
  };
  const map = { x0, y0, pad, f, xc, yB, side, s, sinP, cosP, project,
    toPhoto: (xm, zm, ym = 0) => project(xm, zm, -side * Math.abs(ym)), texAt };
  // colours: the body front, upper middle
  const ctx0 = () => img.getContext('2d');
  const ctx = img.getContext('2d'), sample = (cx, cy, rr) => {
    const d = ctx.getImageData(Math.round(cx - rr), Math.round(cy - rr), Math.max(1, Math.round(2 * rr)), Math.max(1, Math.round(2 * rr))).data;
    let R_ = 0, G = 0, B = 0, n = 0; for (let i = 0; i < d.length; i += 4) { R_ += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return [R_ / n, G / n, B / n];
  };
  const hs = []; { const st = Math.max(1, Math.floor(pix.length / 400)), d = ctx0().getImageData(0, 0, img.width, img.height).data;
    for (let i = 0, k = 0; i < w * h; i++) if (Hm[i] && (k++ % st === 0)) { const [ix, iy] = toImg(i % w, (i / w) | 0), o = 4 * (Math.round(iy) * img.width + Math.round(ix)); hs.push([d[o], d[o + 1], d[o + 2]]); } }
  const handleColor = [0, 1, 2].map(c => median(hs.map(p => p[c])));
  const zc = 0.6 * height, rc = rAt(zc), [bcx, bcy] = map.toPhoto(-0.35 * rc, zc, rc * 0.9);
  const bodyColor = sample(bcx, bcy, Math.max(2, 0.08 * rc / s / f));
  // the plain texel: the body point whose colour is closest to the median of a few samples across the front
  { const cand = [];
    for (const xf of [-0.6, -0.45, -0.3, -0.15, 0, 0.15]) for (const zf of [0.35, 0.5, 0.65]) {
      const z = zf * height, r_ = rAt(z), x = xf * r_, y = -side * Math.sqrt(Math.max(0, r_ * r_ - x * x)), [px, py] = project(x, z, y);
      const c = sample(px, py, 1.5); cand.push({ px, py, c }); }
    const med = [0, 1, 2].map(k => median(cand.map(q => q.c[k])));
    cand.sort((a, b) => Math.hypot(...a.c.map((v, k) => v - med[k])) - Math.hypot(...b.c.map((v, k) => v - med[k])));
    plain = [cand[0].px, cand[0].py]; }
  // inside: the far inner wall, just below the far rim on the axis
  const [icx, icy] = toImg(xcAt(yTop), yTop + 0.35 * (yR - yTop));
  const innerColor = yR - yTop > 3 ? sample(icx, icy, Math.max(1.5, 0.15 * (yR - yTop) / f)) : bodyColor;
  return { side, xc, s, height, tilt: Math.asin(sinP), profile, handle: { pts: sm, thick }, bodyColor, innerColor, handleColor, map,
           debug: { w, h, M, O, Hm, yR, yB, rad: Array.from(rad), yTop, yBot, bx, origin, clRaw: cl.pts, xcA: xcAt(0) } };
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < 3; r++) { const k = M[r][c] / M[c][c]; for (let q = c; q < 4; q++) M[r][q] -= k * M[c][q]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let v = M[r][3]; for (let q = r + 1; q < 3; q++) v -= M[r][q] * x[q]; x[r] = v / M[r][r]; }
  return x;
}

// largest 4-connected component of a full-resolution mask (drops speckles SAM leaves along strong edges)
export function largestComponent(mask, W, H) {
  const c = components(mask, W, H); if (!c.sizes.length) return mask;
  let best = 0; c.sizes.forEach((s, i) => { if (s > c.sizes[best]) best = i; });
  const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) out[i] = c.labels[i] === best ? 1 : 0;
  return out;
}
