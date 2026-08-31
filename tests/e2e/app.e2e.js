/**
 * app.e2e.js — drives the real app in a headless browser.
 *
 * Serves the project over HTTP (the app needs http://, not file://) and stubs the
 * three external data APIs so runs are deterministic and don't hammer public
 * services. Leaflet and fonts are self-hosted (vendor/), so no network at all.
 * Cases map to the testbook IDs (docs/testbook.html).
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
  const time = [], temp = [], rh = [], wind = [], precip = [];
  const d = new Date(Date.UTC(1991, 0, 1));
  while (d.getUTCFullYear() === 1991) {
    time.push(d.toISOString().slice(0, 10));
    const m = d.getUTCMonth();
    temp.push(8 + 12 * Math.sin((m - 3) * Math.PI / 6));  // ~ -4..20, peaks in July
    rh.push(65); wind.push(9); precip.push(2);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { daily: { time, temperature_2m_mean: temp, relative_humidity_2m_mean: rh,
                    windspeed_10m_mean: wind, precipitation_sum: precip } };
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

async function openApp(t, { buildings = 'courtyard', buildingHeight = 30, searchResult = ROME_RESULT, viewport = null } = {}) {
  // An Italian locale makes the app start in Italian through its own auto-detect,
  // so the language-persistence test isn't fighting a forced localStorage value.
  const context = await browser.newContext({ locale: 'it-IT', ...(viewport ? { viewport } : {}) });
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

  await page.goto(`${origin}/app.html`);
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
  await page.waitForFunction(() => document.getElementById('thermal-result').textContent !== '--°C', undefined, { timeout: 8000 });
  await page.waitForTimeout(30); // let the post-OSM refreshUI() finish applying
}

// ─── T01 — the app boots, with no analysis until a room is drawn ─────────────

test('T01: the app loads with no analysis yet; drawing a room produces one, with no page errors', async (t) => {
  const errors = [];
  const page = await openApp(t);
  page.on('pageerror', e => errors.push(e.message));

  assert.ok(await page.locator('#map').isVisible(), 'the map is visible');
  assert.ok(await page.locator('#sidebar').isVisible(), 'the sidebar is visible');
  assert.equal(await text(page, 'thermal-result'), '--°C', 'no room yet → no estimate');
  assert.ok(await page.locator('#remove-room-btn').isVisible(), 'the remove-room button is always there');
  assert.equal(await page.locator('#mobile-warning').isVisible(), false, 'no mobile block on desktop');

  await drawAndAnalyse(page);
  assert.match(await text(page, 'thermal-result'), /^-?\d+\.\d°C$/);
  assert.match(await text(page, 'comfort-rate-stars'), /⭐/);
  assert.deepEqual(errors, []);
});

// ─── T02 — different room shapes give different estimates ────────────────────

test('T40: a differently-shaped room gives a different estimate', async (t) => {
  const page = await openApp(t, { buildings: false }); // open sky: every wall stays exterior
  // A rectangle stretched east-west: its long walls face north/south.
  await drawAndAnalyse(page, { points: [[-160, -8], [160, -8], [160, 8], [-160, 8]] });
  const wideTemp = await text(page, 'thermal-result');

  await page.locator('#remove-room-btn').click();
  await page.waitForTimeout(100);
  // A rectangle stretched north-south: its long walls face east/west instead,
  // catching a very different amount of direct sun at this hour.
  await drawAndAnalyse(page, { points: [[-8, -160], [8, -160], [8, 160], [-8, 160]] });
  const tallTemp = await text(page, 'thermal-result');

  assert.notEqual(wideTemp, tallTemp, 'a differently-oriented set of walls must change the estimate');
});

// ─── T03/T04 — drawing mechanics: closing the loop, and the remove button ────

test('T41: fewer than 3 vertices never closes the loop, even clicking back on the first one', async (t) => {
  const page = await openApp(t);
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.mouse.click(cx - 40, cy - 30);
  await page.mouse.click(cx + 40, cy - 30);
  await page.mouse.click(cx - 40, cy - 30); // back on the first vertex, but only 2 so far
  await page.waitForTimeout(200);
  assert.equal(await text(page, 'thermal-result'), '--°C', 'two vertices is not enough to lock');
  assert.equal(await page.locator('.suntrace-marker').count(), 3, 'the third click added a vertex instead of closing');
});

test('T42: the remove-room button clears a locked room and re-enables drawing', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.notEqual(await text(page, 'thermal-result'), '--°C');

  await page.locator('#remove-room-btn').click();
  await page.waitForTimeout(150);
  assert.equal(await text(page, 'thermal-result'), '--°C', 'removing the room resets the output');
  assert.equal(await page.locator('.suntrace-marker').count(), 0, 'no leftover vertex markers');

  // Drawing again after removal must work exactly like the first time.
  await drawAndAnalyse(page);
  assert.notEqual(await text(page, 'thermal-result'), '--°C', 'a fresh room can be drawn after removal');
});

// ─── T14 / T15 — time controls ────────────────────────────────────────────────

test('T14: moving the month slider updates the label and the estimate', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);

  await page.locator('#month-slider').fill('0');
  await page.waitForFunction(() => document.getElementById('month-label').textContent === 'Gennaio');
  const jan = await text(page, 'thermal-result');

  await page.locator('#month-slider').fill('6');
  await page.waitForFunction(() => document.getElementById('month-label').textContent === 'Luglio');
  const jul = await text(page, 'thermal-result');

  assert.notEqual(jan, jul);
  assert.ok(parseFloat(jul) > parseFloat(jan), `July (${jul}) should be warmer than January (${jan})`);
});

test('T15: moving the hour slider updates the label and the sun readouts', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);

  await page.locator('#hour-slider').fill('12');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '12:00');
  const noonElevation = await text(page, 'val-sun-elevation');

  await page.locator('#hour-slider').fill('2');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '02:00');
  const nightElevation = await text(page, 'val-sun-elevation');

  assert.notEqual(noonElevation, nightElevation);
});

// ─── T17 / T18 / T32 — building properties ────────────────────────────────────

test('T17: single glazing changes the seasonal figures', async (t) => {
  // Open sky, every wall stays exterior and gets real sun — the glazing
  // modifier has something to act on.
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const before = await text(page, 'val-q-summer');
  await page.locator('input[name="windows"][value="single"]').check();
  await page.waitForFunction(b => document.getElementById('val-q-summer').textContent !== b, before);
  assert.notEqual(await text(page, 'val-q-summer'), before);
});

test('T18: insulation warms winter and cools summer', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const winterBeforeText = await text(page, 'val-q-winter');
  const winterBefore = parseFloat(winterBeforeText);
  const summerBefore = parseFloat(await text(page, 'val-q-summer'));

  await page.locator('input[name="insulation"][value="coat"]').check();
  // Compare against the captured text itself (not a reconstructed "X.X°C"
  // string) — reconstructing from the parsed float mishandles -0 (JS's
  // toFixed drops the sign on negative zero), which can make the wait
  // resolve immediately instead of actually waiting for the change.
  await page.waitForFunction(w => document.getElementById('val-q-winter').textContent !== w, winterBeforeText);

  assert.ok(parseFloat(await text(page, 'val-q-winter')) > winterBefore);
  assert.ok(parseFloat(await text(page, 'val-q-summer')) < summerBefore);
});

test('T32: the choice cards are single-select and the fortress tier is the strongest', async (t) => {
  const page = await openApp(t, { buildings: false });
  await drawAndAnalyse(page);
  const bareText = await text(page, 'val-q-winter');
  const bareWinter = parseFloat(bareText);

  await page.locator('input[name="insulation"][value="coat"]').check();
  await page.waitForFunction(w => document.getElementById('val-q-winter').textContent !== w, bareText);
  const coatText = await text(page, 'val-q-winter');
  const coatWinter = parseFloat(coatText);

  await page.locator('input[name="insulation"][value="fortress"]').check();
  await page.waitForFunction(w => document.getElementById('val-q-winter').textContent !== w, coatText);
  const fortWinter = parseFloat(await text(page, 'val-q-winter'));

  assert.ok(fortWinter > coatWinter && coatWinter > bareWinter,
    `winter should rise with insulation: ${bareWinter} < ${coatWinter} < ${fortWinter}`);
  assert.equal(await page.locator('input[name="insulation"]:checked').count(), 1,
    'only one wall option can be selected');
  assert.equal(await page.locator('input[name="windows"]:checked').count(), 1,
    'only one glazing option can be selected');
});

test('T37: the local-climate card follows the selected month', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  await page.waitForFunction(() => document.getElementById('val-humidity').textContent !== '—');

  assert.match(await text(page, 'val-humidity'), /^\d+%$/);
  assert.match(await text(page, 'val-wind'), /km\/h$/);
  assert.match(await text(page, 'val-rain'), /mm$/);
  assert.match(await text(page, 'val-feels'), /°C$/);

  const julyRain = await text(page, 'val-rain');
  await page.locator('#month-slider').fill('1');   // February has fewer days
  await page.waitForFunction(r => document.getElementById('val-rain').textContent !== r, julyRain);
  assert.notEqual(await text(page, 'val-rain'), julyRain, 'rainfall is per month, not fixed');
});

// ─── T22 — Comfort Rate detail ────────────────────────────────────────────────

test('T22: the Comfort Rate badge opens a populated detail modal', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.equal(await page.locator('#kpi-modal').isVisible(), false);

  await page.locator('#energy-class-field').click();
  await page.waitForSelector('#kpi-modal.open');

  assert.match(await text(page, 'kpi-winter-temp'), /°C$/);
  assert.match(await text(page, 'kpi-summer-temp'), /°C$/);
  assert.match(await text(page, 'kpi-humidity'), /^\d+%$/, 'humidity comes from the climate API');
  assert.match(await text(page, 'kpi-rain'), /mm$/);
  assert.ok((await text(page, 'kpi-tip')).length > 20, 'a tip is shown');
  assert.ok((await text(page, 'kpi-exposure')).length > 10, 'the sun-exposure line is shown');

  await page.locator('#modal-close-btn').click();
  await page.waitForSelector('#kpi-modal.open', { state: 'detached' }).catch(() => {});
  assert.equal(await page.locator('#kpi-modal').isVisible(), false, 'the modal closes');
});

// ─── T24 / T25 — language ─────────────────────────────────────────────────────

test('T24: the language switch translates static and dynamic text', async (t) => {
  const page = await openApp(t);
  await drawAndAnalyse(page);
  assert.equal(await page.locator('#search-btn').textContent(), 'Vai');

  await page.locator('.lang-btn[data-lang="en"]').click();
  await page.waitForFunction(() => document.getElementById('search-btn').textContent === 'Go');

  assert.equal(await page.locator('.q-label').first().textContent(), 'Winter', 'seasons translate');
  assert.match(await text(page, 'main-output-title'), /^Estimate/, 'dynamic title translates');
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

// ─── T03 (search) — address search ────────────────────────────────────────────

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

// ─── T11 — geofencing ─────────────────────────────────────────────────────────

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
  const toast = await text(page, 'map-error-toast');
  assert.match(toast, /Ops! Ci hai scoperto/);
  assert.equal(await text(page, 'thermal-result'), '--°C', 'the rejected room is removed, not analysed');
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
  await page.evaluate(() => { throw new Error('guasto simulato'); }).catch(() => {});
  await page.evaluate(() => setTimeout(() => { throw new Error('guasto simulato'); }, 0));
  await page.waitForSelector('.map-error-toast', { state: 'visible' });
  const toast = await text(page, 'map-error-toast');
  assert.match(toast, /errore imprevisto/i, 'the user is told something went wrong');
  assert.match(toast, /guasto simulato/, 'and gets the detail worth reporting');
});

// ─── T27 / T28 / T29 / T30 / T39 — floor, shadow, orientation ─────────────────

test('T28/T29: the direct-sun readout reflects the sun and the buildings', async (t) => {
  const page = await openApp(t); // courtyard: a room at the centre keeps every wall exterior
  await drawAndAnalyse(page);

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

test('T30: a room with no exterior wall reads "sun on the other side"', async (t) => {
  // A small room drawn deep inside one huge building footprint: every wall
  // classifies interior (see classifyRoomEdges), so none of them ever faces
  // the sun/exterior at all, on a normal floor.
  const page = await openApp(t, { buildings: 'engulf' });
  await drawAndAnalyse(page);

  assert.match(await text(page, 'val-sun-direct'), /altro lato/,
    'no exterior wall at all must read "sun on the other side"');
  const tempBefore = await text(page, 'thermal-result');
  await page.locator('#month-slider').fill('6'); // even peak summer sun changes nothing
  await page.waitForTimeout(150);
  assert.match(await text(page, 'val-sun-direct'), /altro lato/, 'still no exterior wall to catch it');
});

test('T39: the roof (floor 5) gets sun regardless of wall orientation', async (t) => {
  // Same fully-interior room as T30 — a wall reads "altro lato" here, but the
  // roof has no facing direction at all, so it must not.
  const page = await openApp(t, { buildings: 'engulf' });
  await drawAndAnalyse(page);
  assert.match(await text(page, 'val-sun-direct'), /altro lato/, 'walls: no exterior wall to catch the sun');

  await page.locator('.floor-btn[data-floor="5"]').click();
  await page.waitForFunction(() => document.getElementById('val-sun-direct').textContent.includes('sole'));
  assert.match(await text(page, 'val-sun-direct'), /sole/, 'the roof catches the sun even with zero exterior walls');

  await page.locator('.floor-btn[data-floor="0"]').click();
  assert.match(await text(page, 'val-sun-direct'), /altro lato/, 'leaving the roof brings the wall verdict back');
});

test('T27: choosing a higher floor escapes the shadow and changes the reading', async (t) => {
  const page = await openApp(t, { buildingHeight: 15 });
  await drawAndAnalyse(page);

  await page.locator('#month-slider').fill('0');
  await page.locator('#hour-slider').fill('12');
  await page.waitForFunction(() => document.getElementById('hour-label').textContent === '12:00');
  await page.waitForFunction(() => document.getElementById('val-sun-direct').textContent.includes('ombra'));

  const groundTemp = await text(page, 'thermal-result');
  assert.match(await text(page, 'val-sun-direct'), /ombra/, 'ground floor starts in shadow');

  await page.locator('.floor-btn[data-floor="5"]').click();
  await page.waitForFunction(() => !document.getElementById('val-sun-direct').textContent.includes('ombra'));

  assert.ok(parseFloat(await text(page, 'thermal-result')) > parseFloat(groundTemp),
    'escaping the shadow warms the room');
});

// ─── T33 / T34 / T38 — window size / mobile layout ────────────────────────────

test('T33: shrinking the window activates the mobile layout instead of hiding controls', async (t) => {
  const page = await openApp(t, { buildings: false });
  assert.equal(await page.locator('#mobile-bottom-bar').isVisible(), false, 'no mobile UI yet, at desktop width');

  // Narrower than the desktop breakpoint — same as a live window resize or browser zoom.
  await page.setViewportSize({ width: 500, height: 820 });
  // #mobile-bottom-bar turning visible is pure CSS (a media query) and can win the
  // race against the JS `resize` listener that still has to run initMobileLayout()
  // (which reparents #energy-class-field into the bar) and map.invalidateSize().
  // Drawing on the map before invalidateSize() runs made the polygon-closing check
  // compare against Leaflet's stale pre-resize size, so the loop never closed and
  // drawAndAnalyse() hung for the rest of its timeout — wait on the JS-driven
  // reparent (a real signal the resize handler finished), not just CSS visibility.
  await page.waitForFunction(() =>
    document.getElementById('mobile-bottom-bar')?.contains(document.getElementById('energy-class-field')));
  await drawAndAnalyse(page);
  assert.match(await text(page, 'val-q-winter'), /°C$/, 'the seasonal reading followed into the bottom bar');
  assert.equal(await page.locator('#mobile-warning').isVisible(), false, 'this width is usable, not blocked');
});

test('T34: opening straight into a narrow window starts the mobile layout, not a block', async (t) => {
  const page = await openApp(t, { viewport: { width: 500, height: 820 } });
  assert.equal(await page.locator('#mobile-warning').isVisible(), false);
  assert.ok(await page.locator('#mobile-bottom-bar').isVisible(), 'the seasonal strip is there from the start');
  assert.ok(await page.locator('#mobile-drawer-toggle').isVisible(), 'so is the settings drawer handle');
  assert.ok(await page.locator('#remove-room-btn').isVisible(), 'drawing is available on mobile too');
});

test('T38: an extreme width still gets the explanatory block', async (t) => {
  const page = await openApp(t, { viewport: { width: 280, height: 700 } });
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('mobile-warning')).display === 'flex');
  assert.equal(await page.locator('.leaflet-control-zoom').count(), 0, 'the app never started at this width');
});
