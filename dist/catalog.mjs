// @ts-check
// Config (menu & settings) helpers for ManageYourStall. Pure module: no DOM, no storage.
//
// Every mutation helper changes the given config (or state) in place, validates its input and throws an Error with a short,
// owner-facing message when something is wrong. The UI calls these inside `commitConfig(st => …)`, so a throw rolls back the
// whole write. `validateConfig` deep-checks a complete Config (ARCHITECTURE.md §2 and §4).
import { uuid, money } from './util.mjs';
import {
  LIMITS, ID_RE, HEX_RE, DATE_RE, UPI_RE, MEDIA_RE, IMAGE_URL_RE,
  TINT_IDS, PATTERN_IDS, TAG_IDS, MILESTONE_TYPE_IDS, MAX_PRODUCTS, MAX_CATEGORIES,
  SPLIT_MODES, MISSION_MODES, MAX_MEMBERS,
} from './constants.mjs';

/**
 * @typedef {{id: string, name: string}} Category
 * @typedef {{productId: string, quantity: number}} BundlePart
 * @typedef {{
 *   id: string, name: string, subtitle: string, categoryId: string, size: string, price: number | null, priceLocked: boolean,
 *   art: string, image: string | null, tint: string, pattern: string, tags: string[], active: boolean, soldOut: boolean,
 *   customizable: boolean, stockKey: string, stockUnits: number, bundle: BundlePart[] | null
 * }} Product
 * @typedef {{id: string, name: string, price: number}} Addon
 * @typedef {{id: string, name: string, fee: number, art: string}} Game
 * @typedef {{id: string, label: string, type: 'flat' | 'percent', value: number, minimum: number, active: boolean}} DiscountRule
 * @typedef {{id: string, label: string, amount: number}} MissionItem
 * @typedef {{mode: 'ledger' | 'total' | 'itemized', total: number, items: MissionItem[]}} Mission
 * @typedef {{id: string, title: string, type: 'orders' | 'revenue' | 'recovery' | 'items' | 'games', target: number}} Milestone
 * @typedef {{
 *   stallName: string, booth: string, tagline: string, subTagline: string, eventName: string, venue: string, city: string,
 *   eventDate: string, ownerName: string, initials: string
 * }} Profile
 * @typedef {{
 *   accent: string, themeId?: string, secondary?: string, heroArt?: string[], heroTint?: string, heroPattern?: string,
 *   heroImage?: string | null
 * }} Theme  Phase-2 fields are optional only for Phase-1 configs that migrate() has not filled yet
 * @typedef {{id: string, name: string, color: string, share: number | null}} TeamMember
 * @typedef {{members: TeamMember[], splitMode: 'equal' | 'custom'}} Team
 * @typedef {{
 *   schema: 2, templateId: string, profile: Profile, theme: Theme, upi: {id: string, payeeName: string},
 *   operator: string, operators: string[], kitchenQueue: boolean, allowCustomDiscount: boolean, inventory: boolean,
 *   stock: Record<string, number>, categories: Category[], products: Product[], addons: Addon[], flavours: string[],
 *   games: Game[], discounts: DiscountRule[], mission: Mission, milestones: Milestone[], team?: Team
 * }} Config
 */

/** Size limits for config collections and numbers (beyond constants.LIMITS). */
export const CATALOG_LIMITS = Object.freeze({
  price: 100_000_000,            // ₹10,00,000 in paise (also the cap for fees, discounts, mission amounts)
  revenueTarget: 10_000_000_000, // ₹10,00,00,000 in paise
  countTarget: 1_000_000,
  recoveryTarget: 1000,          // percent
  stock: 1_000_000,
  stockUnits: 999,
  bundleQuantity: 99,
  addons: 40,
  flavours: 30,
  games: 30,
  discounts: 20,
  milestones: 40,
  missionItems: 30,
  operators: 20,
  stockPools: 60,
  art: 40,
  templateId: 40,
  members: MAX_MEMBERS,
  heroArt: 3,
});

/** Library art ids: lowercase slug, ≤40 chars (unknown ids render the fallback). */
export const ART_ID_RE = /^[a-z0-9-]{1,40}$/;

const PROFILE_FIELDS = /** @type {const} */ ([
  'stallName', 'booth', 'tagline', 'subTagline', 'eventName', 'venue', 'city', 'eventDate', 'ownerName', 'initials',
]);
const PROFILE_LABELS = {
  stallName: 'Stall name', booth: 'Booth', tagline: 'Tagline', subTagline: 'Sub-tagline', eventName: 'Event name',
  venue: 'Venue', city: 'City', eventDate: 'Event date', ownerName: 'Owner / team name', initials: 'Initials',
};

/** Max length of a profile field. @param {typeof PROFILE_FIELDS[number]} key */
const profileLimit = key => (key === 'eventDate' ? 10 : LIMITS[key]);

// ---------------------------------------------------------------------------------------------------------------------------
// small internals

/** @param {string} message @returns {never} */
const fail = message => {
  throw new Error(message);
};
/** Curly-quoted name for messages. @param {unknown} s */
const q = s => `“${String(s ?? '').trim()}”`;
/** Character count (code points, so emoji count once). @param {string} s */
const len = s => [...s].length;
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} n @param {number} min @param {number} max @returns {n is number} */
const isInt = (n, min, max) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
/** @param {number} n */
const num = n => n.toLocaleString('en-IN');
/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** “A”, “A” and “B”, “A”, “B” and “C”. @param {string[]} names */
const listNames = names => {
  const quoted = names.map(q);
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
};
/** @param {string} s */
const lower = s => s.trim().toLocaleLowerCase('en-IN');
/** @param {unknown} v */
const isArt = v => typeof v === 'string' && ART_ID_RE.test(v);
/** @param {string} s */
const isRealDate = s => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Trim and validate a piece of owner-typed text.
 * @param {unknown} value
 * @param {{label: string, max: number, required?: string}} opts `required` = message when blank
 * @returns {string}
 */
function cleanText(value, { label, max, required = '' }) {
  if (value == null) value = '';
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const s = value.trim();
  if (required && !s) fail(required);
  if (len(s) > max) fail(`${label} can be at most ${max} characters.`);
  return s;
}

/** @param {unknown} v @param {string} message @returns {boolean} */
function bool(v, message) {
  if (typeof v !== 'boolean') fail(message);
  return /** @type {boolean} */ (v);
}

/** @param {unknown} dir */
function checkDir(dir) {
  if (dir !== -1 && dir !== 1) fail('Move up or down by one step.');
}

/**
 * Swap an item with its neighbour in a list (no-op at the ends).
 * @template {{id: string}} T
 * @param {T[]} list @param {string} id @param {number} dir @param {string} missing
 */
function moveInList(list, id, dir, missing) {
  checkDir(dir);
  const i = list.findIndex(x => x.id === id);
  if (i < 0) fail(missing);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

/**
 * Pick the id for a saved record: keep it when it already exists in `list`, else a new uuid.
 * @param {{id: string}[]} list @param {unknown} id
 */
const keepOrNewId = (list, id) => (typeof id === 'string' && list.some(x => x.id === id) ? id : newId());

/** @param {Config} c @param {string} id */
function findProduct(c, id) {
  const p = c.products.find(x => x.id === id);
  if (!p) fail('That item no longer exists.');
  return /** @type {Product} */ (p);
}

/** @param {Config} c @param {string} id */
function findCategory(c, id) {
  const cat = c.categories.find(x => x.id === id);
  if (!cat) fail('That category no longer exists.');
  return /** @type {Category} */ (cat);
}

/** Insert a product after the last product of its category (or at the end). @param {Product[]} products @param {Product} p */
function insertInCategory(products, p) {
  const last = products.findLastIndex(x => x.categoryId === p.categoryId);
  if (last < 0) products.push(p);
  else products.splice(last + 1, 0, p);
}

/** Message for a price outside the allowed range. @param {string} name */
const priceMessage = name => `Enter a valid price for ${q(name || 'this item')} (₹0 to ${money(CATALOG_LIMITS.price)}).`;

// ---------------------------------------------------------------------------------------------------------------------------
// ids, mission, milestones

/** @returns {string} a fresh uuid usable as any config id */
export function newId() {
  return uuid();
}

/**
 * The owner's planned investment (break-even before bills). 0 in 'ledger' mode, where the break-even is Σ bills (§16.1).
 * @param {Config} c
 * @returns {number} paise
 */
export function missionTarget(c) {
  const m = c?.mission;
  if (!m || m.mode === 'ledger') return 0;
  if (m.mode === 'itemized') {
    return (Array.isArray(m.items) ? m.items : []).reduce((n, i) => n + (Number.isSafeInteger(i?.amount) ? i.amount : 0), 0);
  }
  return Number.isSafeInteger(m.total) ? m.total : 0;
}

/**
 * Round a paise amount to a "nice" rupee figure (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8 × a power of ten).
 * @param {number} p paise
 * @returns {number} paise
 */
export function niceAmount(p) {
  const rupees = p / 100;
  if (!(rupees >= 1)) return 100;
  const mag = 10 ** Math.floor(Math.log10(rupees));
  let best = mag;
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) {
    if (Math.abs(step * mag - rupees) < Math.abs(best - rupees)) best = step * mag;
  }
  return Math.round(best) * 100;
}

/**
 * A fresh milestone list (new ids) scaled to the stall (§13.5).
 * @param {Config} c
 * @returns {Milestone[]}
 */
export function autoMilestones(c) {
  const investment = missionTarget(c);
  const stretch = Math.min(CATALOG_LIMITS.revenueTarget, Math.max(1_000_000, niceAmount(investment * 2)));
  /** @type {Milestone[]} */
  const list = [
    { id: newId(), title: 'First sale', type: 'orders', target: 1 },
    { id: newId(), title: `${money(100_000)} Club`, type: 'revenue', target: 100_000 },
    { id: newId(), title: 'Crowd magnet', type: 'orders', target: 25 },
    { id: newId(), title: 'Halfway there', type: 'recovery', target: 50 },
    { id: newId(), title: 'Break-even boss', type: 'recovery', target: 100 },
    { id: newId(), title: `${money(stretch)} Dhamaka`, type: 'revenue', target: stretch },
  ];
  if (Array.isArray(c?.games) && c.games.length) list.push({ id: newId(), title: 'Game on', type: 'games', target: 1 });
  return list;
}

// ---------------------------------------------------------------------------------------------------------------------------
// validateConfig

/**
 * @param {unknown} list
 * @param {string} what plural noun for messages ("categories")
 * @param {number} max
 * @returns {any[]}
 */
function checkCollection(list, what, max) {
  if (!Array.isArray(list)) fail(`The ${what} list is missing or damaged.`);
  const arr = /** @type {any[]} */ (list);
  if (arr.length > max) fail(`You can have at most ${max} ${what}.`);
  const seen = new Set();
  for (const x of arr) {
    if (!isObj(x)) fail(`One of the ${what} is damaged.`);
    if (typeof x.id !== 'string' || !ID_RE.test(x.id)) fail(`One of the ${what} has an invalid id.`);
    if (seen.has(x.id)) fail(`Two ${what} share the id ${q(x.id)}.`);
    seen.add(x.id);
  }
  return arr;
}

/**
 * Validate stored text (not trimmed in place).
 * @param {unknown} v @param {number} max @param {string} what @param {boolean} [required]
 */
function checkText(v, max, what, required = false) {
  if (typeof v !== 'string') fail(`${what} must be text.`);
  const s = /** @type {string} */ (v);
  if (required && !s.trim()) fail(`${what} can't be blank.`);
  if (len(s) > max) fail(`${what} can be at most ${max} characters.`);
}

/** @param {unknown} v @param {string} what */
function checkBool(v, what) {
  if (typeof v !== 'boolean') fail(`${what} must be on or off.`);
}

/** @param {any} p @param {Set<string>} catIds @param {Map<string, any>} byId @param {Record<string, number>} stock */
function checkProduct(p, catIds, byId, stock) {
  const label = typeof p.name === 'string' && p.name.trim() ? q(p.name) : 'An item';
  checkText(p.name, LIMITS.productName, `${label}: name`, true);
  checkText(p.subtitle, LIMITS.subtitle, `${label}: subtitle`);
  checkText(p.size, LIMITS.size, `${label}: size`);
  if (typeof p.categoryId !== 'string' || !catIds.has(p.categoryId)) fail(`${label} is in a category that doesn't exist.`);
  if (p.price !== null && !isInt(p.price, 0, CATALOG_LIMITS.price)) fail(priceMessage(p.name));
  checkBool(p.priceLocked, `${label}: price lock`);
  if (!isArt(p.art)) fail(`${label} has an invalid picture id.`);
  if (p.image !== null) {
    const ok = typeof p.image === 'string'
      && (MEDIA_RE.test(p.image) || (IMAGE_URL_RE.test(p.image) && p.image.length <= LIMITS.imageUrl));
    if (!ok) fail(`${label} has an invalid image link.`);
  }
  if (!TINT_IDS.includes(p.tint)) fail(`${label} has an unknown card colour.`);
  if (!PATTERN_IDS.includes(p.pattern)) fail(`${label} has an unknown card pattern.`);
  if (!Array.isArray(p.tags)) fail(`${label}: tags are damaged.`);
  if (p.tags.some(t => !TAG_IDS.includes(t))) fail(`${label} has an unknown tag.`);
  if (new Set(p.tags).size !== p.tags.length) fail(`${label} lists a tag twice.`);
  checkBool(p.active, `${label}: visible`);
  checkBool(p.soldOut, `${label}: sold out`);
  checkBool(p.customizable, `${label}: customizable`);
  if (typeof p.stockKey !== 'string' || (p.stockKey !== '' && !Object.hasOwn(stock, p.stockKey))) {
    fail(`${label} uses a stock pool that doesn't exist.`);
  }
  if (!isInt(p.stockUnits, 1, CATALOG_LIMITS.stockUnits)) fail(`${label}: units per sale must be 1 to ${CATALOG_LIMITS.stockUnits}.`);
  if (p.bundle !== null) {
    if (!Array.isArray(p.bundle) || !p.bundle.length) fail(`Combo ${label} needs at least one item.`);
    const seen = new Set();
    for (const part of p.bundle) {
      if (!isObj(part)) fail(`Combo ${label} is damaged.`);
      const component = byId.get(part.productId);
      if (!component) fail(`Combo ${label} includes an item that no longer exists.`);
      if (component.bundle !== null) fail(`Combo ${label} can't include another combo (${q(component.name)}).`);
      if (seen.has(part.productId)) fail(`Combo ${label} lists ${q(component.name)} twice.`);
      seen.add(part.productId);
      if (!isInt(part.quantity, 1, CATALOG_LIMITS.bundleQuantity)) {
        fail(`Combo ${label}: quantity of ${q(component.name)} must be 1 to ${CATALOG_LIMITS.bundleQuantity}.`);
      }
    }
  }
}

/** @param {any} d */
function checkDiscount(d) {
  const label = typeof d.label === 'string' && d.label.trim() ? q(d.label) : 'A discount';
  checkText(d.label, LIMITS.discountLabel, `${label}: label`, true);
  if (d.type === 'flat') {
    if (!isInt(d.value, 1, CATALOG_LIMITS.price)) fail(`${label}: the amount off must be at least ₹0.01.`);
  } else if (d.type === 'percent') {
    if (!isInt(d.value, 1, 100)) fail(`${label}: percent off must be a whole number from 1 to 100.`);
  } else {
    fail(`${label} has an unknown discount type.`);
  }
  if (!isInt(d.minimum, 0, CATALOG_LIMITS.price)) fail(`${label} has an invalid minimum order.`);
  checkBool(d.active, `${label}: active`);
}

/** @param {any} m */
function checkMilestone(m) {
  const label = typeof m.title === 'string' && m.title.trim() ? q(m.title) : 'A milestone';
  checkText(m.title, LIMITS.milestoneTitle, `${label}: title`, true);
  if (!MILESTONE_TYPE_IDS.includes(m.type)) fail(`${label} has an unknown type.`);
  const max = m.type === 'revenue' ? CATALOG_LIMITS.revenueTarget
    : m.type === 'recovery' ? CATALOG_LIMITS.recoveryTarget : CATALOG_LIMITS.countTarget;
  if (!isInt(m.target, 1, max)) fail(`${label} has an invalid target.`);
}

/**
 * Deep validation of a whole Config: types, text limits, references and uniqueness (§2, §4).
 * @template T
 * @param {T} c
 * @returns {T} the same object
 */
export function validateConfig(c) {
  if (!isObj(c)) fail('Stall settings are missing or damaged.');
  const cfg = /** @type {any} */ (c);
  if (cfg.schema !== 2) fail('Stall settings are in an unknown format.');
  if (typeof cfg.templateId !== 'string' || !ID_RE.test(cfg.templateId) || cfg.templateId.length > CATALOG_LIMITS.templateId) {
    fail('Stall settings have an invalid template id.');
  }

  // profile, theme, upi, team, switches
  if (!isObj(cfg.profile)) fail('Stall profile is missing.');
  for (const key of PROFILE_FIELDS) checkText(cfg.profile[key], profileLimit(key), PROFILE_LABELS[key], key === 'stallName');
  if (cfg.profile.eventDate !== '' && !isRealDate(cfg.profile.eventDate)) fail('Event date must be a real date (YYYY-MM-DD).');
  if (!isObj(cfg.theme) || typeof cfg.theme.accent !== 'string' || !HEX_RE.test(cfg.theme.accent)) {
    fail('Accent colour must look like #FFDD35.');
  }
  checkTheme(cfg.theme);
  if (!isObj(cfg.upi)) fail('UPI settings are missing.');
  checkText(cfg.upi.id, LIMITS.upiId, 'UPI ID');
  if (cfg.upi.id !== '' && !UPI_RE.test(cfg.upi.id)) fail('UPI ID should look like name@bank.');
  checkText(cfg.upi.payeeName, LIMITS.payeeName, 'UPI payee name');
  if (!Array.isArray(cfg.operators) || !cfg.operators.length) fail('Add at least one team member.');
  if (cfg.operators.length > CATALOG_LIMITS.operators) fail(`You can have at most ${CATALOG_LIMITS.operators} team members.`);
  for (const name of cfg.operators) checkText(name, LIMITS.operator, 'Team member name', true);
  if (new Set(cfg.operators).size !== cfg.operators.length) fail('A team member is listed twice.');
  checkText(cfg.operator, LIMITS.operator, 'Current cashier', true);
  checkBool(cfg.kitchenQueue, 'Kitchen queue');
  checkBool(cfg.allowCustomDiscount, 'Custom discount');
  checkBool(cfg.inventory, 'Stock tracking');

  // stock pools
  if (!isObj(cfg.stock)) fail('Stock room data is damaged.');
  const pools = Object.entries(cfg.stock);
  if (pools.length > CATALOG_LIMITS.stockPools) fail(`You can have at most ${CATALOG_LIMITS.stockPools} stock pools.`);
  for (const [key, n] of pools) {
    // '__proto__' matches ID_RE but can't be stored as a plain record key, so it is refused.
    if (!ID_RE.test(key) || key === '__proto__') fail(`Stock pool ${q(key)} has an invalid name.`);
    if (!isInt(n, 0, CATALOG_LIMITS.stock)) fail(`Stock for ${q(key)} must be a whole number from 0 to ${num(CATALOG_LIMITS.stock)}.`);
  }

  // categories
  const categories = checkCollection(cfg.categories, 'categories', MAX_CATEGORIES);
  if (!categories.length) fail('Keep at least one category.');
  const catNames = new Set();
  /** @type {Set<string>} (a Set, so ids like "toString" can't match Object.prototype) */
  const catIds = new Set();
  for (const cat of categories) {
    checkText(cat.name, LIMITS.categoryName, 'Category name', true);
    const key = lower(cat.name);
    if (catNames.has(key)) fail(`There are two categories called ${q(cat.name)}.`);
    catNames.add(key);
    catIds.add(cat.id);
  }

  // products
  const products = checkCollection(cfg.products, 'items', MAX_PRODUCTS);
  const byId = new Map(products.map(p => [p.id, p]));
  for (const p of products) checkProduct(p, catIds, byId, cfg.stock);

  // add-ons & flavours
  const addons = checkCollection(cfg.addons, 'add-ons', CATALOG_LIMITS.addons);
  for (const a of addons) {
    checkText(a.name, LIMITS.addonName, 'Add-on name', true);
    if (!isInt(a.price, 0, CATALOG_LIMITS.price)) fail(`Add-on ${q(a.name)} has an invalid price.`);
  }
  if (!Array.isArray(cfg.flavours)) fail('The flavour list is damaged.');
  if (cfg.flavours.length > CATALOG_LIMITS.flavours) fail(`You can have at most ${CATALOG_LIMITS.flavours} flavours.`);
  for (const f of cfg.flavours) checkText(f, LIMITS.flavour, 'Flavour', true);
  if (new Set(cfg.flavours).size !== cfg.flavours.length) fail('A flavour is listed twice.');

  // games
  const games = checkCollection(cfg.games, 'games', CATALOG_LIMITS.games);
  for (const g of games) {
    checkText(g.name, LIMITS.gameName, 'Game name', true);
    if (!isInt(g.fee, 0, CATALOG_LIMITS.price)) fail(`Game ${q(g.name)} has an invalid fee.`);
    if (!isArt(g.art)) fail(`Game ${q(g.name)} has an invalid picture id.`);
  }

  // discounts
  for (const d of checkCollection(cfg.discounts, 'discounts', CATALOG_LIMITS.discounts)) checkDiscount(d);

  // mission
  const m = cfg.mission;
  if (!isObj(m)) fail('Mission settings are missing.');
  if (!MISSION_MODES.includes(m.mode)) fail('Mission must be from your bills, a total or an itemized list.');
  if (!isInt(m.total, 0, CATALOG_LIMITS.price)) fail('Mission total must be between ₹0 and ' + money(CATALOG_LIMITS.price) + '.');
  for (const item of checkCollection(m.items, 'mission items', CATALOG_LIMITS.missionItems)) {
    checkText(item.label, LIMITS.missionLabel, 'Mission item name', true);
    if (!isInt(item.amount, 0, CATALOG_LIMITS.price)) fail(`Mission item ${q(item.label)} has an invalid amount.`);
  }

  // milestones
  for (const ms of checkCollection(cfg.milestones, 'milestones', CATALOG_LIMITS.milestones)) checkMilestone(ms);

  // team (Phase 2; absent only on a Phase-1 config that migrate() has not filled yet)
  if (cfg.team !== undefined) checkTeam(cfg.team);
  return c;
}

/** Image reference: 'media:<id>' or an https URL. @param {unknown} v */
const isImageRef = v => typeof v === 'string' && (MEDIA_RE.test(v) || (IMAGE_URL_RE.test(v) && v.length <= LIMITS.imageUrl));

/**
 * Phase-2 theme fields. Each one is checked when present (migrate() fills them all on real data).
 * @param {Record<string, any>} t
 */
function checkTheme(t) {
  if (t.themeId !== undefined && !(t.themeId === 'custom' || (typeof t.themeId === 'string' && ID_RE.test(t.themeId)
    && t.themeId.length <= CATALOG_LIMITS.templateId))) {
    fail('The stall theme id is invalid.');
  }
  if (t.secondary !== undefined && !(typeof t.secondary === 'string' && HEX_RE.test(t.secondary))) {
    fail('Second colour must look like #FF4D87.');
  }
  if (t.heroArt !== undefined) {
    if (!Array.isArray(t.heroArt) || t.heroArt.length > CATALOG_LIMITS.heroArt) fail(`Pick up to ${CATALOG_LIMITS.heroArt} hero pictures.`);
    if (!t.heroArt.every(isArt)) fail('A hero picture has an invalid id.');
  }
  if (t.heroTint !== undefined && !TINT_IDS.includes(t.heroTint)) fail('The hero background colour is unknown.');
  if (t.heroPattern !== undefined && !PATTERN_IDS.includes(t.heroPattern)) fail('The hero background pattern is unknown.');
  if (t.heroImage !== undefined && t.heroImage !== null && !isImageRef(t.heroImage)) fail('The stall photo has an invalid image link.');
}

/**
 * Team settings: at most MAX_MEMBERS partners with unique names (case-insensitive) and tint colours; shares are null or
 * whole percents 0–100. Custom shares that do not add up to 100 are *allowed* here — adding or removing a partner in custom
 * mode must not make the whole config unsavable. setShares/saveTeam refuse such shares, and teamSettlement warns and
 * splits the profit equally until they are fixed.
 * @param {unknown} team
 */
function checkTeam(team) {
  if (!isObj(team)) fail('Team settings are damaged.');
  const t = /** @type {Record<string, any>} */ (team);
  if (!SPLIT_MODES.includes(t.splitMode)) fail('Profit split must be equal or custom.');
  const members = checkCollection(t.members, 'team partners', CATALOG_LIMITS.members);
  const names = new Set();
  for (const m of members) {
    checkText(m.name, LIMITS.memberName, 'Partner name', true);
    const key = lower(m.name);
    if (names.has(key)) fail(`There are two partners called ${q(m.name)}.`);
    names.add(key);
    if (!TINT_IDS.includes(m.color)) fail(`${q(m.name)} has an unknown colour.`);
    if (m.share !== null && !isInt(m.share, 0, 100)) fail(`${q(m.name)}'s share must be a whole percent from 0 to 100.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// products

/**
 * Build a complete, validated Product from editor data (does not insert it).
 * Missing fields come from `existing` (when updating) or the §2 defaults.
 * @param {Config} c
 * @param {Partial<Product> & Record<string, any>} data
 * @param {Product | null} [existing]
 * @returns {Product}
 */
export function normalizeProduct(c, data, existing = null) {
  if (!isObj(data)) fail('Item details are missing.');
  /** @param {string} key @param {any} fallback */
  const pick = (key, fallback) => (data[key] !== undefined ? data[key] : existing ? existing[key] : fallback);

  const name = cleanText(pick('name', ''), { label: 'Item name', max: LIMITS.productName, required: 'Give this item a name.' });
  const subtitle = cleanText(pick('subtitle', ''), { label: 'Subtitle', max: LIMITS.subtitle });
  const size = cleanText(pick('size', ''), { label: 'Size', max: LIMITS.size });
  const categoryId = pick('categoryId', c.categories[0]?.id);
  if (typeof categoryId !== 'string' || !c.categories.some(x => x.id === categoryId)) fail('Pick a category for this item.');

  const price = pick('price', null);
  if (price !== null && !isInt(price, 0, CATALOG_LIMITS.price)) fail(priceMessage(name));
  const priceLocked = bool(pick('priceLocked', false), 'Price lock must be on or off.');
  if (existing && existing.priceLocked && priceLocked && price !== existing.price) {
    fail(`Unlock ${q(existing.name)} to change its price.`);
  }

  // combo components
  const rawBundle = pick('bundle', null);
  /** @type {BundlePart[] | null} */
  let bundle = null;
  if (rawBundle !== null) {
    if (!Array.isArray(rawBundle) || !rawBundle.length) fail('Add at least one item to this combo.');
    bundle = [];
    for (const part of rawBundle) {
      if (!isObj(part)) fail('Add at least one item to this combo.');
      const component = c.products.find(x => x.id === part.productId);
      if (!component || (existing && component.id === existing.id)) fail('A combo item no longer exists. Pick it again.');
      if (component.bundle !== null) fail(`A combo can't include another combo (${q(component.name)}).`);
      if (bundle.some(b => b.productId === component.id)) fail(`${q(component.name)} is listed twice. Change its quantity instead.`);
      if (!isInt(part.quantity, 1, CATALOG_LIMITS.bundleQuantity)) {
        fail(`Quantity of ${q(component.name)} must be 1 to ${CATALOG_LIMITS.bundleQuantity}.`);
      }
      bundle.push({ productId: component.id, quantity: part.quantity });
    }
    if (existing) {
      const users = c.products.filter(x => x.bundle?.some(b => b.productId === existing.id));
      if (users.length) fail(`${q(existing.name)} is part of ${listNames(users.map(x => x.name))}, so it can't become a combo.`);
    }
  }

  const art = pick('art', bundle ? 'combo-snack-drink' : 'chips-packet');
  if (!isArt(art)) fail('Pick a picture for this item.');
  let image = pick('image', null);
  if (typeof image === 'string') image = image.trim() || null;
  if (image !== null) {
    if (typeof image !== 'string') fail('Use an https:// image link or upload a photo.');
    const ok = MEDIA_RE.test(image) || (IMAGE_URL_RE.test(image) && image.length <= LIMITS.imageUrl);
    if (!ok) fail('Use an https:// image link or upload a photo.');
  }
  const tint = pick('tint', 'yellow');
  if (!TINT_IDS.includes(tint)) fail('Pick a card colour.');
  const pattern = pick('pattern', 'none');
  if (!PATTERN_IDS.includes(pattern)) fail('Pick a card pattern.');
  const rawTags = pick('tags', []);
  if (!Array.isArray(rawTags)) fail('Tags must be a list.');
  for (const t of rawTags) if (!TAG_IDS.includes(t)) fail(`Unknown tag ${q(t)}.`);
  const tags = [...new Set(/** @type {string[]} */ (rawTags))];

  const active = bool(pick('active', true), 'Visible must be on or off.');
  const soldOut = bool(pick('soldOut', false), 'Sold out must be on or off.');
  const customizable = bool(pick('customizable', false), 'Customizable must be on or off.');
  const stockKey = bundle ? '' : pick('stockKey', '');
  if (typeof stockKey !== 'string' || (stockKey !== '' && !Object.hasOwn(c.stock, stockKey))) fail('Pick a stock pool that exists.');
  const stockUnits = pick('stockUnits', 1);
  if (!isInt(stockUnits, 1, CATALOG_LIMITS.stockUnits)) fail(`Units per sale must be a whole number from 1 to ${CATALOG_LIMITS.stockUnits}.`);

  return {
    id: existing ? existing.id : newId(),
    name, subtitle, categoryId, size, price, priceLocked, art, image, tint, pattern, tags, active, soldOut,
    customizable: bundle ? false : customizable,
    stockKey, stockUnits, bundle,
  };
}

/**
 * Create or update a product. Unknown/missing id → new product appended after its category's last item.
 * Changing the category moves the item to the end of its new category.
 * @param {Config} c
 * @param {Partial<Product> & Record<string, any>} data
 * @returns {Product}
 */
export function saveProduct(c, data) {
  const existing = isObj(data) && typeof data.id === 'string' ? c.products.find(p => p.id === data.id) || null : null;
  if (!existing && c.products.length >= MAX_PRODUCTS) fail(`You can have at most ${MAX_PRODUCTS} items. Delete one first.`);
  const product = normalizeProduct(c, data, existing);
  if (!existing) {
    insertInCategory(c.products, product);
  } else {
    const i = c.products.indexOf(existing);
    if (existing.categoryId === product.categoryId) {
      c.products[i] = product;
    } else {
      c.products.splice(i, 1);
      insertInCategory(c.products, product);
    }
  }
  return product;
}

/**
 * Copy a product as "Name (copy)" right after the original (new id, price unlocked).
 * @param {Config} c @param {string} id
 * @returns {Product}
 */
export function duplicateProduct(c, id) {
  const original = findProduct(c, id);
  if (c.products.length >= MAX_PRODUCTS) fail(`You can have at most ${MAX_PRODUCTS} items. Delete one first.`);
  const taken = new Set(c.products.map(p => lower(p.name)));
  let name = '';
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const base = [...original.name].slice(0, LIMITS.productName - len(suffix)).join('').trimEnd();
    name = base + suffix;
    if (!taken.has(lower(name))) break;
  }
  /** @type {Product} */
  const copy = { ...structuredClone(original), id: newId(), name, priceLocked: false };
  c.products.splice(c.products.indexOf(original) + 1, 0, copy);
  return copy;
}

/**
 * Delete a product. Refuses when a combo uses it; strips it from both carts (live and practice).
 * @param {{config: Config, live?: {draft: any[]}, demo?: {draft: any[]}}} state
 * @param {string} id
 */
export function deleteProduct(state, id) {
  const c = state.config;
  const product = findProduct(c, id);
  const combos = c.products.filter(p => p.bundle?.some(b => b.productId === id));
  if (combos.length) {
    fail(`${listNames(combos.map(p => p.name))} ${combos.length === 1 ? 'uses' : 'use'} ${q(product.name)}. `
      + `Remove it from ${combos.length === 1 ? 'that combo' : 'those combos'} first.`);
  }
  c.products.splice(c.products.indexOf(product), 1);
  for (const s of [state.live, state.demo]) {
    if (s && Array.isArray(s.draft)) s.draft = s.draft.filter(line => line.productId !== id);
  }
}

/**
 * Swap a product with the previous/next product of the SAME category (no-op at the ends).
 * @param {Config} c @param {string} id @param {-1 | 1} dir
 */
export function moveProduct(c, id, dir) {
  checkDir(dir);
  const p = findProduct(c, id);
  const same = c.products.filter(x => x.categoryId === p.categoryId);
  const neighbour = same[same.indexOf(p) + dir];
  if (!neighbour) return;
  const i = c.products.indexOf(p);
  const j = c.products.indexOf(neighbour);
  [c.products[i], c.products[j]] = [c.products[j], c.products[i]];
}

/** Mark a product sold out (or back in stock). @param {Config} c @param {string} id @param {boolean} soldOut */
export function setSoldOut(c, id, soldOut) {
  const p = findProduct(c, id);
  p.soldOut = bool(soldOut, 'Sold out must be on or off.');
}

/** Show or hide a product on the Sell menu. @param {Config} c @param {string} id @param {boolean} active */
export function setActive(c, id, active) {
  const p = findProduct(c, id);
  p.active = bool(active, 'Visible must be on or off.');
}

/**
 * Batch price update. Locked items may only "change" to their current price.
 * @param {Config} c
 * @param {Record<string, number | null>} prices product id → paise | null
 */
export function setPrices(c, prices) {
  if (!isObj(prices)) fail('No prices to save.');
  const updates = Object.entries(prices).map(([id, price]) => {
    const p = findProduct(c, id);
    if (price !== null && !isInt(price, 0, CATALOG_LIMITS.price)) fail(priceMessage(p.name));
    if (p.priceLocked && price !== p.price) fail(`Unlock ${q(p.name)} to change its price.`);
    return /** @type {[Product, number | null]} */ ([p, price]);
  });
  for (const [p, price] of updates) p.price = price;
}

/**
 * Lock or unlock prices.
 * @param {Config} c @param {string[] | 'all'} ids @param {boolean} locked
 */
export function setPriceLock(c, ids, locked) {
  bool(locked, 'Price lock must be on or off.');
  if (ids !== 'all' && !Array.isArray(ids)) fail('Pick the items to lock.');
  const targets = ids === 'all' ? c.products : ids.map(id => findProduct(c, id));
  for (const p of targets) p.priceLocked = locked;
}

// ---------------------------------------------------------------------------------------------------------------------------
// categories

/**
 * @param {Config} c @param {unknown} name @param {string | null} ignoreId
 * @returns {string} cleaned name
 */
function categoryName(c, name, ignoreId) {
  const clean = cleanText(name, { label: 'Category name', max: LIMITS.categoryName, required: 'Give this category a name.' });
  const clash = c.categories.find(x => x.id !== ignoreId && lower(x.name) === lower(clean));
  if (clash) fail(`There's already a category called ${q(clash.name)}.`);
  return clean;
}

/**
 * Add a category at the end.
 * @param {Config} c @param {{name: string}} data
 * @returns {Category}
 */
export function addCategory(c, { name } = /** @type {any} */ ({})) {
  if (c.categories.length >= MAX_CATEGORIES) fail(`You can have at most ${MAX_CATEGORIES} categories.`);
  const category = { id: newId(), name: categoryName(c, name, null) };
  c.categories.push(category);
  return category;
}

/** @param {Config} c @param {string} id @param {string} name */
export function renameCategory(c, id, name) {
  const cat = findCategory(c, id);
  cat.name = categoryName(c, name, id);
}

/** Swap a category with its neighbour (no-op at the ends). @param {Config} c @param {string} id @param {-1 | 1} dir */
export function moveCategory(c, id, dir) {
  moveInList(c.categories, id, dir, 'That category no longer exists.');
}

/**
 * Delete a category. A non-empty category needs `moveTo` (another existing category); its items move to the end of that one.
 * @param {Config} c @param {string} id @param {{moveTo?: string | null}} [opts]
 */
export function deleteCategory(c, id, { moveTo = null } = {}) {
  const cat = findCategory(c, id);
  if (c.categories.length <= 1) fail('Keep at least one category.');
  const items = c.products.filter(p => p.categoryId === id);
  if (items.length) {
    if (moveTo == null || moveTo === '') {
      fail(`${q(cat.name)} still has ${plural(items.length, 'item')}. Move ${items.length === 1 ? 'it' : 'them'} to another category first.`);
    }
    if (moveTo === id) fail('Pick a different category to move the items to.');
    findCategory(c, /** @type {string} */ (moveTo));
    c.products = c.products.filter(p => p.categoryId !== id);
    for (const p of items) {
      p.categoryId = /** @type {string} */ (moveTo);
      insertInCategory(c.products, p);
    }
  }
  c.categories.splice(c.categories.indexOf(cat), 1);
}

// ---------------------------------------------------------------------------------------------------------------------------
// add-ons, flavours, stock

/**
 * Replace the add-on list. Existing ids are kept; new entries get fresh ids.
 * @param {Config} c @param {{id?: string, name: string, price: number}[]} addons
 */
export function saveAddons(c, addons) {
  if (!Array.isArray(addons)) fail('Add-ons must be a list.');
  if (addons.length > CATALOG_LIMITS.addons) fail(`You can have at most ${CATALOG_LIMITS.addons} add-ons.`);
  /** @type {Addon[]} */
  const next = [];
  for (const a of addons) {
    if (!isObj(a)) fail('Give this add-on a name.');
    const name = cleanText(a.name, { label: 'Add-on name', max: LIMITS.addonName, required: 'Give this add-on a name.' });
    if (next.some(x => lower(x.name) === lower(name))) fail(`${q(name)} is listed twice.`);
    if (!isInt(a.price, 0, CATALOG_LIMITS.price)) fail(`Enter a valid price for ${q(name)} (₹0 for free).`);
    let id = keepOrNewId(c.addons, a.id);
    if (next.some(x => x.id === id)) id = newId();
    next.push({ id, name, price: a.price });
  }
  c.addons = next;
}

/**
 * Replace the flavour list: trims, drops blanks and repeats (case-insensitive), ≤40 chars each, ≤30 items.
 * @param {Config} c @param {string[]} flavours
 */
export function saveFlavours(c, flavours) {
  if (!Array.isArray(flavours)) fail('Flavours must be a list.');
  /** @type {string[]} */
  const next = [];
  for (const f of flavours) {
    const clean = cleanText(f, { label: 'Flavour', max: LIMITS.flavour });
    if (clean && !next.some(x => lower(x) === lower(clean))) next.push(clean);
  }
  if (next.length > CATALOG_LIMITS.flavours) fail(`You can have at most ${CATALOG_LIMITS.flavours} flavours.`);
  c.flavours = next;
}

/**
 * Add a stock pool (starts at 0 units). The key is a slug of the name ("Small packets" → "small-packets").
 * @param {Config} c @param {string} name
 * @returns {string} the new key
 */
export function addStockPool(c, name) {
  const clean = cleanText(name, { label: 'Stock pool name', max: 40, required: 'Give this stock pool a name.' });
  const key = clean.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!key) fail('Use letters or numbers in the stock pool name.');
  if (Object.keys(c.stock).some(k => k.toLowerCase() === key)) fail(`There's already a stock pool called ${q(key)}.`);
  if (Object.keys(c.stock).length >= CATALOG_LIMITS.stockPools) fail(`You can have at most ${CATALOG_LIMITS.stockPools} stock pools.`);
  c.stock[key] = 0;
  return key;
}

/** Delete a stock pool that no product uses. @param {Config} c @param {string} key */
export function deleteStockPool(c, key) {
  if (typeof key !== 'string' || !Object.hasOwn(c.stock, key)) fail('That stock pool no longer exists.');
  const users = c.products.filter(p => p.stockKey === key);
  if (users.length) {
    const shown = users.slice(0, 3).map(p => p.name);
    const more = users.length > 3 ? ` and ${plural(users.length - 3, 'more item')}` : '';
    fail(`${shown.map(q).join(', ')}${more} ${users.length === 1 ? 'uses' : 'use'} ${q(key)}. Change ${users.length === 1 ? 'its' : 'their'} stock pool first.`);
  }
  delete c.stock[key];
}

/**
 * Save stock settings. Totals of existing pools may not go below what is already used.
 * @param {Config} c
 * @param {Record<string, number>} used units used per pool (domain.stockUsed(session))
 * @param {{inventory?: boolean, stock?: Record<string, number>}} data
 */
export function saveStock(c, used, { inventory, stock } = {}) {
  if (inventory !== undefined) bool(inventory, 'Stock tracking must be on or off.');
  if (stock !== undefined) {
    if (!isObj(stock)) fail('Stock totals are missing.');
    for (const [key, n] of Object.entries(stock)) {
      if (!Object.hasOwn(c.stock, key)) fail(`There's no stock pool called ${q(key)}. Add it first.`);
      if (!isInt(n, 0, CATALOG_LIMITS.stock)) fail(`Stock for ${q(key)} must be a whole number from 0 to ${num(CATALOG_LIMITS.stock)}.`);
      const u = (isObj(used) && Number.isSafeInteger(used[key]) && used[key]) || 0;
      if (n !== c.stock[key] && n < u) fail(`${num(u)} of ${q(key)} already sold or reserved. Stock can't go below ${num(u)}.`);
    }
    Object.assign(c.stock, stock);
  }
  if (inventory !== undefined) c.inventory = inventory;
}

// ---------------------------------------------------------------------------------------------------------------------------
// discounts

/**
 * Create or update a discount rule (new rules go to the end).
 * @param {Config} c @param {Partial<DiscountRule>} data
 * @returns {DiscountRule}
 */
export function saveDiscount(c, data) {
  if (!isObj(data)) fail('Discount details are missing.');
  const existing = c.discounts.find(d => d.id === data.id) || null;
  if (!existing && c.discounts.length >= CATALOG_LIMITS.discounts) fail(`You can have at most ${CATALOG_LIMITS.discounts} discounts.`);
  /** @param {string} key @param {any} fallback */
  const pick = (key, fallback) => (data[key] !== undefined ? data[key] : existing ? existing[key] : fallback);
  const label = cleanText(pick('label', ''), { label: 'Discount label', max: LIMITS.discountLabel, required: 'Give this discount a label.' });
  const type = pick('type', 'flat');
  if (type !== 'flat' && type !== 'percent') fail('Pick ₹ off or % off.');
  const value = pick('value', 0);
  if (type === 'flat' && !isInt(value, 1, CATALOG_LIMITS.price)) fail(`Enter how much to take off (₹0.01 to ${money(CATALOG_LIMITS.price)}).`);
  if (type === 'percent' && !isInt(value, 1, 100)) fail('Percent off must be a whole number from 1 to 100.');
  const minimum = pick('minimum', 0);
  if (!isInt(minimum, 0, CATALOG_LIMITS.price)) fail('Enter a valid minimum order (₹0 for none).');
  const active = bool(pick('active', true), 'Active must be on or off.');
  /** @type {DiscountRule} */
  const rule = { id: existing ? existing.id : newId(), label, type, value, minimum, active };
  if (existing) c.discounts[c.discounts.indexOf(existing)] = rule;
  else c.discounts.push(rule);
  return rule;
}

/** @param {Config} c @param {string} id */
export function deleteDiscount(c, id) {
  const i = c.discounts.findIndex(d => d.id === id);
  if (i < 0) fail('That discount no longer exists.');
  c.discounts.splice(i, 1);
}

/** @param {Config} c @param {string} id @param {-1 | 1} dir */
export function moveDiscount(c, id, dir) {
  moveInList(c.discounts, id, dir, 'That discount no longer exists.');
}

/** Show or hide the "Custom ₹/% off" chip at checkout. @param {Config} c @param {boolean} on */
export function setAllowCustomDiscount(c, on) {
  c.allowCustomDiscount = bool(on, 'Custom discount must be on or off.');
}

// ---------------------------------------------------------------------------------------------------------------------------
// mission & milestones

/**
 * Save the break-even mission. Items are kept in every mode (switching back restores them); in 'ledger' mode the break-even
 * is Σ bills and the items are only quick-add suggestions for bills.
 * @param {Config} c
 * @param {{mode?: 'ledger' | 'total' | 'itemized', total?: number, items?: {id?: string, label: string, amount: number}[]}} data
 */
export function saveMission(c, { mode, total, items } = {}) {
  const nextMode = mode ?? c.mission.mode;
  if (!MISSION_MODES.includes(nextMode)) fail('Pick From my bills, Total or Itemized.');
  const nextTotal = total ?? c.mission.total;
  if (!isInt(nextTotal, 0, CATALOG_LIMITS.price)) fail(`Enter a valid investment (₹0 to ${money(CATALOG_LIMITS.price)}).`);
  /** @type {MissionItem[]} */
  let nextItems = c.mission.items;
  if (items !== undefined) {
    if (!Array.isArray(items)) fail('Mission items must be a list.');
    if (items.length > CATALOG_LIMITS.missionItems) fail(`You can have at most ${CATALOG_LIMITS.missionItems} mission items.`);
    nextItems = [];
    for (const item of items) {
      if (!isObj(item)) fail('Name this cost (e.g. Stall rent).');
      const label = cleanText(item.label, { label: 'Cost name', max: LIMITS.missionLabel, required: 'Name this cost (e.g. Stall rent).' });
      if (!isInt(item.amount, 0, CATALOG_LIMITS.price)) fail(`Enter a valid amount for ${q(label)}.`);
      let id = keepOrNewId(c.mission.items, item.id);
      if (nextItems.some(x => x.id === id)) id = newId();
      nextItems.push({ id, label, amount: item.amount });
    }
  }
  c.mission = { mode: nextMode, total: nextTotal, items: nextItems };
}

/**
 * @param {Partial<Milestone>} data @param {Milestone | null} existing @param {string} id
 * @returns {Milestone}
 */
function normalizeMilestone(data, existing, id) {
  if (!isObj(data)) fail('Milestone details are missing.');
  /** @param {string} key @param {any} fallback */
  const pick = (key, fallback) => (data[key] !== undefined ? data[key] : existing ? existing[key] : fallback);
  const title = cleanText(pick('title', ''), { label: 'Milestone title', max: LIMITS.milestoneTitle, required: 'Give this milestone a title.' });
  const type = pick('type', 'orders');
  if (!MILESTONE_TYPE_IDS.includes(type)) fail('Pick what this milestone counts.');
  const target = pick('target', 0);
  if (type === 'revenue' && !isInt(target, 1, CATALOG_LIMITS.revenueTarget)) {
    fail(`Money target must be ₹0.01 to ${money(CATALOG_LIMITS.revenueTarget)}.`);
  }
  if (type === 'recovery' && !isInt(target, 1, CATALOG_LIMITS.recoveryTarget)) {
    fail(`Recovery target must be a whole percent from 1 to ${CATALOG_LIMITS.recoveryTarget}.`);
  }
  if (type !== 'revenue' && type !== 'recovery' && !isInt(target, 1, CATALOG_LIMITS.countTarget)) {
    fail(`Target must be a whole number from 1 to ${num(CATALOG_LIMITS.countTarget)}.`);
  }
  return { id, title, type, target };
}

/**
 * Create or update a milestone (new ones go to the end).
 * @param {Config} c @param {Partial<Milestone>} data
 * @returns {Milestone}
 */
export function saveMilestone(c, data) {
  const existing = (isObj(data) && c.milestones.find(m => m.id === data.id)) || null;
  if (!existing && c.milestones.length >= CATALOG_LIMITS.milestones) fail(`You can have at most ${CATALOG_LIMITS.milestones} milestones.`);
  const m = normalizeMilestone(data, existing, existing ? existing.id : newId());
  if (existing) c.milestones[c.milestones.indexOf(existing)] = m;
  else c.milestones.push(m);
  return m;
}

/** @param {Config} c @param {string} id */
export function deleteMilestone(c, id) {
  const i = c.milestones.findIndex(m => m.id === id);
  if (i < 0) fail('That milestone no longer exists.');
  c.milestones.splice(i, 1);
}

/** @param {Config} c @param {string} id @param {-1 | 1} dir */
export function moveMilestone(c, id, dir) {
  moveInList(c.milestones, id, dir, 'That milestone no longer exists.');
}

/**
 * Replace every milestone (e.g. with `autoMilestones(c)`). Valid unique ids are kept; others get new ids.
 * @param {Config} c @param {Partial<Milestone>[]} list
 */
export function replaceMilestones(c, list) {
  if (!Array.isArray(list)) fail('Milestones must be a list.');
  if (list.length > CATALOG_LIMITS.milestones) fail(`You can have at most ${CATALOG_LIMITS.milestones} milestones.`);
  /** @type {Milestone[]} */
  const next = [];
  for (const data of list) {
    const ok = isObj(data) && typeof data.id === 'string' && ID_RE.test(data.id) && !next.some(m => m.id === data.id);
    next.push(normalizeMilestone(data, null, ok ? /** @type {string} */ (data.id) : newId()));
  }
  c.milestones = next;
}

// ---------------------------------------------------------------------------------------------------------------------------
// games

/**
 * Create or update a game (new ones go to the end). Recorded plays keep their own snapshots.
 * @param {Config} c @param {Partial<Game>} data
 * @returns {Game}
 */
export function saveGame(c, data) {
  if (!isObj(data)) fail('Game details are missing.');
  const existing = c.games.find(g => g.id === data.id) || null;
  if (!existing && c.games.length >= CATALOG_LIMITS.games) fail(`You can have at most ${CATALOG_LIMITS.games} games.`);
  /** @param {string} key @param {any} fallback */
  const pick = (key, fallback) => (data[key] !== undefined ? data[key] : existing ? existing[key] : fallback);
  const name = cleanText(pick('name', ''), { label: 'Game name', max: LIMITS.gameName, required: 'Give this game a name.' });
  const fee = pick('fee', 0);
  if (!isInt(fee, 0, CATALOG_LIMITS.price)) fail(`Enter a valid fee for ${q(name)} (₹0 for free).`);
  const art = pick('art', 'spin-wheel');
  if (!isArt(art)) fail('Pick a picture for this game.');
  /** @type {Game} */
  const game = { id: existing ? existing.id : newId(), name, fee, art };
  if (existing) c.games[c.games.indexOf(existing)] = game;
  else c.games.push(game);
  return game;
}

/** @param {Config} c @param {string} id */
export function deleteGame(c, id) {
  const i = c.games.findIndex(g => g.id === id);
  if (i < 0) fail('That game no longer exists.');
  c.games.splice(i, 1);
}

// ---------------------------------------------------------------------------------------------------------------------------
// profile, look, UPI, team

/**
 * Update some profile fields (other keys are ignored). Text is trimmed and length-checked.
 * @param {Config} c @param {Partial<Profile>} partial
 */
export function saveProfile(c, partial) {
  if (!isObj(partial)) fail('Profile details are missing.');
  /** @type {Partial<Profile>} */
  const next = {};
  for (const key of PROFILE_FIELDS) {
    if (partial[key] === undefined) continue;
    const required = key === 'stallName' ? 'Give your stall a name.' : '';
    const value = cleanText(partial[key], { label: PROFILE_LABELS[key], max: profileLimit(key), required });
    if (key === 'eventDate' && value !== '' && !isRealDate(value)) fail('Pick a real event date.');
    next[key] = value;
  }
  Object.assign(c.profile, next);
}

/**
 * Update some theme fields (keys left `undefined` are kept). Colours are '#RRGGBB' (stored uppercase); heroArt is up to 3
 * library ids; heroImage is null, 'media:<id>' or an https URL; themeId is a template id or 'custom'.
 * @param {Config} c @param {Partial<Theme>} partial
 */
export function saveTheme(c, partial = /** @type {any} */ ({})) {
  if (!isObj(partial)) fail('Theme details are missing.');
  /** @type {Record<string, any>} */
  const next = { ...c.theme };
  /** @param {unknown} v @param {string} example */
  const colour = (v, example) => {
    const value = typeof v === 'string' ? v.trim() : '';
    if (!HEX_RE.test(value)) fail(`Pick a colour like ${example}.`);
    return value.toUpperCase();
  };
  if (partial.accent !== undefined) next.accent = colour(partial.accent, '#FFDD35');
  if (partial.secondary !== undefined) next.secondary = colour(partial.secondary, '#FF4D87');
  if (partial.themeId !== undefined) {
    const id = typeof partial.themeId === 'string' ? partial.themeId.trim() : '';
    if (!(id === 'custom' || (ID_RE.test(id) && id.length <= CATALOG_LIMITS.templateId))) fail('Pick a stall theme.');
    next.themeId = id;
  }
  if (partial.heroArt !== undefined) {
    if (!Array.isArray(partial.heroArt)) fail('Hero pictures must be a list.');
    if (partial.heroArt.length > CATALOG_LIMITS.heroArt) fail(`Pick up to ${CATALOG_LIMITS.heroArt} hero pictures.`);
    if (!partial.heroArt.every(isArt)) fail('Pick hero pictures from the library.');
    next.heroArt = [...partial.heroArt];
  }
  if (partial.heroTint !== undefined) {
    if (!TINT_IDS.includes(partial.heroTint)) fail('Pick a hero background colour.');
    next.heroTint = partial.heroTint;
  }
  if (partial.heroPattern !== undefined) {
    if (!PATTERN_IDS.includes(partial.heroPattern)) fail('Pick a hero background pattern.');
    next.heroPattern = partial.heroPattern;
  }
  if (partial.heroImage !== undefined) {
    const img = typeof partial.heroImage === 'string' ? partial.heroImage.trim() : partial.heroImage;
    if (img !== null && img !== '' && !isImageRef(img)) {
      fail('That stall photo link doesn’t look right. Use an https:// image link or upload a photo.');
    }
    next.heroImage = img || null;
  }
  if (typeof next.accent !== 'string' || !HEX_RE.test(next.accent)) fail('Pick a colour like #FFDD35.');
  c.theme = /** @type {Theme} */ (next);
}

/**
 * Save UPI details. An empty id disables the UPI QR.
 * @param {Config} c @param {{id?: string, payeeName?: string}} data
 */
export function saveUpi(c, { id = '', payeeName = '' } = {}) {
  const upiId = cleanText(id, { label: 'UPI ID', max: LIMITS.upiId });
  if (upiId && !UPI_RE.test(upiId)) fail('That UPI ID doesn’t look right. It should look like name@okaxis.');
  const payee = cleanText(payeeName, { label: 'Payee name', max: LIMITS.payeeName });
  c.upi = { id: upiId, payeeName: payee };
}

/**
 * Save the team list and/or the current cashier (who must be on the list).
 * @param {Config} c @param {{operators?: string[], operator?: string}} data
 */
export function saveOperators(c, { operators, operator } = {}) {
  let list = c.operators;
  if (operators !== undefined) {
    if (!Array.isArray(operators)) fail('Team members must be a list.');
    list = [];
    for (const name of operators) {
      const clean = cleanText(name, { label: 'Team member name', max: LIMITS.operator });
      if (!clean) continue;
      if (list.some(x => lower(x) === lower(clean))) fail(`${q(clean)} is listed twice.`);
      list.push(clean);
    }
    if (!list.length) fail('Add at least one team member.');
    if (list.length > CATALOG_LIMITS.operators) fail(`You can have at most ${CATALOG_LIMITS.operators} team members.`);
  }
  let current;
  if (operator !== undefined) {
    const clean = cleanText(operator, { label: 'Cashier name', max: LIMITS.operator, required: 'Pick who is on the counter.' });
    current = list.find(x => lower(x) === lower(clean));
    if (!current) fail(`${q(clean)} isn't on the team list. Add them first.`);
  } else {
    current = list.find(x => x === c.operator) || list[0];
  }
  c.operators = list;
  c.operator = current;
}

/** Turn the kitchen queue on (new orders start 'preparing') or off. @param {Config} c @param {boolean} on */
export function setKitchenQueue(c, on) {
  c.kitchenQueue = bool(on, 'Kitchen queue must be on or off.');
}

// ---------------------------------------------------------------------------------------------------------------------------
// team (partners who fund the stall and split the profit, §16.4)

/** The config's team, created on first use for configs that predate Phase 2. @param {Config} c @returns {Team} */
function teamOf(c) {
  if (!isObj(c.team)) c.team = { members: [], splitMode: 'equal' };
  return /** @type {Team} */ (c.team);
}

/** @param {Config} c @param {string} id */
function findMember(c, id) {
  const m = teamOf(c).members.find(x => x.id === id);
  if (!m) fail('That partner is no longer on the team.');
  return /** @type {TeamMember} */ (m);
}

/** @param {Team} team @param {unknown} name @param {string} [ignoreId] */
function memberName(team, name, ignoreId) {
  const clean = cleanText(name, { label: 'Partner name', max: LIMITS.memberName, required: 'Give this partner a name.' });
  if (team.members.some(m => m.id !== ignoreId && lower(m.name) === lower(clean))) fail(`${q(clean)} is already on the team.`);
  return clean;
}

/** @param {unknown} color */
function memberColor(color) {
  if (!TINT_IDS.includes(/** @type {string} */ (color))) fail('Pick a colour for this partner.');
  return /** @type {string} */ (color);
}

/** First tint not used by another partner (cycles when all are taken). @param {Team} team */
function nextColor(team) {
  const used = new Set(team.members.map(m => m.color));
  return TINT_IDS.find(t => !used.has(t)) || TINT_IDS[team.members.length % TINT_IDS.length];
}

/**
 * Custom shares must be whole percents 0–100 that add up to exactly 100.
 * @param {{name: string, share: number | null}[]} members
 */
function checkCustomShares(members) {
  if (!members.length) return;
  let sum = 0;
  for (const m of members) {
    if (!isInt(m.share, 0, 100)) fail(`Give ${q(m.name)} a whole-number share from 0 to 100%.`);
    sum += /** @type {number} */ (m.share);
  }
  if (sum !== 100) fail(`Shares add up to ${sum}%. Make them add up to 100%.`);
}

/**
 * Equal whole percents (earlier partners get the spare 1%): 3 partners → [34, 33, 33].
 * @param {number} n
 * @returns {number[]}
 */
export function equalShares(n) {
  if (!(n > 0)) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

/**
 * Replace the whole team (Studio › Team "Save"). Members keep their ids when `id` matches an existing partner; new ones get
 * fresh ids and a free colour. Custom mode requires whole-percent shares that add up to 100.
 * Use `removeMember` (not this) to drop a single partner: only it can check the ledgers for their bills and contri.
 * @param {Config} c
 * @param {{members?: {id?: string, name: string, color?: string, share?: number | null}[], splitMode?: 'equal' | 'custom'}} data
 * @returns {Team}
 */
export function saveTeam(c, { members, splitMode } = {}) {
  const team = teamOf(c);
  const mode = splitMode ?? team.splitMode;
  if (!SPLIT_MODES.includes(mode)) fail('Pick Equal or Custom split.');
  /** @type {TeamMember[]} */
  let list = team.members;
  if (members !== undefined) {
    if (!Array.isArray(members)) fail('Team partners must be a list.');
    if (members.length > CATALOG_LIMITS.members) fail(`You can have at most ${CATALOG_LIMITS.members} partners.`);
    /** @type {Team} */
    const draft = { members: [], splitMode: mode };
    for (const data of members) {
      if (!isObj(data)) fail('Give this partner a name.');
      const name = memberName(draft, data.name);
      let id = keepOrNewId(team.members, data.id);
      if (draft.members.some(x => x.id === id)) id = newId();
      const color = data.color === undefined ? nextColor(draft) : memberColor(data.color);
      const share = data.share === undefined || data.share === null ? null : data.share;
      if (share !== null && !isInt(share, 0, 100)) fail(`Give ${q(name)} a whole-number share from 0 to 100%.`);
      draft.members.push({ id, name, color, share });
    }
    list = draft.members;
  }
  if (mode === 'custom') checkCustomShares(list);
  c.team = { members: list, splitMode: mode };
  return c.team;
}

/**
 * Add a partner (≤ MAX_MEMBERS, unique name). In custom split mode the newcomer starts at a 0% share.
 * @param {Config} c @param {{name: string, color?: string}} data
 * @returns {TeamMember}
 */
export function addMember(c, { name, color } = /** @type {any} */ ({})) {
  const team = teamOf(c);
  if (team.members.length >= CATALOG_LIMITS.members) fail(`You can have at most ${CATALOG_LIMITS.members} partners.`);
  /** @type {TeamMember} */
  const m = {
    id: newId(),
    name: memberName(team, name),
    color: color === undefined ? nextColor(team) : memberColor(color),
    share: team.splitMode === 'custom' ? 0 : null,
  };
  team.members.push(m);
  return m;
}

/** @param {Config} c @param {string} id @param {string} name */
export function renameMember(c, id, name) {
  const m = findMember(c, id);
  m.name = memberName(teamOf(c), name, id);
}

/** @param {Config} c @param {string} id @param {string} color TINT id */
export function setMemberColor(c, id, color) {
  findMember(c, id).color = memberColor(color);
}

/**
 * Remove a partner. Refused while they have bills (paidBy) or contri that are not voided in either ledger — rename them
 * instead, so the settlement keeps crediting the right person.
 * @param {{config: Config, live?: any, demo?: any}} state
 * @param {string} id
 */
export function removeMember(state, id) {
  const c = state.config;
  const m = findMember(c, id);
  for (const mode of /** @type {const} */ (['live', 'demo'])) {
    const s = state[mode];
    if (!s) continue;
    const bills = (Array.isArray(s.expenses) ? s.expenses : []).some(e => e && !e.void && e.paidBy === id);
    const contri = (Array.isArray(s.contributions) ? s.contributions : []).some(x => x && !x.void && x.memberId === id);
    if (bills || contri) {
      const where = mode === 'demo' ? ' in the practice ledger' : '';
      fail(`${q(m.name)} has ${bills ? 'bills' : 'contri'} recorded${where}. Rename them instead, or void those entries first.`);
    }
  }
  const team = teamOf(c);
  team.members = team.members.filter(x => x.id !== id);
}

/**
 * Switch between an equal split and custom shares. Switching to custom when the current shares don't add up to 100 starts
 * everyone on equal whole percents (34/33/33) so the config stays valid.
 * @param {Config} c @param {'equal' | 'custom'} mode
 */
export function setSplitMode(c, mode) {
  if (!SPLIT_MODES.includes(mode)) fail('Pick Equal or Custom split.');
  const team = teamOf(c);
  if (mode === 'custom') {
    const valid = team.members.every(m => isInt(m.share, 0, 100))
      && team.members.reduce((n, m) => n + /** @type {number} */ (m.share), 0) === 100;
    if (!valid) {
      const shares = equalShares(team.members.length);
      team.members.forEach((m, i) => { m.share = shares[i]; });
    }
  }
  team.splitMode = mode;
}

/**
 * Set custom shares: `{[memberId]: percent}`. Partners not listed keep their current share (null counts as 0). The result
 * must be whole percents that add up to exactly 100. Does not change the split mode.
 * @param {Config} c @param {Record<string, number>} shares
 */
export function setShares(c, shares) {
  if (!isObj(shares)) fail('Shares are missing.');
  const team = teamOf(c);
  for (const id of Object.keys(shares)) if (!team.members.some(m => m.id === id)) fail('That partner is no longer on the team.');
  const next = team.members.map(m => ({ name: m.name, share: Object.hasOwn(shares, m.id) ? shares[m.id] : m.share ?? 0 }));
  checkCustomShares(next);
  team.members.forEach((m, i) => { m.share = next[i].share; });
}
