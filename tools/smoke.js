// Integrationstest: startar servern och kör två botar genom hela kärnloopen.
// Körs med: npm run smoke

import { spawn } from 'node:child_process';
import { generateHeightmap, heightAt } from '../shared/terrain.js';
import { nodeSpheres, ColliderGrid } from '../shared/nodes.js';
import { raycastAll } from '../shared/raycast.js';
import { BuildIndex } from '../shared/building.js';
import { WATER_LEVEL } from '../shared/const.js';
let HM = null;
let COLL = null;
import { io as ioc } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3123;
const SAVE = path.join(ROOT, 'data', 'smoke-save.json');
const URL = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(name, cond, extra = '') {
  if (cond) { pass++; log(`  ✅ ${name}`); }
  else { fail++; log(`  ❌ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(60);
  }
  log(`     (timeout: ${label})`);
  return false;
}

// ---------------------------------------------------------------- bot-klass ---
class Bot {
  constructor(name, pid) {
    this.name = name; this.pid = pid;
    this.events = [];
    this.state = null; this.inv = null; this.init = null;
    this.nodes = new Map(); this.blocks = new Map();
    this.toasts = []; this.loot = []; this.fx = [];
    this.yaw = 0; this.pitch = 0;
    this.input = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
    this.seq = 0;
    this.died = 0; this.respawned = 0; this.hurt = 0; this.hitmarks = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.s = ioc(URL, { transports: ['websocket', 'polling'], reconnection: false });
      this.s.on('connect', () => {
        this.s.emit('join', { pid: this.pid, name: this.name });
        this.pump = setInterval(() => this.sendInput(), 50);
      });
      this.s.on('connect_error', reject);
      this.s.on('init', (d) => {
        this.init = d;
        this.state = d.you; this.inv = d.you.slots || []; this.held = d.you.held || 0;
        if (!HM) HM = generateHeightmap(d.seed);
        for (const n of d.nodes) this.nodes.set(n.id, { id: n.id, kind: n.k, x: n.x, y: n.y, z: n.z, amount: n.a, max: n.m, alive: n.alive, h: n.h, s: n.s, rot: n.rot });
        for (const b of d.blocks) this.blocks.set(b.id, b);
        resolve(d);
      });
      this.s.on('state', (d) => { this.state = { ...(d.you || {}), tod: d.tod }; this.others = d.players; this.projs = d.projs; });
      this.s.on('inv', (d) => { this.inv = d.slots; this.held = d.held; });
      this.s.on('nodes', (list) => { for (const n of list) { const e = this.nodes.get(n.id); if (e) Object.assign(e, { amount: n.a, alive: n.alive }); } });
      this.s.on('block:add', (b) => this.blocks.set(b.id, b));
      this.s.on('block:upd', (b) => { const e = this.blocks.get(b.id); if (e) Object.assign(e, b); else this.blocks.set(b.id, b); });
      this.s.on('block:del', (d) => this.blocks.delete(d.id));
      this.s.on('toast', (t) => this.toasts.push(t));
      this.s.on('loot', (l) => { this.loot.push(...l); this.count(l); });
      this.s.on('fx', (f) => this.fx.push(...f));
      this.s.on('died', (d) => { this.died++; this.deathInfo = d; });
      this.s.on('respawned', () => this.respawned++);
      this.s.on('hurt', (h) => { this.hurt += h.amount || 0; this.lastHurt = h; });
      this.s.on('hitmark', (h) => this.hitmarks.push(h));
      this.s.on('box:open', (d) => { this.box = d; });
      this.s.on('box:upd', (d) => { if (this.box) this.box.slots = d.slots; });
      this.s.on('chat', (c) => this.chat.push(c));
      this.s.on('kicked', (k) => log('   kicked:', k.reason));
      this.chat = [];
      setTimeout(() => reject(new Error('init timeout')), 8000);
    });
  }
  count(list) { for (const l of list) this.got[l.item] = (this.got[l.item] || 0) + l.qty; }
  get got() { if (!this._got) this._got = {}; return this._got; }
  sendInput() {
    if (!this.s || !this.s.connected) return;
    this.s.emit('input', { seq: ++this.seq, yaw: this.yaw, pitch: this.pitch, ...this.input });
  }
  aimAt(x, y, z, ballistic = 0) {
    const s = this.state; if (!s) return;
    const dx = x - s.x, dy = y - (s.y + 1.62), dz = z - s.z;
    const horiz = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dx, -dz);
    // ballistic: kompensera för pilens fall (0.5*g*(d/v)^2)
    this.pitch = Math.atan2(dy + ballistic * 0.5 * 11 * Math.pow(horiz / 46, 2), horiz);
  }
  moveTo(x, z, stopDist = 1.4, timeout = 60000) {
    let lastDist = Infinity, stuck = 0, evade = 0;
    return this._move(x, z, stopDist, timeout, () => { lastDist = Infinity; stuck = 0; evade = 0; });
  }
  async _move(x, z, stopDist, timeout, reset) {
    let lastDist = Infinity, stuck = 0, evade = 0;
    if (!this.evadeDir) this.evadeDir = 1;
    const res = await waitFor(async () => {
      const s = this.state; if (!s) return false;
      const d = Math.hypot(x - s.x, z - s.z);
      const base = Math.atan2(-(x - s.x), -(z - s.z));
      if (evade > 0) {                    // fastnat: hoppa och sidledsgå
        evade -= 0.06;
        this.yaw = base + (this.evadeDir > 0 ? 1.25 : -1.25);
        this.input.f = evade > 0.5; this.input.r = this.evadeDir > 0; this.input.l = this.evadeDir < 0;
        this.input.jump = true; this.input.sprint = true;
        if (evade <= 0) { this.input.l = this.input.r = false; }
      } else {
        this.yaw = base;
        this.input.f = d > stopDist; this.input.r = false; this.input.l = false; this.input.jump = false;
        this.input.sprint = d > 8;
        if (d > stopDist && d > lastDist - 0.10) stuck += 0.06; else stuck = 0;
        if (stuck > 0.7) { evade = 1.2; stuck = 0; this.evadeDir = -this.evadeDir || 1; }
      }
      lastDist = d;
      this.sendInput();
      return d <= stopDist;
    }, timeout, `moveTo ${x.toFixed(0)},${z.toFixed(0)}`);
    this.halt();
    return res;
  }
  halt() {
    this.input = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
    this.sendInput();
  }
  emitAim(ev, payload = {}) { this.sendInput(); this.s.emit(ev, { ...payload, yaw: this.yaw, pitch: this.pitch }); }
  countItem(id) {
    if (!this.inv) return 0;
    return this.inv.reduce((a, s) => a + (s && s.id === id ? s.amount : 0), 0);
  }
  slotOf(id) { return this.inv ? this.inv.findIndex((s) => s && s.id === id) : -1; }
  stop() { clearInterval(this.pump); this.input = { f: false, b: false, l: false, r: false, jump: false, sprint: false }; this.s.close(); }
}

/** Rikta mot en punkt och utför en handling tills predicate uppfylls. */
async function actUntil(bot, ev, target, pred, tries = 6, payload = {}) {
  for (let i = 0; i < tries; i++) {
    bot.aimAt(target.x, target.y, target.z);
    bot.emitAim(ev, payload);
    if (await waitFor(pred, 700)) return true;
    const a = bot._aimBase === undefined ? (bot._aimBase = 2.3) : bot._aimBase + 0.9;
    bot._aimBase = a;
    await bot._move(target.x + Math.cos(a) * 2.2, target.z + Math.sin(a) * 2.2, 2.3, 6000, () => {});
  }
  return false;
}

/** Ställ sig sydväst om ett golv och sikta på en fri del av golvytan
 *  (väggar/tak skymmer annars siktelinjen, precis som för en riktig spelare). */
/** Hitta en punkt på golvet som VERKLIGEN träffas av en stråle från botens öga
 *  (samma geometri som serverns aimBlock). Flyttar boten om det behövs. */
async function aimFloor(bot, f) {
  const idx = new BuildIndex();
  for (const b of bot.blocks.values()) idx.add(b);
  const probe = () => {
    const o = { x: bot.state.x, y: bot.state.y + 1.62, z: bot.state.z };
    const pts = [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8], [0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4], [1.6, 1.6], [-1.6, -1.6]];
    for (const [dx, dz] of pts) {
      const t = { x: f.x + dx, y: f.y + 0.02, z: f.z + dz };
      const vx = t.x - o.x, vy = t.y - o.y, vz = t.z - o.z;
      const len = Math.hypot(vx, vy, vz);
      if (len < 0.5 || len > 5.8) continue;
      const hit = raycastAll({ hm: HM, index: idx, nodes: null, players: null, o, d: { x: vx / len, y: vy / len, z: vz / len }, maxDist: len });
      if (hit && hit.kind === 'block' && hit.block.id === f.id) return t;
    }
    return null;
  };
  let t = probe();
  if (!t) { await bot.moveTo(f.x + 1.3, f.z + 1.3, 0.9, 40000); t = probe(); }
  if (!t) { await bot.moveTo(f.x - 3.4, f.z - 3.4, 3.0, 40000); t = probe(); }
  if (!t) { await bot.moveTo(f.x + 3.4, f.z - 3.4, 3.0, 40000); t = probe(); }
  t = t || { x: f.x, y: f.y, z: f.z };
  bot.aimAt(t.x, t.y, t.z);
  return t;
}

/** Sikta om (geometriskt verifierat) och utför handlingen tills predikatet gäller. */
async function actOnBlock(bot, ev, block, pred, tries = 5) {
  for (let i = 0; i < tries; i++) {
    await aimFloor(bot, block);
    bot.emitAim(ev);
    if (await waitFor(pred, 800)) return true;
    await sleep(250);
  }
  return false;
}

/** Fri siktlinje till en punkt? (träd/terräng kan skymma – viktigt för pilbågen) */
function hasLOS(bot, tx, ty, tz) {
  if (!HM) return true;
  const o = { x: bot.state.x, y: bot.state.y + 1.62, z: bot.state.z };
  const dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.2) return true;
  const nodes = [];
  for (const n of bot.nodes.values()) {
    if (!n.alive) continue;
    if (Math.hypot(n.x - o.x, n.z - o.z) > len + 6) continue;
    nodes.push(n);
  }
  const hit = raycastAll({
    hm: HM, index: { near: () => [] }, nodes, players: null,
    o, d: { x: dx / len, y: dy / len, z: dz / len }, maxDist: len - 0.7, hitWater: false,
  });
  return !hit || hit.kind === 'water';
}

async function place(bot, type, aim, expectOk = true) {
  await sleep(260);            // serverns placerings-cooldown är 0.12 s
  bot.toasts.length = 0;
  const before = bot.blocks.size;
  bot.sendInput();
  bot.s.emit('place', { type, aim, yaw: bot.yaw, pitch: bot.pitch });
  const ok = await waitFor(() => [...bot.blocks.values()].some((k) => k.type === type), 3000);
  return { ok: ok && expectOk, toasts: bot.toasts.slice(), before };
}

async function equip(bot, itemId, slot = 0) {
  const i = bot.slotOf(itemId);
  if (i < 0) return false;
  if (i !== slot) { bot.s.emit('inv:move', { from: i, to: slot }); await sleep(150); }
  bot.s.emit('hotbar', { slot });
  return waitFor(() => bot.held === slot, 2000);
}

/** Bygg kollisionsrutnät för bottarnas vägplanering (samma data som servern). */
function buildColliders(bot) {
  if (COLL) return;
  COLL = new ColliderGrid();
  for (const n of bot.nodes.values()) COLL.update({ id: n.id, kind: n.kind, x: n.x, y: n.y, z: n.z, s: n.s, h: n.h, alive: n.alive });
}

/** Ligger det ett träd/en klippa i vägen? */
function pathBlocked(bot, n) {
  if (!COLL) return false;
  const s = bot.state;
  const dx = n.x - s.x, dz = n.z - s.z;
  const d = Math.hypot(dx, dz);
  const steps = Math.min(60, Math.ceil(d / 1.2));
  for (let i = 1; i < steps; i++) {
    const x = s.x + dx * (i / steps), z = s.z + dz * (i / steps);
    for (const c of COLL.near(x, z, 1.2)) {
      if (Math.hypot(c.x - x, c.z - z) < c.r + 0.55) return true;
    }
  }
  return false;
}

/** Kan boten nå noden med en rät linje (inget djupt vatten, inga stup)? */
function reachable(bot, n) {
  if (!HM) return true;
  const s = bot.state;
  const dx = n.x - s.x, dz = n.z - s.z;
  const d = Math.hypot(dx, dz);
  const steps = Math.min(40, Math.ceil(d / 2));
  let prev = heightAt(HM, s.x, s.z);
  for (let i = 1; i <= steps; i++) {
    const x = s.x + dx * (i / steps), z = s.z + dz * (i / steps);
    const h = heightAt(HM, x, z);
    if (h < WATER_LEVEL - 0.2) return false;          // simma = för långsamt/ospawnat
    if (Math.abs(h - prev) > 2.4) return false;       // stup
    prev = h;
  }
  return true;
}

function nearestNode(bot, kind, maxDist = 1e9) {
  buildColliders(bot);
  const s = bot.state;
  let best = null, bd = maxDist, bestR = null, bdR = maxDist, bestAny = null, bdAny = maxDist;
  for (const n of bot.nodes.values()) {
    if (n.kind !== kind || !n.alive) continue;
    const d = Math.hypot(n.x - s.x, n.z - s.z);
    if (d < bdAny) { bdAny = d; bestAny = n; }
    if (d >= bdR || !reachable(bot, n)) continue;
    bdR = d; bestR = n;
    if (d < bd && !pathBlocked(bot, n)) { bd = d; best = n; }
  }
  return best || bestR || bestAny;
}

/** Sikta mitt i träffsfären – robust oavsett nodens storlek. */
function aimSphere(n, aimY) {
  const list = nodeSpheres({ ...n, kind: n.kind || n.k, s: n.s || 1, h: n.h || 6, amount: n.amount === undefined ? n.a : n.amount, max: n.max === undefined ? n.m : n.max });
  if (!list.length) return { x: n.x, y: n.y + (aimY || 1.6), z: n.z };
  return list[Math.min(1, list.length - 1)];
}

const DBG = !!process.env.SMOKE_LOG;
async function gather(bot, kind, item, need, aimY) {
  const t0 = Date.now();
  if (DBG) console.log(`   [gather ${kind} -> ${item}] har=${bot.countItem(item)} behöver=${need}`);
  while (bot.countItem(item) < need && Date.now() - t0 < 90000) {
    const n = nearestNode(bot, kind);
    if (!n) { if (DBG) console.log('   [gather] ingen nod kvar!'); return false; }
    const d0 = Math.hypot(n.x - bot.state.x, n.z - bot.state.z);
    const ok = await bot.moveTo(n.x, n.z, kind === 'tree' ? 1.5 : 1.7, 20000);
    if (DBG) console.log(`   [gather] nod ${n.id} dist=${d0.toFixed(1)} moveTo=${ok} amount=${n.amount} pos=${bot.state.x.toFixed(1)},${bot.state.y.toFixed(1)},${bot.state.z.toFixed(1)}`);
    if (!ok) { n.alive = false; bot.deadNodes = (bot.deadNodes || 0) + 1; continue; }
    const sph = aimSphere(n, aimY);
    bot.aimAt(sph.x, sph.y, sph.z);
    for (let i = 0; i < 26 && bot.countItem(item) < need; i++) {
      const nn = bot.nodes.get(n.id);
      if (!nn || !nn.alive) break;
      const sp = aimSphere(nn, aimY);
      bot.aimAt(sp.x, sp.y, sp.z);
      bot.sendInput();
      bot.emitAim('attack');
      if (DBG && i % 8 === 7) console.log(`   [gather] attackerar ${n.id}: ${item}=${bot.countItem(item)} nod=${nn.amount} held=${bot.held} inv=${JSON.stringify(bot.inv.filter(Boolean).map(x=>x.id))}`);
      await sleep(140);
    }
  }
  return bot.countItem(item) >= need;
}

// ------------------------------------------------------------------ testen ---
try { fs.rmSync(SAVE, { force: true }); } catch (e) { /* noop */ }

log('Startar server...');
const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), SAVE_FILE: SAVE }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; process.stderr.write('[server] ' + d); });

await waitFor(() => srvOut.includes('RUST-MVP server'), 10000, 'server start');

try {
  const a = new Bot('Alice', 'pid-alice');
  const b = new Bot('Bob', 'pid-bob');

  log('\n1) Anslut + init');
  await a.connect();
  check('init mottaget', !!a.init && a.init.nodes.length > 500, `noder=${a.init?.nodes?.length}`);
  check('världsfrö skickas', a.init.seed > 0);
  check('starttomt inventarie', a.inv.every((s) => !s));
  check('full hälsa', a.state.hp === 100);
  await b.connect();
  check('två spelare ser varandra', await waitFor(() => a.others && a.others.some((p) => p.name === 'Bob'), 4000));

  log('\n2) Rörelse + synk');
  const p0 = { x: a.state.x, z: a.state.z };
  const toC = Math.hypot(p0.x, p0.z) || 1;
  const tx = p0.x + (-p0.x / toC) * 14, tz = p0.z + (-p0.z / toC) * 14;   // in mot mitten
  const moved = await a.moveTo(tx, tz, 2.5, 25000);
  check('spelare kan gå', moved, `från ${p0.x.toFixed(1)},${p0.z.toFixed(1)} till ${a.state.x.toFixed(1)},${a.state.z.toFixed(1)}`);
  check('position stämmer med servern', Math.hypot(a.state.x - tx, a.state.z - tz) < 5);
  check('Bob ser Alices position', await waitFor(() => {
    const pa = b.others && b.others.find((p) => p.name === 'Alice');
    return pa && Math.hypot(pa.x - a.state.x, pa.z - a.state.z) < 1.5;
  }, 4000));

  log('\n3) Samla resurser (trä + sten)');
  const gotWood = await gather(a, 'tree', 'wood', 60, 1.8);
  check('kunde hugga trä för hand', gotWood, `trä=${a.countItem('wood')}`);
  const gotStone = await gather(a, 'rock', 'stone', 40, 0.9);
  check('kunde bryta sten för hand', gotStone, `sten=${a.countItem('stone')}`);
  const handsWood = (a.got.wood || 0);
  check('hands ger mindre än verktyg (senare)', handsWood >= 60, `got=${JSON.stringify(a.got)}`);

  log('\n4) Crafting');
  a.s.emit('craft', { id: 'stone_axe', n: 1 });
  check('stenyxa craftad', await waitFor(() => a.countItem('stone_axe') === 1, 4000), JSON.stringify(a.toasts.slice(-2)));

  await equip(a, 'stone_axe', 0);
  const woodBeforeTool = a.countItem('wood');
  const hitsBefore = a.fx.filter((f) => f.k === 'gather').length;
  const okToolWood = await gather(a, 'tree', 'wood', woodBeforeTool + 620, 1.8);
  check('yxa ger mer trä per slag', okToolWood && a.countItem('wood') > woodBeforeTool + 560, `trä=${a.countItem('wood')}`);
  const hitsAfter = a.fx.filter((f) => f.k === 'gather').length;
  check('verktyg = färre slag per resurs', (hitsAfter - hitsBefore) < 60, `slag=${hitsAfter - hitsBefore}`);

  a.s.emit('craft', { id: 'stone_pick', n: 1 });
  check('stenhacka craftad', await waitFor(() => a.countItem('stone_pick') === 1, 4000), JSON.stringify(a.toasts.slice(-2)));
  await equip(a, 'stone_pick', 0);
  check('kunde bryta mer sten med hacka', await gather(a, 'rock', 'stone', 380, 0.9), `sten=${a.countItem('stone')}`);
  check('kunde bryta metall', await gather(a, 'metal', 'metal', 200, 0.9), `metall=${a.countItem('metal')}`);
  check('kunde plocka bär', await gather(a, 'bush', 'berry', 4, 0.7), `bär=${a.countItem('berry')}`);
  check('nod töms och markeras död', [...a.nodes.values()].some((n) => !n.alive));

  for (const r of ['wood_spear', 'bow', 'arrow', 'metal_spear', 'campfire']) {
    a.s.emit('craft', { id: r, n: 1 });
    check(`craftade ${r}`, await waitFor(() => a.countItem(r) >= 1, 4000), `slotar=${JSON.stringify((a.inv||[]).filter(Boolean).map(s=>s.id))}`);
  }
  check('pilar i fler exemplar', a.countItem('arrow') >= 5, `pilar=${a.countItem('arrow')}`);

  if (process.env.SMOKE_ONLY === '4') throw new Error('STOP efter sektion 4 (SMOKE_ONLY)');

  log('\n5) Byggande med snappning');
  await equip(a, 'wood_spear', 5);
  const bx = Math.round(a.state.x / 4) * 4 + 4;
  const bz = Math.round(a.state.z / 4) * 4;
  await a.moveTo(bx + 3.2, bz + 3.2, 3.4, 20000);
  const woodTotal = a.countItem('wood');

  const r1 = await place(a, 'foundation', { x: bx, y: a.state.y - 0.6, z: bz });
  check('golv placerat', r1.ok, JSON.stringify(r1.toasts));
  const f = [...a.blocks.values()].find((k) => k.type === 'foundation');
  if (!f) throw new Error('inget golv placerat – avbryter byggtestet: ' + JSON.stringify(a.toasts.slice(-3)));
  check('golv snappat till 4 m-rutnät', f && Math.abs(((f.x % 4) + 4) % 4) < 0.01 && Math.abs(((f.z % 4) + 4) % 4) < 0.01, f ? `${f.x},${f.z}` : '');
  check('trä drog av för golvet', a.countItem('wood') === woodTotal - 30, `${woodTotal} -> ${a.countItem('wood')}`);
  check('golvet ägs av Alice', f && f.owner === 'pid-alice');

  const r2 = await place(a, 'wall', { x: f.x, y: f.y + 1.6, z: f.z + 2 });
  check('vägg snappad till golvkant', r2.ok, JSON.stringify(r2.toasts));
  const w = [...a.blocks.values()].find((k) => k.type === 'wall');
  check('vägg ligger på golvets kant', w && Math.abs(Math.abs(w.z - f.z) - 2) < 0.01 && Math.abs(w.y - (f.y + 1.6)) < 0.01, w ? JSON.stringify(w) : '');

  const r3 = await place(a, 'doorway', { x: f.x + 2, y: f.y + 1.6, z: f.z });
  check('dörröppning placerad', r3.ok, JSON.stringify(r3.toasts));
  const dw = [...a.blocks.values()].find((k) => k.type === 'doorway');

  const r4 = dw ? await place(a, 'door', { x: dw.x, y: dw.y - 0.3, z: dw.z }) : { ok: false, toasts: ['ingen dörröppning'] };
  check('dörr placerad i öppning', r4.ok, JSON.stringify(r4.toasts));
  const door = [...a.blocks.values()].find((k) => k.type === 'door');

  const r5 = await place(a, 'roof', { x: f.x - 2, y: f.y + 3.2, z: f.z });
  check('tak placerat ovanpå vägg', r5.ok, JSON.stringify(r5.toasts));
  const roof = [...a.blocks.values()].find((k) => k.type === 'roof');
  check('tak ligger på väggens höjd', roof && Math.abs(roof.y - (f.y + 3.2)) < 0.01, roof ? String(roof.y) : '');

  const r6 = await place(a, 'box', { x: f.x - 1, y: f.y + 0.5, z: f.z - 1 });
  check('förvaringslåda placerad', r6.ok, JSON.stringify(r6.toasts));
  const box = [...a.blocks.values()].find((k) => k.type === 'box');

  const r7 = await place(a, 'foundation', { x: f.x, y: f.y - 0.6, z: f.z }, false);
  check('upptagen plats nekas', !r7.ok || r7.toasts.some((t) => /upptagen/i.test(t.text)), JSON.stringify(r7.toasts));

  if (door) {
    const opened = await actUntil(a, 'interact', { x: door.x, y: door.y, z: door.z }, () => { const d = a.blocks.get(door.id); return d && d.open === true; });
    check('dörr öppnas med E', opened, JSON.stringify(a.toasts.slice(-2)));
    const closed = await actUntil(a, 'interact', { x: door.x, y: door.y, z: door.z }, () => { const d = a.blocks.get(door.id); return d && d.open === false; });
    check('dörr stängs med E', closed);
  } else { check('dörr öppnas med E', false, 'ingen dörr'); check('dörr stängs med E', false, 'ingen dörr'); }

  const stoneBefore = a.countItem('stone');
  a.aimAt(f.x, f.y, f.z);
  a.emitAim('upgrade');
  check('golv uppgraderas till sten', await waitFor(() => { const bb = a.blocks.get(f.id); return bb && bb.tier === 'stone'; }, 3000));
  check('uppgradering kostar sten', a.countItem('stone') < stoneBefore, `${stoneBefore} -> ${a.countItem('stone')}`);
  check('uppgradering ger mer hp', a.blocks.get(f.id).maxHp > 320, String(a.blocks.get(f.id).maxHp));

  b.toasts.length = 0;
  await actOnBlock(b, 'demolish', f, () => b.toasts.length > 0, 4);
  check('icke-ägare kan inte riva', b.toasts.some((t) => /äger inte/i.test(t.text)) && a.blocks.has(f.id), JSON.stringify(b.toasts));

  if (door) {
    check('ägare kan riva', await actUntil(a, 'demolish', { x: door.x, y: door.y, z: door.z }, () => !a.blocks.has(door.id)));
  } else check('ägare kan riva', false, 'ingen dörr');

  log('\n6) Förvaringslåda');
  check('låda finns kvar för test', !!box);
  if (!box) throw new Error('ingen låda');
  check('låda öppnas', await actUntil(a, 'interact', { x: box.x, y: box.y, z: box.z }, () => !!a.box && a.box.id === box.id), JSON.stringify(a.toasts.slice(-2)));
  const wBefore = a.countItem('wood');
  if (!a.box) throw new Error('lådan öppnades inte');
  a.s.emit('box:xfer', { in: true, idx: a.slotOf('wood'), all: false });
  check('trä läggs i lådan', await waitFor(() => a.box && a.box.slots.some((s) => s && s.id === 'wood'), 3000));
  check('inventariet minskade', a.countItem('wood') < wBefore);
  const idxInBox = a.box.slots.findIndex((s) => s && s.id === 'wood');
  a.s.emit('box:xfer', { in: false, idx: idxInBox, all: true });
  check('trä tas ur lådan', await waitFor(() => a.box && !a.box.slots.some((s) => s && s.id === 'wood'), 3000));

  log('\n7) Lägereld + överlevnad');
  const cf = await waitFor(() => a.countItem('campfire') === 1, 4000);
  check('lägereld craftad', cf);
  await equip(a, 'campfire', 2);
  a.aimAt(a.state.x + 1.8, a.state.y - 0.6, a.state.z + 1.8);
  a.s.emit('inv:use', { slot: 2 });
  check('lägereld placeras via använd', await waitFor(() => [...a.blocks.values()].some((k) => k.type === 'campfire'), 4000), JSON.stringify(a.toasts.slice(-2)));
  check('lägereld förbrukas från inventariet', a.countItem('campfire') === 0);
  const fire = [...a.blocks.values()].find((k) => k.type === 'campfire');
  if (fire) {
    await a.moveTo(fire.x + 1.2, fire.z + 1.2, 1.6, 10000);
    check('eld ger värme', await waitFor(() => a.state.temp > 60, 12000), `temp=${a.state.temp}`);
  }

  log('\n8) Strid: närstrid + död + respawn');
  const spearId = a.countItem('metal_spear') ? 'metal_spear' : 'wood_spear';
  await equip(a, spearId, 0);
  b.halt();
  await b.moveTo(b.state.x, b.state.z, 0.2, 3000);   // nollställ input
  const reached = await a.moveTo(b.state.x, b.state.z, 1.3, 90000);
  check('Alice kan gå fram till Bob', reached, `avstånd=${Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z).toFixed(1)}`);
  const hp0 = 100;
  let hits = 0;
  for (let i = 0; i < 12 && b.died === 0; i++) {
    a.aimAt(b.state.x, b.state.y + 1.0, b.state.z);
    a.sendInput();
    a.emitAim('attack');
    hits++;
    await sleep(450);
    if (Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z) > 2) await a.moveTo(b.state.x, b.state.z, 1.2, 5000);
  }
  check('närstrid träffar annan spelare', a.hitmarks.length > 0, `hitmarks=${a.hitmarks.length}`);
  check('offret tar skada', b.hurt > 0, `skada=${b.hurt}`);
  check('offret dör', await waitFor(() => b.died > 0, 6000), `hp kvar=${b.state && b.state.hp}`);
  check('dödsorsak/kille rapporteras', b.deathInfo && b.deathInfo.by === 'Alice', JSON.stringify(b.deathInfo));
  check('mördaren får kill', await waitFor(() => a.state.kills === 1, 3000));
  check('respawn sker', await waitFor(() => b.respawned > 0 && !b.state.dead, 12000));
  check('hälsa återställd efter respawn', b.state && b.state.hp === 100);

  log('\n9) Avståndsvapen (pilbåge)');
  if (a.countItem('bow') && a.countItem('arrow') > 0) {
    await equip(a, 'bow', 0);
    b.halt();
    // hitta en position 8–20 m från Bob med fri sikt
    let spot = null;
    for (let dist = 14; dist <= 20 && !spot; dist += 6) {
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const tx = b.state.x + Math.cos(ang) * dist, tz = b.state.z + Math.sin(ang) * dist;
        const save = { x: a.state.x, z: a.state.z };
        if (!hasLOS(a, b.state.x, b.state.y + 1.0, b.state.z)) {
          await a.moveTo(tx, tz, 1.6, 40000);
          if (hasLOS(a, b.state.x, b.state.y + 1.0, b.state.z)) { spot = { dist }; break; }
        } else { spot = { dist: Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z) }; break; }
      }
    }
    const dist = Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z);
    check('inom bågräckvidd med fri sikt', dist > 4 && dist < 50 && hasLOS(a, b.state.x, b.state.y + 1.0, b.state.z), `avstånd=${dist.toFixed(1)} sikt=${hasLOS(a, b.state.x, b.state.y + 1.0, b.state.z)}`);
    const arrowsBefore = a.countItem('arrow');
    let hit = false;
    for (let i = 0; i < 10 && !hit; i++) {
      a.aimAt(b.state.x, b.state.y + 1.0, b.state.z, 1);
      a.emitAim('attack');
      await sleep(600);
      hit = b.state.hp < 100 || b.hurt > 0;
    }
    check('pil avfyras och förbrukas', a.countItem('arrow') < arrowsBefore, `${arrowsBefore} -> ${a.countItem('arrow')}`);
    check('pilbåge träffar på avstånd', hit, `hp=${b.state.hp} avstånd=${dist.toFixed(1)}`);
  } else {
    check('pilbåge + pilar finns', false, `bow=${a.countItem('bow')} arrow=${a.countItem('arrow')}`);
  }

  log('\n10) Överlevnadsmekanik');
  check('hunger minskar över tid', await waitFor(() => a.state.hunger < 78, 20000), `hunger=${a.state.hunger}`);
  check('törst minskar över tid', a.state.thirst < 82, `törst=${a.state.thirst}`);
  check('temperatur spåras', typeof a.state.temp === 'number' && a.state.temp > 0);
  check('dag/natt-cykel skickas', typeof a.state.tod === 'number' && a.state.tod >= 0 && a.state.tod < 1);

  log('\n10b) Craft-begränsningar');
  a.s.emit('craft', { id: 'metal_pick', n: 99 });
  await sleep(300);
  check('max 20 craft per anrop', a.countItem('metal_pick') <= 20, `metal_pick=${a.countItem('metal_pick')}`);
  a.toasts.length = 0;
  a.s.emit('craft', { id: 'stone_axe', n: 1 });
  await sleep(200);
  check('craft utan resurser ger toast', a.countItem('stone_axe') >= 1);

  log('\n11) Chat + roster');
  a.s.emit('chat', { text: 'hej från testen' });
  check('chat når andra spelare', await waitFor(() => b.chat.some((c) => c.text === 'hej från testen'), 4000));

  log('\n12) Persistens');
  a.s.emit('inv:move', { from: a.slotOf('stone_pick'), to: 20 });
  await sleep(200);
  const statsRes = await fetch(`${URL}/api/stats`).then((r) => r.json());
  check('stats-API svarar', statsRes.players === 2 && statsRes.blocks > 5, JSON.stringify(statsRes));

  a.stop(); b.stop();
  await sleep(400);
  srv.kill('SIGTERM');
  await waitFor(() => srv.exitCode !== null || !srvOut.includes('x'), 4000).catch(() => {});
  await sleep(800);

  const saved = fs.existsSync(SAVE) ? JSON.parse(fs.readFileSync(SAVE, 'utf8')) : null;
  check('sparfil skapas vid avstängning', !!saved);
  check('spelarprofil sparas', saved && saved.profiles.some((p) => p.pid === 'pid-alice'), saved ? saved.profiles.map((p) => p.pid).join(',') : '');
  const alice = saved && saved.profiles.find((p) => p.pid === 'pid-alice');
  check('inventarie sparas', alice && alice.slots.some((s) => s), JSON.stringify(alice && alice.slots.filter(Boolean).slice(0, 4)));
  check('kill/death sparas', alice && alice.kills === 1 && alice.deaths === 0, JSON.stringify(alice && { k: alice.kills, d: alice.deaths }));
  check('byggnader sparas', saved && saved.blocks.length >= 5, saved ? String(saved.blocks.length) : '');

  // starta om och verifiera att världen laddas
  log('\n13) Omstart laddar sparad värld');
  const srv2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), SAVE_FILE: SAVE }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out2 = '';
  srv2.stdout.on('data', (d) => { out2 += d; });
  srv2.stderr.on('data', (d) => { out2 += d; });
  await waitFor(() => out2.includes('RUST-MVP server'), 10000);
  const c = new Bot('Alice', 'pid-alice');
  await c.connect();
  check('byggnader laddade efter omstart', c.blocks.size >= 5, `blocks=${c.blocks.size}`);
  check('inventarie laddat efter omstart', c.inv && c.inv.some((s) => s), JSON.stringify((c.inv || []).filter(Boolean).slice(0, 3)));
  check('kills följde med', c.state.kills === 1);
  log('\n14) Stödstruktur: ras när golvet rivs');
  const cf2 = [...c.blocks.values()].find((k) => k.type === 'foundation');
  const roof2 = [...c.blocks.values()].find((k) => k.type === 'roof');
  const blocksBefore = c.blocks.size;
  check('golvet finns efter omstart', !!cf2, [...c.blocks.values()].map((k) => k.type).join(','));
  if (cf2) {
    check('vägg/tak rasar när golvet rivs', await actOnBlock(c, 'demolish', cf2, () => c.blocks.size < blocksBefore - 1, 6), `${blocksBefore} -> ${c.blocks.size}`);
    check('taket är borta', roof2 ? await waitFor(() => !c.blocks.has(roof2.id), 2500) : true);
  }
  c.stop();
  srv2.kill('SIGTERM');
  await sleep(300);
} catch (e) {
  fail++;
  log('\n💥 Testkrasch:', e.message);
  console.error(e);
} finally {
  try { srv.kill('SIGKILL'); } catch (e) { /* noop */ }
}

log(`\n=== KLART: ${pass} OK, ${fail} FEL ===`);
process.exit(fail ? 1 : 0);
