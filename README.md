<p align="center">
  <img src="docs/brand/logo.png" alt="SunTrace" width="220">
</p>

# SunTrace

**What will it cost to heat the room you're about to rent?**
SunTrace tells you in euro a month, before you sign.

**[Open SunTrace](https://holyemilio.github.io/suntrace2/)** — free, no
account, works on your phone too. The app is in Italian and English.

It's made for people renting in Italy: students, working students, workers
away from home. Heating is the most variable part of the bill, and it depends
on things a listing doesn't show: where the sun comes from, how much the
buildings opposite shade the room, what glazing the window has.

---

## How to use it

1. **Search the address** of the home.
2. **Draw the room** on the map: one click per corner, then the first point
   again to close it.
3. **Answer the viewing questions.** Each answer sharpens the estimate; if you
   don't know something, leave "Don't know".

The first visit opens a short guided tour of the app.

## What it tells you

- **What it costs to heat**: the most likely figure in euro a month, over the
  months heating is allowed in your comune, with the range from best to worst
  case.
- **How much each**, if you share the bills.
- **How much the sun saves you** through the windows, with the real shadows of
  nearby buildings, at the floor you pick.
- **What a plug-in electric heater would cost**: at today's prices, about
  twice as much as gas.
- **What to check and ask at the viewing**: a short list, different for every
  room.
- **A sheet to share** with flatmates, to compare different homes.

## The viewing questions

| Question | How to find out |
| --- | --- |
| How is the home heated? | Ask the landlord. The boiler is usually in the kitchen, the bathroom or on the balcony. |
| What glazing does it have? | Hold your phone torch to the glass: 2 reflections = single glazing, 4 = double. |
| When was the building built? | In the listing or the energy certificate (APE). |
| What is above and below? | Another flat, or roof and cellar. |
| How many hours a day is heating on? | Your habit; the law sets a maximum per climate zone. |
| How many share the bills? | — |
| Which floor? | The bar at the top of the map. |

## Where the numbers come from

Gas and electricity prices from **ARERA**, the Italian energy regulator,
updated automatically every month for each part of Italy. Walls and windows
from the Italian building typology **TABULA** (Politecnico di Torino). Climate
zones, heating months and hours from Italian law (**DPR 412/93** and
**DPR 74/2013**). Average 1991–2020 climate from **Open-Meteo**, buildings and
water from **OpenStreetMap**.

Every formula, with a legend for each symbol and a worked example, is in
**[the method](docs/method.md)**.

## User manual

Step by step, with screenshots: **[User manual](docs/user-manual/user-manual.md)**.

## What it doesn't do

- It's not a quote or an energy certificate: it's for **comparing** homes.
- It doesn't count the heat of people and appliances: the estimate leans high.
- It doesn't estimate summer heat in euro.
- It only works in Italy.

## Privacy

No account, no server of ours, no analytics. The "Share this sheet" link
contains the room's location and your answers: you decide who gets it.
Details on the [privacy page](https://holyemilio.github.io/suntrace2/privacy.html).

---

**For developers:** running it locally, the tests and the structure are in
[docs/development.md](docs/development.md). [MIT](LICENSE) licence.
