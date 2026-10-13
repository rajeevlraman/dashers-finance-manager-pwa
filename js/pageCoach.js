// pageCoach.js
//
// The "page insight" that appears when someone opens a page from the tour.
// It shows a short insight about the page, then a spotlight and a small
// "Got it" box glide from one item on the screen to the next. Each tap on
// "Got it" moves to the next item; the last one finishes.
//
// What it says lives in pageInsights.js. This file is only the mechanics:
//   - placeCard / spotRect / clamp are pure (no DOM), so they are unit-tested;
//   - startPageCoach / queuePageCoach / stopPageCoach drive the screen.
//
// Nothing here touches your data, and nothing runs unless the tour opens a page.

import { insightFor } from './pageInsights.js';
import { NAV_ITEMS } from './navItems.js';

const ROOT_ID = 'pageCoach';
export const VIEW_LOADED_EVENT = 'dfm:view-loaded';   // dispatched by ui.js when a page has finished rendering

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

// How far through the tour a step is, as a whole percentage. The insight (step 0)
// is 0% and the last step is 100%.
export function progressPercent(index, total) {
  if (!(total > 1)) return 100;
  return Math.round(Math.min(Math.max(index, 0), total - 1) / (total - 1) * 100);
}

// The highlighted box: the target's rectangle with a little padding, trimmed to
// the part of the screen that is actually visible (between the sticky header and
// the bottom bar), so a very tall target does not push the box off screen.
export function spotRect(rect, viewport, insets = { top: 0, bottom: 0 }, pad = 6) {
  const top = Math.max(rect.top - pad, insets.top + 2);
  const bottom = Math.min(rect.bottom + pad, viewport.h - insets.bottom - 2);
  const left = Math.max(rect.left - pad, 4);
  const right = Math.min(rect.right + pad, viewport.w - 4);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// Where the "Got it" box goes. Below the highlight if it fits, else above it,
// else over the lower or upper part of the screen (a target that fills it).
// With no highlight (a page with no obvious heading) it sits in the middle.
// arrowX is where the little pointer sits along the box's top or bottom edge.
export function placeCard({ spot, card, viewport, insets = { top: 0, bottom: 0 }, gap = 12, margin = 8 }) {
  const width = Math.min(card.w, viewport.w - margin * 2);
  const minTop = insets.top + margin;
  const maxBottom = viewport.h - insets.bottom - margin;
  if (!spot) {
    return {
      placement: 'center', width, arrowX: 0,
      left: Math.round((viewport.w - width) / 2),
      top: Math.round(clamp(minTop + (maxBottom - minTop - card.h) / 2, minTop, maxBottom - card.h)),
    };
  }
  const spotBottom = spot.top + spot.height;
  const spaceBelow = maxBottom - (spotBottom + gap);
  const spaceAbove = (spot.top - gap) - minTop;
  let placement, top;
  if (spaceBelow >= card.h) { placement = 'below'; top = spotBottom + gap; }
  else if (spaceAbove >= card.h) { placement = 'above'; top = spot.top - gap - card.h; }
  else { placement = 'over'; top = spaceBelow >= spaceAbove ? maxBottom - card.h : minTop; }
  const centre = spot.left + spot.width / 2;
  const left = clamp(centre - width / 2, margin, viewport.w - width - margin);
  return {
    placement, width,
    left: Math.round(left),
    top: Math.round(clamp(top, minTop, Math.max(minTop, maxBottom - card.h))),
    arrowX: Math.round(clamp(centre - left, 18, width - 18)),
  };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function isShown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const cs = window.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

// First visible element for the first selector that matches one.
// A selector may end in " >> some words": then only an element whose text contains
// those words counts (case-insensitive). That is how one step points at "the Insurance
// Review card" when every card on the page shares the same class.
export function findTarget(root, selectors) {
  if (!root || !selectors) return null;
  for (const raw of selectors) {
    const cut = String(raw).indexOf(' >> ');
    const sel = cut === -1 ? String(raw) : String(raw).slice(0, cut);
    const needle = cut === -1 ? '' : String(raw).slice(cut + 4).trim().toLowerCase();
    let list;
    try { list = root.querySelectorAll(sel); } catch { continue; }
    for (const el of list) {
      if (needle && !String(el.textContent || '').toLowerCase().includes(needle)) continue;
      if (isShown(el)) return el;
    }
  }
  return null;
}

const ACTIVE_CLASSES = ['active', 'is-active', 'selected', 'current'];

// True when a tab-like control is the one currently showing.
export function isActiveTab(el) {
  if (!el) return false;
  if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true') return true;
  return ACTIVE_CLASSES.some(c => el.classList.contains(c));
}

// A selector that finds the same control again after the page redraws.
function cssPath(el) {
  const parts = [];
  for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
    if (n.id && !/\s/.test(n.id)) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
    const parent = n.parentElement;
    parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${parent ? Array.prototype.indexOf.call(parent.children, n) + 1 : 1})`);
  }
  return parts.join(' > ');
}

function readInsets() {
  let top = 0;
  let bottom = 0;
  const bars = [
    document.querySelector('header'),
    document.getElementById('mainNavList')?.closest('nav'),
  ];
  for (const el of bars) {
    if (!el) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || (cs.position !== 'sticky' && cs.position !== 'fixed')) continue;
    top = Math.max(top, el.getBoundingClientRect().bottom);
  }
  const tabs = document.getElementById('bottomNav');
  if (tabs) {
    const cs = window.getComputedStyle(tabs);
    if (cs.display !== 'none' && cs.position === 'fixed') bottom = Math.max(0, window.innerHeight - tabs.getBoundingClientRect().top);
  }
  return { top: Math.max(0, top), bottom };
}

const HEADING_SELECTORS = ['.page-header', '.settings-header', '.wealth-hero', 'h1', 'h2'];

function pageLabel(view) {
  const item = NAV_ITEMS.find(i => i.view === view);
  return { icon: item?.icon || '\u{1F4A1}', label: item?.label || '' };
}

// ---------------------------------------------------------------------------
// The coach
// ---------------------------------------------------------------------------
let active = null;      // { root, spotEl, cardEl, steps, idx, ... } while the coach is on screen
let pending = null;     // { onLoaded, timer } while waiting for a page to finish loading

export function isPageCoachOpen() { return !!active; }

export function stopPageCoach() {
  if (!active) return;
  const a = active;
  active = null;
  window.removeEventListener('resize', a.onMove);
  window.removeEventListener('scroll', a.onMove, true);
  window.removeEventListener('hashchange', a.onHash);
  document.removeEventListener('keydown', a.onKey, true);
  if (a.frame) cancelAnimationFrame(a.frame);
  a.root.remove();
}

function cancelPending() {
  if (!pending) return;
  window.removeEventListener(VIEW_LOADED_EVENT, pending.onLoaded);
  clearTimeout(pending.timer);
  clearTimeout(pending.failsafe);
  pending = null;
}

// Open the coach for `view` once that page has finished rendering. Call this
// BEFORE changing the page (location.hash), so it can tell whether the page
// is already showing.
export function queuePageCoach(view, opts = {}) {
  cancelPending();
  stopPageCoach();
  if (!insightFor(view)) return;
  const current = window.location.hash.slice(1) || 'finance-overview';
  const alreadyShowing = current === view && !document.querySelector('#mainContent .loading-state');
  const begin = () => { cancelPending(); startPageCoach(view, opts); };
  if (alreadyShowing) { pending = { timer: setTimeout(begin, 250) }; return; }
  const onLoaded = (e) => {
    if (e.detail?.view !== view) return;
    window.removeEventListener(VIEW_LOADED_EVENT, onLoaded);
    clearTimeout(pending?.failsafe);
    pending.timer = setTimeout(begin, 350);   // let charts and late-filled cards settle
  };
  window.addEventListener(VIEW_LOADED_EVENT, onLoaded);
  // If the page never reports in (it errored, or is locked), give up quietly.
  pending = { onLoaded, failsafe: setTimeout(cancelPending, 8000) };
}

export async function startPageCoach(view, { onBackToTour } = {}) {
  stopPageCoach();
  const data = insightFor(view);
  const main = document.getElementById('mainContent');
  if (!data || !main) return false;
  const { icon, label } = pageLabel(view);

  // Step 0 is the page insight; the rest point at items that are really on screen.
  const steps = [{ kind: 'insight', title: label || 'This page', text: data.insight }];
  for (const s of data.steps) {
    // A step may name a tab to open first (s.click) when its item sits in a tab that is not showing.
    if (findTarget(main, s.target) || (s.click && main.querySelector(s.click))) {
      steps.push({ kind: 'item', title: s.title, text: s.text, target: s.target, click: s.click });
    }
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'pc-root pc-snap';
  root.innerHTML = `
    <div class="pc-shield"></div>
    <div class="pc-spot" aria-hidden="true"></div>
    <div class="pc-card" role="dialog" aria-labelledby="pcTitle" aria-describedby="pcText" data-placement="below">
      <div class="pc-head"><span class="pc-kicker"></span><span class="pc-count" aria-hidden="true"></span></div>
      <div class="pc-progress" role="progressbar" aria-label="Progress through this page" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      <strong class="pc-title" id="pcTitle"></strong>
      <p class="pc-text" id="pcText"></p>
      <div class="pc-foot"><button type="button" class="pc-link"></button><span class="pc-nav"><button type="button" class="pc-back">Back</button><button type="button" class="pc-got">Got it</button></span></div>
    </div>`;
  document.body.appendChild(root);

  const spotEl = root.querySelector('.pc-spot');
  const cardEl = root.querySelector('.pc-card');
  const kickerEl = root.querySelector('.pc-kicker');
  const countEl = root.querySelector('.pc-count');
  const barEl = root.querySelector('.pc-progress');
  const fillEl = barEl.querySelector('i');
  const backEl = root.querySelector('.pc-back');
  const titleEl = root.querySelector('.pc-title');
  const textEl = root.querySelector('.pc-text');
  const linkEl = root.querySelector('.pc-link');
  const gotEl = root.querySelector('.pc-got');

  const a = { root, spotEl, cardEl, steps, idx: -1, frame: 0, token: 0, home: new Map() };
  active = a;

  // Where the current step's target is right now (re-found if the page redrew).
  function currentTarget() {
    const step = steps[a.idx];
    if (!step) return null;
    if (step.kind === 'insight') {
      const el = findTarget(main, HEADING_SELECTORS);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const insets = readInsets();
      return r.bottom > insets.top && r.top < window.innerHeight * 0.7 ? el : null;
    }
    return findTarget(main, step.target);
  }

  function layout(animate) {
    root.classList.toggle('pc-snap', !animate);
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const insets = readInsets();
    const el = currentTarget();
    const spot = el ? spotRect(el.getBoundingClientRect(), vp, insets) : null;
    cardEl.style.width = `${Math.min(340, vp.w - 16)}px`;
    const place = placeCard({ spot, card: { w: Math.min(340, vp.w - 16), h: cardEl.offsetHeight }, viewport: vp, insets });
    if (spot) {
      Object.assign(spotEl.style, { top: `${spot.top}px`, left: `${spot.left}px`, width: `${spot.width}px`, height: `${spot.height}px`, opacity: '1' });
    } else {
      // No item to point at: an empty box in the middle still dims the page behind the card.
      Object.assign(spotEl.style, { top: `${vp.h / 2}px`, left: `${vp.w / 2}px`, width: '0px', height: '0px', opacity: '1' });
    }
    Object.assign(cardEl.style, { top: `${place.top}px`, left: `${place.left}px`, width: `${place.width}px` });
    cardEl.dataset.placement = place.placement;
    cardEl.style.setProperty('--pc-arrow-x', `${place.arrowX}px`);
  }

  // Scroll the target into the comfortable part of the screen (instantly, so the
  // spotlight is what glides, not the page).
  function bringIntoView(el) {
    const r = el.getBoundingClientRect();
    const insets = readInsets();
    const vh = window.innerHeight;
    // A target inside a sideways-scrolling row (e.g. phone filter bars) can sit off the
    // right edge; scroll that row, not the page, until it is in view.
    if (r.left < 0 || r.right > window.innerWidth) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }); } catch { /* old browser */ }
    }
    const r2 = el.getBoundingClientRect();
    const inside = r2.top >= insets.top + 8 && r2.bottom <= vh - insets.bottom - 8;
    if (inside) return;
    const avail = vh - insets.top - insets.bottom;
    const small = r2.height <= avail * 0.5;
    const wantTop = insets.top + (small ? Math.max(16, avail * 0.18) : 16);
    try { window.scrollBy({ top: r2.top - wantTop, behavior: 'instant' }); }
    catch { window.scrollBy(0, r2.top - wantTop); }
  }

  // Before the coach first switches a row of tabs, remember which tab was showing, so
  // Back can return to it (the first tab of a page has no step that opens it).
  function rememberHome(ctl) {
    const row = ctl && ctl.parentElement;
    if (!row) return;
    const key = cssPath(row);
    if (a.home.has(key)) return;
    const was = [...row.children].find(isActiveTab);
    if (was) a.home.set(key, cssPath(was));
  }

  // Re-open the tabs that were showing when the coach started. True if it clicked anything.
  function goHome() {
    let clicked = false;
    for (const path of a.home.values()) {
      try {
        const el = document.querySelector(path);
        if (el && !isActiveTab(el) && main.contains(el)) { el.click(); clicked = true; }
      } catch { /* the page changed shape */ }
    }
    return clicked;
  }

  // dir is +1 going forward and -1 going back (Back skips missing items the same way).
  function show(i, clicked = false, dir = 1) {
    if (!clicked) a.token += 1;       // a newer tap cancels a step still waiting for its tab to open
    const token = a.token;
    // A step whose item is in another tab opens that tab first, then looks again after a beat.
    // A step whose item has gone from the page since the coach started is skipped.
    while (i < steps.length && i > 0 && !findTarget(main, steps[i].target)) {
      if (!clicked) {
        let opened = false;
        if (steps[i].click) {
          try {
            const ctl = main.querySelector(steps[i].click);
            if (ctl) { rememberHome(ctl); ctl.click(); opened = true; }
          } catch { /* tab gone: fall through and skip */ }
        } else if (dir < 0) {
          opened = goHome();   // going back into the tab that was showing at the start
        }
        if (opened) {
          const at = i;
          setTimeout(() => { if (active === a && a.token === token) show(at, true, dir); }, 120);
          return;
        }
      }
      i += dir;
      clicked = false;
    }
    if (i >= steps.length) { stopPageCoach(); return; }
    if (i < 0) i = 0;
    a.idx = i;
    const step = steps[i];
    const last = i === steps.length - 1;
    const items = steps.length - 1;
    if (step.kind === 'item') { const el = findTarget(main, step.target); if (el) bringIntoView(el); }
    kickerEl.textContent = step.kind === 'insight' ? `${icon} ${label} \u00B7 Page insight` : `${icon} ${label}`;
    countEl.textContent = step.kind === 'item' ? `${i} / ${items}` : '';
    const pct = progressPercent(i, steps.length);
    fillEl.style.width = `${pct}%`;
    barEl.setAttribute('aria-valuenow', String(pct));
    backEl.hidden = i === 0;
    gotEl.textContent = last ? 'Done' : 'Got it';
    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    // Left button: skip the rest while there is more to see, or head back to the tour at the end.
    if (!last) { linkEl.textContent = 'Skip'; linkEl.dataset.act = 'skip'; linkEl.hidden = false; }
    else if (onBackToTour) { linkEl.textContent = 'Back to tour'; linkEl.dataset.act = 'tour'; linkEl.hidden = false; }
    else { linkEl.hidden = true; }
    layout(i > 0 || a.shownOnce);
    a.shownOnce = true;
    try { gotEl.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('.pc-got')) { show(a.idx + 1); return; }
    if (e.target.closest('.pc-back')) { if (a.idx > 0) show(a.idx - 1, false, -1); return; }
    const link = e.target.closest('.pc-link');
    if (link) {
      stopPageCoach();
      if (link.dataset.act === 'tour') onBackToTour?.();
      return;
    }
    if (e.target.classList.contains('pc-shield')) {
      // A tap beside the box does nothing to the page underneath; just point at the button.
      cardEl.classList.remove('pc-nudge');
      void cardEl.offsetWidth;
      cardEl.classList.add('pc-nudge');
    }
  });

  a.onMove = () => {
    if (a.frame) return;
    a.frame = requestAnimationFrame(() => { a.frame = 0; if (active === a) layout(false); });
  };
  a.onHash = () => stopPageCoach();
  a.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); stopPageCoach(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(a.idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (a.idx > 0) show(a.idx - 1, false, -1); }
  };
  window.addEventListener('resize', a.onMove);
  window.addEventListener('scroll', a.onMove, true);
  window.addEventListener('hashchange', a.onHash);
  document.addEventListener('keydown', a.onKey, true);

  show(0);
  requestAnimationFrame(() => root.classList.add('pc-in'));
  return true;
}
