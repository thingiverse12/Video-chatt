// 3D-världen: renderer, himmel, sol/måne, terräng och vatten.

import * as THREE from 'three';
import { MAP_SIZE, HM_RES, WATER_LEVEL, HALF } from '../../shared/const.js';
import { generateHeightmap, heightAt, normalAt } from '../../shared/terrain.js';
import { hash2, clamp, smoothstep, lerp } from '../../shared/math.js';

// Nyckelfärger för himlen över dygnet (tod 0..1, 0.5 = mitt på dagen)
const SKY_KEYS = [
  [0.00, 0x070c1a], [0.18, 0x0d1730], [0.24, 0x7a4a52], [0.28, 0xe79a5c],
  [0.36, 0x93c1e8], [0.62, 0x8cbde6], [0.72, 0xe0955a], [0.78, 0x6d4257],
  [0.84, 0x141f3a], [1.00, 0x070c1a],
];
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

export function skyColor(tod, out = new THREE.Color()) {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [t0, c0] = SKY_KEYS[i], [t1, c1] = SKY_KEYS[i + 1];
    if (tod >= t0 && tod <= t1) {
      const k = (tod - t0) / (t1 - t0 || 1);
      _c1.setHex(c0); _c2.setHex(c1);
      return out.copy(_c1).lerp(_c2, k);
    }
  }
  return out.setHex(SKY_KEYS[0][1]);
}

export function sunDir(tod, out = new THREE.Vector3()) {
  const a = (tod - 0.25) * Math.PI * 2;
  return out.set(Math.cos(a) * 0.9, Math.sin(a), 0.38).normalize();
}

function makeNoiseTexture(size = 128, scale = 1, contrast = 0.5) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x * scale, y * scale, 9999);
      const n2 = hash2(Math.floor(x / 3), Math.floor(y / 3), 4242);
      const v = 243 + ((n - 0.5) * 26 + (n2 - 0.5) * 18) * contrast;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const C_SAND = new THREE.Color(0xcbb787);
const C_GRASS = new THREE.Color(0x5c7a3c);
const C_GRASS2 = new THREE.Color(0x47652f);
const C_ROCK = new THREE.Color(0x77706a);
const C_HIGH = new THREE.Color(0x8d8b80);
const C_SNOW = new THREE.Color(0xe6ecf2);

export class World3D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = opts.renderer || new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(opts.pixelRatio || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1), 1.75));
    this.renderer.shadowMap.enabled = opts.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8cbde6);
    this.scene.fog = new THREE.Fog(0x8cbde6, 60, 320);

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.08, 900);
    this.camera.rotation.order = 'YXZ';

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4433, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.2);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);

    this.groups = {
      terrain: new THREE.Group(),
      nodes: new THREE.Group(),
      blocks: new THREE.Group(),
      actors: new THREE.Group(),
      fx: new THREE.Group(),
      sky: new THREE.Group(),
    };
    for (const g of Object.values(this.groups)) this.scene.add(g);

    this.detailTex = makeNoiseTexture(128, 1, 0.55);
    if (this.detailTex) { this.detailTex.repeat.set(90, 90); }
    this.waterTex = makeNoiseTexture(128, 2, 0.35);
    if (this.waterTex) { this.waterTex.repeat.set(24, 24); }

    this._makeSky();
    this.tod = 0.3;
    this.resize();
  }

  _makeSky() {
    // himmelskupol med gradient via vertexfärger
    const geo = new THREE.SphereGeometry(620, 22, 14);
    const spos = geo.attributes.position;
    this.skyH = new Float32Array(spos.count);
    for (let i = 0; i < spos.count; i++) this.skyH[i] = clamp(spos.getY(i) / 620, -1, 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(spos.count * 3), 3));
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.skyDome = new THREE.Mesh(geo, this.skyMat);
    this.skyDome.renderOrder = -1;
    this.skyDome.frustumCulled = false;
    this.groups.sky.add(this.skyDome);

    // sol & måne
    const sunGeo = new THREE.SphereGeometry(16, 12, 12);
    this.sunMesh = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 12, 12), new THREE.MeshBasicMaterial({ color: 0xd8e2f5, fog: false }));
    this.groups.sky.add(this.sunMesh, this.moonMesh);

    // stjärnor
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * r * 460;
      pos[i * 3 + 1] = Math.abs(u) * 460;
      pos[i * 3 + 2] = Math.sin(th) * r * 460;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.groups.sky.add(this.stars);
  }

  /** Bygger terräng + vatten utifrån ett frö. */
  init(seed) {
    this.seed = seed;
    this.hm = generateHeightmap(seed);
    this._buildTerrain();
    this._buildWater();
    return this.hm;
  }

  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, HM_RES - 1, HM_RES - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(this.hm, x, z);
      pos.setY(i, h);
      const nn = normalAt(this.hm, x, z);
      n.set(nn.x, nn.y, nn.z);
      const slope = 1 - n.y;
      const v = hash2(Math.floor(x * 0.7), Math.floor(z * 0.7), 17);
      col.copy(C_GRASS).lerp(C_GRASS2, v);
      const sand = smoothstep(WATER_LEVEL + 2.2, WATER_LEVEL - 0.6, h);
      col.lerp(C_SAND, sand * 0.92);
      col.lerp(C_ROCK, smoothstep(0.26, 0.52, slope) * 0.9);
      col.lerp(C_HIGH, smoothstep(17, 27, h) * 0.7);
      col.lerp(C_SNOW, smoothstep(28, 34, h) * 0.5);
      // litet färgbrus
      const j = 0.94 + hash2(Math.floor(x * 2.1), Math.floor(z * 2.1), 91) * 0.12;
      colors[i * 3] = col.r * j; colors[i * 3 + 1] = col.g * j; colors[i * 3 + 2] = col.b * j;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (this.detailTex) { mat.map = this.detailTex; }
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.groups.terrain.add(this.terrain);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE * 2.2, MAP_SIZE * 2.2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f6f86, transparent: true, opacity: 0.82, roughness: 0.16, metalness: 0.06,
    });
    if (this.waterTex) { mat.map = this.waterTex; mat.map.repeat.set(60, 60); }
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER_LEVEL;
    this.water.name = 'water';
    this.groups.terrain.add(this.water);
  }

  terrainHeight(x, z) { return this.hm ? heightAt(this.hm, x, z) : 0; }

  resize() {
    const w = (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const h = (typeof window !== 'undefined' ? window.innerHeight : 720);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Uppdaterar himmel, sol, dimma och skuggkamera. */
  setEnvironment(tod, camPos, underwater) {
    this.tod = tod;
    const sky = skyColor(tod, _c1);
    this.scene.background.copy(sky);
    const dir = sunDir(tod, _v3);
    const elev = dir.y;
    const dayF = clamp(elev * 2.2, 0, 1);
    const nightF = 1 - dayF;

    const fogNear = lerp(45, 22, nightF);
    const fogFar = lerp(340, 165, nightF);
    this.scene.fog.color.copy(sky).multiplyScalar(0.96);
    this.scene.fog.near = underwater ? 0.1 : fogNear;
    this.scene.fog.far = underwater ? 26 : fogFar;
    if (underwater) this.scene.fog.color.setHex(0x1d4f63);

    if (elev > -0.08) {
      this.sun.position.set(dir.x * 110, Math.max(6, dir.y * 110), dir.z * 110);
      this.sun.intensity = 0.22 + 1.15 * clamp(elev * 1.5, 0, 1);
      this.sun.color.setHex(elev < 0.22 ? 0xffb46b : 0xfff3de);
    } else {
      this.sun.position.set(-dir.x * 110, Math.max(10, -dir.y * 110), -dir.z * 110);
      this.sun.intensity = 0.22;
      this.sun.color.setHex(0x9db6ea);
    }
    this.hemi.intensity = lerp(0.16, 0.62, dayF);
    this.hemi.color.copy(sky).lerp(WHITE, 0.35);
    this.ambient.intensity = lerp(0.06, 0.16, dayF);

    this.sunMesh.position.set(dir.x * 420, dir.y * 420, dir.z * 420);
    this.sunMesh.visible = dir.y > -0.15;
    this._paintSky(sky, elev, nightF);
    this.moonMesh.position.set(-dir.x * 420, -dir.y * 420, -dir.z * 420);
    this.moonMesh.visible = dir.y < 0.15;
    this.stars.material.opacity = clamp(nightF * 1.1 - 0.1, 0, 0.95);

    if (camPos) {
      this.sun.target.position.set(camPos.x, camPos.y, camPos.z);
      const off = this.sun.position.clone().normalize().multiplyScalar(90);
      this.sun.position.copy(camPos).add(off);
      this.sun.target.updateMatrixWorld();
      this.groups.sky.position.set(camPos.x, 0, camPos.z);
    }
    if (this.waterTex) {
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.00002;
      this.waterTex.offset.set(t, t * 0.6);
    }
    if (this.water) this.water.material.color.setHex(dayF > 0.4 ? 0x2f6f86 : 0x1b3d4d);
  }

  _paintSky(horizon, elev, nightF) {
    if (!this.skyDome) return;
    const attr = this.skyDome.geometry.attributes.color;
    const zen = _c2.copy(horizon).multiplyScalar(0.55);
    zen.lerp(ZENITH_BLUE, clamp(0.25 + elev * 0.9, 0, 1) * (1 - nightF * 0.65));
    const ground = _c3.copy(horizon).multiplyScalar(0.5);
    for (let i = 0; i < this.skyH.length; i++) {
      const h = this.skyH[i];
      if (h >= 0) {
        const k = Math.pow(h, 0.72);
        colOut.setRGB(
          horizon.r + (zen.r - horizon.r) * k,
          horizon.g + (zen.g - horizon.g) * k,
          horizon.b + (zen.b - horizon.b) * k,
        );
      } else {
        colOut.copy(ground);
      }
      attr.setXYZ(i, colOut.r, colOut.g, colOut.b);
    }
    attr.needsUpdate = true;
    if (this.skyDome.parent) this.skyDome.position.y = 0;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

const WHITE = new THREE.Color(0xffffff);
const ZENITH_BLUE = new THREE.Color(0x2f6fc4);
const _v3 = new THREE.Vector3();
const colOut = new THREE.Color();
const _c3 = new THREE.Color();
