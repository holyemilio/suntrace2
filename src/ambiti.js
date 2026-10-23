/**
 * ambiti.js — which ARERA tariff area ("ambito tariffario") a region is in.
 *
 * The gas network price differs by ambito; the regions in each one are listed
 * in ARERA's own price tables (G<anno>_stv.xlsx, the header of every block).
 * Region names come from Nominatim's reverse geocoding (address.state).
 */

import { PRICES } from './prices.js';

const REGIONS = {
  nordOvest: ['valle d', 'piemonte', 'liguria'],
  nordEst: ['lombardia', 'trentino', 'veneto', 'friuli', 'emilia'],
  centro: ['toscana', 'umbria', 'marche'],
  centroSudEst: ['abruzzo', 'molise', 'puglia', 'basilicata'],
  centroSudOvest: ['lazio', 'campania'],
  sud: ['calabria', 'sicilia'],
  sardegna: ['sardegna'],
};

/** The ambito key for a region name, or null when it isn't recognised. */
export function ambitoForRegion(region) {
  const r = (region || '').toLowerCase();
  if (!r) return null;
  for (const [ambito, names] of Object.entries(REGIONS)) {
    if (names.some(n => r.includes(n))) return ambito;
  }
  return null;
}

/**
 * Gas price for a region: its ambito's, or — region unknown (the Vatican, San
 * Marino, a failed lookup) — the plain average of the six mainland ambiti.
 * @returns {{ eurPerSmc: number, ambito: ?string }}
 */
export function gasPriceForRegion(region) {
  const ambito = ambitoForRegion(region);
  if (ambito) return { eurPerSmc: PRICES.gasEurPerSmc[ambito], ambito };
  const mainland = Object.entries(PRICES.gasEurPerSmc).filter(([k]) => k !== 'sardegna').map(([, v]) => v);
  return { eurPerSmc: mainland.reduce((a, b) => a + b, 0) / mainland.length, ambito: null };
}
