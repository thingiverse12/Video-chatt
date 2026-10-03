/**
 * Interaktion: slå/samla, bygga med snäppning, dörrar, lådor och lootpåsar.
 * Servern avgör alltid vad som faktiskt händer – klienten skickar avsikter.
 */

import * as THREE from 'three';
import { canPlace, suggestPlacement, piecePos, PIECES, GRID } from '../../shared/building.js';
import { EQUIP } from '../../shared/items.js';

export class Interactions {
  constructor({ net, renderer, world, player, index, hud, getEquipped, onPlacePreview }) {
    this.net = net;
    this.renderer = renderer;
    this.world = world;
    this.player = player;
    this.index = index;
    this.hud = hud;
    this.getEquipped = getEquipped;
    this.onPlacePreview = onPlacePreview;
    this.candidate = null;
    this.candidateOk = false;
    this.lastHit = 0;
    this.drawStart = 0;
    this.drawing = false;
    this.targetPiece = null;
    this.targetBag = null;
  }

  // -------------------------------------------------------------- strålfärd

  rayAll() {
    // säkerställ att nya byggdelar har uppdaterade matriser innan strålen kastas
    this.renderer.scene?.updateMatrixWorld();
    const ray = this.player.getRay();
    const pieces = this.renderer.raycastPieces(ray);
    const nodes = this.renderer.raycastNodes(ray);
    const terrain = this.rayTerrain(ray);
    const best = {
      piece: pieces[0] || null,
      node: nodes[0] || null,
      terrain,
    };
    const entries = [];
    if (best.piece) entries.push({ d: best.piece.distance, kind: 'piece', data: best.piece });
    if (best.node) entries.push({ d: best.node.distance, kind: 'node', data: best.node });
    if (terrain) entries.push({ d: terrain.distance, kind: 'terrain', data: terrain });
    entries.sort((a, b) => a.d - b.d);
    return { ray, best, closest: entries[0] || null };
  }

  /** Marscherar längs strålen tills den går under terrängen */
  rayTerrain(ray, maxDist = 70) {
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    let prevT = 0.4;
    let prevAbove = true;
    for (let t = 0.4; t < maxDist; t += 0.6) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const h = this.world.heightAt(x, z);
      const above = y > h;
      if (!above && prevAbove) {
        // binärsök mellan prevT och t
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + d.x * mid;
          const my = o.y + d.y * mid;
          const mz = o.z + d.z * mid;
          if (my > this.world.heightAt(mx, mz)) lo = mid;
          else hi = mid;
        }
        const ft = (lo + hi) / 2;
        const point = new THREE.Vector3(o.x + d.x * ft, o.y + d.y * ft, o.z + d.z * ft);
        return { distance: ft, point };
      }
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  // ------------------------------------------------------------- byggläge

  setKind(kind) {
    this.kind = kind;
    if (!kind) this.renderer.hidePreview();
  }

  updateBuild() {
    if (!this.kind) {
      this.renderer.hidePreview();
      this.candidate = null;
      return;
    }
    const { best } = this.rayAll();
    const hit = best.piece
      ? { point: best.piece.point.toArray(), piece: best.piece.piece, dir: [0, 0, 0] }
      : best.node
        ? { point: best.node.point.toArray(), piece: null, dir: [0, 0, 0] }
        : { point: (best.terrain?.point || new THREE.Vector3(this.player.body.x, this.player.body.y, this.player.body.z)).toArray(), piece: null, dir: [0, 0, 0] };

    const cand = suggestPlacement({
      kind: this.kind,
      hit,
      playerPos: [this.player.body.x, this.player.body.y, this.player.body.z],
      index: this.index,
      world: this.world,
    });
    const verdict = canPlace(cand, this.index, this.world);
    if (verdict.ok) cand.y = verdict.y;
    this.candidate = cand;
    this.candidateOk = verdict.ok;
    this.candidateReason = verdict.reason || '';
    // avståndskontroll
    const pos = piecePos(cand);
    const tooFar = Math.hypot(pos.x - this.player.body.x, pos.z - this.player.body.z) > 6.5;
    if (tooFar) {
      this.candidateOk = false;
      this.candidateReason = 'För långt bort';
    }
    this.renderer.showPreview(cand, this.candidateOk);
    this.onPlacePreview?.(cand, this.candidateOk, this.candidateReason);
  }

  place() {
    if (!this.kind || !this.candidate) return false;
    if (!this.candidateOk) {
      this.hud.toast(this.candidateReason || 'Går inte att bygga här', 'bad');
      return false;
    }
    const p = this.candidate;
    const msg = { kind: p.kind, gx: p.gx, gz: p.gz, level: p.level, side: p.side };
    if (p.x !== undefined) {
      msg.x = p.x;
      msg.z = p.z;
      msg.rot = this.player.body.yaw;
    }
    this.net.send({ t: 'place', piece: msg });
    return true;
  }

  // ------------------------------------------------------------------ strid

  /** Upprepa slag med rätt cooldown medan musen hålls nere */
  updateAttack() {
    if (!this.player.mouseDown || this.kind) return;
    const eq = EQUIP[this.getEquipped()] || EQUIP.hand;
    const now = performance.now() / 1000;
    if (eq.type === 'ranged') return; // pilbågen laddas och släpps
    if (now - this.lastHit < eq.cooldown) return;
    this.lastHit = now;
    this.swing();
    const dir = this.player.getDir().toArray();
    this.net.send({ t: 'hit', dir });
  }

  swing() {
    this.renderer.playSwing?.();
  }

  startDraw() {
    const eq = EQUIP[this.getEquipped()] || EQUIP.hand;
    if (eq.type !== 'ranged') return false;
    this.drawing = true;
    this.drawStart = performance.now() / 1000;
    return true;
  }

  releaseDraw() {
    if (!this.drawing) return false;
    const eq = EQUIP[this.getEquipped()] || EQUIP.hand;
    const draw = Math.min(1, (performance.now() / 1000 - this.drawStart) / (eq.draw || 0.75));
    this.drawing = false;
    this.swing();
    this.net.send({ t: 'hit', dir: this.player.getDir().toArray(), draw });
    return true;
  }

  // -------------------------------------------------------------- interaktion

  /** Returnerar en beskrivning av vad spelaren tittar på (för HUD-hinten) */
  look() {
    const { closest, best } = this.rayAll();
    this.targetPiece = null;
    this.targetBag = null;
    if (!closest) return null;
    const maxDist = 4.5;
    if (closest.kind === 'piece' && closest.d < maxDist + 0.8) {
      const piece = closest.data.piece;
      this.targetPiece = piece;
      if (piece.kind === 'storage_box') return { text: '[E] Öppna förvaringslåda', e: true, piece };
      if (piece.kind === 'door') return { text: '[E] Öppna/stäng dörr', e: true, piece };
      if (piece.kind === 'campfire') return { text: 'Lägereld – du blir varm här', e: false, piece };
      if (piece.kind === 'lootbag') return { text: '[E] Plundra påse', e: true, piece };
      return null;
    }
    if (closest.kind === 'piece' && closest.data.piece.kind === 'lootbag') {
      this.targetBag = closest.data.piece;
      return { text: '[E] Plundra påse', e: true, piece: closest.data.piece };
    }
    if (best.piece && best.piece.piece.kind === 'lootbag') {
      this.targetBag = best.piece.piece;
      return { text: '[E] Plundra påse', e: true, piece: best.piece.piece };
    }
    return null;
  }

  interact() {
    const info = this.look();
    const piece = this.targetPiece || this.targetBag;
    if (!piece) return false;
    if (piece.kind === 'storage_box') {
      this.net.send({ t: 'open', id: piece.id });
      return true;
    }
    if (piece.kind === 'door') {
      this.net.send({ t: 'door', id: piece.id });
      return true;
    }
    if (piece.kind === 'lootbag') {
      this.net.send({ t: 'open', id: piece.id });
      return true;
    }
    return false;
  }

  /** R – riv den byggdel man tittar på (nära nog) */
  demolish() {
    const { closest } = this.rayAll();
    if (!closest || closest.kind !== 'piece') {
      this.hud.toast('Titta på en byggdel för att riva den', 'bad');
      return false;
    }
    const piece = closest.data.piece;
    if (piece.kind === 'lootbag') return false;
    this.net.send({ t: 'demolish', id: piece.id });
    return true;
  }
}
