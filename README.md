<p align="center">
  <img src="docs/logo.svg" alt="SunTrace" width="260">
</p>

<p align="center"><strong>Italiano</strong> · <a href="README.en.md">English</a></p>

# SunTrace 2 — Simulatore Microclimatico Urbano

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-72%20unit%20%2B%2025%20e2e-brightgreen)]()
[![Engine](https://img.shields.io/badge/solar%20engine-Meeus%20%2F%20SPA-blue)]()
[![Live Demo](https://img.shields.io/badge/demo-live-f5b301)](https://holyemilio.github.io/suntrace2/)

**[🌐 Prova SunTrace 2 live](https://holyemilio.github.io/suntrace2/)** — nessuna installazione richiesta.

**SunTrace 2** è un simulatore microclimatico urbano: invece di analizzare un singolo punto, **disegni il perimetro della tua stanza** sulla mappa. Ogni lato del poligono diventa una parete, con orientamento derivato geometricamente e classificata automaticamente come esposta al sole o rivolta verso un altro vano dell'edificio (confronto con il perimetro OSM reale). Il risultato è un unico modello climatico "a livello di stanza": posizione solare corretta (Meeus/SPA), medie climatiche reali del luogo (Open-Meteo), stima termica stagionale pesata per parete e area, e un **Comfort Rate** a stelle con consigli. Interfaccia bilingue **IT/EN**, layout mobile dedicato.

> È il fork architetturale di **SunTrace 1** ([holyemilio/Suntrace](https://github.com/holyemilio/Suntrace), live su GitHub Pages), che invece si basava su un punto singolo + bussola per l'orientamento facciata. Il perché del cambio è nel [CHANGELOG](CHANGELOG.md#300--2026-08-30).

---

## ✨ Features

| Feature | Dettaglio |
|---|---|
| **Disegno del perimetro stanza** | Click per vertice sulla mappa, chiusura dell'anello vicino al primo vertice blocca istantaneamente la stanza; un bottone 🗑️ la rimuove per ridisegnare da zero. Nessuna analisi finché non si disegna. |
| **Classificazione automatica delle pareti** | Ogni lato è confrontato col perimetro OSM reale dell'edificio: a ridosso del muro esterno → **esposto al sole** (stagionale, variabile); altrimenti → **verso un altro vano** (valore fisso, neutro). Senza edificio OSM disponibile, fallback prudenziale: tutto esposto. |
| **Sole diretto per parete, in tempo reale** | Ogni parete esposta mostra se in questo momento prende sole diretto (verde) o è in ombra di un edificio vicino (grigio), non solo il totale della stanza. |
| **Modello climatico a livello di stanza** | Le pareti esterne pesano per la propria lunghezza, quelle interne tirano verso un valore neutro, l'intera escursione stagionale si smorza o amplifica in base alla superficie della stanza (mostrata in sidebar e nel dettaglio Comfort Rate). |
| **Motore solare Meeus/SPA** | Declinazione, Equazione del Tempo, rifrazione atmosferica (Bennet). Errore < 0.5° su elevazione e azimut rispetto a SunCalc. |
| **Il 5° piano è il tetto** | Superficie orizzontale, non una parete: il guadagno solare dipende solo dall'elevazione del sole, mai da un orientamento. |
| **Dati climatici reali (Open-Meteo)** | Medie mensili 1991–2020 del punto disegnato, cache in `localStorage`, fallback su Roma. |
| **Comfort Rate** | Indice a 5 stelle (orientamento, sole, ostruzioni, infissi, isolamento) con dettaglio, esposizione solare e consigli. |
| **Ombre reali (OSM)** | Ray-casting verso il sole attraverso gli edifici OSM vicini, dall'altezza del piano scelto. |
| **Geofencing Italia** | Reverse-geocoding: distingue terraferma IT (incluse le enclavi Vaticano/San Marino), acque nazionali ed estero, con messaggi dedicati. |
| **Geolocalizzazione** | Anche dalla landing page (porta dritto su `app.html` centrato sulla propria posizione), oltre che nel simulatore. |
| **Landing + simulatore** | Due pagine separate: `index.html` (missione, ricerca) e `app.html` (il simulatore vero e proprio). |
| **Layout mobile dedicato** | Sotto i 768px: barra inferiore, drawer "Impostazioni", foglio "Info", due widget solare/clima — niente sidebar bloccata. |
| **Bilingue IT/EN** | Selettore in-app, rilevamento automatico della lingua del browser, scelta memorizzata. |
| **Zero dipendenze di runtime** | Leaflet e font serviti in locale (`vendor/`), nessun CDN: le uniche richieste esterne vanno alle API pubbliche senza chiave — OpenStreetMap, Nominatim, Overpass, Open-Meteo. Nessun bundler. |
| **72 unit + 25 e2e** | `node --test` per motore solare, modello termico e geometria/ombre; Playwright guida l'app in un browser vero. |

---

## 📖 Documentazione

- **[Manuale Utente](docs/manuale-utente.html)** — come si usa l'app, cosa fa, pulsanti e notifiche (apribile nel browser, stampabile in PDF).
- **[Testbook](docs/testbook.html)** — piano di test in tabella, con esito da compilare, per verificare tutte le funzioni.
- **[Testbook (CSV)](docs/testbook.csv)** — la stessa checklist, scaricabile e apribile in Excel (separatore `;`, UTF-8).
- **[Stato dei lavori](docs/stato-lavori.md)** — dove siamo, cosa è in sospeso e le trappole già incontrate.
- **[Privacy](privacy.html)** — quali servizi esterni contatta il browser e perché.

---

## 🔬 Algoritmi

### Motore solare (`src/solar.js`)

Basato su **Meeus, "Astronomical Algorithms" 2nd ed. (1998), cap. 25–27**:

1. **Longitudine media del Sole** `L₀ = 280.46646 + 36000.76983·T`
2. **Anomalia media** `M` ed **equazione del centro** `C`
3. **Longitudine apparente** con correzione di nutazione (`ω = 125.04 − 1934.136·T`)
4. **Obliquità eclittica** `ε` → **declinazione** `δ = arcsin(sin ε · sin λ_app)`
5. **Equazione del tempo** `E` (formula a 5 termini, precisione ~0.5")
6. **Angolo orario** `HA = 15·(TST − 12)`, dove `TST = UTC + lon/15 + E/60`
7. **Elevazione** con **rifrazione atmosferica** (formula di Bennet)
8. **Azimut** con la formula corretta `cos Az = (sin δ − sin elev·sin lat)/(cos elev·cos lat)`

**Target di accuratezza**: < 0.5° su elevazione, < 1° su azimut — verificato contro SunCalc su 23 casi di test.

### Geometria stanza (`src/shadow.js`)

Ogni lato del poligono disegnato diventa una parete: `outwardNormalAz` ne deriva l'azimut, `classifyRoomEdges` lo confronta col perimetro OSM dell'edificio ospite (tolleranza `EDGE_TOLERANCE_M`) per decidere se è esposto o interno, `polygonArea`/`polygonCentroid` calcolano superficie e centro per il modello climatico.

---

## 🚀 Come avviare

L'app ha due pagine: **`index.html`** è la landing page (missione del progetto
e barra di ricerca) e **`app.html`** è il simulatore vero e proprio. Cercare un
indirizzo dalla landing porta direttamente su `app.html` già caricato su quel
punto; il pulsante «← Home» nel simulatore riporta alla landing.

> ⚠️ **Non aprire i file `.html` con doppio click.** L'app usa moduli ES
> (`<script type="module">`), la geolocalizzazione e chiamate a API esterne:
> tutte cose che il browser **blocca** in modalità `file://`. Se apri un file
> direttamente, l'app risulta "morta" (pulsanti e ricerca non rispondono).
> Serve un server locale su `http://localhost`.

**Metodo più semplice (macOS):** doppio click su **`start.command`**.
Avvia un server locale e apre il browser sulla landing page. Per fermarlo,
premi `Ctrl+C` nella finestra del Terminale che si apre.

> Il server invia `Cache-Control: no-store`, così dopo una modifica basta
> ricaricare la pagina per vedere subito la versione nuova. Se avessi lasciato
> aperto un server avviato prima, chiudilo e rilancia `start.command`.

**In VSCode:** installa l'estensione *Live Server*, poi tasto destro su
`index.html` → **"Open with Live Server"**.

**Da terminale:**

```bash
cd suntrace2
python3 -m http.server 8000
# poi apri http://localhost:8000
```

---

## 🧪 Test

> Serve **Node.js 18+**. Se non ce l'hai, il modo più semplice è `brew install node`,
> oppure scarica il pacchetto ufficiale da [nodejs.org](https://nodejs.org).

```bash
# Installa suncalc e Playwright (solo devDependency per i test)
npm install

# Esegui i 72 unit test (Node 18+)
npm test
```

**Output atteso**: 72 pass, 0 fail.

### Test end-to-end (browser reale)

Guidano l'app in un browser headless, con le API esterne simulate per risultati
deterministici: avvio, disegno del perimetro stanza, geofencing, cursori,
infissi/isolamento, Comfort Rate, lingua, piani, ombre, clima e finestra stretta
(layout mobile).

```bash
npx playwright install chromium   # una sola volta (~95 MB)
npm run test:e2e
```

**Output atteso**: 25 pass, 0 fail.

---

## 🌍 Deploy su GitHub Pages

**Live su <https://holyemilio.github.io/suntrace2/>** — Source: **Deploy from
a branch** → `main` → `/` (root), da **Settings → Pages** nel repository.
Essendo `index.html` la landing page, il dominio radice mostra quella; il
simulatore è su `/app.html`.

---

## 📁 Struttura

```
suntrace2/
├── index.html          # Landing page: missione del progetto + ricerca
├── app.html            # Simulatore vero e proprio
├── privacy.html         # Informativa privacy (IT/EN)
├── src/
│   ├── solar.js        # Motore astronomico puro (Meeus/SPA) — senza DOM
│   ├── climate.js      # Modello termico stagionale a livello di stanza
│   ├── shadow.js        # Geometria: pareti stanza, classificazione, ombre reali
│   ├── ui.js            # Logica del simulatore, Leaflet, disegno stanza, layout mobile
│   ├── landing.js       # Logica della landing: lingua, ricerca → app.html, reveal
│   ├── legal.js          # Logica della pagina privacy
│   ├── i18n.js           # Dizionario IT/EN e motore di traduzione (condiviso)
│   ├── tokens.css        # Design token (:root) condivisi da tutte le pagine
│   ├── styles.css        # Stili del simulatore (mobile-first)
│   ├── landing.css       # Stili della landing page
│   └── legal.css         # Stili della pagina privacy
├── vendor/
│   ├── fonts/           # Space Grotesk + IBM Plex Mono self-hostati (niente Google Fonts)
│   └── leaflet/         # Leaflet 1.9.4 self-hostato (niente CDN)
├── server/
│   └── overpass-cache/ # Cloudflare Worker: cache 30gg davanti a Overpass (opzionale, non deployato)
├── tests/
│   ├── solar.test.js    # 23 test — motore astronomico (oracle SunCalc)
│   ├── climate.test.js  # modello termico, Comfort Rate e roomSeasonalTemperatures
│   ├── shadow.test.js   # geometria stanza, classificazione pareti, ombre
│   └── e2e/app.e2e.js   # 25 test end-to-end (Playwright, browser headless)
├── .github/
│   └── workflows/ci.yml # CI: unit + parità i18n + e2e a ogni push
├── docs/
│   ├── case-study.md    # Case study tecnico
│   ├── stato-lavori.md  # Stato lavori, pendenze, trappole già pagate
│   ├── manuale-utente.html
│   └── testbook.html / testbook.csv
├── CLAUDE.md            # Contesto di progetto per le sessioni AI
├── README.md
├── README.en.md
├── CHANGELOG.md
├── LICENSE              # MIT
├── .gitignore
└── package.json
```

---

## 🏗 How it was built

SunTrace 2 è stato progettato per essere **zero-dependency** e **deployabile senza build step**. Il codice è suddiviso in moduli ES nativi (`type="module"`) importati direttamente dall'HTML.

Il motore astronomico (`solar.js`) è interamente **puro** (nessun accesso al DOM, nessuna variabile globale), il che lo rende:
- Testabile con `node --test` senza browser
- Riutilizzabile in altri contesti (worker, server-side)

La geometria della stanza (`shadow.js`) è altrettanto pura: prende in input i vertici disegnati e il perimetro OSM dell'edificio, non tocca il DOM.

L'interfaccia usa Leaflet 1.9.4 (self-hosted in `vendor/leaflet/`, hash verificato contro leafletjs.com) per la mappa, l'API pubblica Overpass per il perimetro degli edifici e Nominatim per il geocoding, rispettando i [termini di utilizzo](https://operations.osmfoundation.org/policies/nominatim/) con debounce ≥ 420ms e `countrycodes=it,va,sm`. Anche i font (Space Grotesk, IBM Plex Mono) sono self-hostati in `vendor/fonts/`: nessuna richiesta dei visitatori raggiunge Google o altri CDN.

---

## ⚠️ Limitazioni

- Le temperature usano le **medie climatiche reali** del punto disegnato (Open-Meteo, normali 1991–2020), con la tabella di Roma solo come *fallback* offline in caso di errore di rete. Il modello termico dell'edificio resta però **euristico** e non sostituisce un APE (Attestato di Prestazione Energetica) certificato.
- Orientamento e classificazione delle pareti sono **calcolati sugli edifici reali di OpenStreetMap** (via Overpass): senza un edificio OSM disponibile, ogni parete resta prudenzialmente "esposta". Le altezze OSM spesso mancano: in tal caso si assumono 3 piani (9 m), e si considerano solo gli edifici entro 90 m.
- Nessuna validazione contro poligoni auto-intersecanti o degeneri in fase di disegno.
- Il cuneo d'ombra sulla mappa resta uno solo, disegnato dal centroide della stanza — non uno per parete.
- Il modello non include: massa termica, infiltrazioni, apporti interni, ponti termici.

---

## 📄 Licenza

MIT © 2026 SunTrace. Vedi [LICENSE](LICENSE).
