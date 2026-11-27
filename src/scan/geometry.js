// Pure maths for turning camera observations into room outlines. No DOM — unit-tested.

const RAD = Math.PI / 180;

/**
 * Distance along the floor to a point seen `depressionDeg` below the horizon
 * from a camera held `camHeight` metres above the floor.
 */
export function floorDistance(depressionDeg, camHeight) {
  const d = Math.max(4, Math.min(85, depressionDeg));
  return camHeight / Math.tan(d * RAD);
}

/** Bearing (deg, clockwise from "up" on the plan) + distance -> plan point around the origin. */
export function polarToPoint(bearingDeg, dist) {
  return [Math.sin(bearingDeg * RAD) * dist, -Math.cos(bearingDeg * RAD) * dist];
}

/**
 * Horizontal shift (in pixels) that best aligns two column-brightness profiles.
 * Positive = scene content moved left = camera panned right.
 */
export function profileShift(prev, cur, maxShift = Math.floor(prev.length / 3)) {
  let best = 0, bestErr = Infinity;
  const n = prev.length;
  for (let s = -maxShift; s <= maxShift; s++) {
    let err = 0, cnt = 0;
    for (let i = Math.max(0, -s); i < Math.min(n, n - s); i++) { err += Math.abs(prev[i + s] - cur[i]); cnt++; }
    err = err / cnt + Math.abs(s) * 0.002; // prefer the smaller shift on ties
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return best;
}

/**
 * Find the wall/floor boundary in a greyscale frame: the strongest horizontal edge
 * below the horizon inside the centre strip. Returns the row index, or -1.
 */
export function floorBoundaryRow(gray, w, h, minRow = Math.floor(h * 0.54)) {
  const x0 = Math.floor(w * 0.4), x1 = Math.ceil(w * 0.6);
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += gray[y * w + x];
    rows[y] = s / (x1 - x0);
  }
  // Window sills, pictures and shelves also make strong horizontal edges, but the floor line is
  // the LOWEST of the strong ones: below it there is only floor.
  const y0 = Math.max(2, minRow), y1 = Math.floor(h * 0.96), g = new Float32Array(h);
  let max = 0;
  for (let y = y0; y < y1; y++) {
    g[y] = Math.abs((rows[y + 1] + rows[y + 2]) - (rows[y - 1] + rows[y - 2])) / 2;
    if (g[y] > max) max = g[y];
  }
  if (max < 6) return -1; // not enough contrast anywhere
  for (let y = y1 - 1; y >= y0; y--) {
    if (g[y] >= max * 0.5 && g[y] >= g[y - 1] && g[y] >= g[y + 1]) return y;
  }
  return -1;
}

/** Row in image -> depression angle below horizon for a level camera with the given vertical FOV. */
export function rowToDepression(row, h, vfovDeg) {
  const f = h / 2 / Math.tan((vfovDeg / 2) * RAD);
  return Math.atan2(row - h / 2, f) / RAD;
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.round((s.length - 1) * p)))];
};

/**
 * Fit the tightest rotated rectangle to noisy wall samples (robust to outliers through
 * percentiles). Returns { poly, width, depth, angleDeg } with the poly axis-aligned
 * (the house is assumed to be squared to the plan grid) and its origin at [0,0].
 */
export function fitRectangle(points) {
  if (points.length < 8) return null;
  // Drop samples that look straight through a doorway or window (far beyond the typical wall)
  // or that hit furniture right in front of the camera.
  const med = pct(points.map((p) => Math.hypot(p[0], p[1])), 0.5);
  points = points.filter((p) => { const d = Math.hypot(p[0], p[1]); return d < med * 2 && d > med * 0.4; });
  if (points.length < 8) return null;
  let best = null;
  for (let a = 0; a < 90; a += 1) {
    const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
    const us = points.map((p) => p[0] * c + p[1] * s), vs = points.map((p) => -p[0] * s + p[1] * c);
    const u0 = pct(us, 0.08), u1 = pct(us, 0.92), v0 = pct(vs, 0.08), v1 = pct(vs, 0.92);
    // score: how tightly samples hug the rectangle's edges
    let err = 0;
    for (let i = 0; i < us.length; i++) {
      err += Math.min(Math.abs(us[i] - u0), Math.abs(us[i] - u1), Math.abs(vs[i] - v0), Math.abs(vs[i] - v1));
    }
    if (!best || err < best.err) best = { err, a, w: u1 - u0, d: v1 - v0, u0, v0 };
  }
  const round = (v) => Math.max(1, Math.round(v * 10) / 10);
  let width = round(best.w), depth = round(best.d);
  const c = Math.cos(best.a * RAD), s = Math.sin(best.a * RAD);
  return {
    width, depth, angleDeg: best.a, poly: [[0, 0], [width, 0], [width, depth], [0, depth]],
    /** scan-space point -> room-local coordinates (origin at the rectangle's corner) */
    toLocal: (p) => [p[0] * c + p[1] * s - best.u0, -p[0] * s + p[1] * c - best.v0],
    /** room-local -> scan space */
    toScan: (q) => { const u = q[0] + best.u0, v = q[1] + best.v0; return [u * c - v * s, u * s + v * c]; },
  };
}

/**
 * Clean up hand-marked corners: rotate so the longest edge is axis-aligned, then snap
 * near-right-angle edges to the axes so rooms come out square.
 */
export function squareUp(points, tolDeg = 18) {
  if (points.length < 3) return points.map((p) => [...p]);
  let longest = 0, ang = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > longest) { longest = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  }
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const pts = points.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
  const n = pts.length;
  // classify each edge as horizontal / vertical / free
  const kind = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const a = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) / RAD + 360) % 180);
    if (a < tolDeg || a > 180 - tolDeg) return 'h';
    if (Math.abs(a - 90) < tolDeg) return 'v';
    return 'f';
  });
  const out = pts.map((p) => [...p]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (kind[i] === 'h') { const y = (pts[i][1] + pts[j][1]) / 2; out[i][1] = y; out[j][1] = y; }
    if (kind[i] === 'v') { const x = (pts[i][0] + pts[j][0]) / 2; out[i][0] = x; out[j][0] = x; }
  }
  const mx = Math.min(...out.map((p) => p[0])), my = Math.min(...out.map((p) => p[1]));
  return out.map((p) => [Math.round((p[0] - mx) * 10) / 10, Math.round((p[1] - my) * 10) / 10]);
}
