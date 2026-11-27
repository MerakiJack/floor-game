// Video -> room estimate. Works on greyscale frames so it runs the same in the browser and in tests.
import { profileShift, floorBoundaryRow, rowToDepression, floorDistance, polarToPoint, fitRectangle } from './geometry.js';

const RAD = Math.PI / 180;

/** Lens presets: field of view along the LONG side of the video frame. */
export const LENSES = {
  phone1x: { label: 'Phone main camera (1×)', longFov: 69 },
  phone05x: { label: 'Phone ultra-wide (0.5×)', longFov: 106 },
  action: { label: 'Action camera / wide', longFov: 120 },
};

export function fovs(w, h, longFov) {
  const long = Math.max(w, h), f = long / 2 / Math.tan((longFov / 2) * RAD);
  return { f, hfov: (2 * Math.atan(w / 2 / f)) / RAD, vfov: (2 * Math.atan(h / 2 / f)) / RAD };
}

/**
 * Feed frames from a slow 360° pan taken from the middle of a room.
 * Camera rotation comes from tracking how the wall texture slides sideways; wall distance from
 * where the floor meets the wall (lower in the picture = closer).
 */
export class ScanAccumulator {
  constructor({ w, h, longFov = 69, camHeight = 1.4, pitch = 0 }) {
    // pitch = how far the camera is tipped down from level, in degrees
    Object.assign(this, { w, h, camHeight, pitch, ...fovs(w, h, longFov) });
    this.minRow = Math.floor(h / 2 + this.f * Math.tan((5 - pitch) * RAD));
    this.yaw = 0; this.total = 0; this.prev = null; this.points = []; this.samples = [];
  }
  addFrame(gray) {
    const { w, h } = this, prof = new Float32Array(w);
    const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.5);
    for (let x = 0; x < w; x++) { let s = 0; for (let y = y0; y < y1; y++) s += gray[y * w + x]; prof[x] = s / (y1 - y0); }
    if (this.prev) {
      const d = Math.atan(profileShift(this.prev, prof) / this.f) / RAD / Math.cos(this.pitch * RAD);
      this.yaw += d; this.total += Math.abs(d);
    }
    this.prev = prof;
    const row = floorBoundaryRow(gray, w, h, this.minRow);
    let dist = null;
    if (row >= 0) {
      dist = floorDistance(this.pitch + rowToDepression(row, h, this.vfov), this.camHeight);
      if (dist > 0.4 && dist < 15) this.points.push(polarToPoint(this.yaw, dist)); else dist = null;
    }
    const s = { yaw: this.yaw, row, dist };
    this.samples.push(s);
    return s;
  }
  result() {
    return { points: this.points, coverage: Math.min(360, this.total), fit: fitRectangle(this.points) };
  }
}

/**
 * Synthetic "walk-through clip": a simple ray-cast view from inside a rectangular room.
 * Used for the in-app demo and to regression-test the estimator against a known room.
 */
export function renderSyntheticFrame(w, h, { room = [4.6, 3.4], pos = [2.3, 1.7], yaw = 0, longFov = 69, camHeight = 1.4, wallH = 2.5, pitch = 0 } = {}) {
  const { f } = fovs(w, h, longFov), gray = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    const a = yaw * RAD + Math.atan((x - w / 2) / f), dx = Math.sin(a), dy = -Math.cos(a);
    const tx = dx > 0 ? (room[0] - pos[0]) / dx : dx < 0 ? -pos[0] / dx : Infinity;
    const ty = dy > 0 ? (room[1] - pos[1]) / dy : dy < 0 ? -pos[1] / dy : Infinity;
    const t = Math.min(tx, ty), side = tx < ty ? 0 : 1;
    const along = side === 0 ? pos[1] + dy * t : pos[0] + dx * t;
    const perp = t * Math.cos(a - yaw * RAD);
    const floorRow = h / 2 + f * Math.tan(Math.atan(camHeight / perp) - pitch * RAD), ceilRow = h / 2 - f * Math.tan(Math.atan((wallH - camHeight) / perp) + pitch * RAD);
    // wall texture: pictures, door frames and shading so there is something to track
    const u = along + (side ? 11.3 : 0) + (dx > 0 || dy > 0 ? 5.7 : 0);
    const wall = 150 + side * 28 + (Math.sin(u * 5.1) > 0.82 ? -70 : 0) + Math.sin(u * 1.7) * 14 + (Math.sin(u * 13) > 0.95 ? 40 : 0);
    for (let y = 0; y < h; y++) {
      let v;
      if (y < ceilRow) v = 225; else if (y < floorRow) v = wall - (y > floorRow - h * 0.02 ? 35 : 0); else v = 78 + ((Math.floor((y - h / 2) / 3) + x) % 7 === 0 ? 10 : 0);
      gray[y * w + x] = v;
    }
  }
  return gray;
}

/** COCO object classes -> furniture in the plan. Only the rough category matters. */
export const OBJECT_MAP = {
  couch: 'sofa', chair: 'chair', 'dining table': 'table', bed: 'bed', tv: 'tv', laptop: 'desk',
  refrigerator: 'fridge', toilet: 'toilet', 'potted plant': 'plant', oven: 'counter', sink: 'counter',
};

/**
 * Turns per-frame object detections into furniture positions. An object's bearing comes from
 * where its box sits in the frame; its distance from where the bottom of the box touches the floor.
 */
export class ObjectTracker {
  constructor({ w, h, f, vfov, camHeight, pitch = 0 }) { Object.assign(this, { w, h, f, vfov, camHeight, pitch }); this.clusters = []; }
  /** dets: [{ class, score, bbox:[x,y,w,h] }] in the same pixel space as w×h */
  add(yawDeg, dets) {
    for (const d of dets) {
      const type = OBJECT_MAP[d.class];
      if (!type || d.score < 0.45) continue;
      const [x, y, bw, bh] = d.bbox, bottom = Math.min(this.h - 1, y + bh);
      const dep = this.pitch + rowToDepression(bottom, this.h, this.vfov);
      if (dep < 3) continue; // box does not reach the floor — cannot range it
      const bearing = yawDeg + Math.atan((x + bw / 2 - this.w / 2) / this.f) / RAD;
      // the box bottom is the near edge; nudge to the object's middle
      const p = polarToPoint(bearing, Math.min(12, floorDistance(dep, this.camHeight) + 0.3));
      let c = this.clusters.find((k) => k.type === type && Math.hypot(k.x - p[0], k.y - p[1]) < 1.3);
      if (!c) this.clusters.push((c = { type, label: d.class, x: p[0], y: p[1], n: 0, score: 0 }));
      c.x = (c.x * c.n + p[0]) / (c.n + 1); c.y = (c.y * c.n + p[1]) / (c.n + 1); c.n++; c.score = Math.max(c.score, d.score);
    }
  }
  /** Objects seen in at least `minSeen` analysed frames. */
  result(minSeen = 2) { return this.clusters.filter((c) => c.n >= minSeen); }
}
