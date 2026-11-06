// @ts-check
// Shared vocabulary for ManageYourStall. Pure data, no imports, no DOM.

export const BRAND = Object.freeze({
  name: 'ManageYourStall',
  short: 'MYS',
  credit: 'created by viraj', // permanent, not editable by stall owners
});

export const SCHEMA_VERSION = 2;

/** Methods a single ledger payment can have. A Split order writes one Cash and one UPI payment. */
export const PAYMENT_METHODS = /** @type {const} */ (['Cash', 'UPI', 'Other']);
/** Methods an order can be checked out with. */
export const CHECKOUT_METHODS = /** @type {const} */ (['Cash', 'UPI', 'Split', 'Other']);
export const ORDER_STATUSES = /** @type {const} */ (['paid', 'partial', 'refunded', 'void', 'pending']);
export const KITCHEN_STATUSES = /** @type {const} */ (['preparing', 'ready', 'handed']);

/** Card background tints (art frames, product cards, picker swatches). */
export const TINTS = Object.freeze([
  { id: 'yellow', label: 'Sunny', hex: '#ffe263' },
  { id: 'pink', label: 'Pataka pink', hex: '#ffb1cd' },
  { id: 'coral', label: 'Coral', hex: '#ffc4bb' },
  { id: 'peach', label: 'Peach', hex: '#ffd9bf' },
  { id: 'lime', label: 'Lime', hex: '#d6edb6' },
  { id: 'mint', label: 'Mint', hex: '#c5f2df' },
  { id: 'sky', label: 'Sky', hex: '#bfe6ff' },
  { id: 'lavender', label: 'Lavender', hex: '#ddd3ff' },
  { id: 'cream', label: 'Cream', hex: '#f2e9d5' },
]);
export const TINT_IDS = TINTS.map(t => t.id);

/** Card background patterns (pure CSS, see css/base.css .pattern-*). */
export const PATTERNS = Object.freeze([
  { id: 'none', label: 'Plain' },
  { id: 'dots', label: 'Dots' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'grid', label: 'Grid' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'sunburst', label: 'Sunburst' },
]);
export const PATTERN_IDS = PATTERNS.map(p => p.id);

/** Eye-catching product tags. `id` is stored; `label` is displayed. */
export const TAGS = Object.freeze([
  { id: 'POP', label: 'POP!' },
  { id: 'BESTSELLER', label: 'BESTSELLER' },
  { id: 'SPICY', label: 'SPICY' },
  { id: 'NEW', label: 'NEW' },
  { id: 'COMBO', label: 'COMBO' },
  { id: 'CHILLED', label: 'CHILLED' },
]);
export const TAG_IDS = TAGS.map(t => t.id);

export const SIZE_SUGGESTIONS = Object.freeze(['Small', 'Medium', 'Large', 'Regular', 'Half', 'Full', 'Single', 'Double', 'Combo']);

/** Custom milestone rule types. `target` units: orders/plays/items = count, revenue = paise, recovery = percent. */
export const MILESTONE_TYPES = Object.freeze([
  { id: 'orders', label: 'Orders completed', unit: 'orders' },
  { id: 'revenue', label: 'Money collected', unit: 'paise' },
  { id: 'recovery', label: 'Break-even recovered', unit: 'percent' },
  { id: 'items', label: 'Items sold', unit: 'items' },
  { id: 'games', label: 'Game plays', unit: 'plays' },
]);
export const MILESTONE_TYPE_IDS = MILESTONE_TYPES.map(m => m.id);

/** @typedef {'pre-stall'|'restock'|'rent'|'packaging'|'decor'|'misc'} ExpenseCategoryId */
/**
 * One frozen category entry. A non-enumerable `toString()` returns the label, so Phase-1 code that still treats the list as
 * strings (e.g. `select(…, [...EXPENSE_CATEGORIES])`) shows real labels; addExpense maps labels back to ids.
 * @param {ExpenseCategoryId} id @param {string} label @param {string} emoji
 */
const expenseCategory = (id, label, emoji) => Object.freeze(Object.defineProperty({id, label, emoji}, 'toString', {value: () => label}));
/**
 * Bill categories for the expense ledger (§16.2). `id` is stored on every bill; `label`/`emoji` are displayed.
 * @type {ReadonlyArray<Readonly<{id: ExpenseCategoryId, label: string, emoji: string}>>}
 */
export const EXPENSE_CATEGORIES = Object.freeze([
  expenseCategory('pre-stall', 'Pre-Stall Setup', '🧰'),
  expenseCategory('restock', 'Mid-Stall Restock', '🔄'),
  expenseCategory('rent', 'Stall Rent / Registration', '🏷️'),
  expenseCategory('packaging', 'Packaging & Plates', '🥡'),
  expenseCategory('decor', 'Decor / Banner', '🎪'),
  expenseCategory('misc', 'Misc', '🧾'),
]);
export const EXPENSE_CATEGORY_IDS = Object.freeze(EXPENSE_CATEGORIES.map(c => c.id));
/**
 * Phase-1 / v1 expense categories → Phase-2 ids (legacy expense upgrade, §16.1). Anything not listed maps to 'misc'.
 * @type {Readonly<Record<string, string>>}
 */
export const LEGACY_EXPENSE_CATEGORIES = Object.freeze({
  Ingredients: 'restock', Supplies: 'restock', Packaging: 'packaging', Helper: 'misc', Transport: 'misc', Other: 'misc',
});
/** How a bill or a contri was paid. */
export const EXPENSE_METHODS = /** @type {const} */ (['Cash', 'UPI']);
/** `paidBy` value for bills paid from the stall cash drawer / pool. */
export const DRAWER = 'drawer';
/** Team profit split: equal shares, or custom integer percentages that sum to 100. */
export const SPLIT_MODES = /** @type {const} */ (['equal', 'custom']);
/** Break-even modes: 'ledger' = Σ bills; 'total' / 'itemized' = planned investment + Σ bills. */
export const MISSION_MODES = /** @type {const} */ (['ledger', 'total', 'itemized']);
/** Quick titles for the mid-stall restock sheet. */
export const RESTOCK_SUGGESTIONS = Object.freeze([
  'Extra cheese & buns', '20L water cans & ice', 'Plates & cups', 'Oil refill', 'Loose change', 'Gas cylinder refill', 'Tissues & foil',
]);
/** Most partners on a stall team. */
export const MAX_MEMBERS = 20;
export const MISSION_SUGGESTIONS = Object.freeze(['Stall rent', 'Raw materials', 'Disposables & plates', 'Banner & decor', 'Helper cost', 'Gas & fuel', 'Transport']);

/** Brand accent swatches offered in Stall Studio (any #rrggbb is accepted). */
export const ACCENTS = Object.freeze(['#FFDD35', '#FF4D87', '#FF6B5B', '#7EE0B5', '#B9F36B', '#C7B6FF', '#8FD3FF', '#FF9F43']);

/** Cash quick-tap notes at checkout, in paise (₹50, ₹100, ₹200, ₹500). "Exact" is separate. */
export const CASH_QUICK = Object.freeze([5000, 10000, 20000, 50000]);

/** Text length limits (characters). */
export const LIMITS = Object.freeze({
  stallName: 50, booth: 24, tagline: 70, subTagline: 90, eventName: 60, venue: 80, city: 40,
  ownerName: 40, initials: 3, operator: 40,
  categoryName: 30, productName: 50, subtitle: 80, size: 20,
  addonName: 40, flavour: 40, gameName: 40, discountLabel: 40, missionLabel: 40, milestoneTitle: 40,
  note: 200, reason: 200, prize: 120, expense: 150, upiId: 100, payeeName: 50, imageUrl: 2000,
  expenseTitle: 80, expenseNotes: 500, memberName: 40, contriNote: 120,
});

export const MAX_QUANTITY = 999;
export const MAX_PRODUCTS = 300;
export const MAX_CATEGORIES = 40;

export const ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** UPI virtual payment address, e.g. name@okaxis / 98765@ybl. */
export const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
/** Product image reference stored in the media object store. */
export const MEDIA_RE = /^media:[a-zA-Z0-9_-]{1,100}$/;
/** Remote product image URL (https only). */
export const IMAGE_URL_RE = /^https:\/\/[^\s"'<>\\]{4,2000}$/;
