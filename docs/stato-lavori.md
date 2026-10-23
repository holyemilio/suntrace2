# Stato dei lavori — SunTrace 2

Ultimo aggiornamento: **23 ottobre 2026** · versione **4.4.0** · repo:
`holyemilio/suntrace2` · **live su <https://holyemilio.github.io/suntrace2/>**

Documento di passaggio di consegne: cosa è fatto, cosa è in sospeso e cosa
sapere prima di rimettere le mani al progetto.

**SunTrace 2 è un fork architetturale di SunTrace 1** (`holyemilio/Suntrace`,
live su GitHub Pages): stessa base tecnica (vanilla JS, Meeus/SPA, zero
dipendenze runtime), ma l'interazione centrale è il disegno della stanza.
**Dalla v4.0.0 l'output non è più un Comfort Rate ma il costo del
riscaldamento in euro**, per chi affitta (studenti, lavoratori fuori sede):
vedi la voce **16** prima di toccare `ui.js` o `cost.js`. Il metodo, formula
per formula, è in [`docs/metodo.md`](metodo.md); le istruzioni per chi
sviluppa in [`docs/sviluppo.md`](sviluppo.md).

---

## Come far girare tutto

```bash
# app (server locale, niente cache)
./start.command                      # poi http://localhost:8000 (landing page)

# test
npm test                             # 73 unit  — motore solare, costo, geometria/pareti/ombre
npm run test:e2e                     # 33 e2e   — Playwright guida app.html in un browser vero
```

Su questo Mac **Node è installato** (verificato in questa sessione: `node
--version` funziona) — entrambi i comandi sopra girano localmente, non serve
aspettare la CI per una verifica. La CI (`.github/workflows/ci.yml`) li
riesegue comunque ad ogni push come seconda rete di sicurezza.

Per gli e2e, se Playwright non ha ancora il browser: `npx playwright install
chromium`.

> Il progetto è **zero-dependency a runtime**: nessun bundler, moduli ES nativi.
> Playwright e suncalc sono solo per i test.

---

## Com'è fatto

Due pagine separate, più la privacy:

| File | Responsabilità |
|---|---|
| `index.html` + `src/landing.js` + `src/landing.css` | **Landing**: titolo editoriale, Fig. 1 (percorso del sole su Roma, disegnato da `solar.js`), § 1 confronto della stessa stanza con 4 riscaldamenti (calcolato da `cost.js` su dati Milano incorporati, ai prezzi di `prices.js`), § 2 le domande, § 3 le fonti. Ricerca → `app.html?q=`, geolocalizzazione → `app.html?lat=&lng=`. Non importa `styles.css`. |
| `app.html` | L'app: colonna a sinistra (passi, ricerca, **stima in euro**, **domande della visita**, **checklist**, **condividi**, `<details>` «Dettagli tecnici» con cursori mese/ora, sole e clima), mappa a destra. Icone: un set SVG in `<symbol>` in cima al file, niente emoji. |
| `src/cost.js` | **Il costo del riscaldamento.** Puro. Zona climatica e periodo (DPR 412/93, DPR 74/2013), gradi giorno dalle medie Open-Meteo, sole sulla parete verticale (Erbs + isotropico, raggio d'ombra ogni 10 minuti tramite callback), coefficiente di dispersione H con valori U TABULA, forbice lo/hi, checklist. Ogni costante ha la fonte in `docs/metodo.md`. |
| `src/prices.js` | Prezzi ARERA gas (€/Smc, per ambito) e luce (€/kWh). **Generato ogni mese** da `scripts/update_prices.py` tramite `.github/workflows/update-prices.yml` (voce 17). |
| `src/ambiti.js` | Regione (da Nominatim reverse) → ambito tariffario ARERA. |
| `src/solar.js` | Motore astronomico Meeus/SPA. **Puro, non toccare senza motivo**: 23 test lo confrontano con SunCalc. |
| `src/shadow.js` | Geometria: `outwardNormalAz`, `classifyRoomEdges`, `polygonArea`/`polygonCentroid`/`localToLatLng`, `sunBlocked`. Puro. |
| `src/ui.js` | L'app: Leaflet, geofencing, API, disegno del poligono, domande (`select[data-answer]`), `refreshCost()` (stima + checklist), `refreshUI()` (sole e mappa per mese/ora), cache dell'irraggiamento per parete (`irradianceCache`), link condivisibile (`?v=lat,lng;…&f=&heating=…`), layout mobile. |
| `src/i18n.js` | Testi IT/EN, condivisi dalle tre pagine. Voce: parole semplici, seconda persona, niente emoji. |
| `src/tokens.css` | Carta e inchiostro: `--paper`, `--ink`, `--sun` (solo sole e soldi), `--heat`, `--cold`, scala tipografica fissa `--fs-*`, `--radius: 3px`. Font: Newsreader (titoli, cifre), IBM Plex Sans (interfaccia), IBM Plex Mono (letture). |
| `src/styles.css` | Stili dell'app. Niente vetro sfocato, niente ombre, niente gradienti. |
| `src/climate.js` | **Rimosso in v4.0.0** (modello termico euristico del Comfort Rate, non verificabile). È nella storia git. |

**Regola pratica:** ogni nuova stringa va aggiunta in **entrambe** le lingue di
`i18n.js`, e nell'HTML si marca l'elemento con `data-i18n` (o `-ph`, `-aria`,
`-title`). Un controllo veloce della parità:

```bash
python3 -c "
import re; s=open('src/i18n.js').read()
it=s[s.index('  it: {'):s.index('  en: {')]; en=s[s.index('  en: {'):]
ki=set(re.findall(r\"'([a-z0-9-]+)':\",it)); ke=set(re.findall(r\"'([a-z0-9-]+)':\",en))
print('ok' if ki==ke else sorted(ki^ke))"
```

---

## Servizi esterni (tutti gratuiti, senza chiave)

| Servizio | Uso | Note |
|---|---|---|
| OpenStreetMap tiles | mappa (solo `app.html`) | **Non usare CARTO**: marchia ogni stile con "API KEY REQUIRED" senza chiave. Zoom max 19. Mappa chiara ad alto contrasto. |
| Nominatim | ricerca indirizzi + confini | Accetta `it`, `va`, `sm` (Vaticano e San Marino sono enclavi italiane). |
| Overpass | edifici per classificazione pareti (esterno/interno) e ombre | Il più fragile: rate-limita spesso. C'è un fallback su due mirror, **mai verificato end-to-end**. Senza risposta, ogni parete resta prudenzialmente "esterna" (fallback conservativo, vedi voce 0). |
| Open-Meteo | clima (temperatura, umidità, vento, pioggia, **sole al suolo** `shortwave_radiation_sum`) | Il parametro `monthly` restituisce vuoto: si usa `daily` e si aggrega a mano. Cache `localStorage` con chiave `omc2_` (la v3 usava `omc_`, senza il sole). |

---

## In sospeso / Completati di recente

0. ~~**SunTrace 2.0: disegno della stanza + modello climatico d'ambiente**~~ —
   **completato** il 30/08/2026. Riscrittura architetturale dell'interazione
   centrale (piano approvato dall'utente, vedi CHANGELOG [3.0.0] per il
   riassunto prodotto):
   - **Interazione**: click-punto-singolo + bussola → disegno del perimetro
     della stanza (click per vertice, chiusura vicino al primo vertice con
     tolleranza `CLOSE_LOOP_TOLERANCE_M=1.2`, blocco istantaneo, bottone
     `#remove-room-btn` per rimuovere e riabilitare il disegno). Nessuna
     analisi finché non si disegna — anche al primo avvio (`startApp()` non
     chiama più nulla di equivalente al vecchio `analyzePoint` bootstrap).
   - **Stato**: `currentScan` (5 campi, un punto) → `currentRoom` (`vertices`,
     `locked`, `lat/lng`=centroide, `buildings`, `areaM2`, `walls[]`) +
     `roomGen` (guardia di staleness per le fetch async, sostituisce i
     confronti diretti su lat/lng).
   - **Geometria** (`shadow.js`): nuove `polygonArea`, `polygonCentroid`,
     `localToLatLng` (inversa di `localXY`), `classifyRoomEdges` (esterno se
     un lato è entro `EDGE_TOLERANCE_M` dal perimetro OSM dell'edificio
     ospite, altrimenti interno; nessun edificio trovato → tutto esterno,
     fallback conservativo). Rimossa `nearestFacadeAzimuth` (nessun chiamante
     rimasto); riusato invece `outwardNormalAz` per-lato.
     **`EDGE_TOLERANCE_M` abbassata da 2.5 a 1.0 m in v3.1.1** (segnalato
     dall'utente): a 2.5 m, una stanza disegnata vicino a uno **spigolo**
     dell'edificio poteva avere più lati entro soglia da muri diversi (quello
     a sinistra E quello in alto, es.), indipendentemente da come la stanza
     era ruotata — il controllo misura solo la distanza, non l'allineamento
     dell'angolo. Verificato con un caso concreto (stanza 4×6m ruotata di 25°
     vicino a uno spigolo): a 2.5m dava 3 lati esposti su 4, a 1.0m solo
     quello vero. Un controllo sull'angolo (il lato dev'essere parallelo al
     muro più vicino, non solo vicino) risolverebbe la causa alla radice
     invece del sintomo, ma non è stato implementato — deciso di provare
     prima la soglia più bassa, che basta per il caso segnalato.
     **Trappola pagata qui**: `outwardNormalAz(a,c,click)` ritorna l'azimut
     **verso** `click`, non lontano da esso — passando il centroide della
     stanza si ottiene l'azimut che guarda **dentro** la stanza. In `lockRoom()`
     va flippato di 180°: `(outwardNormalAz(a,c,centroidLocal)+180)%360`.
     Dimenticare il flip fa puntare ogni parete verso l'interno invece che
     verso l'esterno — un bug silenzioso, nessun errore, solo numeri sbagliati.
   - **Cache `monthlySunAccess`**: da singolo slot (`{key,byMonth}`, si
     autodistrugge ad ogni chiamata con `clat,clng` diversi) a `Map`
     multi-chiave — necessario perché un refresh chiama questa funzione una
     volta per parete esterna, ognuna con la propria origine.
   - **Modello climatico** (`climate.js`): nuova `roomSeasonalTemperatures`
     (non tocca la firma di `seasonalTemperatures`, la riusa una volta per
     parete esterna) + `applyRoomSizeDamping` (smorzamento sqrt-based sulla
     superficie, costanti interne `REF_ROOM_AREA_M2=16`,
     `INTERIOR_WALL_REF_C=19`, clamp `[0.5,1.8]`). Il numero "adesso"
     (`thermal-result`) NON passa dallo smorzamento per area — solo il
     pannello stagionale/Comfort Rate lo fa; scelta di scope deliberata, non
     nel piano approvato estenderlo anche al valore istantaneo.
   - **Bussola**: rimossa interamente — markup, CSS (`.compass*`),
     `initCompass`/`initCompassDrag`/`updateCompass`, widget mobile e la sua
     voce nell'array di mutua esclusione (ora due widget, non tre).
   - **Test**: 72 unit (da 60: +`polygonArea`/`polygonCentroid`/
     `classifyRoomEdges`/`localToLatLng` in `shadow.test.js`, +4
     `roomSeasonalTemperatures` in `climate.test.js`, rimosso il test di
     `nearestFacadeAzimuth`). 25 e2e (riscritti da zero, non più adattabili
     riga per riga al vecchio flusso — vedi trappole sotto per le due razze
     scoperte riscrivendoli).
   - **Non fatto in questa voce** (vedi anche "Pendenze" in CLAUDE.md): nessuna
     UI mostra l'area della stanza; un solo cuneo d'ombra rappresentativo dal
     centroide, non uno per parete; nessuna validazione contro poligoni
     auto-intersecanti/degeneri.

1. ~~**CI + self-hosting risorse esterne**~~ — **completato** il 27/08/2026,
   **prima esecuzione reale (ed effettivamente verde) il 28/08/2026**:
   `.github/workflows/ci.yml` esegue unit, parità i18n ed e2e su ogni push
   (i test NON possono girare su questa macchina, Node non è installato — la
   CI è l'unica rete di sicurezza attiva). Al primo giro reale ha trovato tre
   problemi, tutti sistemati nello stesso push: script `test`/`test:e2e` in
   `package.json` con un glob tra virgolette che Node 20 non espande da solo
   (va tolta la virgoletta, lo espande la shell); tre e2e rimasti agganciati a
   elementi rimossi in una modifica precedente (`#telemetry-cardinal`,
   `#val-manual-obs`, `#compass-state`); uno `z-index` mancante sul pulsante
   di chiusura del modale Comfort Rate, che un titolo abbastanza lungo poteva
   coprire rendendolo non cliccabile (vedi trappole sotto). Font e Leaflet ora
   in `vendor/`, zero CDN; privacy policy aggiornata di conseguenza (IT+EN).
   In `server/overpass-cache/` c'è un Cloudflare Worker con cache KV pronto al
   deploy (istruzioni nel suo README): finché `OVERPASS_PROXY_URL` in `ui.js`
   resta vuota il comportamento è identico a prima. **Il deploy del worker
   richiede un account Cloudflare: azione manuale.**
2. ~~**Layout mobile del simulatore**~~ — **completato** il 28/08/2026: sotto i
   768px la sidebar non è più bloccata. Il suo contenuto si sposta in una
   barra inferiore persistente (le 4 temperature stagionali + il Comfort
   Rate), un drawer "Impostazioni" (ricerca, mese/ora, infissi/isolamento), un
   foglio "Info" unico che unisce legenda e suggerimento, e — da v2.6.1 a
   v2.6.2 — tre widget a comparsa (solare/clima/bussola), **ora due** dalla
   voce 0 (la bussola non esiste più). Il blocco totale (schermo troppo
   piccolo per qualunque adattamento) scatta ora solo sotto i 320px.
3. ~~**Rotazione facciata su mobile**~~ — introdotta in v2.6.0/v2.6.1
   (bussola reparentata in un terzo widget mobile, drag-to-rotate libero in
   gradi). **Superseduta interamente dalla voce 0**: non esiste più alcuna
   bussola, né su desktop né su mobile, da rotare o reparentare — l'intera
   voce descrive codice ormai rimosso.
4. ~~**Marker non centrato nel cerchio**~~ — **completato** il 28/08/2026 (v1):
   fix storico su un marker Leaflet oggi anch'esso rimosso (non c'è più un
   singolo punto/marker trascinabile dalla voce 0 in poi — solo i marker di
   vertice durante il disegno, e il poligono bloccato). Lasciato per memoria
   storica del bug (centraggio di un `divIcon` via flexbox), utile se un
   futuro marker Leaflet mostrasse lo stesso sintomo.
5. ~~**Il 5° piano è il tetto**~~ — **completato** il 28/08/2026, **concetto
   ancora valido dopo la voce 0** ma l'implementazione è cambiata: `solar.js`
   ha ancora `roofIrradiance(elevation)`/`dailyRoofSunHours()` (niente azimut,
   un tetto non ha un lato a cui rivolgersi) e `seasonalTemperatures()` prende
   ancora un flag `isRoof`. In `ui.js`, `ROOF_FLOOR = 5` seleziona ancora
   questo ramo in `refreshUI()`. **Non più vero**: non esiste più una bussola
   da disattivare né una `facadeLine` da nascondere sulla mappa (entrambe
   rimosse alla radice dalla voce 0) — il tetto oggi ignora semplicemente
   `currentRoom.walls` e usa il solo centroide della stanza. **Non tocca**
   `sunBlocked`/`monthlySunAccess`: il ray-cast attraverso gli edifici OSM
   vicini resta identico, un tetto può comunque essere in ombra di un vicino
   più alto.
6. ~~**Landing page + separazione app**~~ — **completato** il 27/08/2026:
   `index.html` è ora la landing (mission/vision, 4 sezioni con grafici SVG
   animati, CTA), `app.html` è il simulatore. Ricerca sulla landing → redirect
   ad `app.html?q=...` che avvia la ricerca in automatico; link «← Home» nel
   simulatore per tornare indietro. **Non ancora testata con Playwright**
   (nessun e2e sulla landing: solo verificata a occhio via screenshot
   headless).
7. ~~**Deploy live**~~ — **completato il 02/09/2026**: SunTrace 2 è live su
   <https://holyemilio.github.io/suntrace2/> (GitHub Pages, root → `index.html`
   la landing, simulatore su `/app.html`). Corretto di conseguenza un link
   rimasto copiato da SunTrace 1: il footer di `app.html` puntava al GitHub di
   `holyemilio/Suntrace` (repo v1) invece che a `holyemilio/suntrace2`.
   SunTrace 1 resta separatamente live su <https://holyemilio.github.io/Suntrace/>.
   **Non ancora verificato con traffico reale multi-dispositivo** — vedi voce 15
   sui rischi da monitorare ora che il deploy è pubblico.
8. ~~**Pannelli comprimibili mappa (legenda + suggerimento)**~~ — **completato**
   il 27/08/2026: entrambi collassano in un bottone 42×42 (stessa misura del
   pulsante di geolocalizzazione) con animazione fluida; il testo del
   suggerimento è stato accorciato e reso più leggibile (font più grande,
   colore più chiaro) perché copriva troppo spazio sulla mappa. Su mobile
   legenda e suggerimento confluiscono in un unico foglio "Info" (vedi
   punto 2). Testo della legenda e del suggerimento riscritti nella voce 0
   per il nuovo flusso di disegno.
9. ~~**Bussola: testo duplicato**~~ — fix storico (v1/v2 iniziale) su un
   elemento (`#compass-state`) che non esiste più: l'intera bussola è stata
   rimossa dalla voce 0.
10. ~~**Regressione box Temperature**~~ — **completato**: il box si comprimeva a
   36px di altezza perché era l'unico elemento della sidebar con `overflow:
   hidden` mentre il flex-column della sidebar si restringeva per contenuto
   in eccesso. Fix: `flex-shrink: 0` su tutte le card della sidebar.
11. **Fallback mirror Overpass** — codice in `overpassQuery()`, mai provato per
   irraggiungibilità del servizio. Se le pareti restano tutte classificate
   "esterne" indipendentemente dalla geometria reale, è quasi certamente
   Overpass che non risponde (vedi il fallback conservativo nella voce 0).
12. **Landing page senza test automatici** — `landing.js`/`landing.css` sono
    stati verificati solo visivamente (screenshot Chrome headless). Prima di
    fidarsene in produzione varrebbe la pena aggiungere qualche caso a
    `tests/e2e/` (submit ricerca → redirect corretto, `?q=` raccolto da
    `app.html`, cambio lingua, reveal on scroll). Stesso discorso per il
    layout mobile: niente e2e sulla landing, solo screenshot headless (il
    layout mobile di `app.html` invece è coperto — T33/T34/T38 in
    `tests/e2e/app.e2e.js`).
13. **Documentazione utente non aggiornata** — ~~`docs/manuale-utente.html`,
    `docs/testbook.html` e `docs/testbook.csv` parlano ancora della vecchia
    struttura a pagina singola su desktop-only.~~ **Aggiornati alla voce 0**
    (manuale utente, testbook HTML e CSV riflettono ora il disegno della
    stanza, con gli ID allineati fra i due formati e agli e2e). Restano
    focalizzati sul solo simulatore: non descrivono la landing page né la
    navigazione a due pagine.
14. **Audit accessibilità WCAG 2.2** — deliberatamente rimandato a una fase
    separata futura (concordato con l'utente). Il lavoro mobile di questa
    sessione è stato costruito con attenzione ad aria-label/ruoli/focus, ma
    non è un audit completo.
15. **Rischi da deploy pubblico + uso multi-dispositivo** (nessun codice
    cambiato per questa voce, solo analisi — da tenere d'occhio ora che il
    sito è live):
    - **Overpass sotto carico reale**: è il servizio più fragile della
      pipeline (voce 3/11) e finora è sempre stato testato con un solo
      utente alla volta. Con più visitatori simultanei, i mirror pubblici
      possono rate-limitare l'IP del cliente (non condiviso tra dispositivi
      diversi, quindi il rischio è "tanti utenti lenti", non un utente che ne
      blocca altri) — l'effetto visibile è il fallback conservativo (ogni
      parete resta "esterna") che si attiva silenziosamente, senza errore in
      UI, mascherando un problema di rete da presunto errore di modello.
      **Mitigazione pronta ma non attivata**: il Cloudflare Worker in
      `server/overpass-cache/` (cache KV 30gg) — finché `OVERPASS_PROXY_URL`
      resta vuota in `ui.js` il rischio è intatto. Priorità alzata in
      CLAUDE.md ora che l'app è pubblica.
    - **Cache statica su GitHub Pages**: a differenza di `start.command`
      (`Cache-Control: no-store`), GitHub Pages non garantisce header
      no-cache sugli asset — browser e CDN possono servire JS/CSS vecchi
      dopo un deploy. Nessun cache-busting oggi (niente hash nei nomi file,
      niente `?v=` sugli script). Se un utente segnala "vedo la versione
      vecchia" dopo un aggiornamento pubblicato, è quasi certamente questo,
      non un bug applicativo — verificare prima con un reload forzato
      (svuota cache) prima di investigare altrove.
    - **`localStorage` è per-dispositivo, non sincronizzato**: la cache
      Overpass/Open-Meteo e la lingua salvata restano isolate per browser.
      Non è un bug (nessuno stato utente da sincronizzare, l'app non ha
      account) ma va tenuto a mente se un utente segnala comportamento
      diverso tra telefono e desktop: è normale, non è uno stato condiviso
      che si è disallineato.
    - **Nessuna UI per errori di rete/rate-limit**: se Overpass o Open-Meteo
      falliscono sotto carico, l'app degrada silenziosamente (fallback
      conservativo o tabella di Roma) invece di segnalarlo esplicitamente —
      con più utenti reali questo scenario diventa più probabile che in
      sviluppo locale.

---

16. ~~**v4.0.0: da Comfort Rate a costo in euro, per chi affitta**~~ —
    **completato il 23/10/2026**, su richiesta dell'utente («strumento per
    studenti e lavoratori in affitto, per abbattere i costi, NON deve essere
    AI slop; tutto deve essere verificato altrimenti non ha senso»).
    - **Prodotto**: il Comfort Rate a stelle, le temperature stagionali e le
      card infissi/isolamento sono stati tolti (indice inventato, scelte che
      un inquilino non può fare). Al loro posto: stima del riscaldamento in
      €/mese (forbice), quota a testa, risparmio massimo dal sole, confronto
      con stufetta elettrica, sei domande verificabili alla visita (con
      «Non so»), checklist generata, scheda condivisibile via URL. I dati
      tecnici (sole, ombre, clima, cursori) stanno in un `<details>` chiuso.
    - **Verifica**: ogni numero della proposta iniziale è stato controllato
      su fonti pubbliche. Sbagliati e corretti: prezzo gas (1,2 → 1,62 €/Smc),
      luce (0,28 → 0,4343 €/kWh), potere calorifico (PCI 9,6 → PCS 10,69),
      rendimento caldaia (0,90 → 0,86), ricambi d'aria (0,5 → 0,3), area
      finestre (20% della parete → 1/8 del pavimento, DM 5/7/1975), valori U
      (→ TABULA PoliTo). Tolti perché non verificabili: il fattore «f_sole»,
      la forbice fissa ±25%, gli apporti interni UNI/TS 11300-1, la
      correlazione mensile di Erbs (non trovata in fonti libere: si usa la
      correlazione oraria, verificata in Maleki et al. 2017). Tolti anche dalla
      landing i dati ISPRA/ENEA/ECCO e la stima «−20%» (non verificati).
    - **Decisioni dell'utente**: prezzi aggiornati a mano ogni mese (superato: ora automatici, voce 17)
      (`src/prices.js`); Comfort Rate eliminato (decisione delegata); dati
      tecnici dietro «Dettagli»; parametri nell'URL accettati per la privacy
      (aggiunta la sezione nella privacy policy).
    - **Design**: carta e inchiostro al posto del tema scuro «dark SaaS»;
      Newsreader + IBM Plex Sans al posto di Space Grotesk; icone SVG al posto
      delle emoji; niente glassmorphism, bagliori, gradienti, animazioni di
      reveal. Font scaricati da @fontsource 5.2.6 e self-hostati.
    - **Documentazione separata**: `README` funzionale (per chi usa l'app),
      `docs/metodo.md` tecnico (formule con legenda per ogni simbolo, fonti,
      esempio svolto), `docs/sviluppo.md` per chi modifica il codice. I
      documenti della v3 (manuale, testbook, case study, storyline) sono in
      `docs/archivio/`, superati.
    - **Aperto**: validare la stima con bollette vere (servono 3–5 stanze
      note con i consumi: non fatto, mancano i dati); la forbice con tutti
      «Non so» è molto ampia (es. 73–1.721 €/mese per 100 m² disegnati) — è
      onesta ma poco utile, l'app lo segnala.

---

17. ~~**Prezzi automatici da ARERA (v4.1.0)**~~ — **completato il 23/10/2026**:
    l'utente non può aggiornarli a mano. Fonte: i file Excel ufficiali ARERA
    linkati da arera.it/consumatori/valori-vulnerabilita-gas (gas) e
    arera.it/area-operatori/prezzi-e-tariffe (luce), un foglio per periodo,
    il primo è il più recente, valori **senza imposte**. Il vecchio link
    arera.it/aggiornamento-prezzi è morto (404). Le imposte non hanno una fonte
    leggibile da programma (riforma accise D.Lgs 43/2025 dal 2026, aliquote
    2026 non trovate): si usa un fattore calibrato sul totale del cliente tipo
    pubblicato da ARERA, da ricontrollare ogni gennaio (promemoria automatico).
    **Da tenere d'occhio**: il nome dei file cambia con l'anno (lo script prova
    l'anno corrente e il precedente); se ARERA cambia il layout delle tabelle,
    lo script fallisce e il workflow apre una segnalazione.

---

## Trappole già pagate

- **Cache del browser**: `start.command` ora invia `Cache-Control: no-store`. Se
  le modifiche "non si vedono", è quasi sempre un server vecchio ancora attivo.
- **Finestra < 768 px** (anche per zoom del browser): da v2.6.0 NON blocca più
  l'app. Attiva il layout mobile (barra inferiore, drawer, foglio Info,
  widget). Solo sotto i **320 px** (`MIN_USABLE_WIDTH` in `ui.js`) compare
  ancora l'avviso di blocco totale — non c'è più spazio per adattarsi.
- **`requestAnimationFrame` non è affidabile per aggiornare la UI**: può
  restare silenzioso in una tab in background o in un browser headless (così
  è stato scoperto, debuggando la bussola trascinabile). Per aggiornamenti
  che DEVONO succedere subito (drag, slider), chiamare `refreshUI()`
  direttamente e in modo sincrono, non dentro un rAF.
- **`[hidden]` vs classi per aprire/chiudere un pannello**: l'attributo
  `hidden` ha una specificità bassissima nella cascata UA — una regola autore
  con `display: block` (anche generica, tipo `.mobile-sheet { display:
  flex }`) lo sovrascrive sempre, e il pannello resta visibile. Per il foglio
  Info e il drawer mobile si usa una classe `.open` esplicita, non l'attributo
  `hidden`.
- **`.selector > * { position: relative }` sui contenitori di modali/pannelli**:
  promuove OGNI figlio (anche un titolo `<h2>` che segue nel DOM) a elemento
  posizionato con `z-index: auto`. Se nello stesso contenitore c'è un
  pulsante `position: absolute` senza `z-index` esplicito (es. il tasto di
  chiusura di un modale), un figlio successivo nel DOM può finirci sopra e
  intercettarne i click — è quello che ha trovato la CI sul modale Comfort
  Rate. Dare sempre uno `z-index` esplicito ai pulsanti di chiusura assoluti.
- **Space Grotesk arriva a 700**: chiedere `font-weight: 800` produce un
  grassetto sintetico.
- **`transform` CSS + `backdrop-filter`**: Chromium non risolve il click sugli
  elementi trasformati dentro un pannello sfocato. Ogni bottone flottante sulla
  mappa (`#geo-btn`, `#remove-room-btn`, ecc.) è posizionato con `left`/`top`
  espliciti proprio per questo — mai `transform: translate(...)` per un
  bottone dentro `.map-floating-btn` o un pannello con `backdrop-filter`.
- **Bottoni flottanti sulla mappa: verificare le coordinate reali, non a occhio**
  — `#remove-room-btn` era stato messo a `top:66px;left:14px`, la stessa
  posizione di `#map-hint` (il pannello 💡): da compresso, `#map-hint` è
  anch'esso un quadrato 42×42 nello stesso punto esatto, quindi il nuovo
  bottone ci finiva sopra e ne rendeva impossibile la riapertura (bug trovato
  dall'utente in v3.1.0). Prima di piazzare un nuovo elemento `position:
  absolute` sulla mappa, misurare con Playwright (`boundingBox()`) ogni stato
  (aperto/chiuso) degli elementi vicini — non basta controllare la posizione
  di default, un pannello comprimibile cambia dimensione.
- **`outwardNormalAz(a, c, click)` (in `shadow.js`) ritorna l'azimut VERSO
  `click`, non lontano da esso** — il nome/commento può ingannare. Per
  l'azimut di un lato di poligono che deve puntare **verso l'esterno**
  rispetto a un punto **interno** (es. il centroide della stanza in
  `lockRoom()`, `ui.js`), va flippato di 180° dopo la chiamata:
  `(outwardNormalAz(a,c,centroidInterno)+180)%360`. Passare il centroide
  senza flip fa puntare ogni parete verso l'interno — nessun errore a runtime,
  solo azimut sistematicamente sbagliati di 180°.
- **`monthlySunAccess` (in `shadow.js`) va chiamata una volta per parete/punto
  di osservazione nello stesso refresh** (non più una sola volta per l'intero
  punto analizzato, come nel modello v1): la sua cache interna è una `Map`
  multi-chiave proprio per questo. Se in futuro si torna a un'unica chiamata
  per refresh, va bene anche un singolo slot — ma se si aggiunge un'altra
  fonte di chiamate multiple per ciclo, verificare che la chiave includa tutto
  ciò che varia (oggi: lat/lng arrotondati, altezza osservatore, numero di
  edifici), altrimenti risultati diversi si sovrascrivono a vicenda.
- **L'indicatore "Sole diretto"** distingue tre casi: in sole, in ombra per un
  edificio, e sole sull'altro lato (parete rivolta altrove). Non fonderli.
- **Flex-column + `overflow: hidden`**: un elemento con `overflow` diverso da
  `visible` dentro un flex container ha "automatic minimum size" pari a 0. Se
  il contenuto totale della sidebar supera l'altezza disponibile, il flexbox
  scarica TUTTO il ridimensionamento su quell'elemento (lo schiaccia), mentre
  gli altri (dimensione minima = contenuto) restano intatti. `#sidebar > *`
  ha ora `flex-shrink: 0` proprio per questo — se serve `overflow: hidden` su
  una nuova card (es. per ritagliare un elemento decorativo), non toglierlo.
- **`landing.css` non importa `styles.css`**: quest'ultimo fissa
  `body { overflow: hidden; height: 100vh }` per il layout fisso del
  simulatore, che romperebbe lo scroll normale della landing. Le due pagine
  condividono solo `tokens.css` (i design token in `:root`).
- **`page.waitForFunction(fn, { timeout: N })` in Playwright (non `@playwright/test`,
  l'API "core" usata da `tests/e2e/app.e2e.js`) — l'oggetto opzioni finisce
  silenziosamente nell'`arg` della funzione, non nelle opzioni**, se non si
  passa esplicitamente `undefined` come secondo parametro:
  `page.waitForFunction(fn, undefined, { timeout: N })`. Senza, il timeout
  dichiarato viene ignorato e si usa sempre il default di Playwright (30s) —
  verificato con un microbenchmark diretto. Bug trovato il 31/08/2026 in
  `drawAndAnalyse()` (mascherava un secondo bug reale, vedi sotto, facendolo
  fallire dopo 30s invece che 8s).
- **T33 (finestra che si restringe → layout mobile) era flaky in CI, non
  riproducibile nei primi run locali**: aspettava solo che `#mobile-bottom-bar`
  diventasse visibile via CSS dopo `setViewportSize`, ma quello scatta
  indipendentemente dal listener JS `resize` che deve ancora chiamare
  `map.invalidateSize()`. Disegnando la stanza prima che il resize JS finisse,
  Leaflet calcolava i vertici sulla sua dimensione interna ancora pre-resize:
  il controllo di chiusura dell'anello non tornava mai e `drawAndAnalyse()`
  restava bloccato fino al timeout. **Riprodotto in locale (1 fallimento su 8
  run)** una volta isolato — non è mai stato un problema specifico della CI.
  Fix: aspettare un segnale JS-driven reale (il reparent di
  `#energy-class-field` dentro la barra, fatto da `initMobileLayout()` nello
  stesso handler sincrono che chiama `invalidateSize()`), non la visibilità
  CSS. 20/20 run locali puliti dopo il fix.
- **Controlli dentro un `<details>` chiuso (v4.0.0)**: i cursori mese/ora stanno
  in «Dettagli tecnici». `locator.fill()` di Playwright aspetta che l'elemento
  sia visibile e, con il `<details>` chiuso, resta fermo fino al timeout di
  30 s senza un messaggio chiaro. Negli e2e si apre prima la sezione
  (`showDetails(page)`); `textContent()` invece funziona anche da chiuso.
- **`hidden` su un elemento con `display` d'autore (v4.0.0)**: `#cost-lines` è
  un `<dl class="result-lines">` con `display: flex`, che batte l'attributo
  `hidden`. Serve la regola esplicita `.result-lines[hidden] { display: none }`
  — stessa trappola dei fogli mobile, in un punto nuovo.
- **Link `.md` su GitHub Pages**: Pages (Jekyll) trasforma `docs/metodo.md` in
  `docs/metodo.html`, quindi un link relativo al `.md` si rompe online. App e
  landing linkano la versione su github.com, che rende anche le formule.
- **La guida della prima visita copre tutta l'app (v4.4.0)**: un test e2e che
  apre un contesto pulito trova l'overlay sopra la mappa e ogni clic va a
  vuoto. `openApp()` in `app.e2e.js` imposta `suntrace_tour_done` con
  `addInitScript` prima del caricamento; solo T51 passa `tour: true`.

