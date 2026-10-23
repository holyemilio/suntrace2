/**
 * cost.js — how much it costs to heat the drawn room.
 *
 * Pure functions, no DOM, no network. Every constant below carries its source;
 * the method and a legend of every symbol are in docs/metodo.md.
 *
 * In one line: heat lost through the room's exterior walls, windows, ceiling,
 * floor and air changes (H, in W/K) × how cold the heating season is (degree
 * days) − the most the sun can give back through the windows, turned into
 * euro with the heating system's efficiency and ARERA's prices.
 *
 * The result is always a range, never a single invented number: the low end
 * takes the best case of every uncertain value, the high end the worst. Every
 * "Non so" answer widens it, every real answer narrows it.
 */

import { solarPosition } from './solar.js';

// ─── fixed values (sources in docs/metodo.md) ─────────────────────────────────

/** DM 5/7/1975: minimum internal height of a living room. */
export const ROOM_HEIGHT_M = 2.7;

/** DM 5/7/1975: openable window area ≥ 1/8 of the floor area (legal minimum). */
export const WINDOW_FLOOR_RATIO = 1 / 8;

/** DPR 412/93: conventional indoor temperature for degree days. */
export const INDOOR_C = 20;

/** Air changes per hour: 0.3 (UNI/TS 11300-1, residential) … 0.5 (UNI EN 12831). */
export const AIR_CHANGES = { lo: 0.3, mid: 0.3, hi: 0.5 };

/** Heat capacity of air per volume, Wh/(m³·K) — the 0.34 in 0.34·n·V. */
const AIR_WH_PER_M3K = 0.34;

/** ARERA (TIVG): conventional higher heating value of natural gas, kWh/Smc. */
export const GAS_KWH_PER_SMC = 10.69;

/**
 * Gas boiler seasonal efficiency, on the higher heating value: 0.86 is the
 * legal minimum for new boilers since 26/9/2015 (EU Reg. 813/2013), 0.75 its
 * floor for B1 boilers, 0.94 a class-A condensing boiler.
 */
export const BOILER_EFF = { lo: 0.94, mid: 0.86, hi: 0.75 };

/** Heat pump / air conditioner SCOP: class C (2.8) … A (3.4) … A+ (4.0), EU Reg. 626/2011. */
export const HEAT_PUMP_SCOP = { lo: 4.0, mid: 3.4, hi: 2.8 };

/**
 * U-values in W/(m²·K) by construction period — TABULA Italian building
 * typology (Corrado, Ballarini, Corgnati, Talà, Politecnico di Torino 2011),
 * tables 4 and 5. `lo`/`hi` span the brick wall types of that period, `mid`
 * is the most typical one. In every table "lo" means "cheaper to heat".
 */
export const WALL_U = {
  pre1950:  { lo: 1.02, mid: 1.48, hi: 2.40 }, // mattoni pieni 62 cm … 38 cm … pietra 45 cm
  y1950:    { lo: 1.10, mid: 1.26, hi: 1.76 }, // cassa vuota 40 cm … paramano + forati … forati 25 cm
  y1976:    { lo: 0.76, mid: 0.78, hi: 0.82 }, // basso isolamento
  y1991:    { lo: 0.59, mid: 0.60, hi: 0.62 }, // medio isolamento
  post2005: { lo: 0.34, mid: 0.34, hi: 0.34 }, // D.Lgs 192/2005 e 311/2006
  unknown:  { lo: 0.34, mid: 1.48, hi: 2.40 },
};

/** Ceiling towards an unheated attic or roof (TABULA tab. 4, solai e coperture). */
export const CEILING_U = {
  pre1950:  { lo: 1.65, mid: 1.96, hi: 2.86 },
  y1950:    { lo: 1.65, mid: 1.65, hi: 2.20 },
  y1976:    { lo: 0.95, mid: 0.97, hi: 1.14 },
  y1991:    { lo: 0.64, mid: 0.69, hi: 0.74 },
  post2005: { lo: 0.30, mid: 0.30, hi: 0.30 },
  unknown:  { lo: 0.30, mid: 1.65, hi: 2.86 },
};

/** Floor towards a cellar, garage or the ground (TABULA tab. 4, chiusura inferiore). */
export const FLOOR_U = {
  pre1950:  { lo: 1.30, mid: 1.58, hi: 2.04 },
  y1950:    { lo: 1.30, mid: 1.30, hi: 2.00 },
  y1976:    { lo: 0.98, mid: 0.98, hi: 1.24 },
  y1991:    { lo: 0.77, mid: 0.77, hi: 0.93 },
  post2005: { lo: 0.33, mid: 0.33, hi: 0.33 },
  unknown:  { lo: 0.33, mid: 1.30, hi: 2.04 },
};

/**
 * Windows: whole-window U (W/(m²·K)) from wooden to metal frame, and the
 * glass solar transmittance g at normal incidence (TABULA tab. 5).
 */
export const WINDOWS = {
  single:  { U: { lo: 4.9, mid: 4.9, hi: 5.7 }, g: 0.85 },
  double:  { U: { lo: 2.8, mid: 2.8, hi: 3.7 }, g: 0.75 },
  lowe:    { U: { lo: 2.2, mid: 2.2, hi: 2.4 }, g: 0.67 },
  unknown: { U: { lo: 2.2, mid: 2.8, hi: 5.7 }, g: 0.85 },
};

/** Ground reflectance for the reflected share on a vertical wall (Duffie & Beckman). */
const GROUND_ALBEDO = 0.2;

/** Solar constant, W/m² (Duffie & Beckman). */
const SOLAR_CONSTANT = 1367;

/** Klein's mean day of each month (day of the year) — Maleki et al. 2017, tab. 9. */
export const MEAN_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_PER_MONTH_AVG = 365 / 12;

// ─── climate zone and heating season ──────────────────────────────────────────

/** DPR 412/93, art. 2: climate zone from degree days. */
export function zoneFromDegreeDays(gg) {
  if (gg <= 600) return 'A';
  if (gg <= 900) return 'B';
  if (gg <= 1400) return 'C';
  if (gg <= 2100) return 'D';
  if (gg <= 3000) return 'E';
  return 'F';
}

/**
 * DPR 74/2013, art. 4: heating days counted in each month, per zone.
 * A 1/12–15/3 · B 1/12–31/3 · C 15/11–31/3 · D 1/11–15/4 · E 15/10–15/4 ·
 * F no national limit (every day counts).
 */
export const HEATING_DAYS = {
  A: [31, 28, 15, 0, 0, 0, 0, 0, 0, 0, 0, 31],
  B: [31, 28, 31, 0, 0, 0, 0, 0, 0, 0, 0, 31],
  C: [31, 28, 31, 0, 0, 0, 0, 0, 0, 0, 16, 31],
  D: [31, 28, 31, 15, 0, 0, 0, 0, 0, 0, 30, 31],
  E: [31, 28, 31, 15, 0, 0, 0, 0, 0, 17, 30, 31],
  F: DAYS_IN_MONTH.slice(),
};

/**
 * DPR 74/2013, art. 4: the most hours a day heating may run, per zone
 * (F has no national limit).
 */
export const MAX_DAILY_HOURS = { A: 6, B: 8, C: 10, D: 12, E: 14, F: 24 };

/**
 * Share of the round-the-clock heat loss a day with `hours` of heating costs.
 * Two hard limits: heating `hours` a day can't cost more than heating all 24
 * (factor 1), nor less than the loss during those hours alone (hours / 24, as
 * if the room went cold the instant the heating stopped — it never does). The
 * typical case takes the middle of the two: an assumption, stated as such in
 * docs/metodo.md, because how fast a room cools depends on walls we can't see.
 */
export function dailyHoursFactor(hours, c) {
  const share = Math.min(24, Math.max(0, hours)) / 24;
  if (c === 'lo') return share;
  if (c === 'hi') return 1;
  return (1 + share) / 2;
}

/** Degree days from 12 monthly mean temperatures over the given heating days. */
export function degreeDays(monthlyTemps, heatingDays) {
  return monthlyTemps.reduce((s, t, m) => s + heatingDays[m] * Math.max(0, INDOOR_C - t), 0);
}

/**
 * The zone whose own heating season gives degree days that fall in that same
 * zone. Several can qualify at a boundary: the coldest wins (prudent).
 * @returns {{ zone: string, gg: number, days: number[] }}
 */
export function resolveClimateZone(monthlyTemps) {
  let pick = null;
  for (const zone of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const gg = degreeDays(monthlyTemps, HEATING_DAYS[zone]);
    if (zoneFromDegreeDays(gg) === zone) pick = { zone, gg, days: HEATING_DAYS[zone] };
  }
  if (!pick) {
    const zone = zoneFromDegreeDays(degreeDays(monthlyTemps, HEATING_DAYS.E));
    pick = { zone, gg: degreeDays(monthlyTemps, HEATING_DAYS[zone]), days: HEATING_DAYS[zone] };
  }
  return pick;
}

// ─── sun on a vertical wall ───────────────────────────────────────────────────

/** Erbs hourly diffuse fraction from the clearness index kt (Maleki et al. 2017, tab. 2). */
export function diffuseFraction(kt) {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

/**
 * Daily solar energy reaching a vertical wall on the month's mean day, kWh/m².
 *
 * The month's daily horizontal total H is spread over the day in proportion to
 * the sun above the atmosphere (constant clearness index), split into beam and
 * diffuse with Erbs, then projected on the wall: beam × cos(incidence) only
 * while no building blocks it, half the diffuse sky (isotropic, Liu-Jordan),
 * half the light reflected by the ground.
 *
 * @param {number} H        mean daily horizontal radiation, kWh/m²
 * @param {number} lat
 * @param {number} lng
 * @param {number} month    0-based
 * @param {number} wallAz   direction the wall faces (0 = N, clockwise)
 * @param {(az:number, el:number) => boolean} [isLit]  false when a building
 *        blocks the direct sun; omitted = never blocked
 */
export function wallDailyIrradiance(H, lat, lng, month, wallAz, isLit = () => true) {
  if (!(H > 0)) return 0;
  const n = MEAN_DAY[month];
  const e0 = 1 + 0.033 * Math.cos(2 * Math.PI * n / 365);
  const STEP_H = 1 / 6; // 10 minutes
  const samples = [];
  let h0 = 0; // extraterrestrial on the horizontal, Wh/m²
  const midnight = Date.UTC(2026, 0, n);
  for (let k = 0; k < 24 / STEP_H; k++) {
    const { elevation, azimuth } = solarPosition(new Date(midnight + k * STEP_H * 3600e3), lat, lng);
    if (elevation <= 0) continue;
    const el = elevation * Math.PI / 180;
    const i0 = SOLAR_CONSTANT * e0 * Math.sin(el) * STEP_H;
    h0 += i0;
    samples.push({ i0, cosInc: Math.cos(el) * Math.cos((azimuth - wallAz) * Math.PI / 180), sinEl: Math.sin(el), azimuth, elevation });
  }
  if (h0 <= 0) return 0;
  const kt = Math.min(1, (H * 1000) / h0);
  const fd = diffuseFraction(kt);
  let wh = 0;
  for (const s of samples) {
    const ih = kt * s.i0;            // global on the horizontal in this step
    const beamNormalStep = (1 - fd) * ih / s.sinEl;
    if (s.cosInc > 0 && isLit(s.azimuth, s.elevation)) wh += beamNormalStep * s.cosInc;
    wh += fd * ih * 0.5 + GROUND_ALBEDO * ih * 0.5;
  }
  return wh / 1000;
}

// ─── heat loss ────────────────────────────────────────────────────────────────

/**
 * Heat loss coefficient of the room, W/K, for one case (lo / mid / hi).
 * @param {object} p
 * @param {number} p.areaM2
 * @param {number} p.exteriorLengthM   total length of the exterior walls
 * @param {string} p.epoch     key of WALL_U
 * @param {string} p.glass     key of WINDOWS
 * @param {string} p.above     'flat' | 'roof' | 'unknown'
 * @param {string} p.below     'flat' | 'ground' | 'unknown'
 * @param {'lo'|'mid'|'hi'} c
 */
export function heatLossCoefficient(p, c) {
  const wallArea = p.exteriorLengthM * ROOM_HEIGHT_M;
  const winArea = windowArea(p.areaM2, p.exteriorLengthM);
  const opaque = Math.max(0, wallArea - winArea);
  const surfaceU = (choice, yes, table) =>
    choice === yes ? table[p.epoch][c] : choice === 'unknown' && c === 'hi' ? table[p.epoch].hi : 0;
  return opaque * WALL_U[p.epoch][c]
    + winArea * WINDOWS[p.glass].U[c]
    + p.areaM2 * surfaceU(p.above, 'roof', CEILING_U)
    + p.areaM2 * surfaceU(p.below, 'ground', FLOOR_U)
    + AIR_WH_PER_M3K * AIR_CHANGES[c] * p.areaM2 * ROOM_HEIGHT_M;
}

/** Window area: the legal minimum, never more than the exterior walls hold. */
export function windowArea(areaM2, exteriorLengthM) {
  if (exteriorLengthM <= 0) return 0;
  return Math.min(areaM2 * WINDOW_FLOOR_RATIO, exteriorLengthM * ROOM_HEIGHT_M);
}

// ─── the estimate ─────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {number} input.areaM2
 * @param {Array<{lengthM:number, irradiance:number[]}>} input.exteriorWalls
 *        `irradiance[m]` = wallDailyIrradiance() for month m (0 outside the season is fine)
 * @param {number[]} input.monthlyTemps   12 monthly mean temperatures, °C
 * @param {{heating:string, glass:string, epoch:string, above:string, below:string, people:number}} input.answers
 * @param {{gasEurPerSmc:number, electricityEurPerKWh:number}} input.prices
 */
export function estimateHeating({ areaM2, exteriorWalls, monthlyTemps, answers, prices }) {
  const { zone, gg, days } = resolveClimateZone(monthlyTemps);
  const seasonDays = days.reduce((a, b) => a + b, 0);
  const months = seasonDays / DAYS_PER_MONTH_AVG;
  const exteriorLengthM = exteriorWalls.reduce((s, w) => s + w.lengthM, 0);
  const geo = { areaM2, exteriorLengthM, epoch: answers.epoch, glass: answers.glass, above: answers.above, below: answers.below };

  const winTotal = windowArea(areaM2, exteriorLengthM);
  const g = WINDOWS[answers.glass].g;
  // Windows spread over the exterior walls in proportion to their length.
  const gainsByMonth = monthlyTemps.map((_, m) => exteriorWalls.reduce((s, w) =>
    s + winTotal * (w.lengthM / exteriorLengthM) * g * (w.irradiance[m] || 0) * days[m], 0));

  // Hours a day: the answer, never above the zone's legal maximum; "Non so" = the maximum.
  const hours = Math.min(MAX_DAILY_HOURS[zone], Number(answers.hours) || MAX_DAILY_HOURS[zone]);
  const lossByMonth = c => {
    const H = heatLossCoefficient(geo, c) * dailyHoursFactor(hours, c);
    return monthlyTemps.map((t, m) => H * Math.max(0, INDOOR_C - t) * 24 * days[m] / 1000);
  };
  const net = (loss, withSun) => loss.reduce((s, q, m) => s + Math.max(0, q - (withSun ? gainsByMonth[m] : 0)), 0);

  const lossLo = lossByMonth('lo'), lossMid = lossByMonth('mid'), lossHi = lossByMonth('hi');
  const kWh = {
    lo: net(lossLo, true),
    hi: net(lossHi, false),
    midNoSun: net(lossMid, false),
    midSun: net(lossMid, true),
  };

  // Central heating burns gas too: the room's own consumption is costed like a
  // gas boiler. What the tenant actually pays also depends on how the building
  // splits the bill, which the app says alongside the figure.
  const system = answers.heating === 'unknown' || answers.heating === 'central' ? 'gas' : answers.heating;
  const toEuro = (q, sys, c) => {
    if (sys === 'gas') return q / (BOILER_EFF[c] * GAS_KWH_PER_SMC) * prices.gasEurPerSmc;
    if (sys === 'heatpump') return q / HEAT_PUMP_SCOP[c] * prices.electricityEurPerKWh;
    return q * prices.electricityEurPerKWh; // plug-in electric heater
  };
  const perMonth = eur => eur / months;
  const people = Math.max(1, answers.people || 1);

  const lo = perMonth(toEuro(kWh.lo, system, 'lo'));
  const hi = perMonth(toEuro(kWh.hi, system, 'hi'));
  // The most likely figure: typical values for everything still unknown, the
  // sun counted in full (the same "mid" case the sun line uses).
  const mid = perMonth(toEuro(kWh.midSun, system, 'mid'));
  const sunSaving = perMonth(toEuro(kWh.midNoSun, system, 'mid') - toEuro(kWh.midSun, system, 'mid'));

  return {
    zone, gg, seasonDays, months, system, hours,
    assumedGas: answers.heating === 'unknown',
    central: answers.heating === 'central',
    kWh,
    perMonth: { lo, mid, hi },
    perPerson: people === 1 ? null : { lo: lo / people, mid: mid / people, hi: hi / people, people },
    perSeason: { lo: lo * months, hi: hi * months },
    sunSavingPerMonth: sunSaving,
    electricPerMonth: system === 'electric' ? null
      : { lo: perMonth(toEuro(kWh.lo, 'electric', 'lo')), hi: perMonth(toEuro(kWh.hi, 'electric', 'hi')) },
    sunShare: kWh.midNoSun > 0 ? 1 - kWh.midSun / kWh.midNoSun : 0,
  };
}

// ─── what to check at the viewing ─────────────────────────────────────────────

/**
 * Up to five things to check or ask, most expensive first. Each item is an
 * i18n key; the list depends on the answers and on the estimate itself.
 */
export function visitChecklist(answers, result, { southOrWestExterior = false } = {}) {
  const items = [];
  if (answers.heating === 'electric') items.push('check-electric');
  if (answers.heating === 'central') items.push('check-central');
  if (answers.heating === 'unknown') items.push('check-heating');
  if (answers.glass === 'single') items.push('check-single-glass');
  if (answers.glass === 'unknown') items.push('check-glass-test');
  if (result && result.sunShare < 0.1) items.push('check-mould');
  if (answers.epoch === 'unknown') items.push('check-epoch');
  if (answers.above === 'roof' && southOrWestExterior) items.push('check-summer');
  items.push('check-ape');
  return items.slice(0, 5);
}
