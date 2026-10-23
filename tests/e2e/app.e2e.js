/**
 * app.e2e.js — drives the real app in a headless browser.
 *
 * Serves the project over HTTP (the app needs http://, not file://) and stubs the
 * three external data APIs so runs are deterministic and don't hammer public
 * services. Leaflet and fonts are self-hosted (vendor/), so no network at all.
 * Case IDs come from the v3 testbook (docs/archivio/testbook.html); new ones continue the series.
 *
 * SunTrace 2: the app no longer auto-analyses a clicked point with a
 * bussola-set facade — the user draws the room's outline (a polygon) on the
 * map, which locks on closing and is removed via a dedicated button. There is
 * no analysis at all until a room is drawn, so most cases below draw one
 * first via drawRoom()/drawAndAnalyse() rather than relying on it happening
 * automatically at boot.
 *
 * Retired (no longer applicable, the underlying UI is gone): the old T16
 * ("the compass sets the facade") and T31 ("the compass marks the sun") —
 * there is no compass to click or to show a sun marker on. Their spirit lives
 * on in T40 (different room shapes give different estimates) and in T28/T29
 * (the sun readout itself, unrelated to any dial).
 *
 * v4.0.0: the Comfort Rate, the seasonal temperatures and the infissi /
 * isolamento cards are gone (T17, T18, T22, T32, T39 rewritten): the output is
 * now the heating cost in euro, driven by the visit questions.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

let server, browser, origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    try {
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : decodeURIComponent(path)));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(r => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise(r => server.close(r));
});

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** One year of daily climate values — enough for all 12 monthly means. */
function climatePayload() {
  const time = [], temp = [], rh = [], wind = [], precip = [], rad = [];
  const d = new Date(Date.UTC(1991, 0, 1));
  while (d.getUTCFullYear() === 1991) {
    time.push(d.toISOString().slice(0, 10));
    const m = d.getUTCMonth();
    temp.push(8 + 12 * Math.sin((m - 3) * Math.PI / 6));  // ~ -4..20, peaks in July
    rad.push(12 + 8 * Math.sin((m - 3) * Math.PI / 6));   // 4..20 MJ/m² a day
    rh.push(65); wind.push(9); precip.push(2);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { daily: { time, temperature_2m_mean: temp, relative_humidity_2m_mean: rh,
                    windspeed_10m_mean: wind, precipitation_sum: precip,
                    shortwave_radiation_sum: rad } };
}

const rect = (lat, lon, x0, x1, y0, y1, height) => {
  const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    type: 'way', tags: { building: 'yes', 'building:levels': String(height / 3) },
    geometry: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
      .map(([x, y]) => ({ lat: lat + y * mLat, lon: lon + x * mLng })),
  };
};

/** A closed courtyard of tall blocks around the point: guarantees real shadow
 *  for a small room drawn near the centre (the hollow middle — no building
 *  contains it, so every drawn wall stays "exterior" via the no-host fallback). */
function courtyardPayload(lat, lon, height = 30) {
  const d = 12, o = 18, len = 32;
  return { elements: [
    rect(lat, lon, -len, len, d, o, height),
    rect(lat, lon, -len, len, -o, -d, height),
    rect(lat, lon, d, o, -len, len, height),
    rect(lat, lon, -o, -d, -len, len, height),
  ] };
}

/** One big building footprint that fully SURROUNDS a small room drawn at its
 *  centre — every drawn wall sits deep inside it, far from its perimeter, so
 *  classifyRoomEdges marks every wall interior (no wall faces the sun/exterior). */
function engulfingPayload(lat, lon, height = 30) {
  return { elements: [rect(lat, lon, -300, 300, -300, 300, height)] };
}

const ROME_RESULT = { display_name: 'Via Giusti, Roma', lat: '41.8955', lon: '12.5010' };

async function openApp(t, { buildings = 'courtyard', buildingHeight = 30, searchResult = ROME_RESULT, viewport = null, url = '/app.html' } = {}) {
  // An Italian locale makes the app start in Italian through its own auto-detect,
  // so the language-persistence test isn't fighting a forced localStorage value.
  const context = await browser.newContext({ locale: 'it-IT', ...(viewport ? { viewport } : {}) });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  t.after(() => context.close());
  const page = await context.newPage();

  const overpassJson = buildings === false ? { elements: [] }
    : buildings === 'engulf' ? engulfingPayload(41.9028, 12.4964, buildingHeight)
    : courtyardPayload(41.9028, 12.4964, buildingHeight);

  await page.route('**/climate-api.open-meteo.com/**', r =>
    r.fulfill({ json: climatePayload() }));
  await page.route('**/nominatim.openstreetmap.org/reverse**', r =>
    r.fulfill({ json: { address: { country_code: 'it' } } }));
  await page.route('**/nominatim.openstreetmap.org/search**', r =>
    r.fulfill({ json: [searchResult] }));
  await page.route('**/overpass-api.de/**', r => r.fulfill({ json: overpassJson }));

  await page.goto(`${origin}${url}`);
  // Only a genuinely too-small window (< 320px, MIN_USABLE_WIDTH in ui.js) shows
  // the block instead of starting — desktop and mobile both render normally.
  // The zoom control is added once, synchronously, inside initMap() at the very
  // start of startApp() — its presence is "the app actually booted", independent
  // of any analysis (there is none until a room is drawn).
  if (!viewport || viewport.width >= 320) {
    await page.waitForSelector('.leaflet-control-zoom');
  }
  return page;
}

const text = (page, id) => page.locator(`#${id}`).textContent();

/**
 * Click the vertices of a room (default: a triangle) around a centre point on
 * the map, then click back near the first vertex to close the loop and lock
 * the room. Does not wait for the analysis to settle — see drawAndAnalyse().
 */
async function drawRoom(page, { cx, cy, points = [[-40, -30], [40, -30], [0, 40]] } = {}) {
  const box = await page.locator('#map').boundingBox();
  const centerX = cx ?? box.x + box.width / 2;
  const centerY = cy ?? box.y + box.height / 2;
  for (const [dx, dy] of points) await page.mouse.click(centerX + dx, centerY + dy);
  await page.mouse.click(centerX + points[0][0], centerY + points[0][1]); // close the loop
}

/**
 * drawRoom() followed by waiting for the room to lock, be analysed, AND for
 * the async OSM building fetch to resolve and (re)classify exterior/interior
 * walls — without this second wait, a test reading exterior/interior-derived
 * output right after locking can race the still-provisional "every wall
 * exterior" state that renderRoomPolygon()/refreshUI() show optimistically
 * before Overpass responds.
 */
async function drawAndAnalyse(page, opts = {}) {
  // Short timeout: a room drawn near one already analysed in this same
  // browser context can hit fetchBuildingContext's localStorage cache (see
  // ui.js) and never fire a second network request at all — that's correct,
  // cached behaviour, not something to wait 30s to rule out.
  const overpassDone = page.waitForResponse('**/overpass-api.de/**', { timeout: 2000 }).catch(() => null);
  await drawRoom(page, opts);
  await overpassDone;
  // The explicit `undefined` matters: waitForFunction(fn, options) without it
  // treats `options` as the page function's arg instead, silently discarding
  // the timeout override and falling back to Playwright's 30s default.
  await page.waitForFunction(() => document.getElementById('cost-mid').textContent !== '—', undefined, { timeout: 8000 });
  await page.waitForTimeout(30); // let the post-OSM refreshUI() finish applying
}


/** Set every visit answer at once (keys as in the data-answer attributes). */
async function answer(page, values) {
  for (const [key, value] of Object.entries(values)) {
    await page.locator(`select[data-answer="${key}"]`).selectOption(String(value));
  }
  await page.waitForTimeout(50);
}

/** The month/hour sliders live in the folded "Dettagli tecnici" section. */
async function showDetails(page) {
  if (await page.locator('#tech-details').getAttribute('open') === null) {
    await page.locator('#tech-details > summary').click();
  }
}

const KNOWN = { heating: 'gas', glass: 'double', epoch: 'y1950', above: 'flat', below: 'flat' };

/** "37–62" → { lo: 37, hi: 62 } (thousands separators ignored). */
async function costRange(page) {
  const s = (await text(page, 'cost-range')).replace(/[.,\s]/g, '');
  const [lo, hi = lo] = s.split('–').map(Number);
  return { lo, hi };
}

// ─── T01 — the app boots, with no analysis until a room is drawn ─────────────

test('T01: the app loads with no estimate yet; drawing a room produces one, with no page errors', async (t) => {
  const errors = [];
  const page = await openApp(t);
  page.on('pageerror', e => errors.push(e.message));

  assert.ok(await page.locator('#map').isVisible(), 'the map is visible');
  assert.ok(await page.locator('#sidebar').isVisible(), 'the sidebar is visible');
  assert.equal(await text(page, 'cost-range'), '—', 'no room yet → no estimate');
  assert.match(await text(page, 'cost-state'), /Disegna la stanza/);
  assert.ok(await page.locator('#share-btn').isDisabled(), 'nothing to share yet');
  assert.equal(await page.locator('#mobile-warning').isVisible(), false, 'no mobile block on desktop');

  await drawAndAnalyse(page);
  const r = await costRange(page);
  assert.ok(r.lo > 0 && r.hi >= r.lo, `a euro range is shown: ${await text(page, 'cost-range')}`);
  assert.match(await text(page, 'cost-source'), /ARERA/, 'the prices carry their source');
  assert.ok(await page.locator('#share-btn').isEnabled());
  assert.deepEqual(errors, []);
});

// ─── T40 — different room shapes give different estimates ────────────────────

test('T40: a differently-oriented room gives a different estimate', async (t) => {
  const page = await openApp(t, { buildings: false }); // open sky: every wall stays exterior
  await answer(page, KNOWN);
  // A rectangle stretched east-west: its long walls face north/south.
  await drawAndAnalyse(page, { points: [[-80, -8], [80, -8], [80, 8], [-80, 8]] });
  const wide = await text(page, 'cost-sun');

  await page.locator('#remove-room-btn').click();
  await page.waitForTimeout(100);
  // A rectangle stretched north-south: its long walls face east/west instead,
  // catching a different amount of winter sun.
  await drawAndAnalyse(page, { points: [[-8, -80], [8, -80], [8, 80], [-8, 80]] });
  const tall = await text(page, 'cost-sun');

  assert.notEqual(wide, tall, 'the sun through the windows depends on which way the walls face');
});

// ─── T41 / T42 — drawing mechanics ────────────────────────────────────────────

test('T41: fewer than 3 vertices never closes the loop, even clicking back on the first one', async (t) => {
  const page = await openApp(t);
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.mouse.click(cx - 40, cy - 30);
  await page.mouse.click(cx + 40, cy - 30);
  await page.mouse.click(cx - 40, cy - 30); // back on the first vertex, but only 2 so far
  await page.waitForTimeout(200);
  assert.equal(await text(page, 'cost-range'), '—', 'two vertices is not enough to lock');
  assert.equal(await page.locator('.suntrace-marker').count(), 3, 'the third click added a vertex instead of closing');
});

test('T42: the remove-room button clears a locked room and re-enables drawing', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.notEqual(await text(page, 'cost-range'), '—');

  await page.locator('#remove-room-btn').click();
  await page.waitForTimeout(150);
  assert.equal(await text(page, 'cost-range'), '—', 'removing the room resets the output');
  assert.equal(await page.locator('.suntrace-marker').count(), 0, 'no leftover vertex markers');
  assert.ok(await page.locator('#share-btn').isDisabled());

  await drawAndAnalyse(page);
  assert.notEqual(await text(page, 'cost-range'), '—', 'a fresh room can be drawn after removal');
});

test('T46: a room whose sides cross is cleared, with a message to redraw it', async (t) => {
  const page = await openApp(t);
  await drawRoom(page, { points: [[-40, -30], [40, 30], [40, -30], [-40, 30]] }); // a bow tie
  await page.waitForSelector('.map-error-toast', { state: 'visible' });
  assert.match(await text(page, 'map-error-toast'), /si incrociano/);
  assert.equal(await text(page, 'cost-mid'), '—');
  assert.equal(await page.locator('.suntrace-marker').count(), 0, 'drawing starts over');
});

test('T47: the big number is the most likely figure, inside its range', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const mid = Number((await text(page, 'cost-mid')).replace(/[^\d]/g, ''));
  const r = await costRange(page);
  assert.match(await text(page, 'cost-mid'), /^circa /);
  assert.ok(mid >= r.lo && mid <= r.hi, `${mid} within ${r.lo}–${r.hi}`);
});

test('T48: on a phone, tapping outside an open widget closes it', async (t) => {
  const page = await openApp(t, { viewport: { width: 390, height: 844 } });
  await page.locator('#mobile-solar-toggle').click();
  assert.equal(await page.locator('#mobile-solar-widget.collapsed').count(), 0, 'the widget opened');
  await page.mouse.click(120, 400); // on the map
  await page.waitForSelector('#mobile-solar-widget.collapsed', { state: 'attached' });
});

// ─── T14 / T15 — time controls move the sun, not the cost ─────────────────────

test('T14: the month slider moves the sun on the map but never the seasonal cost', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const cost = await text(page, 'cost-range');

  await showDetails(page);
  await page.locator('#month-slider').fill('0');
  await page.waitForFunction(() => document.getElementById('month-label').textContent === 'Gennaio');
  const jan = await text(page, 'val-sun-elevation');

  await page.locator('#month-slider').fill('6');
  await page.waitForFunction(() => document.getElementById('month-label').textContent === 'Luglio');
  const jul = await text(page, 'val-sun-elevation');

  assert.ok(parseFloat(jul) > parseFloat(jan), `the July sun (${jul}) is higher than January's (${jan})`);
  assert.equal(await text(page, 'cost-range'), cost, 'the cost covers the whole season, whatever the slider');
});

test('T15: moving the hour slider updates the label and the sun readouts', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);

  await showDetails(page);
  await page.locator('#hour-slider').fill('12');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '12:00');
  const noonElevation = await text(page, 'val-sun-elevation');

  await page.locator('#hour-slider').fill('2');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '02:00');
  const nightElevation = await text(page, 'val-sun-elevation');

  assert.notEqual(noonElevation, nightElevation);
});

// ─── T17 / T18 / T32 / T22 — the visit questions ──────────────────────────────

test('T17: single glazing makes the room dearer to heat', async (t) => {
  const page = await openApp(t, { buildings: false });
  await answer(page, KNOWN);
  await drawAndAnalyse(page);
  const double = await costRange(page);
  await answer(page, { glass: 'single' });
  const single = await costRange(page);
  assert.ok(single.hi > double.hi, `single ${JSON.stringify(single)} vs double ${JSON.stringify(double)}`);
});

test('T18: a plug-in electric heater costs more than the gas boiler, and says so', async (t) => {
  const page = await openApp(t, { buildings: false });
  await answer(page, KNOWN);
  await drawAndAnalyse(page);
  const gas = await costRange(page);
  assert.match(await text(page, 'cost-electric'), /€ al mese/, 'gas shows the heater comparison');

  await answer(page, { heating: 'electric' });
  const electric = await costRange(page);
  assert.ok(electric.lo > gas.lo);
  assert.ok(await page.locator('#cost-electric-row').isHidden(), 'no comparison with itself');
  assert.match(await text(page, 'checklist'), /stufetta elettrica/, 'the checklist flags it');
});

test('T32: answering the questions narrows the range', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const unknown = await costRange(page);
  assert.match(await text(page, 'cost-state'), /caldaia a gas/, '"Non so" heating says what was assumed');

  await answer(page, KNOWN);
  const known = await costRange(page);
  assert.ok(known.hi - known.lo < unknown.hi - unknown.lo,
    `known ${JSON.stringify(known)} must be narrower than unknown ${JSON.stringify(unknown)}`);
});

test('T22: central heating keeps the euro figure and explains the building split', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  await answer(page, { heating: 'central' });
  assert.notEqual(await text(page, 'cost-range'), '—', 'answering never hides the price');
  assert.match(await text(page, 'cost-state'), /condominio/);
  assert.match(await text(page, 'checklist'), /centralizzato/);
});

test('T43: split bills show the cost per person', async (t) => {
  const page = await openApp(t, { buildings: false });
  await answer(page, KNOWN);
  await drawAndAnalyse(page);
  assert.ok(await page.locator('#cost-split-row').isHidden(), 'one person: no split line');
  await answer(page, { people: 3 });
  assert.match(await text(page, 'cost-split'), /^in 3 persone:/);
});

test('T44: the checklist follows the answers and always asks for the APE', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const items = await page.locator('#checklist li').allTextContents();
  assert.ok(items.length >= 2 && items.length <= 5);
  assert.match(items.at(-1), /APE/);
  assert.ok(items.some(i => /come si scalda/i.test(i)), '"Non so" heating → ask how it is heated');
});

// ─── T37 — climate card ───────────────────────────────────────────────────────

test('T37: the climate card shows the zone and follows the selected month', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.match(await text(page, 'val-zone'), /^[A-F]$/);
  assert.match(await text(page, 'val-humidity'), /^\d+%$/);
  assert.match(await text(page, 'val-wind'), /km\/h$/);

  await showDetails(page);
  await page.locator('#month-slider').fill('6');
  await page.waitForFunction(() => document.getElementById('month-label').textContent === 'Luglio');
  const julyRain = await text(page, 'val-rain');
  await page.locator('#month-slider').fill('1');   // February has fewer days
  await page.waitForFunction(r => document.getElementById('val-rain').textContent !== r, julyRain);
  assert.notEqual(await text(page, 'val-rain'), julyRain, 'rainfall is per month, not fixed');
});

// ─── T45 — the shareable sheet ────────────────────────────────────────────────

test('T45: a shared link rebuilds the same room, answers and estimate', async (t) => {
  const page = await openApp(t, { buildings: false });
  await answer(page, { ...KNOWN, people: 2 });
  await drawAndAnalyse(page);
  const cost = await costRange(page);

  await page.evaluate(() => { navigator.share = undefined; });
  await page.locator('#share-btn').click();
  await page.waitForFunction(() => document.getElementById('map-error-toast').textContent.length > 0);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(url, /app\.html\?v=/);

  const shared = await openApp(t, { buildings: false, url: url.replace(origin, '') });
  await shared.waitForFunction(() => document.getElementById('cost-range').textContent !== '—', undefined, { timeout: 8000 });
  // The link stores the vertices to 6 decimals (~10 cm): same room, same euro to within a rounding.
  const again = await costRange(shared);
  assert.ok(Math.abs(again.lo - cost.lo) <= Math.max(1, cost.lo * 0.002) && Math.abs(again.hi - cost.hi) <= Math.max(1, cost.hi * 0.002),
    `shared ${JSON.stringify(again)} vs original ${JSON.stringify(cost)}`);
  assert.equal(await shared.locator('#q-heating').inputValue(), 'gas');
  assert.equal(await shared.locator('#q-people').inputValue(), '2');
});

// ─── T24 / T25 — language ─────────────────────────────────────────────────────

test('T24: the language switch translates static and dynamic text', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.equal(await page.locator('#search-btn').textContent(), 'Vai');

  await page.locator('.lang-btn[data-lang="en"]').click();
  await page.waitForFunction(() => document.getElementById('search-btn').textContent === 'Go');

  assert.equal(await text(page, 'result-title'), 'Heating this room', 'static text translates');
  assert.match(await text(page, 'cost-source'), /ARERA prices/, 'dynamic text translates');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
});

test('T25: the chosen language survives a reload', async (t) => {
  const page = await openApp(t);
  await page.locator('.lang-btn[data-lang="en"]').click();
  await page.waitForFunction(() => document.getElementById('search-btn').textContent === 'Go');

  await page.reload();
  await page.waitForSelector('.leaflet-control-zoom');
  assert.equal(await page.locator('#search-btn').textContent(), 'Go', 'still English after reload');
});

// ─── T04 / T05 / T06 — address search ─────────────────────────────────────────

test('T04: suggestions appear and clicking one only fills the field, the map stays put', async (t) => {
  const page = await openApp(t, { buildings: false });

  await page.locator('#search-input').fill('Via Giusti Roma');
  await page.waitForSelector('.preview-item');
  await page.locator('.preview-item').first().click();
  assert.equal(await page.locator('#search-input').inputValue(), 'Via Giusti, Roma');

  // Picking a suggestion must not move the map: a room drawn now analyses the
  // still-default Rome centre, not the (unrelated) suggestion's coordinates.
  await drawAndAnalyse(page);
  assert.ok((await text(page, 'coord-lat')).startsWith('41.90'), 'the map never moved to the suggestion');
});

test('T05/T06: Enter does not search, the Go button does move the map', async (t) => {
  const page = await openApp(t, {
    buildings: false,
    searchResult: { display_name: 'Via Giusti, Roma', lat: '45.0', lon: '9.0' }, // far from default Rome centre
  });

  await page.locator('#search-input').fill('Via Giusti Roma');
  await page.locator('#search-input').press('Enter');
  await page.waitForTimeout(200);
  await drawAndAnalyse(page);
  assert.ok((await text(page, 'coord-lat')).startsWith('41.90'), 'Enter must not trigger a search');

  await page.locator('#remove-room-btn').click();
  await page.locator('#search-btn').click();
  await page.waitForTimeout(200);
  await drawAndAnalyse(page);
  assert.ok((await text(page, 'coord-lat')).startsWith('45.0'), '"Vai" moved the map to the searched address');
});

// ─── T11 / T35 — geofencing ───────────────────────────────────────────────────

test('T11: a room drawn outside Italy is rejected and the map recentres on Rome', async (t) => {
  const page = await openApp(t, {
    searchResult: { display_name: 'Paris, France', lat: '48.8566', lon: '2.3522' },
  });
  await page.route('**/nominatim.openstreetmap.org/reverse**', r =>
    r.fulfill({ json: { address: { country_code: 'fr' } } }));

  await page.locator('#search-input').fill('Paris');
  await page.locator('#search-btn').click();
  await page.waitForTimeout(200);
  await drawRoom(page); // locks over Paris — should be rejected
  await page.waitForSelector('.map-error-toast', { state: 'visible' });
  assert.match(await text(page, 'map-error-toast'), /solo in Italia/);
  assert.equal(await text(page, 'cost-range'), '—', 'the rejected room is removed, not analysed');
});

test('T35: the Vatican and San Marino count as Italy, not abroad', async (t) => {
  for (const [nome, cc, lat, lon] of [['Vatican', 'va', '41.9022', '12.4539'],
                                      ['San Marino', 'sm', '43.9356', '12.4473']]) {
    const page = await openApp(t, {
      buildings: false,
      searchResult: { display_name: nome, lat, lon },
    });
    await page.route('**/nominatim.openstreetmap.org/reverse**', r =>
      r.fulfill({ json: { address: { country_code: cc } } }));

    await page.locator('#search-input').fill(nome);
    await page.locator('#search-btn').click();
    await page.waitForTimeout(200);
    await drawAndAnalyse(page);

    assert.equal(await page.locator('#map-error-toast').isVisible(), false,
      `${nome} (${cc}) must not be rejected as foreign`);
    assert.ok((await text(page, 'coord-lat')).startsWith(lat.slice(0, 5)),
      'the room stays on the drawn location');
  }
});

test('T36: an unexpected failure surfaces as a message instead of a dead page', async (t) => {
  const page = await openApp(t);
  await page.evaluate(() => setTimeout(() => { throw new Error('guasto simulato'); }, 0));
  await page.waitForSelector('.map-error-toast', { state: 'visible' });
  const toast = await text(page, 'map-error-toast');
  assert.match(toast, /errore imprevisto/i, 'the user is told something went wrong');
  assert.match(toast, /guasto simulato/, 'and gets the detail worth reporting');
});

// ─── T27 / T28 / T29 / T30 — floor, shadow, orientation ───────────────────────

test('T28/T29: the direct-sun readout reflects the sun and the buildings', async (t) => {
  const page = await openApp(t); // courtyard: a room at the centre keeps every wall exterior
  await drawAndAnalyse(page);

  await showDetails(page);
  await page.locator('#hour-slider').fill('2');            // night
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '02:00');
  assert.match(await text(page, 'val-sun-direct'), /orizzonte/, 'night → below horizon');

  // January at midday: Rome's sun barely clears ~27° elevation, well under what
  // the courtyard's 15-18 m-away, 30 m-tall walls need to stop blocking (~60°+).
  await page.locator('#month-slider').fill('0');
  await page.locator('#hour-slider').fill('12');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '12:00');
  assert.match(await text(page, 'val-sun-direct'), /ombra/, 'low winter sun in a courtyard → shadow');
});

test('T30: a room with no exterior wall gets no sun and says why', async (t) => {
  // A small room drawn deep inside one huge building footprint: every wall
  // classifies interior (see classifyRoomEdges).
  const page = await openApp(t, { buildings: 'engulf' });
  await drawAndAnalyse(page);

  assert.match(await text(page, 'val-sun-direct'), /altra parte/,
    'no exterior wall at all must read "the sun is on the other side"');
  assert.match(await text(page, 'cost-why'), /nessuna parete/);
  assert.match(await text(page, 'cost-sun'), /niente sole/);
});

test('T27: a higher floor escapes the shadow and lets more winter sun in', async (t) => {
  const page = await openApp(t, { buildingHeight: 15 });
  await answer(page, KNOWN);
  await drawAndAnalyse(page);

  await showDetails(page);
  await page.locator('#month-slider').fill('0');
  await page.locator('#hour-slider').fill('12');
  await page.waitForFunction(() => document.getElementById('val-sun-direct').textContent.includes('ombra'));
  const groundSun = await text(page, 'cost-sun');
  const ground = await costRange(page);

  await page.locator('.floor-btn[data-floor="5"]').click();
  await page.waitForFunction(() => !document.getElementById('val-sun-direct').textContent.includes('ombra'));

  assert.notEqual(await text(page, 'cost-sun'), groundSun, 'the sun saving changes with the floor');
  assert.ok((await costRange(page)).lo <= ground.lo, 'more sun can only lower the cheap end');
});

// ─── T33 / T34 / T38 — window size / mobile layout ────────────────────────────

test('T33: shrinking the window activates the mobile layout instead of hiding controls', async (t) => {
  const page = await openApp(t, { buildings: false });
  assert.equal(await page.locator('#mobile-bottom-bar').isVisible(), false, 'no mobile UI yet, at desktop width');

  await page.setViewportSize({ width: 500, height: 820 });
  // #mobile-bottom-bar turning visible is pure CSS (a media query) and can win the
  // race against the JS `resize` listener that still has to run initMobileLayout()
  // and map.invalidateSize(). Drawing before invalidateSize() made the loop-closing
  // check compare against Leaflet's stale size, so it never closed — wait on the
  // JS-driven reparent (a real signal the resize handler finished) instead.
  await page.waitForFunction(() =>
    document.getElementById('mobile-drawer-body')?.contains(document.getElementById('result-card')));
  await drawAndAnalyse(page);
  assert.notEqual(await text(page, 'mobile-cost-range'), '—', 'the cost shows in the bottom bar');
  assert.equal(await page.locator('#mobile-warning').isVisible(), false, 'this width is usable, not blocked');
});

test('T34: opening straight into a narrow window starts the mobile layout, not a block', async (t) => {
  const page = await openApp(t, { viewport: { width: 500, height: 820 } });
  assert.equal(await page.locator('#mobile-warning').isVisible(), false);
  assert.ok(await page.locator('#mobile-bottom-bar').isVisible(), 'the cost bar is there from the start');
  assert.ok(await page.locator('#mobile-drawer-toggle').isVisible(), 'so is the questions drawer handle');
  assert.ok(await page.locator('#remove-room-btn').isVisible(), 'drawing is available on mobile too');

  await page.locator('#mobile-cost').click();
  await page.waitForSelector('#mobile-drawer.open');
  assert.ok(await page.locator('#q-heating').isVisible(), 'tapping the cost opens the questions');
});

test('T38: an extreme width still gets the explanatory block', async (t) => {
  const page = await openApp(t, { viewport: { width: 280, height: 700 } });
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('mobile-warning')).display === 'flex');
  assert.equal(await page.locator('.leaflet-control-zoom').count(), 0, 'the app never started at this width');
});
