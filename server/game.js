/**
 * Spellogik på servern: auktoritativ simulering av spelare, resurser,
 * hantverk, bygge, överlevnad och strid. Allt skickas som JSON över /ws.
 */

import { World, CONFIG, NODE_TYPES, daylight } from '../shared/worldgen.js';
import { BuildingIndex, canPlace, pieceAABB, piecePos, PIECES, GRID, LEVEL_H } from '../shared/building.js';
import { ITEMS, EQUIP, equipOf, RECIPES, recipeById, NODE_RESOURCE, maxStack } from '../shared/items.js';
import { PLAYER, createBody, stepBody } from '../shared/movement.js';

export const TICK_HZ = 20;
export const SNAPSHOT_EVERY = 2; // -> 10 Hz snapshots
const RESPAWN_TIME = 8;
const REACH = 6.5; // hur långt ifrån man får bygga
const HOTBAR_SLOTS = 10;

const RESOURCES = new Set(['wood', 'stone', 'metal']);

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class Game {
  constructor({ world, save, net, seed } = {}) {
    this.world = world || new World(seed ?? CONFIG.seed);
    this.index = new BuildingIndex();
    this.net = net; // { send(id, obj), broadcast(obj), broadcastExcept(id, obj), roster() }
    this.players = new Map(); // id -> player
    this.byToken = new Map(); // token -> id
    this.byName = new Map(); // lowercase namn -> id
    this.bags = new Map(); // id -> lootbag (finns även i index.props)
    this.projectiles = [];
    this.nextId = 1;
    this.nextPieceId = 1;
    this.nextBagId = 1;
    this.time = 0; // sekunder sedan start
    this.dayFraction = 0.28; // morgon
    this.tickCount = 0;
    this.chatLog = [];
    this.events = [];
    this.tokens = save?.tokens || {}; // namn -> {token, password, playtime}
    this.statLines = [];
    this.loadSave(save);
  }

  // ---------------------------------------------------------------- spelare

  get onlineCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  createPlayer({ name, token }) {
    const spawn = this.findSpawn();
    const p = {
      id: this.nextId++,
      name,
      token,
      connected: false,
      sleeper: false,
      alive: true,
      body: createBody(spawn.x, spawn.y + 0.2, spawn.z, Math.random() * Math.PI * 2),
      input: { f: 0, r: 0, j: false, s: false, c: false },
      lastSeq: 0,
      hp: 100,
      hunger: 100,
      thirst: 100,
      warmth: 100,
      inv: {},
      hotbar: new Array(HOTBAR_SLOTS).fill(null),
      selected: 0,
      frac: {},
      lastHit: -10,
      lastInputAt: 0,
      lastGather: -10,
      lastDamageFrom: null,
      lastDamageAt: -100,
      combatUntil: -100,
      respawnAt: 0,
      sleeping: false,
      sheltered: false,
      nearFire: 0,
      ambient: 15,
      kills: 0,
      deaths: 0,
      stats: { gathered: 0, crafted: 0, built: 0, playtime: 0 },
      messages: [],
    };
    this.players.set(p.id, p);
    if (token) this.byToken.set(token, p.id);
    this.byName.set(name.toLowerCase(), p.id);
    return p;
  }

  findSpawn() {
    for (let i = 0; i < 200; i++) {
      const s = this.world.randomBeachSpawn(Math.random);
      const c = this.index.near(s.x, s.z, 3);
      let blocked = false;
      for (const pc of c) {
        if (pc.kind === 'campfire' || pc.kind === 'storage_box') {
          if (Math.hypot(pc.x - s.x, pc.z - s.z) < 2) blocked = true;
        }
      }
      if (!blocked) return s;
    }
    return { x: 0, y: this.world.heightAt(0, 0) + 1, z: 0 };
  }

  /** Hitta en ledig plats nära en position (används av /tp) */
  findSpawnNear(x, z) {
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const rad = i === 0 ? 0 : 1.1 + Math.floor(i / 8) * 0.7;
      const sx = x + Math.cos(a) * rad;
      const sz = z + Math.sin(a) * rad;
      const h = this.world.heightAt(sx, sz);
      if (h < this.world.waterLevel + 0.5) continue;
      if (this.world.slopeAt(sx, sz) > 0.6) continue;
      return { x: sx, y: h, z: sz };
    }
    return { x, y: this.world.heightAt(x, z), z };
  }

  /** Spelare ansluter (ny eller återupptar med token) */
  join(conn, { name, token, password }) {
    let p = token ? this.players.get(this.byToken.get(token)) : null;
    let resumed = false;
    if (!p) {
      const existing = this.byName.get(String(name || '').toLowerCase());
      if (existing && this.tokens[name.toLowerCase()]?.password && this.tokens[name.toLowerCase()].password !== password) {
        return { error: 'Namnet är upptaget' };
      }
      p = existing ? this.players.get(existing) : null;
      if (p) {
        // samma namn + rätt lösenord -> ta över kroppen
        resumed = true;
      } else {
        p = this.createPlayer({ name, token: token || null });
      }
    } else {
      resumed = true;
    }
    if (p.connected && p.conn && p.conn !== conn && p.conn.open) {
      p.conn.send({ t: 'kicked', reason: 'Du loggade in från en annan flik' });
      p.conn.close(1000, 'kicked');
    }
    // ny token vid behov
    if (!p.token) {
      p.token = makeToken();
    }
    this.byToken.set(p.token, p.id);
    this.byName.set(p.name.toLowerCase(), p.id);
    this.tokens[p.name.toLowerCase()] = { token: p.token, password: password || null };
    p.conn = conn;
    conn.data.playerId = p.id;
    p.connected = true;
    p.sleeper = false;
    p.stats.playtime = p.stats.playtime || 0;
    return { player: p, resumed };
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.sleeper = true;
    p.conn = null;
    p.input = { f: 0, r: 0, j: false, s: false, c: false };
    p.body.vx = p.body.vy = p.body.vz = 0;
    this.net.broadcast({ t: 'sleeper', id: p.id, sleeper: 1 });
  }

  send(p, obj) {
    if (p.connected && p.conn) p.conn.send(obj);
  }

  // ------------------------------------------------------------------ state

  playerState(p) {
    const b = p.body;
    return {
      i: p.id,
      x: r2(b.x),
      y: r2(b.y),
      z: r2(b.z),
      yw: r2(b.yaw),
      pt: r2(b.pitch),
      hp: Math.round(p.hp),
      al: p.alive ? 1 : 0,
      sl: p.sleeper ? 1 : 0,
      eq: this.equippedItem(p) || 'hand',
      mv: b.moving ? 1 : 0,
      sp: b.sprinting ? 1 : 0,
      cr: b.crouching ? 1 : 0,
    };
  }

  snapshot() {
    const out = [];
    for (const p of this.players.values()) out.push(this.playerState(p));
    return out;
  }

  equippedItem(p) {
    const slot = p.hotbar[p.selected];
    if (!slot) return 'hand';
    const it = ITEMS[slot.item];
    if (it && it.kind === 'equipment') return slot.item;
    return 'hand';
  }

  fullState(p) {
    return {
      t: 'you',
      id: p.id,
      name: p.name,
      token: p.token,
      inv: p.inv,
      hotbar: p.hotbar,
      selected: p.selected,
      hp: p.hp,
      hunger: p.hunger,
      thirst: p.thirst,
      warmth: +p.warmth.toFixed(1),
      alive: p.alive,
      respawnAt: p.respawnAt,
      kills: p.kills,
      deaths: p.deaths,
      stats: p.stats,
      pos: [r2(p.body.x), r2(p.body.y), r2(p.body.z)],
      equipped: this.equippedItem(p) || 'hand',
    };
  }

  welcome(p) {
    const roster = [];
    for (const q of this.players.values()) {
      roster.push({ id: q.id, name: q.name, sleeper: q.sleeper ? 1 : 0, hp: Math.round(q.hp), alive: q.alive ? 1 : 0 });
    }
    const buildings = [];
    for (const piece of this.index.pieces.values()) {
      if (piece.kind === 'lootbag') continue;
      buildings.push(this.serializePiece(piece));
    }
    const nodes = [];
    for (const n of this.world.nodes) {
      if (n.hp < NODE_TYPES[n.type].hp || n.dead) {
        nodes.push([n.id, n.hp, n.dead ? Math.round(n.respawnAt - this.time) : 0]);
      }
    }
    const bags = [];
    for (const bag of this.bags.values()) bags.push(this.serializePiece(bag));
    return {
      t: 'welcome',
      seed: this.world.seed,
      you: this.fullState(p),
      roster,
      buildings,
      nodes,
      bags,
      dayFraction: this.dayFraction,
      time: this.time,
      online: this.onlineCount,
      chat: this.chatLog.slice(-25),
      config: {
        grid: GRID,
        levelHeight: LEVEL_H,
        dayLength: CONFIG.dayLength,
        size: CONFIG.size,
        waterLevel: CONFIG.waterLevel,
        player: PLAYER,
        nodeTypes: NODE_TYPES,
        pieces: PIECES,
        items: ITEMS,
        equip: EQUIP,
        recipes: RECIPES,
        tickHz: TICK_HZ,
      },
    };
  }

  serializePiece(p) {
    const out = {
      id: p.id,
      kind: p.kind,
      gx: p.gx,
      gz: p.gz,
      level: p.level,
      side: p.side,
      ek: p.ek,
      y: r2(p.y),
      hp: p.hp,
    };
    if (p.x !== undefined) out.x = r2(p.x);
    if (p.z !== undefined) out.z = r2(p.z);
    if (p.rot) out.rot = r2(p.rot);
    if (p.owner) out.owner = p.owner;
    if (p.inv) out.inv = p.inv;
    if (p.kind === 'door') out.open = p.open ? 1 : 0;
    if (p.kind === 'lootbag') out.items = p.items;
    return out;
  }

  // ------------------------------------------------------------------ input

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'input':
        this.onInput(p, msg);
        break;
      case 'hit':
        this.onHit(p, msg);
        break;
      case 'place':
        this.onPlace(p, msg);
        break;
      case 'demolish':
        this.onDemolish(p, msg);
        break;
      case 'craft':
        this.onCraft(p, msg);
        break;
      case 'select':
        this.onSelect(p, msg);
        break;
      case 'eat':
        this.onEat(p, msg);
        break;
      case 'move':
        this.onMoveItem(p, msg);
        break;
      case 'loot':
        this.onLoot(p, msg);
        break;
      case 'door':
        this.onDoor(p, msg);
        break;
      case 'open':
        this.onOpen(p, msg);
        break;
      case 'respawn':
        this.respawn(p);
        break;
      case 'chat':
        this.onChat(p, msg);
        break;
      case 'ping':
        this.send(p, { t: 'pong', c: msg.c, time: this.time });
        break;
      default:
        break;
    }
  }

  onInput(p, msg) {
    p.lastSeq = msg.seq | 0;
    p.lastInputAt = this.time;
    if (p.alive) {
      const inp = p.input;
      inp.f = clampNum(msg.f, -1, 1);
      inp.r = clampNum(msg.r, -1, 1);
      inp.j = !!msg.j;
      inp.s = !!msg.s;
      inp.c = !!msg.c;
      p.body.yaw = Number.isFinite(msg.yaw) ? msg.yaw : p.body.yaw;
      p.body.pitch = Number.isFinite(msg.pitch) ? clampNum(msg.pitch, -1.55, 1.55) : p.body.pitch;
    }
    this.send(p, { t: 'ack', seq: p.lastSeq, dt: msg.dt });
  }

  // -------------------------------------------------------------- strid/act

  onHit(p, msg) {
    if (!p.alive) return;
    const eq = equipOf(this.equippedItem(p));
    if (this.time - p.lastHit < eq.cooldown) return;
    p.lastHit = this.time;
    p.combatUntil = this.time + 20;

    const eyeY = p.body.y + PLAYER.eye;
    let dir = msg.dir;
    if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(Number.isFinite)) {
      dir = [-Math.sin(p.body.yaw), 0, -Math.cos(p.body.yaw)];
    }
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const origin = [p.body.x, eyeY, p.body.z];

    if (eq.type === 'ranged') {
      const draw = clampNum(msg.draw, 0, 1);
      if (draw < 0.32) {
        this.send(p, { t: 'fx', k: 'weakdraw' });
        return;
      }
      if (!this.takeItem(p, eq.ammo, 1)) {
        this.send(p, { t: 'fx', k: 'noammo' });
        return;
      }
      const speed = 55;
      const dmg = eq.playerDmg * (0.45 + 0.55 * draw);
      this.projectiles.push({
        id: this.nextId++,
        owner: p.id,
        x: origin[0],
        y: origin[1],
        z: origin[2],
        vx: dir[0] * speed,
        vy: dir[1] * speed + 1.2,
        vz: dir[2] * speed,
        dmg,
        ttl: 4,
      });
      this.net.broadcast({ t: 'fx', k: 'shoot', i: p.id, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])], d: [r2(dir[0]), r2(dir[1]), r2(dir[2])] });
      return;
    }

    // närstrid: hitta närmaste träffbara mål längs blickriktningen
    const maxT = eq.range;
    let bestT = maxT;
    let best = null;
    for (const q of this.players.values()) {
      if (q.id === p.id || !q.alive) continue;
      const t = raySphere(origin, dir, [q.body.x, q.body.y + 0.95, q.body.z], 0.55);
      if (t !== null && t < bestT) {
        bestT = t;
        best = { kind: 'player', player: q };
      }
    }
    for (const n of this.world.nodes) {
      if (n.dead) continue;
      if (Math.abs(n.x - p.body.x) > 10 || Math.abs(n.z - p.body.z) > 10) continue;
      const info = NODE_TYPES[n.type];
      const y0 = n.y + 0.15;
      const y1 = n.y + info.height * 0.85;
      const r = Math.max(0.55, info.radius + 0.45);
      let t = null;
      // testa längs en vertikal "stam" så att man kan slå var som helst på trädet
      for (let i = 0; i <= 4; i++) {
        const yy = y0 + (y1 - y0) * (i / 4);
        const tt = raySphere(origin, dir, [n.x, yy, n.z], r);
        if (tt !== null && (t === null || tt < t)) t = tt;
      }
      if (t !== null && t < bestT) {
        bestT = t;
        best = { kind: 'node', node: n };
      }
    }
    for (const piece of this.index.near(p.body.x, p.body.z, 5)) {
      if (piece.kind === 'lootbag') continue;
      const bb = pieceAABB(piece);
      const t = rayBox(origin, dir, bb.min, bb.max);
      if (t !== null && t < bestT) {
        bestT = t;
        best = { kind: 'piece', piece };
      }
    }

    if (!best) {
      this.net.broadcast({ t: 'fx', k: 'swing', i: p.id, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])], d: [r2(dir[0]), r2(dir[1]), r2(dir[2])] });
      return;
    }
    this.net.broadcast({ t: 'fx', k: 'swing', i: p.id, o: [r2(origin[0]), r2(origin[1]), r2(origin[2])], d: [r2(dir[0]), r2(dir[1]), r2(dir[2])] });

    if (best.kind === 'player') {
      const dmg = eq.playerDmg;
      this.damagePlayer(best.player, dmg, p, 'melee');
      this.net.broadcast({
        t: 'fx',
        k: 'hit',
        i: p.id,
        h: [bestT ? r2(origin[0] + dir[0] * bestT) : 0, r2(origin[1] + dir[1] * bestT), r2(origin[2] + dir[2] * bestT)],
        target: best.player.id,
        dmg,
      });
      return;
    }
    if (best.kind === 'node') {
      this.harvestNode(p, best.node, eq);
      return;
    }
    if (best.kind === 'piece') {
      const piece = best.piece;
      const dmg = Math.max(1, eq.nodeDmg * 0.8);
      this.damagePiece(piece, dmg, p);
      return;
    }
  }

  harvestNode(p, node, eq) {
    const info = NODE_TYPES[node.type];
    const amount = eq.gather?.[node.type] ?? 0;
    const res = NODE_RESOURCE[node.type];
    if (amount > 0) {
      const frac = (p.frac[res] || 0) + amount;
      const whole = Math.floor(frac);
      p.frac[res] = frac - whole;
      if (whole > 0) this.giveItem(p, res, whole);
    }
    node.hp -= eq.nodeDmg;
    this.net.broadcast({ t: 'nodestate', id: node.id, hp: Math.max(0, node.hp) });
    this.net.broadcast({
      t: 'fx',
      k: 'gather',
      i: p.id,
      node: node.id,
      res,
      amount,
    });
    if (node.hp <= 0) {
      node.dead = true;
      node.hp = 0;
      node.respawnAt = this.time + info.respawn;
      this.net.broadcast({ t: 'nodestate', id: node.id, hp: 0, dead: 1, in: info.respawn });
      this.net.broadcast({ t: 'fx', k: 'nodebroke', node: node.id, x: node.x, y: node.y, z: node.z, type: node.type });
    }
    p.stats.gathered += Math.max(0, amount);
  }

  damagePiece(piece, dmg, attacker) {
    piece.hp -= dmg;
    if (piece.hp <= 0) {
      // innehåll i förvaringslådor sprids
      if (piece.inv && Object.keys(piece.inv).length) {
        this.spawnBag(piece.x, piece.y, piece.z, piece.inv, null);
      }
      this.index.remove(piece.id);
      this.net.broadcast({ t: 'build', rm: [piece.id] });
      this.net.broadcast({ t: 'fx', k: 'piecebroke', id: piece.id, x: piece.x ?? 0, y: piece.y, z: piece.z ?? 0 });
      return true;
    }
    this.net.broadcast({ t: 'build', upd: [[piece.id, Math.round(piece.hp)]] });
    return false;
  }

  onPlace(p, msg) {
    if (!p.alive) return;
    const req = msg.piece;
    if (!req || typeof req.kind !== 'string' || !PIECES[req.kind]) return;
    const def = PIECES[req.kind];
    const piece = {
      id: this.nextPieceId++,
      kind: req.kind,
      gx: intOr(req.gx, 0),
      gz: intOr(req.gz, 0),
      level: intOr(req.level, 0),
      side: intOr(req.side, 0),
      y: 0,
      hp: def.hp,
      owner: p.id,
    };
    if (def.item) {
      piece.x = round2(req.x ?? p.body.x);
      piece.z = round2(req.z ?? p.body.z);
      piece.rot = Number.isFinite(req.rot) ? ((req.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : 0;
    }
    if (piece.kind === 'door') piece.open = 0;
    if (piece.kind === 'storage_box') piece.inv = {};

    // avståndskontroll (anti-fusk)
    const px = piece.x ?? piece.gx * GRID + GRID / 2;
    const pz = piece.z ?? piece.gz * GRID + GRID / 2;
    const dx = px - p.body.x;
    const dz = pz - p.body.z;
    if (Math.hypot(dx, dz) > REACH) {
      this.send(p, { t: 'fx', k: 'toofar' });
      return;
    }

    const check = canPlace(piece, this.index, this.world);
    if (!check.ok) {
      this.send(p, { t: 'fx', k: 'noplace', reason: check.reason });
      return;
    }
    piece.y = r2(check.y);

    // betala
    if (def.item) {
      const sel = p.hotbar[p.selected];
      const idx = sel && sel.item === piece.kind ? p.selected : p.hotbar.findIndex((s) => s && s.item === piece.kind);
      if (idx < 0 || !this.takeSlotItem(p, idx)) {
        this.send(p, { t: 'fx', k: 'nocost', need: def.cost });
        return;
      }
    } else if (!this.canAfford(p, def.cost)) {
      this.send(p, { t: 'fx', k: 'nocost', need: def.cost });
      return;
    }
    if (!def.item) this.pay(p, def.cost);

    this.index.add(piece);
    p.stats.built++;
    this.net.broadcast({ t: 'build', add: [this.serializePiece(piece)] });
    this.net.broadcast({ t: 'fx', k: 'place', id: piece.id });
    this.sendYou(p);
  }

  onDemolish(p, msg) {
    const piece = this.index.pieces.get(msg.id | 0);
    if (!piece) return;
    if (!p.alive || dist2D(p.body, piecePos(piece)) > 5) return;
    if (piece.kind === 'lootbag') return;
    // återbetalning 50 %
    const def = PIECES[piece.kind];
    if (def && piece.hp > def.hp * 0.6) {
      for (const [item, n] of Object.entries(def.cost)) this.giveItem(p, item, Math.floor(n / 2));
    } else {
      this.giveItem(p, 'wood', 5);
    }
    this.index.remove(piece.id);
    this.net.broadcast({ t: 'build', rm: [piece.id] });
    this.sendYou(p);
  }

  onCraft(p, msg) {
    const recipe = recipeById(msg.id);
    if (!recipe) return;
    if (!p.alive) return;
    if (!this.canAfford(p, recipe.cost)) {
      this.send(p, { t: 'fx', k: 'nocost', need: recipe.cost });
      return;
    }
    this.pay(p, recipe.cost);
    this.giveItem(p, recipe.out, recipe.count);
    p.stats.crafted += recipe.count;
    this.send(p, { t: 'fx', k: 'crafted', item: recipe.out, count: recipe.count });
    this.sendYou(p);
  }

  onSelect(p, msg) {
    const i = intOr(msg.slot, 0);
    if (i < 0 || i >= HOTBAR_SLOTS) return;
    p.selected = i;
    this.sendYou(p);
    this.send(p, { t: 'fx', k: 'select', slot: i });
  }

  onEat(p, msg) {
    const slotIndex = msg.slot === undefined ? p.selected : intOr(msg.slot, p.selected);
    const slot = p.hotbar[slotIndex];
    if (!slot) return;
    const def = ITEMS[slot.item];
    if (!def) return;
    if (def.kind === 'food') {
      p.hunger = Math.min(100, p.hunger + (def.food.hunger || 0));
      p.thirst = Math.min(100, p.thirst + (def.food.thirst || 0));
      p.hp = Math.min(100, p.hp + (def.food.heal || 0));
      this.takeSlotItem(p, slotIndex);
      this.send(p, { t: 'fx', k: 'ate', item: slot.item });
      this.sendYou(p);
    } else if (def.kind === 'heal') {
      p.hp = Math.min(100, p.hp + (def.heal || 0));
      this.takeSlotItem(p, slotIndex);
      this.send(p, { t: 'fx', k: 'heal', amount: def.heal });
      this.sendYou(p);
    }
  }

  onMoveItem(p, msg) {
    const piece = this.index.pieces.get(msg.id | 0);
    if (!piece || piece.kind !== 'storage_box') return;
    if (dist2D(p.body, piecePos(piece)) > 4.5) return;
    const item = String(msg.item || '');
    const count = Math.abs(intOr(msg.count, 1)) || 1;
    piece.inv = piece.inv || {};
    if (msg.dir === 'take') {
      const have = piece.inv[item] || 0;
      const take = Math.min(have, count);
      if (take <= 0) return;
      piece.inv[item] = have - take;
      if (piece.inv[item] <= 0) delete piece.inv[item];
      this.giveItem(p, item, take);
    } else {
      const n = this.takeItem(p, item, count);
      if (n <= 0) return;
      piece.inv[item] = (piece.inv[item] || 0) + n;
    }
    this.send(p, { t: 'container', id: piece.id, inv: piece.inv, name: PIECES.storage_box.name });
    this.sendYou(p);
  }

  onLoot(p, msg) {
    const bag = this.bags.get(msg.id | 0);
    if (!bag) return;
    if (!p.alive) return;
    if (dist2D(p.body, bag) > 4) return;
    if (this.time < p.combatUntil && p.id !== msg.force) {
      // i strid: plocka ett föremål i taget
      const item = String(msg.item || '');
      if (!item) return;
      const have = bag.items[item] || 0;
      const take = Math.min(have, Math.max(1, intOr(msg.count, 1)));
      if (take <= 0) return;
      bag.items[item] = have - take;
      if (bag.items[item] <= 0) delete bag.items[item];
      this.giveItem(p, item, take);
    } else {
      for (const [item, n] of Object.entries(bag.items)) this.giveItem(p, item, n);
      bag.items = {};
    }
    if (!Object.keys(bag.items).length) {
      this.bags.delete(bag.id);
      this.index.remove(bag.id);
      this.net.broadcast({ t: 'bag', rm: [bag.id] });
    } else {
      this.net.broadcast({ t: 'bag', upd: [this.serializePiece(bag)] });
    }
    this.sendYou(p);
  }

  /** Öppna förvaringslåda eller lootpåse (skickar innehållet till spelaren) */
  onOpen(p, msg) {
    const piece = this.index.pieces.get(msg.id | 0);
    if (!piece || !p.alive) return;
    if (dist2D(p.body, piecePos(piece)) > 4.5) return;
    if (piece.kind === 'storage_box') {
      this.send(p, { t: 'container', id: piece.id, inv: piece.inv || {}, name: PIECES.storage_box.name });
    } else if (piece.kind === 'lootbag') {
      this.send(p, {
        t: 'bag',
        upd: [this.serializePiece(piece)],
        open: 1,
      });
    }
  }

  onDoor(p, msg) {
    const piece = this.index.pieces.get(msg.id | 0);
    if (!piece || piece.kind !== 'door') return;
    if (dist2D(p.body, piecePos(piece)) > 4.5) return;
    piece.open = piece.open ? 0 : 1;
    this.net.broadcast({ t: 'build', upd: [[piece.id, piece.hp, piece.open]] });
    this.net.broadcast({ t: 'fx', k: 'door', id: piece.id, open: piece.open });
  }

  onChat(p, msg) {
    let text = String(msg.msg || '').slice(0, 200).trim();
    if (!text) return;
    if (text.startsWith('/')) {
      this.command(p, text);
      return;
    }
    const entry = { name: p.name, id: p.id, msg: text, ts: Date.now() };
    this.chatLog.push(entry);
    if (this.chatLog.length > 120) this.chatLog.shift();
    this.net.broadcast({ t: 'chat', ...entry });
  }

  command(p, text) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ');
    if (cmd === 'spawn' || cmd === 'respawn') {
      if (!p.alive) this.respawn(p, true);
    } else if (cmd === 'kill') {
      this.killPlayer(p, null, 'kommando');
    } else if (cmd === 'help') {
      this.pushChat('Server', '/spawn  /kill  /time <0-1>  /give <item> <antal>  /players  /seed', true);
    } else if (cmd === 'players') {
      const list = [...this.players.values()].map((q) => `${q.name}${q.sleeper ? ' (sover)' : ''}`).join(', ');
      this.pushChat('Server', `Online (${this.onlineCount}): ${list}`, true);
    } else if (cmd === 'seed') {
      this.pushChat('Server', `Seed: ${this.world.seed}`, true);
    } else if (cmd === 'time') {
      const v = parseFloat(arg);
      if (Number.isFinite(v)) this.dayFraction = Math.max(0, Math.min(0.999, v));
    } else if (cmd === 'tp') {
      const target = [...this.players.values()].find((q) => q.name.toLowerCase() === arg.trim().toLowerCase());
      if (!target) {
        this.pushChat('Server', `Hittar ingen spelare som heter "${arg}"`, true);
        return;
      }
      const spot = this.findSpawnNear(target.body.x, target.body.z);
      p.body.x = spot.x;
      p.body.y = spot.y + 0.4;
      p.body.z = spot.z;
      p.body.vx = p.body.vy = p.body.vz = 0;
      this.send(p, { t: 'respawned', pos: [r2(spot.x), r2(spot.y + 0.4), r2(spot.z)] });
      this.pushChat('Server', `${p.name} teleporterades till ${target.name}`, true);
    } else if (cmd === 'give') {
      const [item, n] = rest;
      if (ITEMS[item]) {
        this.giveItem(p, item, Math.max(1, Math.min(9999, intOr(n, 1))));
        this.sendYou(p);
      }
    }
  }

  pushChat(name, msg, system = false) {
    const entry = { name, msg, ts: Date.now(), system };
    this.chatLog.push(entry);
    if (this.chatLog.length > 120) this.chatLog.shift();
    this.net.broadcast({ t: 'chat', ...entry });
  }

  // ---------------------------------------------------------------- inventarie

  giveItem(p, item, count) {
    if (!count) return;
    const def = ITEMS[item];
    if (!def) return;
    if (RESOURCES.has(item)) {
      p.inv[item] = (p.inv[item] || 0) + count;
      this.sendYou(p);
      return;
    }
    // allt annat hamnar i hotbaren
    const stacked = p.hotbar.findIndex((s) => s && s.item === item && s.count < maxStack(item));
    if (stacked >= 0) {
      p.hotbar[stacked].count += count;
    } else {
      const empty = p.hotbar.findIndex((s) => !s);
      if (empty < 0) {
        p.inv[item] = (p.inv[item] || 0) + count;
      } else {
        p.hotbar[empty] = { item, count: Math.min(count, maxStack(item)) };
        const extra = count - p.hotbar[empty].count;
        if (extra > 0) {
          const more = p.hotbar.findIndex((s, i) => i !== empty && s && s.item === item);
          if (more >= 0) p.hotbar[more].count += extra;
          else p.inv[item] = (p.inv[item] || 0) + extra;
        }
      }
    }
    this.sendYou(p);
  }

  takeItem(p, item, count) {
    let left = count;
    if (p.inv[item]) {
      const t = Math.min(p.inv[item], left);
      p.inv[item] -= t;
      if (p.inv[item] <= 0) delete p.inv[item];
      left -= t;
    }
    if (left > 0) {
      for (const slot of p.hotbar) {
        if (!slot || slot.item !== item) continue;
        const t = Math.min(slot.count, left);
        slot.count -= t;
        left -= t;
        if (slot.count <= 0) {
          const i = p.hotbar.indexOf(slot);
          p.hotbar[i] = null;
        }
        if (left <= 0) break;
      }
    }
    const taken = count - left;
    if (taken > 0) this.sendYou(p);
    return taken;
  }

  takeSlotItem(p, slotIndex) {
    const slot = p.hotbar[slotIndex];
    if (!slot) return false;
    slot.count -= 1;
    if (slot.count <= 0) p.hotbar[slotIndex] = null;
    return true;
  }

  canAfford(p, cost) {
    for (const [item, n] of Object.entries(cost)) {
      const have = (p.inv[item] || 0) + p.hotbar.reduce((a, s) => a + (s && s.item === item ? s.count : 0), 0);
      if (have < n) return false;
    }
    return true;
  }

  pay(p, cost) {
    for (const [item, n] of Object.entries(cost)) this.takeItem(p, item, n);
  }

  sendYou(p) {
    this.send(p, {
      t: 'inv',
      inv: p.inv,
      hotbar: p.hotbar,
      selected: p.selected,
      equipped: this.equippedItem(p) || 'hand',
      stats: p.stats,
      kills: p.kills,
      deaths: p.deaths,
    });
  }

  // ------------------------------------------------------------------- strid

  damagePlayer(target, dmg, attacker, cause = '') {
    if (!target.alive || !Number.isFinite(dmg)) return;
    target.hp -= dmg;
    target.lastDamageFrom = attacker ? attacker.id : null;
    target.lastDamageAt = this.time;
    target.combatUntil = this.time + 20;
    if (attacker && attacker !== target) attacker.combatUntil = this.time + 20;
    this.send(target, { t: 'hurt', dmg: Math.round(dmg), from: attacker ? attacker.name : cause, hp: Math.max(0, Math.round(target.hp)) });
    if (target.hp <= 0) this.killPlayer(target, attacker, cause);
  }

  killPlayer(p, killer, cause = '') {
    if (!p.alive) return;
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.respawnAt = this.time + RESPAWN_TIME;
    p.body.vx = p.body.vy = p.body.vz = 0;
    const items = { ...p.inv };
    for (const slot of p.hotbar) {
      if (slot) items[slot.item] = (items[slot.item] || 0) + slot.count;
    }
    if (killer) killer.kills++;
    this.spawnBag(p.body.x, p.body.y, p.body.z, items, p.id);
    p.inv = {};
    p.frac = {};
    p.hotbar = new Array(HOTBAR_SLOTS).fill(null);
    p.selected = 0;
    this.net.broadcast({
      t: 'death',
      id: p.id,
      name: p.name,
      killer: killer ? killer.name : cause || 'världen',
      killerId: killer ? killer.id : null,
      pos: [r2(p.body.x), r2(p.body.y), r2(p.body.z)],
    });
    this.pushChat('Killfeed', `${p.name} dödades av ${killer ? killer.name : cause || 'världen'}`, true);
    this.sendYou(p);
    this.send(p, { t: 'youdead', in: RESPAWN_TIME });
    if (killer) this.sendYou(killer);
  }

  spawnBag(x, y, z, items, ownerId) {
    const bag = {
      id: this.nextBagId++,
      kind: 'lootbag',
      x: r2(x),
      y: r2(y),
      z: r2(z),
      gx: Math.floor(x / GRID),
      gz: Math.floor(z / GRID),
      level: 0,
      hp: 100,
      items: items || {},
      owner: ownerId || null,
      spawnAt: this.time,
    };
    this.bags.set(bag.id, bag);
    this.index.add(bag);
    this.net.broadcast({ t: 'bag', add: [this.serializePiece(bag)] });
    return bag;
  }

  respawn(p, force = false) {
    if (p.alive && !force) return;
    const spawn = this.findSpawn();
    p.body = createBody(spawn.x, spawn.y + 0.4, spawn.z, Math.random() * Math.PI * 2);
    p.hp = 100;
    p.hunger = 85;
    p.thirst = 85;
    p.warmth = 100;
    p.alive = true;
    p.combatUntil = -100;
    p.respawnAt = 0;
    p.input = { f: 0, r: 0, j: false, s: false, c: false };
    this.send(p, { t: 'respawned', pos: [r2(spawn.x), r2(spawn.y + 0.4), r2(spawn.z)] });
    this.sendYou(p);
  }

  // --------------------------------------------------------------- projektiler

  stepProjectiles(dt) {
    if (!this.projectiles.length) return;
    const keep = [];
    for (const pr of this.projectiles) {
      pr.ttl -= dt;
      if (pr.ttl <= 0) continue;
      const steps = Math.min(8, Math.ceil(Math.hypot(pr.vx, pr.vy, pr.vz) * dt / 0.6));
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        const sdt = dt / steps;
        pr.vy += -11 * sdt;
        const nx = pr.x + pr.vx * sdt;
        const ny = pr.y + pr.vy * sdt;
        const nz = pr.z + pr.vz * sdt;
        // mark
        if (ny <= this.world.heightAt(nx, nz)) {
          this.net.broadcast({ t: 'fx', k: 'arrowhit', x: r2(nx), y: r2(ny), z: r2(nz), mat: 'ground' });
          hit = true;
          break;
        }
        for (const q of this.players.values()) {
          if (q.id === pr.owner || !q.alive) continue;
          if (Math.abs(q.body.x - nx) > 1 || Math.abs(q.body.z - nz) > 1) continue;
          if (ny > q.body.y && ny < q.body.y + PLAYER.height) {
            const shooter = this.players.get(pr.owner);
            this.damagePlayer(q, pr.dmg, shooter, 'pil');
            this.net.broadcast({ t: 'fx', k: 'arrowhit', x: r2(nx), y: r2(ny), z: r2(nz), mat: 'player', target: q.id });
            hit = true;
            break;
          }
        }
        if (hit) break;
        const piece = this.pieceAt(nx, ny, nz);
        if (piece) {
          this.damagePiece(piece, pr.dmg * 0.5, this.players.get(pr.owner));
          this.net.broadcast({ t: 'fx', k: 'arrowhit', x: r2(nx), y: r2(ny), z: r2(nz), mat: 'wood' });
          hit = true;
          break;
        }
        pr.x = nx;
        pr.y = ny;
        pr.z = nz;
      }
      if (!hit) keep.push(pr);
    }
    this.projectiles = keep;
  }

  pieceAt(x, y, z) {
    for (const p of this.index.near(x, z, 1.6)) {
      if (p.kind === 'door') continue;
      const bb = pieceAABB(p);
      if (x >= bb.min[0] && x <= bb.max[0] && y >= bb.min[1] && y <= bb.max[1] && z >= bb.min[2] && z <= bb.max[2]) return p;
    }
    return null;
  }

  // ------------------------------------------------------------------- tick

  tick(dt) {
    this.time += dt;
    this.tickCount++;
    this.dayFraction = (this.dayFraction + dt / CONFIG.dayLength) % 1;

    const ctx = this.moveCtx();
    for (const p of this.players.values()) {
      if (p.alive && p.connected) {
        // tappar vi kontakten slutar spelaren gå (inga "spökgångare")
        if (this.time - (p.lastInputAt || 0) > 1) {
          p.input.f = 0;
          p.input.r = 0;
          p.input.j = false;
          p.input.s = false;
        }
        stepBody(p.body, p.input, dt, ctx);
        if (p.body.fallImpact > 17) {
          const dmg = (p.body.fallImpact - 17) * 3.2;
          p.body.fallImpact = 0;
          this.damagePlayer(p, dmg, null, 'fall');
        }
        p.stats.playtime += dt;
      } else if (p.alive && !p.connected) {
        // sovande kropp: står still
        stepBody(p.body, { f: 0, r: 0, j: false, s: false, c: false }, dt, ctx);
      }
      if (!p.alive && p.respawnAt && this.time > p.respawnAt) this.respawn(p, true);
      this.updateSurvival(p, dt);
    }
    this.stepProjectiles(dt);
    this.updateNodes();

    if (this.tickCount % 10 === 0) {
      for (const p of this.players.values()) {
        if (!p.connected) continue;
        this.send(p, {
          t: 'stats',
          hp: Math.round(p.hp * 10) / 10,
          hunger: Math.round(p.hunger * 10) / 10,
          thirst: Math.round(p.thirst * 10) / 10,
          warmth: Math.round(p.warmth * 10) / 10,
          fever: p.warmth >= 99.5 ? 1 : 0,
          ambient: Math.round((p.ambient ?? 15) * 10) / 10,
          sheltered: p.sheltered ? 1 : 0,
          fire: +(p.nearFire || 0).toFixed(2),
          alive: p.alive ? 1 : 0,
          respawnIn: p.alive ? 0 : Math.max(0, Math.round((p.respawnAt - this.time) * 10) / 10),
          inWater: p.body.inWater ? 1 : 0,
          online: this.onlineCount,
        });
      }
    }

    if (this.tickCount % SNAPSHOT_EVERY === 0) {
      this.net.broadcast({
        t: 'state',
        s: this.snapshot(),
        day: +this.dayFraction.toFixed(5),
        time: +this.time.toFixed(2),
        online: this.onlineCount,
        bags: this.bags.size,
      });
    }
  }

  moveCtx() {
    const world = this.world;
    const index = this.index;
    const aabbCache = new Map();
    return {
      bounds: world.half - 2,
      waterLevel: world.waterLevel,
      terrainHeight: (x, z) => world.heightAt(x, z),
      colliders: (x, z, r) => index.near(x, z, r),
      aabb: (p) => {
        let bb = aabbCache.get(p.id);
        if (!bb) {
          bb = pieceAABB(p);
          aabbCache.set(p.id, bb);
        }
        return bb;
      },
      onFall: null,
    };
  }

  updateSurvival(p, dt) {
    if (!p.alive) return;
    const terrain = this.world.heightAt(p.body.x, p.body.z);
    const inWater = terrain < this.world.waterLevel - 0.25 && p.body.y < this.world.waterLevel + 0.3;

    // aktivitet
    const activity = p.body.sprinting ? 1.9 : p.body.moving ? 1.15 : 0.75;
    const coldMult = p.warmth < 40 ? 1.4 : 1;
    p.hunger = Math.max(0, p.hunger - dt * 0.075 * activity * coldMult);
    p.thirst = Math.max(0, p.thirst - dt * (p.warmth < 30 || p.feverish ? 0.15 : 0.1) * activity);

    // skydd (tak + väggar) och eld – uppdateras några gånger per sekund
    if (this.tickCount % 10 === p.id % 10) {
      p.sheltered = this.isSheltered(p);
      p.nearFire = this.nearCampfire(p);
    }

    // Värme: kroppen tappar värme i kyla och vinner värme vid eld
    let ambient = -5 + daylight(this.dayFraction) * 25; // -5 (natt) .. 20 (dag)
    if (inWater) ambient -= 12;
    if (p.sheltered) ambient += 7;
    ambient = Math.max(-15, ambient);
    p.ambient = ambient;
    const fire = p.nearFire || 0;
    if (ambient < 15) {
      let drain = (15 - ambient) * 0.02; // 0,4/s en kall natt
      if (p.sheltered) drain *= 0.55;
      p.warmth -= drain * dt;
    } else {
      p.warmth += (ambient - 15) * 0.012 * dt;
    }
    if (fire > 0) p.warmth += 7 * fire * dt;
    p.warmth = Math.max(0, Math.min(100, p.warmth));
    const overheating = fire > 0.72 && p.warmth >= 99.5;

    // effekter av hunger, törst och värme
    let dmg = 0;
    if (p.warmth <= 0) dmg += dt * 1.5;
    else if (p.warmth < 18) dmg += dt * 0.25;
    if (overheating) dmg += dt * 0.5;
    if (p.hunger <= 0) dmg += dt * 1.2;
    if (p.thirst <= 0) dmg += dt * 1.8;

    if (dmg > 0) {
      p.hp -= dmg;
      if (p.hp <= 0) {
        this.killPlayer(p, null, p.warmth <= 0 ? 'nedfrysning' : overheating ? 'hetta' : p.hunger <= 0 ? 'svält' : p.thirst <= 0 ? 'uttorkning' : 'skada');
        return;
      }
    } else if (p.hunger > 35 && p.thirst > 35 && p.warmth > 55 && p.hp < 100) {
      p.hp = Math.min(100, p.hp + dt * 0.5);
    }
  }

  isSheltered(p) {
    const cell = { gx: Math.floor(p.body.x / GRID), gz: Math.floor(p.body.z / GRID) };
    const level = Math.floor((p.body.y + 0.2) / LEVEL_H);
    // tak över huvudet?
    let roof = false;
    for (let i = -1; i <= 1 && !roof; i++) {
      for (let j = -1; j <= 1 && !roof; j++) {
        for (let l = level; l <= level + 2; l++) {
          const f = this.index.floor(cell.gx + i, cell.gz + j, l);
          if (f && f.y > p.body.y + 1.6 && f.y < p.body.y + 5) {
            roof = true;
            break;
          }
        }
      }
    }
    if (!roof) return false;
    // minst två väggar runt cellen
    let walls = 0;
    for (let side = 0; side < 4; side++) {
      const list = this.index.edgeOf(cell.gx, cell.gz, side, level);
      if (list.some((q) => q.kind === 'wall' || q.kind === 'doorway' || q.kind === 'door')) walls++;
    }
    return walls >= 2;
  }

  nearCampfire(p) {
    let best = 0;
    for (const piece of this.index.props.values()) {
      if (piece.kind !== 'campfire') continue;
      const d = Math.hypot(piece.x - p.body.x, piece.z - p.body.z);
      if (d > 6) continue;
      best = Math.max(best, Math.pow(Math.max(0, 1 - d / 6), 1.5));
    }
    return best;
  }

  updateNodes() {
    for (const n of this.world.nodes) {
      if (n.dead && this.time > n.respawnAt) {
        n.dead = false;
        n.hp = NODE_TYPES[n.type].hp;
        n.respawnAt = 0;
        this.net.broadcast({ t: 'nodestate', id: n.id, hp: n.hp, alive: 1 });
      }
    }
  }

  // ------------------------------------------------------------- persistens

  serialize() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        token: p.token,
        alive: p.alive,
        sleeper: true,
        body: p.body,
        hp: p.hp,
        hunger: p.hunger,
        thirst: p.thirst,
        inv: p.inv,
        hotbar: p.hotbar,
        selected: p.selected,
        kills: p.kills,
        deaths: p.deaths,
        stats: p.stats,
        respawnAt: p.alive ? 0 : Math.max(this.time + 5, p.respawnAt),
      });
    }
    const nodes = [];
    for (const n of this.world.nodes) {
      if (n.dead || n.hp < NODE_TYPES[n.type].hp) {
        nodes.push([n.id, n.hp, n.dead ? 1 : 0, Math.max(0, Math.round(n.respawnAt - this.time))]);
      }
    }
    const buildings = [];
    for (const piece of this.index.pieces.values()) {
      if (piece.kind === 'lootbag') continue;
      buildings.push(piece);
    }
    const bags = [...this.bags.values()];
    return {
      savedAt: Date.now(),
      seed: this.world.seed,
      time: this.time,
      dayFraction: this.dayFraction,
      nextId: this.nextId + 1,
      nextPieceId: this.nextPieceId + 1,
      nextBagId: this.nextBagId + 1,
      tokens: this.tokens,
      players,
      buildings,
      bags,
      nodes,
    };
  }

  loadSave(save) {
    if (!save || !save.players) return;
    try {
      this.time = save.time || 0;
      this.dayFraction = save.dayFraction ?? 0.28;
      this.nextId = save.nextId || 1;
      this.nextPieceId = save.nextPieceId || 1;
      this.nextBagId = save.nextBagId || 1;
      this.tokens = save.tokens || {};
      for (const s of save.players) {
        const body = Object.assign(createBody(), s.body || {});
        const p = {
          ...s,
          conn: null,
          connected: false,
          sleeper: true,
          body,
          input: { f: 0, r: 0, j: false, s: false, c: false },
          lastSeq: 0,
          hotbar: padHotbar(s.hotbar),
          inv: s.inv || {},
          frac: {},
          lastHit: -10,
          combatUntil: -100,
          sheltered: false,
          nearFire: 0,
          ambient: 15,
          stats: s.stats || { gathered: 0, crafted: 0, built: 0, playtime: 0 },
        };
        this.players.set(p.id, p);
        if (p.token) this.byToken.set(p.token, p.id);
        this.byName.set(String(p.name).toLowerCase(), p.id);
      }
      for (const piece of save.buildings || []) this.index.add(piece);
      for (const bag of save.bags || []) {
        this.bags.set(bag.id, bag);
        this.index.add(bag);
      }
      // nodrestaurering
      const map = new Map(this.world.nodes.map((n) => [n.id, n]));
      for (const [id, hp, dead, inSec] of save.nodes || []) {
        const n = map.get(id);
        if (!n) continue;
        n.hp = hp;
        if (dead) {
          n.dead = true;
          n.respawnAt = this.time + (inSec || 30);
        }
      }
    } catch (err) {
      console.error('Kunde inte läsa sparfilen:', err.message);
    }
  }
}

// ------------------------------------------------------------------ hjälpare

function round2(v) {
  return Math.round((v || 0) * 100) / 100;
}
const r2 = round2;

function intOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : d;
}

function clampNum(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(a, Math.min(b, n));
}

function padHotbar(hb) {
  const out = new Array(HOTBAR_SLOTS).fill(null);
  if (Array.isArray(hb)) for (let i = 0; i < HOTBAR_SLOTS; i++) out[i] = hb[i] || null;
  return out;
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Ray-sphere: returnerar t (avstånd längs strålen) eller null */
function raySphere(o, d, c, r) {
  const ox = c[0] - o[0];
  const oy = c[1] - o[1];
  const oz = c[2] - o[2];
  const tca = ox * d[0] + oy * d[1] + oz * d[2];
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > r * r) return null;
  const thc = Math.sqrt(r * r - d2);
  const t0 = tca - thc;
  return t0 >= 0 ? t0 : tca + thc >= 0 ? 0 : null;
}

/** Ray-AABB (slab-metoden) */
function rayBox(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / (d[i] || 1e-9);
    let t1 = (min[i] - o[i]) * inv;
    let t2 = (max[i] - o[i]) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
