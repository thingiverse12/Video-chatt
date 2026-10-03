// Deterministisk terränggenerering. Servern skickar bara ett frö –
// klienten bygger exakt samma höjdkarta lokalt.

import { MAP_SIZE, HALF, HM_RES, HM_STEP, WATER_LEVEL } from './const.js';
import { hash2, smoothstep, clamp } from './math.js';

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x, y, seed, octaves = 5, lac = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm; // 0..1
}

/** Bygger höjdkartan (HM_RES x HM_RES). Index: iz * HM_RES + ix */
export function generateHeightmap(seed) {
  const hm = new Float32Array(HM_RES * HM_RES);
  for (let iz = 0; iz < HM_RES; iz++) {
    const z = -HALF + iz * HM_STEP;
    for (let ix = 0; ix < HM_RES; ix++) {
      const x = -HALF + ix * HM_STEP;
      let cont = fbm(x * 0.0055 + 40, z * 0.0055 - 20, seed, 4);        // kontinent
      const hills = fbm(x * 0.017 + 11, z * 0.017 + 7, seed, 4);        // kullar
      const detail = fbm(x * 0.075 - 5, z * 0.075 + 3, seed, 3);        // småskräp
      // dra ihop mitten så att vi får plana dalar och tydliga berg
      cont = 0.5 + Math.sign(cont - 0.5) * Math.pow(Math.abs(cont - 0.5) * 2, 1.5) / 2;
      const d = Math.hypot(x, z) / (HALF * 0.99);
      const mask = smoothstep(1.0, 0.70, d);                            // ö-form
      let h = (cont - 0.5) * 70 + (hills - 0.5) * 22 + (detail - 0.5) * 1.8 + 15;
      h = h * mask - (1 - mask) * 14;
      // platta till stränder något
      if (h > WATER_LEVEL - 1.5 && h < WATER_LEVEL + 2.2) h = WATER_LEVEL + (h - WATER_LEVEL) * 0.55;
      hm[iz * HM_RES + ix] = h;
    }
  }
  return hm;
}

const idx = (ix, iz) => iz * HM_RES + ix;

/** Bilineär höjdlookup i världskoordinater. */
export function heightAt(hm, x, z) {
  const fx = clamp((x + HALF) / HM_STEP, 0, HM_RES - 1.001);
  const fz = clamp((z + HALF) / HM_STEP, 0, HM_RES - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const h00 = hm[idx(ix, iz)], h10 = hm[idx(ix + 1, iz)];
  const h01 = hm[idx(ix, iz + 1)], h11 = hm[idx(ix + 1, iz + 1)];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

export function normalAt(hm, x, z) {
  const e = HM_STEP;
  const hl = heightAt(hm, x - e, z), hr = heightAt(hm, x + e, z);
  const hd = heightAt(hm, x, z - e), hu = heightAt(hm, x, z + e);
  const nx = hl - hr, ny = 2 * e, nz = hd - hu;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

/** Branthet 0 (plant) .. 1 (lodrätt) */
export function slopeAt(hm, x, z) {
  const n = normalAt(hm, x, z);
  return 1 - n.y;
}

export function isWaterAt(hm, x, z) {
  return heightAt(hm, x, z) < WATER_LEVEL;
}

/**
 * Marscherar en stråle mot terrängen (och vattenytan).
 * Returnerar { t, x, y, z, water } eller null.
 */
export function rayTerrain(hm, o, d, maxDist = 120) {
  const step = 0.35;
  let prevT = 0;
  let prevH = o.y - heightAt(hm, o.x, o.z);
  let prevW = o.y - WATER_LEVEL;
  for (let t = step; t <= maxDist; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = y - heightAt(hm, x, z);
    if (h <= 0 && prevH > 0) {
      // finsök med binärsökning
      let lo = prevT, hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const mx = o.x + d.x * mid, my = o.y + d.y * mid, mz = o.z + d.z * mid;
        if (my - heightAt(hm, mx, mz) > 0) lo = mid; else hi = mid;
      }
      const tt = (lo + hi) / 2;
      return { t: tt, x: o.x + d.x * tt, y: o.y + d.y * tt, z: o.z + d.z * tt, water: false, kind: 'terrain' };
    }
    const w = y - WATER_LEVEL;
    const terr = heightAt(hm, x, z);
    if (w <= 0 && prevW > 0 && terr < WATER_LEVEL - 0.05) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (o.y + d.y * mid - WATER_LEVEL > 0) lo = mid; else hi = mid;
      }
      const tt = (lo + hi) / 2;
      return { t: tt, x: o.x + d.x * tt, y: WATER_LEVEL, z: o.z + d.z * tt, water: true, kind: 'water' };
    }
    prevT = t; prevH = h; prevW = w;
  }
  return null;
}
