# CLAUDE.md — SunTrace 2

Contesto di progetto per le sessioni Claude Code. Il dettaglio completo (storia,
trappole, pendenze) è in `docs/stato-lavori.md` — leggerlo prima di lavori grossi.

## Cos'è

Uno strumento per **chi cerca casa in affitto** (studenti, studenti lavoratori,
lavoratori fuori sede): disegni il perimetro della stanza sulla mappa, rispondi a
sei domande verificabili alla visita, e l'app stima **quanto costa scaldarla, in
euro al mese** (sempre una forbice), con le ombre vere dei palazzi vicini e i
prezzi ARERA. Dalla v4.0.0 non c'è più il Comfort Rate a stelle (vedi
`CHANGELOG.md` [4.0.0]). Due requisiti fissi dell'utente: **niente "AI slop"**
(né nel design né nei contenuti) e **ogni numero deve avere una fonte
verificata**, altrimenti non entra nel calcolo.

Vanilla JS, moduli ES nativi, **nessun build step, zero dipendenze di runtime**.
Pagine: `index.html` (landing), `app.html` (l'app, layout mobile sotto i 768px),
`privacy.html`. **Live su <https://holyemilio.github.io/suntrace2/>** (GitHub
Pages da `main`, root → `index.html`) · versione **4.6.0**.

## Comandi

```bash
./start.command      # server locale su :8000 (Cache-Control: no-store)
npm test             # 78 unit test (motore solare, costo, geometria/ombre, prezzi)
npm run test:e2e     # 34 e2e Playwright (API esterne mockate)
```

Node **è installato** su questo Mac — i test girano localmente. La CI
(`.github/workflows/ci.yml`) li rigira ad ogni push — unit, parità i18n IT/EN,
e2e.

## Mappa dei file

| Percorso | Ruolo |
|---|---|
| `src/cost.js` | **Il calcolo del costo.** Puro. Zona climatica + periodo (DPR 412/93, 74/2013), gradi giorno, sole sulla parete (Erbs + isotropico, ombre via callback), dispersione H con valori U TABULA, forbice lo/hi, checklist. Ogni costante ha la fonte in `docs/metodo.md`: **non aggiungere costanti senza fonte**. |
| `src/prices.js` | Prezzi ARERA gas (per ambito) e luce. **Generato** da `scripts/update_prices.py`, che un'azione GitHub (`update-prices.yml`) esegue ogni mese: non modificarlo a mano. Imposte: fattori in `scripts/price-taxes.json`. |
| `src/ambiti.js` | Regione → ambito tariffario ARERA del gas. |
| `src/zones.js` · `src/data/zone-climatiche.json` | Comune → zona climatica di legge (DPR 412/93). Tabella generata a mano da `scripts/build_zones.py` (tre copie dell'Allegato A, maggioranza); cambia solo per decreto. |
| `src/solar.js` | Motore astronomico Meeus/SPA. **Puro, non toccare senza motivo** (23 test vs SunCalc). |
| `src/shadow.js` | Geometria: `outwardNormalAz` (**attenzione** — ritorna l'azimut VERSO il punto passato: per il lato di una stanza va usato col centroide e flippato di 180°, vedi `lockRoom()`), `classifyRoomEdges`, `polygonArea`/`polygonCentroid`, `sunBlocked`. |
| `src/ui.js` | L'app: Leaflet, API, disegno del poligono, domande (`select[data-answer]`), `refreshCost()` (stima + checklist), `refreshUI()` (sole/mappa per mese e ora), link condivisibile `?v=…`, layout mobile con reparenting DOM. |
| `src/landing.js` · `landing.css` | Landing: Fig. 1 (percorso del sole, da `solar.js`) e confronto § 1 (da `cost.js`, dati Milano incorporati). **Non importano `styles.css`** (che blocca lo scroll). |
| `src/i18n.js` | Testi IT/EN. **Ogni stringa nuova va in ENTRAMBE le lingue** — la CI lo verifica. Voce: semplice, seconda persona, niente emoji. |
| `src/tokens.css` | Carta e inchiostro, scala tipografica `--fs-*`, font, **e la variante scura** (`@media (prefers-color-scheme: dark)`). Ogni colore nuovo va definito qui in entrambe le versioni, mai scritto a mano nei CSS. |
| `vendor/fonts/` · `vendor/leaflet/` | Newsreader, IBM Plex Sans/Mono e Leaflet 1.9.4 **self-hostati**: mai reintrodurre link a Google Fonts/unpkg. |
| `docs/metodo.md` | Il metodo per chi vuole capire i numeri: formule con legenda, fonti, esempio svolto. |
| `docs/sviluppo.md` | Per chi sviluppa: avvio, test, struttura. Il `README` è solo funzionale. |
| `server/overpass-cache/` | Cloudflare Worker (cache KV 30gg davanti ai mirror Overpass). **Non ancora deployato**: si attiva incollando l'URL in `OVERPASS_PROXY_URL` (`src/ui.js`). |

## Servizi esterni (gratuiti, senza chiave)

OpenStreetMap (tiles) · Nominatim (geocoding, debounce ≥420ms, accetta it/va/sm)
· Overpass (edifici — il più fragile: 3 mirror in fallback in `ui.js`)
· Open-Meteo (normali 1991–2020: temperatura, umidità, vento, pioggia, sole;
param `daily` aggregato a mano). La privacy policy (`privacy.html` + chiavi
`privacy-*` in i18n) riflette esattamente questo elenco — se cambi i servizi
contattati, aggiorna anche lei, in entrambe le lingue.

## Regole di progetto

- Stringhe UI: sempre via `data-i18n` (o `-ph`/`-aria`/`-title`) + chiave in
  entrambe le lingue di `i18n.js`.
- Niente CDN, niente nuove dipendenze di runtime, niente bundler.
- Niente emoji come icone: c'è un set SVG (`<symbol>` in cima ad `app.html`).
- Le coordinate nelle query Overpass sono arrotondate a 4 decimali (stessa
  tolleranza della cache localStorage): non "correggerlo".
- Trappole già pagate (flexbox sidebar, `transform`+`backdrop-filter`, `hidden`
  contro `display`, controlli dentro `<details>` negli e2e, link `.md` su Pages,
  finestra <768px): elenco completo in `docs/stato-lavori.md`.
- A fine release: aggiornare `CHANGELOG.md`, `docs/stato-lavori.md` e la
  versione in `package.json`, poi commit + push su `holyemilio/suntrace2`
  (live su GitHub Pages).

## Pendenze note (ottobre 2026)

1. **Deploy del worker Overpass** (azione manuale utente — README in
   `server/overpass-cache/`): con traffico reale le richieste si concentrano
   sui mirror Overpass pubblici, il servizio più fragile.
2. **Validare la stima con bollette vere** (3–5 stanze note): servono i dati
   dell'utente.
3. La forbice con tutti «Non so» è molto ampia: onesta ma poco utile.
4. Nessun e2e sulla landing (verificata solo via screenshot).
5. Fallback mirror Overpass mai provato end-to-end.
