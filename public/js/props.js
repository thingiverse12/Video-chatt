// Allt som ritas i världen utöver terrängen: noder, byggdelar, spelare,
// pilar, tappade föremål och partiklar.

import * as THREE from 'three';
import { PIECES, TIER_INFO, LOCAL_BOXES, rotLocal } from '../../shared/building.js';
import { NODES } from '../../shared/nodes.js';
import { ITEMS } from '../../shared/items.js';
import { clamp, lerp } from '../../shared/math.js';

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function makeTex(draw, size = 128) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const TEX = {};
function textures() {
  if (TEX.wood) return TEX;
  TEX.wood = makeTex((g, s) => {
    g.fillStyle = '#8a6134'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      const y = (i / 6) * s;
      g.fillStyle = i % 2 ? '#7d5730' : '#94693a';
      g.fillRect(0, y, s, s / 6 - 2);
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y + s / 6 - 2); g.lineTo(s, y + s / 6 - 2); g.stroke();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`;
      g.fillRect(Math.random() * s, Math.random() * s, Math.random() * 22, 1.4);
    }
  });
  TEX.stone = makeTex((g, s) => {
    g.fillStyle = '#8d8880'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        const x = c * (s / 3) + (r % 2 ? s / 6 : 0), y = r * (s / 5);
        g.fillStyle = `rgb(${130 + Math.random() * 26 | 0},${126 + Math.random() * 24 | 0},${118 + Math.random() * 22 | 0})`;
        g.fillRect(x + 2, y + 2, s / 3 - 4, s / 5 - 4);
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
  TEX.metal = makeTex((g, s) => {
    g.fillStyle = '#9aa3ab'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo((i * s) / 2, 0); g.lineTo((i * s) / 2, s); g.stroke();
      g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
  });
  return TEX;
}

const GEOS = {};
function boxGeo(sx, sy, sz) {
  const k = `${sx},${sy},${sz}`;
  if (!GEOS[k]) GEOS[k] = new THREE.BoxGeometry(sx, sy, sz);
  return GEOS[k];
}

const MATS = {};
/** Material per (typ, nivå) med textur-repetition anpassad efter bitens storlek. */
export function blockMaterial(type, tier) {
  const key = type + ':' + tier;
  if (MATS[key]) return MATS[key];
  const base = textures()[tier] || textures().wood;
  const info = TIER_INFO[tier] || TIER_INFO.wood;
  const size = (PIECES[type] && PIECES[type].size) || [1, 1, 1];
  let map = null;
  if (base) {
    map = base.clone();
    map.needsUpdate = true;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const biggest = Math.max(size[0], size[1], size[2]);
    map.repeat.set(Math.max(1, Math.round(biggest / 1.6)), Math.max(1, Math.round(size[1] / 1.6)));
  }
  const m = new THREE.MeshStandardMaterial({
    color: info.color, map, roughness: tier === 'metal' ? 0.42 : 0.88,
    metalness: tier === 'metal' ? 0.55 : 0.02,
  });
  MATS[key] = m;
  return m;
}

// ---------------------------------------------------------------- noder -----
const KIND_STYLE = {
  tree: { trunk: 0x6b4a2a, leaf: 0x3d6b30, leafVar: 0.18 },
  rock: { body: 0x8b8680 },
  metal: { body: 0x7d6a52, vein: 0xc98b3a },
  bush: { body: 0x4a7a35, berry: 0xc2385c },
};

export class Props {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.groups = world.groups;
    this.blocks = new Map();       // id -> Object3D
    this.animated = [];            // dörrar + lägereldar
    this.avatars = new Map();      // playerId -> {obj, parts, tag, data}
    this.projs = new Map();
    this.drops = new Map();
    this.nodeMeshes = {};
    this.nodeIdx = new Map();      // nodeId -> {kind, i}
    this.particles = [];
    this.fireLights = [];
    this._t = 0;

    this._initParticles();
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 12, 2);
      this.fireLights.push(l);
      this.scene.add(l);
    }
  }

  // --- resursnoder ---------------------------------------------------------
  buildNodes(list) {
    for (const k of Object.keys(this.nodeMeshes)) {
      for (const m of this.nodeMeshes[k]) { this.groups.nodes.remove(m); if (m.dispose) m.dispose(); }
    }
    this.nodeMeshes = {};
    this.nodeIdx.clear();
    const counts = { tree: 0, rock: 0, metal: 0, bush: 0 };
    for (const n of list) counts[n.kind] = (counts[n.kind] || 0) + 1;

    const meshes = {};
    const add = (kind, geo, mat, count, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = shadow; im.receiveShadow = false;
      im.frustumCulled = false;
      this.groups.nodes.add(im);
      (meshes[kind] = meshes[kind] || []).push(im);
      return im;
    };

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const veinGeo = new THREE.OctahedronGeometry(0.22, 0);
    const bushGeo = new THREE.IcosahedronGeometry(0.72, 0);
    const berryGeo = new THREE.SphereGeometry(0.09, 5, 4);

    if (counts.tree) {
      meshes.tree = [];
      add('tree', trunkGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.tree.trunk }), counts.tree);
      add('tree', coneGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.tree.leaf }), counts.tree);
      add('tree', coneGeo, new THREE.MeshLambertMaterial({ color: 0x4a7c39 }), counts.tree);
    }
    if (counts.rock) add('rock', rockGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.rock.body, flatShading: true }), counts.rock);
    if (counts.metal) {
      add('metal', rockGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.metal.body, flatShading: true }), counts.metal);
      add('metal', veinGeo, new THREE.MeshStandardMaterial({ color: KIND_STYLE.metal.vein, roughness: 0.35, metalness: 0.7, emissive: 0x2a1405 }), counts.metal * 2);
    }
    if (counts.bush) {
      add('bush', bushGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.bush.body, flatShading: true }), counts.bush);
      add('bush', berryGeo, new THREE.MeshLambertMaterial({ color: KIND_STYLE.bush.berry }), counts.bush * 3);
    }
    this.nodeMeshes = meshes;

    const counters = { tree: 0, rock: 0, metal: 0, bush: 0 };
    for (const n of list) {
      const i = counters[n.kind]++;
      this.nodeIdx.set(n.id, { kind: n.kind, i });
      this._setNode(n, i);
    }
    for (const k in meshes) for (const m of meshes[k]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  _setNode(n, i) {
    const meshes = this.nodeMeshes[n.kind];
    if (!meshes) return;
    const frac = n.alive ? clamp(n.amount / n.max, 0, 1) : 0;
    const s = n.s || 1;

    if (n.kind === 'tree') {
      const h = (n.h || 6);
      const [trunk, c1, c2] = meshes;
      if (n.alive) {
        dummy.position.set(n.x, n.y, n.z); dummy.rotation.set(0, n.rot || 0, 0);
        dummy.scale.set(s, h, s); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.set(n.x, n.y + h * 0.30, n.z);
        dummy.scale.set(h * 0.30 * s, h * 0.52, h * 0.30 * s); dummy.updateMatrix(); c1.setMatrixAt(i, dummy.matrix);
        dummy.position.set(n.x, n.y + h * 0.56, n.z);
        dummy.scale.set(h * 0.21 * s, h * 0.42, h * 0.21 * s); dummy.updateMatrix(); c2.setMatrixAt(i, dummy.matrix);
      } else {
        // stubbe
        dummy.position.set(n.x, n.y, n.z); dummy.rotation.set(0, n.rot || 0, 0);
        dummy.scale.set(s * 1.1, 0.45, s * 1.1); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
        dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.updateMatrix();
        c1.setMatrixAt(i, dummy.matrix); c2.setMatrixAt(i, dummy.matrix);
      }
      const g = 0.82 + frac * 0.18;
      tmpColor.setRGB(g * 0.85, g, g * 0.8);
      c1.setColorAt(i, tmpColor);
      c2.setColorAt(i, tmpColor);
      if (c1.instanceColor) c1.instanceColor.needsUpdate = true;
      if (c2.instanceColor) c2.instanceColor.needsUpdate = true;
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      return;
    }

    if (n.kind === 'rock' || n.kind === 'metal') {
      const r = (NODES[n.kind].radius * s) * (n.alive ? 0.55 + 0.45 * frac : 0.12);
      dummy.position.set(n.x, n.y + r * 0.45, n.z);
      dummy.rotation.set((n.v || 0) * 0.7, (n.rot || 0), (n.v || 0) * 0.4);
      dummy.scale.set(r * 1.15, r * 0.9, r * 1.05);
      dummy.updateMatrix();
      meshes[0].setMatrixAt(i, dummy.matrix);
      meshes[0].instanceMatrix.needsUpdate = true;
      if (n.kind === 'metal') {
        for (let v = 0; v < 2; v++) {
          if (!n.alive) { dummy.scale.set(0.0001, 0.0001, 0.0001); }
          else {
            const a = (n.rot || 0) + v * 2.4;
            dummy.position.set(n.x + Math.cos(a) * r * 0.8, n.y + r * (0.5 + v * 0.35), n.z + Math.sin(a) * r * 0.8);
            dummy.scale.setScalar(r * 0.42);
          }
          dummy.updateMatrix();
          meshes[1].setMatrixAt(i * 2 + v, dummy.matrix);
        }
        meshes[1].instanceMatrix.needsUpdate = true;
      }
      return;
    }

    if (n.kind === 'bush') {
      const [body, berries] = meshes;
      dummy.position.set(n.x, n.y + 0.42 * s, n.z);
      dummy.rotation.set(0, n.rot || 0, 0);
      dummy.scale.set(s * (0.75 + 0.25 * frac), s * (0.6 + 0.3 * frac), s * (0.75 + 0.25 * frac));
      dummy.updateMatrix(); body.setMatrixAt(i, dummy.matrix);
      for (let v = 0; v < 3; v++) {
        if (!n.alive || frac < 0.15) { dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.position.set(n.x, n.y - 5, n.z); }
        else {
          const a = (n.rot || 0) + v * 2.1;
          dummy.position.set(n.x + Math.cos(a) * 0.42 * s, n.y + (0.42 + (v % 2) * 0.2) * s, n.z + Math.sin(a) * 0.42 * s);
          dummy.scale.setScalar(1);
        }
        dummy.updateMatrix(); berries.setMatrixAt(i * 3 + v, dummy.matrix);
      }
      body.instanceMatrix.needsUpdate = true;
      berries.instanceMatrix.needsUpdate = true;
    }
  }

  updateNode(id, amount, alive) {
    const ref = this.nodeIdx.get(id);
    if (!ref || !this._nodeData) return;
    const base = this._nodeData.get(id);
    if (!base) return;
    base.amount = amount; base.alive = alive;
    this._setNode(base, ref.i);
  }

  setNodeData(list) {
    this._nodeData = new Map();
    for (const n of list) this._nodeData.set(n.id, n);
  }

  // --- byggdelar -----------------------------------------------------------
  addBlock(b) {
    if (this.blocks.has(b.id)) this.delBlock(b.id);
    const obj = this.buildBlockMesh(b);
    obj.position.set(b.x, b.y, b.z);
    obj.rotation.y = (b.rot || 0) * Math.PI / 2;
    obj.userData.block = b;
    this.blocks.set(b.id, obj);
    this.groups.blocks.add(obj);
    if (obj.userData.pivot || obj.userData.flame) this.animated.push(obj);
    return obj;
  }

  buildBlockMesh(b) {
    const mat = blockMaterial(b.type, b.tier || 'wood');
    const p = PIECES[b.type];
    if (!p) return new THREE.Object3D();

    if (b.type === 'doorway') {
      const g = new THREE.Group();
      const parts = LOCAL_BOXES.doorway;
      for (const [cx, cy, cz, sx, sy, sz] of parts) {
        const m = new THREE.Mesh(boxGeo(sx, sy, sz), mat);
        m.position.set(cx, cy, cz);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      return g;
    }
    if (b.type === 'door') {
      const g = new THREE.Group();
      const pivot = new THREE.Group();
      pivot.position.set(-0.6, 0, 0);
      const leaf = new THREE.Mesh(boxGeo(1.2, 2.4, 0.1), blockMaterial('door', b.tier || 'wood'));
      leaf.position.set(0.6, 0, 0);
      leaf.castShadow = true;
      const handle = new THREE.Mesh(boxGeo(0.09, 0.22, 0.09), MATS.handle || (MATS.handle = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.7, roughness: 0.4 })));
      handle.position.set(1.02, 0, 0.11);
      pivot.add(leaf, handle);
      g.add(pivot);
      g.userData.pivot = pivot;
      g.userData.open = !!b.open;
      return g;
    }
    if (b.type === 'box') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(boxGeo(0.9, 0.62, 0.9), mat);
      body.position.y = -0.14;
      const lid = new THREE.Mesh(boxGeo(0.96, 0.24, 0.96), mat);
      lid.position.y = 0.29;
      const lock = new THREE.Mesh(boxGeo(0.16, 0.16, 0.06), MATS.lock || (MATS.lock = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.8, roughness: 0.35 })));
      lock.position.set(0, 0.1, 0.48);
      body.castShadow = lid.castShadow = true;
      body.receiveShadow = lid.receiveShadow = true;
      g.add(body, lid, lock);
      return g;
    }
    if (b.type === 'campfire') {
      const g = new THREE.Group();
      const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6f6a63 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), stoneMat);
        s.position.set(Math.cos(a) * 0.55, -0.24, Math.sin(a) * 0.55);
        s.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(s);
      }
      const logMat = new THREE.MeshLambertMaterial({ color: 0x5a3d21 });
      for (let i = 0; i < 3; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.85, 5), logMat);
        l.rotation.set(Math.PI / 2 - 0.35, (i / 3) * Math.PI * 2, 0);
        l.position.y = -0.1;
        g.add(l);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.7, 7), new THREE.MeshBasicMaterial({ color: 0xffa028, transparent: true, opacity: 0.92 }));
      flame.position.y = 0.18;
      const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 }));
      flame2.position.y = 0.22;
      g.add(flame, flame2);
      g.userData.flame = flame; g.userData.flame2 = flame2;
      return g;
    }
    const [sx, sy, sz] = p.size;
    const m = new THREE.Mesh(boxGeo(sx, sy, sz), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  updBlock(b) {
    let obj = this.blocks.get(b.id);
    if (!obj) { this.addBlock(b); return; }
    const old = obj.userData.block || {};
    if (old.tier !== b.tier || old.type !== b.type) {
      this.delBlock(b.id);
      obj = this.addBlock(b);
    }
    obj.userData.block = b;
    if (b.type === 'door' && obj.userData.pivot) obj.userData.open = !!b.open;
    if (obj.userData.block !== b) { obj.userData.block = b; }
  }

  delBlock(id) {
    const obj = this.blocks.get(id);
    if (!obj) return;
    this.groups.blocks.remove(obj);
    this._dispose(obj);
    this.blocks.delete(id);
  }

  _dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }

  // --- spelaravatarer ------------------------------------------------------
  makeAvatar(name) {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const cloth = new THREE.MeshLambertMaterial({ color: 0x4c6b8a });
    const pants = new THREE.MeshLambertMaterial({ color: 0x3b3a35 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.52, 3, 8), cloth);
    torso.position.y = 1.1; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
    head.position.y = 1.66; head.castShadow = true;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), cloth);
    const armR = armL.clone();
    armL.position.set(-0.35, 1.18, 0); armR.position.set(0.35, 1.18, 0);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.8, 0.17), pants);
    const legR = legL.clone();
    legL.position.set(-0.13, 0.4, 0); legR.position.set(0.13, 0.4, 0);
    const hand = new THREE.Group();
    hand.position.set(0.35, 0.92, 0.16);
    g.add(torso, head, armL, armR, legL, legR, hand);

    const tag = this.makeTag(name);
    tag.position.y = 2.12;
    g.add(tag);

    return { obj: g, parts: { torso, head, armL, armR, legL, legR, hand }, tag, phase: 0, heldId: null };
  }

  makeTag(name, hp = 100) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const w = 256, h = 64;
    const mat = new THREE.SpriteMaterial({ depthTest: true, depthWrite: false, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.5, 0.375, 1);
    spr.renderOrder = 5;
    spr.userData = { name, hp, canvas: c, w, h };
    this.paintTag(spr, name, hp);
    return spr;
  }

  paintTag(spr, name, hp) {
    const u = spr.userData;
    if (!u.canvas || !u.canvas.getContext) return;
    if (u.name === name && u.hp === hp && u.painted) return;
    u.name = name; u.hp = hp; u.painted = true;
    const c = u.canvas; c.width = u.w; c.height = u.h;
    const g = c.getContext('2d');
    g.clearRect(0, 0, u.w, u.h);
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(name, u.w / 2, 20);
    g.fillStyle = '#fff';
    g.fillText(name, u.w / 2, 20);
    const bw = 150, bx = (u.w - bw) / 2, by = 42;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(bx, by, bw, 9);
    const f = clamp(hp / 100, 0, 1);
    g.fillStyle = f > 0.5 ? '#67c14b' : f > 0.22 ? '#e0a02c' : '#d0453b';
    g.fillRect(bx + 1, by + 1, (bw - 2) * f, 7);
    if (u.tex) u.tex.dispose();
    u.tex = new THREE.CanvasTexture(c);
    spr.material.map = u.tex;
    spr.material.needsUpdate = true;
  }

  syncActors(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let a = this.avatars.get(d.id);
      if (!a) {
        a = this.makeAvatar(d.name);
        a.data = d;
        this.avatars.set(d.id, a);
        this.groups.actors.add(a.obj);
      }
      a.data = d;
      if (!a.buf) a.buf = [];
      a.buf.push({ t: performance.now(), d: { ...d } });
      if (a.buf.length > 24) a.buf.shift();
      this.paintTag(a.tag, d.name, d.hp);
      a.obj.visible = !d.dead;
      if (a.heldId !== d.item) { a.heldId = d.item; this._setHeld(a, d.item); }
    }
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) { this.groups.actors.remove(a.obj); this._dispose(a.obj); this.avatars.delete(id); }
    }
  }

  _setHeld(a, itemId) {
    const hand = a.parts.hand;
    while (hand.children.length) hand.remove(hand.children[0]);
    const m = buildItemMesh(itemId, 0.62);
    if (m) { m.rotation.set(-0.5, 0, 0.2); hand.add(m); }
  }

  /** Interpolera avatarer ~100 ms bakåt i tiden. */
  updateActors(now, dt) {
    const target = now - 100;
    for (const a of this.avatars.values()) {
      const buf = a.buf;
      if (!buf || !buf.length) continue;
      let i = buf.length - 1;
      while (i > 0 && buf[i].t > target) i--;
      const A = buf[i], B = buf[Math.min(buf.length - 1, i + 1)];
      const span = Math.max(1, B.t - A.t);
      const k = clamp((target - A.t) / span, 0, 1);
      const p = A.d, p2 = B.d;
      a.obj.position.set(lerp(p.x, p2.x, k), lerp(p.y, p2.y, k), lerp(p.z, p2.z, k));
      a.obj.rotation.y = lerpAngle(p.yaw, p2.yaw, k);
      const speed = Math.hypot(p2.x - p.x, p2.z - p.z) / (span / 1000 || 1);
      a.phase += dt * clamp(speed, 0, 7) * 2.6;
      const sw = Math.sin(a.phase) * clamp(speed / 5, 0, 1);
      a.parts.legL.rotation.x = sw * 0.8;
      a.parts.legR.rotation.x = -sw * 0.8;
      const attacking = (now - (a.swingStart || 0)) < 340;
      if (!attacking && p.swing !== a.lastSwing) { a.swingStart = now; a.lastSwing = p.swing; }
      const atk = attacking ? 1 - (now - a.swingStart) / 340 : 0;
      a.parts.armR.rotation.x = -sw * 0.6 - atk * 2.1;
      a.parts.armL.rotation.x = -sw * 0.5;
      a.parts.torso.rotation.y = p2.pitch ? clamp(-p2.pitch, -0.5, 0.5) * 0.35 : 0;
      if (buf.length > 4 && buf[0].t < target - 400) buf.splice(0, buf.length - 4);
    }
  }

  // --- pilar ---------------------------------------------------------------
  syncProjectiles(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projs.get(p.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 5), new THREE.MeshLambertMaterial({ color: 0xd8c9a3 }));
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 5), new THREE.MeshLambertMaterial({ color: 0xb9bcc0 }));
        tip.position.y = 0.42; tip.rotation.x = 0;
        m.add(tip);
        m.rotation.x = Math.PI / 2;
        this.projs.set(p.id, m);
        this.groups.fx.add(m);
        m.userData.prev = { x: p.x, y: p.y, z: p.z };
      }
      const prev = m.userData.prev;
      const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
      m.position.set(p.x, p.y, p.z);
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.001) {
        const dir = new THREE.Vector3(dx, dy, dz).normalize();
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      }
      m.userData.prev = { x: p.x, y: p.y, z: p.z };
    }
    for (const [id, m] of this.projs) if (!seen.has(id)) { this.groups.fx.remove(m); this.projs.delete(id); }
  }

  // --- tappade föremål -----------------------------------------------------
  syncDrop(d) {
    let m = this.drops.get(d.id);
    if (!m) {
      const g = new THREE.Group();
      const col = (ITEMS[d.item] && ITEMS[d.item].color) || '#c9c9c9';
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshLambertMaterial({ color: new THREE.Color(col) }));
      g.add(box);
      m = g; m.userData.t0 = this._t;
      this.drops.set(d.id, m);
      this.groups.fx.add(m);
    }
    m.position.set(d.x, d.y + 0.12 + Math.sin(this._t * 2 + d.id) * 0.05, d.z);
    m.rotation.y = this._t * 1.2 + d.id;
  }
  delDrop(id) {
    const m = this.drops.get(id);
    if (!m) return;
    this.groups.fx.remove(m); this._dispose(m); this.drops.delete(id);
  }

  // --- partiklar -----------------------------------------------------------
  _initParticles() {
    const CAP = 420;
    this.pCap = CAP;
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ vertexColors: false }), CAP);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    this.pMesh.material.vertexColors = true;
    this.pMesh.setColorAt(0, tmpColor.set('#ffffff'));
    this.groups.fx.add(this.pMesh);
    dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.position.set(0, -999, 0); dummy.updateMatrix();
    for (let i = 0; i < CAP; i++) this.pMesh.setMatrixAt(i, dummy.matrix);
    this.pMesh.instanceMatrix.needsUpdate = true;
  }

  spawnParticles(x, y, z, count, color, opts = {}) {
    const spread = opts.spread === undefined ? 2.2 : opts.spread;
    const up = opts.up === undefined ? 2.4 : opts.up;
    const size = opts.size || 0.09;
    const life = opts.life || 0.7;
    const grav = opts.gravity === undefined ? 12 : opts.gravity;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.pCap) this.particles.shift();
      this.particles.push({
        x, y, z,
        vx: (Math.random() - 0.5) * spread, vy: Math.random() * up, vz: (Math.random() - 0.5) * spread,
        life: life * (0.6 + Math.random() * 0.7), t: 0, size: size * (0.6 + Math.random()), grav,
        color: Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color,
        i: -1,
      });
    }
  }

  _updateParticles(dt) {
    // återanvänd index i ordning
    const n = this.particles.length;
    for (let k = 0; k < n; k++) {
      const p = this.particles[k];
      p.t += dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = clamp(1 - p.t / p.life, 0, 1);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.t * 6, p.t * 4, 0);
      const s = p.size * (0.4 + f * 0.9);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.pMesh.setMatrixAt(k, dummy.matrix);
      tmpColor.set(p.color);
      this.pMesh.setColorAt(k, tmpColor);
      p.i = k;
    }
    if (this._lastCount > n) {
      dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.position.set(0, -999, 0); dummy.updateMatrix();
      for (let k = n; k < this._lastCount; k++) this.pMesh.setMatrixAt(k, dummy.matrix);
    }
    this._lastCount = n;
    this.particles = this.particles.filter((p) => p.t < p.life);
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  fx(e) {
    const C = {
      wood: ['#8a5a2b', '#a9743d', '#6b4423'],
      stone: ['#9a9a9a', '#7d7d7d', '#b5b5b5'],
      metal: ['#c9a227', '#8a7355', '#e0c060'],
      berry: ['#c0405f', '#7a2b3f'],
      blood: ['#a01818', '#7a1010', '#c83030'],
      dust: ['#b0a48c', '#8d8272'],
      water: ['#7fc4dd', '#bfe6f2'],
      spark: ['#ffd479', '#ff9a3c'],
    };
    switch (e.k) {
      case 'gather': case 'depleted':
        this.spawnParticles(e.x, e.y, e.z, e.n || 6, C[e.kind === 'tree' ? 'wood' : e.kind === 'bush' ? 'berry' : e.kind === 'metal' ? 'metal' : 'stone'], { spread: 2.4, up: 2.2, life: 0.6 });
        break;
      case 'blood': this.spawnParticles(e.x, e.y, e.z, e.n || 8, C.blood, { spread: 2.6, up: 2.6, life: 0.55 }); break;
      case 'dust': this.spawnParticles(e.x, e.y, e.z, e.n || 5, C.dust, { spread: 1.6, up: 1.2, life: 0.5 }); break;
      case 'chip': this.spawnParticles(e.x, e.y, e.z, e.n || 5, e.type === 'foundation' || e.type === 'wall' ? C.wood : C.stone, { spread: 2, up: 1.6 }); break;
      case 'spark': this.spawnParticles(e.x, e.y, e.z, e.n || 5, C.spark, { spread: 3, up: 2.4, life: 0.35, gravity: 6 }); break;
      case 'splash': this.spawnParticles(e.x, e.y, e.z, e.n || 6, C.water, { spread: 2.2, up: 3.2, life: 0.5 }); break;
      case 'break': this.spawnParticles(e.x, e.y, e.z, 22, C.wood, { spread: 4, up: 3.4, size: 0.14, life: 0.9 }); break;
      case 'place': this.spawnParticles(e.x, e.y - 0.1, e.z, 8, C.dust, { spread: 2.4, up: 1.0, life: 0.4 }); break;
      case 'upgrade': this.spawnParticles(e.x, e.y, e.z, 12, C.spark, { spread: 2.4, up: 2.6, life: 0.5, gravity: 4 }); break;
      case 'craft': this.spawnParticles(e.x, e.y, e.z, 8, C.spark, { spread: 1.4, up: 1.6, life: 0.45, gravity: 4 }); break;
      case 'land': this.spawnParticles(e.x, e.y + 0.05, e.z, 10, C.dust, { spread: 3, up: 1.2, life: 0.45 }); break;
      default: break;
    }
  }

  // --- per-frame -----------------------------------------------------------
  update(dt, camPos, tod) {
    this._t += dt;
    this.updateActors(performance.now(), dt);
    this._updateParticles(dt);

    // dörrar och eldar animeras
    for (const obj of this.animated) {
      if (obj.userData.pivot) {
        const target = obj.userData.open ? -1.85 : 0;
        obj.userData.pivot.rotation.y = lerp(obj.userData.pivot.rotation.y, target, Math.min(1, dt * 9));
      }
      if (obj.userData.flame) {
        const f = 0.85 + Math.sin(this._t * 11 + obj.position.x) * 0.1 + Math.random() * 0.08;
        obj.userData.flame.scale.set(f, 0.9 + Math.random() * 0.35, f);
        obj.userData.flame2.scale.set(f * 0.9, 0.8 + Math.random() * 0.4, f * 0.9);
      }
    }

    // eldsljus: de tre närmaste lägereldarna
    const fires = [];
    for (const obj of this.animated) {
      const b = obj.userData.block;
      if (!b || b.type !== 'campfire') continue;
      const d = Math.hypot(b.x - camPos.x, b.z - camPos.z);
      if (d < 40) fires.push({ b, d });
    }
    fires.sort((a, b) => a.d - b.d);
    const nightBoost = 1 - clamp(Math.sin((tod - 0.25) * Math.PI * 2) * 2, 0, 1);
    for (let i = 0; i < this.fireLights.length; i++) {
      const l = this.fireLights[i];
      const f = fires[i];
      if (!f) { l.intensity = 0; continue; }
      l.position.set(f.b.x, f.b.y + 0.5, f.b.z);
      l.intensity = (1.2 + Math.random() * 0.5) * (0.45 + nightBoost * 0.9);
      l.distance = 14;
    }
  }

  clearBlocks() {
    for (const id of [...this.blocks.keys()]) this.delBlock(id);
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Bygger ett litet 3D-föremål (vapen/verktyg) – används av avatarer och vy-modellen. */
export function buildItemMesh(itemId, scale = 1) {
  if (!itemId) return null;
  const d = ITEMS[itemId];
  if (!d) return null;
  const g = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x7c5a30 });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8f8b84 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc3cad1, metalness: 0.75, roughness: 0.35 });
  const headMat = itemId.startsWith('metal') ? metalMat : itemId.startsWith('stone') ? stoneMat : woodMat;

  if (itemId.includes('axe')) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.78, 6), woodMat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.3), headMat);
    head.position.set(0, 0.36, 0.13);
    g.add(handle, head);
  } else if (itemId.includes('pick')) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.78, 6), woodMat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.07), headMat);
    head.position.y = 0.34;
    const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), headMat);
    tip1.rotation.z = Math.PI / 2; tip1.position.set(0.26, 0.3, 0);
    const tip2 = tip1.clone(); tip2.position.x = -0.26; tip2.rotation.z = -Math.PI / 2;
    g.add(handle, head, tip1, tip2);
  } else if (itemId.includes('spear')) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), woodMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), headMat);
    tip.position.y = 0.86;
    g.add(shaft, tip);
  } else if (itemId === 'bow') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 6, 14, Math.PI * 1.15), woodMat);
    arc.rotation.z = Math.PI * 0.42;
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.82, 4), new THREE.MeshLambertMaterial({ color: 0xe8e2cf }));
    str.rotation.z = 0.28; str.position.set(0.1, 0, 0);
    g.add(arc, str);
  } else if (itemId === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 5), woodMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 5), stoneMat);
    tip.position.y = 0.34;
    g.add(shaft, tip);
  } else if (itemId === 'torch') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), woodMat);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 7), new THREE.MeshBasicMaterial({ color: 0xffa62c }));
    flame.position.y = 0.34;
    g.add(stick, flame);
  } else if (itemId === 'campfire') {
    const logs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), woodMat);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xff9a2c }));
    flame.position.y = 0.2;
    g.add(logs, flame);
  } else if (d.cat === 'res' || d.cat === 'food' || d.cat === 'ammo') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshLambertMaterial({ color: new THREE.Color(d.color || '#ccc') }));
    g.add(m);
  } else {
    return null;
  }
  g.scale.setScalar(scale);
  return g;
}
