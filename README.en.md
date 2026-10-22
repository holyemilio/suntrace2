<p align="center">
  <img src="docs/logo.svg" alt="SunTrace" width="260">
</p>

<p align="center"><a href="README.md">Italiano</a> · <strong>English</strong></p>

# SunTrace 2 — Urban Microclimate Simulator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-72%20unit%20%2B%2025%20e2e-brightgreen)]()
[![Engine](https://img.shields.io/badge/solar%20engine-Meeus%20%2F%20SPA-blue)]()
[![Live Demo](https://img.shields.io/badge/demo-live-f5b301)](https://holyemilio.github.io/suntrace2/)

**[🌐 Try SunTrace 2 live](https://holyemilio.github.io/suntrace2/)** — no install needed.

**SunTrace 2** is an urban microclimate simulator: instead of analysing a single point, you **draw your room's perimeter** on the map. Every edge of the polygon becomes a wall, with its orientation derived geometrically and automatically classified as exposed to the sun or facing another room of the building (compared against the real OSM building outline). The result is a single "room-level" climate model: accurate solar position (Meeus/SPA), real local climate normals (Open-Meteo), a seasonal thermal estimate weighted by wall and room size, and a star-based **Comfort Rate** with tips. Bilingual **IT/EN** interface, with a dedicated mobile layout.

> This is the architectural fork of **SunTrace 1** ([holyemilio/Suntrace](https://github.com/holyemilio/Suntrace), live on GitHub Pages), which relied on a single point plus a compass for facade orientation. The reasoning behind the change is in the [CHANGELOG](CHANGELOG.md#300--2026-08-30).

---

## ✨ Features

| Feature | Detail |
|---|---|
| **Room perimeter drawing** | Click a vertex per wall on the map; closing the loop near the first vertex locks the room instantly. A 🗑️ button removes it to redraw from scratch. No analysis runs until a room is drawn. |
| **Automatic wall classification** | Each edge is compared against the real OSM outline of the building: close to the outer wall → **exposed to the sun** (seasonal, variable); otherwise → **facing another room** (fixed, neutral value). With no OSM building found, a conservative fallback treats every wall as exposed. |
| **Live per-wall sun state** | Each exposed wall shows whether it gets direct sun right now (green) or is shadowed by a nearby building (grey) — not just the room's aggregate total. |
| **Room-level climate model** | Exterior walls are weighted by their own length, interior walls pull toward a neutral value, and the whole seasonal swing is damped or amplified based on the room's floor area (shown in the sidebar and in the Comfort Rate detail). |
| **Meeus/SPA solar engine** | Declination, Equation of Time, atmospheric refraction (Bennet). Error < 0.5° on elevation and azimuth vs SunCalc. |
| **The 5th floor is the roof** | A horizontal surface, not a wall: solar gain depends only on the sun's elevation, never on an orientation. |
| **Real climate data (Open-Meteo)** | 1991–2020 monthly normals for the drawn point, cached in `localStorage`, with a Rome fallback. |
| **Comfort Rate** | 5-star index (orientation, sun, obstructions, glazing, insulation) with a detail view, sun exposure and tips. |
| **Real shadows (OSM)** | Ray-tracing toward the sun through nearby OSM buildings, from the selected floor's height. |
| **Italy geofencing** | Reverse geocoding distinguishes Italian land (Vatican/San Marino enclaves included), national waters and abroad, each with its own message. |
| **Geolocation** | Available from the landing page too (jumps straight into `app.html` centred on your position), as well as inside the simulator. |
| **Landing + simulator** | Two separate pages: `index.html` (mission, search) and `app.html` (the actual simulator). |
| **Dedicated mobile layout** | Below 768px: a bottom bar, a "Settings" drawer, an "Info" sheet, two pop-up widgets for sun/climate — no locked sidebar. |
| **Bilingual IT/EN** | In-app switcher, automatic browser-language detection, remembered choice. |
| **Zero runtime dependencies** | Leaflet and fonts served locally (`vendor/`), no CDNs: the only external requests go to key-free public APIs — OpenStreetMap, Nominatim, Overpass, Open-Meteo. No bundler. |
| **72 unit + 25 e2e** | `node --test` for the solar engine, thermal model and shadow/room geometry; Playwright drives the app in a real browser. |

---

## 📖 Documentation

- **[User Manual](docs/manuale-utente.html)** (Italian) — how to use the app, what it does, buttons and notifications (opens in the browser, printable to PDF).
- **[Testbook](docs/testbook.html)** (Italian) — a table-based test plan with a blank outcome column to run through every feature.
- **[Testbook (CSV)](docs/testbook.csv)** (Italian) — the same checklist, downloadable and Excel-ready (`;` separator, UTF-8).
- **[Project status](docs/stato-lavori.md)** (Italian) — where things stand, what is pending, and the traps already hit.
- **[Privacy](privacy.html)** — which external services the browser contacts, and why.

---

## 🔬 Algorithms

### Solar engine (`src/solar.js`)

Based on **Meeus, "Astronomical Algorithms" 2nd ed. (1998), ch. 25–27**:

1. **Sun's mean longitude** `L₀ = 280.46646 + 36000.76983·T`
2. **Mean anomaly** `M` and **equation of the centre** `C`
3. **Apparent longitude** with nutation correction (`ω = 125.04 − 1934.136·T`)
4. **Obliquity of the ecliptic** `ε` → **declination** `δ = arcsin(sin ε · sin λ_app)`
5. **Equation of time** `E` (5-term formula, ~0.5" precision)
6. **Hour angle** `HA = 15·(TST − 12)`, where `TST = UTC + lon/15 + E/60`
7. **Elevation** with **atmospheric refraction** (Bennet formula)
8. **Azimuth** with the correct formula `cos Az = (sin δ − sin elev·sin lat)/(cos elev·cos lat)`

**Accuracy target**: < 0.5° on elevation, < 1° on azimuth — verified against SunCalc across 23 test cases.

### Room geometry (`src/shadow.js`)

Every edge of the drawn polygon becomes a wall: `outwardNormalAz` derives its azimuth, `classifyRoomEdges` compares it against the host building's OSM outline (tolerance `EDGE_TOLERANCE_M`) to decide whether it's exposed or interior, and `polygonArea`/`polygonCentroid` compute the room's area and centre for the climate model.

---

## 🚀 How to run

The app has two pages: **`index.html`** is the landing page (the project's
mission and a search bar) and **`app.html`** is the actual simulator.
Searching an address from the landing takes you straight to `app.html`
already loaded on that point; the «← Home» button in the simulator goes
back to the landing.

> ⚠️ **Do not open the `.html` files by double-clicking them.** The app uses
> ES modules (`<script type="module">`), geolocation and calls to external
> APIs — all of which the browser **blocks** under `file://`. Opened
> directly, the app looks "dead" (buttons and search don't respond). You
> need a local server on `http://localhost`.

**Easiest way (macOS):** double-click **`start.command`**. It starts a local
server and opens the browser on the landing page. To stop it, press `Ctrl+C`
in the Terminal window that opens.

> The server sends `Cache-Control: no-store`, so a plain reload always shows the
> latest edit. If an older server is still running from before, stop it and
> relaunch `start.command`.

**In VSCode:** install the *Live Server* extension, then right-click
`index.html` → **"Open with Live Server"**.

**From a terminal:**

```bash
cd suntrace2
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## 🧪 Tests

> Requires **Node.js 18+**. If you don't have it, `brew install node` is the
> easiest route, or grab the official package from [nodejs.org](https://nodejs.org).

```bash
# Install suncalc and Playwright (test-only devDependencies)
npm install

# Run the 72 unit tests (Node 18+)
npm test
```

**Expected output**: 72 pass, 0 fail.

### End-to-end tests (real browser)

These drive the app in a headless browser with the external APIs stubbed for
deterministic runs: boot, drawing the room perimeter, geofencing, sliders,
glazing/insulation, Comfort Rate, language, floors, shadows, climate and
narrow windows (mobile layout).

```bash
npx playwright install chromium   # once (~95 MB)
npm run test:e2e
```

**Expected output**: 25 pass, 0 fail.

---

## 🌍 Deploy to GitHub Pages

**Live at <https://holyemilio.github.io/suntrace2/>** — Source: **Deploy from
a branch** → `main` → `/` (root), from **Settings → Pages** in the
repository. Since `index.html` is the landing page, the root domain shows
that; the simulator lives at `/app.html`.

---

## 📁 Structure

```
suntrace2/
├── index.html          # Landing page: the project's mission + search
├── app.html            # The actual simulator
├── privacy.html        # Privacy policy (IT/EN)
├── src/
│   ├── solar.js        # Pure astronomical engine (Meeus/SPA) — no DOM
│   ├── climate.js      # Room-level seasonal thermal model
│   ├── shadow.js        # Geometry: room walls, classification, real shadows
│   ├── ui.js             # Simulator logic, Leaflet, room drawing, mobile layout
│   ├── landing.js        # Landing logic: language, search → app.html, reveal
│   ├── legal.js           # Privacy page logic
│   ├── i18n.js            # IT/EN dictionary and translation engine (shared)
│   ├── tokens.css         # Design tokens (:root) shared by every page
│   ├── styles.css         # Simulator styles (mobile-first)
│   ├── landing.css        # Landing page styles
│   └── legal.css          # Privacy page styles
├── vendor/
│   ├── fonts/           # Self-hosted Space Grotesk + IBM Plex Mono (no Google Fonts)
│   └── leaflet/         # Self-hosted Leaflet 1.9.4 (no CDN)
├── server/
│   └── overpass-cache/ # Cloudflare Worker: 30-day cache in front of Overpass (optional, not deployed)
├── tests/
│   ├── solar.test.js    # 23 tests — astronomical engine (SunCalc oracle)
│   ├── climate.test.js  # thermal model, Comfort Rate and roomSeasonalTemperatures
│   ├── shadow.test.js   # room geometry, wall classification, shadows
│   └── e2e/app.e2e.js   # 25 end-to-end tests (Playwright, headless browser)
├── .github/
│   └── workflows/ci.yml # CI: unit + i18n parity + e2e on every push
├── docs/
│   ├── case-study.md    # Technical case study
│   ├── stato-lavori.md  # Project status, pending items, traps already hit
│   ├── manuale-utente.html
│   └── testbook.html / testbook.csv
├── CLAUDE.md            # Project brief for AI coding sessions
├── README.md            # Italian
├── README.en.md         # English
├── CHANGELOG.md
├── LICENSE              # MIT
├── .gitignore
└── package.json
```

---

## 🏗 How it was built

SunTrace 2 is designed to be **zero-dependency** and **deployable with no build step**. The code is split into native ES modules (`type="module"`) imported directly from the HTML.

The astronomical engine (`solar.js`) is entirely **pure** (no DOM access, no globals), which makes it:
- Testable with `node --test`, no browser required
- Reusable in other contexts (workers, server-side)

The room geometry (`shadow.js`) is just as pure: it takes the drawn vertices and the building's OSM outline as input, never touching the DOM.

The interface uses Leaflet 1.9.4 (self-hosted in `vendor/leaflet/`, hash verified against leafletjs.com) for the map, the public Overpass API for building outlines and Nominatim for geocoding, honouring its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) with a ≥ 420 ms debounce and `countrycodes=it,va,sm`. The fonts (Space Grotesk, IBM Plex Mono) are self-hosted in `vendor/fonts/` too: no visitor request ever reaches Google or any other CDN.

---

## ⚠️ Limitations

- Temperatures use the **real climate normals** of the drawn point (Open-Meteo, 1991–2020), with the Rome table only as an offline *fallback* on network errors. The building's thermal model is however **heuristic** and is not a certified energy performance assessment (APE).
- Orientation and wall classification are **computed on real OpenStreetMap buildings** (via Overpass): with no OSM building found, every wall conservatively stays "exposed". OSM heights are often missing: 3 storeys (9 m) are assumed, and only buildings within 90 m are considered.
- No validation against self-intersecting or degenerate polygons while drawing.
- The shadow wedge on the map stays a single one, cast from the room's centroid — not one per wall.
- The model does not include: thermal mass, infiltration, internal gains, thermal bridges.

---

## 📄 License

MIT © 2026 SunTrace. See [LICENSE](LICENSE).
