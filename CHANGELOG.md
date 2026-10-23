# Changelog

All notable changes to SunTrace are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — [Semantic Versioning](https://semver.org/).

---

## [4.7.1] — 2026-10-23

- **"SunTrace", not "SunTrace 2".** The earlier single-point SunTrace is
  discontinued, so the "2" is gone from the app, the landing, the privacy page
  and the documentation. Historical entries below keep their original names.
  The repository and site address (`suntrace2`) are unchanged.

---

## [4.7.0] — 2026-10-23

- **Repository in English.** README, method, developer guide, project status,
  changelog, user manual, script and workflow messages are now in English. The
  app itself stays bilingual (Italian/English). Renamed: `docs/metodo.md` →
  `docs/method.md`, `docs/sviluppo.md` → `docs/development.md`,
  `docs/stato-lavori.md` → `docs/project-status.md`, `docs/manuale/` →
  `docs/user-manual/` (English only). Removed: `README.en.md` (the README is
  now English), the Italian user manual and `docs/archivio/` (v3 documents, in
  git history).

---

## [4.6.1] — 2026-10-23

- "The range is wide because answers are missing" now appears only while some
  answer is still "Don't know": with every answer in, the remaining range comes
  from what can't be seen (walls, habits), not from missing questions.
- User manual updated to the current version (new screenshots: logo, guide,
  water check, main figure, hours question) and added to the repository.

## [4.6.0] — 2026-10-23

- **Legal climate zone per comune.** The heating season and the maximum daily
  hours now follow the DPR 412/93 zone of the room's comune (8,010 comuni,
  `src/data/zone-climatiche.json`) instead of the zone estimated from the
  climate. The table is built by `scripts/build_zones.py` from three published
  copies of Annex A, keeping only comuni on which at least two agree; checked
  against the official list of Regione Piemonte. If the comune isn't found, the
  estimated zone remains and the app says so ("E (estimated from the climate)"
  instead of "E (legal, Milano)").

## [4.5.0] — 2026-10-23

- **Automatic dark mode** following the device setting (`prefers-color-scheme`):
  warm near-black paper, light ink, slightly brighter amber; greys around 6:1
  contrast. Dedicated light logo (`docs/brand/logo-dark.png`), browser bar
  colour and system controls adapted. The map stays light: OpenStreetMap has no
  free dark tiles without a key.

## [4.4.2] — 2026-10-23

- **Link preview with the new logo.** Open Graph and Twitter tags on landing,
  app and privacy: sharing the site on WhatsApp, Telegram, LinkedIn or by email
  shows the logo, the slogan "Sai quanto spendi prima di firmare." and a
  description (`docs/brand/og-image.png`, 1200×630, generated from
  `docs/brand/og-source.html`).
- Page titles aligned with the "SunTrace" brand and slogan; favicon with `?v=2`
  so browsers drop the cached old one.

## [4.4.1] — 2026-10-23

- **New logo (provisional)**: a rising sun over an arc, with "SunTrace" in a
  serif. Files in `docs/brand/`: `logo.png` (wordmark, transparent),
  `symbol.png`, icons at 32, 180 and 512 px. Used in the app column, the
  landing bar, as favicon and phone icon, and in the README.

## [4.4.0] — 2026-10-23

- **First-visit guided tour** (`src/tour.js`). A dark overlay covers the app and
  an amber frame circles one element at a time, with a card explaining it and
  Next, Back and Skip (keyboard too). The app can't be used during the tour.
  Nine steps on desktop, seven on phones; shown once, reopened from the "Guide"
  link at the bottom of the column (on phones, at the bottom of the questions
  panel, which now also holds the Method, GitHub and Privacy links).
- e2e tests mark the tour as seen (`addInitScript`), except the test that checks it.

## [4.3.1] — 2026-10-23

- **Message during the water check.** Right after closing the room, "Checking
  the room isn't on water and loading the buildings around it…" appears and
  disappears when the data arrives, so a room cleared a few seconds later no
  longer looks like a bug.

## [4.3.0] — 2026-10-23

- **Heating hours.** New question "How many hours a day is it on?", never above
  the zone's legal maximum (DPR 74/2013: 14 hours in zone E, 12 in D, …); "Don't
  know" uses the maximum. The calculation no longer assumes heating on 24 hours:
  the main figure sits halfway between the two physical limits (hours on only,
  or 24 hours), which remain the ends of the range.
- **No rooms on water.** A drawing on a river, a lake (OpenStreetMap
  `natural=water`, `waterway=riverbank`) or on the sea side of a coastline is
  cleared with a request to redraw it. 1.5 m of slack at the shore for
  waterfront buildings (`onWater` in `shadow.js`).
- **Degree days removed from the climate panel**: a technical measure people
  don't use. It stays in the calculation and in the method.

## [4.2.0] — 2026-10-23

Fixes from the user's tests.

- **A main figure, not only a range.** The big number is now the most likely
  estimate ("about €812 a month"), with typical values for everything unknown;
  the range moves to the "Range" line. Before, with no answers, only a range
  like €55–2,254 showed, which wasn't useful.
- **Impossible rooms refused.** Crossing sides, or a room under 2 m², is cleared
  with an explanation of how to redraw it (`roomShapeProblem` in `shadow.js`).
- **Mobile: the sun and climate panels close when tapping outside.**
- **Mobile: the questions panel no longer slides sideways** while scrolling.
- **Closer zoom:** the map reaches level 21 (OSM level-19 tiles scaled up) and
  on phones the search lands one level closer, to tap corners with a finger.
- **Degree days explained** in the climate panel.

## [4.1.0] — 2026-10-23

- **Prices update themselves every month.** `scripts/update_prices.py` reads
  ARERA's official files (`G<year>_stv.xlsx` for gas, `E<year>-smt.xlsx` for
  electricity) and regenerates `src/prices.js`; a GitHub Action runs it on the
  3rd, 5th and 8th of the month, runs the tests and publishes. If a file can't
  be read or a price moves more than 40%, it publishes nothing and opens an issue.
- **Gas price per area.** The room's region picks ARERA's tariff area (seven
  areas, `src/ambiti.js`): in September 2026 from €1.54/Smc (north-east) to
  €1.76/Smc (south and islands), instead of one national price.
- **Taxes through a factor** calibrated on ARERA's published reference-customer
  spend (`scripts/price-taxes.json`), with a yearly January reminder.
- 3 new unit tests (tariff areas and generated prices).

## [4.0.1] — 2026-10-23

- **With "Central heating" the price disappeared** (reported by the user): the
  app showed "—" and only a message, which looked like a bug. It now costs the
  room's estimated consumption as for a gas boiler (central heating burns gas
  too) and explains that what you pay also depends on how the building splits
  the bill. No answer hides the price any more.

## [4.0.0] — 2026-10-23

SunTrace 2 becomes a tool for renters: no star rating any more, it says what it
costs to heat the room, in euro a month, from verified sources.

### Changed (breaking)
- **The star Comfort Rate, the seasonal temperatures and the
  windows/insulation cards are removed**, along with the heuristic thermal
  model behind them (`src/climate.js`, in git history). They were a unitless
  index and choices a tenant can't make.
- **Floor 5 is no longer the roof**: it's "5th floor or higher". What is above
  the room (roof or attic) is now an explicit question.
- **The month/hour sliders only move the sun on the map** and live in
  "Technical details": the estimate always covers the whole season.

### Added
- **Heating estimate in €/month** (`src/cost.js`): room heat loss with TABULA
  U-values (Politecnico di Torino), degree days from the Open-Meteo 1991–2020
  climate over the zone's heating period (DPR 412/93, DPR 74/2013), sun on the
  wall with OSM shadows at the chosen floor, gas boiler / heat pump / plug-in
  heater with legal efficiencies (EU Reg. 813/2013, 626/2011) and ARERA prices.
  Always a range: best and worst case of the uncertain values.
- **Six viewing questions**, each with "Don't know": heating, glazing (with the
  torch test), building period, what's above and below, people sharing the bills.
- **Share each**, **maximum sun saving**, **comparison with a plug-in heater**,
  **"check and ask" checklist** generated from the answers.
- **Shareable sheet**: a link with room and answers (`?v=…`), no server. New
  section in the privacy policy.
- **Landing rewritten**: Fig. 1 with the real sun path over Rome, § 1 the same
  room with four heating systems (computed live at current prices), § 2 the
  questions, § 3 the sources.
- **Method document** with every formula, a legend for each symbol, the
  sources and a worked example; **developer guide**.
- 18 unit tests on `cost.js`; e2e rewritten for the new flow (27).

### Design
- Paper and ink instead of the dark theme: the icon's cream as ground, one
  amber reserved for sun and money, hairline rules instead of shadows, 3 px
  radius, no blur, glows, gradients or reveal animations.
- Newsreader (headings, figures) and IBM Plex Sans (interface) instead of Space
  Grotesk; IBM Plex Mono only for readings. Fixed 6-step type scale.
  Self-hosted fonts.
- An SVG icon set drawn for the app instead of emoji; texts without emoji, in
  the second person.

### Removed
- ISPRA, ENEA and ECCO Climate figures and the "−20% with good orientation"
  estimate from the landing: not verified.
- v3 documents moved to an archive (since removed from the repository).

---

## [3.1.2] — 2026-09-02

Live deploy on GitHub Pages and documentation realigned with SunTrace 2.

- **Live deploy** on GitHub Pages: <https://holyemilio.github.io/suntrace2/>
  (root → `index.html` landing, simulator at `/app.html`).
- **Fix: GitHub link in the simulator footer** still pointed to the SunTrace 1
  repository (`holyemilio/Suntrace`) instead of `holyemilio/suntrace2`.
- **README and case study rewritten**: they still described SunTrace 1's
  interaction (compass/single point); updated to room drawing, per-wall
  classification, room-level climate model, mobile layout, 72 unit + 25 e2e.
- **`CLAUDE.md` realigned** (it still said version 3.0.0 and "not deployed").
- **Public-deploy and multi-device risks analysed** (documentation only):
  Overpass under real load, GitHub Pages caching without `no-store`,
  per-device `localStorage`, silent degradation with no error UI. Priority of
  the Overpass cache worker raised.

## [3.1.1] — 2026-08-31

- **`EDGE_TOLERANCE_M`: 2.5 m → 1.0 m.** At 2.5 m a room drawn near a building
  corner could have several sides classified "exposed" by different walls,
  whatever its orientation (the check measures distance, not alignment).
  Verified on a concrete case: a room rotated 25° near a corner went from 3
  exposed sides out of 4 (at 2.5 m) to the only real one (at 1.0 m).

## [3.1.0] — 2026-08-31

Per-wall sun/shade colouring, geolocation on the landing, an overlap bug fixed.

- **Every exposed wall shows whether it's in sun right now**, not just the room
  total: green = direct sun, grey = blocked by a nearby building. Walls towards
  another room keep only the thin outline, now explained in the legend.
- **Location icon** changed.
- **Geolocation on the landing page**: a button next to the search goes
  straight to `app.html` centred on the user's position (`?lat=&lng=`).
- **Bug: the remove-room button covered the hint panel** when collapsed (same
  42×42 px box), making it impossible to reopen. Moved below the panel's full
  expanded height, measured live.
- **Room area shown** in the sidebar and in the Comfort Rate detail.
- **Legend: the missing entry added** for the thin outline.

## [3.0.0] — 2026-08-30

SunTrace 2.0: you draw the room, not a point. The compass goes, a room-level
climate model comes in.

- **Room outline drawing**: click one vertex per wall and close the loop near
  the first point. The room locks on closing; a new bin button removes it. No
  analysis until a room is drawn.
- **Compass removed**: each wall's orientation comes from the polygon's sides.
- **Automatic wall classification**: each side is compared with the real OSM
  outline of the building containing the room — on the outer wall it's
  **exposed**, otherwise it faces **another room**. Without an OSM building,
  every wall stays exposed (conservative).
- **Room-level climate model**: one combined result, outside walls weighted by
  length, inside walls pulled to a neutral value, the seasonal swing damped or
  amplified by floor area.
- **Legend updated**; **e2e suite rewritten** (25 cases) for the new flow.

## [2.6.2] — 2026-08-28

- **Compass: free rotation**, no 45° snapping.
- **Floor 5 is the roof**: a horizontal surface whose solar gain depends only
  on sun height, not orientation.

## [2.6.1] — 2026-08-28

- **Pinch-zoom anywhere on the map** (the two-finger gesture on the marker
  blocked zooming near it).
- **Compass in a mobile widget**, replacing a hidden gesture.
- **Mutually exclusive widgets** (sun, climate, compass).
- **IT/EN switch moved to the top left** on mobile.

## [2.6.0] — 2026-08-28

- **Mobile layout for `app.html`** below 768px: persistent bottom bar, settings
  drawer, Info sheet, sun and climate widgets. The full block only below 320px.
- **Touch gestures** for the marker; **draggable desktop compass**.
- **Marker correctly centred** in its icon.
- **CI green on its first real run**, after fixing an unexpanded test glob,
  three e2e tests bound to removed elements and a missing `z-index` on the
  Comfort Rate modal's close button.

## [2.5.0] — 2026-08-27

- **CI on GitHub Actions**: unit tests, i18n IT/EN parity, Playwright e2e on
  every push and PR.
- **Self-hosted fonts and Leaflet** (`vendor/`, Leaflet sha256 checked): no
  visitor request reaches Google Fonts or unpkg. Privacy policy updated.
- **Overpass edge cache ready to deploy** (`server/overpass-cache/`): a
  Cloudflare Worker with a 30-day KV cache, off until `OVERPASS_PROXY_URL` is set.
- **Canonical Overpass queries**: coordinates rounded to 4 decimals (~11 m).

## [2.4.0] — 2026-08-27

- **Landing page** (`index.html`) with animated hero and four "Why SunTrace"
  sections; the simulator moves to `app.html`.
- **Live deploy** on GitHub Pages (SunTrace 1).
- **Collapsible legend and hint** on the map; shorter, more legible hint.
- **Fix**: the "Temperatures" box collapsed to a few pixels when the sidebar
  overflowed (flexbox shrink on an `overflow: hidden` card).
- **Sidebar reordered.**

## [2.3.0] — 2026-08-27

- **New brand icon**; **solar arc widget** (sunrise to sunset); **bento
  telemetry grid**; light high-contrast map.

## [2.2.0] — 2026-08-26

- **OpenStreetMap tiles** (CARTO started stamping "API KEY REQUIRED").
- **Compass on the map** to pick the wall; **local climate** in the sidebar;
  compact selectors; Space Grotesk + IBM Plex Mono.
- **Fixes**: controls disappearing in narrow windows; the Vatican and San
  Marino rejected as "abroad"; visible error messages; `start.command` without
  caching.
- **Tests**: from 23 to 60 unit + 22 end-to-end.

## [2.1.0] — 2026-07-15

- **Real data for every place** (temperature, humidity, wind, rain).
- **Feels-like temperature**; real orientation and shading from buildings.
- **Italy only**, with a message and a return to Rome otherwise.
- **Address search** with suggestions; **bilingual app**; new dark interface;
  better map; hover explanations; `start.command`.

## [2.0.0] — 2026-07-14

### Added
- **Comfort Rate** (5 stars) replacing the energy class.
- **Property parameters**: window type and wall insulation.
- **Open-Meteo integration**: real monthly climate normals (1991–2020), cached,
  with a Rome fallback.
- **Italy geofencing** and a **mobile block overlay**.

### Changed
- `energyClass()` replaced by `cozynessScore()`; seasonal model accepts climate
  normals, windows and insulation; KPI modal redesigned.

### Removed
- Energy consumption, cost and CO₂ estimates of the old energy-class model.

## [1.0.0] — 2026-07-02

### Added
- **Meeus/SPA solar engine** (`src/solar.js`): declination, equation of time,
  hour angle with longitude correction, elevation, azimuth, Bennet refraction.
- Sunrise/sunset; automatic time zone and DST via `Intl.DateTimeFormat`.
- Sun hours per facade; KPI modal; solar data panel; mobile-first layout.
- **23 astronomical unit tests** against SunCalc.
- Modular architecture: `solar.js` + `climate.js` + `ui.js` + `styles.css`.

### Fixed
- Inverted azimuth formula; hour angle without time zone/DST (up to ~80 min off
  in summer); several Leaflet layer and search bugs; map shadow distortion.

## [0.3.3] — 2026-06-01

- Earlier single-file version with a simplified Cooper engine, no
  sunrise/sunset, inverted azimuth, no time zone handling.
