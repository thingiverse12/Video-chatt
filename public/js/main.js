// Klientns huvudloop: nätverk, förutsägelse, rendering, HUD och actions.

import * as THREE from 'three';
import { Net } from './net.js';
import { S } from './state.js';
import { World3D } from './scene.js';
import { Props } from './props.js';
import { ViewModel } from './viewmodel.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { sfx } from './sfx.js';

import { BuildIndex, snapPiece, PIECES, BUILD_ORDER, serializeBlock } from '../../shared/building.js';
import { simulatePlayer, makeQuery } from '../../shared/physics.js';
import { raycastAll, aimVector } from '../../shared/raycast.js';
import { attackStats, ColliderGrid } from '../../shared/nodes.js';
import { ITEMS } from '../../shared/items.js';
import { P, HM_RES, WATER_LEVEL, TEMP, HOTBAR_SIZE } from '../../shared/const.js';
import { clamp } from '../../shared/math.js';

const BUILD_ALL = [...BUILD_ORDER, 'campfire'];

export class Client {
  constructor(opts = {}) {
    this.opts = opts;
    this.canvas = opts.canvas || (typeof document !== 'undefined' ? document.getElementById('gl') : null);
    this.net = new Net(opts.socketFactory);
    this.input = new Input();
    this.hud = new Hud();
    this.world = new World3D(this.canvas, { renderer: opts.renderer, shadows: opts.shadows !== false, pixelRatio: opts.pixelRatio });
    this.props = new Props(this.world);
    this.camera = this.world.camera;
    this.world.scene.add(this.camera);
    this.viewmodel = new ViewModel(this.camera);

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostType = null;
    this.ghostMats = {
      ok: new THREE.MeshBasicMaterial({ color: 0x6fe08a, transparent: true, opacity: 0.42, depthWrite: false }),
      bad: new THREE.MeshBasicMaterial({ color: 0xe0564a, transparent: true, opacity: 0.42, depthWrite: false }),
    };
    this.world.groups.blocks.add(this.ghost);

    this.nodeGrid = new Map();
    this.attackHeld = false;
    this.nextAttack = 0;
    this.nextSend = 0;
    this.bobPhase = 0;
    this.fovBase = 74;
    this.lastFrame = 0;
    this.fpsAvg = 60;
    this.lastTod = 0;
    this._hintT = 0;
    this._mapT = 0;
    this.sens = 1;
    this.invertY = false;
    this.joined = false;
    this.frame = this.frame.bind(this);
  }

  // ---------------------------------------------------------------- boot ---
  boot() {
    this._wireNet();
    this._wireUi();
    this.net.connect();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', () => this.world.resize());
      window.addEventListener('error', (e) => this.reportError(e.message + '\n' + (e.error && e.error.stack || '')));
      window.addEventListener('unhandledrejection', (e) => this.reportError('Promise: ' + (e.reason && e.reason.message || e.reason)));
    }
    if (!this.opts.headless) requestAnimationFrame(this.frame);
    return this;
  }

  reportError(msg) {
    console.error('[klient]', msg);
    if (this.hud) this.hud.error(String(msg).slice(0, 800));
    try { this.net.emit('clientError', String(msg).slice(0, 500)); } catch (e) { /* noop */ }
  }

  _wireUi() {
    const hud = this.hud;
    hud.on('hotbar', (i) => { if (S.ui.buildType) this.selectBuild(i); else { this.net.emit('hotbar', { slot: i }); S.me.held = i; } });
    hud.on('move', (from, to, split) => this.net.emit('inv:move', { from, to, split: !!split }));
    hud.on('drop', (slot) => this.net.emit('inv:drop', { slot, all: true }));
    hud.on('craft', (id, n) => { this.net.emit('craft', { id, n }); sfx.play('ui'); });
    hud.on('buildSelect', (t) => { S.ui.buildType = t; this.setBuildMode(t); this.hud.setPanel(null); sfx.play('ui'); });
    hud.on('boxXfer', (intoBox, idx) => this.net.emit('box:xfer', { in: intoBox, idx, all: false }));
    hud.on('respawn', () => this.net.emit('respawn'));
    hud.on('chat', (text) => this.net.emit('chat', { text }));
    hud.on('lock', () => this.input.requestLock());
    hud.on('typing', (on) => { this.input.typing = on; });
    hud.on('panel', (name) => {
      if (name) { this.input.releaseLock(); }
      else if (this.joined && !S.me.dead) { this.input.requestLock(); }
    });

    if (this.canvas && this.canvas.addEventListener) {
      this.canvas.addEventListener('click', () => {
        if (this.joined && !this.input.locked && !hud.panel) this.input.requestLock();
      });
    }
    this.input.onLockChange = (locked) => {
      S.ui.locked = locked;
      hud.setPauseHint(this.joined && !locked && !hud.panel && !S.me.dead);
    };
    this.input.onKey = (code) => this.onKey(code);
    this.input.onClick = (button) => this.onClick(button);
    if (this.canvas) this.input.attach(this.canvas);
  }

  _wireNet() {
    const n = this.net;
    n.on('connect', () => { this.hud.setMenuStatus && this.hud.setMenuStatus('Ansluten – välj namn och spela'); this.onConnect(); });
    n.on('disconnect', () => { this.hud.toast('Anslutningen avbröts', 'warn'); });
    n.on('error', (m) => { this.hud.toast('Anslutningsfel: ' + m, 'warn'); });
    n.on('pong', (t) => { S.ping = performance.now() - t; });
    n.on('init', (d) => this.onInit(d));
    n.on('state', (d) => this.onState(d));
    n.on('inv', (d) => { S.slots = d.slots; this.hud.setInventory(S.slots, d.held); this.viewmodel.setItem(S.slots[d.held] ? S.slots[d.held].id : null); });
    n.on('nodes', (list) => {
      for (const u of list) {
        const nd = S.nodes.get(u.id);
        if (nd) { nd.amount = u.a; nd.alive = u.alive; if (S.colliders) S.colliders.update(nd); }
        this.props.updateNode(u.id, u.a, u.alive);
      }
    });
    n.on('block:add', (b) => this.addBlock(b));
    n.on('block:upd', (b) => this.updBlock(b));
    n.on('block:del', (d) => this.delBlock(d.id));
    n.on('drop:add', (d) => { S.drops.set(d.id, d); this.props.syncDrop(d); });
    n.on('drop:upd', (d) => { const e = S.drops.get(d.id); if (e) e.amount = d.amount; });
    n.on('drop:del', (d) => { S.drops.delete(d.id); this.props.delDrop(d.id); });
    n.on('fx', (list) => { for (const e of list) this.onFx(e); });
    n.on('loot', (items) => { this.hud.loot(items); for (const it of items) S.stats.gathered[it.item] = (S.stats.gathered[it.item] || 0) + it.qty; });
    n.on('toast', (t) => { this.hud.toast(t.text, t.kind); sfx.play(t.kind === 'warn' ? 'deny' : 'ui'); });
    n.on('chat', (m) => this.hud.chat(m));
    n.on('hitmark', (h) => { this.hud.hitmark(); sfx.play(h.part === 'head' ? 'head' : 'hit'); this.hud.damageNumber(window.innerWidth / 2 + (Math.random() * 40 - 20), window.innerHeight / 2 - 26, '-' + h.dmg, h.part === 'head' ? 'head' : ''); });
    n.on('dealt', (d) => this.hud.damageNumber(window.innerWidth / 2 + (Math.random() * 60 - 30), window.innerHeight / 2 - 40, '-' + d.amount, ''));
    n.on('hurt', (h) => { this.hud.hurtFlash(h.amount); sfx.play('hurt'); this.hud.damageNumber(window.innerWidth / 2 + (Math.random() * 80 - 40), window.innerHeight / 2 + 40, '-' + h.amount, 'me'); if (h.kind === 'cold') this.hud.toast('Du fryser!', 'warn'); });
    n.on('died', (d) => { this.hud.died(d); sfx.play('death'); this.input.releaseLock(); });
    n.on('respawned', () => { this.hud.hideDeath(); S.inputHistory.length = 0; this.input.requestLock(); });
    n.on('crafted', (d) => { sfx.play('craft'); S.stats.crafted += d.n; const it = ITEMS[d.id]; this.hud.toast(`Craftade ${it ? it.name : d.id}${d.n > 1 ? ' ×' + d.n : ''}`, 'good'); });
    n.on('placed', () => { sfx.play('place'); S.stats.built++; });
    n.on('ate', () => sfx.play('eat'));
    n.on('box:open', (d) => { this.hud.setBox(d); S.ui.box = d; });
    n.on('box:upd', (d) => { if (this.hud.box && this.hud.box.id === d.id) { this.hud.box.slots = d.slots; this.hud.renderBoxPanel(); } });
    n.on('box:close', () => { this.hud.setBox(null); S.ui.box = null; });
    n.on('kicked', (k) => this.hud.error('Utsparkad: ' + k.reason));
    n.on('clientError', () => {});
  }

  onConnect() {
    if (this.opts.headless && this.opts.autoJoin) this.join(this.opts.autoJoin.name, this.opts.autoJoin.pid);
  }

  join(name, pid) {
    this.net.emit('join', { name, pid });
    this.joined = true;
  }

  // ---------------------------------------------------------------- init ---
  onInit(d) {
    S.seed = d.seed;
    S.dayLength = d.dayLength;
    S.waterLevel = d.waterLevel;
    S.tod = d.tod;
    S.time = d.time;
    this.lastTod = d.tod;

    S.hm = this.world.init(d.seed);
    S.index = new BuildIndex();

    S.nodes.clear();
    for (const n of d.nodes) {
      S.nodes.set(n.id, { id: n.id, kind: n.k, x: n.x, y: n.y, z: n.z, amount: n.a, max: n.m, alive: n.alive, rot: n.rot, s: n.s, h: n.h, v: n.v });
    }
    this.buildNodeGrid();
    S.colliders = new ColliderGrid();
    S.colliders.build([...S.nodes.values()]);
    S.query = makeQuery(S.hm, S.index, S.colliders);
    const nodeList = [...S.nodes.values()];
    this.props.setNodeData(nodeList);
    this.props.buildNodes(nodeList);

    S.index.clear();
    this.props.clearBlocks();
    for (const b of d.blocks) this.addBlock(b);

    Object.assign(S.me, d.you);
    S.me.vx = S.me.vy = S.me.vz = 0;
    S.slots = d.you.slots || [];
    S.inputHistory.length = 0;
    S.others.clear();
    this.props.syncActors(d.players || []);

    this.hud.setTerrain(S.hm, HM_RES);
    this.hud.setInventory(S.slots, S.me.held);
    this.hud.setVitals(S.me);
    this.hud.setClock(S.tod);
    this.hud.show(true);
    this.hud.setMenu(false);
    this.hud.setLoading(false);
    this.viewmodel.setItem(S.slots[S.me.held] ? S.slots[S.me.held].id : null);
    this.camera.position.set(S.me.x, S.me.y + P.eye, S.me.z);
    S.ready = true;
    this.welcome();
    if (!this.opts.headless) this.input.requestLock();
    if (this.opts.onReady) this.opts.onReady();
  }

  welcome() {
    const t = (ms, text, kind) => setTimeout(() => this.hud.toast(text, kind), ms);
    t(400, `Välkommen till ön, ${S.me.name}!`, 'good');
    t(2600, 'Hugg träd och sten med VÄNSTERKLICK – sikta nära.');
    t(6200, 'C = crafting · B = bygg · Tab = inventarie · E = interagera');
    t(10500, 'Drick vid vatten (E), ät bär, håll dig varm vid elden på natten.', 'warn');
  }

  buildNodeGrid() {
    this.nodeGrid.clear();
    for (const n of S.nodes.values()) {
      const k = Math.floor(n.x / 8) + ',' + Math.floor(n.z / 8);
      let a = this.nodeGrid.get(k);
      if (!a) { a = []; this.nodeGrid.set(k, a); }
      a.push(n);
    }
  }

  nodesNear(x, z, r) {
    const out = [];
    const c0 = Math.floor((x - r) / 8), c1 = Math.floor((x + r) / 8);
    const d0 = Math.floor((z - r) / 8), d1 = Math.floor((z + r) / 8);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.nodeGrid.get(i + ',' + j);
      if (a) for (const n of a) out.push(n);
    }
    return out;
  }

  addBlock(b) {
    const block = { ...b };
    S.index.add(block);
    this.props.addBlock(block);
  }
  updBlock(b) {
    const old = S.index.get(b.id);
    if (!old) { this.addBlock(b); return; }
    Object.assign(old, b);
    old._boxes = null;
    S.index.add(old);
    this.props.updBlock(old);
  }
  delBlock(id) {
    S.index.remove(id);
    this.props.delBlock(id);
    if (S.ui.box && S.ui.box.id === id) this.hud.setBox(null);
  }

  // --------------------------------------------------------------- state ---
  onState(d) {
    S.tod = d.tod;
    S.time = d.t;
    if (this.lastTod > 0.85 && d.tod < 0.15) this.hud.bumpDay();
    this.lastTod = d.tod;

    S.others.clear();
    for (const p of d.players || []) S.others.set(p.id, p);
    this.props.syncActors(d.players || []);
    this.props.syncProjectiles(d.projs || []);
    this.hud.setRoster([...(d.players || []).map((p) => ({ name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, dead: p.dead })),
      { name: S.me.name + ' (du)', kills: S.me.kills, deaths: S.me.deaths, dead: S.me.dead }]);

    const you = d.you;
    if (!you) return;
    const wasDead = S.me.dead;
    // bevara lokala värden som servern inte bestämmer
    const localYaw = S.me.yaw, localPitch = S.me.pitch;
    S.me.hp = you.hp; S.me.hunger = you.hunger; S.me.thirst = you.thirst; S.me.temp = you.temp;
    S.me.wet = you.wet; S.me.dead = you.dead; S.me.respawnIn = you.respawnIn;
    S.me.kills = you.kills; S.me.deaths = you.deaths; S.me.inWater = you.inWater;
    S.me.held = you.held; S.me.pid = you.pid;
    if (you.held !== this.hud.held) this.hud.setInventory(S.slots, you.held);

    const err = Math.hypot(you.x - S.me.x, you.z - S.me.z) + Math.abs(you.y - S.me.y);
    if (err > 12 || (you.dead && !wasDead) || S.me.respawnIn === 0 && wasDead) {
      S.inputHistory.length = 0;
    }
    S.me.x = you.x; S.me.y = you.y; S.me.z = you.z;
    S.me.vy = you.vy; S.me.onGround = you.onGround;
    S.me.yaw = localYaw; S.me.pitch = localPitch;
    S.lastSelf = you;

    // spela upp alla input som servern ännu inte hunnit med
    const mods = this.speedMods();
    for (const h of S.inputHistory) {
      if (h.seq > you.seq) simulatePlayer(S.me, h.input, h.dt, S.query, mods);
    }
    while (S.inputHistory.length && S.inputHistory[0].seq <= you.seq) S.inputHistory.shift();
    if (S.inputHistory.length > 120) S.inputHistory.splice(0, S.inputHistory.length - 120);

    if (you.dead) this.hud.setRespawnTimer(you.respawnIn);
  }

  speedMods() {
    const m = { speedMul: 1 };
    if (S.me.hunger < 12) m.speedMul *= 0.85;
    if (S.me.temp < TEMP.coldThreshold) m.speedMul *= 0.9;
    if (S.me.hp < 30) m.speedMul *= 0.92;
    return m;
  }

  // ---------------------------------------------------------------- loop ---
  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    this.fpsAvg = this.fpsAvg * 0.92 + (1 / dt) * 0.08;
    if (!S.ready) { this.world.render(); return; }

    this.handleLook();
    this.handleActions(now);
    this.predict(dt);
    this.sendInput(now);
    this.updateCamera(dt);
    this.updateGhost();
    this.updateHints(now);

    this.world.setEnvironment(S.tod, this.camera.position, this.camera.position.y < S.waterLevel);
    this.props.update(dt, this.camera.position, S.tod);
    this.viewmodel.update(dt, S.me.moving, S.me.sprinting, this._lastYawDelta || 0);
    this.world.render();

    this.hud.setVitals(S.me);
    this.hud.setClock(S.tod);
    this.hud.setCompass(S.me.yaw);
    this.hud.setNet(S.others.size + 1, S.ping, this.fpsAvg);
    this.hud.drawMap(S.me, S.nodes, S.index.blocks, S.others, now);
  }

  handleLook() {
    const m = this.input.consumeMouse();
    if (!this.input.locked) { this._lastYawDelta = 0; return; }
    const sens = 0.0022 * this.sens;
    const dy = m.dx * sens;
    S.me.yaw -= dy;
    S.me.pitch -= m.dy * sens * (this.invertY ? -1 : 1);
    S.me.pitch = clamp(S.me.pitch, -1.5533, 1.5533);
    if (S.me.yaw > Math.PI) S.me.yaw -= Math.PI * 2;
    if (S.me.yaw < -Math.PI) S.me.yaw += Math.PI * 2;
    this._lastYawDelta = dy;
    const w = this.input.consumeWheel();
    if (w) {
      if (S.ui.buildType) {
        const i = BUILD_ALL.indexOf(S.ui.buildType);
        this.selectBuild((i + w + BUILD_ALL.length) % BUILD_ALL.length);
      } else {
        const nh = (S.me.held + w + HOTBAR_SIZE) % HOTBAR_SIZE;
        this.net.emit('hotbar', { slot: nh });
        S.me.held = nh;
      }
    }
  }

  predict(dt) {
    if (S.me.dead) { S.me.vx = S.me.vy = S.me.vz = 0; return; }
    const input = this.input.movement();
    if (this.hud.panel || this.input.typing || !this.input.locked || this.opts.headless === 'nomove') {
      input.f = input.b = input.l = input.r = false; input.sprint = false; input.jump = false;
    }
    S.me.seq++;
    S.inputHistory.push({ seq: S.me.seq, input: { ...input }, dt });
    simulatePlayer(S.me, input, dt, S.query, this.speedMods());
  }

  sendInput(now) {
    if (now < this.nextSend) return;
    this.nextSend = now + 45;
    const i = this.input.movement();
    if (this.hud.panel || this.input.typing || !this.input.locked) { i.f = i.b = i.l = i.r = false; i.sprint = false; i.jump = false; }
    this.net.emit('input', { seq: S.me.seq, ...i, yaw: S.me.yaw, pitch: S.me.pitch });
  }

  updateCamera(dt) {
    const speed = Math.hypot(S.me.vx || 0, S.me.vz || 0);
    this.bobPhase += dt * (speed > 0.4 ? speed * 1.9 : 1.2);
    const bob = S.me.onGround ? Math.sin(this.bobPhase * 2) * 0.028 * clamp(speed / 4, 0, 1.3) : 0;
    const camY = S.me.y + P.eye + bob;
    this.camera.position.set(S.me.x, camY, S.me.z);
    this.camera.rotation.set(S.me.pitch, S.me.yaw, Math.sin(this.bobPhase) * 0.006 * clamp(speed / 4, 0, 1));
    const targetFov = this.fovBase + (S.me.sprinting ? 4.5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    this.viewmodel.setVisible(this.input.locked && !this.hud.panel && !S.me.dead);
    const held = S.slots[S.me.held];
    this.viewmodel.setItem(held ? held.id : null);
    this.hud.setWater(this.camera.position.y < S.waterLevel, S.me.wet);
  }

  // ------------------------------------------------------------- actions ---
  onClick(button) {
    if (!this.input.locked) return;
    if (button === 0) {
      if (S.ui.buildType) { this.place(); }
      else { this.attackHeld = true; this.doAttack(); }
    } else if (button === 2) {
      if (S.ui.buildType) this.setBuildMode(null);
      else this.useHeld();
    }
  }

  onKey(code) {
    if (this.input.typing) return;
    const panel = this.hud.panel;
    if (code === 'Escape') {
      if (panel === 'box') { this.net.emit('box:close'); this.hud.setBox(null); }
      else if (S.ui.buildType) this.setBuildMode(null);
      else if (panel) this.hud.setPanel(null);
      return;
    }
    if (code === 'Tab') { this.hud.togglePanel('inv'); sfx.play('ui'); return; }
    if (code === 'KeyC') { this.hud.togglePanel('craft'); sfx.play('ui'); return; }
    if (code === 'KeyB') {
      if (S.ui.buildType) { this.setBuildMode(null); return; }
      this.hud.togglePanel('build'); sfx.play('ui'); return;
    }
    if (code.startsWith('Digit')) {
      const n = parseInt(code.slice(5), 10) - 1;
      if (S.ui.buildType || this.hud.panel === 'build') { if (n >= 0 && n < BUILD_ALL.length) this.selectBuild(n); }
      else if (n >= 0 && n < HOTBAR_SIZE) { this.net.emit('hotbar', { slot: n }); S.me.held = n; sfx.play('ui'); }
      return;
    }
    if (code === 'KeyE' || code === 'KeyF') { this.net.emit('interact', { yaw: S.me.yaw, pitch: S.me.pitch }); return; }
    if (code === 'KeyU') { this.net.emit('upgrade', { yaw: S.me.yaw, pitch: S.me.pitch }); return; }
    if (code === 'KeyX') { this.net.emit('demolish', { yaw: S.me.yaw, pitch: S.me.pitch }); return; }
    if (code === 'KeyQ') { this.net.emit('inv:drop', { slot: S.me.held, all: false }); return; }
    if (code === 'KeyR' && S.me.dead) { this.net.emit('respawn'); return; }
    if (code === 'KeyT') { this.hud.setChatOpen(true); return; }
    if (code === 'KeyG') { this.useHeld(); return; }
  }

  selectBuild(i) {
    const t = BUILD_ALL[i];
    if (!t) return;
    S.ui.buildType = t;
    this.hud.buildType = t;
    this.hud.setBuildMode(t);
    this.buildGhost(t);
    sfx.play('ui');
  }

  setBuildMode(type) {
    S.ui.buildType = type || null;
    this.hud.setBuildMode(S.ui.buildType);
    if (type) this.buildGhost(type);
    else { this.ghost.visible = false; this.hud.setBuildHint(null); }
  }

  buildGhost(type) {
    while (this.ghost.children.length) this.ghost.remove(this.ghost.children[0]);
    const obj = this.props.buildBlockMesh({ type, tier: 'wood', rot: 0, x: 0, y: 0, z: 0, open: false });
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = this.ghostMats.ok; } });
    this.ghost.add(obj);
    this.ghostType = type;
    this.ghost.visible = true;
  }

  aimRay(maxDist) {
    const o = { x: S.me.x, y: S.me.y + P.eye, z: S.me.z };
    const d = aimVector(S.me.yaw, S.me.pitch);
    const nodes = this.nodesNear(o.x + d.x * maxDist * 0.5, o.z + d.z * maxDist * 0.5, maxDist * 0.5 + 9);
    return raycastAll({ hm: S.hm, index: S.index, nodes, players: null, o, d, maxDist, excludeId: S.me.id });
  }

  place() {
    if (!S.ui.buildType) return;
    const hit = this.aimRay(P.reach + 6);
    const aim = hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
    if (!aim) { this.hud.toast('Rikta mot marken eller en byggnad', 'warn'); return; }
    this.net.emit('place', { type: S.ui.buildType, aim, yaw: S.me.yaw, pitch: S.me.pitch });
  }

  useHeld() {
    const s = S.slots[S.me.held];
    if (!s) return;
    this.net.emit('inv:use', { slot: S.me.held });
  }

  doAttack() {
    const now = performance.now();
    if (now < this.nextAttack) return;
    const held = S.slots[S.me.held];
    const st = attackStats(held ? held.id : null);
    this.nextAttack = now + st.rate * 1000;
    this.viewmodel.doSwing(st.ranged ? 0.55 : 1);
    this.net.emit('attack', { yaw: S.me.yaw, pitch: S.me.pitch });
    sfx.play(st.ranged ? 'bow' : 'swing');
  }

  handleActions(now) {
    if (this.attackHeld && !this.input.mouse.left) this.attackHeld = false;
    if (this.attackHeld && this.input.locked && !S.ui.buildType && !S.me.dead && !this.hud.panel) this.doAttack();
  }

  updateGhost() {
    if (!S.ui.buildType || !this.ghostType) { this.ghost.visible = false; return; }
    if (this.ghostType !== S.ui.buildType) this.buildGhost(S.ui.buildType);
    const hit = this.aimRay(P.reach + 6);
    if (!hit) { this.ghost.visible = false; this.hud.setBuildHint('Rikta mot marken', false); return; }
    const res = snapPiece(S.ui.buildType, { x: hit.x, y: hit.y, z: hit.z }, S.index, S.hm, S.me);
    this.ghost.visible = true;
    if (res.ok) {
      this.ghost.position.set(res.piece.x, res.piece.y, res.piece.z);
      this.ghost.rotation.y = (res.piece.rot || 0) * Math.PI / 2;
      this.ghost.traverse((o) => { if (o.isMesh) o.material = this.ghostMats.ok; });
      const cost = S.ui.buildType === 'campfire' ? { campfire: 1 } : (PIECES[S.ui.buildType].cost || {});
      const costTxt = Object.keys(cost).map((k) => `${cost[k]} ${ITEMS[k] ? ITEMS[k].name : k}`).join(' + ') || 'gratis';
      this.hud.setBuildHint(`<b>${PIECES[S.ui.buildType].name}</b> · kostar ${costTxt} · [vänsterklick] placera`, true);
    } else {
      const p = { x: hit.x, y: hit.y + 0.4, z: hit.z };
      this.ghost.position.set(p.x, p.y, p.z);
      this.ghost.rotation.y = 0;
      this.ghost.traverse((o) => { if (o.isMesh) o.material = this.ghostMats.bad; });
      this.hud.setBuildHint(`<b>${PIECES[S.ui.buildType].name}</b> · ${res.reason}`, false);
    }
  }

  updateHints(now) {
    if (now - this._hintT < 110) return;
    this._hintT = now;
    if (S.ui.buildType || S.me.dead) { this.hud.setInteract(null); return; }
    const hit = this.aimRay(P.reach);
    if (!hit) { this.hud.setInteract(null); return; }
    const kb = (k) => `<kbd>${k}</kbd>`;
    if (hit.kind === 'node') {
      const n = hit.node;
      const held = S.slots[S.me.held];
      const st = attackStats(held ? held.id : null);
      const label = n.kind === 'tree' ? 'Träd' : n.kind === 'rock' ? 'Sten' : n.kind === 'metal' ? 'Metallmalm' : 'Bärbuske';
      const pct = Math.round((n.amount / n.max) * 100);
      if (n.kind === 'bush') this.hud.setInteract(`${kb('E')} Plocka bär · ${label} ${pct}%`);
      else this.hud.setInteract(`${kb('Klick')} Hugg ${label} · ${pct}% kvar`);
      return;
    }
    if (hit.kind === 'block') {
      const b = hit.block;
      const p = PIECES[b.type];
      const tier = b.tier && b.tier !== 'wood' ? ` (${b.tier === 'stone' ? 'sten' : 'metall'})` : '';
      const hp = b.hp < b.maxHp ? ` · ${Math.round(b.hp)}/${b.maxHp} hp` : '';
      const mine = b.owner && b.owner === S.me.pid;
      if (b.type === 'door') { this.hud.setInteract(`${kb('E')} ${b.open ? 'Stäng' : 'Öppna'} dörr${hp}`); return; }
      if (b.type === 'box') { this.hud.setInteract(`${kb('E')} Öppna låda${hp}`); return; }
      if (b.type === 'campfire') { this.hud.setInteract(`Lägereld – värmer dig${hp}`); return; }
      this.hud.setInteract(`${p ? p.name : b.type}${tier}${hp}${mine ? ` · ${kb('U')} uppgradera · ${kb('X')} riv` : ' · inte din'}`);
      return;
    }
    if (hit.kind === 'water') { this.hud.setInteract(`${kb('E')} Drick vatten`); return; }
    this.hud.setInteract(null);
  }

  onFx(e) {
    this.props.fx(e);
    if (e.k === 'gather') {
      const kind = e.kind;
      sfx.play(kind === 'tree' || kind === 'bush' ? 'chop' : 'mine');
    } else if (e.k === 'break') sfx.play('break');
    else if (e.k === 'place') sfx.play('place');
    else if (e.k === 'upgrade') sfx.play('levelup');
    else if (e.k === 'door') sfx.play('door');
    else if (e.k === 'splash') sfx.play('drink');
  }
}

// ------------------------------------------------------------------ start ---
export function startClient(opts = {}) {
  const c = new Client(opts);
  c.boot();
  if (typeof window !== 'undefined') window.__client = c;
  return c;
}

if (typeof window !== 'undefined' && !window.__HEADLESS__) {
  const c = startClient();

  // meny-logik
  const menu = document.getElementById('menu');
  const playBtn = document.getElementById('playbtn');
  const nameField = document.getElementById('namefield');
  const status = document.getElementById('menustatus');
  const loading = document.getElementById('loading');

  let pid = localStorage.getItem('rust_pid');
  if (!pid) { pid = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('rust_pid', pid); }
  nameField.value = localStorage.getItem('rust_name') || '';
  if (status) status.textContent = 'Ansluter…';

  c.net.on('connect', () => { if (status) status.textContent = 'Servern är ansluten – skriv ett namn och spela'; });
  fetch('/api/stats').then((r) => r.json()).then((st) => {
    const s = document.getElementById('menuseed'); if (s) s.textContent = st.seed;
    const p = document.getElementById('menuping'); if (p) p.textContent = st.players + ' spelare online';
  }).catch(() => {});

  const doJoin = () => {
    const name = (nameField.value || '').trim() || 'Namnlös';
    localStorage.setItem('rust_name', name);
    playBtn.disabled = true;
    if (status) status.textContent = 'Laddar världen…';
    if (loading) loading.classList.remove('hidden');
    c.join(name, pid);
  };
  playBtn.addEventListener('click', doJoin);
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  // inställningar
  const sens = document.getElementById('optsensivity');
  if (sens) sens.addEventListener('input', () => { c.sens = sens.value / 100; });
  const inv = document.getElementById('optsens');
  if (inv) inv.addEventListener('change', () => { c.invertY = inv.checked; });
  const fov = document.getElementById('optfov');
  if (fov) fov.addEventListener('input', () => { c.fovBase = +fov.value; c.camera.fov = +fov.value; c.camera.updateProjectionMatrix(); });
  const sh = document.getElementById('optshadows');
  if (sh) sh.addEventListener('change', () => {
    c.world.renderer.shadowMap.enabled = sh.checked;
    c.world.sun.castShadow = sh.checked;
    c.world.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  });

  c.opts.onReady = () => { if (menu) menu.classList.add('hidden'); if (loading) loading.classList.add('hidden'); };
  c.hud.on('lock', () => c.input.requestLock());
}
