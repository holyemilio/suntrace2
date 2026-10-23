/**
 * ambiti.test.js — region → ARERA gas tariff area, and the generated prices.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ambitoForRegion, gasPriceForRegion } from '../src/ambiti.js';
import { PRICES } from '../src/prices.js';

test('every region lands in the ARERA ambito listed in the price tables', () => {
  assert.equal(ambitoForRegion('Lombardia'), 'nordEst');
  assert.equal(ambitoForRegion("Valle d'Aosta / Vallée d'Aoste"), 'nordOvest');
  assert.equal(ambitoForRegion('Trentino-Alto Adige/Südtirol'), 'nordEst');
  assert.equal(ambitoForRegion('Lazio'), 'centroSudOvest');
  assert.equal(ambitoForRegion('Sicilia'), 'sud');
  assert.equal(ambitoForRegion('Sardegna'), 'sardegna');
  assert.equal(ambitoForRegion(null), null);
});

test('an unknown region falls back to the mainland average', () => {
  const p = gasPriceForRegion(null);
  assert.equal(p.ambito, null);
  const values = Object.entries(PRICES.gasEurPerSmc).filter(([k]) => k !== 'sardegna').map(([, v]) => v);
  assert.ok(p.eurPerSmc >= Math.min(...values) && p.eurPerSmc <= Math.max(...values));
});

test('the generated prices are complete and plausible', () => {
  assert.equal(Object.keys(PRICES.gasEurPerSmc).length, 7);
  for (const v of Object.values(PRICES.gasEurPerSmc)) assert.ok(v > 0.5 && v < 4, `gas ${v} €/Smc`);
  assert.ok(PRICES.electricityEurPerKWh > 0.1 && PRICES.electricityEurPerKWh < 1.5);
  assert.match(PRICES.gasPeriod.it, /\d{4}$/);
  assert.match(PRICES.electricityPeriod.en, /\d{4}$/);
});
