/**
 * ui.js — Application UI controller.
 * Imports solar.js, climate.js and shadow.js; manages Leaflet map, DOM
 * interactions, autocomplete, geolocation, the room-polygon drawing
 * interaction, and the KPI modal.
 */

import {
  solarPosition,
  sunriseSunset,
  facadeIrradiance,
  dailySunHours,
  roofIrradiance,
  dailyRoofSunHours,
  localToUTC,
  offsetByAzimuth,
} from './solar.js';

import {
  airTemperature,
  solarThermalGain,
  seasonalTemperatures,
  roomSeasonalTemperatures,
  cozynessScore,
  apparentTemperature,
} from './climate.js';

import {
  localXY,
  localToLatLng,
  outwardNormalAz,
  polygonArea,
  polygonCentroid,
  classifyRoomEdges,
  sunBlocked,
  monthlySunAccess,
} from './shadow.js';

import { t, monthName, getLang, setLang, applyTranslations } from './i18n.js';

// ─── constants ────────────────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_DEBOUNCE_MS = 420;
const TIMEZONE = 'Europe/Rome';
const DEFAULT_YEAR = 2026;

// Bounding box covering Italy including islands (Sicily, Sardinia, Lampedusa)
const ITALY_BOUNDS = { latMin: 35.4, latMax: 47.1, lonMin: 6.6, lonMax: 18.6 };

// Vatican City and San Marino are enclaves surrounded by Italy: Nominatim gives
// them their own country code, but a click there is not "abroad".
const IN_ITALY_CODES = new Set(['it', 'va', 'sm']);

// Open-Meteo climate normals (1991-2020, EC-Earth3P-HR). "monthly" aggregation
// param returns an empty payload on this API — verified against the live
// endpoint — so we pull daily means and aggregate to 12 monthly values ourselves.
const OPEN_METEO_URL = 'https://climate-api.open-meteo.com/v1/climate';
const OPEN_METEO_RANGE = 'models=EC_Earth3P_HR&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_mean,relative_humidity_2m_mean,windspeed_10m_mean,precipitation_sum';
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Shadow model: one storey ≈ 3 m, and a facade in shadow still receives diffuse
// sky light — never zero, just a small fraction of the direct gain.
const FLOOR_HEIGHT_M = 3;
const DIFFUSE_K = 0.15;

// Clicking/tapping within this many metres of the room's first vertex closes
// the loop instead of adding another vertex — generous enough for a fingertip
// on a touch screen without needing to be pixel-precise.
const CLOSE_LOOP_TOLERANCE_M = 1.2;

// Nominatim reverse geocoding — precise land/water/country classification.
// Land returns address.country_code; open sea returns an error (no country).
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// ─── state ────────────────────────────────────────────────────────────────────

let map = null;
let vertexMarkers = [];   // in-progress drawing: one marker per placed vertex
let drawPolyline = null;  // in-progress drawing: open line through the vertices
let roomPolygon = null;   // locked room's closed outline
let wallLines = [];       // one highlighted line per exterior (sun-facing) wall
let shadowPolygon = null;
let sunRay = null;
let errorTimeout = null;
let autocompleteTimeout = null;
let customBaseTemps = null; // 12 monthly temp means from Open-Meteo; null = fallback to climate.js Rome table
let climateExtra = null;    // { rh, wind, precip } monthly means from Open-Meteo (may be null / partial)
let currentFloor = 0;       // user's floor (0 = ground … 5); higher clears nearby rooftops → less obstruction
// Floor 5 isn't "a wall 15m up" like the others — it's the roof: a horizontal
// surface with no facing direction, so orientation stops mattering entirely.
const ROOF_FLOOR = 5;
let lastAnalysis = null; // { seasonal, comfort, ... } from the latest refreshUI(), read by openKPIModal()
// Coordinates of the last picked autocomplete suggestion, kept so the "Vai"
// button can analyse them without a second Nominatim call. Includes the exact
// query text it was picked for, to invalidate it if the user edits the field.
let pendingSearch = null; // { query, lat, lng } | null

// The room being drawn/analysed. `vertices` grows as the user clicks; once the
// loop is closed the room locks (`locked: true`) and `walls`/`areaM2`/`lat,lng`
// (the centroid) are derived. Re-drawing requires removeRoom() first.
let currentRoom = {
  vertices: [],  // [{lat,lng}], in click order, open until locked
  locked: false,
  lat: null, lng: null,   // centroid, set once locked
  buildings: [], // OSM footprints + heights near the centroid (for shadow casting)
  areaM2: 0,
  walls: [],     // [{i, azDeg, lengthM, exterior, midLat, midLng}], set once locked
};

// Bumped on every lock()/removeRoom(): lets async work (Overpass/Nominatim
// fetches) started for one room recognise it's been superseded by another.
let roomGen = 0;

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function showToast(msg, type = 'default', duration = 10000) {
  const toast = $('map-error-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'map-error-toast' + (type !== 'default' ? ` ${type}` : '');
  toast.style.display = 'block';
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

function hideToast() {
  const toast = $('map-error-toast');
  if (toast) toast.style.display = 'none';
  if (errorTimeout) { clearTimeout(errorTimeout); errorTimeout = null; }
}

// ─── time helpers ─────────────────────────────────────────────────────────────

function getSelectedUTCDate() {
  const month = parseInt($('month-slider').value);
  const localHour = parseInt($('hour-slider').value);
  return localToUTC(DEFAULT_YEAR, month, 15, localHour, TIMEZONE);
}

function getSelectedMonth() { return parseInt($('month-slider').value); }
function getSelectedLocalHour() { return parseInt($('hour-slider').value); }

// ─── map initialisation ───────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', { zoomControl: false, maxZoom: 19 }).setView([41.9028, 12.4964], 17);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Standard OpenStreetMap tiles: free, no API key, and legible — CARTO's
  // basemaps now stamp "API KEY REQUIRED" over every style without a key.
  L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '©<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,          // the OSM tile server serves up to z19
    }
  ).addTo(map);

  map.on('click', e => addVertex(e.latlng));
}

// Clean custom marker (a green dot) — replaces Leaflet's default pin + grey shadow.
// The icon box is bigger than the visible dot on purpose: it's the drag
// hit-area (Leaflet's 1-finger drag grabs this element), and a 16px dot
// alone is too small a touch target.
function markerIcon() {
  return L.divIcon({
    className: 'suntrace-marker',
    html: '<span class="suntrace-marker-dot"></span>',
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

// ─── map overlays ─────────────────────────────────────────────────────────────

// In-progress drawing (vertex markers + open line) — cleared on lock and on
// removeRoom(), never touched by refreshUI()'s per-refresh redraws below.
function clearDrawingOverlays() {
  vertexMarkers.forEach(m => map.removeLayer(m));
  vertexMarkers = [];
  if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
}

// The locked room's outline — redrawn only when the room is (re)locked or its
// wall classification is refined by OSM data, never on every refreshUI() (the
// shape itself doesn't change with month/hour/floor/etc).
function clearRoomPolygon() {
  if (roomPolygon) { map.removeLayer(roomPolygon); roomPolygon = null; }
}

function renderRoomPolygon() {
  clearRoomPolygon();
  const pts = currentRoom.vertices.map(v => [v.lat, v.lng]);
  roomPolygon = L.polygon(pts, {
    color: '#22c55e',
    weight: 2,
    fillColor: '#22c55e',
    fillOpacity: 0.06,
  }).addTo(map);
}

// Exterior-wall highlights — unlike the outline above, these DO get redrawn on
// every refreshUI() (month/hour/floor change which walls are actually lit
// right now). Interior walls are skipped entirely: only exterior walls ever
// get a highlight, lit or not.
function clearWallHighlights() {
  wallLines.forEach(l => map.removeLayer(l));
  wallLines = [];
}

/**
 * @param {Array} exteriorWalls
 * @param {?Map<number,boolean>} perWallLit — wall index (`w.i`) -> "catching
 *   direct sun right now" (already computed once in refreshUI() for kNow, not
 *   recomputed here). Pass null for the roof branch, where per-wall lighting
 *   isn't the relevant computation — every exterior wall then shows the same
 *   plain "exposed" green, undifferentiated.
 */
function renderWallHighlights(exteriorWalls, perWallLit) {
  clearWallHighlights();
  const n = currentRoom.vertices.length;
  for (const w of exteriorWalls) {
    const lit = perWallLit ? perWallLit.get(w.i) : true;
    const a = currentRoom.vertices[w.i];
    const c = currentRoom.vertices[(w.i + 1) % n];
    wallLines.push(L.polyline([[a.lat, a.lng], [c.lat, c.lng]], {
      color: lit ? '#22c55e' : '#64748b', // lit: same green as the outline accent; shadowed: slate grey
      weight: 6,
      opacity: 0.95,
    }).addTo(map));
  }
}

// Sun-position-dependent overlays (shadow wedge + sun ray) — these DO change
// on every refreshUI() (month/hour move the sun). Drawn from the room's
// centroid: one representative wedge for the whole room, not one per wall —
// a deliberate simplification, same spirit as the rest of this heuristic model.
function clearAnalysisOverlays() {
  if (shadowPolygon) { map.removeLayer(shadowPolygon); shadowPolygon = null; }
  if (sunRay)        { map.removeLayer(sunRay);        sunRay        = null; }
}

function renderMapOverlays(lat, lng, elevation, azimuth) {
  clearAnalysisOverlays();
  if (elevation <= 0) return;

  const shadowAz = (azimuth + 180) % 360;
  const L_shadow = Math.min(0.00055, 0.00004 + (1 / elevation) * 0.006);
  const p1 = offsetByAzimuth(lat, lng, shadowAz - 8, L_shadow);
  const p2 = offsetByAzimuth(lat, lng, shadowAz + 8, L_shadow);
  const opacity = Math.max(0.18, 0.58 - (elevation / 90) * 0.32);

  shadowPolygon = L.polygon([[lat, lng], p1, p2], {
    color: 'rgba(148, 163, 184, 0.45)', // faint outline so the wedge reads on the dark map
    fillColor: '#020509',
    fillOpacity: Math.min(0.6, opacity + 0.12),
    weight: 1,
  }).addTo(map);

  const sunPt = offsetByAzimuth(lat, lng, azimuth, 0.00028);
  sunRay = L.polyline([sunPt, [lat, lng]], {
    color: '#f5b301',
    weight: 2,
    dashArray: '6 5',
    opacity: 0.95,
  }).addTo(map);
}

// ─── geofencing ───────────────────────────────────────────────────────────────

const ROME = { lat: 41.9028, lng: 12.4964 };

// Fast offline pre-filter: true when clearly outside the Italian bounding box.
function isOutsideBox(lat, lng) {
  return lat < ITALY_BOUNDS.latMin || lat > ITALY_BOUNDS.latMax
      || lng < ITALY_BOUNDS.lonMin || lng > ITALY_BOUNDS.lonMax;
}

/**
 * Precise classification of a point via Nominatim reverse geocoding.
 * Land returns a country_code; open sea returns an error (no country), which we
 * read as water — Italian waters when inside the box, foreign waters otherwise.
 * @returns {Promise<'it-land'|'it-water'|'foreign'>}
 */
async function classifyLocation(lat, lng) {
  const url = `${REVERSE_URL}?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&zoom=10&addressdetails=1`;
  const res = await fetch(url);
  const data = await res.json();
  const cc = data && data.address ? data.address.country_code : null;
  if (cc && IN_ITALY_CODES.has(cc)) return 'it-land';
  if (cc) return 'foreign';               // some other country's land
  return isOutsideBox(lat, lng) ? 'foreign' : 'it-water';
}

// A room drawn abroad or over water can't sensibly be "moved" to Rome (unlike
// the old single click-point) — it's simply removed, and the map recentres on
// Rome as a friendly default so the user isn't left looking at a foreign view.
function goToRome() {
  map.setView([ROME.lat, ROME.lng], 13);
}

function rejectForeign() {
  showToast(t('geo-foreign'), 'warn', 10000);
  removeRoom();
  goToRome();
}

function rejectWater() {
  showToast(t('geo-water'), 'warn', 10000);
  removeRoom();
  goToRome();
}

// Load real climate normals for a validated in-Italy room, then re-render.
// `myGen` guards against a slower fetch resolving after the room it was for
// has since been removed or redrawn.
function loadClimateFor(lat, lng, myGen) {
  fetchClimateNormals(lat, lng)
    .then(normals => {
      if (roomGen !== myGen) return;
      customBaseTemps = normals.temp;
      climateExtra = { rh: normals.rh, wind: normals.wind, precip: normals.precip };
      refreshUI();
    })
    .catch(() => { /* silent fallback — Rome table already in effect */ });
}

// ─── OSM building context (real facade orientation + obstruction) ─────────────

// Optional edge cache (see server/overpass-cache): once deployed, paste its URL
// here and it becomes the first stop — instant answers for already-seen areas,
// no rate limits. Empty string = disabled; the public mirrors below always
// remain as fallback, so the app never gains a new single point of failure.
const OVERPASS_PROXY_URL = '';

// The main Overpass instance is a heavily used free service that rate-limits and
// refuses connections under load; fall through to the community mirrors.
const OVERPASS_URLS = [
  ...(OVERPASS_PROXY_URL ? [OVERPASS_PROXY_URL] : []),
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Called for a validated in-Italy room: fetch real climate + building context.
function onValidRoom(lat, lng, myGen) {
  loadClimateFor(lat, lng, myGen);
  detectBuildingContext(lat, lng, myGen);
}

// Pulse the obstruction/cardinal readouts while OSM is being queried.
function setBuildingLoading(on) {
  ['telemetry-cardinal', 'val-manual-obs'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('loading-pulse', on);
  });
}

/**
 * Fetch real OSM buildings around the room, refine each wall's provisional
 * exterior/interior classification against the containing building's actual
 * footprint, and re-render. Cached, silent, best-effort — never throws upward.
 * `myGen` guards against a slower fetch resolving after the room it was for
 * has since been removed or redrawn.
 */
async function detectBuildingContext(lat, lng, myGen) {
  setBuildingLoading(true);
  let ctx;
  try { ctx = await fetchBuildingContext(lat, lng); }
  catch { if (roomGen === myGen) setBuildingLoading(false); return; }
  if (roomGen !== myGen) return; // superseded — a newer call owns the loading state
  setBuildingLoading(false);
  if (!ctx) return; // no building nearby → every wall keeps its provisional "exterior"

  currentRoom.buildings = ctx.buildings;

  const xy = localXY(lat, lng);
  const ring = currentRoom.vertices.map(v => xy(v.lat, v.lng));
  const classes = classifyRoomEdges(lat, lng, ring, ctx.buildings);
  if (classes) {
    for (const { i, exterior } of classes) {
      const wall = currentRoom.walls.find(w => w.i === i);
      if (wall) wall.exterior = exterior;
    }
  }
  // classes === null (no containing building found) → leave every wall's
  // provisional `exterior: true` as-is — see classifyRoomEdges' own doc.

  // The base outline doesn't change here — only which walls are exterior did,
  // and refreshUI() -> renderWallHighlights() picks that up on its own.
  refreshUI();
}

// Floor-bar handler: the floor sets the observer height, so just re-render —
// refreshUI recomputes the shadow geometrically from currentRoom.buildings.
function applyFloor() {
  if (currentRoom.locked) refreshUI();
}

async function fetchBuildingContext(lat, lng) {
  const cacheKey = `osm3_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* corrupted cache — refetch */ }

  // Coordinates rounded to 4 decimals (~11 m — same tolerance as the cache key
  // above): identical queries from nearby clicks let the edge cache share results.
  const qLat = lat.toFixed(4), qLng = lng.toFixed(4);
  const q = `[out:json][timeout:20];(way["building"](around:90,${qLat},${qLng});relation["building"](around:90,${qLat},${qLng}););out geom;`;
  const data = await overpassQuery(q);

  const raw = (data.elements || []).filter(e => Array.isArray(e.geometry) && e.geometry.length >= 3);
  let ctx = null;
  if (raw.length) {
    const buildings = raw.map(e => ({ geom: e.geometry.map(p => ({ lat: p.lat, lon: p.lon })), h: heightOf(e) }));
    ctx = { buildings };
  }
  try { localStorage.setItem(cacheKey, JSON.stringify(ctx)); } catch { /* storage unavailable */ }
  return ctx;
}

/** Ask each Overpass instance in turn; the first one that answers wins. */
async function overpassQuery(q) {
  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) { lastError = new Error('Overpass ' + res.status); continue; }
      return await res.json();
    } catch (err) {
      lastError = err; // network refused this mirror — try the next one
    }
  }
  throw lastError ?? new Error('Overpass unreachable');
}

// Building height in metres: OSM `height` tag, else levels × 3 m, default 3 storeys.
function heightOf(el) {
  const t = el.tags || {};
  const h = parseFloat(t.height);
  if (!isNaN(h) && h > 0) return h;
  const lv = parseFloat(t['building:levels']);
  if (!isNaN(lv) && lv > 0) return lv * 3;
  return 9;
}

// ─── Open-Meteo climate normals ───────────────────────────────────────────────

// Aggregate a daily series into 12 monthly means, skipping nulls.
// Returns null if the series is missing or has an empty month (treat as unavailable).
function monthlyMean(time, values) {
  if (!Array.isArray(values) || values.length !== time.length) return null;
  const sums = new Array(12).fill(0);
  const counts = new Array(12).fill(0);
  for (let i = 0; i < time.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    const m = parseInt(time[i].slice(5, 7), 10) - 1;
    sums[m] += v;
    counts[m] += 1;
  }
  if (counts.some(c => c === 0)) return null;
  return sums.map((s, i) => s / counts[i]);
}

/**
 * Real monthly climate normals (1991-2020) for a coordinate — temperature plus
 * humidity, wind and precipitation — cached in localStorage. Throws on any
 * network/shape problem or if temperature is unavailable; humidity/wind/precip
 * may individually be null and are handled gracefully downstream.
 * @returns {Promise<{temp:number[], rh:?number[], wind:?number[], precip:?number[]}>}
 */
async function fetchClimateNormals(lat, lon) {
  const cacheKey = `omc_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* corrupted cache entry — refetch */ }

  const url = `${OPEN_METEO_URL}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&${OPEN_METEO_RANGE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo ' + res.status);
  const data = await res.json();

  const time = data?.daily?.time;
  if (!Array.isArray(time) || time.length === 0) throw new Error('Open-Meteo: risposta inattesa');

  const temp = monthlyMean(time, data.daily.temperature_2m_mean);
  if (!temp) throw new Error('Open-Meteo: temperatura mancante');

  const normals = {
    temp,
    rh: monthlyMean(time, data.daily.relative_humidity_2m_mean),
    wind: monthlyMean(time, data.daily.windspeed_10m_mean),
    precip: monthlyMean(time, data.daily.precipitation_sum),
  };
  try { localStorage.setItem(cacheKey, JSON.stringify(normals)); } catch { /* storage full/unavailable — non-fatal */ }
  return normals;
}

// ─── room drawing ─────────────────────────────────────────────────────────────

/**
 * Add a vertex to the room being drawn, or — if this click lands near the
 * first vertex and at least a triangle already exists — close the loop and
 * lock the room instead. No-op once a room is already locked (drawing is only
 * re-enabled by removeRoom()).
 */
function addVertex(latlng) {
  if (currentRoom.locked) return;
  const { lat, lng } = latlng;

  if (currentRoom.vertices.length >= 3) {
    const first = currentRoom.vertices[0];
    const xy = localXY(first.lat, first.lng);
    const p = xy(lat, lng);
    if (Math.hypot(p.x, p.y) <= CLOSE_LOOP_TOLERANCE_M) { lockRoom(); return; }
  }

  currentRoom.vertices.push({ lat, lng });
  vertexMarkers.push(L.marker([lat, lng], { icon: markerIcon() }).addTo(map));

  if (drawPolyline) map.removeLayer(drawPolyline);
  drawPolyline = L.polyline(currentRoom.vertices.map(v => [v.lat, v.lng]), {
    color: '#22c55e', weight: 4, opacity: 0.85, dashArray: '6 5',
  }).addTo(map);
}

/**
 * Close the drawn loop: lock the room, derive its walls (azimuth + length,
 * provisionally all "exterior" until OSM data refines them) and floor area
 * from the vertices alone, then kick off the same geofence → climate/OSM
 * pipeline the old single-click flow used, now keyed on the room's centroid.
 */
function lockRoom() {
  currentRoom.locked = true;
  roomGen++;
  const myGen = roomGen;

  clearDrawingOverlays();

  const verts = currentRoom.vertices;
  const cLat = verts.reduce((s, v) => s + v.lat, 0) / verts.length;
  const cLng = verts.reduce((s, v) => s + v.lng, 0) / verts.length;
  const xy = localXY(cLat, cLng);
  const toLatLng = localToLatLng(cLat, cLng);
  const ring = verts.map(v => xy(v.lat, v.lng));
  const centroidLocal = polygonCentroid(ring);
  const n = ring.length;

  currentRoom.lat = cLat;
  currentRoom.lng = cLng;
  currentRoom.areaM2 = polygonArea(ring);
  currentRoom.buildings = [];
  currentRoom.walls = ring.map((a, i) => {
    const c = ring[(i + 1) % n];
    const mid = toLatLng((a.x + c.x) / 2, (a.y + c.y) / 2);
    return {
      i,
      // outwardNormalAz(a, c, click) returns the azimuth pointing TOWARD click
      // (see its doc in shadow.js) — passing the room's own centroid gives the
      // azimuth facing INTO the room, so it's flipped 180° to get the wall's
      // actual outward-facing (away from the room, toward the exterior) azimuth.
      azDeg: (outwardNormalAz(a, c, centroidLocal) + 180) % 360,
      lengthM: Math.hypot(c.x - a.x, c.y - a.y),
      exterior: true, // provisional — refined once OSM buildings resolve, see detectBuildingContext
      midLat: mid.lat, midLng: mid.lon,
    };
  });
  customBaseTemps = null; // reset to Rome fallback; upgraded async below if the fetch succeeds
  climateExtra = null;    // humidity/wind/precip reset with the room

  renderRoomPolygon();
  refreshUI();

  // Fast offline reject for rooms clearly outside Italy.
  if (isOutsideBox(cLat, cLng)) { rejectForeign(); return; }

  // Precise check near borders / on the sea: reverse-geocode the country.
  classifyLocation(cLat, cLng)
    .then(kind => {
      if (roomGen !== myGen) return; // superseded by a newer room
      if (kind === 'it-land') onValidRoom(cLat, cLng, myGen);
      else if (kind === 'it-water') rejectWater();
      else rejectForeign();
    })
    .catch(() => {
      // Network / rate-limit failure: best-effort, keep the optimistic result.
      if (roomGen === myGen) onValidRoom(cLat, cLng, myGen);
    });
}

/** Remove the current room (locked or still being drawn) and re-enable drawing. */
function removeRoom() {
  roomGen++;
  clearDrawingOverlays();
  clearRoomPolygon();
  clearWallHighlights();
  clearAnalysisOverlays();
  currentRoom = { vertices: [], locked: false, lat: null, lng: null, buildings: [], areaM2: 0, walls: [] };
  customBaseTemps = null;
  climateExtra = null;
  lastAnalysis = null;
  resetOutputUI();
}

function initRemoveRoomButton() {
  $('remove-room-btn')?.addEventListener('click', removeRoom);
}

/** Reset the sidebar output to its pre-analysis placeholder state. */
function resetOutputUI() {
  setText('coord-lat', '--°N');
  setText('coord-lng', '--°E');
  setText('room-area', '-- m²');
  setText('thermal-result', '--°C');
  setText('main-output-title', t('output-initial'));
  setText('hero-lo', '--°');
  setText('hero-hi', '--°');
  for (const id of ['winter', 'spring', 'summer', 'autumn']) setText(`val-q-${id}`, '--°C');
  setText('comfort-rate-stars', '⭐⭐⭐⭐⭐');
  setText('comfort-rate-label', '--');
  setText('val-sunrise', '--:--');
  setText('val-sunset', '--:--');
  setText('val-day-length', '--');
  setText('val-sun-elevation', '--°');
  setText('val-sun-azimuth', '--°');
  setText('val-sun-direct', '--');
  setText('val-humidity', '—');
  setText('val-wind', '—');
  setText('val-rain', '—');
  setText('val-feels', '—');
}

function refreshUI() {
  const { lat, lng, walls, areaM2, buildings } = currentRoom;
  const month = getSelectedMonth();
  const localHour = getSelectedLocalHour();
  const utcDate = getSelectedUTCDate();

  // Solar position — shared by every wall (and by the roof), computed once.
  const { elevation, azimuth } = solarPosition(utcDate, lat, lng);
  const elevClamped = Math.max(0, elevation);
  const hasSun = elevClamped > 1;

  // Property parameters
  const windowsType = checkedValue('windows', 'double');
  const insulationType = checkedValue('insulation', 'none');

  const isRoof = currentFloor === ROOF_FLOOR;

  // Real shadow: cast a ray to the sun through the nearby OSM buildings from the
  // observer's floor height. When blocked, only diffuse sky light gets through.
  const obsH = currentFloor * FLOOR_HEIGHT_M;
  const hasBuildings = !!(buildings && buildings.length);

  const exteriorWalls = walls.filter(w => w.exterior);
  const hasExterior = exteriorWalls.length > 0;
  const totalExtLen = exteriorWalls.reduce((s, w) => s + w.lengthM, 0) || 1;

  // A roof has no facing direction — its gain depends only on how high the sun
  // is, and its single-point shadow check keeps exactly the old room's logic.
  // A room's walls are aggregated by length: irradiance/obstruction of each
  // exterior wall, weighted by how much of the room's perimeter it covers.
  // Populated only in the exterior-walls branch below; read by
  // renderWallHighlights() at the end of this function to colour each
  // exterior wall by whether it's catching direct sun right now — reusing
  // the exact same sunBlocked() call kNow already makes, not a second pass.
  let perWallLit = null;

  let irr, kNow, kMonth;
  if (isRoof) {
    irr = roofIrradiance(elevClamped);
    const inShadow = hasSun && hasBuildings && sunBlocked(lat, lng, buildings, azimuth, elevation, obsH);
    kNow = inShadow ? DIFFUSE_K : 1.0;
    kMonth = m => hasBuildings
      ? Math.max(DIFFUSE_K, monthlySunAccess(lat, lng, buildings, obsH, m, DEFAULT_YEAR, TIMEZONE))
      : 1.0;
  } else if (hasExterior) {
    irr = exteriorWalls.reduce((s, w) => s + w.lengthM * facadeIrradiance(elevClamped, azimuth, w.azDeg), 0) / totalExtLen;
    perWallLit = new Map();
    kNow = exteriorWalls.reduce((s, w) => {
      const blocked = hasSun && hasBuildings && sunBlocked(w.midLat, w.midLng, buildings, azimuth, elevation, obsH);
      perWallLit.set(w.i, hasSun && !blocked);
      return s + w.lengthM * (blocked ? DIFFUSE_K : 1.0);
    }, 0) / totalExtLen;
    kMonth = m => exteriorWalls.reduce((s, w) => {
      const k = hasBuildings
        ? Math.max(DIFFUSE_K, monthlySunAccess(w.midLat, w.midLng, buildings, obsH, m, DEFAULT_YEAR, TIMEZONE))
        : 1.0;
      return s + w.lengthM * k;
    }, 0) / totalExtLen;
  } else {
    // No exterior wall at all (a fully interior room) — no solar term.
    irr = 0; kNow = 1.0; kMonth = () => 1.0;
  }
  const kOmbra = kMonth(month);

  const airTemp = airTemperature(month, localHour, lat, customBaseTemps);
  const gain = solarThermalGain(month, irr, kNow);
  const roomTemp = airTemp + gain;

  // Sunrise / sunset
  const { sunrise, sunset, dayLength } = sunriseSunset(utcDate, lat, lng);
  const fmt = d => d ? d.toLocaleTimeString('it-IT', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }) : '--:--';

  // Update main output
  setText('coord-lat', lat.toFixed(5) + '°N');
  setText('coord-lng', lng.toFixed(5) + '°E');
  setText('room-area', areaM2.toFixed(1) + ' m²');
  setText('thermal-result', roomTemp.toFixed(1) + '°C');
  setText('main-output-title', t('main-title', { month: monthName(month), hour: localHour }));
  setText('month-label', monthName(month));
  setText('hour-label', String(localHour).padStart(2, '0') + ':00');

  // Seasonal analysis: a roof keeps the old single-point model untouched
  // (isRoof=true short-circuits facing direction inside seasonalTemperatures);
  // a real room combines every wall — exterior walls each run seasonalTemperatures
  // with their own azimuth/obstruction, interior walls pull toward a fixed
  // neutral reference, combined by wall length and damped by floor area.
  const seasonal = isRoof
    ? seasonalTemperatures(
        m => solarPosition(localToUTC(DEFAULT_YEAR, m, 15, 12, TIMEZONE), lat, lng),
        0, lat, kMonth, customBaseTemps, windowsType, insulationType, true
      )
    : roomSeasonalTemperatures(
        m => solarPosition(localToUTC(DEFAULT_YEAR, m, 15, 12, TIMEZONE), lat, lng),
        walls.map(w => ({
          azDeg: w.azDeg,
          lengthM: w.lengthM,
          exterior: w.exterior,
          obstrK: m => hasBuildings
            ? Math.max(DIFFUSE_K, monthlySunAccess(w.midLat, w.midLng, buildings, obsH, m, DEFAULT_YEAR, TIMEZONE))
            : 1.0,
        })),
        areaM2, lat, customBaseTemps, windowsType, insulationType
      );

  const seasonMap = {
    winter: { id: 'winter', label: 'Inverno',   temp: seasonal.winter },
    spring: { id: 'spring', label: 'Primavera', temp: seasonal.spring },
    summer: { id: 'summer', label: 'Estate',    temp: seasonal.summer },
    autumn: { id: 'autumn', label: 'Autunno',   temp: seasonal.autumn },
  };

  for (const [, s] of Object.entries(seasonMap)) {
    setText(`val-q-${s.id}`, s.temp.toFixed(1) + '°C');
    const card = $(`quad-${s.id}`);
    if (!card) continue;
    let color = 'var(--green)';
    if (s.id === 'winter') {
      if (s.temp < 13.5) color = 'var(--red)';
      else if (s.temp < 14.5) color = 'var(--orange)';
      else if (s.temp < 15.5) color = 'var(--yellow)';
    } else if (s.id === 'summer') {
      if (s.temp >= 29.5) color = 'var(--red)';
      else if (s.temp >= 27.5) color = 'var(--orange)';
      else if (s.temp >= 26.0) color = 'var(--yellow)';
    }
    card.style.setProperty('--q-color', color);
  }

  // Perceived ("feels-like") winter/summer temperatures from humidity + wind,
  // when climate data is available (winter = January, summer = July).
  let feels = null;
  if (climateExtra && climateExtra.rh && climateExtra.wind) {
    feels = {
      winter: apparentTemperature(seasonal.winter, climateExtra.rh[0], climateExtra.wind[0]),
      summer: apparentTemperature(seasonal.summer, climateExtra.rh[6], climateExtra.wind[6]),
    };
  }

  // Hero range: the coldest and warmest season, beside the headline number
  setText('hero-lo', seasonal.winter.toFixed(0) + '\u00b0');
  setText('hero-hi', seasonal.summer.toFixed(0) + '\u00b0');

  // Comfort Rate
  const comfort = cozynessScore(seasonal.winter, seasonal.summer, kOmbra, windowsType, insulationType, feels);
  const comfortLabel = t('comfort-' + comfort.stars);
  setText('comfort-rate-stars', '⭐'.repeat(comfort.stars));
  setText('comfort-rate-label', comfortLabel);
  const badge = $('energy-class-field');
  if (badge) {
    badge.style.setProperty('--comfort-color', comfort.color);
    badge.dataset.stars = String(comfort.stars);
    badge.dataset.label = comfortLabel;
  }
  // Direct sun hours today, length-weighted across exterior walls (folded
  // into the Comfort Rate detail) — a roof keeps the old single-point call.
  const sunHoursToday = isRoof
    ? dailyRoofSunHours(utcDate, lat, lng)
    : hasExterior
      ? exteriorWalls.reduce((s, w) => s + w.lengthM * dailySunHours(utcDate, w.midLat, w.midLng, w.azDeg), 0) / totalExtLen
      : 0;
  lastAnalysis = { seasonal, comfort, sunHoursToday, feels, climate: climateExtra };

  // Solar info
  setText('val-sunrise', fmt(sunrise));
  setText('val-sunset', fmt(sunset));
  setText('val-day-length', dayLength > 0 ? `${dayLength.toFixed(1)}h` : '--');
  setText('val-sun-elevation', elevClamped > 0 ? `${elevation.toFixed(1)}°` : t('below-horizon'));
  setText('val-sun-azimuth', `${azimuth.toFixed(0)}°`);
  // Direct-sun verdict, from the room's aggregate figures. Orientation comes
  // first: a room with no sun-facing wall has irr=0, same as every wall facing
  // away from the sun; kNow < 1 means at least one exterior wall's ray is
  // blocked right now.
  let sunKey;
  if (!hasSun) sunKey = 'sun-night';
  else if (irr <= 0) sunKey = 'sun-other-side';
  else if (kNow < 0.999) sunKey = 'sun-shadow';
  else sunKey = 'sun-yes';
  setText('val-sun-direct', t(sunKey));
  updateDayArc(sunrise, sunset, localHour);
  $('hero-sun')?.classList.toggle('night', !hasSun);

  // Local climate for the selected month (— when the API gave us nothing)
  const rhNow = climateExtra?.rh?.[month];
  const windNow = climateExtra?.wind?.[month];
  const rainNow = climateExtra?.precip?.[month];
  setText('val-humidity', rhNow != null ? Math.round(rhNow) + '%' : '—');
  setText('val-wind', windNow != null ? windNow.toFixed(1) + ' km/h' : '—');
  setText('val-rain', rainNow != null ? Math.round(rainNow * DAYS_IN_MONTH[month]) + ' mm' : '—');
  setText('val-feels', (rhNow != null && windNow != null)
    ? apparentTemperature(roomTemp, rhNow, windNow).toFixed(1) + '°C'
    : '—');

  // Sun-position-dependent map overlays. The room outline itself is drawn
  // once by renderRoomPolygon() (on lock only — the shape never changes
  // after that) — not here. Wall highlights DO belong here: which walls are
  // lit (or exterior at all) can change every refresh, same as the shadow
  // wedge/sun ray.
  renderMapOverlays(lat, lng, elevation, azimuth);
  renderWallHighlights(exteriorWalls, perWallLit);
}

// ─── KPI modal ────────────────────────────────────────────────────────────────

/**
 * Turn today's direct-sun hours on the facade into a "good/bad news" line
 * for the Comfort Rate detail (replaces the removed sun-hours chart).
 */
function sunExposureNote(hours) {
  const h = hours.toFixed(1);
  if (hours >= 5)   return t('exp-great', { h });
  if (hours >= 2.5) return t('exp-ok', { h });
  if (hours > 0)    return t('exp-low', { h });
  return t('exp-none');
}

/** Value of the checked radio in a group, or a fallback. */
function checkedValue(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

/** Visible label of the checked radio in a group. */
function checkedLabel(name, fallback) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el?.parentElement?.querySelector('.choice-text')?.textContent ?? fallback;
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function openKPIModal() {
  if (!lastAnalysis) return;
  const { seasonal, comfort, sunHoursToday, feels, climate } = lastAnalysis;

  const comfortLabel = t('comfort-' + comfort.stars);
  setText('modal-class-title', t('modal-title', { label: comfortLabel }));
  const classBadge = $('modal-class-badge');
  if (classBadge) {
    classBadge.textContent = `${t('comfort-rate')} ${'⭐'.repeat(comfort.stars)}`;
    classBadge.style.setProperty('--comfort-color', comfort.color);
  }

  setText('kpi-winter-temp', seasonal.winter.toFixed(1) + '°C');
  setText('kpi-summer-temp', seasonal.summer.toFixed(1) + '°C');
  setText('kpi-infissi-selected', checkedLabel('windows', '--'));
  setText('kpi-isolamento-selected', checkedLabel('insulation', '--'));
  setText('kpi-room-area', currentRoom.areaM2.toFixed(1) + ' m²');

  // Real-climate strip (humidity/wind → feels-like, plus rainfall)
  setText('kpi-feels-summer', feels ? feels.summer.toFixed(1) + '°C' : '—');
  setText('kpi-humidity', climate && climate.rh ? Math.round(avg(climate.rh)) + '%' : '—');
  setText('kpi-rain', climate && climate.precip
    ? Math.round(climate.precip.reduce((s, v, i) => s + v * DAYS_IN_MONTH[i], 0)) + ' mm'
    : '—');

  setText('kpi-exposure', sunExposureNote(sunHoursToday));
  setText('kpi-tip', t(comfort.tipKey));
  $('kpi-modal').classList.add('open');
}

function closeKPIModal() {
  $('kpi-modal').classList.remove('open');
}

// ─── daylight bar ─────────────────────────────────────────────────────────────

/**
 * Paint the daylight bar: the lit span of the day plus a dot on the hour being
 * analysed. Purely decorative — the same numbers sit in the rows underneath.
 * @param {Date|null} sunrise
 * @param {Date|null} sunset
 * @param {number} localHour  hour under analysis (0–23)
 */
function updateDayArc(sunrise, sunset, localHour) {
  const sunOrb = $('solar-arc-sun');

  const hourOf = d => {
    // The Date is UTC; read it back in the app's timezone, as the rows do.
    const parts = new Intl.DateTimeFormat('it-IT', {
      timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const h = +parts.find(p => p.type === 'hour').value;
    const m = +parts.find(p => p.type === 'minute').value;
    return h + m / 60;
  };

  // No sunrise or sunset (polar edge cases): show defaults
  const rise = sunrise ? hourOf(sunrise) : 6;
  const set = sunset ? hourOf(sunset) : 18;
  const dayLength = Math.max(0.1, set - rise);
  const now = localHour + 0.5;
  const fraction = (now - rise) / dayLength;

  // SVG coordinate dimensions: x from 20 to 260, yBase = 70, yApex = 14
  const x0 = 20, x1 = 260, yBase = 70, yApex = 14;

  if (sunOrb) {
    if (fraction >= 0 && fraction <= 1) {
      const u = Math.max(0, Math.min(1, fraction));
      const x = x0 + u * (x1 - x0);
      // Parabolic arc height formula: y = yBase - (yBase - yApex) * 4 * u * (1 - u)
      const y = yBase - (yBase - yApex) * 4 * u * (1 - u);
      sunOrb.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
      sunOrb.classList.remove('night');
    } else {
      // Below horizon
      const isBeforeRise = fraction < 0;
      const x = isBeforeRise ? x0 : x1;
      const y = yBase + 4;
      sunOrb.setAttribute('transform', `translate(${x}, ${y})`);
      sunOrb.classList.add('night');
    }
  }
}

// ─── time sliders ─────────────────────────────────────────────────────────────

/** Fill the track up to the current value (CSS reads --p as 0…1). */
function paintSlider(el) {
  const min = +el.min, max = +el.max;
  el.style.setProperty('--p', String((el.value - min) / (max - min)));
}

function initSliders() {
  for (const id of ['month-slider', 'hour-slider']) {
    const el = $(id);
    paintSlider(el);
    el.addEventListener('input', () => {
      paintSlider(el);
      if (currentRoom.locked) refreshUI(); // refreshUI updates the month/hour labels
    });
  }
}

// ─── property selectors (infissi / isolamento) ────────────────────────────────

function initPropertySelects() {
  document.querySelectorAll('input[name="windows"], input[name="insulation"]').forEach(radio => {
    radio.addEventListener('change', () => { if (currentRoom.locked) refreshUI(); });
  });
}

// ─── address search ───────────────────────────────────────────────────────────

// Recentring on an address no longer analyses a point by itself — the user
// draws the room next. Any room already there (mid-drawing or locked) is
// cleared so the map is ready to draw at the new location.
function goToAddress(lat, lng, zoom) {
  map.setView([lat, lng], zoom);
  removeRoom();
}

function initSearchAutocomplete() {
  const input   = $('search-input');
  const preview = $('autocomplete-preview');

  // Search runs only on the "Vai" button. Enter just closes the suggestions;
  // Escape closes them and blurs the field.
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePreview(); input.blur(); }
    if (e.key === 'Enter')  { e.preventDefault(); closePreview(); }
  });

  input.addEventListener('input', () => {
    clearTimeout(autocompleteTimeout);
    pendingSearch = null; // editing the text invalidates any previously picked suggestion
    const q = input.value.trim();

    if (q.length < 3) { closePreview(); return; }

    autocompleteTimeout = setTimeout(() => fetchSuggestions(q), NOMINATIM_DEBOUNCE_MS);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !preview.contains(e.target)) closePreview();
  });

  $('search-btn').addEventListener('click', searchAddress);
}

function closePreview() {
  const preview = $('autocomplete-preview');
  if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
}

async function fetchSuggestions(query) {
  const input = $('search-input');
  const preview = $('autocomplete-preview');

  input.classList.add('input-loading');
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=it&addressdetails=1`
    );
    if (!res.ok) throw new Error('Nominatim ' + res.status);
    const data = await res.json();

    preview.innerHTML = '';
    if (data && data.length > 0) {
      preview.style.display = 'block';
      data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.textContent = item.display_name;
        div.addEventListener('click', () => {
          // Picking a suggestion only fills the field; the search itself runs
          // when the user presses "Vai" (which reuses these coordinates).
          input.value = item.display_name;
          pendingSearch = { query: item.display_name, lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
          closePreview();
          input.focus();
        });
        preview.appendChild(div);
      });
    } else {
      preview.style.display = 'block';
      const empty = document.createElement('div');
      empty.className = 'autocomplete-empty';
      empty.textContent = t('search-empty');
      preview.appendChild(empty);
    }
  } catch (err) {
    preview.style.display = 'block';
    const errDiv = document.createElement('div');
    errDiv.className = 'autocomplete-empty';
    errDiv.textContent = t('search-neterror');
    preview.appendChild(errDiv);
  } finally {
    input.classList.remove('input-loading');
  }
}

async function searchAddress() {
  const input = $('search-input');
  const query = input.value.trim();
  if (!query) return;

  // Reuse the coordinates of a picked suggestion when the field still matches it,
  // avoiding a redundant Nominatim lookup.
  if (pendingSearch && pendingSearch.query === query) {
    closePreview();
    goToAddress(pendingSearch.lat, pendingSearch.lng, 18);
    return;
  }

  input.classList.add('input-loading');
  closePreview();
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=it`
    );
    if (!res.ok) throw new Error('Rete non disponibile');
    const data = await res.json();

    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      goToAddress(lat, lng, 18);
    } else {
      showToast(t('search-notfound'), 'warn', 7000);
    }
  } catch {
    showToast(t('search-neterror-toast'), 'error', 8000);
  } finally {
    input.classList.remove('input-loading');
  }
}

// ─── geolocation ──────────────────────────────────────────────────────────────

function initGeolocation() {
  $('geo-btn').addEventListener('click', getLocation);
}

function getLocation() {
  const btn  = $('geo-btn');
  const icon = $('geo-icon');
  hideToast();

  if (!navigator.geolocation) {
    showToast(t('geoloc-unsupported'), 'error', 8000);
    return;
  }

  btn.classList.add('loading');
  icon.textContent = '⟳';

  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.classList.remove('loading', 'denied');
      icon.textContent = '📌';
      btn.setAttribute('aria-label', t('geo-aria'));

      const acc = Math.round(pos.coords.accuracy);
      if (acc > 2000) {
        showToast(t('geoloc-inaccurate', { km: (acc / 1000).toFixed(1) }), 'warn', 15000);
      }

      goToAddress(pos.coords.latitude, pos.coords.longitude, 18);
    },
    err => {
      btn.classList.remove('loading');
      btn.classList.add('denied');
      icon.textContent = '🚫';

      let msg = t('geoloc-failed');
      if (err.code === err.PERMISSION_DENIED) {
        msg = t('geoloc-denied');
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = t('geoloc-unavailable');
      } else if (err.code === err.TIMEOUT) {
        msg = t('geoloc-timeout');
      }
      btn.setAttribute('aria-label', msg);
      showToast(msg, 'error', 15000);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ─── language switcher (IT / EN) ──────────────────────────────────────────────

function markActiveLang() {
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });
}

function changeLang(lang) {
  if (lang === getLang()) return;
  setLang(lang);
  applyTranslations();          // static text
  panelRemeasurers.forEach(fn => fn()); // IT/EN copy differs in length
  markActiveLang();
  if (currentRoom.locked) refreshUI(); // dynamic text (temps, labels, exposure…)
  if ($('kpi-modal')?.classList.contains('open')) openKPIModal(); // refresh an open modal
}

function initLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => changeLang(btn.dataset.lang));
  });
  markActiveLang();
}

// ─── collapsible mini panels (map legend / placement hint) ─────────────────────

// Re-measured after a language switch, since IT/EN copy differs in length.
const panelRemeasurers = [];

/**
 * Wire a panel that folds down to a single 42×42 icon button (the geolocation
 * button's own footprint) and back. CSS can't transition to/from `auto`, so we
 * measure the panel's real laid-out width and height once and drive the
 * animation from explicit `--panel-w`/`--panel-h` custom properties instead.
 * @param {string} panelId
 * @param {string} toggleId
 */
function initCollapsiblePanel(panelId, toggleId) {
  const panel = $(panelId);
  const toggle = $(toggleId);
  if (!panel || !toggle) return;

  const measure = () => {
    const wasCollapsed = panel.classList.contains('collapsed');
    if (wasCollapsed) panel.classList.remove('collapsed'); // measure the true expanded size
    panel.style.setProperty('--panel-w', panel.scrollWidth + 'px');
    panel.style.setProperty('--panel-h', panel.scrollHeight + 'px');
    if (wasCollapsed) panel.classList.add('collapsed');
  };
  measure();
  panelRemeasurers.push(measure);

  toggle.addEventListener('click', () => {
    const collapsed = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
}

function initCollapsiblePanels() {
  initCollapsiblePanel('map-hint', 'map-hint-toggle');
  initCollapsiblePanel('map-legend', 'map-legend-toggle');
}

// ─── floor selector (building height) ─────────────────────────────────────────

function markActiveFloor() {
  document.querySelectorAll('.floor-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.floor, 10) === currentFloor);
  });
}

function initFloorBar() {
  document.querySelectorAll('.floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFloor = parseInt(btn.dataset.floor, 10);
      markActiveFloor();
      applyFloor(); // recompute obstruction for the chosen floor and re-render
    });
  });
  markActiveFloor();
}

// ─── mobile layout ──────────────────────────────────────────────────────────
//
// Below the desktop breakpoint the sidebar is hidden (see the CSS) and its
// content is moved, once, into the mobile-only elements declared in app.html:
// a persistent bottom bar for the seasons and the Comfort Rate, a settings
// drawer for search/month/hour/infissi/isolamento, two small widgets for the
// solar and climate readings, and one Info sheet folding the map legend and
// the placement hint together. Reparenting the *existing* elements (not
// duplicating markup) keeps every id and its already-wired event handlers —
// setText() and friends keep working unchanged regardless of where in the
// DOM an element now lives.

// Matches the CSS breakpoint. Decided once at startup — the app does not
// re-layout live across a resize that crosses it (same as before).
function isMobileLayout() {
  return window.innerWidth <= 768;
}

function initMobileLayout() {
  if (mobileLayoutActive) return; // idempotent: a resize can call this more than once
  mobileLayoutActive = true;
  const move = (el, into) => { if (el && into) into.appendChild(el); };

  const bottomBar = $('mobile-bottom-bar');
  move(document.querySelector('.quadrant-grid'), bottomBar);
  move($('energy-class-field'), bottomBar);

  // The lang switch / drawer button / widgets float just above this bar.
  // Its real height depends on content (season labels reflow between IT/EN,
  // a wrapping label makes it taller) — measuring it beats guessing a fixed
  // px offset, which is what let the lang switch drift over the bar's
  // content on a real phone. Re-measured on language change (see below).
  const measureBottomBar = () => {
    if (bottomBar) document.documentElement.style.setProperty('--mobile-bar-h', bottomBar.getBoundingClientRect().height + 'px');
  };
  measureBottomBar();
  panelRemeasurers.push(measureBottomBar);

  const drawerBody = $('mobile-drawer-body');
  move(document.querySelector('.hero-top'), drawerBody);
  move(document.querySelector('.hero-main'), drawerBody);
  move(document.querySelector('.hero-feels-row'), drawerBody);
  move(document.querySelector('.search-card'), drawerBody);
  move(document.querySelector('[data-i18n-aria="time-card-aria"]'), drawerBody);
  move(document.querySelector('[data-i18n-aria="facade-card-aria"]'), drawerBody);

  move(document.querySelector('.solar-card'), $('mobile-solar-body'));
  move(document.querySelector('[data-i18n-aria="climate-card-aria"]'), $('mobile-climate-body'));

  const infoBody = $('mobile-info-body');
  move($('map-legend-body'), infoBody);
  move($('map-hint-text'), infoBody);

  initMobileSheet('mobile-info-btn', 'mobile-info-sheet', 'mobile-info-overlay', 'mobile-info-close');
  initMobileSheet('mobile-drawer-toggle', 'mobile-drawer', 'mobile-drawer-overlay', 'mobile-drawer-close');
  initCollapsiblePanel('mobile-solar-widget', 'mobile-solar-toggle');
  initCollapsiblePanel('mobile-climate-widget', 'mobile-climate-toggle');

  // The two widgets share the same corner: only one open at a time, or the
  // expanded panels pile up over each other and over the map.
  const widgets = [
    ['mobile-solar-widget', 'mobile-solar-toggle'],
    ['mobile-climate-widget', 'mobile-climate-toggle'],
  ];
  widgets.forEach(([, toggleId]) => {
    $(toggleId)?.addEventListener('click', () => {
      widgets.forEach(([otherPanel, otherToggle]) => {
        if (otherToggle === toggleId) return;
        $(otherPanel)?.classList.add('collapsed');
        $(otherToggle)?.setAttribute('aria-expanded', 'false');
      });
    });
  });
}

/**
 * Wire one bottom sheet: a toggle button that opens it, an overlay and a
 * close button that close it. `inert` keeps its (now off-screen) controls
 * out of tab order and out of the accessibility tree while closed, without
 * fighting the `display:block` the slide-up transform animation needs.
 */
function initMobileSheet(toggleId, sheetId, overlayId, closeId) {
  const toggle = $(toggleId), sheet = $(sheetId), overlay = $(overlayId), close = $(closeId);
  if (!toggle || !sheet) return;
  sheet.inert = true;

  const setOpen = open => {
    sheet.classList.toggle('open', open);
    overlay?.classList.toggle('open', open);
    sheet.inert = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  close?.addEventListener('click', () => setOpen(false));
  overlay?.addEventListener('click', () => setOpen(false));
}

// ─── app bootstrap ────────────────────────────────────────────────────────────

let appStarted = false;
let mobileLayoutActive = false; // initMobileLayout() has run and moved the sidebar's content out

// Below this, even the mobile layout has nowhere to put things. Real phones
// don't go this narrow; this only catches an extreme browser zoom.
const MIN_USABLE_WIDTH = 320;

/**
 * Show the explanation whenever the window is too small — not only at load.
 * Also the one live-resize case this app handles: starting wide and later
 * resizing *down* past the mobile breakpoint activates the mobile layout on
 * the spot, so shrinking the window never leaves you with neither the
 * sidebar nor the mobile UI. Going back the other way (mobile → desktop) is
 * not supported live — the sidebar's content has already been moved out —
 * a reload picks the right layout for whatever width you land on.
 */
function updateMobileBlock() {
  const warning = $('mobile-warning');
  const tooSmall = window.innerWidth < MIN_USABLE_WIDTH;
  if (warning) warning.style.display = tooSmall ? 'flex' : 'none';
  if (tooSmall) return;
  if (!appStarted) { startApp(); return; }
  if (!mobileLayoutActive && isMobileLayout()) initMobileLayout();
  map?.invalidateSize();   // the map container just changed size
}

function startApp() {
  appStarted = true;
  initMap();
  initSliders();
  initPropertySelects();
  initSearchAutocomplete();
  initGeolocation();
  initLangSwitch();
  initFloorBar();
  initRemoveRoomButton();

  if (isMobileLayout()) {
    initMobileLayout();
  } else {
    initCollapsiblePanels();
  }

  // KPI modal wiring
  const badge = $('energy-class-field');
  if (badge) badge.addEventListener('click', openKPIModal);
  const closeBtn = $('modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeKPIModal);
  const overlay = $('kpi-modal');
  if (overlay) overlay.addEventListener('click', e => {
    if (e.target === overlay) closeKPIModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeKPIModal();
  });

  // Arriving from the landing page: either a typed address (?q=...), run
  // through the same search as the "Vai" button, or real coordinates from its
  // own geolocation button (?lat=&lng=...), which skip the search entirely.
  const params = new URLSearchParams(location.search);
  const handoffQuery = params.get('q');
  const handoffLat = parseFloat(params.get('lat'));
  const handoffLng = parseFloat(params.get('lng'));
  if (!isNaN(handoffLat) && !isNaN(handoffLng)) {
    goToAddress(handoffLat, handoffLng, 18);
  } else if (handoffQuery) {
    const input = $('search-input');
    if (input) input.value = handoffQuery;
    searchAddress();
  }
  // Otherwise: nothing to do — initMap() already centred on Rome, and there is
  // no analysis to run until the user draws a room.
}

/**
 * Last resort: an unexpected failure should say so rather than leave a dead page.
 * The message is deliberately literal — it is what you would paste in a report.
 */
function initErrorReporting() {
  const report = (what) => showToast(t('app-error', { detail: String(what).slice(0, 160) }), 'error', 20000);
  window.addEventListener('error', e => report(e.message || e.error));
  window.addEventListener('unhandledrejection', e => report(e.reason?.message || e.reason));
}

export function init() {
  initErrorReporting();
  setLang(getLang());  // sync <html lang> + persist the resolved language
  applyTranslations(); // fill static UI text (including the mobile overlay below)
  updateMobileBlock();
  window.addEventListener('resize', updateMobileBlock);
}
