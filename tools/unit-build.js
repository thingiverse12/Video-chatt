// Enhetstest för bygglogik, snappning, ras (settle) och fysik. Ingen nätverk.
// Körs: npm run unit  (SAVE_FILE sätts i paket-scriptet)

import { Game } from '../server/game.js';
import { snapPiece } from '../shared/building.js';
import { simulatePlayer, makeQuery } from '../shared/physics.js';

const fakeIo = { emit() {} };
const g = new Game(fakeIo);
g.index.clear();

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name} ${extra}`); failures++; }
};
const types = () => g.index.all().map((b) => b.type).sort().join(',');

console.log('\n— Bygg & snappning —');
const gy = g.world.terrain(0, 0);
const f = g.addBlockRaw({ type: 'foundation', tier: 'wood', x: 0, y: gy + 0.1, z: 0, rot: 0, owner: 'p1' });
const wN = g.addBlockRaw({ type: 'wall', tier: 'wood', x: 0, y: f.y + 1.6, z: 2, rot: 0, owner: 'p1' });
const wS = g.addBlockRaw({ type: 'wall', tier: 'wood', x: 0, y: f.y + 1.6, z: -2, rot: 0, owner: 'p1' });
const wE = g.addBlockRaw({ type: 'wall', tier: 'wood', x: 2, y: f.y + 1.6, z: 0, rot: 1, owner: 'p1' });
const roof = g.addBlockRaw({ type: 'roof', tier: 'wood', x: 0, y: f.y + 3.2, z: 0, rot: 0, owner: 'p1' });
const box = g.addBlockRaw({ type: 'box', tier: 'wood', x: 1, y: f.y + 0.55, z: 1, rot: 0, owner: 'p1' });
ok('alla block i index', g.index.blocks.size === 6, String(g.index.blocks.size));

const pl = { x: 3.5, y: gy, z: 3.5 };
let r = snapPiece('wall', { x: 0, y: f.y + 1.6, z: 2 }, g.index, g.world.hm, pl);
ok('upptagen väggplats nekas', r.ok === false && /upptagen/i.test(r.reason), JSON.stringify(r));

r = snapPiece('wall', { x: -2.1, y: f.y + 1.0, z: 0.3 }, g.index, g.world.hm, pl);
ok('tom väggkant snappar (västra sidan)', r.ok && r.piece.x === -2 && r.piece.z === 0 && r.piece.rot === 1, JSON.stringify(r));

r = snapPiece('foundation', { x: 3.4, y: gy, z: 0.2 }, g.index, g.world.hm, pl);
ok('golv snappar till 4 m-rutnät', r.ok && r.piece.x === 4 && r.piece.z === 0, JSON.stringify(r));
ok('nytt golv ärjar grannens höjd', r.ok && Math.abs(r.piece.y - f.y) < 1e-6, `y=${r.piece && r.piece.y} f.y=${f.y}`);
const f2 = r.ok ? g.addBlockRaw({ ...r.piece, type: 'foundation', tier: 'wood', owner: 'p1' }) : null;
ok('golv bredvid golv tillåtet', !!f2);
r = snapPiece('foundation', { x: 3.4, y: gy, z: 0.2 }, g.index, g.world.hm, pl);
ok('dubbelt golv nekas', r.ok === false, JSON.stringify(r));

r = snapPiece('roof', { x: 0.5, y: f.y + 3.2, z: 4.3 }, g.index, g.world.hm, pl);
ok('tak snappar till väggkant', r.ok && r.piece.z === 4 && Math.abs(r.piece.y - (f.y + 3.2)) < 1e-6, JSON.stringify(r));

r = snapPiece('door', { x: 0, y: f.y + 1.3, z: 2 }, g.index, g.world.hm, pl);
ok('dörr kräver dörröppning', r.ok === false, JSON.stringify(r));

r = snapPiece('box', { x: 0.9, y: f.y + 0.4, z: -1.1 }, g.index, g.world.hm, pl);
ok('låda snappar till golvets 1 m-rutnät', r.ok && Math.abs(r.piece.x - 1) < 1e-6 && Math.abs(r.piece.z + 1) < 1e-6, JSON.stringify(r));
if (r.ok) {
  const b2 = g.addBlockRaw({ ...r.piece, type: 'box', tier: 'wood', owner: 'p1' });
  const r2 = snapPiece('box', { x: 0.9, y: f.y + 0.4, z: -1.1 }, g.index, g.world.hm, pl);
  ok('två lådor på samma ruta nekas', r2.ok === false, JSON.stringify(r2));
  g.removeBlock(b2, false);
}

r = snapPiece('campfire', { x: 8, y: g.world.terrain(8, 8), z: 8 }, g.index, g.world.hm, { x: 8, y: g.world.terrain(8, 8), z: 9.5 });
ok('lägereld placeras på marken', r.ok && Math.abs(r.piece.z - 8) < 0.01, JSON.stringify(r));

// dörröppning + dörr
g.index.remove(wE.id);
const dw = g.addBlockRaw({ type: 'doorway', tier: 'wood', x: 2, y: f.y + 1.6, z: 0, rot: 1, owner: 'p1' });
r = snapPiece('door', { x: 2, y: f.y + 1.3, z: 0 }, g.index, g.world.hm, pl);
ok('dörr snappar i dörröppning', r.ok && Math.abs(r.piece.y - (dw.y - 0.3)) < 1e-6, JSON.stringify(r));
const door = r.ok ? g.addBlockRaw({ ...r.piece, type: 'door', tier: 'wood', owner: 'p1' }) : null;
if (door) {
  const r2 = snapPiece('door', { x: 2, y: f.y + 1.3, z: 0 }, g.index, g.world.hm, pl);
  ok('andra dörr i samma öppning nekas', r2.ok === false, JSON.stringify(r2));
  ok('stängd dörr är solid', g.index.get(door.id) && !door.open);
}

console.log('\n— Andra våningen —');
const w2 = g.addBlockRaw({ type: 'wall', tier: 'wood', x: 0, y: f.y + 4.6, z: 2, rot: 0, owner: 'p1' });
r = snapPiece('foundation', { x: 0.2, y: f.y + 3.2, z: 3.8 }, g.index, g.world.hm, { x: 0, y: f.y + 3.2, z: 6 });
ok('golv ovanpå vägg (våning 2)', r.ok && Math.abs(r.piece.y - (f.y + 3.2)) < 1e-6, JSON.stringify(r));
const upper = r.ok ? g.addBlockRaw({ ...r.piece, type: 'foundation', tier: 'wood', owner: 'p1' }) : null;
ok('vägg kan staplas på vägg', !!w2);

console.log('\n— Ras (settle) —');
// ren stuga på eget golv: golv + 4 väggar + tak + låda
g.index.clear();
const gy3 = g.world.terrain(-40, -40);
const base = g.addBlockRaw({ type: 'foundation', tier: 'wood', x: -40, y: gy3 + 0.1, z: -40, rot: 0, owner: 'p1' });
for (const [x, z, rot] of [[0, 2, 0], [0, -2, 0], [2, 0, 1], [-2, 0, 1]]) {
  g.addBlockRaw({ type: 'wall', tier: 'wood', x: -40 + x, y: base.y + 1.6, z: -40 + z, rot, owner: 'p1' });
}
const roof3 = g.addBlockRaw({ type: 'roof', tier: 'wood', x: -40, y: base.y + 3.2, z: -40, rot: 0, owner: 'p1' });
const box3 = g.addBlockRaw({ type: 'box', tier: 'wood', x: -39, y: base.y + 0.55, z: -39, rot: 0, owner: 'p1' });
const camp = g.addBlockRaw({ type: 'campfire', tier: 'wood', x: -34, y: g.world.terrain(-34, -34) + 0.35, z: -34, rot: 0, owner: 'p1' });
const before = g.index.blocks.size;
ok('stuga = 8 block', before === 8, String(before));
g.removeBlock(base, true);
ok('hela stugan rasar när golvet rivs', g.index.blocks.size === 1, `${before} -> ${g.index.blocks.size} kvar: ${types()}`);
ok('lägereld (fristående) står kvar', !!g.index.get(camp.id), types());

// riva en vägg -> bara taket över den väggen påverkas (här: taket vilar på 4 väggar)
g.index.clear();
const base2 = g.addBlockRaw({ type: 'foundation', tier: 'wood', x: -40, y: gy3 + 0.1, z: -40, rot: 0, owner: 'p1' });
const walls2 = [[0, 2, 0], [0, -2, 0], [2, 0, 1], [-2, 0, 1]].map(([x, z, rot]) =>
  g.addBlockRaw({ type: 'wall', tier: 'wood', x: -40 + x, y: base2.y + 1.6, z: -40 + z, rot, owner: 'p1' }));
const roof4 = g.addBlockRaw({ type: 'roof', tier: 'wood', x: -40, y: base2.y + 3.2, z: -40, rot: 0, owner: 'p1' });
g.removeBlock(walls2[0], true);
ok('tak står kvar när en av fyra väggar rivs', !!g.index.get(roof4.id), types());
ok('övriga väggar står kvar', g.index.all().filter((b) => b.type === 'wall').length === 3, types());

console.log('\n— Spara / ladda om —');
const snapshot = g.index.all().map((b) => ({ id: b.id, type: b.type, tier: b.tier, x: b.x, y: b.y, z: b.z, rot: b.rot, hp: b.hp, maxHp: b.maxHp, owner: b.owner }));
g.index.clear();
const loaded = snapshot.map((b) => g.addBlockRaw(b));
ok('reload ger samma antal block', g.index.blocks.size === snapshot.length, `${g.index.blocks.size} vs ${snapshot.length}`);

console.log('\n— Kollision & fysik —');
g.index.clear();
const gy2 = g.world.terrain(20, 20);
const f4 = g.addBlockRaw({ type: 'foundation', tier: 'wood', x: 20, y: gy2 + 0.1, z: 20, rot: 0, owner: 'p1' });
g.addBlockRaw({ type: 'wall', tier: 'wood', x: 20, y: f4.y + 1.6, z: 22, rot: 0, owner: 'p1' });
g.addBlockRaw({ type: 'wall', tier: 'wood', x: 20, y: f4.y + 1.6, z: 18, rot: 0, owner: 'p1' });
const q = makeQuery(g.world.hm, g.index);

const st = { x: 20, y: gy2, z: 26, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };  // yaw 0 = -Z (mot väggen)
for (let i = 0; i < 120; i++) simulatePlayer(st, { f: true }, 1 / 30, q);
ok('vägg stoppar spelaren', st.z > 22.25 && st.z < 24, `z=${st.z.toFixed(2)}`);
const stOpen = { x: 20, y: gy2, z: 26, vx: 0, vy: 0, vz: 0, yaw: Math.PI, pitch: 0, onGround: true };
for (let i = 0; i < 60; i++) simulatePlayer(stOpen, { f: true }, 1 / 30, q);
ok('utan vägg i ryggen går spelaren framåt', stOpen.z > 27, `z=${stOpen.z.toFixed(2)}`);

const st2 = { x: 15, y: gy2, z: 20, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 2, pitch: 0, onGround: true };
let maxOnFloor = 0;
for (let i = 0; i < 200; i++) {
  simulatePlayer(st2, { f: true }, 1 / 30, q);
  if (st2.x > 18.4 && st2.x < 21.6) maxOnFloor = Math.max(maxOnFloor, st2.y);
}
ok('spelare kliver upp på golvet', Math.abs(maxOnFloor - (f4.y + 0.1)) < 0.06, `y=${maxOnFloor.toFixed(2)} topp=${(f4.y + 0.1).toFixed(2)}`);
ok('spelare går av golvet utan att fastna', st2.x > 22, `x=${st2.x.toFixed(2)}`);

// hoppar in i taket/väggen: huvudet ska stötas
const st3 = { x: 20, y: f4.y + 0.2, z: 20, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
simulatePlayer(st3, { jump: true }, 1 / 30, q);
for (let i = 0; i < 60; i++) simulatePlayer(st3, {}, 1 / 30, q);
ok('spelare landar efter hopp', st3.onGround && Math.abs(st3.y - (f4.y + 0.1)) < 0.12, `y=${st3.y.toFixed(2)}`);

// simulerad determinism: samma input ger samma resultat
const a1 = { x: 0, y: g.world.terrain(0, 0), z: 0, vx: 0, vy: 0, vz: 0, yaw: 0.7, onGround: true };
const a2 = { ...a1 };
for (let i = 0; i < 60; i++) simulatePlayer(a1, { f: true, sprint: true }, 1 / 30, q);
for (let i = 0; i < 60; i++) simulatePlayer(a2, { f: true, sprint: true }, 1 / 30, q);
ok('fysiken är deterministisk (klient/server)', Math.abs(a1.x - a2.x) < 1e-9 && Math.abs(a1.z - a2.z) < 1e-9, `${a1.x}/${a2.x}`);

console.log('\n— Nodkollision (träd & klippor) —');
g.index.clear();
const gy5 = g.world.terrain(-80, -80);
// ett träd och en klippa mitt i vägen
const treeN = { id: 't1', kind: 'tree', x: -80, y: gy5, z: -84, s: 1, h: 6, amount: 150, max: 150, alive: true, rot: 0 };
const rockN = { id: 'r1', kind: 'rock', x: -74, y: gy5, z: -84, s: 1, h: 0, amount: 180, max: 180, alive: true, rot: 0 };
g.world.colliders.clear();
g.world.colliders.update(treeN);
g.world.colliders.update(rockN);
const q5 = makeQuery(g.world.hm, g.index, g.world.colliders);
ok('kollisionsrutnät har noder', g.world.colliders.map.size === 2, String(g.world.colliders.map.size));

const p1 = { x: -80, y: gy5, z: -80, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };   // yaw 0 = -Z (mot trädet)
for (let i = 0; i < 150; i++) simulatePlayer(p1, { f: true }, 1 / 30, q5);
ok('träd stoppar spelaren', p1.z > -84 + 0.4, `z=${p1.z.toFixed(2)} (träd vid -84)`);
ok('spelaren fastnar inte i trädet', Math.hypot(p1.x + 80, p1.z + 84) > 0.7, `avstånd till stam=${Math.hypot(p1.x + 80, p1.z + 84).toFixed(2)}`);

const p2 = { x: -80, y: gy5, z: -80, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
for (let i = 0; i < 40; i++) simulatePlayer(p2, { f: true, r: true }, 1 / 30, q5);
for (let i = 0; i < 150; i++) simulatePlayer(p2, { f: true }, 1 / 30, q5);
ok('går att passera bredvid trädet', p2.z < -85, `z=${p2.z.toFixed(2)}`);

const p3 = { x: -74, y: gy5, z: -80, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
for (let i = 0; i < 150; i++) simulatePlayer(p3, { f: true }, 1 / 30, q5);
ok('klippa stoppar spelaren', p3.z > -84 + 0.5, `z=${p3.z.toFixed(2)}`);

// avverkat träd -> stubbe blockerar mindre; utbruten klippa -> ingen kollision
treeN.alive = false; rockN.alive = false;
g.world.colliders.update(treeN); g.world.colliders.update(rockN);
ok('utbruten klippa har ingen kollision', !g.world.colliders.map.has('r1'));
const p4 = { x: -74, y: gy5, z: -80, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
for (let i = 0; i < 150; i++) simulatePlayer(p4, { f: true }, 1 / 30, q5);
ok('går rakt igenom utbruten klippa', p4.z < -86, `z=${p4.z.toFixed(2)}`);
const p5 = { x: -80, y: gy5, z: -80, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
for (let i = 0; i < 150; i++) simulatePlayer(p5, { f: true }, 1 / 30, q5);
ok('stubbe stoppar fortfarande', p5.z > -84 + 0.25, `z=${p5.z.toFixed(2)}`);

// spawn inuti ett träd -> knuffas ut
const p6 = { x: -80, y: gy5, z: -84, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true };
simulatePlayer(p6, {}, 1 / 30, q5);
ok('spelare inuti stam knuffas ut', Math.hypot(p6.x + 80, p6.z + 84) > 0.6, `d=${Math.hypot(p6.x + 80, p6.z + 84).toFixed(2)}`);

console.log(failures ? `\n${failures} FEL` : '\nAlla byggtester OK');
process.exit(failures ? 1 : 0);
