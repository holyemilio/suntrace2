/**
 * cost.test.js — heating-cost estimate.
 * Covers climate zones and heating seasons (DPR 412/93, DPR 74/2013), degree
 * days, the Erbs diffuse fraction, sun on a vertical wall, the room's heat loss
 * coefficient, the euro range and the visit checklist. Pure functions: no DOM,
 * no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  zoneFromDegreeDays,
  HEATING_DAYS,
  degreeDays,
  resolveClimateZone,
  diffuseFraction,
  wallDailyIrradiance,
  heatLossCoefficient,
  windowArea,
  estimateHeating,
  visitChecklist,
  ROOM_HEIGHT_M,
} from '../src/cost.js';

// Milan, Open-Meteo EC_Earth3P_HR 1991–2020 monthly means (°C and kWh/m²/day).
const MILAN_T = [1.9, 3.75, 7.92, 12.1, 16.3, 20.38, 23.06, 23.19, 19.17, 13.28, 6.79, 2.09];
const MILAN_H = [1.535, 2.534, 3.48, 4.641, 5.622, 6.345, 6.257, 5.454, 4.005, 2.552, 1.566, 1.287];
const MILAN = { lat: 45.4642, lng: 9.19 };
const PRICES = { gasEurPerSmc: 1.6202, electricityEurPerKWh: 0.4343 };

const known = { heating: 'gas', glass: 'double', epoch: 'y1950', above: 'flat', below: 'flat', people: 1 };
const unknown = { heating: 'unknown', glass: 'unknown', epoch: 'unknown', above: 'unknown', below: 'unknown', people: 1 };

const wallsFacing = (...azimuths) => azimuths.map(az => ({
  lengthM: 4,
  irradiance: MILAN_H.map((H, m) => wallDailyIrradiance(H, MILAN.lat, MILAN.lng, m, az)),
}));

const estimate = (answers, walls = wallsFacing(0, 90), areaM2 = 16) =>
  estimateHeating({ areaM2, exteriorWalls: walls, monthlyTemps: MILAN_T, answers, prices: PRICES });

// ─── zones and seasons ────────────────────────────────────────────────────────

test('zoneFromDegreeDays follows the DPR 412/93 bands', () => {
  assert.equal(zoneFromDegreeDays(600), 'A');
  assert.equal(zoneFromDegreeDays(601), 'B');
  assert.equal(zoneFromDegreeDays(1400), 'C');
  assert.equal(zoneFromDegreeDays(1415), 'D'); // Roma
  assert.equal(zoneFromDegreeDays(2404), 'E'); // Milano
  assert.equal(zoneFromDegreeDays(3001), 'F');
});

test('HEATING_DAYS match the DPR 74/2013 periods day for day', () => {
  const total = z => HEATING_DAYS[z].reduce((a, b) => a + b, 0);
  assert.equal(total('A'), 105); // 1/12 – 15/3
  assert.equal(total('B'), 121); // 1/12 – 31/3
  assert.equal(total('C'), 137); // 15/11 – 31/3
  assert.equal(total('D'), 166); // 1/11 – 15/4
  assert.equal(total('E'), 183); // 15/10 – 15/4
  assert.equal(total('F'), 365); // no limit
});

test('degreeDays sums (20 − T) over the heating days only', () => {
  assert.equal(degreeDays(new Array(12).fill(10), HEATING_DAYS.E), 183 * 10);
  assert.equal(degreeDays(new Array(12).fill(25), HEATING_DAYS.E), 0, 'no negative contributions');
});

test('resolveClimateZone puts Milan in zone E and is self-consistent', () => {
  const r = resolveClimateZone(MILAN_T);
  assert.equal(r.zone, 'E');
  assert.equal(zoneFromDegreeDays(r.gg), r.zone);
  const warm = resolveClimateZone([11, 11.5, 13, 15.5, 19, 23, 26, 26.5, 23.5, 20, 16, 12.5]);
  assert.equal(zoneFromDegreeDays(warm.gg), warm.zone);
  assert.ok(['A', 'B', 'C'].includes(warm.zone), `a mild coast is a warm zone, got ${warm.zone}`);
});

// ─── sun on a wall ────────────────────────────────────────────────────────────

test('diffuseFraction is the Erbs correlation and stays continuous at its breaks', () => {
  assert.ok(Math.abs(diffuseFraction(0.1) - 0.991) < 1e-9);
  assert.ok(Math.abs(diffuseFraction(0.22) - diffuseFraction(0.2201)) < 0.01);
  assert.ok(Math.abs(diffuseFraction(0.8) - diffuseFraction(0.8001)) < 0.01);
  assert.ok(diffuseFraction(0.7) < diffuseFraction(0.3), 'clearer sky, less diffuse');
});

test('in January a south wall gets far more sun than a north wall', () => {
  const south = wallDailyIrradiance(MILAN_H[0], MILAN.lat, MILAN.lng, 0, 180);
  const north = wallDailyIrradiance(MILAN_H[0], MILAN.lat, MILAN.lng, 0, 0);
  assert.ok(south > 2 * north, `south ${south} vs north ${north}`);
  assert.ok(north > 0, 'a north wall still sees the diffuse sky');
});

test('a building blocking the sun leaves only sky and ground light', () => {
  const open = wallDailyIrradiance(MILAN_H[0], MILAN.lat, MILAN.lng, 0, 180);
  const shaded = wallDailyIrradiance(MILAN_H[0], MILAN.lat, MILAN.lng, 0, 180, () => false);
  const north = wallDailyIrradiance(MILAN_H[0], MILAN.lat, MILAN.lng, 0, 0);
  assert.ok(shaded < open);
  assert.ok(Math.abs(shaded - north) < 1e-9, 'with no beam, orientation stops mattering');
  assert.equal(wallDailyIrradiance(0, MILAN.lat, MILAN.lng, 0, 180), 0);
});

// ─── heat loss ────────────────────────────────────────────────────────────────

test('heatLossCoefficient matches a hand calculation', () => {
  const p = { areaM2: 16, exteriorLengthM: 8, epoch: 'y1950', glass: 'double', above: 'flat', below: 'flat' };
  const win = 16 / 8;                       // 1/8 of the floor
  const opaque = 8 * ROOM_HEIGHT_M - win;
  const expected = opaque * 1.26 + win * 2.8 + 0.34 * 0.3 * 16 * ROOM_HEIGHT_M;
  assert.ok(Math.abs(heatLossCoefficient(p, 'mid') - expected) < 1e-9);
});

test('a roof above adds the ceiling, "Non so" adds it only to the high case', () => {
  const base = { areaM2: 16, exteriorLengthM: 8, epoch: 'y1950', glass: 'double', below: 'flat' };
  const flat = heatLossCoefficient({ ...base, above: 'flat' }, 'mid');
  const roof = heatLossCoefficient({ ...base, above: 'roof' }, 'mid');
  assert.ok(Math.abs(roof - flat - 16 * 1.65) < 1e-9);
  assert.equal(heatLossCoefficient({ ...base, above: 'unknown' }, 'mid'), flat);
  assert.ok(heatLossCoefficient({ ...base, above: 'unknown' }, 'hi') > heatLossCoefficient({ ...base, above: 'flat' }, 'hi'));
});

test('windowArea is the legal 1/8 of the floor, capped by the exterior walls', () => {
  assert.equal(windowArea(16, 8), 2);
  assert.equal(windowArea(16, 0), 0);
  assert.equal(windowArea(400, 1), ROOM_HEIGHT_M);
});

// ─── the estimate ─────────────────────────────────────────────────────────────

test('the estimate is a range in zone E, low below high', () => {
  const r = estimate(known);
  assert.equal(r.zone, 'E');
  assert.ok(r.perMonth.lo > 0 && r.perMonth.lo < r.perMonth.hi);
  assert.ok(Math.abs(r.months - 183 / (365 / 12)) < 1e-9);
});

test('"Non so" answers widen the range', () => {
  const k = estimate(known), u = estimate(unknown);
  assert.ok(u.perMonth.lo <= k.perMonth.lo && u.perMonth.hi >= k.perMonth.hi);
  assert.equal(u.assumedGas, true);
});

test('a plug-in electric heater costs more than a gas boiler, a heat pump less', () => {
  const gas = estimate(known);
  const electric = estimate({ ...known, heating: 'electric' });
  const heatpump = estimate({ ...known, heating: 'heatpump' });
  assert.ok(electric.perMonth.lo > gas.perMonth.lo);
  assert.ok(heatpump.perMonth.hi < gas.perMonth.hi);
  assert.equal(electric.electricPerMonth, null, 'no comparison with itself');
});

test('central heating is costed like the gas it burns, and flagged', () => {
  const central = estimate({ ...known, heating: 'central' });
  const gas = estimate(known);
  assert.deepEqual(central.perMonth, gas.perMonth);
  assert.equal(central.central, true);
  assert.equal(gas.central, false);
});

test('the split per person divides the room cost', () => {
  const r = estimate({ ...known, people: 3 });
  assert.ok(Math.abs(r.perPerson.lo * 3 - r.perMonth.lo) < 1e-9);
  assert.equal(estimate(known).perPerson, null);
});

test('south and west walls save more sun than north and east ones', () => {
  const ne = estimate(known, wallsFacing(0, 90));
  const sw = estimate(known, wallsFacing(180, 270));
  assert.ok(sw.sunSavingPerMonth > ne.sunSavingPerMonth);
  assert.ok(sw.perMonth.lo < ne.perMonth.lo);
  assert.equal(sw.perMonth.hi, ne.perMonth.hi, 'the high end counts no sun at all');
});

test('a fully interior room still loses heat through air changes', () => {
  const r = estimate(known, []);
  assert.ok(r.perMonth.lo > 0);
  assert.equal(r.sunShare, 0);
});

// ─── checklist ────────────────────────────────────────────────────────────────

test('the checklist puts the costliest issue first, ends with the APE, max 5', () => {
  const items = visitChecklist({ ...unknown, heating: 'electric', glass: 'single', above: 'roof' }, { sunShare: 0.05 }, { southOrWestExterior: true });
  assert.equal(items[0], 'check-electric');
  assert.ok(items.length <= 5);
  assert.equal(visitChecklist(known, { sunShare: 0.3 }).at(-1), 'check-ape');
  assert.deepEqual(visitChecklist(known, { sunShare: 0.3 }), ['check-ape']);
});
