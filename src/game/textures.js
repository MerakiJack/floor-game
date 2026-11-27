// Procedural PBR textures (colour + normal map) drawn on canvases — no downloads, works offline.
import * as THREE from 'three';

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const shade = (hex, f) => {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `rgb(${(Math.min(1, c.r) * 255) | 0},${(Math.min(1, c.g) * 255) | 0},${(Math.min(1, c.b) * 255) | 0})`;
};
function pair(size) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const c = mk(), h = mk();
  const cx = c.getContext('2d'), hx = h.getContext('2d');
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, size, size);
  return { c, h, cx, hx, size };
}
function speckle(ctx, size, n, colors, max = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    const s = 1 + rnd() * max;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
}
function blotches(ctx, size, n, color, r0, r1, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * size, y = rnd() * size, r = r0 + rnd() * (r1 - r0);
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, color.replace('A', alpha)); g.addColorStop(1, color.replace('A', 0));
      ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}
function normalFrom(heightCanvas, strength) {
  const s = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas'); out.width = out.height = s;
  const ox = out.getContext('2d'), img = ox.createImageData(s, s);
  const H = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) / 255 * strength, dy = (H(x, y + 1) - H(x, y - 1)) / 255 * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

const DRAW = {
  wood({ cx, hx, size }) {
    const rows = 8, ph = size / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * size * 0.5;
      while (x < size) {
        const len = size * (0.35 + rnd() * 0.4), f = 0.78 + rnd() * 0.4;
        cx.fillStyle = shade('#8a5a33', f); cx.fillRect(x, r * ph, len, ph);
        for (let g = 0; g < 26; g++) {
          cx.strokeStyle = `rgba(${rnd() < 0.5 ? '40,22,8' : '190,140,90'},${0.05 + rnd() * 0.1})`; cx.lineWidth = 0.6 + rnd();
          const gy = r * ph + rnd() * ph; cx.beginPath(); cx.moveTo(x, gy);
          cx.bezierCurveTo(x + len * 0.3, gy + rnd() * 5 - 2.5, x + len * 0.6, gy + rnd() * 5 - 2.5, x + len, gy + rnd() * 3 - 1.5); cx.stroke();
        }
        cx.fillStyle = 'rgba(20,10,4,.75)'; cx.fillRect(x + len - 1.5, r * ph, 1.5, ph);
        hx.fillStyle = '#000'; hx.fillRect(x + len - 2, r * ph, 2.5, ph);
        x += len;
      }
      cx.fillStyle = 'rgba(20,10,4,.8)'; cx.fillRect(0, r * ph, size, 1.5);
      hx.fillStyle = '#000'; hx.fillRect(0, r * ph - 1, size, 3);
    }
    speckle(hx, size, 3000, ['#787878', '#888888']);
  },
  tile({ cx, hx, size }) {
    const n = 4, t = size / n, g = 5;
    cx.fillStyle = '#6f6a62'; cx.fillRect(0, 0, size, size);
    hx.fillStyle = '#202020'; hx.fillRect(0, 0, size, size);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      cx.fillStyle = shade('#d9d4c8', 0.9 + rnd() * 0.14); cx.fillRect(x * t + g / 2, y * t + g / 2, t - g, t - g);
      hx.fillStyle = '#a0a0a0'; hx.fillRect(x * t + g / 2 + 1, y * t + g / 2 + 1, t - g - 2, t - g - 2);
    }
    blotches(cx, size, 40, 'rgba(120,112,100,A)', 20, 70, 0.12);
    speckle(cx, size, 2500, ['rgba(255,255,255,.12)', 'rgba(70,60,50,.12)']);
  },
  carpet({ cx, hx, size }) {
    cx.fillStyle = '#5d6475'; cx.fillRect(0, 0, size, size);
    speckle(cx, size, 26000, ['rgba(120,130,150,.5)', 'rgba(50,55,70,.5)', 'rgba(90,96,115,.6)'], 1.5);
    speckle(hx, size, 26000, ['#5a5a5a', '#a8a8a8', '#909090', '#707070'], 1.5);
    blotches(cx, size, 14, 'rgba(40,44,60,A)', 40, 110, 0.12);
  },
  plaster({ cx, hx, size }) {
    cx.fillStyle = '#e4dfd4'; cx.fillRect(0, 0, size, size);
    blotches(cx, size, 60, 'rgba(160,150,135,A)', 30, 120, 0.07);
    blotches(cx, size, 40, 'rgba(255,255,250,A)', 30, 100, 0.08);
    speckle(cx, size, 5000, ['rgba(255,255,255,.1)', 'rgba(120,110,100,.07)']);
    blotches(hx, size, 160, 'rgba(160,160,160,A)', 6, 26, 0.5);
    blotches(hx, size, 160, 'rgba(96,96,96,A)', 6, 26, 0.5);
  },
  brick({ cx, hx, size }) {
    const rows = 8, bh = size / rows, bw = size / 4, m = 5;
    cx.fillStyle = '#9b9488'; cx.fillRect(0, 0, size, size);
    hx.fillStyle = '#282828'; hx.fillRect(0, 0, size, size);
    for (let r = 0; r < rows; r++) for (let b = -1; b < 5; b++) {
      const x = b * bw + (r % 2) * bw / 2;
      cx.fillStyle = shade(rnd() < 0.2 ? '#7c3f2c' : '#9a4c35', 0.8 + rnd() * 0.35);
      cx.fillRect(x + m / 2, r * bh + m / 2, bw - m, bh - m);
      hx.fillStyle = shade('#b0b0b0', 0.85 + rnd() * 0.2); hx.fillRect(x + m / 2 + 1, r * bh + m / 2 + 1, bw - m - 2, bh - m - 2);
    }
    speckle(cx, size, 9000, ['rgba(40,20,10,.16)', 'rgba(230,180,150,.12)']);
    speckle(hx, size, 5000, ['rgba(60,60,60,.35)', 'rgba(220,220,220,.25)']);
  },
  concrete({ cx, hx, size }) {
    cx.fillStyle = '#8b8d8c'; cx.fillRect(0, 0, size, size);
    blotches(cx, size, 50, 'rgba(60,62,62,A)', 30, 120, 0.1);
    blotches(cx, size, 30, 'rgba(190,190,186,A)', 30, 100, 0.1);
    speckle(cx, size, 14000, ['rgba(255,255,255,.1)', 'rgba(30,30,30,.12)']);
    speckle(hx, size, 9000, ['#707070', '#909090', '#606060']);
    cx.strokeStyle = 'rgba(40,40,40,.5)'; hx.strokeStyle = '#101010'; cx.lineWidth = hx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      let x = rnd() * size, y = rnd() * size; cx.beginPath(); hx.beginPath(); cx.moveTo(x, y); hx.moveTo(x, y);
      for (let k = 0; k < 9; k++) { x += rnd() * 40 - 20; y += rnd() * 40 - 10; cx.lineTo(x, y); hx.lineTo(x, y); }
      cx.stroke(); hx.stroke();
    }
  },
  grass({ cx, hx, size }) {
    cx.fillStyle = '#2f4a24'; cx.fillRect(0, 0, size, size);
    blotches(cx, size, 40, 'rgba(20,34,14,A)', 30, 110, 0.25);
    blotches(cx, size, 30, 'rgba(84,112,48,A)', 30, 90, 0.18);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * size, y = rnd() * size, l = 3 + rnd() * 6;
      cx.strokeStyle = `rgba(${60 + rnd() * 70},${95 + rnd() * 80},${35 + rnd() * 30},.55)`; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + rnd() * 4 - 2, y - l); cx.stroke();
    }
    speckle(hx, size, 20000, ['#585858', '#a0a0a0', '#808080'], 2);
  },
  door({ cx, hx, size }) {
    cx.fillStyle = '#6e4526'; cx.fillRect(0, 0, size, size);
    for (let g = 0; g < 420; g++) {
      cx.strokeStyle = `rgba(${rnd() < 0.5 ? '35,18,6' : '170,115,70'},${0.05 + rnd() * 0.12})`; cx.lineWidth = 0.6 + rnd() * 1.4;
      const x = rnd() * size; cx.beginPath(); cx.moveTo(x, 0); cx.bezierCurveTo(x + rnd() * 8 - 4, size * 0.3, x + rnd() * 8 - 4, size * 0.6, x + rnd() * 6 - 3, size); cx.stroke();
    }
    const panel = (x, y, w, h) => {
      cx.strokeStyle = 'rgba(25,12,4,.8)'; cx.lineWidth = 5; cx.strokeRect(x, y, w, h);
      cx.strokeStyle = 'rgba(210,160,110,.3)'; cx.lineWidth = 2; cx.strokeRect(x + 5, y + 5, w - 10, h - 10);
      hx.fillStyle = '#585858'; hx.fillRect(x, y, w, h); hx.fillStyle = '#909090'; hx.fillRect(x + 9, y + 9, w - 18, h - 18);
    };
    const u = size / 512;
    panel(70 * u, 40 * u, 150 * u, 190 * u); panel(292 * u, 40 * u, 150 * u, 190 * u);
    panel(70 * u, 270 * u, 150 * u, 200 * u); panel(292 * u, 270 * u, 150 * u, 200 * u);
  },
  fabric({ cx, hx, size }) {
    cx.fillStyle = '#b9b3a6'; cx.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 3) {
      cx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.06})`; cx.fillRect(i, 0, 1, size); cx.fillRect(0, i, size, 1);
      hx.fillStyle = '#5c5c5c'; hx.fillRect(i, 0, 1, size); hx.fillRect(0, i, size, 1);
    }
    speckle(cx, size, 6000, ['rgba(255,255,255,.08)', 'rgba(0,0,0,.06)']);
  },
};

// tile = metres covered by one texture repeat
const SPEC = {
  wood: { tile: 1.6, rough: 0.55, bump: 2.2 }, tile: { tile: 1.6, rough: 0.28, bump: 2.5 }, carpet: { tile: 1.2, rough: 0.98, bump: 2.5 },
  plaster: { tile: 2.4, rough: 0.92, bump: 1.2 }, brick: { tile: 1.1, rough: 0.88, bump: 4 }, concrete: { tile: 2.5, rough: 0.85, bump: 2 },
  grass: { tile: 3, rough: 1, bump: 3 }, door: { tile: 1, rough: 0.5, bump: 2 }, fabric: { tile: 0.5, rough: 0.95, bump: 1.5 },
};

const cache = new Map();
/** Returns a shared MeshStandardMaterial. UVs are expected in metres. */
export function material(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const spec = SPEC[name], size = opts.size || 512;
  const tkey = name + size;
  if (!cache.has(tkey)) {
    seed = 7 + name.length * 131;
    const p = pair(size);
    DRAW[name](p);
    const map = new THREE.CanvasTexture(p.c), normalMap = new THREE.CanvasTexture(normalFrom(p.h, spec.bump));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.setScalar(1 / spec.tile); t.anisotropy = 4; }
    cache.set(tkey, { map, normalMap });
  }
  const { map, normalMap } = cache.get(tkey);
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: spec.rough, metalness: 0, color: opts.color || 0xffffff });
  cache.set(key, m);
  return m;
}
export function flat(color, rough = 0.6, metal = 0, extra = {}) {
  const key = `flat${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  return cache.get(key);
}

/** Box whose UVs are in metres so shared tiling textures keep a constant real-world scale. */
export function boxUV(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}
