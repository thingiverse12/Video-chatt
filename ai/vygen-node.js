'use strict';
/**
 * VY-Gen — inferensmotor på Node.js, skriven från grunden.
 *
 * Läser den binära exporten (ai/dist/vygen.bin) och kör samma transformer
 * som träningarna i Python: char-level GPT med KV-cache, top-k-sampling.
 * Ingen extern AI-API — allt körs i processen.
 *
 * Format VYGEN1:
 *   [6 byte 'VYGEN1'][u32 JSON-längd][JSON-huvud, uppfojat till 4][float32 ...]
 */

const fs = require('fs');

const MAGIC = 'VYGEN1';

/** Läser en VYGEN1-fil och returnerar en klar modell. */
function loadModel(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 6) !== MAGIC) throw new Error('Okej modellformat: ' + file);
  const headerLen = buf.readUInt32LE(6);
  const header = JSON.parse(buf.toString('utf-8', 10, 10 + headerLen));
  const padded = Math.ceil(headerLen / 4) * 4;
  // Kopiera till ny buffer så att Float32Array-viewet alltid är 4-byte justerat.
  const nFloats = Math.floor((buf.byteLength - 10 - padded) / 4);
  const byteCopy = new Uint8Array(nFloats * 4);
  byteCopy.set(buf.subarray(10 + padded, 10 + padded + nFloats * 4));
  const floatView = new Float32Array(byteCopy.buffer);
  return buildModel(header, floatView);
}

/** Bygger matriserna i samma ordning som export_model.py skrev dem. */
function buildModel(header, flat) {
  const cfg = header.config;
  const d = cfg.d_model;
  const headDim = d / cfg.n_heads;
  const vocab = header.vocab;

  let pos = 0;
  const take = (n) => {
    const a = flat.subarray(pos, pos + n);
    pos += n;
    return a;
  };

  const model = {
    vocab,
    config: cfg,
    ctx: cfg.ctx,
    d,
    headDim,
    nHeads: cfg.n_heads,
    nLayers: cfg.n_layers,
    dFf: cfg.d_ff,
    tok: take(vocab.length * d),          // (vocab, d)
    posEmb: take(cfg.ctx * d),            // (ctx, d)
    layers: [],
    scale: 1 / Math.sqrt(headDim),
  };

  for (let L = 0; L < cfg.n_layers; L++) {
    model.layers.push({
      ln1W: take(d), ln1B: take(d),
      wQkv: take(3 * d * d), bQkv: take(3 * d),
      wO: take(d * d),
      ln2W: take(d), ln2B: take(d),
      w1: take(cfg.d_ff * d), b1: take(cfg.d_ff),
      w2: take(d * cfg.d_ff),
      kCache: null,                       // (p, heads*headDim) per position
      vCache: null,
    });
  }
  model.lnfW = take(d);
  model.lnfB = take(d);
  return model;
}

function encode(model, text) {
  const map = new Map();
  model.vocab.forEach((ch, i) => map.set(ch, i));
  const ids = [];
  for (const ch of text) {
    const id = map.get(ch);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function layerNorm(x, offset, d, w, b, out) {
  let mean = 0;
  for (let j = 0; j < d; j++) mean += x[offset + j];
  mean /= d;
  let varr = 0;
  for (let j = 0; j < d; j++) {
    const diff = x[offset + j] - mean;
    varr += diff * diff;
  }
  varr = varr / d + 1e-5;
  const inv = 1 / Math.sqrt(varr);
  for (let j = 0; j < d; j++) out[offset + j] = (x[offset + j] - mean) * inv * w[j] + b[j];
}

/** Erf-approximation (Abramowitz & Stegun 7.1.26, fel < 1.5e-7). */
function erf(x) {
  if (x < 0) return -erf(-x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return y;
}

function geluInPlace(a) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    a[i] = 0.5 * x * (1 + erf(x / Math.SQRT2));
  }
}

/**
 * Forward-pass över `ids` (en token om steg, hela fönstret vid prefill).
 * startPos = absolut position för det första tokenet. KV-cache ligger i
 * model.layers[*] och växer med varje anrop.
 * Returns: { logits: Float32Array(vocab) för sista tokenet }
 */
function forward(model, ids, startPos, debug = false) {
  const d = model.d;
  const t = ids.length;
  const debugTrace = debug ? { afterBlocks: [], lnf: null } : null;
  const h = new Float32Array(t * d);
  for (let i = 0; i < t; i++) {
    const id = ids[i];
    const eTok = model.tok.subarray(id * d, id * d + d);
    const ePos = model.posEmb.subarray((startPos + i) * d, (startPos + i) * d + d);
    const off = i * d;
    for (let j = 0; j < d; j++) h[off + j] = eTok[j] + ePos[j];
  }

  const buffers = [new Float32Array(t * d), new Float32Array(t * 3 * d)];
  let prev = h;
  if (debug) debugTrace.sub = [];

  for (let L = 0; L < model.nLayers; L++) {
    const layer = model.layers[L];
    const [buf1, buf2] = buffers;
    for (let i = 0; i < t; i++) layerNorm(prev, i * d, d, layer.ln1W, layer.ln1B, buf1);

    // QKV: out[o] = b[o] + sum_j x1[j] * W[o*d + j],  o i [0, 3d)
    for (let i = 0; i < t; i++) {
      const xOff = i * d;
      for (let o = 0; o < 3 * d; o++) {
        let s = layer.bQkv[o];
        const wOff = o * d;
        for (let j = 0; j < d; j++) s += buf1[xOff + j] * layer.wQkv[wOff + j];
        buf2[i * 3 * d + o] = s;
      }
    }

    // Uppdelning i headar + KV-cache. k/v-layout: (position, head, comp)
    const hp = model.nHeads * model.headDim; // == d
    const pOld = layer.kCache ? layer.kCache.length / hp : 0;
    const pNew = pOld + t;
    const kFull = new Float32Array(pNew * hp);
    const vFull = new Float32Array(pNew * hp);
    if (layer.kCache) {
      kFull.set(layer.kCache, 0);
      vFull.set(layer.vCache, 0);
    }
    for (let i = 0; i < t; i++) {
      kFull.set(buf2.subarray(i * 3 * d + d, i * 3 * d + 2 * d), (pOld + i) * hp);
      vFull.set(buf2.subarray(i * 3 * d + 2 * d, i * 3 * d + 3 * d), (pOld + i) * hp);
    }
    layer.kCache = kFull;
    layer.vCache = vFull;

    if (debug && L === 0) {
      debugTrace.sub.push(
        { name: 'ln1', v: Array.from(buf1.subarray((t - 1) * d, t * d)) },
        { name: 'qkv', v: Array.from(buf2.subarray((t - 1) * 3 * d, t * 3 * d)) },
      );
    }
    // Attention: frågan på absolut position a ser nycklar 0..a.
    const attnOut = new Float32Array(t * d);
    void pNew;
    // Multi-head attention: varje head har egna scores, softmax och V.
    const hd = model.headDim;
    for (let i = 0; i < t; i++) {
      const a = startPos + i; // absolut position
      const nJ = a + 1;
      // Max för numerisk stabilitet (över alla headar och nycklar).
      let maxS = -Infinity;
      for (let h = 0; h < model.nHeads; h++) {
        const base = h * hd;
        const qOff = i * 3 * d + base;
        for (let j = 0; j < nJ; j++) {
          let s = 0;
          const kOff = j * hp + base;
          for (let cc = 0; cc < hd; cc++) s += buf2[qOff + cc] * kFull[kOff + cc];
          maxS = Math.max(maxS, s * model.scale);
        }
      }
      if (debug && L === 0 && i === t - 1) debugTrace.scoresDump = [];
      const exps = new Float32Array(model.nHeads * nJ);
      const sums = new Float32Array(model.nHeads);
      for (let h = 0; h < model.nHeads; h++) {
        const base = h * hd;
        const qOff = i * 3 * d + base;
        let sum = 0;
        for (let j = 0; j < nJ; j++) {
          let s = 0;
          const kOff = j * hp + base;
          for (let cc = 0; cc < hd; cc++) s += buf2[qOff + cc] * kFull[kOff + cc];
          const e = Math.exp(s * model.scale - maxS);
          exps[h * nJ + j] = e;
          sum += e;
          if (debug && L === 0 && i === t - 1) debugTrace.scoresDump.push(s * model.scale);
        }
        sums[h] = sum;
      }
      if (debug && L === 0 && i === t - 1) {
        debugTrace.attnMat = [];
        for (let h = 0; h < model.nHeads; h++) {
          for (let j = 0; j < nJ; j++) debugTrace.attnMat.push(exps[h * nJ + j] / sums[h]);
        }
      }
      for (let cc = 0; cc < d; cc++) {
        const h = Math.floor(cc / hd);
        let o = 0;
        for (let j = 0; j < nJ; j++) o += exps[h * nJ + j] * vFull[j * hp + cc];
        attnOut[i * d + cc] = o / sums[h];
      }
    }
    if (debug && L === 0) debugTrace.sub.push({ name: 'attn', v: Array.from(attnOut.subarray((t - 1) * d, t * d)) });
    // wO: prev = prev + attnOut @ wO
    for (let i = 0; i < t; i++) {
      const xOff = i * d;
      for (let j = 0; j < d; j++) {
        let s = 0;
        const wOff = j * d;
        for (let c = 0; c < d; c++) s += attnOut[xOff + c] * layer.wO[wOff + c];
        prev[xOff + j] += s;
      }
    }

    for (let i = 0; i < t; i++) layerNorm(prev, i * d, d, layer.ln2W, layer.ln2B, buf1);
    const mlp = new Float32Array(t * model.dFf);
    for (let i = 0; i < t; i++) {
      const xOff = i * d;
      for (let o = 0; o < model.dFf; o++) {
        let s = layer.b1[o];
        const wOff = o * d;
        for (let j = 0; j < d; j++) s += buf1[xOff + j] * layer.w1[wOff + j];
        mlp[i * model.dFf + o] = s;
      }
      geluInPlace(mlp.subarray(i * model.dFf, (i + 1) * model.dFf));
      for (let j = 0; j < d; j++) {
        let s = 0;
        const wOff = j * model.dFf;
        for (let o = 0; o < model.dFf; o++) s += mlp[i * model.dFf + o] * layer.w2[wOff + o];
        prev[xOff + j] += s;
      }
    }
    if (debug) debugTrace.afterBlocks.push(Array.from(prev.subarray((t - 1) * d, t * d)));
  }

  // Slutnorm + delat språkhuvud: logits[v] = dot(lnf(h_last), tok[v])
  const last = new Float32Array(d);
  let mean = 0;
  for (let j = 0; j < d; j++) mean += prev[(t - 1) * d + j];
  mean /= d;
  let varr = 0;
  for (let j = 0; j < d; j++) {
    const diff = prev[(t - 1) * d + j] - mean;
    varr += diff * diff;
  }
  const inv = 1 / Math.sqrt(varr / d + 1e-5);
  for (let j = 0; j < d; j++) last[j] = (prev[(t - 1) * d + j] - mean) * inv * model.lnfW[j] + model.lnfB[j];

  const logits = new Float32Array(model.vocab.length);
  for (let v = 0; v < model.vocab.length; v++) {
    let s = 0;
    const off = v * d;
    for (let j = 0; j < d; j++) s += last[j] * model.tok[off + j];
    logits[v] = s;
  }
  if (debug) {
    debugTrace.lnf = Array.from(last);
    return { logits, trace: debugTrace };
  }
  return { logits };
}

/** Top-k + temperatur-sampling. */
function sample(logits, temp, topK) {
  const n = logits.length;
  const k = Math.min(topK, n);
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => logits[b] - logits[a]);
  const chosen = idx.slice(0, k);
  let max = -Infinity;
  for (const i of chosen) max = Math.max(max, logits[i] / temp);
  let sum = 0;
  const exps = chosen.map((i) => {
    const e = Math.exp(logits[i] / temp - max);
    sum += e;
    return e;
  });
  let r = Math.random() * sum;
  for (let i = 0; i < chosen.length; i++) {
    r -= exps[i];
    if (r <= 0) return chosen[i];
  }
  return chosen[chosen.length - 1];
}

/**
 * Genererar ett svar. `prompt` ska sluta med "VY-GEN: ".
 * Returns: { text, steps, ms }
 */
function generate(model, prompt, opts = {}) {
  const maxNew = Math.min(opts.maxNew || 200, model.ctx - 4);
  // Låg temperatur: modellen är liten och hämtar svar ur minnet,
  // för högt värde blandar ihop flera svar.
  const temp = opts.temperature || 0.4;
  const topK = opts.topK || 20;
  const t0 = Date.now();

  let ids = encode(model, prompt);
  if (ids.length === 0) throw new Error('Tom prompt');
  if (ids.length > model.ctx) ids = ids.slice(-model.ctx);
  const startPos = 0;

  // Nollställa cache
  for (const layer of model.layers) {
    layer.kCache = null;
    layer.vCache = null;
  }

  let { logits } = forward(model, ids, startPos);
  const out = [];
  let steps = 0;
  for (let n = 0; n < maxNew; n++) {
    const id = sample(logits, temp, topK);
    const ch = model.vocab[id];
    out.push(ch);
    steps++;
    const textSoFar = out.join('');
    if (n > 15 && textSoFar.endsWith('\n\n')) break; // tränat stopp
    if (n > 40 && textSoFar.includes('\nANVÄNDARE:')) break; // återgång till promptformat
    if (ch === '\n' && n > 80 && textSoFar.trimEnd().endsWith('.')) break;
    ({ logits } = forward(model, [id], ids.length + n));
  }
  return { text: out.join(''), steps, ms: Date.now() - t0 };
}

/**
 * Kör forward-pass en gång och returnerar log-odds för sista positionen.
 * (Används t.ex. i tvärvalideringen mot PyTorch.)
 */
function logitsFor(model, prompt) {
  let ids = encode(model, prompt);
  if (ids.length === 0) return null;
  if (ids.length > model.ctx) ids = ids.slice(-model.ctx);
  for (const layer of model.layers) {
    layer.kCache = null;
    layer.vCache = null;
  }
  const { logits } = forward(model, ids, 0);
  return Array.from(logits);
}

/**
 * Chatt-nivå: tar ett användarbesked och returnerar VY-Gens svar.
 * Promptformatet är det som modellen tränades på.
 */
function chat(model, message, opts = {}) {
  const clean = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return '';
  const prompt = `ANVÄNDARE: ${clean}\nVY-GEN: `;
  let result = generate(model, prompt, opts);
  let text = result.text.trim();
  // En snabb repris om första försöket blev tomt eller kort.
  if (text.length < 4) {
    result = generate(model, prompt, { ...opts, temperature: 0.4, topK: 16 });
    text = result.text.trim();
  }
  // Klipp bort alltihop efter ett nytt "ANVÄNDARE:" (formatläcka).
  const leak = text.indexOf('\nANVÄNDARE:');
  if (leak >= 0) text = text.slice(0, leak);
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text || 'Jag blir lite osäker på det. Prova att formulera om?';
}

module.exports = { loadModel, generate, chat, encode, logitsFor, forward };
