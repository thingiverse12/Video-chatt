# RUST MVP — multiplayer-överlevnad i webbläsaren

Ett litet men komplett överlevnadsspel i RUST-anda, byggt med **Node.js + Express + Socket.io + Three.js**.
Du spawnar på en ö med tomma händer, hugger trä och bryter sten, craftar verktyg och vapen,
bygger en bas med snappande byggdelar, och överlever hunger, törst, kyla — och andra spelare.

Ingen byggstep, inga externa assets: all geometri, alla texturer och alla ljudeffekter
genereras i koden. Servern är auktoritativ (allt viktigt räknas där), klienten kör
prediktion + interpolation så att det känns direkt.

---

## Kom igång

```bash
npm install          # express, socket.io, three (+ socket.io-client för tester)
npm start            # http://localhost:3000
```

Öppna `http://localhost:3000` i **två flikar/fönster** (eller två datorer i samma nätverk)
för att se multiplayer-delen: spelare ser varandra, kan samarbeta eller slåss, och allt
sparas i `data/save.json`.

> Port: `PORT=8080 npm start`

### Testa

```bash
npm run unit        # bygglogik, snappning, ras, kollision (snabb, utan nätverk)
npm run clienttest  # hela klienten headless mot riktig server (DOM-stub)
npm run smoke       # 2 botar spelar igenom hela kärnloopen (tar ~4 min)
npm test            # alla tre
```

---

## Kontroller

| Tangent | Funktion |
|---|---|
| `W A S D` | Gå |
| `Shift` | Spring |
| `Mellanslag` | Hoppa (simma uppåt i vatten) |
| `Vänsterklick` | Slå / hugg / skjut — i byggläge: placera |
| `Högerklick` | Använd föremål (ät bär, placera lägereld) — i byggläge: avbryt |
| `E` | Interagera: dörr, låda, dricka, plocka bär, plocka upp tappat |
| `U` | Uppgradera byggdel (trä → sten → metall) |
| `X` | Riv **egen** byggdel |
| `B` | Byggläge / byggmeny |
| `C` | Crafting |
| `Tab` | Inventarie (24 platser) |
| `1`–`6`, mushjul | Välj i hotbar (i byggläge: välj byggdel) |
| `Q` | Släpp föremålet i handen |
| `T` | Chatt |
| `Esc` | Stäng panel / släpp musen |

---

## Spelet

### Världen
* ~280 m stor ö med skog, berg, strand och vatten, genererad deterministiskt från ett frö
  (`shared/terrain.js`, frövärde i `shared/const.js`). Klienten bygger samma höjdkarta lokalt
  av fröet — den skickas aldrig som data.
* Dag/natt på 15 min med sol, måne, stjärnor, skiftande himmel och dimma.
* 1000 begränsade resurspunkter som tar slut och växer tillbaka efter en tid.

### Resurser (bara tre, som specat)
| Resurs | Från | Bäst med |
|---|---|---|
| **Trä** 🪵 | Träd | Yxa |
| **Sten** 🪨 | Stenklippor | Hacka |
| **Metall** ⚙️ | Metallåder (gul-orange fläckar i sten) | Metallhacka |

Utöver de tre resurserna finns **bärbuskar** 🫐 — mat är ett krav för att hunger ska gå att överleva.
Bär mättar och ger lite hälsa; buskens sekundärloot är trä.

### Crafting (`C`)
Verktyg: **stenyxa**, **stenhacka**, **metallyxa**, **metallhacka**, **fackla**
Vapen: **träspjut**, **stenspjut**, **metallspjut**, **pilbåge** + **pilar**
Överlevnad: **lägereld**

Verktyg och vapen har **hållbarhet** som nöts ner per slag och visas i hotbaren. Går sönder = försvinner.

### Byggande (`B`) — delarna snappar
`Golv` → `Vägg` → `Dörröppning` → `Dörr` → `Tak` → `Förvaringslåda` (+ `Lägereld`).

* Golv snappar till ett 4 m-rutnät och ärver höjden från angränsande golv (jämnt byggande).
* Väggar/dörröppningar snappar till golvets kanter, tak snappar ovanpå väggar,
  dörrar snappar i sin dörröppning, lådor på golvets 1 m-rutnät.
* Grön förhandsvisning = giltig plats, röd = upptagen/ogiltig.
* **Stödstruktur:** rivs golvet rasar väggar, tak, lådor och dörrar med det.
  Ett golv på en vägg ger våning 2.
* Äganderätt: bara den som byggde får riva (`X`) och uppgradera (`U`).
  Alla får slå på allt — dvs baser kan raidas. Trä → sten kostar 70 sten per del,
  sten → metall 55 metall, och höjer hp rejält (×2,6 resp. ×5,2).

### Överlevnad
Hälsa, hunger, törst och kroppstemperatur. Du fryser på natten och i vatten,
blir varm vid lägereld och under tak. Skada från fall, svält, törst, kyla och strid.
Vid 0 hp dör du och respawnar efter 6 s vid en strand — **inventariet behålls**
(och sparas på servern mellan sessioner).

### Strid
* Närstrid: spjut/yxor/hackor med räckvidd, skada och träffzon (huvud ×1,7, kropp ×1,0, ben ×0,85).
* Avstånd: **pilbåge** med pilfall — sikta lite över målet på håll.
* Träffregistrering sker på servern utifrån ditt sikte (`yaw`/`pitch` skickas med varje handling),
  med hitmarkör, skadenummer och blodpartiklar som svar.

### Progression
spawn → slå för hand → stenyxa/hacka → trä & sten → träbas → bättre verktyg →
metall → metallspjut/metallyxa → sten- och metallbas → överlev natten och andra spelare.

---

## Multiplayer & data

* Upp till 24 spelare per server, 30 Hz simulering, 15 Hz snapshots.
* Rörelse: klientprediktion med input-sekvenser + uppspelning av osäkrade inputs vid varje
  snapshot (ingen rubberbanding). Andra spelare interpoleras ~100 ms bakåt i tiden.
* Noder och byggdelar skickas en gång i `init` och därefter **inkrementellt**
  (`block:add/upd/del`, `nodes`, `drop:*`) — aldrig i snapshots.
* Sparas i `data/save.json` (gitignorerad): tid på dygnet, alla byggdelar och varje spelares
  namn, inventarie, kills/deaths och speltid. Sparas var 20:e sekund och vid avstängning.
  Spelar-id (`pid`) ligger i localStorage, så du är samma person nästa gång.

---

## Kodstruktur

```
server.js             Express + Socket.io + statiska filer
server/game.js        Auktoritativ simulering: tick, strid, bygg, överlevnad, spar
server/world.js       Höjdkarta, resursnoder, spawn-punkter, respawn av noder
server/net.js         Socket-händelser → Game
server/persistence.js Atomärt JSON-sparande
shared/               Körs på BÅDE server och klient (en enda sanning för regler)
  const.js  math.js  terrain.js  items.js  building.js  nodes.js  raycast.js  physics.js
public/index.html     Spelet (meny + HUD)
public/css/style.css
public/js/            main.js (loop) · scene.js (terräng/himmel) · props.js (noder, block,
                      avatarer, pilar, partiklar) · viewmodel.js · hud.js · input.js · net.js · sfx.js
tools/                unit-build.js · client-headless.js + dom-stub.js · smoke.js
public/legacy/        Den gamla WebRTC-videochatten (ligger kvar på /legacy)
```

Protokollet (klient → server): `join, input, attack, interact, respawn, craft, place, demolish,
upgrade, inv:move, inv:drop, inv:use, hotbar, box:xfer, box:close, chat, ping`.
Server → klient: `init, state, inv, nodes, block:add/upd/del, drop:add/upd/del, fx, loot, toast,
chat, hurt, dealt, hitmark, died, respawned, crafted, placed, ate, box:open/upd/close, kicked, pong`.

---

## Medvetet utanför MVP:n

Fordon, el, NPC:er, monument, avancerade vapen, odling, helikoptrar, tåg, klaner,
jättekartor och ekonomi — allt det är bortvalt för att kärnloopen ska vara hel och spelbar.
