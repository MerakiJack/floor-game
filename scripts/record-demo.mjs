// Records the feature tour video by driving the real app in headless Chromium.
// 3D scenes are stepped frame-by-frame (the app's ?capture mode) so the video is smooth even
// on a machine without a GPU.   Usage: npm run build && npm run preview &  node scripts/record-demo.mjs <outDir>
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }

const OUT = process.argv[2] || 'demo-out', URL_ = process.argv[3] || 'http://localhost:4173/?capture=1', FPS = 20;
rmSync(`${OUT}/frames`, { recursive: true, force: true }); mkdirSync(`${OUT}/frames`, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
p.setDefaultTimeout(10000);
await p.goto(URL_);

let n = 0;
const ONLY = process.env.ONLY ? +process.env.ONLY : 0; let sec = 0;
const section = async (fn) => { sec++; if (ONLY && sec !== ONLY) return; try { if (ONLY === 4) await p.evaluate(() => window.__app.editor()); await fn(); } catch (e) { console.log('SECTION FAILED:', e.message.split('\n')[0]); await p.evaluate(() => window.__app.home()).catch(() => {}); } };
const DRY = !!process.env.DRY;
const shot = async () => { if (DRY) { n++; return; } await p.screenshot({ path: `${OUT}/frames/f${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 }); };
const hold = async (sec) => { if (DRY) { n += sec * FPS; return p.waitForTimeout(60); } for (let i = 0; i < sec * FPS; i++) { const t = Date.now(); await shot(); const w = 1000 / FPS - (Date.now() - t); if (w > 0) await p.waitForTimeout(w); } };
const overlay = async () => p.evaluate(() => {
  if (document.getElementById('cap')) return;
  const c = document.createElement('div'); c.id = 'cap';
  c.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:999;background:#facc15;color:#111;font:700 17px system-ui;padding:7px 16px;border-radius:99px;box-shadow:0 4px 18px #0009;pointer-events:none;white-space:nowrap';
  const m = document.createElement('div'); m.id = 'cur';
  m.style.cssText = 'position:fixed;z-index:998;width:18px;height:18px;margin:-9px;border-radius:50%;background:#fff;border:3px solid #111;pointer-events:none;left:-50px;top:-50px;opacity:.9';
  document.body.append(c, m);
  addEventListener('mousemove', (e) => { m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; }, true);
});
const cap = async (text) => { await overlay(); await p.evaluate((t) => { document.getElementById('cap').textContent = t; }, text); console.log(`[${(n / FPS).toFixed(1)}s] ${text}`); };
const click = async (sel, pause = 0.5) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await hold(0.3); await p.mouse.down(); await p.mouse.up(); await hold(pause); };
// editor helpers: plan metres -> screen pixels
const ePt = (x, y) => p.evaluate(([x, y]) => { const e = window.__editor, r = e.cv.getBoundingClientRect(); return [r.left + x * e.view.s + e.view.x, r.top + y * e.view.s + e.view.y]; }, [x, y]);
const eDrag = async (a, b) => { const [ax, ay] = await ePt(...a), [bx, by] = await ePt(...b); await p.mouse.move(ax, ay, { steps: 5 }); await shot(); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(ax + ((bx - ax) * i) / 10, ay + ((by - ay) * i) / 10); await shot(); } await p.mouse.up(); await hold(0.4); };
const eTap = async (x, y) => { const [ax, ay] = await ePt(x, y); await p.mouse.move(ax, ay, { steps: 5 }); await hold(0.2); await p.mouse.down(); await p.mouse.up(); await hold(0.5); };

// 3D helpers: advance the game one video frame at a time, with simple auto-steering
const gameReady = async () => { await p.waitForFunction(() => window.__step && window.__game); await p.evaluate((dry) => {
  if (dry) window.__game.renderer.render = () => {};
  window.__bot = { path: null, spray: false, look: null };
  window.__tick = (dt) => {
    const g = window.__game; if (!g || g.ended || !window.__step) return true;
    const s = g.sim, P = s.player, B = window.__bot;
    const turn = (want, k = 0.18) => { P.yaw += ((((want - P.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * k; };
    g.keys.delete('KeyW');
    if (B.path && B.path.length) {
      while (B.path.length > 1 && Math.hypot(B.path[0][0] - P.x, B.path[0][1] - P.y) < 0.45) B.path.shift();
      const t = B.path[Math.min(2, B.path.length - 1)];
      if (Math.hypot(B.path[B.path.length - 1][0] - P.x, B.path[B.path.length - 1][1] - P.y) < 0.3) B.path = null; else {
        turn(Math.atan2(t[0] - P.x, -(t[1] - P.y)), 0.3); g.keys.add('KeyW');
        const a = s.actions().find((q) => /^(Open door|Unlock & open door)$/.test(q.label));
        const near = s.nearPortal(1.1);
        if (a && near && B.path.some((q) => Math.hypot(q[0] - near.x, q[1] - near.y) < 0.35)) s.doAction('door');
      }
    } else if (B.look != null) turn(B.look);
    if (B.spray) { const it = s.intruders.find((i) => !i.gone && Math.hypot(i.x - P.x, i.y - P.y) < 3.2 && s.nav.los(P.x, P.y, i.x, i.y, s.isOpen)); if (it) { P.yaw = Math.atan2(it.x - P.x, -(it.y - P.y)); s.doAction('spray'); B.spray = false; B.sprayed = true; } }
    window.__step(dt);
    if (g.disposed) return true;
    const gl = g.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return !!s.outcome;
  };
  window.__go = (x, y) => { const s = window.__game.sim, P = s.player; window.__bot.path = s.nav.path(P.x, P.y, x, y, () => 1); };
}, DRY); };
const run = async (sec, dt = 0.05) => { for (let i = 0; i < sec / dt; i++) { await p.evaluate((d) => window.__tick(d), dt); await shot(); } };
const act = (id) => p.evaluate((i) => window.__game?.sim.doAction(i), id);
const go = (x, y) => p.evaluate(([x, y]) => window.__game && window.__go(x, y), [x, y]);
const look = (a) => p.evaluate((a) => { window.__bot.look = a; window.__bot.path = null; }, a);
const walking = () => p.evaluate(() => !!window.__game && !window.__game.ended && !!window.__bot.path);
const walk = async (x, y, max = 12) => { await go(x, y); for (let i = 0; i < max / 0.05 && (await walking()); i++) { await p.evaluate(() => window.__tick(0.05)); await shot(); } };
const toDebrief = async () => { for (let i = 0; i < 500 && !(await p.$('.debrief')); i++) { await p.evaluate(() => window.__tick && window.__tick(0.05)); await shot(); } console.log('   outcome:', await p.textContent('.debrief h1').catch(() => '?')); };
const state = () => p.evaluate(() => { const g = window.__game; if (!g || g.ended) return 'over'; const s = g.sim, i = s.intruders[0]; return `t=${s.t.toFixed(0)} eta=${s.police.eta.toFixed(0)} intr=${i.state} nerve=${i.nerve.toFixed(0)} inside=${i.inside} d=${Math.hypot(i.x - s.player.x, i.y - s.player.y).toFixed(1)}`; });
const ended = () => p.evaluate(() => !!window.__game?.ended || !window.__game);

// ---------------------------------------------------------------- 1. home
await section(async () => {
await cap('Home Defence Sim — installable web app (iPhone, Quest, desktop)'); await hold(2.5);

});
// ---------------------------------------------------------------- 2. video scan + furniture recognition
await section(async () => {
await cap('1 · Scan a room from a video');
await click('[data-go=video]', 1);
await click('.s-demo', 0.2);
await cap('Tracking the walls + recognising furniture (couch, chair, table, TV…)');
for (let i = 0; i < 400; i++) { await shot(); await p.waitForTimeout(350); if (await p.evaluate(() => !document.querySelector('.s-result').hidden)) break; }
await p.evaluate(() => document.querySelector('.s-status').scrollIntoView({ block: 'center' }));
await cap('Result: room size + furniture, estimated on-device'); await hold(3);
await p.fill('.s-name', 'Scanned lounge');
await click('.s-add', 0.5);
await cap('The scanned room drops straight into the 2D floor plan'); await hold(2.5);

});
// ---------------------------------------------------------------- 3. editor
await section(async () => {
await cap('2 · Edit the 2D floor plan — drag rooms into place');
await eDrag([16.5, 2.5], [16.5, 8.2]);
await cap('Draw a new room');
await click('[data-tool=room]', 0.2); await eDrag([13.6, 2.5], [17.6, 5.7]);
await cap('Add doors and windows by tapping walls');
await click('[data-tool=door]', 0.2); await eTap(15.6, 5.7); await eTap(13.6, 3.4);
await click('[data-tool=window]', 0.2); await eTap(15.6, 2.5); await eTap(17.6, 4.1);
await cap('Place furniture, hiding spots and valuables');
await click('[data-tool=item]', 0.2); await p.selectOption('.e-item', 'sofa'); await eTap(15.6, 3.2);
await p.selectOption('.e-item', 'safe'); await eTap(17.0, 5.1); await click('[data-a=rot]', 0.4);
await click('[data-tool=select]', 0.2); await eTap(15.0, 4.4); await p.fill('.r-name', 'Sun room'); await p.selectOption('.r-type', 'office'); await hold(1.5);

});
// ---------------------------------------------------------------- 4. live corner scan
await section(async () => {
await click('.back', 0.6);
await cap('Alternative: live corner scan with camera + motion sensors (sensor input simulated here)');
await click('[data-go=live]', 0.6); await click('.l-start', 1.2);
const ori = (heading, beta) => p.evaluate(([h, b]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 360 - h, beta: b, gamma: 0 })), [heading, beta]);
let hd = 20, bt = 85;
for (const [h, b] of [[53, 60.8], [127, 60.8], [233, 60.8], [307, 60.8]]) {
  for (let i = 1; i <= 10; i++) { await ori(hd + ((h - hd) * i) / 10, bt + ((b - bt) * i) / 10); await shot(); }
  hd = h; bt = b; await click('.l-mark', 0.3);
}
await click('.l-done', 1.5);
await click('.back', 0.4);

});
// ---------------------------------------------------------------- 5. daytime walk-through (sample house)
await section(async () => {
await click('[data-go=sample]', 1);
await cap('3 · Walk through your home in 3D — realistic lighting and textures');
await p.evaluate(() => window.__app.play({ preview: true })); await gameReady();
await look(0.5); await run(1);
await walk(5, 5.8); await walk(3, 3); await look(-0.9); await run(1.5); await look(1.6); await run(1.2);
await walk(7.8, 2.2, 8); await look(2.4); await run(1.2);
await cap('Cut-away 3D map — orbit the whole house');
await p.evaluate(() => { window.__game.toggleView(); window.__bot.look = null; window.__game.orbit = 0.7; }); await run(4.5);
await cap('Outside view — roof, garden, sky and sun shadows');
await p.evaluate(() => { window.__game.toggleView(); window.__game.orbit = 2.2; }); await run(5);
await click('[data-b=exit]', 0.4);

});
// ---------------------------------------------------------------- 6. setup
await section(async () => {
await cap('4 · Choose the intruder and prepare your defences');
await click('[data-go=setup]', 1);
await click('[data-type=aggressive]', 0.4); await click('[data-type=burglar]', 0.4);
await p.selectOption('[data-k=level]', 'easy'); await hold(0.6);
for (const u of ['camera', 'winlock', 'smartlock', 'barkit']) { await p.locator(`[data-up=${u}]`).scrollIntoViewIfNeeded(); await click(`[data-up=${u}]`, 0.35); }
await hold(1);

});
// ---------------------------------------------------------------- 7. drill A: defend
await section(async () => {
await p.evaluate(() => window.__app.play({ type: 'aggressive', count: 1, time: 'night', powerCut: false, upgrades: ['alarm', 'panic', 'spray', 'camera', 'winlock', 'smartlock', 'barkit'], seed: 11 })); await gameReady();
await cap('5 · The drill — night, an intruder is outside'); await look(0.9); await run(1.5);
await cap('Option: torch'); await act('torch'); await look(-0.6); await run(1.5); await act('torch');
await cap('Option: call the police (takes a few seconds)'); await act('call'); await look(0); await run(5.3);
await cap('Option: room lights'); await act('light'); await run(1.5); await act('light'); await run(0.5);
await cap('Option: lock and barricade the door'); await walk(2.2, 7.3, 4); await look(0); await run(0.4); await act('lock'); await run(0.8); await act('barricade'); await run(3);
await cap('Option: smart-lock every door in the house'); await act('smartlock'); await run(1.5);
console.log('  ', await state());
await cap('3D map: security cameras show the intruder breaking in'); await p.evaluate(() => window.__game?.toggleView()); await run(4); await p.evaluate(() => window.__game?.toggleView()); await cap('Outside view at night'); await run(3); await p.evaluate(() => window.__game?.toggleView());
await cap('Option: hide (under the bed / in the wardrobe)'); await walk(2.2, 8.6, 4); await act('hide'); await run(2.5); await act('hide');
await cap('Option: shout a warning'); await act('shout'); await run(1.8);
await cap('Option: panic button — siren'); await act('panic'); await run(2);
console.log('  ', await state());
await cap('Option: sneak, open the door and throw a distraction'); await act('sneak'); await walk(2.2, 7.25, 4); await look(0); await run(0.3);
await act('door'); await run(0.8);
await walk(2.6, 5.8, 5); await look(1.57); await run(0.6); await act('throw'); await run(2.2); await act('sneak');
console.log('  ', await state());
await cap('Last resort: pepper spray if the intruder gets close');
await p.evaluate(() => { if (window.__bot) window.__bot.spray = true; });
let sprayed = false;
for (let i = 0; i < 30 / 0.05 && !(await ended()); i++) {
  // watch the intruder; once the spray has landed, retreat
  sprayed = await p.evaluate(() => { const g = window.__game; if (!g || g.ended) return false; const s = g.sim, P = s.player, it = s.intruders.find((q) => !q.gone); if (it && !window.__bot.path) window.__bot.look = Math.atan2(it.x - P.x, -(it.y - P.y)); window.__tick(0.05); return !!window.__bot.sprayed; });
  await shot();
  if (sprayed) break;
}
console.log('  ', await state(), 'sprayed', sprayed);
if (sprayed && !(await ended())) {
  await run(1.2);
  await cap('…then fall back to another room, shut the door, lock it'); await walk(5.7, 7.7, 8); await look(0); await run(0.3);
  await p.evaluate(() => { const s = window.__game?.sim; if (!s) return; if (s.actions().some((a) => a.id === 'door' && a.label === 'Close door')) s.doAction('door'); s.doAction('lock'); });
  await run(0.6); await cap('…and barricade it again'); await act('barricade'); await run(3); await walk(5.4, 9.4, 4); await look(0);
}
await cap('Hold out until help arrives…');
await toDebrief();
await cap('Debrief: outcome, grade and what to improve'); await hold(4);
});
// ---------------------------------------------------------------- 8. drill B: escape
await section(async () => {
await p.evaluate(() => window.__app.play({ type: 'aggressive', count: 2, time: 'evening', powerCut: true, upgrades: [], seed: 5 })); await gameReady();
await cap('Another way out — two aggressive intruders, power cut, no defences'); await look(-1.2); await run(2);
await cap('Option: set off the car alarm as a diversion'); await act('car'); await run(2.5);
await cap('Option: sneak to a window, climb out…'); await act('sneak'); await walk(0.7, 8.9, 6); await look(-1.57); await run(0.5); await act('climb'); await run(3.4);
await cap('…and run to a neighbour'); await act('sneak'); await go(-4.8, 8.9);
await toDebrief();
await cap('Escaping safely counts as a win'); await hold(4);
});

await browser.close();
console.log('frames', n);
if (!ONLY && !DRY) execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${OUT}/frames/f%05d.jpg -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart ${OUT}/demo.mp4`);
console.log('wrote', `${OUT}/demo.mp4`);
