<p align="center">
  <img src="docs/logo.svg" alt="SunTrace" width="220">
</p>

<p align="center"><a href="README.md">Italiano</a> · <strong>English</strong></p>

# SunTrace 2

**What will it cost to heat the room you're about to rent?**
SunTrace 2 tells you in euro a month, before you sign.

**[Open SunTrace 2](https://holyemilio.github.io/suntrace2/)** — free, no
account, works on your phone too.

It's made for people renting in Italy: students, working students, workers
away from home. Heating is the most variable part of the bill, and it depends
on things a listing doesn't show: where the sun comes from, how much the
buildings opposite shade the room, what glazing the window has.

---

## How to use it

1. **Search the address** of the home.
2. **Draw the room** on the map: one click per corner, then the first point
   again to close it.
3. **Answer the viewing questions.** Each answer narrows the estimate; if you
   don't know something, leave "Don't know".

## What it tells you

- **What it costs to heat**, in euro a month, over the months heating is
  allowed in your zone. It's a range, for example "40–97 €": the more you
  answer, the narrower it gets.
- **How much each**, if you share the bills.
- **How much the sun saves you** through the windows, with the real shadows of
  nearby buildings, at the floor you pick.
- **What a plug-in electric heater would cost**: at today's prices, about twice as much as gas.
- **What to check and ask at the viewing**: a short list, different for every
  room.
- **A sheet to share** with flatmates, to compare different homes.

## Where the numbers come from

Gas and electricity prices from **ARERA**, updated monthly. Walls and windows
from the Italian building typology **TABULA** (Politecnico di Torino). Climate
zones and heating months from Italian law (**DPR 412/93** and **DPR 74/2013**).
Average 1991–2020 climate from **Open-Meteo**, buildings from
**OpenStreetMap**.

Every formula, with a legend for each symbol and a worked example, is in
**[the method](docs/metodo.md)** (in Italian).

## What it doesn't do

- It's not a quote or an energy certificate: it's for **comparing** homes.
- It doesn't count the heat of people and appliances, or your habits: the
  estimate leans high.
- It doesn't estimate summer heat in euro.
- It only works in Italy.

## Privacy

No account, no server of ours, no analytics. The "Share this sheet" link
contains the room's location and your answers: you decide who gets it.
Details on the [privacy page](privacy.html).

---

**For developers:** how to run it, the tests and the structure are in
[docs/sviluppo.md](docs/sviluppo.md). [MIT](LICENSE) licence.
