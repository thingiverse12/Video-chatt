// Vy-modell: händer + valt föremål i första person, med gung och sving.

import * as THREE from 'three';
import { buildItemMesh } from './props.js';
import { ITEMS } from '../../shared/items.js';
import { clamp } from '../../shared/math.js';

export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.position.set(0.34, -0.32, -0.62);
    camera.add(this.root);

    this.handMat = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    this.hands = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), this.handMat);
    arm.position.set(0, -0.06, 0.1);
    arm.rotation.x = 0.5;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.12), this.handMat);
    fist.position.set(0, 0.02, -0.06);
    this.hands.add(arm, fist);
    this.root.add(this.hands);

    this.item = new THREE.Group();
    this.root.add(this.item);

    this.light = new THREE.PointLight(0xffd9a0, 0, 6, 2);
    this.light.position.set(0, 0.4, 0);
    this.root.add(this.light);

    this.swing = 0;      // 0..1
    this.bob = 0;
    this.recoil = 0;
    this.itemId = null;
    this.sens = 1;
  }

  setItem(itemId) {
    if (this.itemId === itemId) return;
    this.itemId = itemId;
    while (this.item.children.length) this.item.remove(this.item.children[0]);
    const m = buildItemMesh(itemId, 0.62);
    if (m) {
      const d = ITEMS[itemId] || {};
      if (d.cat === 'tool') { m.rotation.set(-0.9, 0.2, -0.25); m.position.set(0.02, 0.06, -0.05); }
      else if (d.cat === 'weapon') { m.rotation.set(-1.35, 0, 0.1); m.position.set(0, 0.02, -0.06); }
      else if (d.cat === 'ranged') { m.rotation.set(-0.2, 0.4, 0.1); m.position.set(-0.02, 0.02, -0.1); }
      else { m.rotation.set(0, 0.4, 0); m.position.set(0, -0.02, -0.08); }
      this.item.add(m);
    }
    this.item.visible = !!m;
    this.hands.visible = true;
    this.light.intensity = itemId === 'torch' ? 2.2 : 0;
  }

  doSwing(power = 1) { this.swing = 1; this.sens = power; }
  doRecoil() { this.recoil = 1; }

  update(dt, moving, sprinting, yawDelta) {
    this.bob += dt * (moving ? (sprinting ? 13 : 8.5) : 1.6);
    const bobAmp = moving ? (sprinting ? 0.028 : 0.017) : 0.005;
    const bx = Math.sin(this.bob) * bobAmp;
    const by = -Math.abs(Math.cos(this.bob)) * bobAmp * 1.3;

    this.swing = Math.max(0, this.swing - dt * 3.6);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const s = this.swing;
    const sw = Math.sin((1 - s) * Math.PI) * s;

    this.root.position.set(
      0.34 + bx - sw * 0.16 * this.sens,
      -0.32 + by - sw * 0.2 * this.sens + this.recoil * 0.03,
      -0.62 + sw * 0.22 * this.sens + this.recoil * 0.08,
    );
    this.root.rotation.set(
      -sw * 1.25 * this.sens - this.recoil * 0.25,
      sw * 0.45 * this.sens - clamp(yawDelta * 0.02, -0.12, 0.12),
      sw * 0.3 * this.sens,
    );
  }

  setVisible(v) { this.root.visible = v; }
}
