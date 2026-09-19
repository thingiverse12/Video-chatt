# VY-Gen — VY:s helt egna AI

En liten språkmodell (en GPT-liknande transformer) som är **helt egen**:
egen arkitektur, egen kod, egen träningsdata och egna vikter. Ingen extern
AI-API — modellen laddas in i VY:s server och genererar text direkt i
processen.

## Vad är det?

| Egenskap | Värde |
| --- | --- |
| Arkitektur | Char-level transformer (varje tecken är en token) |
| Storlek | ~3,25 M parametrar |
| Kontext | 256 tecken |
| Huvud | Delat språkhuvud (samma vikter som inbäddningen) |
| Träningsdata | Skrivna svenska dialoger (chatt-persona + trygghet) + stickprov av offentliga domän-böcker (Projekt Gutenberg: Lagerlöf, Strindberg, folksagor) |
| Körplats | Node.js-processen (CPU) — `ai/vygen-node.js` |

## Filer

```
ai/
  vygen.py          Arkitekturen (PyTorch), skriven från grunden
  train.py          Träningsmotor (AdamW, cosine LR, validering)
  build_corpus.py   Bygger träningskorpusen ur dialoger + böcker
  export_model.py   Exporterar tränade vikter till VYGEN1-binärfil
  fetch_books.sh    Hämtar bokkällorna (GitHub GITenberg)
  vygen-node.js     Inferensmotor på JavaScript (KV-cache, top-k)
  test_crosscheck.py  Tvärvalidering PyTorch ↔ JS
  test-vygen-node.js  (samma test, JS-sidan)
  corpus/           Skrivna dialoger + byggd korpus
  dist/
    vygen.bin       Exporterade vikter (laddas av servern)
    model-info.json Parametrar/tecken för status-UI:et
```

## Träna om (gör AI:en smartare)

```bash
python3 -m venv .venv
.venv/bin/pip install torch numpy
bash ai/fetch_books.sh            # en gång, kräver github.com
.venv/bin/python ai/build_corpus.py
.venv/bin/python ai/train.py      # ~20 min på 2 CPU-kärnor
.venv/bin/python ai/export_model.py
```

Tips för att förbättra kvaliteten:
1. **Mer dialog** — lägg till egna Q/A-par i `corpus/dialog_*.txt` i
   formatet `ANVÄNDARE: …` / `VY-GEN: …` och kör `build_corpus.py` igen.
   Det är den största kvalitetsupphöjningen.
2. **Längre träning** — `VYGEN_EPOCHS=6 .venv/bin/python ai/train.py`.
3. **Större modell** — ändra `DEFAULT_CONFIG` i `vygen.py` (kostnaden är
   kvadratisk i kontexten, linjär i bredden).

## Hur chatten fungerar

1. Klienten skickar `POST /api/ai/chat` med ett meddelande.
2. Servern bygger prompten i det tränade formatet:
   `ANVÄNDARE: {meddelande}\nVY-GEN: `
3. `vygen-node.js` kör forward-pass med KV-cache och samplar med
   top-k=40 + temperatur 0,8.
4. Svarstexten returneras och visas i chattvyn.

`GET /api/ai/status` ger modellfakta till UI:et (parametrar, tränade tecken).

## Ärlig notis

VY-Gen är en prototyp på storlek av en "nanomodell": den är helt egen och
lär sig sin personan och sina grundfakta, men den kan inte matcha de
största kommersiella modellerna (som tränats på enorma datacenter med
billiarder i ström). Det är meningen — poängen är att den är 100 % er
egen, från kodbaser till vikter, och att ni kan lära den upp.
