/**
 * landing.js — the marketing/mission page (index.html). Independent of ui.js:
 * no map, no analysis, just language, the hero search hand-off to the app,
 * and a scroll-reveal for the feature sections.
 */

import { t, getLang, setLang, applyTranslations } from './i18n.js';

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
      applyTranslations();
      document.title = t('landing-title');
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
  const icon = document.getElementById('landing-geo-icon');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) return; // no silent failure UI here — typing an address still works
    btn.classList.add('loading');
    icon.textContent = '⟳';

    navigator.geolocation.getCurrentPosition(
      pos => {
        location.href = `app.html?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
      },
      () => {
        btn.classList.remove('loading');
        icon.textContent = '📌';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

/** Fade sections and draw the feature charts in as they enter the viewport. */
function initScrollReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('revealed'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('revealed');
      io.unobserve(entry.target);
    }
  }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(el => io.observe(el));
}

setLang(getLang());
applyTranslations();
document.title = t('landing-title');
initLangSwitch();
initSearchHandoff();
initGeolocationHandoff();
initScrollReveal();
