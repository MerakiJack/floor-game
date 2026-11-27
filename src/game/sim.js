// Home-invasion simulation: pure game logic (no rendering) so it can be unit-tested.
import { deriveWalls, roomAt, polyCentroid, ITEM_TYPES } from '../plan/model.js';
import { buildNav } from './nav.js';

export const UPGRADES = [
  { id: 'deadbolt', name: 'Deadbolts & strike plates', cost: 2, desc: 'Exterior doors take far longer to kick in.' },
  { id: 'winlock', name: 'Window locks & security film', cost: 2, desc: 'Windows resist being forced or smashed.' },
  { id: 'alarm', name: 'Alarm with door/window sensors', cost: 3, desc: 'Siren the moment an entry point is breached.' },
  { id: 'monitor', name: 'Alarm monitoring', cost: 2, needs: 'alarm', desc: 'Police are dispatched automatically after the siren.' },
  { id: 'camera', name: 'Security cameras', cost: 2, desc: 'Always see intruders on your map.' },
  { id: 'flood', name: 'Motion floodlights', cost: 1, desc: 'Exposes anyone approaching — rattles their nerve.' },
  { id: 'dog', name: 'Dog', cost: 2, desc: 'Early warning bark and a constant deterrent.' },
  { id: 'smartlock', name: 'Smart locks', cost: 2, desc: 'Lock every door in the house from your phone.' },
  { id: 'saferoom', name: 'Safe room', cost: 3, desc: 'Bedroom doors are reinforced — very hard to force once locked.' },
  { id: 'panic', name: 'Panic button', cost: 1, desc: 'Trigger a siren yourself at any moment.' },
  { id: 'spray', name: 'Pepper spray', cost: 1, desc: 'Two uses. Stuns at close range — a last resort.' },
  { id: 'barkit', name: 'Door barricade bar', cost: 1, desc: 'Barricade doors twice as fast and twice as strong.' },
  { id: 'boltsafe', name: 'Bolted-down safe', cost: 1, desc: 'Safes take much longer to crack.' },
  { id: 'neighbor', name: 'Neighbourhood watch', cost: 1, desc: 'A neighbour calls the police when they hear trouble.' },
];

export const INTRUDER_TYPES = {
  opportunist: { label: 'Opportunist', nerve: 55, chase: false, speed: 1.5, carry: 2, desc: 'Wants an easy score. Flees at the first sign of trouble.' },
  burglar: { label: 'Determined burglar', nerve: 120, chase: true, speed: 1.7, carry: 3, desc: 'Came prepared. Will push through locks and may confront you.' },
  aggressive: { label: 'Aggressive intruder', nerve: 200, chase: true, speed: 1.9, carry: 3, desc: 'Not easily scared and actively hunts for occupants.' },
};

export const BUDGETS = { easy: 12, normal: 8, hard: 5 };

export const OUTCOMES = {
  arrest: { title: 'Intruder arrested', good: true, base: 100, text: 'Police arrived while the intruder was still on the property.' },
  deterred: { title: 'Deterred before entry', good: true, base: 96, text: 'Your defences convinced them to leave before they ever got inside.' },
  repelled: { title: 'Intruder driven off', good: true, base: 86, text: 'They lost their nerve and ran.' },
  escaped: { title: 'You got out safely', good: true, base: 82, text: 'You left the house and reached safety — your life matters more than property.' },
  burgled: { title: 'Safe, but burgled', good: true, base: 55, text: 'They took what they wanted and left. You were unharmed.' },
  caught: { title: 'Caught by the intruder', good: false, base: 0, text: 'The intruder got hold of you. Avoiding confrontation is always the priority.' },
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Sim {
  constructor(plan, cfg = {}) {
    this.plan = plan;
    this.cfg = { type: 'burglar', count: 1, time: 'night', powerCut: false, upgrades: [], seed: 1, preview: false, ...cfg };
    this.up = new Set(this.cfg.upgrades);
    this.rand = mulberry(this.cfg.seed);
    this.walls = deriveWalls(plan);
    this.nav = buildNav(plan, this.walls);
    this.events = [];
    this.t = 0;
    this.outcome = null;
    this.stats = { spotted: 0, stolen: 0, called: false, actions: new Set() };

    this.portals = this.nav.portals.map((p) => {
      const inner = roomAt(plan, [p.x + p.n[0] * 0.5, p.y + p.n[1] * 0.5]), other = roomAt(plan, [p.x - p.n[0] * 0.5, p.y - p.n[1] * 0.5]);
      const safe = this.up.has('saferoom') && p.type === 'door' && [inner, other].some((r) => r && r.type === 'bedroom');
      let state = 'closed';
      if (p.type === 'entry') state = this.cfg.preview ? 'closed' : 'locked';
      if (p.type === 'door') state = p.w > 1.1 || this.cfg.preview ? 'open' : 'closed';
      return { ...p, state, barricade: 0, damage: 0, safe, swing: state === 'open' ? 1 : 0 };
    });
    this.items = plan.items.map((i) => ({ ...i, def: ITEM_TYPES[i.type], taken: false }));
    this.lights = {};
    for (const r of plan.rooms) this.lights[r.id] = this.cfg.preview || (this.cfg.time === 'evening' && ['living', 'kitchen', 'hall'].includes(r.type));
    this.power = !this.cfg.powerCut;
    this.alarm = { armed: this.up.has('alarm'), on: false, since: 0 };
    this.police = { called: false, eta: 0, arrived: false, by: '' };
    this.carAlarm = 0;
    this.lastNoise = null;

    const start = plan.rooms.find((r) => r.type === 'bedroom') || plan.rooms[0];
    const c = start ? polyCentroid(start.poly) : [0, 0];
    const [px, py] = this.nav.freeNear(c[0], c[1] - 0.6);
    this.player = { x: px, y: py, yaw: 0, sneak: false, hidden: false, torch: false, busy: null, spray: this.up.has('spray') ? 2 : 0, shoutCd: 0, throwCd: 0, step: 0, moving: false };

    this.intruders = [];
    if (!this.cfg.preview) {
      const def = INTRUDER_TYPES[this.cfg.type];
      for (let i = 0; i < this.cfg.count; i++) {
        const [sx, sy] = this.spawnPoint();
        this.intruders.push({
          id: i, x: sx, y: sy, yaw: 0, sx, sy, def, nerve: def.nerve * (0.9 + this.rand() * 0.2), state: 'approach', path: null, repath: 0,
          wait: i * 6 + 5, work: null, stun: 0, grab: 0, loot: 0, seen: 0, lost: 0, inside: false, gone: false, arrested: false,
          warned: {}, known: 0, target: null, walk: 0, searchLeft: 3,
        });
      }
      this.msg(this.cfg.powerCut ? 'The power just went out. Something is wrong.' : 'You wake to a noise outside. Someone is on the property.', 'warn');
    }
  }

  // ---------- helpers ----------
  msg(text, tone = 'info') { this.events.push({ type: 'msg', text, tone }); }
  sound(name, x, y) { this.events.push({ type: 'sound', name, x, y }); }
  isOpen = (i) => { const s = this.portals[i].state; return s === 'open' || s === 'broken'; };
  seeThrough = (i) => this.portals[i].type === 'window' || this.isOpen(i);
  room(e) { return roomAt(this.plan, [e.x, e.y]); }
  lit(e) { const r = this.room(e); return !!(r && this.power && this.lights[r.id]); }
  spawnPoint() {
    const n = this.nav, b = n.bounds, m = n.margin - 0.8, side = Math.floor(this.rand() * 4), t = this.rand();
    const x = b.x0 - m + t * (b.x1 - b.x0 + m * 2), y = b.y0 - m + t * (b.y1 - b.y0 + m * 2);
    return [[x, b.y0 - m], [b.x1 + m, y], [x, b.y1 + m], [b.x0 - m, y]][side];
  }
  breachTime(p) {
    if (this.isOpen(this.portals.indexOf(p))) return 0;
    let t = 0;
    if (p.type === 'window') t = 7 + (this.up.has('winlock') ? 14 : 0);
    else if (p.type === 'entry') t = p.state === 'locked' ? 6 + (this.up.has('deadbolt') ? 15 : 0) : 0.8;
    else t = p.state === 'locked' ? 5 + (p.safe ? 22 : 0) : 0.8;
    return Math.max(0.8, t + p.barricade - p.damage);
  }
  portalCost = (i) => this.breachTime(this.portals[i]) * 1.6;
  noise(x, y, radius, kind) {
    this.lastNoise = { x, y, t: this.t, kind };
    for (const it of this.intruders) {
      if (it.gone || it.stun > 0 || it.state === 'flee' || it.state === 'chase' || it.state === 'approach') continue;
      if (Math.hypot(it.x - x, it.y - y) > radius) continue;
      if (kind === 'lure' || it.def.chase) { it.state = 'investigate'; it.target = { x, y }; it.path = null; it.work = null; }
    }
  }
  scare(it, amount, key, cooldown = 0) {
    if (key && cooldown && this.t - (it.warned[key] ?? -99) < cooldown) return;
    if (key) { amount /= 1 + (it.warned[key + '#'] || 0) * 0.6; it.warned[key] = this.t; it.warned[key + '#'] = (it.warned[key + '#'] || 0) + 1; }
    it.nerve -= amount;
  }
  callPolice(by) {
    if (this.police.called) return;
    this.police = { called: true, eta: 45 + this.rand() * 12, arrived: false, by };
    this.stats.called = true;
    this.msg(by === 'you' ? 'Emergency call connected. Police are on the way.' : `${by} — police dispatched.`, 'good');
  }
  siren(reason) {
    if (this.alarm.on) return;
    this.alarm.on = true; this.alarm.since = this.t;
    this.msg(`ALARM: ${reason}`, 'warn');
    this.sound('siren', 0, 0);
  }

  // ---------- player options ----------
  nearPortal(maxD = 1.5) {
    let best = null;
    for (const p of this.portals) {
      const d = Math.hypot(p.x - this.player.x, p.y - this.player.y);
      if (d < maxD && (!best || d < best.d)) best = { p, d };
    }
    return best && best.p;
  }
  nearItem(pred, maxD = 1.6) {
    return this.items.find((i) => pred(i) && Math.hypot(i.x - this.player.x, i.y - this.player.y) < maxD + Math.max(i.def.w, i.def.d) / 2);
  }
  /** Options currently available to the player. */
  actions() {
    const P = this.player, A = [];
    const add = (id, label, o = {}) => A.push({ id, label, ...o });
    if (this.outcome) return A;
    if (P.busy) return [{ id: 'cancel', label: `Cancel ${P.busy.label}`, kind: 'warn' }];
    if (P.hidden) return [{ id: 'hide', label: 'Leave hiding spot' }, ...(this.police.called ? [] : [{ id: 'call', label: 'Whisper call to police', kind: 'key' }])];
    if (this.cfg.preview) {
      const p = this.nearPortal();
      if (p && p.type !== 'window') add('door', p.state === 'open' ? 'Close door' : 'Open door');
      const r0 = this.room(P); if (r0) add('light', this.lights[r0.id] ? 'Lights off' : 'Lights on');
      return A;
    }
    if (!this.police.called) add('call', 'Call police', { kind: 'key' });
    const p = this.nearPortal();
    if (p && p.state !== 'broken') {
      if (p.type === 'window') add('climb', 'Climb out window');
      else {
        add('door', p.state === 'open' ? 'Close door' : p.state === 'locked' ? 'Unlock & open door' : 'Open door');
        if (p.state !== 'open') add('lock', p.state === 'locked' ? 'Unlock door' : 'Lock door');
        if (p.state !== 'open' && !p.barricade) add('barricade', 'Barricade door');
      }
    }
    if (this.nearItem((i) => i.def.hide)) add('hide', 'Hide here');
    const r = this.room(P);
    if (r) add('light', this.lights[r.id] ? 'Lights off' : 'Lights on', { off: !this.power });
    if (this.nearItem((i) => i.type === 'breaker')) add('breaker', this.power ? 'Cut main power' : 'Restore power');
    add('sneak', P.sneak ? 'Stop sneaking' : 'Sneak (quiet)');
    add('torch', P.torch ? 'Torch off' : 'Torch on');
    add('shout', 'Shout a warning', { off: P.shoutCd > 0 });
    add('throw', 'Throw a distraction', { off: P.throwCd > 0 });
    if (this.up.has('panic') && !this.alarm.on) add('panic', 'Panic button');
    if (this.up.has('smartlock')) add('smartlock', 'Smart-lock all doors');
    if (this.items.some((i) => i.type === 'car') && !this.carAlarm) add('car', 'Set off car alarm');
    if (this.up.has('spray')) add('spray', `Pepper spray (${P.spray})`, { off: P.spray <= 0, kind: 'warn' });
    return A;
  }

  doAction(id) {
    const P = this.player;
    if (this.outcome) return;
    if (!this.actions().some((a) => a.id === id && !a.off)) return;
    this.stats.actions.add(id);
    const busy = (label, time, done) => { P.busy = { label, t: 0, total: time, done }; };
    const p = this.nearPortal();
    switch (id) {
      case 'cancel': P.busy = null; break;
      case 'call':
        busy('call', P.hidden ? 7 : 5, () => this.callPolice('you'));
        if (!P.hidden) this.noise(P.x, P.y, 4, 'voice');
        break;
      case 'door':
        if (p.state === 'open') p.state = 'closed'; else { p.state = 'open'; p.barricade = 0; }
        this.sound('door', p.x, p.y); this.noise(p.x, p.y, P.sneak ? 2 : 5, 'door');
        break;
      case 'lock':
        p.state = p.state === 'locked' ? 'closed' : 'locked'; this.sound('lock', p.x, p.y);
        break;
      case 'barricade': {
        const kit = this.up.has('barkit');
        busy('barricade', kit ? 2.5 : 5, () => {
          if (p.state === 'open' || p.state === 'broken') return;
          p.state = 'locked'; p.barricade = kit ? 18 : 9; this.sound('thud', p.x, p.y); this.noise(p.x, p.y, 6, 'door');
          this.msg('Door barricaded.', 'good');
        });
        break;
      }
      case 'climb':
        busy('climb', 3, () => {
          const side = Math.sign((P.x - p.x) * p.n[0] + (P.y - p.y) * p.n[1]) || 1;
          const [nx, ny] = this.nav.freeNear(p.x - p.n[0] * side * 0.7, p.y - p.n[1] * side * 0.7);
          p.state = 'open'; P.x = nx; P.y = ny; this.sound('door', p.x, p.y); this.noise(p.x, p.y, 5, 'door');
        });
        break;
      case 'hide':
        P.hidden = !P.hidden; P.torch = false;
        this.msg(P.hidden ? 'You are hidden. Stay still.' : 'You leave your hiding spot.');
        break;
      case 'light': {
        const r = this.room(P); this.lights[r.id] = !this.lights[r.id]; this.sound('lock', P.x, P.y);
        break;
      }
      case 'breaker':
        busy('breaker', 1.5, () => {
          this.power = !this.power; this.sound('thud', P.x, P.y);
          this.msg(this.power ? 'Power restored.' : 'Main power cut — the house goes dark.');
          if (!this.power && this.alarm.on && !this.up.has('monitor')) { this.alarm.on = false; this.msg('The siren dies with the power.', 'warn'); }
        });
        break;
      case 'sneak': P.sneak = !P.sneak; break;
      case 'torch': P.torch = !P.torch; break;
      case 'shout':
        P.shoutCd = 6; this.sound('shout', P.x, P.y);
        this.msg('"Police are on their way! Get out!"');
        for (const it of this.intruders) if (!it.gone && Math.hypot(it.x - P.x, it.y - P.y) < 14) this.scare(it, it.def.chase ? 14 : 30, 'shout');
        this.noise(P.x, P.y, 14, 'voice');
        break;
      case 'throw': {
        P.throwCd = 8;
        let tx = P.x, ty = P.y;
        for (let d = 0.4; d <= 7; d += 0.2) {
          const x = P.x + Math.sin(P.yaw) * d, y = P.y - Math.cos(P.yaw) * d;
          if (this.nav.blockedAt(x, y, this.isOpen)) break;
          tx = x; ty = y;
        }
        this.sound('thud', tx, ty); this.events.push({ type: 'throw', x: tx, y: ty });
        this.noise(tx, ty, 11, 'lure');
        this.msg('You throw something — it clatters in the dark.');
        break;
      }
      case 'panic': this.siren('panic button pressed'); break;
      case 'smartlock': {
        let n = 0;
        for (const q of this.portals) if (q.type !== 'window' && q.state === 'closed') { q.state = 'locked'; n++; }
        this.sound('lock', P.x, P.y); this.msg(`Smart locks engaged on ${n} door${n === 1 ? '' : 's'}.`, 'good');
        break;
      }
      case 'car': {
        const car = this.items.find((i) => i.type === 'car');
        this.carAlarm = 25; this.sound('car', car.x, car.y); this.msg('Car alarm blaring from the key fob.', 'good');
        this.noise(car.x, car.y, 30, 'lure');
        break;
      }
      case 'spray': {
        P.spray--; this.sound('spray', P.x, P.y);
        let hit = false;
        for (const it of this.intruders) {
          if (it.gone) continue;
          const d = Math.hypot(it.x - P.x, it.y - P.y);
          const ang = Math.atan2(it.x - P.x, -(it.y - P.y));
          const da = Math.abs(((ang - P.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (d < 3.6 && da < 0.75 && this.nav.los(P.x, P.y, it.x, it.y, this.isOpen)) { // not through glass
            it.stun = 7; it.grab = 0; it.work = null; this.scare(it, 55); hit = true;
          }
        }
        this.msg(hit ? 'Direct hit — the intruder is blinded. Move!' : 'The spray misses.', hit ? 'good' : 'warn');
        break;
      }
    }
  }

  // ---------- main update ----------
  /** input: { fwd, strafe } in -1..1 relative to player yaw; yaw is set directly on sim.player. */
  update(dt, input = {}) {
    if (this.outcome) return;
    this.t += dt;
    const P = this.player;
    P.shoutCd = Math.max(0, P.shoutCd - dt); P.throwCd = Math.max(0, P.throwCd - dt);
    const mag = Math.min(1, Math.hypot(input.fwd || 0, input.strafe || 0));
    P.moving = false;
    if (P.busy) {
      if (mag > 0.3) { P.busy = null; this.msg('Interrupted.'); } else {
        P.busy.t += dt;
        if (P.busy.t >= P.busy.total) { const b = P.busy; P.busy = null; b.done(); }
      }
    } else if (mag > 0.05 && !P.hidden) {
      const speed = (P.sneak ? 1.2 : 2.8) * mag * dt;
      const s = Math.sin(P.yaw), c = Math.cos(P.yaw);
      const dx = ((input.fwd || 0) * s + (input.strafe || 0) * c) / Math.max(1, mag) * speed;
      const dy = (-(input.fwd || 0) * c + (input.strafe || 0) * s) / Math.max(1, mag) * speed;
      if (this.nav.canStand(P.x + dx, P.y, this.isOpen)) P.x += dx;
      if (this.nav.canStand(P.x, P.y + dy, this.isOpen)) P.y += dy;
      P.moving = true;
      P.step += speed;
      if (P.step > 1.4) { P.step = 0; if (!P.sneak) { this.sound('step', P.x, P.y); this.noise(P.x, P.y, 4.5, 'steps'); } }
    }
    for (const p of this.portals) p.swing += ((this.isOpen(this.portals.indexOf(p)) ? 1 : 0) - p.swing) * Math.min(1, dt * 8);
    if (this.cfg.preview) return;

    if (this.carAlarm > 0) this.carAlarm -= dt;
    if (this.alarm.on && this.up.has('monitor') && this.t - this.alarm.since > 8) this.callPolice('Alarm monitoring centre');
    if (this.up.has('neighbor') && (this.alarm.on || this.carAlarm > 0 || (this.lastNoise && this.lastNoise.kind === 'glass')) && !this.police.called) {
      this.neigh = (this.neigh || 0) + dt;
      if (this.neigh > 14) this.callPolice('A neighbour heard the commotion');
    }
    if (this.police.called && !this.police.arrived) {
      this.police.eta -= dt;
      if (this.police.eta <= 0) {
        this.police.arrived = true; this.sound('police', 0, 0);
        const here = this.intruders.filter((i) => !i.gone);
        for (const i of here) { i.arrested = true; i.gone = true; }
        return this.finish(here.length ? 'arrest' : null);
      }
    }
    for (const it of this.intruders) if (!it.gone) this.updateIntruder(it, dt);
    if (this.outcome) return;
    if (this.nav.outsideGrid(P.x, P.y)) return this.finish('escaped');
    if (this.intruders.every((i) => i.gone)) this.finish(null);
  }

  finish(forced) {
    let o = forced;
    if (!o) {
      if (this.stats.stolen > 0) o = 'burgled';
      else if (this.intruders.every((i) => !i.entered)) o = 'deterred';
      else o = 'repelled';
    }
    const def = OUTCOMES[o];
    let score = def.base;
    if (o !== 'caught') {
      score -= this.stats.stolen * 8;
      if (this.stats.called && o !== 'arrest') score += 4;
      score -= Math.min(12, this.stats.spotted * 6);
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score > 0 ? 'D' : 'F';
    this.outcome = { id: o, ...def, score, grade, time: this.t, stolen: this.stats.stolen, spotted: this.stats.spotted, called: this.stats.called, actions: [...this.stats.actions] };
    this.events.push({ type: 'end' });
  }

  goTo(it, x, y) {
    it.path = this.nav.path(it.x, it.y, x, y, this.portalCost);
    it.dest = { x, y };
    return !!it.path;
  }

  updateIntruder(it, dt) {
    const P = this.player;
    if (it.wait > 0) { it.wait -= dt; return; }
    if (it.known > 0) it.known -= dt;
    if (it.stun > 0) {
      it.stun -= dt;
      if (it.stun <= 0 && it.nerve > 0) { it.state = it.def.chase ? 'search' : 'flee'; it.path = null; it.target = { x: P.x, y: P.y }; }
      return;
    }
    const b = this.nav.bounds;
    const nearHouse = it.x > b.x0 - 3 && it.x < b.x1 + 3 && it.y > b.y0 - 3 && it.y < b.y1 + 3;
    const wasInside = it.inside;
    it.inside = !!this.room(it);
    if (it.inside && !wasInside && !it.entered) { it.entered = true; this.msg('An intruder is inside the house.', 'warn'); }

    // --- deterrents ---
    const soft = it.def.chase ? 0.45 : 1;
    if (nearHouse && it.state === 'approach') {
      if (this.up.has('flood') && !it.warned.flood) { it.warned.flood = 1; it.nerve -= 22 * soft; it.known = 6; this.msg('Motion floodlights snap on outside.', 'good'); this.events.push({ type: 'flood' }); }
      if (this.up.has('dog') && !it.warned.dog) { it.warned.dog = 1; it.nerve -= 26 * soft; this.sound('bark', P.x, P.y); this.msg('Your dog is barking at something outside!', 'warn'); }
    }
    if (this.alarm.on) it.nerve -= (it.def.chase ? 2.2 : 5) * dt;
    if (this.carAlarm > 0) it.nerve -= (it.def.chase ? 1.2 : 3) * dt;
    if (it.inside && this.up.has('dog')) { it.nerve -= 1.3 * dt; if ((this.t % 3) < dt) this.sound('bark', it.x, it.y); }
    if (it.inside && this.lit(it)) it.nerve -= (it.def.chase ? 0.6 : 1.6) * dt;
    if (this.police.called && this.police.eta < 12) it.nerve -= 14 * dt;
    if (it.nerve <= 0 && it.state !== 'flee') {
      it.state = 'flee'; it.path = null; it.work = null;
      this.msg(it.entered ? 'The intruder is running for it!' : 'The intruder backs off and leaves.', 'good');
    }

    // --- perception ---
    const d = Math.hypot(P.x - it.x, P.y - it.y);
    let sees = false;
    if (it.state !== 'flee') {
      // a hidden player is only found by an intruder who is actively searching right next to the spot
      const range = P.hidden ? (it.state === 'search' || it.state === 'investigate' || it.state === 'chase' ? 0.8 : 0) : this.lit(P) || P.torch ? 11 : 6;
      if (d < range && this.nav.los(it.x, it.y, P.x, P.y, this.seeThrough)) {
        const ang = Math.atan2(P.x - it.x, -(P.y - it.y));
        const da = Math.abs(((ang - it.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        sees = da < 1.05 || d < 1.6;
      }
    }
    if (sees) {
      it.lost = 0; it.known = 3;
      if (it.state !== 'chase' && it.state !== 'flee') {
        this.stats.spotted++;
        if (it.def.chase) { it.state = 'chase'; it.work = null; it.path = null; this.msg('The intruder has seen you!', 'bad'); this.sound('sting', it.x, it.y); } else {
          this.scare(it, 35, 'seen', 4); this.msg('The intruder spotted you and hesitates.', 'warn');
        }
      }
    } else if (d < 7 && this.nav.los(P.x, P.y, it.x, it.y, this.seeThrough)) it.known = 2;

    // --- behaviour ---
    let speed = it.def.speed;
    switch (it.state) {
      case 'approach':
      case 'loot': {
        if (!it.dest || !it.path) {
          const left = this.items.filter((i) => i.def.loot && !i.taken && !i.claimed);
          if (it.loot >= it.def.carry || (!left.length && it.loot > 0)) { it.state = 'flee'; it.leaving = true; it.path = null; this.msg('The intruder is leaving with your valuables.', 'warn'); break; }
          let goal;
          if (left.length) {
            left.sort((p, q) => Math.hypot(p.x - it.x, p.y - it.y) - Math.hypot(q.x - it.x, q.y - it.y));
            goal = left[0]; goal.claimed = true; it.item = goal;
          } else if (it.searchLeft-- > 0) {
            const r = this.plan.rooms[Math.floor(this.rand() * this.plan.rooms.length)], c = polyCentroid(r.poly);
            goal = { x: c[0], y: c[1] }; it.item = null;
          } else { it.state = 'flee'; it.leaving = true; break; }
          const [gx, gy] = this.nav.freeNear(goal.x, goal.y);
          if (!this.goTo(it, gx, gy)) { it.state = 'flee'; it.leaving = true; break; }
        }
        if (this.follow(it, dt, speed)) {
          it.state = 'loot'; it.dest = null;
          if (it.item && !it.item.taken) {
            const time = it.item.def.loot * (it.item.type === 'safe' && this.up.has('boltsafe') ? 2.5 : 1);
            it.work = { kind: 'loot', t: 0, total: time };
          }
        }
        break;
      }
      case 'investigate':
      case 'search': {
        if (!it.path) { const [gx, gy] = this.nav.freeNear(it.target.x, it.target.y); this.goTo(it, gx, gy); it.lookT = 0; }
        if (!it.path || this.follow(it, dt, speed)) {
          it.lookT = (it.lookT || 0) + dt; it.yaw += dt * 1.6;
          if (it.lookT > 3.5) { it.state = 'loot'; it.dest = null; it.path = null; if (it.item) it.item.claimed = false; }
        }
        break;
      }
      case 'chase': {
        speed = it.def.speed * 1.75;
        if (!sees) { it.lost += dt; if (it.lost > 3.5) { it.state = 'search'; it.target = { x: it.lastSeen?.x ?? P.x, y: it.lastSeen?.y ?? P.y }; it.path = null; this.msg('The intruder lost track of you.', 'good'); break; } } else it.lastSeen = { x: P.x, y: P.y };
        it.repath -= dt;
        if (it.repath <= 0 || !it.path) { it.repath = 0.4; const tgt = sees ? P : it.lastSeen || P; this.goTo(it, tgt.x, tgt.y); }
        this.follow(it, dt, speed);
        if (d < 0.9 && sees) {
          it.grab += dt;
          if (it.grab > 1.3) return this.finish('caught');
        } else it.grab = Math.max(0, it.grab - dt);
        break;
      }
      case 'flee': {
        speed = it.def.speed * 2;
        if (!it.path) this.goTo(it, it.sx, it.sy);
        if (!it.path || this.follow(it, dt, speed) || this.nav.outsideGrid(it.x, it.y, 1)) {
          it.gone = true;
          if (it.loot) this.stats.stolen += it.loot;
        }
        break;
      }
    }
  }

  /** Walk along it.path, handling doors/windows in the way. Returns true on arrival. */
  follow(it, dt, speed) {
    if (it.work) {
      const w = it.work; w.t += dt;
      if (w.kind === 'breach') {
        const p = w.portal;
        if (this.isOpen(this.portals.indexOf(p))) { it.work = null; return false; }
        w.bang -= dt;
        if (w.bang <= 0) { w.bang = 1.1; p.damage += 1.1; this.sound(p.type === 'window' ? 'rattle' : 'kick', p.x, p.y); this.lastNoise = { x: p.x, y: p.y, t: this.t, kind: 'bang' }; }
        if (this.breachTime(p) <= 0.85) {
          const quick = w.total < 1.5;
          p.state = quick ? 'open' : 'broken'; p.barricade = 0; it.work = null;
          if (!quick) {
            this.sound(p.type === 'window' ? 'glass' : 'crash', p.x, p.y);
            this.lastNoise = { x: p.x, y: p.y, t: this.t, kind: p.type === 'window' ? 'glass' : 'bang' };
            this.msg(p.type === 'window' ? 'Glass shatters somewhere in the house!' : p.exterior ? 'A door has been kicked in!' : 'An inside door gives way!', 'bad');
          } else this.sound('door', p.x, p.y);
          if (p.exterior && this.alarm.armed && (this.power || this.up.has('monitor'))) this.siren('entry sensor triggered');
        }
      } else if (w.t >= w.total) {
        it.work = null;
        if (w.kind === 'loot' && it.item && !it.item.taken) { it.item.taken = true; it.loot++; this.msg(`The intruder took the ${it.item.def.label.toLowerCase()}.`, 'warn'); this.events.push({ type: 'taken', id: it.item.id }); }
      }
      return false;
    }
    if (!it.path || !it.path.length) return true;
    const [tx, ty] = it.path[0];
    const pi = this.nav.portalAt[this.nav.cy(ty) * this.nav.w + this.nav.cx(tx)];
    if (pi >= 0 && !this.isOpen(pi)) {
      const p = this.portals[pi];
      it.work = { kind: 'breach', portal: p, t: 0, total: this.breachTime(p), bang: 0.3 };
      it.yaw = Math.atan2(p.x - it.x, -(p.y - it.y));
      return false;
    }
    const dx = tx - it.x, dy = ty - it.y, d = Math.hypot(dx, dy), step = speed * dt;
    if (d <= step) { it.x = tx; it.y = ty; it.path.shift(); } else { it.x += (dx / d) * step; it.y += (dy / d) * step; }
    if (d > 0.01) {
      const want = Math.atan2(dx, -dy);
      it.yaw += (((want - it.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
    }
    it.walk += step;
    return it.path.length === 0;
  }
}
