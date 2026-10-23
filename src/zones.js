/**
 * zones.js — the legal climate zone of a comune (DPR 412/93, Allegato A).
 *
 * The table (src/data/zone-climatiche.json, built by scripts/build_zones.py)
 * maps provincia → comune → "<zona><gradi giorno>", e.g. MI → MILANO → "E2404".
 * The comune and its provincia come from Nominatim's reverse geocoding.
 * Comuni born from mergers after 1993, or missing from the table, fall back to
 * the zone estimated from the climate (cost.js, resolveClimateZone).
 */

let table = null;
let loading = null;

/** Fetch the table once; resolves to it (or null if it can't be loaded). */
export function loadZones() {
  if (table) return Promise.resolve(table);
  if (!loading) {
    loading = fetch(new URL('./data/zone-climatiche.json', import.meta.url))
      .then(r => (r.ok ? r.json() : null))
      .then(t => (table = t))
      .catch(() => null);
  }
  return loading;
}

export function zonesLoaded() { return table; }

/** Same normalisation as scripts/build_zones.py. */
export function normComune(name) {
  return (name || '').toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
}

/**
 * @param {object} t        the table
 * @param {string} comune   e.g. "Milano"
 * @param {?string} prov    two-letter provincia, e.g. "MI" (may be a post-1993 one)
 * @returns {?{zone: string, gg: number, prov: string}}
 */
export function lookupZone(t, comune, prov) {
  if (!t || !comune) return null;
  const key = normComune(comune);
  const parse = (p, v) => ({ zone: v[0], gg: Number(v.slice(1)), prov: p });
  if (prov && t[prov]?.[key]) return parse(prov, t[prov][key]);
  // A provincia created after 1993 (MB, BT, FM, …): accept the name if it's unique.
  const hits = Object.entries(t).filter(([, c]) => c[key]);
  return hits.length === 1 ? parse(hits[0][0], hits[0][1][key]) : null;
}
