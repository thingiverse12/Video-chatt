// Byggsystem: bitar, nivåer, snappning och AABB-lådor.
// Samma kod används av klienten (spökvisning) och servern (validering)
// så att de alltid är överens om var en bit hamnar.

import { heightAt, slopeAt } from './terrain.js';
import { WATER_LEVEL, P } from './const.js';
import { clamp } from './math.js';

export const TIERS = ['wood', 'stone', 'metal'];

export const TIER_INFO = {
  wood:  { name: 'Trä',    hp: 1.0, color: 0xe6c9a4 },
  stone: { name: 'Sten',   hp: 2.6, color: 0xdcd8d1 },
  metal: { name: 'Metall', hp: 5.2, color: 0xe2e8ee },
};

export const PIECES = {
  foundation: { name: 'Golv',           size: [4, 0.2, 4],     cost: { wood: 30 },          hp: 320, upMul: 1.0 },
  wall:       { name: 'Vägg',           size: [4, 3, 0.2],     cost: { wood: 20 },          hp: 280, upMul: 0.8 },
  doorway:    { name: 'Dörröppning',    size: [4, 3, 0.2],     cost: { wood: 20 },          hp: 280, upMul: 0.8 },
  roof:       { name: 'Tak',            size: [4, 0.2, 4],     cost: { wood: 25 },          hp: 240, upMul: 0.8 },
  door:       { name: 'Dörr',           size: [1.2, 2.4, 0.12],cost: { wood: 25, stone: 10 },hp: 160, upMul: 0.5 },
  box:        { name: 'Förvaringslåda', size: [0.9, 0.9, 0.9], cost: { wood: 40 },          hp: 200, upMul: 0.5, storage: true },
  campfire:   { name: 'Lägereld',       size: [1.2, 0.7, 1.2], cost: {},                    hp: 120, upMul: 0, fire: true },
};

export const BUILD_ORDER = ['foundation', 'wall', 'doorway', 'roof', 'door', 'box'];

const UPGRADE_BASE = { stone: { stone: 70 }, metal: { metal: 55 } };

export function buildCost(type) { return { ...(PIECES[type] ? PIECES[type].cost : {}) }; }

export function upgradeCost(type, toTier) {
  const base = UPGRADE_BASE[toTier];
  const mul = PIECES[type] ? PIECES[type].upMul : 0;
  if (!base || !mul) return null;
  const out = {};
  for (const k in base) out[k] = Math.max(1, Math.round(base[k] * mul));
  return out;
}

export function pieceHp(type, tier) {
  const p = PIECES[type];
  if (!p) return 100;
  return Math.round(p.hp * (TIER_INFO[tier] ? TIER_INFO[tier].hp : 1));
}

export function nextTier(tier) {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

// Lokala lådor (relativt blockets mittpunkt, oroterade)
export const LOCAL_BOXES = {
  foundation: [[0, 0, 0, 4, 0.2, 4]],
  wall:       [[0, 0, 0, 4, 3, 0.2]],
  doorway:    [[-1.3, 0, 0, 1.4, 3, 0.2], [1.3, 0, 0, 1.4, 3, 0.2], [0, 1.2, 0, 1.2, 0.6, 0.2]],
  roof:       [[0, 0, 0, 4, 0.2, 4]],
  door:       [[0, 0, 0, 1.2, 2.4, 0.12]],
  box:        [[0, 0, 0, 0.9, 0.9, 0.9]],
  campfire:   [[0, -0.15, 0, 1.0, 0.4, 1.0]],
};

export function rotLocal(lx, lz, rot) {
  const r = ((rot % 4) + 4) % 4;
  if (r === 0) return [lx, lz];
  if (r === 1) return [lz, -lx];
  if (r === 2) return [-lx, -lz];
  return [-lz, lx];
}

/** Alla kollisionslådor för ett block (världs-AABB). */
export function blockBoxes(b) {
  if (b._boxes && b._boxesRot === b.rot) return b._boxes;
  const locals = LOCAL_BOXES[b.type] || [[0, 0, 0, 1, 1, 1]];
  const odd = (((b.rot % 4) + 4) % 4) % 2 === 1;
  const out = [];
  for (const [cx, cy, cz, sx, sy, sz] of locals) {
    const [wx, wz] = rotLocal(cx, cz, b.rot);
    const hx = (odd ? sz : sx) / 2, hy = sy / 2, hz = (odd ? sx : sz) / 2;
    out.push({
      min: { x: b.x + wx - hx, y: b.y + cy - hy, z: b.z + wz - hz },
      max: { x: b.x + wx + hx, y: b.y + cy + hy, z: b.z + wz + hz },
    });
  }
  b._boxes = out;
  b._boxesRot = b.rot;
  return out;
}

export function blockSolid(b) {
  if (b.type === 'door') return !b.open;
  if (b.type === 'campfire') return false; // man kan gå genom elden (den skadar inte i MVP)
  return true;
}

export function blockTop(b) {
  const boxes = blockBoxes(b);
  let top = -Infinity;
  for (const bb of boxes) top = Math.max(top, bb.max.y);
  return top;
}

// --- Occupy-nycklar ---------------------------------------------------------
const q2 = (v) => Math.round(v * 2);

export function blockKey(b) {
  switch (b.type) {
    case 'foundation': return `N:${Math.round(b.x / 4)}:${q2(b.y)}:${Math.round(b.z / 4)}`;
    case 'roof':       return `R:${Math.round(b.x / 4)}:${q2(b.y)}:${Math.round(b.z / 4)}`;
    case 'wall':
    case 'doorway':    return `W:${q2(b.x)}:${q2(b.y)}:${q2(b.z)}:${(((b.rot % 2) + 2) % 2)}`;
    case 'door':       return `D:${b.parentKey || (q2(b.x) + ':' + q2(b.y) + ':' + q2(b.z))}`;
    case 'box':        return `X:${q2(b.x)}:${q2(b.y)}:${q2(b.z)}`;
    case 'campfire':   return `C:${q2(b.x)}:${q2(b.z)}`;
    default:           return `?:${q2(b.x)}:${q2(b.y)}:${q2(b.z)}`;
  }
}

export function keyFor(type, x, y, z, rot, parentKey) {
  return blockKey({ type, x, y, z, rot, parentKey });
}

// --- Rumsligt index ---------------------------------------------------------
export class BuildIndex {
  constructor(cell = 8) {
    this.cell = cell;
    this.cells = new Map();
    this.keys = new Map();
    this.blocks = new Map();
  }
  clear() { this.cells.clear(); this.keys.clear(); this.blocks.clear(); }
  _cellsFor(b) {
    const r = 3;
    const c0 = Math.floor((b.x - r) / this.cell), c1 = Math.floor((b.x + r) / this.cell);
    const d0 = Math.floor((b.z - r) / this.cell), d1 = Math.floor((b.z + r) / this.cell);
    const out = [];
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) out.push(i + ',' + j);
    return out;
  }
  add(b) {
    if (this.blocks.has(b.id)) this.remove(b.id);
    b._boxes = null;
    blockBoxes(b);
    this.blocks.set(b.id, b);
    this.keys.set(blockKey(b), b.id);
    for (const c of this._cellsFor(b)) {
      let s = this.cells.get(c);
      if (!s) { s = new Set(); this.cells.set(c, s); }
      s.add(b.id);
    }
    return b;
  }
  remove(id) {
    const b = this.blocks.get(id);
    if (!b) return;
    this.keys.delete(blockKey(b));
    for (const c of this._cellsFor(b)) {
      const s = this.cells.get(c);
      if (s) { s.delete(id); if (!s.size) this.cells.delete(c); }
    }
    this.blocks.delete(id);
  }
  get(id) { return this.blocks.get(id); }
  hasKey(k) { return this.keys.has(k); }
  byKey(k) { return this.blocks.get(this.keys.get(k)); }
  all() { return [...this.blocks.values()]; }
  near(x, z, r = 6) {
    const out = [];
    const c0 = Math.floor((x - r) / this.cell), c1 = Math.floor((x + r) / this.cell);
    const d0 = Math.floor((z - r) / this.cell), d1 = Math.floor((z + r) / this.cell);
    const seen = new Set();
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const s = this.cells.get(i + ',' + j);
        if (!s) continue;
        for (const id of s) if (!seen.has(id)) { seen.add(id); out.push(this.blocks.get(id)); }
      }
    }
    return out;
  }
}

// --- Snappning --------------------------------------------------------------
const FS = 4;                    // golvstorlek
const quant = (v, s) => Math.round(v / s) * s;

/** Medelhöjd av mitten och de fyra hörnen för en 4x4-yta. */
export function groundLevel(hm, cx, cz) {
  let sum = heightAt(hm, cx, cz) * 1.6;
  for (const [dx, dz] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) sum += heightAt(hm, cx + dx, cz + dz);
  return sum / 5.6;
}

function nearest(list, aim) {
  let best = null, bd = Infinity;
  for (const c of list) {
    const d = (c.x - aim.x) ** 2 + (c.y - aim.y) ** 2 + (c.z - aim.z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function floorCellsNear(index, aim) {
  const out = [];
  for (const b of index.near(aim.x, aim.z, 9)) {
    if (b.type !== 'wall' && b.type !== 'doorway') continue;
    const top = b.y + 1.5;                 // väggens överkant
    const odd = b.rot % 2 === 1;
    for (const s of [-1, 1]) {
      out.push({
        x: b.x + (odd ? s * 2 : 0),
        z: b.z + (odd ? 0 : s * 2),
        y: top + 0.1,                      // golv/tak ligger ovanpå väggen
      });
    }
  }
  return out;
}

function adjacentCells(index, aim, types) {
  const out = [];
  for (const b of index.near(aim.x, aim.z, 9)) {
    if (!types.includes(b.type)) continue;
    for (const [dx, dz] of [[FS, 0], [-FS, 0], [0, FS], [0, -FS]]) {
      out.push({ x: b.x + dx, z: b.z + dz, y: b.y });
    }
  }
  return out;
}

function wallSockets(index, aim) {
  const out = [];
  for (const b of index.near(aim.x, aim.z, 9)) {
    if (b.type === 'foundation' || b.type === 'roof') {
      const top = b.y + 0.1;
      const wy = top + 1.5;
      out.push({ x: b.x, z: b.z + 2, y: wy, rot: 0 });
      out.push({ x: b.x, z: b.z - 2, y: wy, rot: 0 });
      out.push({ x: b.x + 2, z: b.z, y: wy, rot: 1 });
      out.push({ x: b.x - 2, z: b.z, y: wy, rot: 1 });
    } else if (b.type === 'wall' || b.type === 'doorway') {
      out.push({ x: b.x, z: b.z, y: b.y + 3, rot: b.rot }); // våning 2
    }
  }
  return out;
}

/**
 * Beräknar var en byggdel hamnar.
 * @param type  'foundation' | 'wall' | 'doorway' | 'roof' | 'door' | 'box' | 'campfire'
 * @param aim   {x,y,z} punkt där siktstrålen träffade världen
 * @param index BuildIndex
 * @param hm    höjdkarta
 * @param pl    {x,y,z} spelarens position
 */
export function snapPiece(type, aim, index, hm, pl) {
  if (!PIECES[type]) return { ok: false, reason: 'Okänd byggdel' };
  const reach = P.reach + 3.5;
  const far = (x, y, z) => Math.hypot(x - pl.x, (y - 0.9) - pl.y, z - pl.z) > reach;

  if (type === 'foundation') {
    const cands = [];
    const gx = Math.round(aim.x / FS), gz = Math.round(aim.z / FS);
    const cx = gx * FS, cz = gz * FS;
    // medelhöjd av mitten + hörnen så att golvet inte hamnar under backen
    const groundY = quant(groundLevel(hm, cx, cz) + 0.1, 0.25);
    let y = groundY;
    // ärj intilliggande golvhöjd så att delarna ligger i plan (nära marken)
    let bestDy = 1e9;
    for (const n of index.near(cx, cz, 5)) {
      if (n.type !== 'foundation' && n.type !== 'roof') continue;
      const dx = Math.abs(Math.round(n.x / FS) - gx), dz = Math.abs(Math.round(n.z / FS) - gz);
      if (dx + dz !== 1) continue;
      const dy = Math.abs(n.y - groundY);
      if (dy < 2.6 && dy < bestDy) { bestDy = dy; y = n.y; }
    }
    if (heightAt(hm, cx, cz) > WATER_LEVEL - 0.4) cands.push({ x: cx, y, z: cz, rot: 0 });
    cands.push(...floorCellsNear(index, aim));
    const best = nearest(cands.filter((c) => !far(c.x, c.y, c.z)), aim);
    if (!best) return { ok: false, reason: 'Ingen giltig plats' };
    const key = keyFor('foundation', best.x, best.y, best.z, 0);
    if (index.hasKey(key)) return { ok: false, reason: 'Platsen är upptagen' };
    return { ok: true, piece: { type, x: best.x, y: best.y, z: best.z, rot: 0 } };
  }

  if (type === 'roof') {
    const cands = [...floorCellsNear(index, aim)];
    for (const b of index.near(aim.x, aim.z, 9)) {
      if (b.type !== 'roof') continue;
      for (const [dx, dz] of [[FS, 0], [-FS, 0], [0, FS], [0, -FS]]) cands.push({ x: b.x + dx, z: b.z + dz, y: b.y });
    }
    const best = nearest(cands.filter((c) => !far(c.x, c.y, c.z)), aim);
    if (!best) return { ok: false, reason: 'Tak måste fästas på en vägg' };
    if (index.hasKey(keyFor('roof', best.x, best.y, best.z, 0)) ||
        index.hasKey(keyFor('foundation', best.x, best.y, best.z, 0))) return { ok: false, reason: 'Platsen är upptagen' };
    return { ok: true, piece: { type, x: best.x, y: best.y, z: best.z, rot: 0 } };
  }

  if (type === 'wall' || type === 'doorway') {
    const cands = wallSockets(index, aim).filter((c) => Math.hypot(c.x - aim.x, c.y - aim.y, c.z - aim.z) < 3.2 && !far(c.x, c.y, c.z));
    const best = nearest(cands, aim);
    if (!best) return { ok: false, reason: 'Väggar fästs på ett golv' };
    if (index.hasKey(keyFor(type, best.x, best.y, best.z, best.rot)) ||
        index.hasKey(keyFor(type === 'wall' ? 'doorway' : 'wall', best.x, best.y, best.z, best.rot))) {
      return { ok: false, reason: 'Platsen är upptagen' };
    }
    return { ok: true, piece: { type, x: best.x, y: best.y, z: best.z, rot: best.rot } };
  }

  if (type === 'door') {
    let best = null, bd = Infinity;
    for (const b of index.near(aim.x, aim.z, 6)) {
      if (b.type !== 'doorway') continue;
      const d = Math.hypot(b.x - aim.x, b.y - aim.y, b.z - aim.z);
      if (d < bd && d < 3.0) { bd = d; best = b; }
    }
    if (!best) return { ok: false, reason: 'Rikta mot en dörröppning' };
    const y = best.y - 0.3;
    const key = keyFor('door', best.x, y, best.z, best.rot, blockKey(best));
    if (index.hasKey(key)) return { ok: false, reason: 'Det finns redan en dörr' };
    if (far(best.x, y, best.z)) return { ok: false, reason: 'För långt bort' };
    return { ok: true, piece: { type, x: best.x, y, z: best.z, rot: best.rot, parentKey: blockKey(best) } };
  }

  if (type === 'box') {
    let best = null, bd = Infinity;
    for (const b of index.near(aim.x, aim.z, 7)) {
      if (b.type !== 'foundation' && b.type !== 'roof') continue;
      const top = b.y + 0.1;
      if (Math.abs(aim.y - top) > 3) continue;
      const lx = clamp(Math.round(aim.x - b.x), -1, 1);
      const lz = clamp(Math.round(aim.z - b.z), -1, 1);
      const x = b.x + lx, z = b.z + lz, y = top + 0.45;
      const d = Math.hypot(x - aim.x, y - aim.y, z - aim.z);
      if (d < bd) { bd = d; best = { x, y, z }; }
    }
    if (!best) return { ok: false, reason: 'Lådan måste stå på ett golv' };
    if (index.hasKey(keyFor('box', best.x, best.y, best.z, 0))) return { ok: false, reason: 'Platsen är upptagen' };
    if (far(best.x, best.y, best.z)) return { ok: false, reason: 'För långt bort' };
    return { ok: true, piece: { type, x: best.x, y: best.y, z: best.z, rot: 0 } };
  }

  if (type === 'campfire') {
    const y = heightAt(hm, aim.x, aim.z) + 0.35;
    if (aim.y < WATER_LEVEL + 0.2) return { ok: false, reason: 'Inte i vatten' };
    if (slopeAt(hm, aim.x, aim.z) > 0.35) return { ok: false, reason: 'För brant' };
    if (Math.hypot(aim.x - pl.x, aim.z - pl.z) > P.reach + 1.5) return { ok: false, reason: 'För långt bort' };
    if (index.hasKey(keyFor('campfire', aim.x, y, aim.z, 0))) return { ok: false, reason: 'Platsen är upptagen' };
    return { ok: true, piece: { type, x: aim.x, y, z: aim.z, rot: 0 } };
  }

  return { ok: false, reason: 'Okänd byggdel' };
}

export function serializeBlock(b) {
  const o = {
    id: b.id, type: b.type, tier: b.tier, x: b.x, y: b.y, z: b.z, rot: b.rot,
    hp: Math.round(b.hp), maxHp: b.maxHp, owner: b.owner || '',
  };
  if (b.type === 'door') o.open = !!b.open;
  if (b.type === 'box') o.slots = b.slots;
  return o;
}

export function adjacentFloors(index, b) { return adjacentCells(index, b, ['foundation']); }
