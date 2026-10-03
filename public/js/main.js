/**
 * Huvudmodul: kopplar ihop nätverk, rendering, lokal spelare, HUD och
 * interaktion samt kör spelloopen.
 */

import * as THREE from 'three';
import { Net } from './net.js';
import { Renderer } from './render.js';
import { LocalPlayer } from './player.js';
import { Interactions } from './interact.js';
import { Hud } from './hud.js';
import { World, CONFIG, NODE_TYPES } from '../../shared/worldgen.js';
import { BuildingIndex, pieceAABB } from '../../shared/building.js';
import { ITEMS, itemName } from '../../shared/items.js';

const canvas = document.getElementById('game');
const net = new Net();
const hud = new Hud(net);

const state = {
  world: null,
  renderer: null,
  player: null,
  index: new BuildingIndex(),
  interact: null,
  you: null,
  equipped: 'hand',
  day: 0.28,
  playing: false,
  bags: new Map(),
  roster: new Map(),
  lastDamageFrom: null,
};

let last = performance.now() / 1000;
let acc = 0;
let hudTick = 0;
const NET_DT = 1 / 20;

// ------------------------------------------------------------------ anslutning

hud.onJoinRequest(async (name) => {
  try {
    const token = localStorage.getItem('rust_token');
    await net.connect(name || 'Överlevare', token);
  } catch (err) {
    hud.showMenu(err.message || 'Kunde inte ansluta');
    hud.el.joinBtn.disabled = false;
  }
});

net.on('close', () => {
  if (state.playing) hud.showDisconnect('Anslutningen till servern bröts.');
});

net.on('error', (err) => {
  const text = err?.msg || err?.message || 'Kunde inte ansluta';
  hud.showMenu(text);
  hud.el.joinBtn.disabled = false;
});

async function boot() {
  // serverinfo i menyn
  try {
    const info = await fetch('/api/status').then((r) => r.json());
    hud.setServerInfo(`Server: ${info.players.length} sparade spelare · ${info.nodes} resurspunkter · seed ${info.seed}`);
  } catch {
    hud.setServerInfo('Servern svarar inte ännu.');
  }
  document.getElementById('nameInput').value = localStorage.getItem('rust_name') || '';
}

// ------------------------------------------------------------------ meddelanden

net.on('welcome', (msg) => {
  state.you = msg.you;
  state.day = msg.dayFraction;
  state.playing = true;
  state.world = new World(msg.seed);
  state.renderer = new Renderer(canvas, state.world, { ...CONFIG, ...msg.config });
  state.player = new LocalPlayer(state.world, msg.config);
  state.player.setAabbFn(pieceAABB);
  state.player.setColliderSource((x, z, r) => state.index.near(x, z, r));
  state.player.alive = msg.you.alive;
  state.player.body.x = msg.you.pos[0];
  state.player.body.y = msg.you.pos[1];
  state.player.body.z = msg.you.pos[2];
  state.interact = new Interactions({
    net,
    renderer: state.renderer,
    world: state.world,
    player: state.player,
    index: state.index,
    hud,
    getEquipped: () => state.equipped,
    onPlacePreview: (cand, ok, reason) => {
      if (state.player.buildMode && !ok && reason) hud.hint(`${reason}`);
      else if (state.player.buildMode) hud.hint('[Vänster mus] bygg · [B] avbryt');
    },
  });
  window.__setBuildKind = (kind) => setBuildKind(kind);

  // byggdelar, påsar och resursnoder
  for (const piece of msg.buildings) addPiece(piece, true);
  for (const bag of msg.bags) addBag(bag);
  for (const [id, hp, inSec] of msg.nodes) {
    const dead = hp <= 0;
    state.renderer.setNodeState(id, hp, dead, inSec);
  }
  for (const p of msg.roster) {
    state.roster.set(p.id, p);
    if (p.id !== msg.you.id) {
      state.renderer.addPlayerState({ i: p.id, x: 0, y: -50, z: 0, hp: p.hp }, p.name, p.sleeper);
    }
  }
  for (const entry of msg.chat || []) hud.addChat(entry);
  hud.setInventory(msg.you.inv, msg.you.hotbar, msg.you.selected, msg.you.stats);
  setEquipped(msg.you.equipped);
  hud.hideMenu();
  hud.playing = true;
  hud.toast(`Välkommen ${msg.you.name}! ${msg.online} spelare online`, 'good');
  hud.addChat({ system: true, msg: `Välkommen till ön! Samla trä med vänster mus och bygg med B.` });
  net.startPing();
  requestPointerLock();
  startLoop();
});

net.on('you', (msg) => {
  state.you = msg;
  state.player.alive = msg.alive;
  hud.setInventory(msg.inv, msg.hotbar, msg.selected, msg.stats);
  if (!msg.alive) {
    const left = msg.respawnAt && state.serverTime ? Math.max(0, msg.respawnAt - state.serverTime) : null;
    hud.showDeath(state.lastDamageFrom || 'världen', left);
  }
});

net.on('inv', (msg) => {
  hud.setInventory(msg.inv, msg.hotbar, msg.selected, msg.stats);
  if (msg.equipped) setEquipped(msg.equipped);
});

net.on('stats', (msg) => {
  hud.setVitals(msg);
  hud.setTop({ online: msg.online });
  if (msg.alive === 0) hud.setDeathTimer(msg.respawnIn);
});

net.on('state', (msg) => {
  state.serverTime = msg.time;
  state.day = msg.day;
  hud.setTop({ online: msg.online, day: msg.day });
  for (const s of msg.s) {
    if (s.i === state.you?.id) {
      state.player.alive = !!s.al;
      state.player.reconcile([s.x, s.y, s.z], s.yw, null);
      continue;
    }
    if (!state.renderer.players.has(s.i)) {
      const entry = state.roster.get(s.i);
      state.renderer.addPlayerState(s, entry?.name, s.sl);
    }
    state.renderer.setPlayerPosition(s);
  }
});

net.on('build', (msg) => {
  for (const piece of msg.add || []) addPiece(piece, false);
  for (const id of msg.rm || []) {
    state.index.remove(id);
    state.renderer.removePiece(id);
    state.player.resetAabbCache();
  }
  for (const [id, hp, open] of msg.upd || []) {
    const piece = state.index.pieces.get(id);
    if (piece) {
      piece.hp = hp;
      if (open !== undefined) piece.open = open;
    }
    state.renderer.updatePieceHp(id, hp, open);
    if (open !== undefined) state.renderer.setDoorOpen(id, open);
  }
});

net.on('bag', (msg) => {
  for (const bag of msg.add || []) addBag(bag);
  for (const id of msg.rm || []) {
    state.bags.delete(id);
    state.renderer.removePiece(id);
    state.index.remove(id);
    hud.closePanel('lootpanel');
  }
  for (const bag of msg.upd || []) {
    state.bags.set(bag.id, bag);
    if (msg.open) hud.renderLoot(bag);
    else if (hud.state.bag && hud.state.bag.id === bag.id) hud.renderLoot(bag);
  }
});

net.on('nodestate', (msg) => {
  if (msg.dead) state.renderer.setNodeState(msg.id, 0, true);
  else if (msg.alive) state.renderer.setNodeState(msg.id, msg.hp, false);
});

net.on('container', (msg) => {
  hud.state.containerId = msg.id;
  hud.state.containerInv = msg.inv || {};
  hud.state.containerName = msg.name;
  hud.renderContainer();
  hud.openPanel('containerpanel');
});

net.on('fx', (msg) => handleFx(msg));
net.on('chat', (msg) => hud.addChat(msg));
net.on('latency', (ms) => hud.setTop({ latency: ms }));
net.on('death', (msg) => {
  hud.addKill(`${msg.name} dödades av ${msg.killer}`);
  if (msg.id === state.you?.id) {
    state.lastDamageFrom = msg.killer;
    hud.showDeath(msg.killer, 8);
  }
});
net.on('youdead', (msg) => {
  hud.showDeath(state.lastDamageFrom || 'världen', msg.in);
});
net.on('respawned', (msg) => {
  state.player.body.x = msg.pos[0];
  state.player.body.y = msg.pos[1];
  state.player.body.z = msg.pos[2];
  state.player.body.vx = state.player.body.vy = state.player.body.vz = 0;
  state.player.alive = true;
  hud.hideDeath();
  hud.toast('Du är tillbaka på ön', 'good');
  canvas.requestPointerLock?.();
});
net.on('hurt', (msg) => {
  document.body.classList.add('hurt');
  setTimeout(() => document.body.classList.remove('hurt'), 180);
  hud.toast(`${msg.from} gjorde ${msg.dmg} skada på dig`, 'bad');
  state.lastDamageFrom = msg.from;
});
net.on('roster', (msg) => {
  for (const p of msg.add || []) state.roster.set(p.id, p);
  for (const p of msg.upd || []) state.roster.set(p.id, { ...(state.roster.get(p.id) || {}), ...p });
});
net.on('sleeper', (msg) => {
  const s = state.renderer.players.get(msg.id);
  if (s) {
    s.sleeper = !!msg.sleeper;
    state.renderer.setPlayerPosition({ i: msg.id, sl: msg.sleeper ? 1 : 0, hp: s.hp, x: s.target.x, y: s.target.y, z: s.target.z });
  }
});
net.on('kicked', (msg) => {
  state.playing = false;
  hud.showDisconnect(msg.reason || 'Utsparkad');
});


// ------------------------------------------------------------------ hjälpare

function addPiece(piece, initial) {
  state.index.add(piece);
  state.renderer.addPiece(piece);
  if (piece.kind === 'lootbag') state.bags.set(piece.id, piece);
  if (!initial) state.player.resetAabbCache();
}

function addBag(bag) {
  state.bags.set(bag.id, bag);
  state.index.add(bag);
  state.renderer.addPiece(bag);
}

function setEquipped(item) {
  state.equipped = item || 'hand';
  state.renderer.setViewModel(state.equipped);
}

function setBuildKind(kind) {
  state.player.buildMode = kind ? { kind } : null;
  state.interact.setKind(kind);
  hud.setBuildMode(kind);
  if (!kind) hud.hint('');
}

function handleFx(msg) {
  const r = state.renderer;
  const p = state.player;
  switch (msg.k) {
    case 'swing':
      if (msg.i === state.you?.id) r.playSwing();
      break;
    case 'hit':
      if (msg.h) r.spawnBurst(msg.h[0], msg.h[1], msg.h[2], 0xc1440e, 8);
      break;
    case 'gather': {
      const node = state.world.nodes.find((n) => n.id === msg.node);
      if (node) {
        const color = msg.res === 'wood' ? 0xa9702f : msg.res === 'stone' ? 0x9aa0a6 : msg.res === 'metal' ? 0xc8d2da : 0xc23a4e;
        r.spawnBurst(node.x, node.y + NODE_TYPES[node.type].height * 0.5, node.z, color, 7);
        if (msg.i === state.you?.id && msg.amount > 0) {
          const pos = projectToScreen(node.x, node.y + NODE_TYPES[node.type].height * 0.7, node.z);
          if (pos) hud.floatText(pos.x, pos.y, `+${Math.round(msg.amount)} ${itemName(msg.res)}`, '#ffd9a0');
        }
      }
      break;
    }
    case 'nodebroke':
      r.spawnBurst(msg.x, msg.y + 1, msg.z, 0x8a6a44, 18);
      break;
    case 'piecebroke':
      r.spawnBurst(msg.x, msg.y + 0.5, msg.z, 0x9c7b52, 14);
      break;
    case 'place':
      break;
    case 'shoot': {
      const dir = msg.d;
      r.spawnArrow(msg.o, dir);
      if (msg.i === state.you?.id) {
        const to = [msg.o[0] + dir[0] * 3, msg.o[1] + dir[1] * 3, msg.o[2] + dir[2] * 3];
        r.spawnTracer(msg.o, to);
      }
      break;
    }
    case 'arrowhit':
      r.spawnBurst(msg.x, msg.y, msg.z, msg.mat === 'player' ? 0xaa2222 : 0xbbb098, 6);
      break;
    case 'door':
      r.setDoorOpen(msg.id, !!msg.open);
      break;
    case 'crafted':
      hud.toast(`Tillverkade ${itemName(msg.item)}${msg.count > 1 ? ` ×${msg.count}` : ''}`, 'good');
      break;
    case 'ate':
      hud.toast(`Åt ${itemName(msg.item)}`, 'good');
      break;
    case 'heal':
      hud.toast(`Använde bandage (+${msg.amount} hp)`, 'good');
      break;
    case 'toofar':
      hud.toast('För långt bort – gå närmare', 'bad');
      break;
    case 'noplace':
      hud.toast(`Går inte att bygga: ${msg.reason || 'hinder'}`, 'bad');
      break;
    case 'nocost':
      hud.toast('Du saknar material', 'bad');
      break;
    case 'weakdraw':
      hud.toast('Dra bågen längre', 'bad');
      break;
    case 'noammo':
      hud.toast('Slut på pilar – tillverka fler', 'bad');
      break;
    default:
      break;
  }
}

function projectToScreen(x, y, z) {
  if (!state.renderer) return null;
  const v = new THREE.Vector3(x, y, z).project(state.renderer.camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}

// ------------------------------------------------------------------ inmatning

addEventListener('keydown', (e) => {
  const p = state.player;
  if (!p) return;
  if (hud.chatOpen) return;
  const panelOpen = hud.isPanelOpen();
  if (panelOpen && e.code !== 'Tab' && e.code !== 'Escape') return;
  p.keys.add(e.code);

  if (e.code === 'Enter') {
    hud.openChat();
    document.exitPointerLock?.();
    e.preventDefault();
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    hud.togglePanel('craftpanel');
    return;
  }
  if (e.code === 'KeyB') {
    setBuildKind(state.player.buildMode ? null : 'foundation');
    return;
  }
  if (e.code === 'KeyE') {
    state.interact.interact();
    return;
  }
  if (e.code === 'KeyR') {
    state.interact.demolish();
    return;
  }
  if (e.code === 'KeyF') {
    const slot = state.you?.hotbar?.[state.you.selected];
    if (slot && (ITEMS[slot.item]?.kind === 'food' || ITEMS[slot.item]?.kind === 'heal')) {
      net.send({ t: 'eat' });
    } else if (slot && ITEMS[slot.item]?.kind === 'placeable') {
      hud.toast('Placerbart föremål – välj det och tryck vänster mus', '');
    }
    return;
  }
  if (e.code === 'Escape') {
    if (state.player.buildMode) {
      setBuildKind(null);
      return;
    }
    hud.showPauseMenu();
    return;
  }
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    const slot = p.buildMode && n >= 1 && n <= 5 ? ['foundation', 'wall', 'doorway', 'ceiling', 'door'][n - 1] : null;
    if (slot) {
      setBuildKind(slot);
    } else {
      net.send({ t: 'select', slot: (n || 10) - 1 });
    }
    return;
  }
  if (e.code === 'KeyQ') {
    setBuildKind(null);
  }
  if (e.code === 'Space') e.preventDefault();
});

addEventListener('keyup', (e) => {
  state.player?.keys.delete(e.code);
});

canvas.addEventListener('mousedown', (e) => {
  if (!state.playing || hud.isPanelOpen()) return;
  if (document.pointerLockElement !== document.body && !hud.chatOpen) {
    requestPointerLock();
    return;
  }
  const p = state.player;
  if (e.button === 0) {
    if (p.buildMode) {
      if (state.interact.place()) hud.playPlaceFeedback?.();
    } else if (state.interact.startDraw()) {
      // pilbåge: ladda
    } else {
      p.mouseDown = true;
      state.interact.lastHit = 0;
    }
  } else if (e.button === 2) {
    if (p.buildMode) setBuildKind(null);
  }
});

addEventListener('mouseup', (e) => {
  const p = state.player;
  if (!p) return;
  if (e.button === 0) {
    p.mouseDown = false;
    state.interact.releaseDraw();
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === document.body) {
    state.player?.applyLook(e.movementX, e.movementY);
  }
});

document.addEventListener('pointerlockchange', () => {
  const unlocked = document.pointerLockElement !== document.body;
  if (unlocked && state.playing && !hud.isPanelOpen() && !hud.chatOpen && !document.body.classList.contains('dead')) {
    hud.showPauseMenu();
  } else if (!unlocked) {
    hud.hideMenu();
  }
});

function requestPointerLock() {
  canvas.requestPointerLock?.();
}

canvas.addEventListener('click', () => {
  if (!state.playing) return;
  if (document.body.classList.contains('dead')) return;
  if (document.pointerLockElement !== document.body && !hud.chatOpen && !hud.isPanelOpen()) canvas.requestPointerLock?.();
});

// mushjul byter hotbar-plats
addEventListener('wheel', (e) => {
  if (!state.playing || hud.isPanelOpen() || hud.chatOpen) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const next = ((state.you?.selected ?? 0) + dir + 10) % 10;
  net.send({ t: 'select', slot: next });
}, { passive: true });

// ------------------------------------------------------------------ spelloop

function startLoop() {
  last = performance.now() / 1000;
  requestAnimationFrame(loop);
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now() / 1000;
  let dt = now - last;
  last = now;
  if (dt > 0.25) dt = 0.25;
  const p = state.player;
  const r = state.renderer;
  if (!p || !r) return;

  // nätverk i fast takt (20 Hz)
  acc += dt;
  let steps = 0;
  while (acc >= NET_DT && steps < 4) {
    const msg = p.predict(NET_DT);
    if (msg) net.send(msg);
    acc -= NET_DT;
    steps++;
  }

  state.interact.updateAttack();
  state.interact.updateBuild();
  hudTick -= dt;
  const updateHudTick = hudTick <= 0;
  if (updateHudTick) hudTick = 0.1;

  r.updatePlayers(dt, state.you?.id);
  r.updateFires(dt, p.body);
  r.updateDoors(dt);
  r.updateEffects(dt);
  r.updateWater(now);
  r.updateDayNight(state.day, dt, p.body);
  r.updateViewModel(dt, state.interact.drawing);

  // HUD: interaktionshint
  if (!p.buildMode) {
    const info = state.interact.look();
    hud.hint(info ? info.text : '');
  }
  if (updateHudTick) hud.setTop({ pos: [p.body.x, p.body.y, p.body.z] });

  r.render(dt, p.body);
}

boot();
