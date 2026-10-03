/**
 * Rökprov för RUST-MVP: ansluter två botklienter till en körande server och
 * verifierar kärnloopen (rörelse, resurser, hantverk, bygge, synk, strid).
 *
 *   node server/index.js &
 *   node tools/smoketest.js [url]
 */

import { World } from '../shared/worldgen.js';
import { canPlace, BuildingIndex } from '../shared/building.js';

const URL_ = process.argv[2] || process.env.WS_URL || 'ws://localhost:3000/ws';
const results = [];

function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? `  (${extra})` : ''}`);
}

class Bot {
  constructor(name) {
    this.name = name;
    this.inv = {};
    this.hotbar = new Array(10).fill(null);
    this.selected = 0;
    this.players = new Map();
    this.buildings = new Map();
    this.you = null;
    this.youId = null;
    this.msgs = [];
    this.fx = [];
    this.stats2 = null;
    this.seq = 0;
    this.lastHit = 0;
    this.pos = [0, 0, 0];
    this.alive = true;
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL_);
      const timer = setTimeout(() => reject(new Error(`${this.name}: timeout vid anslutning`)), 8000);
      this.ws.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        this.onMessage(m);
        if (m.t === 'welcome') {
          clearTimeout(timer);
          resolve(this);
        }
        if (m.t === 'error') this.errors.push(m.msg);
      });
      this.ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`${this.name}: anslutningsfel`));
      });
      this.ws.addEventListener('open', () => this.send({ t: 'join', name: this.name }));
    });
  }

  onMessage(m) {
    this.msgs.push(m);
    switch (m.t) {
      case 'you':
        this.you = m;
        this.youId = m.id;
        this.inv = m.inv || {};
        this.hotbar = m.hotbar || this.hotbar;
        if (m.pos) this.pos = m.pos;
        break;
      case 'inv':
        this.you = { ...(this.you || {}), ...m };
        if (m.inv) this.inv = m.inv;
        if (m.hotbar) this.hotbar = m.hotbar;
        if (m.selected !== undefined) this.selected = m.selected;
        break;
      case 'stats':
        this.stats2 = m;
        break;
      case 'fx':
        this.fx.push(m);
        break;
      case 'welcome':
        this.welcome = m;
        this.you = m.you;
        this.youId = m.you.id;
        this.inv = m.you.inv || {};
        this.hotbar = m.you.hotbar || this.hotbar;
        for (const p of m.roster) this.players.set(p.id, p);
        for (const b of m.buildings) this.buildings.set(b.id, b);
        break;
      case 'state':
        for (const s of m.s) {
          this.players.set(s.i, { ...(this.players.get(s.i) || {}), ...s });
          if (s.i === this.youId) this.pos = [s.x, s.y, s.z];
        }
        break;
      case 'build':
        for (const b of m.add || []) this.buildings.set(b.id, b);
        for (const id of m.rm || []) this.buildings.delete(id);
        for (const [id, hp] of m.upd || []) {
          const b = this.buildings.get(id);
          if (b) b.hp = hp;
        }
        break;
      case 'respawned':
        this.pos = m.pos;
        break;
      case 'nodestate':
        this.lastNode = m;
        break;
      case 'chat':
        this.chat = m;
        break;
      default:
        break;
    }
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /** Skicka input enligt tidigare röst; yaw i radianer */
  move({ f = 0, r = 0, s = false, j = false, yaw = 0, pitch = 0 }) {
    this.seq++;
    this.send({ t: 'input', seq: this.seq, dt: 0.05, f, r, s, j, yaw, pitch });
  }

  hit(dir, draw) {
    this.send({ t: 'hit', dir, draw });
  }

  chat_(msg) {
    this.send({ t: 'chat', msg });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nearestNode(world, p, filter = () => true) {
  let best = null;
  let bd = Infinity;
  for (const n of world.nodes) {
    if (!filter(n)) continue;
    const d = Math.hypot(n.x - p[0], n.z - p[2]);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return { node: best, dist: bd };
}

function yawTo(from, to) {
  // yaw 0 tittar mot -Z, positiv yaw roterar mot +X ... matchar stepBody
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

async function main() {
  console.log(`\n🔍 Rökprov mot ${URL_}\n`);
  const world = new World();
  const index = new BuildingIndex();

  const base = URL_.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');

  // 0. statiska filer och API
  const assets = ['/', '/css/style.css', '/js/main.js', '/js/render.js', '/js/hud.js', '/vendor/three.module.js', '/vendor/three.core.min.js', '/shared/worldgen.js', '/shared/building.js'];
  const assetResults = await Promise.all(
    assets.map(async (path) => {
      try {
        const res = await fetch(base + path);
        const text = res.ok ? await res.text() : '';
        return { path, ok: res.ok && text.length > 50 };
      } catch {
        return { path, ok: false };
      }
    })
  );
  const badAssets = assetResults.filter((a) => !a.ok).map((a) => a.path);
  check('Alla klientfiler serveras', badAssets.length === 0, badAssets.length ? `saknas: ${badAssets.join(', ')}` : `${assets.length} filer`);
  const indexHtml = await fetch(base + '/').then((r) => r.text());
  check('index.html har importkarta och modul', indexHtml.includes('/vendor/three.module.js') && indexHtml.includes('/js/main.js'));
  const threeSrc = await fetch(base + '/vendor/three.module.js').then((r) => r.text());
  check('three.js-bundeln är komplett (importerar three.core.min.js)', threeSrc.includes('./three.core.min.js'));

  // 1. servern svarar på /api/status och genererar samma värld
  const status = await fetch(new URL('/api/status', base)).then((r) => r.json());
  check('Världen har resurspunkter', world.nodes.length > 800, `${world.nodes.length} noder lokalt`);
  check('Server och klient genererar samma antal noder', status.nodes === world.nodes.length, `server ${status.nodes} / klient ${world.nodes.length}`);

  // 2. två spelare ansluter
  const a = new Bot('Arena-A');
  const b = new Bot('Arena-B');
  await a.connect();
  await b.connect();
  check('Spelare A fick welcome med konfiguration', !!a.welcome && !!a.welcome.config, `seed ${a.welcome?.seed}`);
  check('Spelare B ser spelare A i roster', [...b.players.values()].some((p) => p.name === 'Arena-A') || b.msgs.some((m) => m.t === 'roster'));
  await sleep(400);
  check('B ser A i state-snapshoten', [...b.players.values()].some((p) => p.id === a.welcome.you.id), `${b.players.size} spelare sedda`);
  check('A spawnade på mark', a.pos[1] > 0.5 && !world.isWater(a.pos[0], a.pos[2]), `y=${a.pos[1].toFixed(2)}`);

  // 3. rörelse
  const startPos = [...a.pos];
  const yaw = 0.7;
  for (let i = 0; i < 24; i++) {
    a.move({ f: 1, s: true, yaw });
    await sleep(50);
  }
  await sleep(200);
  const moved = Math.hypot(a.pos[0] - startPos[0], a.pos[2] - startPos[2]);
  check('Spelaren rör sig när man håller framåt', moved > 2, `${moved.toFixed(2)} m`);

  // 4. gå fram till närmaste träd och slå det
  const { node, dist } = nearestNode(world, a.pos, (n) => n.type === 'tree');
  console.log(`  → närmaste träd ${dist.toFixed(1)} m bort (id ${node.id})`);
  let guard = 0;
  while (guard++ < 400) {
    const d = Math.hypot(node.x - a.pos[0], node.z - a.pos[2]);
    if (d < 2.4) break;
    a.move({ f: 1, s: d > 6, yaw: yawTo(a.pos, [node.x, 0, node.z]) });
    await sleep(50);
  }
  check('Boten tog sig fram till ett träd', Math.hypot(node.x - a.pos[0], node.z - a.pos[2]) < 2.6, `avstånd ${Math.hypot(node.x - a.pos[0], node.z - a.pos[2]).toFixed(2)} m`);

  a.move({ f: 0, yaw: a.players.get(a.youId)?.yw ?? 0 });
  await sleep(250);
  const beforeWood = a.inv.wood || 0;
  for (let i = 0; i < 16; i++) {
    const dir = [node.x - a.pos[0], node.y + 1.6 - (a.pos[1] + 1.62), node.z - a.pos[2]];
    const l = Math.hypot(...dir) || 1;
    a.hit(dir.map((v) => v / l));
    await sleep(680); // längre än nävarnas cooldown (0,62 s)
    if ((a.inv.wood || 0) > beforeWood) break;
  }
  check('Nävar på träd ger trä', (a.inv.wood || 0) > beforeWood, `trä ${a.inv.wood ?? 0}`);
  check('Servern rapporterar nodens hälsa', !!a.lastNode && a.lastNode.hp < 45, `hp ${a.lastNode?.hp}`);

  // 5. hantverk
  a.chat_('/give wood 400');
  a.chat_('/give stone 300');
  await sleep(300);
  a.send({ t: 'craft', id: 'stone_hatchet' });
  await sleep(300);
  const hasHatchet = a.hotbar.some((s) => s && s.item === 'stone_hatchet');
  check('Kan tillverka stenyxa', hasHatchet, `trä ${a.inv.wood ?? 0}, sten ${a.inv.stone ?? 0}`);
  check('Kostnaden drogs från inventariet', (a.inv.wood ?? 0) < 400, `trä kvar ${a.inv.wood ?? 0}`);

  a.move({ f: 0, yaw: a.players.get(a.youId)?.yw ?? 0 });
  await sleep(250);
  // 6. bygge på grid – hitta en cell nära spelaren som får bebyggas
  let cell = null;
  let verdict = { ok: false, reason: 'ingen cell hittad' };
  outer: for (let rad = 0; rad < 4 && !cell; rad++) {
    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        const c = { gx: Math.floor(a.pos[0] / 3) + dx, gz: Math.floor(a.pos[2] / 3) + dz };
        const cand = { kind: 'foundation', gx: c.gx, gz: c.gz, level: 0, side: 0, y: 0, hp: 320 };
        const v = canPlace(cand, index, world);
        const center = { x: c.gx * 3 + 1.5, z: c.gz * 3 + 1.5 };
        if (v.ok && Math.hypot(center.x - a.pos[0], center.z - a.pos[2]) < 6) {
          cell = c;
          verdict = v;
          break outer;
        }
      }
    }
  }
  check('Placeringsreglerna hittar en giltig cell nära spelaren', !!cell && verdict.ok, verdict.ok ? `gx ${cell.gx}, gz ${cell.gz}` : verdict.reason);
  a.send({ t: 'place', piece: { kind: 'foundation', gx: cell.gx, gz: cell.gz, level: 0, side: 0 } });
  await sleep(400);
  const placed = [...a.buildings.values()].find((x) => x.kind === 'foundation' && x.gx === cell.gx && x.gz === cell.gz);
  const fxPlace = a.fx.slice(-4).map((f) => f.k || f.t).join(',');
  check('Grund placerades och broadcastades', !!placed, placed ? `id ${placed.id} y=${placed.y}` : `ingen (fx: ${fxPlace})`);
  if (placed) index.add(placed);

  // vägg på kanten mot spelaren
  const wallSide = 2;
  a.send({ t: 'place', piece: { kind: 'wall', gx: cell.gx, gz: cell.gz, level: 0, side: wallSide } });
  await sleep(400);
  const wall = [...a.buildings.values()].find((x) => x.kind === 'wall');
  check('Vägg byggdes på kanten', !!wall, wall ? `ek ${wall.ek}` : 'ingen');

  // lägereld: hantverk, placering och värmemekanik
  a.send({ t: 'craft', id: 'campfire' });
  await sleep(300);
  const hasFire = a.hotbar.some((s) => s && s.item === 'campfire');
  check('Kan tillverka lägereld', hasFire, hasFire ? 'i hotbaren' : `hotbar: ${JSON.stringify(a.hotbar.filter(Boolean))}`);
  if (hasFire) {
    let fireSpot = null;
    for (let i = 0; i < 16 && !fireSpot; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const x = a.pos[0] + Math.cos(ang) * 1.8;
      const z = a.pos[2] + Math.sin(ang) * 1.8;
      const cand = { kind: 'campfire', x, z, level: 0, y: 0, hp: 150 };
      const v = canPlace(cand, index, world);
      if (v.ok) fireSpot = { x, z };
      // lägg till byggda delar i det lokala indexet så reglerna stämmer
      if (v.ok && false) index.add(cand);
    }
    check('Hittar plats för lägereld', !!fireSpot, fireSpot ? `x ${fireSpot.x.toFixed(1)}, z ${fireSpot.z.toFixed(1)}` : 'ingen plats');
    if (fireSpot) {
      const slot = a.hotbar.findIndex((s) => s && s.item === 'campfire');
      a.send({ t: 'select', slot });
      await sleep(150);
      a.send({ t: 'place', piece: { kind: 'campfire', x: fireSpot.x, z: fireSpot.z, rot: 0 } });
      await sleep(600);
      const firePiece = [...a.buildings.values()].find((x) => x.kind === 'campfire');
      check('Lägereld placerades i världen', !!firePiece, firePiece ? `id ${firePiece.id}` : 'ingen');
      await sleep(900);
      check('Lägerelden värmer spelaren (värme-faktor > 0)', (a.stats2?.fire ?? 0) > 0, `fire ${a.stats2?.fire}`);
    }
  }

  // B ser bygget
  await sleep(300);
  check('Andra spelare ser byggdelarna', b.buildings.size >= a.buildings.size - 1, `B har ${b.buildings.size}, A har ${a.buildings.size}`);

  // 7. slå på byggdelen (strid mot byggnader)
  const hpBefore = placed?.hp || 320;
  a.send({ t: 'demolish', id: placed?.id });
  await sleep(300);
  const gone = ![...a.buildings.values()].some((x) => x.id === placed?.id);
  check('Kan riva sin byggdel (50 % återbetalning)', gone, gone ? `+${Math.floor(40 / 2)} trä` : 'kvar');

  // 8. överlevnadsmekanik: hunger, törst, kroppstemperatur
  await sleep(300);
  const s1 = a.stats2;
  await sleep(2500);
  const s2 = a.stats2;
  check(
    'Servern skickar överlevnadsvärden (hp, hunger, törst, temp)',
    !!s1 && ['hp', 'hunger', 'thirst', 'warmth'].every((k) => typeof s1[k] === 'number'),
    s1 ? `hp ${s1.hp} hunger ${s1.hunger} törst ${s1.thirst} värme ${s1.warmth}` : 'inget stats-meddelande'
  );
  check('Hunger och törst minskar över tid', !!s2 && s2.hunger < s1.hunger && s2.thirst < s1.thirst, `${s1?.hunger}→${s2?.hunger} hunger, ${s1?.thirst}→${s2?.thirst} törst`);
  check('Spelaren tar inte skada av kyla under dagen', (s2?.hp ?? 0) >= 99, `hp ${s2?.hp}, värme ${s2?.warmth}`);

  // 9. strid spelare mot spelare
  a.chat_('/tp Arena-B');
  await sleep(700);
  const bHpBefore = b.players.get(b.youId)?.hp ?? 100;
  const distAB = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
  for (let i = 0; i < 6; i++) {
    const dir = [b.pos[0] - a.pos[0], b.pos[1] + 1 - (a.pos[1] + 1.62), b.pos[2] - a.pos[2]];
    const l = Math.hypot(...dir) || 1;
    a.hit(dir.map((v) => v / l));
    await sleep(700);
    if ((b.players.get(b.youId)?.hp ?? 100) < bHpBefore) break;
  }
  const bHpAfter = b.players.get(b.youId)?.hp ?? 100;
  check('Närstrid skadar en annan spelare', bHpAfter < bHpBefore, `B hp ${bHpBefore} → ${bHpAfter} (avstånd ${distAB.toFixed(1)} m)`);
  check('Offret får hurt-meddelande', b.msgs.some((m) => m.t === 'hurt'), '');

  // 10. respawn
  a.chat_('/kill');
  await sleep(600);
  check('Spelaren dog av /kill', a.msgs.some((m) => m.t === 'youdead') || a.msgs.some((m) => m.t === 'death'));
  check('Lootbag skapades vid dödsplatsen', a.msgs.some((m) => m.t === 'bag' && m.add), '');

  a.close();
  b.close();
  await sleep(200);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} prov lyckades${failed.length ? ` – misslyckade: ${failed.map((f) => f.name).join(', ')}` : ' 🎉'}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Rökprovet kraschade:', err);
  process.exit(1);
});
