/**
 * Delad rörelse- och kollisionsmodell.
 * Klienten förutsäger rörelse med exakt samma kod som servern kör, vilket gör
 * att avstämningen (reconciliation) blir nästan osynlig.
 */

import { GRID } from './building.js';

export const PLAYER = {
  radius: 0.36,
  height: 1.8,
  eye: 1.62,
  walk: 4.6,
  sprint: 7.0,
  crouch: 2.2,
  accelGround: 14,
  accelAir: 3.5,
  frictionGround: 10,
  frictionAir: 0.4,
  jump: 6.1,
  gravity: -22,
  maxFall: -55,
  stepUp: 0.75,
  swimSpeed: 2.6,
  swimUp: 3.0,
  waterDrag: 3.2,
};

export function createBody(x = 0, y = 0, z = 0, yaw = 0) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    grounded: false,
    inWater: false,
    sprinting: false,
    crouching: false,
    moving: false,
  };
}

export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Terränghöjd + eventuella golv (foundation/tak) under spelaren */
export function groundHeight(b, x, z, ctx) {
  const r = PLAYER.radius;
  let g = ctx.terrainHeight(x, z);
  const list = ctx.colliders(x, z, r + 1.7);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.kind !== 'foundation' && p.kind !== 'ceiling') continue;
    const cx = p.gx * GRID;
    const cz = p.gz * GRID;
    if (x < cx - r || x > cx + GRID + r || z < cz - r || z > cz + GRID + r) continue;
    const top = p.y;
    if (top <= b.y + PLAYER.stepUp && top > g) g = top;
  }
  return g;
}

function solidFilter(p) {
  // förenkling i MVP: dörrar, lägereldar och lootpåsar går att gå igenom
  if (p.kind === 'door' || p.kind === 'campfire' || p.kind === 'lootbag') return false;
  return true;
}

/** Kliv över låga hinder: hörn av AABB i världen */
function resolveHorizontal(b, dt, ctx) {
  let dx = b.vx * dt;
  let dz = b.vz * dt;
  const dist = Math.hypot(dx, dz);
  const sub = dist > 0.12 ? Math.min(6, Math.ceil(dist / 0.12)) : 1;
  const sx = dx / sub;
  const sz = dz / sub;
  const r = PLAYER.radius;
  const feet = b.y;
  const head = b.y + PLAYER.height;

  for (let s = 0; s < sub; s++) {
    // X-led
    if (sx !== 0) {
      let nx = b.x + sx;
      const list = ctx.colliders(nx, b.z, r + 0.6);
      let blocked = false;
      for (const p of list) {
        if (!solidFilter(p)) continue;
        const bb = ctx.aabb(p);
        if (!bb) continue;
        if (bb.max[1] <= feet + PLAYER.stepUp) continue;
        if (bb.min[1] >= head) continue;
        if (nx + r > bb.min[0] && nx - r < bb.max[0] && b.z + r > bb.min[2] && b.z - r < bb.max[2]) {
          if (sx > 0) nx = bb.min[0] - r;
          else nx = bb.max[0] + r;
          blocked = true;
          b.vx = 0;
          break;
        }
      }
      if (blocked) {
        const list2 = ctx.colliders(nx, b.z, r + 0.6);
        for (const p of list2) {
          if (!solidFilter(p)) continue;
          const bb = ctx.aabb(p);
          if (!bb) continue;
          if (bb.max[1] <= feet + PLAYER.stepUp || bb.min[1] >= head) continue;
          if (nx + r > bb.min[0] && nx - r < bb.max[0] && b.z + r > bb.min[2] && b.z - r < bb.max[2]) {
            nx = sx > 0 ? bb.min[0] - r : bb.max[0] + r;
          }
        }
      }
      b.x = nx;
    }
    // Z-led
    if (sz !== 0) {
      let nz = b.z + sz;
      const list = ctx.colliders(b.x, nz, r + 0.6);
      let blocked = false;
      for (const p of list) {
        if (!solidFilter(p)) continue;
        const bb = ctx.aabb(p);
        if (!bb) continue;
        if (bb.max[1] <= feet + PLAYER.stepUp) continue;
        if (bb.min[1] >= head) continue;
        if (b.x + r > bb.min[0] && b.x - r < bb.max[0] && nz + r > bb.min[2] && nz - r < bb.max[2]) {
          nz = sz > 0 ? bb.min[2] - r : bb.max[2] + r;
          blocked = true;
          b.vz = 0;
          break;
        }
      }
      if (blocked) {
        const list2 = ctx.colliders(b.x, nz, r + 0.6);
        for (const p of list2) {
          if (!solidFilter(p)) continue;
          const bb = ctx.aabb(p);
          if (!bb) continue;
          if (bb.max[1] <= feet + PLAYER.stepUp || bb.min[1] >= head) continue;
          if (b.x + r > bb.min[0] && b.x - r < bb.max[0] && nz + r > bb.min[2] && nz - r < bb.max[2]) {
            nz = sz > 0 ? bb.min[2] - r : bb.max[2] + r;
          }
        }
      }
      b.z = nz;
    }
  }

  const half = ctx.bounds ? ctx.bounds : 10000;
  b.x = Math.max(-half, Math.min(half, b.x));
  b.z = Math.max(-half, Math.min(half, b.z));
}

/**
 * Ett fysiksteg. input = { f, r, j, s, c } (fram, höger, hoppa, sprint, huka)
 */
export function stepBody(b, input, dt, ctx) {
  dt = Math.max(0.001, Math.min(0.1, dt));
  const grounded = b.grounded;

  // kamera-orientering: yaw 0 tittar mot -Z
  const sy = Math.sin(b.yaw);
  const cy = Math.cos(b.yaw);
  const fx = -sy;
  const fz = -cy;
  const rx = cy;
  const rz = -sy;

  let mx = fx * (input.f || 0) + rx * (input.r || 0);
  let mz = fz * (input.f || 0) + rz * (input.r || 0);
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  b.crouching = !!input.c;
  b.sprinting = !!input.s && !b.crouching && ml > 0.1;

  const terrain = ctx.terrainHeight(b.x, b.z);
  b.inWater = terrain < ctx.waterLevel - 0.25 && b.y < ctx.waterLevel + 0.2;

  let speed = b.crouching ? PLAYER.crouch : b.sprinting ? PLAYER.sprint : PLAYER.walk;
  if (b.inWater) speed = PLAYER.swimSpeed;
  else if (b.moving && (input.f || input.r)) speed *= 1.0;

  const targetVx = mx * speed;
  const targetVz = mz * speed;
  const accel = b.inWater ? 6 : grounded ? PLAYER.accelGround : PLAYER.accelAir;
  const k = Math.min(1, accel * dt);
  b.vx += (targetVx - b.vx) * k;
  b.vz += (targetVz - b.vz) * k;

  if (!grounded && !b.inWater && ml < 0.1) {
    // luftmotstånd
    b.vx *= 1 - Math.min(1, PLAYER.frictionAir * dt);
    b.vz *= 1 - Math.min(1, PLAYER.frictionAir * dt);
  }

  // hopp / simma upp
  if (input.j) {
    if (b.inWater) b.vy = PLAYER.swimUp;
    else if (grounded) {
      b.vy = PLAYER.jump;
      b.grounded = false;
    }
  }

  b.moving = ml > 0.1 && Math.hypot(b.vx, b.vz) > 0.3;
  resolveHorizontal(b, dt, ctx);

  // vertikalt
  const g = groundHeight(b, b.x, b.z, ctx);
  const grav = b.inWater ? PLAYER.gravity * 0.25 : PLAYER.gravity;
  b.vy += grav * dt;
  if (b.inWater) b.vy = Math.max(b.vy, -3.5);
  if (b.vy < PLAYER.maxFall) b.vy = PLAYER.maxFall;
  b.y += b.vy * dt;

  if (b.y <= g) {
    b.y = g;
    // fallhastighet sparas så att spelloopet kan lägga på fallskada
    b.fallImpact = b.vy < -17 ? -b.vy : 0;
    if (b.vy < -17 && ctx.onFall) ctx.onFall(-b.vy);
    b.vy = 0;
    b.grounded = true;
  } else {
    b.grounded = false;
    b.fallImpact = 0;
  }
  return b;
}
