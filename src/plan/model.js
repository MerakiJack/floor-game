// Floor-plan data model. Units are metres. Plan coords: x right, y down (3D: x -> x, y -> z).

export const ROOM_TYPES = {
  living: { label: 'Living room', floor: 'wood' },
  kitchen: { label: 'Kitchen', floor: 'tile' },
  bedroom: { label: 'Bedroom', floor: 'carpet' },
  bathroom: { label: 'Bathroom', floor: 'tile' },
  hall: { label: 'Hallway', floor: 'wood' },
  office: { label: 'Office', floor: 'carpet' },
  garage: { label: 'Garage', floor: 'concrete' },
};

// w = size along the item's local x, d = depth. hide = player can hide, loot = seconds to steal.
export const ITEM_TYPES = {
  bed: { label: 'Bed', w: 1.6, d: 2.0, h: 0.55, hide: true },
  wardrobe: { label: 'Wardrobe', w: 1.2, d: 0.6, h: 2.0, hide: true },
  sofa: { label: 'Sofa', w: 2.0, d: 0.9, h: 0.8 },
  table: { label: 'Table', w: 1.4, d: 0.9, h: 0.75 },
  counter: { label: 'Kitchen counter', w: 2.0, d: 0.6, h: 0.9 },
  desk: { label: 'Desk + laptop', w: 1.3, d: 0.6, h: 0.75, loot: 4 },
  tv: { label: 'TV', w: 1.4, d: 0.35, h: 1.2, loot: 6 },
  jewelry: { label: 'Jewellery box', w: 0.5, d: 0.4, h: 0.9, loot: 4 },
  safe: { label: 'Safe', w: 0.6, d: 0.6, h: 0.8, loot: 18 },
  chair: { label: 'Chair', w: 0.5, d: 0.5, h: 0.9 },
  fridge: { label: 'Fridge', w: 0.7, d: 0.7, h: 1.8 },
  toilet: { label: 'Toilet', w: 0.45, d: 0.7, h: 0.8 },
  plant: { label: 'Plant', w: 0.4, d: 0.4, h: 1.1 },
  breaker: { label: 'Breaker panel', w: 0.5, d: 0.15, h: 1.6 },
  car: { label: 'Car', w: 1.8, d: 4.2, h: 1.4 },
};

export const OPENING_TYPES = {
  door: { label: 'Interior door', w: 0.9 },
  entry: { label: 'Exterior door', w: 0.95 },
  window: { label: 'Window', w: 1.2 },
};

let _id = 0;
export const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

export const rectPoly = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function emptyPlan() {
  return { name: 'My home', rooms: [], openings: [], items: [] };
}

export function samplePlan() {
  const room = (name, type, x, y, w, h) => ({ id: uid('r'), name, type, poly: rectPoly(x, y, w, h) });
  const op = (type, x, y, w) => ({ id: uid('o'), type, x, y, w: w ?? OPENING_TYPES[type].w });
  const it = (type, x, y, rot = 0) => ({ id: uid('i'), type, x, y, rot });
  return {
    name: 'Sample house',
    rooms: [
      room('Living room', 'living', 0, 0, 6, 5),
      room('Kitchen', 'kitchen', 6, 0, 4, 5),
      room('Hallway', 'hall', 0, 5, 10, 1.6),
      room('Master bedroom', 'bedroom', 0, 6.6, 4.5, 4),
      room('Bathroom', 'bathroom', 4.5, 6.6, 2.5, 4),
      room('Office', 'office', 7, 6.6, 3, 4),
      room('Garage', 'garage', 10, 0, 3.6, 6.6),
    ],
    openings: [
      op('entry', 0, 5.8), op('entry', 8, 0), op('entry', 13.6, 5.2),
      op('window', 3, 0, 1.8), op('window', 0, 2.5, 1.4), op('window', 6.9, 0, 1.0),
      op('window', 0, 8.6), op('window', 2.2, 10.6), op('window', 5.7, 10.6, 0.7),
      op('window', 8.5, 10.6), op('window', 10, 8.8),
      op('door', 3, 5), op('door', 8, 5), op('door', 6, 2.5, 1.3),
      op('door', 2.2, 6.6), op('door', 5.7, 6.6), op('door', 8.5, 6.6), op('door', 10, 3.6),
    ],
    items: [
      it('sofa', 2.2, 0.75), it('tv', 4.4, 4.72), it('table', 7.6, 3.2), it('counter', 9.6, 1.6, 1),
      it('bed', 1.1, 9.4), it('wardrobe', 4.1, 9.2, 1), it('jewelry', 3.6, 6.95),
      it('desk', 9.55, 9.6, 1), it('safe', 7.45, 10.15), it('breaker', 10.2, 1.2, 1), it('car', 12, 2.6),
    ],
  };
}

// ---------- geometry ----------
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const roomAt = (plan, p) => plan.rooms.find((r) => pointInPoly(p, r.poly)) || null;

export function polyCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
export function planBounds(plan) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of plan.rooms) for (const [x, y] of r.poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 8, y1: 6 };
  return { x0, y0, x1, y1 };
}
export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + dx * t, a[1] + dy * t];
  return { dist: Math.hypot(p[0] - q[0], p[1] - q[1]), t, point: q };
}

/**
 * Turn room outlines into unique wall pieces. Shared edges are merged, each piece is
 * tagged interior/exterior, and openings are attached to the piece they sit on.
 * Returns [{a,b,len,dir,n,exterior,outside(+1|-1 side of n),extA,extB,openings:[{...o,t}]}]
 */
export function deriveWalls(plan) {
  const groups = new Map();
  for (const r of plan.rooms) {
    for (let i = 0; i < r.poly.length; i++) {
      let a = r.poly[i], b = r.poly[(i + 1) % r.poly.length];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      dx /= len; dy /= len;
      if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && dy < 0)) { dx = -dx; dy = -dy; [a, b] = [b, a]; }
      const ang = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      const off = Math.round((a[0] * dy - a[1] * dx) / 0.05);
      const key = `${ang}|${off}`;
      if (!groups.has(key)) groups.set(key, { dir: [dx, dy], origin: a, ivs: [] });
      const g = groups.get(key);
      const t = (p) => (p[0] - g.origin[0]) * g.dir[0] + (p[1] - g.origin[1]) * g.dir[1];
      g.ivs.push([t(a), t(b)]);
    }
  }
  const inside = (p) => plan.rooms.some((r) => pointInPoly(p, r.poly));
  const walls = [];
  for (const g of groups.values()) {
    const cuts = [...new Set(g.ivs.flat().map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    const [dx, dy] = g.dir, n = [-dy, dx];
    const at = (t) => [g.origin[0] + dx * t, g.origin[1] + dy * t];
    let prev = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i], t1 = cuts[i + 1], tm = (t0 + t1) / 2;
      if (t1 - t0 < 0.02 || !g.ivs.some(([s, e]) => s <= tm && e >= tm)) { prev = null; continue; }
      const m = at(tm);
      const inP = inside([m[0] + n[0] * 0.15, m[1] + n[1] * 0.15]);
      const inN = inside([m[0] - n[0] * 0.15, m[1] - n[1] * 0.15]);
      const exterior = !(inP && inN);
      const outside = inP ? -1 : 1;
      if (prev && prev.exterior === exterior && prev.outside === outside && Math.abs(prev.t1 - t0) < 1e-6) {
        prev.t1 = t1; prev.b = at(t1); prev.len = prev.t1 - prev.t0;
      } else {
        const w = { a: at(t0), b: at(t1), t0, t1, len: t1 - t0, dir: g.dir, n, exterior, outside, extA: true, extB: true, openings: [] };
        if (prev && Math.abs(prev.t1 - t0) < 1e-6) { prev.extB = false; w.extA = false; }
        walls.push(w); prev = w;
      }
    }
  }
  for (const o of plan.openings) {
    const hit = nearestWall(walls, [o.x, o.y]);
    if (!hit || hit.dist > 0.5) continue;
    const w = hit.wall, half = Math.min(o.w / 2, w.len / 2 - 0.08);
    if (half < 0.2) continue;
    const t = Math.max(half + 0.08, Math.min(w.len - half - 0.08, hit.t * w.len));
    if (w.openings.some((q) => Math.abs(q.t - t) < q.w / 2 + half + 0.1)) continue;
    w.openings.push({ ...o, w: half * 2, t, type: o.type === 'window' ? 'window' : w.exterior ? 'entry' : 'door' });
  }
  for (const w of walls) w.openings.sort((p, q) => p.t - q.t);
  return walls;
}

export function nearestWall(walls, p) {
  let best = null;
  for (const wall of walls) {
    const d = distToSeg(p, wall.a, wall.b);
    if (!best || d.dist < best.dist) best = { wall, ...d };
  }
  return best;
}

// ---------- persistence ----------
const KEY = 'floor-game.plan.v1';
export function savePlan(plan) {
  try { localStorage.setItem(KEY, JSON.stringify(plan)); } catch { /* private mode */ }
}
export function loadPlan() {
  try { return validatePlan(JSON.parse(localStorage.getItem(KEY))); } catch { return null; }
}
export function validatePlan(p) {
  if (!p || !Array.isArray(p.rooms)) return null;
  const num = (v) => typeof v === 'number' && isFinite(v);
  return {
    name: String(p.name || 'My home').slice(0, 60),
    rooms: p.rooms.filter((r) => Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every((q) => num(q[0]) && num(q[1])))
      .map((r) => ({ id: r.id || uid('r'), name: String(r.name || 'Room').slice(0, 40), type: ROOM_TYPES[r.type] ? r.type : 'living', poly: r.poly.map((q) => [q[0], q[1]]) })),
    openings: (p.openings || []).filter((o) => OPENING_TYPES[o.type] && num(o.x) && num(o.y))
      .map((o) => ({ id: o.id || uid('o'), type: o.type, x: o.x, y: o.y, w: num(o.w) ? o.w : OPENING_TYPES[o.type].w })),
    items: (p.items || []).filter((i) => ITEM_TYPES[i.type] && num(i.x) && num(i.y))
      .map((i) => ({ id: i.id || uid('i'), type: i.type, x: i.x, y: i.y, rot: i.rot ? 1 : 0 })),
  };
}
export function planToHash(plan) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const slim = {
    n: plan.name,
    r: plan.rooms.map((r) => [r.name, r.type, r.poly.flat().map(r2)]),
    o: plan.openings.map((o) => [o.type[0], r2(o.x), r2(o.y), r2(o.w)]),
    i: plan.items.map((i) => [i.type, r2(i.x), r2(i.y), i.rot ? 1 : 0]),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(slim)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function planFromHash(hash) {
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(hash.replace(/-/g, '+').replace(/_/g, '/')))));
    const types = { d: 'door', e: 'entry', w: 'window' };
    return validatePlan({
      name: s.n,
      rooms: s.r.map(([name, type, flat]) => ({ name, type, poly: flat.reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), []) })),
      openings: s.o.map(([t, x, y, w]) => ({ type: types[t], x, y, w })),
      items: s.i.map(([type, x, y, rot]) => ({ type, x, y, rot })),
    });
  } catch { return null; }
}

/** Footprint size of an item in plan axes, accounting for its 90° rotation flag. */
export function itemSize(it) {
  const t = ITEM_TYPES[it.type];
  return it.rot ? [t.d, t.w] : [t.w, t.d];
}
