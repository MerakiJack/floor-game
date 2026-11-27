import { describe, it, expect } from 'vitest';
import { samplePlan, deriveWalls, planToHash, planFromHash, validatePlan } from '../src/plan/model.js';
import { floorDistance, profileShift, fitRectangle, squareUp, polarToPoint } from '../src/scan/geometry.js';
import { ScanAccumulator, ObjectTracker, renderSyntheticFrame, fovs } from '../src/scan/pipeline.js';
import { buildNav } from '../src/game/nav.js';
import { Sim, UPGRADES } from '../src/game/sim.js';

describe('floor plan model', () => {
  const plan = samplePlan(), walls = deriveWalls(plan);
  it('merges shared walls and tags exterior ones', () => {
    expect(walls.some((w) => w.exterior)).toBe(true);
    expect(walls.some((w) => !w.exterior)).toBe(true);
    // the living-room/kitchen wall exists once, not twice
    expect(walls.filter((w) => Math.abs(w.a[0] - 6) < 0.01 && Math.abs(w.b[0] - 6) < 0.01 && w.a[1] < 5).length).toBe(1);
  });
  it('attaches every opening to a wall with the right type', () => {
    const ops = walls.flatMap((w) => w.openings.map((o) => ({ ...o, ext: w.exterior })));
    expect(ops.length).toBe(plan.openings.length);
    expect(ops.filter((o) => o.type === 'entry').every((o) => o.ext)).toBe(true);
    expect(ops.filter((o) => o.type === 'door').every((o) => !o.ext)).toBe(true);
  });
  it('round-trips through a share link', () => {
    const back = planFromHash(planToHash(plan));
    expect(back.rooms.length).toBe(plan.rooms.length);
    expect(back.openings.length).toBe(plan.openings.length);
    expect(back.items.map((i) => i.type)).toEqual(plan.items.map((i) => i.type));
  });
  it('rejects junk', () => { expect(validatePlan({ rooms: 'x' })).toBe(null); expect(planFromHash('!!!')).toBe(null); });
});

describe('scan geometry', () => {
  it('ranges a floor point from tilt', () => { expect(floorDistance(45, 1.4)).toBeCloseTo(1.4, 5); });
  it('finds the shift between profiles', () => {
    const a = Float32Array.from({ length: 120 }, (_, i) => Math.sin(i * 0.31) * 50 + Math.sin(i * 0.07) * 80);
    const b = Float32Array.from({ length: 120 }, (_, i) => Math.sin((i + 7) * 0.31) * 50 + Math.sin((i + 7) * 0.07) * 80);
    expect(profileShift(a, b)).toBe(7);
  });
  it('fits a rotated rectangle to noisy wall samples', () => {
    const pts = [];
    for (let a = 0; a < 360; a += 2) {
      const r = (a * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
      const t = Math.min(2.5 / Math.abs(dx), 1.5 / Math.abs(dy)) + (Math.sin(a * 7) * 0.04);
      const x = dx * t, y = dy * t, c = Math.cos(0.4), s = Math.sin(0.4);
      pts.push([x * c - y * s, x * s + y * c]);
    }
    const f = fitRectangle(pts), dims = [f.width, f.depth].sort();
    expect(dims[0]).toBeCloseTo(3, 0); expect(dims[1]).toBeCloseTo(5, 0);
    const q = f.toLocal(f.toScan([1, 2])); expect(q[0]).toBeCloseTo(1); expect(q[1]).toBeCloseTo(2);
  });
  it('squares up hand-marked corners', () => {
    const p = squareUp([[0, 0], [4.1, 0.2], [3.9, 3.1], [-0.1, 2.9]]);
    expect(p.length).toBe(4);
    const xs = [...new Set(p.map((q) => q[0]))], ys = [...new Set(p.map((q) => q[1]))];
    expect(xs.length).toBe(2); expect(ys.length).toBe(2);
  });
});

describe('video scan pipeline', () => {
  it('recovers a known room from a synthetic 360° pan', () => {
    const w = 135, h = 180, acc = new ScanAccumulator({ w, h, longFov: 69, camHeight: 1.4 });
    for (let i = 0; i < 150; i++) acc.addFrame(renderSyntheticFrame(w, h, { room: [4.6, 3.4], yaw: (i / 149) * 372 }));
    const r = acc.result(), dims = [r.fit.width, r.fit.depth].sort();
    expect(r.coverage).toBeGreaterThan(330);
    expect(Math.abs(dims[0] - 3.4)).toBeLessThan(0.5);
    expect(Math.abs(dims[1] - 4.6)).toBeLessThan(0.5);
  });
  it('also works with the phone tipped down, in a small room', () => {
    const w = 135, h = 180, acc = new ScanAccumulator({ w, h, longFov: 69, camHeight: 1.4, pitch: 20 });
    for (let i = 0; i < 150; i++) acc.addFrame(renderSyntheticFrame(w, h, { room: [3.2, 2.8], pos: [1.6, 1.4], pitch: 20, yaw: (i / 149) * 372 }));
    const r = acc.result(), dims = [r.fit.width, r.fit.depth].sort();
    expect(Math.abs(dims[0] - 2.8)).toBeLessThan(0.45);
    expect(Math.abs(dims[1] - 3.2)).toBeLessThan(0.45);
  });
  it('places a detected object by bearing and floor contact', () => {
    const w = 270, h = 360, { f, vfov } = fovs(w, h, 69);
    const t = new ObjectTracker({ w, h, f, vfov, camHeight: 1.4 });
    // box centred, bottom edge 30° below the horizon -> 2.42 m (+0.3 nudge) straight ahead at yaw 90°
    const bottom = h / 2 + f * Math.tan(Math.PI / 6);
    for (let i = 0; i < 3; i++) t.add(90, [{ class: 'couch', score: 0.8, bbox: [w / 2 - 40, bottom - 60, 80, 60] }, { class: 'person', score: 0.9, bbox: [0, 0, 10, 10] }]);
    const out = t.result();
    expect(out.length).toBe(1); expect(out[0].type).toBe('sofa');
    const want = polarToPoint(90, 1.4 / Math.tan(Math.PI / 6) + 0.3);
    expect(out[0].x).toBeCloseTo(want[0], 1); expect(out[0].y).toBeCloseTo(want[1], 1);
  });
});

describe('navigation', () => {
  const plan = samplePlan(), nav = buildNav(plan, deriveWalls(plan));
  it('routes between rooms through doors', () => {
    const p = nav.path(2, 8, 8, 2, () => 1);
    expect(p).toBeTruthy(); expect(p.length).toBeGreaterThan(20);
  });
  it('walls block sight, impassable portals block paths', () => {
    expect(nav.los(2, 8, 8, 2, () => true)).toBe(false);
    expect(nav.los(1, 1, 5, 1, () => true)).toBe(true);
    expect(nav.path(2, 8, -3, -3, () => Infinity)).toBe(null);
  });
});

describe('simulation', () => {
  const run = (cfg, script = () => {}, max = 600) => {
    const sim = new Sim(samplePlan(), { seed: 3, ...cfg });
    for (let t = 0; t < max && !sim.outcome; t += 0.05) { script(sim, t); sim.update(0.05, {}); }
    return sim;
  };
  it('an unprepared, passive household gets burgled', () => {
    const s = run({ type: 'burglar' }, (sim) => { if (sim.t > 1 && !sim.player.hidden) { sim.player.x = 1.9; sim.player.y = 9.4; sim.doAction('hide'); } });
    expect(s.outcome.id).toBe('burgled'); expect(s.outcome.stolen).toBeGreaterThan(0);
  });
  it('layered deterrents turn an opportunist away before entry', () => {
    const s = run({ type: 'opportunist', upgrades: ['flood', 'dog', 'alarm', 'deadbolt', 'winlock'] });
    expect(['deterred', 'repelled']).toContain(s.outcome.id); expect(s.outcome.stolen).toBe(0);
  });
  it('calling early with strong doors gets the intruder arrested', () => {
    const s = run({ type: 'aggressive', upgrades: ['deadbolt', 'winlock', 'saferoom', 'barkit'] }, (sim) => {
      if (!sim.police.called && !sim.player.busy) sim.doAction('call');
      if (sim.police.called && !sim.player.hidden) { sim.player.x = 1.9; sim.player.y = 9.4; sim.doAction('hide'); }
    });
    expect(s.outcome.id).toBe('arrest');
  });
  it('standing in the open against an aggressive intruder ends badly', () => {
    const s = run({ type: 'aggressive', time: 'evening' }, (sim) => { sim.player.x = 5; sim.player.y = 5.8; });
    expect(s.outcome.id).toBe('caught');
  });
  it('every option can be used without errors', () => {
    const sim = new Sim(samplePlan(), { seed: 5, type: 'burglar', count: 2, upgrades: UPGRADES.map((u) => u.id) });
    const seen = new Set();
    for (let i = 0; i < 4000 && !sim.outcome; i++) {
      const acts = sim.actions().filter((a) => !a.off);
      const a = acts[i % Math.max(1, acts.length)];
      if (a && i % 7 === 0) { sim.doAction(a.id); seen.add(a.id); }
      sim.update(0.05, { fwd: Math.sin(i / 40), strafe: Math.cos(i / 55) });
      sim.player.yaw += 0.02;
    }
    expect(seen.size).toBeGreaterThan(8);
  });
});
