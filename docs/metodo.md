# Come SunTrace 2 calcola il costo del riscaldamento

SunTrace 2 stima quanto costa scaldare la stanza che hai disegnato, in euro al
mese, durante la stagione di riscaldamento. Il risultato è sempre una
**forbice**: il numero basso usa il caso migliore di ogni valore incerto, il
numero alto il caso peggiore. Ogni risposta alle domande della visita la
stringe, ogni «Non so» la allarga.

Il calcolo è in [`src/cost.js`](../src/cost.js), i prezzi in
[`src/prices.js`](../src/prices.js). Ogni costante ha una fonte pubblica,
elencata in fondo. Dove un valore non era verificabile l'abbiamo tolto, invece
di inventarlo.

Il calcolo si fa in quattro passi:

1. [Quanto calore perde la stanza](#1-quanto-calore-perde-la-stanza)
2. [Quanto freddo fa nella stagione di riscaldamento](#2-quanto-freddo-fa-nella-stagione-di-riscaldamento)
3. [Quanto sole entra dalle finestre](#3-quanto-sole-entra-dalle-finestre)
4. [Quanto costa in euro](#4-quanto-costa-in-euro)

---

## 1. Quanto calore perde la stanza

```math
H = \sum_{\text{pareti esterne}} \left( A_{muro} \cdot U_{muro} + A_{fin} \cdot U_{fin} \right) + A \cdot U_{soffitto} + A \cdot U_{pavimento} + 0{,}34 \cdot n \cdot V
```

| Simbolo | Cos'è | Unità | Da dove viene |
| --- | --- | --- | --- |
| *H* | Quanto calore perde la stanza per ogni grado di differenza tra dentro e fuori | W/K | il risultato |
| *A* | Superficie del pavimento della stanza | m² | dal poligono che disegni |
| *A_muro* | Parte piena di una parete esterna: lunghezza × 2,70 m, meno le finestre | m² | lunghezza dal disegno, altezza dal DM 5/7/1975 |
| *A_fin* | Superficie delle finestre: 1/8 del pavimento, divisa tra le pareti esterne in proporzione alla lunghezza | m² | minimo di legge del DM 5/7/1975 |
| *U_muro* | Quanto calore lascia passare 1 m² di muro per ogni grado | W/(m²·K) | TABULA, per epoca del palazzo |
| *U_fin* | Lo stesso, per una finestra intera (vetro + telaio) | W/(m²·K) | TABULA, per tipo di vetro |
| *U_soffitto* | Il soffitto, solo se sopra c'è il tetto o un sottotetto | W/(m²·K) | TABULA, per epoca |
| *U_pavimento* | Il pavimento, solo se sotto c'è cantina, garage o terreno | W/(m²·K) | TABULA, per epoca |
| *n* | Quante volte all'ora si rinnova l'aria della stanza | 1/h | 0,3 (UNI/TS 11300-1); 0,5 nel caso peggiore (UNI EN 12831) |
| *V* | Volume della stanza: *A* × 2,70 m | m³ | dal disegno |
| 0,34 | Energia per scaldare di 1 grado 1 m³ d'aria | Wh/(m³·K) | costante fisica |

Quali pareti sono «esterne» lo decide il confronto con il perimetro reale del
palazzo su OpenStreetMap: una parete a ridosso del muro esterno disperde, una
verso un'altra stanza no (si assume che anche quella sia scaldata).

### Valori *U* per epoca (TABULA, Politecnico di Torino 2011)

| Epoca del palazzo | *U_muro* min · tipico · max | *U_soffitto* | *U_pavimento* |
| --- | --- | --- | --- |
| Prima del 1950 | 1,02 · 1,48 · 2,40 | 1,65 · 1,96 · 2,86 | 1,30 · 1,58 · 2,04 |
| 1950–1975 | 1,10 · 1,26 · 1,76 | 1,65 · 1,65 · 2,20 | 1,30 · 1,30 · 2,00 |
| 1976–1990 | 0,76 · 0,78 · 0,82 | 0,95 · 0,97 · 1,14 | 0,98 · 0,98 · 1,24 |
| 1991–2005 | 0,59 · 0,60 · 0,62 | 0,64 · 0,69 · 0,74 | 0,77 · 0,77 · 0,93 |
| Dopo il 2005 | 0,34 | 0,30 | 0,33 |
| Non so | 0,34 · 1,48 · 2,40 | 0,30 · 1,65 · 2,86 | 0,33 · 1,30 · 2,04 |

Il minimo e il massimo coprono i tipi di muro in laterizio di quell'epoca
nella tabella 4 di TABULA. Prima del 1976 nei muri non c'è isolante; dal 1976
inizia un isolamento basso, dal 1991 medio, dal 2005 i limiti di legge
(D.Lgs 192/2005 e 311/2006).

### Valori delle finestre (TABULA, tabella 5)

| Vetro | *U_fin* (telaio in legno … in metallo) | *g* (quanta luce del sole passa) |
| --- | --- | --- |
| Vetro singolo | 4,9 … 5,7 | 0,85 |
| Doppio vetro | 2,8 … 3,7 | 0,75 |
| Doppio vetro basso emissivo | 2,2 … 2,4 | 0,67 |
| Non so | 2,2 … 5,7 | 0,85 |

**Come riconoscerlo alla visita:** avvicina al vetro una fiamma o la torcia del
telefono e conta i riflessi. Ogni lastra ne fa due, quindi 2 riflessi = vetro
singolo, 4 = doppio vetro. Se uno dei riflessi è violaceo, una faccia ha lo
strato basso emissivo
([forum Edilclima](https://forum.edilclima.it/viewtopic.php?p=51782)).

---

## 2. Quanto freddo fa nella stagione di riscaldamento

```math
GG = \sum_{\text{mesi}} g_m \cdot \max(0,\ 20 - T_m)
```

| Simbolo | Cos'è | Unità | Da dove viene |
| --- | --- | --- | --- |
| *GG* | Gradi giorno: quanto freddo c'è stato in tutta la stagione | °C·giorno | il risultato |
| *g_m* | Giorni del mese *m* in cui si può accendere il riscaldamento | giorni | DPR 74/2013, per zona |
| *T_m* | Temperatura media del mese *m*, media 1991–2020 | °C | Open-Meteo, nel punto disegnato |
| 20 | Temperatura interna convenzionale | °C | DPR 412/93 |

La **zona climatica** dipende dai gradi giorno (DPR 412/93): A fino a 600, B
fino a 900, C fino a 1.400, D fino a 2.100, E fino a 3.000, F oltre. Ogni zona
ha il suo periodo di accensione (DPR 74/2013, art. 4):

| Zona | Periodo | Giorni |
| --- | --- | --- |
| A | 1 dicembre – 15 marzo | 105 |
| B | 1 dicembre – 31 marzo | 121 |
| C | 15 novembre – 31 marzo | 137 |
| D | 1 novembre – 15 aprile | 166 |
| E | 15 ottobre – 15 aprile | 183 |
| F | nessun limite di legge | 365 |

SunTrace sceglie la zona il cui periodo produce gradi giorno che cadono in
quella stessa zona (se più di una, la più fredda). Usiamo il clima recente
(1991–2020) invece della tabella di legge del 1993, che è basata su anni più
freddi: per Milano il DPR dà 2.404 gradi giorno, il modello climatico di
Open-Meteo ne dà circa 2.575. La zona di legge del comune resta in ogni caso
quella del DPR 412/93.

L'energia che serve senza contare il sole, mese per mese, è:

```math
Q_m = \frac{H \cdot \max(0,\ 20 - T_m) \cdot 24 \cdot g_m}{1000}
```

con *Q_m* in kWh: le 24 ore sono una giornata di riscaldamento continuo a
20 °C, come nel calcolo standard. Chi scalda meno ore spende meno: anche per
questo la stima tende al rialzo.

---

## 3. Quanto sole entra dalle finestre

```math
S_m = \sum_{\text{pareti esterne}} A_{fin} \cdot g \cdot I_m \cdot g_m
```

| Simbolo | Cos'è | Unità | Da dove viene |
| --- | --- | --- | --- |
| *S_m* | Calore del sole che entra dalle finestre nel mese *m* | kWh | il risultato |
| *A_fin* | Finestre di quella parete | m² | vedi passo 1 |
| *g* | Quanta energia del sole passa dal vetro | – | TABULA, tabella 5 |
| *I_m* | Sole che arriva in un giorno medio del mese su quella parete, ombre comprese | kWh/m² | calcolato, vedi sotto |
| *g_m* | Giorni di riscaldamento del mese | giorni | DPR 74/2013 |

*I_m* si calcola così, ogni 10 minuti del giorno medio del mese (17 gennaio,
16 febbraio, 16 marzo, 15 aprile, … 10 dicembre, i giorni di Klein):

1. **Sole sul piano orizzontale.** Open-Meteo dà il sole medio giornaliero sul
   terreno *H*. Il rapporto *K_T* = *H* / *H₀*, dove *H₀* è il sole sopra
   l'atmosfera (costante solare 1.367 W/m², corretta per la distanza Terra-Sole),
   dice quanto è limpido il cielo.
2. **Diretto e diffuso.** La quota di luce diffusa dal cielo viene dalla
   correlazione di Erbs:
   ```math
   \frac{I_d}{I} = 0{,}9511 - 0{,}1604\,K_T + 4{,}388\,K_T^2 - 16{,}638\,K_T^3 + 12{,}336\,K_T^4
   ```
   (per 0,22 < *K_T* ≤ 0,8; 1 − 0,09 *K_T* sotto, 0,165 sopra).
3. **Sulla parete verticale.** Il sole diretto conta solo se la parete è
   rivolta verso il sole **e** nessun palazzo di OpenStreetMap lo copre,
   guardando dal piano scelto (un raggio verso il sole ogni 10 minuti). Il
   diffuso arriva per metà (la parete vede metà cielo), e si aggiunge la luce
   riflessa dal terreno (albedo 0,2), sempre per metà.

Questo dà il **massimo** che il sole può fare: il vetro è considerato tutto
trasparente (niente telaio) e tutto il calore entrato viene contato come utile.
Per questo l'app dice «fino a».

---

## 4. Quanto costa in euro

L'energia della stagione è la somma dei mesi:

```math
Q = \sum_{\text{mesi}} \max(0,\ Q_m - S_m)
```

Poi dipende da come si scalda la casa:

| Riscaldamento | Costo della stagione | Valori usati |
| --- | --- | --- |
| Caldaia a gas | *Q* / (*η* · 10,69) × prezzo del gas | *η* = 0,94 · 0,86 · 0,75 |
| Pompa di calore o condizionatore | *Q* / *SCOP* × prezzo della luce | *SCOP* = 4,0 · 3,4 · 2,8 |
| Stufetta elettrica | *Q* × prezzo della luce | rendimento 1 |
| Centralizzato | come la caldaia a gas: è il consumo stimato della stanza; quanto paghi dipende anche dalla ripartizione del condominio, e l'app lo dice | come sopra |
| Non so | calcolato come caldaia a gas, e l'app lo dice | – |

| Simbolo | Cos'è | Da dove viene |
| --- | --- | --- |
| *η* | Rendimento stagionale della caldaia, sul potere calorifico superiore: 0,86 è il minimo di legge per le caldaie nuove dal 26/9/2015, 0,75 il minimo delle caldaie B1, 0,94 una condensazione di classe A | Reg. UE 813/2013 |
| 10,69 | kWh contenuti in 1 Smc di gas (potere calorifico superiore convenzionale, la base delle bollette) | ARERA, TIVG |
| *SCOP* | Quanti kWh di calore per ogni kWh di corrente in una stagione: classe C (2,8), A (3,4), A+ (4,0) | Reg. UE 626/2011, allegato II |
| prezzo del gas | Prezzo ARERA del cliente tipo (1.100 Smc/anno) per l'**ambito tariffario** della regione della stanza, imposte comprese; settembre 2026: da 1,54 €/Smc (nord-est) a 1,76 €/Smc (sud e isole) | ARERA, `G<anno>_stv.xlsx` |
| prezzo della luce | Prezzo ARERA del cliente tipo (2.000 kWh/anno, 3 kW, residente), imposte comprese; ottobre–dicembre 2026: 0,4343 €/kWh | ARERA, `E<anno>-smt.xlsx` |

L'importo **al mese** è il costo della stagione diviso per i mesi di
riscaldamento della zona (giorni / 30,4). Con più persone l'app divide anche
per il numero di persone.

### Come si costruisce la forbice

| | Numero basso | Numero alto |
| --- | --- | --- |
| Muri, finestre, soffitto, pavimento | *U* minimo dell'epoca | *U* massimo dell'epoca |
| «Non so» su tetto o cantina | non c'è | c'è |
| Ricambio d'aria *n* | 0,3 | 0,5 |
| Sole dalle finestre | tutto quello possibile | nessuno |
| Caldaia / pompa di calore | la più efficiente | la meno efficiente |

La riga **«Il sole»** nell'app usa invece i valori tipici e mostra la
differenza tra «senza sole» e «con tutto il sole possibile».

---

## Esempio svolto

Una stanza di 16 m² a Milano, piano intermedio, pareti esterne a nord e a est
(4 m ciascuna), palazzo 1950–1975, doppio vetro, caldaia a gas, nessun palazzo
vicino. Valori tipici:

| Passo | Calcolo | Risultato |
| --- | --- | --- |
| Finestre | 16 / 8 | 2,0 m² |
| Muro pieno | 8 × 2,70 − 2,0 = 19,6 m² × 1,26 | 24,7 W/K |
| Finestre | 2,0 m² × 2,8 | 5,6 W/K |
| Aria | 0,34 × 0,3 × 43,2 m³ | 4,4 W/K |
| *H* | somma | 34,7 W/K |
| Gradi giorno, zona E | Open-Meteo 1991–2020 | ≈ 2.575 |
| Senza sole | 34,7 × 2.575 × 24 / 1000 | ≈ 2.144 kWh |
| Con il sole | meno il sole dalle finestre a nord ed est | ≈ 1.779 kWh |

Con il prezzo del gas dell'ambito nord-orientale (Lombardia) di settembre 2026,
1,5373 €/Smc, l'app mostra **40–97 € al mese** (da ottobre ad aprile) e «il
sole ti fa risparmiare fino a 10 € al mese». Le cifre cambiano ogni mese con i
prezzi ARERA. La stessa
stanza con una stufetta elettrica: 114–220 € al mese. Il test
[`tests/cost.test.js`](../tests/cost.test.js) controlla questi passaggi.

---

## Cosa non contiamo

- **Il calore di persone ed elettrodomestici.** La formula della UNI/TS 11300-1
  per gli apporti interni non era verificabile da fonti libere: l'abbiamo
  lasciata fuori. La stima tende quindi al rialzo.
- **Le abitudini.** Contiamo 20 °C per 24 ore nei giorni ammessi. Chi scalda
  meno ore spende meno.
- **L'acqua calda e la cucina.** Non dipendono dall'esposizione della stanza.
- **Il caldo d'estate in euro.** Molti non hanno il condizionatore: un numero
  sarebbe inventato. L'app segnala invece le stanze sotto il tetto con pareti a
  sud o a ovest.
- **I ponti termici e la massa dei muri.** Servirebbe un calcolo dinamico.
- **L'ombra sulla luce diffusa.** I palazzi vicini tolgono solo il sole diretto.

---

## Come si aggiornano i prezzi

**Da soli, ogni mese.** Il file [`src/prices.js`](../src/prices.js) è generato
da [`scripts/update_prices.py`](../scripts/update_prices.py), che un'azione
GitHub ([`update-prices.yml`](../.github/workflows/update-prices.yml)) esegue
i giorni 3, 5 e 8 di ogni mese:

1. Scarica i due file ufficiali di ARERA, con i prezzi **al netto delle
   imposte** e un foglio per periodo:
   [`G<anno>_stv.xlsx`](https://www.arera.it/consumatori/valori-vulnerabilita-gas)
   per il gas (ogni mese, per ambito tariffario) e
   [`E<anno>-smt.xlsx`](https://www.arera.it/area-operatori/prezzi-e-tariffe)
   per la luce (ogni trimestre).
2. Dal foglio più recente calcola la spesa del **cliente tipo** ARERA: gas
   1.100 Smc/anno a scaglioni, più la quota fissa del contatore G6; luce
   2.000 kWh/anno, 3 kW, residente, più quota fissa e quota potenza. Divide per
   il consumo e ottiene un prezzo medio.
3. Aggiunge le imposte con un **fattore** (vedi sotto).
4. Se un prezzo cambia più del 40% rispetto al mese prima, o se un file non si
   legge, **non pubblica** e apre una segnalazione su GitHub. L'app continua a
   usare gli ultimi prezzi validi.
5. Altrimenti lancia i test e pubblica.

**Le imposte.** I file ARERA non le contengono. Il fattore in
[`scripts/price-taxes.json`](../scripts/price-taxes.json) è il rapporto, nello
stesso periodo, tra la spesa del cliente tipo **con** imposte pubblicata da
ARERA e quella **senza** imposte calcolata dai file: 1,2553 per il gas
(settembre 2026), 1,1063 per la luce (ottobre–dicembre 2026). Tratta accise,
addizionale regionale e IVA come un'unica percentuale: è un'approssimazione di
pochi punti, perché le accise sono in realtà un importo fisso per Smc. Il
fattore cambia solo quando cambiano le imposte: ogni gennaio l'azione apre un
promemoria per ricontrollarlo.

**Quale ambito.** La regione della stanza (dalla ricerca inversa di
Nominatim) sceglie l'ambito, con le regioni elencate nei file ARERA
([`src/ambiti.js`](../src/ambiti.js)). Se la regione non si trova, si usa la
media dei sei ambiti della penisola.

---

## Fonti

- **ARERA**, nota stampa del 2/10/2026, prezzo di riferimento del gas per il
  cliente tipo, settembre 2026:
  [PDF](https://www.arera.it/fileadmin/allegati/com_stampa/26/Nota_stampa_aggiornamento_mensile_vulnerabili_gas_SETTEMBRE_2026.pdf).
- **ARERA**, prezzo di riferimento dell'elettricità, IV trimestre 2026, via
  [Il Sole 24 Ore Radiocor](https://en.ilsole24ore.com/radiocor/nRC_29.09.2026_18.49_64610646).
- **ARERA, TIVG**: potere calorifico superiore convenzionale 10,69 kWh/Smc, via
  [luce-gas.it](https://luce-gas.it/guida/tariffe/conversione-kwh-smc).
- **Corrado, Ballarini, Corgnati, Talà**, *Building Typology Brochure – Italy*
  (TABULA), Politecnico di Torino, 2011, tabelle 4 e 5:
  [PDF](https://iris.polito.it/bitstream/11583/2465779/1/Italian%20Typology%20Brochure.pdf).
- **DPR 412/1993**: zone climatiche e gradi giorno; **DPR 74/2013**, art. 4:
  periodi e ore di accensione, via
  [Infobuild](https://www.infobuild.it/approfondimenti/accensione-riscaldamento-2026-orari-zona-climatica/).
- **DM 5 luglio 1975**: altezza minima 2,70 m, finestre ≥ 1/8 del pavimento:
  [testo](https://www.bosettiegatti.eu/info/norme/statali/1975_dm_05_07.htm).
- **Reg. UE 813/2013**: rendimento stagionale minimo delle caldaie, via
  [Vaillant](https://Vaillant.it/downloads/utente/incentivi-fiscali/erp-etichetta-energetica/v-approfondimento-direttive-erp-ed-eld-1297776.pdf).
- **Reg. UE 626/2011**, allegato II: classi SCOP dei condizionatori:
  [testo](https://www.legislation.gov.uk/eur/2011/626/annex/II/adopted).
- **UNI/TS 11300-1**: 0,3 ricambi d'aria all'ora nel residenziale, via
  [forum Edilclima](https://forum.edilclima.it/viewtopic.php?p=31684).
- **Maleki, Hizam, Gomes**, *Estimation of Hourly, Daily and Monthly Global
  Solar Radiation on Inclined Surfaces: Models Re-Visited*, Energies 10, 134
  (2017): correlazione di Erbs (tab. 2), sole su superfici inclinate e giorni
  medi di Klein (tab. 9):
  [articolo](https://www.mdpi.com/1996-1073/10/1/134).
- **D.Lgs 192/2005**, art. 6 c. 8: obbligo di indicare la classe energetica
  negli annunci (sanzione 500–3.000 €), via
  [Ediltecnico](https://ediltecnico.it/attestato-prestazione-energetica-ape-obbligatorio-non-obbligatorio/).
- **Open-Meteo Climate API**, modello EC_Earth3P_HR, 1991–2020:
  [documentazione](https://open-meteo.com/en/docs/climate-api).
- **OpenStreetMap** (via Overpass): perimetri e altezze degli edifici.
