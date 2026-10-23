/**
 * zones.test.js — the legal climate zone table (DPR 412/93, Allegato A).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { lookupZone, normComune } from '../src/zones.js';

const table = JSON.parse(readFileSync(new URL('../src/data/zone-climatiche.json', import.meta.url)));

test('the table covers the country', () => {
  const n = Object.values(table).reduce((s, c) => s + Object.keys(c).length, 0);
  assert.ok(n > 7500, `${n} comuni`);
});

test('known comuni carry their legal zone and degree days', () => {
  assert.deepEqual(lookupZone(table, 'Milano', 'MI'), { zone: 'E', gg: 2404, prov: 'MI' });
  assert.deepEqual(lookupZone(table, 'Roma', 'RM'), { zone: 'D', gg: 1415, prov: 'RM' });
  assert.deepEqual(lookupZone(table, 'Firenze', 'FI'), { zone: 'D', gg: 1821, prov: 'FI' });
  assert.equal(lookupZone(table, 'Palermo', 'PA').zone, 'B');
});

test('names match without accents, apostrophes or spaces', () => {
  assert.equal(normComune("Sant'Albano Stura"), 'SANTALBANOSTURA');
  assert.equal(normComune('Agliè'), 'AGLIE');
  assert.ok(lookupZone(table, 'Agliè', 'TO'));
});

test('a provincia created after 1993 still finds a unique comune', () => {
  assert.equal(lookupZone(table, 'Monza', 'MB')?.zone, 'E'); // Monza was in provincia di Milano in 1993
  assert.equal(lookupZone(table, 'Comune che non esiste', 'MI'), null);
});
