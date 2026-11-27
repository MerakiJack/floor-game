// Scan screens: (1) analyse a recorded walk-through video, (2) live camera corner-marking.
import { ScanAccumulator, ObjectTracker, OBJECT_MAP, LENSES } from './pipeline.js';
import { loadDetector } from './detect.js';
import { floorDistance, polarToPoint, squareUp } from './geometry.js';
import { ROOM_TYPES, ITEM_TYPES } from '../plan/model.js';

const roomForm = (name) => `
  <label>Room name <input class="s-name" value="${name}" maxlength="40"></label>
  <label>Room type <select class="s-type">${Object.entries(ROOM_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>`;

function drawPolar(cv, points, poly, extra) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#0d1322'; g.fillRect(0, 0, W, H);
  const all = [...points, ...(poly || []), ...(extra?.marks || []).map((k) => k.p)];
  const m = Math.max(2.5, ...all.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.15, sc = Math.min(W, H) / 2 / m;
  g.strokeStyle = '#1f2a44'; g.lineWidth = 1;
  for (let r = 1; r < m; r++) { g.beginPath(); g.arc(W / 2, H / 2, r * sc, 0, 7); g.stroke(); }
  g.fillStyle = '#38bdf8';
  for (const p of points) g.fillRect(W / 2 + p[0] * sc - 1.5, H / 2 + p[1] * sc - 1.5, 3, 3);
  if (poly && poly.length > 1) {
    g.strokeStyle = '#4ade80'; g.lineWidth = 3; g.beginPath();
    poly.forEach((p, i) => (i ? g.lineTo(W / 2 + p[0] * sc, H / 2 + p[1] * sc) : g.moveTo(W / 2 + p[0] * sc, H / 2 + p[1] * sc)));
    if (extra?.closed) g.closePath(); g.stroke();
  }
  g.font = '11px system-ui,sans-serif';
  for (const mk of extra?.marks || []) {
    const x = W / 2 + mk.p[0] * sc, y = H / 2 + mk.p[1] * sc;
    g.fillStyle = '#fb923c'; g.fillRect(x - 6, y - 6, 12, 12); g.fillText(mk.label, x + 9, y + 4);
  }
  g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(W / 2, H / 2, 5, 0, 7); g.fill();
  if (extra?.heading != null) {
    const a = (extra.heading * Math.PI) / 180;
    g.strokeStyle = '#fbbf24'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a) * (extra.dist || 1) * sc, H / 2 - Math.cos(a) * (extra.dist || 1) * sc); g.stroke();
  }
}

// ------------------------------------------------------------------ video file
export function videoScanScreen(el, { onRoom, onBack }) {
  el.innerHTML = `
  <header class="bar"><button class="back">‹ Back</button><h2>Scan from video</h2></header>
  <div class="scroll pad">
    <p class="lead">Stand in the middle of a room and hold the phone upright at chest height, tipped slightly down so the bottom of the walls is in the picture. Turn slowly on the spot through one full circle (10–20 s).</p>
    <div class="row wrap">
      <label class="btn primary">Record or choose video<input class="s-file" type="file" accept="video/*" capture="environment" hidden></label>
      <button class="btn s-demo">Try the built-in demo clip</button>
    </div>
    <div class="row wrap">
      <label>Lens <select class="s-lens">${Object.entries(LENSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label>Camera height (m) <input class="s-height" type="number" step="0.05" min="0.5" max="2.2" value="1.4"></label>
      <label>Phone tilt <select class="s-pitch"><option value="20">Tipped slightly down (~20°)</option><option value="0">Held level</option><option value="35">Tipped well down (~35°)</option></select></label>
      <label class="check"><input class="s-objects" type="checkbox" checked> Recognise furniture</label>
    </div>
    <div class="scan-view">
      <div><canvas class="s-frame" width="270" height="360"></canvas><small>What the scanner sees</small></div>
      <div><canvas class="s-polar" width="360" height="360"></canvas><small>Top-down wall samples</small></div>
    </div>
    <div class="s-status status">No video loaded yet.</div>
    <div class="s-result" hidden>
      <div class="row wrap">${roomForm('Scanned room')}
        <label>Width (m) <input class="s-w" type="number" step="0.1" min="1"></label>
        <label>Depth (m) <input class="s-d" type="number" step="0.1" min="1"></label>
      </div>
      <div class="s-found"></div>
      <button class="btn primary s-add">Add room to floor plan</button>
    </div>
    <p class="note">Everything runs on this device — the video is never uploaded. The estimate comes from tracking wall texture and the floor–wall line, so plain white rooms, clutter and low light reduce accuracy. Furniture is recognised by rough category only (couch, chair, table, bed, TV…). Check against a tape measure and fine-tune in the editor.</p>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const frameCv = $('.s-frame'), fg = frameCv.getContext('2d'), status = $('.s-status');
  let token = 0, last = null;
  $('.back').onclick = () => { token++; onBack(); };

  const show = (frame, w, h, row, dets, k) => {
    frameCv.width = w * 2; frameCv.height = h * 2; fg.setTransform(2, 0, 0, 2, 0, 0);
    if (frame.source) fg.drawImage(frame.source, 0, 0, w, h); else {
      const img = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = frame.gray[i]; img.data[i * 4 + 3] = 255; }
      const t = Object.assign(document.createElement('canvas'), { width: w, height: h }); t.getContext('2d').putImageData(img, 0, 0); fg.imageSmoothingEnabled = false; fg.drawImage(t, 0, 0);
    }
    if (row >= 0) { fg.strokeStyle = '#4ade80'; fg.lineWidth = 2; fg.beginPath(); fg.moveTo(w * 0.3, row); fg.lineTo(w * 0.7, row); fg.stroke(); }
    fg.strokeStyle = 'rgba(251,191,36,.6)'; fg.lineWidth = 1; fg.strokeRect(w * 0.4, h * 0.3, w * 0.2, h * 0.66);
    fg.font = '9px system-ui,sans-serif';
    for (const d of dets || []) {
      if (!OBJECT_MAP[d.class]) continue;
      const [x, y, bw, bh] = d.bbox.map((v) => v / k);
      fg.strokeStyle = '#fb923c'; fg.lineWidth = 1.5; fg.strokeRect(x, y, bw, bh);
      fg.fillStyle = '#fb923c'; fg.fillRect(x, y - 10, fg.measureText(d.class).width + 6, 10); fg.fillStyle = '#111'; fg.fillText(d.class, x + 3, y - 2);
    }
  };
  const objMarks = (objs) => objs.map((o) => ({ p: [o.x, o.y], label: ITEM_TYPES[o.type].label }));
  const finish = (acc, tracker) => {
    const r = acc.result();
    if (!r.fit) { status.textContent = 'Could not find the floor–wall line in enough frames. Try better lighting, or use the live corner scan instead.'; status.className = 's-status status bad'; return; }
    const objs = tracker ? tracker.result() : [];
    last = { fit: r.fit, objs };
    drawPolar($('.s-polar'), r.points, r.fit.poly.map(r.fit.toScan), { closed: true, marks: objMarks(objs) });
    $('.s-w').value = r.fit.width; $('.s-d').value = r.fit.depth; $('.s-result').hidden = false;
    $('.s-found').innerHTML = objs.length
      ? `<b>Recognised furniture</b> ${objs.map((o, i) => `<label class="check"><input type="checkbox" data-i="${i}" checked> ${ITEM_TYPES[o.type].label} <small>(${o.label}, ${Math.round(o.score * 100)}%)</small></label>`).join('')}`
      : tracker ? '<small>No furniture was recognised in this clip.</small>' : '';
    const partial = r.coverage < 300;
    status.className = 's-status status ' + (partial ? 'warn' : 'good');
    status.textContent = `Estimated room: ${r.fit.width} m × ${r.fit.depth} m from ${r.points.length} wall samples, ${Math.round(r.coverage)}° of rotation tracked.` + (objs.length ? ` ${objs.length} piece${objs.length === 1 ? '' : 's'} of furniture recognised.` : '') + (partial ? ' Less than a full turn was detected, so treat this as a rough guess.' : '');
  };

  /** next(i) -> { gray, source? } | null. `k` = source pixels per grey pixel. */
  async function runFrames(next, total, w, h, k = 1) {
    const my = ++token;
    $('.s-result').hidden = true; status.className = 's-status status';
    const camHeight = +$('.s-height').value || 1.4;
    const pitch = +$('.s-pitch').value;
    const acc = new ScanAccumulator({ w, h, longFov: LENSES[$('.s-lens').value].longFov, camHeight, pitch });
    let detect = null, tracker = null;
    if (k > 1 && $('.s-objects').checked) {
      status.textContent = 'Loading the furniture recogniser…';
      try { detect = await loadDetector(); tracker = new ObjectTracker({ w: w * k, h: h * k, f: acc.f * k, vfov: acc.vfov, camHeight, pitch }); } catch { status.textContent = 'Furniture recogniser unavailable — continuing with walls only.'; }
      if (my !== token) return;
    }
    let dets = [];
    for (let i = 0; i < total; i++) {
      const frame = await next(i);
      if (my !== token) return;
      if (!frame) break;
      const s = acc.addFrame(frame.gray);
      if (detect && frame.source && i % 2 === 0) { try { dets = await detect(frame.source); tracker.add(s.yaw, dets); } catch { dets = []; } }
      show(frame, w, h, s.row, dets, k);
      drawPolar($('.s-polar'), acc.points, null, { heading: s.yaw, dist: s.dist || 1, marks: tracker ? objMarks(tracker.result(1)) : [] });
      status.textContent = `Analysing… frame ${i + 1}/${total} · rotation ${Math.round(acc.total)}°${s.dist ? ` · wall at ${s.dist.toFixed(1)} m` : ''}`;
      await new Promise((r) => requestAnimationFrame(r));
    }
    finish(acc, tracker);
  }

  // The demo clip is a real video file (a 360° turn inside the sample living room, camera 1.6 m up,
  // tipped 20° down), so it exercises exactly the same path as your own footage.
  $('.s-demo').onclick = () => { $('.s-height').value = 1.6; $('.s-pitch').value = 20; $('.s-lens').value = 'phone1x'; runVideo('/demo/room-pan.mp4'); };

  $('.s-file').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    runVideo(url).finally(() => URL.revokeObjectURL(url));
  };
  async function runVideo(src) {
    status.textContent = 'Loading video…';
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src;
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video format could not be opened by the browser.')); });
    } catch (err) { status.textContent = err.message; status.className = 's-status status bad'; return; }
    const K = 2, scale = 180 / Math.max(v.videoWidth, v.videoHeight), w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const tmp = Object.assign(document.createElement('canvas'), { width: w * K, height: h * K }), tg = tmp.getContext('2d', { willReadFrequently: true });
    const grab = () => {
      tg.drawImage(v, 0, 0, w * K, h * K);
      const d = tg.getImageData(0, 0, w * K, h * K).data, gray = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * K * w * K + x * K) * 4; gray[y * w + x] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; }
      return { gray, source: tmp };
    };
    if (isFinite(v.duration) && v.duration > 0) {
      const n = Math.max(20, Math.min(240, Math.round(v.duration * 10)));
      await runFrames(async (i) => {
        const t = Math.min(v.duration - 0.05, (i / (n - 1)) * v.duration);
        await new Promise((res) => { const to = setTimeout(res, 1500); v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = t; });
        return grab();
      }, n, w, h, K);
    } else {
      // streams without a known duration (some recorders): sample while playing through
      let ended = false; v.onended = () => { ended = true; };
      await v.play().catch(() => { ended = true; });
      await runFrames(async () => { await new Promise((r) => setTimeout(r, 90)); return ended ? null : grab(); }, 2000, w, h, K);
    }
  }

  $('.s-add').onclick = () => {
    const w = Math.max(1, +$('.s-w').value), d = Math.max(1, +$('.s-d').value);
    const items = [];
    for (const box of el.querySelectorAll('.s-found input:checked')) {
      const o = last.objs[+box.dataset.i], def = ITEM_TYPES[o.type], q = last.fit.toLocal([o.x, o.y]);
      const m = Math.max(def.w, def.d) / 2 + 0.1;
      items.push({ type: o.type, x: Math.max(m, Math.min(w - m, q[0])), y: Math.max(m, Math.min(d - m, q[1])) });
    }
    onRoom({ name: $('.s-name').value || 'Room', type: $('.s-type').value, poly: [[0, 0], [w, 0], [w, d], [0, d]], items });
  };
  drawPolar($('.s-polar'), [], null);
}

// ------------------------------------------------------------------ live camera
export function liveScanScreen(el, { onRoom, onBack }) {
  el.innerHTML = `
  <header class="bar"><button class="back">‹ Back</button><h2>Live corner scan</h2></header>
  <div class="live">
    <video class="l-video" playsinline muted></video>
    <div class="l-cross"></div>
    <div class="l-read">Tap “Start” and allow camera + motion access.</div>
    <canvas class="l-map" width="220" height="220"></canvas>
    <div class="l-controls">
      <label>Phone height (m) <input class="l-height" type="number" step="0.05" min="0.5" max="2.2" value="1.4"></label>
      <div class="row">
        <button class="btn primary l-start">Start</button>
        <button class="btn primary l-mark" hidden>Mark corner</button>
        <button class="btn l-undo" hidden>Undo</button>
        <button class="btn good l-done" hidden>Finish room</button>
      </div>
      <div class="l-form" hidden><div class="row wrap">${roomForm('Scanned room')}</div><button class="btn primary l-add">Add room to floor plan</button></div>
      <small>Stand still in one spot. Aim the crosshair at each floor corner in turn (where two walls meet the floor) and tap “Mark corner”.</small>
    </div>
  </div>`;
  const $ = (s) => el.querySelector(s);
  let stream = null, heading = null, tilt = null, corners = [], poly = null;
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); window.removeEventListener('deviceorientation', onOri, true); window.removeEventListener('deviceorientationabsolute', onOri, true); };
  $('.back').onclick = () => { stop(); onBack(); };
  const current = () => {
    if (heading == null || tilt == null) return null;
    const dep = 90 - tilt; // phone upright = 90°, tipping the top forward looks down
    if (dep < 4) return { heading, dist: null };
    return { heading, dist: floorDistance(dep, +$('.l-height').value || 1.4) };
  };
  const redraw = () => {
    const c = current();
    drawPolar($('.l-map'), corners, poly || corners, { closed: !!poly, heading: c?.heading, dist: c?.dist || 1 });
    if (c) $('.l-read').textContent = c.dist ? `Heading ${Math.round(c.heading)}° · floor point ${c.dist.toFixed(2)} m away · ${corners.length} corner${corners.length === 1 ? '' : 's'}` : 'Tilt the phone down until the crosshair is on the floor corner.';
  };
  function onOri(e) {
    if (e.beta == null) return;
    heading = e.webkitCompassHeading ?? (360 - (e.alpha || 0)) % 360;
    tilt = e.beta;
    redraw();
  }
  $('.l-start').onclick = async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('motion access was denied. Allow “Motion & Orientation Access” for this site and try again.');
      }
      window.addEventListener('deviceorientation', onOri, true);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const v = $('.l-video'); v.srcObject = stream; await v.play();
      $('.l-start').hidden = true; $('.l-mark').hidden = $('.l-undo').hidden = $('.l-done').hidden = false;
      setTimeout(() => { if (heading == null) $('.l-read').textContent = 'No motion sensor found on this device. Use “Scan from video” or draw the room in the editor.'; }, 2500);
    } catch (err) { $('.l-read').textContent = 'Cannot start: ' + err.message; }
  };
  $('.l-mark').onclick = () => {
    const c = current();
    if (!c || !c.dist) { $('.l-read').textContent = 'Aim lower — the crosshair must be on the floor.'; return; }
    corners.push(polarToPoint(c.heading, c.dist)); poly = null; navigator.vibrate?.(30); redraw();
  };
  $('.l-undo').onclick = () => { corners.pop(); poly = null; $('.l-form').hidden = true; redraw(); };
  $('.l-done').onclick = () => {
    if (corners.length < 3) { $('.l-read').textContent = 'Mark at least 3 corners first.'; return; }
    poly = squareUp(corners); $('.l-form').hidden = false;
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    $('.l-read').textContent = `Room outline: ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} m × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m (squared up).`;
    drawPolar($('.l-map'), [], poly.map((p) => [p[0] - Math.max(...xs) / 2, p[1] - Math.max(...ys) / 2]), { closed: true });
  };
  $('.l-add').onclick = () => { stop(); onRoom({ name: $('.s-name').value || 'Room', type: $('.s-type').value, poly }); };
  redraw();
}
