/**
 * prices.js — energy prices used by the cost estimate.
 *
 * Updated by hand once a month (see docs/metodo.md, "Aggiornare i prezzi").
 * Both are ARERA reference prices for the "cliente tipo vulnerabile", all
 * taxes and charges included — the closest thing to a single public number
 * for what a household pays per unit.
 */

export const PRICES = {
  // ARERA, nota stampa del 2/10/2026: prezzo di riferimento del gas per il
  // nuovo cliente tipo (1.100 Smc/anno), settembre 2026: 162,02 c€/Smc.
  gasEurPerSmc: 1.6202,
  gasPeriod: { it: 'settembre 2026', en: 'September 2026' },

  // ARERA via Il Sole 24 Ore Radiocor, 29/9/2026: prezzo di riferimento
  // dell'elettricità per il cliente tipo vulnerabile, IV trimestre 2026,
  // tasse incluse: 43,43 c€/kWh.
  electricityEurPerKWh: 0.4343,
  electricityPeriod: { it: 'ottobre–dicembre 2026', en: 'October–December 2026' },
};
