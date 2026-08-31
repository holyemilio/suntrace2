# CLAUDE.md — SunTrace 2

Contesto di progetto per le sessioni Claude Code. Il dettaglio completo (storia,
trappole, pendenze) è in `docs/stato-lavori.md` — leggerlo prima di lavori grossi.

## Cos'è

Simulatore microclimatico urbano — ma a differenza di SunTrace 1 (repo separata,
`holyemilio/Suntrace`), qui l'utente **disegna il perimetro della propria stanza**
sulla mappa invece di cliccare un singolo punto: ogni lato del poligono diventa
una parete con orientamento derivato geometricamente, classificata esposta al
sole o verso un altro vano, e il risultato è un unico modello climatico "a
livello di stanza" (non una bussola/facciata singola — vedi `docs/CHANGELOG.md`
[3.0.0] per il perché). Vanilla JS, moduli ES nativi, **nessun build step, zero
dipendenze di runtime**. Due pagine: `index.html` (landing) e `app.html`
(simulatore, con layout mobile dedicato sotto i 768px). Repo privata, non ancora
deployata pubblicamente · versione **3.0.0**.

## Comandi

```bash
./start.command      # server locale su :8000 (Cache-Control: no-store)
npm test             # 72 unit test (motore solare, clima, geometria/ombre)
npm run test:e2e     # 25 e2e Playwright (API esterne mockate)
```

Node **è installato** su questo Mac (verificato: `node --version` funziona) —
i test girano localmente, non serve aspettare la CI per verificare una modifica.
La CI (`.github/workflows/ci.yml`) li rigira comunque ad ogni push — unit, parità
i18n IT/EN, e2e — come seconda rete di sicurezza.

## Mappa dei file

| Percorso | Ruolo |
|---|---|
| `src/solar.js` | Motore astronomico Meeus/SPA. **Puro, non toccare senza motivo** (23 test vs SunCalc). |
| `src/climate.js` | Modello termico. `seasonalTemperatures` (una parete) resta invariata e testata; `roomSeasonalTemperatures` la chiama una volta per parete e combina per lunghezza + smorzamento da area stanza (`REF_ROOM_AREA_M2`, `INTERIOR_WALL_REF_C`, entrambe costanti interne non esportate). |
| `src/shadow.js` | Geometria: `outwardNormalAz` (azimut di un lato, **attenzione** — ritorna l'azimut VERSO il punto di riferimento passato, non lontano da esso: per il lato di una stanza va usato col centroide e poi flippato di 180°, vedi `lockRoom()` in `ui.js`), `classifyRoomEdges` (esterno/interno per lato, tolleranza `EDGE_TOLERANCE_M=2.5`), `polygonArea`/`polygonCentroid`, `sunBlocked`/`monthlySunAccess` (cache ora una `Map` multi-chiave, non più a singolo slot — serve una chiamata per parete per refresh). |
| `src/ui.js` | Tutto il simulatore: Leaflet, API, **disegno del poligono stanza** (click per vertice, chiusura vicino al primo vertice blocca la stanza, bottone 🗑️ la rimuove — niente più bussola/punto singolo), pannelli, layout mobile con reparenting DOM. Monolite. |
| `src/landing.js` · `landing.css` | Landing. **Non importano `styles.css`** (che blocca lo scroll). |
| `src/i18n.js` | Dizionario IT/EN. **Ogni stringa nuova va in ENTRAMBE le lingue** — la CI lo verifica. |
| `src/tokens.css` | Design token condivisi dalle due pagine. |
| `vendor/fonts/` · `vendor/leaflet/` | Font e Leaflet 1.9.4 **self-hostati**: niente CDN, mai reintrodurre link a Google Fonts/unpkg. |
| `server/overpass-cache/` | Cloudflare Worker (cache KV 30gg davanti ai mirror Overpass). **Non ancora deployato**: si attiva incollando l'URL in `OVERPASS_PROXY_URL` (`src/ui.js`). |

## Servizi esterni (gratuiti, senza chiave)

OpenStreetMap (tiles) · Nominatim (geocoding, debounce ≥420ms, accetta it/va/sm)
· Overpass (edifici — il più fragile: 3 mirror in fallback in `ui.js`)
· Open-Meteo (normali climatiche 1991–2020, param `daily` aggregato a mano).
Font e Leaflet **non** sono più esterni (self-hostati da v2.5.0); la privacy
policy (`privacy.html` + chiavi `privacy-*` in i18n) riflette esattamente questo
elenco — se cambi i servizi contattati, aggiorna anche lei, in entrambe le lingue.

## Regole di progetto

- Stringhe UI: sempre via `data-i18n` (o `-ph`/`-aria`/`-title`) + chiave in
  entrambe le lingue di `i18n.js`.
- Niente CDN, niente nuove dipendenze di runtime, niente bundler.
- Le coordinate nelle query Overpass sono arrotondate a 4 decimali (stessa
  tolleranza della cache localStorage): non "correggerlo".
- Trappole già pagate (flexbox sidebar, `transform`+`backdrop-filter`,
  cache del browser, finestra <768px): elenco completo in `docs/stato-lavori.md`
  — consultarlo prima di toccare layout o mappa.
- A fine release: aggiornare `CHANGELOG.md`, `docs/stato-lavori.md` e la
  versione in `package.json`, poi commit + push sul repo del progetto
  (`holyemilio/suntrace2`, privata).

## Pendenze note (agosto 2026)

1. Deploy del worker Overpass (azione manuale utente — README in `server/overpass-cache/`).
2. Nessun e2e sulla landing (`landing.js` verificata solo via screenshot).
3. Fallback mirror Overpass mai provato end-to-end.
4. Nessuna UI mostra esplicitamente l'area della stanza (mq) — usata internamente
   per lo smorzamento stagionale ma non esposta all'utente.
5. Il cuneo d'ombra sulla mappa resta uno solo, disegnato dal centroide della
   stanza — non uno per parete (semplificazione dichiarata).
6. Nessuna validazione esplicita contro poligoni auto-intersecanti o degeneri
   in fase di disegno.
