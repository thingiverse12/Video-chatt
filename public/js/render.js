/**
 * All rendering med three.js: terräng, vatten, himmel, dag/natt, resurspunkter,
 * byggdelar, spelare, projektiler och partikeleffekter.
 */

import * as THREE from 'three';
import { NODE_TYPES, daylight, sunHeight } from '../../shared/worldgen.js';
import { pieceGeometry, GRID } from '../../shared/building.js';

const NODE_INFO = NODE_TYPES;

const COLORS = {
  wood: 0x8b6640,
  woodDark: 0x6f4f30,
  stoneWall: 0x9a9a95,
  door: 0x6b4b2a,
  metal: 0xb9c2cc,
  bag: 0x3b3226,
  water: 0x1f6f8b,
};

function makeNametag() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 72;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.4, 0.54, 1);
  sprite.renderOrder = 10;
  return { canvas, tex, sprite };
}

function drawNametag(canvas, tex, name, hp, sleeper) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 320, 72);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = sleeper ? 'rgba(190,190,190,0.95)' : 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 5;
  ctx.strokeText(name + (sleeper ? ' 💤' : ''), 160, 32);
  ctx.fillText(name + (sleeper ? ' 💤' : ''), 160, 32);
  // hp-rad
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(90, 44, 140, 12);
  const pct = Math.max(0, Math.min(1, hp / 100));
  ctx.fillStyle = pct > 0.5 ? '#6ee36e' : pct > 0.25 ? '#e3c96e' : '#e36e6e';
  ctx.fillRect(92, 46, 136 * pct, 8);
  tex.needsUpdate = true;
}

export class Renderer {
  constructor(canvas, world, config) {
    this.canvas = canvas;
    this.world = world;
    this.config = config || {};
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);
    this.scene.fog = new THREE.Fog(0x9fc4dd, 60, 340);

    this.clock = new THREE.Clock();
    this.nodeMeshes = new Map(); // nodeId -> {type, index}
    this.nodeCounts = new Map();
    this.pieces = new Map(); // pieceId -> {group, meshes, kind, def}
    this.players = new Map(); // id -> {group, parts, target, tag}
    this.effects = [];
    this.tracers = [];
    this.campfires = new Map();
    this.previewGroup = null;

    this._initViewModel();
    this._initLights();
    this._initSky();
    this._initTerrain();
    this._initWater();
    this._initNodes();
    this._initPreview();

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- vy-modell

  _initViewModel() {
    this.scene.add(this.camera);
    this.viewGroup = new THREE.Group();
    this.viewGroup.position.set(0.36, -0.34, -0.55);
    this.camera.add(this.viewGroup);
    this.swingT = 0;
    this.swingDur = 0.26;
    this.currentItem = null;
    this.setViewModel('hand');
  }

  setViewModel(item) {
    if (this.currentItem === item) return;
    this.currentItem = item;
    this.viewGroup.clear();
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a5f34 });
    const metal = new THREE.MeshLambertMaterial({ color: 0xb9c2cc });
    const stone = new THREE.MeshLambertMaterial({ color: 0x8d8f8c, flatShading: true });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a97e });
    const add = (geo, mat, pos, rot, scale) => {
      const m = new THREE.Mesh(geo, mat);
      if (pos) m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      if (scale) m.scale.set(...scale);
      this.viewGroup.add(m);
      return m;
    };
    const id = item || 'hand';
    if (id === 'hand') {
      add(new THREE.BoxGeometry(0.14, 0.14, 0.2), skin, [0, -0.06, 0.03]);
      return;
    }
    if (id === 'hatchet' || id === 'stone_hatchet') {
      // yxa
      const head = id === 'hatchet' ? metal : stone;
      add(new THREE.CylinderGeometry(0.022, 0.026, 0.75, 6), wood, [0, 0, 0], [0.5, 0, 0.1]);
      add(new THREE.BoxGeometry(0.05, 0.22, 0.14), head, [0.02, 0.34, 0.06], [0.5, 0, 0.1]);
      return;
    }
    if (id === 'pickaxe' || id === 'stone_pickaxe') {
      const head = id === 'pickaxe' ? metal : stone;
      add(new THREE.CylinderGeometry(0.022, 0.026, 0.8, 6), wood, [0, 0, 0], [0.6, 0, 0.1]);
      add(new THREE.BoxGeometry(0.05, 0.09, 0.42), head, [0.02, 0.36, 0.08], [0.6, 0, 0.1]);
      return;
    }
    if (id.includes('spear')) {
      add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), wood, [0, -0.1, 0.1], [1.35, 0, 0.05]);
      add(new THREE.ConeGeometry(0.045, 0.24, 6), id === 'spear_metal' ? metal : stone, [0, 0.62, -0.42], [1.35, 0, 0.05]);
      return;
    }
    if (id === 'club') {
      add(new THREE.CylinderGeometry(0.035, 0.05, 0.85, 7), wood, [0, 0, 0], [0.7, 0, 0.1]);
      return;
    }
    if (id === 'bow') {
      add(new THREE.TorusGeometry(0.42, 0.02, 6, 16, Math.PI * 1.05), wood, [0, 0, 0.1], [0, 0, -0.5]);
      add(new THREE.CylinderGeometry(0.005, 0.005, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0xe8e0cc }), [0, 0, 0.1], [0, 0, 0]);
      return;
    }
    if (id === 'campfire' || id === 'storage_box' || id === 'door') {
      add(new THREE.BoxGeometry(0.34, 0.26, 0.3), wood, [0, -0.02, 0.04]);
      return;
    }
    if (id === 'bandage') {
      add(new THREE.BoxGeometry(0.2, 0.12, 0.2), new THREE.MeshLambertMaterial({ color: 0xf0e6dc }), [0, -0.02, 0.04]);
      return;
    }
    if (id === 'arrow') {
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), wood, [0, 0, 0], [1.4, 0, 0]);
      return;
    }
    // mat
    add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xc23a4e }), [0, -0.02, 0.04]);
  }

  playSwing() {
    this.swingT = this.swingDur;
  }

  updateViewModel(dt, attacking) {
    const g = this.viewGroup;
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    const t = this.swingT / this.swingDur; // 1 -> 0
    const swing = Math.sin((1 - t) * Math.PI) * 0.15;
    const draw = this.currentItem === 'bow' ? attacking : 0;
    g.rotation.x = -0.15 + swing * 2.4 - draw * 0.2;
    g.rotation.z = 0.1 - swing * 0.9;
    g.position.set(0.36 - draw * 0.08, -0.34 + swing * 0.12, -0.55 - draw * 0.1);
    const bob = Math.sin(performance.now() * 0.004) * 0.006;
    g.position.y += bob;
  }

  // ------------------------------------------------------------- grundscen

  _initLights() {
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4034, 0.65);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d5, 1.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 60;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x93a9d6, 0.22);
    this.scene.add(this.moon);
    this.fireLight = new THREE.PointLight(0xff9a3c, 0, 14, 2);
    this.scene.add(this.fireLight);
  }

  _initSky() {
    const geo = new THREE.SphereGeometry(600, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fb0) },
        bottom: { value: new THREE.Color(0xcfe6f5) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xfff0cc) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(h, 0.8));
          float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 24.0);
          col += sunColor * sun * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _initTerrain() {
    const size = this.config.size || 400;
    const seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xd9cba3);
    const grass = new THREE.Color(0x6f9a4e);
    const forest = new THREE.Color(0x4f7a3c);
    const rock = new THREE.Color(0x8d8f8c);
    const snow = new THREE.Color(0xe6ebee);
    const bed = new THREE.Color(0x6c6a4f);
    const c = new THREE.Color();
    const half = size / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.world.heightAt(x, z);
      pos.setY(i, h);
      if (h < -0.3) c.copy(bed).lerp(sand, Math.max(0, (h + 4) / 4));
      else if (h < 1.6) c.copy(sand);
      else if (h > 26) c.copy(snow);
      else if (h > 20) c.copy(rock).lerp(snow, (h - 20) / 8);
      else {
        const forestMask = Math.max(0, Math.min(1, (h - 5) / 14));
        c.copy(grass).lerp(forest, forestMask * 0.85);
        c.lerp(rock, Math.max(0, Math.min(1, (h - 15) / 10)) * 0.5);
      }
      // lite färgbrus så att marken inte ser platt ut
      const n = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
      c.offsetHSL(0, 0, (n - 0.5) * 0.045);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  _initWater() {
    const size = (this.config.size || 400) * 2.2;
    const geo = new THREE.PlaneGeometry(size, size, 40, 40);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshPhongMaterial({
      color: COLORS.water,
      transparent: true,
      opacity: 0.72,
      shininess: 90,
      specular: 0x9fd8ff,
      side: THREE.DoubleSide,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.position.y = this.world.waterLevel;
    this.waterBase = geo.attributes.position.array.slice();
    this.scene.add(this.water);
  }

  _initNodes() {
    const byType = new Map();
    for (const n of this.world.nodes) {
      if (!byType.has(n.type)) byType.set(n.type, []);
      byType.get(n.type).push(n);
    }
    this.nodeGroups = new Map();
    for (const [type, list] of byType) {
      const group = new THREE.Group();
      group.name = `nodes:${type}`;
      const meshes = this._buildNodePrototype(type, list.length);
      this._fillNodeInstances(type, list, meshes);
      for (const m of meshes) group.add(m);
      this.nodeGroups.set(type, { group, meshes, list });
      this.scene.add(group);
    }
  }

  _prototypeParts(type) {
    switch (type) {
      case 'tree':
        return [
          { geo: new THREE.CylinderGeometry(0.22, 0.34, 5.2, 7), color: 0x6b4a2c, y: 2.6, kind: 'trunk' },
          { geo: new THREE.ConeGeometry(1.75, 4.4, 8), color: 0x3f6b31, y: 6.6, kind: 'leaf' },
          { geo: new THREE.ConeGeometry(1.3, 3.2, 8), color: 0x4a7a38, y: 8.4, kind: 'leaf' },
        ];
      case 'rock':
        return [{ geo: new THREE.IcosahedronGeometry(0.85, 0), color: 0x8b8d8a, y: 0.55, kind: 'rock' }];
      case 'ore':
        return [
          { geo: new THREE.IcosahedronGeometry(0.95, 0), color: 0x7d8184, y: 0.6, kind: 'rock' },
          { geo: new THREE.IcosahedronGeometry(0.34, 0), color: 0xc8d2da, y: 1.05, x: 0.35, z: 0.25, kind: 'ore' },
          { geo: new THREE.IcosahedronGeometry(0.26, 0), color: 0xd7e2ea, y: 0.42, x: -0.42, z: -0.3, kind: 'ore' },
        ];
      case 'berry':
        return [
          { geo: new THREE.IcosahedronGeometry(0.6, 1), color: 0x38602f, y: 0.55, kind: 'bush' },
          { geo: new THREE.IcosahedronGeometry(0.16, 0), color: 0xc23a4e, y: 0.85, x: 0.3, z: 0.2, kind: 'berry' },
          { geo: new THREE.IcosahedronGeometry(0.15, 0), color: 0xc23a4e, y: 0.62, x: -0.3, z: -0.2, kind: 'berry' },
        ];
      case 'mushroom':
        return [
          { geo: new THREE.CylinderGeometry(0.07, 0.09, 0.32, 6), color: 0xe4dcc6, y: 0.16, kind: 'stem' },
          { geo: new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: 0xb4463a, y: 0.3, kind: 'cap' },
        ];
      default:
        return [{ geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), color: 0x999999, y: 0.25, kind: 'x' }];
    }
  }

  _buildNodePrototype(type, count) {
    const parts = this._prototypeParts(type);
    const meshes = [];
    for (const part of parts) {
      let mat;
      if (part.kind === 'leaf' || part.kind === 'bush') {
        mat = new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
      } else if (part.kind === 'ore' || part.kind === 'berry') {
        mat = new THREE.MeshPhongMaterial({ color: part.color, shininess: 60 });
      } else {
        mat = new THREE.MeshLambertMaterial({ color: part.color, flatShading: true });
      }
      const mesh = new THREE.InstancedMesh(part.geo, mat, count);
      mesh.castShadow = true;
      mesh.receiveShadow = type !== 'tree';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.part = part;
      mesh.userData.type = type;
      mesh.count = 0;
      meshes.push(mesh);
      for (let i = 0; i < count; i++) {
        mesh.setColorAt(i, new THREE.Color(part.color));
      }
    }
    return meshes;
  }

  _fillNodeInstances(type, list, meshes) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (const mesh of meshes) {
      mesh.count = list.length;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const part = mesh.userData.part;
        pos.set(n.x + (part.x || 0) * n.s, n.y + part.y * n.s, n.z + (part.z || 0) * n.s);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), n.r);
        scale.setScalar(n.s);
        m4.compose(pos, q, scale);
        mesh.setMatrixAt(i, m4);
        this.nodeMeshes.set(`${n.id}:${part.kind}`, { mesh, index: i, node: n });
        if (!this.nodeIndex) this.nodeIndex = new Map();
        this.nodeIndex.set(n.id, { type, index: i });
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  setNodeState(id, hp, dead, respawnIn) {
    const entry = this.nodeIndex?.get(id);
    if (!entry) return;
    const group = this.nodeGroups.get(entry.type);
    const node = group.list[entry.index];
    this._hideNode(group, entry.index, dead);
    if (dead) {
      this.spawnBurst(node.x, node.y + 1, node.z, node.type === 'tree' ? 0x6b4a2c : 0x8b8d8a, 16);
    }
  }

  _hideNode(group, index, hide) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const node = group.list[index];
    for (const mesh of group.meshes) {
      const part = mesh.userData.part;
      pos.set(node.x + (part.x || 0) * node.s, node.y + part.y * node.s, node.z + (part.z || 0) * node.s);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), node.r);
      scale.setScalar(hide ? 0 : node.s);
      m4.compose(pos, q, scale);
      mesh.setMatrixAt(index, m4);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Träff mot resurspunkter. Använder samma regler som servern (sfärer längs
   * stammen) i stället för att raycasta tusentals instanser varje bildruta.
   */
  raycastNodes(raycaster, maxDist = 14) {
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    const out = [];
    if (!this.nodeGroups) return out;
    for (const { list } of this.nodeGroups.values()) {
      for (const n of list) {
        const dx = n.x - o.x;
        const dz = n.z - o.z;
        if (Math.abs(dx) > maxDist || Math.abs(dz) > maxDist) continue;
        const info = NODE_INFO[n.type];
        const y0 = n.y + 0.15;
        const y1 = n.y + info.height * 0.85;
        const r = Math.max(0.55, info.radius + 0.45);
        let best = null;
        for (let i = 0; i <= 4; i++) {
          const yy = y0 + (y1 - y0) * (i / 4);
          const t = raySphere(o, d, n.x, yy, n.z, r);
          if (t !== null && (best === null || t < best)) best = t;
        }
        if (best !== null) {
          out.push({
            distance: best,
            node: n,
            point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best),
          });
        }
      }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  // -------------------------------------------------------------- byggdelar

  _pieceMaterial(kind) {
    if (!this._mats) this._mats = {};
    if (this._mats[kind]) return this._mats[kind];
    let mat;
    switch (kind) {
      case 'foundation':
        mat = new THREE.MeshLambertMaterial({ color: 0x9c7b52 });
        break;
      case 'ceiling':
        mat = new THREE.MeshLambertMaterial({ color: 0x8a6c47 });
        break;
      case 'wall':
        mat = new THREE.MeshLambertMaterial({ color: COLORS.wood });
        break;
      case 'doorway':
        mat = new THREE.MeshLambertMaterial({ color: COLORS.woodDark });
        break;
      case 'door':
        mat = new THREE.MeshLambertMaterial({ color: COLORS.door });
        break;
      case 'storage_box':
        mat = new THREE.MeshLambertMaterial({ color: 0x7d6237 });
        break;
      case 'lootbag':
        mat = new THREE.MeshLambertMaterial({ color: COLORS.bag });
        break;
      default:
        mat = new THREE.MeshLambertMaterial({ color: 0x8d8d8d });
    }
    this._mats[kind] = mat;
    return mat;
  }

  addPiece(piece) {
    if (piece.kind === 'lootbag') return this.addBag(piece);
    if (this.pieces.has(piece.id)) return;
    const geo = pieceGeometry(piece);
    const group = new THREE.Group();
    group.position.set(geo.pos[0], geo.pos[1], geo.pos[2]);
    group.rotation.y = geo.rotY;
    const meshes = [];
    for (const box of geo.boxes) {
      const mesh = new THREE.Mesh(unitBox, this._pieceMaterial(piece.kind));
      mesh.position.set(box.pos[0], box.pos[1], box.pos[2]);
      mesh.scale.set(box.size[0], box.size[1], box.size[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pieceId = piece.id;
      group.add(mesh);
      meshes.push(mesh);
    }
    if (piece.kind === 'campfire') {
      group.add(this._buildCampfire(group));
    }
    if (piece.kind === 'storage_box') {
      const lid = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0x5f4a2a }));
      lid.position.set(0, 0.92, 0);
      lid.scale.set(1.34, 0.12, 0.9);
      group.add(lid);
    }
    if (piece.kind === 'door') {
      group.userData.open = !!piece.open;
      group.rotation.y += piece.open ? Math.PI / 2 : 0;
    }
    this.scene.add(group);
    this.pieces.set(piece.id, { group, meshes, kind: piece.kind, piece, geo });
  }

  _buildCampfire() {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x8b8d8a, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), ringMat);
      s.position.set(Math.cos(a) * 0.55, 0.14, Math.sin(a) * 0.55);
      g.add(s);
    }
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3524 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), logMat);
      log.rotation.set(Math.PI / 2.6, (i / 3) * Math.PI * 2, 0);
      log.position.y = 0.16;
      g.add(log);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.85, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa63c, transparent: true, opacity: 0.92 })
    );
    flame.position.y = 0.62;
    g.add(flame);
    const flame2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.5, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 })
    );
    flame2.position.y = 0.55;
    g.add(flame2);
    g.userData.flame = flame;
    g.userData.flame2 = flame2;
    return g;
  }

  addBag(bag) {
    if (this.pieces.has(bag.id)) return;
    const group = new THREE.Group();
    group.position.set(bag.x, bag.y, bag.z);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), this._pieceMaterial('lootbag'));
    inner.scale.set(1, 0.7, 1);
    inner.position.y = 0.3;
    inner.castShadow = true;
    group.add(inner);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 6, 10), new THREE.MeshLambertMaterial({ color: 0x8a7a5c }));
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.62;
    group.add(tie);
    group.userData.pieceId = bag.id;
    group.userData.kind = 'lootbag';
    this.scene.add(group);
    this.pieces.set(bag.id, { group, meshes: [inner], kind: 'lootbag', piece: bag, geo: { pos: [bag.x, bag.y, bag.z], rotY: 0 } });
  }

  updatePieceHp(id, hp, open) {
    const entry = this.pieces.get(id);
    if (!entry) return;
    const def = entry.piece;
    const maxHp = Math.max(1, def.hp0 || def.hp || hp);
    def.hp0 = maxHp;
    def.hp = hp;
    const ratio = Math.max(0.25, Math.min(1, hp / maxHp));
    for (const m of entry.meshes) {
      m.material = this._pieceMaterial(entry.kind);
    }
    if (entry.kind === 'door' && open !== undefined) {
      entry.open = !!open;
    }
  }

  setDoorOpen(id, open) {
    const entry = this.pieces.get(id);
    if (!entry || entry.kind !== 'door') return;
    entry.open = !!open;
    entry.targetRot = (entry.geo.rotY || 0) + (open ? Math.PI / 2 : 0);
  }

  removePiece(id) {
    const entry = this.pieces.get(id);
    if (!entry) return;
    const p = entry.piece;
    this.spawnBurst(entry.group.position.x, entry.group.position.y + 0.6, entry.group.position.z, entry.kind === 'lootbag' ? COLORS.bag : COLORS.wood, 12);
    this.scene.remove(entry.group);
    entry.group.traverse((o) => {
      if (o.geometry && o.geometry !== unitBox && o.geometry.dispose) o.geometry.dispose();
    });
    this.pieces.delete(id);
  }

  /** Raycast mot byggdelar: returnerar {distance, point, piece, normal} */
  raycastPieces(raycaster) {
    const meshes = [];
    for (const entry of this.pieces.values()) {
      for (const m of entry.meshes) meshes.push(m);
    }
    const hits = raycaster.intersectObjects(meshes, false);
    const out = [];
    for (const h of hits) {
      const entry = this.pieces.get(h.object.userData.pieceId);
      if (!entry) continue;
      out.push({ distance: h.distance, point: h.point, normal: h.face ? h.face.normal.clone() : null, piece: entry.piece });
    }
    return out;
  }

  // ----------------------------------------------------------------- spelare

  addPlayerState(s, name, sleeper) {
    if (this.players.has(s.i)) return this.players.get(s.i);
    const group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: sleeper ? 0xb9a892 : 0xe0b48c });
    const cloth = new THREE.MeshLambertMaterial({ color: 0x6b7f96 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3d4a5a });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.28), cloth);
    torso.position.y = 1.18;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
    head.position.y = 1.66;
    head.castShadow = true;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.2), dark);
    legL.position.set(-0.13, 0.42, 0);
    const legR = legL.clone();
    legR.position.x = 0.13;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), skin);
    armL.position.set(-0.34, 1.25, 0);
    const armR = armL.clone();
    armR.position.x = 0.34;
    const hand = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xa9702f }));
    hand.position.set(0.42, 1.1, -0.25);
    hand.scale.set(0.1, 0.1, 0.55);
    hand.visible = false;
    const tag = makeNametag();
    tag.sprite.position.y = 2.3;
    group.add(torso, head, legL, legR, armL, armR, hand, tag.sprite);
    this.scene.add(group);
    const entry = {
      group,
      parts: { torso, head, legL, legR, armL, armR, hand, tag },
      target: { x: s.x, y: s.y, z: s.z, yaw: s.yw ?? 0, pitch: s.pt ?? 0 },
      current: { x: s.x, y: s.y, z: s.z, yaw: s.yw ?? 0 },
      hp: s.hp ?? 100,
      name: name || `Spelare ${s.i}`,
      sleeper: !!sleeper,
      walkPhase: 0,
      moving: !!s.mv,
    };
    drawNametag(tag.canvas, tag.tex, entry.name, entry.hp, entry.sleeper);
    this.players.set(s.i, entry);
    return entry;
  }

  setPlayerPosition(s) {
    const entry = this.players.get(s.i);
    if (!entry) return;
    entry.target.x = s.x;
    entry.target.y = s.y;
    entry.target.z = s.z;
    entry.target.yaw = s.yw ?? 0;
    entry.target.pitch = s.pt ?? 0;
    entry.moving = !!s.mv;
    entry.sprinting = !!s.sp;
    if (s.hp !== undefined && s.hp !== entry.hp) {
      entry.hp = s.hp;
      drawNametag(entry.parts.tag.canvas, entry.parts.tag.tex, entry.name, entry.hp, entry.sleeper);
    }
    if (s.eq && s.eq !== entry.equip) {
      entry.equip = s.eq;
      entry.parts.hand.visible = s.eq !== 'hand';
    }
    if (s.sl !== undefined && !!s.sl !== entry.sleeper) {
      entry.sleeper = !!s.sl;
      drawNametag(entry.parts.tag.canvas, entry.parts.tag.tex, entry.name, entry.hp, entry.sleeper);
    }
  }

  removePlayer(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    this.players.delete(id);
  }

  updatePlayers(dt, isSelf) {
    for (const [id, entry] of this.players) {
      const t = entry.target;
      const c = entry.current;
      const k = Math.min(1, dt * 12);
      c.x += (t.x - c.x) * k;
      c.y += (t.y - c.y) * k;
      c.z += (t.z - c.z) * k;
      let dy = t.yaw - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw += dy * Math.min(1, dt * 12);
      entry.group.position.set(c.x, c.y, c.z);
      entry.group.rotation.y = c.yaw;
      entry.group.visible = !isSelf || isSelf !== id;
      // gånganimation
      if (entry.moving) {
        entry.walkPhase += dt * (entry.sprinting ? 14 : 9);
        const swing = Math.sin(entry.walkPhase) * 0.6;
        entry.parts.legL.rotation.x = swing;
        entry.parts.legR.rotation.x = -swing;
        entry.parts.armL.rotation.x = -swing * 0.8;
        entry.parts.armR.rotation.x = swing * 0.8;
      } else {
        entry.walkPhase = 0;
        for (const part of ['legL', 'legR', 'armL', 'armR']) entry.parts[part].rotation.x *= 0.8;
      }
      entry.parts.head.rotation.x = -(t.pitch || 0) * 0.6;
    }
  }

  // -------------------------------------------------------------------- fx

  spawnBurst(x, y, z, color, count = 12) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3.4 + 0.6, (Math.random() - 0.5) * 4));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.16, transparent: true, opacity: 1 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.effects.push({ points, velocities, life: 0, maxLife: 0.9, geo, mat });
  }

  spawnTracer(from, to, color = 0xffe6b0) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0, maxLife: 0.25 });
  }

  spawnArrow(pos, dir) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5),
      new THREE.MeshLambertMaterial({ color: 0xd8c8a0 })
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    const target = new THREE.Vector3(pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]);
    mesh.lookAt(target);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.tracers.push({ line: mesh, life: 0, maxLife: 2.2, isMesh: true });
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += dt;
      const arr = e.geo.attributes.position.array;
      for (let j = 0; j < e.velocities.length; j++) {
        const v = e.velocities[j];
        v.y -= 12 * dt;
        arr[j * 3] += v.x * dt;
        arr[j * 3 + 1] += v.y * dt;
        arr[j * 3 + 2] += v.z * dt;
      }
      e.geo.attributes.position.needsUpdate = true;
      e.mat.opacity = Math.max(0, 1 - e.life / e.maxLife);
      if (e.life >= e.maxLife) {
        this.scene.remove(e.points);
        e.geo.dispose();
        e.mat.dispose();
        this.effects.splice(i, 1);
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      const o = t.isMesh ? t.line.material : t.line.material;
      o.transparent = true;
      o.opacity = Math.max(0, 1 - t.life / t.maxLife);
      if (t.life >= t.maxLife) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        o.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------- dag/natt

  updateDayNight(dayFraction, dt, playerPos) {
    const sun = sunHeight(dayFraction);
    const day = daylight(dayFraction);
    const warm = 1 - Math.abs(sun);

    const skyTop = new THREE.Color(0x0a1024).lerp(new THREE.Color(0x2f6fb0), day);
    const skyBottom = new THREE.Color(0x131a2c).lerp(new THREE.Color(0xd6e9f6), day);
    if (day > 0.05 && day < 0.55) {
      const sunset = Math.sin(((day - 0.05) / 0.5) * Math.PI);
      skyBottom.lerp(new THREE.Color(0xff9c5a), sunset * 0.55);
      skyTop.lerp(new THREE.Color(0x8c5aa0), sunset * 0.25);
    }
    this.skyMat.uniforms.top.value.copy(skyTop);
    this.skyMat.uniforms.bottom.value.copy(skyBottom);
    const sunDir = new THREE.Vector3(Math.cos(dayFraction * Math.PI * 2) * 0.5, sun, Math.sin(dayFraction * Math.PI * 2) * 0.5);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.sunColor.value.setHex(day > 0.3 ? 0xfff0cc : 0xff9a4a);

    const fogColor = skyBottom.clone().lerp(new THREE.Color(0x0e1526), 1 - day);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = 40 + day * 40;
    this.scene.fog.far = 220 + day * 160;

    this.sun.position.set(playerPos.x + sunDir.x * 120, Math.max(2, sun) * 120 + 10, playerPos.z + sunDir.z * 120);
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.sun.intensity = 0.15 + day * 1.25;
    this.sun.color.setHex(day > 0.4 ? 0xfff3da : 0xffb267);
    this.sun.castShadow = day > 0.12;
    this.moon.position.set(-sunDir.x * 120, Math.max(0.05, -sun) * 120, -sunDir.z * 120);
    this.moon.intensity = (1 - day) * 0.28;
    this.hemi.intensity = 0.12 + day * 0.62;
    this.hemi.color.setHex(day > 0.3 ? 0xbfd8ff : 0x2a3a5c);
    this.renderer.setClearColor(fogColor);
    this.waterMat.color.setHex(day > 0.25 ? 0x1f6f8b : 0x143a4d);
  }

  /** Animera lägereldar och flytta eldljuset till närmaste eld */
  updateFires(dt, playerPos) {
    let nearest = null;
    let nearestDist = Infinity;
    let phase = 0;
    for (const entry of this.pieces.values()) {
      const fire = entry.group.userData.flame;
      if (!fire) continue;
      phase += 1;
      const flick = 0.85 + Math.sin(performance.now() * 0.012 + phase) * 0.12 + Math.random() * 0.06;
      fire.scale.set(flick, 0.9 + Math.random() * 0.25, flick);
      entry.group.userData.flame2.scale.setScalar(0.9 + Math.random() * 0.2);
      const d = Math.hypot(entry.group.position.x - playerPos.x, entry.group.position.z - playerPos.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = entry.group;
      }
    }
    if (nearest && nearestDist < 22) {
      this.fireLight.position.set(nearest.position.x, nearest.position.y + 0.8, nearest.position.z);
      this.fireLight.intensity = 9 * Math.max(0, 1 - nearestDist / 22) * (0.9 + Math.random() * 0.2);
    } else {
      this.fireLight.intensity = 0;
    }
  }

  updateDoors(dt) {
    for (const entry of this.pieces.values()) {
      if (entry.kind !== 'door') continue;
      const target = (entry.geo.rotY || 0) + (entry.open ? Math.PI / 2 : 0);
      let diff = target - entry.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entry.group.rotation.y += diff * Math.min(1, dt * 8);
    }
  }

  updateWater(t) {
    const pos = this.water.geometry.attributes.position;
    if (!this.waterBase) return;
    if (t % 0.1 > 0.09) {
      for (let i = 0; i < pos.count; i++) {
        const x = this.waterBase[i * 3];
        const z = this.waterBase[i * 3 + 2];
        pos.setY(i, Math.sin(x * 0.08 + t * 0.9) * 0.14 + Math.cos(z * 0.07 + t * 0.7) * 0.12);
      }
      pos.needsUpdate = true;
      this.water.geometry.computeVertexNormals();
    }
  }

  // -------------------------------------------------------------- förhandsvisning

  _initPreview() {
    this.previewGroup = new THREE.Group();
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);
    this.previewMatOk = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.42, depthWrite: false });
    this.previewMatBad = new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.35, depthWrite: false });
  }

  showPreview(piece, ok) {
    this.previewGroup.clear();
    if (!piece) {
      this.previewGroup.visible = false;
      return;
    }
    let geo;
    try {
      geo = pieceGeometry(piece);
    } catch {
      this.previewGroup.visible = false;
      return;
    }
    const mat = ok ? this.previewMatOk : this.previewMatBad;
    this.previewGroup.position.set(geo.pos[0], geo.pos[1], geo.pos[2]);
    this.previewGroup.rotation.y = geo.rotY;
    for (const box of geo.boxes) {
      const mesh = new THREE.Mesh(unitBox, mat);
      mesh.position.set(box.pos[0], box.pos[1], box.pos[2]);
      mesh.scale.set(box.size[0], box.size[1], box.size[2]);
      this.previewGroup.add(mesh);
    }
    this.previewGroup.visible = true;
  }

  hidePreview() {
    this.previewGroup.visible = false;
  }

  render(dt, playerBody) {
    this.camera.position.set(playerBody.x, playerBody.y + 1.62 + (playerBody.bob || 0), playerBody.z);
    this.camera.rotation.set(playerBody.pitch || 0, playerBody.yaw || 0, 0, 'YXZ');
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(1);
    this.renderer.render(this.scene, this.camera);
  }
}

function raySphere(o, d, cx, cy, cz, r) {
  const ox = cx - o.x;
  const oy = cy - o.y;
  const oz = cz - o.z;
  const tca = ox * d.x + oy * d.y + oz * d.z;
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > r * r) return null;
  const thc = Math.sqrt(r * r - d2);
  return tca - thc >= 0 ? tca - thc : 0;
}

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
export { GRID, NODE_INFO };
