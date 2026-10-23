# CLAUDE.md — SunTrace 2

Project context for Claude Code sessions. The full detail (history, pitfalls,
open items) is in `docs/project-status.md` — read it before large changes.

## What it is

A tool for **people renting a home** in Italy (students, working students,
workers away from home): you draw the room's outline on the map, answer the
viewing questions, and the app estimates **what it costs to heat it, in euro a
month** (a most likely figure plus a range), with the real shadows of nearby
buildings and ARERA prices. Two standing requirements from the user: **no "AI
slop"** (neither in design nor in content) and **every number must have a
verified source**, otherwise it doesn't enter the calculation.

Vanilla JS, native ES modules, **no build step, zero runtime dependencies**.
Pages: `index.html` (landing), `app.html` (the app, mobile layout below 768px),
`privacy.html`. **Live at <https://holyemilio.github.io/suntrace2/>** (GitHub
Pages from `main`, root → `index.html`) · version **4.7.0**.

**Language:** the app is bilingual (Italian/English, `src/i18n.js`); everything
in the repository — README, docs, code comments, commit messages — is **in
English**. Talk to the user in Italian.

## Commands

```bash
./start.command      # local server on :8000 (Cache-Control: no-store)
npm test             # 78 unit tests (solar engine, cost, geometry/shadows, prices, zones)
npm run test:e2e     # 34 Playwright e2e tests (external APIs mocked)
```

Node **is installed** on this Mac — tests run locally. CI
(`.github/workflows/ci.yml`) reruns them on every push — unit, i18n IT/EN
parity, e2e.

## File map

| Path | Role |
|---|---|
| `src/cost.js` | **The cost calculation.** Pure. Climate zone + season (DPR 412/93, 74/2013), degree days, heating-hours factor, sun on the wall (Erbs + isotropic, shadows via callback), heat-loss coefficient H with TABULA U-values, lo/mid/hi, checklist. Every constant has its source in `docs/method.md`: **never add a constant without a source**. |
| `src/prices.js` | ARERA gas (per tariff area) and electricity prices. **Generated** by `scripts/update_prices.py`, run monthly by a GitHub Action (`update-prices.yml`): never edit by hand. Taxes: factors in `scripts/price-taxes.json`. |
| `src/ambiti.js` | Region → ARERA gas tariff area. |
| `src/zones.js` · `src/data/zone-climatiche.json` | Comune → legal climate zone (DPR 412/93). Table built by hand with `scripts/build_zones.py` (three copies of Annex A, majority vote); changes only by decree. |
| `src/solar.js` | Meeus/SPA astronomical engine. **Pure, don't touch without reason** (23 tests vs SunCalc). |
| `src/shadow.js` | Geometry: `outwardNormalAz` (**careful** — returns the azimuth TOWARDS the point passed: for a room side use it with the centroid and flip 180°, see `lockRoom()`), `classifyRoomEdges`, `polygonArea`/`polygonCentroid`, `sunBlocked`, `roomShapeProblem`, `onWater`. |
| `src/ui.js` | The app: Leaflet, APIs, polygon drawing, questions (`select[data-answer]`), `refreshCost()` (estimate + checklist), `refreshUI()` (sun/map for month and hour), shareable link `?v=…`, mobile layout by DOM reparenting. |
| `src/tour.js` | First-visit guided tour (overlay, Next/Back/Skip, `suntrace_tour_done` in localStorage). |
| `src/landing.js` · `landing.css` | Landing: Fig. 1 (sun path, from `solar.js`) and § 1 comparison (from `cost.js`, embedded Milan data). **They don't import `styles.css`** (which locks scrolling). |
| `src/i18n.js` | Italian/English texts. **Every new string goes in BOTH languages** — CI checks it. Voice: plain, second person, no emoji. |
| `src/tokens.css` | Paper and ink, `--fs-*` type scale, typefaces, **and the dark variant** (`@media (prefers-color-scheme: dark)`). Every new colour is defined here in both versions, never hard-coded in CSS. |
| `vendor/fonts/` · `vendor/leaflet/` | Newsreader, IBM Plex Sans/Mono and Leaflet 1.9.4 **self-hosted**: never reintroduce Google Fonts/unpkg links. |
| `docs/method.md` | The method for anyone who wants to understand the numbers: formulas with a legend, sources, worked example. |
| `docs/development.md` | For developers: running, tests, structure. The `README` is user-facing only. |
| `docs/user-manual/` | User manual with screenshots. |
| `server/overpass-cache/` | Cloudflare Worker (30-day KV cache in front of the Overpass mirrors). **Not deployed yet**: enabled by pasting its URL into `OVERPASS_PROXY_URL` (`src/ui.js`). |

## External services (free, no key)

OpenStreetMap (tiles) · Nominatim (geocoding, debounce ≥420ms, accepts
it/va/sm) · Overpass (buildings and water — the most fragile: 3 mirrors as
fallback in `ui.js`) · Open-Meteo (1991–2020 normals: temperature, humidity,
wind, rain, sun; `daily` aggregated by hand). The privacy policy
(`privacy.html` + `privacy-*` keys in i18n) mirrors exactly this list — if you
change the services contacted, update it too, in both languages.

## Project rules

- UI strings: always via `data-i18n` (or `-ph`/`-aria`/`-title`) + a key in
  both languages of `i18n.js`.
- No CDNs, no new runtime dependencies, no bundler.
- No emoji as icons: there's an SVG set (`<symbol>` at the top of `app.html`).
- Coordinates in Overpass queries are rounded to 4 decimals (same tolerance as
  the localStorage cache): don't "fix" it.
- Pitfalls already paid for (sidebar flexbox, `transform`+`backdrop-filter`,
  `hidden` vs `display`, controls inside `<details>` in e2e, `.md` links on
  Pages, the tour overlay in e2e, window <768px): full list in
  `docs/project-status.md`.
- At the end of a release: update `CHANGELOG.md`, `docs/project-status.md` and
  the version in `package.json`, then commit + push to `holyemilio/suntrace2`
  (live on GitHub Pages).

## Known open items (October 2026)

1. **Deploy the Overpass worker** (manual step for the user — README in
   `server/overpass-cache/`): with real traffic, requests pile onto the public
   Overpass mirrors, the most fragile service.
2. Viewing questions as tap buttons, one at a time on phones (adoption).
3. Accessibility: drawing has no keyboard alternative; sun/shade on the map is
   colour-only; small touch targets; never tested with a screen reader.
4. No e2e on the landing page (checked by screenshot only).
5. Overpass mirror fallback never tested end to end.
6. Validation against real bills: set aside by the user for now.
