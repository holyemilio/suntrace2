# SunTrace 2 — per chi sviluppa

Questa pagina è per chi vuole modificare il codice. Come funziona l'app per
chi la usa è nel [README](../README.md); come si calcola la stima, formula per
formula, è in [metodo.md](metodo.md).

Vanilla JS, moduli ES nativi, **nessun build step, zero dipendenze di
runtime**. Leaflet 1.9.4 e i font sono self-hostati in `vendor/`.

## Avviarlo in locale

I file `.html` non si aprono con doppio clic: moduli ES e geolocalizzazione
richiedono `http://localhost`.

```bash
./start.command          # macOS: server su :8000 con Cache-Control: no-store
# oppure
python3 -m http.server 8000
```

`index.html` è la landing, `app.html` l'app.

## Test

Serve Node.js 18+.

```bash
npm install                        # suncalc e Playwright, solo per i test
npm test                           # unit: motore solare, costo, geometria/ombre
npx playwright install chromium    # una volta sola
npm run test:e2e                   # e2e: l'app in un browser vero, API simulate
```

La CI (`.github/workflows/ci.yml`) li rilancia a ogni push, più un controllo
che ogni chiave di `src/i18n.js` esista in italiano e in inglese.

## Struttura

```
index.html          landing: hero, Fig. 1 (percorso del sole), confronto, fonti
app.html            l'app: mappa + colonna con stima, domande, checklist, dettagli
privacy.html        informativa privacy
src/
  solar.js          posizione del sole (Meeus/SPA) — puro, testato contro SunCalc
  shadow.js         geometria della stanza, pareti esterne/interne, raggi d'ombra
  cost.js           il costo del riscaldamento — puro, tutte le costanti con fonte
  prices.js         prezzi ARERA di gas (per ambito) e luce — GENERATO, non modificare
  ambiti.js         regione → ambito tariffario ARERA
  zones.js          comune → zona climatica di legge (DPR 412/93)
  data/zone-climatiche.json  la tabella dei comuni, generata da scripts/build_zones.py
  ui.js             l'app: Leaflet, disegno, domande, stima, condivisione, mobile
  landing.js        la landing: lingua, ricerca → app, Fig. 1 e confronto
  legal.js          la pagina privacy
  i18n.js           testi IT/EN
  tokens.css        colori, caratteri e scala tipografica condivisi
  styles.css        stili dell'app
  landing.css       stili della landing (non importa styles.css)
  legal.css         stili della pagina privacy
vendor/fonts/       Newsreader, IBM Plex Sans, IBM Plex Mono (OFL)
vendor/leaflet/     Leaflet 1.9.4
server/overpass-cache/  Cloudflare Worker opzionale, non ancora deployato
scripts/            update_prices.py (prezzi ARERA → src/prices.js), price-taxes.json,
                    build_zones.py (DPR 412/93 → src/data/zone-climatiche.json, a mano: serve pdfplumber)
tests/              *.test.js (unit) e e2e/app.e2e.js (Playwright)
docs/
  metodo.md         il metodo di calcolo, con fonti
  manuale/          manuale utente IT (manuale-utente.md) ed EN (user-manual.md), con le schermate
  sviluppo.md       questa pagina
  stato-lavori.md   stato, pendenze, trappole già incontrate
  archivio/         documenti della versione 3 (Comfort Rate), superati
```

## Regole del progetto

- Ogni testo visibile passa da `data-i18n` (o `-ph`, `-aria`, `-title`) e ha la
  chiave in **entrambe** le lingue in `src/i18n.js`.
- Niente CDN, niente nuove dipendenze di runtime, niente bundler.
- Ogni costante del calcolo ha una fonte in `docs/metodo.md`. Un valore che
  non si può verificare non entra nel calcolo.
- Prima di toccare layout o mappa, leggi le trappole in
  [stato-lavori.md](stato-lavori.md).

## Prezzi

Si aggiornano da soli ogni mese (`.github/workflows/update-prices.yml`). Per
rigenerarli a mano: `python3 scripts/update_prices.py` (con `--check` stampa
senza scrivere). Dettagli in
[metodo.md, «Come si aggiornano i prezzi»](metodo.md#come-si-aggiornano-i-prezzi).

## Marchio e anteprima dei link

Logo, simbolo e icone sono in `docs/brand/`. L'immagine dell'anteprima dei
link (`og-image.png`, 1200×630) si rigenera aprendo `docs/brand/og-source.html`
dal server locale e facendo uno screenshot a 1200×630 (es. con Playwright).

## Deploy

GitHub Pages da `main`, cartella `/`: <https://holyemilio.github.io/suntrace2/>.
Un push su `main` è già un rilascio.
