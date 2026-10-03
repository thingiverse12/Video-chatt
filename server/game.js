// Auktoritativ spellogik: spelare, överlevnad, resurser, crafting,
// byggande, strid, projektiler och snapshots.

import { World } from './world.js';
import { loadSave, writeSave } from './persistence.js';
import {
  BuildIndex, PIECES, snapPiece, blockKey, serializeBlock, blockBoxes,
  pieceHp, nextTier, upgradeCost, buildCost,
} from '../shared/building.js';
import {
  ITEMS, RECIPES, addItem, removeItem, countItem, canAfford, payCost,
  moveSlot, splitSlot, emptySlots,
} from '../shared/items.js';
import { gatherFrom, attackStats, NODES } from '../shared/nodes.js';
import { simulatePlayer, makeQuery, fallDamage } from '../shared/physics.js';
import { raycastAll, aimVector } from '../shared/raycast.js';
import {
  TICK_RATE, SNAPSHOT_RATE, DAY_LENGTH, START_TOD, DEFAULT_SEED, MAX_PLAYERS,
  P, SURVIVAL, TEMP, INVENTORY_SIZE, HOTBAR_SIZE, BOX_SLOTS, RESPAWN_DELAY,
  WATER_LEVEL, HALF,
} from '../shared/const.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(io) {
    this.io = io;
    const save = loadSave();
    this.seed = (save && save.seed) ? save.seed : (process.env.SEED ? parseInt(process.env.SEED, 10) : DEFAULT_SEED);
    this.world = new World(this.seed);
    this.index = new BuildIndex();
    this.query = makeQuery(this.world.hm, this.index, this.world.colliders);

    this.players = new Map();      // socketId -> player
    this.profiles = new Map();     // pid -> profil (persistent)
    this.projectiles = [];
    this.drops = [];
    this.fx = [];
    this.time = 0;
    this.tod = START_TOD;
    this.nextBlock = 1;
    this.nextProj = 1;
    this.nextDrop = 1;
    this.saveDirty = false;

    if (save && Array.isArray(save.profiles)) {
      for (const pr of save.profiles) if (pr && pr.pid) this.profiles.set(pr.pid, pr);
    }
    if (save && Array.isArray(save.blocks)) {
      for (const b of save.blocks) this.addBlockRaw(b);
      console.log(`[värld] ${save.blocks.length} byggdelar laddade`);
    }
    if (save && save.tod) this.tod = save.tod;

    console.log(`[värld] frö ${this.seed}, ${this.world.nodes.length} resurspunkter, ${this.world.spawns.length} spawn-punkter`);

    this.lastTick = Date.now();
    this.snapAcc = 0;
    this.saveAcc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  // ---------------------------------------------------------------- värld ---
  addBlockRaw(b) {
    const block = {
      id: b.id || 'b' + this.nextBlock++,
      type: b.type, tier: b.tier || 'wood',
      x: b.x, y: b.y, z: b.z, rot: b.rot || 0,
      hp: b.hp || pieceHp(b.type, b.tier || 'wood'),
      maxHp: b.maxHp || pieceHp(b.type, b.tier || 'wood'),
      owner: b.owner || '',
      open: !!b.open,
      parentId: b.parentId || null,
      parentKey: b.parentKey || null,
      slots: b.type === 'box' ? (b.slots || emptySlots(BOX_SLOTS)) : undefined,
    };
    const n = parseInt(String(block.id).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n >= this.nextBlock) this.nextBlock = n + 1;
    this.index.add(block);
    return block;
  }

  eye(p) { return { x: p.x, y: p.y + P.eye, z: p.z }; }

  alivePlayers() {
    const out = [];
    for (const p of this.players.values()) if (!p.dead) out.push(p);
    return out;
  }

  // ------------------------------------------------------------- spelare ---
  join(socket, data) {
    if (this.players.size >= MAX_PLAYERS) {
      socket.emit('kicked', { reason: 'Servern är full' });
      socket.disconnect(true);
      return null;
    }
    const pid = String(data.pid || '').slice(0, 40) || socket.id;
    const name = (String(data.name || 'Namnlös').trim().slice(0, 16)) || 'Namnlös';
    let profile = this.profiles.get(pid);
    if (!profile) {
      profile = { pid, name, slots: emptySlots(INVENTORY_SIZE), kills: 0, deaths: 0, playtime: 0 };
      this.profiles.set(pid, profile);
    }
    profile.name = name;
    profile.slots = this.sanitizeSlots(profile.slots);

    const others = [...this.players.values()];
    const spawn = this.world.randomSpawn(others);
    const p = {
      id: socket.id, pid, name, socket,
      x: spawn.x, y: spawn.y, z: spawn.z,
      vx: 0, vy: 0, vz: 0,
      yaw: spawn.yaw || 0, pitch: 0,
      onGround: true, inWater: false, wading: false,
      hp: P.maxHp, hunger: 78, thirst: 82, temp: TEMP.baseDay * 0.9, wetT: 0,
      dead: false, respawnAt: 0, minVy: 0,
      slots: profile.slots, held: 0,
      kills: profile.kills || 0, deaths: profile.deaths || 0, playtime: profile.playtime || 0,
      input: { f: false, b: false, l: false, r: false, jump: false, sprint: false },
      seq: 0, nextAttack: 0, nextInteract: 0, nextPlace: 0, nextChat: 0, nextDrink: 0,
      swing: -10, hurt: -10, openBox: null, joinedAt: this.time,
    };
    this.players.set(socket.id, p);
    profile.ref = p;

    socket.emit('init', {
      seed: this.seed, tod: this.tod, dayLength: DAY_LENGTH, waterLevel: WATER_LEVEL,
      you: this.packSelf(p, true),
      nodes: this.world.serializeNodes(),
      blocks: this.index.all().map(serializeBlock),
      players: this.packOthers(p),
      time: this.time,
    });
    this.sendInv(p);
    this.sysChat(`${name} kom till ön`);
    this.saveDirty = true;
    return p;
  }

  sanitizeSlots(slots) {
    const out = emptySlots(INVENTORY_SIZE);
    if (!Array.isArray(slots)) return out;
    for (let i = 0; i < Math.min(slots.length, INVENTORY_SIZE); i++) {
      const s = slots[i];
      if (!s || !ITEMS[s.id]) continue;
      const amount = Math.max(1, Math.min(ITEMS[s.id].stack, Math.floor(Number(s.amount) || 1)));
      out[i] = { id: s.id, amount };
      if (ITEMS[s.id].dur) out[i].dur = Math.max(0, Math.min(ITEMS[s.id].dur, Math.floor(Number(s.dur) || ITEMS[s.id].dur)));
    }
    return out;
  }

  leave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    const profile = this.profiles.get(p.pid);
    if (profile) {
      profile.slots = p.slots;
      profile.kills = p.kills; profile.deaths = p.deaths;
      profile.playtime = (profile.playtime || 0) + (this.time - p.joinedAt);
      profile.name = p.name;
    }
    if (p.openBox) p.openBox = null;
    profile.ref = null;
    this.sysChat(`${p.name} lämnade ön`);
    this.save();
  }

  packSelf(p, full = false) {
    const o = {
      id: p.id, pid: p.pid, name: p.name,
      x: r2(p.x), y: r2(p.y), z: r2(p.z), vy: r2(p.vy),
      yaw: r2(p.yaw), pitch: r2(p.pitch), seq: p.seq,
      hp: Math.round(p.hp), hunger: Math.round(p.hunger), thirst: Math.round(p.thirst),
      temp: Math.round(p.temp), wet: p.wetT > 0, onGround: p.onGround, inWater: p.inWater,
      dead: p.dead, respawnIn: p.dead ? Math.max(0, Math.round(p.respawnAt - this.time)) : 0,
      held: p.held, kills: p.kills, deaths: p.deaths,
    };
    if (full) o.slots = p.slots;
    return o;
  }

  packOthers(me) {
    const out = [];
    for (const p of this.players.values()) {
      if (p.id === me.id) continue;
      out.push({
        id: p.id, name: p.name, x: r2(p.x), y: r2(p.y), z: r2(p.z),
        yaw: r2(p.yaw), pitch: r2(p.pitch), hp: Math.round(p.hp), dead: p.dead,
        swing: r2(p.swing), item: p.slots[p.held] ? p.slots[p.held].id : null,
        moving: p.moving ? 1 : 0, sprint: p.sprinting ? 1 : 0, inWater: p.inWater ? 1 : 0,
      });
    }
    return out;
  }

  sendInv(p) { p.socket.emit('inv', { slots: p.slots, held: p.held }); }

  toast(p, text, kind = 'info') { p.socket.emit('toast', { text, kind }); }
  sysChat(text) { this.io.emit('chat', { sys: true, text }); }

  // ---------------------------------------------------------------- tick ---
  tick() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) return;
    this.time += dt;
    this.tod = (this.tod + dt / DAY_LENGTH) % 1;

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.world.tick(this.time);
    this.updateProjectiles(dt);
    this.updateDrops(dt);

    // noder som ändrats
    const nodes = this.world.takeDirty();
    if (nodes) this.io.emit('nodes', nodes);

    if (this.fx.length) { this.io.emit('fx', this.fx); this.fx.length = 0; }

    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_RATE) {
      this.snapAcc = 0;
      this.broadcast();
    }

    this.saveAcc += dt;
    if (this.saveAcc > 20) { this.saveAcc = 0; if (this.saveDirty) this.save(); }
  }

  broadcast() {
    for (const p of this.players.values()) {
      p.socket.emit('state', {
        t: r2(this.time), tod: this.tod,
        you: this.packSelf(p),
        players: this.packOthers(p),
        projs: this.projectiles.map((q) => ({ id: q.id, x: r2(q.x), y: r2(q.y), z: r2(q.z) })),
      });
    }
  }

  updatePlayer(p, dt) {
    if (p.dead) {
      if (this.time >= p.respawnAt) this.respawn(p);
      return;
    }
    p.playtime += dt;

    // rörelse
    const before = p.onGround;
    const mods = { speedMul: 1 };
    if (p.hunger < 12) mods.speedMul *= 0.85;
    if (p.temp < TEMP.coldThreshold) mods.speedMul *= 0.9;
    if (p.hp < 30) mods.speedMul *= 0.92;
    simulatePlayer(p, p.input, dt, this.query, mods);

    // fallskada
    if (!p.onGround && !p.inWater) p.minVy = Math.min(p.minVy, p.vy);
    if (p.onGround && !before) {
      const dmg = fallDamage(p.minVy);
      if (dmg > 0) { this.pushFx('land', { x: p.x, y: p.y, z: p.z }); this.damagePlayer(p, dmg, null, 'fall'); }
      p.minVy = 0;
    }
    if (p.inWater) p.minVy = 0;

    // överlevnad
    const active = p.moving;
    const sprinting = p.sprinting;
    p.hunger = Math.max(0, p.hunger - (sprinting ? SURVIVAL.hungerSprint : active ? SURVIVAL.hunger * 1.35 : SURVIVAL.hunger) * dt);
    p.thirst = Math.max(0, p.thirst - (sprinting ? SURVIVAL.thirstSprint : active ? SURVIVAL.thirst * 1.3 : SURVIVAL.thirst) * dt);

    const night = this.isNight();
    let target = night ? TEMP.baseNight : TEMP.baseDay;
    if (p.inWater) target -= TEMP.waterPenalty;
    else if (p.wetT > 0) target -= TEMP.wetPenalty;
    const fire = this.fireWarmth(p);
    if (fire > 0) target = Math.min(100, target + fire);
    if (this.isSheltered(p)) target = Math.min(100, target + 10);
    p.temp += (target - p.temp) * Math.min(1, dt * 0.18);
    p.temp = Math.max(0, Math.min(P.maxTemp, p.temp));

    if (p.inWater) p.wetT = SURVIVAL.wetSeconds; else p.wetT = Math.max(0, p.wetT - dt);

    let dmg = 0;
    if (p.temp < TEMP.coldThreshold) dmg += SURVIVAL.coldDamage * (1 - p.temp / TEMP.coldThreshold);
    if (p.hunger <= 0) dmg += SURVIVAL.starveDamage;
    if (p.thirst <= 0) dmg += SURVIVAL.dehydrateDamage;
    if (dmg > 0) {
      p.hp -= dmg * dt;
      p.coldTick = (p.coldTick || 0) + dmg * dt;
      if (p.coldTick > 4) { p.coldTick = 0; p.socket.emit('hurt', { amount: 4, kind: p.temp < TEMP.coldThreshold ? 'cold' : 'starve' }); }
      if (p.hp <= 0) this.die(p, null, p.temp < TEMP.coldThreshold ? 'kylan' : 'svält/törst');
    } else if (p.hunger > 55 && p.thirst > 45 && p.temp > 32 && p.hp < P.maxHp) {
      p.hp = Math.min(P.maxHp, p.hp + SURVIVAL.regen * dt);
    }
  }

  isNight() { return this.tod < 0.22 || this.tod > 0.80; }

  fireWarmth(p) {
    let best = 0;
    for (const b of this.index.near(p.x, p.z, TEMP.fireRadius + 2)) {
      if (b.type !== 'campfire') continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < TEMP.fireRadius) best = Math.max(best, TEMP.fireBonus * (1 - d / TEMP.fireRadius));
    }
    return best;
  }

  /** Enkel tak-over-test: finns ett golv/tak ovanför spelaren? */
  isSheltered(p) {
    for (const b of this.index.near(p.x, p.z, 3)) {
      if (b.type !== 'foundation' && b.type !== 'roof') continue;
      if (b.y > p.y + 1.2 && Math.abs(b.x - p.x) < 2.2 && Math.abs(b.z - p.z) < 2.2) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- strid ---
  attack(socketId, data) {
    this.setAim(socketId, data);
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const held = p.slots[p.held];
    const st = attackStats(held ? held.id : null);
    if (this.time < p.nextAttack) return;
    p.nextAttack = this.time + st.rate;
    p.swing = this.time;

    if (st.ranged) { this.fireBow(p, st, held); return; }

    const o = this.eye(p);
    const d = aimVector(p.yaw, p.pitch);
    const hit = raycastAll({
      hm: this.world.hm, index: this.index, nodes: this.world.nodes, players: this.alivePlayers(),
      o, d, maxDist: st.range, excludeId: p.id,
    });
    if (!hit) { this.pushFx('swing', { x: o.x + d.x * st.range, y: o.y + d.y * st.range, z: o.z + d.z * st.range }); return; }

    if (hit.kind === 'node') {
      this.harvest(p, hit.node, hit, held);
      this.wearDown(p, held);
    } else if (hit.kind === 'block') {
      this.damageBlock(hit.block, st.dmg * 1.6, p, hit);
      this.wearDown(p, held);
    } else if (hit.kind === 'player') {
      const dmg = Math.round(st.dmg * (hit.mul || 1));
      this.pushFx('blood', { x: hit.x, y: hit.y, z: hit.z, n: 8 });
      p.socket.emit('hitmark', { dmg, part: hit.part, kill: false });
      this.damagePlayer(hit.player, dmg, p, 'melee', hit.part);
      this.wearDown(p, held);
    } else {
      this.pushFx(hit.water ? 'splash' : 'dust', { x: hit.x, y: hit.y, z: hit.z, n: 5 });
    }
  }

  wearDown(p, held) {
    if (!held || !held.dur) return;
    held.dur -= 1;
    if (held.dur <= 0) {
      const name = ITEMS[held.id] ? ITEMS[held.id].name : held.id;
      p.slots[p.held] = null;
      this.toast(p, `${name} gick sönder`, 'warn');
      this.sendInv(p);
    } else if (held.dur % 10 === 0) {
      this.sendInv(p);
    }
  }

  harvest(p, node, hit, held) {
    const { loot, damage } = gatherFrom(node.kind, held ? held.id : null);
    const gained = [];
    for (const l of loot) {
      const got = addItem(p.slots, l.item, l.qty);
      if (got > 0) gained.push({ item: l.item, qty: got });
    }
    if (gained.length) { p.socket.emit('loot', gained); this.sendInv(p); }
    else this.toast(p, 'Inventariet är fullt', 'warn');

    const kind = node.kind;
    const depleted = this.world.damageNode(node.id, damage, this.time);
    this.pushFx('gather', { x: hit.x, y: hit.y, z: hit.z, kind, n: depleted ? 14 : 6 });
    if (depleted) this.pushFx('depleted', { x: node.x, y: node.y, z: node.z, kind });
    this.saveDirty = true;
  }

  fireBow(p, st, held) {
    if (!countItem(p.slots, 'arrow')) { this.toast(p, 'Du har inga pilar', 'warn'); p.nextAttack = this.time + 0.3; return; }
    removeItem(p.slots, 'arrow', 1);
    this.sendInv(p);
    const o = this.eye(p);
    const d = aimVector(p.yaw, p.pitch);
    const sp = st.projSpeed;
    this.projectiles.push({
      id: this.nextProj++, owner: p.id, ownerPid: p.pid,
      x: o.x + d.x * 0.55, y: o.y + d.y * 0.55 - 0.1, z: o.z + d.z * 0.55,
      vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
      dmg: st.dmg, life: 6,
    });
    this.wearDown(p, held);
  }

  updateProjectiles(dt) {
    const sub = 4;
    const sdt = dt / sub;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const q = this.projectiles[i];
      q.life -= dt;
      let remove = q.life <= 0;
      for (let s = 0; s < sub && !remove; s++) {
        q.vy -= 11 * sdt;
        const dx = q.vx * sdt, dy = q.vy * sdt, dz = q.vz * sdt;
        const len = Math.hypot(dx, dy, dz) || 1e-6;
        const hit = raycastAll({
          hm: this.world.hm, index: this.index, nodes: this.world.nodes, players: this.alivePlayers(),
          o: { x: q.x, y: q.y, z: q.z }, d: { x: dx / len, y: dy / len, z: dz / len },
          maxDist: len + 0.05, excludeId: q.owner, hitWater: false,
        });
        if (hit && hit.kind !== 'water') {
          remove = true;
          if (hit.kind === 'player') {
            const dmg = Math.round(q.dmg * (hit.mul || 1));
            this.pushFx('blood', { x: hit.x, y: hit.y, z: hit.z, n: 10 });
            const shooter = this.players.get(q.owner);
            if (shooter) shooter.socket.emit('hitmark', { dmg, part: hit.part, kill: false });
            this.damagePlayer(hit.player, dmg, shooter, 'pil', hit.part);
          } else if (hit.kind === 'block') {
            this.damageBlock(hit.block, q.dmg * 0.7, null, hit);
            this.pushFx('spark', { x: hit.x, y: hit.y, z: hit.z, n: 4 });
          } else if (hit.kind === 'node') {
            this.world.damageNode(hit.node.id, 2, this.time);
            this.pushFx('gather', { x: hit.x, y: hit.y, z: hit.z, kind: hit.node.kind, n: 3 });
          } else {
            this.pushFx('dust', { x: hit.x, y: hit.y, z: hit.z, n: 4 });
          }
          break;
        }
        q.x += dx; q.y += dy; q.z += dz;
        if (q.y < -20) remove = true;
      }
      if (remove) this.projectiles.splice(i, 1);
    }
  }

  damagePlayer(target, dmg, attacker, cause, part) {
    if (target.dead || dmg <= 0) return;
    target.hp -= dmg;
    target.hurt = this.time;
    target.socket.emit('hurt', { amount: Math.round(dmg), kind: cause || 'slag', by: attacker ? attacker.name : null });
    if (attacker && attacker !== target) attacker.socket.emit('dealt', { amount: Math.round(dmg), to: target.name });
    if (target.hp <= 0) this.die(target, attacker, cause);
  }

  die(p, killer, cause) {
    if (p.dead) return;
    p.dead = true; p.hp = 0; p.deaths++;
    p.respawnAt = this.time + RESPAWN_DELAY;
    p.vx = p.vy = p.vz = 0;
    if (p.openBox) p.openBox = null;
    this.pushFx('blood', { x: p.x, y: p.y + 1, z: p.z, n: 18 });
    p.socket.emit('died', { by: killer ? killer.name : null, cause: cause || 'okänt' });
    if (killer && killer !== p) {
      killer.kills++;
      killer.socket.emit('toast', { text: `Du dödade ${p.name}`, kind: 'good' });
      this.io.emit('chat', { sys: true, text: `${killer.name} dödade ${p.name}` });
    } else {
      this.io.emit('chat', { sys: true, text: `${p.name} dog (${cause || 'okänt'})` });
    }
    const profile = this.profiles.get(p.pid);
    if (profile) { profile.deaths = p.deaths; profile.kills = p.kills; }
    this.saveDirty = true;
  }

  respawn(p, silent) {
    const spawn = this.world.randomSpawn(this.alivePlayers().filter((o) => o.id !== p.id));
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
    p.vx = p.vy = p.vz = 0; p.minVy = 0;
    p.yaw = spawn.yaw || 0;
    p.hp = P.maxHp; p.hunger = Math.max(65, p.hunger * 0.5 + 40); p.thirst = Math.max(70, p.thirst * 0.5 + 45);
    p.temp = TEMP.baseDay * 0.85; p.wetT = 0;
    p.dead = false; p.respawnAt = 0;
    if (!silent) p.socket.emit('respawned', { x: r2(p.x), y: r2(p.y), z: r2(p.z) });
  }

  // ------------------------------------------------------------- byggande ---
  overlapsPlayer(piece, ignore) {
    const boxes = blockBoxes({ ...piece, _boxes: null });
    for (const pl of this.players.values()) {
      if (pl.dead || pl.id === ignore.id) continue;
      const pb = { minX: pl.x - P.radius, maxX: pl.x + P.radius, minY: pl.y, maxY: pl.y + P.height, minZ: pl.z - P.radius, maxZ: pl.z + P.radius };
      for (const bb of boxes) {
        if (pb.maxX > bb.min.x && pb.minX < bb.max.x && pb.maxY > bb.min.y && pb.minY < bb.max.y && pb.maxZ > bb.min.z && pb.minZ < bb.max.z) return true;
      }
    }
    return false;
  }

  place(socketId, data) {
    this.setAim(socketId, data);
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    if (this.time < p.nextPlace) return;
    p.nextPlace = this.time + 0.12;
    const type = data && data.type;
    if (!PIECES[type]) return;
    const aim = data.aim;
    if (!aim || !isFinite(aim.x) || !isFinite(aim.y) || !isFinite(aim.z)) return;
    if (Math.hypot(aim.x - p.x, aim.z - p.z) > P.reach + 8) { this.toast(p, 'För långt bort', 'warn'); return; }

    let costItem = null;
    if (type === 'campfire') {
      if (!countItem(p.slots, 'campfire')) { this.toast(p, 'Du har ingen lägereld – crafta en (C)', 'warn'); return; }
      costItem = 'campfire';
    } else {
      const cost = buildCost(type);
      if (!canAfford(p.slots, cost)) { this.toast(p, `Kräver ${this.costText(cost)}`, 'warn'); return; }
    }

    const res = snapPiece(type, aim, this.index, this.world.hm, p);
    if (!res.ok) { this.toast(p, res.reason, 'warn'); return; }
    if (type !== 'campfire' && this.overlapsPlayer(res.piece, p)) { this.toast(p, 'Någon står i vägen', 'warn'); return; }

    if (costItem) removeItem(p.slots, costItem, 1);
    else payCost(p.slots, buildCost(type));

    const b = this.addBlockRaw({
      ...res.piece, type, tier: 'wood', owner: p.pid,
      hp: pieceHp(type, 'wood'), maxHp: pieceHp(type, 'wood'),
    });
    this.io.emit('block:add', serializeBlock(b));
    this.pushFx('place', { x: b.x, y: b.y, z: b.z });
    this.sendInv(p);
    this.saveDirty = true;
    p.socket.emit('placed', { type });
  }

  costText(cost) {
    return Object.keys(cost).map((k) => `${cost[k]} ${ITEMS[k] ? ITEMS[k].name.toLowerCase() : k}`).join(' + ');
  }

  demolish(socketId, data) {
    this.setAim(socketId, data);
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const b = this.aimBlock(p, P.reach + 1);
    if (!b) { this.toast(p, 'Rikta mot en byggdel', 'warn'); return; }
    if (b.owner !== p.pid) { this.toast(p, 'Du äger inte den byggdelen', 'warn'); return; }
    this.removeBlock(b, true);
    this.toast(p, `${PIECES[b.type] ? PIECES[b.type].name : b.type} riven`, 'info');
  }

  upgrade(socketId, data) {
    this.setAim(socketId, data);
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const b = this.aimBlock(p, P.reach + 1);
    if (!b) { this.toast(p, 'Rikta mot en byggdel', 'warn'); return; }
    if (b.type === 'campfire') return;
    if (b.owner !== p.pid) { this.toast(p, 'Du äger inte den byggdelen', 'warn'); return; }
    const nt = nextTier(b.tier);
    if (!nt) { this.toast(p, 'Redan högsta nivå', 'info'); return; }
    const cost = upgradeCost(b.type, nt);
    if (!cost) return;
    if (!canAfford(p.slots, cost)) { this.toast(p, `Uppgradering kräver ${this.costText(cost)}`, 'warn'); return; }
    payCost(p.slots, cost);
    b.tier = nt;
    b.maxHp = pieceHp(b.type, nt);
    b.hp = b.maxHp;
    this.index.add(b);
    this.io.emit('block:upd', serializeBlock(b));
    this.sendInv(p);
    this.pushFx('upgrade', { x: b.x, y: b.y, z: b.z });
    this.saveDirty = true;
  }

  aimBlock(p, maxDist) {
    const hit = raycastAll({
      hm: this.world.hm, index: this.index, nodes: null, players: null,
      o: this.eye(p), d: aimVector(p.yaw, p.pitch), maxDist,
    });
    return hit && hit.kind === 'block' ? hit.block : null;
  }

  damageBlock(b, dmg, attacker, hit) {
    b.hp -= dmg;
    if (hit) this.pushFx('chip', { x: hit.x, y: hit.y, z: hit.z, n: 5, type: b.type });
    this.io.emit('block:upd', serializeBlock(b));
    if (b.hp <= 0) {
      this.removeBlock(b, true);
      if (attacker) attacker.socket.emit('toast', { text: `${PIECES[b.type] ? PIECES[b.type].name : 'Byggnadsdel'} förstörd`, kind: 'good' });
    }
  }

  removeBlock(b, cascade) {
    this.index.remove(b.id);
    this.io.emit('block:del', { id: b.id });
    this.pushFx('break', { x: b.x, y: b.y, z: b.z, type: b.type });
    if (b.type === 'doorway') {
      for (const o of this.index.all()) if (o.type === 'door' && o.parentKey === blockKey(b)) this.removeBlock(o, false);
    }
    if (b.type === 'box' && b.slots) {
      for (const s of b.slots) if (s) this.spawnDrop(b.x, b.y + 0.5, b.z, s.id, s.amount);
    }
    this.saveDirty = true;
    if (cascade) this.settle();
  }

  /** Byggdelar som inte längre bärs upp ska rasa. Körs i omgångar eftersom
   *  varje ras kan göra nya delar ostödda (t.ex. taket när väggen försvinner). */
  settle() {
    for (let round = 0; round < 8; round++) {
      const all = this.index.all();
      const ok = new Set();
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const b of all) {
          if (ok.has(b.id)) continue;
          if (this.isSupported(b, ok)) { ok.add(b.id); changed = true; }
        }
        if (!changed) break;
      }
      const doomed = all.filter((b) => !ok.has(b.id));
      if (!doomed.length) return;
      for (const b of doomed) this.removeBlock(b, false);
    }
  }

  isSupported(b, ok) {
    const terr = this.world.terrain(b.x, b.z);
    switch (b.type) {
      case 'campfire': return true;
      case 'foundation': {
        if (b.y - 0.1 <= terr + 1.6) return true;
        for (const w of this.index.near(b.x, b.z, 3)) {
          if (w.type !== 'wall' && w.type !== 'doorway') continue;
          if (Math.abs((w.y + 1.5) - (b.y - 0.1)) < 0.35 && Math.abs(w.x - b.x) < 2.7 && Math.abs(w.z - b.z) < 2.7) return true;
        }
        return this.hasSupportedNeighbourFloor(b, ok);
      }
      case 'roof': {
        for (const w of this.index.near(b.x, b.z, 3)) {
          if (w.type !== 'wall' && w.type !== 'doorway') continue;
          if (Math.abs((w.y + 1.5) - (b.y - 0.1)) < 0.35 && Math.abs(w.x - b.x) < 2.7 && Math.abs(w.z - b.z) < 2.7) return true;
        }
        return this.hasSupportedNeighbourFloor(b, ok);
      }
      case 'wall':
      case 'doorway': {
        const base = b.y - 1.5;
        for (const f of this.index.near(b.x, b.z, 3)) {
          if (f.type !== 'foundation' && f.type !== 'roof') continue;
          if (Math.abs((f.y + 0.1) - base) < 0.35 && Math.abs(f.x - b.x) < 2.7 && Math.abs(f.z - b.z) < 2.7) return true;
        }
        for (const w of this.index.near(b.x, b.z, 1.5)) {
          if (w.id === b.id || (w.type !== 'wall' && w.type !== 'doorway')) continue;
          if (Math.abs((w.y + 3) - base) < 0.35 && Math.abs(w.x - b.x) < 0.2 && Math.abs(w.z - b.z) < 0.2 && ok.has(w.id)) return true;
        }
        return false;
      }
      case 'door': {
        const parent = b.parentKey ? this.index.byKey(b.parentKey) : null;
        return !!parent;
      }
      case 'box': {
        for (const f of this.index.near(b.x, b.z, 2)) {
          if (f.type !== 'foundation' && f.type !== 'roof') continue;
          if (Math.abs((f.y + 0.1) - (b.y - 0.45)) < 0.4 && Math.abs(f.x - b.x) < 2.2 && Math.abs(f.z - b.z) < 2.2) return true;
        }
        return false;
      }
      default: return b.y - 0.3 <= terr + 1;
    }
  }

  hasSupportedNeighbourFloor(b, ok) {
    for (const n of this.index.near(b.x, b.z, 5)) {
      if (n.id === b.id) continue;
      if (n.type !== 'foundation' && n.type !== 'roof') continue;
      if (Math.abs(n.y - b.y) > 0.06) continue;
      const dx = Math.abs(n.x - b.x), dz = Math.abs(n.z - b.z);
      const adjacent = (Math.abs(dx - 4) < 0.35 && dz < 0.35) || (Math.abs(dz - 4) < 0.35 && dx < 0.35);
      if (adjacent && ok.has(n.id)) return true;
    }
    return false;
  }

  toggleDoor(p, b) {
    b.open = !b.open;
    this.io.emit('block:upd', serializeBlock(b));
    this.pushFx('door', { x: b.x, y: b.y, z: b.z, open: b.open });
  }

  // ----------------------------------------------------------- interaktion ---
  interact(socketId, data) {
    this.setAim(socketId, data);
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    if (this.time < p.nextInteract) return;
    p.nextInteract = this.time + 0.25;

    // plocka upp tappade föremål först
    const drop = this.nearestDrop(p, 2.6);
    if (drop) { this.pickupDrop(p, drop); return; }

    const o = this.eye(p);
    const d = aimVector(p.yaw, p.pitch);
    const hit = raycastAll({
      hm: this.world.hm, index: this.index, nodes: this.world.nodes, players: null,
      o, d, maxDist: P.reach, excludeId: p.id,
    });
    if (!hit) {
      if (p.inWater || p.wading) this.drink(p);
      return;
    }
    if (hit.kind === 'block') {
      const b = hit.block;
      if (b.type === 'door') { this.toggleDoor(p, b); return; }
      if (b.type === 'box') { this.openBox(p, b); return; }
      if (b.type === 'campfire') { this.toast(p, 'Elden värmer dig', 'good'); return; }
      this.toast(p, `${PIECES[b.type] ? PIECES[b.type].name : b.type} – U för att uppgradera, X för att riva`, 'info');
      return;
    }
    if (hit.kind === 'node') {
      const n = hit.node;
      if (n.kind === 'bush') {
        const { loot, damage } = gatherFrom('bush', null);
        const gained = [];
        for (const l of loot) { const got = addItem(p.slots, l.item, l.qty); if (got > 0) gained.push({ item: l.item, qty: got }); }
        if (gained.length) { p.socket.emit('loot', gained); this.sendInv(p); }
        this.world.damageNode(n.id, damage, this.time);
        this.pushFx('gather', { x: hit.x, y: hit.y, z: hit.z, kind: 'bush', n: 4 });
        p.nextInteract = this.time + 0.4;
      } else {
        this.toast(p, `Slå på ${NODES[n.kind].label.toLowerCase()}en med vänsterklick`, 'info');
      }
      return;
    }
    if (hit.kind === 'water') { this.drink(p); return; }
  }

  drink(p) {
    if (this.time < p.nextDrink) return;
    p.nextDrink = this.time + SURVIVAL.drinkCooldown;
    p.thirst = Math.min(P.maxThirst, p.thirst + SURVIVAL.drinkAmount);
    p.wetT = Math.max(p.wetT, 6);
    this.pushFx('splash', { x: p.x, y: WATER_LEVEL, z: p.z, n: 5 });
    p.socket.emit('toast', { text: 'Du drack vatten', kind: 'good' });
  }

  // ---------------------------------------------------------------- lådor ---
  openBox(p, b) {
    if (Math.hypot(b.x - p.x, b.z - p.z) > 4.5) { this.toast(p, 'För långt bort', 'warn'); return; }
    p.openBox = b.id;
    p.socket.emit('box:open', { id: b.id, slots: b.slots, x: b.x, y: b.y, z: b.z });
  }

  closeBox(socketId) {
    const p = this.players.get(socketId);
    if (p) p.openBox = null;
  }

  boxXfer(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || p.dead || !p.openBox) return;
    const b = this.index.get(p.openBox);
    if (!b || b.type !== 'box') { p.openBox = null; return; }
    if (Math.hypot(b.x - p.x, b.z - p.z) > 5) { p.openBox = null; p.socket.emit('box:close'); this.toast(p, 'För långt från lådan', 'warn'); return; }
    const from = data.in ? p.slots : b.slots;
    const to = data.in ? b.slots : p.slots;
    const fi = data.idx | 0;
    const src = from[fi];
    if (!src) return;
    const amount = Math.max(1, Math.min(src.amount, data.all ? src.amount : Math.ceil(src.amount / 2)));
    if (amount >= src.amount) {
      // flytta hela högen
      let placed = addItem(to, src.id, src.amount);
      if (placed > 0) {
        src.amount -= placed;
        if (src.amount <= 0) from[fi] = null;
      } else {
        // ingen plats – lägg i första tomma
        const empty = to.findIndex((s) => !s);
        if (empty >= 0) { to[empty] = { ...src }; from[fi] = null; }
        else { this.toast(p, 'Ingen plats', 'warn'); return; }
      }
    } else {
      src.amount -= amount;
      const added = addItem(to, src.id, amount);
      if (added < amount) src.amount += amount - added;
    }
    p.socket.emit('box:upd', { id: b.id, slots: b.slots });
    this.sendInv(p);
    this.saveDirty = true;
  }

  // ---------------------------------------------------------------- drops ---
  spawnDrop(x, y, z, itemId, amount) {
    const d = { id: this.nextDrop++, item: itemId, amount, x: r2(x), y: r2(y), z: r2(z), vy: 1.5, t: 0 };
    this.drops.push(d);
    this.io.emit('drop:add', d);
    return d;
  }

  updateDrops(dt) {
    for (const d of this.drops) {
      d.t += dt;
      if (d.y > this.world.terrain(d.x, d.z) + 0.25) {
        d.vy -= 18 * dt;
        d.y = Math.max(this.world.terrain(d.x, d.z) + 0.25, d.y + d.vy * dt);
        if (d.y <= this.world.terrain(d.x, d.z) + 0.251) d.vy = 0;
      }
    }
  }

  nearestDrop(p, range) {
    const o = this.eye(p);
    const d = aimVector(p.yaw, p.pitch);
    let best = null, bestScore = Infinity;
    for (const dr of this.drops) {
      const dx = dr.x - o.x, dy = dr.y - o.y, dz = dr.z - o.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range) continue;
      const dot = (dx * d.x + dy * d.y + dz * d.z) / (dist || 1);
      if (dot < 0.55) continue;
      if (dist < bestScore) { bestScore = dist; best = dr; }
    }
    return best;
  }

  pickupDrop(p, dr) {
    const got = addItem(p.slots, dr.item, dr.amount);
    if (got <= 0) { this.toast(p, 'Inventariet är fullt', 'warn'); return; }
    dr.amount -= got;
    if (dr.amount <= 0) {
      const i = this.drops.indexOf(dr);
      if (i >= 0) this.drops.splice(i, 1);
      this.io.emit('drop:del', { id: dr.id });
    } else {
      this.io.emit('drop:upd', { id: dr.id, amount: dr.amount });
    }
    p.socket.emit('loot', [{ item: dr.item, qty: got }]);
    this.sendInv(p);
  }

  dropItem(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const i = data.slot | 0;
    const s = p.slots[i];
    if (!s) return;
    const amount = Math.max(1, Math.min(s.amount, data.all ? s.amount : Math.ceil(s.amount / 2)));
    s.amount -= amount;
    if (s.amount <= 0) p.slots[i] = null;
    const d = aimVector(p.yaw, p.pitch);
    this.spawnDrop(p.x + d.x * 1.1, p.y + 1.0, p.z + d.z * 1.1, s.id, amount);
    this.sendInv(p);
  }

  // -------------------------------------------------------------- crafting ---
  craft(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const recipe = RECIPES.find((r) => r.id === data.id);
    if (!recipe) return;
    let times = Math.max(1, Math.min(20, data.n | 0 || 1));
    let made = 0;
    for (let i = 0; i < times; i++) {
      if (!canAfford(p.slots, recipe.cost)) break;
      payCost(p.slots, recipe.cost);
      for (const k in recipe.out) {
        const got = addItem(p.slots, k, recipe.out[k]);
        if (got < recipe.out[k]) this.toast(p, 'Inte plats för allt', 'warn');
      }
      made++;
    }
    if (!made) { this.toast(p, `Kräver ${this.costText(recipe.cost)}`, 'warn'); return; }
    this.sendInv(p);
    p.socket.emit('crafted', { id: recipe.id, n: made });
    this.pushFx('craft', { x: p.x, y: p.y + 1, z: p.z });
    this.saveDirty = true;
  }

  // ------------------------------------------------------------- inventarie ---
  invMove(socketId, data) {
    const p = this.players.get(socketId);
    if (!p) return;
    const from = data.from | 0, to = data.to | 0;
    if (from < 0 || to < 0 || from >= INVENTORY_SIZE || to >= INVENTORY_SIZE) return;
    if (data.split) splitSlot(p.slots, from, to, true);
    else moveSlot(p.slots, from, to);
    this.sendInv(p);
    this.saveDirty = true;
  }

  invUse(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    const i = data.slot | 0;
    const s = p.slots[i];
    if (!s) return;
    const d = ITEMS[s.id];
    if (!d) return;
    if (d.cat === 'food') {
      p.hunger = Math.min(P.maxHunger, p.hunger + (d.hunger || 5));
      p.hp = Math.min(P.maxHp, p.hp + (d.hp || 0));
      s.amount -= 1;
      if (s.amount <= 0) p.slots[i] = null;
      p.socket.emit('toast', { text: `Du åt ${d.name.toLowerCase()}`, kind: 'good' });
      p.socket.emit('ate', {});
      this.sendInv(p);
      this.saveDirty = true;
      return;
    }
    if (d.place) {
      const hit = raycastAll({
        hm: this.world.hm, index: this.index, nodes: this.world.nodes, players: null,
        o: this.eye(p), d: aimVector(p.yaw, p.pitch), maxDist: P.reach, excludeId: p.id,
      });
      if (!hit) { this.toast(p, 'Rikta mot marken', 'warn'); return; }
      this.place(socketId, { type: d.place, aim: { x: hit.x, y: hit.y, z: hit.z } });
      return;
    }
    if (d.cat === 'tool' || d.cat === 'weapon' || d.cat === 'ranged') {
      if (i < HOTBAR_SIZE) { p.held = i; this.sendInv(p); }
      else this.toast(p, 'Flytta till hotbar (1–6) först', 'info');
    }
  }

  hotbar(socketId, data) {
    const p = this.players.get(socketId);
    if (!p) return;
    const i = data.slot | 0;
    if (i < 0 || i >= HOTBAR_SIZE) return;
    p.held = i;
    this.sendInv(p);
  }

  /** Uppdaterar bara siktet – skickas med varje handling för exakt träffregistrering. */
  setAim(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || !data) return;
    if (typeof data.yaw === 'number' && isFinite(data.yaw)) p.yaw = data.yaw;
    if (typeof data.pitch === 'number' && isFinite(data.pitch)) p.pitch = Math.max(-1.55, Math.min(1.55, data.pitch));
  }

  // ---------------------------------------------------------------- input ---
  setInput(socketId, data) {
    const p = this.players.get(socketId);
    if (!p || !data) return;
    p.input.f = !!data.f; p.input.b = !!data.b; p.input.l = !!data.l; p.input.r = !!data.r;
    p.input.jump = !!data.jump; p.input.sprint = !!data.sprint;
    if (typeof data.yaw === 'number' && isFinite(data.yaw)) p.yaw = data.yaw;
    if (typeof data.pitch === 'number' && isFinite(data.pitch)) p.pitch = Math.max(-1.55, Math.min(1.55, data.pitch));
    if (typeof data.seq === 'number') p.seq = data.seq;
  }

  chat(socketId, text) {
    const p = this.players.get(socketId);
    if (!p) return;
    if (this.time < p.nextChat) return;
    p.nextChat = this.time + 0.35;
    const t = String(text || '').slice(0, 200).trim();
    if (!t) return;
    this.io.emit('chat', { name: p.name, text: t });
  }

  pushFx(kind, data) {
    if (this.fx.length > 120) return;
    this.fx.push({ k: kind, ...data, x: r2(data.x || 0), y: r2(data.y || 0), z: r2(data.z || 0) });
  }

  // ----------------------------------------------------------------- save ---
  save() {
    const profiles = [];
    for (const pr of this.profiles.values()) {
      const live = pr.ref;
      profiles.push({
        pid: pr.pid, name: live ? live.name : pr.name,
        slots: live ? live.slots : pr.slots,
        kills: live ? live.kills : pr.kills || 0,
        deaths: live ? live.deaths : pr.deaths || 0,
        playtime: (pr.playtime || 0) + (live ? this.time - live.joinedAt : 0),
      });
      if (live) live.joinedAt = this.time;
    }
    const blocks = this.index.all().map((b) => {
      const o = { id: b.id, type: b.type, tier: b.tier, x: b.x, y: b.y, z: b.z, rot: b.rot, hp: Math.round(b.hp), maxHp: b.maxHp, owner: b.owner };
      if (b.type === 'door') { o.open = b.open; o.parentKey = b.parentKey; }
      if (b.type === 'box') o.slots = b.slots;
      return o;
    });
    const ok = writeSave({ v: 1, seed: this.seed, tod: this.tod, profiles, blocks });
    if (ok) this.saveDirty = false;
    return ok;
  }

  stats() {
    return {
      players: this.players.size,
      blocks: this.index.blocks.size,
      nodes: this.world.nodes.length,
      seed: this.seed,
      tod: this.tod,
      uptime: Math.round(this.time),
    };
  }
}
