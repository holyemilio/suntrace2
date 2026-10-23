/**
 * landing.js — the landing page (index.html). Independent of ui.js: no map,
 * just language, the hero search hand-off to the app, and two figures drawn
 * from the app's own engine — the sun path over Rome (solar.js) and the
 * same-room comparison (cost.js, at the current ARERA prices).
 */

import { t, getLang, setLang, applyTranslations } from './i18n.js';
import { solarPosition } from './solar.js';
import { estimateHeating, wallDailyIrradiance } from './cost.js';
import { PRICES } from './prices.js';
import { gasPriceForRegion } from './ambiti.js';

// Milan, Open-Meteo Climate API (EC_Earth3P_HR, 1991–2020): monthly mean
// temperature (°C) and daily horizontal solar radiation (kWh/m²), aggregated
// from the daily series exactly as ui.js does for any drawn room.
const MILAN = {
  lat: 45.4642, lng: 9.19,
  temp: [1.9, 3.75, 7.92, 12.1, 16.3, 20.38, 23.06, 23.19, 19.17, 13.28, 6.79, 2.09],
  rad: [1.535, 2.534, 3.48, 4.641, 5.622, 6.345, 6.257, 5.454, 4.005, 2.552, 1.566, 1.287],
};

const ROME = { lat: 41.9028, lng: 12.4964 };

// Milan's gas price: ARERA's nord-orientale tariff area.
const MILAN_GAS = gasPriceForRegion('Lombardia');

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// ─── Fig. 1: the sun path over Rome ───────────────────────────────────────────

/**
 * Polar sun-path chart: horizon on the outer circle, zenith in the centre,
 * north up. Each day is sampled every 10 minutes with solarPosition().
 */
function drawSunPath() {
  const svg = document.getElementById('sunpath');
  if (!svg) return;
  const C = 160, R = 130;
  const toXY = (az, el) => {
    const r = R * (1 - el / 90);
    const a = az * Math.PI / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };

  svg.replaceChildren();
  for (const el of [0, 30, 60]) {
    svg.append(svgEl('circle', { cx: C, cy: C, r: R * (1 - el / 90), class: el === 0 ? 'sp-horizon' : 'sp-ring' }));
  }
  svg.append(svgEl('line', { x1: C, y1: C - R, x2: C, y2: C + R, class: 'sp-ring' }));
  svg.append(svgEl('line', { x1: C - R, y1: C, x2: C + R, y2: C, class: 'sp-ring' }));
  for (const [label, x, y] of [['N', C, C - R - 10], ['S', C, C + R + 20], ['E', C + R + 14, C + 5], ['O', C - R - 14, C + 5]]) {
    const tx = svgEl('text', { x, y, class: 'sp-label', 'text-anchor': 'middle' });
    tx.textContent = getLang() === 'en' && label === 'O' ? 'W' : label;
    svg.append(tx);
  }
  for (const el of [30, 60]) {
    const tx = svgEl('text', { x: C + 4, y: C - R * (1 - el / 90) - 4, class: 'sp-small' });
    tx.textContent = `${el}°`;
    svg.append(tx);
  }

  const days = [
    { date: Date.UTC(2026, 11, 21), cls: 'sp-winter', label: getLang() === 'en' ? '21 Dec' : '21 dic' },
    { date: Date.UTC(2026, 5, 21), cls: 'sp-summer', label: getLang() === 'en' ? '21 Jun' : '21 giu' },
  ];
  for (const day of days) {
    const pts = [];
    let top = null;
    for (let m = 0; m < 1440; m += 10) {
      const { elevation, azimuth } = solarPosition(new Date(day.date + m * 60000), ROME.lat, ROME.lng);
      if (elevation <= 0) continue;
      const p = toXY(azimuth, elevation);
      pts.push(p);
      if (!top || elevation > top.el) top = { el: elevation, p };
    }
    svg.append(svgEl('polyline', { points: pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' '), class: day.cls }));
    const tx = svgEl('text', { x: top.p[0] + 8, y: top.p[1] + (day.cls === 'sp-winter' ? 16 : -8), class: 'sp-day' });
    tx.textContent = `${day.label} · ${Math.round(top.el)}°`;
    svg.append(tx);
  }
}

// ─── § 1: the same room, four ways to heat it ─────────────────────────────────

const CASES = {
  heatpump:     { heating: 'heatpump', glass: 'double' },
  gas:          { heating: 'gas', glass: 'double' },
  'gas-single': { heating: 'gas', glass: 'single' },
  electric:     { heating: 'electric', glass: 'double' },
};

function fillComparison() {
  const table = document.getElementById('compare-table');
  if (!table) return;
  const walls = [0, 90].map(az => ({
    lengthM: 4,
    irradiance: MILAN.rad.map((H, m) => wallDailyIrradiance(H, MILAN.lat, MILAN.lng, m, az)),
  }));
  const results = Object.fromEntries(Object.entries(CASES).map(([key, c]) => [key, estimateHeating({
    areaM2: 16,
    exteriorWalls: walls,
    monthlyTemps: MILAN.temp,
    answers: { ...c, epoch: 'y1950', above: 'flat', below: 'flat', people: 1 },
    prices: { gasEurPerSmc: MILAN_GAS.eurPerSmc, electricityEurPerKWh: PRICES.electricityEurPerKWh },
  }).perMonth]));
  const max = Math.max(...Object.values(results).map(r => r.hi));

  for (const row of table.querySelectorAll('tbody tr')) {
    const r = results[row.dataset.case];
    row.querySelector('.l-num-col').textContent = `${Math.round(r.lo)}–${Math.round(r.hi)}`;
    const bar = row.querySelector('.l-bar');
    bar.style.setProperty('--lo', String(r.lo / max));
    bar.style.setProperty('--hi', String(r.hi / max));
  }

  const lang = getLang();
  const fmt = v => v.toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('compare-caption').textContent = t('landing-s1-caption', {
    gas: fmt(MILAN_GAS.eurPerSmc), gasPeriod: PRICES.gasPeriod[lang],
    el: fmt(PRICES.electricityEurPerKWh), elPeriod: PRICES.electricityPeriod[lang],
  });
}

// ─── language, search hand-off ────────────────────────────────────────────────

function render() {
  applyTranslations();
  document.title = t('landing-title');
  drawSunPath();
  fillComparison();
}

function markActiveLang() {
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });
}

function initLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.lang === getLang()) return;
      setLang(btn.dataset.lang);
      render();
      markActiveLang();
    });
  });
  markActiveLang();
}

/** Hand off to the app: a typed address carries over and searches itself there. */
function initSearchHandoff() {
  const form = document.getElementById('landing-search-form');
  const input = document.getElementById('landing-search-input');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const query = input.value.trim();
    location.href = query ? `app.html?q=${encodeURIComponent(query)}` : 'app.html';
  });
}

/** Hand off to the app with real coordinates, skipping the address search entirely. */
function initGeolocationHandoff() {
  const btn = document.getElementById('landing-geo-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) return; // typing an address still works
    btn.classList.add('loading');
    navigator.geolocation.getCurrentPosition(
      pos => {
        location.href = `app.html?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
      },
      () => btn.classList.remove('loading'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

setLang(getLang());
render();
initLangSwitch();
initSearchHandoff();
initGeolocationHandoff();
