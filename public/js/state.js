// Klientns globala spel-läge (ett delat, muterbart objekt).

import { WATER_LEVEL } from '../../shared/const.js';

export const S = {
  ready: false,
  seed: 0,
  hm: null,               // Float32Array höjdkarta
  index: null,            // BuildIndex
  colliders: null,        // ColliderGrid (träd/klippor)
  query: null,            // fysik-query
  nodes: new Map(),       // id -> nod
  drops: new Map(),       // id -> tappat föremål
  others: new Map(),      // id -> { data, buf, obj }
  projs: new Map(),       // id -> projektil
  me: {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    onGround: true, inWater: false, wading: false, moving: false, sprinting: false,
    hp: 100, hunger: 100, thirst: 100, temp: 70, wet: false,
    dead: false, respawnIn: 0, held: 0, name: '', pid: '', kills: 0, deaths: 0, seq: 0,
  },
  slots: [],
  tod: 0.3,
  dayLength: 900,
  waterLevel: WATER_LEVEL,
  time: 0,                // serverns klocka (sekunder)
  ping: 0,
  fps: 0,
  inputHistory: [],
  lastSelf: null,         // senaste auktoritativa "you"
  ui: {
    buildType: null,      // aktiv byggdel (null = inte i byggeläge)
    panel: null,          // 'inv' | 'craft' | 'box' | null
    chat: false,
    box: null,            // öppen låda {id, slots}
    locked: false,        // pointer lock
    ghost: null,          // senaste snapp-resultat
  },
  stats: { gathered: {}, crafted: 0, built: 0, kills: 0, deaths: 0 },
};

export function resetWorld() {
  S.nodes.clear(); S.drops.clear(); S.projs.clear();
  S.inputHistory.length = 0;
}
