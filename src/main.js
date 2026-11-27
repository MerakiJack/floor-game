import './style.css';
import { samplePlan, emptyPlan, loadPlan, savePlan, validatePlan, planToHash, planFromHash, planBounds, polyArea, deriveWalls, ROOM_TYPES, ITEM_TYPES } from './plan/model.js';
import { Editor } from './plan/editor.js';
import { videoScanScreen, liveScanScreen } from './scan/ui.js';
import { UPGRADES, INTRUDER_TYPES, BUDGETS } from './game/sim.js';

const app = document.getElementById('app');
if (new URLSearchParams(location.search).has('capture')) window.__capture = true;

const state = {
  plan: null,
  cfg: { type: 'burglar', count: 1, time: 'night', powerCut: false, level: 'normal', upgrades: ['alarm', 'panic', 'spray'] },
};
try { Object.assign(state.cfg, JSON.parse(localStorage.getItem('floor-game.cfg.v1')) || {}); } catch { /* ignore */ }
const hashPlan = location.hash.startsWith('#p=') ? planFromHash(location.hash.slice(3)) : null;
state.plan = hashPlan || loadPlan() || samplePlan();
if (hashPlan) { history.replaceState(null, '', location.pathname + location.search); savePlan(state.plan); }
const persist = () => { savePlan(state.plan); localStorage.setItem('floor-game.cfg.v1', JSON.stringify(state.cfg)); };

let cleanup = null;
function screen(render) {
  cleanup?.(); cleanup = null;
  app.className = ''; app.innerHTML = '';
  cleanup = render(app) || null;
}
const flash = (text) => {
  const d = document.createElement('div'); d.className = 'flash'; d.textContent = text; document.body.append(d);
  setTimeout(() => d.remove(), 2600);
};

function drawMini(cv, plan) {
  const g = cv.getContext('2d'), b = planBounds(plan), W = cv.width, H = cv.height;
  const s = Math.min(W / (b.x1 - b.x0 + 1), H / (b.y1 - b.y0 + 1));
  const X = (x) => (x - (b.x0 + b.x1) / 2) * s + W / 2, Y = (y) => (y - (b.y0 + b.y1) / 2) * s + H / 2;
  g.clearRect(0, 0, W, H);
  const col = { wood: '#b08a5e', tile: '#cfd4d6', carpet: '#7f88a3', concrete: '#9a9c9b' };
  for (const r of plan.rooms) {
    g.beginPath(); r.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath();
    g.fillStyle = col[ROOM_TYPES[r.type].floor]; g.fill();
  }
  for (const w of deriveWalls(plan)) {
    g.strokeStyle = '#f1f5f9'; g.lineWidth = w.exterior ? 4 : 2.5; g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke();
    for (const o of w.openings) {
      g.strokeStyle = o.type === 'window' ? '#60a5fa' : o.type === 'entry' ? '#f97316' : '#4ade80'; g.lineWidth = 5; g.beginPath();
      g.moveTo(X(w.a[0] + w.dir[0] * (o.t - o.w / 2)), Y(w.a[1] + w.dir[1] * (o.t - o.w / 2))); g.lineTo(X(w.a[0] + w.dir[0] * (o.t + o.w / 2)), Y(w.a[1] + w.dir[1] * (o.t + o.w / 2))); g.stroke();
    }
  }
}

// ------------------------------------------------------------------ home
function home() {
  screen((el) => {
    const p = state.plan, area = p.rooms.reduce((a, r) => a + polyArea(r.poly), 0);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    el.innerHTML = `
    <div class="scroll pad home">
      <h1>Home Defence Sim</h1>
      <p class="lead">Film your home, turn it into a floor plan, then rehearse how you would handle a break-in — in 3D, on your phone or in a headset.</p>
      <div class="card plan-card">
        <canvas class="mini" width="640" height="400"></canvas>
        <div><b>${p.name}</b><br><small>${p.rooms.length} rooms · ${area.toFixed(0)} m² · ${p.openings.length} doors & windows · ${p.items.length} objects</small></div>
      </div>
      <h3>1 · Capture your home</h3>
      <div class="grid2">
        <button class="btn tile" data-go="video"><b>Scan from video</b><small>Film a slow turn in each room. Finds walls and furniture.</small></button>
        <button class="btn tile" data-go="live"><b>Live corner scan</b><small>Aim at each floor corner. Most accurate on a phone.</small></button>
      </div>
      <h3>2 · Check the plan</h3>
      <div class="grid2">
        <button class="btn tile" data-go="edit"><b>Edit 2D floor plan</b><small>Arrange rooms, add doors, windows and valuables.</small></button>
        <button class="btn tile" data-go="walk"><b>3D walk-through</b><small>Look around your home in daylight.</small></button>
      </div>
      <h3>3 · Run the drill</h3>
      <button class="btn primary big" data-go="setup">Plan defences &amp; start an invasion drill</button>
      <h3>Plans</h3>
      <div class="row wrap">
        <button class="btn" data-go="sample">Load sample house</button>
        <button class="btn" data-go="new">Start empty plan</button>
        <button class="btn" data-go="share">Copy share link</button>
        <button class="btn" data-go="export">Export file</button>
        <label class="btn">Import file<input class="imp" type="file" accept=".json,application/json" hidden></label>
      </div>
      ${standalone ? '' : '<p class="note"><b>Install:</b> on iPhone tap Share → “Add to Home Screen”. On Quest or Android open the browser menu → “Install app”. Works offline once installed.</p>'}
      <p class="note">A planning and training game — not professional security advice. In a real emergency, get to safety and call your local emergency number.</p>
    </div>`;
    drawMini(el.querySelector('.mini'), p);
    el.onclick = async (e) => {
      const go = e.target.closest('[data-go]')?.dataset.go; if (!go) return;
      if (go === 'video') scan('video');
      if (go === 'live') scan('live');
      if (go === 'edit') editor();
      if (go === 'walk') play({ preview: true });
      if (go === 'setup') setup();
      if (go === 'sample') { state.plan = samplePlan(); persist(); home(); }
      if (go === 'new') { state.plan = emptyPlan(); persist(); editor(); }
      if (go === 'share') {
        const url = `${location.origin}${location.pathname}#p=${planToHash(p)}`;
        try { await navigator.clipboard.writeText(url); flash('Share link copied — open it on your headset or another phone.'); } catch { prompt('Copy this link:', url); }
      }
      if (go === 'export') {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }));
        a.download = `${p.name.replace(/\W+/g, '-').toLowerCase() || 'plan'}.json`; a.click();
      }
    };
    el.querySelector('.imp').onchange = async (e) => {
      try {
        const plan = validatePlan(JSON.parse(await e.target.files[0].text()));
        if (!plan) throw new Error();
        state.plan = plan; persist(); home(); flash('Plan imported.');
      } catch { flash('That file is not a valid floor plan.'); }
    };
  });
}

// ------------------------------------------------------------------ scanning
function scan(kind) {
  screen((el) => {
    el.className = 'screen';
    const opts = { onBack: home, onRoom: (room) => editor(room) };
    if (kind === 'video') videoScanScreen(el, opts); else liveScanScreen(el, opts);
  });
}

// ------------------------------------------------------------------ editor
function editor(newRoom) {
  screen((el) => {
    el.className = 'screen';
    el.innerHTML = `
    <header class="bar"><button class="back">‹ Home</button><input class="e-name" value="${state.plan.name.replace(/"/g, '&quot;')}" maxlength="60" aria-label="Plan name"><button class="btn small e-fit">Fit</button><button class="btn small primary e-3d">3D</button></header>
    <div class="tools">
      ${[['select', 'Select / move'], ['room', 'Draw room'], ['door', 'Door'], ['window', 'Window'], ['item', 'Furniture']].map(([k, l]) => `<button data-tool="${k}">${l}</button>`).join('')}
      <select class="e-item">${Object.entries(ITEM_TYPES).map(([k, v]) => `<option value="${k}">${v.label}${v.loot ? ' (valuable)' : v.hide ? ' (hiding spot)' : ''}</option>`).join('')}</select>
    </div>
    <canvas class="e-canvas"></canvas>
    <div class="e-sel"></div>`;
    const $ = (s) => el.querySelector(s);
    const ed = new Editor($('.e-canvas'), state.plan, persist);
    const setTool = (t) => { ed.tool = t; el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); $('.e-item').hidden = t !== 'item'; hint(); };
    const HINTS = { select: 'Drag rooms, furniture, doors and windows. Drag a blue corner to resize. Pinch or scroll to zoom.', room: 'Drag on the grid to draw a new room.', door: 'Tap a wall to add a door. Doors on outside walls become entry doors.', window: 'Tap a wall to add a window.', item: 'Tap to place the chosen object. Valuables are what the intruder goes for.' };
    const hint = () => { if (!ed.selected()) $('.e-sel').innerHTML = `<small>${HINTS[ed.tool]}</small>`; };
    ed.onSelect = (s) => {
      const box = $('.e-sel');
      if (!s) return hint();
      if (s.kind === 'room') {
        box.innerHTML = `<input class="r-name" value="${s.obj.name.replace(/"/g, '&quot;')}" maxlength="40" aria-label="Room name"><select class="r-type">${Object.entries(ROOM_TYPES).map(([k, v]) => `<option value="${k}" ${k === s.obj.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select><button class="btn small danger" data-a="del">Delete</button>`;
        box.querySelector('.r-name').oninput = (e) => { s.obj.name = e.target.value; persist(); ed.draw(); };
        box.querySelector('.r-type').onchange = (e) => { s.obj.type = e.target.value; ed.changed(); };
      } else if (s.kind === 'opening') {
        box.innerHTML = `<b>${s.obj.type === 'window' ? 'Window' : 'Door'}</b> <span>${s.obj.w.toFixed(1)} m wide</span><button class="btn small" data-a="narrow">− Narrower</button><button class="btn small" data-a="wide">+ Wider</button><button class="btn small danger" data-a="del">Delete</button>`;
      } else box.innerHTML = `<b>${ITEM_TYPES[s.obj.type].label}</b><button class="btn small" data-a="rot">Rotate</button><button class="btn small danger" data-a="del">Delete</button>`;
    };
    $('.e-sel').onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a, s = ed.selected(); if (!a || !s) return;
      if (a === 'del') ed.remove();
      if (a === 'rot') { s.obj.rot = s.obj.rot ? 0 : 1; ed.changed(); }
      if (a === 'narrow' || a === 'wide') { s.obj.w = Math.max(0.6, Math.min(3, Math.round((s.obj.w + (a === 'wide' ? 0.1 : -0.1)) * 10) / 10)); ed.changed(); ed.onSelect(s); }
    };
    el.querySelector('.tools').onclick = (e) => { const t = e.target.closest('[data-tool]')?.dataset.tool; if (t) setTool(t); };
    $('.e-item').onchange = (e) => { ed.itemType = e.target.value; };
    $('.e-name').oninput = (e) => { state.plan.name = e.target.value || 'My home'; persist(); };
    $('.e-fit').onclick = () => ed.fit();
    $('.e-3d').onclick = () => (state.plan.rooms.length ? play({ preview: true }) : flash('Add a room first.'));
    $('.back').onclick = home;
    setTool('select');
    if (newRoom) { ed.addRoom(newRoom); flash(`“${newRoom.name}” added — drag it into place next to the other rooms.`); }
    window.__editor = ed;
    return () => ed.destroy();
  });
}

// ------------------------------------------------------------------ scenario setup
function setup() {
  if (!state.plan.rooms.length) { flash('Add at least one room first.'); return editor(); }
  screen((el) => {
    el.className = 'screen';
    const c = state.cfg;
    const render = () => {
      c.upgrades = c.upgrades.filter((id) => { const u = UPGRADES.find((x) => x.id === id); return u && (!u.needs || c.upgrades.includes(u.needs)); });
      const spent = c.upgrades.reduce((a, id) => a + UPGRADES.find((u) => u.id === id).cost, 0), budget = BUDGETS[c.level];
      el.innerHTML = `
      <header class="bar"><button class="back">‹ Home</button><h2>Plan the drill</h2></header>
      <div class="scroll pad">
        <h3>Who is breaking in?</h3>
        <div class="grid3">${Object.entries(INTRUDER_TYPES).map(([k, v]) => `<button class="btn tile ${c.type === k ? 'on' : ''}" data-type="${k}"><b>${v.label}</b><small>${v.desc}</small></button>`).join('')}</div>
        <div class="row wrap opts">
          <label>Intruders <select data-k="count">${[1, 2, 3].map((n) => `<option ${c.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Time <select data-k="time"><option value="night" ${c.time === 'night' ? 'selected' : ''}>Night, lights off</option><option value="evening" ${c.time === 'evening' ? 'selected' : ''}>Evening, lights on</option></select></label>
          <label>Budget <select data-k="level">${Object.entries(BUDGETS).map(([k, v]) => `<option value="${k}" ${c.level === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)} (${v} pts)</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" data-k="powerCut" ${c.powerCut ? 'checked' : ''}> Intruder cuts the power first</label>
        </div>
        <h3>Prepare your home <span class="budget ${spent > budget ? 'over' : ''}">${budget - spent} of ${budget} points left</span></h3>
        <div class="grid2 ups">${UPGRADES.map((u) => {
          const on = c.upgrades.includes(u.id), locked = u.needs && !c.upgrades.includes(u.needs), poor = !on && spent + u.cost > budget;
          return `<button class="btn tile ${on ? 'on' : ''}" data-up="${u.id}" ${locked || poor ? 'disabled' : ''}><b>${u.name} <i>${u.cost}</i></b><small>${u.desc}${locked ? ' Needs the alarm.' : ''}</small></button>`;
        }).join('')}</div>
        <h3>During the drill you can always</h3>
        <p class="lead small">Call the police · lock, close or barricade doors · hide in wardrobes or under beds · sneak · switch lights · cut or restore power at the breaker · shout a warning · throw a distraction · set off the car alarm · climb out of a window and run for it.</p>
        <button class="btn primary big start" ${spent > budget ? 'disabled' : ''}>Start the drill</button>
      </div>`;
    };
    render();
    el.onclick = (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.classList.contains('back')) return home();
      if (t.classList.contains('start')) { persist(); return play({ ...c, seed: (Math.random() * 1e9) | 0 }); }
      if (t.dataset.type) c.type = t.dataset.type;
      if (t.dataset.up) c.upgrades = c.upgrades.includes(t.dataset.up) ? c.upgrades.filter((x) => x !== t.dataset.up) : [...c.upgrades, t.dataset.up];
      persist(); const sc = el.querySelector('.scroll').scrollTop; render(); el.querySelector('.scroll').scrollTop = sc;
    };
    el.onchange = (e) => {
      const k = e.target.dataset.k; if (!k) return;
      c[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'count' ? +e.target.value : e.target.value;
      persist(); const sc = el.querySelector('.scroll').scrollTop; render(); el.querySelector('.scroll').scrollTop = sc;
    };
  });
}

// ------------------------------------------------------------------ 3D game
async function play(cfg) {
  const { Game } = await import('./game/game.js');
  screen((el) => {
    const game = new Game(el, state.plan, cfg, { onExit: () => (cfg.preview ? home() : setup()), onEnd: (o) => debrief(o, cfg) });
    return () => game.dispose();
  });
}

const ACTION_NAMES = { call: 'Called the police', door: 'Used doors', lock: 'Locked doors', barricade: 'Barricaded a door', climb: 'Left through a window', hide: 'Hid', light: 'Used the lights', breaker: 'Used the breaker', sneak: 'Sneaked', torch: 'Used a torch', shout: 'Shouted a warning', throw: 'Threw a distraction', panic: 'Hit the panic button', smartlock: 'Smart-locked the house', car: 'Set off the car alarm', spray: 'Used pepper spray' };

function debrief(o, cfg) {
  screen((el) => {
    el.className = 'screen';
    const tips = [];
    if (!o.called) tips.push('Nobody called for help. Calling the police early is the single most useful thing you can do — do it as soon as you are somewhere safe.');
    if (o.spotted) tips.push('You were seen. Staying out of sight (sneaking, lights off, a locked door between you) keeps a burglary from becoming a confrontation.');
    if (o.id === 'caught') tips.push('Put distance and locked doors between you and the intruder, or get out of the house entirely. Never go looking for them.');
    if (o.stolen) tips.push('Valuables were taken. A bolted safe, an alarm and stronger entry points all buy time until help arrives.');
    if (!cfg.upgrades.includes('alarm')) tips.push('An audible alarm ends most break-ins within a minute — try a drill with one installed.');
    if (!cfg.upgrades.includes('deadbolt') && !cfg.upgrades.includes('winlock')) tips.push('Your doors and windows gave way quickly. Deadbolts, long strike-plate screws and window locks are cheap and effective.');
    if (o.id === 'arrest' || o.id === 'deterred') tips.push('Textbook: layered defences and early detection meant you never had to face anyone.');
    if (o.id === 'escaped') tips.push('Getting out and going to a neighbour is a strong choice whenever there is a safe exit.');
    el.innerHTML = `
    <div class="scroll pad debrief">
      <div class="grade ${o.good ? 'good' : 'bad'}">${o.grade}</div>
      <h1>${o.title}</h1>
      <p class="lead">${o.text}</p>
      <div class="stats">
        <div><b>${o.score}</b><small>score</small></div>
        <div><b>${Math.floor(o.time / 60)}:${String(Math.floor(o.time % 60)).padStart(2, '0')}</b><small>duration</small></div>
        <div><b>${o.stolen}</b><small>items stolen</small></div>
        <div><b>${o.spotted}</b><small>times seen</small></div>
      </div>
      <h3>What you did</h3>
      <p class="chips">${o.actions.filter((a) => ACTION_NAMES[a]).map((a) => `<span class="chip info">${ACTION_NAMES[a]}</span>`).join('') || '<span class="chip">Nothing</span>'}</p>
      <h3>Debrief</h3>
      <ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>
      <div class="row wrap">
        <button class="btn primary" data-go="again">Run it again</button>
        <button class="btn" data-go="setup">Change defences</button>
        <button class="btn" data-go="home">Home</button>
      </div>
      <p class="note">This is a training game. Real situations are unpredictable — your safety always comes before property.</p>
    </div>`;
    el.onclick = (e) => {
      const go = e.target.closest('[data-go]')?.dataset.go;
      if (go === 'again') play({ ...cfg, seed: (Math.random() * 1e9) | 0 });
      if (go === 'setup') setup();
      if (go === 'home') home();
    };
  });
}

window.__app = { state, home, setup, editor, scan, play };
home();
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
