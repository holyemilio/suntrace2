/**
 * tour.js — the first-visit guided tour.
 *
 * A dimmed overlay covers the whole app (nothing underneath can be clicked),
 * a ring circles one element at a time and a card explains it, with
 * Avanti / Indietro / Salta. Shown once per browser; the "Guida" link replays it.
 */

import { t } from './i18n.js';

const DONE_KEY = 'suntrace_tour_done';
const PAD = 6; // px of breathing room around the circled element

export function tourDone() {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}

function markDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode: it just shows again */ }
}

/**
 * @param {Array<{target: string, key: string}>} steps  CSS selector of the
 *   element to circle, and the i18n key prefix of its text (`<key>-title`,
 *   `<key>-body`). Steps whose element is missing or hidden are skipped.
 */
export function startTour(steps) {
  const visible = steps.filter(s => {
    const el = document.querySelector(s.target);
    return el && el.getClientRects().length > 0;
  });
  if (!visible.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="tour-ring" aria-hidden="true"></div>
    <div class="tour-card">
      <p class="tour-count"></p>
      <h2 class="tour-title"></h2>
      <p class="tour-body"></p>
      <div class="tour-actions">
        <button type="button" class="tour-skip"></button>
        <span class="tour-spacer"></span>
        <button type="button" class="tour-back"></button>
        <button type="button" class="tour-next"></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const ring = overlay.querySelector('.tour-ring');
  const card = overlay.querySelector('.tour-card');
  const next = overlay.querySelector('.tour-next');
  const back = overlay.querySelector('.tour-back');
  const skip = overlay.querySelector('.tour-skip');
  let i = 0;

  const place = () => {
    const el = document.querySelector(visible[i].target);
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // The ring: the element's box, clamped to the screen.
    const left = Math.max(4, r.left - PAD), top = Math.max(4, r.top - PAD);
    const right = Math.min(vw - 4, r.right + PAD), bottom = Math.min(vh - 4, r.bottom + PAD);
    Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    // The card: below the ring if it fits, else above, else beside; always on screen.
    const cw = Math.min(340, vw - 32);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight;
    let cy = bottom + 12;
    if (cy + ch > vh - 12) cy = top - 12 - ch;
    if (cy < 12) cy = Math.max(12, Math.min(vh - ch - 12, (top + bottom) / 2 - ch / 2));
    let cx = Math.min(Math.max(16, (left + right) / 2 - cw / 2), vw - cw - 16);
    if (cy + ch > top && cy < bottom && right + 12 + cw < vw) cx = right + 12; // beside a tall element
    Object.assign(card.style, { left: `${cx}px`, top: `${cy}px` });
  };

  const show = () => {
    const step = visible[i];
    document.querySelector(step.target).scrollIntoView({ block: 'nearest' });
    overlay.querySelector('.tour-count').textContent = t('tour-count', { i: i + 1, n: visible.length });
    overlay.querySelector('.tour-title').textContent = t(`${step.key}-title`);
    overlay.querySelector('.tour-body').textContent = t(`${step.key}-body`);
    back.textContent = t('tour-back');
    back.hidden = i === 0;
    skip.textContent = t('tour-skip');
    next.textContent = i === visible.length - 1 ? t('tour-done') : t('tour-next');
    place();
    next.focus();
  };

  const close = () => {
    markDone();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };

  const go = d => {
    if (i + d >= visible.length) return close();
    i = Math.max(0, i + d);
    show();
  };

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Tab') { // keep focus inside the card
      const buttons = [...card.querySelectorAll('button:not([hidden])')];
      const at = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  };

  next.addEventListener('click', () => go(1));
  back.addEventListener('click', () => go(-1));
  skip.addEventListener('click', close);
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey, true);
  show();
}
