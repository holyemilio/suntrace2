# How SunTrace estimates the heating cost

SunTrace estimates what it costs to heat the room you drew, in euro a month,
over the heating season. It shows a **most likely figure** and a **range**:
the low end takes the best case of every uncertain value, the high end the
worst. Every answer to the viewing questions narrows the range; every "Don't
know" widens it.

The calculation is in [`src/cost.js`](../src/cost.js), the prices in
[`src/prices.js`](../src/prices.js). Every constant has a public source,
listed at the end. Where a value couldn't be verified, we removed it instead
of inventing it.

The calculation has four steps:

1. [How much heat the room loses](#1-how-much-heat-the-room-loses)
2. [How cold the heating season is](#2-how-cold-the-heating-season-is)
3. [How much sun comes in through the windows](#3-how-much-sun-comes-in-through-the-windows)
4. [What it costs in euro](#4-what-it-costs-in-euro)

---

## 1. How much heat the room loses

```math
H = \sum_{\text{outside walls}} \left( A_{wall} \cdot U_{wall} + A_{win} \cdot U_{win} \right) + A \cdot U_{ceiling} + A \cdot U_{floor} + 0.34 \cdot n \cdot V
```

| Symbol | What it is | Unit | Where it comes from |
| --- | --- | --- | --- |
| *H* | How much heat the room loses for each degree of difference between inside and outside | W/K | the result |
| *A* | Floor area of the room | m² | the polygon you draw |
| *A_wall* | Solid part of an outside wall: length × 2.70 m, minus the windows | m² | length from the drawing, height from DM 5/7/1975 |
| *A_win* | Window area: 1/8 of the floor, shared among the outside walls by length | m² | legal minimum, DM 5/7/1975 |
| *U_wall* | How much heat 1 m² of wall lets through per degree | W/(m²·K) | TABULA, by building period |
| *U_win* | The same, for a whole window (glass + frame) | W/(m²·K) | TABULA, by glazing |
| *U_ceiling* | The ceiling, only when the roof or an attic is above | W/(m²·K) | TABULA, by period |
| *U_floor* | The floor, only when a cellar, garage or the ground is below | W/(m²·K) | TABULA, by period |
| *n* | How many times an hour the room's air is replaced | 1/h | 0.3 (UNI/TS 11300-1); 0.5 in the worst case (UNI EN 12831) |
| *V* | Room volume: *A* × 2.70 m | m³ | the drawing |
| 0.34 | Energy to warm 1 m³ of air by 1 degree | Wh/(m³·K) | physical constant |

Which walls are "outside" is decided by comparing each side with the
building's real outline on OpenStreetMap: a side on the outer wall loses heat,
a side towards another room doesn't (that room is assumed heated too).

### U-values by building period (TABULA, Politecnico di Torino 2011)

| Building period | *U_wall* min · typical · max | *U_ceiling* | *U_floor* |
| --- | --- | --- | --- |
| Before 1950 | 1.02 · 1.48 · 2.40 | 1.65 · 1.96 · 2.86 | 1.30 · 1.58 · 2.04 |
| 1950–1975 | 1.10 · 1.26 · 1.76 | 1.65 · 1.65 · 2.20 | 1.30 · 1.30 · 2.00 |
| 1976–1990 | 0.76 · 0.78 · 0.82 | 0.95 · 0.97 · 1.14 | 0.98 · 0.98 · 1.24 |
| 1991–2005 | 0.59 · 0.60 · 0.62 | 0.64 · 0.69 · 0.74 | 0.77 · 0.77 · 0.93 |
| After 2005 | 0.34 | 0.30 | 0.33 |
| Don't know | 0.34 · 1.48 · 2.40 | 0.30 · 1.65 · 2.86 | 0.33 · 1.30 · 2.04 |

Minimum and maximum span the brick wall types of that period in TABULA's
table 4. Before 1976 walls have no insulation; from 1976 a low level, from
1991 a medium one, from 2005 the legal limits (D.Lgs 192/2005 and 311/2006).

### Windows (TABULA, table 5)

| Glazing | *U_win* (wooden … metal frame) | *g* (share of sunlight let through) |
| --- | --- | --- |
| Single | 4.9 … 5.7 | 0.85 |
| Double | 2.8 … 3.7 | 0.75 |
| Low-emissivity double | 2.2 … 2.4 | 0.67 |
| Don't know | 2.2 … 5.7 | 0.85 |

**How to tell at the viewing:** hold a flame or the phone torch to the glass
and count the reflections. Each pane makes two, so 2 reflections = single
glazing, 4 = double. A purple reflection means a low-emissivity coating
([Edilclima forum](https://forum.edilclima.it/viewtopic.php?p=51782)).

---

## 2. How cold the heating season is

```math
DD = \sum_{\text{months}} d_m \cdot \max(0,\ 20 - T_m)
```

| Symbol | What it is | Unit | Where it comes from |
| --- | --- | --- | --- |
| *DD* | Degree days: how cold the whole season is | °C·day | the result |
| *d_m* | Days of month *m* on which heating may be on | days | DPR 74/2013, by zone |
| *T_m* | Mean temperature of month *m*, 1991–2020 average | °C | Open-Meteo, at the drawn spot |
| 20 | Conventional indoor temperature | °C | DPR 412/93 |

The **climate zone** depends on degree days (DPR 412/93): A up to 600, B up to
900, C up to 1,400, D up to 2,100, E up to 3,000, F above. Each zone has its
heating period (DPR 74/2013, art. 4):

| Zone | Period | Days |
| --- | --- | --- |
| A | 1 December – 15 March | 105 |
| B | 1 December – 31 March | 121 |
| C | 15 November – 31 March | 137 |
| D | 1 November – 15 April | 166 |
| E | 15 October – 15 April | 183 |
| F | no legal limit | 365 |

**Which zone.** The **comune's legal zone** is used, from the table in Annex A
of DPR 412/93 ([`src/data/zone-climatiche.json`](../src/data/zone-climatiche.json),
8,010 comuni). The table has no official machine-readable version:
[`scripts/build_zones.py`](../scripts/build_zones.py) reads three
independently published copies
([ANAIP](https://nazionale.anaip.it/wp-content/uploads/dpr412-93_allA_tabellagradigiorno-riscaldamento.pdf),
[Il Sole 24 Ore](https://i2.res.24o.it/pdf2010/Editrice/ILSOLE24ORE/ILSOLE24ORE/Online/_Oggetti_Embedded/Documenti/2019/10/11/ALLEGATO.pdf),
[SICET](https://www.sicet.it/attachments/article/702/Allegato_A_DPR_412-93.pdf))
and keeps a comune only where at least two copies agree on both zone and
degree days; 142 comuni are dropped. Where the copies disagree, the official
list of [Regione Piemonte](https://www.regione.piemonte.it/web/media/44156/download)
always sides with the majority kept. The comune and its province come from
Nominatim's reverse geocoding; for a province created after 1993 (e.g. Monza
e Brianza) the name is enough, if it's unique in Italy.

If the comune isn't in the table (recent mergers, name not found), the zone is
**estimated from the climate**: the zone whose own period yields degree days
that fall in that same zone (the coldest, if several). The app says which one
it used.

The **degree days in the calculation** still come from the recent climate
(1991–2020) over the zone's period, not from the 1993 table, which is based
on other years: for Milan the DPR gives 2,404, Open-Meteo's model about 2,575.

The energy needed before counting the sun, month by month, is:

```math
Q_m = \frac{H \cdot f_h \cdot \max(0,\ 20 - T_m) \cdot 24 \cdot d_m}{1000}
```

with *Q_m* in kWh and *f_h* the **heating hours** factor for *h* hours a day:

| Case | *f_h* | Why |
| --- | --- | --- |
| High end | 1 | Upper physical limit: on 24 hours a day. |
| Low end | *h* / 24 | Lower physical limit: as if the room went cold the moment heating stops, which never happens. |
| Most likely figure | (1 + *h*/24) / 2 | **Assumption:** halfway between the two limits. How fast a room cools depends on the mass of the walls, which we can't see. |

*h* is the answer to "How many hours a day is it on?", never above the
**zone's legal maximum** (DPR 74/2013, art. 4): A 6 hours, B 8, C 10, D 12,
E 14, F no limit. "Don't know" uses the legal maximum.

---

## 3. How much sun comes in through the windows

```math
S_m = \sum_{\text{outside walls}} A_{win} \cdot g \cdot I_m \cdot d_m
```

| Symbol | What it is | Unit | Where it comes from |
| --- | --- | --- | --- |
| *S_m* | Solar heat entering through the windows in month *m* | kWh | the result |
| *A_win* | That wall's windows | m² | see step 1 |
| *g* | Share of solar energy let through by the glass | – | TABULA, table 5 |
| *I_m* | Sun reaching that wall on the month's mean day, shadows included | kWh/m² | computed, see below |
| *d_m* | Heating days in the month | days | DPR 74/2013 |

*I_m* is computed every 10 minutes of the month's mean day (17 January,
16 February, 16 March, 15 April, … 10 December: Klein's days):

1. **Sun on the horizontal.** Open-Meteo gives the mean daily sun on the
   ground, *H*. The ratio *K_T* = *H* / *H₀*, where *H₀* is the sun above the
   atmosphere (solar constant 1,367 W/m², corrected for the Earth–Sun
   distance), says how clear the sky is.
2. **Beam and diffuse.** The diffuse share of the light comes from the Erbs
   correlation:
   ```math
   \frac{I_d}{I} = 0.9511 - 0.1604\,K_T + 4.388\,K_T^2 - 16.638\,K_T^3 + 12.336\,K_T^4
   ```
   (for 0.22 < *K_T* ≤ 0.8; 1 − 0.09 *K_T* below, 0.165 above).
3. **On the vertical wall.** Direct sun counts only when the wall faces the
   sun **and** no OpenStreetMap building blocks it, seen from the chosen floor
   (one ray towards the sun every 10 minutes). Half the diffuse sky reaches
   the wall (it sees half the sky), plus half the light reflected by the
   ground (albedo 0.2).

This gives the **most** the sun can do: the glass is treated as fully
transparent (no frame) and all the heat that comes in counts as useful. That's
why the app says "up to".

---

## 4. What it costs in euro

The season's energy is the sum of the months:

```math
Q = \sum_{\text{months}} \max(0,\ Q_m - S_m)
```

Then it depends on how the home is heated:

| Heating | Season cost | Values used |
| --- | --- | --- |
| Gas boiler | *Q* / (*η* · 10.69) × gas price | *η* = 0.94 · 0.86 · 0.75 |
| Heat pump or air conditioner | *Q* / *SCOP* × electricity price | *SCOP* = 4.0 · 3.4 · 2.8 |
| Plug-in electric heater | *Q* × electricity price | efficiency 1 |
| Central heating | as a gas boiler: the room's estimated consumption; what you pay also depends on how the building splits the bill, and the app says so | as above |
| Don't know | costed as a gas boiler, and the app says so | – |

| Symbol | What it is | Where it comes from |
| --- | --- | --- |
| *η* | Boiler seasonal efficiency, on the higher heating value: 0.86 is the legal minimum for new boilers since 26/9/2015, 0.75 the minimum for B1 boilers, 0.94 a class-A condensing boiler | EU Reg. 813/2013 |
| 10.69 | kWh in 1 Smc of gas (conventional higher heating value, the basis of bills) | ARERA, TIVG |
| *SCOP* | kWh of heat per kWh of electricity over a season: class C (2.8), A (3.4), A+ (4.0) | EU Reg. 626/2011, annex II |
| gas price | ARERA's reference-customer price (1,100 Smc/year) for the **tariff area** of the room's region, taxes included; September 2026: from €1.54/Smc (north-east) to €1.76/Smc (south and islands) | ARERA, `G<year>_stv.xlsx` |
| electricity price | ARERA's reference-customer price (2,000 kWh/year, 3 kW, resident), taxes included; October–December 2026: €0.4343/kWh | ARERA, `E<year>-smt.xlsx` |

The **monthly** amount is the season cost divided by the zone's heating months
(days / 30.4). With more people the app also divides by the number of people.

### How the range is built

| | Low end | High end |
| --- | --- | --- |
| Walls, windows, ceiling, floor | lowest *U* of the period | highest *U* of the period |
| "Don't know" on roof or cellar | not there | there |
| Air changes *n* | 0.3 | 0.5 |
| Heating hours | *h* / 24 | 24 hours |
| Sun through the windows | all that's possible | none |
| Boiler / heat pump | the most efficient | the least efficient |

The **most likely figure** uses the typical value of everything, the hours
factor halfway between the limits and all the possible sun. The **"The sun"**
line shows the difference between "no sun" and "all the possible sun" at
typical values.

---

## Worked example

A 16 m² room in Milan, middle floor, outside walls facing north and east (4 m
each), 1950–1975 building, double glazing, gas boiler, no buildings nearby,
hours "Don't know" (zone E: 14 hours). Typical values:

| Step | Calculation | Result |
| --- | --- | --- |
| Windows | 16 / 8 | 2.0 m² |
| Solid wall | 8 × 2.70 − 2.0 = 19.6 m² × 1.26 | 24.7 W/K |
| Windows | 2.0 m² × 2.8 | 5.6 W/K |
| Air | 0.34 × 0.3 × 43.2 m³ | 4.4 W/K |
| *H* | sum | 34.7 W/K |
| Degree days, zone E | Open-Meteo 1991–2020 | ≈ 2,575 |
| Hours factor | (1 + 14/24) / 2 | 0.79 |
| Without sun | 34.7 × 0.79 × 2,575 × 24 / 1000 | ≈ 1,698 kWh |
| With sun | minus the sun through the north and east windows | ≈ 1,332 kWh |

At the gas price of the north-east tariff area (Lombardy) for September 2026,
€1.5373/Smc, the app shows **about €37 a month** (range €20–97, October to
April) and "the sun saves you up to €10 a month". The same room with a
plug-in electric heater: about €96 a month. Figures change every month with
ARERA's prices. [`tests/cost.test.js`](../tests/cost.test.js) checks these
steps.

---

## What we don't count

- **Heat from people and appliances.** The UNI/TS 11300-1 formula for internal
  gains couldn't be verified from free sources, so it's left out. The estimate
  therefore leans high.
- **The thermostat setting.** We count 20 °C, the conventional value of DPR
  412/93. A lower thermostat costs less.
- **Hot water and cooking.** They don't depend on the room's orientation.
- **Summer heat in euro.** Many renters have no air conditioning: a figure
  would be invented. Instead the app flags rooms under the roof with south- or
  west-facing walls.
- **Thermal bridges and wall mass.** These would need a dynamic model.
- **Shade on diffuse light.** Nearby buildings only remove direct sun.

---

## How prices are updated

**Automatically, every month.** [`src/prices.js`](../src/prices.js) is
generated by [`scripts/update_prices.py`](../scripts/update_prices.py), which a
GitHub Action ([`update-prices.yml`](../.github/workflows/update-prices.yml))
runs on the 3rd, 5th and 8th of each month:

1. It downloads ARERA's two official files, with prices **before taxes** and
   one sheet per period:
   [`G<year>_stv.xlsx`](https://www.arera.it/consumatori/valori-vulnerabilita-gas)
   for gas (monthly, per tariff area) and
   [`E<year>-smt.xlsx`](https://www.arera.it/area-operatori/prezzi-e-tariffe)
   for electricity (quarterly).
2. From the newest sheet it computes ARERA's **reference customer** spend: gas
   1,100 Smc/year across the consumption brackets plus the G6 meter fixed fee;
   electricity 2,000 kWh/year, 3 kW, resident, plus fixed and power fees. It
   divides by consumption to get an average price.
3. It adds taxes with a **factor** (see below).
4. If a price moves more than 40% from the previous month, or a file can't be
   read, it **publishes nothing** and opens a GitHub issue. The app keeps
   using the last valid prices.
5. Otherwise it runs the tests and publishes.

**Taxes.** ARERA's files don't include them. The factor in
[`scripts/price-taxes.json`](../scripts/price-taxes.json) is the ratio, for
the same period, between the reference customer's spend **with** taxes
published by ARERA and the spend **without** taxes computed from the files:
1.2553 for gas (September 2026), 1.1063 for electricity (October–December
2026). It treats excise, regional surcharge and VAT as a single percentage: an
approximation of a few points, since excise is really a fixed amount per Smc.
The factor only changes when taxes do: every January the Action opens a
reminder to check it.

**Which tariff area.** The room's region (from Nominatim's reverse geocoding)
picks the area, using the region lists in ARERA's files
([`src/ambiti.js`](../src/ambiti.js)). If the region isn't found, the average
of the six mainland areas is used.

---

## Sources

- **ARERA**, press note of 2/10/2026, reference gas price for the reference
  customer, September 2026:
  [PDF](https://www.arera.it/fileadmin/allegati/com_stampa/26/Nota_stampa_aggiornamento_mensile_vulnerabili_gas_SETTEMBRE_2026.pdf).
- **ARERA**, reference electricity price, Q4 2026, via
  [Il Sole 24 Ore Radiocor](https://en.ilsole24ore.com/radiocor/nRC_29.09.2026_18.49_64610646).
- **ARERA, TIVG**: conventional higher heating value 10.69 kWh/Smc, via
  [luce-gas.it](https://luce-gas.it/guida/tariffe/conversione-kwh-smc).
- **ARERA**, price tables `G<year>_stv.xlsx` and `E<year>-smt.xlsx`:
  [gas](https://www.arera.it/consumatori/valori-vulnerabilita-gas),
  [electricity](https://www.arera.it/area-operatori/prezzi-e-tariffe).
- **Corrado, Ballarini, Corgnati, Talà**, *Building Typology Brochure – Italy*
  (TABULA), Politecnico di Torino, 2011, tables 4 and 5:
  [PDF](https://iris.polito.it/bitstream/11583/2465779/1/Italian%20Typology%20Brochure.pdf).
- **DPR 412/1993, Annex A**: climate zone and degree days of every comune,
  from three published copies (ANAIP, Il Sole 24 Ore, SICET) checked against
  the official list of Regione Piemonte; **DPR 74/2013**, art. 4: heating
  periods and hours, via
  [Infobuild](https://www.infobuild.it/approfondimenti/accensione-riscaldamento-2026-orari-zona-climatica/).
- **DM 5 July 1975**: minimum height 2.70 m, windows ≥ 1/8 of the floor:
  [text](https://www.bosettiegatti.eu/info/norme/statali/1975_dm_05_07.htm).
- **EU Reg. 813/2013**: minimum seasonal efficiency of boilers, via
  [Vaillant](https://Vaillant.it/downloads/utente/incentivi-fiscali/erp-etichetta-energetica/v-approfondimento-direttive-erp-ed-eld-1297776.pdf).
- **EU Reg. 626/2011**, annex II: SCOP classes of air conditioners:
  [text](https://www.legislation.gov.uk/eur/2011/626/annex/II/adopted).
- **UNI/TS 11300-1**: 0.3 air changes an hour in homes, via
  [Edilclima forum](https://forum.edilclima.it/viewtopic.php?p=31684).
- **Maleki, Hizam, Gomes**, *Estimation of Hourly, Daily and Monthly Global
  Solar Radiation on Inclined Surfaces: Models Re-Visited*, Energies 10, 134
  (2017): Erbs correlation (table 2), sun on inclined surfaces and Klein's mean
  days (table 9): [article](https://www.mdpi.com/1996-1073/10/1/134).
- **D.Lgs 192/2005**, art. 6 c. 8: the energy class must be in rental and sale
  listings (fine €500–3,000), via
  [Ediltecnico](https://ediltecnico.it/attestato-prestazione-energetica-ape-obbligatorio-non-obbligatorio/).
- **Open-Meteo Climate API**, model EC_Earth3P_HR, 1991–2020:
  [documentation](https://open-meteo.com/en/docs/climate-api).
- **OpenStreetMap** (via Overpass): building outlines and heights.
