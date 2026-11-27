// 3D game shell: renderer, cameras, input (keyboard / touch / XR controllers), HUD and audio.
import * as THREE from 'three';
import { Sim } from './sim.js';
import { World } from './world.js';
import { Sfx } from './audio.js';
import { planBounds } from '../plan/model.js';

const HUD_HTML = `
<canvas class="g-canvas"></canvas>
<div class="g-vignette"></div>
<div class="g-top">
  <div class="g-btns">
    <button data-b="exit" aria-label="Exit">✕</button>
    <button data-b="view" aria-label="Toggle view">3D map</button>
    <button data-b="mute" aria-label="Sound">Sound on</button>
    <button data-b="vr" hidden>Enter VR</button>
  </div>
  <div class="g-chips"></div>
  <canvas class="g-map" width="300" height="300"></canvas>
</div>
<div class="g-toasts"></div>
<div class="g-busy" hidden><span></span><div><i></i></div></div>
<div class="g-joy"><i></i></div>
<div class="g-actions"></div>
<div class="g-hint">Drag to look · WASD / left stick to move · tap an option to act</div>`;

export class Game {
  constructor(el, plan, cfg, { onEnd, onExit } = {}) {
    this.el = el; this.onEnd = onEnd; this.onExit = onExit; this.cfg = cfg;
    el.innerHTML = HUD_HTML; el.classList.add('game');
    this.$ = (s) => el.querySelector(s);
    this.sim = new Sim(plan, cfg);
    this.capture = !!window.__capture;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.quality = cfg.quality || (coarse ? 'medium' : 'high');

    const canvas = this.$('.g-canvas');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = cfg.preview ? 1.0 : 1.25;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = (this.scene = new THREE.Scene());
    const sky = cfg.preview ? 0x9ec4ee : 0x060913;
    scene.background = new THREE.Color(sky); scene.fog = new THREE.FogExp2(sky, cfg.preview ? 0.006 : 0.02);
    this.world = new World(this.sim, { shadows: true, preview: cfg.preview });
    scene.add(this.world.root);

    this.rig = new THREE.Group(); this.head = new THREE.Group(); this.rig.add(this.head); scene.add(this.rig);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200); this.head.add(this.camera);
    this.tcam = new THREE.PerspectiveCamera(50, 1, 0.5, 300);
    this.torch = new THREE.SpotLight(0xfff4e0, 0, 16, 0.5, 0.45, 1.3); this.torch.position.set(0.15, -0.15, 0); this.torch.target.position.set(0.1, -0.3, -5);
    this.torch.castShadow = true; this.torch.shadow.mapSize.setScalar(1024); this.torch.shadow.bias = -0.002;
    this.camera.add(this.torch, this.torch.target);
    // a faint personal glow so the player can always just make out their surroundings
    this.aura = new THREE.PointLight(0x8aa0d0, cfg.preview ? 0 : 0.6, 6, 1.5); this.camera.add(this.aura);

    // overhead fill light so the night-time 3D map stays readable
    this.tacLight = new THREE.DirectionalLight(0xc8d4ff, 1.5); this.tacLight.position.set(this.world.center.x + 4, 30, this.world.center.z + 6); this.tacLight.target.position.copy(this.world.center); this.tacLight.visible = false; scene.add(this.tacLight, this.tacLight.target);
    this.fogDensity = scene.fog.density;
    this.pitch = 0; this.tactical = false; this.orbit = 0.6; this.eye = 1.6;
    this.keys = new Set(); this.joy = { x: 0, y: 0 }; this.toasts = []; this.actSig = ''; this.endT = -1; this.ended = false;
    this.sfx = new Sfx();
    this.bind();
    this.setupXR();
    this.resize();
    this.last = performance.now();
    if (this.capture) { window.__game = this; window.__step = (dt) => this.frame(dt); this.frame(0.016); } else r.setAnimationLoop(() => { const n = performance.now(), dt = Math.min(0.05, (n - this.last) / 1000); this.last = n; this.frame(dt); });
    window.__game = this;
  }

  // ---------- input ----------
  bind() {
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); (this.unbind ||= []).push(() => t.removeEventListener(e, f, o)); };
    on(window, 'resize', () => this.resize());
    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.sfx.unlock();
      if (e.code === 'KeyV') this.toggleView();
      const n = e.code.startsWith('Digit') ? +e.code.slice(5) : e.code === 'Space' ? 1 : 0;
      if (n) { const a = this.sim.actions()[n - 1]; if (a) this.sim.doAction(a.id); }
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    const c = this.$('.g-canvas'), joyEl = this.$('.g-joy'), ptrs = new Map();
    on(c, 'pointerdown', (e) => {
      this.sfx.unlock(); c.setPointerCapture(e.pointerId);
      const isJoy = e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.4 && ![...ptrs.values()].some((p) => p.joy);
      ptrs.set(e.pointerId, { joy: isJoy, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      if (isJoy) { joyEl.style.left = e.clientX + 'px'; joyEl.style.top = e.clientY + 'px'; joyEl.classList.add('on'); }
    });
    on(c, 'pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      if (p.joy) {
        const dx = e.clientX - p.x0, dy = e.clientY - p.y0, m = Math.max(1, Math.hypot(dx, dy) / 50);
        this.joy = { x: dx / 50 / m, y: dy / 50 / m };
        joyEl.firstElementChild.style.transform = `translate(${this.joy.x * 34}px,${this.joy.y * 34}px)`;
      } else {
        const k = 0.0045;
        if (this.tactical) this.orbit -= (e.clientX - p.x) * k; else { this.sim.player.yaw += (e.clientX - p.x) * k; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - (e.clientY - p.y) * k)); }
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => { const p = ptrs.get(e.pointerId); if (p?.joy) { this.joy = { x: 0, y: 0 }; joyEl.classList.remove('on'); joyEl.firstElementChild.style.transform = ''; } ptrs.delete(e.pointerId); };
    on(c, 'pointerup', up); on(c, 'pointercancel', up);
    on(this.$('.g-actions'), 'click', (e) => { const b = e.target.closest('button'); if (b) { this.sfx.unlock(); this.sim.doAction(b.dataset.id); } });
    on(this.$('.g-btns'), 'click', (e) => {
      const b = e.target.closest('button')?.dataset.b; this.sfx.unlock();
      if (b === 'exit') this.onExit?.();
      if (b === 'view') this.toggleView();
      if (b === 'mute') { this.sfx.setMuted(!this.sfx.muted); this.$('[data-b=mute]').textContent = this.sfx.muted ? 'Sound off' : 'Sound on'; }
      if (b === 'vr') this.enterVR();
    });
    on(this.$('.g-map'), 'click', () => this.toggleView());
  }
  toggleView() { this.tactical = !this.tactical; this.$('[data-b=view]').textContent = this.tactical ? 'First person' : '3D map'; }
  resize() {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight, a = w / h;
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h, false);
    this.camera.aspect = this.tcam.aspect = a;
    this.camera.fov = a < 1 ? Math.min(100, (2 * Math.atan(Math.tan((62 * Math.PI) / 360) / a) * 180) / Math.PI) : 70;
    this.camera.updateProjectionMatrix(); this.tcam.updateProjectionMatrix();
  }

  // ---------- XR (Meta Quest etc.) ----------
  setupXR() {
    const r = this.renderer;
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => { if (ok) this.$('[data-b=vr]').hidden = false; }).catch(() => {});
    r.xr.enabled = true; r.xr.setReferenceSpaceType('local-floor');
    this.panelCanvas = Object.assign(document.createElement('canvas'), { width: 720, height: 560 });
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas); this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.56), new THREE.MeshBasicMaterial({ map: this.panelTex, transparent: true, fog: false }));
    this.panelPivot = new THREE.Group(); this.panel.position.set(0, 1.0, -0.8); this.panel.rotation.x = -0.6; this.panelPivot.add(this.panel);
    this.panelPivot.visible = false; this.rig.add(this.panelPivot);
    this.ray = new THREE.Raycaster(); this.hover = -1; this.xrSnap = false;
    this.controllers = [0, 1].map((i) => {
      const c = r.xr.getController(i);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1.5)]), new THREE.LineBasicMaterial({ color: 0x9fd0ff, fog: false }));
      c.add(line); this.rig.add(c);
      c.addEventListener('selectstart', () => { const h = this.panelHit(c); if (h >= 0) { const a = this.xrActions[h]; if (a && !a.off) this.sim.doAction(a.id); } });
      return c;
    });
    r.xr.addEventListener('sessionstart', () => {
      this.tactical = false; this.head.position.y = 0; this.camera.rotation.set(0, 0, 0); this.panelPivot.visible = true;
      this.torch.castShadow = false; r.xr.setFoveation?.(1); this.sfx.unlock();
      // headsets render every frame twice: keep the (mostly static) moon shadow map from re-rendering each frame
      r.shadowMap.autoUpdate = false; this.shadowTick = 0;
    });
    r.xr.addEventListener('sessionend', () => { this.panelPivot.visible = false; this.torch.castShadow = true; r.shadowMap.autoUpdate = true; this.resize(); });
  }
  async enterVR() {
    try {
      const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      await this.renderer.xr.setSession(s);
    } catch (e) { this.toast('Could not start VR: ' + e.message, 'warn'); }
  }
  panelHit(c) {
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(c.matrixWorld); this.ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
    const hit = this.ray.intersectObject(this.panel)[0];
    if (!hit) return -1;
    const x = hit.uv.x * 720, y = (1 - hit.uv.y) * 560;
    if (y < 130) return -1;
    const i = Math.floor((y - 130) / 54) * 2 + (x > 360 ? 1 : 0);
    return i < (this.xrActions?.length || 0) ? i : -1;
  }
  updateXR(dt) {
    const s = this.renderer.xr.getSession(), P = this.sim.player, input = { fwd: 0, strafe: 0 };
    const headYaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y;
    for (const src of s.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      const x = gp.axes[2] ?? gp.axes[0] ?? 0, y = gp.axes[3] ?? gp.axes[1] ?? 0;
      if (src.handedness === 'left') { if (Math.hypot(x, y) > 0.15) { input.strafe = x; input.fwd = -y; } } else if (Math.abs(x) > 0.6) { if (!this.xrSnap) { this.rigYaw += Math.sign(x) * (Math.PI / 6); this.xrSnap = true; } } else this.xrSnap = false;
    }
    P.yaw = this.rigYaw - headYaw;
    // lazy-follow action panel
    let d = ((headYaw - this.panelPivot.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(d) > 0.8) this.panelFollow = true;
    if (this.panelFollow) { this.panelPivot.rotation.y += d * Math.min(1, dt * 5); if (Math.abs(d) < 0.05) this.panelFollow = false; }
    let hover = -1;
    for (const c of this.controllers) { const h = this.panelHit(c); if (h >= 0) hover = h; }
    const acts = this.sim.actions();
    const st = this.statusChips().map((c) => c[0]).join(' · ');
    const sig = JSON.stringify(acts) + hover + st + (this.toasts[0]?.text || '') + (this.sim.outcome?.id || '');
    if (sig !== this.panelSig) {
      this.panelSig = sig; this.xrActions = acts; this.hover = hover;
      const g = this.panelCanvas.getContext('2d'); g.clearRect(0, 0, 720, 560);
      g.fillStyle = 'rgba(10,14,24,.88)'; g.beginPath(); g.roundRect(0, 0, 720, 560, 24); g.fill();
      g.fillStyle = '#9fb4d8'; g.font = '600 24px system-ui,sans-serif'; g.fillText(st.slice(0, 54), 22, 40);
      g.fillStyle = '#fff'; g.font = '26px system-ui,sans-serif';
      const o = this.sim.outcome;
      g.fillText((o ? `${o.title} — grade ${o.grade}. Remove headset for debrief.` : this.toasts[0]?.text || 'Point and pull the trigger to choose.').slice(0, 52), 22, 88);
      acts.slice(0, 16).forEach((a, i) => {
        const x = 14 + (i % 2) * 350, y = 130 + Math.floor(i / 2) * 54;
        g.fillStyle = i === hover ? '#3b82f6' : a.off ? '#1c2230' : a.kind === 'key' ? '#14532d' : '#273149';
        g.beginPath(); g.roundRect(x, y, 340, 46, 10); g.fill();
        g.fillStyle = a.off ? '#667' : '#fff'; g.font = '24px system-ui,sans-serif'; g.fillText(a.label.slice(0, 26), x + 14, y + 31);
      });
      this.panelTex.needsUpdate = true;
    }
    return input;
  }

  // ---------- HUD ----------
  toast(text, tone = 'info') {
    const d = document.createElement('div'); d.className = 'toast ' + tone; d.textContent = text;
    const box = this.$('.g-toasts'); box.prepend(d);
    this.toasts.unshift({ el: d, t: 5, text });
    while (this.toasts.length > 3) this.toasts.pop().el.remove();
  }
  statusChips() {
    const s = this.sim, P = s.player, c = [];
    if (s.cfg.preview) return [['Walk-through preview', 'info']];
    if (s.police.arrived) c.push(['Police on scene', 'good']); else if (s.police.called) c.push([`Police ETA ${Math.ceil(s.police.eta)}s`, 'good']); else c.push(['Police not called', 'bad']);
    if (s.alarm.on) c.push(['Alarm sounding', 'warn']); else if (s.alarm.armed) c.push(['Alarm armed', 'info']);
    if (!s.power) c.push(['Power out', 'warn']);
    if (P.hidden) c.push(['Hidden', 'good']); else if (P.sneak) c.push(['Sneaking', 'info']);
    const inside = s.intruders.filter((i) => !i.gone && i.inside).length, out = s.intruders.filter((i) => !i.gone && !i.inside).length;
    if (inside) c.push([`${inside} inside`, 'bad']); else if (out) c.push([`${out} outside`, 'warn']);
    return c;
  }
  updateHUD(dt) {
    const s = this.sim, P = s.player;
    const chips = this.statusChips(), cs = JSON.stringify(chips);
    if (cs !== this.chipSig) { this.chipSig = cs; this.$('.g-chips').innerHTML = chips.map(([t, k]) => `<span class="chip ${k}">${t}</span>`).join(''); }
    const acts = s.actions(), sig = JSON.stringify(acts);
    if (sig !== this.actSig) {
      this.actSig = sig;
      this.$('.g-actions').innerHTML = acts.map((a, i) => `<button data-id="${a.id}" class="${a.kind || ''}" ${a.off ? 'disabled' : ''}><kbd>${i < 9 ? i + 1 : ''}</kbd>${a.label}</button>`).join('');
    }
    const busy = this.$('.g-busy'); busy.hidden = !P.busy;
    if (P.busy) { busy.firstElementChild.textContent = { call: 'Calling police…', barricade: 'Barricading…', climb: 'Climbing…', breaker: 'At the breaker…' }[P.busy.label]; busy.querySelector('i').style.width = (P.busy.t / P.busy.total) * 100 + '%'; }
    for (const t of this.toasts) { t.t -= dt; if (t.t <= 0) t.el.remove(); }
    this.toasts = this.toasts.filter((t) => t.t > 0);
    const grab = Math.max(0, ...s.intruders.map((i) => i.grab || 0));
    this.$('.g-vignette').style.opacity = s.outcome?.id === 'caught' ? 1 : Math.min(1, grab / 1.3);
    this.drawMap();
  }
  drawMap() {
    const cv = this.$('.g-map'), g = cv.getContext('2d'), s = this.sim, b = planBounds(s.plan), pad = 3.2;
    const sc = Math.min(cv.width / (b.x1 - b.x0 + pad * 2), cv.height / (b.y1 - b.y0 + pad * 2));
    const X = (x) => (x - b.x0 + pad) * sc + (cv.width - (b.x1 - b.x0 + pad * 2) * sc) / 2, Y = (y) => (y - b.y0 + pad) * sc + (cv.height - (b.y1 - b.y0 + pad * 2) * sc) / 2;
    g.clearRect(0, 0, cv.width, cv.height);
    for (const r of s.plan.rooms) {
      g.beginPath(); r.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath();
      g.fillStyle = s.power && s.lights[r.id] ? 'rgba(255,224,160,.35)' : 'rgba(120,140,180,.22)'; g.fill();
    }
    g.strokeStyle = '#dfe6f5'; g.lineWidth = 3; g.lineCap = 'butt';
    for (const w of s.walls) { g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke(); }
    for (const p of s.portals) {
      g.strokeStyle = p.state === 'broken' ? '#ff4d4d' : p.state === 'locked' ? (p.barricade ? '#c084fc' : '#facc15') : p.state === 'open' ? '#0b1020' : p.type === 'window' ? '#60a5fa' : '#4ade80';
      g.lineWidth = 5; g.beginPath(); g.moveTo(X(p.x - (p.dir[0] * p.w) / 2), Y(p.y - (p.dir[1] * p.w) / 2)); g.lineTo(X(p.x + (p.dir[0] * p.w) / 2), Y(p.y + (p.dir[1] * p.w) / 2)); g.stroke();
    }
    for (const it of s.items) if (it.def.loot && !it.taken) { g.fillStyle = '#fbbf24'; g.fillRect(X(it.x) - 4, Y(it.y) - 4, 8, 8); }
    const n = s.lastNoise;
    if (n && s.t - n.t < 3 && n.kind !== 'steps') { g.fillStyle = `rgba(255,120,80,${1 - (s.t - n.t) / 3})`; g.font = 'bold 26px sans-serif'; g.fillText('!', X(n.x) - 4, Y(n.y) + 8); }
    for (const it of s.intruders) {
      if (it.gone || it.wait > 0 || !(s.up.has('camera') || it.known > 0)) continue;
      g.fillStyle = it.stun > 0 ? '#fb923c' : '#ef4444'; g.beginPath(); g.arc(X(it.x), Y(it.y), 8, 0, 7); g.fill();
    }
    const P = s.player; g.save(); g.translate(X(P.x), Y(P.y)); g.rotate(P.yaw);
    g.fillStyle = P.hidden ? '#86efac' : '#38bdf8'; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.restore();
  }

  // ---------- frame ----------
  frame(dt) {
    const s = this.sim, P = s.player, k = this.keys, xr = this.renderer.xr.isPresenting;
    let input;
    if (xr) { this.rigYaw ??= P.yaw; input = this.updateXR(dt); } else {
      this.rigYaw = undefined;
      const turn = (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0);
      if (this.tactical) this.orbit -= turn * dt * 1.2; else P.yaw += turn * dt * 2.1;
      input = {
        fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.joy.y,
        strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.joy.x,
      };
    }
    s.update(dt, input);
    for (const e of s.events.splice(0)) {
      if (e.type === 'msg') this.toast(e.text, e.tone);
      else if (e.type === 'sound') { if (e.name === 'siren') continue; const d = e.x || e.y ? Math.hypot(e.x - P.x, e.y - P.y) : 0; this.sfx.play(e.name, Math.max(0, 1 - d / 22)); } else if (e.type === 'throw') this.world.throwAt(e.x, e.y);
      else if (e.type === 'flood') this.world.floodOn = true;
      else if (e.type === 'end') this.endT = s.outcome.id === 'caught' ? 1.6 : 3.2;
    }
    this.sfx.loop('siren', s.alarm.on && !this.ended); this.sfx.loop('car', s.carAlarm > 0 && !this.ended);
    if (this.endT > 0) { this.endT -= dt; if (this.endT <= 0 && !this.ended) { this.ended = true; this.sfx.stopAll(); if (xr) this.renderer.xr.getSession().end().catch(() => {}); this.onEnd?.(s.outcome); } }

    // camera
    const eye = P.hidden ? 0.75 : P.sneak ? 1.2 : 1.6; this.eye += (eye - this.eye) * Math.min(1, dt * 8);
    this.rig.position.set(P.x, 0, P.y);
    if (xr) this.rig.rotation.y = -this.rigYaw; else { this.rig.rotation.y = -P.yaw; this.head.position.y = this.eye + (P.moving ? Math.sin(this.world.time * 10) * 0.025 : 0); this.camera.rotation.x = this.pitch; }
    this.torch.visible = P.torch; this.torch.intensity = 70;
    const tact = this.tactical && !xr;
    this.world.ceilings.visible = !tact;
    this.world.hemi.intensity = s.cfg.preview ? 1.1 : 0.55;
    this.tacLight.visible = tact && !s.cfg.preview; this.scene.fog.density = tact ? 0.003 : this.fogDensity;
    this.world.update(dt, !tact);
    if (tact) {
      if (!this.keys.size) this.orbit += dt * 0.12;
      // back off far enough that the whole house fits the narrower of the two view angles
      const c = this.world.center, half = Math.min(Math.tan((25 * Math.PI) / 180), Math.tan((25 * Math.PI) / 180) * this.tcam.aspect);
      const D = (this.world.radius * 1.25 + 1.5) / half;
      this.tcam.position.set(c.x + Math.sin(this.orbit) * D * 0.66, D * 0.75, c.z + Math.cos(this.orbit) * D * 0.66); this.tcam.lookAt(c.x, 0.5, c.z);
    }
    if (xr && (this.shadowTick -= dt) <= 0) { this.shadowTick = 0.5; this.renderer.shadowMap.needsUpdate = true; }
    this.updateHUD(dt);
    this.renderer.render(this.scene, tact ? this.tcam : this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null); this.sfx.stopAll();
    for (const f of this.unbind || []) f();
    this.renderer.dispose(); this.el.innerHTML = ''; this.el.classList.remove('game');
    if (window.__game === this) { window.__game = null; window.__step = null; }
  }
}
