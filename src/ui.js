/**
 * ui.js — Application UI controller.
 * Imports solar.js, shadow.js and cost.js; manages the Leaflet map, the
 * room-polygon drawing, address search and geolocation, the visit questions,
 * the heating-cost estimate, the checklist and the shareable link.
 */

import {
  solarPosition,
  sunriseSunset,
  facadeIrradiance,
  localToUTC,
  offsetByAzimuth,
} from './solar.js';

import {
  localXY,
  localToLatLng,
  outwardNormalAz,
  polygonArea,
  polygonCentroid,
  classifyRoomEdges,
  sunBlocked,
  roomShapeProblem,
  onWater,
} from './shadow.js';

import {
  estimateHeating,
  visitChecklist,
  wallDailyIrradiance,
  resolveClimateZone,
  HEATING_DAYS,
} from './cost.js';

import { PRICES } from './prices.js';
import { gasPriceForRegion } from './ambiti.js';
import { loadZones, zonesLoaded, lookupZone } from './zones.js';

import { t, monthName, getLang, setLang, applyTranslations } from './i18n.js';
import { startTour, tourDone } from './tour.js';

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
// shortwave_radiation_sum (MJ/m² per day, on the horizontal) feeds the sun
// that comes in through the windows.
const OPEN_METEO_URL = 'https://climate-api.open-meteo.com/v1/climate';
const OPEN_METEO_RANGE = 'models=EC_Earth3P_HR&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_mean,relative_humidity_2m_mean,windspeed_10m_mean,precipitation_sum,shortwave_radiation_sum';
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// One storey ≈ 3 m: the floor sets the observer height for the shadow rays.
const FLOOR_HEIGHT_M = 3;

// Clicking/tapping within this many metres of the room's first vertex closes
// the loop instead of adding another vertex — generous enough for a fingertip
// on a touch screen without needing to be pixel-precise.
const CLOSE_LOOP_TOLERANCE_M = 1.2;

// Nominatim reverse geocoding — precise land/water/country classification.
// Land returns address.country_code; open sea returns an error (no country).
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// Map colours: the room in ink, sunlit walls in the sun's amber.
const INK = '#1c1a16';
const SUN = '#d08a00';
const SHADE = '#8a8377';

// A forbice wider than this (high ÷ low) tells the user to answer more.
const WIDE_RANGE_RATIO = 3;

// Above this the drawing is more likely a whole flat or building than a room.
const BIG_ROOM_M2 = 120;

// ─── state ────────────────────────────────────────────────────────────────────

let map = null;
let vertexMarkers = [];   // in-progress drawing: one marker per placed vertex
let drawPolyline = null;  // in-progress drawing: open line through the vertices
let roomPolygon = null;   // locked room's closed outline
let wallLines = [];       // one highlighted line per exterior wall
let shadowPolygon = null;
let sunRay = null;
let errorTimeout = null;
let autocompleteTimeout = null;
let climate = null;         // { temp, rh, wind, precip, rad } monthly normals, or null
let climateStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
let currentFloor = 0;       // user's floor (0 = ground … 5+); higher clears nearby rooftops
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
  region: null,  // from reverse geocoding: picks the ARERA gas tariff area
  comune: null, prov: null, // from reverse geocoding: pick the legal climate zone
  buildings: [], // OSM footprints + heights near the centroid (for shadow casting)
  areaM2: 0,
  walls: [],     // [{i, azDeg, lengthM, exterior, midLat, midLng}], set once locked
};

// Bumped on every lock()/removeRoom(): lets async work (Overpass/Nominatim
// fetches) started for one room recognise it's been superseded by another.
let roomGen = 0;

// Monthly sun on each exterior wall is the expensive part (a shadow ray every
// 10 minutes of 12 mean days): computed once per room/floor/buildings/climate.
let irradianceCache = { key: null, byWall: new Map() };

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

/** Hide the toast only if it still shows this message (a newer one stays). */
function hideToastIf(msg) {
  if ($('map-error-toast')?.textContent === msg) hideToast();
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
  // OSM serves tiles up to z19; Leaflet enlarges them for two more levels, so a
  // fingertip can still hit the corners of a small room on a phone.
  map = L.map('map', { zoomControl: false, maxZoom: 21 }).setView([41.9028, 12.4964], 17);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Standard OpenStreetMap tiles: free, no API key, and legible — CARTO's
  // basemaps now stamp "API KEY REQUIRED" over every style without a key.
  L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '©<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 19,    // the OSM tile server serves up to z19…
      maxZoom: 21,          // …beyond that the z19 tiles are scaled up
    }
  ).addTo(map);

  map.on('click', e => addVertex(e.latlng));
}

// A plain ink dot. The icon box is bigger than the visible dot on purpose:
// it's the touch hit-area, and a 14px dot alone is too small a target.
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

// The locked room's outline — redrawn only when the room is (re)locked, never
// on every refreshUI() (the shape itself doesn't change with month/hour/floor).
function clearRoomPolygon() {
  if (roomPolygon) { map.removeLayer(roomPolygon); roomPolygon = null; }
}

function renderRoomPolygon() {
  clearRoomPolygon();
  const pts = currentRoom.vertices.map(v => [v.lat, v.lng]);
  roomPolygon = L.polygon(pts, {
    color: INK,
    weight: 2,
    fillColor: INK,
    fillOpacity: 0.06,
  }).addTo(map);
}

// Exterior-wall highlights — redrawn on every refreshUI() (month/hour/floor
// change which walls are lit right now). Interior walls get no highlight.
function clearWallHighlights() {
  wallLines.forEach(l => map.removeLayer(l));
  wallLines = [];
}

/**
 * @param {Array} exteriorWalls
 * @param {Map<number,boolean>} perWallLit — wall index (`w.i`) -> "catching
 *   direct sun right now", already computed once in refreshUI().
 */
function renderWallHighlights(exteriorWalls, perWallLit) {
  clearWallHighlights();
  const n = currentRoom.vertices.length;
  for (const w of exteriorWalls) {
    const lit = perWallLit.get(w.i);
    const a = currentRoom.vertices[w.i];
    const c = currentRoom.vertices[(w.i + 1) % n];
    wallLines.push(L.polyline([[a.lat, a.lng], [c.lat, c.lng]], {
      color: lit ? SUN : SHADE,
      weight: 6,
      opacity: 0.95,
    }).addTo(map));
  }
}

// Sun-position-dependent overlays (shadow wedge + sun ray), drawn from the
// room's centroid: one representative wedge for the whole room, not one per
// wall — a deliberate simplification for the map only (the estimate itself
// checks every wall separately).
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
  const opacity = Math.max(0.12, 0.4 - (elevation / 90) * 0.25);

  shadowPolygon = L.polygon([[lat, lng], p1, p2], {
    color: 'rgba(28, 26, 22, 0.35)',
    fillColor: INK,
    fillOpacity: opacity,
    weight: 1,
  }).addTo(map);

  const sunPt = offsetByAzimuth(lat, lng, azimuth, 0.00028);
  sunRay = L.polyline([sunPt, [lat, lng]], {
    color: SUN,
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
  // The region picks the ARERA tariff area for the gas price (see ambiti.js).
  if (cc && IN_ITALY_CODES.has(cc)) {
    const a = data.address;
    return {
      kind: 'it-land',
      region: a.state || null,
      // comune + provincia pick the legal climate zone (see zones.js)
      comune: a.city || a.town || a.village || a.municipality || null,
      prov: (a['ISO3166-2-lvl6'] || '').replace(/^IT-/, '') || null,
    };
  }
  if (cc) return { kind: 'foreign' };     // some other country's land
  return { kind: isOutsideBox(lat, lng) ? 'foreign' : 'it-water' };
}

// A room drawn abroad or over water is simply removed, and the map recentres
// on Rome as a friendly default so the user isn't left looking at a foreign view.
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
  climateStatus = 'loading';
  refreshCost();
  fetchClimateNormals(lat, lng)
    .then(normals => {
      if (roomGen !== myGen) return;
      climate = normals;
      climateStatus = 'ready';
      refreshUI();
    })
    .catch(() => {
      if (roomGen !== myGen) return;
      climateStatus = 'failed';
      refreshCost();
    });
}

// ─── OSM building context (real wall classification + shadows) ────────────────

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

/**
 * Fetch real OSM buildings around the room, refine each wall's provisional
 * exterior/interior classification against the containing building's actual
 * footprint, and re-render. Cached, silent, best-effort — never throws upward.
 */
async function detectBuildingContext(lat, lng, myGen) {
  let ctx;
  try { ctx = await fetchBuildingContext(lat, lng); }
  catch { hideToastIf(t('water-checking')); return; }
  if (roomGen !== myGen) return; // superseded by a newer room
  hideToastIf(t('water-checking'));
  if (!ctx) return; // no building nearby → every wall keeps its provisional "exterior"

  const xy = localXY(lat, lng);
  const ring = currentRoom.vertices.map(v => xy(v.lat, v.lng));

  // A river, a lake or the sea under the drawing: not a room.
  if (onWater(lat, lng, ring, ctx.water)) {
    removeRoom();
    showToast(t('geo-water-inland'), 'warn', 12000);
    return;
  }

  currentRoom.buildings = ctx.buildings;
  if (!ctx.buildings.length) return;
  const classes = classifyRoomEdges(lat, lng, ring, ctx.buildings);
  if (classes) {
    for (const { i, exterior } of classes) {
      const wall = currentRoom.walls.find(w => w.i === i);
      if (wall) wall.exterior = exterior;
    }
  }
  // classes === null (no containing building found) → leave every wall's
  // provisional `exterior: true` as-is — see classifyRoomEdges' own doc.
  refreshUI();
}

async function fetchBuildingContext(lat, lng) {
  const cacheKey = `osm4_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* corrupted cache — refetch */ }

  // Coordinates rounded to 4 decimals (~11 m — same tolerance as the cache key
  // above): identical queries from nearby clicks let the edge cache share results.
  const qLat = lat.toFixed(4), qLng = lng.toFixed(4);
  // Buildings for shadows and wall classification; water nearby (and any water
  // area containing the point, via is_in) to refuse rooms drawn on it.
  const q = `[out:json][timeout:25];is_in(${qLat},${qLng})->.here;(`
    + `way["building"](around:90,${qLat},${qLng});relation["building"](around:90,${qLat},${qLng});`
    + `way["natural"="water"](around:60,${qLat},${qLng});relation["natural"="water"](around:60,${qLat},${qLng});`
    + `way["waterway"="riverbank"](around:60,${qLat},${qLng});way["natural"="coastline"](around:200,${qLat},${qLng});`
    + `way(pivot.here)["natural"="water"];relation(pivot.here)["natural"="water"];`
    + `);out geom;`;
  const data = await overpassQuery(q);

  const els = data.elements || [];
  const pts = g => g.map(p => ({ lat: p.lat, lon: p.lon }));
  const isWater = e => e.tags && (e.tags.natural === 'water' || e.tags.waterway === 'riverbank');
  const buildings = els
    .filter(e => !isWater(e) && e.tags?.natural !== 'coastline' && Array.isArray(e.geometry) && e.geometry.length >= 3)
    .map(e => ({ geom: pts(e.geometry), h: heightOf(e) }));
  const water = {
    areas: els.filter(isWater).map(e => e.type === 'relation'
      ? (e.members || []).filter(m => Array.isArray(m.geometry)).map(m => pts(m.geometry))
      : [pts(e.geometry || [])]),
    coasts: els.filter(e => e.tags?.natural === 'coastline' && Array.isArray(e.geometry)).map(e => pts(e.geometry)),
  };
  const ctx = (buildings.length || water.areas.length || water.coasts.length) ? { buildings, water } : null;
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
  const tags = el.tags || {};
  const h = parseFloat(tags.height);
  if (!isNaN(h) && h > 0) return h;
  const lv = parseFloat(tags['building:levels']);
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
 * Real monthly climate normals (1991-2020) for a coordinate, cached in
 * localStorage. Throws on any network/shape problem or if temperature is
 * unavailable; the other series may individually be null.
 * @returns {Promise<{temp:number[], rh:?number[], wind:?number[], precip:?number[], rad:?number[]}>}
 *   rad = mean daily horizontal solar radiation, kWh/m²
 */
async function fetchClimateNormals(lat, lon) {
  const cacheKey = `omc2_${lat.toFixed(2)}_${lon.toFixed(2)}`;
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

  const radMJ = monthlyMean(time, data.daily.shortwave_radiation_sum);
  const normals = {
    temp,
    rh: monthlyMean(time, data.daily.relative_humidity_2m_mean),
    wind: monthlyMean(time, data.daily.windspeed_10m_mean),
    precip: monthlyMean(time, data.daily.precipitation_sum),
    rad: radMJ ? radMJ.map(v => v / 3.6) : null, // MJ/m² → kWh/m²
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
    color: INK, weight: 3, opacity: 0.85, dashArray: '6 5',
  }).addTo(map);
}

/**
 * Close the drawn loop: lock the room, derive its walls (azimuth + length,
 * provisionally all "exterior" until OSM data refines them) and floor area
 * from the vertices alone, then kick off the geofence → climate/OSM pipeline,
 * keyed on the room's centroid.
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

  // Crossing sides or a sliver aren't a room: clear it and say why.
  const problem = roomShapeProblem(ring);
  if (problem) {
    removeRoom();
    showToast(t('shape-' + problem), 'warn', 12000);
    return;
  }

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
  climate = null;
  climateStatus = 'idle';

  renderRoomPolygon();
  $('share-btn')?.removeAttribute('disabled');
  refreshUI();
  // The water check needs the OSM data: say so, or a room vanishing a few
  // seconds later looks like a bug.
  showToast(t('water-checking'), 'default', 20000);

  // Fast offline reject for rooms clearly outside Italy.
  if (isOutsideBox(cLat, cLng)) { rejectForeign(); return; }

  // Precise check near borders / on the sea: reverse-geocode the country.
  climateStatus = 'loading';
  refreshCost();
  classifyLocation(cLat, cLng)
    .then(({ kind, region, comune, prov }) => {
      if (roomGen !== myGen) return; // superseded by a newer room
      currentRoom.region = region || null;
      currentRoom.comune = comune || null;
      currentRoom.prov = prov || null;
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
  currentRoom = { vertices: [], locked: false, lat: null, lng: null, region: null, comune: null, prov: null, buildings: [], areaM2: 0, walls: [] };
  climate = null;
  climateStatus = 'idle';
  $('share-btn')?.setAttribute('disabled', '');
  resetOutputUI();
}

function initRemoveRoomButton() {
  $('remove-room-btn')?.addEventListener('click', removeRoom);
}

/** Reset every reading to its pre-analysis placeholder. */
function resetOutputUI() {
  setText('coord-lat', '--°N');
  setText('coord-lng', '--°E');
  setText('room-area', '-- m²');
  setText('val-sunrise', '--:--');
  setText('val-sunset', '--:--');
  setText('val-day-length', '--');
  setText('val-sun-elevation', '--°');
  setText('val-sun-azimuth', '--°');
  setText('val-sun-direct', '--');
  setText('val-humidity', '—');
  setText('val-wind', '—');
  setText('val-rain', '—');
  setText('val-zone', '—');
  refreshCost();
}

// ─── the visit answers ────────────────────────────────────────────────────────

const ANSWER_KEYS = ['heating', 'glass', 'epoch', 'above', 'below', 'hours', 'people'];

function getAnswers() {
  const a = {};
  for (const key of ANSWER_KEYS) {
    const el = document.querySelector(`select[data-answer="${key}"]`);
    a[key] = el ? el.value : 'unknown';
  }
  a.people = parseInt(a.people, 10) || 1;
  return a;
}

function setAnswers(values) {
  for (const key of ANSWER_KEYS) {
    const el = document.querySelector(`select[data-answer="${key}"]`);
    const v = values[key];
    if (el && v != null && [...el.options].some(o => o.value === String(v))) el.value = String(v);
  }
}

function initAnswers() {
  document.querySelectorAll('select[data-answer]').forEach(sel => {
    sel.addEventListener('change', refreshCost);
  });
}

function selectedLabel(key) {
  const el = document.querySelector(`select[data-answer="${key}"]`);
  return el?.selectedOptions[0]?.textContent ?? '';
}

// ─── the estimate ─────────────────────────────────────────────────────────────

const euro = v => Math.round(v).toLocaleString(getLang() === 'en' ? 'en-GB' : 'it-IT');
const range = (lo, hi) => Math.round(lo) === Math.round(hi) ? euro(lo) : `${euro(lo)}–${euro(hi)}`;

/** Compass name of a wall's outward direction (8 sectors). */
function cardinal(az) {
  const keys = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  return t('dir-' + keys[Math.round(((az % 360) + 360) % 360 / 45) % 8]);
}

/**
 * Daily sun on every exterior wall for each month of the heating season,
 * shadows from the OSM buildings included. Cached: it only changes with the
 * room, the floor, the buildings and the climate data.
 */
function wallIrradiance(exteriorWalls, days) {
  const { buildings } = currentRoom;
  const key = `${roomGen}|${currentFloor}|${buildings.length}|${climate?.rad ? 1 : 0}|${days.join(',')}`;
  if (irradianceCache.key !== key) irradianceCache = { key, byWall: new Map() };
  const obsH = currentFloor * FLOOR_HEIGHT_M;
  return exteriorWalls.map(w => {
    let irr = irradianceCache.byWall.get(w.i);
    if (!irr) {
      const isLit = (az, el) => !buildings.length || !sunBlocked(w.midLat, w.midLng, buildings, az, el, obsH);
      irr = climate.rad.map((H, m) => days[m] ? wallDailyIrradiance(H, w.midLat, w.midLng, m, w.azDeg, isLit) : 0);
      irradianceCache.byWall.set(w.i, irr);
    }
    return { lengthM: w.lengthM, irradiance: irr };
  });
}

function showCostState(key) {
  setText('cost-mid', '—');
  setText('cost-range', '—');
  setText('mobile-cost-range', '—');
  setText('cost-state', t(key));
  $('cost-state').hidden = false;
  $('cost-lines').hidden = true;
  setText('cost-source', '');
}

function renderChecklist(items) {
  const list = $('checklist');
  if (!list) return;
  list.replaceChildren(...items.map(key => {
    const li = document.createElement('li');
    li.textContent = t(key);
    return li;
  }));
}

/** Recompute and print the heating cost, the checklist and the climate rows. */
function refreshCost() {
  const answers = getAnswers();
  if (!currentRoom.locked) {
    showCostState('cost-empty');
    renderChecklist(['checklist-empty']);
    return;
  }
  if (climateStatus === 'failed') { showCostState('cost-failed'); renderChecklist(['check-ape']); return; }
  if (climateStatus !== 'ready' || !climate) { showCostState('cost-loading'); return; }

  const exteriorWalls = currentRoom.walls.filter(w => w.exterior);
  const legal = lookupZone(zonesLoaded(), currentRoom.comune, currentRoom.prov);
  const zone = legal?.zone || resolveClimateZone(climate.temp).zone;
  const days = HEATING_DAYS[zone];
  const walls = climate.rad ? wallIrradiance(exteriorWalls, days)
    : exteriorWalls.map(w => ({ lengthM: w.lengthM, irradiance: new Array(12).fill(0) }));

  const gas = gasPriceForRegion(currentRoom.region);
  const r = estimateHeating({
    areaM2: currentRoom.areaM2,
    exteriorWalls: walls,
    monthlyTemps: climate.temp,
    answers,
    prices: { gasEurPerSmc: gas.eurPerSmc, electricityEurPerKWh: PRICES.electricityEurPerKWh },
    legalZone: legal?.zone || null,
  });

  setText('val-zone', legal ? t('zone-legal', { zone, comune: currentRoom.comune }) : t('zone-estimated', { zone }));

  const southOrWestExterior = exteriorWalls.some(w => w.azDeg >= 135 && w.azDeg <= 315);
  renderChecklist(visitChecklist(answers, r, { southOrWestExterior }));

  const central = t('range-approx', { eur: euro(r.perMonth.mid) });
  setText('cost-mid', central);
  setText('mobile-cost-range', central);
  setText('cost-range', range(r.perMonth.lo, r.perMonth.hi));

  const area = euro(currentRoom.areaM2);
  const notes = [
    currentRoom.areaM2 > BIG_ROOM_M2 ? t('cost-big-room', { area }) : '',
    // "Answer more" only while something is still unanswered: with every
    // answer in, the range left is the physics we can't see (walls, habits).
    r.perMonth.hi > WIDE_RANGE_RATIO * Math.max(1, r.perMonth.lo)
      && ANSWER_KEYS.some(k => answers[k] === 'unknown') ? t('cost-wide') : '',
    r.assumedGas ? t('cost-assumed-gas') : '',
    r.central ? t('cost-central') : '',
  ].filter(Boolean);
  $('cost-state').hidden = notes.length === 0;
  setText('cost-state', notes.join(' '));
  $('cost-lines').hidden = false;

  setText('cost-season', t('season-hours', { season: t('season-' + zone, { zone }), hours: r.hours }));

  $('cost-split-row').hidden = !r.perPerson;
  if (r.perPerson) setText('cost-split', t('split-value', { n: r.perPerson.people, mid: euro(r.perPerson.mid), range: range(r.perPerson.lo, r.perPerson.hi) }));

  const saving = r.sunSavingPerMonth;
  setText('cost-sun', exteriorWalls.length === 0 ? t('sun-none-interior')
    : !climate.rad ? t('sun-no-data')
    : saving >= 1 ? t('sun-value', { eur: euro(saving) }) : t('sun-little'));

  $('cost-electric-row').hidden = !r.electricPerMonth;
  if (r.electricPerMonth) setText('cost-electric', t('electric-value', { range: range(r.electricPerMonth.lo, r.electricPerMonth.hi) }));

  if (exteriorWalls.length === 0) {
    setText('cost-why', t('why-interior', { area }));
  } else {
    const dirs = [...new Set(exteriorWalls.map(w => cardinal(w.azDeg)))].join(', ');
    setText('cost-why', t(exteriorWalls.length === 1 ? 'why-value-one' : 'why-value', {
      area,
      n: exteriorWalls.length,
      dirs,
      glass: answers.glass === 'unknown' ? t('why-glass-unknown') : selectedLabel('glass').toLowerCase(),
    }));
  }

  const lang = getLang();
  setText('cost-source', t('result-source', {
    gas: gas.eurPerSmc.toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    gasPeriod: PRICES.gasPeriod[lang],
    el: PRICES.electricityEurPerKWh.toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    elPeriod: PRICES.electricityPeriod[lang],
  }));
}

// ─── sun readings and map, for the selected month/hour ────────────────────────

function refreshUI() {
  if (!currentRoom.locked) { resetOutputUI(); return; }
  const { lat, lng, walls, areaM2, buildings } = currentRoom;
  const month = getSelectedMonth();
  const localHour = getSelectedLocalHour();
  const utcDate = getSelectedUTCDate();

  const { elevation, azimuth } = solarPosition(utcDate, lat, lng);
  const elevClamped = Math.max(0, elevation);
  const hasSun = elevClamped > 1;

  const obsH = currentFloor * FLOOR_HEIGHT_M;
  const hasBuildings = !!(buildings && buildings.length);
  const exteriorWalls = walls.filter(w => w.exterior);

  // Which exterior walls catch direct sun right now: facing the sun AND not
  // blocked by a building. Coloured on the map, summarised in "Sole sulle pareti".
  const perWallLit = new Map();
  let facing = 0, blocked = 0;
  for (const w of exteriorWalls) {
    const faces = hasSun && facadeIrradiance(elevClamped, azimuth, w.azDeg) > 0;
    const isBlocked = faces && hasBuildings && sunBlocked(w.midLat, w.midLng, buildings, azimuth, elevation, obsH);
    if (faces) facing++;
    if (isBlocked) blocked++;
    perWallLit.set(w.i, faces && !isBlocked);
  }

  const { sunrise, sunset, dayLength } = sunriseSunset(utcDate, lat, lng);
  const fmt = d => d ? d.toLocaleTimeString('it-IT', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }) : '--:--';

  setText('coord-lat', lat.toFixed(5) + '°N');
  setText('coord-lng', lng.toFixed(5) + '°E');
  setText('room-area', areaM2.toFixed(1) + ' m²');
  setText('month-label', monthName(month));
  setText('hour-label', String(localHour).padStart(2, '0') + ':00');

  setText('val-sunrise', fmt(sunrise));
  setText('val-sunset', fmt(sunset));
  setText('val-day-length', dayLength > 0 ? `${dayLength.toFixed(1)} h` : '--');
  setText('val-sun-elevation', elevClamped > 0 ? `${elevation.toFixed(1)}°` : t('below-horizon'));
  setText('val-sun-azimuth', `${azimuth.toFixed(0)}° · ${cardinal(azimuth)}`);

  // Direct-sun verdict for the room's walls: night, no wall facing the sun,
  // at least one facing wall shaded by a building, or in sun.
  let sunKey;
  if (!hasSun) sunKey = 'sun-night';
  else if (facing === 0) sunKey = 'sun-other-side';
  else if (blocked > 0) sunKey = 'sun-shadow';
  else sunKey = 'sun-yes';
  setText('val-sun-direct', t(sunKey));

  const rhNow = climate?.rh?.[month];
  const windNow = climate?.wind?.[month];
  const rainNow = climate?.precip?.[month];
  setText('val-humidity', rhNow != null ? Math.round(rhNow) + '%' : '—');
  setText('val-wind', windNow != null ? windNow.toFixed(1) + ' km/h' : '—');
  setText('val-rain', rainNow != null ? Math.round(rainNow * DAYS_IN_MONTH[month]) + ' mm' : '—');

  renderMapOverlays(lat, lng, elevation, azimuth);
  renderWallHighlights(exteriorWalls, perWallLit);

  refreshCost();
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
      setText('month-label', monthName(getSelectedMonth()));
      setText('hour-label', String(getSelectedLocalHour()).padStart(2, '0') + ':00');
      if (currentRoom.locked) refreshUI();
    });
  }
  setText('month-label', monthName(getSelectedMonth()));
}

// ─── the shareable sheet ──────────────────────────────────────────────────────

/** The current room and answers as a link: no server, everything is in the URL. */
function shareUrl() {
  const p = new URLSearchParams();
  p.set('v', currentRoom.vertices.map(v => `${v.lat.toFixed(6)},${v.lng.toFixed(6)}`).join(';'));
  p.set('f', String(currentFloor));
  const a = getAnswers();
  for (const key of ANSWER_KEYS) p.set(key, String(a[key]));
  return `${location.origin}${location.pathname}?${p.toString()}`;
}

async function shareSheet() {
  if (!currentRoom.locked) return;
  const url = shareUrl();
  try {
    if (navigator.share) { await navigator.share({ title: t('share-title'), url }); return; }
  } catch { /* the user closed the share sheet — fall back to copying */ }
  try {
    await navigator.clipboard.writeText(url);
    showToast(t('share-copied'), 'default', 5000);
  } catch {
    showToast(url, 'default', 15000);
  }
}

/** Rebuild a room from a shared link (?v=lat,lng;lat,lng;…). */
function restoreSharedRoom(params) {
  const verts = (params.get('v') || '').split(';')
    .map(pair => pair.split(',').map(Number))
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lat, lng]) => ({ lat, lng }));
  if (verts.length < 3) return false;

  setAnswers(Object.fromEntries(ANSWER_KEYS.map(k => [k, params.get(k)])));
  const floor = parseInt(params.get('f'), 10);
  if (floor >= 0 && floor <= 5) { currentFloor = floor; markActiveFloor(); }

  const cLat = verts.reduce((s, v) => s + v.lat, 0) / verts.length;
  const cLng = verts.reduce((s, v) => s + v.lng, 0) / verts.length;
  map.setView([cLat, cLng], 19);
  currentRoom.vertices = verts;
  lockRoom();
  return true;
}

function initShare() {
  $('share-btn')?.addEventListener('click', shareSheet);
}

// ─── address search ───────────────────────────────────────────────────────────

// Recentring on an address no longer analyses a point by itself — the user
// draws the room next. Any room already there (mid-drawing or locked) is
// cleared so the map is ready to draw at the new location.
function goToAddress(lat, lng, zoom) {
  // On a phone the room is drawn with a finger: start one level closer.
  map.setView([lat, lng], isMobileLayout() ? zoom + 1 : zoom);
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
  const btn = $('geo-btn');
  hideToast();

  if (!navigator.geolocation) {
    showToast(t('geoloc-unsupported'), 'error', 8000);
    return;
  }

  btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.classList.remove('loading', 'denied');
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
  setText('month-label', monthName(getSelectedMonth()));
  if (currentRoom.locked) refreshUI(); else refreshCost(); // dynamic text
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
      if (currentRoom.locked) refreshUI(); // shadows are recomputed for the new height
    });
  });
  markActiveFloor();
}

// ─── mobile layout ──────────────────────────────────────────────────────────
//
// Below the desktop breakpoint the sidebar is hidden (see the CSS) and its
// content is moved, once, into the mobile-only elements declared in app.html:
// the cost stays in a persistent bottom bar, the drawer carries search, the
// full result, the questions, the checklist and the technical details, two
// small widgets hold the sun and climate readings, and one Info sheet folds
// the map legend and the drawing hint together. Reparenting the *existing*
// elements (not duplicating markup) keeps every id and its event handlers.

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
  // The lang switch / drawer button / widgets float just above this bar; its
  // real height depends on content, so it's measured rather than guessed.
  const measureBottomBar = () => {
    if (bottomBar) document.documentElement.style.setProperty('--mobile-bar-h', bottomBar.getBoundingClientRect().height + 'px');
  };
  measureBottomBar();
  panelRemeasurers.push(measureBottomBar);

  const drawerBody = $('mobile-drawer-body');
  move(document.querySelector('.search-card'), drawerBody);
  move($('result-card'), drawerBody);
  move($('visit-card'), drawerBody);
  move($('checklist-card'), drawerBody);
  move($('share-block'), drawerBody);
  move($('tech-details'), drawerBody);
  move(document.querySelector('.sidebar-footer'), drawerBody);

  move(document.querySelector('.solar-card'), $('mobile-solar-body'));
  move(document.querySelector('.climate-card'), $('mobile-climate-body'));

  const infoBody = $('mobile-info-body');
  move($('map-legend-body'), infoBody);
  move($('map-hint-text'), infoBody);

  const openDrawer = initMobileSheet('mobile-drawer-toggle', 'mobile-drawer', 'mobile-drawer-overlay', 'mobile-drawer-close');
  initMobileSheet('mobile-info-btn', 'mobile-info-sheet', 'mobile-info-overlay', 'mobile-info-close');
  $('mobile-cost')?.addEventListener('click', () => openDrawer?.(true));
  initCollapsiblePanel('mobile-solar-widget', 'mobile-solar-toggle');
  initCollapsiblePanel('mobile-climate-widget', 'mobile-climate-toggle');

  // The two widgets share the same corner: only one open at a time, or the
  // expanded panels pile up over each other and over the map.
  const widgets = [
    ['mobile-solar-widget', 'mobile-solar-toggle'],
    ['mobile-climate-widget', 'mobile-climate-toggle'],
  ];
  const collapse = (panelId, toggleId) => {
    $(panelId)?.classList.add('collapsed');
    $(toggleId)?.setAttribute('aria-expanded', 'false');
  };
  widgets.forEach(([, toggleId]) => {
    $(toggleId)?.addEventListener('click', () => {
      widgets.forEach(([otherPanel, otherToggle]) => {
        if (otherToggle !== toggleId) collapse(otherPanel, otherToggle);
      });
    });
  });
  // A tap anywhere outside an open widget (the map included) closes it.
  document.addEventListener('click', e => {
    widgets.forEach(([panelId, toggleId]) => {
      if (!$(panelId)?.contains(e.target)) collapse(panelId, toggleId);
    });
  });
}

/**
 * Wire one bottom sheet: a toggle button that opens it, an overlay and a
 * close button that close it. `inert` keeps its (now off-screen) controls
 * out of tab order and out of the accessibility tree while closed, without
 * fighting the `display:block` the slide-up transform animation needs.
 * @returns {(open:boolean) => void} the open/close setter
 */
function initMobileSheet(toggleId, sheetId, overlayId, closeId) {
  const toggle = $(toggleId), sheet = $(sheetId), overlay = $(overlayId), close = $(closeId);
  if (!toggle || !sheet) return null;
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
  return setOpen;
}

// ─── first-visit tour ─────────────────────────────────────────────────────────

const TOUR_DESKTOP = [
  { target: '.search-card', key: 'tour-search' },
  { target: '#map-hint', key: 'tour-draw' },
  { target: '#floor-bar', key: 'tour-floor' },
  { target: '#remove-room-btn', key: 'tour-remove' },
  { target: '#result-card', key: 'tour-result' },
  { target: '#visit-card', key: 'tour-questions' },
  { target: '#checklist-card', key: 'tour-checklist' },
  { target: '#share-block', key: 'tour-share' },
  { target: '#lang-switch', key: 'tour-lang' },
];

const TOUR_MOBILE = [
  { target: '#map', key: 'tour-draw-mobile' },
  { target: '#floor-bar', key: 'tour-floor' },
  { target: '#remove-room-btn', key: 'tour-remove' },
  { target: '#mobile-bottom-bar', key: 'tour-result-mobile' },
  { target: '#mobile-drawer-toggle', key: 'tour-drawer' },
  { target: '#mobile-widgets', key: 'tour-widgets' },
  { target: '#mobile-info-btn', key: 'tour-info' },
];

function runTour() {
  startTour(mobileLayoutActive ? TOUR_MOBILE : TOUR_DESKTOP);
}

function initTour() {
  $('tour-replay')?.addEventListener('click', () => {
    if (mobileLayoutActive) $('mobile-drawer-close')?.click();
    runTour();
  });
  // First visit only, once the layout (and the map) has settled.
  if (!tourDone()) setTimeout(runTour, 400);
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
 * the spot. Going back the other way is not supported live — a reload picks
 * the right layout for whatever width you land on.
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
  initAnswers();
  initSearchAutocomplete();
  initGeolocation();
  initLangSwitch();
  initFloorBar();
  initRemoveRoomButton();
  initShare();
  initTour();

  if (isMobileLayout()) {
    initMobileLayout();
  } else {
    initCollapsiblePanels();
  }
  refreshCost();
  loadZones().then(() => { if (currentRoom.locked) refreshCost(); });

  // Arriving with a link: a shared sheet (?v=…), a typed address from the
  // landing page (?q=…), or real coordinates from its geolocation (?lat=&lng=).
  const params = new URLSearchParams(location.search);
  if (restoreSharedRoom(params)) return;
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
