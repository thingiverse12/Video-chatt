# 🪓 RUST – MVP

Ett multiplayer-survival-spel i webbläsaren: du vaknar på en ö nästan utan resurser,
samlar material, bygger en bas, tillverkar utrustning och försöker överleva mot både
miljön och andra spelare.

**Ingen build behövs, inga npm-beroenden för att spela.**

```bash
node server/index.js      # eller: npm start
```

Öppna <http://localhost:3000> i webbläsaren. Öppna gärna flera flikar (eller andra
enheter på samma nätverk) för att spela flera spelare mot varandra – alla ansluter till
samma server.

Spelet använder **muslås** (pointer lock) för att styra kameran. Om vyn körs inbäddad
(t.ex. i en iframe som inte tillåter muslås) upptäcker spelet det automatiskt och byter
till **drag-läge**: håll in vänster musknapp och rör musen för att titta, och släpp för
att slå/samla. En gul ledtråd visas högst upp när det läget är aktivt.

---

## Kärnloopen (MVP-målet)

> Spawn → samla resurser → crafta verktyg → bygga ett litet skydd → hitta andra spelare →
> överleva → dö/respawna → fortsätta utvecklas

Start → samla → crafta → bygga → överleva → uppgradera. Exempel på väg genom spelet:
**Nävar → trä → stenyxa → träbas → lägereld → metall → metalverktyg → starkare bas.**

---

## Kontroller

| Tangent | Funktion |
| --- | --- |
| `W A S D` | Gå |
| `Shift` | Spring |
| `Ctrl` / `C` | Huka |
| `Space` | Hoppa / simma upp |
| **Vänster mus** | Slå / samla / använd (håll in för att fortsätta slå) |
| **Höger mus** | Avbryt byggläge |
| `E` | Interagera: dörr, förvaringslåda, lootpåse |
| `R` | Riv byggdelen du tittar på (50 % återbetalning) |
| `B` | Byggmeny (1–5 väljer del, vänster mus placerar) |
| `Tab` | Inventarie & hantverk |
| `1–0`, mushjul | Välj hotbar-plats |
| `F` | Ät / använd föremålet i handen |
| `Enter` | Chatt |
| `Esc` | Pausmeny med kontroller (Esc igen, klicka utanför rutan eller tryck ▶ Fortsätt spelar för att gå tillbaka) |

---

## Vad som finns i MVP:n

### Spelvärld
* En öppen 3D-ö på **400 × 400 m** med skog, berg, sten, stränder och 5 sjöar.
* Allt genereras deterministiskt ur en **seed** (samma värld hos server och klient) –
  `seed` ligger i `shared/worldgen.js`.
* **1180 resurspunkter**: 520 träd, 300 stenblock, 90 metallmalmer, 150 bärbuskar,
  120 svampar. Punkterna tar slut när de töms och växer tillbaka efter 2,5–5 min.
* **Dag/natt-cykel** på 15 minuter med sol, skymning, nattljus, dimma och vindkänsla i vattnet.

### Spelaren
* Förstapersonsperspektiv med klientförutsägelse (samma fysikkod på server och klient).
* **Hälsa, hunger, törst och värme** (0–100). Värme tappas i kyla och vid bad, och fylls
  på vid lägereld eller inomhus.
* Inventarie: trä, sten och metall är resurspooler; verktyg, vapen, mat och byggbara
  föremål ligger i en hotbar med 10 platser.
* Spring, hoppa, huka, simma, interagera, slåss och bygga.

### Resurser
Träd → **trä**, stenblock → **sten**, metallmalm → **metall**, bärbuskar → **bär**,
svampar → **svamp**. Vilket verktyg du använder avgör hur mycket du får per slag: en
metallyxa ger 13 trä per slag, nävarna 4.

### Hantverk (13 recept i tre steg)
| Steg | Recept |
| --- | --- |
| 1 – sten & trä | Stenyxa (40 trä + 25 sten), Stenhacka (40 trä + 35 sten), Träklubba (70 trä), Lägereld (60 trä + 20 sten), Bandage (40 trä) |
| 2 – träbas & jakt | Träspjut (120 trä), Pilbåge (140 trä + 20 sten), 4×Pil (24 trä + 12 sten), Förvaringslåda (120 trä + 30 sten), Dörr (60 trä) |
| 3 – metall | Metallyxa (80 trä + 8 metall), Metalhacka (80 trä + 10 metall), Metalspjut (100 trä + 12 metall) |

### Byggande med snäppning
Byggdelarna ligger på ett **3 × 3 m-grid** och snäpper ihop: grunden äger en ruta, väggar
och dörröppningar sitter på rutans kanter och taket hamnar en våning upp.

| Del | Kostnad | HP | Regel |
| --- | --- | --- | --- |
| Grund | 40 trä | 320 | Plan mark, inte i vattnet |
| Vägg | 25 trä | 240 | Kräver golv på minst en sida |
| Dörröppning | 30 trä | 240 | Som vägg, med hål för dörr |
| Tak | 30 trä | 240 | En våning över en befintlig grund |
| Dörr | 50 trä | 400 | Kräver dörröppning (`E` öppnar/stänger) |
| Lägereld | 60 trä + 20 sten | 150 | Värmer dig inom 6 m |
| Förvaringslåda | 100 trä + 20 sten | 350 | 4,5 m räckvidd, håller dina saker |

Förhandsvisningen visar **grön** ruta när det går att bygga och **röd** med orsak
(”Ojämn mark”, ”Behöver golv”, ”För nära vatten” …) när det inte går. Servern kör
exakt samma regler, så det som är grönt går alltid att bygga.

### Multiplayer
* Flera spelare på samma server, upp till valfritt antal i praktiken.
* Spelare ser varandra med namnskylt, hälsobar, gånganimation och vilket vapen de håller.
* Rörelsen synkroniseras med klientförutsägelse + avstämning mot serverns snapshots.
* Inventarie, resurser, byggdelar och världen sparas i `data/save.json`.
* Bygg tillsammans eller konkurrera – och slåss om samma resurspunkter.
* Kopplar du från somnar kroppen kvar i världen: andra kan slå ihjäl den och ta dina saker.
  Återanslut med samma namn (token sparas i webbläsaren) så vaknar du igen.

### Överlevnad
* Hunger och törst sjunker (snabbare när du springer, ännu snabbare när du är kall).
* **Kyla/värme**: i kyla och i vatten tappar du värme; en lägereld (+7 värme/s) eller ett
  tak över huvudet håller dig varm. Vid 0 värme tar du köldskada; står du för nära elden
  blir det i stället **för varmt** och du tar skada av hettan.
* Hälsan återhämtar sig långsamt om du är mätt, varm och hydrerad.
* Dör du hamnar dina saker i en **lootpåse** där du dog. Du respawnar automatiskt efter
  8 sekunder – eller direkt med knappen.

### Strid
* Närstrid: nävar, träklubba, stenyxa, metallyxa, träspjut, metalspjut.
* Avstånd: **pilbåge** – håll in vänster mus för att spänna bågen (minst 1/3 drag) och
  släpp för att skjuta. Pilen flyger 55 m/s med fall och kan träffa spelare och byggdelar.
* Träffregistrering sker på servern (sfärer för spelare och resursnoder, boxar för byggdelar).
* Dödsfall, killfeed, lootpåsar och respawn.

### Progression
Start → samla → crafta → bygga → överleva → uppgradera. Metall krävs i praktiken av en
stenhacka och finns bara i bergen, vilket tvingar dig att röra på dig – och därmed möta
andra spelare.

---

## Så är koden upplagd

```
shared/        samma kod körs på server och i klienten
  worldgen.js  seedad terräng, sjöar, resurspunkter, dag/natt-hjälpare
  building.js  grid, BuildingIndex, canPlace, snäppningsförslag, geometri & AABB
  items.js     föremål, verktygsstatistik, recept, byggkostnader
  movement.js  spelarfysik och kollision (identisk på båda sidor)

server/
  index.js        HTTP (statiska filer + litet API) och /ws
  game.js         auktoritativ spelvärld: spelare, resurser, bygge, strid, överlevnad
  ws.js           minimal WebSocket-server (RFC 6455) – inga npm-beroenden
  persistence.js  JSON-sparning (atomisk skrivning)

public/
  index.html      HUD, menyer och importkarta för three.js
  css/style.css   all HUD-styling
  js/main.js      spelloop, inmatning och alla nätverkshändelser
  js/render.js    three.js: terräng, vatten, himmel, dag/natt, instansierade noder, byggdelar, spelare, partiklar
  js/player.js    lokal spelare: förutsägelse, kollision, avstämning
  js/interact.js  strålfärd, snäppningsförhandsvisning, slag, dörrar, lådor, loot
  js/hud.js       alla DOM-paneler (mätare, hotbar, hantverk, chatt, dödskärm)
  js/net.js       WebSocket-klient med ping och återanslutning
  vendor/         three.js r180 (MIT) – paketerad lokalt, ingen CDN behövs
```

**Nätverksmodell:** servern tickar i 20 Hz och skickar snapshots i 10 Hz; klienten
förutsäger sin egen rörelse med `shared/movement.js` och rättar sig mot serverns
position. Allt spelavgörande (resursutbyte, byggregler, skada, överlevnad) sker på
servern – klienten skickar bara avsikter.

---

## Testa

```bash
# starta servern först
node server/index.js &

# 1) fullständigt rökprov via WebSocket: två botar som spelar igenom hela loopen
npm test                 # 31 kontroller: statiska filer, värld, rörelse, resurser,
                         # hantverk, bygge, snäppning, lägereld, rev, överlevnad, PvP, död

# 2) klientkontroll i simulerad webbläsare (kräver jsdom)
npm i -D jsdom
npm run test:client      # 12 kontroller: DOM, mätare, paneler, bygglogik, delad fysik
```

Rökprovet skapar två spelare (`Arena-A`, `Arena-B`) på servern. Vill du köra det från
rent bord: `rm -f data/save.json` innan du startar servern.

---

## Fusk-/admin-kommandon i chatten

`/help` · `/give <föremål> <antal>` · `/tp <spelare>` · `/time <0-1>` · `/kill` ·
`/spawn` · `/players` · `/seed`

---

## Justera spelet

| Vad | Var |
| --- | --- |
| Karta, seed, daglängd, vattennivå, grid | `shared/worldgen.js` → `CONFIG` |
| Antal och typ av resurspunkter | `shared/worldgen.js` → `NODE_TYPES` + `_makeNodes()` |
| Gångfart, hopp, gravitation, simning | `shared/movement.js` → `PLAYER` |
| Vapenskada, räckvidd, cooldown, utbyte per slag | `shared/items.js` → `EQUIP` |
| Recept och byggkostnader | `shared/items.js` → `RECIPES`, `shared/building.js` → `PIECES` |
| Överlevnadsbalans (hunger, törst, värme, skada) | `server/game.js` → `updateSurvival()` |
| Tick-frekvens, respawn-tid, byggräckvidd | `server/game.js` → `TICK_HZ`, `RESPAWN_TIME`, `REACH` |

---

## Medvetna förenklingar i MVP:n

* Ingen strukturell stabilitet (i Rust rasar byggdelar utan stöd) – tak kräver dock en
  grund under sig.
* Dörrar går att gå igenom (ingen låsning), så ingen kan bli inlåst.
* En serverprocess utan kontosystem; spelaridentitet bygger på namn + token i webbläsaren.
* Ingen röst-/textkanal utöver chatten, ingen clanfunktion, ingen karta i HUD:n.
* Byggdelar kan rivas och förstöras men inte repareras.

## Sådant som kan vänta (enligt specen)

Fordon · elektricitet · komplicerade NPC:er · stora monument · avancerade vapen ·
jordbruk · helikoptrar · tåg · avancerade clansystem · massiva kartor · komplicerad ekonomi.

Naturliga nästa steg när MVP:n känns bra: strukturell stabilitet, fler biom och
resurstyper, verktygsslitage, sängar/respawn-punkter, ugn för smältning, och en
mobiler-anpassad HUD.
