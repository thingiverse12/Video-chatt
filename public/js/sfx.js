// Minimala syntetiska ljudeffekter (WebAudio, inga filer behövs).

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
    this.last = {};
  }

  ensure() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _throttle(name, ms) {
    const t = performance.now();
    if (this.last[name] && t - this.last[name] < ms) return false;
    this.last[name] = t;
    return true;
  }

  tone(freq, dur, type = 'sine', vol = 0.3, glide = 0) {
    const c = this.ensure(); if (!c || !this.enabled) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), c.currentTime + dur);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  }

  noise(dur, vol = 0.3, filterFreq = 1200, type = 'lowpass', sweep = 0) {
    const c = this.ensure(); if (!c || !this.enabled) return;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq + sweep), c.currentTime + dur);
    const g = c.createGain();
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(); s.stop(c.currentTime + dur + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'chop': if (this._throttle(name, 90)) { this.noise(0.13, 0.34, 900, 'lowpass', -500); this.tone(120, 0.09, 'triangle', 0.16); } break;
      case 'mine': if (this._throttle(name, 90)) { this.noise(0.1, 0.3, 2200, 'bandpass', -900); this.tone(220, 0.05, 'square', 0.08); } break;
      case 'hit': if (this._throttle(name, 60)) this.tone(320, 0.07, 'square', 0.16, -120); break;
      case 'head': this.tone(680, 0.09, 'square', 0.2, -200); break;
      case 'hurt': this.tone(200, 0.22, 'sawtooth', 0.22, -110); break;
      case 'swing': if (this._throttle(name, 120)) this.noise(0.09, 0.1, 1800, 'highpass'); break;
      case 'bow': this.noise(0.16, 0.16, 700, 'bandpass', 1600); break;
      case 'place': this.tone(96, 0.14, 'sine', 0.3); this.noise(0.07, 0.1, 500); break;
      case 'break': this.noise(0.34, 0.36, 700, 'lowpass', -400); break;
      case 'craft': this.tone(520, 0.07, 'triangle', 0.18); setTimeout(() => this.tone(780, 0.09, 'triangle', 0.16), 70); break;
      case 'eat': this.tone(300, 0.09, 'sine', 0.16, 90); break;
      case 'drink': this.noise(0.18, 0.14, 600, 'bandpass', 400); break;
      case 'door': this.noise(0.14, 0.14, 420, 'lowpass', 220); break;
      case 'ui': this.tone(880, 0.03, 'square', 0.05); break;
      case 'deny': this.tone(150, 0.12, 'square', 0.12, -40); break;
      case 'death': this.tone(160, 0.9, 'sawtooth', 0.24, -110); break;
      case 'levelup': [440, 660, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'triangle', 0.16), i * 80)); break;
      default: break;
    }
  }
}

export const sfx = new Sfx();
