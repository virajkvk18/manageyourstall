// @ts-check
// Visual library registry: merges every illustration batch into one lookup.
// Pure module (no DOM). UI code calls artSvg(id) to get an inline <svg> string.
import snacks from './art/snacks.mjs';
import mains from './art/mains.mjs';
import drinks from './art/drinks.mjs';
import sweets from './art/sweets.mjs';
import classic from './art/classic.mjs';

/** @typedef {{id: string, label: string, group: string, keywords: string[], svg: string}} ArtEntry */

export const ART_GROUPS = Object.freeze([
  { id: 'snacks', label: 'Street & crispy' },
  { id: 'mains', label: 'Fast food & mains' },
  { id: 'drinks', label: 'Drinks & fizz' },
  { id: 'sweets', label: 'Desserts' },
  { id: 'combos', label: 'Combos' },
  { id: 'games', label: 'Stall games' },
  { id: 'classic', label: 'Classic' },
]);

/** Ids every template and migration may rely on. Batches must provide all of them. */
export const REQUIRED_ART_IDS = Object.freeze({
  snacks: ['samosa', 'kachori', 'pani-puri', 'bhel-puri', 'aloo-tikki', 'crispy-corn', 'french-fries', 'peri-peri-fries', 'nachos', 'chips-packet'],
  mains: ['veg-pizza', 'cheese-pizza', 'burger', 'grilled-sandwich', 'steamed-momos', 'fried-momos', 'maggi', 'pav-bhaji', 'chole-bhature', 'frankie-roll'],
  drinks: ['masala-chai', 'kulhad-chai', 'hot-coffee', 'cold-coffee', 'cola-can', 'lime-can', 'orange-can', 'lemon-fizz', 'orange-fizz',
    'mint-mojito', 'milkshake', 'lassi'],
  sweets: ['brownie-sundae', 'gulab-jamun', 'kulfi'],
  combos: ['combo-snack-drink', 'combo-pizza-drink', 'combo-triple'],
  games: ['ring-toss', 'spin-wheel', 'dart-game', 'lucky-cup'],
  classic: ['packet', 'corn', 'pizza', 'lemon', 'masala', 'cold'],
});

/** Used whenever an id is unknown (e.g. a batch is missing an entry). */
export const FALLBACK_ART = 'packet';

/** @type {Record<string, ArtEntry>} */
export const ART = {};
for (const batch of [snacks, mains, drinks, sweets, classic]) {
  for (const [id, entry] of Object.entries(batch)) {
    if (!ART[id]) ART[id] = { id, label: entry.label, group: entry.group, keywords: entry.keywords || [], svg: entry.svg };
  }
}

/** Library entries in display order (grouped as ART_GROUPS). @type {ArtEntry[]} */
export const ART_LIST = ART_GROUPS.flatMap(g => Object.values(ART).filter(a => a.group === g.id));

/** @param {string} id */
export const hasArt = id => Object.prototype.hasOwnProperty.call(ART, id);

// ---- Sprite mode (browser performance) ------------------------------------------------------------------------------
// The UI re-renders #app with innerHTML on every change, so inlining every illustration made Sell/Menu renders
// 100 KB–1.6 MB of markup. In the browser, core.mjs injects artSprite() once (outside #app) and turns sprite mode on:
// artSvg/heroSvg then emit tiny <use href="#mys-art-…"> references. Off by default (Node, unit tests, exports) so the
// output is fully self-contained inline markup there.

/** Prefix of every sprite symbol id (`mys-art-<library id>`). */
export const SPRITE_PREFIX = 'mys-art-';

let spriteMode = false;

/**
 * Switch sprite mode: when on, artSvg/heroSvg reference the symbols injected by artSprite() instead of inlining markup.
 * Only turn it on once artSprite() is in the document.
 * @param {boolean} on
 */
export function useSprite(on) {
  spriteMode = Boolean(on);
}

/** True while sprite mode is on. */
export const spriteEnabled = () => spriteMode;

/** Library id an artSvg/heroSvg call actually draws (unknown ids → FALLBACK_ART). @param {unknown} id */
const artId = id => (typeof id === 'string' && hasArt(id) ? id : FALLBACK_ART);

/** `<use>` reference to one sprite symbol, drawn in its 150×150 box. @param {string} id a library id */
const spriteUse = id => `<use href="#${SPRITE_PREFIX}${id}" width="150" height="150"/>`;

/**
 * One hidden <svg> holding a <symbol id="mys-art-<id>" viewBox="0 0 150 150"> for every library illustration.
 * Insert it once into the document (outside the re-rendered app root) before turning on useSprite(true).
 * @returns {string}
 */
export function artSprite() {
  const symbols = Object.values(ART).map(a => `<symbol id="${SPRITE_PREFIX}${a.id}" viewBox="0 0 150 150">${a.svg}</symbol>`);
  return '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" ' +
    `focusable="false">${symbols.join('')}</svg>`;
}

/**
 * Inline SVG markup for a library illustration (150×150 viewBox, decorative). In sprite mode the illustration is a
 * `<use>` reference to its sprite symbol instead of inline markup (same rendering).
 * @param {string} id library id; unknown ids fall back to FALLBACK_ART
 * @param {string} [cls] class for the <svg> element
 * @returns {string}
 */
export function artSvg(id, cls = 'food-art') {
  const entry = ART[id] || ART[FALLBACK_ART];
  const body = spriteMode && entry ? spriteUse(entry.id) : (entry ? entry.svg : '');
  return `<svg class="${cls}" viewBox="0 0 150 150" aria-hidden="true" focusable="false"><ellipse cx="76" cy="136" rx="40" ry="5" fill="#171717" opacity=".12"/>${body}</svg>`;
}

/**
 * Where one illustration sits in a hero: its centre (x, y) in the 360×160 hero, rotation (degrees) and scale.
 * @typedef {{x: number, y: number, r: number, s: number}} HeroSlot
 */
/** A hero sparkle: centre, radius and fill. @typedef {[number, number, number, string]} HeroSparkle */

/**
 * Hero layouts by illustration count. `slots` are in draw order (the last one is in front); `order` maps slot → index in
 * the caller's left-to-right id list, so the middle id of three is drawn last and biggest.
 * @type {ReadonlyArray<{slots: HeroSlot[], order: number[], ground: number, sparkles: HeroSparkle[]}>}
 */
const HERO_LAYOUTS = [
  {
    slots: [],
    order: [],
    ground: 0,
    sparkles: [[96, 52, 14, '#ffdd35'], [180, 92, 22, '#ff4d87'], [264, 50, 13, '#ffffff'], [126, 122, 8, '#ffffff'],
      [244, 124, 10, '#ffdd35'], [312, 92, 7, '#ffffff']],
  },
  {
    slots: [{x: 180, y: 84, r: -4, s: 1.12}],
    order: [0],
    ground: 66,
    sparkles: [[96, 46, 11, '#ffdd35'], [266, 40, 9, '#ffffff'], [110, 122, 6, '#ffffff'], [258, 116, 8, '#ff4d87'],
      [56, 92, 5, '#ffffff']],
  },
  {
    slots: [{x: 134, y: 88, r: -8, s: 1.04}, {x: 226, y: 86, r: 7, s: 1.06}],
    order: [0, 1],
    ground: 120,
    sparkles: [[46, 50, 10, '#ffdd35'], [318, 44, 9, '#ffffff'], [180, 18, 6, '#ffffff'], [36, 116, 6, '#ffffff'],
      [326, 112, 7, '#ff4d87']],
  },
  {
    slots: [{x: 86, y: 96, r: -9, s: 0.9}, {x: 274, y: 96, r: 9, s: 0.9}, {x: 180, y: 85, r: -2, s: 1.1}],
    order: [0, 2, 1],
    ground: 150,
    sparkles: [[24, 36, 10, '#ffdd35'], [338, 30, 9, '#ffffff'], [130, 28, 6, '#ffffff'], [232, 22, 7, '#ffdd35'],
      [22, 128, 6, '#ffffff'], [340, 124, 6, '#ff4d87']],
  },
];

/**
 * Four-point sparkle star with an ink outline (house style, see art batches).
 * @param {HeroSparkle} sparkle
 */
function heroSparkle([x, y, r, fill]) {
  const k = Math.round(r * 2.2) / 10;
  const d = `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
    `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
  return `<path d="${d}" fill="${fill}" stroke="#171717" stroke-width="2" stroke-linejoin="round"/>`;
}

/**
 * Wide, decorative hero illustration (360×160 viewBox) composed from up to three library illustrations: slightly tilted,
 * overlapping, standing on one soft ground shadow, with 4–6 ink-outlined sparkles. Ids are read left to right; with three,
 * the middle one is drawn in front and biggest. Extra ids are ignored, unknown ids use FALLBACK_ART, and an empty list
 * gives a sparkles-only composition. No `id=` attributes, so any number of heroes can share a page.
 * @param {readonly string[] | null | undefined} artIds 0–3 library ids (theme.heroArt)
 * @param {{cls?: string}} [options] class for the <svg> element (default 'hero-art')
 * @returns {string}
 */
export function heroSvg(artIds, {cls = 'hero-art'} = {}) {
  const ids = (Array.isArray(artIds) ? artIds : []).slice(0, 3).map(artId);
  const layout = HERO_LAYOUTS[ids.length];
  const parts = [];
  if (layout.ground) {
    parts.push(`<ellipse cx="180" cy="148" rx="${layout.ground}" ry="7" fill="#171717" opacity=".14"/>`);
  }
  layout.slots.forEach((slot, i) => {
    const entry = ART[ids[layout.order[i]]];
    const body = spriteMode && entry ? spriteUse(entry.id) : (entry ? entry.svg : '');
    parts.push(`<g transform="translate(${slot.x} ${slot.y}) rotate(${slot.r}) scale(${slot.s})">` +
      `<g transform="translate(-75 -75)">${body}</g></g>`);
  });
  parts.push(`<g class="hero-sparkles">${layout.sparkles.map(heroSparkle).join('')}</g>`);
  const safeCls = String(cls).replace(/[^\w -]/g, '');
  return `<svg class="${safeCls}" viewBox="0 0 360 160" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

/**
 * Case-insensitive search across label, id, group and keywords.
 * @param {string} query
 * @param {string} [group] limit to a group id ('' = all)
 * @returns {ArtEntry[]}
 */
export function searchArt(query, group = '') {
  const q = String(query || '').trim().toLowerCase();
  return ART_LIST.filter(a => (!group || a.group === group) && (!q || [a.label, a.id, a.group, ...a.keywords].some(t => t.toLowerCase().includes(q))));
}
