// Delad strålkastning: terräng, block, noder, spelare, projektiler.

import { rayTerrain } from './terrain.js';
import { blockBoxes } from './building.js';
import { nodeSpheres } from './nodes.js';
import { raySphere, rayAABB } from './math.js';

export function aimVector(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function rayBlocks(index, o, d, maxDist) {
  let best = null;
  for (const b of index.near(o.x + d.x * maxDist * 0.5, o.z + d.z * maxDist * 0.5, maxDist * 0.5 + 6)) {
    for (const bb of blockBoxes(b)) {
      const t = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, bb.min, bb.max);
      if (t !== null && t <= maxDist && (!best || t < best.t)) {
        best = { t, block: b, kind: 'block', x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      }
    }
  }
  return best;
}

export function rayNodes(nodes, o, d, maxDist, onlyAlive = true) {
  let best = null;
  for (const n of nodes) {
    if (onlyAlive && !n.alive) continue;
    if (Math.hypot(n.x - o.x, n.z - o.z) > maxDist + 4) continue;
    for (const s of nodeSpheres(n)) {
      const t = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, s.x, s.y, s.z, s.r);
      if (t !== null && t <= maxDist && (!best || t < best.t)) {
        best = { t, node: n, kind: 'node', x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t, part: s.r < 0.7 ? 'trunk' : 'body' };
      }
    }
  }
  return best;
}

export function rayPlayers(players, o, d, maxDist, excludeId) {
  let best = null;
  for (const p of players) {
    if (p.id === excludeId || p.dead) continue;
    if (Math.hypot(p.x - o.x, p.z - o.z) > maxDist + 3) continue;
    const head = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 1.62, p.z, 0.27);
    const body = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 0.95, p.z, 0.46);
    const legs = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 0.35, p.z, 0.34);
    for (const [t, part, mul] of [[head, 'head', 1.7], [body, 'body', 1.0], [legs, 'legs', 0.85]]) {
      if (t !== null && t <= maxDist && (!best || t < best.t)) {
        best = { t, player: p, kind: 'player', part, mul, x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      }
    }
  }
  return best;
}

/**
 * Fullständig stråle mot hela världen. Returnerar närmaste träff.
 * opts: { hm, index, nodes, players, o, d, maxDist, excludeId, hitWater }
 */
export function raycastAll(opts) {
  const { hm, index, nodes, players, o, d, maxDist, excludeId, hitWater = true } = opts;
  const hits = [];
  if (index) { const h = rayBlocks(index, o, d, maxDist); if (h) hits.push(h); }
  if (nodes) { const h = rayNodes(nodes, o, d, maxDist); if (h) hits.push(h); }
  if (players) { const h = rayPlayers(players, o, d, maxDist, excludeId); if (h) hits.push(h); }
  const terr = rayTerrain(hm, o, d, Math.min(maxDist, 160));
  if (terr && (hitWater || !terr.water)) hits.push(terr);
  if (!hits.length) return null;
  hits.sort((a, b) => a.t - b.t);
  return hits[0];
}
