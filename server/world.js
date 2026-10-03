// Världen: höjdkarta, resursnoder och spawn-punkter.

import { generateHeightmap, heightAt, slopeAt, fbm } from '../shared/terrain.js';
import { NODES, ColliderGrid } from '../shared/nodes.js';
import { mulberry32 } from '../shared/math.js';
import { HALF, WATER_LEVEL } from '../shared/const.js';

const COUNTS = { tree: 620, rock: 210, metal: 90, bush: 130 };

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.hm = generateHeightmap(this.seed);
    this.nodes = [];
    this.byId = new Map();
    this.dirty = new Set();
    this._nextId = 1;
    this._occupied = new Set();
    this.scatter();
    this.spawns = this.findSpawns(16);
    this.colliders = new ColliderGrid();
    this.colliders.build(this.nodes);
  }

  terrain(x, z) { return heightAt(this.hm, x, z); }
  slope(x, z) { return slopeAt(this.hm, x, z); }

  _occ(x, z, r = 2) {
    const cells = [];
    for (let i = Math.floor((x - r) / 2); i <= Math.floor((x + r) / 2); i++) {
      for (let j = Math.floor((z - r) / 2); j <= Math.floor((z + r) / 2); j++) cells.push(i + ',' + j);
    }
    return cells;
  }
  _free(x, z, r) {
    for (const c of this._occ(x, z, r)) if (this._occupied.has(c)) return false;
    return true;
  }
  _mark(x, z, r) { for (const c of this._occ(x, z, r)) this._occupied.add(c); }

  addNode(kind, x, z, rng) {
    const y = this.terrain(x, z);
    const def = NODES[kind];
    const scale = 0.8 + rng() * 0.5;
    const n = {
      id: this._nextId++,
      kind, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10,
      amount: def.amount, max: def.amount, alive: true, respawnAt: 0,
      rot: rng() * Math.PI * 2,
      s: scale,
      h: kind === 'tree' ? 4.4 + rng() * 3.4 : def.radius * 2 * scale,
      v: rng(),
    };
    this.nodes.push(n);
    this.byId.set(n.id, n);
    this._mark(x, z, kind === 'tree' ? 1.6 : def.radius + 0.8);
    return n;
  }

  scatter() {
    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    const tries = { tree: 9000, rock: 6000, metal: 5000, bush: 5000 };
    for (const kind of ['rock', 'metal', 'tree', 'bush']) {
      let placed = 0;
      for (let i = 0; i < tries[kind] && placed < COUNTS[kind]; i++) {
        const x = (rng() * 2 - 1) * (HALF - 8);
        const z = (rng() * 2 - 1) * (HALF - 8);
        const h = this.terrain(x, z);
        const sl = this.slope(x, z);
        if (h < WATER_LEVEL + 0.9) continue;
        if (sl > 0.42) continue;
        let ok = false;
        if (kind === 'tree') {
          const forest = fbm(x * 0.016 + 5, z * 0.016 - 3, this.seed + 777, 3);
          ok = h < 30 && rng() < (forest - 0.28) * 2.6;
        } else if (kind === 'rock') {
          ok = rng() < 0.55 + sl * 0.6;
        } else if (kind === 'metal') {
          ok = h > WATER_LEVEL + 3 && rng() < 0.35 + sl * 0.8;
        } else if (kind === 'bush') {
          const meadow = fbm(x * 0.02 - 11, z * 0.02 + 9, this.seed + 313, 3);
          ok = h < 24 && rng() < (meadow - 0.3) * 2.0;
        }
        if (!ok) continue;
        if (!this._free(x, z, kind === 'tree' ? 2.2 : NODES[kind].radius + 1.6)) continue;
        this.addNode(kind, x, z, rng);
        placed++;
      }
    }
  }

  findSpawns(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      let best = null;
      for (let r = HALF * 0.45; r < HALF * 0.95; r += 6) {
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const h = this.terrain(x, z);
        if (h > WATER_LEVEL + 0.6 && h < WATER_LEVEL + 7 && this.slope(x, z) < 0.2) { best = { x, y: h, z }; break; }
      }
      if (!best) {
        // reserv: närmaste land inåt
        for (let r = HALF * 0.45; r > 20; r -= 6) {
          const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
          const h = this.terrain(x, z);
          if (h > WATER_LEVEL + 0.6 && this.slope(x, z) < 0.3) { best = { x, y: h, z }; break; }
        }
      }
      if (best) out.push({ ...best, yaw: ang + Math.PI });
    }
    if (!out.length) out.push({ x: 0, y: this.terrain(0, 0), z: 0, yaw: 0 });
    return out;
  }

  randomSpawn(avoid = []) {
    const scored = this.spawns.map((s) => {
      let d = Infinity;
      for (const p of avoid) d = Math.min(d, Math.hypot(p.x - s.x, p.z - s.z));
      return { s, d };
    });
    const ok = scored.filter((x) => x.d > 25);
    const pool = ok.length ? ok : scored;
    return pool[Math.floor(Math.random() * pool.length)].s;
  }

  /** Slår på en nod. Returnerar true om den tömdes. */
  damageNode(id, dmg, now) {
    const n = this.byId.get(id);
    if (!n || !n.alive) return false;
    n.amount -= dmg;
    this.dirty.add(n.id);
    if (n.amount <= 0) {
      n.amount = 0;
      n.alive = false;
      n.respawnAt = now + NODES[n.kind].respawn;
      if (this.colliders) this.colliders.update(n);
      return true;
    }
    return false;
  }

  tick(now) {
    for (const n of this.nodes) {
      if (!n.alive && n.respawnAt && now >= n.respawnAt) {
        n.alive = true;
        n.amount = n.max;
        n.respawnAt = 0;
        this.dirty.add(n.id);
        if (this.colliders) this.colliders.update(n);
      }
    }
  }

  takeDirty() {
    if (!this.dirty.size) return null;
    const out = [];
    for (const id of this.dirty) {
      const n = this.byId.get(id);
      if (n) out.push({ id: n.id, a: Math.round(n.amount), alive: n.alive });
    }
    this.dirty.clear();
    return out;
  }

  serializeNodes() {
    return this.nodes.map((n) => ({
      id: n.id, k: n.kind, x: n.x, y: n.y, z: n.z, a: n.amount, m: n.max,
      alive: n.alive, rot: n.rot, s: n.s, h: n.h, v: n.v,
    }));
  }
}
