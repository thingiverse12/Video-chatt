// Delade konstanter – används av BÅDE server och klient (ESM).
// Hela världens "sanning" ligger här så att klienten kan förutsäga rörelser
// med exakt samma regler som servern.

export const MAP_SIZE = 400;             // meter, världen spänner -200..200
export const HALF = MAP_SIZE / 2;
export const HM_RES = 201;               // höjdkartans upplösning (punkter per sida)
export const HM_STEP = MAP_SIZE / (HM_RES - 1); // 2 m
export const WATER_LEVEL = 2.0;

export const DEFAULT_SEED = 20261003;
export const DAY_LENGTH = 900;           // sekunder för ett helt dygn (15 min)
export const START_TOD = 0.28;           // börja på morgonen

export const TICK_RATE = 30;             // serverns simuleringstakt
export const SNAPSHOT_RATE = 15;         // utskick av världsläge per sekund
export const MAX_PLAYERS = 24;

export const GRAVITY = 22;

export const P = {
  radius: 0.34,
  height: 1.8,
  eye: 1.62,
  walk: 3.15,
  sprint: 5.5,
  swim: 1.9,
  jump: 7.4,
  step: 0.62,          // hur högt block man kan kliva upp på automatiskt
  maxHp: 100,
  maxHunger: 100,
  maxThirst: 100,
  maxTemp: 100,
  reach: 5.0,          // räckvidd för interaktion/bygge
  attackReach: 2.7,
};

// Avklingning per sekund
export const SURVIVAL = {
  hunger: 0.075,
  hungerSprint: 0.19,
  thirst: 0.15,
  thirstSprint: 0.30,
  tempLerp: 2.4,        // hur snabbt kroppstemperatur närmar sig miljötemperaturen
  coldDamage: 1.1,      // hp/s vid temp <= 0
  starveDamage: 0.9,
  dehydrateDamage: 1.3,
  regen: 0.65,          // hp/s när man är mätt och varm
  wetSeconds: 25,
  drinkAmount: 22,
  drinkCooldown: 0.7,
};

// Miljötemperaturer (mål-värde för "temp")
export const TEMP = {
  baseDay: 74,
  baseNight: 26,
  waterPenalty: 46,
  wetPenalty: 16,
  fireBonus: 62,
  fireRadius: 7.5,
  coldThreshold: 22,
};

export const INVENTORY_SIZE = 24;   // 24 platser, 0-5 = hotbar
export const HOTBAR_SIZE = 6;
export const BOX_SLOTS = 12;

export const RESPAWN_DELAY = 6;     // sekunder
export const STARTER_KIT = [];      // spelaren börjar med ingenting (enligt spec)
