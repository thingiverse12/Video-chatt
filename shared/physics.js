// Deterministisk spelarfysik. Körs på SERVERN (auktoritativt) och på
// KLIENTEN (förutsägelse) med exakt samma kod -> inga gummibandseffekter.

import { P, GRAVITY, HALF, WATER_LEVEL } from './const.js';
import { heightAt } from './terrain.js';
import { blockBoxes } from './building.js';
import { clamp } from './math.js';

export function wishVector(input, yaw) {
  let f = (input.f ? 1 : 0) - (input.b ? 1 : 0);
  let r = (input.r ? 1 : 0) - (input.l ? 1 : 0);
  if (f || r) { const l = Math.hypot(f, r); f /= l; r /= l; }
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: -s * f + c * r, z: -c * f - s * r };
}

/** Knuffa ut spelaren ur trädstammar och klippor (XZ-cylindrar). */
export function resolveColliders(st, q) {
  if (!q || !q.colliders) return;
  const list = q.colliders.near(st.x, st.z, 2.5);
  if (!list.length) return;
  for (const c of list) {
    if (st.y > c.top || st.y + P.height < c.minY) continue;
    const dx = st.x - c.x, dz = st.z - c.z;
    const d = Math.hypot(dx, dz);
    const minD = c.r + P.radius;
    if (d >= minD) continue;
    if (d < 1e-4) { st.x += minD; continue; }
    const push = (minD - d) + 0.001;
    st.x += (dx / d) * push;
    st.z += (dz / d) * push;
  }
}

export function makeQuery(hm, index, colliders) {
  return {
    hm,
    index,
    water: WATER_LEVEL,
    terrain: (x, z) => heightAt(hm, x, z),
    blocksNear: (x, z, r) => (index ? index.near(x, z, r) : []),
    colliders: colliders || null,
  };
}

function boxOf(st, dy = 0) {
  return {
    min: { x: st.x - P.radius, y: st.y + dy + 0.001, z: st.z - P.radius },
    max: { x: st.x + P.radius, y: st.y + dy + P.height, z: st.z + P.radius },
  };
}

function overlaps(a, b) {
  return a.max.x > b.min.x && a.min.x < b.max.x &&
         a.max.y > b.min.y && a.min.y < b.max.y &&
         a.max.z > b.min.z && a.min.z < b.max.z;
}

function solidBoxes(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'door' && b.open) continue;
    if (b.type === 'campfire') continue;
    for (const bb of blockBoxes(b)) out.push(bb);
  }
  return out;
}

function resolveBlocks(st, boxes) {
  for (let iter = 0; iter < 4; iter++) {
    let hit = false;
    for (const bb of boxes) {
      const a = boxOf(st);
      if (!overlaps(a, bb)) continue;
      hit = true;
      const px = Math.min(a.max.x - bb.min.x, bb.max.x - a.min.x);
      const py = Math.min(a.max.y - bb.min.y, bb.max.y - a.min.y);
      const pz = Math.min(a.max.z - bb.min.z, bb.max.z - a.min.z);
      const up = bb.max.y - st.y;
      // kliv upp på låga block (golv, tak, lådor)
      if (up > 0 && up <= P.step && st.vy > -13) {
        let blocked = false;
        const nb = boxOf(st, up + 0.02);
        for (const o of boxes) if (o !== bb && overlaps(nb, o)) { blocked = true; break; }
        if (!blocked) { st.y = bb.max.y + 0.002; st.vy = 0; st.onGround = true; continue; }
      }
      if (py <= px && py <= pz) {
        if (st.y + P.height * 0.5 < bb.min.y) { st.y = bb.min.y - P.height - 0.002; if (st.vy > 0) st.vy = 0; }
        else { st.y = bb.max.y; if (st.vy < 0) st.vy = 0; st.onGround = true; }
      } else if (px <= pz) {
        st.x += (a.min.x + a.max.x) / 2 < (bb.min.x + bb.max.x) / 2 ? -px - 0.002 : px + 0.002;
      } else {
        st.z += (a.min.z + a.max.z) / 2 < (bb.min.z + bb.max.z) / 2 ? -pz - 0.002 : pz + 0.002;
      }
    }
    if (!hit) break;
  }
}

/**
 * @param st    {x,y,z,vx,vy,vz,yaw,onGround,inWater,moving,sprinting}
 * @param input {f,b,l,r,jump,sprint}
 * @param q     makeQuery(hm, index)
 * @param mods  {speedMul}
 */
export function simulatePlayer(st, input, dt, q, mods = {}) {
  dt = Math.min(dt, 0.08);
  const w = wishVector(input, st.yaw);
  const terr = q.terrain(st.x, st.z);
  const deep = terr < q.water - 0.35;
  st.inWater = deep && st.y < q.water - 0.25;
  st.wading = !st.inWater && terr < q.water + 0.15 && st.y < q.water + 0.1;

  let speed;
  if (st.inWater) speed = P.swim * (input.sprint ? 1.3 : 1);
  else speed = (input.sprint && input.f ? P.sprint : P.walk) * (st.wading ? 0.78 : 1);
  speed *= mods.speedMul === undefined ? 1 : mods.speedMul;

  const k = Math.min(1, (st.onGround || st.inWater ? 16 : 5) * dt);
  st.vx += (w.x * speed - st.vx) * k;
  st.vz += (w.z * speed - st.vz) * k;
  st.moving = Math.hypot(st.vx, st.vz) > 0.25;
  st.sprinting = !!input.sprint && input.f && st.moving && !st.inWater;

  const wasGround = st.onGround;
  st.onGround = false;

  if (st.inWater) {
    st.vy += ((input.jump ? 15 : -4.5) - st.vy) * Math.min(1, 7 * dt);
    if (st.y > q.water - 0.45) st.vy = Math.min(st.vy, 0.9);
    st.vy = clamp(st.vy, -3.0, 3.2);
  } else {
    st.vy -= GRAVITY * dt;
    if (input.jump && wasGround) { st.vy = P.jump; }
    st.vy = Math.max(st.vy, -48);
  }

  st.x += st.vx * dt;
  st.y += st.vy * dt;
  st.z += st.vz * dt;

  const boxes = solidBoxes(q.blocksNear(st.x, st.z, 5));
  resolveBlocks(st, boxes);

  const th = q.terrain(st.x, st.z);
  if (st.y <= th) { st.y = th; if (st.vy < 0) st.vy = 0; st.onGround = true; }

  resolveColliders(st, q);          // träd och klippor blockerar
  const th2 = q.terrain(st.x, st.z);
  if (st.y <= th2) { st.y = th2; if (st.vy < 0) st.vy = 0; st.onGround = true; }

  st.x = clamp(st.x, -HALF + 3, HALF - 3);
  st.z = clamp(st.z, -HALF + 3, HALF - 3);
  if (st.y < -30) { st.y = th; st.vy = 0; }
  st.fallSpeed = st.vy;
  return st;
}

/** Fallskada (servern räknar ut denna när spelaren landar). */
export function fallDamage(peakFallSpeed) {
  if (peakFallSpeed > -13) return 0;
  return Math.round((-peakFallSpeed - 13) * 4.5);
}
