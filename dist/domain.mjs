// @ts-check
// ManageYourStall ledger & reports — the financial source of truth.
// Contract: ARCHITECTURE.md §2 (data model + invariants), §3 (API), §13.4 (day report), §14 (v1 → v2 migration),
// §16.1–§16.3 (Phase 2: bills ledger, team contri, settlement, stall themes).
// Pure module: no DOM, no storage. Money is integer paise everywhere; time is ISO UTC, grouped by India time.
import {uuid, money, paise, integer, istDate, istHour, istStamp, slug, tokenLabel, clamp} from './util.mjs';
import {
  BRAND, SCHEMA_VERSION, CHECKOUT_METHODS, PAYMENT_METHODS, ORDER_STATUSES, KITCHEN_STATUSES,
  LIMITS, MAX_QUANTITY, ID_RE, DATE_RE, HEX_RE, MEDIA_RE, TINT_IDS, PATTERN_IDS,
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_IDS, LEGACY_EXPENSE_CATEGORIES, EXPENSE_METHODS, DRAWER,
} from './constants.mjs';
import {validateConfig, missionTarget, CATALOG_LIMITS} from './catalog.mjs';
import {TEMPLATES, buildTemplate} from './templates.mjs';

// Re-exported for modules (and older callers) that import money helpers from the ledger.
export {uuid, money, paise, integer};

// ---------------------------------------------------------------------------------------------------------------------
// Types (ARCHITECTURE.md §2)
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {number} Paise integer paise (₹1 = 100) */
/** @typedef {string} ISO ISO-8601 UTC timestamp */
/** @typedef {'Cash'|'UPI'|'Other'} PaymentMethod */
/** @typedef {'Cash'|'UPI'|'Split'|'Other'} CheckoutMethod */
/** @typedef {'paid'|'partial'|'refunded'|'void'|'pending'} OrderStatus */
/** @typedef {'preparing'|'ready'|'handed'} KitchenStatus */

/**
 * @typedef {object} Profile
 * @property {string} stallName
 * @property {string} booth
 * @property {string} tagline
 * @property {string} subTagline
 * @property {string} eventName
 * @property {string} venue
 * @property {string} city
 * @property {string} eventDate 'YYYY-MM-DD' or ''
 * @property {string} ownerName
 * @property {string} initials
 */
/** @typedef {{id: string, name: string}} Category */
/** @typedef {{productId: string, quantity: number}} BundlePart */
/**
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} subtitle
 * @property {string} categoryId
 * @property {string} size
 * @property {Paise|null} price null = not sellable yet
 * @property {boolean} priceLocked
 * @property {string} art
 * @property {string|null} image
 * @property {string} tint
 * @property {string} pattern
 * @property {string[]} tags
 * @property {boolean} active
 * @property {boolean} soldOut
 * @property {boolean} customizable
 * @property {string} stockKey
 * @property {number} stockUnits
 * @property {BundlePart[]|null} bundle
 */
/** @typedef {{id: string, name: string, price: Paise}} Addon */
/** @typedef {{id: string, name: string, fee: Paise, art: string}} Game */
/**
 * @typedef {object} DiscountRule
 * @property {string} id
 * @property {string} label
 * @property {'flat'|'percent'} type
 * @property {number} value flat: paise ≥1; percent: 1–100
 * @property {Paise} minimum
 * @property {boolean} active
 */
/**
 * 'ledger' (Phase 2 default): break-even = Σ bills, `items` are only quick-add bill suggestions.
 * 'total' / 'itemized' (planned): break-even = planned investment + Σ bills.
 * @typedef {{mode: 'ledger'|'total'|'itemized', total: Paise, items: {id: string, label: string, amount: Paise}[]}} Mission
 */
/** @typedef {{id: string, title: string, type: 'orders'|'revenue'|'recovery'|'items'|'games', target: number}} Milestone */
/**
 * @typedef {object} Config
 * @property {2} schema
 * @property {string} templateId
 * @property {Profile} profile
 * @property {Theme} theme
 * @property {{id: string, payeeName: string}} upi
 * @property {string} operator
 * @property {string[]} operators
 * @property {boolean} kitchenQueue
 * @property {boolean} allowCustomDiscount
 * @property {boolean} inventory
 * @property {Record<string, number>} stock
 * @property {Category[]} categories
 * @property {Product[]} products
 * @property {Addon[]} addons
 * @property {string[]} flavours
 * @property {Game[]} games
 * @property {DiscountRule[]} discounts
 * @property {Mission} mission
 * @property {Milestone[]} milestones
 * @property {Team} [team] always present after migrate(); optional so Phase-1 configs still type-check
 */
/**
 * @typedef {object} Theme
 * @property {string} accent '#RRGGBB'
 * @property {string} [themeId] template id the look came from, or 'custom'
 * @property {string} [secondary] '#RRGGBB'
 * @property {string[]} [heroArt] 0–3 library art ids
 * @property {string} [heroTint] TINT id
 * @property {string} [heroPattern] PATTERN id
 * @property {string|null} [heroImage] 'media:<id>' | 'https://…' | null
 */
/** @typedef {{id: string, name: string, color: string, share: number|null}} TeamMember */
/** @typedef {{members: TeamMember[], splitMode: 'equal'|'custom'}} Team */
/**
 * @typedef {object} Line immutable price snapshot
 * @property {string} id
 * @property {string} productId
 * @property {string} name
 * @property {string} category category NAME snapshot
 * @property {string} size
 * @property {string} flavour
 * @property {Addon[]} addons
 * @property {number} quantity
 * @property {Paise} unitPrice
 * @property {Paise} lineTotal
 * @property {Record<string, number>} stock units per 1 quantity, by stock key
 * @property {BundlePart[]|null} bundle
 * @property {string} note
 */
/** @typedef {{id: string|null, label: string, type: 'flat'|'percent', value: number}} DiscountInfo */
/** @typedef {{id: string|null, label: string, type: 'flat'|'percent', value: number, minimum: Paise}} ResolvedDiscount */
/**
 * Draft discount choice: `{ruleId}` for a configured rule or `{custom: true, type, value}`.
 * @typedef {{ruleId?: string, custom?: boolean, type?: 'flat'|'percent', value?: number}} DiscountSpec
 */
/** @typedef {{Cash: Paise, UPI: Paise}} SplitParts */
/**
 * @typedef {object} Order
 * @property {string} id
 * @property {number} number
 * @property {number|null} token
 * @property {string|null} tokenDay
 * @property {ISO} at
 * @property {string} operator
 * @property {Line[]} items
 * @property {Paise} subtotal
 * @property {Paise} discount
 * @property {Paise} total
 * @property {DiscountInfo|null} discountInfo
 * @property {string} note
 * @property {CheckoutMethod} method
 * @property {SplitParts|null} split
 * @property {OrderStatus} status
 * @property {KitchenStatus} kitchen
 * @property {{preparing?: ISO, ready?: ISO, handed?: ISO}} kitchenAt
 * @property {Paise|null} cashReceived
 * @property {Paise} change
 */
/**
 * @typedef {object} Payment ledger row
 * @property {string} id
 * @property {string} entityId order or game play id
 * @property {'order'|'game'|'refund'} kind
 * @property {Paise} amount negative for refunds
 * @property {PaymentMethod} method
 * @property {ISO} at
 */
/**
 * @typedef {object} GamePlay
 * @property {string} id
 * @property {string} gameId
 * @property {string} name
 * @property {Paise} fee
 * @property {string} prize
 * @property {PaymentMethod} method
 * @property {string} operator
 * @property {ISO} at
 * @property {boolean} void
 */
/** @typedef {'pre-stall'|'restock'|'rent'|'packaging'|'decor'|'misc'} ExpenseCategory */
/**
 * A bill in the expense ledger (§16.1). Voided bills stay for audit and are excluded from every total.
 * @typedef {object} Expense
 * @property {string} id
 * @property {ISO} at
 * @property {string} operator
 * @property {string} title 1–80 chars
 * @property {ExpenseCategory} category
 * @property {Paise} amount ≥1
 * @property {'Cash'|'UPI'} method
 * @property {string} paidBy team member id or 'drawer' (an unknown id = a removed member, counted as drawer)
 * @property {string|null} billImage 'media:<id>' photo of the bill
 * @property {string} notes ≤500
 * @property {boolean} void
 * @property {string} [voidReason]
 * @property {ISO} [voidAt]
 */
/**
 * Money a partner put into the stall pool ("contri").
 * @typedef {object} Contribution
 * @property {string} id
 * @property {ISO} at
 * @property {string} operator
 * @property {string} memberId
 * @property {Paise} amount ≥1
 * @property {'Cash'|'UPI'} method
 * @property {string} note ≤120
 * @property {boolean} void
 * @property {string} [voidReason]
 * @property {ISO} [voidAt]
 */
/**
 * @typedef {object} SettlementMember
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {number} sharePct profit share in percent (equal: 100/n rounded to 2 decimals)
 * @property {Paise} contri
 * @property {Paise} bills bills this partner paid from their pocket
 * @property {Paise} capital contri + bills
 * @property {number} capitalPct share of all capital, percent (2 decimals)
 * @property {Paise} recovery capital paid back (step 1)
 * @property {Paise} profitShare profit share (step 2)
 * @property {Paise} payout recovery + profitShare
 */
/**
 * @typedef {object} SettlementResult
 * @property {SettlementMember[]} members
 * @property {{contri: Paise, pocketBills: Paise, drawerBills: Paise, expenses: Paise, capital: Paise, revenue: Paise,
 *   netProfit: Paise, pot: Paise, inProfit: boolean, recoveryPct: number}} totals
 * @property {'equal'|'custom'} splitMode the split actually used (custom shares that don't add up to 100 fall back to equal)
 * @property {string[]} warnings
 */
/** @typedef {{id: string, at: ISO, operator: string, result: SettlementResult, text: string}} SettlementSnapshot */
/**
 * @typedef {object} ExpenseTotals
 * @property {Paise} total Σ non-void bills in scope
 * @property {number} count
 * @property {Record<string, Paise>} byCategory every EXPENSE_CATEGORY_IDS key (0 when none)
 * @property {{Cash: Paise, UPI: Paise}} byMethod
 * @property {Record<string, Paise>} byPayer member id or 'drawer' → Σ (stored paidBy; removed members keep their id)
 * @property {Paise} restock
 * @property {Paise} preStall
 */
/** @typedef {{id: string, type: string, entityId: string, operator: string, details: object, at: ISO}} AuditEntry */
/** @typedef {{active: boolean, unlockedAt: ISO|null, reference: string|null, updatedAt: ISO}} MilestoneState */
/**
 * @typedef {object} Session
 * @property {boolean} started
 * @property {Order[]} orders
 * @property {Payment[]} payments
 * @property {GamePlay[]} games
 * @property {Expense[]} expenses
 * @property {Contribution[]} [contributions] always present after migrate()/session()
 * @property {SettlementSnapshot[]} [settlements] always present after migrate()/session()
 * @property {AuditEntry[]} audit
 * @property {Record<string, MilestoneState>} milestones
 * @property {Line[]} draft
 * @property {string} draftId
 * @property {DiscountSpec|null} draftDiscount
 * @property {string} draftNote
 * @property {string|null} tokenDay
 * @property {number} tokenSeq
 */
/**
 * @typedef {object} State
 * @property {number} version
 * @property {number} revision
 * @property {'live'|'demo'} mode
 * @property {boolean} onboarded
 * @property {null|{salt: string, hash: string}} pin
 * @property {Config} config
 * @property {Session} live
 * @property {Session} demo
 */
/**
 * @typedef {object} MissionReport
 * @property {Paise} investment ledger mode: Σ bills; planned modes: missionTarget(c)
 * @property {Paise} extraExpenses ledger mode: 0; planned modes: Σ non-void bills
 * @property {Paise} target investment + extraExpenses (break-even)
 * @property {Paise} collected all-time session collections
 * @property {Paise} remaining
 * @property {Paise} profit may be negative
 * @property {number} percent 0–100 clamped
 * @property {number} recovery unclamped %
 * @property {boolean} profitMode
 * @property {boolean} hasTarget
 * @property {'ledger'|'total'|'itemized'} mode
 * @property {Paise} planned missionTarget(c) (0 in ledger mode)
 * @property {Paise} bills Σ non-void bills, whole session
 * @property {Paise} restock Σ non-void restock bills, whole session
 */
/**
 * @typedef {object} Report
 * @property {string} scope 'all' or the IST day
 * @property {Paise} collected
 * @property {Paise} food
 * @property {Paise} gameIncome
 * @property {{Cash: Paise, UPI: Paise, Other: Paise}} methods
 * @property {number} orders eligible (paid | partial) orders
 * @property {number} units
 * @property {Paise} average
 * @property {Paise} gross
 * @property {Paise} discounts
 * @property {Paise} refunds
 * @property {number} games
 * @property {Paise} expenses Σ non-void bills in scope
 * @property {ExpenseTotals} expenseTotals
 * @property {{count: number, amount: Paise}} pending
 * @property {{productId: string, name: string, units: number, revenue: Paise}[]} best
 * @property {Record<string, Paise>} categories
 * @property {Record<string, Paise>} hourly
 * @property {Record<string, {count: number, amount: Paise}>} discountUses
 * @property {MissionReport} mission
 */
/** @typedef {{ok: boolean, reason: ''|'hidden'|'soldout'|'unpriced'|'stock'|'component', left: number|null}} Sellability */
/** @typedef {Record<string, string>} MediaMap media id → data URL */

// ---------------------------------------------------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const isInt = (/** @type {unknown} */ n, min = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min;
const isObj = (/** @type {unknown} */ x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isIso = (/** @type {unknown} */ x) => typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x));
const hasOwn = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k);
const rupees = (/** @type {number} */ p) => (p / 100).toFixed(2);
const plural = (/** @type {number} */ n, /** @type {string} */ one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/**
 * Read a counter from a record keyed by owner data (stock pool keys). Own properties only, so a pool named e.g.
 * "constructor" never reads Object.prototype.
 * @param {Record<string, number>} record
 * @param {string} key
 */
const count = (record, key) => (hasOwn(record, key) ? record[key] : 0);
/**
 * Add to a counter in a record keyed by owner data (see `count`).
 * @param {Record<string, number>} record
 * @param {string} key
 * @param {number} n
 */
const bump = (record, key, n) => {
  record[key] = count(record, key) + n;
};

/**
 * Trim a free-text value and enforce a length limit.
 * @param {unknown} value
 * @param {number} max
 * @param {string} what human name for the error
 */
function text(value, max, what) {
  const t = String(value ?? '').trim();
  if (t.length > max) throw Error(`${what} must be ${max} characters or less.`);
  return t;
}

// India-time lookups are memoized: report() runs on every render and Intl formatting is the hot spot.
/** @type {Map<string, string>} */ const dayMemo = new Map();
/** @type {Map<string, string>} */ const hourMemo = new Map();
/** @param {string} at */
function dayOf(at) {
  let d = dayMemo.get(at);
  if (d === undefined) {
    if (dayMemo.size > 50000) dayMemo.clear();
    d = istDate(at);
    dayMemo.set(at, d);
  }
  return d;
}
/** @param {string} at */
function hourOf(at) {
  let h = hourMemo.get(at);
  if (h === undefined) {
    if (hourMemo.size > 50000) hourMemo.clear();
    h = istHour(at);
    hourMemo.set(at, h);
  }
  return h;
}

/**
 * Append an audit entry to a session.
 * @param {Session} s
 * @param {string} type
 * @param {string} entityId
 * @param {string} operator
 * @param {object} [details]
 * @param {ISO} [now]
 * @returns {AuditEntry}
 */
export function audit(s, type, entityId, operator, details = {}, now = nowIso()) {
  /** @type {AuditEntry} */
  const entry = {id: uuid(), type, entityId, operator, details, at: now};
  s.audit.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A fresh, empty ledger for one mode (live or practice).
 * @returns {Session}
 */
export function session() {
  return {
    started: false,
    orders: [],
    payments: [],
    games: [],
    expenses: [],
    contributions: [],
    settlements: [],
    audit: [],
    milestones: {},
    draft: [],
    draftId: uuid(),
    draftDiscount: null,
    draftNote: '',
    tokenDay: null,
    tokenSeq: 0,
  };
}

/** Hero art for stalls whose look predates themes (the original Packet Pataka stall). */
const LEGACY_HERO_ART = Object.freeze(['packet', 'pizza', 'cold']);
/** New installs start on the 'street-chaat' theme (§16.5); older template sets fall back to 'snacks-pizza'. */
const DEFAULT_TEMPLATE_ID = () => (TEMPLATES.some(t => t.id === 'street-chaat') ? 'street-chaat' : 'snacks-pizza');

/**
 * The full theme for a built template. Templates that predate §16.5 (no `theme`) get the Phase-1 accent plus defaults.
 * @param {any} t buildTemplate() result
 * @param {string|null} [heroImage]
 * @returns {Theme}
 */
function themeOf(t, heroImage = null) {
  const th = isObj(t.theme) ? t.theme : {};
  return {
    accent: typeof th.accent === 'string' && HEX_RE.test(th.accent) ? th.accent : t.accent || '#FFDD35',
    themeId: t.templateId,
    secondary: typeof th.secondary === 'string' && HEX_RE.test(th.secondary) ? th.secondary : '#FF4D87',
    heroArt: Array.isArray(th.heroArt) ? th.heroArt.slice(0, 3) : [...LEGACY_HERO_ART],
    heroTint: TINT_IDS.includes(th.heroTint) ? th.heroTint : 'yellow',
    heroPattern: PATTERN_IDS.includes(th.heroPattern) ? th.heroPattern : 'sunburst',
    heroImage,
  };
}

/**
 * A brand-new install: template menu and look, default profile (§5), empty team, onboarding pending.
 * @param {{templateId?: string, withPrices?: boolean}} [options]
 * @returns {State}
 */
export function initialState({templateId = DEFAULT_TEMPLATE_ID(), withPrices = true} = {}) {
  const t = /** @type {any} */ (buildTemplate(templateId, {withPrices}));
  /** @type {Config} */
  const config = {
    schema: SCHEMA_VERSION,
    templateId: t.templateId,
    profile: {
      stallName: 'My Awesome Stall',
      booth: 'Stall No. 1',
      tagline: t.tagline || '',
      subTagline: t.subTagline || '',
      eventName: 'College Fest',
      venue: '',
      city: '',
      eventDate: '',
      ownerName: 'Team Stall',
      initials: '',
    },
    theme: themeOf(t),
    upi: {id: '', payeeName: ''},
    operator: 'Team Stall',
    operators: ['Team Stall', 'Cashier 1', 'Cashier 2'],
    kitchenQueue: t.kitchenQueue !== false,
    allowCustomDiscount: !!t.allowCustomDiscount,
    inventory: !!t.inventory,
    stock: t.stock || {},
    categories: t.categories,
    products: t.products,
    addons: t.addons,
    flavours: t.flavours,
    games: t.games,
    discounts: t.discounts,
    mission: t.mission,
    milestones: t.milestones,
    team: {members: [], splitMode: 'equal'},
  };
  return {version: SCHEMA_VERSION, revision: 0, mode: 'live', onboarded: false, pin: null, config, live: session(), demo: session()};
}

/**
 * Replace the menu side of the config with a starter template, keeping identity, team, PIN and sales history (§3).
 * @param {State} state
 * @param {string} templateId
 * @param {{withPrices?: boolean}} [options]
 * @param {ISO} [now]
 */
export function applyTemplate(state, templateId, {withPrices = true} = {}, now = nowIso()) {
  const t = /** @type {any} */ (buildTemplate(templateId, {withPrices}));
  const c = state.config;
  c.templateId = t.templateId;
  c.categories = t.categories;
  c.products = t.products;
  c.addons = t.addons;
  c.flavours = t.flavours;
  c.games = t.games;
  c.discounts = t.discounts;
  c.allowCustomDiscount = !!t.allowCustomDiscount;
  c.mission = t.mission;
  c.milestones = t.milestones;
  c.stock = t.stock || {};
  c.inventory = !!t.inventory;
  c.kitchenQueue = t.kitchenQueue !== false;
  if (!c.profile.tagline) c.profile.tagline = t.tagline || '';
  if (!c.profile.subTagline) c.profile.subTagline = t.subTagline || '';
  for (const mode of /** @type {const} */ (['live', 'demo'])) clearDraft(state[mode]);
  audit(state[state.mode], 'template-applied', t.templateId, c.operator, {templateId: t.templateId, withPrices}, now);
  for (const mode of /** @type {const} */ (['live', 'demo'])) refreshMilestones(state[mode], c, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalog lookups used by the ledger
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {Config} c
 * @param {string} id
 * @returns {Product|undefined}
 */
export function productById(c, id) {
  return c.products.find(p => p.id === id);
}

/**
 * Stock units consumed per 1 item sold, by pool key (combos add up their components).
 * @param {Config} c
 * @param {Product} p
 * @returns {Record<string, number>}
 */
function stockPerItem(c, p) {
  /** @type {Record<string, number>} */
  const stock = {};
  if (p.bundle) {
    for (const part of p.bundle) {
      const component = productById(c, part.productId);
      if (component?.stockKey) bump(stock, component.stockKey, part.quantity * (component.stockUnits || 1));
    }
  } else if (p.stockKey) {
    stock[p.stockKey] = p.stockUnits || 1;
  }
  return stock;
}

/**
 * Price of one item: a combo's own price, else base price + chosen add-ons. null when unpriced (or an add-on is unknown).
 * @param {Product} product
 * @param {Config} c
 * @param {string[]} [addonIds]
 * @returns {Paise|null}
 */
export function unitPrice(product, c, addonIds = []) {
  if (!product || product.price === null || product.price === undefined) return null;
  if (product.bundle) return product.price;
  let price = product.price;
  for (const id of new Set(addonIds)) {
    const addon = c.addons.find(a => a.id === id);
    if (!addon) return null;
    price += addon.price;
  }
  return price;
}

/** @type {WeakMap<Order[], {sig: string, used: Record<string, number>}>} */
const stockMemo = new WeakMap();

/** @param {Session} s */
function stockUsedShared(s) {
  // Lines are immutable and 'void' is terminal, so (order count, void count) fingerprints the usage exactly.
  let voids = 0;
  for (const o of s.orders) if (o.status === 'void') voids++;
  const sig = `${s.orders.length}:${voids}`;
  const hit = stockMemo.get(s.orders);
  if (hit && hit.sig === sig) return hit.used;
  /** @type {Record<string, number>} */
  const used = {};
  for (const o of s.orders) {
    if (o.status === 'void') continue;
    for (const l of o.items) for (const [key, n] of Object.entries(l.stock || {})) bump(used, key, n * l.quantity);
  }
  stockMemo.set(s.orders, {sig, used});
  return used;
}

/**
 * Units used per stock pool by every non-void order (pending orders reserve stock; refunds do not return it).
 * @param {Session} s
 * @returns {Record<string, number>}
 */
export function stockUsed(s) {
  return {...stockUsedShared(s)};
}

/**
 * Units left in a pool, or null when the pool is untracked (inventory off, '' key or unknown key).
 * @param {Session} s
 * @param {Config} c
 * @param {string} key
 * @returns {number|null}
 */
export function stockLeft(s, c, key) {
  if (!c.inventory || !key || !hasOwn(c.stock, key)) return null;
  return Math.max(0, c.stock[key] - count(stockUsedShared(s), key));
}

/**
 * Can this product be sold right now? `left` = units remaining in its pool (for a combo: how many more combos the
 * pools allow), null when untracked.
 * @param {Session} s
 * @param {Config} c
 * @param {Product} product
 * @returns {Sellability}
 */
export function sellability(s, c, product) {
  /** @type {number|null} */
  let left = null;
  let short = false;
  if (c.inventory && product) {
    const needs = Object.entries(stockPerItem(c, product));
    for (const [key, need] of needs) {
      const remaining = stockLeft(s, c, key);
      if (remaining === null) continue;
      if (remaining < need) short = true;
      const value = product.bundle ? Math.floor(remaining / need) : remaining;
      left = left === null ? value : Math.min(left, value);
    }
  }
  /** @param {Sellability['reason']} reason */
  const out = reason => ({ok: reason === '', reason, left});
  if (!product || !product.active) return out('hidden');
  if (product.soldOut) return out('soldout');
  if (unitPrice(product, c) === null) return out('unpriced');
  if (product.bundle && product.bundle.some(part => {
    const component = productById(c, part.productId);
    return !component || component.soldOut || !!component.bundle;
  })) return out('component');
  if (short) return out('stock');
  return out('');
}

/**
 * Human error for a product that can't be sold.
 * @param {Sellability['reason']} reason
 * @param {string} name
 */
function unsellableMessage(reason, name) {
  switch (reason) {
    case 'hidden': return `${name} is hidden from the menu right now.`;
    case 'soldout': return `${name} is sold out.`;
    case 'unpriced': return `Set a price for ${name} first (Menu › Price board).`;
    case 'component': return `An item inside the combo ${name} is sold out or missing.`;
    case 'stock': return `Not enough stock left for ${name}. Update the stock room or change the order.`;
    default: return `${name} can't be sold right now.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {unknown} quantity
 * @param {number} [min]
 */
function checkQuantity(quantity, min = 1) {
  if (!isInt(quantity, min)) throw Error('Quantity must be a whole number of at least 1.');
  if (/** @type {number} */ (quantity) > MAX_QUANTITY) throw Error(`Maximum quantity is ${MAX_QUANTITY}.`);
  return /** @type {number} */ (quantity);
}

/**
 * Build an immutable cart line (price snapshot). Validates that the product is sellable (stock is checked at checkout).
 * @param {Config} c
 * @param {string} productId
 * @param {{quantity?: number, addons?: string[], flavour?: string, note?: string}} [options]
 * @returns {Line}
 */
export function makeLine(c, productId, {quantity = 1, addons = [], flavour = '', note = ''} = {}) {
  const p = productById(c, productId);
  if (!p) throw Error('That item is no longer on the menu.');
  checkQuantity(quantity);
  const ids = new Set(Array.isArray(addons) ? addons : []);
  if (ids.size && (!p.customizable || p.bundle)) throw Error(`${p.name} doesn't take add-ons.`);
  for (const id of ids) if (!c.addons.some(a => a.id === id)) throw Error('That add-on is no longer available.');
  const chosenFlavour = String(flavour ?? '').trim();
  // Flavours, like add-ons, are customize-sheet choices: only customizable, non-combo items take them (§2).
  if (chosenFlavour && (!p.customizable || p.bundle)) throw Error(`${p.name} doesn't have flavour choices.`);
  if (chosenFlavour && !c.flavours.includes(chosenFlavour)) throw Error('That flavour is no longer available.');
  const lineNote = text(note, LIMITS.note, 'The item note');
  // Stock is deliberately ignored here (only at checkout); everything else must be sellable.
  const check = sellability(session0, {...c, inventory: false}, p);
  if (!check.ok) throw Error(unsellableMessage(check.reason, p.name));
  const price = /** @type {number} */ (unitPrice(p, c, [...ids]));
  return {
    id: uuid(),
    productId: p.id,
    name: p.name,
    category: c.categories.find(x => x.id === p.categoryId)?.name || '',
    size: p.size || '',
    flavour: chosenFlavour,
    addons: c.addons.filter(a => ids.has(a.id)).map(a => ({id: a.id, name: a.name, price: a.price})),
    quantity,
    unitPrice: price,
    lineTotal: price * quantity,
    stock: stockPerItem(c, p),
    bundle: p.bundle ? p.bundle.map(b => ({productId: b.productId, quantity: b.quantity})) : null,
    note: lineNote,
  };
}
/** Placeholder session for stock-free sellability checks. @type {Session} */
const session0 = {
  started: false, orders: [], payments: [], games: [], expenses: [], audit: [], milestones: {}, draft: [], draftId: 'none',
  draftDiscount: null, draftNote: '', tokenDay: null, tokenSeq: 0,
};

/** @param {Line} l */
const lineKey = l => JSON.stringify([l.productId, l.unitPrice, l.flavour || '', (l.addons || []).map(a => a.id).sort(), l.note || '']);

/**
 * Add a line to the cart, merging with an identical line (same product, unit price, flavour, add-ons and note).
 * @param {Session} s
 * @param {Config} c
 * @param {Line} line
 * @returns {Line} the line now in the cart (merged or newly added)
 */
export function addToDraft(s, c, line) {
  if (!line || typeof line !== 'object' || !isInt(line.unitPrice)) throw Error('That item could not be added.');
  checkQuantity(line.quantity);
  if (c && !productById(c, line.productId)) throw Error('That item is no longer on the menu.');
  const key = lineKey(line);
  const same = s.draft.find(l => lineKey(l) === key);
  if (same) {
    const quantity = same.quantity + line.quantity;
    if (quantity > MAX_QUANTITY) throw Error(`Maximum quantity is ${MAX_QUANTITY}.`);
    same.quantity = quantity;
    same.lineTotal = same.unitPrice * quantity;
    return same;
  }
  const fresh = {...line, note: line.note || '', lineTotal: line.unitPrice * line.quantity};
  s.draft.push(fresh);
  return fresh;
}

/**
 * Change a cart line's quantity (0 removes it).
 * @param {Session} s
 * @param {string} lineId
 * @param {number} quantity
 */
export function setLineQuantity(s, lineId, quantity) {
  const line = s.draft.find(l => l.id === lineId);
  if (!line) throw Error('That item is no longer in the cart.');
  checkQuantity(quantity, 0);
  if (quantity === 0) {
    removeLine(s, lineId);
    return;
  }
  line.quantity = quantity;
  line.lineTotal = line.unitPrice * quantity;
}

/**
 * Remove a cart line (no-op when it is already gone).
 * @param {Session} s
 * @param {string} lineId
 */
export function removeLine(s, lineId) {
  s.draft = s.draft.filter(l => l.id !== lineId);
}

/**
 * Empty the cart, its discount and note, and start a new idempotency key.
 * @param {Session} s
 */
export function clearDraft(s) {
  s.draft = [];
  s.draftDiscount = null;
  s.draftNote = '';
  s.draftId = uuid();
}

/**
 * Why a discount spec is not usable ('' when it is).
 * @param {Config} c
 * @param {DiscountSpec} spec
 */
function discountProblem(c, spec) {
  if (!isObj(spec)) return 'Choose a discount.';
  if (spec.custom === true) {
    if (!c.allowCustomDiscount) return 'Custom discounts are turned off for this stall.';
    if (spec.type === 'flat') return isInt(spec.value, 1) && spec.value <= 100000000 ? '' : 'Enter a custom discount of at least ₹0.01.';
    if (spec.type === 'percent') return isInt(spec.value, 1) && spec.value <= 100 ? '' : 'Percent off must be a whole number from 1 to 100.';
    return 'Choose ₹ off or % off.';
  }
  const rule = typeof spec.ruleId === 'string' ? c.discounts.find(d => d.id === spec.ruleId) : undefined;
  if (!rule || !rule.active) return 'That discount is not available any more.';
  return '';
}

/**
 * Resolve a discount choice against the config. null for no discount, a missing/inactive rule, or an invalid/disallowed custom.
 * @param {Config} c
 * @param {DiscountSpec|null} spec
 * @returns {ResolvedDiscount|null}
 */
export function resolveDiscount(c, spec) {
  if (spec === null || spec === undefined || discountProblem(c, spec)) return null;
  if (spec.custom === true) {
    const type = /** @type {'flat'|'percent'} */ (spec.type);
    const value = /** @type {number} */ (spec.value);
    return {id: null, label: type === 'flat' ? `Custom ${money(value)} off` : `Custom ${value}% off`, type, value, minimum: 0};
  }
  const rule = /** @type {DiscountRule} */ (c.discounts.find(d => d.id === spec.ruleId));
  return {id: rule.id, label: rule.label, type: rule.type, value: rule.value, minimum: rule.minimum || 0};
}

/**
 * Choose (or clear with null) the cart's discount. Throws a cashier-friendly message when it can't be used.
 * @param {Session} s
 * @param {Config} c
 * @param {DiscountSpec|null} spec
 */
export function setDraftDiscount(s, c, spec) {
  if (spec === null || spec === undefined) {
    s.draftDiscount = null;
    return;
  }
  const problem = discountProblem(c, spec);
  if (problem) throw Error(problem);
  s.draftDiscount = spec.custom === true
    ? {custom: true, type: spec.type, value: spec.value}
    : {ruleId: /** @type {string} */ (spec.ruleId)};
}

/**
 * Set the order note for the cart.
 * @param {Session} s
 * @param {string} value
 */
export function setDraftNote(s, value) {
  s.draftNote = text(value, LIMITS.note, 'The order note');
}

/**
 * Cart arithmetic. The discount applies once per order and only when the subtotal meets the rule's minimum.
 * @param {Line[]} lines
 * @param {ResolvedDiscount|DiscountRule|null} [rule]
 * @returns {{subtotal: Paise, discount: Paise, total: Paise, discountInfo: DiscountInfo|null, minimumShort: Paise}}
 */
export function totals(lines, rule = null) {
  if (!Array.isArray(lines)) throw Error('Invalid cart.');
  let subtotal = 0;
  for (const l of lines) {
    if (!isInt(l?.unitPrice) || !isInt(l?.quantity, 1)) throw Error('Invalid cart line.');
    subtotal += l.unitPrice * l.quantity;
  }
  let discount = 0;
  let minimumShort = 0;
  if (rule) {
    const minimum = rule.minimum || 0;
    if (subtotal < minimum) minimumShort = minimum - subtotal;
    else if (rule.type === 'flat') discount = Math.min(rule.value, subtotal);
    else if (rule.type === 'percent') discount = Math.min(Math.round(subtotal * rule.value / 100), subtotal);
  }
  const discountInfo = rule && discount > 0 ? {id: rule.id ?? null, label: rule.label, type: rule.type, value: rule.value} : null;
  return {subtotal, discount, total: subtotal - discount, discountInfo, minimumShort};
}

/**
 * Totals for the current cart with its chosen discount (convenience for Sell/Checkout).
 * @param {Session} s
 * @param {Config} c
 */
export function draftTotals(s, c) {
  return totals(s.draft, resolveDiscount(c, s.draftDiscount));
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders & payments
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Validate a payment choice for an amount due and work out the ledger rows.
 * @param {Paise} total
 * @param {unknown} method
 * @param {unknown} split
 * @param {unknown} cashReceived
 */
function paymentPlan(total, method, split, cashReceived) {
  if (!CHECKOUT_METHODS.includes(/** @type {any} */ (method))) throw Error('Choose a payment method: Cash, UPI, Split or Other.');
  const m = /** @type {CheckoutMethod} */ (method);
  /** @type {SplitParts|null} */
  let parts = null;
  /** @type {[PaymentMethod, Paise][]} */
  let rows = [];
  if (m === 'Split') {
    const sp = /** @type {any} */ (split);
    if (!isObj(sp)) throw Error('Enter the cash part and the UPI part of the split.');
    if (!isInt(sp.Cash, 1) || !isInt(sp.UPI, 1)) throw Error('Both split parts must be more than ₹0.');
    if (sp.Cash + sp.UPI !== total) throw Error(`Split parts must add up to ${money(total)}.`);
    parts = {Cash: sp.Cash, UPI: sp.UPI};
    rows = [['Cash', sp.Cash], ['UPI', sp.UPI]];
  } else if (total > 0) {
    rows = [[m, total]];
  }
  const due = m === 'Cash' ? total : parts ? parts.Cash : null;
  /** @type {Paise|null} */
  let received = null;
  let change = 0;
  if (due !== null && cashReceived !== null && cashReceived !== undefined) {
    if (!isInt(cashReceived)) throw Error('Enter the cash received as a valid amount.');
    const given = /** @type {number} */ (cashReceived);
    if (given < due) throw Error(`Cash received is less than the ${money(due)} due in cash.`);
    received = given;
    change = given - due;
  }
  return {method: m, split: parts, cashReceived: received, change, rows};
}

/**
 * Next daily kitchen token (resets when the India-time day changes).
 * @param {Session} s
 * @param {ISO} now
 */
function nextToken(s, now) {
  const day = istDate(now);
  if (s.tokenDay !== day) {
    s.tokenDay = day;
    s.tokenSeq = 0;
  }
  s.tokenSeq += 1;
  return {token: s.tokenSeq, tokenDay: day};
}

/**
 * The kitchen token the next order would get at `now`, without issuing it. Checkout shows it (e.g. in the UPI QR note
 * "Token #07 · stall") before the order exists; createOrder at the same `now` assigns exactly this token.
 * @param {Session} s
 * @param {ISO} [now]
 * @returns {number}
 */
export function upcomingToken(s, now = nowIso()) {
  return s.tokenDay === istDate(now) ? s.tokenSeq + 1 : 1;
}

/**
 * Check an incoming cart line's shape before it becomes history.
 * @param {Line} l
 */
function checkIncomingLine(l) {
  if (!isObj(l) || typeof l.productId !== 'string' || !isInt(l.unitPrice)) throw Error('The cart has an invalid item. Clear it and add again.');
  checkQuantity(l.quantity);
}

/**
 * Record an order (Cash / UPI / Split / Other, or pending). Idempotent on `id`: a repeat returns the existing order.
 * @param {Session} s
 * @param {Config} c
 * @param {{id: string, items: Line[], discount?: DiscountSpec|null, note?: string, method?: CheckoutMethod, split?: SplitParts|null,
 *   pending?: boolean, cashReceived?: Paise|null}} input
 * @param {ISO} [now]
 * @returns {Order}
 */
export function createOrder(s, c, {id, items, discount = null, note = '', method = 'Cash', split = null, pending = false, cashReceived = null},
  now = nowIso()) {
  const existing = s.orders.find(o => o.id === id);
  if (existing) return existing;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw Error('This checkout has no valid order id. Reopen the cart and try again.');
  if (s.games.some(g => g.id === id)) throw Error('This order id is already used. Reopen the cart and try again.');
  if (!Array.isArray(items) || !items.length) throw Error('Add an item before checkout.');
  for (const l of items) checkIncomingLine(l);

  // Every item must still be sellable (stock checked below for the whole order at once).
  const noStock = {...c, inventory: false};
  for (const l of items) {
    const p = productById(c, l.productId);
    if (!p) throw Error(`${l.name || 'An item'} is no longer on the menu.`);
    const check = sellability(session0, noStock, p);
    if (!check.ok) throw Error(unsellableMessage(check.reason, l.name || p.name));
  }
  if (c.inventory) {
    const used = stockUsedShared(s);
    /** @type {Record<string, number>} */
    const need = {};
    /** @type {Record<string, string>} */
    const who = {};
    for (const l of items) {
      for (const [key, n] of Object.entries(l.stock || {})) {
        bump(need, key, n * l.quantity);
        if (!hasOwn(who, key)) who[key] = l.name;
      }
    }
    for (const [key, n] of Object.entries(need)) {
      if (!hasOwn(c.stock, key)) continue;
      const left = Math.max(0, c.stock[key] - count(used, key));
      if (n > left) throw Error(`Not enough stock for ${who[key]}: ${left} left in "${key}". Change the order or update the stock room.`);
    }
  }

  /** @type {ResolvedDiscount|null} */
  let rule = null;
  if (discount !== null && discount !== undefined) {
    const problem = discountProblem(c, discount);
    if (problem) throw Error(problem);
    rule = resolveDiscount(c, discount);
  }
  const lines = items.map(l => ({...structuredClone(l), note: l.note || '', lineTotal: l.unitPrice * l.quantity}));
  const t = totals(lines, rule);
  const orderNote = text(note, LIMITS.note, 'The order note');

  let plan;
  if (pending) {
    // Nothing is collected yet: the method is the expected one; split parts are optional until payment is confirmed.
    if (!CHECKOUT_METHODS.includes(method)) throw Error('Choose a payment method: Cash, UPI, Split or Other.');
    const parts = method === 'Split' && split ? paymentPlan(t.total, 'Split', split, null).split : null;
    plan = {method, split: parts, cashReceived: null, change: 0, rows: []};
  } else {
    plan = paymentPlan(t.total, method, split, cashReceived);
  }

  const number = s.orders.reduce((n, o) => Math.max(n, o.number || 0), 0) + 1;
  const {token, tokenDay} = nextToken(s, now);
  /** @type {KitchenStatus} */
  const kitchen = c.kitchenQueue ? 'preparing' : 'handed';
  /** @type {Order} */
  const order = {
    id,
    number,
    token,
    tokenDay,
    at: now,
    operator: c.operator,
    items: lines,
    subtotal: t.subtotal,
    discount: t.discount,
    total: t.total,
    discountInfo: t.discountInfo,
    note: orderNote,
    method: plan.method,
    split: plan.split,
    status: pending ? 'pending' : 'paid',
    kitchen,
    kitchenAt: {[kitchen]: now},
    cashReceived: plan.cashReceived,
    change: plan.change,
  };
  s.orders.push(order);
  for (const [m, amount] of plan.rows) s.payments.push({id: uuid(), entityId: id, kind: 'order', amount, method: m, at: now});
  audit(s, 'order-created', id, c.operator, {status: order.status, total: order.total, method: order.method, token}, now);
  clearDraft(s);
  refreshMilestones(s, c, now);
  return order;
}

/**
 * Confirm payment for a pending order.
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {{method: CheckoutMethod, split?: SplitParts|null, cashReceived?: Paise|null}} payment
 * @param {ISO} [now]
 * @returns {Order}
 */
export function markPaid(s, c, id, payment, now = nowIso()) {
  const o = s.orders.find(x => x.id === id);
  if (!o || o.status !== 'pending') throw Error('This order is no longer pending.');
  const {method, split = null, cashReceived = null} = typeof payment === 'string' ? {method: payment} : (payment || /** @type {any} */ ({}));
  const plan = paymentPlan(o.total, method, split, cashReceived);
  o.status = 'paid';
  o.method = plan.method;
  o.split = plan.split;
  o.cashReceived = plan.cashReceived;
  o.change = plan.change;
  for (const [m, amount] of plan.rows) s.payments.push({id: uuid(), entityId: id, kind: 'order', amount, method: m, at: now});
  audit(s, 'payment-confirmed', id, c.operator, {amount: o.total, method: plan.method, split: plan.split}, now);
  refreshMilestones(s, c, now);
  return o;
}

/**
 * Net collected per payment method for one order or game play.
 * @param {Session} s
 * @param {string} entityId
 * @returns {{Cash: Paise, UPI: Paise, Other: Paise}}
 */
export function methodBalances(s, entityId) {
  const out = {Cash: 0, UPI: 0, Other: 0};
  for (const p of s.payments) if (p.entityId === entityId && hasOwn(out, p.method)) out[p.method] += p.amount;
  return out;
}

/**
 * Net collected for one order or game play.
 * @param {Session} s
 * @param {string} entityId
 * @returns {Paise}
 */
export function netFor(s, entityId) {
  let n = 0;
  for (const p of s.payments) if (p.entityId === entityId) n += p.amount;
  return n;
}

/**
 * Refund part of an order (from one method) or void it (reverse every method, release stock). Reason required.
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {{type: 'void'|'refund', amount?: Paise, reason: string, method?: PaymentMethod|null}} correction
 * @param {ISO} [now]
 * @returns {Order}
 */
export function correctOrder(s, c, id, {type, amount = 0, reason, method = null}, now = nowIso()) {
  const o = s.orders.find(x => x.id === id);
  if (!o) throw Error('That order could not be found.');
  if (o.status === 'void') throw Error('This order is already void.');
  if (type !== 'void' && type !== 'refund') throw Error('Choose refund or void.');
  const why = text(reason, LIMITS.reason, 'The reason');
  if (!why) throw Error('A correction reason is required.');
  const balances = methodBalances(s, id);
  /** @type {{method: PaymentMethod, amount: Paise}[]} */
  const reversals = [];
  if (type === 'refund') {
    if (o.status === 'pending') throw Error('A pending order has no payment to refund. Void it instead.');
    if (!isInt(amount, 1)) throw Error('Enter a refund amount of at least ₹0.01.');
    /** @type {PaymentMethod} */
    let from;
    if (o.method === 'Split') {
      if (method !== 'Cash' && method !== 'UPI') throw Error('Choose which part to refund: Cash or UPI.');
      from = method;
    } else {
      from = /** @type {PaymentMethod} */ (method ?? o.method);
      if (!PAYMENT_METHODS.includes(from)) throw Error('Choose the refund method.');
    }
    const available = balances[from];
    if (amount > available) throw Error(`Refund can't be more than the ${money(available)} collected by ${from}.`);
    reversals.push({method: from, amount});
  } else {
    for (const m of PAYMENT_METHODS) if (balances[m] > 0) reversals.push({method: m, amount: balances[m]});
  }
  for (const r of reversals) s.payments.push({id: uuid(), entityId: id, kind: 'refund', amount: -r.amount, method: r.method, at: now});
  if (type === 'void') o.status = 'void';
  else o.status = netFor(s, id) === 0 ? 'refunded' : 'partial';
  const total = reversals.reduce((n, r) => n + r.amount, 0);
  audit(s, type, id, c.operator, {amount: total, methods: reversals, reason: why, status: o.status}, now);
  refreshMilestones(s, c, now);
  return o;
}

/**
 * Move an order between kitchen stages (forward or undo).
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {KitchenStatus} status
 * @param {ISO} [now]
 * @returns {Order}
 */
export function setKitchen(s, c, id, status, now = nowIso()) {
  if (!KITCHEN_STATUSES.includes(status)) throw Error('Unknown kitchen status.');
  const o = s.orders.find(x => x.id === id);
  if (!o) throw Error('That order could not be found.');
  if (o.status === 'void' || o.status === 'refunded') throw Error('This order was cancelled, so it is not in the kitchen queue.');
  if (o.kitchen === status) return o;
  const rank = KITCHEN_STATUSES.indexOf(status);
  /** @type {Order['kitchenAt']} */
  const at = {};
  for (const k of KITCHEN_STATUSES.slice(0, rank)) if (o.kitchenAt?.[k]) at[k] = o.kitchenAt[k];
  at[status] = o.kitchenAt?.[status] && KITCHEN_STATUSES.indexOf(o.kitchen) > rank ? o.kitchenAt[status] : now;
  o.kitchen = status;
  o.kitchenAt = at;
  return o;
}

/**
 * Orders still in the kitchen, oldest first. Pending (unpaid) orders are included; void/refunded/handed are not.
 * @param {Session} s
 * @returns {{preparing: Order[], ready: Order[]}}
 */
export function kitchenQueue(s) {
  /** @type {{preparing: Order[], ready: Order[]}} */
  const out = {preparing: [], ready: []};
  for (const o of s.orders) {
    if (o.status === 'void' || o.status === 'refunded') continue;
    if (o.kitchen === 'preparing' || o.kitchen === 'ready') out[o.kitchen].push(o);
  }
  const byAge = (/** @type {Order} */ a, /** @type {Order} */ b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.number - b.number);
  out.preparing.sort(byAge);
  out.ready.sort(byAge);
  return out;
}

/**
 * Restart kitchen tokens at #01 for today.
 * @param {Session} s
 * @param {Config} c
 * @param {ISO} [now]
 */
export function resetTokens(s, c, now = nowIso()) {
  s.tokenSeq = 0;
  s.tokenDay = istDate(now);
  audit(s, 'tokens-reset', '', c.operator, {day: s.tokenDay}, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Games & expenses
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Record a game play. Idempotent on id. Free games write no payment.
 * @param {Session} s
 * @param {Config} c
 * @param {{id: string, gameId: string, prize?: string, method?: PaymentMethod}} play
 * @param {ISO} [now]
 * @returns {GamePlay}
 */
export function addGame(s, c, {id, gameId, prize = '', method = 'Cash'}, now = nowIso()) {
  const existing = s.games.find(g => g.id === id);
  if (existing) return existing;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw Error('This game play has no valid id. Try again.');
  if (s.orders.some(o => o.id === id)) throw Error('This game play id is already used. Try again.');
  const game = c.games.find(g => g.id === gameId);
  if (!game) throw Error('That game is no longer set up.');
  if (!isInt(game.fee)) throw Error('This game has an invalid fee. Fix it in Stall Studio.');
  if (!PAYMENT_METHODS.includes(method)) throw Error('Choose how the fee was paid: Cash, UPI or Other.');
  /** @type {GamePlay} */
  const play = {id, gameId, name: game.name, fee: game.fee, prize: text(prize, LIMITS.prize, 'The prize'), method, operator: c.operator, at: now, void: false};
  s.games.push(play);
  if (game.fee > 0) s.payments.push({id: uuid(), entityId: id, kind: 'game', amount: game.fee, method, at: now});
  audit(s, 'game-recorded', id, c.operator, {fee: game.fee, method}, now);
  refreshMilestones(s, c, now);
  return play;
}

/**
 * Reverse a game play (refunds its fee, keeps the record).
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {string} reason
 * @param {ISO} [now]
 * @returns {GamePlay}
 */
export function voidGame(s, c, id, reason, now = nowIso()) {
  const g = s.games.find(x => x.id === id);
  if (!g) throw Error('That game play could not be found.');
  if (g.void) throw Error('This game play is already reversed.');
  const why = text(reason, LIMITS.reason, 'The reason');
  if (!why) throw Error('A reason is required.');
  g.void = true;
  const balances = methodBalances(s, id);
  let amount = 0;
  for (const m of PAYMENT_METHODS) {
    if (balances[m] > 0) {
      s.payments.push({id: uuid(), entityId: id, kind: 'refund', amount: -balances[m], method: m, at: now});
      amount += balances[m];
    }
  }
  audit(s, 'game-void', id, c.operator, {amount, reason: why}, now);
  refreshMilestones(s, c, now);
  return g;
}

// (bills: see the expense ledger section below)

// ---------------------------------------------------------------------------------------------------------------------
// Bills (expense ledger) & team contri — §16.1, §16.3
// ---------------------------------------------------------------------------------------------------------------------

const MAX_AMOUNT = 100000000; // ₹10,00,000
const EXPENSE_FIELDS = /** @type {const} */ (['title', 'category', 'amount', 'method', 'paidBy', 'billImage', 'notes']);

/** Team partners of a config (an empty list for configs that predate Phase 2). @param {Config} c @returns {TeamMember[]} */
const membersOf = c => (isObj(c?.team) && Array.isArray(c.team.members) ? c.team.members : []);
/** Display label of a bill category. @param {string} id */
const categoryLabel = id => EXPENSE_CATEGORIES.find(x => x.id === id)?.label || 'Misc';

/**
 * Any category text → a Phase-2 category id: ids pass through, Phase-1 names map per §16.1 (Ingredients → restock …),
 * new labels ("Mid-Stall Restock") map to their id; anything else is null.
 * @param {unknown} category
 * @returns {ExpenseCategory|null}
 */
function categoryId(category) {
  if (typeof category !== 'string') return null;
  const t = category.trim();
  if (EXPENSE_CATEGORY_IDS.includes(/** @type {any} */ (t))) return /** @type {ExpenseCategory} */ (t);
  if (hasOwn(LEGACY_EXPENSE_CATEGORIES, t)) return /** @type {ExpenseCategory} */ (LEGACY_EXPENSE_CATEGORIES[t]);
  const byLabel = EXPENSE_CATEGORIES.find(x => x.label.toLowerCase() === t.toLowerCase());
  return byLabel ? byLabel.id : null;
}

/**
 * Title (and overflow notes) for a Phase-1 expense: `description || 'Expense'`. Phase-1 descriptions could be 150 chars;
 * a longer one is cut to the 80-char title and kept whole in the notes.
 * @param {string} description trimmed
 */
function legacyTitle(description) {
  if (!description) return {title: 'Expense', notes: ''};
  if (description.length <= LIMITS.expenseTitle) return {title: description, notes: ''};
  return {title: clipUnits(description, LIMITS.expenseTitle).trim(), notes: clipUnits(description, LIMITS.expenseNotes)};
}

/** Cut text to `max` UTF-16 units without splitting an emoji's surrogate pair. @param {string} t @param {number} max */
function clipUnits(t, max) {
  let out = t.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (out.length < t.length && last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/**
 * Validate and normalize bill fields (used by addExpense and updateExpense).
 * @param {Config} c
 * @param {Record<string, any>} f
 * @param {string|null} keepPaidBy a stored paidBy that may stay even though the partner was removed
 */
function cleanExpense(c, f, keepPaidBy = null) {
  const title = text(f.title, LIMITS.expenseTitle, 'The bill title');
  if (!title) throw Error('Give this bill a title, like “Extra cheese & buns”.');
  const category = categoryId(f.category);
  if (!category) throw Error('Pick a bill category.');
  if (!isInt(f.amount, 1)) throw Error('Enter an expense amount of at least ₹0.01.');
  if (f.amount > MAX_AMOUNT) throw Error(`A bill can be at most ${money(MAX_AMOUNT)}.`);
  if (!EXPENSE_METHODS.includes(f.method)) throw Error('Choose how the bill was paid: Cash or UPI.');
  const paidBy = f.paidBy;
  if (!(paidBy === DRAWER || (keepPaidBy !== null && paidBy === keepPaidBy) || membersOf(c).some(m => m.id === paidBy))) {
    throw Error('Pick who paid this bill: a partner or the stall cash drawer.');
  }
  const billImage = f.billImage === '' || f.billImage === undefined ? null : f.billImage;
  if (billImage !== null && !(typeof billImage === 'string' && MEDIA_RE.test(billImage))) {
    throw Error('The bill photo could not be attached. Try adding it again.');
  }
  const notes = text(f.notes, LIMITS.expenseNotes, 'The notes');
  return {title, category, amount: /** @type {number} */ (f.amount), method: /** @type {'Cash'|'UPI'} */ (f.method), paidBy, billImage, notes};
}

/**
 * Record a bill. Idempotent on id. Every non-void bill counts towards the break-even (ledger mode: it *is* the break-even).
 * Also accepts the Phase-1 shape `{id, category: 'Ingredients'|…, amount, description}` (mapped per §16.1; unknown
 * Phase-1 categories become 'misc').
 * @param {Session} s
 * @param {Config} c
 * @param {{id: string, title?: string, category: string, amount: Paise, method?: 'Cash'|'UPI', paidBy?: string,
 *   billImage?: string|null, notes?: string, description?: string}} expense
 * @param {ISO} [now]
 * @returns {Expense}
 */
export function addExpense(s, c, expense, now = nowIso()) {
  const data = /** @type {Record<string, any>} */ (isObj(expense) ? expense : {});
  const {id} = data;
  const existing = s.expenses.find(e => e.id === id);
  if (existing) return existing;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw Error('This expense has no valid id. Try again.');
  /** @type {Record<string, any>} */
  const fields = {method: 'Cash', paidBy: DRAWER, billImage: null, notes: '', ...data};
  if (data.title === undefined) {
    // Phase-1 call: {category, amount, description}.
    const legacy = legacyTitle(text(data.description, LIMITS.expense, 'The description'));
    fields.title = legacy.title;
    if (!data.notes) fields.notes = legacy.notes;
    fields.category = categoryId(data.category) || 'misc';
  }
  const clean = cleanExpense(c, fields);
  /** @type {Expense} */
  const e = {id, at: now, operator: c.operator, ...clean, void: false};
  s.expenses.push(e);
  audit(s, 'expense-recorded', id, c.operator, {amount: e.amount, category: e.category, method: e.method, paidBy: e.paidBy}, now);
  refreshMilestones(s, c, now);
  return e;
}

/**
 * Edit a bill's title/category/amount/method/paidBy/billImage/notes (other keys are ignored). Audits the before/after
 * of every changed field. A bill paid by a since-removed partner may keep that payer.
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {Partial<Pick<Expense, 'title'|'category'|'amount'|'method'|'paidBy'|'billImage'|'notes'>>} patch
 * @param {ISO} [now]
 * @returns {Expense}
 */
export function updateExpense(s, c, id, patch, now = nowIso()) {
  const e = s.expenses.find(x => x.id === id);
  if (!e) throw Error('That bill could not be found.');
  if (e.void) throw Error('This bill is voided. Add a new bill instead.');
  if (!isObj(patch)) throw Error('Nothing to change.');
  /** @type {Record<string, any>} */
  const next = {};
  for (const k of EXPENSE_FIELDS) next[k] = hasOwn(patch, k) && patch[k] !== undefined ? patch[k] : e[k];
  const clean = /** @type {Record<string, any>} */ (cleanExpense(c, next, e.paidBy));
  /** @type {Record<string, any>} */
  const before = {};
  /** @type {Record<string, any>} */
  const after = {};
  for (const k of EXPENSE_FIELDS) {
    if (clean[k] !== /** @type {any} */ (e)[k]) {
      before[k] = /** @type {any} */ (e)[k];
      after[k] = clean[k];
    }
  }
  if (!Object.keys(after).length) return e;
  Object.assign(e, after);
  audit(s, 'expense-updated', id, c.operator, {before, after}, now);
  refreshMilestones(s, c, now);
  return e;
}

/**
 * Void a bill (kept for audit, excluded from every total). A reason is required.
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {string} reason
 * @param {ISO} [now]
 * @returns {Expense}
 */
export function voidExpense(s, c, id, reason, now = nowIso()) {
  const e = s.expenses.find(x => x.id === id);
  if (!e) throw Error('That bill could not be found.');
  if (e.void) throw Error('This bill is already voided.');
  const why = text(reason, LIMITS.reason, 'The reason');
  if (!why) throw Error('A reason is required.');
  e.void = true;
  e.voidReason = why;
  e.voidAt = now;
  audit(s, 'expense-void', id, c.operator, {amount: e.amount, reason: why}, now);
  refreshMilestones(s, c, now);
  return e;
}

/**
 * Record money a partner put into the stall pool. Idempotent on id.
 * @param {Session} s
 * @param {Config} c
 * @param {{id: string, memberId: string, amount: Paise, method?: 'Cash'|'UPI', note?: string}} contribution
 * @param {ISO} [now]
 * @returns {Contribution}
 */
export function addContribution(s, c, {id, memberId, amount, method = 'Cash', note = ''}, now = nowIso()) {
  s.contributions ??= [];
  const existing = s.contributions.find(x => x.id === id);
  if (existing) return existing;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw Error('This contri has no valid id. Try again.');
  if (!membersOf(c).some(m => m.id === memberId)) throw Error('Pick which partner put this money in.');
  if (!isInt(amount, 1)) throw Error('Enter a contri of at least ₹0.01.');
  if (amount > MAX_AMOUNT) throw Error(`A contri can be at most ${money(MAX_AMOUNT)}.`);
  if (!EXPENSE_METHODS.includes(method)) throw Error('Choose how the money came in: Cash or UPI.');
  /** @type {Contribution} */
  const x = {id, at: now, operator: c.operator, memberId, amount, method, note: text(note, LIMITS.contriNote, 'The note'), void: false};
  s.contributions.push(x);
  audit(s, 'contri-recorded', id, c.operator, {memberId, amount, method}, now);
  return x;
}

/**
 * Void a contri (kept for audit, excluded from the settlement). A reason is required.
 * @param {Session} s
 * @param {Config} c
 * @param {string} id
 * @param {string} reason
 * @param {ISO} [now]
 * @returns {Contribution}
 */
export function voidContribution(s, c, id, reason, now = nowIso()) {
  const x = (s.contributions || []).find(y => y.id === id);
  if (!x) throw Error('That contri could not be found.');
  if (x.void) throw Error('This contri is already voided.');
  const why = text(reason, LIMITS.reason, 'The reason');
  if (!why) throw Error('A reason is required.');
  x.void = true;
  x.voidReason = why;
  x.voidAt = now;
  audit(s, 'contri-void', id, c.operator, {amount: x.amount, reason: why}, now);
  return x;
}

/**
 * Bill totals for a scope (`day` = IST 'YYYY-MM-DD', null = whole session). Void bills never count.
 * @param {Session} s
 * @param {{day?: string|null}} [options]
 * @returns {ExpenseTotals}
 */
export function expenseTotals(s, {day = null} = {}) {
  /** @type {Record<string, number>} */
  const byCategory = Object.fromEntries(EXPENSE_CATEGORY_IDS.map(id => [id, 0]));
  const byMethod = {Cash: 0, UPI: 0};
  /** @type {Map<string, number>} */
  const byPayer = new Map();
  let total = 0;
  let count = 0;
  for (const e of Array.isArray(s.expenses) ? s.expenses : []) {
    if (e.void || (day !== null && dayOf(e.at) !== day)) continue;
    total += e.amount;
    count++;
    const cat = categoryId(e.category) || 'misc';
    byCategory[cat] += e.amount;
    if (e.method === 'UPI') byMethod.UPI += e.amount;
    else byMethod.Cash += e.amount;
    const payer = typeof e.paidBy === 'string' ? e.paidBy : DRAWER;
    byPayer.set(payer, (byPayer.get(payer) || 0) + e.amount);
  }
  return {
    total, count, byCategory, byMethod, byPayer: Object.fromEntries(byPayer),
    restock: byCategory.restock, preStall: byCategory['pre-stall'],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Team settlement — §16.3 "Settlement math"
// ---------------------------------------------------------------------------------------------------------------------

/** Round a percentage for display (2 decimals). @param {number} n */
const pct2 = n => Math.round(n * 100) / 100;

/**
 * Largest-remainder split of `total` paise in proportion to integer `weights`: the parts add up to `total` exactly; the
 * leftover paise go to the largest remainders, ties to the earlier member. BigInt keeps total × weight exact.
 * @param {number} total ≥ 0
 * @param {number[]} weights integers ≥ 0
 * @returns {number[]}
 */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(sum > 0)) return weights.map(() => 0);
  const T = BigInt(total);
  const W = BigInt(sum);
  /** @type {number[]} */
  const parts = [];
  /** @type {bigint[]} */
  const rems = [];
  for (const w of weights) {
    const n = T * BigInt(w);
    parts.push(Number(n / W));
    rems.push(n % W);
  }
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => (rems[b] > rems[a] ? 1 : rems[b] < rems[a] ? -1 : a - b));
  for (let k = 0; left > 0; k++, left--) parts[order[k]]++;
  return parts;
}

/**
 * The end-of-stall fair split (pure, integer paise, deterministic).
 * - revenue = whole-session collections (Cash + UPI + Other, net of refunds, incl. game fees);
 *   expenses = Σ non-void bills; a partner's capital = their contri + bills they paid from their pocket.
 *   Bills paid by 'drawer' — or by a partner who was since removed — come out of the pool.
 * - netProfit = revenue − expenses; pot = capital + netProfit (= Σ contri − drawer bills + revenue).
 * - Step 1, capital recovery: pot ≥ capital → everyone gets their capital back; 0 < pot < capital → the pot is shared in
 *   proportion to capital; pot ≤ 0 → nothing.
 * - Step 2, profit (only when netProfit > 0): split equally, or by custom % shares. Custom shares that are missing or don't add
 *   up to exactly 100 fall back to an equal split with a warning. Partners who put nothing in still get their profit share.
 * - Both steps use largest-remainder rounding (ties → member order), so Σ payout = max(pot, 0) whenever there is a partner.
 * Contri from a partner who is no longer on the team is left out (with a warning); totals.recoveryPct is 100 when nobody
 * put money in and the pot isn't negative.
 * @param {Session} s
 * @param {Config} c
 * @returns {SettlementResult}
 */
export function teamSettlement(s, c) {
  const members = membersOf(c);
  const n = members.length;
  /** @type {Map<string, number>} */
  const index = new Map(members.map((m, i) => [m.id, i]));
  const contri = members.map(() => 0);
  const bills = members.map(() => 0);
  /** @type {string[]} */
  const warnings = [];

  let revenue = 0;
  for (const p of s.payments) revenue += p.amount;
  let expenses = 0;
  let drawerBills = 0;
  let removedBills = 0;
  for (const e of s.expenses) {
    if (e.void) continue;
    expenses += e.amount;
    const i = e.paidBy === DRAWER ? undefined : index.get(e.paidBy);
    if (i === undefined) {
      drawerBills += e.amount;
      if (e.paidBy !== DRAWER) removedBills += e.amount;
    } else {
      bills[i] += e.amount;
    }
  }
  let orphanContri = 0;
  for (const x of s.contributions || []) {
    if (x.void) continue;
    const i = index.get(x.memberId);
    if (i === undefined) orphanContri += x.amount;
    else contri[i] += x.amount;
  }

  const capitals = members.map((_, i) => contri[i] + bills[i]);
  const capital = capitals.reduce((a, b) => a + b, 0);
  const totalContri = contri.reduce((a, b) => a + b, 0);
  const pocketBills = bills.reduce((a, b) => a + b, 0);
  const netProfit = revenue - expenses;
  const pot = capital + netProfit;

  // Step 1 — capital recovery.
  const recovery = pot >= capital ? capitals.slice() : pot > 0 ? allocate(pot, capitals) : capitals.map(() => 0);

  // Step 2 — profit shares.
  const team = isObj(c?.team) ? c.team : {members: [], splitMode: 'equal'};
  let splitMode = team.splitMode === 'custom' ? 'custom' : 'equal';
  if (splitMode === 'custom' && n) {
    const valid = members.every(m => isInt(m.share) && m.share <= 100);
    const sum = members.reduce((a, m) => a + (isInt(m.share) ? m.share : 0), 0);
    if (!valid || sum !== 100) {
      splitMode = 'equal';
      warnings.push(valid
        ? `Custom shares add up to ${sum}%, not 100% — the profit is split equally until you fix them in Studio › Team.`
        : 'Some partners have no custom share — the profit is split equally until you set every share in Studio › Team.');
    }
  }
  const weights = splitMode === 'custom' ? members.map(m => /** @type {number} */ (m.share)) : members.map(() => 1);
  const profitShare = netProfit > 0 && n ? allocate(netProfit, weights) : members.map(() => 0);

  if (!n) warnings.push('No partners yet — add your team in Studio › Team to split the money.');
  if (pot < 0) {
    warnings.push(`Bills paid from the stall drawer are ${money(-pot)} more than the money that came in (contri + sales). ` +
      'If a partner covered the gap from their pocket, record it as a bill paid by them.');
  }
  if (removedBills) warnings.push(`${money(removedBills)} of bills were paid by a removed partner — counted as paid from the stall drawer.`);
  if (orphanContri) warnings.push(`${money(orphanContri)} of contri came from a removed partner and is not counted. Void it or add them back.`);

  const recovered = recovery.reduce((a, b) => a + b, 0);
  return {
    members: members.map((m, i) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      sharePct: splitMode === 'custom' ? /** @type {number} */ (m.share) : pct2(100 / n),
      contri: contri[i],
      bills: bills[i],
      capital: capitals[i],
      capitalPct: capital > 0 ? pct2((capitals[i] * 100) / capital) : 0,
      recovery: recovery[i],
      profitShare: profitShare[i],
      payout: recovery[i] + profitShare[i],
    })),
    totals: {
      contri: totalContri,
      pocketBills,
      drawerBills,
      expenses,
      capital,
      revenue,
      netProfit,
      pot,
      inProfit: netProfit > 0,
      recoveryPct: capital > 0 ? pct2(clamp((recovered * 100) / capital, 0, 100)) : pot >= 0 ? 100 : 0,
    },
    splitMode: /** @type {'equal'|'custom'} */ (splitMode),
    warnings,
  };
}

/**
 * WhatsApp-ready team settlement (§16.3).
 * @param {Session} s
 * @param {Config} c
 * @param {{now?: ISO}} [options]
 * @returns {string}
 */
export function settlementText(s, c, {now = nowIso()} = {}) {
  const r = teamSettlement(s, c);
  const t = r.totals;
  const p = c.profile;
  const et = expenseTotals(s);
  const lines = [
    `*🤝 ${p.stallName} — Team settlement*`,
    [p.booth, p.eventName, dayLabel(istDate(now))].filter(Boolean).join(' · '),
    `💰 Revenue: ${money(t.revenue)}`,
  ];
  const cats = EXPENSE_CATEGORIES.filter(x => et.byCategory[x.id] > 0).map(x => `${x.emoji} ${x.label} ${money(et.byCategory[x.id])}`);
  lines.push(cats.length ? `🧾 Bills: ${money(t.expenses)} (${cats.join(' · ')})` : '🧾 Bills: none recorded');
  lines.push(t.netProfit >= 0 ? `📈 Net profit: ${money(t.netProfit)}` : `📉 Net loss: ${money(-t.netProfit)}`);
  lines.push(`👥 Money put in: ${money(t.capital)} (contri ${money(t.contri)} + bills paid by partners ${money(t.pocketBills)})`);
  lines.push(`💼 To split: ${money(Math.max(t.pot, 0))}`);
  for (const m of r.members) {
    lines.push(`• ${m.name} — put in ${money(m.capital)} → back ${money(m.recovery)} + profit ${money(m.profitShare)} = *${money(m.payout)}*`);
  }
  lines.push(r.splitMode === 'custom'
    ? `⚖️ Profit split: custom (${r.members.map(m => `${m.name} ${m.sharePct}%`).join(' · ')})`
    : '⚖️ Profit split: equal');
  for (const w of r.warnings) lines.push(`⚠️ ${w}`);
  lines.push('_A fair-split calculator, not accounting or tax advice. UPI money lands in the UPI account holder’s bank._');
  lines.push(`_Sent from ${BRAND.name} (${BRAND.short})_`);
  return lines.join('\n');
}

/**
 * Save an immutable snapshot of the current settlement (result deep-copied + its text). Audits 'settlement-saved'.
 * @param {Session} s
 * @param {Config} c
 * @param {ISO} [now]
 * @returns {SettlementSnapshot}
 */
export function saveSettlement(s, c, now = nowIso()) {
  const result = structuredClone(teamSettlement(s, c));
  /** @type {SettlementSnapshot} */
  const snap = {id: uuid(), at: now, operator: c.operator, result, text: settlementText(s, c, {now})};
  s.settlements ??= [];
  s.settlements.push(snap);
  audit(s, 'settlement-saved', snap.id, c.operator, {pot: result.totals.pot, netProfit: result.totals.netProfit}, now);
  return snap;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stall themes & media references
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Apply a stall theme's look (accent, secondary, hero art/tint/pattern) from buildTemplate(themeId).theme. The owner's hero
 * photo is kept when `keepPhoto`. `menu: true` also swaps in that template's menu via applyTemplate (sales history stays).
 * Audits 'theme-applied' in the current session.
 * @param {State} state
 * @param {string} themeId
 * @param {{menu?: boolean, withPrices?: boolean, keepPhoto?: boolean}} [options]
 * @param {ISO} [now]
 */
export function applyTheme(state, themeId, {menu = false, withPrices = true, keepPhoto = true} = {}, now = nowIso()) {
  const t = /** @type {any} */ (buildTemplate(themeId, {withPrices}));
  if (!isObj(t.theme)) throw Error('This stall theme has no look yet. Try another one.');
  if (menu) applyTemplate(state, themeId, {withPrices}, now);
  const old = isObj(state.config.theme) ? state.config.theme : {accent: '#FFDD35'};
  state.config.theme = themeOf(t, keepPhoto ? old.heroImage ?? null : null);
  audit(state[state.mode], 'theme-applied', t.templateId, state.config.operator, {themeId: t.templateId, menu, withPrices, keepPhoto}, now);
}

/**
 * Every media id (without the 'media:' prefix) the stall still references: product photos, the theme's hero photo and bill
 * photos in both ledgers (voided bills included — they stay for audit). storage.pruneMedia keeps all of them.
 * Tolerates partial / unmigrated data.
 * @param {any} state
 * @returns {Set<string>}
 */
export function referencedMedia(state) {
  /** @type {Set<string>} */
  const ids = new Set();
  const add = (/** @type {unknown} */ ref) => {
    if (typeof ref === 'string' && MEDIA_RE.test(ref)) ids.add(ref.slice('media:'.length));
  };
  const c = isObj(state) ? state.config : null;
  for (const p of Array.isArray(c?.products) ? c.products : []) add(p?.image);
  add(c?.theme?.heroImage);
  for (const mode of ['live', 'demo']) {
    const list = isObj(state) && isObj(state[mode]) ? state[mode].expenses : null;
    for (const e of Array.isArray(list) ? list : []) add(e?.billImage);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------------------------------

/**
 * All dashboard numbers in one linear pass over orders + payments. `day` ('YYYY-MM-DD', IST) scopes the sales metrics;
 * the mission block is always whole-session.
 * @param {Session} s
 * @param {Config} c
 * @param {{day?: string|null}} [options]
 * @returns {Report}
 */
export function report(s, c, {day = null} = {}) {
  const inScope = (/** @type {string} */ at) => day === null || dayOf(at) === day;
  /** @type {Map<string, 'order'|'game'>} */
  const kindOf = new Map();
  for (const o of s.orders) kindOf.set(o.id, 'order');
  for (const g of s.games) kindOf.set(g.id, 'game');

  /** @type {Map<string, number>} */
  const net = new Map();
  /** @type {Map<string, number>} */
  const hourly = new Map();
  const methods = {Cash: 0, UPI: 0, Other: 0};
  let allCollected = 0;
  let collected = 0;
  let food = 0;
  let gameIncome = 0;
  let refunds = 0;
  for (const p of s.payments) {
    net.set(p.entityId, (net.get(p.entityId) || 0) + p.amount);
    allCollected += p.amount;
    if (!inScope(p.at)) continue;
    collected += p.amount;
    if (hasOwn(methods, p.method)) methods[p.method] += p.amount;
    const kind = kindOf.get(p.entityId);
    if (kind === 'order') food += p.amount;
    else if (kind === 'game') gameIncome += p.amount;
    if (p.amount < 0) refunds -= p.amount;
    const h = hourOf(p.at);
    hourly.set(h, (hourly.get(h) || 0) + p.amount);
  }

  let orders = 0;
  let units = 0;
  let eligibleNet = 0;
  let gross = 0;
  let discounts = 0;
  const pending = {count: 0, amount: 0};
  /** @type {Map<string, {productId: string, name: string, units: number, revenue: number}>} */
  const best = new Map();
  /** @type {Map<string, number>} */
  const categories = new Map();
  /** @type {Map<string, {count: number, amount: number}>} */
  const discountUses = new Map();
  for (const o of s.orders) {
    if (!inScope(o.at)) continue;
    if (o.status === 'pending') {
      pending.count++;
      pending.amount += o.total;
      continue;
    }
    gross += o.subtotal;
    discounts += o.discount;
    if (o.discount > 0) {
      const label = o.discountInfo?.label || 'Discount';
      const use = discountUses.get(label) || {count: 0, amount: 0};
      use.count++;
      use.amount += o.discount;
      discountUses.set(label, use);
    }
    if (o.status !== 'paid' && o.status !== 'partial') continue;
    orders++;
    eligibleNet += net.get(o.id) || 0;
    for (const l of o.items) {
      units += l.quantity;
      const b = best.get(l.productId) || {productId: l.productId, name: l.name, units: 0, revenue: 0};
      b.name = l.name;
      b.units += l.quantity;
      b.revenue += l.lineTotal;
      best.set(l.productId, b);
      categories.set(l.category, (categories.get(l.category) || 0) + l.lineTotal);
    }
  }

  let games = 0;
  for (const g of s.games) if (!g.void && inScope(g.at)) games++;
  const scopedBills = expenseTotals(s, {day});
  let bills = 0;
  let restock = 0;
  for (const e of s.expenses) {
    if (e.void) continue;
    bills += e.amount;
    if (e.category === 'restock') restock += e.amount;
  }

  // Ledger mode: the break-even *is* the bills. Planned modes: planned investment + bills (Phase-1 semantics).
  const mode = c.mission?.mode === 'ledger' || c.mission?.mode === 'itemized' ? c.mission.mode : 'total';
  const planned = mode === 'ledger' ? 0 : missionTarget(c) || 0;
  const investment = mode === 'ledger' ? bills : planned;
  const extraExpenses = mode === 'ledger' ? 0 : bills;
  const target = investment + extraExpenses;
  const hasTarget = target > 0;
  const recovery = hasTarget ? (allCollected * 100) / target : 0;
  return {
    scope: day === null ? 'all' : day,
    collected,
    food,
    gameIncome,
    methods,
    orders,
    units,
    average: orders ? Math.round(eligibleNet / orders) : 0,
    gross,
    discounts,
    refunds,
    games,
    expenses: scopedBills.total,
    expenseTotals: scopedBills,
    pending,
    best: [...best.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    categories: Object.fromEntries(categories),
    hourly: Object.fromEntries([...hourly].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    discountUses: Object.fromEntries(discountUses),
    mission: {
      investment,
      extraExpenses,
      target,
      collected: allCollected,
      remaining: Math.max(0, target - allCollected),
      profit: allCollected - target,
      percent: hasTarget ? clamp(recovery, 0, 100) : 0,
      recovery,
      profitMode: hasTarget && allCollected >= target,
      hasTarget,
      mode,
      planned,
      bills,
      restock,
    },
  };
}

/**
 * Is a milestone reached for this report? (Recovery uses exact integer arithmetic.)
 * @param {Milestone} m
 * @param {Report} r
 */
function milestoneReached(m, r) {
  switch (m.type) {
    case 'orders': return r.orders >= m.target;
    case 'revenue': return r.collected >= m.target;
    case 'recovery': return r.mission.hasTarget && r.mission.collected * 100 >= m.target * r.mission.target;
    case 'items': return r.units >= m.target;
    case 'games': return r.games >= m.target;
    default: return false;
  }
}

/**
 * Re-evaluate the configured milestones against the whole session. Reversals can deactivate a milestone; the first
 * unlock time and reference are kept.
 * @param {Session} s
 * @param {Config} c
 * @param {ISO} [now]
 * @returns {Record<string, boolean>}
 */
export function refreshMilestones(s, c, now = nowIso()) {
  const r = report(s, c);
  /** @type {Record<string, boolean>} */
  const result = {};
  const lastOrder = s.orders.length ? s.orders[s.orders.length - 1].id : null;
  let lastGame = null;
  for (let i = s.games.length - 1; i >= 0; i--) {
    if (!s.games[i].void) {
      lastGame = s.games[i].id;
      break;
    }
  }
  s.milestones ??= {};
  for (const m of c.milestones || []) {
    const active = milestoneReached(m, r);
    const old = hasOwn(s.milestones, m.id) ? s.milestones[m.id] : undefined;
    const reference = m.type === 'games' ? lastGame : lastOrder;
    s.milestones[m.id] = {
      active,
      unlockedAt: old?.unlockedAt || (active ? now : null),
      reference: old?.reference || (active ? reference : null),
      updatedAt: old && old.active === active ? old.updatedAt : now,
    };
    result[m.id] = active;
  }
  return result;
}

/**
 * Progress towards one milestone, with display labels (₹ for revenue, % for recovery).
 * @param {Milestone} m
 * @param {Report} r
 * @returns {{value: number, goal: number, ratio: number, done: boolean, valueLabel: string, goalLabel: string}}
 */
export function milestoneProgress(m, r) {
  const goal = m.target;
  let value = 0;
  if (m.type === 'orders') value = r.orders;
  else if (m.type === 'revenue') value = r.collected;
  else if (m.type === 'recovery') value = r.mission.hasTarget ? r.mission.recovery : 0;
  else if (m.type === 'items') value = r.units;
  else if (m.type === 'games') value = r.games;
  const done = milestoneReached(m, r);
  const ratio = done ? 1 : goal > 0 ? clamp(value / goal, 0, 1) : 0;
  const label = (/** @type {number} */ n) => (m.type === 'revenue' ? money(n) : m.type === 'recovery' ? `${Math.floor(n)}%` : String(n));
  return {value, goal, ratio, done, valueLabel: label(value), goalLabel: label(goal)};
}

/**
 * UPI deep link for a QR code, or null when the stall has no UPI id.
 * @param {Config} c
 * @param {Paise} amount
 * @param {string} [note]
 * @returns {string|null}
 */
export function upiUri(c, amount, note = '') {
  if (!c.upi?.id) return null;
  if (!isInt(amount, 1)) throw Error('The UPI amount must be at least ₹0.01.');
  const enc = encodeURIComponent;
  const payee = c.upi.payeeName || c.profile.stallName;
  return `upi://pay?pa=${enc(c.upi.id)}&pn=${enc(payee)}&am=${(amount / 100).toFixed(2)}&cu=INR` + (note ? `&tn=${enc(note)}` : '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-04' → '4 Nov 2026'. @param {string} day */
function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * WhatsApp-ready summary (§13.4). Sales lines and the bills line (§16.3, only when there are bills in scope) follow the
 * scope; break-even lines are always whole-event. Ledger mode says "(all bills so far)" instead of investment + extra costs.
 * @param {Session} s
 * @param {Config} c
 * @param {{day?: string|null, now?: ISO}} [options]
 * @returns {string}
 */
export function dayReportText(s, c, {day = null, now = nowIso()} = {}) {
  const r = report(s, c, {day});
  const m = r.mission;
  const p = c.profile;
  const when = day ? dayLabel(day) : `Whole event till ${dayLabel(istDate(now))}`;
  const lines = [
    `*🧾 ${p.stallName} — Day report*`,
    [p.booth, p.eventName, when].filter(Boolean).join(' · '),
    `💰 Collected: ${money(r.collected)}  (💵 Cash ${money(r.methods.Cash)} · 📲 UPI ${money(r.methods.UPI)} · Other ${money(r.methods.Other)})`,
    `🧾 Orders: ${r.orders} · Items: ${r.units} · Avg: ${money(r.average)}`,
  ];
  if (r.expenseTotals.count) lines.push(`🧾 Bills: ${money(r.expenseTotals.total)} (restock ${money(r.expenseTotals.restock)})`);
  if (m.hasTarget) {
    lines.push(m.mode === 'ledger'
      ? `🎯 Break-even: ${money(m.target)} (all bills so far)`
      : `🎯 Break-even: ${money(m.target)} (investment ${money(m.investment)} + extra costs ${money(m.extraExpenses)})`);
    lines.push(m.profitMode
      ? `🔥 PROFIT MODE: ${money(m.profit)} profit`
      : `📈 Recovered: ${Math.floor(m.percent)}% — ${money(m.remaining)} to go`);
  } else {
    lines.push('🎯 Break-even: not set yet');
  }
  if (r.best.length) {
    lines.push('🏆 Top sellers:');
    r.best.slice(0, 3).forEach((b, i) => lines.push(`${i + 1}. ${b.name} — ${b.units} sold`));
  } else {
    lines.push('🏆 Top sellers: none yet');
  }
  if (r.games > 0 || r.gameIncome !== 0) lines.push(`🎮 Games: ${plural(r.games, 'play')} · ${money(r.gameIncome)} fees`);
  if (r.pending.count) lines.push(`⏳ Pending: ${plural(r.pending.count, 'order')} · ${money(r.pending.amount)}`);
  lines.push(`_Sent from ${BRAND.name} (${BRAND.short})_`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Itemized orders: one row per line item. Amounts in rupees ("160.00").
 * @param {Session} s
 * @returns {string[][]}
 */
export function ordersCsvRows(s) {
  const rows = [[
    'Order', 'Token', 'Time (IST)', 'Status', 'Kitchen', 'Method', 'Operator', 'Item', 'Category', 'Size', 'Flavour', 'Add-ons',
    'Item note', 'Quantity', 'Unit price', 'Line total', 'Order subtotal', 'Order discount', 'Discount', 'Order total', 'Order note', 'Order ID',
  ]];
  for (const o of s.orders) {
    for (const l of o.items) {
      rows.push([
        String(o.number), tokenLabel(o.token), istStamp(o.at), o.status, o.kitchen, o.method, o.operator, l.name, l.category, l.size,
        l.flavour, (l.addons || []).map(a => `${a.name} (${rupees(a.price)})`).join('; '), l.note || '', String(l.quantity),
        rupees(l.unitPrice), rupees(l.lineTotal), rupees(o.subtotal), rupees(o.discount), o.discountInfo?.label || '', rupees(o.total),
        o.note || '', o.id,
      ]);
    }
  }
  return rows;
}

/**
 * One row per order with payment details and net collected.
 * @param {Session} s
 * @returns {string[][]}
 */
export function orderSummaryCsvRows(s) {
  /** @type {Map<string, {net: number, refunded: number}>} */
  const ledger = new Map();
  for (const p of s.payments) {
    const m = ledger.get(p.entityId) || {net: 0, refunded: 0};
    m.net += p.amount;
    if (p.amount < 0) m.refunded -= p.amount;
    ledger.set(p.entityId, m);
  }
  const rows = [[
    'Order', 'Token', 'Token day', 'Time (IST)', 'Status', 'Kitchen', 'Method', 'Cash part', 'UPI part', 'Items', 'Units', 'Subtotal',
    'Discount', 'Discount label', 'Total', 'Net collected', 'Refunded', 'Cash received', 'Change', 'Note', 'Operator', 'Order ID',
  ]];
  for (const o of s.orders) {
    const m = ledger.get(o.id) || {net: 0, refunded: 0};
    rows.push([
      String(o.number), tokenLabel(o.token), o.tokenDay || '', istStamp(o.at), o.status, o.kitchen, o.method,
      o.split ? rupees(o.split.Cash) : '', o.split ? rupees(o.split.UPI) : '',
      o.items.map(l => `${l.quantity} x ${l.name}`).join('; '), String(o.items.reduce((n, l) => n + l.quantity, 0)),
      rupees(o.subtotal), rupees(o.discount), o.discountInfo?.label || '', rupees(o.total), rupees(m.net), rupees(m.refunded),
      o.cashReceived === null || o.cashReceived === undefined ? '' : rupees(o.cashReceived), rupees(o.change || 0), o.note || '',
      o.operator, o.id,
    ]);
  }
  return rows;
}

/**
 * The money ledger: one row per payment / refund.
 * @param {Session} s
 * @returns {string[][]}
 */
export function paymentsCsvRows(s) {
  /** @type {Map<string, string>} */
  const label = new Map();
  for (const o of s.orders) label.set(o.id, `Order ${o.number}${o.token ? ` (${tokenLabel(o.token)})` : ''}`);
  for (const g of s.games) label.set(g.id, `Game: ${g.name}`);
  const rows = [['Payment ID', 'Time (IST)', 'Kind', 'For', 'Method', 'Amount', 'Entity ID']];
  for (const p of s.payments) rows.push([p.id, istStamp(p.at), p.kind, label.get(p.entityId) || '', p.method, rupees(p.amount), p.entityId]);
  return rows;
}

/** Display name of a bill payer. @param {Config} c @param {string} paidBy */
function payerName(c, paidBy) {
  if (paidBy === DRAWER) return 'Stall cash drawer';
  return membersOf(c).find(m => m.id === paidBy)?.name || 'Removed partner (counted as drawer)';
}

/**
 * The bills ledger: one row per bill (void bills included, marked VOID). Amounts in rupees.
 * @param {Session} s
 * @param {Config} c
 * @returns {string[][]}
 */
export function expensesCsvRows(s, c) {
  const rows = [['Time (IST)', 'Title', 'Category', 'Amount', 'Method', 'Paid by', 'Bill photo', 'Notes', 'Status', 'Void reason', 'Operator', 'Bill ID']];
  for (const e of s.expenses) {
    rows.push([
      istStamp(e.at), e.title, categoryLabel(e.category), rupees(e.amount), e.method, payerName(c, e.paidBy), e.billImage ? 'yes' : '',
      e.notes || '', e.void ? 'VOID' : 'ok', e.voidReason || '', e.operator, e.id,
    ]);
  }
  return rows;
}

/**
 * Team contri: one row per contribution (void ones included, marked VOID). Amounts in rupees.
 * @param {Session} s
 * @param {Config} c
 * @returns {string[][]}
 */
export function contributionsCsvRows(s, c) {
  const rows = [['Time (IST)', 'Partner', 'Amount', 'Method', 'Note', 'Status', 'Void reason', 'Operator', 'Contri ID']];
  for (const x of s.contributions || []) {
    const name = membersOf(c).find(m => m.id === x.memberId)?.name || 'Removed partner (not counted)';
    rows.push([istStamp(x.at), name, rupees(x.amount), x.method, x.note || '', x.void ? 'VOID' : 'ok', x.voidReason || '', x.operator, x.id]);
  }
  return rows;
}

/**
 * The current team settlement: one row per partner, a TOTAL row, then the stall totals and any warnings.
 * @param {Session} s
 * @param {Config} c
 * @returns {string[][]}
 */
export function settlementCsvRows(s, c) {
  const r = teamSettlement(s, c);
  const t = r.totals;
  const rows = [['Partner', 'Profit share %', 'Contri', 'Bills paid', 'Put in (capital)', 'Capital %', 'Capital back', 'Profit share', 'Payout']];
  for (const m of r.members) {
    rows.push([
      m.name, String(m.sharePct), rupees(m.contri), rupees(m.bills), rupees(m.capital), String(m.capitalPct), rupees(m.recovery),
      rupees(m.profitShare), rupees(m.payout),
    ]);
  }
  const sum = (/** @type {(m: SettlementMember) => number} */ f) => rupees(r.members.reduce((a, m) => a + f(m), 0));
  rows.push([
    'TOTAL', '', sum(m => m.contri), sum(m => m.bills), sum(m => m.capital), '', sum(m => m.recovery), sum(m => m.profitShare),
    sum(m => m.payout),
  ]);
  rows.push([]);
  rows.push(['Revenue', rupees(t.revenue)]);
  rows.push(['All bills', rupees(t.expenses)]);
  rows.push(['Bills from the drawer', rupees(t.drawerBills)]);
  rows.push(['Bills paid by partners', rupees(t.pocketBills)]);
  rows.push(['Net profit', rupees(t.netProfit)]);
  rows.push(['Money put in', rupees(t.capital)]);
  rows.push(['Pot to split', rupees(t.pot)]);
  rows.push(['Profit split', r.splitMode]);
  for (const w of r.warnings) rows.push(['Warning', w]);
  return rows;
}

/**
 * Serialize rows as Excel-friendly CSV: UTF-8 BOM, CRLF, every cell quoted, and spreadsheet formula injection neutralized
 * (text starting with = + - @ TAB CR gets a leading apostrophe; plain numbers such as "-20.00" stay numeric).
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function csv(rows) {
  const cell = (/** @type {unknown} */ v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Migration v1 → v2 (§14)
// ---------------------------------------------------------------------------------------------------------------------

const LEGACY_MILESTONES = Object.freeze([
  {id: 'spark', title: 'First Spark', type: 'orders', target: 1},
  {id: 'game', title: 'Game On', type: 'games', target: 1},
  {id: 'crowd', title: 'Crowd Magnet', type: 'orders', target: 50},
  {id: 'big', title: 'The Big Pataka', type: 'recovery', target: 100},
]);

/** @param {any} state */
function computeOnboarded(state) {
  const hasRecords = ['live', 'demo'].some(m => {
    const s = state[m];
    return s && ['orders', 'payments', 'games', 'expenses', 'contributions'].some(k => Array.isArray(s[k]) && s[k].length > 0);
  });
  const priced = (state.config?.products || []).some((/** @type {any} */ p) => p && p.price !== null && p.price !== undefined);
  return hasRecords || priced || !!state.pin;
}

/**
 * Convert a v1 (Packet Pataka) state in place.
 * @param {any} state
 */
function migrateV1(state) {
  const old = state.config || {};
  const promo = isInt(old.promo) ? old.promo : 0;
  const promoLabel = `Reel / banner ${money(promo)} off`;
  const v1Products = Array.isArray(old.products) ? old.products : [];
  const stock = isObj(old.stock) ? {...old.stock} : {};

  // Categories from distinct product categories, in order of first appearance.
  /** @type {Category[]} */
  const categories = [];
  /** @type {Map<string, string>} */
  const categoryIds = new Map();
  for (const p of v1Products) {
    const name = String(p.category || 'Menu').trim().slice(0, LIMITS.categoryName) || 'Menu';
    if (categoryIds.has(name.toLowerCase())) continue;
    let id = slug(name, 40);
    while (categories.some(c => c.id === id)) id = `${id}-x`;
    categoryIds.set(name.toLowerCase(), id);
    categories.push({id, name});
  }
  if (!categories.length) categories.push({id: 'menu', name: 'Menu'});

  const byId = new Map(v1Products.map((/** @type {any} */ p) => [p.id, p]));
  const addons = (Array.isArray(old.addons) ? old.addons : []).map((/** @type {any} */ a) => ({id: a.id, name: a.name, price: a.price}));
  // v1 text came from <textarea>/<input> fields without the v2 limits (textareas had no maxlength, the same line could be typed
  // twice, a preset's size was its base product's id): clip to the v2 limits by code point and de-duplicate.
  const clip = (/** @type {unknown} */ x, /** @type {number} */ max) => [...String(x ?? '').trim()].slice(0, max).join('').trim();
  const uniqueTexts = (/** @type {unknown} */ list, /** @type {number} */ max, /** @type {number} */ count) => [
    ...new Set((Array.isArray(list) ? list : []).filter(x => typeof x === 'string').map(x => clip(x, max)).filter(Boolean)),
  ].slice(0, count);
  /** @type {Product[]} */
  const products = v1Products.map((/** @type {any} */ p) => {
    let price = p.price ?? null;
    let stockKey = p.stockKey || '';
    if (p.base) {
      // Legacy preset: becomes a plain product priced base + preset add-ons (or unpriced).
      const base = byId.get(p.base);
      price = base && base.price !== null && base.price !== undefined ? base.price : null;
      for (const id of p.addons || []) {
        const addon = addons.find((/** @type {Addon} */ a) => a.id === id);
        if (!addon) price = null;
        else if (price !== null) price += addon.price;
      }
      if (!stockKey && base?.stockKey) stockKey = base.stockKey;
    }
    if (stockKey && !hasOwn(stock, stockKey)) stock[stockKey] = 0;
    const tint = p.tint === 'blue' ? 'sky' : TINT_IDS.includes(p.tint) ? p.tint : 'yellow';
    const bundle = Array.isArray(p.bundle)
      ? p.bundle.filter((/** @type {any} */ b) => byId.has(b.productId)).map((/** @type {any} */ b) => ({productId: b.productId, quantity: b.quantity}))
      : null;
    const name = String(p.category || 'Menu').trim().slice(0, LIMITS.categoryName) || 'Menu';
    return {
      id: p.id,
      name: p.name,
      subtitle: '',
      categoryId: /** @type {string} */ (categoryIds.get(name.toLowerCase())),
      // v1 save-product set a preset's size to its base id (e.g. a uuid); show the base product's size instead.
      size: clip(p.base ? byId.get(p.base)?.size ?? '' : p.size || '', LIMITS.size),
      price,
      priceLocked: false,
      art: p.art || 'packet',
      image: null,
      tint,
      pattern: 'none',
      tags: bundle && bundle.length ? ['COMBO'] : [],
      active: p.active !== false,
      soldOut: !!p.soldOut,
      customizable: !!p.custom,
      stockKey,
      stockUnits: isInt(p.stockUnits, 1) ? p.stockUnits : 1,
      bundle: bundle && bundle.length ? bundle : null,
    };
  });

  // The current operator always stays on the team list (v1 let it be any typed name); duplicates/over-long names are cleaned.
  const operators = uniqueTexts(old.operators, LIMITS.operator, CATALOG_LIMITS.operators);
  const operator = clip(old.operator, LIMITS.operator) || operators[0] || 'Team Stall';
  if (!operators.includes(operator)) {
    operators.length = Math.min(operators.length, CATALOG_LIMITS.operators - 1);
    operators.unshift(operator);
  }

  /** @type {Config} */
  const config = {
    schema: SCHEMA_VERSION,
    templateId: 'legacy',
    profile: {
      stallName: old.stallName || 'My Awesome Stall',
      booth: old.stallNumber ? `Stall No. ${old.stallNumber}` : '',
      tagline: 'Little packets. Big pataka energy.',
      subTagline: 'Good food. Fast orders. A fest to remember.',
      eventName: 'Diwali Celebration',
      venue: 'Baderia Global Institute',
      city: 'Jabalpur',
      eventDate: typeof old.eventDate === 'string' && DATE_RE.test(old.eventDate) ? old.eventDate : '',
      ownerName: operator,
      initials: '',
    },
    theme: {accent: HEX_RE.test(old.accent || '') ? old.accent : '#FFDD35'},
    upi: {id: '', payeeName: ''},
    operator,
    operators,
    kitchenQueue: true,
    allowCustomDiscount: false,
    inventory: !!old.inventory,
    stock,
    categories,
    products,
    addons,
    flavours: uniqueTexts(old.flavours, LIMITS.flavour, CATALOG_LIMITS.flavours),
    games: (Array.isArray(old.games) ? old.games : []).map((/** @type {any} */ g) => ({
      id: g.id, name: g.name, fee: g.fee, art: /wheel/i.test(`${g.id} ${g.name}`) ? 'spin-wheel' : 'lucky-cup',
    })),
    discounts: promo > 0
      ? [{id: 'promo', label: promoLabel, type: 'flat', value: promo, minimum: isInt(old.promoMinimum) ? old.promoMinimum : 0, active: true}]
      : [],
    mission: {mode: 'total', total: isInt(old.target) ? old.target : 0, items: []},
    milestones: LEGACY_MILESTONES.map(m => ({...m, type: /** @type {Milestone['type']} */ (m.type)})),
  };

  for (const mode of ['live', 'demo']) {
    const s = state[mode];
    if (!isObj(s)) continue;
    s.draftDiscount = s.draftPromo && promo > 0 ? {ruleId: 'promo'} : null;
    delete s.draftPromo;
    s.draftNote = '';
    s.tokenDay = null;
    s.tokenSeq = 0;
    // v1 wrote a ₹0 'order' payment row for every ₹0 sale (promo ≥ subtotal) and for markPaid on one; v2 never writes ₹0
    // rows and validateBackup rejects them. They carry no money, so they are dropped (collections are unchanged).
    if (Array.isArray(s.payments)) s.payments = s.payments.filter((/** @type {any} */ p) => !(isObj(p) && p.amount === 0));
    // v1 stored `reference: undefined` when a milestone unlocked with no order yet (e.g. "big" reached by game fees alone).
    if (isObj(s.milestones)) {
      for (const m of Object.values(s.milestones)) {
        if (!isObj(m)) continue;
        if (typeof m.reference !== 'string') m.reference = null;
        if (typeof m.unlockedAt !== 'string') m.unlockedAt = null;
      }
    }
    for (const o of Array.isArray(s.orders) ? s.orders : []) {
      if (!isObj(o)) continue;
      o.token = null;
      o.tokenDay = null;
      // The promo rule only describes orders that got exactly what today's promo would give; an order discounted under an
      // earlier promo amount keeps the amount it actually got (v1 kept no snapshot).
      const current = promo > 0 && o.discount === Math.min(promo, o.subtotal);
      o.discountInfo = o.discount > 0
        ? current
          ? {id: 'promo', label: promoLabel, type: 'flat', value: promo}
          : {id: null, label: `Reel / banner ${money(o.discount)} off`, type: 'flat', value: o.discount}
        : null;
      o.note = '';
      o.split = null;
      o.kitchen = 'handed';
      o.kitchenAt = {};
    }
  }
  state.onboarded = computeOnboarded(state);
  state.config = config;
  state.version = SCHEMA_VERSION;
}

/**
 * The built template for a stored templateId, or null when it is not a known template ('legacy', removed ids…).
 * @param {unknown} templateId
 */
function knownTemplate(templateId) {
  if (typeof templateId !== 'string' || templateId === 'legacy') return null;
  try {
    return /** @type {any} */ (buildTemplate(templateId));
  } catch {
    return null;
  }
}

/**
 * Phase-2 theme defaults (§16.1): themeId = the template id if it is a known template, else 'custom'; heroArt from the
 * template's theme (legacy stalls: packet, pizza, cold); secondary #FF4D87, heroTint yellow, heroPattern sunburst, no photo.
 * @param {any} c
 */
function fillTheme(c) {
  if (!isObj(c.theme)) c.theme = {accent: '#FFDD35'};
  const th = c.theme;
  th.accent ??= '#FFDD35';
  if (th.themeId === undefined || th.heroArt === undefined) {
    const t = knownTemplate(c.templateId);
    th.themeId ??= t ? t.templateId : 'custom';
    th.heroArt ??= t && isObj(t.theme) && Array.isArray(t.theme.heroArt) ? t.theme.heroArt.slice(0, 3) : [...LEGACY_HERO_ART];
  }
  th.secondary ??= '#FF4D87';
  th.heroTint ??= 'yellow';
  th.heroPattern ??= 'sunburst';
  th.heroImage ??= null;
}

/**
 * Upgrade a Phase-1 / v1 expense `{category, amount, description}` to the Phase-2 bill shape in place (§16.1), and fill
 * any missing bill field. A non-string description is left alone so validateBackup rejects the record.
 * @param {any} e
 */
function upgradeExpense(e) {
  if (!isObj(e)) return;
  if (e.title === undefined && (e.description === undefined || e.description === null || typeof e.description === 'string')) {
    const legacy = legacyTitle(String(e.description ?? '').trim());
    e.title = legacy.title;
    if (legacy.notes) e.notes ??= legacy.notes;
    delete e.description;
  }
  if (!EXPENSE_CATEGORY_IDS.includes(e.category)) {
    const mapped = categoryId(e.category);
    if (mapped || typeof e.category === 'string' || e.category === undefined) e.category = mapped || 'misc';
  }
  e.method ??= 'Cash';
  e.paidBy ??= DRAWER;
  e.billImage ??= null;
  e.notes ??= '';
  e.void ??= false;
}

/**
 * Fill any missing optional v2 fields (never overwrites present values, so it is idempotent).
 * @param {any} state
 */
function fillV2(state) {
  state.revision ??= 0;
  if (state.mode !== 'live' && state.mode !== 'demo') state.mode = 'live';
  state.onboarded ??= computeOnboarded(state);
  state.pin ??= null;
  const c = state.config;
  c.schema ??= SCHEMA_VERSION;
  c.templateId ??= 'legacy';
  c.profile ??= {};
  for (const k of ['stallName', 'booth', 'tagline', 'subTagline', 'eventName', 'venue', 'city', 'eventDate', 'ownerName', 'initials']) c.profile[k] ??= '';
  fillTheme(c);
  c.upi ??= {id: '', payeeName: ''};
  c.upi.payeeName ??= '';
  c.operators ??= [];
  c.operator ??= c.operators[0] || 'Team Stall';
  if (!c.operators.length) c.operators.push(c.operator);
  c.kitchenQueue ??= true;
  c.allowCustomDiscount ??= false;
  c.inventory ??= false;
  c.stock ??= {};
  c.categories ??= [];
  c.products ??= [];
  for (const p of c.products) {
    if (!isObj(p)) continue;
    p.subtitle ??= '';
    p.size ??= '';
    p.price ??= null;
    p.priceLocked ??= false;
    p.art ??= 'packet';
    p.image ??= null;
    p.tint ??= 'yellow';
    p.pattern ??= 'none';
    p.tags ??= [];
    p.active ??= true;
    p.soldOut ??= false;
    p.customizable ??= false;
    p.stockKey ??= '';
    p.stockUnits ??= 1;
    p.bundle ??= null;
  }
  c.addons ??= [];
  c.flavours ??= [];
  c.games ??= [];
  for (const g of c.games) if (isObj(g)) g.art ??= 'lucky-cup';
  c.discounts ??= [];
  c.mission ??= {mode: 'total', total: 0, items: []};
  c.mission.items ??= [];
  c.milestones ??= [];
  if (!isObj(c.team)) c.team = {members: [], splitMode: 'equal'};
  c.team.members ??= [];
  c.team.splitMode ??= 'equal';
  for (const mode of ['live', 'demo']) {
    if (!isObj(state[mode])) state[mode] = session();
    const s = state[mode];
    s.started ??= false;
    for (const k of ['orders', 'payments', 'games', 'expenses', 'contributions', 'settlements', 'audit', 'draft']) s[k] ??= [];
    if (Array.isArray(s.expenses)) for (const e of s.expenses) upgradeExpense(e);
    if (Array.isArray(s.contributions)) {
      for (const x of s.contributions) {
        if (!isObj(x)) continue;
        x.method ??= 'Cash';
        x.note ??= '';
        x.void ??= false;
      }
    }
    s.milestones ??= {};
    s.draftId ??= uuid();
    s.draftDiscount ??= null;
    s.draftNote ??= '';
    s.tokenDay ??= null;
    s.tokenSeq ??= 0;
    const fillLine = (/** @type {any} */ l) => {
      if (!isObj(l)) return;
      l.note ??= '';
      l.size ??= '';
      l.flavour ??= '';
      l.addons ??= [];
      l.stock ??= {};
      l.bundle ??= null;
    };
    for (const l of Array.isArray(s.draft) ? s.draft : []) fillLine(l);
    for (const o of Array.isArray(s.orders) ? s.orders : []) {
      if (!isObj(o)) continue;
      o.token ??= null;
      o.tokenDay ??= null;
      o.discountInfo ??= null;
      o.note ??= '';
      o.split ??= null;
      o.kitchen ??= 'handed';
      o.kitchenAt ??= {};
      o.cashReceived ??= null;
      o.change ??= 0;
      for (const l of Array.isArray(o.items) ? o.items : []) fillLine(l);
    }
  }
}

/**
 * Bring saved data to schema v2 (in place; returns the same object). v1 → v2 per §14; v2 only gains missing optional
 * fields. Idempotent.
 * @param {any} state
 * @returns {State}
 */
export function migrate(state) {
  if (!isObj(state) || !isObj(state.config)) throw Error('This saved data is not a ManageYourStall stall.');
  if (state.version === 1) migrateV1(state);
  else if (state.version !== SCHEMA_VERSION) throw Error('This saved data is from an unknown app version.');
  for (const k of ['menuVersion', 'promo', 'promoMinimum', 'target', 'stallName', 'stallNumber', 'eventDate', 'accent']) delete state.config[k];
  fillV2(state);
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------------------------------------------------

const MEDIA_DATA_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_MEDIA_BYTES = 1.5 * 1024 * 1024;
const MAX_MEDIA_TOTAL = 40 * 1024 * 1024;

/**
 * Wrap the whole stall (state + uploaded images) for a JSON download.
 * @param {State} state
 * @param {MediaMap} [media]
 */
export function exportBackup(state, media = {}) {
  return {
    app: BRAND.name,
    format: 'mys-backup',
    version: SCHEMA_VERSION,
    exportedAt: nowIso(),
    state: structuredClone(state),
    media: {...(media || {})},
  };
}

/**
 * Decoded byte size of a base64 payload.
 * @param {string} b64
 */
function base64Bytes(b64) {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Ledger-critical config checks (validateConfig does the deep validation; these protect the money maths regardless).
 * @param {any} c
 * @param {(msg: string) => never} fail
 */
function checkLedgerConfig(c, fail) {
  if (!isObj(c)) fail('the stall settings are missing.');
  for (const k of ['categories', 'products', 'addons', 'flavours', 'games', 'discounts', 'milestones', 'operators']) {
    if (!Array.isArray(c[k])) fail(`the stall settings are incomplete (${k}).`);
  }
  const seen = new Set();
  for (const p of c.products) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id) || seen.has(p.id)) fail('a menu item has a missing or duplicate id.');
    seen.add(p.id);
    if (typeof p.name !== 'string') fail('a menu item has no name.');
    if (p.price !== null && (!isInt(p.price) || p.price > 100000000)) fail(`"${p.name}" has an invalid price.`);
    if (!isInt(p.stockUnits, 1)) fail(`"${p.name}" has invalid stock units.`);
  }
  for (const a of c.addons) if (!isObj(a) || !isInt(a.price)) fail('an add-on has an invalid price.');
  for (const g of c.games) if (!isObj(g) || !isInt(g.fee)) fail('a game has an invalid fee.');
  for (const d of c.discounts) {
    if (!isObj(d) || (d.type !== 'flat' && d.type !== 'percent') || !isInt(d.value, 1) || (d.type === 'percent' && d.value > 100) || !isInt(d.minimum)) {
      fail('a discount rule is invalid.');
    }
  }
  if (!isObj(c.stock) || Object.values(c.stock).some(n => !isInt(n))) fail('the stock room has invalid counts.');
  if (!isObj(c.mission)) fail('the mission is missing.');
  if (!c.operators.length || typeof c.operator !== 'string' || !c.operator) fail('the team list is empty.');
}

/**
 * Deep-check one ledger against the §2 invariants.
 * @param {any} s
 * @param {string} mode
 * @param {(msg: string) => never} fail
 */
function checkSession(s, mode, fail) {
  const where = mode === 'demo' ? 'practice ledger' : 'live ledger';
  if (!isObj(s)) fail(`the ${where} is missing.`);
  for (const k of ['orders', 'payments', 'games', 'expenses', 'contributions', 'settlements', 'audit', 'draft']) {
    if (!Array.isArray(s[k])) fail(`the ${where} is incomplete (${k}).`);
  }
  if (!isObj(s.milestones)) fail(`the ${where} milestones are invalid.`);
  if (typeof s.draftId !== 'string' || !ID_RE.test(s.draftId)) fail(`the ${where} cart id is invalid.`);
  if (typeof s.draftNote !== 'string' || s.draftNote.length > LIMITS.note) fail(`the ${where} cart note is invalid.`);
  if (s.tokenDay !== null && !(typeof s.tokenDay === 'string' && DATE_RE.test(s.tokenDay))) fail(`the ${where} token day is invalid.`);
  if (!isInt(s.tokenSeq)) fail(`the ${where} token counter is invalid.`);
  if (typeof s.started !== 'boolean') fail(`the ${where} start flag is invalid.`);
  const dd = s.draftDiscount;
  if (dd !== null && !(isObj(dd) && (typeof dd.ruleId === 'string' || (dd.custom === true && (dd.type === 'flat' || dd.type === 'percent') && isInt(dd.value, 1))))) {
    fail(`the ${where} cart discount is invalid.`);
  }

  const id = (/** @type {unknown} */ x, /** @type {string} */ what) => {
    if (typeof x !== 'string' || !ID_RE.test(x)) fail(`${what} has an invalid id.`);
  };
  const str = (/** @type {unknown} */ x, max = 500) => typeof x === 'string' && x.length <= max;
  const unique = (/** @type {any[]} */ list, /** @type {string} */ what) => {
    const seen = new Set();
    for (const x of list) {
      if (!isObj(x)) fail(`a ${what} record is damaged.`);
      id(x.id, `A ${what} record`);
      if (seen.has(x.id)) fail(`two ${what} records share the same id.`);
      seen.add(x.id);
    }
  };
  const line = (/** @type {any} */ l, /** @type {string} */ what) => {
    if (!isObj(l)) fail(`${what} has a damaged item.`);
    id(l.id, what);
    id(l.productId, what);
    if (!str(l.name) || !str(l.category) || !str(l.size) || !str(l.flavour) || !str(l.note, LIMITS.note)) fail(`${what} has an invalid item.`);
    if (!isInt(l.unitPrice) || !isInt(l.quantity, 1) || l.quantity > MAX_QUANTITY || l.lineTotal !== l.unitPrice * l.quantity) {
      fail(`${what} has an item whose total doesn't add up.`);
    }
    if (!Array.isArray(l.addons) || !isObj(l.stock) || !(l.bundle === null || Array.isArray(l.bundle))) fail(`${what} has an invalid item snapshot.`);
    for (const a of l.addons) if (!isObj(a) || !str(a.name) || !isInt(a.price)) fail(`${what} has an invalid add-on.`);
    for (const [k, n] of Object.entries(l.stock)) if (!ID_RE.test(k) || !isInt(n, 1)) fail(`${what} has invalid stock usage.`);
  };

  for (const k of ['orders', 'payments', 'games', 'expenses', 'contributions', 'settlements', 'audit']) unique(s[k], k.replace(/s$/, ''));
  s.draft.forEach((/** @type {any} */ l) => line(l, 'The cart'));

  /** @type {Map<string, 'order'|'game'>} */
  const entities = new Map();
  for (const o of s.orders) {
    const what = `Order ${o.number ?? '?'}`;
    if (!isInt(o.number, 1)) fail('an order has an invalid number.');
    if (!isIso(o.at) || !str(o.operator)) fail(`${what} has an invalid time or operator.`);
    if (!(o.token === null || isInt(o.token, 1)) || !(o.tokenDay === null || (typeof o.tokenDay === 'string' && DATE_RE.test(o.tokenDay)))) {
      fail(`${what} has an invalid token.`);
    }
    if (!Array.isArray(o.items) || !o.items.length) fail(`${what} has no items.`);
    o.items.forEach((/** @type {any} */ l) => line(l, what));
    if (!isInt(o.subtotal) || !isInt(o.discount) || !isInt(o.total)) fail(`${what} has invalid totals.`);
    if (o.items.reduce((/** @type {number} */ n, /** @type {Line} */ l) => n + l.lineTotal, 0) !== o.subtotal || o.discount > o.subtotal ||
      o.subtotal - o.discount !== o.total) {
      fail(`${what}'s totals don't add up.`);
    }
    const di = o.discountInfo;
    if (di !== null && !(isObj(di) && (di.id === null || typeof di.id === 'string') && str(di.label) && (di.type === 'flat' || di.type === 'percent') &&
      isInt(di.value))) {
      fail(`${what} has an invalid discount snapshot.`);
    }
    if (!str(o.note, LIMITS.note)) fail(`${what} has an invalid note.`);
    if (!ORDER_STATUSES.includes(o.status)) fail(`${what} has an unknown status.`);
    if (!CHECKOUT_METHODS.includes(o.method)) fail(`${what} has an unknown payment method.`);
    if (!KITCHEN_STATUSES.includes(o.kitchen) || !isObj(o.kitchenAt)) fail(`${what} has an invalid kitchen status.`);
    for (const [k, v] of Object.entries(o.kitchenAt)) if (!KITCHEN_STATUSES.includes(/** @type {any} */ (k)) || !isIso(v)) fail(`${what} has an invalid kitchen time.`);
    if (o.split !== null) {
      if (o.method !== 'Split' || !isObj(o.split) || !isInt(o.split.Cash, 1) || !isInt(o.split.UPI, 1) || o.split.Cash + o.split.UPI !== o.total) {
        fail(`${what}'s split payment doesn't add up.`);
      }
    }
    if (!(o.cashReceived === null || isInt(o.cashReceived)) || !isInt(o.change)) fail(`${what} has invalid cash details.`);
    entities.set(o.id, 'order');
  }
  for (const g of s.games) {
    if (entities.has(g.id)) fail('a game play and an order share the same id.');
    if (typeof g.gameId !== 'string' || !str(g.name) || !str(g.prize) || !str(g.operator) || !isIso(g.at) || !isInt(g.fee) ||
      !PAYMENT_METHODS.includes(g.method) || typeof g.void !== 'boolean') {
      fail('a game play record is invalid.');
    }
    entities.set(g.id, 'game');
  }

  /** @type {Map<string, {Cash: number, UPI: number, Other: number, positive: Record<string, number>, rows: number}>} */
  const balances = new Map();
  for (const p of s.payments) {
    if (!isIso(p.at) || !isInt(Math.abs(p.amount), 1) || !PAYMENT_METHODS.includes(p.method)) fail('a payment record is invalid.');
    const kind = entities.get(p.entityId);
    if (!kind) fail('a payment points to an order or game that is not in the backup.');
    if (!(p.kind === 'refund' ? p.amount < 0 : p.kind === kind && p.amount > 0)) fail('a payment record has the wrong kind or sign.');
    const b = balances.get(p.entityId) || {Cash: 0, UPI: 0, Other: 0, positive: {Cash: 0, UPI: 0, Other: 0}, rows: 0};
    b[p.method] += p.amount;
    if (p.amount > 0) b.positive[p.method] += p.amount;
    b.rows++;
    balances.set(p.entityId, b);
  }
  const empty = {Cash: 0, UPI: 0, Other: 0, positive: {Cash: 0, UPI: 0, Other: 0}, rows: 0};
  for (const o of s.orders) {
    const what = `Order ${o.number}`;
    const b = balances.get(o.id) || empty;
    if (b.Cash < 0 || b.UPI < 0 || b.Other < 0) fail(`${what} was refunded more than was collected.`);
    const net = b.Cash + b.UPI + b.Other;
    const paidIn = b.positive.Cash + b.positive.UPI + b.positive.Other;
    if (o.status === 'paid' && net !== o.total) fail(`${what} is marked paid but its payments don't match the total.`);
    if (o.status === 'partial' && !(net > 0 && net < o.total)) fail(`${what}'s partial refund doesn't match its payments.`);
    if ((o.status === 'refunded' || o.status === 'void' || o.status === 'pending') && net !== 0) fail(`${what} should have no money left but does.`);
    if (o.status === 'pending' && b.rows) fail(`${what} is pending but has payments.`);
    const expectIn = o.status === 'pending' ? [0] : o.status === 'void' ? [0, o.total] : [o.total];
    if (!expectIn.includes(paidIn)) fail(`${what}'s payments don't match its total.`);
    if (paidIn > 0) {
      if (o.method === 'Split') {
        if (!o.split || b.positive.Cash !== o.split.Cash || b.positive.UPI !== o.split.UPI || b.positive.Other !== 0) {
          fail(`${what}'s split payments don't match its Cash and UPI parts.`);
        }
      } else if (b.positive[o.method] !== paidIn) {
        fail(`${what}'s payments don't match its payment method.`);
      }
    }
  }
  for (const g of s.games) {
    const b = balances.get(g.id) || empty;
    if (b.Cash < 0 || b.UPI < 0 || b.Other < 0 || b.Cash + b.UPI + b.Other !== (g.void ? 0 : g.fee)) fail(`the "${g.name}" game play's payments don't match its fee.`);
  }
  /** Void bookkeeping: a voided record keeps its reason and time; a live one has neither. */
  const voidOk = (/** @type {any} */ x) => typeof x.void === 'boolean' && (x.void
    ? typeof x.voidReason === 'string' && x.voidReason.trim() !== '' && x.voidReason.length <= LIMITS.reason && isIso(x.voidAt)
    : x.voidReason === undefined && x.voidAt === undefined);
  for (const e of s.expenses) {
    const title = typeof e.title === 'string' ? e.title : '';
    if (!isInt(e.amount, 1) || e.amount > MAX_AMOUNT || !isIso(e.at) || !str(e.operator) || !title.trim() || title.length > LIMITS.expenseTitle ||
      !EXPENSE_CATEGORY_IDS.includes(e.category) || !EXPENSE_METHODS.includes(e.method) ||
      !(e.paidBy === DRAWER || (typeof e.paidBy === 'string' && ID_RE.test(e.paidBy))) ||
      !(e.billImage === null || (typeof e.billImage === 'string' && MEDIA_RE.test(e.billImage))) || !str(e.notes, LIMITS.expenseNotes) || !voidOk(e)) {
      fail(`a bill in the ${where} is invalid.`);
    }
  }
  for (const x of s.contributions) {
    if (!isInt(x.amount, 1) || x.amount > MAX_AMOUNT || !isIso(x.at) || !str(x.operator) || typeof x.memberId !== 'string' || !ID_RE.test(x.memberId) ||
      !EXPENSE_METHODS.includes(x.method) || !str(x.note, LIMITS.contriNote) || !voidOk(x)) {
      fail(`a contri record in the ${where} is invalid.`);
    }
  }
  const money0 = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isSafeInteger(n);
  for (const snap of s.settlements) {
    const r = snap.result;
    if (!isIso(snap.at) || !str(snap.operator) || !str(snap.text, 20000) || !isObj(r) || !Array.isArray(r.members) || !isObj(r.totals) ||
      !Array.isArray(r.warnings) || !r.members.every((/** @type {any} */ m) => isObj(m) && str(m.name) && isInt(m.payout)) ||
      !['revenue', 'expenses', 'capital', 'netProfit', 'pot'].every(k => money0(r.totals[k]))) {
      fail(`a saved settlement in the ${where} is damaged.`);
    }
  }
  for (const a of s.audit) {
    if (!isIso(a.at) || !str(a.type) || typeof a.entityId !== 'string' || !str(a.operator) || !isObj(a.details)) fail('an audit history entry is invalid.');
  }
  for (const m of Object.values(s.milestones)) {
    if (!isObj(m) || typeof m.active !== 'boolean' || !(m.unlockedAt === null || isIso(m.unlockedAt)) ||
      !(m.reference === null || typeof m.reference === 'string')) {
      fail(`the ${where} milestones are invalid.`);
    }
  }
}

/**
 * Validate a backup before restoring it. Accepts the v2 wrapper, a raw v2 state or a raw v1 state (migrated first).
 * Never mutates the input. Throws a human message on anything invalid.
 * @param {unknown} input
 * @returns {{state: State, media: MediaMap, warnings: string[]}}
 */
export function validateBackup(input) {
  /** @type {(msg: string) => never} */
  const fail = msg => {
    throw Error(`Backup rejected: ${msg}`);
  };
  if (!isObj(input)) fail('this is not a ManageYourStall backup file.');
  const raw = /** @type {any} */ (input);
  let source;
  let mediaIn = {};
  if (raw.format === 'mys-backup') {
    if (raw.app !== BRAND.name || raw.version !== SCHEMA_VERSION) fail('this backup is from an unsupported app version.');
    source = raw.state;
    mediaIn = raw.media ?? {};
  } else {
    source = raw;
  }
  if (!isObj(source) || !isObj(source.config) || (source.version !== 1 && source.version !== SCHEMA_VERSION)) {
    fail('this is not a ManageYourStall backup file.');
  }
  let state;
  try {
    state = structuredClone(source);
  } catch {
    fail('the file contains data that cannot be restored.');
  }
  for (const mode of ['live', 'demo']) {
    const s = state[mode];
    if (!isObj(s) || !['orders', 'payments', 'games', 'expenses', 'audit'].every(k => Array.isArray(s[k]))) {
      fail(`the ${mode === 'demo' ? 'practice' : 'live'} ledger is incomplete.`);
    }
  }
  if (state.version === SCHEMA_VERSION && (!Array.isArray(state.config.products) || !Array.isArray(state.config.categories))) {
    fail('the menu is incomplete.');
  }
  try {
    migrate(state);
  } catch (err) {
    fail(/** @type {Error} */ (err).message);
  }

  if (state.mode !== 'live' && state.mode !== 'demo') fail('the counter mode is invalid.');
  if (typeof state.onboarded !== 'boolean' || !isInt(state.revision)) fail('the stall header is invalid.');
  if (state.pin !== null && !(isObj(state.pin) && typeof state.pin.salt === 'string' && typeof state.pin.hash === 'string' &&
    /^[0-9a-fA-F]{64}$/.test(state.pin.hash))) {
    fail('the admin PIN record is invalid.');
  }

  // Media: data URLs only, size-limited.
  if (!isObj(mediaIn)) fail('the uploaded images are damaged.');
  /** @type {MediaMap} */
  const media = {};
  let totalBytes = 0;
  for (const [key, value] of Object.entries(mediaIn)) {
    if (!ID_RE.test(key)) fail('an uploaded image has an invalid id.');
    const match = typeof value === 'string' ? MEDIA_DATA_RE.exec(value) : null;
    if (!match) fail('an uploaded image is not a PNG, JPEG, WebP or GIF data URL.');
    const bytes = base64Bytes(match[2]);
    if (bytes > MAX_MEDIA_BYTES) fail('an uploaded image is larger than 1.5 MB.');
    totalBytes += bytes;
    if (totalBytes > MAX_MEDIA_TOTAL) fail('the uploaded images add up to more than 40 MB.');
    media[key] = /** @type {string} */ (value);
  }

  const warnings = [];
  const c = state.config;
  checkLedgerConfig(c, fail);
  const dangling = (/** @type {unknown} */ ref) => typeof ref === 'string' && MEDIA_RE.test(ref) && !hasOwn(media, ref.slice('media:'.length));
  for (const p of c.products) {
    if (dangling(p.image)) {
      p.image = null;
      warnings.push(`"${p.name}" lost its uploaded photo (not in the backup), so it will show its illustration.`);
    }
  }
  if (isObj(c.theme) && dangling(c.theme.heroImage)) {
    c.theme.heroImage = null;
    warnings.push('The stall photo was not in the backup, so the hero shows its illustrations instead.');
  }
  for (const mode of ['live', 'demo']) {
    let lost = 0;
    for (const e of state[mode].expenses) {
      if (isObj(e) && dangling(e.billImage)) {
        e.billImage = null;
        lost++;
      }
    }
    if (lost) {
      const where = mode === 'demo' ? 'practice' : 'live';
      warnings.push(`${plural(lost, 'bill photo')} in the ${where} ledger ${lost === 1 ? 'was' : 'were'} not in the backup; the ${lost === 1 ? 'bill is' : 'bills are'} kept without ${lost === 1 ? 'its photo' : 'photos'}.`);
    }
  }
  try {
    validateConfig(c);
  } catch (err) {
    fail(/** @type {Error} */ (err).message);
  }
  checkSession(state.live, 'live', fail);
  checkSession(state.demo, 'demo', fail);
  refreshMilestones(state.live, c);
  refreshMilestones(state.demo, c);
  return {state, media, warnings};
}
