// Alla föremål, recept och inventarielogik. Delas av server + klient.

export const ITEMS = {
  // --- Resurser ---
  wood:  { name: 'Trä',    icon: '🪵', stack: 500, cat: 'res',   color: '#a9743d' },
  stone: { name: 'Sten',   icon: '🪨', stack: 500, cat: 'res',   color: '#9a9a9a' },
  metal: { name: 'Metall', icon: '🔩', stack: 300, cat: 'res',   color: '#c9a227' },
  berry: { name: 'Bär',    icon: '🫐', stack: 50,  cat: 'food',  color: '#c04a6a', hunger: 9, hp: 1.5 },
  arrow: { name: 'Pil',    icon: '➶',  stack: 100, cat: 'ammo',  color: '#d8c9a3' },

  // --- Verktyg (samlar + närstrid) ---
  stone_axe: {
    name: 'Stenyxa', icon: '🪓', stack: 1, cat: 'tool', color: '#b98a4e',
    gather: { wood: 3.2, stone: 1.2, metal: 1.0 }, dmg: 14, range: 2.8, rate: 0.85, dur: 140,
  },
  stone_pick: {
    name: 'Stenhacka', icon: '⛏️', stack: 1, cat: 'tool', color: '#9aa3ab',
    gather: { stone: 3.2, metal: 2.6, wood: 1.0 }, dmg: 12, range: 2.8, rate: 0.9, dur: 140,
  },
  metal_axe: {
    name: 'Metallyxa', icon: '🪓', stack: 1, cat: 'tool', color: '#d6dbe0',
    gather: { wood: 5.5, stone: 1.8, metal: 1.4 }, dmg: 22, range: 2.9, rate: 0.7, dur: 260,
  },
  metal_pick: {
    name: 'Metallhacka', icon: '⛏️', stack: 1, cat: 'tool', color: '#d6dbe0',
    gather: { stone: 5.5, metal: 4.8, wood: 1.4 }, dmg: 20, range: 2.9, rate: 0.75, dur: 260,
  },

  // --- Vapen (närstrid) ---
  wood_spear: { name: 'Träspjut', icon: '🔱', stack: 1, cat: 'weapon', color: '#a9743d', dmg: 18, range: 3.1, rate: 0.95, dur: 120, gather: { wood: 1.2 } },
  stone_spear:{ name: 'Stenspjut', icon: '🔱', stack: 1, cat: 'weapon', color: '#9aa3ab', dmg: 28, range: 3.2, rate: 1.0, dur: 180, gather: { wood: 1.2 } },
  metal_spear:{ name: 'Metallspjut', icon: '🔱', stack: 1, cat: 'weapon', color: '#d6dbe0', dmg: 42, range: 3.3, rate: 1.0, dur: 300, gather: { wood: 1.4 } },

  // --- Avståndsvapen ---
  bow: { name: 'Pilbåge', icon: '🏹', stack: 1, cat: 'ranged', color: '#8d6b3f', dmg: 26, range: 90, rate: 1.15, dur: 200, ammo: 'arrow', projSpeed: 46 },

  // --- Placerbart ---
  campfire: { name: 'Lägereld', icon: '🔥', stack: 5, cat: 'place', color: '#e2703a', place: 'campfire' },
  torch: { name: 'Fackla', icon: '🕯️', stack: 5, cat: 'place', color: '#f0a63c', light: 6, dmg: 6, range: 2.2, rate: 0.8 },
};

export const ITEM_IDS = Object.keys(ITEMS);

export function def(id) { return ITEMS[id]; }
export function itemName(id) { return ITEMS[id] ? ITEMS[id].name : id; }
export function isTool(id) { const c = ITEMS[id] && ITEMS[id].cat; return c === 'tool' || c === 'weapon' || c === 'ranged'; }

// --- Recept -----------------------------------------------------------------
// cost: vad som krävs. out: vad man får.
export const RECIPES = [
  { id: 'stone_axe',   out: { stone_axe: 1 },   cost: { wood: 40, stone: 25 },            group: 'Verktyg' },
  { id: 'stone_pick',  out: { stone_pick: 1 },  cost: { wood: 40, stone: 25 },            group: 'Verktyg' },
  { id: 'metal_axe',   out: { metal_axe: 1 },   cost: { wood: 60, metal: 40 },            group: 'Verktyg' },
  { id: 'metal_pick',  out: { metal_pick: 1 },  cost: { wood: 60, metal: 40 },            group: 'Verktyg' },
  { id: 'wood_spear',  out: { wood_spear: 1 },  cost: { wood: 35 },                       group: 'Vapen' },
  { id: 'stone_spear', out: { stone_spear: 1 },  cost: { wood: 30, stone: 25 },            group: 'Vapen' },
  { id: 'metal_spear', out: { metal_spear: 1 },  cost: { wood: 30, metal: 35 },            group: 'Vapen' },
  { id: 'bow',         out: { bow: 1 },         cost: { wood: 70, stone: 20 },            group: 'Vapen' },
  { id: 'arrow',       out: { arrow: 5 },       cost: { wood: 10, stone: 5 },             group: 'Vapen' },
  { id: 'campfire',    out: { campfire: 1 },    cost: { wood: 30, stone: 15 },            group: 'Överlevnad' },
  { id: 'torch',       out: { torch: 1 },       cost: { wood: 15, stone: 5 },             group: 'Överlevnad' },
];

export const RECIPE_GROUPS = ['Verktyg', 'Vapen', 'Överlevnad'];

// --- Inventarie (rena funktioner, används av servern) -----------------------

export function emptySlots(n) { return new Array(n).fill(null); }

export function countItem(slots, itemId) {
  let n = 0;
  for (const s of slots) if (s && s.id === itemId) n += s.amount;
  return n;
}

export function canAfford(slots, cost) {
  for (const k in cost) if (countItem(slots, k) < cost[k]) return false;
  return true;
}

export function payCost(slots, cost) {
  if (!canAfford(slots, cost)) return false;
  for (const k in cost) removeItem(slots, k, cost[k]);
  return true;
}

export function freeSpaceFor(slots, itemId) {
  const stack = ITEMS[itemId] ? ITEMS[itemId].stack : 1;
  let space = 0;
  for (const s of slots) {
    if (!s) space += stack;
    else if (s.id === itemId) space += Math.max(0, stack - s.amount);
  }
  return space;
}

/** Lägger till items, returnerar hur många som faktiskt fick plats. */
export function addItem(slots, itemId, amount) {
  if (!ITEMS[itemId] || amount <= 0) return 0;
  const stack = ITEMS[itemId].stack;
  let left = amount;
  // fyll befintliga högar först
  for (const s of slots) {
    if (left <= 0) break;
    if (s && s.id === itemId && s.amount < stack) {
      const put = Math.min(stack - s.amount, left);
      s.amount += put; left -= put;
    }
  }
  while (left > 0) {
    const i = slots.findIndex((s) => !s);
    if (i < 0) break;
    const put = Math.min(stack, left);
    const slot = { id: itemId, amount: put };
    if (ITEMS[itemId].dur) slot.dur = ITEMS[itemId].dur;   // verktyg har hållbarhet
    slots[i] = slot;
    left -= put;
  }
  return amount - left;
}

export function removeItem(slots, itemId, amount) {
  let left = amount;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const s = slots[i];
    if (!s || s.id !== itemId) continue;
    const take = Math.min(s.amount, left);
    s.amount -= take; left -= take;
    if (s.amount <= 0) slots[i] = null;
  }
  return left === 0;
}

/** Flytta/stacka mellan två platser. */
export function moveSlot(slots, from, to) {
  if (from === to) return;
  const a = slots[from];
  if (!a) return;
  const b = slots[to];
  if (!b) { slots[to] = a; slots[from] = null; return; }
  if (b.id === a.id) {
    const stack = ITEMS[a.id] ? ITEMS[a.id].stack : 1;
    const put = Math.min(stack - b.amount, a.amount);
    b.amount += put; a.amount -= put;
    if (a.amount <= 0) slots[from] = null;
    return;
  }
  slots[to] = a; slots[from] = b; // byt plats
}

export function splitSlot(slots, from, to, half) {
  const a = slots[from];
  if (!a || slots[to] || a.amount < 2) return;
  const take = half ? Math.ceil(a.amount / 2) : a.amount;
  slots[to] = { id: a.id, amount: take };
  a.amount -= take;
  if (a.amount <= 0) slots[from] = null;
}

export function slotLabel(s) {
  if (!s) return '';
  const d = ITEMS[s.id];
  return `${d ? d.name : s.id} x${s.amount}`;
}
