// Röktest: kör spelets logik i Node med DOM-stubbar och sök efter körningsfel.
'use strict';

const fs = require('fs');
const path = require('path');

const failures = [];

function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    closePath() {}, fillText() {}, drawImage() {}, ellipse() {}, setLineDash() {},
    putImageData() {}, measureText: () => ({ width: 10 }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    globalCompositeOperation: 'source-over', shadowColor: '', shadowBlur: 0,
    imageSmoothingEnabled: true,
  };
}

function makeEl() {
  const handlers = {};
  return {
    checked: true,
    textContent: '',
    innerHTML: '',
    title: '',
    style: {},
    dataset: {},
    width: 0, height: 0,
    clientWidth: 900, clientHeight: 640,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(type, cb) { (handlers[type] = handlers[type] || []).push(cb); },
    click() { (handlers.click || []).forEach(cb => cb({ preventDefault() {} })); },
    appendChild() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 640 }; },
    getContext() { return makeCtx(); },
  };
}

const elements = new Map();
function getEl(sel) {
  if (!elements.has(sel)) elements.set(sel, makeEl());
  return elements.get(sel);
}

const readyHandlers = [];
global.document = {
  querySelector: getEl,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener: (type, cb) => { if (type === 'DOMContentLoaded') readyHandlers.push(cb); },
};
global.window = { addEventListener() {}, devicePixelRatio: 1 };
global.requestAnimationFrame = () => {};

// Ladda spelet och exportera dess interna API till __T
let src = fs.readFileSync(path.join(__dirname, 'public', 'game.js'), 'utf8');
src += `
globalThis.__T = {
  state, laws, ERAS, POWER_TABS,
  simTick, draw, updateStatsUI, renderKingdomList, renderChronicle, renderInspector,
  selectUnit, selectKingdom, inspectAt, applyPower, generateWorld, populateWorld,
  warsCount, centerCameraOn,
  getChronicleDirty: () => chronicleDirty,
  setUsedCityNames: (v) => { usedCityNames = v; },
};
`;
try {
  (0, eval)(src);
} catch (e) {
  console.error('FEL vid laddning av game.js:', e);
  process.exit(1);
}
const T = globalThis.__T;

try {
  readyHandlers.forEach(cb => cb());
} catch (e) {
  console.error('FEL vid init():', e);
  process.exit(1);
}
console.log('init() ok');

function step() {
  try {
    T.simTick();
    T.draw();
    T.updateStatsUI();
    T.renderKingdomList();
    if (T.getChronicleDirty()) T.renderChronicle();
    if (T.state.selected) T.renderInspector();
  } catch (e) {
    failures.push('steg: ' + (e.stack || e.message));
    return false;
  }
  return true;
}

// Simulera ~150 år
for (let i = 0; i < 1000; i++) {
  if (!step()) break;
}
if (failures.length) {
  console.error('FEL under steg:\n' + failures[0].split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}
console.log('1000 simuleringssteg (~83 år) utan fel. Status:');
console.log('  År:', T.state.year, '| Enheter:', T.state.units.length,
  '| Kungariken:', T.state.kingdoms.filter(Boolean).length,
  '| Städer:', T.state.cities.length);

// Testa alla gudakraft-typer
const allPowers = [];
for (const tab of Object.values(T.POWER_TABS)) for (const p of tab) allPowers.push(p.id);
for (const pid of allPowers) {
  try {
    T.applyPower(60 + Math.random() * 100, 40 + Math.random() * 80, pid);
  } catch (e) {
    failures.push('applyPower(' + pid + '): ' + (e.stack || e.message));
  }
}
for (let i = 0; i < 300 && failures.length === 0; i++) step();
if (failures.length) {
  console.error('FEL efter gudakraft-test:\n' + failures[0]);
  process.exit(1);
}
console.log('Alla ' + allPowers.length + ' gudakraft-typer fungerar utan fel.');

// Inspektörval
try {
  if (T.state.units.length > 0) T.selectUnit(T.state.units[0].id, true);
  const ks = T.state.kingdoms.filter(Boolean);
  if (ks.length > 0) T.selectKingdom(ks[0].id, true);
  T.inspectAt(50, 50);
  T.draw();
} catch (e) {
  failures.push('inspektion: ' + (e.stack || e.message));
}

// Världslagar + extremtest: meteorregn, alla katastrofer upprepat
try {
  T.laws.naturalDisasters = true;
  for (let i = 0; i < 200 && failures.length === 0; i++) step();
  for (let i = 0; i < 15; i++) T.applyPower(30 + Math.random() * 200, 30 + Math.random() * 100, 'meteor');
} catch (e) {
  failures.push('katastrofer: ' + (e.stack || e.message));
}

// Nya planeter av varje preset
for (const preset of ['continents', 'archipelago', 'pangaea', 'volcanic', 'empty']) {
  try {
    T.generateWorld(preset);
    T.setUsedCityNames([]);
    T.populateWorld();
    for (let i = 0; i < 100 && failures.length === 0; i++) step();
  } catch (e) {
    failures.push('preset ' + preset + ': ' + (e.stack || e.message));
  }
}

if (failures.length) {
  console.error('\nRÖKTEST MISSLYCKADES:');
  for (const f of failures) console.error('- ' + f);
  process.exit(1);
}

console.log('\nSlutstatus efter lång körning:');
console.log('  År:', T.state.year);
console.log('  Enheter:', T.state.units.length);
console.log('  Kungariken:', T.state.kingdoms.filter(Boolean).length);
console.log('  Städer:', T.state.cities.length);
console.log('  Byggnader:', T.state.totalBuildings, '| Tempel:', T.state.totalTemples);
console.log('  Krönikans händelser:', T.state.events.length);
console.log('  Aktiva krig:', T.warsCount());
console.log('  Tidsålder:', T.ERAS[T.state.eraIdx].n);
console.log('\nRÖKTEST OK ✔');
