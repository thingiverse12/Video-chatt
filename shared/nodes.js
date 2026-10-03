// Resursnoder: träd, sten, metallmalm, bärbuskar.
// Delas av server (utbyte/skada) och klient (rendering/ikoner).

import { ITEMS } from './items.js';

export const NODES = {
  tree: {
    label: 'Träd', amount: 150, respawn: 220, radius: 0.85,
    primary: { item: 'wood', base: 4 }, secondary: [{ item: 'stone', base: 1 }],
  },
  rock: {
    label: 'Sten', amount: 190, respawn: 280, radius: 1.25,
    primary: { item: 'stone', base: 4 }, secondary: [{ item: 'wood', base: 0 }],
  },
  metal: {
    label: 'Metallmalm', amount: 130, respawn: 400, radius: 1.15,
    primary: { item: 'metal', base: 3 }, secondary: [{ item: 'stone', base: 2 }],
  },
  bush: {
    label: 'Bärbuske', amount: 24, respawn: 110, radius: 0.7,
    primary: { item: 'berry', base: 2 }, secondary: [],
  },
};

export const NODE_KINDS = Object.keys(NODES);

/** Vilka sfärer som används för träfftest mot en nod. */
/**
 * Träffsfärer för en resursnod. Flera sfärer per nod så att man träffar
 * var som helst på stammen/kronan – annars känns huggandet trasigt.
 */
export function nodeSpheres(n) {
  const kind = NODES[n.kind];
  if (!kind) return [];
  const s = n.s || 1;
  if (n.kind === 'tree') {
    const h = (n.h || 6) * s;
    return [
      { x: n.x, y: n.y + h * 0.10, z: n.z, r: 0.5 * s },
      { x: n.x, y: n.y + h * 0.36, z: n.z, r: 0.6 * s },
      { x: n.x, y: n.y + h * 0.62, z: n.z, r: 0.55 * s },
      { x: n.x, y: n.y + h * 0.82, z: n.z, r: Math.max(1.1, h * 0.3) },
    ];
  }
  if (n.kind === 'bush') {
    return [{ x: n.x, y: n.y + 0.5 * s, z: n.z, r: 0.85 * s }];
  }
  const r = kind.radius * s * (0.72 + 0.28 * (n.amount / n.max));
  return [
    { x: n.x, y: n.y + r * 0.45, z: n.z, r },
    { x: n.x, y: n.y + r * 1.0, z: n.z, r: r * 0.72 },
  ];
}

/**
 * Räknar ut vad ett slag mot en nod ger.
 * @returns {{loot: Array<{item:string,qty:number}>, damage:number}}
 */
export function gatherFrom(kindId, heldItemId) {
  const kind = NODES[kindId];
  if (!kind) return { loot: [], damage: 0 };
  const d = heldItemId ? ITEMS[heldItemId] : null;
  const loot = [];
  let damage = 1;

  const multFor = (res) => {
    if (!d) return 1;
    if (d.gather && d.gather[res]) return d.gather[res];
    return d.cat === 'tool' || d.cat === 'weapon' ? 1.35 : 1;
  };

  const q = Math.max(1, Math.round(kind.primary.base * multFor(kind.primary.item)));
  loot.push({ item: kind.primary.item, qty: q });
  damage += q;
  for (const s of kind.secondary) {
    if (!s.base) continue;
    const sq = Math.max(1, Math.round(s.base * multFor(s.item)));
    loot.push({ item: s.item, qty: sq });
  }
  return { loot, damage };
}

/** Skada mot spelare/byggnad med ett föremål (eller nävarna). */
export function attackStats(itemId) {
  const d = itemId ? ITEMS[itemId] : null;
  if (!d) return { dmg: 6, range: 2.2, rate: 0.55, ranged: false, dur: 0 };
  return {
    dmg: d.dmg || 6,
    range: d.range || 2.4,
    rate: d.rate || 0.7,
    ranged: d.cat === 'ranged',
    ammo: d.ammo || null,
    projSpeed: d.projSpeed || 40,
    dur: d.dur ? 1 : 0,
  };
}


/**
 * Kollisionscylinder för en nod (cirkel i XZ-planet mellan minY och top).
 * Endast `alive`, `s`, `h` och `kind` används – aldrig `amount` – så att
 * klient och server alltid räknar fram exakt samma yta.
 */
export function nodeCollider(n) {
  if (!n || n.kind === 'bush') return null;
  const s = n.s || 1;
  if (n.kind === 'tree') {
    const h = (n.h || 6) * s;
    return n.alive
      ? { x: n.x, z: n.z, r: 0.46 * s, minY: n.y - 0.3, top: n.y + h * 0.92 }
      : { x: n.x, z: n.z, r: 0.34 * s, minY: n.y - 0.3, top: n.y + 0.55 };   // stubbe
  }
  if (!n.alive) return null;                                                  // utbruten klippa
  const k = NODES[n.kind];
  const r = k.radius * s;
  return { x: n.x, z: n.z, r: r * 0.92, minY: n.y - 0.3, top: n.y + r * 1.45 };
}

/** Enkelt spatialt rutnät för nod-kollisioner. */
export class ColliderGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.cells = new Map();
    this.map = new Map();     // nodeId -> collider
  }
  clear() { this.cells.clear(); this.map.clear(); }
  build(nodes) { this.clear(); for (const n of nodes) this.update(n); }
  _keys(c) {
    const out = [];
    const c0 = Math.floor((c.x - c.r) / this.cell), c1 = Math.floor((c.x + c.r) / this.cell);
    const d0 = Math.floor((c.z - c.r) / this.cell), d1 = Math.floor((c.z + c.r) / this.cell);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) out.push(i + ',' + j);
    return out;
  }
  update(n) {
    const old = this.map.get(n.id);
    if (old) {
      for (const k of this._keys(old)) {
        const a = this.cells.get(k);
        if (a) { const i = a.indexOf(old); if (i >= 0) a.splice(i, 1); }
      }
      this.map.delete(n.id);
    }
    const c = nodeCollider(n);
    if (!c) return null;
    c.id = n.id;
    this.map.set(n.id, c);
    for (const k of this._keys(c)) {
      let a = this.cells.get(k);
      if (!a) { a = []; this.cells.set(k, a); }
      a.push(c);
    }
    return c;
  }
  remove(id) {
    const old = this.map.get(id);
    if (!old) return;
    for (const k of this._keys(old)) {
      const a = this.cells.get(k);
      if (a) { const i = a.indexOf(old); if (i >= 0) a.splice(i, 1); }
    }
    this.map.delete(id);
  }
  near(x, z, r = 2) {
    const out = [];
    const c0 = Math.floor((x - r) / this.cell), c1 = Math.floor((x + r) / this.cell);
    const d0 = Math.floor((z - r) / this.cell), d1 = Math.floor((z + r) / this.cell);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.cells.get(i + ',' + j);
      if (a) for (const c of a) out.push(c);
    }
    return out;
  }
}
