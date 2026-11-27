// Builds the 3D house from a floor plan and keeps it in sync with the simulation.
import * as THREE from 'three';
import { polyCentroid, polyArea, planBounds, itemSize, ROOM_TYPES } from '../plan/model.js';
import { material, flat, boxUV } from './textures.js';

export const WALL_H = 2.6, DOOR_H = 2.05, SILL = 0.9, WIN_TOP = 2.1, THICK = 0.14;

function polyGeometry(poly, y, up) {
  const pts = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], uv = [], nor = [], idx = [];
  for (const p of poly) { pos.push(p[0], y, p[1]); uv.push(p[0], p[1]); nor.push(0, up ? 1 : -1, 0); }
  const cw = THREE.ShapeUtils.isClockWise(pts);
  for (const t of tris) { if (cw === up) idx.push(t[0], t[1], t[2]); else idx.push(t[0], t[2], t[1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function figure(color, skin) {
  const g = new THREE.Group(), cloth = flat(color, 0.9), dark = flat(0x15161a, 0.9);
  const part = (w, h, d, x, y, z, m, pivotTop) => {
    const geo = new THREE.BoxGeometry(w, h, d); if (pivotTop) geo.translate(0, -h / 2, 0);
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  g.userData.legL = part(0.16, 0.85, 0.18, -0.11, 0.87, 0, dark, true);
  g.userData.legR = part(0.16, 0.85, 0.18, 0.11, 0.87, 0, dark, true);
  g.userData.torso = part(0.46, 0.62, 0.26, 0, 1.17, 0, cloth);
  g.userData.armL = part(0.12, 0.6, 0.14, -0.3, 1.46, 0, cloth, true);
  g.userData.armR = part(0.12, 0.6, 0.14, 0.3, 1.46, 0, cloth, true);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), flat(skin, 0.8)); head.position.set(0, 1.65, 0); head.castShadow = true; g.add(head);
  g.userData.head = head;
  return g;
}

function itemMesh(it) {
  const g = new THREE.Group(), [sw, sd] = itemSize(it);
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(boxUV(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
  const w = it.rot ? sd : sw, d = it.rot ? sw : sd; // local, before rotation
  const wood = material('wood', { color: 0x9a7a5c }), fabric = material('fabric'), metal = flat(0x3a3d42, 0.35, 0.8);
  switch (it.type) {
    case 'bed':
      box(w, 0.3, d, 0, 0.2, 0, wood); box(w - 0.06, 0.2, d - 0.1, 0, 0.45, 0.03, material('fabric', { color: 0x8fa3c9 }));
      box(w, 0.9, 0.08, 0, 0.5, -d / 2 + 0.04, wood); box(w * 0.36, 0.1, 0.4, -w * 0.22, 0.6, -d / 2 + 0.35, flat(0xf2f0ea, 0.9)); box(w * 0.36, 0.1, 0.4, w * 0.22, 0.6, -d / 2 + 0.35, flat(0xf2f0ea, 0.9));
      break;
    case 'wardrobe': box(w, 2, d, 0, 1, 0, wood); box(0.02, 1.8, 0.02, 0, 1, d / 2 + 0.01, flat(0x1a1a1a)); box(0.03, 0.2, 0.03, -0.06, 1.05, d / 2 + 0.02, metal); box(0.03, 0.2, 0.03, 0.06, 1.05, d / 2 + 0.02, metal); break;
    case 'sofa':
      box(w, 0.42, d, 0, 0.21, 0, fabric); box(w, 0.45, 0.22, 0, 0.62, -d / 2 + 0.11, fabric);
      box(0.2, 0.3, d, -w / 2 + 0.1, 0.55, 0, fabric); box(0.2, 0.3, d, w / 2 - 0.1, 0.55, 0, fabric);
      break;
    case 'table': box(w, 0.06, d, 0, 0.74, 0, wood); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.07, 0.72, 0.07, x * (w / 2 - 0.08), 0.36, z * (d / 2 - 0.08), wood); break;
    case 'counter': box(w, 0.86, d, 0, 0.43, 0, flat(0xe9e6df, 0.6)); box(w + 0.04, 0.05, d + 0.04, 0, 0.885, 0, flat(0x2b2d31, 0.25, 0.1)); box(0.5, 0.02, 0.36, w * 0.2, 0.915, 0, metal); break;
    case 'desk':
      box(w, 0.05, d, 0, 0.74, 0, wood); box(0.05, 0.72, d, -w / 2 + 0.03, 0.36, 0, wood); box(0.05, 0.72, d, w / 2 - 0.03, 0.36, 0, wood);
      g.userData.loot = [box(0.34, 0.02, 0.24, 0, 0.78, 0.05, metal), box(0.34, 0.22, 0.015, 0, 0.89, -0.07, flat(0x101820, 0.2, 0.3, { emissive: 0x1b3a66, emissiveIntensity: 0.6 }))];
      break;
    case 'tv':
      box(w, 0.45, d, 0, 0.225, 0, wood);
      g.userData.loot = [box(w * 0.9, 0.62, 0.04, 0, 0.82, 0, flat(0x08090b, 0.15, 0.4)), box(0.3, 0.06, 0.2, 0, 0.48, 0, metal)];
      break;
    case 'jewelry':
      box(w, 0.8, d, 0, 0.4, 0, wood);
      g.userData.loot = [box(0.28, 0.12, 0.2, 0, 0.86, 0, flat(0x7a1f2b, 0.4)), box(0.3, 0.02, 0.22, 0, 0.93, 0, flat(0xd8b45a, 0.25, 0.9))];
      break;
    case 'safe':
      box(w, 0.8, d, 0, 0.4, 0, flat(0x2d3238, 0.4, 0.75));
      g.userData.loot = [box(0.12, 0.12, 0.03, 0, 0.45, d / 2 + 0.015, flat(0xc8ccd2, 0.2, 0.9))];
      break;
    case 'chair': box(w, 0.06, d, 0, 0.45, 0, wood); box(w, 0.45, 0.05, 0, 0.7, -d / 2 + 0.03, wood); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, 0.44, 0.05, x * (w / 2 - 0.04), 0.22, z * (d / 2 - 0.04), wood); break;
    case 'fridge': box(w, 1.8, d, 0, 0.9, 0, flat(0xd9dde2, 0.3, 0.6)); box(0.03, 0.5, 0.04, -w / 2 + 0.08, 1.2, d / 2 + 0.02, metal); box(w, 0.012, 0.01, 0, 0.62, d / 2 + 0.005, flat(0x555a60)); break;
    case 'toilet': box(w, 0.4, d * 0.6, 0, 0.2, d * 0.15, flat(0xf4f4f1, 0.15)); box(w, 0.75, d * 0.28, 0, 0.375, -d * 0.36, flat(0xf4f4f1, 0.15)); break;
    case 'plant': {
      box(0.3, 0.3, 0.3, 0, 0.15, 0, flat(0x9a5a3a, 0.8));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), flat(0x2f6b34, 0.9)); leaves.position.y = 0.72; leaves.scale.y = 1.25; leaves.castShadow = true; g.add(leaves);
      break;
    }
    case 'breaker': box(w, 0.6, d, 0, 1.4, 0, flat(0x7d848c, 0.4, 0.6)); box(0.06, 0.1, 0.03, 0.1, 1.4, d / 2 + 0.015, flat(0xd33a2c, 0.5)); break;
    case 'car': {
      const paint = flat(0x7a1320, 0.22, 0.7), glass = flat(0x0c1218, 0.08, 0.6);
      box(w, 0.55, d, 0, 0.55, 0, paint); box(w - 0.18, 0.5, d * 0.5, 0, 1.08, d * 0.04, glass); box(w - 0.3, 0.04, d * 0.46, 0, 1.34, d * 0.04, paint);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18), flat(0x0e0e10, 0.9)); wh.rotation.z = Math.PI / 2; wh.position.set(x * (w / 2 - 0.08), 0.33, z * d * 0.32); g.add(wh);
      }
      const lamp = flat(0xfff2c2, 0.3, 0, { emissive: 0xffe9a0, emissiveIntensity: 0 });
      g.userData.lamps = [box(0.3, 0.12, 0.03, -w / 2 + 0.3, 0.62, -d / 2 - 0.01, lamp.clone()), box(0.3, 0.12, 0.03, w / 2 - 0.3, 0.62, -d / 2 - 0.01, lamp.clone())];
      break;
    }
  }
  g.position.set(it.x, 0, it.y);
  g.rotation.y = it.rot ? -Math.PI / 2 : 0;
  return g;
}

export class World {
  constructor(sim, { shadows = true, preview = false } = {}) {
    this.sim = sim;
    const plan = sim.plan, walls = sim.walls, root = (this.root = new THREE.Group());
    const b = planBounds(plan);
    this.center = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.y0 + b.y1) / 2);
    this.radius = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
    const day = preview;

    // --- sky & ambient ---
    this.hemi = new THREE.HemisphereLight(day ? 0xbfd6ff : 0x33405f, day ? 0x555040 : 0x0c0d12, day ? 1.1 : 0.55);
    root.add(this.hemi);
    const moon = (this.moon = new THREE.DirectionalLight(day ? 0xfff1d6 : 0x8fa8dc, day ? 2.4 : 0.9));
    moon.position.set(this.center.x - 14, 22, this.center.z - 9); moon.target.position.copy(this.center);
    if (shadows) {
      moon.castShadow = true; moon.shadow.mapSize.setScalar(2048);
      const r = this.radius + 7; Object.assign(moon.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 70 });
      moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.03;
    }
    root.add(moon, moon.target);
    if (!day) {
      const stars = new Float32Array(900);
      for (let i = 0; i < 300; i++) {
        const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.3;
        stars.set([this.center.x + Math.cos(a) * Math.cos(e) * 90, Math.sin(e) * 90, this.center.z + Math.sin(a) * Math.cos(e) * 90], i * 3);
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3));
      root.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.45, fog: false })));
    }

    // --- ground ---
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), material('grass'));
    ground.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 140; });
    ground.rotation.x = -Math.PI / 2; ground.position.set(this.center.x, -0.02, this.center.z); ground.receiveShadow = true; root.add(ground);

    // --- floors, ceilings, room lights ---
    this.ceilings = new THREE.Group(); root.add(this.ceilings);
    this.roomLights = {};
    const byArea = [...plan.rooms].sort((p, q) => polyArea(q.poly) - polyArea(p.poly));
    for (const r of plan.rooms) {
      const floor = new THREE.Mesh(polyGeometry(r.poly, 0, true), material(ROOM_TYPES[r.type].floor));
      floor.receiveShadow = true; root.add(floor);
      const ceil = new THREE.Mesh(polyGeometry(r.poly, WALL_H, false), material('plaster'));
      this.ceilings.add(ceil);
      // invisible slab so the moon cannot light the interior through the ceiling
      const lid = new THREE.Mesh(polyGeometry(r.poly, WALL_H + 0.02, true), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      lid.castShadow = true; root.add(lid);
      const c = polyCentroid(r.poly);
      const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0 }));
      bulb.position.set(c[0], WALL_H - 0.04, c[1]); root.add(bulb);
      let light = null;
      if (byArea.indexOf(r) < 8) { light = new THREE.PointLight(0xffe0b0, 0, 11, 1.6); light.position.set(c[0], WALL_H - 0.35, c[1]); root.add(light); }
      this.roomLights[r.id] = { light, bulb, power: Math.sqrt(polyArea(r.poly)) * 3.2 + 5 };
    }

    // --- walls ---
    const plaster = material('plaster'), brick = material('brick');
    const addWall = (wall, t0, t1, y0, y1) => {
      if (t1 - t0 < 0.01 || y1 - y0 < 0.01) return;
      const mats = [plaster, plaster, plaster, plaster, plaster, plaster];
      if (wall.exterior) mats[wall.outside > 0 ? 4 : 5] = brick;
      const m = new THREE.Mesh(boxUV(t1 - t0, y1 - y0, THICK), mats);
      const tm = (t0 + t1) / 2;
      m.position.set(wall.a[0] + wall.dir[0] * tm, (y0 + y1) / 2, wall.a[1] + wall.dir[1] * tm);
      m.rotation.y = -Math.atan2(wall.dir[1], wall.dir[0]);
      m.castShadow = m.receiveShadow = true; root.add(m);
    };
    const ext = THICK / 2 - 0.002;
    for (const wall of walls) {
      let t = wall.extA ? -ext : 0;
      for (const o of wall.openings) {
        addWall(wall, t, o.t - o.w / 2, 0, WALL_H);
        if (o.type === 'window') { addWall(wall, o.t - o.w / 2, o.t + o.w / 2, 0, SILL); addWall(wall, o.t - o.w / 2, o.t + o.w / 2, WIN_TOP, WALL_H); } else addWall(wall, o.t - o.w / 2, o.t + o.w / 2, DOOR_H, WALL_H);
        t = o.t + o.w / 2;
      }
      addWall(wall, t, wall.len + (wall.extB ? ext : 0), 0, WALL_H);
    }

    // --- doors & windows ---
    const frameM = flat(0xf3f1ec, 0.5), doorM = material('door'), entryM = material('door', { color: 0x4e6a8a });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x9fc4e6, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.6, side: THREE.DoubleSide });
    this.portals = sim.portals.map((p) => {
      const g = new THREE.Group(); g.position.set(p.x, 0, p.y); g.rotation.y = -Math.atan2(p.dir[1], p.dir[0]); root.add(g);
      const bar = (w, h, d, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameM); m.position.set(x, y, 0); g.add(m); return m; };
      const o = { p, g };
      if (p.type === 'window') {
        bar(p.w, 0.05, THICK + 0.04, 0, SILL); bar(p.w, 0.05, THICK + 0.04, 0, WIN_TOP); bar(0.05, WIN_TOP - SILL, THICK + 0.04, -p.w / 2, (SILL + WIN_TOP) / 2); bar(0.05, WIN_TOP - SILL, THICK + 0.04, p.w / 2, (SILL + WIN_TOP) / 2);
        bar(p.w, 0.03, 0.04, 0, (SILL + WIN_TOP) / 2);
        o.glass = new THREE.Mesh(new THREE.PlaneGeometry(p.w, WIN_TOP - SILL), glassM); o.glass.position.y = (SILL + WIN_TOP) / 2; g.add(o.glass);
      } else {
        bar(0.05, DOOR_H, THICK + 0.04, -p.w / 2, DOOR_H / 2); bar(0.05, DOOR_H, THICK + 0.04, p.w / 2, DOOR_H / 2); bar(p.w, 0.05, THICK + 0.04, 0, DOOR_H);
        o.hinge = new THREE.Group(); o.hinge.position.set(-p.w / 2 + 0.03, 0, 0); g.add(o.hinge);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(p.w - 0.07, DOOR_H - 0.04, 0.045), p.type === 'entry' ? entryM : doorM);
        leaf.position.set((p.w - 0.07) / 2, DOOR_H / 2, 0); leaf.castShadow = true; o.hinge.add(leaf);
        for (const z of [0.045, -0.045]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), flat(0xc9a646, 0.25, 0.9)); k.position.set(p.w - 0.17, 1, z); o.hinge.add(k); }
        o.bar = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.2, 0.09, 0.06), material('wood', { color: 0x9a7a5c })); o.bar.position.set(0, 1.05, 0.09); o.bar.visible = false; g.add(o.bar);
      }
      return o;
    });

    // --- furniture ---
    this.items = {};
    for (const it of sim.items) { const m = itemMesh(it); root.add(m); this.items[it.id] = m; }

    // --- characters ---
    this.playerFig = figure(0x2f6fd0, 0xe0b090); root.add(this.playerFig);
    this.intruders = sim.intruders.map(() => {
      const f = figure(0x1d1f24, 0x1b1b1e); root.add(f);
      const torch = new THREE.SpotLight(0xfff0d0, 0, 12, 0.42, 0.5, 1.4); torch.position.set(0.25, 1.25, -0.2); torch.target.position.set(0.25, 0.9, -4);
      f.add(torch, torch.target); f.userData.torch = torch;
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), flat(0x3d3526, 0.95)); bag.position.set(0, 1.15, 0.24); bag.visible = false; f.add(bag); f.userData.bag = bag;
      return f;
    });
    if (sim.up.has('dog')) {
      const dog = new THREE.Group(), fur = flat(0x6b4a2a, 0.95);
      const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fur); m.position.set(x, y, z); m.castShadow = true; dog.add(m); };
      add(0.26, 0.26, 0.6, 0, 0.42, 0); add(0.2, 0.2, 0.24, 0, 0.62, -0.36); add(0.07, 0.3, 0.07, -0.08, 0.15, -0.22); add(0.07, 0.3, 0.07, 0.08, 0.15, -0.22); add(0.07, 0.3, 0.07, -0.08, 0.15, 0.22); add(0.07, 0.3, 0.07, 0.08, 0.15, 0.22); add(0.05, 0.05, 0.22, 0, 0.56, 0.38);
      dog.position.set(sim.player.x + 0.8, 0, sim.player.y + 0.5); root.add(dog); this.dog = dog;
    }

    // --- exterior effect lights ---
    this.floods = [[b.x0 - 1, b.y0 - 1], [b.x1 + 1, b.y1 + 1]].map(([x, z]) => { const l = new THREE.PointLight(0xf4f8ff, 0, 30, 1.2); l.position.set(x, 3.4, z); root.add(l); return l; });
    this.police = [0xff2030, 0x2050ff].map((c, i) => { const l = new THREE.PointLight(c, 0, 45, 1.1); l.position.set(b.x0 - 3 + i * 1.5, 1.6, b.y1 + 4); root.add(l); return l; });
    this.sirenLight = new THREE.PointLight(0xff3020, 0, 14, 1.4); this.sirenLight.position.set(this.center.x, WALL_H - 0.3, this.center.z); root.add(this.sirenLight);
    this.thrown = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), flat(0xd8d8d8, 0.4, 0.5)); this.thrown.visible = false; root.add(this.thrown);
    this.floodOn = false; this.time = 0;
  }

  update(dt, firstPerson) {
    const sim = this.sim; this.time += dt;
    for (const r of sim.plan.rooms) {
      const L = this.roomLights[r.id], on = sim.power && sim.lights[r.id];
      if (L.light) L.light.intensity += ((on ? L.power : 0) - L.light.intensity) * Math.min(1, dt * 10);
      L.bulb.material.emissiveIntensity = on ? 2.2 : 0;
    }
    for (const o of this.portals) {
      const p = o.p;
      if (o.glass) o.glass.visible = p.state === 'closed' || p.state === 'locked';
      if (o.hinge) {
        o.hinge.rotation.y = p.swing * 1.75;
        o.hinge.rotation.x = p.state === 'broken' ? 0.12 : 0; o.hinge.rotation.z = p.state === 'broken' ? -0.1 : 0;
        o.bar.visible = p.barricade > 0 && p.state === 'locked';
      }
    }
    const P = sim.player, pf = this.playerFig;
    pf.visible = !firstPerson;
    pf.position.set(P.x, P.hidden ? -0.6 : 0, P.y); pf.rotation.y = -P.yaw;
    const sw = P.moving ? Math.sin(this.time * (P.sneak ? 6 : 11)) * 0.6 : 0;
    pf.userData.legL.rotation.x = sw; pf.userData.legR.rotation.x = -sw; pf.userData.armL.rotation.x = -sw; pf.userData.armR.rotation.x = sw;
    sim.intruders.forEach((it, i) => {
      const f = this.intruders[i]; f.visible = !it.gone && it.wait <= 0;
      f.position.set(it.x, 0, it.y); f.rotation.y = -it.yaw;
      const s = Math.sin(it.walk * 4.2) * 0.65, u = f.userData;
      u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.8;
      u.armR.rotation.x = it.work ? -1.3 + Math.sin(this.time * 9) * 0.5 : -0.9;
      u.torso.rotation.x = it.stun > 0 ? 0.7 : 0; u.head.position.z = it.stun > 0 ? -0.3 : 0; u.head.position.y = it.stun > 0 ? 1.5 : 1.65;
      u.torch.intensity = it.stun > 0 || it.state === 'flee' ? 0 : 55;
      u.bag.visible = it.loot > 0;
    });
    for (const it of sim.items) {
      const m = this.items[it.id];
      if (it.taken && m.userData.loot) for (const l of m.userData.loot) l.visible = false;
      if (m.userData.lamps) for (const l of m.userData.lamps) l.material.emissiveIntensity = sim.carAlarm > 0 && Math.sin(this.time * 12) > 0 ? 6 : 0;
    }
    for (const l of this.floods) l.intensity += ((this.floodOn ? 160 : 0) - l.intensity) * Math.min(1, dt * 12);
    const pol = sim.police.arrived || (sim.police.called && sim.police.eta < 8);
    this.police[0].intensity = pol && Math.sin(this.time * 9) > 0 ? 260 : 0;
    this.police[1].intensity = pol && Math.sin(this.time * 9) <= 0 ? 260 : 0;
    this.sirenLight.intensity = sim.alarm.on ? 14 + Math.sin(this.time * 10) * 14 : 0;
    if (this.thrown.visible) { this.thrownT -= dt; if (this.thrownT < 0) this.thrown.visible = false; }
  }
  throwAt(x, y) { this.thrown.position.set(x, 0.07, y); this.thrown.visible = true; this.thrownT = 12; }
}
