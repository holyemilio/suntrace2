/**
 * shadow.js — Urban geometry: room-polygon wall orientation/classification and
 * line-of-sight solar access through nearby OpenStreetMap building footprints.
 * Pure functions, no DOM.
 *
 * Buildings are `{ geom: [{lat, lon}, …], h: metres }`; coordinates are projected
 * to local metres centred on the observation point.
 */

import { solarPosition, localToUTC } from './solar.js';

// ─── local projection ─────────────────────────────────────────────────────────

/** Projector from lat/lon to metres relative to the observation point. */
export function localXY(clat, clng) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos(clat * Math.PI / 180);
  return (la, lo) => ({ x: (lo - clng) * mLng, y: (la - clat) * mLat });
}

export function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function pointSegDist(p, a, c) {
  const abx = c.x - a.x, aby = c.y - a.y;
  const ab2 = abx * abx + aby * aby || 1e-9;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Outward normal of edge a→c on the side of the click, as an azimuth (0=N, 90=E, 0..360). */
export function outwardNormalAz(a, c, click) {
  let nx = -(c.y - a.y);
  let ny = (c.x - a.x);
  const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
  if (nx * (click.x - mx) + ny * (click.y - my) < 0) { nx = -nx; ny = -ny; }
  const deg = Math.atan2(nx, ny) * 180 / Math.PI;
  return (deg % 360 + 360) % 360;
}

/** Inverse of localXY: metres relative to the origin back to lat/lon. */
export function localToLatLng(clat, clng) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos(clat * Math.PI / 180);
  return (x, y) => ({ lat: clat + y / mLat, lon: clng + x / mLng });
}

// ─── room polygon geometry ─────────────────────────────────────────────────────

/** Area (shoelace formula) of a ring in local metres, m². Ring may be open (n
 *  distinct vertices, edges wrap i→(i+1)%n) or closed (first===last). */
export function polygonArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(sum) / 2;
}

/** Centroid (vertex average) of a ring in local metres. */
export function polygonCentroid(ring) {
  const sx = ring.reduce((s, p) => s + p.x, 0);
  const sy = ring.reduce((s, p) => s + p.y, 0);
  return { x: sx / ring.length, y: sy / ring.length };
}

// A room edge counts as "exterior" (sun-facing) when it sits this close to the
// containing building's own outer wall — absorbs typical OSM/hand-drawn slop
// without misclassifying a genuine partition wall a few metres further in.
// Was 2.5 m; lowered to 1.0 m (v3.1.1) — 2.5 m was generous enough that a room
// drawn near a building CORNER could have several edges each within tolerance
// of a *different* nearby wall segment, regardless of the room's own
// rotation, so a deliberately misaligned room still came out mostly
// "exterior". A distance-only check can't fully rule that out (fixing it
// properly needs also comparing the edge's angle to the matched wall's, not
// implemented), but shrinking the tolerance shrinks how often it happens in
// practice while still absorbing an honest few-pixel drawing slip.
const EDGE_TOLERANCE_M = 1.0;

/**
 * Classify each edge of a user-drawn room polygon as exterior (near the
 * containing OSM building's outer wall — sun-facing) or interior (facing
 * another room). `roomRing`: local-metres ring (open, n distinct vertices),
 * same origin as `clat,clng`. `buildings`: `{ geom: [{lat,lon}], h }`, the
 * same shape already used by sunBlocked/monthlySunAccess.
 * @returns {?Array<{i:number, exterior:boolean}>} null when no containing
 *   building is found (caller should then treat every edge as exterior).
 */
export function classifyRoomEdges(clat, clng, roomRing, buildings) {
  if (!buildings || !buildings.length) return null;
  const xy = localXY(clat, clng);
  const centroid = polygonCentroid(roomRing);

  let host = null;
  for (const b of buildings) {
    const ring = b.geom.map(p => xy(p.lat, p.lon));
    if (pointInPolygon(centroid.x, centroid.y, ring)) { host = ring; break; }
  }
  if (!host) return null;

  const n = roomRing.length;
  return roomRing.map((a, i) => {
    const c = roomRing[(i + 1) % n];
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    let bestDist = Infinity;
    for (let k = 0; k < host.length - 1; k++) {
      bestDist = Math.min(bestDist, pointSegDist(mid, host[k], host[k + 1]));
    }
    return { i, exterior: bestDist <= EDGE_TOLERANCE_M };
  });
}

// ─── solar access (line-of-sight to the sun) ──────────────────────────────────

/**
 * True when a neighbouring building blocks the direct sun for an observer at the
 * point, at the given height (obsH, m). Casts a horizontal ray toward the sun and
 * checks whether any roof rises above the ray where it crosses a footprint.
 */
export function sunBlocked(clat, clng, buildings, azDeg, elevDeg, obsH) {
  if (elevDeg <= 1) return true; // sun on/below the horizon → no direct sun
  const xy = localXY(clat, clng);
  const az = azDeg * Math.PI / 180;
  const dir = { x: Math.sin(az), y: Math.cos(az) }; // horizontal sun direction (E, N)
  const tanE = Math.tan(elevDeg * Math.PI / 180);

  for (const b of buildings) {
    const ring = b.geom.map(p => xy(p.lat, p.lon));
    if (pointInPolygon(0, 0, ring)) continue; // skip the observer's own building
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], c = ring[i + 1];
      const ex = c.x - a.x, ey = c.y - a.y;
      const det = dir.x * (-ey) - (-ex) * dir.y;
      if (Math.abs(det) < 1e-9) continue;             // ray parallel to the edge
      const tt = (-a.x * ey + ex * a.y) / det;        // distance along the ray
      const ss = (dir.x * a.y - dir.y * a.x) / det;   // position along the edge
      if (tt > 1 && ss >= 0 && ss <= 1) {
        const rayH = obsH + tt * tanE;                // sun-ray height at that distance
        if (b.h > rayH) return true;                  // roof above the ray → shadow
      }
    }
  }
  return false;
}

/**
 * Fraction of the daylight hours the point gets direct sun in a given month
 * (0 = always shaded, 1 = always sunlit). Samples the representative day hourly.
 */
export function sunAccessFraction(clat, clng, buildings, obsH, month, year, timeZone) {
  if (!buildings || !buildings.length) return 1.0;
  let sunlit = 0, daylight = 0;
  for (let h = 4; h <= 21; h++) {
    const { elevation, azimuth } = solarPosition(localToUTC(year, month, 15, h, timeZone), clat, clng);
    if (elevation <= 1) continue;
    daylight++;
    if (!sunBlocked(clat, clng, buildings, azimuth, elevation, obsH)) sunlit++;
  }
  return daylight ? sunlit / daylight : 1.0;
}

// Cached per (point, floor, building set) so dragging the sliders stays cheap.
// A Map (not a single slot) because a room refresh calls this once per exterior
// wall — each with its own origin point — in the same cycle; a single-slot
// cache would evict itself on every call and never actually cache anything.
let accessCache = new Map();

export function monthlySunAccess(clat, clng, buildings, obsH, month, year, timeZone) {
  const key = `${clat.toFixed(5)},${clng.toFixed(5)},${obsH},${buildings ? buildings.length : 0}`;
  let byMonth = accessCache.get(key);
  if (!byMonth) { byMonth = {}; accessCache.set(key, byMonth); }
  if (byMonth[month] === undefined) {
    byMonth[month] = sunAccessFraction(clat, clng, buildings, obsH, month, year, timeZone);
  }
  return byMonth[month];
}
