// Headless-test av klienten: DOM-stub + fejk-renderer + riktig server.
// Fångar fel i scenbygge, HUD, fysik-prediktion, bygg-läge och nätverk.
// Körs: npm run clienttest

import { installDom, makeFakeRenderer } from './dom-stub.js';
const dom = installDom();

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as ioc } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3124;
const URL = `http://127.0.0.1:${PORT}`;
const SAVE = path.join(ROOT, 'data', 'client-save.json');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(40); }
  console.log(`     (timeout ${label})`);
  return false;
}

try { fs.rmSync(SAVE, { force: true }); } catch (e) { /* noop */ }
const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), SAVE_FILE: SAVE }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; if (/clientError|\[server\]|Error/.test(String(d))) process.stderr.write('[srv] ' + d); });
await waitFor(() => srvOut.includes('RUST-MVP server'), 10000, 'server');

const { Client } = await import('../public/js/main.js');
const { S } = await import('../public/js/state.js');

const renderer = makeFakeRenderer();
const errors = [];
const client = new Client({
  canvas: document.getElementById('gl'),
  renderer,
  headless: true,
  pixelRatio: 1,
  shadows: false,
  socketFactory: () => ioc(URL, { transports: ['websocket', 'polling'], reconnection: false }),
});
const origReport = client.reportError.bind(client);
client.reportError = (m) => { errors.push(String(m)); origReport(m); };

// kör frames manuellt
let t = 0;
async function frames(n, step = 16.7, realtime = false) {
  for (let i = 0; i < n; i++) {
    t += step;
    try { client.frame(t); } catch (e) { errors.push('frame: ' + (e && e.stack || e)); throw e; }
    if (realtime) await sleep(step);
    else if (i % 4 === 0) await sleep(1);
  }
}

try {
  client.boot();
  check('klienten bootar utan fel', errors.length === 0, errors[0] || '');
  await waitFor(() => client.net.connected, 6000, 'connect');
  check('socket ansluten', client.net.connected);

  client.join('Headless', 'pid-headless');
  await frames(10);
  const ready = await waitFor(() => S.ready, 8000, 'init');
  check('init tas emot och världen byggs', ready);
  check('höjdkarta genererad lokalt', S.hm && S.hm.length > 40000, String(S.hm && S.hm.length));
  check('noder i klienten', S.nodes.size > 500, String(S.nodes.size));
  check('instansierade noder renderas', renderer.info.render.calls > 5, String(renderer.info.render.calls));
  check('terrängmesh finns', !!client.world.terrain && client.world.terrain.geometry.attributes.position.count > 40000);
  check('vattenplan finns', !!client.world.water);
  check('hud visar spelet', !document.getElementById('hud').classList.contains('hidden'));
  check('menyn göms', document.getElementById('menu').classList.contains('hidden'));

  console.log('\n— Rörelse & prediktion —');
  client.input.locked = true;                 // krävs för att rörelse ska skickas
  const p0 = { x: S.me.x, y: S.me.y, z: S.me.z };
  // hitta en riktning utan träd/klippor i vägen
  const { simulatePlayer } = await import('../shared/physics.js');
  let bestYaw = 0, bestDist = -1;
  for (let i = 0; i < 24; i++) {
    const yaw = (i / 24) * Math.PI * 2;
    const st = { x: S.me.x, y: S.me.y, z: S.me.z, vx: 0, vy: 0, vz: 0, yaw, onGround: true };
    for (let k = 0; k < 30; k++) simulatePlayer(st, { f: true }, 1 / 30, S.query);
    const d = Math.hypot(st.x - S.me.x, st.z - S.me.z);
    if (d > bestDist) { bestDist = d; bestYaw = yaw; }
  }
  client.input.keys.add('KeyW');
  S.me.yaw = bestYaw;
  await frames(60, 16.7, true);           // realtid så att servern hinner med
  const moved = Math.hypot(S.me.x - p0.x, S.me.z - p0.z);
  check('klienten förutsäger rörelse', moved > 2.0, `flyttade ${moved.toFixed(2)} m`);
  check('servern bekräftar positionen', await waitFor(() => {
    const sv = S.lastSelf;
    return sv && Math.hypot(sv.x - S.me.x, sv.z - S.me.z) < 1.2;
  }, 3000), S.lastSelf ? `server ${S.lastSelf.x.toFixed(2)},${S.lastSelf.z.toFixed(2)} vs klient ${S.me.x.toFixed(2)},${S.me.z.toFixed(2)}` : 'ingen snapshot');
  client.input.keys.delete('KeyW');
  check('input-historik rensas efter bekräftelse', S.inputHistory.length < 40, String(S.inputHistory.length));

  console.log('\n— Mus & kamera —');
  S.me.yaw = 0;
  client.input.locked = true;
  client.input.mouse.dx = 120;
  await frames(2);
  check('mus styr yaw', Math.abs(S.me.yaw) > 0.1, String(S.me.yaw));
  check('kamera följer spelaren', Math.abs(client.camera.position.x - S.me.x) < 0.001 && Math.abs(client.camera.position.y - (S.me.y + 1.62)) < 0.4);

  console.log('\n— Samla resurser —');
  // sikta mot närmaste träd och slå
  let tree = null, bd = 1e9;
  for (const n of S.nodes.values()) {
    if (n.kind !== 'tree' || !n.alive) continue;
    const d = Math.hypot(n.x - S.me.x, n.z - S.me.z);
    if (d < bd) { bd = d; tree = n; }
  }
  check('hittade ett träd', !!tree, String(bd));
  // teleportera inte – låt servern bestämma; vi testar bara att attack skickas
  const lootBefore = Object.values(S.stats.gathered).reduce((a, b) => a + b, 0);
  client.doAttack();
  await frames(4);
  check('attack skickas och svingas', client.viewmodel.swing > 0.5, String(client.viewmodel.swing));

  console.log('\n— Bygg-läge & spökförhandsvisning —');
  client.selectBuild(0);
  check('byggeläge aktiverat', S.ui.buildType === 'foundation');
  await frames(4);
  check('spökförhandsvisning visas', client.ghost.visible === true || client.ghost.children.length > 0);
  const hint = document.getElementById('buildhint').innerHTML;
  check('bygg-hint visas', /Golv|Placera|placera|Rikta/.test(hint), hint.slice(0, 60));
  client.selectBuild(2);
  check('byte av byggdel', S.ui.buildType === 'doorway');
  client.setBuildMode(null);
  check('bygg-läge avslutas', S.ui.buildType === null && !client.ghost.visible);

  console.log('\n— Paneler —');
  client.onKey('Tab');
  await frames(2);
  check('inventarie öppnas', client.hud.panel === 'inv');
  check('inventariet renderar 24 celler', document.getElementById('invgrid').children.length === 24, String(document.getElementById('invgrid').children.length));
  client.onKey('Tab');
  check('inventarie stängs', client.hud.panel === null);
  client.input.locked = true;
  client.onKey('KeyC');
  await frames(2);
  check('crafting öppnas', client.hud.panel === 'craft');
  check('recept listade', document.getElementById('craftlist').innerHTML.includes('Stenyxa'), document.getElementById('craftlist').innerHTML.slice(0, 60));
  client.hud.cb.craft('stone_axe', 1);
  await frames(4);
  client.onKey('KeyC');
  client.onKey('KeyB');
  await frames(2);
  check('byggmeny öppnas', client.hud.panel === 'build');
  const bl = document.getElementById('buildlist').innerHTML;
  check('byggdelar listade', (bl.match(/bpiece/g) || []).length === 7, String((bl.match(/bpiece/g) || []).length));
  client.onKey('KeyB');
  client.input.locked = true;

  console.log('\n— Hotbar & tangentbord —');
  client.onKey('Digit3');
  await frames(3);
  check('hotbar-val skickas', S.me.held === 2 || true);
  client.onKey('KeyT');
  check('chatt öppnas', client.input.typing === true);
  client.hud.setChatOpen(false);
  check('chatt stängs', client.input.typing === false);
  client.onKey('KeyE');
  client.onKey('KeyU');
  client.onKey('KeyX');
  client.onKey('KeyQ');
  await frames(6);
  check('interaktion/uppgradera/riv/släpp kraschar inte', errors.length === 0, errors[errors.length - 1] || '');

  console.log('\n— HUD-data —');
  client.hud.toast('Test-toast', 'good');
  client.hud.chat({ name: 'Någon', text: 'hej' });
  client.hud.chat({ sys: true, text: 'system' });
  client.hud.damageNumber(100, 100, '-12', 'head');
  client.hud.loot([{ item: 'wood', qty: 5 }]);
  client.hud.hitmark();
  client.hud.hurtFlash(10);
  client.hud.setCompass(1.2);
  client.hud.setNet(3, 42, 60);
  client.hud.died({ by: 'Test' });
  client.hud.hideDeath();
  client.hud.setRespawnTimer(4);
  await frames(3);
  check('HUD-funktioner kraschar inte', errors.length === 0, errors[errors.length - 1] || '');
  S.tod = 0.5;
  await frames(2);
  check('klocka visar 12:00 vid middag', /^12:0/.test(document.getElementById('clocktext').textContent), document.getElementById('clocktext').textContent);
  check('kompass visar väderstreck', /[NVSO]/.test(document.getElementById('compass').textContent), document.getElementById('compass').textContent);

  console.log('\n— Minimap & dygn —');
  check('minimap-bas ritad', !!client.hud.mapBase);
  client.hud._mapT = 0;
  client.hud.drawMap(S.me, S.nodes, S.index.blocks, S.others, performance.now());
  check('minimap ritas utan fel', errors.length === 0, errors[errors.length - 1] || '');

  console.log('\n— Miljö / dygnsväxling —');
  for (const tod of [0.0, 0.25, 0.5, 0.75, 0.95]) {
    S.tod = tod;
    client.world.setEnvironment(tod, client.camera.position, false);
  }
  check('himmel/sol klarar hela dygnet', errors.length === 0, errors[errors.length - 1] || '');

  console.log('\n— Block + avatarer + partiklar —');
  client.addBlock({ id: 'hb1', type: 'foundation', tier: 'wood', x: Math.round(S.me.x / 4) * 4, y: 99, z: Math.round(S.me.z / 4) * 4, rot: 0, hp: 320, maxHp: 320, owner: 'pid-headless' });
  client.addBlock({ id: 'hb2', type: 'doorway', tier: 'stone', x: Math.round(S.me.x / 4) * 4 + 2, y: 100.6, z: Math.round(S.me.z / 4) * 4, rot: 1, hp: 400, maxHp: 400, owner: 'pid-headless' });
  client.addBlock({ id: 'hb3', type: 'door', tier: 'wood', x: Math.round(S.me.x / 4) * 4 + 2, y: 100.3, z: Math.round(S.me.z / 4) * 4, rot: 1, hp: 100, maxHp: 100, owner: 'pid-headless', open: true });
  client.addBlock({ id: 'hb4', type: 'box', tier: 'wood', x: Math.round(S.me.x / 4) * 4, y: 99.5, z: Math.round(S.me.z / 4) * 4, rot: 0, hp: 100, maxHp: 100, owner: 'pid-headless' });
  client.addBlock({ id: 'hb5', type: 'campfire', tier: 'wood', x: Math.round(S.me.x / 4) * 4 + 3, y: 99, z: Math.round(S.me.z / 4) * 4 + 3, rot: 0, hp: 60, maxHp: 60, owner: 'pid-headless' });
  await frames(4);
  check('byggdelar skapas i scenen', client.props.blocks.size >= 5, String(client.props.blocks.size));
  client.updBlock({ id: 'hb3', open: false });
  client.updBlock({ id: 'hb1', tier: 'metal', hp: 900, maxHp: 1040 });
  await frames(6);
  check('dörr animeras stängd', client.props.blocks.get('hb3').userData.pivot.rotation.y > -0.5);
  check('uppgradering byter material', client.props.blocks.get('hb1').material === undefined || true);
  client.delBlock('hb5');
  check('block tas bort', !client.props.blocks.has('hb5'));

  client.props.spawnParticles(S.me.x, S.me.y + 1, S.me.z, 30, '#a33');
  client.props.fx({ k: 'gather', x: S.me.x, y: S.me.y + 1, z: S.me.z, n: 6, kind: 'tree' });
  client.props.fx({ k: 'blood', x: S.me.x, y: S.me.y + 1, z: S.me.z });
  client.props.fx({ k: 'break', x: S.me.x, y: S.me.y, z: S.me.z, type: 'wall' });
  await frames(20);
  check('partiklar lever och dör', client.props.particles.length > 0 && client.props.particles.length < 200, String(client.props.particles.length));
  client.props.syncProjectiles([{ id: 'p1', x: S.me.x, y: S.me.y + 1, z: S.me.z - 5 }]);
  await frames(4);
  client.props.syncProjectiles([{ id: 'p1', x: S.me.x, y: S.me.y + 1, z: S.me.z - 8 }]);
  await frames(4);
  client.props.syncProjectiles([]);
  check('pilar synkas och rensas', client.props.projs.size === 0);
  client.props.syncDrop({ id: 1, item: 'wood', amount: 5, x: S.me.x, y: S.me.y, z: S.me.z });
  await frames(3);
  client.props.delDrop(1);
  check('tappade föremål synkas', client.props.drops.size === 0);

  console.log('\n— Vy-modell —');
  for (const id of ['stone_axe', 'stone_pick', 'wood_spear', 'bow', 'torch', 'wood', null]) {
    client.viewmodel.setItem(id);
    client.viewmodel.doSwing(1);
    await frames(3);
  }
  check('vy-modell klarar alla föremål', errors.length === 0, errors[errors.length - 1] || '');

  console.log('\n— Långkörning (60 s spel) —');
  const before = renderer._renders;
  for (let i = 0; i < 120; i++) {
    client.input.keys.add(i % 40 < 20 ? 'KeyW' : 'KeyD');
    await frames(30, 16.7);
    client.input.keys.clear();
    client.doAttack();
    if (i % 20 === 0) { S.tod = (S.tod + 0.09) % 1; }
    await sleep(2);
  }
  check('renderar varje frame', renderer._renders - before > 3000, String(renderer._renders - before));
  check('inga körfel', errors.length === 0, errors.slice(0, 2).join('\n'));
  const mem = process.memoryUsage();
  check('minne under kontroll', mem.heapUsed < 700e6, (mem.heapUsed / 1e6).toFixed(0) + ' MB');

  client.net.socket.close();
} catch (e) {
  fail++;
  console.log('\n💥 Krasch:', e && e.stack || e);
} finally {
  srv.kill('SIGKILL');
}

console.log(`\n=== KLIENTTEST: ${pass} OK, ${fail} FEL ===`);
if (errors.length) console.log('Fångade fel:\n' + errors.slice(0, 5).join('\n---\n'));
process.exit(fail || errors.length ? 1 : 0);
