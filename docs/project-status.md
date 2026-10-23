# Project status — SunTrace 2

Last updated: **23 October 2026** · version **4.7.0** · repo
`holyemilio/suntrace2` · **live at <https://holyemilio.github.io/suntrace2/>**

Handover document: what's done, what's open and what to know before working on
the project again. The method, formula by formula, is in
[method.md](method.md); developer instructions in
[development.md](development.md); every release in the
[CHANGELOG](../CHANGELOG.md).

**SunTrace 2 is an architectural fork of SunTrace 1** (`holyemilio/Suntrace`,
also live on GitHub Pages): same technical base (vanilla JS, Meeus/SPA, zero
runtime dependencies), but the core interaction is drawing the room. **Since
v4.0.0 the output is the heating cost in euro** (it used to be a "Comfort
Rate"), for people renting (students, workers away from home).

---

## Running everything

```bash
./start.command                      # then http://localhost:8000 (landing page)
npm test                             # 78 unit — solar engine, cost, geometry/shadows, prices, zones
npm run test:e2e                     # 34 e2e  — Playwright drives app.html in a real browser
```

Node is installed on the development Mac: both commands run locally. CI
(`.github/workflows/ci.yml`) reruns them on every push as a second safety net.
For e2e, if Playwright has no browser yet: `npx playwright install chromium`.

---

## How it's built

| File | Responsibility |
|---|---|
| `index.html` + `src/landing.js` + `src/landing.css` | **Landing**: editorial headline, Fig. 1 (sun path over Rome drawn by `solar.js`), § 1 the same room with 4 heating systems (computed by `cost.js` on embedded Milan data, at `prices.js` prices), § 2 the questions, § 3 the sources. Search → `app.html?q=`, geolocation → `app.html?lat=&lng=`. Doesn't import `styles.css`. |
| `app.html` | The app: left column (steps, search, **estimate**, **viewing questions**, **checklist**, **share**, a `<details>` "Technical details" with month/hour sliders, sun and climate), map on the right. Icons: an SVG `<symbol>` set at the top of the file, no emoji. |
| `src/cost.js` | **The heating cost.** Pure. Climate zone and season (DPR 412/93, DPR 74/2013), degree days from Open-Meteo means, heating-hours factor, sun on the vertical wall (Erbs + isotropic, a shadow ray every 10 minutes via callback), heat-loss coefficient H with TABULA U-values, lo/mid/hi, checklist. |
| `src/prices.js` | ARERA prices, gas (€/Smc, per tariff area) and electricity (€/kWh). **Generated monthly** by `scripts/update_prices.py` through `.github/workflows/update-prices.yml`. |
| `src/ambiti.js` | Region (from Nominatim reverse) → ARERA tariff area. |
| `src/zones.js` · `src/data/zone-climatiche.json` | Comune → legal climate zone (DPR 412/93), table built by `scripts/build_zones.py`. |
| `src/solar.js` | Meeus/SPA astronomical engine. **Pure, don't touch without reason**: 23 tests compare it with SunCalc. |
| `src/shadow.js` | Geometry: `outwardNormalAz`, `classifyRoomEdges`, `polygonArea`/`polygonCentroid`/`localToLatLng`, `sunBlocked`, `roomShapeProblem`, `onWater`. Pure. |
| `src/ui.js` | The app: Leaflet, geofencing, APIs, polygon drawing, questions (`select[data-answer]`), `refreshCost()` (estimate + checklist), `refreshUI()` (sun and map per month/hour), per-wall irradiance cache (`irradianceCache`), shareable link (`?v=lat,lng;…&f=&heating=…`), mobile layout. |
| `src/tour.js` | First-visit guided tour. |
| `src/i18n.js` | Italian/English texts for the three pages. Voice: plain words, second person, no emoji. |
| `src/tokens.css` | Paper and ink (`--paper`, `--ink`, `--sun` for sun and money only, `--heat`, `--cold`), fixed `--fs-*` type scale, `--radius: 3px`, and the dark variant. Typefaces: Newsreader (headings, figures), IBM Plex Sans (interface), IBM Plex Mono (readings). |
| `src/styles.css` | App styles. No blur, no shadows, no gradients. |

**Rule of thumb:** every new string goes into **both** languages of
`i18n.js`, and the HTML element gets `data-i18n` (or `-ph`, `-aria`,
`-title`). Quick parity check:

```bash
python3 -c "
import re; s=open('src/i18n.js').read()
it=s[s.index('  it: {'):s.index('  en: {')]; en=s[s.index('  en: {'):]
ki=set(re.findall(r\"'([a-z0-9-]+)':\",it)); ke=set(re.findall(r\"'([a-z0-9-]+)':\",en))
print('ok' if ki==ke else sorted(ki^ke))"
```

---

## External services (all free, no key)

| Service | Use | Notes |
|---|---|---|
| OpenStreetMap tiles | map (`app.html` only) | **Don't use CARTO**: it stamps "API KEY REQUIRED" on every style without a key. Native z19, scaled up to z21. No free dark tiles, so the map stays light in dark mode. |
| Nominatim | address search, reverse geocoding | Accepts `it`, `va`, `sm` (the Vatican and San Marino are enclaves). Reverse gives region (gas tariff area), comune and province (legal climate zone). |
| Overpass | buildings (wall classification, shadows) and water (rooms drawn on water) | The most fragile: rate-limits often. Fallback to two mirrors, **never tested end to end**. With no answer, every wall stays "outside" (conservative fallback). |
| Open-Meteo | climate (temperature, humidity, wind, rain, ground-level sun `shortwave_radiation_sum`) | `monthly` returns empty: `daily` is aggregated by hand. localStorage cache key `omc2_`. |
| ARERA (build time only) | monthly price tables | Fetched by the GitHub Action, never by the browser. |

---

## Open items

1. **Deploy the Overpass worker** (manual: needs a Cloudflare account; README in
   `server/overpass-cache/`). With real traffic, requests pile onto the public
   mirrors; when they fail, the conservative fallback kicks in silently.
2. **Viewing questions as tap buttons**, one at a time on phones (adoption).
3. **Accessibility**: drawing has no keyboard alternative (the main blocker);
   sun/shade on the map is colour-only; floor/language buttons under 44 px; no
   skip link; never tested with a screen reader or an automated checker.
4. **No e2e on the landing page** (checked by screenshot only).
5. **Overpass mirror fallback** never tested end to end.
6. **Validation against real bills**: set aside by the user for now. Without
   it, accuracy can't be stated as a percentage.
7. **Taxes**: the tax factors in `scripts/price-taxes.json` must be rechecked
   every January (an issue is opened automatically).
8. **Logo**: the current one is provisional.

---

## History in brief

- **v3.0 (30/08/2026)** — from single point + compass to drawing the room;
  walls classified outside/inside against the OSM outline.
- **v3.1 (31/08–02/09/2026)** — per-wall sun/shade colours, landing
  geolocation, `EDGE_TOLERANCE_M` 2.5 → 1.0 m, deploy on GitHub Pages.
- **v4.0 (23/10/2026)** — the Comfort Rate is replaced by the heating cost in
  euro; every number checked against public sources (five were wrong, two
  unverifiable values removed); paper-and-ink design; documentation split into
  user-facing and technical.
- **v4.1–4.6 (23/10/2026)** — automatic monthly ARERA prices per tariff area,
  heating hours, refusal of rooms on water or with crossing sides, first-visit
  tour, dark mode, new logo, legal climate zone per comune.

Details in the [CHANGELOG](../CHANGELOG.md).

---

## Pitfalls already paid for

- **Browser cache**: `start.command` sends `Cache-Control: no-store`. If changes
  "don't show", it's almost always an old server still running. GitHub Pages
  doesn't send no-store: after a deploy, a hard reload.
- **Window < 768 px** (also from browser zoom) activates the mobile layout
  (bottom bar, drawer, Info sheet, widgets). Only below **320 px**
  (`MIN_USABLE_WIDTH` in `ui.js`) does the full block appear.
- **`requestAnimationFrame` isn't reliable for UI updates**: it can stay
  silent in a background tab or a headless browser. For updates that MUST
  happen at once (sliders), call `refreshUI()` synchronously.
- **`[hidden]` loses to any author `display` rule**: a rule like
  `.mobile-sheet { display: flex }` overrides the attribute and the panel stays
  visible. Mobile sheets use an explicit `.open` class; where `hidden` is used
  on an element with a display rule (`#cost-lines`, a flex `<dl>`), restate it:
  `.result-lines[hidden] { display: none }`.
- **`.selector > * { position: relative }` on modal/panel containers** promotes
  every child to a positioned element with `z-index: auto`; an absolute close
  button without an explicit `z-index` can end up under a later sibling and
  lose its clicks. Always give absolute close buttons an explicit `z-index`.
- **CSS `transform` + `backdrop-filter`**: Chromium doesn't resolve clicks on
  transformed elements inside a blurred panel. Floating map buttons are placed
  with explicit `left`/`top`, never `transform`. (There's no blur left in the
  design, but the rule stands.)
- **Floating map buttons: measure real coordinates, not by eye.**
  `#remove-room-btn` once sat exactly on the collapsed `#map-hint` (same 42×42
  box) and made it impossible to reopen. Before placing a new absolute element
  on the map, measure every state (open/collapsed) of its neighbours with
  Playwright `boundingBox()`.
- **`outwardNormalAz(a, c, click)` returns the azimuth TOWARDS `click`**, not
  away from it. For a room side pointing outwards from an inside point (the
  centroid in `lockRoom()`), flip it: `(outwardNormalAz(a,c,centroid)+180)%360`.
  Forgetting the flip makes every wall face inwards — no error, just wrong
  numbers.
- **The "Sun on the walls" reading** has three cases: in sun, shaded by a
  building, sun on the other side. Don't merge them.
- **Flex column + `overflow: hidden`**: an item with non-visible overflow in a
  flex container has an automatic minimum size of 0, so all the shrinking lands
  on it. `#sidebar > *` has `flex-shrink: 0` for this reason.
- **`landing.css` doesn't import `styles.css`**: the latter sets
  `body { overflow: hidden; height: 100vh }` for the fixed app layout, which
  would break the landing's scrolling. They share only `tokens.css`.
- **`page.waitForFunction(fn, { timeout: N })` in core Playwright**: the options
  object silently becomes the function's `arg` unless `undefined` is passed as
  the second parameter: `page.waitForFunction(fn, undefined, { timeout: N })`.
  Otherwise the timeout is ignored and the 30 s default applies.
- **T33 (window shrinks → mobile layout) was flaky**: it waited for the bottom
  bar to become visible via CSS, which can happen before the JS `resize`
  handler calls `map.invalidateSize()`; drawing before that used Leaflet's
  stale size and the loop never closed. Fix: wait for a JS-driven signal (the
  reparenting of `#result-card` into the drawer, done in the same handler).
- **Controls inside a closed `<details>`**: the month/hour sliders live in
  "Technical details". Playwright's `fill()` waits for visibility and hangs
  until the 30 s timeout. e2e tests open the section first (`showDetails`);
  `textContent()` works even when closed.
- **`.md` links on GitHub Pages**: Pages (Jekyll) turns `docs/method.md` into
  `docs/method.html`, so a relative link to the `.md` breaks online. The app
  and landing link to the github.com version, which also renders the formulas.
- **The first-visit tour covers the whole app**: an e2e test opening a clean
  context finds the overlay above the map and every click misses. `openApp()`
  in `app.e2e.js` sets `suntrace_tour_done` with `addInitScript` before
  loading; only T51 passes `tour: true`.
- **The toast keeps its text after hiding**: `hideToast()` only sets
  `display: none`. A test waiting for "any toast text" can pass on a stale
  message; wait for the specific text (T45 waits for "copiato").
