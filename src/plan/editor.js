// 2D floor-plan editor on a canvas: pan/zoom, draw rooms, drag walls corners, place doors, windows and furniture.
import { ROOM_TYPES, ITEM_TYPES, OPENING_TYPES, deriveWalls, nearestWall, pointInPoly, polyCentroid, polyArea, planBounds, itemSize, rectPoly, uid, distToSeg } from './model.js';

const FLOOR_COL = { wood: '#b08a5e', tile: '#cfd4d6', carpet: '#7f88a3', concrete: '#9a9c9b' };
const snap = (v) => Math.round(v * 10) / 10;

export class Editor {
  constructor(canvas, plan, onChange) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.plan = plan; this.onChange = onChange;
    this.tool = 'select'; this.itemType = 'bed'; this.sel = null; this.view = { s: 40, x: 0, y: 0 }; this.ptrs = new Map(); this.drag = null;
    this.onSelect = () => {};
    const o = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), o);
    canvas.addEventListener('pointermove', (e) => this.move(e), o);
    canvas.addEventListener('pointerup', (e) => this.up(e)); canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : 0.89, e.offsetX, e.offsetY); }, o);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    this.resize(); this.fit();
  }
  destroy() { this.ro.disconnect(); }
  resize() {
    const r = this.cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.max(50, r.width * d); this.cv.height = Math.max(50, r.height * d); this.dpr = d; this.draw();
  }
  fit() {
    const b = planBounds(this.plan), w = this.cv.width / this.dpr, h = this.cv.height / this.dpr;
    this.view.s = Math.min(w / (b.x1 - b.x0 + 2.4), h / (b.y1 - b.y0 + 2.4));
    this.view.x = w / 2 - ((b.x0 + b.x1) / 2) * this.view.s; this.view.y = h / 2 - ((b.y0 + b.y1) / 2) * this.view.s;
    this.draw();
  }
  zoom(f, cx, cy) {
    const v = this.view, ns = Math.max(12, Math.min(160, v.s * f));
    v.x = cx - ((cx - v.x) / v.s) * ns; v.y = cy - ((cy - v.y) / v.s) * ns; v.s = ns; this.draw();
  }
  toWorld(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left - this.view.x) / this.view.s, (e.clientY - r.top - this.view.y) / this.view.s]; }
  changed() { this.walls = null; this.onChange(); this.draw(); }
  getWalls() { return (this.walls ||= deriveWalls(this.plan)); }
  select(sel) { this.sel = sel; this.onSelect(this.selected()); this.draw(); }
  selected() {
    if (!this.sel) return null;
    const list = { room: this.plan.rooms, opening: this.plan.openings, item: this.plan.items }[this.sel.kind];
    const obj = list.find((o) => o.id === this.sel.id);
    return obj ? { kind: this.sel.kind, obj } : null;
  }
  remove() {
    const s = this.selected(); if (!s) return;
    const key = { room: 'rooms', opening: 'openings', item: 'items' }[s.kind];
    this.plan[key] = this.plan[key].filter((o) => o !== s.obj);
    if (s.kind === 'room') {
      const walls = deriveWalls(this.plan);
      this.plan.openings = this.plan.openings.filter((o) => { const h = nearestWall(walls, [o.x, o.y]); return h && h.dist < 0.3; });
    }
    this.select(null); this.changed();
  }
  /** Add a scanned/new room next to the existing plan. */
  addRoom(room) {
    const b = this.plan.rooms.length ? planBounds(this.plan) : { x1: 0, y0: 0 };
    const r = { id: uid('r'), name: room.name, type: room.type, poly: room.poly.map((p) => [snap(p[0] + b.x1), snap(p[1] + b.y0)]) };
    this.plan.rooms.push(r);
    for (const it of room.items || []) this.plan.items.push({ id: uid('i'), type: it.type, x: snap(it.x + b.x1), y: snap(it.y + b.y0), rot: 0 });
    this.select({ kind: 'room', id: r.id }); this.changed(); this.fit();
    return r;
  }

  hit(p) {
    const tol = 14 / this.view.s;
    const s = this.selected();
    if (s?.kind === 'room') { const i = s.obj.poly.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol); if (i >= 0) return { kind: 'vertex', obj: s.obj, i }; }
    for (const o of this.plan.openings) if (Math.hypot(o.x - p[0], o.y - p[1]) < Math.max(tol, o.w / 2)) return { kind: 'opening', obj: o };
    for (const it of [...this.plan.items].reverse()) { const [w, d] = itemSize(it); if (Math.abs(p[0] - it.x) < Math.max(w / 2, tol * 0.6) && Math.abs(p[1] - it.y) < Math.max(d / 2, tol * 0.6)) return { kind: 'item', obj: it }; }
    for (const r of [...this.plan.rooms].reverse()) if (pointInPoly(p, r.poly)) return { kind: 'room', obj: r };
    return null;
  }

  down(e) {
    e.preventDefault(); this.cv.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.ptrs.size === 2) { this.drag = { kind: 'pinch', d: this.pinchDist() }; return; }
    const p = this.toWorld(e);
    if (this.tool === 'room') { this.drag = { kind: 'draw', a: p.map(snap), b: p.map(snap) }; return; }
    if (this.tool === 'door' || this.tool === 'window') {
      const h = nearestWall(this.getWalls(), p);
      if (h && h.dist < 0.8) {
        const o = { id: uid('o'), type: this.tool === 'window' ? 'window' : h.wall.exterior ? 'entry' : 'door', x: snap(h.point[0]), y: snap(h.point[1]), w: OPENING_TYPES[this.tool].w };
        this.plan.openings.push(o); this.select({ kind: 'opening', id: o.id }); this.changed();
      }
      return;
    }
    if (this.tool === 'item') {
      const it = { id: uid('i'), type: this.itemType, x: snap(p[0]), y: snap(p[1]), rot: 0 };
      this.plan.items.push(it); this.select({ kind: 'item', id: it.id }); this.changed(); return;
    }
    const h = this.hit(p);
    if (!h) { this.select(null); this.drag = { kind: 'pan', x: e.clientX, y: e.clientY }; return; }
    if (h.kind === 'vertex') { this.drag = { kind: 'vertex', obj: h.obj, i: h.i }; return; }
    this.select({ kind: h.kind, id: h.obj.id });
    this.drag = { kind: h.kind, obj: h.obj, last: p, moved: false };
    if (h.kind === 'room') {
      // furniture and openings that belong to the room travel with it
      this.drag.items = this.plan.items.filter((it) => pointInPoly([it.x, it.y], h.obj.poly));
      this.drag.openings = this.plan.openings.filter((o) => h.obj.poly.some((q, i) => distToSeg([o.x, o.y], q, h.obj.poly[(i + 1) % h.obj.poly.length]).dist < 0.25));
      this.drag.acc = [0, 0];
    }
  }
  pinchDist() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  move(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    e.preventDefault();
    const prev = this.ptrs.get(e.pointerId); this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const d = this.drag; if (!d) return;
    const p = this.toWorld(e);
    if (d.kind === 'pinch' && this.ptrs.size === 2) {
      const nd = this.pinchDist(), [a, b] = [...this.ptrs.values()], r = this.cv.getBoundingClientRect();
      this.zoom(nd / d.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); d.d = nd; return;
    }
    if (d.kind === 'pan') { this.view.x += e.clientX - prev[0]; this.view.y += e.clientY - prev[1]; this.draw(); return; }
    if (d.kind === 'draw') { d.b = p.map(snap); this.draw(); return; }
    if (d.kind === 'vertex') {
      const poly = d.obj.poly, old = poly[d.i], nx = snap(p[0]), ny = snap(p[1]);
      for (const q of poly) { if (q !== old) { if (Math.abs(q[0] - old[0]) < 0.01) q[0] = nx; if (Math.abs(q[1] - old[1]) < 0.01) q[1] = ny; } }
      old[0] = nx; old[1] = ny; this.walls = null; this.draw(); d.moved = true; return;
    }
    if (d.kind === 'room') {
      d.acc[0] += p[0] - d.last[0]; d.acc[1] += p[1] - d.last[1]; d.last = p;
      const dx = snap(d.acc[0]), dy = snap(d.acc[1]);
      if (dx || dy) {
        d.acc[0] -= dx; d.acc[1] -= dy; d.moved = true;
        for (const q of d.obj.poly) { q[0] = snap(q[0] + dx); q[1] = snap(q[1] + dy); }
        for (const o of [...d.items, ...d.openings]) { o.x = snap(o.x + dx); o.y = snap(o.y + dy); }
        this.walls = null; this.draw();
      }
      return;
    }
    if (d.kind === 'opening') {
      const h = nearestWall(this.getWalls(), p);
      if (h && h.dist < 1.2) { d.obj.x = snap(h.point[0]); d.obj.y = snap(h.point[1]); d.moved = true; this.walls = null; this.draw(); }
      return;
    }
    if (d.kind === 'item') { d.obj.x = snap(p[0]); d.obj.y = snap(p[1]); d.moved = true; this.draw(); }
  }
  up(e) {
    this.ptrs.delete(e.pointerId);
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.kind === 'draw') {
      const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.a[0] - d.b[0]), h = Math.abs(d.a[1] - d.b[1]);
      if (w >= 1 && h >= 1) {
        const r = { id: uid('r'), name: 'Room ' + (this.plan.rooms.length + 1), type: 'living', poly: rectPoly(x, y, w, h) };
        this.plan.rooms.push(r); this.select({ kind: 'room', id: r.id }); this.changed();
      } else this.draw();
      return;
    }
    if (d.moved) this.changed();
  }

  draw() {
    const g = this.g, v = this.view, W = this.cv.width, H = this.cv.height, k = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0d1322'; g.fillRect(0, 0, W, H);
    g.setTransform(k, 0, 0, k, 0, 0);
    const X = (x) => x * v.s + v.x, Y = (y) => y * v.s + v.y;
    // grid (1 m)
    g.strokeStyle = '#18213a'; g.lineWidth = 1; g.beginPath();
    for (let x = Math.floor(-v.x / v.s); X(x) < W / k; x++) { g.moveTo(X(x), 0); g.lineTo(X(x), H / k); }
    for (let y = Math.floor(-v.y / v.s); Y(y) < H / k; y++) { g.moveTo(0, Y(y)); g.lineTo(W / k, Y(y)); }
    g.stroke();
    const sel = this.selected();
    for (const r of this.plan.rooms) {
      g.beginPath(); r.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath();
      g.fillStyle = FLOOR_COL[ROOM_TYPES[r.type].floor]; g.globalAlpha = sel?.obj === r ? 0.95 : 0.7; g.fill(); g.globalAlpha = 1;
    }
    for (const it of this.plan.items) {
      const [w, d] = itemSize(it), def = ITEM_TYPES[it.type];
      g.fillStyle = def.loot ? '#fbbf24' : def.hide ? '#34d399' : '#e2e8f0'; g.globalAlpha = 0.85;
      g.fillRect(X(it.x - w / 2), Y(it.y - d / 2), w * v.s, d * v.s); g.globalAlpha = 1;
      g.strokeStyle = sel?.obj === it ? '#38bdf8' : '#0b1020'; g.lineWidth = sel?.obj === it ? 3 : 1; g.strokeRect(X(it.x - w / 2), Y(it.y - d / 2), w * v.s, d * v.s);
      if (v.s > 26) { g.fillStyle = '#0b1020'; g.font = '10px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(def.label.split(' ')[0], X(it.x), Y(it.y) + 3); }
    }
    const walls = this.getWalls();
    g.lineCap = 'square';
    for (const w of walls) {
      g.strokeStyle = w.exterior ? '#f1f5f9' : '#cbd5e1'; g.lineWidth = Math.max(3, (w.exterior ? 0.2 : 0.12) * v.s);
      g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke();
      for (const o of w.openings) {
        const ax = w.a[0] + w.dir[0] * (o.t - o.w / 2), ay = w.a[1] + w.dir[1] * (o.t - o.w / 2), bx = w.a[0] + w.dir[0] * (o.t + o.w / 2), by = w.a[1] + w.dir[1] * (o.t + o.w / 2);
        g.lineCap = 'butt'; g.strokeStyle = '#0d1322'; g.lineWidth = Math.max(5, 0.26 * v.s); g.beginPath(); g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.stroke();
        const picked = sel?.obj?.id === o.id;
        g.strokeStyle = picked ? '#38bdf8' : o.type === 'window' ? '#60a5fa' : o.type === 'entry' ? '#f97316' : '#4ade80'; g.lineWidth = picked ? 4 : 2.5;
        if (o.type === 'window') { g.beginPath(); g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.stroke(); } else {
          const ang = Math.atan2(w.dir[1], w.dir[0]);
          g.beginPath(); g.moveTo(X(ax), Y(ay)); g.arc(X(ax), Y(ay), o.w * v.s, ang, ang + Math.PI / 2); g.lineTo(X(ax), Y(ay)); g.stroke();
        }
        g.lineCap = 'square';
      }
    }
    g.textAlign = 'center';
    for (const r of this.plan.rooms) {
      const c = polyCentroid(r.poly), xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
      g.fillStyle = '#0b1020'; g.font = `600 ${Math.max(10, Math.min(15, v.s * 0.32))}px system-ui,sans-serif`; g.fillText(r.name, X(c[0]), Y(c[1]) - 3);
      g.font = `${Math.max(9, Math.min(12, v.s * 0.26))}px system-ui,sans-serif`;
      g.fillText(`${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m · ${polyArea(r.poly).toFixed(1)} m²`, X(c[0]), Y(c[1]) + 12);
      if (sel?.obj === r) {
        g.strokeStyle = '#38bdf8'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); r.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); g.stroke(); g.setLineDash([]);
        for (const p of r.poly) { g.fillStyle = '#38bdf8'; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.stroke(); }
      }
    }
    if (this.drag?.kind === 'draw') {
      const { a, b } = this.drag; g.strokeStyle = '#38bdf8'; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.strokeRect(X(Math.min(a[0], b[0])), Y(Math.min(a[1], b[1])), Math.abs(a[0] - b[0]) * v.s, Math.abs(a[1] - b[1]) * v.s); g.setLineDash([]);
      g.fillStyle = '#38bdf8'; g.font = '13px system-ui,sans-serif'; g.fillText(`${Math.abs(a[0] - b[0]).toFixed(1)} × ${Math.abs(a[1] - b[1]).toFixed(1)} m`, X((a[0] + b[0]) / 2), Y(Math.min(a[1], b[1])) - 8);
    }
    // scale bar
    g.fillStyle = '#94a3b8'; g.fillRect(14, H / k - 18, v.s, 3); g.font = '11px system-ui,sans-serif'; g.textAlign = 'left'; g.fillText('1 m', 14, H / k - 24);
  }
}
