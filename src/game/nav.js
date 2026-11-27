// Grid navigation: collision, A* path-finding and line-of-sight on a rasterised floor plan.
import { planBounds, itemSize } from '../plan/model.js';

export const CELL = 0.2;
const HALF_WALL = 0.15;

export function buildNav(plan, walls, margin = 5) {
  const b = planBounds(plan);
  const ox = b.x0 - margin, oy = b.y0 - margin;
  const w = Math.ceil((b.x1 - b.x0 + margin * 2) / CELL), h = Math.ceil((b.y1 - b.y0 + margin * 2) / CELL);
  const solid = new Uint8Array(w * h); // 0 free, 1 wall, 2 furniture
  const portalAt = new Int16Array(w * h).fill(-1);
  const portals = [];

  for (const wall of walls) {
    const first = portals.length;
    for (const o of wall.openings) {
      const cx = wall.a[0] + wall.dir[0] * o.t, cy = wall.a[1] + wall.dir[1] * o.t;
      portals.push({
        id: o.id, type: o.type, x: cx, y: cy, w: o.w, dir: wall.dir, n: wall.n, exterior: wall.exterior,
        // a point just outside the house for exterior portals
        out: wall.exterior ? [cx + wall.n[0] * wall.outside * 0.7, cy + wall.n[1] * wall.outside * 0.7] : null,
        in: wall.exterior ? [cx - wall.n[0] * wall.outside * 0.7, cy - wall.n[1] * wall.outside * 0.7] : null,
      });
    }
    const x0 = Math.floor((Math.min(wall.a[0], wall.b[0]) - 0.3 - ox) / CELL), x1 = Math.ceil((Math.max(wall.a[0], wall.b[0]) + 0.3 - ox) / CELL);
    const y0 = Math.floor((Math.min(wall.a[1], wall.b[1]) - 0.3 - oy) / CELL), y1 = Math.ceil((Math.max(wall.a[1], wall.b[1]) + 0.3 - oy) / CELL);
    for (let cy = Math.max(0, y0); cy < Math.min(h, y1); cy++) for (let cx = Math.max(0, x0); cx < Math.min(w, x1); cx++) {
      const px = ox + (cx + 0.5) * CELL - wall.a[0], py = oy + (cy + 0.5) * CELL - wall.a[1];
      const t = px * wall.dir[0] + py * wall.dir[1], d = Math.abs(px * wall.n[0] + py * wall.n[1]);
      if (d > HALF_WALL || t < -HALF_WALL || t > wall.len + HALF_WALL) continue;
      const k = wall.openings.findIndex((o) => Math.abs(t - o.t) < o.w / 2 - 0.02);
      const i = cy * w + cx;
      if (k >= 0) { if (solid[i] !== 1) portalAt[i] = first + k; } else { solid[i] = 1; portalAt[i] = -1; }
    }
  }
  for (const it of plan.items) {
    const [sw, sd] = itemSize(it);
    for (let y = it.y - sd / 2 + 0.05; y < it.y + sd / 2; y += CELL / 2) for (let x = it.x - sw / 2 + 0.05; x < it.x + sw / 2; x += CELL / 2) {
      const cx = Math.floor((x - ox) / CELL), cy = Math.floor((y - oy) / CELL);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h && !solid[cy * w + cx] && portalAt[cy * w + cx] < 0) solid[cy * w + cx] = 2;
    }
  }
  return new Nav({ ox, oy, w, h, solid, portalAt, portals, bounds: b, margin });
}

export class Nav {
  constructor(o) { Object.assign(this, o); }
  cx(x) { return Math.floor((x - this.ox) / CELL); }
  cy(y) { return Math.floor((y - this.oy) / CELL); }
  inGrid(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }
  world(cx, cy) { return [this.ox + (cx + 0.5) * CELL, this.oy + (cy + 0.5) * CELL]; }
  outsideGrid(x, y, pad = 0.6) {
    return x < this.ox + pad || y < this.oy + pad || x > this.ox + this.w * CELL - pad || y > this.oy + this.h * CELL - pad;
  }
  /** Is the point blocked for a walker? `isOpen(portalIndex)` decides doors/windows. */
  blockedAt(x, y, isOpen) {
    const cx = this.cx(x), cy = this.cy(y);
    if (!this.inGrid(cx, cy)) return false;
    const i = cy * this.w + cx;
    if (this.solid[i]) return true;
    const p = this.portalAt[i];
    return p >= 0 && !isOpen(p);
  }
  canStand(x, y, isOpen, r = 0.18) {
    if (this.blockedAt(x, y, isOpen)) return false;
    for (let a = 0; a < 8; a++) {
      if (this.blockedAt(x + Math.cos((a * Math.PI) / 4) * r, y + Math.sin((a * Math.PI) / 4) * r, isOpen)) return false;
    }
    return true;
  }
  /** Nearest free cell centre to a point (BFS ring search). */
  freeNear(x, y) {
    const open = () => false;
    for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const px = x + dx * CELL, py = y + dy * CELL;
      if (this.canStand(px, py, open, 0.25)) return [px, py];
    }
    return [x, y];
  }
  /** Line of sight. `seeThrough(portalIndex)` — open doors and all windows are transparent. */
  los(ax, ay, bx, by, seeThrough) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.1);
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      const cx = this.cx(x), cy = this.cy(y);
      if (!this.inGrid(cx, cy)) continue;
      const k = cy * this.w + cx;
      if (this.solid[k] === 1) return false;
      const p = this.portalAt[k];
      if (p >= 0 && !seeThrough(p)) return false;
    }
    return true;
  }
  /**
   * A* over the grid. `portalCost(i)` returns the extra cost (in metres-equivalent) of pushing
   * through portal i, or Infinity if impassable. Returns [[x,y],...] world points or null.
   */
  path(sx, sy, tx, ty, portalCost) {
    const { w, h, solid, portalAt } = this;
    const clamp = (v, m) => Math.max(0, Math.min(m - 1, v));
    const s = clamp(this.cy(sy), h) * w + clamp(this.cx(sx), w);
    let t = clamp(this.cy(ty), h) * w + clamp(this.cx(tx), w);
    if (solid[t]) { const [fx, fy] = this.freeNear(tx, ty); t = this.cy(fy) * w + this.cx(fx); }
    const g = new Float32Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const heap = new Heap();
    const tcx = t % w, tcy = (t / w) | 0;
    const hfn = (i) => Math.hypot((i % w) - tcx, ((i / w) | 0) - tcy);
    g[s] = 0; heap.push(s, hfn(s));
    const pc = new Map();
    const cost = (p) => { if (!pc.has(p)) pc.set(p, portalCost(p) / CELL); return pc.get(p); };
    while (heap.size) {
      const cur = heap.pop();
      if (cur === t) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w, cy = (cur / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] || (solid[ni] && ni !== s)) continue;
        if (dx && dy && (solid[cy * w + nx] || solid[ny * w + cx])) continue; // no corner cutting
        let step = dx && dy ? 1.414 : 1;
        const p = portalAt[ni];
        if (p >= 0 && portalAt[cur] !== p) { const c = cost(p); if (!isFinite(c)) continue; step += c; }
        // keep a little clearance from walls and furniture
        if ((nx > 0 && solid[ni - 1]) || (nx < w - 1 && solid[ni + 1]) || (ny > 0 && solid[ni - w]) || (ny < h - 1 && solid[ni + w])) step += 1.2;
        const ng = g[cur] + step;
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ni, ng + hfn(ni)); }
      }
    }
    if (from[t] < 0 && t !== s) return null;
    const out = [];
    for (let i = t; i >= 0 && i !== s; i = from[i]) out.push(this.world(i % w, (i / w) | 0));
    return out.reverse();
  }
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(v, k) {
    const { k: ks, v: vs } = this; let i = ks.length; ks.push(k); vs.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (ks[p] <= ks[i]) break; [ks[p], ks[i]] = [ks[i], ks[p]]; [vs[p], vs[i]] = [vs[i], vs[p]]; i = p; }
  }
  pop() {
    const { k: ks, v: vs } = this; const top = vs[0]; const lk = ks.pop(), lv = vs.pop();
    if (ks.length) {
      ks[0] = lk; vs[0] = lv; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < ks.length && ks[l] < ks[m]) m = l;
        if (r < ks.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [ks[m], ks[i]] = [ks[i], ks[m]]; [vs[m], vs[i]] = [vs[i], vs[m]]; i = m;
      }
    }
    return top;
  }
}
