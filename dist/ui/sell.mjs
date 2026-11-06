// Sell screen (ARCHITECTURE.md §13.1 + §16.5/§16.6): where cashiers live at rush hour.
// Themed hero banner (config.theme: tint, pattern, hero illustration or stall photo, palette) + readiness, mini mission
// strip, setup banner, search + filter chips, product grid (cards with a main add button and a separate in-cart stepper),
// quick-edit tools, customize sheet, and a responsive cart:
//   desktop ≥1024px  → sticky right cart column (3-zone command center with the sidebar)
//   tablet 768–1023  → 2-column grid + floating cart bar → slide-over cart drawer from the right (sheet kind 'cart')
//   mobile ≤767px    → floating "N items · ₹Total · Review & Pay →" bar → full-screen order sheet (sheet kind 'cart')
//
// Public actions: 'sell-add' (data-id) · 'sell-quick-edit'. Everything else here is private ('sell-*').
import {
  C, S, store, ui, esc, money, icon, btn, select, textarea, toggle, emptyState, artFrame, toast, openSheet, closeSheet,
  sheetEl, sheetKind, confirmSheet, commit, render, registerScreen, registerActions, registerInputs, registerChanges,
  runAction, isAdmin, showError, mediaUrl,
} from './core.mjs';
import {
  productById, sellability, makeLine, addToDraft, setLineQuantity, removeLine, clearDraft, setDraftNote, draftTotals,
  report, upcomingToken, resolveDiscount,
} from '../domain.mjs';
import {TAGS, LIMITS, MAX_QUANTITY, TINT_IDS, PATTERN_IDS} from '../constants.mjs';
import {tokenLabel} from '../util.mjs';
import * as lib from '../library.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Module state (transient, per device tab)
// ---------------------------------------------------------------------------------------------------------------------

/** Search text. */
let query = '';
/** 'all' | 'top' | 'cat:<categoryId>' */
let filter = 'all';
/** Quick-edit mode: per-card owner tools. */
let quickEdit = false;
/** One-shot flags consumed by the next render (add feedback). */
let bumpNext = false;
/** @type {string} product id whose card pops on the next render */
let popNext = '';
/** Product ids matching the current search (for Enter-to-add when exactly one matches). @type {string[]} */
let lastResults = [];
/** Customize sheet state. @type {null | {id: string, flavour: string, addons: Set<string>, quantity: number, note: string}} */
let cz = null;
/** Where the note sheet was opened from, so saving returns to the cart sheet on phones. */
let noteFromSheet = false;

const TOP_LIMIT = 6;
const LOW_STOCK = 5;
const SEARCH_ID = 'sell-search';

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const tagLabel = (/** @type {string} */ id) => TAGS.find(t => t.id === id)?.label || id;
const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Product name without a trailing " · Small" when the size chip already says it.
 * @param {{name: string, size?: string}} p
 */
function displayName(p) {
  const size = String(p.size || '').trim();
  if (!size) return p.name;
  const trimmed = p.name.replace(new RegExp(`\\s*[·|–-]\\s*${escapeRe(size)}\\s*$`, 'i'), '').trim();
  return trimmed || p.name;
}

/** Category name by id. */
const categoryName = (/** @type {any} */ c, /** @type {string} */ id) => c.categories.find(x => x.id === id)?.name || '';

/** Quantity of a product across all cart lines. */
function cartQty(/** @type {any} */ s, /** @type {string} */ productId) {
  let n = 0;
  for (const l of s.draft) if (l.productId === productId) n += l.quantity;
  return n;
}

/** Σ quantities in the cart. */
const cartCount = (/** @type {any} */ s) => s.draft.reduce((n, l) => n + l.quantity, 0);

/**
 * Does this product match every word of the search?
 * @param {any} p
 * @param {string} catName
 * @param {string[]} words lowercase
 */
function matches(p, catName, words) {
  if (!words.length) return true;
  const hay = [p.name, p.subtitle, p.size, catName, ...p.tags.map(tagLabel), ...p.tags].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

/** Customizable items open the customize sheet (combos never do). */
const isCustom = (/** @type {any} */ p) => !!p.customizable && !p.bundle;

/**
 * The session as if the current cart were already sold, so `sellability(...).left` counts what the cart holds too
 * (stock math stays in the domain; the cart lines carry their own `stock` per item).
 * @param {any} s
 */
const withCartSold = s => (s.draft.length ? {...s, orders: [...s.orders, {id: 'sell-cart', status: 'paid', items: s.draft}]} : s);

/**
 * Can one more of this product go into the cart? Sellable now, and (with inventory on) stock left after the cart.
 * @param {any} s session · @param {any} c config · @param {any} p product · @param {any} [cartSold] withCartSold(s), when at hand
 * @returns {{ok: boolean, reason: string, left: number|null, capped: boolean}} capped = sellable but the cart holds all the stock
 */
function addable(s, c, p, cartSold = withCartSold(s)) {
  const now = sellability(s, c, p);
  if (!now.ok || !c.inventory || !s.draft.length) return {...now, capped: false};
  const after = sellability(cartSold, c, p);
  return {ok: after.ok, reason: after.reason, left: after.left, capped: after.reason === 'stock'};
}

// Cart changes run one after another (no tap is lost while IndexedDB saves the previous one); a repeat tap on the same
// target while its change is still saving is ignored (double-tap guard per item, not per action name).
let cartChain = Promise.resolve();
/** @type {Set<string>} */
const inFlight = new Set();

/**
 * @param {any} el the tapped element (null for runAction: then the caller gets the promise to await)
 * @param {string} key per-target guard key
 * @param {() => any} fn
 */
function queueCart(el, key, fn) {
  if (inFlight.has(key)) return undefined;
  inFlight.add(key);
  const run = cartChain.then(fn).finally(() => inFlight.delete(key));
  cartChain = run.catch(() => {});
  if (el) {
    run.catch(showError);
    return undefined;
  }
  return run;
}

/** Put focus back on a control that survived a re-render, else on a sensible neighbour (keyboard cashiers). */
function refocus(/** @type {string[]} */ ...ids) {
  const active = document.activeElement;
  if (sheetEl()?.open || (active && active !== document.body && document.contains(active))) return;
  for (const id of ids) {
    const el = id && document.getElementById(id);
    if (el && !(/** @type {any} */ (el).disabled) && el.offsetParent !== null) {
      el.focus({preventScroll: true});
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen pieces
// ---------------------------------------------------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Readable ink/paper on a hex background (same rule as the kernel's --on-accent). @param {string} hex */
function onColor(hex) {
  if (!HEX_RE.test(hex)) return 'var(--ink)';
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#171717' : '#fff9ed';
}

/**
 * The hero illustration: a stall photo (theme.heroImage) over the themed library composition (library.heroSvg, or the
 * first hero art id when heroSvg isn't available). The photo uses `art-img`, so a broken/offline link falls back to the art.
 * @param {any} theme
 */
function heroArt(theme) {
  const ids = (Array.isArray(theme?.heroArt) ? theme.heroArt : []).filter((/** @type {unknown} */ x) => typeof x === 'string');
  const list = ids.length ? ids : ['packet'];
  const anyLib = /** @type {any} */ (lib);
  const svg = typeof anyLib.heroSvg === 'function'
    ? anyLib.heroSvg(list, {cls: 'sell-hero-svg'})
    : lib.artSvg(list[0], 'sell-hero-svg');
  const src = theme?.heroImage ? mediaUrl(theme.heroImage) : '';
  const photo = src
    ? `<img class="art-img sell-hero-img" src="${esc(src)}" alt="" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<div class="sell-hero-art${photo ? ' has-photo' : ''}" aria-hidden="true">
      <div class="sell-hero-frame"><span class="sell-hero-blob"></span>${svg}${photo}</div>
    </div>`;
}

/** @param {any[]} visible active products */
function hero(visible) {
  const c = C();
  const p = c.profile;
  const theme = c.theme || {};
  const tint = TINT_IDS.includes(theme.heroTint) ? theme.heroTint : 'yellow';
  const pattern = PATTERN_IDS.includes(theme.heroPattern) ? theme.heroPattern : 'none';
  const second = HEX_RE.test(theme.secondary) ? theme.secondary : '#FF4D87';
  const stall = String(p.stallName || '').trim() || 'My stall';
  const booth = String(p.booth || '').trim();
  const event = String(p.eventName || '').trim();
  const tagline = String(p.tagline || '').trim() || 'Let’s make some noise.';
  const sub = String(p.subTagline || '').trim() || 'Tap an item to start an order.';
  const priced = visible.filter(x => x.price !== null).length;
  const ready = visible.length > 0 && priced === visible.length;
  const badge = visible.length
    ? `<span class="badge ${ready ? 'lime' : 'yellow'} sell-ready" title="${priced} of ${visible.length} menu items have a price">${ready ? icon('check') : icon('tag')}${priced}/${visible.length} PRICED</span>`
    : '';
  return `<section class="sell-hero tint-${tint}" style="--sell-2:${second};--sell-on-2:${onColor(second)}" aria-label="Your stall">
    <div class="sell-hero-bg pattern-${pattern}" aria-hidden="true"></div>
    <div class="sell-hero-copy">
      <div class="sell-hero-chips">
        <span class="sell-hero-name">${icon('store')}<span>${esc(stall)}</span></span>
        ${booth ? `<span class="sell-hero-chip">${esc(booth)}</span>` : ''}
        ${event ? `<span class="sell-hero-chip is-event">${icon('calendar')}<span>${esc(event)}</span></span>` : ''}
      </div>
      ${badge}
      <h1>${esc(tagline)}</h1>
      <p class="sell-hero-sub">${esc(sub)}</p>
      <div class="sell-hero-tools">
        ${btn(`${icon('palette')}<span>Customize<span class="sell-hero-cta-more"> My Stall</span></span>`, 'studio-open', 'sell-hero-cta', 'data-section="themes" aria-label="Customize My Stall"')}
        ${toggle('sell-quick-edit', 'Quick edit', quickEdit, 'id="sell-quick-toggle"')}
      </div>
    </div>
    ${heroArt(theme)}
  </section>`;
}

/** @param {ReturnType<typeof report>['mission']} m */
function missionStrip(m) {
  if (!m.hasTarget && m.mode === 'ledger') {
    return `<div class="sell-mission is-unset">
      <span class="sell-mission-icon">${icon('receipt')}</span>
      <span class="sell-mission-copy"><strong>No bills logged yet.</strong> <span class="muted">Add stall costs as you spend — break-even updates itself.</span></span>
      ${btn(`${icon('plus')}Add a bill`, 'money-add-bill', 'small yellow')}
    </div>`;
  }
  if (!m.hasTarget) {
    return `<div class="sell-mission is-unset">
      <span class="sell-mission-icon">${icon('target')}</span>
      <span class="sell-mission-copy"><strong>No break-even target yet.</strong> <span class="muted">Add your costs to track recovery.</span></span>
      ${btn(`${icon('target')}Set your investment`, 'studio-open', 'small yellow', 'data-section="mission"')}
    </div>`;
  }
  if (m.profitMode) {
    return `<button type="button" class="sell-mission is-profit" data-action="nav" data-screen="dashboard" aria-label="Profit mode: ${esc(money(m.profit))} profit. Open the dashboard">
      <span class="sell-profit-badge">PROFIT MODE 🔥</span>
      <span class="sell-mission-copy"><strong class="sell-mission-big">${esc(money(m.profit))} profit</strong>
      <span class="sell-mission-small">${esc(money(m.collected))} collected · break-even ${esc(money(m.target))}</span></span>
      ${icon('chevron-right', 'sell-mission-go')}
    </button>`;
  }
  const pct = Math.floor(m.percent);
  return `<button type="button" class="sell-mission" data-action="nav" data-screen="dashboard" aria-label="Mission: ${esc(money(m.collected))} of ${esc(money(m.target))} recovered, ${pct}%. Open the dashboard">
    <span class="sell-mission-copy"><span class="eyebrow">Mission</span><span><strong>${esc(money(m.collected))}</strong> / ${esc(money(m.target))} recovered</span></span>
    <span class="progress sell-mission-bar" aria-hidden="true"><span class="progress-fill" style="width:${pct}%"></span></span>
    <strong class="sell-mission-pct">${pct}%</strong>
    ${icon('chevron-right', 'sell-mission-go')}
  </button>`;
}

/** @param {number} unpriced */
function setupBanner(unpriced) {
  if (!unpriced) return '';
  return `<div class="notice sell-setup" role="note">
    ${icon('tag')}
    <div class="grow"><strong>${plural(unpriced, 'item')} ${unpriced === 1 ? 'needs' : 'need'} a price.</strong>
    <span class="sell-banner-more">Unpriced items show <b>SET PRICE</b> and can’t be sold yet.</span></div>
    ${btn(`${icon('rupee')}Set prices`, 'menu-price-board', 'small accent')}
  </div>`;
}

function quickEditBanner() {
  if (!quickEdit) return '';
  return `<div class="notice sky sell-quick-banner" role="note">
    ${icon('sliders')}
    <div class="grow"><strong>Quick edit is on.</strong> <span class="sell-banner-more">Flip items sold out, tap ₹ for prices, Edit for the rest.</span></div>
    ${btn('Done', 'sell-quick-edit', 'small')}
  </div>`;
}

/**
 * @param {any} c
 * @param {any[]} visible
 * @param {any[]} top
 */
function toolbar(c, visible, top) {
  const counts = new Map();
  for (const p of visible) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
  const chip = (/** @type {string} */ key, /** @type {string} */ label, /** @type {number|null} */ count) => {
    const on = filter === key;
    return `<button type="button" class="chip sell-chip${on ? ' active' : ''}" data-action="sell-filter" data-filter="${esc(key)}" aria-pressed="${on}">${label}${count === null ? '' : `<span class="sell-chip-count">${count}</span>`}</button>`;
  };
  const chips = [
    chip('all', 'All', visible.length),
    top.length ? chip('top', '🔥 Top sellers', null) : '',
    ...c.categories.map((/** @type {any} */ cat) => chip(`cat:${cat.id}`, esc(cat.name), counts.get(cat.id) || 0)),
    c.games.length ? btn(`${icon('game')}Games`, 'games-open', 'chip sell-chip sell-chip-games') : '',
  ].join('');
  return `<div class="sell-toolbar">
    <div class="sell-search">
      ${icon('search', 'sell-search-icon')}
      <input id="${SEARCH_ID}" type="search" data-input="sell-search" value="${esc(query)}" placeholder="Search the menu" aria-label="Search the menu" autocomplete="off" enterkeyhint="search" maxlength="60">
      ${query ? btn(icon('close'), 'sell-search-clear', 'quiet icon-btn small sell-search-clear', 'aria-label="Clear search"') : '<kbd class="sell-kbd" aria-hidden="true">/</kbd>'}
    </div>
    <div class="sell-chips" role="group" aria-label="Filter the menu">${chips}</div>
  </div>`;
}

/**
 * One product card: <article> with a main add button (stretched over the card) and, separately, the stepper/tools.
 * @param {any} p
 * @param {any} s
 * @param {any} c
 * @param {string} pop product id to animate
 */
function card(p, s, c, pop, cartSold) {
  const sale = sellability(s, c, p);
  const more = addable(s, c, p, cartSold);
  const qty = cartQty(s, p.id);
  const unpriced = p.price === null;
  const out = sale.reason === 'soldout' || sale.reason === 'component' || sale.reason === 'stock';
  const name = displayName(p);
  // Stock left after what this cart already holds (inventory on only).
  const low = c.inventory && sale.ok && more.left !== null && (more.capped || more.left <= LOW_STOCK);
  const lowText = more.capped ? (qty ? 'All left in cart' : 'None left') : `Only ${more.left} left`;
  const outWhy = sale.reason === 'stock' ? 'No stock left' : sale.reason === 'component' ? 'A combo item is out' : '';
  const label = unpriced
    ? `${name}${p.size ? `, ${p.size}` : ''} — price not set`
    : out
      ? `${name}${p.size ? `, ${p.size}` : ''} — sold out`
      : more.capped
        ? `${name}${p.size ? `, ${p.size}` : ''} — no more stock left`
        : `Add ${name}${p.size ? `, ${p.size}` : ''}, ${money(p.price)}${isCustom(p) ? ' (choose options)' : ''}${low ? `, only ${more.left} left` : ''}`;
  const cls = ['sell-card', unpriced ? 'is-unpriced' : '', out ? 'is-out' : '', qty ? 'in-cart' : '', pop === p.id ? 'sell-pop' : '']
    .filter(Boolean).join(' ');
  const tags = p.tags.length ? `<span class="sell-card-tags">${p.tags.map((/** @type {string} */ t) => `<span class="tag tag-${esc(t)}">${esc(tagLabel(t))}</span>`).join('')}</span>` : '';
  const price = unpriced
    ? `<span class="sell-setprice">${icon('lock')}SET PRICE</span>`
    : `<span class="price sell-price">${esc(money(p.price))}</span>`;
  const hint = unpriced || out || more.capped || (qty && !quickEdit) ? '' : `<span class="sell-add-hint" aria-hidden="true">${icon('plus')}</span>`;
  const stepper = qty && !quickEdit
    ? `<div class="sell-card-stepper" role="group" aria-label="${esc(name)} in cart">
        ${btn(icon('minus'), 'sell-dec', 'sell-step', `id="sell-dec-${esc(p.id)}" data-id="${esc(p.id)}" aria-label="One less ${esc(name)}"`)}
        <span class="sell-step-qty">${qty}<small> in cart</small></span>
        ${btn(icon('plus'), 'sell-inc', 'sell-step', `id="sell-inc-${esc(p.id)}" data-id="${esc(p.id)}" aria-label="One more ${esc(name)}"${out || unpriced || more.capped ? ' disabled' : ''}`)}
      </div>`
    : '';
  const tools = quickEdit
    ? `<div class="sell-tools" role="group" aria-label="Quick edit ${esc(name)}">
        <button type="button" class="sell-tool sell-tool-stock${p.soldOut ? ' is-soldout' : ''}" data-action="menu-toggle-soldout" data-id="${esc(p.id)}" aria-pressed="${p.soldOut ? 'false' : 'true'}" aria-label="In stock: ${esc(name)}">${icon(p.soldOut ? 'close' : 'check')}${p.soldOut ? 'Sold out' : 'In stock'}</button>
        ${btn(`${icon('rupee')}<span>Price</span>`, 'menu-quick-price', 'sell-tool', `data-id="${esc(p.id)}" aria-label="Change price of ${esc(name)}"`)}
        ${btn(`${icon('edit')}<span>Edit</span>`, 'menu-edit-product', 'sell-tool', `data-id="${esc(p.id)}" aria-label="Edit ${esc(name)}"`)}
      </div>`
    : '';
  return `<article class="${cls}" data-product="${esc(p.id)}">
    <div class="sell-card-media">
      ${artFrame(p, {size: 'md', cls: 'sell-card-art'})}
      ${tags}
      ${qty ? `<span class="sell-qty-badge" aria-hidden="true">×${qty}</span>` : ''}
      ${out ? `<span class="sell-ribbon"><b>SOLD OUT</b>${outWhy ? `<small>${outWhy}</small>` : ''}</span>` : ''}
      ${low ? `<span class="sell-low${more.capped ? ' is-capped' : ''}">${lowText}</span>` : ''}
    </div>
    <div class="sell-card-body">
      <h3 class="sell-card-name"><button type="button" class="sell-card-main" id="sell-card-${esc(p.id)}" data-action="sell-add" data-id="${esc(p.id)}" aria-label="${esc(label)}">${esc(name)}</button></h3>
      ${p.size ? `<span class="sell-size">${esc(p.size)}</span>` : ''}
      ${p.subtitle ? `<p class="sell-card-sub">${esc(p.subtitle)}</p>` : ''}
      <div class="sell-card-foot">${price}${hint}</div>
    </div>
    ${stepper}${tools}
  </article>`;
}

/** @param {any[]} list @param {any} s @param {any} c @param {string} pop */
const grid = (list, s, c, pop) => {
  if (!renderCartSold) renderCartSold = withCartSold(s);
  const cartSold = renderCartSold;
  return `<div class="sell-grid">${list.map(p => card(p, s, c, pop, cartSold)).join('')}</div>`;
};
/** withCartSold(S()) for the render in progress (shared by every section). @type {any} */
let renderCartSold = null;

/**
 * The product area: category sections (All), a flat grid (search / chip), or a friendly empty state.
 * @param {any} c @param {any} s @param {any[]} visible @param {any[]} top @param {string} pop
 */
function products(c, s, visible, top, pop) {
  if (!c.products.length || !visible.length) {
    lastResults = [];
    const hidden = c.products.length - visible.length;
    return emptyState(
      'sell',
      c.products.length ? 'Every item is hidden' : 'Your stall is empty',
      c.products.length
        ? `${plural(hidden, 'item')} ${hidden === 1 ? 'is' : 'are'} hidden from Sell. Turn them back on in the Menu manager.`
        : 'Add your first item and start the dhamaka.',
      c.products.length
        ? btn(`${icon('menu')}Open menu manager`, 'nav', 'primary', 'data-screen="menu"')
        : btn(`${icon('plus')}Add your first item`, 'menu-new-product', 'primary'),
    );
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const catName = new Map(c.categories.map((/** @type {any} */ x) => [x.id, x.name]));
  const hit = (/** @type {any} */ p) => matches(p, catName.get(p.categoryId) || '', words);

  let scoped = visible;
  let scopeLabel = '';
  if (filter === 'top') {
    scoped = top;
    scopeLabel = 'Top sellers';
  } else if (filter.startsWith('cat:')) {
    const id = filter.slice(4);
    scoped = visible.filter(p => p.categoryId === id);
    scopeLabel = catName.get(id) || '';
    if (!scoped.length) {
      lastResults = [];
      return emptyState('menu', `Nothing in ${scopeLabel} yet`, 'Add an item to this category and it shows up here.',
        btn(`${icon('plus')}Add an item`, 'menu-new-product', 'primary', `data-category="${esc(id)}"`));
    }
  }
  const results = scoped.filter(hit);
  lastResults = words.length ? results.map(p => p.id) : [];

  if (!results.length) {
    return emptyState('search', `No match for “${query.trim()}”`, scopeLabel ? `Nothing in ${scopeLabel} matches. Try All or another word.` : 'Try another word, a category or a tag like spicy.',
      btn('Clear search', 'sell-search-clear', '') + (filter !== 'all' ? btn('Search all items', 'sell-filter', 'quiet-outline', 'data-filter="all"') : ''));
  }

  if (filter === 'all' && !words.length) {
    return c.categories.map((/** @type {any} */ cat) => {
      const list = results.filter(p => p.categoryId === cat.id);
      if (!list.length) return '';
      return `<section class="sell-section" aria-label="${esc(cat.name)}">
        <h2 class="sell-section-title">${esc(cat.name)}<span class="sell-section-count">${list.length}</span></h2>
        ${grid(list, s, c, pop)}
      </section>`;
    }).join('');
  }
  const head = words.length
    ? `<p class="sell-results" role="status">${plural(results.length, 'match', 'matches')}${scopeLabel ? ` in ${esc(scopeLabel)}` : ''}${results.length === 1 ? ' · press Enter to add' : ''}</p>`
    : filter === 'top' ? `<p class="sell-results">Your ${plural(results.length, 'bestseller')} this session, most sold first.</p>` : '';
  return `${head}${grid(results, s, c, pop)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cart (column on desktop ≥1024px; floating bar + drawer/full-screen sheet below)
// ---------------------------------------------------------------------------------------------------------------------

/** Why a cart line can't be paid for any more ('' when it can). Stock shortages are reported by checkout. */
const LINE_BLOCKED = /** @type {Record<string, string>} */ ({
  missing: 'No longer on the menu',
  hidden: 'Hidden from the menu',
  soldout: 'Sold out now',
  unpriced: 'Has no price now',
  component: 'A combo item is out',
  stock: 'Out of stock now',
});

/**
 * @param {any} l line · @param {any} s · @param {any} c · @param {any} cartSold withCartSold(s)
 * @param {boolean} inSheet lines in the cart sheet get no ids (the panel copy owns them)
 */
function lineHtml(l, s, c, cartSold, inSheet) {
  const details = [
    l.flavour ? esc(l.flavour) : '',
    ...(l.addons || []).map((/** @type {any} */ a) => `+ ${esc(a.name)}`),
  ].filter(Boolean).join(' · ');
  const p = productById(c, l.productId);
  const more = p ? addable(s, c, p, cartSold) : {ok: false, reason: 'missing', capped: false};
  const blocked = !more.ok && !more.capped ? LINE_BLOCKED[more.reason] || 'Can’t be sold now' : '';
  const id = (/** @type {string} */ part) => (inSheet ? '' : `id="sell-${part}-${esc(l.id)}" `);
  const noMore = l.quantity >= MAX_QUANTITY || !!blocked || more.capped;
  return `<li class="sell-line${blocked ? ' is-blocked' : ''}">
    <div class="sell-line-top">
      <div class="grow">
        <strong class="sell-line-name">${esc(l.name)}</strong>
        ${details ? `<small class="sell-line-detail">${details}</small>` : ''}
        ${l.note ? `<small class="sell-line-note">${icon('note')}${esc(l.note)}</small>` : ''}
        <small class="sell-line-unit">${esc(money(l.unitPrice))} each</small>
        ${blocked ? `<small class="sell-line-blocked">${icon('alert')}${blocked} · remove it to pay</small>` : ''}
      </div>
      <strong class="sell-line-total">${esc(money(l.lineTotal))}</strong>
    </div>
    <div class="sell-line-tools">
      <div class="sell-stepper" role="group" aria-label="Quantity of ${esc(l.name)}">
        ${btn(icon('minus'), 'sell-line-dec', 'sell-step', `${id('ld')}data-line="${esc(l.id)}" aria-label="One less ${esc(l.name)}"`)}
        <span class="sell-step-qty">${l.quantity}</span>
        ${btn(icon('plus'), 'sell-line-inc', 'sell-step', `${id('li')}data-line="${esc(l.id)}" aria-label="One more ${esc(l.name)}"${noMore ? ' disabled' : ''}`)}
      </div>
      ${btn(`${icon('trash')}<span>Remove</span>`, 'sell-line-remove', 'quiet small sell-remove', `${id('lr')}data-line="${esc(l.id)}" aria-label="Remove ${esc(l.name)}"`)}
    </div>
  </li>`;
}

/**
 * Lines, note and totals (shared by the panel and the sheet).
 * @param {any} s @param {any} c @param {boolean} inSheet
 */
function cartBody(s, c, inSheet) {
  if (!s.draft.length) {
    return `<div class="sell-cart-empty">
      <span class="sell-cart-empty-icon">${icon('cart')}</span>
      <strong>Cart’s empty</strong>
      <p>Tap an item to start the next order.</p>
      ${s.draftNote ? `<p class="sell-note-text">${icon('note')}${esc(s.draftNote)}</p>` : ''}
    </div>`;
  }
  const t = draftTotals(s, c);
  const rule = resolveDiscount(c, s.draftDiscount);
  const from = inSheet ? ' data-from="sheet"' : '';
  const note = s.draftNote
    ? `<div class="sell-note"><span class="sell-note-text">${icon('note')}<span>${esc(s.draftNote)}</span></span>${btn('Edit', 'sell-note', 'quiet small', `aria-label="Edit order note"${from}`)}</div>`
    : btn(`${icon('note')}Add order note`, 'sell-note', 'quiet small sell-note-add', from.trim());
  const cartSold = withCartSold(s);
  return `<ul class="sell-lines" aria-label="Items in cart">${s.draft.map(l => lineHtml(l, s, c, cartSold, inSheet)).join('')}</ul>
    ${note}
    <div class="sell-totals">
      <div class="sell-total-row"><span>Subtotal</span><strong>${esc(money(t.subtotal))}</strong></div>
      ${t.discount > 0 ? `<div class="sell-total-row is-discount"><span>${icon('tag')}${esc(t.discountInfo?.label || 'Discount')}</span><strong>− ${esc(money(t.discount))}</strong></div>` : ''}
      ${rule && t.minimumShort > 0 ? `<p class="sell-total-hint">Add ${esc(money(t.minimumShort))} more for “${esc(rule.label)}”.</p>` : ''}
      <div class="sell-total-row is-total"><span>Total</span><strong>${esc(money(t.total))}</strong></div>
    </div>`;
}

/** @param {any} s @param {any} c */
function payButton(s, c, cls = '') {
  const t = draftTotals(s, c);
  const empty = !s.draft.length;
  return btn(`<span>Review &amp; Pay</span>${empty ? '' : `<strong class="sell-pay-amt">${esc(money(t.total))}</strong>`}${icon('arrow')}`, 'co-open',
    `primary big block sell-pay${cls ? ' ' + cls : ''}`, empty ? 'disabled' : '');
}

/** Sheet kind of the cart drawer (tablet) / full-screen order sheet (phone). */
const CART_KIND = 'cart';

/** "Next token #07" (+ PRACTICE) line shared by the panel and the sheet. @param {any} s */
const tokenLine = s => `next token ${esc(tokenLabel(upcomingToken(s)))}`;

/** @param {any} s @param {any} c @param {boolean} bump */
function cartPanel(s, c, bump) {
  const n = cartCount(s);
  const practice = store.state.mode === 'demo' ? '<span class="badge yellow">PRACTICE</span>' : '';
  return `<aside class="sell-cart-panel${bump ? ' sell-bump' : ''}" aria-label="Current order">
    <div class="sell-cart-head">
      <div class="grow"><h2 id="sell-cart-title" tabindex="-1">Current order</h2><span class="sell-cart-sub">${n ? plural(n, 'item') : 'No items yet'} · ${tokenLine(s)}</span></div>
      ${practice}
      ${s.draft.length ? btn(`${icon('trash')}Clear`, 'sell-clear', 'quiet small sell-clear') : ''}
    </div>
    <div class="sell-cart-scroll">${cartBody(s, c, false)}</div>
    <div class="sell-cart-foot">${payButton(s, c)}<p class="sell-kbd-hint">Ctrl + Enter to pay</p></div>
  </aside>`;
}

/**
 * Floating checkout bar (tablet + phone; hidden on desktop where the cart column shows). It reads exactly
 * "N items · ₹Total · Review & Pay →": the summary opens the cart, "Review & Pay →" goes straight to checkout.
 * @param {any} s @param {any} c @param {boolean} bump
 */
function cartBar(s, c, bump) {
  if (!s.draft.length) return '';
  const n = cartCount(s);
  const t = draftTotals(s, c);
  const summary = `${plural(n, 'item')} · ${money(t.total)}`;
  return `<div class="sell-cart-spacer" aria-hidden="true"></div>
  <div class="sell-cartbar${bump ? ' sell-bump' : ''}" role="region" aria-label="Cart"><button type="button" class="sell-cartbar-open" id="sell-cartbar-open-btn" data-action="sell-cart-open" aria-haspopup="dialog" aria-label="View order: ${esc(summary)}">${icon('cart', 'sell-cartbar-icon')}<span class="sell-cartbar-sum">${esc(summary)}</span></button><span class="sell-cartbar-dot" aria-hidden="true"> · </span><button type="button" class="primary sell-cartbar-pay" data-action="co-open">Review &amp; Pay →</button></div>`;
}

function cartSheetTitle() {
  const n = cartCount(S());
  return n ? `Your order · ${plural(n, 'item')}` : 'Your order';
}

function cartSheetMeta() {
  const s = S();
  const practice = store.state.mode === 'demo' ? '<span class="badge yellow">PRACTICE</span>' : '';
  return `<span class="sell-sheet-token">${icon('ticket')}<span>${tokenLine(s).replace(/^n/, 'N')}</span></span>${practice}`;
}

function cartSheetActions() {
  const s = S();
  return (s.draft.length ? btn(`${icon('trash')}Clear`, 'sell-clear', 'quiet-outline sell-sheet-clear') : btn('Back to menu', 'close', 'quiet-outline'))
    + payButton(s, C(), 'sell-sheet-pay');
}

/** Close the cart drawer on a backdrop click (a click whose target is the dialog box itself, outside its content). */
function wireBackdrop() {
  const sheet = sheetEl();
  if (!sheet || sheet.dataset.sellBackdrop) return;
  sheet.dataset.sellBackdrop = '1';
  sheet.addEventListener('click', e => {
    if (e.target !== sheet || sheetKind() !== CART_KIND) return;
    const r = sheet.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside || (e.clientX === 0 && e.clientY === 0)) closeSheet();
  });
}

function openCartSheet() {
  wireBackdrop();
  openSheet(esc(cartSheetTitle()),
    `<div class="sell-sheet-meta">${cartSheetMeta()}</div><div class="sell-cart-sheet">${cartBody(S(), C(), true)}</div>`,
    cartSheetActions(), CART_KIND, {onClose: () => refocus('sell-cartbar-open-btn')});
  // Start on the first control inside the drawer (focus stays trapped in the modal dialog).
  const first = /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('.sell-cart-sheet [data-action="sell-line-dec"], .sheet-close'));
  first?.focus({preventScroll: true});
}

/** Keep an open cart sheet in step with the cart (the kernel only re-renders #app). */
function refreshCartSheet() {
  if (sheetKind() !== CART_KIND) return;
  const sheet = sheetEl();
  // Remember the focused control (by action + line) so keyboard and screen-reader users stay put.
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const was = active && sheet.contains(active) ? {action: active.dataset.action || '', line: active.dataset.line || ''} : null;
  const title = sheet.querySelector('#sheet-title');
  if (title) title.textContent = cartSheetTitle();
  const meta = sheet.querySelector('.sell-sheet-meta');
  if (meta) meta.innerHTML = cartSheetMeta();
  const body = sheet.querySelector('.sell-cart-sheet');
  if (body) body.innerHTML = cartBody(S(), C(), true);
  const actions = sheet.querySelector('.sheet-actions');
  if (actions) actions.innerHTML = cartSheetActions();
  if (!was || (document.activeElement && sheet.contains(document.activeElement))) return;
  const sel = was.line ? `[data-action="${was.action}"][data-line="${CSS.escape(was.line)}"]` : `[data-action="${was.action}"]`;
  const next = /** @type {HTMLElement|null} */ (
    [sheet.querySelector(sel), sheet.querySelector('.sell-cart-sheet [data-action="sell-line-dec"]'), sheet.querySelector('.sheet-close')]
      .find(el => el && !(/** @type {any} */ (el).disabled)) || null
  );
  next?.focus({preventScroll: true});
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function renderSell() {
  const c = C();
  const s = S();
  const bump = bumpNext;
  const pop = popNext;
  bumpNext = false;
  popNext = '';
  renderCartSold = null;
  const r = report(s, c);
  const visible = c.products.filter((/** @type {any} */ p) => p.active);
  const top = r.best
    .map(b => productById(c, b.productId))
    .filter(p => p && p.active)
    .slice(0, TOP_LIMIT);
  if (filter === 'top' && !top.length) filter = 'all';
  if (filter.startsWith('cat:') && !c.categories.some((/** @type {any} */ x) => x.id === filter.slice(4))) filter = 'all';
  const unpriced = visible.filter((/** @type {any} */ p) => p.price === null).length;
  return `<div class="sell-layout${quickEdit ? ' is-quick' : ''}">
    <div class="sell-main">
      ${hero(visible)}
      ${missionStrip(r.mission)}
      ${setupBanner(unpriced)}
      ${quickEditBanner()}
      ${c.products.length ? toolbar(c, visible, top) : ''}
      <div class="sell-products">${products(c, s, visible, top, pop)}</div>
    </div>
    ${cartPanel(s, c, bump)}
  </div>
  ${cartBar(s, c, bump)}`;
}

registerScreen('sell', renderSell);

// ---------------------------------------------------------------------------------------------------------------------
// Adding items
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Commit a cart change with the add feedback (cart bump + card pop).
 * @param {(st: any) => any} fn
 * @param {string} productId
 */
async function commitAdd(fn, productId) {
  bumpNext = true;
  popNext = productId;
  try {
    await commit(fn);
  } finally {
    bumpNext = false;
    popNext = '';
  }
  refreshCartSheet();
}

/** Explain why a card can't be added (and offer the price sheet to an unlocked owner). @param {any} p @param {string} reason */
function explainBlocked(p, reason) {
  const name = displayName(p);
  if (reason === 'unpriced') {
    if (isAdmin()) return runAction('menu-quick-price', {id: p.id});
    toast(`${name} has no price yet. The owner sets it in Menu › Price board.`, {tone: 'warn'});
    return undefined;
  }
  const why = {
    soldout: `${name} is sold out right now.`,
    component: `${name} is out: an item inside this combo is sold out.`,
    stock: `${name} is out of stock. Restock it in the Stock room.`,
    hidden: `${name} is hidden from the menu.`,
  }[reason] || `${name} can’t be sold right now.`;
  toast(why, {tone: 'warn'});
  return undefined;
}

/** Add one product (or open its customize sheet). @param {string} id */
async function addProduct(id) {
  const c = C();
  const p = productById(c, id);
  if (!p) throw Error('That item is no longer on the menu.');
  const sale = addable(S(), c, p);
  if (sale.capped) {
    const n = cartQty(S(), p.id);
    toast(n ? `All the ${displayName(p)} left is already in this cart.` : `No ${displayName(p)} stock left after this cart.`, {tone: 'warn'});
    return undefined;
  }
  if (!sale.ok) return explainBlocked(p, sale.reason);
  if (isCustom(p)) return openCustomize(p.id);
  await commitAdd(st => addToDraft(st[st.mode], st.config, makeLine(st.config, id)), id);
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Customize sheet
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function openCustomize(id) {
  const c = C();
  const p = productById(c, id);
  if (!p) throw Error('That item is no longer on the menu.');
  cz = {id, flavour: c.flavours[0] || '', addons: new Set(), quantity: 1, note: ''};
  const flavours = c.flavours.length
    ? select('Flavour', 'sell-cz-flavour', c.flavours, cz.flavour, 'data-change="sell-cz-flavour"')
    : '';
  const addons = c.addons.length
    ? `<fieldset class="sell-cz-group"><legend class="field-label">Add-ons <span class="muted">(optional)</span></legend>
        <div class="sell-cz-addons">${c.addons.map((/** @type {any} */ a) =>
          `<button type="button" class="chip sell-cz-addon" data-action="sell-cz-addon" data-addon="${esc(a.id)}" aria-pressed="false">${icon('plus')}<span>${esc(a.name)}</span><span class="sell-cz-addon-price">+${esc(money(a.price))}</span></button>`).join('')}</div>
      </fieldset>`
    : '';
  const body = `<form class="sell-cz" data-submit="sell-cz-add">
    <div class="sell-cz-item">
      ${artFrame(p, {size: 'sm'})}
      <div class="grow"><strong class="sell-cz-name">${esc(displayName(p))}</strong>${p.size ? ` <span class="sell-size">${esc(p.size)}</span>` : ''}
      ${p.subtitle ? `<small>${esc(p.subtitle)}</small>` : ''}</div>
      <span class="price sell-cz-base">${esc(money(p.price))}</span>
    </div>
    ${flavours}
    ${addons}
    <div class="sell-cz-qty">
      <span class="field-label" id="sell-cz-qty-label">Quantity</span>
      <div class="sell-stepper is-big" role="group" aria-labelledby="sell-cz-qty-label">
        ${btn(icon('minus'), 'sell-cz-dec', 'sell-step', 'aria-label="One less"')}
        <span class="sell-step-qty" data-cz-qty aria-live="polite">1</span>
        ${btn(icon('plus'), 'sell-cz-inc', 'sell-step', 'aria-label="One more"')}
      </div>
    </div>
    ${textarea('Note for this item', 'sell-cz-note', '', `maxlength="${LIMITS.note}" rows="2" placeholder="Extra spicy, no onion…" data-input="sell-cz-note"`, `Optional · up to ${LIMITS.note} characters`)}
    <p class="sell-cz-live" data-cz-live aria-live="polite"></p>
  </form>`;
  openSheet(esc(`Make it yours`), body,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('cart')}<span data-cz-add>Add</span>`, 'sell-cz-add', 'primary sell-cz-submit'),
    'sell-customize', {onClose: () => {
      cz = null;
      refocus(`sell-card-${id}`);
    }});
  refreshCustomize();
}

/** The line the customize sheet would add (null when it can't be built). */
function previewLine() {
  if (!cz) return null;
  const c = C();
  return makeLine(c, cz.id, {
    quantity: cz.quantity,
    addons: [...cz.addons],
    flavour: c.flavours.length ? cz.flavour : '',
    note: cz.note,
  });
}

/** Update the live parts of the customize sheet in place (keeps focus and scroll). */
function refreshCustomize() {
  const sheet = sheetEl();
  if (!cz || sheetKind() !== 'sell-customize' || !sheet) return;
  for (const el of sheet.querySelectorAll('[data-addon]')) {
    const on = cz.addons.has(/** @type {HTMLElement} */ (el).dataset.addon || '');
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  }
  const qty = sheet.querySelector('[data-cz-qty]');
  if (qty) qty.textContent = String(cz.quantity);
  const dec = /** @type {HTMLButtonElement|null} */ (sheet.querySelector('[data-action="sell-cz-dec"]'));
  if (dec) dec.disabled = cz.quantity <= 1;
  const inc = /** @type {HTMLButtonElement|null} */ (sheet.querySelector('[data-action="sell-cz-inc"]'));
  if (inc) inc.disabled = cz.quantity >= MAX_QUANTITY;
  let line = null;
  try {
    line = previewLine();
  } catch {
    line = null;
  }
  const live = sheet.querySelector('[data-cz-live]');
  const add = sheet.querySelector('[data-cz-add]');
  if (line) {
    if (live) live.innerHTML = `<span>${esc(money(line.unitPrice))} each × ${line.quantity}</span><strong>${esc(money(line.lineTotal))}</strong>`;
    if (add) add.textContent = `Add ${line.quantity} · ${money(line.lineTotal)}`;
  } else {
    if (live) live.textContent = '';
    if (add) add.textContent = 'Add';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Note sheet
// ---------------------------------------------------------------------------------------------------------------------

function openNoteSheet() {
  const note = S().draftNote;
  openSheet(
    'Order note',
    `<form class="sell-note-form" data-submit="sell-note-save">
      <p class="muted sell-note-intro">Shows on the kitchen queue and the receipt.</p>
      ${textarea('Note for the whole order', 'sell-note-text', note, `maxlength="${LIMITS.note}" rows="3" placeholder="Extra spicy · no onion · pack separately" autofocus`, `Up to ${LIMITS.note} characters`)}
    </form>`,
    (note ? btn(`${icon('trash')}Remove note`, 'sell-note-remove', 'quiet-outline') : btn('Cancel', 'sell-note-cancel', 'quiet-outline'))
      + btn(`${icon('check')}Save note`, 'sell-note-save', 'primary'),
    'sell-note',
  );
}

/** After the note sheet: back to the cart sheet on phones, else just close. */
function leaveNoteSheet() {
  if (noteFromSheet) openCartSheet();
  else closeSheet();
  noteFromSheet = false;
}

/** @param {string} value */
async function saveNote(value) {
  await commit(st => setDraftNote(st[st.mode], value));
  leaveNoteSheet();
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions, inputs, keyboard
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Change one line's quantity by ±1 (0 removes it). The quantity is read inside the transaction, so queued taps add up.
 * @param {string} lineId
 * @param {number} delta
 */
async function stepLine(lineId, delta) {
  await commit(st => {
    const s = st[st.mode];
    const line = s.draft.find((/** @type {any} */ l) => l.id === lineId);
    if (!line) throw Error('That item is no longer in the cart.');
    setLineQuantity(s, lineId, line.quantity + delta);
  });
  refreshCartSheet();
  refocus(`sell-${delta > 0 ? 'li' : 'ld'}-${lineId}`, ...panelFallback());
}

/** Where keyboard focus goes when the panel control it was on disappears. */
const panelFallback = () => {
  const first = /** @type {HTMLElement|null} */ (document.querySelector('.sell-cart-panel [id^="sell-ld-"]'));
  return [first?.id || '', 'sell-cart-title'];
};

registerActions({
  'sell-add': (el, ds) => {
    const id = ds.id || '';
    return queueCart(el, `add:${id}`, async () => {
      await addProduct(id);
      refocus(`sell-card-${id}`);
    });
  },
  'sell-quick-edit': () => {
    quickEdit = !quickEdit;
    render();
  },
  'sell-filter': (_el, ds) => {
    filter = ds.filter || 'all';
    render();
  },
  'sell-search-clear': () => {
    query = '';
    render();
    /** @type {HTMLInputElement|null} */ (document.getElementById(SEARCH_ID))?.focus();
  },
  // Card "+": one more of a plain item; customizable items reopen the options sheet (addProduct does both).
  'sell-inc': (el, ds) => {
    const id = ds.id || '';
    return queueCart(el, `add:${id}`, async () => {
      await addProduct(id);
      refocus(`sell-inc-${id}`, `sell-card-${id}`);
    });
  },
  // Card "−": one less from the most recent cart line of that item.
  'sell-dec': (el, ds) => {
    const id = ds.id || '';
    return queueCart(el, `dec:${id}`, async () => {
      await commit(st => {
        const s = st[st.mode];
        const line = [...s.draft].reverse().find((/** @type {any} */ l) => l.productId === id);
        if (line) setLineQuantity(s, line.id, line.quantity - 1);
      });
      refreshCartSheet();
      refocus(`sell-dec-${id}`, `sell-card-${id}`);
    });
  },
  'sell-line-inc': (el, ds) => queueCart(el, `line:${ds.line}`, () => stepLine(ds.line || '', 1)),
  'sell-line-dec': (el, ds) => queueCart(el, `line:${ds.line}`, () => stepLine(ds.line || '', -1)),
  'sell-line-remove': (el, ds) => queueCart(el, `line:${ds.line}`, async () => {
    await commit(st => removeLine(st[st.mode], ds.line || ''));
    refreshCartSheet();
    refocus(...panelFallback());
  }),
  'sell-clear': () => {
    const s = S();
    if (!s.draft.length) return;
    const n = cartCount(s);
    const t = draftTotals(s, C());
    confirmSheet({
      title: 'Clear the cart?',
      body: `<p>This removes <strong>${plural(n, 'item')}</strong> (${esc(money(t.total))})${s.draftNote ? ' and the order note' : ''}. Nothing has been charged.</p>`,
      confirmLabel: 'Clear cart',
      danger: true,
      onConfirm: async () => {
        await commit(st => clearDraft(st[st.mode]));
        toast('Cart cleared. Fresh start!');
      },
    });
  },
  'sell-cart-open': () => openCartSheet(),
  'sell-note': (_el, ds) => {
    noteFromSheet = ds.from === 'sheet' || sheetKind() === CART_KIND;
    openNoteSheet();
  },
  'sell-note-save': () => {
    const el = /** @type {HTMLTextAreaElement|null} */ (sheetEl()?.querySelector('#sell-note-text'));
    return saveNote(el?.value ?? '');
  },
  'sell-note-remove': () => saveNote(''),
  'sell-note-cancel': () => leaveNoteSheet(),
  'sell-cz-addon': (_el, ds) => {
    if (!cz) return;
    const id = ds.addon || '';
    if (cz.addons.has(id)) cz.addons.delete(id);
    else cz.addons.add(id);
    refreshCustomize();
  },
  'sell-cz-inc': () => {
    if (!cz) return;
    cz.quantity = Math.min(MAX_QUANTITY, cz.quantity + 1);
    refreshCustomize();
  },
  'sell-cz-dec': () => {
    if (!cz) return;
    cz.quantity = Math.max(1, cz.quantity - 1);
    refreshCustomize();
  },
  'sell-cz-add': async () => {
    if (!cz) return;
    const pick = {...cz, addons: [...cz.addons]};
    previewLine(); // throws a cashier-friendly message into the sheet when the item can't be built
    await commitAdd(st => {
      const c = st.config;
      return addToDraft(st[st.mode], c, makeLine(c, pick.id, {
        quantity: pick.quantity,
        addons: pick.addons,
        flavour: c.flavours.length ? pick.flavour : '',
        note: pick.note,
      }));
    }, pick.id);
    closeSheet();
    refocus(`sell-inc-${pick.id}`, `sell-card-${pick.id}`);
  },
});

registerInputs({
  'sell-search': el => {
    query = String(el.value || '').slice(0, 60);
    render();
  },
  'sell-cz-note': el => {
    if (cz) cz.note = String(el.value || '');
    refreshCustomize();
  },
});

registerChanges({
  'sell-cz-flavour': el => {
    if (cz) cz.flavour = String(el.value || '');
    refreshCustomize();
  },
});

/** @param {EventTarget|null} t */
const isTyping = t => {
  const el = /** @type {HTMLElement|null} */ (t);
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

function onKey(/** @type {KeyboardEvent} */ e) {
  if (ui.screen !== 'sell' || e.defaultPrevented || e.isComposing) return;
  const pinOpen = !!document.querySelector('#pin-dialog[open]');
  if (pinOpen) return;
  const kind = sheetKind();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    if (kind && kind !== CART_KIND) return;
    e.preventDefault();
    if (!S().draft.length) {
      toast('Cart’s empty. Tap an item first.', {tone: 'warn'});
      return;
    }
    runAction('co-open');
    return;
  }
  if (kind) return;
  const target = /** @type {HTMLElement|null} */ (e.target);
  if (target?.id === SEARCH_ID) {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      query = '';
      render();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && lastResults.length === 1) {
      e.preventDefault();
      runAction('sell-add', {id: lastResults[0]});
    }
    return;
  }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(SEARCH_ID));
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  }
}

if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
