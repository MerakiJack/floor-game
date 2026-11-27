// Tiny synthesised sound set (Web Audio) — no audio files to download.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.loops = {}; }
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  env(gain, dur, attack = 0.005) {
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master); return g;
  }
  noise(dur, freq, gain, type = 'lowpass', delay = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(), t = this.ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, gain, type = 'sine', delay = 0) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** vol 0..1 = loudness after distance falloff */
  play(name, vol = 1) {
    if (!this.ctx || this.muted || vol < 0.03) return;
    const v = vol;
    switch (name) {
      case 'step': this.noise(0.09, 300, 0.25 * v); break;
      case 'door': this.noise(0.18, 500, 0.4 * v); this.tone(140, 70, 0.2, 0.3 * v); break;
      case 'lock': this.noise(0.04, 3000, 0.3 * v, 'highpass'); this.noise(0.04, 2500, 0.25 * v, 'highpass', 0.07); break;
      case 'thud': this.tone(110, 45, 0.25, 0.6 * v); this.noise(0.12, 400, 0.3 * v); break;
      case 'kick': this.tone(90, 38, 0.3, 0.9 * v); this.noise(0.15, 700, 0.5 * v); break;
      case 'rattle': this.noise(0.25, 2200, 0.35 * v, 'bandpass'); this.tone(240, 180, 0.2, 0.2 * v, 'square'); break;
      case 'crash': this.tone(80, 30, 0.6, 1 * v); this.noise(0.5, 900, 0.8 * v); break;
      case 'glass': this.noise(0.7, 4200, 0.8 * v, 'highpass'); for (let i = 0; i < 6; i++) this.tone(2500 + Math.random() * 3000, 1800, 0.12, 0.12 * v, 'triangle', Math.random() * 0.4); break;
      case 'bark': this.tone(420, 240, 0.12, 0.5 * v, 'sawtooth'); this.tone(400, 220, 0.14, 0.5 * v, 'sawtooth', 0.22); break;
      case 'shout': this.tone(300, 220, 0.5, 0.4, 'sawtooth'); this.noise(0.5, 1200, 0.3, 'bandpass'); break;
      case 'spray': this.noise(0.6, 5000, 0.5, 'highpass'); break;
      case 'sting': this.tone(110, 104, 1.2, 0.45, 'sawtooth'); this.tone(165, 150, 1.2, 0.3, 'sawtooth'); break;
      case 'police': for (let i = 0; i < 4; i++) { this.tone(650, 1250, 0.45, 0.3, 'sine', i * 0.9); this.tone(1250, 650, 0.45, 0.3, 'sine', i * 0.9 + 0.45); } break;
    }
  }
  /** Start/stop a looping alarm tone. */
  loop(name, on) {
    if (!this.ctx) return;
    if (on && !this.loops[name]) {
      const o = this.ctx.createOscillator(), l = this.ctx.createOscillator(), lg = this.ctx.createGain(), g = this.ctx.createGain();
      const car = name === 'car';
      o.type = 'square'; o.frequency.value = car ? 880 : 1050; l.type = car ? 'square' : 'sawtooth'; l.frequency.value = car ? 2.2 : 3.2; lg.gain.value = car ? 260 : 320;
      l.connect(lg); lg.connect(o.frequency); g.gain.value = car ? 0.05 : 0.07; o.connect(g); g.connect(this.master); o.start(); l.start();
      this.loops[name] = { o, l };
    } else if (!on && this.loops[name]) { this.loops[name].o.stop(); this.loops[name].l.stop(); delete this.loops[name]; }
  }
  stopAll() { for (const k of Object.keys(this.loops)) this.loop(k, false); }
}
