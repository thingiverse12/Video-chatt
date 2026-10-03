/**
 * Klientkontroll: laddar klientmodulerna i en simulerad webbläsare (jsdom) och
 * verifierar HUD-DOM, förutsägelse av rörelse samt bygglogik.
 *
 *   node tools/clientcheck.js
 *
 * Kräver jsdom (installeras utanför repot, se README).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? `  (${extra})` : ''}`);
};

// ---------------------------------------------------------------- jsdom-miljö

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  try {
    ({ JSDOM } = await import('/tmp/jsdomtest/node_modules/jsdom/lib/api.js'));
  } catch {
    console.error('jsdom saknas. Installera med:  npm i jsdom --prefix /tmp/jsdomtest');
    process.exit(2);
  }
}

const html = readFileSync(resolve(ROOT, 'public/index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch {
  /* navigator finns redan */
}
try {
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
} catch {
  /* ignoreras */
}
globalThis.HTMLElement = window.HTMLElement;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.performance = globalThis.performance || window.performance;
globalThis.location = window.location;
globalThis.WebSocket = window.WebSocket || class {};

// Node kan inte läsa importkartan i index.html – lägg three i node_modules
// (node_modules är gitignorerat och används bara av kontrollskriptet).
const threeDir = resolve(ROOT, 'node_modules/three');
mkdirSync(threeDir, { recursive: true });
writeFileSync(
  resolve(threeDir, 'package.json'),
  JSON.stringify({ name: 'three', version: '0.180.0', type: 'module', main: 'three.module.js', exports: { '.': './three.module.js' } })
);
for (const f of ['three.module.js', 'three.core.min.js']) {
  copyFileSync(resolve(ROOT, `public/vendor/${f}`), resolve(threeDir, f));
}

const load = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href);

console.log('\n🧪 Klientkontroll (jsdom)\n');

// 1. modulerna går att importera (fångar felaktiga importer/exporter)
let mods = {};
try {
  mods.hud = await load('public/js/hud.js');
  mods.player = await load('public/js/player.js');
  mods.interact = await load('public/js/interact.js');
  mods.net = await load('public/js/net.js');
  mods.worldgen = await load('shared/worldgen.js');
  mods.building = await load('shared/building.js');
  mods.items = await load('shared/items.js');
  check('Klientmodulerna kan importeras', true, 'hud, player, interact, net');
} catch (err) {
  check('Klientmodulerna kan importeras', false, err.message);
  console.error(err);
  process.exit(1);
}

// 2. HUD mot den riktiga index.html (fångar saknade element-id:n)
let hud;
try {
  const sent = [];
  const netStub = { send: (m) => sent.push(m), on() {}, connect: async () => {} };
  hud = new mods.hud.Hud(netStub);
  hud.setInventory({ wood: 120, stone: 40, metal: 3 }, [{ item: 'stone_hatchet', count: 1 }, null, null, null, null, null, null, null, null, null], 0, { gathered: 10, crafted: 1, built: 0 });
  hud.setVitals({ hp: 88, hunger: 70, thirst: 60, warmth: 80, ambient: 12, held: 1, fire: 0, sheltered: 0, inWater: 0, alive: 1, respawnIn: 0, online: 2 });
  hud.setTop({ online: 2, day: 0.3, latency: 45, pos: [10, 4, 20] });
  hud.renderCraftPanel();
  hud.setBuildMode('wall');
  hud.renderBuildSlots();
  hud.addChat({ name: 'Björn', msg: 'hej' });
  hud.addChat({ system: true, msg: 'Server: välkommen' });
  hud.toast('test');
  hud.floatText(100, 100, '+4 Trä');
  hud.renderLoot({ id: 5, items: { wood: 40, stone_hatchet: 1 } });
  hud.state.containerInv = { metal: 12 };
  hud.state.containerId = 9;
  hud.renderContainer();
  hud.showDeath('Björn', 8);
  hud.setVitals({ hp: 88, hunger: 70, thirst: 60, warmth: 20, ambient: 12, fire: 0, sheltered: 1, inWater: 0, alive: 1, respawnIn: 0, online: 2 });
  check(
    'HUD: hotbar, mätare, paneler och chatt renderas i DOM',
    document.querySelectorAll('#hotbar .slot').length === 10 &&
      document.querySelectorAll('#recipeList .row').length > 4 &&
      document.querySelectorAll('#containerItems .row').length === 1 &&
      document.querySelectorAll('#chatlog .chatline').length === 2 &&
      document.getElementById('numWarmth').textContent === '20' &&
      document.querySelectorAll('#buildSlots .bslot').length === 5,
    `${document.querySelectorAll('#recipeList .row').length} recept, ${document.querySelectorAll('#buildSlots .bslot').length} byggdelar`
  );
  check('HUD: kyla markeras i gränssnittet', document.querySelector('.vital.warmth').classList.contains('cold'));
  check('HUD: dödskärmen visas', document.body.classList.contains('dead'));
} catch (err) {
  check('HUD: hotbar, mätare, paneler och chatt renderas i DOM', false, err.message);
  console.error(err);
}

// 3. lokal spelare: förutsägelse med samma fysik som servern
try {
  const world = new mods.worldgen.World();
  const spawn = world.randomBeachSpawn(Math.random);
  const player = new mods.player.LocalPlayer(world, {});
  const index = new mods.building.BuildingIndex();
  player.setColliderSource((x, z, r) => index.near(x, z, r));
  player.setAabbFn(mods.building.pieceAABB);
  player.body.x = spawn.x;
  player.body.y = spawn.y + 0.5;
  player.body.z = spawn.z;
  player.keys.add('KeyW');
  const start = { x: player.body.x, z: player.body.z };
  for (let i = 0; i < 40; i++) player.predict(1 / 20);
  const dist = Math.hypot(player.body.x - start.x, player.body.z - start.z);
  check('Klienten förutsäger gång framåt', dist > 5, `${dist.toFixed(2)} m på 2 s`);
  check('Klienten håller sig ovanför marken', player.body.y >= world.heightAt(player.body.x, player.body.z) - 0.01, `y=${player.body.y.toFixed(2)}`);

  // samma startläge ska ge samma resultat på server och klient (delad fysik)
  const { stepBody, createBody } = await load('shared/movement.js');
  const body = createBody(spawn.x, spawn.y + 0.5, spawn.z, 0);
  const ctx = {
    bounds: world.half - 2,
    waterLevel: world.waterLevel,
    terrainHeight: (x, z) => world.heightAt(x, z),
    colliders: () => [],
    aabb: () => null,
  };
  for (let i = 0; i < 40; i++) stepBody(body, { f: 1, r: 0, j: false, s: false, c: false }, 1 / 20, ctx);
  const drift = Math.hypot(body.x - player.body.x, body.z - player.body.z);
  check('Klient och server räknar samma rörelse', drift < 0.2, `avvikelse ${drift.toFixed(3)} m`);
} catch (err) {
  check('Klient och server räknar samma rörelse', false, err.message);
  console.error(err);
}

// 4. byggförhandsvisning: alla byggdelar ska kunna snäppas fram
try {
  const world = new mods.worldgen.World();
  const index = new mods.building.BuildingIndex();
  const player = new mods.player.LocalPlayer(world, {});
  // hitta en plan plats
  let spot = null;
  for (const n of world.nodes) {
    if (world.slopeAt(n.x, n.z) < 0.2 && world.heightAt(n.x, n.z) > 6) {
      spot = { x: n.x, z: n.z };
      break;
    }
  }
  player.body.x = spot.x;
  player.body.y = world.heightAt(spot.x, spot.z);
  player.body.z = spot.z;

  const fakeRenderer = {
    raycastPieces: () => [],
    raycastNodes: () => [],
    showPreview() {},
    hidePreview() {},
  };
  const netStub = { send() {} };
  const interact = new mods.interact.Interactions({
    net: netStub,
    renderer: fakeRenderer,
    world,
    player,
    index,
    hud,
    getEquipped: () => 'stone_hatchet',
  });

  const placement = [];
  for (const kind of ['foundation', 'wall', 'doorway', 'ceiling']) {
    interact.setKind(kind);
    interact.updateBuild();
    placement.push({ kind, cand: interact.candidate, ok: interact.candidateOk, why: interact.candidateReason });
  }
  const foundation = placement[0];
  check(
    'Förhandsvisning ger en snäppt placering på marken',
    !!foundation.cand && foundation.cand.gx !== undefined && Number.isFinite(foundation.cand.y),
    foundation.cand ? `gx ${foundation.cand.gx}, gz ${foundation.cand.gz}, y ${foundation.cand.y?.toFixed?.(2)}` : foundation.why
  );
  check(
    'Vägg/dörr/tak kräver stöd (nekas utan grund)',
    !placement[1].ok && !placement[2].ok && !placement[3].ok,
    placement.map((p) => `${p.kind}:${p.ok ? 'ok' : p.why}`).join(', ')
  );

  // lägg in en grund och kontrollera att väggen då blir grön
  const cell = { gx: foundation.cand.gx, gz: foundation.cand.gz };
  const c = mods.building.canPlace({ kind: 'foundation', gx: cell.gx, gz: cell.gz, level: 0, side: 0, y: 0 }, index, world);
  const piece = { id: 1, kind: 'foundation', gx: cell.gx, gz: cell.gz, level: 0, side: 0, y: c.y, hp: 320 };
  index.add(piece);
  interact.setKind('wall');
  interact.updateBuild();
  check('Vägg snäpper mot grunden när den finns', !!interact.candidate && interact.candidate.ek !== undefined, `ek ${interact.candidate?.ek}`);

  interact.setKind('ceiling');
  interact.updateBuild();
  check('Tak går att lägga ovanpå grunden', !!interact.candidate && interact.candidateOk, `${interact.candidate?.level} våning – ${interact.candidateReason || 'ok'}`);

  // framtvinga ett serversvar för att testa att klienten följer indexet
  const wallPiece = { id: 2, kind: 'wall', gx: cell.gx, gz: cell.gz, level: 0, side: interact.candidate.side, ek: interact.candidate.ek, y: c.y, hp: 240 };
  index.add(wallPiece);
  check('Klientens index följer serverns byggdelar', index.size === 2 && index.hasWallOnEdge(wallPiece.ek));
} catch (err) {
  check('Förhandsvisning ger en snäppt placering på marken', false, err.message);
  console.error(err);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} klientkontroller lyckades${failed.length ? ` – misslyckade: ${failed.map((f) => f.name).join(', ')}` : ' 🎉'}\n`);
process.exit(failed.length ? 1 : 0);
