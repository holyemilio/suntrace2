# SunTrace 2 — Case Study Tecnico

## Problema

Gli strumenti professionali per l'analisi solare urbana (EnergyPlus, Helios3D, Autodesk Insight) richiedono licenze costose, software desktop installato e file di input complessi. Un proprietario di immobile, un agente immobiliare o un piccolo studio di architettura che vuole stimare rapidamente l'esposizione solare di un appartamento in un contesto urbano italiano non ha strumenti accessibili, gratuiti e sufficientemente accurati.

## Soluzione

SunTrace 2 è un simulatore microclimatico urbano zero-dependency deployabile come pagina web statica su GitHub Pages. Invece di analizzare un punto singolo con orientamento scelto a mano (bussola), l'utente **disegna il perimetro della propria stanza**: ogni lato diventa una parete, classificata automaticamente esposta o interna confrontando il poligono col perimetro reale dell'edificio OSM. L'app calcola in tempo reale:

- Posizione solare precisa (errore < 0.5°) via algoritmi Meeus/SPA
- Classificazione automatica di ogni parete (esposta al sole / verso un altro vano) e il suo stato attuale (sole diretto o in ombra)
- Stima termica stagionale a livello di stanza, pesata per lunghezza delle pareti esterne e smorzata in base alla superficie
- Classe energetica indicativa (A–G) con KPI di risparmio

## Architettura

```
Utente → disegno perimetro (Leaflet) → ui.js
                                          ├── solar.js (Meeus)  → posizione, alba/tramonto, ore sole
                                          ├── shadow.js         → pareti, classificazione, ombre (ray-cast OSM)
                                          └── climate.js        → temperatura a livello stanza, classe energetica, KPI
```

Il motore astronomico (`solar.js`) e la geometria (`shadow.js`) sono completamente disaccoppiati dal DOM: possono essere importati in Node.js, web worker o server-side. I 72 unit test vengono eseguiti con `node --test` nativo (Node 18+), senza framework di test.

## Algoritmi principali

### Declinazione solare (Meeus cap. 25)
```
L₀ = 280.46646 + 36000.76983·T        # longitudine media
M  = 357.52911 + 35999.05029·T        # anomalia media
C  = (1.914602 − 0.004817·T)·sin M + …  # equazione del centro
δ  = arcsin(sin ε · sin λ_app)         # declinazione
```

### Equazione del tempo (Meeus cap. 28)
```
y = tan²(ε/2)
E = [y·sin 2L₀ − 2e·sin M + 4ey·sin M·cos 2L₀ − ½y²·sin 4L₀ − 5/4·e²·sin 2M] × 4 min
```

### Angolo orario con correzione longitudinale e DST
```
TST = UTC_ore + lon/15 + E/60
HA  = 15·(TST − 12)
```
Il passaggio ora locale → UTC usa `Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome' })` per gestire automaticamente ora legale e fuso.

### Rifrazione atmosferica (Bennet)
```
R = 1.02 / (60·tan(elev + 10.3/(elev + 5.11)))  gradi
```

## Risultati

| Metrica | Valore |
|---|---|
| Accuratezza elevazione | < 0.5° vs SunCalc (23 casi testati) |
| Accuratezza azimut | < 1.0° vs SunCalc |
| Errore alba/tramonto | < 6 min vs SunCalc |
| Copertura test | 72 unit (motore solare, clima, geometria) + 25 e2e |
| Dipendenze runtime | 0 (Leaflet e font self-hostati in `vendor/`; API pubbliche senza chiave: OSM, Nominatim, Overpass, Open-Meteo) |
| Build step | Nessuno (ES modules nativi) |

## Deploy

Nessun build step: `git push` + GitHub Pages attivo = live in 60 secondi.
Live su <https://holyemilio.github.io/suntrace2/>.
