/**
 * Delad byggnadslogik (server + klient).
 * Byggnader ligger på ett grid om 3 x 3 m. En "floor" (foundation/tak) äger en
 * cell, en "wall"/"doorway"/"door" sitter på en kant mellan två celler.
 * Samma BuildingIndex och canPlace() används av både servern och klientens
 * förhandsvisning, så att det som ser grönt ut också går att bygga.
 */

import { CONFIG } from './worldgen.js';

export const GRID = CONFIG.grid;
export const LEVEL_H = CONFIG.levelHeight;

/** Byggbara delar: kostnad, hp, namn och om de är strukturella */
export const PIECES = {
  foundation: { name: 'Grund', cost: { wood: 40 }, hp: 320, slot: true },
  wall: { name: 'Vägg', cost: { wood: 25 }, hp: 240, slot: true },
  doorway: { name: 'Dörröppning', cost: { wood: 30 }, hp: 240, slot: true },
  ceiling: { name: 'Tak', cost: { wood: 30 }, hp: 240, slot: true },
  door: { name: 'Dörr', cost: { wood: 50 }, hp: 400, item: true },
  campfire: { name: 'Lägereld', cost: { wood: 60, stone: 20 }, hp: 150, item: true },
  storage_box: { name: 'Förvaringslåda', cost: { wood: 100, stone: 20 }, hp: 350, item: true },
};

export const SIDES = [
  { id: 0, name: 'Norr', dx: 0, dz: -1 }, // -z
  { id: 1, name: 'Öst', dx: 1, dz: 0 }, // +x
  { id: 2, name: 'Syd', dx: 0, dz: 1 }, // +z
  { id: 3, name: 'Väst', dx: -1, dz: 0 }, // -x
];

export function cellOf(x, z) {
  return { gx: Math.floor(x / GRID), gz: Math.floor(z / GRID) };
}

export function cellCenter(gx, gz) {
  return { x: gx * GRID + GRID / 2, z: gz * GRID + GRID / 2 };
}

/** Kanonisk nyckel för en kant (vägg-position) */
export function edgeKey(gx, gz, side, level) {
  if (side === 1) return `V:${gx + 1}:${gz}:${level}`;
  if (side === 3) return `V:${gx}:${gz}:${level}`;
  if (side === 0) return `H:${gx}:${gz}:${level}`;
  return `H:${gx}:${gz + 1}:${level}`;
}

/** Cellerna på ömse sidor om en kant */
export function edgeCells(gx, gz, side) {
  const d = SIDES[side];
  return [
    { gx, gz },
    { gx: gx + d.dx, gz: gz + d.dz },
  ];
}

export function cellKey(gx, gz, level) {
  return `${gx}:${gz}:${level}`;
}

export function pieceKey(p) {
  switch (p.kind) {
    case 'foundation':
    case 'ceiling':
      return `F:${cellKey(p.gx, p.gz, p.level)}`;
    case 'wall':
    case 'doorway':
    case 'door': {
      const ek = p.ek || edgeKey(p.gx, p.gz, p.side, p.level);
      return `${p.kind[0]}:${ek}`;
    }
    default:
      return `P:${p.id}`;
  }
}

export function isFloor(kind) {
  return kind === 'foundation' || kind === 'ceiling';
}

/**
 * Index över placerade byggdelar med snabb uppslagning.
 */
export class BuildingIndex {
  constructor() {
    this.pieces = new Map(); // id -> piece
    this.floors = new Map(); // cellKey -> piece
    this.edges = new Map(); // edgeKey -> piece[] (wall/doorway/door)
    this.props = new Map(); // id -> piece (campfire/storage_box)
    this.levels = new Set(); // vilka våningar som har golv
    this.propsByCell = new Map(); // "gx:gz" -> piece[]
  }

  clear() {
    this.pieces.clear();
    this.floors.clear();
    this.edges.clear();
    this.props.clear();
    this.levels.clear();
    this.propsByCell.clear();
  }

  get size() {
    return this.pieces.size;
  }

  add(p) {
    if (!p.ek && (p.kind === 'wall' || p.kind === 'doorway' || p.kind === 'door')) {
      p.ek = edgeKey(p.gx, p.gz, p.side, p.level);
    }
    this.pieces.set(p.id, p);
    if (isFloor(p.kind)) {
      this.floors.set(cellKey(p.gx, p.gz, p.level), p);
      this.levels.add(p.level);
    } else if (p.kind === 'campfire' || p.kind === 'storage_box' || p.kind === 'lootbag') {
      this.props.set(p.id, p);
      const ck = `${Math.floor(p.x / GRID)}:${Math.floor(p.z / GRID)}`;
      const list = this.propsByCell.get(ck) || [];
      list.push(p);
      this.propsByCell.set(ck, list);
    } else {
      const list = this.edges.get(p.ek) || [];
      list.push(p);
      this.edges.set(p.ek, list);
    }
  }

  remove(id) {
    const p = this.pieces.get(id);
    if (!p) return null;
    this.pieces.delete(id);
    if (isFloor(p.kind)) this.floors.delete(cellKey(p.gx, p.gz, p.level));
    else if (this.props.has(id)) {
      this.props.delete(id);
      const ck = `${Math.floor(p.x / GRID)}:${Math.floor(p.z / GRID)}`;
      const list = this.propsByCell.get(ck);
      if (list) {
        const i = list.findIndex((q) => q.id === id);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.propsByCell.delete(ck);
      }
    } else {
      const list = this.edges.get(p.ek) || [];
      const idx = list.findIndex((q) => q.id === id);
      if (idx >= 0) list.splice(idx, 1);
      if (!list.length) this.edges.delete(p.ek);
    }
    return p;
  }

  floor(gx, gz, level) {
    return this.floors.get(cellKey(gx, gz, level)) || null;
  }

  /** Alla delar på en kant (vägg, dörröppning, dörr) */
  edge(ek) {
    return this.edges.get(ek) || [];
  }

  edgeOf(gx, gz, side, level) {
    return this.edge(edgeKey(gx, gz, side, level));
  }

  hasWallOnEdge(ek) {
    return this.edge(ek).some((p) => p.kind === 'wall' || p.kind === 'doorway');
  }

  hasDoorOnEdge(ek) {
    return this.edge(ek).some((p) => p.kind === 'door');
  }

  doorwayOnEdge(ek) {
    return this.edge(ek).find((p) => p.kind === 'doorway') || null;
  }

  /** Hitta en byggdel nära en punkt (används för interaktion/träffar) */
  propNear(x, z, maxDist = 3) {
    let best = null;
    let bd = maxDist;
    for (const p of this.props.values()) {
      if (p.kind === 'lootbag') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Alla byggdelar inom en radie (för kollision och interaktion) */
  near(x, z, radius = 2.5) {
    const out = [];
    const g0 = Math.floor((x - radius) / GRID);
    const g1 = Math.floor((x + radius) / GRID);
    const h0 = Math.floor((z - radius) / GRID);
    const h1 = Math.floor((z + radius) / GRID);
    for (let gx = g0; gx <= g1; gx++) {
      for (let gz = h0; gz <= h1; gz++) {
        for (const level of this.levels) {
          const f = this.floors.get(cellKey(gx, gz, level));
          if (f) out.push(f);
        }
        for (let side = 0; side < 4; side++) {
          const ek = edgeKey(gx, gz, side, 0);
          for (const p of this.edge(ek)) out.push(p);
        }
        const props = this.propsByCell.get(`${gx}:${gz}`);
        if (props) out.push(...props);
      }
    }
    // kanter på högre våningar (en våning över marken räcker för kollision nära spelaren)
    for (const level of this.levels) {
      if (level === 0) continue;
      for (let gx = g0; gx <= g1; gx++) {
        for (let gz = h0; gz <= h1; gz++) {
          for (let side = 0; side < 4; side++) {
            for (const p of this.edge(edgeKey(gx, gz, side, level))) out.push(p);
          }
        }
      }
    }
    // ta bort dubbletter
    const seen = new Set();
    return out.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  }
}

/**
 * Geometri för en byggdel: en eller flera boxar (lokala mått i meter).
 * Returnerar { pos:[x,y,z], boxes:[{pos:[dx,dy,dz], size:[w,h,d], rotY, hp}], rotY }
 * där pos är delens ankarpunkt och boxarnas positioner är relativa ankarpunkten.
 */
export function pieceGeometry(p) {
  const c = cellCenter(p.gx, p.gz);
  switch (p.kind) {
    case 'foundation':
    case 'ceiling':
      return {
        pos: [c.x, p.y, c.z],
        rotY: 0,
        boxes: [{ pos: [0, -0.15, 0], size: [GRID, 0.3, GRID] }],
      };
    case 'wall':
      return {
        pos: wallAnchor(p),
        rotY: wallRot(p.side),
        boxes: [{ pos: [0, LEVEL_H / 2, 0], size: [GRID, LEVEL_H, 0.3] }],
      };
    case 'doorway':
      return {
        pos: wallAnchor(p),
        rotY: wallRot(p.side),
        boxes: [
          { pos: [-0.9, LEVEL_H / 2, 0], size: [1.2, LEVEL_H, 0.3] },
          { pos: [0.9, LEVEL_H / 2, 0], size: [1.2, LEVEL_H, 0.3] },
          { pos: [0, LEVEL_H - 0.4, 0], size: [0.6, 0.8, 0.3] },
        ],
      };
    case 'door':
      return {
        pos: wallAnchor(p),
        rotY: wallRot(p.side),
        boxes: [{ pos: [0, LEVEL_H / 2 - 0.35, 0], size: [0.62, 2.2, 0.12], door: true }],
      };
    case 'campfire':
      return { pos: [p.x, p.y, p.z], rotY: p.rot || 0, boxes: [{ pos: [0, 0.18, 0], size: [1.3, 0.36, 1.3] }] };
    case 'storage_box':
      return {
        pos: [p.x, p.y, p.z],
        rotY: p.rot || 0,
        boxes: [{ pos: [0, 0.45, 0], size: [1.3, 0.9, 0.85] }],
      };
    default:
      return { pos: [p.x || 0, p.y || 0, p.z || 0], rotY: p.rot || 0, boxes: [{ pos: [0, 0.5, 0], size: [1, 1, 1] }] };
  }
}

function wallAnchor(p) {
  const ek = p.ek || edgeKey(p.gx, p.gz, p.side, p.level);
  const [type, a, b] = ek.split(':');
  const X = +a;
  const Z = +b;
  if (type === 'V') return [X * GRID, p.y, Z * GRID + GRID / 2];
  return [X * GRID + GRID / 2, p.y, Z * GRID];
}

function wallRot(side) {
  return side === 1 || side === 3 ? Math.PI / 2 : 0;
}

/** Byggdelens ankarpunkt i världen (för avståndskontroller och interaktion) */
export function piecePos(p) {
  if (p.kind === 'campfire' || p.kind === 'storage_box' || p.kind === 'lootbag') {
    return { x: p.x, y: p.y, z: p.z };
  }
  if (isFloor(p.kind)) {
    const c = cellCenter(p.gx, p.gz);
    return { x: c.x, y: p.y, z: c.z };
  }
  const a = wallAnchor(p);
  return { x: a[0], y: a[1], z: a[2] };
}

/** Världs-AABB (axel-låda) för kollision: returnerar {min:[x,y,z], max:[x,y,z]} */
export function pieceAABB(p) {
  const geo = pieceGeometry(p);
  // enkel rotation runt Y -> ta bounding box av alla hörn
  const cos = Math.cos(geo.rotY);
  const sin = Math.sin(geo.rotY);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const b of geo.boxes) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = b.pos[0] + (sx * b.size[0]) / 2;
          const ly = b.pos[1] + (sy * b.size[1]) / 2;
          const lz = b.pos[2] + (sz * b.size[2]) / 2;
          const wx = geo.pos[0] + lx * cos + lz * sin;
          const wz = geo.pos[2] - lx * sin + lz * cos;
          const wy = geo.pos[1] + ly;
          min = [Math.min(min[0], wx), Math.min(min[1], wy), Math.min(min[2], wz)];
          max = [Math.max(max[0], wx), Math.max(max[1], wy), Math.max(max[2], wz)];
        }
      }
    }
  }
  return { min, max };
}

/**
 * Regler för placering. Returnerar { ok, reason, y }.
 * `world` behöver heightAt(x,z) och slopeAt(x,z).
 */
export function canPlace(piece, index, world) {
  const pk = pieceKey(piece);
  if (index.pieces.has(piece.id)) return { ok: false, reason: 'Finns redan' };

  if (isFloor(piece.kind)) {
    const c = cellCenter(piece.gx, piece.gz);
    if (index.floor(piece.gx, piece.gz, piece.level)) return { ok: false, reason: 'Upptaget' };
    if (piece.level === 0) {
      const h = world.heightAt(c.x, c.z);
      if (h < 0.35) return { ok: false, reason: 'För nära vatten' };
      if (world.slopeAt(c.x, c.z) > 0.62) return { ok: false, reason: 'För brant mark' };
      // marken måste vara någorlunda jämn över cellen
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const cx = c.x + (i % 2 ? 1.2 : -1.2);
        const cz = c.z + (i > 1 ? 1.2 : -1.2);
        const hh = world.heightAt(cx, cz);
        lo = Math.min(lo, hh);
        hi = Math.max(hi, hh);
      }
      if (hi - lo > 2.2) return { ok: false, reason: 'Ojämn mark' };
      return { ok: true, y: Math.max(h, lo + 0.35) };
    }
    const below = index.floor(piece.gx, piece.gz, piece.level - 1);
    if (!below) return { ok: false, reason: 'Behöver stöd under' };
    return { ok: true, y: below.y + LEVEL_H };
  }

  if (piece.kind === 'wall' || piece.kind === 'doorway' || piece.kind === 'door') {
    const ek = edgeKey(piece.gx, piece.gz, piece.side, piece.level);
    const cells = edgeCells(piece.gx, piece.gz, piece.side);
    const floorA = index.floor(cells[0].gx, cells[0].gz, piece.level);
    const floorB = index.floor(cells[1].gx, cells[1].gz, piece.level);
    const floor = floorA || floorB;
    if (!floor) return { ok: false, reason: 'Behöver golv' };
    if (piece.kind === 'door') {
      if (!index.doorwayOnEdge(ek)) return { ok: false, reason: 'Kräver dörröppning' };
      if (index.hasDoorOnEdge(ek)) return { ok: false, reason: 'Dörr finns redan' };
    } else if (index.hasWallOnEdge(ek)) {
      return { ok: false, reason: 'Vägg finns redan' };
    } else if (index.hasDoorOnEdge(ek)) {
      return { ok: false, reason: 'Dörr blockerar' };
    }
    // golvet kan vara olika högt på ömse sidor – kräv samma nivå
    if (floorA && floorB && Math.abs(floorA.y - floorB.y) > 0.01) {
      return { ok: false, reason: 'Ojämna golv' };
    }
    // får inte krocka med en annan del på samma kant
    for (const other of index.edge(ek)) {
      if (other.id !== piece.id && other.kind === piece.kind) return { ok: false, reason: 'Upptaget' };
    }
    return { ok: true, y: floor.y };
  }

  // campfire / storage_box / lootbag – fri placering på mark eller golv
  const x = piece.x;
  const z = piece.z;
  const terrain = world.heightAt(x, z);
  const cell = cellOf(x, z);
  const floor = index.floor(cell.gx, cell.gz, piece.level ?? 0);
  if (floor) {
    const top = floor.y;
    if (terrain > top + 0.6) return { ok: false, reason: 'Hinder i marken' };
    return { ok: true, y: top };
  }
  if (terrain < 0.3) return { ok: false, reason: 'För nära vatten' };
  if (world.slopeAt(x, z) > 0.5) return { ok: false, reason: 'För brant mark' };
  for (const other of index.props.values()) {
    if (other.kind === 'lootbag') continue;
    if (Math.hypot(other.x - x, other.z - z) < 1.3) return { ok: false, reason: 'För nära annan byggdel' };
  }
  return { ok: true, y: terrain };
}

/**
 * Föreslå en placering utifrån var spelaren tittar.
 * hit: { point:[x,y,z], piece } där piece är träffad byggdel (eller null för mark).
 */
export function suggestPlacement({ kind, hit, playerPos, index, world }) {
  const base = { kind, level: 0, side: 0, y: 0 };
  const px = playerPos[0];
  const pz = playerPos[2];

  if (kind === 'campfire' || kind === 'storage_box') {
    const p = hit?.point || [px, 0, pz];
    const snapped = { ...base, x: p[0], z: p[2], level: 0 };
    const c = cellOf(p[0], p[2]);
    const floor = index.floor(c.gx, c.gz, 0);
    snapped.level = floor ? 0 : 0;
    return snapped;
  }

  let cell = null;
  let level = 0;

  const hp = hit?.piece;
  if (hp) {
    if (isFloor(hp.kind)) {
      cell = { gx: hp.gx, gz: hp.gz };
      level = hp.level;
    } else {
      cell = { gx: hp.gx, gz: hp.gz };
      level = hp.level;
    }
  } else if (hit?.point) {
    cell = cellOf(hit.point[0], hit.point[2]);
    level = 0;
  } else {
    // faller tillbaka på marken framför spelaren
    const dirX = hit?.dir?.[0] ?? 0;
    const dirZ = hit?.dir?.[2] ?? 0;
    cell = cellOf(px + dirX * 3, pz + dirZ * 3);
  }

  if (!cell) cell = cellOf(px, pz);

  if (isFloor(kind)) {
    if (kind === 'foundation') {
      // alltid marknivå – men om cellen redan har ett golv läggs nästa våning
      const below = index.floor(cell.gx, cell.gz, 0);
      return { ...base, gx: cell.gx, gz: cell.gz, level: below ? 1 : 0 };
    }
    // tak: hamnar alltid en våning över en befintlig grund
    let lvl;
    if (hp) lvl = hp.level + 1;
    else {
      let l = 0;
      while (index.floor(cell.gx, cell.gz, l)) l++;
      lvl = Math.max(1, l);
    }
    return { ...base, gx: cell.gx, gz: cell.gz, level: lvl };
  }

  // vägg/dörr: välj den kant av cellen som spelaren står närmast
  const c = cellCenter(cell.gx, cell.gz);
  const dx = px - c.x;
  const dz = pz - c.z;
  let side;
  if (Math.abs(dx) > Math.abs(dz)) side = dx > 0 ? 1 : 3;
  else side = dz > 0 ? 2 : 0;

  if (hp && (hp.kind === 'wall' || hp.kind === 'doorway' || hp.kind === 'door')) {
    side = hp.side;
    level = hp.level;
  }
  return { ...base, gx: cell.gx, gz: cell.gz, level, side, ek: edgeKey(cell.gx, cell.gz, side, level) };
}
