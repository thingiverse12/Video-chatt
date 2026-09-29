'use strict';

/* ============================================================
   AETHELGARD – Gudasimulator & Planetbyggare
   Du är en gud över en levande 2D-planet.
   ============================================================ */

// ---------- Hjälpfunktioner ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = mulberry32(seed);
  const S = 256, g = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) g[i] = r();
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const gv = (XX, YY) => g[((YY & 255) * S) + (XX & 255)];
    const v00 = gv(xi, yi), v10 = gv(xi + 1, yi), v01 = gv(xi, yi + 1), v11 = gv(xi + 1, yi + 1);
    return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
  };
}

function fbm(noise, x, y, oct) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// ---------- Namn ----------
const FIRST_NAMES = ['Alva','Björn','Cedric','Dagny','Erik','Freja','Gustav','Hilda','Ivar','Johanna',
  'Kael','Linnea','Magnus','Nora','Odin','Petra','Quintus','Runa','Sigurd','Tora',
  'Ulf','Vera','Yrsa','Zara','Asger','Britta','Crom','Doris','Elias','Folke',
  'Gerda','Halvar','Ingrid','Jens','Kira','Leif','Mira','Nils','Olga','Pär'];
const EPITHETS = ['den Vise','den Starka','Stormarn','Gråvarg','den Modiga','Järnhjärta','den Lilla',
  'Solfångare','den Gyllene','Skuggvandrar','den Gamla','Vildsjäl','Stjärnseende','den Lange'];
const CITY_NAMES = ['Aelfheim','Björnheim','Cragsport','Dalarne','Ekhov','Fyrborg','Gullvik','Hällby',
  'Isfjäll','Jotunheim','Kronstad','Ljusby','Mistholm','Nordvakt','Ormslätt','Prästvik',
  'Runsten','Skövde','Trollhamn','Ulväng','Valhall','Älvdal','Örnsköld','Ytterby',
  'Vinterstad','Sommaräng','Silverdal','Rödberg','Gryninghamn','Vidöppet','Fredslund','Nattvakt'];
const KINGDOM_PREFIX = ['Kungariket','Riket','Herskardömet','Förbundet','Klanen','Storriket','Landskapet'];
const KINGDOM_ROOTS = ['Aldoria','Björnrike','Cyril','Dunmar','Eldve','Frösön','Galdor','Hvitsten',
  'Isgård','Järnland','Kalmara','Ljusfalk','Mörkheim','Nordgard','Ormvik','Prysmat'];
const FACTION_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ec4899',
  '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#f43f5e', '#06b6d4'
];

// ---------- Terräng ----------
const T_DEEP = 0, T_WATER = 1, T_SAND = 2, T_GRASS = 3, T_FOREST = 4, T_HILL = 5, T_MOUNT = 6, T_SNOW = 7, T_LAVA = 8;
const W = 256, H = 160;
const SEA = 0.42;

const TERRAIN_COLORS = [
  [5, 22, 62],     // deep – djup marinblå
  [16, 74, 148],   // water
  [228, 206, 142], // sand – varmare
  [78, 158, 66],   // grass – frodigrare
  [38, 102, 50],   // forest – djupare grön
  [126, 142, 86],  // hill – olivgrön
  [132, 127, 138], // mount – kall gråviolett
  [240, 246, 252], // snow – renare
  [255, 92, 32],   // lava – glödande
];

// ---------- Race ----------
const RACES = {
  human:  { name: 'Människa',  icon: '🧑', color: '#ffd27f', civ: true },
  elf:    { name: 'Alv',       icon: '🧝', color: '#8ef0b0', civ: true },
  dwarf:  { name: 'Dvärg',     icon: '🧔', color: '#ff9b6b', civ: true },
  orc:    { name: 'Orch',      icon: '👹', color: '#8bd450', civ: true },
  hybrid: { name: 'Hybrid',    icon: '🧬', color: '#67e8f9', civ: true },
  animal: { name: 'Djur',      icon: '🐑', color: '#e6d3a3', civ: false },
  monster:{ name: 'Monster',   icon: '🐉', color: '#d56aff', civ: false },
};
const TRAIT_POOL = ['Modig','Feg','Snabb','Vis','Vänlig','Aggressiv','Nyfiken','Lat','Hållfast','Drömmare','Hetsig','Klok'];

// ---------- Gudakraft-typer ----------
const POWER_TABS = {
  terraform: [
    { id: 'raise',   icon: '⛰️', name: 'Höj Mark',   desc: 'Lyft havsbotten upp till land.', cost: 4, paint: true },
    { id: 'lower',   icon: '🌊', name: 'Sänk Mark',  desc: 'Sänk landet och låt havet ta över.', cost: 4, paint: true },
    { id: 'sand',    icon: '🏖️', name: 'Sand & Öken', desc: 'Måla sandig öken eller strand.', cost: 2, paint: true },
    { id: 'grass',   icon: '🌿', name: 'Gräsmark',   desc: 'Måla frodig gräsmark.', cost: 2, paint: true },
    { id: 'forest',  icon: '🌲', name: 'Skog',       desc: 'Plantera tät skog.', cost: 2, paint: true },
    { id: 'mount',   icon: '🏔️', name: 'Berg',       desc: 'Res ett berg i landskapet.', cost: 3, paint: true },
    { id: 'snow',    icon: '❄️', name: 'Snö & Is',   desc: 'Lägg evig snö på landet.', cost: 3, paint: true },
    { id: 'lava',    icon: '🌋', name: 'Lava',       desc: 'Häll ut strömmande lava.', cost: 5, paint: true },
  ],
  life: [
    { id: 'human',  icon: '🧑', name: 'Människor', desc: 'Släpp ut en grupp människor som kan grunda rike.', cost: 12 },
    { id: 'elf',    icon: '🧝', name: 'Alver',     desc: 'Släpp ut alver – vise skogsfolket.', cost: 12 },
    { id: 'dwarf',  icon: '🧔', name: 'Dvärgar',   desc: 'Släpp ut dvärgar – mästare på berg.', cost: 12 },
    { id: 'orc',    icon: '👹', name: 'Orcher',    desc: 'Släpp ut orcher – rasande krigare.', cost: 12 },
    { id: 'animal', icon: '🐑', name: 'Djur',      desc: 'Släpp ut flockar av djur.', cost: 5 },
    { id: 'monster',icon: '🐉', name: 'Monster',   desc: 'Släpp ut ett fruktat monster.', cost: 20 },
  ],
  miracles: [
    { id: 'rain',   icon: '💧', name: 'Regn',     desc: 'Livgivande regn – öken blir till gräs.', cost: 25 },
    { id: 'heal',   icon: '✨', name: 'Hälsa',    desc: 'Läk alla sår i området.', cost: 30 },
    { id: 'gift',   icon: '🎁', name: 'Rikedom',  desc: 'Stad i området välsignas med tillväxt.', cost: 40 },
    { id: 'peace',  icon: '🕊️', name: 'Fred',     desc: 'Alla krig i världen tar slut.', cost: 80 },
    { id: 'wisdom', icon: '📚', name: 'Kunskap',  desc: 'En stor idé föds – civilisationen springer framåt.', cost: 50 },
    { id: 'fertile',icon: '🌾', name: 'Befrukta', desc: 'Gräs gror till tät skog.', cost: 20 },
    { id: 'fusion', icon: '🧬', name: 'Fusion',   desc: 'Småla ihop varelser till hybrider, eller slå ihop närliggande städer till megastäder.', cost: 40 },
  ],
  disasters: [
    { id: 'meteor',   icon: '☄️', name: 'Meteor',   desc: 'En meteor slår ner och lämnar krater.', cost: 70 },
    { id: 'volcano',  icon: '🌋', name: 'Vulkan',   desc: 'En vulkan vaknar till liv.', cost: 60 },
    { id: 'lightning',icon: '⚡', name: 'Åska',     desc: 'Kraftig blixtnedslag dödar i området.', cost: 25 },
    { id: 'plague',   icon: '🦠', name: 'Pest',     desc: 'En dödlig sjukdom sprids bland varelser.', cost: 45 },
    { id: 'frost',    icon: '🥶', name: 'Istid',    desc: 'Bitande kyla fryser området.', cost: 50 },
    { id: 'quake',    icon: '🌍', name: 'Jordskälv', desc: 'Marken spricker upp i en fisssur.', cost: 60 },
  ],
};

const ERAS = [
  { t: 0,   n: 'Yngre Stenåldern' },
  { t: 35,  n: 'Äldre Stenåldern' },
  { t: 90,  n: 'Bronsåldern' },
  { t: 180, n: 'Järnåldern' },
  { t: 320, n: 'Medeltiden' },
  { t: 520, n: 'Renässansen' },
  { t: 800, n: 'Industrins Tidsålder' },
  { t: 1200,n: 'Mekaniska Tidsåldern' },
];

// ---------- Speltillstånd ----------
const state = {
  height: new Float32Array(W * H),
  moisture: new Float32Array(W * H),
  terrain: new Uint8Array(W * H),
  owner: new Int16Array(W * H), // -1 = ingen
  units: [],
  cities: [],
  kingdoms: [],
  events: [],
  particles: [],
  clouds: [],
  faith: 100,
  year: 1, month: 1,
  eraIdx: 0,
  totalBuildings: 0,
  totalTemples: 0,
  nextUnitId: 1,
  nextCityId: 1,
  nextKingdomId: 1,
  terrainDirty: true,
  territoryDirty: true,
  speed: 1,
  lastTick: 0,
  tickAcc: 0,
  activePower: null,
  activeTab: 'terraform',
  brushSize: 3,
  selected: null,      // {type:'unit'|'kingdom', id}
  followSelected: false,
  paused: false,
  kingdomColorsUsed: 0,
};

// ---------- Kamera ----------
const cam = { x: 0, y: 0, zoom: 1 };
let canvas, ctx, terrainCv, terrCtx, terrImg, terrCv, terrOvCtx, terrOvImg, miniCtx;
let cloudSprite = null; // mjuk molnsprite
let vignette = null;    // vinjettgradient för hörnen
let viewportW = 100, viewportH = 100, DPR = 1;

// ---------- Input ----------
const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, panning: false, lastSX: 0, lastSY: 0, moved: 0 };
let spaceHeld = false;

// ============================================================
// VÄRLDSGENERERING
// ============================================================
function generateWorld(preset) {
  const seed = Math.floor(Math.random() * 1e9);
  const nH = makeNoise(seed);
  const nM = makeNoise(seed + 999);
  const nD = makeNoise(seed + 4242);

  let freq = 4, oct = 5, sea = SEA, radial = 0.15, mountBoost = 0;
  if (preset === 'archipelago') { freq = 7; oct = 5; sea = 0.5; radial = 0.1; }
  else if (preset === 'pangaea') { freq = 2.5; oct = 4; sea = 0.4; radial = 0.45; }
  else if (preset === 'volcanic') { freq = 4.5; oct = 5; sea = 0.44; radial = 0.2; mountBoost = 0.14; }
  else if (preset === 'empty') { sea = 0.99; }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let h = fbm(nH, x / W * freq, y / H * freq, oct);
      // Radial mask -> världens kanter blir hav
      const nx = (x / W - 0.5) * 2, ny = (y / H - 0.5) * 2;
      const rr = Math.sqrt(nx * nx + ny * ny);
      h -= Math.max(0, rr - 0.55) * radial;
      h += mountBoost * Math.max(0, fbm(nD, x / W * 9, y / H * 9, 3) - 0.62);
      state.height[i] = clamp(h, 0, 1);
      state.moisture[i] = fbm(nM, x / W * 5, y / H * 5, 4);
      state.owner[i] = -1;
      state.terrain[i] = terrainFromHeight(state.height[i], state.moisture[i], sea, preset);
    }
  }
  // Vulkaniska glödhölar
  if (preset === 'volcanic') {
    for (let k = 0; k < 14; k++) {
      const cx = randInt(30, W - 30), cy = randInt(20, H - 20), r = randInt(2, 5);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (dist2(x, y, cx, cy) <= r * r) {
          const i = y * W + x;
          if (state.terrain[i] !== T_DEEP && state.terrain[i] !== T_WATER) state.terrain[i] = T_LAVA;
        }
      }
    }
  }

  state.units = [];
  state.cities = [];
  state.kingdoms = [];
  state.events = [];
  state.particles = [];
  state.faith = 100;
  state.year = 1; state.month = 1;
  state.eraIdx = 0;
  state.totalBuildings = 0;
  state.totalTemples = 0;
  state.nextUnitId = 1; state.nextCityId = 1; state.nextKingdomId = 1;
  state.kingdomColorsUsed = 0;
  state.selected = null;
  state.followSelected = false;
  state.terrainDirty = true;
  state.territoryDirty = true;

  // Moln
  state.clouds = [];
  for (let i = 0; i < 16; i++) {
    state.clouds.push({ x: rand(0, W), y: rand(0, H), r: rand(8, 22), s: rand(0.02, 0.08) });
  }

  addEvent('Solen går upp över en ny planet. Guden Aethelgard vaknar och ser tomma hav sträcka sig mot horisonten.', W / 2, H / 2);
}

function terrainFromHeight(h, m, sea, preset) {
  if (preset === 'empty') return T_DEEP;
  if (h < sea - 0.08) return T_DEEP;
  if (h < sea) return T_WATER;
  if (h < sea + 0.03) return T_SAND;
  if (h > 0.8) return T_SNOW;
  if (h > 0.68) return T_MOUNT;
  if (h > 0.57) return T_HILL;
  if (m < 0.22 && h < sea + 0.2) return T_SAND;
  return m > 0.55 ? T_FOREST : T_GRASS;
}

// ============================================================
// RENDER – Terräng & Territorium (offscreen)
// ============================================================
function renderTerrain() {
  const d = terrImg.data;
  const hArr = state.height;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = state.terrain[i];
      const base = TERRAIN_COLORS[t];
      // ---- Hillshade: ljus från nordväst ger markerad terräng ----
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1);
      const slope = (hArr[y * W + x0] - hArr[y * W + x1]) * 1.1
                  + (hArr[y0 * W + x] - hArr[y1 * W + x]) * 1.1;
      let shade;
      if (t === T_DEEP || t === T_WATER) {
        const depth = clamp((SEA - hArr[i]) * 3.2, 0, 1);
        shade = 1.12 - depth * 0.45 + clamp(slope * 2.5, -0.08, 0.1);
      } else if (t === T_LAVA) {
        shade = 1 + clamp(slope * 3, -0.3, 0.45);
      } else {
        shade = 1 + clamp(slope * 7, -0.42, 0.55);
      }
      // Litet per-tile variation för textur
      const v = (((i * 2654435761) >>> 0) % 13) - 6;
      let r, g, b;
      if (t === T_LAVA) {
        const flick = Math.floor(Math.random() * 70);
        r = 255; g = 92 + flick; b = 32 + Math.floor(flick * 0.3);
      } else {
        r = base[0] + v; g = base[1] + v; b = base[2] + v;
      }
      d[i * 4] = clamp(r * shade, 0, 255);
      d[i * 4 + 1] = clamp(g * shade, 0, 255);
      d[i * 4 + 2] = clamp(b * shade, 0, 255);
      d[i * 4 + 3] = 255;
    }
  }
  terrCtx.putImageData(terrImg, 0, 0);
  state.terrainDirty = false;
}

function renderTerritory() {
  const d = terrOvImg.data;
  for (let i = 0; i < W * H; i++) {
    const o = state.owner[i];
    if (o < 0 || !state.kingdoms[o]) { d[i * 4 + 3] = 0; continue; }
    const k = state.kingdoms[o];
    d[i * 4] = k.r;
    d[i * 4 + 1] = k.g;
    d[i * 4 + 2] = k.b;
    d[i * 4 + 3] = 70;
  }
  terrOvCtx.putImageData(terrOvImg, 0, 0);
  state.territoryDirty = false;
}

// ============================================================
// ENHETER
// ============================================================
function spawnUnit(race, x, y, kingdomId = null) {
  if (state.units.length >= MAX_UNITS) return null;
  x = clamp(Math.round(x), 0, W - 1);
  y = clamp(Math.round(y), 0, H - 1);
  const i = y * W + x;
  const t = state.terrain[i];
  if (race !== 'monster' && (t === T_DEEP || t === T_WATER || t === T_LAVA)) return null;
  const isKing = false;
  const u = {
    id: state.nextUnitId++,
    race, x, y,
    name: choice(FIRST_NAMES) + (Math.random() < 0.35 ? ' ' + choice(EPITHETS) : ''),
    hp: 10, maxHp: 10,
    age: randInt(1, 25), months: randInt(0, 11),
    kingdomId,
    isKing,
    targetX: x, targetY: y,
    repathIn: randInt(0, 6),
    plague: 0,
    frozen: 0,
    traits: [choice(TRAIT_POOL), choice(TRAIT_POOL)],
    kills: 0,
    bornYear: state.year,
    dead: false,
  };
  state.units.push(u);
  return u;
}

function findLandPos(tries = 60) {
  for (let k = 0; k < tries; k++) {
    const x = randInt(2, W - 3), y = randInt(2, H - 3);
    const t = state.terrain[y * W + x];
    if (t !== T_DEEP && t !== T_WATER && t !== T_LAVA) return { x, y };
  }
  return null;
}

function spawnCluster(race, n, cx, cy, kingdomId = null) {
  let spawned = 0;
  for (let k = 0; k < n * 6 && spawned < n; k++) {
    const x = clamp(cx + randInt(-4, 4), 0, W - 1);
    const y = clamp(cy + randInt(-4, 4), 0, H - 1);
    if (spawnUnit(race, x, y, kingdomId)) spawned++;
  }
  return spawned;
}

function killUnit(u, cause = '') {
  if (u.dead) return;
  u.dead = true;
  if (u.isKing && u.kingdomId != null && state.kingdoms[u.kingdomId]) {
    const k = state.kingdoms[u.kingdomId];
    if (k.kingId === u.id) {
      succession(k);
      addEvent(`Kung ${u.name} av ${k.name} har fallit${cause ? ' (' + cause + ')' : ''}. Tronen söker en ny ägare.`, u.x, u.y);
    }
  }
}

function succession(k) {
  const heir = state.units.find(x => !x.dead && x.kingdomId === k.id && !x.isKing && x.age >= 14);
  if (heir) {
    heir.isKing = true;
    k.kingId = heir.id;
    k.kingName = heir.name;
    addEvent(`${heir.name} kröns till ny härskare av ${k.name}.`, heir.x, heir.y);
  } else {
    k.kingId = -1;
    k.kingName = '(vakant)';
  }
}

// ============================================================
// KUNGARIKEN & STÄDER
// ============================================================
function foundKingdom(u) {
  if (state.kingdoms.length >= 40) return false;
  const raceName = { human: 'människor', elf: 'alver', dwarf: 'dvärgar', orc: 'orcher', hybrid: 'hybrider' }[u.race];
  const id = state.nextKingdomId++;
  const color = FACTION_COLORS[state.kingdomColorsUsed++ % FACTION_COLORS.length];
  const rgb = hexToRgb(color);
  const name = choice(KINGDOM_PREFIX) + ' ' + choice(KINGDOM_ROOTS);
  const k = {
    id, name, race: u.race, color,
    r: rgb[0], g: rgb[1], b: rgb[2],
    kingId: u.id, kingName: u.name,
    warWith: new Set(),
    foundedYear: state.year,
    cities: 0,
  };
  state.kingdoms[id] = k;
  u.kingdomId = id;
  u.isKing = true;
  // Närbelägna av samma ras ansluter sig
  for (const o of nearbyUnits(u.x, u.y, 5)) {
    if (o.race === u.race && o.kingdomId == null) o.kingdomId = id;
  }
  const city = createCity(u.x, u.y, id);
  addEvent(`🏛️ ${u.name} grundar ${k.name} och reser sig till Kung! Huvudstaden ${city.name} anlitas.`, u.x, u.y);
  return true;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let usedCityNames = [];
function createCity(x, y, kingdomId) {
  let name = choice(CITY_NAMES);
  for (let i = 0; i < 30; i++) {
    if (!usedCityNames.includes(name)) break;
    name = choice(CITY_NAMES);
  }
  usedCityNames.push(name);
  const c = {
    id: state.nextCityId++,
    x, y, name, kingdomId,
    pop: randInt(5, 10),
    level: 1,
    houses: 1,
    temple: false,
  };
  state.cities.push(c);
  if (state.kingdoms[kingdomId]) state.kingdoms[kingdomId].cities++;
  claimTiles(c);
  return c;
}

function claimTiles(c) {
  const k = state.kingdoms[c.kingdomId];
  if (!k) return;
  const rad = 3 + c.level + Math.floor(c.pop / 14);
  for (let y = c.y - rad; y <= c.y + rad; y++) {
    for (let x = c.x - rad; x <= c.x + rad; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (dist2(x, y, c.x, c.y) > rad * rad) continue;
      const i = y * W + x;
      const t = state.terrain[i];
      if (t === T_DEEP || t === T_WATER || t === T_LAVA) continue;
      const cur = state.owner[i];
      if (cur === -1) { state.owner[i] = c.kingdomId; state.territoryDirty = true; }
      else if (cur !== c.kingdomId && laws.diplomacy) {
        // Fiendeland erövras långsamt i krig; grannar tar bara små bitar i fred
        const atWar = k.warWith.has(cur);
        const chance = atWar ? 0.3 : 0.03;
        if (Math.random() < chance) {
          state.owner[i] = c.kingdomId;
          state.territoryDirty = true;
          if (!atWar) checkCityCapture(x, y, c.kingdomId);
        }
      }
    }
  }
}

function startWar(k1, k2, reason) {
  if (!k1 || !k2 || k1 === k2) return;
  if (!laws.diplomacy) return;
  if (k1.warWith.has(k2.id)) return;
  k1.warWith.add(k2.id);
  k2.warWith.add(k1.id);
  addEvent(`⚔️ Krig utropas: ${k1.name} anfaller ${k2.name}! ${reason || ''}`.trim(), randInt(0, W), randInt(0, H));
}

function endWar(k1, k2, reason) {
  if (!k1 || !k2) return;
  k1.warWith.delete(k2.id);
  k2.warWith.delete(k1.id);
  addEvent(`🕊️ Fred sluts mellan ${k1.name} och ${k2.name}. ${reason || ''}`.trim(), randInt(0, W), randInt(0, H));
}

function warsCount() {
  let n = 0;
  for (const k of state.kingdoms) if (k) for (const id of k.warWith) if (k.id < id) n++;
  return n;
}

// ============================================================
// RUMSLIG HASH (snabb grannsöking)
// ============================================================
const MAX_UNITS = 6000;
const CELL = 8, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
let grid = [];
function rebuildGrid() {
  if (grid.length !== GW * GH) grid = new Array(GW * GH);
  for (let i = 0; i < grid.length; i++) grid[i] = null;
  for (const u of state.units) {
    if (u.dead) continue;
    const gi = (Math.floor(u.y / CELL) * GW) + Math.floor(u.x / CELL);
    if (!grid[gi]) grid[gi] = [];
    grid[gi].push(u);
  }
}
function nearbyUnits(x, y, rad) {
  const out = [];
  const x0 = clamp(Math.floor((x - rad) / CELL), 0, GW - 1);
  const x1 = clamp(Math.floor((x + rad) / CELL), 0, GW - 1);
  const y0 = clamp(Math.floor((y - rad) / CELL), 0, GH - 1);
  const y1 = clamp(Math.floor((y + rad) / CELL), 0, GH - 1);
  const r2 = rad * rad;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const cell = grid[gy * GW + gx];
      if (!cell) continue;
      for (const u of cell) {
        if (u.dead) continue;
        if (dist2(u.x, u.y, x, y) <= r2) out.push(u);
      }
    }
  }
  return out;
}

function isEnemy(a, b) {
  if (a === b || a.kingdomId == null || b.kingdomId == null || a.kingdomId === b.kingdomId) {
    // Utanför rike: endast monster är fiender
    if (a.race === 'monster' || b.race === 'monster') return a.race !== b.race;
    return false;
  }
  // Medlemmar av olika riken
  const k = state.kingdoms[a.kingdomId];
  if (k && k.warWith.has(b.kingdomId)) return true;
  // Monster utan rike (eller med) angriper allt som inte är monster
  if (a.race === 'monster' || b.race === 'monster') return a.race !== b.race;
  return false;
}

// ============================================================
// HÄNDELSER (Världskrönikan)
// ============================================================
function addEvent(text, x, z) {
  state.events.unshift({ year: state.year, text, x: x ?? W / 2, z: z ?? H / 2 });
  if (state.events.length > 70) state.events.pop();
  chronicleDirty = true;
}
let chronicleDirty = true;

// ============================================================
// GUDAKRAFT-UTFÖRANDE
// ============================================================
function spend(cost) {
  if ($('#chkInfiniteFaith').checked) return true;
  if (state.faith >= cost) { state.faith -= cost; updateFaithUI(); return true; }
  flashFaithDenied();
  return false;
}

let faithFlashT = null;
function flashFaithDenied() {
  const el = $('#statFaith');
  el.style.color = '#f87171';
  clearTimeout(faithFlashT);
  faithFlashT = setTimeout(() => { el.style.color = ''; }, 700);
}

function applyPower(wx, wy, powerId) {
  const r = state.brushSize / 2;
  const p = findPower(powerId);
  if (!p) return;
  if (!spend(p.cost)) return;

  switch (powerId) {
    // --- Terraform ---
    case 'raise': paintTiles(wx, wy, r, (i) => {
      state.height[i] = clamp(state.height[i] + 0.04, 0, 1);
      state.terrain[i] = terrainFromHeight(state.height[i], state.moisture[i], SEA, 'continents');
      if (state.owner[i] >= 0 && state.terrain[i] <= T_WATER) state.owner[i] = -1;
    }); state.terrainDirty = true; state.territoryDirty = true; break;

    case 'lower': paintTiles(wx, wy, r, (i) => {
      state.height[i] = clamp(state.height[i] - 0.05, 0, 1);
      state.terrain[i] = terrainFromHeight(state.height[i], state.moisture[i], SEA, 'continents');
      state.owner[i] = -1;
    }); state.terrainDirty = true; state.territoryDirty = true; break;

    case 'sand': paintTerrain(wx, wy, r, T_SAND, 0.06); break;
    case 'grass': paintTerrain(wx, wy, r, T_GRASS, 0.08); break;
    case 'forest': paintTerrain(wx, wy, r, T_FOREST, 0.08); break;
    case 'mount': paintTerrain(wx, wy, r, T_MOUNT, 0.12); break;
    case 'snow': paintTerrain(wx, wy, r, T_SNOW, 0.1); break;
    case 'lava': paintTiles(wx, wy, r, (i) => {
      state.terrain[i] = T_LAVA;
      state.owner[i] = -1;
    }); state.terrainDirty = true; state.territoryDirty = true;
      for (const u of nearbyUnits(wx, wy, r)) {
        if (state.terrain[u.y * W + u.x] === T_LAVA) { u.hp -= 6; if (u.hp <= 0) killUnit(u, 'smälte i lava'); }
      }
      burst(wx, wy, '#ff6a00', 10); break;

    // --- Liv ---
    case 'human': case 'elf': case 'dwarf': case 'orc': {
      const pos = findLandNear(wx, wy, r);
      if (pos) { spawnCluster(powerId, 7, pos.x, pos.y); burst(pos.x, pos.y, RACES[powerId].color, 14); }
      break;
    }
    case 'animal': {
      const pos = findLandNear(wx, wy, r);
      if (pos) { spawnCluster('animal', 6, pos.x, pos.y); burst(pos.x, pos.y, RACES.animal.color, 10); }
      break;
    }
    case 'monster': {
      const pos = findLandNear(wx, wy, r);
      if (pos) { spawnUnit('monster', pos.x, pos.y); burst(pos.x, pos.y, '#d56aff', 20);
        addEvent(`🐉 Ett monster har dykt upp nära ${pos.x},${pos.y} och skrämer allt omkring sig!`, pos.x, pos.y); }
      break;
    }

    // --- Mirakel ---
    case 'rain': {
      const R = Math.max(4, r);
      paintTiles(wx, wy, R, (i) => {
        if (state.terrain[i] === T_SAND) { state.terrain[i] = T_GRASS; state.moisture[i] = Math.min(1, state.moisture[i] + 0.3); }
        else if (state.terrain[i] === T_HILL && Math.random() < 0.3) state.terrain[i] = T_GRASS;
        else if (state.terrain[i] === T_LAVA && Math.random() < 0.5) state.terrain[i] = T_MOUNT;
      });
      state.terrainDirty = true;
      burst(wx, wy, '#38bdf8', 26);
      addEvent('💧 Gudens regn faller – ökenlandskap blommar upp.', wx, wy);
      break;
    }
    case 'heal': {
      const R = Math.max(3, r);
      for (const u of nearbyUnits(wx, wy, R)) { u.hp = u.maxHp; u.plague = 0; u.frozen = 0; }
      burst(wx, wy, '#a7f3d0', 26);
      break;
    }
    case 'gift': {
      const R = Math.max(5, r);
      let boosted = false;
      for (const c of state.cities) {
        if (dist2(c.x, c.y, wx, wy) <= R * R) {
          c.pop += 6; c.houses += 1; state.totalBuildings++;
          boosted = true;
          addEvent(`🎁 Himmelns gåva regnar över ${c.name} – staden blomstrar!`, c.x, c.y);
        }
      }
      if (!boosted) for (const u of nearbyUnits(wx, wy, R)) u.hp = u.maxHp;
      burst(wx, wy, '#fbbf24', 30);
      break;
    }
    case 'peace': {
      let any = false;
      for (const k of state.kingdoms) {
        if (!k) continue;
        for (const id of Array.from(k.warWith)) {
          const k2 = state.kingdoms[id];
          if (k2 && k.id < k2.id) endWar(k, k2, 'Gudens vilja.');
          any = true;
        }
      }
      if (!any) addEvent('🕊️ Världen är redan i fred. Guden sträcker ut sin hand ändå.', wx, wy);
      burst(wx, wy, '#fde68a', 40);
      break;
    }
    case 'wisdom': {
      state.totalBuildings += 3;
      burst(wx, wy, '#a78bfa', 30);
      addEvent('📚 En stor idé slår ner bland folket – kunskapen sprider sig som eld!', wx, wy);
      checkEra();
      break;
    }
    case 'fertile': {
      const R = Math.max(3, r);
      paintTiles(wx, wy, R, (i) => {
        if (state.terrain[i] === T_GRASS) state.terrain[i] = T_FOREST;
        else if (state.terrain[i] === T_SAND && Math.random() < 0.4) state.terrain[i] = T_GRASS;
      });
      state.terrainDirty = true;
      burst(wx, wy, '#84cc16', 22);
      break;
    }

    // --- Katastrofer ---
    case 'meteor': {
      const R = Math.max(5, r * 1.4);
      paintTiles(wx, wy, R, (i, dx, dy, d) => {
        const fall = 1 - d / R;
        state.height[i] = clamp(state.height[i] - 0.3 * fall, 0, 1);
        if (d < R * 0.35) state.terrain[i] = T_LAVA;
        else state.terrain[i] = terrainFromHeight(state.height[i], state.moisture[i], SEA, 'continents');
        if (d < R * 0.8) state.owner[i] = -1;
      });
      for (const u of nearbyUnits(wx, wy, R + 2)) {
        const d = Math.sqrt(dist2(u.x, u.y, wx, wy));
        if (Math.random() < (1 - d / (R + 2)) * 0.95) killUnit(u, 'träffad av meteoren');
      }
      state.terrainDirty = true; state.territoryDirty = true;
      burst(wx, wy, '#ff9f43', 60, 3.5);
      state.particles.push({ ring: true, x: wx + 0.5, y: wy + 0.5, r0: 1, r1: R * 1.8, life: 1, maxLife: 1, color: '#fdba74' });
      addEvent('☄️ EN METEOR SLÅR NER! En glödande krater lämnas där städer en gång stod.', wx, wy);
      break;
    }
    case 'volcano': {
      const R = Math.max(3, r * 0.9);
      paintTiles(wx, wy, R, (i, dx, dy, d) => {
        state.height[i] = clamp(state.height[i] + 0.15, 0, 1);
        state.terrain[i] = d < R * 0.4 ? T_LAVA : T_MOUNT;
        if (d < R * 0.7) state.owner[i] = -1;
      });
      for (const u of nearbyUnits(wx, wy, R + 1)) {
        if (Math.random() < 0.7) killUnit(u, 'stekt av vulkanutbrott');
      }
      state.terrainDirty = true; state.territoryDirty = true;
      burst(wx, wy, '#ff4d1c', 50, 3);
      state.particles.push({ ring: true, x: wx + 0.5, y: wy + 0.5, r0: 1, r1: R * 1.7, life: 1, maxLife: 1, color: '#fca5a5' });
      addEvent('🌋 ETT VULKANUTBROTT skakar jorden! Lava strömmar över landet.', wx, wy);
      break;
    }
    case 'lightning': {
      const R = Math.max(2, r * 0.8);
      const targets = nearbyUnits(wx, wy, R);
      let killed = 0;
      for (const u of targets) {
        if (Math.random() < 0.55) { killUnit(u, 'blixtnedslag'); killed++; }
      }
      paintTiles(wx, wy, R, (i) => { if (state.terrain[i] === T_FOREST && Math.random() < 0.4) state.terrain[i] = T_GRASS; });
      state.terrainDirty = true;
      burst(wx, wy, '#fef08a', 34, 4);
      if (killed > 0) addEvent(`⚡ Blixten slår ner och dödar ${killed} varelser.`, wx, wy);
      break;
    }
    case 'plague': {
      const R = Math.max(3, r);
      let n = 0;
      for (const u of nearbyUnits(wx, wy, R)) { u.plague = 8; n++; }
      burst(wx, wy, '#86efac', 24);
      if (n > 0) addEvent(`🦠 Pesten sprider sig till ${n} varelser!`, wx, wy);
      break;
    }
    case 'frost': {
      const R = Math.max(3, r);
      paintTiles(wx, wy, R, (i) => {
        const t = state.terrain[i];
        if (t === T_GRASS || t === T_FOREST || t === T_SAND) state.terrain[i] = T_SNOW;
        else if (t === T_WATER) state.height[i] = clamp(state.height[i] + 0.02, 0, 1);
      });
      for (const u of nearbyUnits(wx, wy, R)) u.frozen = 6;
      state.terrainDirty = true;
      burst(wx, wy, '#e0f2fe', 30);
      addEvent('🥶 Istiden slår till! Allt i området fryser.', wx, wy);
      break;
    }
    case 'quake': {
      const R = Math.max(6, r * 1.6);
      const ang = rand(0, Math.PI * 2);
      for (let t = -R; t <= R; t++) {
        const px = Math.round(wx + Math.cos(ang) * t);
        const py = Math.round(wy + Math.sin(ang) * t);
        for (let w2 = -1; w2 <= 1; w2++) {
          const x2 = px + Math.round(Math.cos(ang + Math.PI / 2) * w2);
          const y2 = py + Math.round(Math.sin(ang + Math.PI / 2) * w2);
          if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) continue;
          const i = y2 * W + x2;
          if (Math.abs(t) <= R) {
            state.height[i] = clamp(state.height[i] - 0.1, 0, 1);
            state.terrain[i] = terrainFromHeight(state.height[i], state.moisture[i], SEA, 'continents');
          }
        }
      }
      for (const u of nearbyUnits(wx, wy, R)) if (Math.random() < 0.3) killUnit(u, 'jordskälv');
      state.terrainDirty = true; state.territoryDirty = true;
      burst(wx, wy, '#d6d3d1', 40, 3);
      addEvent('🌍 Ett jordskälv sliter sönder landet i en lång spricka.', wx, wy);
      break;
    }

    // --- FUSION ---
    case 'fusion': {
      const R = Math.max(5, r * 1.4);
      const fusedUnits = fuseUnitsNear(wx, wy, R);
      const fusedCities = fuseCitiesNear(wx, wy, R);
      if (fusedUnits > 0 || fusedCities > 0) {
        burst(wx, wy, '#67e8f9', 44, 3.2);
        burst(wx, wy, '#c084fc', 30, 2.4);
        state.particles.push({ ring: true, x: wx + 0.5, y: wy + 0.5, r0: 1, r1: R * 1.6, life: 1, maxLife: 1, color: '#a5f3fc' });
        if (fusedUnits > 0) addEvent(`🧬 ${fusedUnits} varelser har FUSERATS till starkare hybrider!`, wx, wy);
      } else {
        burst(wx, wy, '#67e8f9', 12, 1.5);
      }
      break;
    }
  }
}

// ---------- Fusionshjälpare ----------
function mixColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

function fuseTwoUnits(a, b) {
  const sameRace = a.race === b.race;
  const spawnRace = sameRace ? a.race : 'hybrid';
  const kid = spawnUnit(spawnRace, a.x, a.y, a.kingdomId != null ? a.kingdomId : b.kingdomId);
  if (!kid) return false;
  kid.maxHp = Math.max(a.maxHp, b.maxHp) + (sameRace ? 6 : 4);
  kid.hp = kid.maxHp;
  kid.traits = [...new Set([...a.traits, ...b.traits])].slice(0, 4);
  kid.kills = a.kills + b.kills;
  kid.age = Math.max(a.age, b.age);
  kid.bornYear = Math.min(a.bornYear, b.bornYear);
  if (sameRace) {
    kid.tint = mixColor(RACES[a.race].color, '#fde68a', 0.45);
    kid.name = choice(FIRST_NAMES) + ' den Sammanslagna';
    kid.fusionLabel = `Två ${RACES[a.race].name}släktingar smält samman`;
  } else {
    kid.tint = mixColor(RACES[a.race].color, RACES[b.race].color, 0.5);
    kid.name = choice(FIRST_NAMES) + ' ' + choice(EPITHETS);
    kid.fusionLabel = `${RACES[a.race].icon}${RACES[a.race].name} + ${RACES[b.race].icon}${RACES[b.race].name}`;
    kid.fromRaces = [a.race, b.race];
  }
  // Kungatronen: ärves av avkomman om föräldern var kung
  const wasKing = a.isKing || b.isKing;
  a.dead = true; b.dead = true; // markeras utan successionsbråk
  if (wasKing && kid.kingdomId != null) {
    const k = state.kingdoms[kid.kingdomId];
    if (k && (k.kingId === a.id || k.kingId === b.id || k.kingId === -1)) {
      kid.isKing = true;
      k.kingId = kid.id;
      k.kingName = kid.name;
    }
  }
  return true;
}

function fuseUnitsNear(wx, wy, rad) {
  const us = nearbyUnits(wx, wy, rad).filter(u => u.race !== 'monster');
  if (us.length < 2) return 0;
  const used = new Set();
  let count = 0;

  // Fas 1: blanda raser (riktig fusion -> hybrider)
  for (let i = 0; i < us.length; i++) {
    const A = us[i];
    if (used.has(A.id)) continue;
    for (let j = i + 1; j < us.length; j++) {
      const B = us[j];
      if (used.has(B.id) || A.race === B.race) continue;
      if (fuseTwoUnits(A, B)) { used.add(A.id); used.add(B.id); count++; }
      break;
    }
  }
  // Fas 2: homogena par -> sammanslagna mästare
  for (let i = 0; i < us.length; i++) {
    const A = us[i];
    if (used.has(A.id)) continue;
    for (let j = i + 1; j < us.length; j++) {
      const B = us[j];
      if (used.has(B.id) || B.race !== A.race) continue;
      if (fuseTwoUnits(A, B)) { used.add(A.id); used.add(B.id); count++; }
      break;
    }
  }
  return count;
}

function fuseCitiesNear(wx, wy, rad) {
  const cs = state.cities.filter(c => dist2(c.x, c.y, wx, wy) <= rad * rad);
  if (cs.length < 2) return 0;
  cs.sort((a, b) => b.pop - a.pop);
  const main = cs[0];
  let merged = 0;
  for (let i = 1; i < cs.length; i++) {
    const c = cs[i];
    main.pop += c.pop;
    const addH = Math.min(c.houses, 14 - main.houses);
    if (addH > 0) { main.houses += addH; state.totalBuildings += addH; }
    if (c.temple) {
      if (main.temple) state.totalTemples--;
      else main.temple = true;
    }
    main.level = Math.min(8, Math.max(main.level, 1 + Math.floor((main.pop) / 25)));
    const kc = state.kingdoms[c.kingdomId];
    if (kc) kc.cities = Math.max(0, kc.cities - 1);
    state.cities = state.cities.filter(x => x.id !== c.id);
    addEvent(`🧬 FUSION: Staden ${c.name} har smält samman med ${main.name} – en megastad föds!`, main.x, main.y);
    merged++;
  }
  return merged;
}

function mergeKingdoms(big, small) {
  if (!big || !small || big === small) return false;
  for (const u of state.units) {
    if (u.kingdomId === small.id) {
      u.kingdomId = big.id;
      if (u.isKing) u.isKing = false;
    }
  }
  for (const c of state.cities) if (c.kingdomId === small.id) c.kingdomId = big.id;
  big.cities = state.cities.filter(c => c.kingdomId === big.id).length;
  // Krigsförpliktelser förs vidare
  for (const id of Array.from(small.warWith)) {
    if (id === big.id) continue;
    big.warWith.add(id);
    const other = state.kingdoms[id];
    if (other) { other.warWith.delete(small.id); other.warWith.add(big.id); }
  }
  state.kingdoms[small.id] = null;
  addEvent(`🧬 RIKSFUSION: ${small.name} har gått upp i ${big.name} genom sammanslagning!`,
    state.cities.find(c => c.kingdomId === big.id)?.x ?? W / 2,
    state.cities.find(c => c.kingdomId === big.id)?.y ?? H / 2);
  return true;
}

function findPower(id) {
  for (const tab of Object.values(POWER_TABS)) {
    const p = tab.find(x => x.id === id);
    if (p) return p;
  }
  return null;
}

function paintTiles(wx, wy, r, fn) {
  const r2 = r * r;
  const x0 = clamp(Math.floor(wx - r), 0, W - 1);
  const x1 = clamp(Math.ceil(wx + r), 0, W - 1);
  const y0 = clamp(Math.floor(wy - r), 0, H - 1);
  const y1 = clamp(Math.ceil(wy + r), 0, H - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - wx, dy = y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      fn(y * W + x, dx, dy, Math.sqrt(d2));
    }
  }
}

function paintTerrain(wx, wy, r, terrain, hDelta) {
  paintTiles(wx, wy, r, (i) => {
    state.terrain[i] = terrain;
    if (terrain === T_MOUNT || terrain === T_SNOW) state.height[i] = clamp(state.height[i] + hDelta, 0, 1);
    else if (terrain === T_SAND) state.height[i] = clamp(Math.max(state.height[i], SEA + 0.03), 0, 0.66);
    else state.height[i] = clamp(state.height[i], SEA + 0.03, 0.65);
    if (terrain === T_LAVA) state.owner[i] = -1;
  });
  state.terrainDirty = true;
  state.territoryDirty = true;
}

function findLandNear(wx, wy, r) {
  const t = state.terrain[clamp(Math.round(wy), 0, H - 1) * W + clamp(Math.round(wx), 0, W - 1)];
  if (t !== T_DEEP && t !== T_WATER && t !== T_LAVA) return { x: Math.round(wx), y: Math.round(wy) };
  for (let k = 0; k < 20; k++) {
    const x = clamp(Math.round(wx + rand(-r - 3, r + 3)), 0, W - 1);
    const y = clamp(Math.round(wy + rand(-r - 3, r + 3)), 0, H - 1);
    const tt = state.terrain[y * W + x];
    if (tt !== T_DEEP && tt !== T_WATER && tt !== T_LAVA) return { x, y };
  }
  return null;
}

function burst(wx, wy, color, n = 20, speed = 2) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(0.3, speed);
    state.particles.push({
      x: wx + 0.5, y: wy + 0.5,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.5, 1.4), maxLife: 1.4,
      color, size: rand(0.6, 2),
    });
  }
}

// ============================================================
// SIMULERINGSTICK
// ============================================================
const laws = { diplomacy: true, naturalDisasters: false, fastGrowth: true, monsters: true };

function simTick() {
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; onNewYear(); }

  rebuildGrid();

  // --- Enhetsuppdatering ---
  const units = state.units;
  for (let idx = units.length - 1; idx >= 0; idx--) {
    const u = units[idx];
    if (u.dead) { units.splice(idx, 1); continue; }
    updateUnit(u);
  }

  // --- Partiklar hanteras i renderloopen ---
  // Städer växer var 3:e månad för jämn temp
  if (state.month % 3 === 0) updateCities();

  if (state.territoryDirty) { /* renderas vid nästa frame */ }
}

function updateUnit(u) {
  // Aldrande
  u.months++;
  if (u.months >= 12) { u.months = 0; u.age++; }
  if (u.age > 70 && Math.random() < 0.05) { killUnit(u, 'ålderdom'); return; }

  // Pest
  if (u.plague > 0) {
    u.plague--;
    u.hp -= 1.5;
    if (u.hp <= 0) { killUnit(u, 'pest'); return; }
  }
  if (u.frozen > 0) { u.frozen--; return; } // frusna rör sig inte

  const ti = u.y * W + u.x;
  if (state.terrain[ti] === T_LAVA) {
    u.hp -= 4;
    if (u.hp <= 0) { killUnit(u, 'smälte i lava'); return; }
  }

  // Strid – sök fiender i närheten
  const foes = nearbyUnits(u.x, u.y, u.race === 'monster' ? 3 : 2);
  let target = null;
  for (const f of foes) {
    if (f === u || f.dead) continue;
    if (isEnemy(u, f)) { target = f; break; }
  }
  if (target) {
    const bonus = u.traits.includes('Modig') || u.traits.includes('Hetsig') ? 1.5 : 1;
    const monsterDmg = u.race === 'monster' ? 2.5 : 1;
    target.hp -= bonus * monsterDmg;
    if (target.hp <= 0) {
      u.kills++;
      killUnit(target, `dödade av ${u.name}`);
    }
    return; // strid tar upp denna månad
  }

  // Monster jagar sitt byte
  if (u.race === 'monster') {
    if (u.repathIn <= 0) {
      const prey = nearestPrey(u, 14);
      if (prey) { u.targetX = prey.x; u.targetY = prey.y; }
      else { u.targetX = clamp(u.x + randInt(-6, 6), 0, W - 1); u.targetY = clamp(u.y + randInt(-6, 6), 0, H - 1); }
      u.repathIn = randInt(2, 5);
    }
    moveToward(u, true);
    u.repathIn--;
    return;
  }

  // Krigande civilisationer marscherar mot fiendestäder
  if (u.kingdomId != null && u.kingdomId >= 0 && state.kingdoms[u.kingdomId]) {
    const k = state.kingdoms[u.kingdomId];
    if (k.warWith.size > 0 && Math.random() < 0.5 && u.repathIn <= 0) {
      const ec = nearestEnemyCity(u, k, 30);
      if (ec) { u.targetX = ec.x + randInt(-2, 2); u.targetY = ec.y + randInt(-2, 2); u.repathIn = 8; }
      else { u.repathIn = 3; }
    }
    // Frontlinje: erövra fientlig mark under fötterna
    const own = state.owner[ti];
    if (own >= 0 && own !== u.kingdomId && k.warWith.has(own) && Math.random() < 0.3) {
      state.owner[ti] = u.kingdomId;
      state.territoryDirty = true;
      checkCityCapture(u.x, u.y, u.kingdomId);
    }
  }

  // Vildfärd eller sök efter flock (grundande)
  if (u.repathIn <= 0) {
    if (RACES[u.race].civ && u.kingdomId == null) {
      // Sök samma ras i närheten -> grundandeförsök
      const kin = nearbyUnits(u.x, u.y, 5).filter(o => o.race === u.race && o.kingdomId == null);
      if (kin.length >= 6 && Math.random() < 0.35) {
        const t = state.terrain[ti];
        if (t !== T_DEEP && t !== T_WATER && t !== T_LAVA && !nearCity(u.x, u.y, 7)) {
          if (foundKingdom(u)) { u.repathIn = 10; return; }
        }
      }
      // Gå mot större grupp av samma ras
      if (kin.length >= 3) {
        const cx = kin.reduce((s, o) => s + o.x, 0) / kin.length;
        const cy = kin.reduce((s, o) => s + o.y, 0) / kin.length;
        u.targetX = Math.round(cx + randInt(-2, 2));
        u.targetY = Math.round(cy + randInt(-2, 2));
      } else {
        u.targetX = clamp(u.x + randInt(-8, 8), 0, W - 1);
        u.targetY = clamp(u.y + randInt(-8, 8), 0, H - 1);
      }
      u.repathIn = randInt(3, 8);
    } else if (u.kingdomId != null && u.kingdomId >= 0 && state.kingdoms[u.kingdomId]) {
      // Håll sig i närheten av hemmet, eller dra till oskyddad mark
      const home = state.cities.find(c => c.kingdomId === u.kingdomId);
      if (home && Math.random() < 0.7) {
        u.targetX = clamp(home.x + randInt(-8, 8), 0, W - 1);
        u.targetY = clamp(home.y + randInt(-8, 8), 0, H - 1);
      } else {
        u.targetX = clamp(u.x + randInt(-6, 6), 0, W - 1);
        u.targetY = clamp(u.y + randInt(-6, 6), 0, H - 1);
      }
      u.repathIn = randInt(3, 9);
    } else {
      u.targetX = clamp(u.x + randInt(-5, 5), 0, W - 1);
      u.targetY = clamp(u.y + randInt(-5, 5), 0, H - 1);
      u.repathIn = randInt(2, 7);
    }
  }
  u.repathIn--;

  moveToward(u, false);

  // Djur förökar sig
  if (u.race === 'animal' && Math.random() < 0.015) {
    const animals = state.units.filter(x => x.race === 'animal').length;
    if (animals < 380) {
      const t = state.terrain[ti];
      if (t === T_GRASS || t === T_FOREST) spawnUnit('animal', u.x + randInt(-1, 1), u.y + randInt(-1, 1));
    }
  }
}

function nearestPrey(u, rad) {
  let best = null, bd = rad * rad;
  for (const o of nearbyUnits(u.x, u.y, rad)) {
    if (o.race === 'monster') continue;
    const d = dist2(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function nearestEnemyCity(u, k, rad) {
  let best = null, bd = rad * rad;
  for (const c of state.cities) {
    if (!k.warWith.has(c.kingdomId)) continue;
    const d = dist2(u.x, u.y, c.x, c.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function nearCity(x, y, rad) {
  const r2 = rad * rad;
  for (const c of state.cities) if (dist2(x, y, c.x, c.y) <= r2) return true;
  return false;
}

function moveToward(u, canFly) {
  const dx = u.targetX - u.x, dy = u.targetY - u.y;
  if (dx === 0 && dy === 0) return;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  // Rör sig diagonalt/stegvis
  const tryMove = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    const t = state.terrain[ny * W + nx];
    if (!canFly && (t === T_DEEP || t === T_WATER)) return false;
    if (t === T_LAVA && !canFly) return false;
    u.x = nx; u.y = ny;
    return true;
  };
  if (Math.random() < 0.5) {
    if (!tryMove(u.x + stepX, u.y)) tryMove(u.x, u.y + stepY);
  } else {
    if (!tryMove(u.x, u.y + stepY)) tryMove(u.x + stepX, u.y);
  }
}

function checkCityCapture(x, y, newOwner) {
  for (const c of state.cities) {
    if (c.x === x && c.y === y && c.kingdomId !== newOwner) {
      const oldK = state.kingdoms[c.kingdomId];
      const newK = state.kingdoms[newOwner];
      if (!newK || !oldK) return;
      if (!oldK.warWith.has(newOwner)) return;
      c.kingdomId = newOwner;
      if (oldK) oldK.cities = Math.max(0, oldK.cities - 1);
      newK.cities++;
      addEvent(`⚔️ ${c.name} erövras av ${newK.name} från ${oldK.name}!`, c.x, c.y);
      if (oldK.cities <= 0 && !state.kingdoms.some(k => k && k.cities > 0 && k.id === oldK.id)) {
        dissolveKingdom(oldK, 'förlorade sitt sista hållplats');
      }
      return;
    }
  }
}

function dissolveKingdom(k, reason) {
  for (const u of state.units) if (u.kingdomId === k.id) { u.kingdomId = null; u.isKing = false; }
  for (const c of state.cities) if (c.kingdomId === k.id) { /* staden blir ruin */ }
  state.cities = state.cities.filter(c => c.kingdomId !== k.id);
  for (const k2 of state.kingdoms) if (k2 && k2 !== k) k2.warWith.delete(k.id);
  state.kingdoms[k.id] = null;
  addEvent(`💀 ${k.name} har fallit – ${reason}.`, randInt(0, W), randInt(0, H));
}

function updateCities() {
  const fast = laws.fastGrowth ? 3.0 : 1.4;
  for (const c of state.cities) {
    const k = state.kingdoms[c.kingdomId];
    if (!k) continue;
    // Fertilitet
    let fert = 0;
    for (let y = c.y - 3; y <= c.y + 3; y++) {
      for (let x = c.x - 3; x <= c.x + 3; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = state.terrain[y * W + x];
        if (t === T_GRASS) fert += 1;
        else if (t === T_FOREST) fert += 1.5;
        else if (t === T_SAND || t === T_DEEP || t === T_WATER) fert -= 0.5;
      }
    }
    fert = Math.max(0, fert);
    const growth = (1.1 + fert * 0.08) * fast * rand(0.5, 1.3);
    c.pop = Math.max(1, c.pop + growth);

    // Nya hus
    const wantHouses = 1 + Math.floor(c.pop / 12);
    if (c.houses < wantHouses && c.houses < 12) {
      c.houses++; state.totalBuildings++;
    }
    // Tempel
    if (!c.temple && c.level >= 2 && Math.random() < 0.06) {
      c.temple = true;
      state.totalTemples++;
      addEvent(`⛪ Staden ${c.name} reser sitt första tempel och ber till guden!`, c.x, c.y);
    }
    // Nivå
    if (c.pop > 25 * c.level && c.level < 6) {
      c.level++;
      if (c.level === 3) addEvent(`🏙️ ${c.name} växer till en blommande stad (nivå ${c.level}).`, c.x, c.y);
    }
    // Försvarare föds
    const kUnits = state.units.filter(u => u.kingdomId === k.id).length;
    if (kUnits < c.pop * 0.6 && state.units.length < MAX_UNITS && Math.random() < 0.5) {
      spawnUnit(k.race, c.x + randInt(-2, 2), c.y + randInt(-2, 2), k.id);
    }
    claimTiles(c);

    // Koloni: blommande stader sänder ut bosättare och grundar nya städer
    const canColony = k.cities < 14 && (laws.fastGrowth ? c.pop > 35 : c.pop > 55);
    if (canColony && Math.random() < 0.09) {
        for (let tries = 0; tries < 12; tries++) {
          const ang = rand(0, Math.PI * 2), dd = randInt(10, 28);
          const nx = clamp(Math.round(c.x + Math.cos(ang) * dd), 2, W - 3);
          const ny = clamp(Math.round(c.y + Math.sin(ang) * dd), 2, H - 3);
          const t = state.terrain[ny * W + nx];
          if (t === T_DEEP || t === T_WATER || t === T_LAVA) continue;
          if (nearCity(nx, ny, 9)) continue;
          const nc = createCity(nx, ny, k.id);
          spawnUnit(k.race, nx, ny, k.id);
          spawnUnit(k.race, nx + randInt(-1, 1), ny + randInt(-1, 1), k.id);
          addEvent(`⛵ Kolonister från ${k.name} landstiger och grundar staden ${nc.name}!`, nx, ny);
          break;
        }
    }
  }

  // Krigschans mellan grannar
  if (laws.diplomacy) {
    for (let i = 0; i < state.cities.length; i++) {
      const a = state.cities[i];
      for (let j = i + 1; j < state.cities.length; j++) {
        const b = state.cities[j];
        if (a.kingdomId === b.kingdomId) continue;
        const kA = state.kingdoms[a.kingdomId], kB = state.kingdoms[b.kingdomId];
        if (!kA || !kB || kA.warWith.has(kB.id)) continue;
        if (dist2(a.x, a.y, b.x, b.y) < 40 * 40 && Math.random() < 0.03) {
          startWar(kA, kB, 'Gränskonflikten vid ' + a.name + ' spänner till.');
        }
      }
    }
    // Slumpmässiga fredsförhandlingar
    for (const k of state.kingdoms) {
      if (k && k.warWith.size > 0 && Math.random() < 0.04) {
        const id = Array.from(k.warWith)[0];
        const k2 = state.kingdoms[id];
        if (k2) endWar(k, k2, 'Trötthet efter långt krig.');
      }
    }
  }
}

function onNewYear() {
  // Tro genereras
  const pop = state.units.length;
  state.faith += state.totalTemples * 2 + pop * 0.04;

  // Byggnader bjuder in till erövring/befolkning
  if (state.totalBuildings > 0) checkEra();

  // Slumpmässiga världshändelser
  if (laws.naturalDisasters && Math.random() < 0.07) {
    const p = findLandPos();
    if (p && Math.random() < 0.5) {
      applyDisasterAt('meteor', p.x, p.y);
    } else {
      applyDisasterAt('volcano', randInt(20, W - 20), randInt(15, H - 15));
    }
  }
  if (laws.monsters && Math.random() < 0.05) {
    const p = findLandPos();
    if (p) {
      spawnCluster('monster', randInt(1, 3), p.x, p.y);
      addEvent(`🐉 Monster har vaknat i vildmarken nära ${p.x},${p.y}.`, p.x, p.y);
    }
  }

  // Hjälte föds i ett rike med tempel
  if (Math.random() < 0.08 && state.kingdoms.some(k => k)) {
    const c = choice(state.cities.filter(c2 => c2.temple) || []);
    if (c) {
      const h = spawnUnit(state.kingdoms[c.kingdomId]?.race || 'human', c.x, c.y, c.kingdomId);
      if (h) {
        h.age = randInt(20, 35);
        h.maxHp = 16; h.hp = 16;
        h.traits = ['Modig', 'Vis'];
        h.name = choice(FIRST_NAMES) + ' ' + 'Ljusbringaren';
        addEvent(`🌟 Hjälten ${h.name} föds i ${c.name} och sägs gå i gudens fotspår.`, c.x, c.y);
      }
    }
  }

  // Fredlig riksfusion: mycket större rike sväljer en svagare granne
  if (Math.random() < 0.14) {
    const ks = state.kingdoms.filter(Boolean);
    if (ks.length >= 2) {
      const big = choice(ks);
      const candidates = ks.filter(k2 => k2 !== big && !big.warWith.has(k2.id));
      if (candidates.length > 0) {
        const small = choice(candidates);
        const popBig = state.units.filter(u => u.kingdomId === big.id).length;
        const popSmall = state.units.filter(u => u.kingdomId === small.id).length;
        if (popBig > popSmall * 3 && Math.random() < 0.5) {
          mergeKingdoms(big, small);
        }
      }
    }
  }

  updateFaithUI();
}

function applyDisasterAt(id, x, y) {
  const oldBrush = state.brushSize;
  state.brushSize = 8;
  const oldChk = $('#chkInfiniteFaith').checked;
  $('#chkInfiniteFaith').checked = true;
  applyPower(x, y, id);
  $('#chkInfiniteFaith').checked = oldChk;
  state.brushSize = oldBrush;
}

function checkEra() {
  const dev = state.totalBuildings + state.totalTemples * 3 + state.cities.length * 4;
  let idx = 0;
  for (let i = 0; i < ERAS.length; i++) if (dev >= ERAS[i].t) idx = i;
  if (idx > state.eraIdx) {
    state.eraIdx = idx;
    addEvent(`⏳ TIDSALDER: ${ERAS[idx].n} har inletts!`, W / 2, H / 2);
    updateEraLabel();
  }
}

// ============================================================
// RENDERING
// ============================================================
function screenToWorld(sx, sy) {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

function draw() {
  const dpr = DPR;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewportW, viewportH);
  ctx.fillStyle = '#040914';
  ctx.fillRect(0, 0, viewportW, viewportH);

  if (state.terrainDirty) renderTerrain();
  if (state.territoryDirty) renderTerritory();

  const z = cam.zoom;
  ctx.imageSmoothingEnabled = z < 1.5;

  // Terräng
  ctx.drawImage(terrainCv, -cam.x * z, -cam.y * z, W * z, H * z);

  // Territorier
  if ($('#chkBorders').checked) {
    ctx.globalAlpha = 0.9;
    ctx.drawImage(terrCv, -cam.x * z, -cam.y * z, W * z, H * z);
    ctx.globalAlpha = 1;
  }

  // Moln – mjuk sprayad sprite
  if ($('#chkWeather').checked && cloudSprite) {
    for (const c of state.clouds) {
      const sx = (c.x - cam.x) * z, sy = (c.y - cam.y) * z;
      if (sx < -140 || sy < -90 || sx > viewportW + 140 || sy > viewportH + 90) continue;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cloudSprite, sx - c.r * z, sy - c.r * 0.6 * z, c.r * 2 * z, c.r * 1.2 * z);
      ctx.globalAlpha = 1;
      c.x += c.s;
      if (c.x > W + 30) c.x = -30;
    }
  }

  // Säsongsstämning: varma sommarmånader, kalla vintermånader
  const m = state.month;
  if (m <= 2) {
    ctx.fillStyle = 'rgba(255, 186, 90, 0.05)';
    ctx.fillRect(0, 0, viewportW, viewportH);
  } else if (m >= 6 && m <= 8) {
    ctx.fillStyle = 'rgba(120, 175, 255, 0.06)';
    ctx.fillRect(0, 0, viewportW, viewportH);
  }

  // Synligt område
  const vx0 = cam.x - 2, vy0 = cam.y - 2;
  const vx1 = cam.x + viewportW / z + 2, vy1 = cam.y + viewportH / z + 2;

  // Städer
  const showNames = $('#chkNames').checked;
  for (const c of state.cities) {
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    const k = state.kingdoms[c.kingdomId];
    const sx = (c.x - cam.x + 0.5) * z, sy = (c.y - cam.y + 0.5) * z;
    const s = Math.max(3, (2.5 + c.level * 0.9) * z);
    // Hus
    ctx.fillStyle = k ? k.color : '#94a3b8';
    ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - s / 2, sy - s / 2, s, s);
    // Tempel
    if (c.temple) {
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(sx - 1, sy - s - 3, 2, 3);
      ctx.fillRect(sx - 2.5, sy - s - 1.5, 5, 1.5);
    }
    if (showNames && z > 0.55) {
      ctx.font = `${clamp(10 * Math.min(z, 1.4), 9, 13)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(c.name, sx + 1, sy + s + 12);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(c.name, sx, sy + s + 11);
      if (k && showNames && z > 0.85) {
        ctx.font = `bold ${clamp(11 * z, 10, 15)}px Inter, sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(k.name, sx + 1, sy - s - 6);
        ctx.fillStyle = k.color;
        ctx.fillText(k.name, sx, sy - s - 7);
      }
    }
  }

  // Enheter
  const wantShadows = z > 1.3 && state.units.length < 4500;
  for (const u of state.units) {
    if (u.dead) continue;
    if (u.x < vx0 || u.x > vx1 || u.y < vy0 || u.y > vy1) continue;
    const sx = (u.x - cam.x + 0.5) * z, sy = (u.y - cam.y + 0.5) * z;
    const r = clamp((u.race === 'monster' ? 2.4 : 1.6) * Math.sqrt(z), 1, 6);
    // Skugga under fötterna
    if (wantShadows) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(sx + r * 0.35, sy + r * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Kungar får en gyllene glöd
    if (u.isKing && z > 0.9) {
      ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = u.tint || RACES[u.race].color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (u.isKing) { ctx.shadowBlur = 0; }
    if (z > 1.4) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    // Hybrider glittrar svagt
    if (u.tint && z > 1.6) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(sx - r * 0.3, sy - r * 0.3, Math.max(0.6, r * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
    // Pestmarkering
    if (u.plague > 0 && z > 1) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(sx - r, sy - r - 2, r, 1);
    }
    // Kungakrona
    if (u.isKing && z > 0.9) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy - r - 1);
      ctx.lineTo(sx, sy - r - 5);
      ctx.lineTo(sx + 3, sy - r - 1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Partiklar – additiv blandning ger glöd
  ctx.globalCompositeOperation = 'lighter';
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= 0.03;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }
    const sx = (p.x - cam.x) * z, sy = (p.y - cam.y) * z;
    if (p.ring) {
      // Expanderande chockvåg
      const t = 1 - p.life / p.maxLife;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(0.5, 3 * (1 - t));
      ctx.beginPath();
      ctx.arc(sx, sy, (p.r0 + t * (p.r1 - p.r0)) * z, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    p.x += p.vx * 0.1; p.y += p.vy * 0.1;
    p.vx *= 0.96; p.vy *= 0.96;
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx, sy, p.size * z, p.size * z);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Vald enhet
  if (state.selected && state.selected.type === 'unit') {
    const u = getSelectedUnit();
    if (u && !u.dead) {
      const sx = (u.x - cam.x + 0.5) * z, sy = (u.y - cam.y + 0.5) * z;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 7 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Penselmarkering
  if (!mouse.panning && state.activePower) {
    const sx = (mouse.wx - cam.x) * z, sy = (mouse.wy - cam.y) * z;
    const r = (state.brushSize / 2) * z;
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(r, 3), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Vinjett – mjukt mörka hörn ger djup
  if (vignette) {
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, viewportW, viewportH);
  }

  drawMinimap();
}

function drawMinimap() {
  if (!miniCtx) return;
  const mw = 220, mh = 143;
  const s = Math.min(mw / W, mh / H);
  const ox = (mw - W * s) / 2, oy = (mh - H * s) / 2;
  miniCtx.clearRect(0, 0, mw, mh);
  miniCtx.fillStyle = '#061021';
  miniCtx.fillRect(0, 0, mw, mh);
  miniCtx.imageSmoothingEnabled = false;
  miniCtx.drawImage(terrainCv, ox, oy, W * s, H * s);
  // Städer
  for (const c of state.cities) {
    const k = state.kingdoms[c.kingdomId];
    miniCtx.fillStyle = k ? k.color : '#fff';
    miniCtx.fillRect(ox + c.x * s - 1, oy + c.y * s - 1, 3, 3);
  }
  // Vy-rektangel
  const x0 = ox + cam.x * s, y0 = oy + cam.y * s;
  const ww = (viewportW / cam.zoom) * s, hh = (viewportH / cam.zoom) * s;
  miniCtx.strokeStyle = 'rgba(255,255,255,0.9)';
  miniCtx.lineWidth = 1.5;
  miniCtx.strokeRect(x0, y0, ww, hh);
  miniCtx._off = { ox, oy, s };
}

// ============================================================
// UI
// ============================================================
function updateFaithUI() {
  const inf = $('#chkInfiniteFaith').checked;
  $('#statFaith').textContent = inf ? '∞ (Sandbox)' : Math.floor(state.faith) + ' Tro';
}

function updateEraLabel() {
  const sub = document.querySelector('.subtitle');
  sub.textContent = `Forma kontinenter, skapa riken, ta emot tillbedjan & släpp lös katastrofer · ${ERAS[state.eraIdx].n}`;
}

function renderPowerGrid() {
  const grid = $('#powerGrid');
  grid.innerHTML = '';
  const powers = POWER_TABS[state.activeTab];
  for (const p of powers) {
    const btn = document.createElement('button');
    btn.className = 'power-btn' + (state.activePower === p.id ? ' active' : '');
    btn.title = p.desc + (p.cost ? ` (Kostnad: ${p.cost} Tro)` : '');
    btn.innerHTML = `<span class="power-icon">${p.icon}</span><span class="power-name">${p.name}</span><span class="power-cost">${p.cost} 🙏</span>`;
    btn.addEventListener('click', () => {
      state.activePower = p.id;
      updateActivePowerBanner(p);
      renderPowerGrid();
      // Mobil: stäng verktygslådan så kartan syns
      if (typeof isMobileLayout === 'function' && isMobileLayout()) closeLeftDrawer();
    });
    grid.appendChild(btn);
  }
}

function updateActivePowerBanner(p) {
  if (!p) {
    $('#activePowerIcon').textContent = '🔍';
    $('#activePowerTitle').textContent = 'Inspektera & Välj';
    $('#activePowerDesc').textContent = 'Klicka på en varelse eller stad för att se detaljer.';
    return;
  }
  $('#activePowerIcon').textContent = p.icon;
  $('#activePowerTitle').textContent = p.name;
  $('#activePowerDesc').textContent = p.desc;
}

function renderKingdomList() {
  const list = $('#kingdomList');
  const ks = state.kingdoms.filter(Boolean);
  if (ks.length === 0) {
    list.innerHTML = '<p class="empty-hint">Placera Människor, Alver, Dvärgar eller Orcher på land för att grunda riken!</p>';
  } else {
    list.innerHTML = '';
    for (const k of ks) {
      const div = document.createElement('div');
      div.className = 'kingdom-card' + (state.selected && state.selected.type === 'kingdom' && state.selected.id === k.id ? ' selected' : '');
      const popN = state.units.filter(u => u.kingdomId === k.id).length;
      const wars = k.warWith.size;
      div.innerHTML = `
        <div class="kingdom-left">
          <div class="kingdom-banner" style="background:${k.color}"></div>
          <div>
            <div class="kingdom-title">${RACES[k.race].icon} ${k.name}</div>
            <div class="kingdom-sub">Kung: ${k.kingName} · Grundat år ${k.foundedYear}</div>
          </div>
        </div>
        <div class="kingdom-right">👥 ${popN}<br>🏰 ${k.cities}${wars ? '<br>⚔️ ' + wars : ''}</div>`;
      div.addEventListener('click', () => selectKingdom(k.id, true));
      list.appendChild(div);
    }
  }
  const wc = warsCount();
  $('#warsCountBadge').textContent = wc === 0 ? 'Fred i världen' : `⚔️ ${wc} aktiva krig`;
}

function renderChronicle() {
  const feed = $('#chronicleFeed');
  feed.innerHTML = '';
  for (const e of state.events) {
    const div = document.createElement('div');
    div.className = 'event-item';
    div.innerHTML = `<span class="event-year">År ${e.year}</span>${e.text}`;
    div.addEventListener('click', () => {
      centerCameraOn(e.x, e.z);
    });
    feed.appendChild(div);
  }
  chronicleDirty = false;
}

function centerCameraOn(wx, wy) {
  cam.x = wx - viewportW / (2 * cam.zoom);
  cam.y = wy - viewportH / (2 * cam.zoom);
  clampCam();
}

function clampCam() {
  const margin = 0.3;
  cam.x = clamp(cam.x, -W * margin, W * (1 + margin) - viewportW / cam.zoom);
  cam.y = clamp(cam.y, -H * margin, H * (1 + margin) - viewportH / cam.zoom);
}

function getSelectedUnit() {
  if (!state.selected || state.selected.type !== 'unit') return null;
  return state.units.find(u => u.id === state.selected.id && !u.dead) || null;
}

function selectUnit(id, center) {
  state.selected = { type: 'unit', id };
  const u = getSelectedUnit();
  if (u && center) centerCameraOn(u.x, u.y);
  renderInspector();
}

function selectKingdom(id, center) {
  state.selected = { type: 'kingdom', id };
  const k = state.kingdoms[id];
  if (k && center) {
    const c = state.cities.find(c2 => c2.kingdomId === id);
    if (c) centerCameraOn(c.x, c.y);
  }
  renderInspector();
  renderKingdomList();
}

function renderInspector() {
  const body = $('#inspectorBody');
  const title = $('#inspectorHeaderTitle');

  if (!state.selected) {
    title.textContent = '👁️ Gudomligt Öga';
    body.innerHTML = `
      <p class="empty-hint">Klicka på kartan med <b>Inspektera-verktyget</b> (standard) för att läsa en varelses tankar, eller klicka på ett rike i listan till vänster.</p>
      <p class="empty-hint">Tips: håll in <b>mellanslag</b> och dra för att panorera, scrolla för att zooma.</p>`;
    return;
  }

  if (state.selected.type === 'unit') {
    const u = getSelectedUnit();
    if (!u) {
      title.textContent = '👤 Varelse';
      body.innerHTML = '<p class="empty-hint">Den valda varelsen har dött... Gudens makt är kortfattad.</p>';
      return;
    }
    const k = u.kingdomId != null ? state.kingdoms[u.kingdomId] : null;
    title.textContent = '👤 Varelseinspektör';
    body.innerHTML = `
      <div class="ins-card-top">
        <div class="ins-avatar">${RACES[u.race].icon}</div>
        <div>
          <div class="ins-title">${u.name} ${u.isKing ? '👑' : ''}</div>
          <div class="ins-subtitle">${RACES[u.race].name}${u.isKing ? ' · Kung av ' + (k ? k.name : '?') : ''}</div>
          <div class="ins-meta">${k ? '🏳️ ' + k.name : '🏳️ Vild – inget rike'}</div>
        </div>
      </div>
      <div class="ins-stats-grid">
        <div class="ins-stat-box"><span>Ålder</span><b>${u.age} år</b></div>
        <div class="ins-stat-box"><span>Hälsa</span><b>${Math.max(0, Math.ceil(u.hp))}/${u.maxHp}</b></div>
        <div class="ins-stat-box"><span>Dråp</span><b>${u.kills}</b></div>
        <div class="ins-stat-box"><span>Född</span><b>År ${u.bornYear}</b></div>
        <div class="ins-stat-box"><span>Status</span><b>${u.plague > 0 ? '🦠 Sjuk' : u.frozen > 0 ? '🥶 Frusen' : 'Frisk'}</b></div>
        <div class="ins-stat-box"><span>Kordinater</span><b>${u.x},${u.y}</b></div>
      </div>
      <div class="ins-traits">${u.fusionLabel ? `<span class="trait-badge fusion-badge">${u.fusionLabel}</span>` : ''}${u.traits.map(t => `<span class="trait-badge">${t}</span>`).join('')}</div>
      <div class="ins-actions">
        <button class="btn-ins-act" id="actBlessUnit">⚡ Blesse</button>
        <button class="btn-ins-act" id="actSmitUnit">☄️ Smita</button>
        <button class="btn-ins-act" id="actHealPlague">💊 Kura</button>
      </div>`;
    $('#actBlessUnit').addEventListener('click', () => {
      if (!spend(20)) return;
      u.hp = u.maxHp = Math.min(30, u.maxHp + 4);
      u.age = Math.max(1, u.age - 3);
      burst(u.x, u.y, '#fde68a', 20);
      renderInspector();
    });
    $('#actSmitUnit').addEventListener('click', () => {
      killUnit(u, 'smitad av guden');
      burst(u.x, u.y, '#ef4444', 30, 3);
      state.selected = null;
      state.followSelected = false;
      $('#btnFollowUnit').classList.remove('active');
      renderInspector();
    });
    $('#actHealPlague').addEventListener('click', () => {
      if (!spend(10)) return;
      u.plague = 0; u.hp = u.maxHp; u.frozen = 0;
      burst(u.x, u.y, '#a7f3d0', 15);
      renderInspector();
    });
    return;
  }

  // Rike
  const k = state.kingdoms[state.selected.id];
  if (!k) {
    state.selected = null;
    renderInspector();
    return;
  }
  const popN = state.units.filter(u => u.kingdomId === k.id).length;
  const cities = state.cities.filter(c => c.kingdomId === k.id);
  const wars = Array.from(k.warWith).map(id => state.kingdoms[id]).filter(Boolean);
  title.textContent = '👑 Rikesinspektör';
  body.innerHTML = `
    <div class="ins-card-top">
      <div class="ins-avatar" style="border-color:${k.color}; background:${k.color}33">🏰</div>
      <div>
        <div class="ins-title">${k.name}</div>
        <div class="ins-subtitle">${RACES[k.race].name} · Grundat år ${k.foundedYear}</div>
        <div class="ins-meta">Kung: ${k.kingName}</div>
      </div>
    </div>
    <div class="ins-stats-grid">
      <div class="ins-stat-box"><span>Folk</span><b>${popN}</b></div>
      <div class="ins-stat-box"><span>Städer</span><b>${k.cities}</b></div>
      <div class="ins-stat-box"><span>Krig</span><b>${wars.length}</b></div>
    </div>
    <div class="ins-traits">
      ${cities.slice(0, 5).map(c => `<span class="trait-badge">${c.name} (nivå ${c.level})</span>`).join('')}
    </div>
    <div class="ins-actions">
      <button class="btn-ins-act" id="actPeaceK">🕊️ Stifta fred</button>
      <button class="btn-ins-act" id="actWarK">⚔️ Tvinga krig</button>
      <button class="btn-ins-act" id="actGiftK">🎁 Befalla tillväxt</button>
    </div>`;
  $('#actPeaceK').addEventListener('click', () => {
    for (const id of Array.from(k.warWith)) {
      const k2 = state.kingdoms[id];
      if (k2) endWar(k, k2, 'Guden beordrar det.');
    }
    renderInspector(); renderKingdomList();
  });
  $('#actWarK').addEventListener('click', () => {
    if (!laws.diplomacy) { addEvent('⚔️ Gudens krigslystna rop dämpas – världslagen tillåter inga krig.', 0, 0); return; }
    const others = state.kingdoms.filter(x => x && x !== k && !k.warWith.has(x.id));
    if (others.length === 0) return;
    const target = others.reduce((a, b) => {
      const pa = state.units.filter(u => u.kingdomId === a.id).length;
      const pb = state.units.filter(u => u.kingdomId === b.id).length;
      return pa < pb ? a : b;
    });
    startWar(k, target, 'Guden kräver blod!');
    renderInspector(); renderKingdomList();
  });
  $('#actGiftK').addEventListener('click', () => {
    if (!spend(40)) return;
    for (const c of cities) { c.pop += 8; c.houses++; state.totalBuildings++; }
    addEvent(`🎁 Guden välsignar ${k.name} med överflöd!`, cities[0]?.x ?? 0, cities[0]?.y ?? 0);
    renderInspector();
  });
}

function updateStatsUI() {
  $('#statYear').textContent = `År ${state.year}`;
  $('#statPop').textContent = state.units.length;
  $('#statKingdoms').textContent = state.kingdoms.filter(Boolean).length;
  $('#statBuildings').textContent = state.totalBuildings;
  $('#statTemples').textContent = state.totalTemples;

  let h = 0, e = 0, d = 0, o = 0, a = 0, m = 0, hy = 0;
  for (const u of state.units) {
    switch (u.race) {
      case 'human': h++; break;
      case 'elf': e++; break;
      case 'dwarf': d++; break;
      case 'orc': o++; break;
      case 'hybrid': hy++; break;
      case 'animal': a++; break;
      case 'monster': m++; break;
    }
  }
  $('#popHumans').textContent = h;
  $('#popElves').textContent = e;
  $('#popDwarves').textContent = d;
  $('#popOrcs').textContent = o;
  $('#popHybrids').textContent = hy;
  $('#popAnimals').textContent = a;
  $('#popMonsters').textContent = m;
}

// ============================================================
// INTERAKTION
// ============================================================
function setupInput() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ===== Pointer Events – mus + pekskärm (måla, nypa-zoom, pan) =====
  const pointers = new Map();      // pointerId -> {x,y}
  let pinch = null;                // aktiv nypa
  let stalePointerId = null;       // pekare kvar efter nypa – ignoreras tills den släpps
  let panning = false;
  let painting = false;
  let downMoved = 0;
  let downStart = null;
  let lastPaintAt = 0;

  const isMobileLayout = () => window.matchMedia && window.matchMedia('(max-width: 900px)').matches;

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    pointers.set(e.pointerId, { x, y });

    // Två fingrar / två pekare -> nypa-zoom
    if (pointers.size === 2) {
      painting = false; panning = false;
      mouse.down = false; mouse.panning = false;
      const [p1, p2] = Array.from(pointers.values());
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      pinch = {
        dist0: dist,
        zoom0: cam.zoom,
        mid0x: (p1.x + p2.x) / 2,
        mid0y: (p1.y + p2.y) / 2,
        camX0: cam.x,
        camY0: cam.y,
      };
      return;
    }
    if (pointers.size > 2) return;

    stalePointerId = null;
    downMoved = 0;
    downStart = { x, y };
    mouse.x = x; mouse.y = y;
    mouse.lastSX = x; mouse.lastSY = y;
    mouse.moved = 0;
    const w = screenToWorld(x, y);
    mouse.wx = w.x; mouse.wy = w.y;

    // Panning: höger/mederklick, eller vänster + mellanslag
    const wantPan = e.button === 2 || e.button === 1 || (e.button === 0 && spaceHeld);
    if (wantPan) {
      panning = true; mouse.panning = true;
      return;
    }
    if (e.button !== 0) return;

    if (state.activePower) {
      painting = true;
      mouse.down = true;
      applyPower(mouse.wx, mouse.wy, state.activePower);
      lastPaintAt = performance.now();
      // Mobil: stäng verktygslådan så kartan blir synlig
      if (isMobileLayout()) closeLeftDrawer();
    } else if (e.pointerType === 'mouse') {
      // Inspekteringsläge med mus: klicka för att välja
      inspectAt(mouse.wx, mouse.wy);
    } else {
      // Inspekteringsläge med touch: dra = panning, tap = inspektera
      panning = true; mouse.panning = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (!pointers.has(e.pointerId)) {
      // Bara uppdatera musmarkör (penselringen)
      mouse.x = x; mouse.y = y;
      const w = screenToWorld(x, y);
      mouse.wx = w.x; mouse.wy = w.y;
      return;
    }
    pointers.set(e.pointerId, { x, y });

    // Nypa-zoom: behåll världspunkten under fingrarna
    if (pinch && pointers.size >= 2) {
      const [p1, p2] = Array.from(pointers.values());
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const midx = (p1.x + p2.x) / 2, midy = (p1.y + p2.y) / 2;
      const newZoom = clamp(pinch.zoom0 * (dist / pinch.dist0), 0.35, 20);
      const worldX = pinch.camX0 + pinch.mid0x / pinch.zoom0;
      const worldY = pinch.camY0 + pinch.mid0y / pinch.zoom0;
      cam.zoom = newZoom;
      cam.x = worldX - midx / newZoom;
      cam.y = worldY - midy / newZoom;
      clampCam();
      $('#camZoomLabel').textContent = cam.zoom.toFixed(1) + 'x';
      return;
    }

    if (e.pointerId === stalePointerId) return;

    downMoved += Math.abs(x - mouse.lastSX) + Math.abs(y - mouse.lastSY);
    mouse.x = x; mouse.y = y;
    const w = screenToWorld(x, y);
    mouse.wx = w.x; mouse.wy = w.y;

    if (panning) {
      cam.x -= (x - mouse.lastSX) / cam.zoom;
      cam.y -= (y - mouse.lastSY) / cam.zoom;
      clampCam();
      mouse.lastSX = x; mouse.lastSY = y;
      return;
    }
    mouse.lastSX = x; mouse.lastSY = y;

    if (painting && state.activePower) {
      const now = performance.now();
      if (now - lastPaintAt > 90) {
        applyPower(mouse.wx, mouse.wy, state.activePower);
        lastPaintAt = now;
      }
    }
  });

  const endPointer = (e) => {
    const wasDown = pointers.has(e.pointerId);
    const startPos = downStart;
    pointers.delete(e.pointerId);

    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        // Resterande pekare får inte måla/panna förrän den släpps
        if (pointers.size === 1) stalePointerId = Array.from(pointers.keys())[0];
        panning = false; painting = false;
        mouse.down = false; mouse.panning = false;
      }
      return;
    }

    if (wasDown && pointers.size === 0) {
      // Tap i inspektionsläge med touch = inspektera
      if (!painting && panning && startPos && downMoved < 10) {
        const w = screenToWorld(startPos.x, startPos.y);
        inspectAt(w.x, w.y);
      }
      panning = false; painting = false;
      mouse.down = false; mouse.panning = false;
      stalePointerId = null;
      downStart = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    cam.zoom = clamp(cam.zoom * factor, 0.35, 20);
    const after = screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
    $('#camZoomLabel').textContent = cam.zoom.toFixed(1) + 'x';
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const tag = e.target && e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'TEXTAREA') {
        spaceHeld = true;
        e.preventDefault();
      }
    }
    if (e.code === 'Escape') {
      state.activePower = null;
      updateActivePowerBanner(null);
      renderPowerGrid();
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  // Minimapa-klick
  $('#minimapCanvas').addEventListener('mousedown', (e) => {
    const r = e.target.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const off = miniCtx._off;
    if (!off) return;
    const wx = (mx - off.ox) / off.s;
    const wy = (my - off.oy) / off.s;
    centerCameraOn(wx, wy);
  });

  // Zoom-knappar
  $('#btnZoomIn').addEventListener('click', () => { cam.zoom = clamp(cam.zoom * 1.3, 0.35, 20); clampCam(); $('#camZoomLabel').textContent = cam.zoom.toFixed(1) + 'x'; });
  $('#btnZoomOut').addEventListener('click', () => { cam.zoom = clamp(cam.zoom / 1.3, 0.35, 20); clampCam(); $('#camZoomLabel').textContent = cam.zoom.toFixed(1) + 'x'; });
  $('#btnResetCam').addEventListener('click', () => {
    cam.zoom = Math.min(viewportW / W, viewportH / H) * 0.97;
    cam.x = (W - viewportW / cam.zoom) / 2;
    cam.y = (H - viewportH / cam.zoom) / 2;
    clampCam();
    $('#camZoomLabel').textContent = cam.zoom.toFixed(1) + 'x';
  });
}

function isMobileLayout() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
}
function closeLeftDrawer() {
  const el = document.querySelector('.sidebar-left');
  if (el) el.classList.remove('open');
}
function openRightDrawer() {
  const el = document.querySelector('.sidebar-right');
  if (el) el.classList.add('open');
}

function inspectAt(wx, wy) {
  // Närmaste enhet
  let best = null, bd = Math.max(2.2, 6 / cam.zoom);
  const bd2 = bd * bd;
  for (const u of state.units) {
    if (u.dead) continue;
    const d = dist2(u.x, u.y, wx, wy);
    if (d < bd2) { bd2 = d; best = u; }
  }
  if (best) { selectUnit(best.id, false); if (isMobileLayout()) openRightDrawer(); return; }
  // Stad?
  const c = state.cities.find(c2 => dist2(c2.x, c2.y, wx, wy) < 9);
  if (c) { selectKingdom(c.kingdomId, false); if (isMobileLayout()) openRightDrawer(); return; }
  // Rike via territorium?
  const tx = clamp(Math.floor(wx), 0, W - 1), ty = clamp(Math.floor(wy), 0, H - 1);
  const o = state.owner[ty * W + tx];
  if (o >= 0 && state.kingdoms[o]) { selectKingdom(o, false); if (isMobileLayout()) openRightDrawer(); return; }
  state.selected = null;
  state.followSelected = false;
  $('#btnFollowUnit').classList.remove('active');
  renderInspector();
}

function setupUI() {
  // Power-tabs
  $$('.power-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.power-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.tab;
      renderPowerGrid();
    });
  });

  // Penselstorlek
  $$('.brush-btn').forEach(b => {
    b.addEventListener('click', () => {
      $$('.brush-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.brushSize = parseInt(b.dataset.size, 10);
    });
  });

  // Hastighet
  $$('.btn-speed').forEach(b => {
    b.addEventListener('click', () => {
      $$('.btn-speed').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.speed = parseInt(b.dataset.speed, 10);
      state.paused = state.speed === 0;
    });
  });

  // Nya världen
  $('#btnNewPlanet').addEventListener('click', () => {
    const preset = $('#planetPresetSelect').value;
    generateWorld(preset);
    usedCityNames = [];
    renderKingdomList();
    renderChronicle();
    renderInspector();
    updateStatsUI();
    $('#btnResetCam').click();
  });

  // Befolka
  $('#btnAutoPopulate').addEventListener('click', () => populateWorld());

  // Världslagar
  $('#lawDiplomacy').addEventListener('change', e => { laws.diplomacy = e.target.checked; });
  $('#lawNaturalDisasters').addEventListener('change', e => { laws.naturalDisasters = e.target.checked; });
  $('#lawFastGrowth').addEventListener('change', e => { laws.fastGrowth = e.target.checked; });
  $('#lawMonsters').addEventListener('change', e => { laws.monsters = e.target.checked; });

  // Faith-växel
  $('#chkInfiniteFaith').addEventListener('change', updateFaithUI);

  // Tillbaka till inspekteringsläge
  $('#btnInspectMode').addEventListener('click', () => {
    state.activePower = null;
    updateActivePowerBanner(null);
    renderPowerGrid();
  });

  // Inspector-knappar
  $('#btnFindKing').addEventListener('click', () => {
    const kings = state.units.filter(u => u.isKing && !u.dead);
    if (kings.length === 0) { addEvent('👑 Ännu ingen kung finns på planeten.', W / 2, H / 2); return; }
    const k = choice(kings);
    selectUnit(k.id, true);
  });

  $('#btnFollowUnit').addEventListener('click', () => {
    if (!state.selected || state.selected.type !== 'unit') return;
    state.followSelected = !state.followSelected;
    $('#btnFollowUnit').classList.toggle('active', state.followSelected);
  });

  // Mobil: flytande knappar för verktygslåda & panel
  $('#btnTogglePowers').addEventListener('click', () => {
    const el = document.querySelector('.sidebar-left');
    el.classList.toggle('open');
    document.querySelector('.sidebar-right').classList.remove('open');
  });
  $('#btnTogglePanel').addEventListener('click', () => {
    const el = document.querySelector('.sidebar-right');
    el.classList.toggle('open');
    document.querySelector('.sidebar-left').classList.remove('open');
  });

  // På pekskärm: börja med "Höj Mark" så första gnidningen formar jord direkt
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    state.activePower = 'raise';
    updateActivePowerBanner(findPower('raise'));
  }

  updateActivePowerBanner(state.activePower ? findPower(state.activePower) : null);
  renderPowerGrid();
  renderInspector();
  updateEraLabel();
}

function populateWorld() {
  const spots = [];
  for (let k = 0; k < 40 && spots.length < 5; k++) {
    const p = findLandPos();
    if (p && spots.every(s => dist2(s.x, s.y, p.x, p.y) > 40 * 40)) spots.push(p);
  }
  const races = ['human', 'elf', 'dwarf', 'orc', 'animal'];
  spots.forEach((p, i) => {
    spawnCluster(races[i], i === 4 ? 40 : 26, p.x, p.y);
  });
  // Djurhérdar här och var
  for (let i = 0; i < 14; i++) {
    const p = findLandPos();
    if (p) spawnCluster('animal', 7, p.x, p.y);
  }
  // Ett monster någonstans
  const mp = findLandPos();
  if (mp) spawnUnit('monster', mp.x, mp.y);
  if (spots.length === 0) {
    addEvent('🌊 Det finns ingen landmassa att bosätta sig på! Lyft land ur havet med Höj Mark, och befolka sedan.', W / 2, H / 2);
  } else {
    addEvent('✨ Guden skänker liv åt planeten: bosättare landstiger på kontinenterna!', spots[0].x, spots[0].y);
  }
  renderKingdomList();
}

// ============================================================
// START & LOOPEN
// ============================================================
function resize() {
  const vp = $('#viewport');
  viewportW = vp.clientWidth;
  viewportH = vp.clientHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewportW * DPR);
  canvas.height = Math.floor(viewportH * DPR);
  canvas.style.width = viewportW + 'px';
  canvas.style.height = viewportH + 'px';
  // Vinjett-gradient (om skärmen finns)
  if (viewportW > 0 && viewportH > 0 && ctx && ctx.createRadialGradient) {
    const cx = viewportW / 2, cy = viewportH / 2;
    const rad = Math.hypot(cx, cy) * 0.72;
    const g = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2, 4, 12, 0.42)');
    vignette = g;
  }
}

function makeCloudSprite() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  // Tre överlappande mjuka bollar = mer molnigt
  const blobs = [[30, 36, 24], [54, 30, 26], [72, 38, 20], [48, 42, 22]];
  for (const [bx, by, br] of blobs) {
    const grad = g.createRadialGradient(bx, by, 2, bx, by, br);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function mainLoop(now) {
  requestAnimationFrame(mainLoop);

  // Tidssteg
  if (!state.paused && state.speed > 0) {
    const interval = 350 / state.speed;
    if (now - state.lastTick >= interval) {
      state.lastTick = now;
      simTick();
    }
  }

  // Följ enhet
  if (state.followSelected) {
    const u = getSelectedUnit();
    if (u && !u.dead) {
      cam.x = u.x - viewportW / (2 * cam.zoom);
      cam.y = u.y - viewportH / (2 * cam.zoom);
      clampCam();
    } else {
      state.followSelected = false;
      $('#btnFollowUnit').classList.remove('active');
    }
  }

  draw();

  // Periodiska UI-uppdateringar
  if (now - (state.lastUiUpdate || 0) > 600) {
    state.lastUiUpdate = now;
    updateStatsUI();
    renderKingdomList();
    if (chronicleDirty) renderChronicle();
    if (state.selected) renderInspector();
  }
}

function init() {
  canvas = $('#worldCanvas');
  ctx = canvas.getContext('2d');
  miniCtx = $('#minimapCanvas').getContext('2d');
  cloudSprite = makeCloudSprite();

  // Offscreen terräng
  terrainCv = document.createElement('canvas');
  terrainCv.width = W; terrainCv.height = H;
  terrCtx = terrainCv.getContext('2d');
  terrImg = terrCtx.createImageData(W, H);

  // Offscreen territorium
  terrCv = document.createElement('canvas');
  terrCv.width = W; terrCv.height = H;
  terrOvCtx = terrCv.getContext('2d');
  terrOvImg = terrOvCtx.createImageData(W, H);

  resize();
  window.addEventListener('resize', () => { resize(); });

  generateWorld('continents');
  usedCityNames = [];
  populateWorld();

  setupUI();
  setupInput();
  updateStatsUI();
  renderKingdomList();
  renderChronicle();
  updateFaithUI();
  $('#btnResetCam').click();

  requestAnimationFrame(mainLoop);
}

document.addEventListener('DOMContentLoaded', init);
