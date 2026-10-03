/**
 * Delad världsgenerering (server + klient).
 * Allt här är deterministiskt utifrån ett seed, så servern och webbläsaren
 * får exakt samma terräng och samma resurspunkter utan att skicka dem över nätet.
 */

export const CONFIG = {
  seed: 20261003,
  size: 400, // meter, kvadratisk karta (x och z från -size/2 till +size/2)
  waterLevel: 0,
  grid: 3, // byggnadsgrid i meter
  levelHeight: 3, // våningshöjd
  dayLength: 900, // sekunder för ett helt dygn (15 min)
  nightStart: 0.75, // andel av dygnet då natten börjar
  nightEnd: 0.98,
};

// ---------------------------------------------------------------------------
// Deterministisk "slump" (samma resultat i alla JS-motorer)
// ---------------------------------------------------------------------------

export function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Value noise i 2D, returnerar 0..1 */
export function noise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Fraktal brus-summa, returnerar 0..1 */
export function fbm(x, y, octaves, seed) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, (seed + i * 7919) | 0);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Resurspunkter
// ---------------------------------------------------------------------------

export const NODE_TYPES = {
  tree: { name: 'Träd', hp: 45, respawn: 150, radius: 0.55, height: 7 },
  rock: { name: 'Sten', hp: 60, respawn: 210, radius: 1.0, height: 1.5 },
  ore: { name: 'Metallmalm', hp: 90, respawn: 300, radius: 1.1, height: 1.6 },
  berry: { name: 'Bärbuske', hp: 20, respawn: 240, radius: 0.6, height: 1.0 },
  mushroom: { name: 'Svamp', hp: 8, respawn: 300, radius: 0.3, height: 0.4 },
};

export class World {
  constructor(seed = CONFIG.seed) {
    this.seed = seed | 0;
    this.size = CONFIG.size;
    this.half = this.size / 2;
    this.waterLevel = CONFIG.waterLevel;
    this.lakes = this._makeLakes();
    this.nodes = this._makeNodes();
    this._heightCache = new Map();
  }

  // --- höjd ---

  /** Terränghöjd utan sjöar (ö-form med berg) */
  baseHeight(x, z) {
    const s = this.seed;
    let h = fbm(x * 0.0068, z * 0.0068, 4, s) * 36 - 7;
    h += fbm(x * 0.021, z * 0.021, 3, s + 101) * 6 - 3;
    // berg i nordost
    const mdx = (x - 78) / 72;
    const mdz = (z + 74) / 66;
    h += 20 * Math.exp(-(mdx * mdx + mdz * mdz) * 1.6);
    // kuperad ås i sydväst
    const rdx = (x + 96) / 90;
    const rdz = (z - 88) / 40;
    h += 9 * Math.exp(-(rdx * rdx + rdz * rdz) * 2.0);
    // ö-kant: havet tar över utanför radien
    const d = Math.sqrt(x * x + z * z) / this.half;
    h -= smoothstep(clamp((d - 0.62) / 0.42, 0, 1)) * 52;
    return h;
  }

  _makeLakes() {
    const rnd = mulberry32(this.seed ^ 0x51ed270b);
    const lakes = [];
    let guard = 0;
    while (lakes.length < 5 && guard++ < 400) {
      const a = rnd() * Math.PI * 2;
      const r = (0.15 + rnd() * 0.42) * this.half;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const rad = 20 + rnd() * 22;
      if (this.baseHeight(x, z) < 6) continue;
      let ok = true;
      for (const l of lakes) {
        if (Math.hypot(l.x - x, l.z - z) < l.r + rad + 24) ok = false;
      }
      if (!ok) continue;
      // sjön måste ha plats innanför kartan
      if (Math.hypot(x, z) + rad > this.half * 0.82) continue;
      lakes.push({ x, z, r: rad });
    }
    return lakes;
  }

  /** Terränghöjd inklusive sjöbottnar */
  heightAt(x, z) {
    let h = this.baseHeight(x, z);
    for (let i = 0; i < this.lakes.length; i++) {
      const l = this.lakes[i];
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r) {
        // t = 1 i mitten, 0 vid strandkanten; gräver en skål under vattenytan
        const t = smoothstep(clamp(1 - d / l.r, 0, 1));
        h = lerp(h, -2.5 - 5.5 * t, t * t);
      }
    }
    return h;
  }

  /** Lutning (0 = plant) som största höjdskillnad per meter */
  slopeAt(x, z) {
    const d = 1.5;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.sqrt(hx * hx + hz * hz) / (2 * d);
  }

  isWater(x, z) {
    return this.heightAt(x, z) < this.waterLevel - 0.15;
  }

  /** Grov biomtyp, används för färgsättning och resursplacering */
  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    const forest = fbm(x * 0.009 + 500, z * 0.009 + 500, 3, this.seed + 31);
    if (h < 1.5) return 'beach';
    if (h > 22) return 'mountain';
    if (h > 13) return 'rock';
    return forest > 0.52 ? 'forest' : 'grass';
  }

  _makeNodes() {
    const rnd = mulberry32(this.seed ^ 0x2545f491);
    const nodes = [];
    let id = 0;
    const attempt = (type, count, test) => {
      let placed = 0;
      let guard = 0;
      const maxGuard = count * 60;
      while (placed < count && guard++ < maxGuard) {
        const x = (rnd() * 2 - 1) * (this.half - 12);
        const z = (rnd() * 2 - 1) * (this.half - 12);
        const h = this.heightAt(x, z);
        if (h < 0.8 || h > 40) continue;
        if (this.slopeAt(x, z) > 0.55) continue;
        // inte för nära en annan nod av samma typ
        let close = false;
        for (let i = nodes.length - 1; i >= 0 && i > nodes.length - 30; i--) {
          const n = nodes[i];
          if (n.type === type && Math.hypot(n.x - x, n.z - z) < (type === 'tree' ? 3.2 : 2.4)) {
            close = true;
            break;
          }
        }
        if (close) continue;
        const info = NODE_TYPES[type];
        if (!test(x, z, h, this.biomeAt(x, z))) continue;
        nodes.push({
          id: id++,
          type,
          x: +x.toFixed(2),
          z: +z.toFixed(2),
          y: +h.toFixed(2),
          s: +(0.75 + rnd() * 0.5).toFixed(2),
          r: +(rnd() * Math.PI * 2).toFixed(2),
          hp: info.hp,
        });
        placed++;
      }
    };

    attempt('tree', 520, (x, z, h, b) => h > 1.6 && h < 24 && b !== 'beach' && b !== 'mountain');
    attempt('rock', 300, (x, z, h, b) => h > 1.0 && h < 34 && b !== 'beach');
    attempt('ore', 90, (x, z, h, b) => h > 11 && b !== 'beach' && b !== 'forest');
    attempt('berry', 150, (x, z, h, b) => h > 2 && h < 20 && (b === 'forest' || b === 'grass'));
    attempt('mushroom', 120, (x, z, h, b) => h > 2 && h < 22 && b === 'forest');
    return nodes;
  }

  /** Strandposition för respawn */
  randomBeachSpawn(rnd) {
    const r = (v) => (typeof rnd === 'function' ? rnd() : Math.random() * v);
    for (let i = 0; i < 500; i++) {
      const a = r(1) * Math.PI * 2;
      const rad = 60 + r(1) * (this.half - 80);
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const h = this.heightAt(x, z);
      if (h > 1.2 && h < 6 && this.slopeAt(x, z) < 0.5) return { x, y: h, z };
    }
    return { x: 0, y: Math.max(1.5, this.heightAt(0, 0)), z: 0 };
  }
}

/** Solens höjd: 0 = midnatt, 0.5 = middag. Returnerar -1..1 */
export function sunHeight(dayFraction) {
  return Math.sin((dayFraction - 0.25) * Math.PI * 2);
}

/** 0 = natt, 1 = full dagsljus */
export function daylight(dayFraction) {
  const s = sunHeight(dayFraction);
  return clamp((s + 0.18) / 0.5, 0, 1);
}
