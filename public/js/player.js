/**
 * Lokal spelare: inmatning, klientförutsägelse med samma fysik som servern och
 * avstämning mot serverns snapshots.
 */

import * as THREE from 'three';
import { PLAYER, createBody, stepBody } from '../../shared/movement.js';

export class LocalPlayer {
  constructor(world, config) {
    this.world = world;
    this.body = createBody(0, 50, 0, 0);
    this.keys = new Set();
    this.mouseDown = false;
    this.seq = 0;
    this.pending = []; // {seq, input} för avstämning
    this.lastAck = 0;
    this.correction = new THREE.Vector3();
    this.correctionTimer = 0;
    this.bobPhase = 0;
    this.inventoryOpen = false;
    this.sensitivity = 0.0022;
    this.errors = 0;
    this.alive = true;
    this.buildMode = null;

    const aabbCache = new Map();
    this.ctx = {
      bounds: world.half - 2,
      waterLevel: world.waterLevel,
      terrainHeight: (x, z) => world.heightAt(x, z),
      colliders: (x, z, r) => (this.colliderSource ? this.colliderSource(x, z, r) : []),
      aabb: (piece) => {
        let bb = aabbCache.get(piece.id);
        if (!bb) {
          bb = this.aabbFn(piece);
          aabbCache.set(piece.id, bb);
        }
        return bb;
      },
      onFall: null,
    };
    this.aabbFn = () => null;
    this.colliderSource = null;
  }

  setColliderSource(fn) {
    this.colliderSource = fn;
    this.ctx.colliders = (x, z, r) => fn(x, z, r);
  }

  setAabbFn(fn) {
    this.aabbFn = fn;
    this.ctx.aabb = (piece) => {
      let bb = this._aabbCache2?.get(piece.id);
      if (!bb) {
        bb = fn(piece);
        if (!this._aabbCache2) this._aabbCache2 = new Map();
        this._aabbCache2.set(piece.id, bb);
      }
      return bb;
    };
  }

  resetAabbCache() {
    this._aabbCache2?.clear();
  }

  get eye() {
    return { x: this.body.x, y: this.body.y + PLAYER.eye, z: this.body.z };
  }

  /** Rotera kameran. Anroparen avgör om vi har muslås eller drag-läge. */
  applyLook(dx, dy) {
    if (this.inventoryOpen || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.body.yaw -= dx * this.sensitivity;
    this.body.pitch -= dy * this.sensitivity;
    const max = Math.PI / 2 - 0.02;
    this.body.pitch = Math.max(-max, Math.min(max, this.body.pitch));
  }

  readInput() {
    const k = this.keys;
    let f = 0;
    let r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    return {
      f,
      r,
      j: k.has('Space'),
      s: k.has('ShiftLeft') || k.has('ShiftRight'),
      c: k.has('ControlLeft') || k.has('KeyC'),
    };
  }

  /** Förutsäg ett steg och returnera meddelandet som ska skickas till servern */
  predict(dt) {
    if (!this.alive) {
      this.body.vx = this.body.vy = this.body.vz = 0;
      return null;
    }
    const input = this.readInput();
    this.ctx.aabb = this.ctx.aabb;
    stepBody(this.body, input, dt, this.ctx);
    const wasMoving = this.body.moving;
    // huvudstuds när man går
    if (wasMoving && this.body.grounded) {
      this.bobPhase += dt * (this.body.sprinting ? 13 : 9);
    } else {
      this.bobPhase *= 0.9;
    }
    this.body.bob = Math.sin(this.bobPhase) * (this.body.sprinting ? 0.055 : 0.035);
    this.seq++;
    const msg = {
      t: 'input',
      seq: this.seq,
      dt: Math.round(dt * 1000) / 1000,
      f: input.f,
      r: input.r,
      j: input.j,
      s: input.s,
      c: input.c,
      yaw: Math.round(this.body.yaw * 1000) / 1000,
      pitch: Math.round(this.body.pitch * 1000) / 1000,
    };
    this.pending.push({ seq: this.seq, msg });
    if (this.pending.length > 120) this.pending.shift();
    return msg;
  }

  /** Liten korrigering när servern säger något annat */
  reconcile(serverPos, serverYaw, ackSeq) {
    if (!serverPos) return;
    const dx = serverPos[0] - this.body.x;
    const dy = serverPos[1] - this.body.y;
    const dz = serverPos[2] - this.body.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 4) {
      this.body.x = serverPos[0];
      this.body.y = serverPos[1];
      this.body.z = serverPos[2];
      if (typeof serverYaw === 'number') this.body.yaw = serverYaw;
      this.errors++;
      return;
    }
    if (dist > 0.06) {
      const k = dist > 1.2 ? 0.5 : 0.18;
      this.body.x += dx * k;
      this.body.y += dy * k;
      this.body.z += dz * k;
    }
    if (typeof serverYaw === 'number') {
      let dyaw = serverYaw - this.body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(dyaw) > 0.35) this.body.yaw = serverYaw;
    }
    if (ackSeq) this.pending = this.pending.filter((p) => p.seq > ackSeq);
  }

  /** Stråle från kameran (används för träffar och bygge) */
  getRay() {
    return new THREE.Raycaster(
      new THREE.Vector3(this.body.x, this.body.y + PLAYER.eye, this.body.z),
      new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.body.pitch, this.body.yaw, 0, 'YXZ')).normalize()
    );
  }

  getDir() {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.body.pitch, this.body.yaw, 0, 'YXZ')).normalize();
  }
}
