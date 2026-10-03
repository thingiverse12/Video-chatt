/**
 * Delade definitioner av föremål, verktyg, vapen och recept.
 * Används av server (auktoritativ logik) och klient (UI, hotbar, modeller).
 */

import { PIECES } from './building.js';

export const ITEMS = {
  wood: { name: 'Trä', icon: '🪵', stack: 1000, color: '#a9702f', kind: 'resource' },
  stone: { name: 'Sten', icon: '🪨', stack: 1000, color: '#9aa0a6', kind: 'resource' },
  metal: { name: 'Metall', icon: '⛓️', stack: 1000, color: '#b8c0c8', kind: 'resource' },
  berries: { name: 'Bär', icon: '🍓', stack: 50, color: '#d3375f', kind: 'food', food: { hunger: 14, thirst: 6, heal: 3 } },
  mushroom: { name: 'Svamp', icon: '🍄', stack: 50, color: '#c8a165', kind: 'food', food: { hunger: 10, thirst: -2, heal: 1 } },
  arrow: { name: 'Pil', icon: '🏹', stack: 200, color: '#c8b48a', kind: 'ammo' },
  bandage: { name: 'Bandage', icon: '🩹', stack: 20, color: '#f0e6dc', kind: 'heal', heal: 25 },

  // Verktyg & vapen (kind: equipment) – se EQUIP för statistik
  stone_hatchet: { name: 'Stenyxa', icon: '🪓', stack: 1, kind: 'equipment' },
  stone_pickaxe: { name: 'Stenhacka', icon: '⛏️', stack: 1, kind: 'equipment' },
  hatchet: { name: 'Metallyxa', icon: '🪓', stack: 1, kind: 'equipment', tint: '#cfd6dd' },
  pickaxe: { name: 'Metalhacka', icon: '⛏️', stack: 1, kind: 'equipment', tint: '#cfd6dd' },
  club: { name: 'Träklubba', icon: '🏏', stack: 1, kind: 'equipment' },
  spear_wood: { name: 'Träspjut', icon: '🔱', stack: 1, kind: 'equipment' },
  spear_metal: { name: 'Metalspjut', icon: '🗡️', stack: 1, kind: 'equipment', tint: '#cfd6dd' },
  bow: { name: 'Pilbåge', icon: '🏹', stack: 1, kind: 'equipment' },

  // Placerbara föremål
  campfire: { name: 'Lägereld', icon: '🔥', stack: 5, kind: 'placeable', piece: 'campfire' },
  storage_box: { name: 'Förvaringslåda', icon: '📦', stack: 5, kind: 'placeable', piece: 'storage_box' },
  door: { name: 'Dörr', icon: '🚪', stack: 5, kind: 'placeable', piece: 'door' },
};

/**
 * Nävar och utrustning.
 *  nodeDmg  – skada mot resurspunkter per slag
 *  gather   – utbyte per nodtyp och slag (server ackumulerar decimaler)
 *  playerDmg– skada mot spelare (och byggdelar, halverad)
 */
export const EQUIP = {
  hand: {
    name: 'Nävar',
    type: 'melee',
    playerDmg: 6,
    nodeDmg: 5,
    range: 2.2,
    cooldown: 0.62,
    gather: { tree: 4, rock: 2.5, ore: 0.8, berry: 1, mushroom: 1 },
  },
  stone_hatchet: {
    name: 'Stenyxa',
    type: 'melee',
    playerDmg: 11,
    nodeDmg: 9,
    range: 2.5,
    cooldown: 0.55,
    gather: { tree: 7, rock: 1, ore: 0.6, berry: 1, mushroom: 1 },
  },
  stone_pickaxe: {
    name: 'Stenhacka',
    type: 'melee',
    playerDmg: 10,
    nodeDmg: 11,
    range: 2.5,
    cooldown: 0.55,
    gather: { tree: 2, rock: 7, ore: 3, berry: 1, mushroom: 1 },
  },
  hatchet: {
    name: 'Metallyxa',
    type: 'melee',
    playerDmg: 17,
    nodeDmg: 15,
    range: 2.6,
    cooldown: 0.5,
    gather: { tree: 13, rock: 2, ore: 1, berry: 1, mushroom: 1 },
  },
  pickaxe: {
    name: 'Metalhacka',
    type: 'melee',
    playerDmg: 15,
    nodeDmg: 17,
    range: 2.6,
    cooldown: 0.5,
    gather: { tree: 3, rock: 13, ore: 7, berry: 1, mushroom: 1 },
  },
  club: {
    name: 'Träklubba',
    type: 'melee',
    playerDmg: 21,
    nodeDmg: 5,
    range: 2.6,
    cooldown: 0.75,
    gather: { tree: 4, rock: 1, ore: 0.4, berry: 1, mushroom: 1 },
  },
  spear_wood: {
    name: 'Träspjut',
    type: 'melee',
    playerDmg: 27,
    nodeDmg: 6,
    range: 3.3,
    cooldown: 1.0,
    gather: { tree: 3, rock: 1, ore: 0.4, berry: 1, mushroom: 1 },
  },
  spear_metal: {
    name: 'Metalspjut',
    type: 'melee',
    playerDmg: 42,
    nodeDmg: 10,
    range: 3.4,
    cooldown: 1.0,
    gather: { tree: 5, rock: 2, ore: 1, berry: 1, mushroom: 1 },
  },
  bow: {
    name: 'Pilbåge',
    type: 'ranged',
    playerDmg: 34,
    nodeDmg: 4,
    range: 140,
    cooldown: 0.9,
    draw: 0.75,
    ammo: 'arrow',
    gather: { tree: 2, rock: 1, ore: 0.3, berry: 1, mushroom: 1 },
  },
};

export function equipOf(itemId) {
  return EQUIP[itemId] || EQUIP.hand;
}

/** Resurs per nodtyp */
export const NODE_RESOURCE = {
  tree: 'wood',
  rock: 'stone',
  ore: 'metal',
  berry: 'berries',
  mushroom: 'mushroom',
};

/** Verktyg för att bygga strukturella delar (krävs i handen eller inventariet) */
export const BUILD_ITEMS = {
  foundation: { cost: PIECES.foundation.cost, name: PIECES.foundation.name },
  wall: { cost: PIECES.wall.cost, name: PIECES.wall.name },
  doorway: { cost: PIECES.doorway.cost, name: PIECES.doorway.name },
  ceiling: { cost: PIECES.ceiling.cost, name: PIECES.ceiling.name },
};

/**
 * Recept. `count` = antal skapade föremål per hantverkskörning.
 * Out-parametern är item-id (verktyg/vapen/placerbart).
 */
export const RECIPES = [
  { id: 'stone_hatchet', out: 'stone_hatchet', count: 1, cost: { wood: 40, stone: 25 }, time: 2.0, tier: 1 },
  { id: 'stone_pickaxe', out: 'stone_pickaxe', count: 1, cost: { wood: 40, stone: 35 }, time: 2.0, tier: 1 },
  { id: 'club', out: 'club', count: 1, cost: { wood: 70 }, time: 1.5, tier: 1 },
  { id: 'campfire', out: 'campfire', count: 1, cost: { wood: 60, stone: 20 }, time: 1.5, tier: 1 },
  { id: 'spear_wood', out: 'spear_wood', count: 1, cost: { wood: 120 }, time: 2.5, tier: 2 },
  { id: 'bow', out: 'bow', count: 1, cost: { wood: 140, stone: 20 }, time: 3.0, tier: 2 },
  { id: 'arrow', out: 'arrow', count: 4, cost: { wood: 24, stone: 12 }, time: 1.2, tier: 2 },
  { id: 'storage_box', out: 'storage_box', count: 1, cost: { wood: 120, stone: 30 }, time: 2.5, tier: 2 },
  { id: 'door', out: 'door', count: 1, cost: { wood: 60 }, time: 1.5, tier: 2 },
  { id: 'hatchet', out: 'hatchet', count: 1, cost: { wood: 80, metal: 8 }, time: 3.5, tier: 3 },
  { id: 'pickaxe', out: 'pickaxe', count: 1, cost: { wood: 80, metal: 10 }, time: 3.5, tier: 3 },
  { id: 'spear_metal', out: 'spear_metal', count: 1, cost: { wood: 100, metal: 12 }, time: 4.0, tier: 3 },
  { id: 'bandage', out: 'bandage', count: 1, cost: { wood: 40 }, time: 1.5, tier: 1 },
];

export function recipeById(id) {
  return RECIPES.find((r) => r.id === id) || null;
}

export function itemName(id) {
  if (!id) return '—';
  return ITEMS[id]?.name || PIECES[id]?.name || id;
}

export function itemIcon(id) {
  return ITEMS[id]?.icon || '❓';
}

export function maxStack(id) {
  return ITEMS[id]?.stack ?? 1;
}

/** Byggkostnad för en byggdel (strukturella delar) */
export function pieceCost(kind) {
  return PIECES[kind]?.cost || null;
}
