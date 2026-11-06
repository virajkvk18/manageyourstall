// Menu manager for ManageYourStall (ARCHITECTURE.md §13.6): categories, items, combos, prices, price locks,
// add-ons & flavours and the stock room.
//
// Every change goes through commitConfig(st => catalog helper…) so an invalid edit rolls back and shows the catalog's
// human message. Everything except the 1-tap Sold out / In stock switch needs the admin PIN.
// Sheets keep unsaved input in module-level drafts so the visual picker (which replaces the sheet) and the PIN
// dialog never lose what the owner typed.
import {
  C, S, esc, money, paise, icon, btn, field, select, textarea, toggle, heading, emptyState, artFrame, toast, openSheet,
  closeSheet, sheetEl, sheetKind, confirmSheet, commitConfig, requireAdmin, render, registerScreen, registerActions, registerInputs,
  registerChanges,
} from './core.mjs';
import * as catalog from '../catalog.mjs';
import {audit, sellability, stockUsed, unitPrice} from '../domain.mjs';
import {TAGS, SIZE_SUGGESTIONS, LIMITS} from '../constants.mjs';
import {openPicker} from './picker.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Transient state
// ---------------------------------------------------------------------------------------------------------------------

/** Screen filter + search. */
const view = {filter: 'all', query: ''};

/** Select value that means "create a new category" in the product editor. */
const NEW_CAT = '__new__';

/**
 * Product / combo editor draft (survives the visual picker and PIN prompts).
 * @type {null | {id: string|null, combo: boolean, title: string, wasLocked: boolean, qty: Record<string, number>, data: any}}
 */
let draft = null;

/** Add-ons & flavours sheet draft. @type {null | {rows: {id: string|null, name: string, price: string}[], flavours: string}} */
let addonDraft = null;

/** Stock room draft. @type {null | {inventory: boolean, totals: Record<string, string>}} */
let stockDraft = null;

const QUICK_PRICES = [20, 30, 40, 50, 60, 80, 100, 150];
const CATEGORY_IDEAS = ['Chaat', 'Momos', 'Maggi', 'Hot drinks', 'Cold drinks', 'Desserts', 'Combos', 'Specials'];

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function need(id) {
  const p = C().products.find(x => x.id === id);
  if (!p) throw Error('That item no longer exists.');
  return p;
}

/**
 * Run a write behind the PIN (it may have expired while a confirm sheet was open). A cancelled PIN prompt throws, so
 * the confirm sheet stays open with an honest message instead of a "done" toast for a change that never happened.
 * @param {() => Promise<unknown>} write
 */
async function asAdmin(write) {
  const done = await requireAdmin(async () => {
    await write();
    return true;
  });
  if (!done) throw Error('Nothing changed — the PIN was cancelled.');
}

/** @param {string} id */
function needCategory(id) {
  const cat = C().categories.find(x => x.id === id);
  if (!cat) throw Error('That category no longer exists.');
  return cat;
}

/** 'chips-small' → 'Chips small'. @param {string} key */
const humanize = key => {
  const s = String(key || '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

/** Paise → plain rupee text for an input ('30', '12.50', '' for null). @param {number|null} p */
const rupeeText = p => (p === null || p === undefined ? '' : p % 100 ? (p / 100).toFixed(2) : String(p / 100));

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** @param {string} id */
const tagLabel = id => TAGS.find(t => t.id === id)?.label || id;

/** @param {unknown} err */
const msg = err => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err));

/**
 * Parse an owner-typed price: blank → null (not priced yet), else exact paise.
 * @param {string} text
 * @param {string} [what] prefix for the error message
 */
function priceFrom(text, what = '') {
  const t = String(text ?? '').trim();
  if (!t) return null;
  try {
    return paise(t);
  } catch (err) {
    throw Error(what ? `${what}: ${msg(err)}` : msg(err));
  }
}

/** Set a 1-tap switch / chip button on or off in place (no re-render). @param {Element} el @param {boolean} on */
function setPressed(el, on) {
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.classList.toggle(el.classList.contains('chip') ? 'active' : 'on', on);
  const target = /** @type {HTMLElement} */ (el).dataset.locks;
  if (target) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(target));
    if (input) input.disabled = on;
  }
}

/** @param {Element|null|undefined} root @param {string} sel */
const pressed = (root, sel) => root?.querySelector(sel)?.getAttribute('aria-pressed') === 'true';

/** Value of an input inside the open sheet. @param {string} id */
const valueOf = id => /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector(`#${id}`))?.value ?? '';

/** ₹-prefixed text input (blank = not set). @param {string} id @param {string} value @param {string} [extra] @param {string} [cls] */
const moneyInput = (id, value, extra = '', cls = '') =>
  `<div class="menu-money${cls ? ' ' + cls : ''}"><span class="menu-money-sign" aria-hidden="true">₹</span><input id="${esc(id)}" name="${esc(id)}" type="text" inputmode="decimal" autocomplete="off" placeholder="Not set" value="${esc(value)}"${extra ? ' ' + extra : ''}></div>`;

/**
 * Separate-price math for a combo hint: Σ component price × qty (display only; the combo's own price is what sells).
 * @param {{productId: string, quantity: number}[]} parts
 */
function separatePrice(parts) {
  const c = C();
  let total = 0;
  let missing = false;
  let count = 0;
  for (const part of parts) {
    const p = c.products.find(x => x.id === part.productId);
    if (!p || part.quantity <= 0) continue;
    count += part.quantity;
    const each = unitPrice(p, c);
    if (each === null) missing = true;
    else total += each * part.quantity;
  }
  return {total, missing, count};
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

/** @param {any} p @param {string} catName */
function matches(p, catName) {
  if (view.filter === 'soldout' && !p.soldOut) return false;
  if (view.filter === 'unpriced' && p.price !== null) return false;
  if (view.filter === 'hidden' && p.active) return false;
  const q = view.query.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.subtitle, p.size, catName, ...p.tags.map(tagLabel)].some(t => String(t || '').toLowerCase().includes(q));
}

/** @param {any} p @param {any} c */
function comboLine(p, c) {
  const names = p.bundle.map(part => {
    const item = c.products.find(x => x.id === part.productId);
    return `${part.quantity > 1 ? `${part.quantity}× ` : ''}${item ? item.name : 'Missing item'}`;
  });
  const sep = separatePrice(p.bundle);
  const saves = p.price !== null && !sep.missing && sep.total > p.price ? ` · saves ${money(sep.total - p.price)}` : '';
  return `${names.join(' + ')}${saves}`;
}

/**
 * One product row.
 * @param {any} p @param {any} c @param {any} s @param {boolean} first @param {boolean} last
 */
function productRow(p, c, s, first, last) {
  const id = esc(p.id);
  const name = esc(p.name);
  const sell = sellability(s, c, p);
  const tags = p.tags.map(t => `<span class="tag tag-${esc(t)}">${esc(tagLabel(t))}</span>`).join('');
  const size = p.size ? `<span class="badge menu-size">${esc(p.size)}</span>` : '';
  const sub = p.bundle ? comboLine(p, c) : p.subtitle;
  const flags = [];
  if (!p.active) flags.push(`<span class="badge lavender">${icon('eye-off')} Hidden</span>`);
  if (p.soldOut) flags.push('<span class="badge coral">Sold out</span>');
  if (!p.soldOut && sell.reason === 'component') flags.push('<span class="badge coral">Item inside is out</span>');
  if (sell.left !== null) flags.push(`<span class="badge ${sell.left <= 5 ? 'orange' : 'mint'}">${sell.left} left</span>`);
  if (p.customizable) flags.push('<span class="badge sky">Customizable</span>');
  const price = p.price === null
    ? `<button type="button" class="menu-price unset" data-action="menu-quick-price" data-id="${id}" aria-label="Set a price for ${name}">SET PRICE</button>`
    : `<button type="button" class="menu-price${p.priceLocked ? ' locked' : ''}" data-action="menu-quick-price" data-id="${id}" aria-label="Price of ${name}: ${esc(money(p.price))}${p.priceLocked ? ' (locked)' : ''}. Tap to change.">${p.priceLocked ? icon('lock', 'menu-lock') : ''}<span>${esc(money(p.price))}</span></button>`;
  return `<article class="menu-row${p.active ? '' : ' is-hidden'}${p.soldOut ? ' is-soldout' : ''}" data-product="${id}">
    ${artFrame(p, {size: 'sm', cls: 'menu-row-art'})}
    <div class="menu-row-info">
      <div class="menu-row-name"><h3>${name}</h3>${size}${tags}</div>
      ${sub ? `<p class="menu-row-sub">${esc(sub)}</p>` : ''}
      ${flags.length ? `<div class="menu-row-flags">${flags.join('')}</div>` : ''}
    </div>
    <div class="menu-row-price">${price}</div>
    <div class="menu-row-ctrl">
      <div class="menu-switches">
        ${toggle('menu-toggle-soldout', p.soldOut ? 'Sold out' : 'In stock', !p.soldOut, `data-id="${id}" aria-label="In stock: ${name}"`)}
        ${toggle('menu-toggle-visible', p.active ? 'Visible' : 'Hidden', p.active, `data-id="${id}" aria-label="Visible on Sell: ${name}"`)}
      </div>
      <div class="menu-tools">
        ${btn(`${icon('edit')}<span class="menu-tool-text">Edit</span>`, 'menu-edit-product', 'small yellow menu-edit', `data-id="${id}" aria-label="Edit ${name}"`)}
        ${btn(icon('duplicate'), 'menu-dup', 'small icon-btn', `data-id="${id}" aria-label="Duplicate ${name}" title="Duplicate"`)}
        ${btn(icon('up'), 'menu-move', 'small icon-btn', `data-id="${id}" data-dir="-1" aria-label="Move ${name} up" title="Move up"${first ? ' disabled' : ''}`)}
        ${btn(icon('down'), 'menu-move', 'small icon-btn', `data-id="${id}" data-dir="1" aria-label="Move ${name} down" title="Move down"${last ? ' disabled' : ''}`)}
        ${btn(icon('trash'), 'menu-delete', 'small icon-btn danger', `data-id="${id}" aria-label="Delete ${name}" title="Delete"`)}
        ${btn(icon('more'), 'menu-row-more', 'small icon-btn menu-more-btn', `data-id="${id}" aria-label="More for ${name}" title="More"`)}
      </div>
    </div>
  </article>`;
}

/** @param {string} key @param {string} label @param {number} count */
function filterChip(key, label, count) {
  const on = view.filter === key;
  return `<button type="button" class="chip${on ? ' active' : ''}" data-action="menu-filter" data-filter="${key}" aria-pressed="${on}">${label}<span class="menu-chip-count">${count}</span></button>`;
}

function menuScreen() {
  const c = C();
  const s = S();
  let priced = 0;
  let sold = 0;
  let hidden = 0;
  let unpricedVisible = 0;
  for (const p of c.products) {
    if (p.price !== null) priced++;
    else if (p.active) unpricedVisible++;
    if (p.soldOut) sold++;
    if (!p.active) hidden++;
  }
  const total = c.products.length;
  const counts = `<div class="menu-counts" aria-label="Menu summary">
    <span class="badge ink">${plural(total, 'item')}</span>
    <span class="badge ${priced === total ? 'lime' : 'yellow'}">${priced}/${total} priced</span>
    <span class="badge${sold ? ' coral' : ''}">${sold} sold out</span>
    <span class="badge${hidden ? ' lavender' : ''}">${hidden} hidden</span>
  </div>`;

  const toolbar = `<div class="menu-toolbar">
    ${btn(`${icon('plus')} Item`, 'menu-new-product', 'primary')}
    ${btn(`${icon('plus')} Category`, 'menu-new-category')}
    ${btn(`${icon('plus')} Combo`, 'menu-new-combo', 'lavender')}
    ${btn(`${icon('rupee')} Price board`, 'menu-price-board', 'yellow')}
    ${btn(`${icon('sliders')} Add-ons & flavours`, 'menu-addons', 'mint')}
    ${btn(`${icon('box')} Stock room`, 'menu-stock', 'sky')}
  </div>`;

  const setup = unpricedVisible
    ? `<div class="notice pink menu-setup">${icon('alert')}<div class="grow"><strong>${plural(unpricedVisible, 'item')} still ${unpricedVisible === 1 ? 'needs' : 'need'} a price.</strong> ${unpricedVisible === 1 ? 'It shows' : 'They show'} on Sell but can’t be sold yet.</div>${btn('Set prices', 'menu-price-board', 'small')}</div>`
    : '';

  const filters = `<div class="menu-filters">
    <div class="menu-search">${icon('search')}<input id="menu-search" type="search" value="${esc(view.query)}" placeholder="Search items, sizes, tags" aria-label="Search the menu" autocomplete="off" data-input="menu-search"></div>
    <div class="menu-chips" role="group" aria-label="Show">
      ${filterChip('all', 'All', total)}
      ${filterChip('soldout', 'Sold out', sold)}
      ${filterChip('unpriced', 'Not priced', total - priced)}
      ${filterChip('hidden', 'Hidden', hidden)}
    </div>
  </div>`;

  const filtering = view.filter !== 'all' || view.query.trim() !== '';
  const sections = c.categories.map((cat, i) => {
    const all = c.products.filter(p => p.categoryId === cat.id);
    const shown = filtering ? all.filter(p => matches(p, cat.name)) : all;
    if (filtering && !shown.length) return '';
    const cid = esc(cat.id);
    const cname = esc(cat.name);
    const rows = shown.map(p => productRow(p, c, s, p === all[0], p === all[all.length - 1])).join('');
    const empty = `<div class="menu-cat-empty"><p>No items here yet.</p>${btn(`${icon('plus')} Add the first item`, 'menu-new-product', 'small', `data-category="${cid}"`)}</div>`;
    return `<section class="panel menu-cat" data-category="${cid}" aria-labelledby="menu-cat-${i}">
      <header class="menu-cat-head">
        <div class="menu-cat-title"><h2 id="menu-cat-${i}">${cname}</h2><span class="badge">${plural(all.length, 'item')}</span></div>
        <div class="menu-cat-tools">
          ${btn(`${icon('plus')}<span class="menu-tool-text">Item</span>`, 'menu-new-product', 'small menu-cat-add', `data-category="${cid}" aria-label="Add an item to ${cname}"`)}
          ${btn(icon('edit'), 'menu-rename-category', 'small icon-btn', `data-id="${cid}" aria-label="Rename ${cname}" title="Rename"`)}
          ${btn(icon('up'), 'menu-move-category', 'small icon-btn', `data-id="${cid}" data-dir="-1" aria-label="Move ${cname} up" title="Move up"${i === 0 ? ' disabled' : ''}`)}
          ${btn(icon('down'), 'menu-move-category', 'small icon-btn', `data-id="${cid}" data-dir="1" aria-label="Move ${cname} down" title="Move down"${i === c.categories.length - 1 ? ' disabled' : ''}`)}
          ${btn(icon('trash'), 'menu-delete-category', 'small icon-btn danger', `data-id="${cid}" aria-label="Delete ${cname}" title="Delete category"`)}
        </div>
      </header>
      <div class="menu-rows">${rows || empty}</div>
    </section>`;
  }).join('');

  const nothing = filtering && !sections
    ? emptyState('search', 'Nothing matches', 'Try another word or show everything.', btn('Show all items', 'menu-clear-filter', 'small'))
    : '';

  return `<div class="menu-screen">
    ${heading('Your menu', 'Tap, tweak, done. Prices, combos and stock in one place.', counts)}
    ${toolbar}
    ${setup}
    ${filters}
    <div class="menu-cats">${sections}${nothing}</div>
    <p class="footnote menu-foot">${icon('lock', 'menu-foot-icon')} Menu edits need the admin PIN. Sold out / In stock is one tap for any cashier — no PIN.</p>
  </div>`;
}

registerScreen('menu', menuScreen);

/** Phone: every row tool in one bottom sheet (the row itself keeps the switches, Edit and price). @param {string} id */
function rowSheet(id) {
  const p = need(id);
  const same = C().products.filter(x => x.categoryId === p.categoryId);
  const i = same.indexOf(p);
  const pid = `data-id="${esc(p.id)}"`;
  openSheet(
    esc(p.name),
    `<div class="menu-rowsheet">
      ${btn(`${icon('edit')} Edit item`, 'menu-edit-product', 'block yellow', pid)}
      ${btn(`${icon('rupee')} ${p.price === null ? 'Set price' : `Change price (${esc(money(p.price))})`}`, 'menu-quick-price', 'block', pid)}
      ${btn(`${icon('duplicate')} Duplicate`, 'menu-dup', 'block', pid)}
      <div class="menu-rowsheet-move">
        ${btn(`${icon('up')} Move up`, 'menu-move', '', `${pid} data-dir="-1"${i <= 0 ? ' disabled' : ''}`)}
        ${btn(`${icon('down')} Move down`, 'menu-move', '', `${pid} data-dir="1"${i === same.length - 1 ? ' disabled' : ''}`)}
      </div>
      ${btn(`${icon('trash')} Delete`, 'menu-delete', 'block danger', pid)}
    </div>`,
    '',
    'menu-row',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string|null} id existing category (rename) or null (new) */
function categorySheet(id) {
  const cat = id ? needCategory(id) : null;
  const taken = new Set(C().categories.map(x => x.name.toLowerCase()));
  const ideas = cat ? [] : CATEGORY_IDEAS.filter(x => !taken.has(x.toLowerCase())).slice(0, 6);
  const idAttr = cat ? ` data-id="${esc(cat.id)}"` : '';
  openSheet(
    cat ? `Rename “${esc(cat.name)}”` : 'New category',
    `<form class="menu-cat-form" data-submit="menu-save-category"${idAttr}>
      ${field('Category name', 'menu-cat-name', cat ? cat.name : '', 'text', `maxlength="${LIMITS.categoryName}" autocomplete="off" required autofocus`)}
      ${ideas.length ? `<div class="menu-ideas" role="group" aria-label="Ideas">${ideas.map(x => btn(esc(x), 'menu-fill', 'chip', `data-target="menu-cat-name" data-value="${esc(x)}"`)).join('')}</div>` : ''}
      ${cat ? '' : '<p class="footnote">New categories go to the end. Use ↑ ↓ to move them.</p>'}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(cat ? 'Save name' : `${icon('plus')} Add category`, 'menu-save-category', 'primary', idAttr.trim()),
    'menu-category',
  );
}

/** @param {string} id */
function deleteCategoryFlow(id) {
  const cat = needCategory(id);
  const c = C();
  const items = c.products.filter(p => p.categoryId === id);
  const others = c.categories.filter(x => x.id !== id);
  // Dry run on a copy so a blocked delete (last category) explains itself before anything is asked.
  catalog.deleteCategory(structuredClone(c), id, {moveTo: others[0]?.id ?? null});
  if (!items.length) {
    confirmSheet({
      title: `Delete “${esc(cat.name)}”?`,
      body: '<p>It’s empty, so nothing else changes.</p>',
      confirmLabel: 'Delete category',
      danger: true,
      onConfirm: async () => {
        await asAdmin(() => commitConfig(st => catalog.deleteCategory(st.config, id)));
        toast(`Category “${cat.name}” deleted.`);
      },
    });
    return;
  }
  openSheet(
    `Delete “${esc(cat.name)}”?`,
    `<form class="menu-cat-form" data-submit="menu-delete-category-go" data-id="${esc(id)}">
      <div class="notice">${icon('info')}<div><strong>${plural(items.length, 'item')} ${items.length === 1 ? 'lives' : 'live'} here.</strong> Pick where ${items.length === 1 ? 'it goes' : 'they go'} — prices, combos and sales history stay as they are.</div></div>
      <div class="menu-gap"></div>
      ${select('Move items to…', 'menu-cat-move', others.map(x => [x.id, x.name]), others[0]?.id ?? '')}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('trash')} Move & delete`, 'menu-delete-category-go', 'danger', `data-id="${esc(id)}"`),
    'menu-category',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Product & combo editor
// ---------------------------------------------------------------------------------------------------------------------

/** @param {boolean} combo @param {string} categoryId */
function blankDraft(combo, categoryId) {
  return {
    id: null,
    combo,
    title: combo ? 'New combo' : 'New item',
    wasLocked: false,
    qty: {},
    data: {
      name: '', subtitle: '', categoryId, newCategory: '', size: '', priceText: '', priceLocked: false,
      art: combo ? 'combo-snack-drink' : 'chips-packet', image: null, tint: combo ? 'lavender' : 'yellow', pattern: 'none',
      tags: combo ? ['COMBO'] : [], active: true, soldOut: false, customizable: false, stockKey: '', stockUnits: '1',
    },
  };
}

/** @param {any} p */
function draftFrom(p) {
  /** @type {Record<string, number>} */
  const qty = {};
  for (const part of p.bundle || []) qty[part.productId] = part.quantity;
  return {
    id: p.id,
    combo: !!p.bundle,
    title: `Edit “${p.name}”`,
    wasLocked: p.priceLocked,
    qty,
    data: {
      name: p.name, subtitle: p.subtitle, categoryId: p.categoryId, newCategory: '', size: p.size, priceText: rupeeText(p.price),
      priceLocked: p.priceLocked, art: p.art, image: p.image, tint: p.tint, pattern: p.pattern, tags: [...p.tags], active: p.active,
      soldOut: p.soldOut, customizable: p.customizable, stockKey: p.stockKey, stockUnits: String(p.stockUnits),
    },
  };
}

/** Copy what is typed in the open editor into the draft. */
function captureEditor() {
  const form = sheetEl()?.querySelector('#menu-editor');
  if (!form || !draft) return;
  const d = draft.data;
  d.name = valueOf('menu-ed-name');
  d.subtitle = valueOf('menu-ed-subtitle');
  d.categoryId = valueOf('menu-ed-category');
  d.newCategory = valueOf('menu-ed-newcat');
  d.size = valueOf('menu-ed-size');
  d.priceText = valueOf('menu-ed-price');
  d.priceLocked = pressed(form, '[data-field="priceLocked"]');
  d.active = pressed(form, '[data-field="active"]');
  d.soldOut = pressed(form, '[data-field="soldOut"]');
  d.tags = [...form.querySelectorAll('[data-tag][aria-pressed="true"]')].map(b => /** @type {HTMLElement} */ (b).dataset.tag);
  if (!draft.combo) {
    d.customizable = pressed(form, '[data-field="customizable"]');
    d.stockKey = valueOf('menu-ed-stock');
    d.stockUnits = valueOf('menu-ed-units');
  }
}

/** Combo savings hint (live). */
function comboHint() {
  if (!draft) return '';
  const parts = Object.entries(draft.qty).map(([productId, quantity]) => ({productId, quantity}));
  const sep = separatePrice(parts);
  if (!sep.count) return `${icon('info')}<span>Tap + on the items that go inside this combo.</span>`;
  let price = null;
  try {
    price = priceFrom(sheetEl()?.querySelector('#menu-ed-price') ? valueOf('menu-ed-price') : draft.data.priceText);
  } catch {
    price = null;
  }
  const base = `${plural(sep.count, 'item')} · ${money(sep.total)} if bought separately${sep.missing ? ' (some items have no price yet)' : ''}`;
  if (price === null || sep.missing) return `${icon('tag')}<span>${esc(base)}</span>`;
  const diff = sep.total - price;
  if (diff > 0) return `${icon('gift')}<span>${esc(base)} · <strong class="menu-saves">Saves ${esc(money(diff))} vs separate</strong></span>`;
  if (diff < 0) return `${icon('alert')}<span>${esc(base)} · <strong class="menu-costs">Costs ${esc(money(-diff))} more than separate</strong></span>`;
  return `${icon('tag')}<span>${esc(base)} · same as buying separately</span>`;
}

function refreshComboHint() {
  const el = sheetEl()?.querySelector('#menu-combo-hint');
  if (el) el.innerHTML = comboHint();
}

function comboSection() {
  const c = C();
  const groups = c.categories.map(cat => {
    const items = c.products.filter(p => p.categoryId === cat.id && !p.bundle && p.id !== draft?.id);
    if (!items.length) return '';
    return `<div class="menu-combo-group"><h4>${esc(cat.name)}</h4>${items.map(p => {
      const q = draft?.qty[p.id] || 0;
      const name = esc(p.name);
      return `<div class="menu-combo-item${q ? ' on' : ''}" data-combo-row="${esc(p.id)}">
        ${artFrame(p, {size: 'xs'})}
        <div class="grow"><strong>${name}</strong><small>${p.price === null ? 'No price yet' : esc(money(p.price))}${p.soldOut ? ' · sold out' : ''}</small></div>
        <div class="menu-stepper">
          ${btn(icon('minus'), 'menu-combo-step', 'small icon-btn', `data-id="${esc(p.id)}" data-dir="-1" aria-label="One less ${name}"${q ? '' : ' disabled'}`)}
          <output class="menu-step-qty" aria-label="${name} in combo">${q}</output>
          ${btn(icon('plus'), 'menu-combo-step', 'small icon-btn', `data-id="${esc(p.id)}" data-dir="1" aria-label="One more ${name}"${q >= catalog.CATALOG_LIMITS.bundleQuantity ? ' disabled' : ''}`)}
        </div>
      </div>`;
    }).join('')}</div>`;
  }).join('');
  return `<section class="menu-combo" aria-labelledby="menu-combo-h">
    <h3 class="menu-sub" id="menu-combo-h">What’s inside</h3>
    <div class="menu-combo-hint" id="menu-combo-hint" aria-live="polite">${comboHint()}</div>
    <div class="menu-combo-list">${groups || '<p class="muted">Add a few single items first, then bundle them here.</p>'}</div>
  </section>`;
}

/** @param {string} fieldName @param {string} label @param {boolean} on @param {string} [extra] */
const flip = (fieldName, label, on, extra = '') => toggle('menu-flip', label, on, `data-field="${fieldName}"${extra ? ' ' + extra : ''}`);

function openEditor() {
  if (!draft) return;
  const mine = draft;
  const c = C();
  const d = draft.data;
  const combo = draft.combo;
  const isNew = !draft.id;
  if (d.categoryId !== NEW_CAT && !c.categories.some(x => x.id === d.categoryId)) d.categoryId = c.categories[0]?.id || NEW_CAT;
  const cats = c.categories.map(x => [x.id, x.name]);
  const lockAttr = draft.wasLocked ? 'data-locks="menu-ed-price"' : '';
  const priceDisabled = draft.wasLocked && d.priceLocked ? ' disabled' : '';
  const tagChips = TAGS.map(t => {
    const on = d.tags.includes(t.id);
    return `<button type="button" class="chip menu-tag-opt${on ? ' active' : ''}" data-action="menu-tag" data-tag="${esc(t.id)}" aria-pressed="${on}"><span class="menu-tag-dot tag-${esc(t.id)}" aria-hidden="true"></span>${esc(t.label)}</button>`;
  }).join('');
  const pools = Object.keys(c.stock);
  const custom = `${plural(c.flavours.length, 'flavour')} and ${plural(c.addons.length, 'add-on')}`;

  const main = `
    ${field('Name', 'menu-ed-name', d.name, 'text', `maxlength="${LIMITS.productName}" autocomplete="off" required${isNew ? ' autofocus' : ''} placeholder="${combo ? 'e.g. Snack + Fizz' : 'e.g. Masala Maggi'}"`)}
    ${field('Subtitle <span class="menu-opt">optional</span>', 'menu-ed-subtitle', d.subtitle, 'text', `maxlength="${LIMITS.subtitle}" autocomplete="off" placeholder="${combo ? 'Best seller pair' : 'Crunchy, tangy, made fresh'}"`)}
    <div class="form-grid">
      ${select('Category', 'menu-ed-category', [...cats, [NEW_CAT, '+ New category…']], d.categoryId, 'data-change="menu-ed-category"')}
      ${field('Size <span class="menu-opt">optional</span>', 'menu-ed-size', d.size, 'text', `maxlength="${LIMITS.size}" list="menu-size-list" autocomplete="off" placeholder="Small, Large, Half…"`)}
    </div>
    <datalist id="menu-size-list">${SIZE_SUGGESTIONS.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
    <div class="menu-ed-newcat"${d.categoryId === NEW_CAT ? '' : ' hidden'}>
      ${field('New category name', 'menu-ed-newcat', d.newCategory, 'text', `maxlength="${LIMITS.categoryName}" autocomplete="off" placeholder="e.g. Desserts"`)}
    </div>
    <div class="menu-ed-price">
      <div class="field">
        <label for="menu-ed-price">${combo ? 'Combo price' : 'Price'}</label>
        ${moneyInput('menu-ed-price', d.priceText, `aria-describedby="menu-ed-price-hint"${combo ? ' data-input="menu-ed-price"' : ''}${priceDisabled}`, 'menu-money-lg')}
        <small id="menu-ed-price-hint">${priceDisabled ? 'Locked. Switch “Lock price” off to change it.' : 'Leave blank if you haven’t decided — it shows on Sell as “Set price” and can’t be sold yet.'}</small>
      </div>
      ${flip('priceLocked', `${icon('lock')} Lock price`, d.priceLocked, lockAttr)}
    </div>
    ${combo ? comboSection() : ''}
    <fieldset class="menu-ed-tags"><legend>Tags</legend><div class="menu-tag-list">${tagChips}</div></fieldset>
    ${combo ? '<p class="menu-hint">Combos use their items’ stock, so there’s no separate stock pool here.</p>' : `<div class="menu-ed-stock">
      <div class="form-grid">
        ${select('Stock pool', 'menu-ed-stock', [['', 'Not tracked'], ...pools.map(k => [k, humanize(k)])], d.stockKey)}
        ${field('Units per sale', 'menu-ed-units', d.stockUnits, 'number', `min="1" max="${catalog.CATALOG_LIMITS.stockUnits}" step="1" inputmode="numeric"`)}
      </div>
      <p class="menu-hint">${c.inventory ? 'Each sale uses this many units from the pool.' : 'Stock tracking is off right now — switch it on in Stock room.'}</p>
    </div>`}`;

  const side = `
    <div class="menu-ed-visual">
      ${artFrame(d, {size: 'lg', cls: 'menu-ed-art'})}
      ${btn(`${icon('image')} Change visual`, 'menu-ed-visual', 'small block')}
    </div>
    <div class="menu-ed-switches">
      ${flip('active', 'Visible on Sell', d.active)}
      ${flip('soldOut', 'Sold out for now', d.soldOut)}
      ${combo ? '' : `${flip('customizable', 'Customizable', d.customizable)}
      <p class="menu-hint">On Sell, a tap opens a quick sheet: flavour, add-ons, quantity and a note. You have ${esc(custom)} — edit them in Add-ons &amp; flavours.</p>`}
    </div>
`;

  openSheet(
    esc(draft.title),
    `<form id="menu-editor" class="menu-editor${combo ? ' is-combo' : ''}" data-submit="menu-save-product" novalidate>
      <div class="menu-ed-grid"><div class="menu-ed-main">${main}</div><aside class="menu-ed-side" aria-label="Look and status">${side}</aside></div>
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} ${isNew ? (combo ? 'Add combo' : 'Add item') : 'Save changes'}`, 'menu-save-product', 'primary menu-act'),
    'menu-editor',
    {wide: true, onClose: () => {
      if (draft === mine) draft = null;
    }},
  );
}

async function saveProductFromEditor() {
  if (!draft) throw Error('Nothing to save. Open the item again.');
  captureEditor();
  const mine = draft;
  const d = mine.data;
  /** @type {Record<string, any>} */
  const data = {
    name: d.name, subtitle: d.subtitle, size: d.size, price: priceFrom(d.priceText, 'Price'), priceLocked: d.priceLocked,
    art: d.art, image: d.image, tint: d.tint, pattern: d.pattern, tags: d.tags, active: d.active, soldOut: d.soldOut,
  };
  if (mine.id) data.id = mine.id;
  if (mine.combo) {
    data.bundle = Object.entries(mine.qty).filter(([, q]) => q > 0).map(([productId, quantity]) => ({productId, quantity}));
  } else {
    Object.assign(data, {bundle: null, customizable: d.customizable, stockKey: d.stockKey, stockUnits: Number(d.stockUnits)});
  }
  const newCategory = d.categoryId === NEW_CAT ? d.newCategory : null;
  if (newCategory !== null && !newCategory.trim()) throw Error('Give the new category a name.');
  const saved = await commitConfig(st => {
    // A locked price can only be edited here after switching "Lock price" off (that enables the input). Switching it
    // back on before saving means "new price, keep it locked", so lift the old lock first and saveProduct re-locks it.
    if (mine.id && mine.wasLocked && d.priceLocked) catalog.setPriceLock(st.config, [mine.id], false);
    const categoryId = newCategory !== null ? catalog.addCategory(st.config, {name: newCategory}).id : d.categoryId;
    return catalog.saveProduct(st.config, {...data, categoryId});
  });
  if (draft === mine) draft = null;
  closeSheet();
  toast(mine.id
    ? `Saved “${saved.name}”.`
    : saved.price === null ? `“${saved.name}” added. Set its price to start selling.` : `“${saved.name}” is on the menu. Let’s sell!`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Price board & quick price
// ---------------------------------------------------------------------------------------------------------------------

function priceBoard() {
  const c = C();
  const priced = c.products.filter(p => p.price !== null).length;
  const groups = c.categories.map(cat => {
    const items = c.products.filter(p => p.categoryId === cat.id);
    if (!items.length) return '';
    return `<section class="menu-pb-group"><h3 class="menu-sub">${esc(cat.name)}</h3>${items.map(p => {
      const id = esc(p.id);
      const name = esc(p.name);
      const size = p.size && !p.name.toLowerCase().includes(p.size.toLowerCase()) ? p.size : '';
      const small = [size, p.bundle ? 'Combo' : ''].filter(Boolean).join(' · ');
      return `<div class="menu-pb-row${p.price === null ? ' unset' : ''}" data-pb="${id}">
        ${artFrame(p, {size: 'xs'})}
        <label class="menu-pb-name" for="menu-pb-${id}"><strong>${name}</strong>${small ? `<small>${esc(small)}</small>` : ''}</label>
        ${moneyInput(`menu-pb-${p.id}`, rupeeText(p.price), `data-pb-input="${id}"${p.priceLocked ? ' disabled' : ''}`, 'menu-money-sm')}
        ${toggle('menu-flip', `${icon('lock')}<span class="menu-pb-lock-text">Lock</span>`, p.priceLocked, `data-pb-lock="${id}" data-locks="menu-pb-${id}" aria-label="Lock price of ${name}"`)}
      </div>`;
    }).join('')}</section>`;
  }).join('');
  openSheet(
    'Price board',
    `<form id="menu-pb" class="menu-pb" data-submit="menu-pb-save" novalidate>
      <div class="menu-pb-top">
        <p class="muted"><strong class="menu-pb-count">${priced}/${c.products.length} priced.</strong> Blank = not priced yet. Locked prices stay put until you unlock them.</p>
        <div class="menu-pb-bulk">
          ${btn(`${icon('lock')} Lock all`, 'menu-pb-lockall', 'small', 'data-lock="1"')}
          ${btn(`${icon('unlock')} Unlock all`, 'menu-pb-lockall', 'small quiet-outline', 'data-lock="0"')}
        </div>
      </div>
      ${groups || emptyState('menu', 'No items yet', 'Add items first, then price them here.')}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save all prices`, 'menu-pb-save', 'primary menu-act'),
    'menu-price-board',
    {wide: true},
  );
}

async function savePriceBoard() {
  const form = sheetEl()?.querySelector('#menu-pb');
  if (!form) throw Error('Open the price board again.');
  const c = C();
  /** @type {Record<string, number|null>} */
  const prices = {};
  /** @type {string[]} */
  const lock = [];
  /** @type {string[]} */
  const unlock = [];
  for (const p of c.products) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`menu-pb-${p.id}`));
    const lockBtn = form.querySelector(`[data-pb-lock="${p.id}"]`);
    if (!input || !lockBtn) continue;
    input.removeAttribute('aria-invalid');
    try {
      prices[p.id] = priceFrom(input.value, p.name);
    } catch (err) {
      input.setAttribute('aria-invalid', 'true');
      if (!input.disabled) input.focus();
      throw err;
    }
    const on = lockBtn.getAttribute('aria-pressed') === 'true';
    // A locked input only becomes editable after its Lock switch is turned off, so a changed price on a locked item
    // means "unlocked, edited, locked again": lift the old lock, set the price, lock it again.
    const changed = prices[p.id] !== p.price;
    if (p.priceLocked && (!on || changed)) unlock.push(p.id);
    if (on && (!p.priceLocked || changed)) lock.push(p.id);
  }
  const changed = await commitConfig(st => {
    const before = new Map(st.config.products.map(p => [p.id, p.price]));
    catalog.setPriceLock(st.config, unlock, false);
    catalog.setPrices(st.config, prices);
    catalog.setPriceLock(st.config, lock, true);
    const changes = Object.entries(prices).filter(([id, price]) => before.get(id) !== price).map(([id, price]) => ({id, from: before.get(id), to: price}));
    if (changes.length) audit(st[st.mode], 'prices-changed', 'menu', st.config.operator, {changes});
    return changes.length;
  });
  closeSheet();
  const n = C().products.filter(p => p.price !== null).length;
  toast(`${changed ? `${plural(changed, 'price')} updated` : 'Prices saved'} · ${n}/${C().products.length} priced.`);
}

/** @param {string} id */
function quickPrice(id) {
  const p = need(id);
  const c = C();
  const locked = p.priceLocked;
  const cat = c.categories.find(x => x.id === p.categoryId);
  const pid = esc(p.id);
  openSheet(
    p.price === null ? 'Set the price' : 'Change price',
    `<form id="menu-qp" class="menu-qp" data-submit="menu-qp-save" data-id="${pid}" novalidate>
      <div class="menu-qp-head">${artFrame(p, {size: 'sm'})}<div class="grow"><strong>${esc(p.name)}</strong><small>${esc([p.size, cat?.name].filter(Boolean).join(' · '))}</small></div></div>
      <div class="field">
        <label for="menu-qp-price">Price</label>
        ${moneyInput('menu-qp-price', rupeeText(p.price), `aria-describedby="menu-qp-hint"${locked ? ' disabled' : ' autofocus'}`, 'menu-money-xl')}
        <small id="menu-qp-hint">${locked ? 'Locked prices can’t change by accident.' : 'Blank = not priced yet (it can’t be sold until it has one).'}</small>
      </div>
      ${locked
        ? `<div class="notice menu-qp-locked">${icon('lock')}<div class="grow"><strong>${p.price === null ? 'Locked with no price.' : `Locked at ${esc(money(p.price))}.`}</strong> Locks stop accidental changes during the rush. Unlock to edit.</div></div>
           ${btn(`${icon('unlock')} Unlock price`, 'menu-qp-unlock', 'yellow block', `data-id="${pid}"`)}`
        : `<div class="menu-qp-chips" role="group" aria-label="Quick prices">${QUICK_PRICES.map(r => btn(`₹${r}`, 'menu-qp-chip', 'chip', `data-value="${r}"`)).join('')}</div>
           <div class="menu-qp-lock">${flip('qp-lock', `${icon('lock')} Lock this price after saving`, false)}</div>`}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save price`, 'menu-qp-save', 'primary menu-act', `data-id="${pid}"${locked ? ' disabled' : ''}`),
    'menu-quick-price',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Add-ons & flavours
// ---------------------------------------------------------------------------------------------------------------------

function captureAddons() {
  const form = sheetEl()?.querySelector('#menu-ao');
  if (!form || !addonDraft) return;
  addonDraft.rows = addonDraft.rows.map((r, i) => ({id: r.id, name: valueOf(`menu-ao-name-${i}`), price: valueOf(`menu-ao-price-${i}`)}));
  addonDraft.flavours = valueOf('menu-ao-flavours');
}

/** @param {number} [focusIndex] */
function addonsSheet(focusIndex = -1) {
  const c = C();
  if (!addonDraft) addonDraft = {rows: c.addons.map(a => ({id: a.id, name: a.name, price: rupeeText(a.price)})), flavours: c.flavours.join('\n')};
  const mine = addonDraft;
  const custom = c.products.filter(p => p.customizable).length;
  const rows = mine.rows.map((r, i) => `<div class="menu-ao-row">
      ${field(i === 0 ? 'Add-on' : `<span class="sr-only">Add-on ${i + 1}</span>`, `menu-ao-name-${i}`, r.name, 'text', `maxlength="${LIMITS.addonName}" autocomplete="off" placeholder="e.g. Extra cheese"`)}
      <div class="field menu-ao-price"><label for="menu-ao-price-${i}">${i === 0 ? 'Price' : `<span class="sr-only">Price ${i + 1}</span>`}</label>${moneyInput(`menu-ao-price-${i}`, r.price, 'placeholder="Free"')}</div>
      ${btn(icon('trash'), 'menu-ao-remove', 'small icon-btn danger menu-ao-remove', `data-index="${i}" aria-label="Remove add-on ${i + 1}"`)}
    </div>`).join('');
  openSheet(
    'Add-ons & flavours',
    `<form id="menu-ao" class="menu-ao" data-submit="menu-ao-save" novalidate>
      <p class="menu-hint">Only items with <strong>Customizable</strong> switched on ask for these (${plural(custom, 'item')} right now).</p>
      <section class="menu-ao-block">
        <h3 class="menu-sub">Add-ons <span class="badge">${mine.rows.length}/${catalog.CATALOG_LIMITS.addons}</span></h3>
        <p class="menu-hint">Paid extras added to the item price — e.g. Extra cheese ₹10. Blank price = free.</p>
        <div class="menu-ao-list">${rows || '<p class="muted menu-ao-empty">No add-ons yet.</p>'}</div>
        ${btn(`${icon('plus')} Add an add-on`, 'menu-ao-add', 'small')}
      </section>
      <section class="menu-ao-block">
        <h3 class="menu-sub">Flavours</h3>
        ${textarea('One flavour per line', 'menu-ao-flavours', mine.flavours, 'rows="6" placeholder="Classic Salted&#10;Magic Masala"', `The customer picks one. Leave empty for none (max ${catalog.CATALOG_LIMITS.flavours}).`)}
      </section>
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save`, 'menu-ao-save', 'primary menu-act'),
    'menu-addons',
    {onClose: () => {
      if (addonDraft === mine) addonDraft = null;
    }},
  );
  if (focusIndex >= 0) /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector(`#menu-ao-name-${focusIndex}`))?.focus();
}

// ---------------------------------------------------------------------------------------------------------------------
// Stock room
// ---------------------------------------------------------------------------------------------------------------------

function captureStock() {
  const form = sheetEl()?.querySelector('#menu-stock-form');
  if (!form || !stockDraft) return;
  stockDraft.inventory = pressed(form, '[data-field="inventory"]');
  for (const key of Object.keys(stockDraft.totals)) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`menu-st-${key}`));
    if (input) stockDraft.totals[key] = input.value;
  }
}

/** @param {string} [focusKey] */
function stockSheet(focusKey = '') {
  const c = C();
  const used = stockUsed(S());
  if (!stockDraft) stockDraft = {inventory: c.inventory, totals: {}};
  const mine = stockDraft;
  for (const key of Object.keys(mine.totals)) if (!Object.hasOwn(c.stock, key)) delete mine.totals[key];
  for (const [key, n] of Object.entries(c.stock)) if (!(key in mine.totals)) mine.totals[key] = String(n);
  const rows = Object.keys(c.stock).map(key => {
    const k = esc(key);
    const u = used[key] || 0;
    const users = c.products.filter(p => p.stockKey === key);
    const left = Math.max(0, c.stock[key] - u);
    const who = users.length ? `${users.slice(0, 2).map(p => p.name).join(', ')}${users.length > 2 ? ` +${users.length - 2} more` : ''}` : 'Not used by any item';
    return `<div class="menu-st-row" data-pool="${k}">
      <div class="menu-st-name"><strong>${esc(humanize(key))}</strong><small>${esc(who)}</small></div>
      <div class="field menu-st-total"><label for="menu-st-${k}">Total stocked</label><input id="menu-st-${k}" type="number" min="0" max="${catalog.CATALOG_LIMITS.stock}" step="1" inputmode="numeric" value="${esc(mine.totals[key])}"></div>
      <div class="menu-st-num menu-st-used"><small>Used</small><strong>${u}</strong></div>
      <div class="menu-st-num menu-st-left${left <= 5 ? ' low' : ''}"><small>Left</small><strong>${left}</strong></div>
      <div class="menu-st-del">${users.length ? '' : btn(icon('trash'), 'menu-stock-del', 'small icon-btn danger', `data-key="${k}" aria-label="Delete pool ${esc(humanize(key))}" title="Delete pool"`)}</div>
    </div>`;
  }).join('');
  openSheet(
    'Stock room',
    `<form id="menu-stock-form" class="menu-stock" data-submit="menu-stock-save" novalidate>
      <div class="menu-st-switch">
        ${flip('inventory', 'Track stock', mine.inventory)}
        <p class="menu-hint">When on, Sell shows “N left” and stops an item when its pool runs out. Used counts every order so far, pending ones too; a voided order gives its stock back.</p>
      </div>
      <div class="menu-st-list">${rows || '<p class="muted">No stock pools yet. Add one below — e.g. “Paper cups”.</p>'}</div>
    </form>
    <form class="menu-st-add" data-submit="menu-stock-add" novalidate>
      ${field('New stock pool', 'menu-stock-new', '', 'text', 'maxlength="40" autocomplete="off" placeholder="e.g. Paper cups"')}
      ${btn(`${icon('plus')} Add pool`, 'menu-stock-add', 'small')}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save stock`, 'menu-stock-save', 'primary menu-act'),
    'menu-stock',
    {wide: true, onClose: () => {
      if (stockDraft === mine) stockDraft = null;
    }},
  );
  if (focusKey) /** @type {HTMLInputElement|null} */ (document.getElementById(`menu-st-${focusKey}`))?.focus();
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------------

/** First category whose name says "combo", else the given/first one. @param {string} [preferred] */
function comboCategory(preferred) {
  const cats = C().categories;
  if (preferred && cats.some(x => x.id === preferred)) return preferred;
  return (cats.find(x => /combo/i.test(x.name)) || cats[0])?.id || NEW_CAT;
}

let searchTimer = 0;

registerInputs({
  'menu-search': el => {
    view.query = String(el.value || '').slice(0, 60);
    // Every row carries an illustration, so a big menu re-renders slowly; wait for a typing pause there.
    clearTimeout(searchTimer);
    if (C().products.length <= 40) render();
    else searchTimer = window.setTimeout(render, 180);
  },
  'menu-ed-price': () => refreshComboHint(),
});

registerChanges({
  'menu-ed-category': el => {
    const wrap = /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('.menu-ed-newcat'));
    if (!wrap) return;
    wrap.hidden = el.value !== NEW_CAT;
    if (!wrap.hidden) /** @type {HTMLInputElement|null} */ (wrap.querySelector('input'))?.focus();
  },
});

registerActions(
  {
    // --- screen ---
    'menu-filter': (_el, ds) => {
      view.filter = ['all', 'soldout', 'unpriced', 'hidden'].includes(ds.filter) ? ds.filter : 'all';
      render();
    },
    'menu-clear-filter': () => {
      view.filter = 'all';
      view.query = '';
      render();
    },

    // --- public ---
    'menu-toggle-soldout': async (_el, ds) => {
      const id = ds.id || '';
      const out = await commitConfig(st => {
        const p = st.config.products.find(x => x.id === id);
        if (!p) throw Error('That item no longer exists.');
        catalog.setSoldOut(st.config, id, !p.soldOut);
        audit(st[st.mode], p.soldOut ? 'item-sold-out' : 'item-back-in-stock', id, st.config.operator, {name: p.name});
        return {name: p.name, soldOut: p.soldOut};
      });
      toast(out.soldOut ? `${out.name} is sold out. Sell won’t take it.` : `${out.name} is back in stock!`, {tone: out.soldOut ? 'warn' : 'ok'});
    },
    'menu-new-product': (_el, ds) => {
      const cats = C().categories;
      const cat = cats.some(x => x.id === ds.category) ? ds.category : cats[0]?.id || NEW_CAT;
      draft = blankDraft(false, cat);
      openEditor();
    },
    'menu-edit-product': (_el, ds) => {
      draft = draftFrom(need(ds.id || ''));
      openEditor();
    },
    'menu-quick-price': (_el, ds) => quickPrice(ds.id || ''),
    'menu-price-board': () => priceBoard(),
    'menu-stock': () => {
      stockDraft = null;
      stockSheet();
    },

    // --- categories ---
    'menu-new-category': () => categorySheet(null),
    'menu-rename-category': (_el, ds) => categorySheet(ds.id || ''),
    'menu-save-category': async (_el, ds) => {
      const name = valueOf('menu-cat-name');
      if (ds.id) {
        await commitConfig(st => catalog.renameCategory(st.config, ds.id, name));
        closeSheet();
        toast(`Renamed to “${needCategory(ds.id).name}”.`);
      } else {
        const cat = await commitConfig(st => catalog.addCategory(st.config, {name}));
        closeSheet();
        toast(`“${cat.name}” added. Now fill it up!`);
        view.filter = 'all';
        view.query = '';
        render();
        document.querySelector(`.menu-cat[data-category="${CSS.escape(cat.id)}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'});
      }
    },
    'menu-move-category': (_el, ds) => commitConfig(st => catalog.moveCategory(st.config, ds.id, ds.dir === '-1' ? -1 : 1)),
    'menu-delete-category': (_el, ds) => deleteCategoryFlow(ds.id || ''),
    'menu-delete-category-go': async (_el, ds) => {
      const id = ds.id || '';
      const cat = needCategory(id);
      const moveTo = valueOf('menu-cat-move');
      const target = C().categories.find(x => x.id === moveTo);
      await commitConfig(st => catalog.deleteCategory(st.config, id, {moveTo}));
      closeSheet();
      toast(`“${cat.name}” deleted. Its items moved to ${target ? `“${target.name}”` : 'the other category'}.`);
    },
    'menu-fill': (_el, ds) => {
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById(ds.target || ''));
      if (!input) return;
      input.value = ds.value || '';
      input.focus();
    },

    // --- rows ---
    'menu-toggle-visible': async (_el, ds) => {
      const id = ds.id || '';
      const out = await commitConfig(st => {
        const p = st.config.products.find(x => x.id === id);
        if (!p) throw Error('That item no longer exists.');
        catalog.setActive(st.config, id, !p.active);
        return {name: p.name, active: p.active};
      });
      toast(out.active ? `${out.name} is back on the Sell menu.` : `${out.name} is hidden from Sell (still here in Menu).`);
    },
    'menu-dup': async (_el, ds) => {
      const copy = await commitConfig(st => catalog.duplicateProduct(st.config, ds.id || ''));
      toast(`Copied as “${copy.name}”. Tweak the size and price.`);
      draft = draftFrom(copy);
      openEditor();
    },
    'menu-move': async (_el, ds) => {
      await commitConfig(st => catalog.moveProduct(st.config, ds.id || '', ds.dir === '-1' ? -1 : 1));
      if (sheetKind() === 'menu-row') rowSheet(ds.id || '');
    },
    'menu-row-more': (_el, ds) => rowSheet(ds.id || ''),
    'menu-delete': (_el, ds) => {
      const id = ds.id || '';
      const p = need(id);
      try {
        catalog.deleteProduct({config: structuredClone(C())}, id);
      } catch (err) {
        openSheet(
          'Can’t delete this yet',
          `<div class="notice danger">${icon('alert')}<div>${esc(msg(err))}</div></div>`,
          btn('Got it', 'close', 'primary'),
          'menu-blocked',
        );
        return;
      }
      confirmSheet({
        title: `Delete “${esc(p.name)}”?`,
        body: '<p>It leaves the menu and any open cart. Past orders keep their own copy, so your sales history stays exact.</p>',
        confirmLabel: 'Delete item',
        danger: true,
        onConfirm: async () => {
          await asAdmin(() => commitConfig(st => catalog.deleteProduct(st, id)));
          toast(`“${p.name}” deleted.`);
        },
      });
    },

    // --- editor ---
    'menu-new-combo': (_el, ds) => {
      if (!C().products.some(p => !p.bundle)) throw Error('Add a few single items first, then bundle them into a combo.');
      draft = blankDraft(true, comboCategory(ds.category));
      openEditor();
    },
    'menu-flip': el => {
      if (el) setPressed(el, el.getAttribute('aria-pressed') !== 'true');
    },
    'menu-tag': el => {
      if (el) setPressed(el, el.getAttribute('aria-pressed') !== 'true');
    },
    'menu-ed-visual': () => {
      if (!draft) return;
      captureEditor();
      const mine = draft;
      const d = mine.data;
      openPicker(
        {art: d.art, image: d.image, tint: d.tint, pattern: d.pattern, name: d.name},
        selection => {
          draft = mine;
          for (const key of ['art', 'image', 'tint', 'pattern']) {
            if (selection && selection[key] !== undefined) mine.data[key] = selection[key];
          }
          openEditor();
        },
        {onCancel: () => {
          draft = mine;
          openEditor();
        }},
      );
    },
    'menu-combo-step': (_el, ds) => {
      if (!draft?.combo) return;
      const id = ds.id || '';
      const next = Math.max(0, Math.min(catalog.CATALOG_LIMITS.bundleQuantity, (draft.qty[id] || 0) + (ds.dir === '-1' ? -1 : 1)));
      if (next) draft.qty[id] = next;
      else delete draft.qty[id];
      const row = sheetEl()?.querySelector(`[data-combo-row="${CSS.escape(id)}"]`);
      if (row) {
        row.classList.toggle('on', next > 0);
        const out = row.querySelector('.menu-step-qty');
        if (out) out.textContent = String(next);
        const minus = /** @type {HTMLButtonElement|null} */ (row.querySelector('[data-dir="-1"]'));
        if (minus) minus.disabled = next === 0;
        const plus = /** @type {HTMLButtonElement|null} */ (row.querySelector('[data-dir="1"]'));
        if (plus) plus.disabled = next >= catalog.CATALOG_LIMITS.bundleQuantity;
      }
      refreshComboHint();
    },
    'menu-save-product': () => saveProductFromEditor(),

    // --- price board & quick price ---
    'menu-pb-lockall': (_el, ds) => {
      const on = ds.lock === '1';
      sheetEl()?.querySelectorAll('[data-pb-lock]').forEach(b => setPressed(b, on));
    },
    'menu-pb-save': () => savePriceBoard(),
    'menu-qp-chip': (_el, ds) => {
      const input = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#menu-qp-price'));
      if (!input || input.disabled) return;
      input.value = ds.value || '';
      input.focus();
    },
    'menu-qp-save': async (el, ds) => {
      const id = ds.id || el?.dataset?.id || '';
      const p = need(id);
      const price = priceFrom(valueOf('menu-qp-price'), 'Price');
      const lock = pressed(sheetEl(), '[data-field="qp-lock"]');
      await commitConfig(st => {
        const before = st.config.products.find(x => x.id === id)?.price ?? null;
        catalog.setPrices(st.config, {[id]: price});
        if (lock) catalog.setPriceLock(st.config, [id], true);
        if (before !== price) audit(st[st.mode], 'prices-changed', 'menu', st.config.operator, {changes: [{id, from: before, to: price}]});
      });
      closeSheet();
      toast(price === null ? `${p.name} has no price now — it can’t be sold.` : `${p.name} is now ${money(price)}${lock ? ' and locked' : ''}.`);
    },
    'menu-qp-unlock': async (_el, ds) => {
      const id = ds.id || '';
      await commitConfig(st => catalog.setPriceLock(st.config, [id], false));
      quickPrice(id);
      toast('Price unlocked. Change it, and lock it again if you like.');
    },

    // --- add-ons & flavours ---
    'menu-addons': () => {
      addonDraft = null;
      addonsSheet();
    },
    'menu-ao-add': () => {
      if (!addonDraft) return;
      captureAddons();
      if (addonDraft.rows.length >= catalog.CATALOG_LIMITS.addons) throw Error(`You can have at most ${catalog.CATALOG_LIMITS.addons} add-ons.`);
      addonDraft.rows.push({id: null, name: '', price: ''});
      addonsSheet(addonDraft.rows.length - 1);
    },
    'menu-ao-remove': (_el, ds) => {
      if (!addonDraft) return;
      captureAddons();
      addonDraft.rows.splice(Number(ds.index), 1);
      addonsSheet();
    },
    'menu-ao-save': async () => {
      if (!addonDraft) throw Error('Open Add-ons & flavours again.');
      captureAddons();
      const rows = addonDraft.rows
        .filter(r => r.name.trim() || r.price.trim())
        .map(r => ({...(r.id ? {id: r.id} : {}), name: r.name, price: priceFrom(r.price, r.name.trim() || 'Add-on price') ?? 0}));
      const flavours = addonDraft.flavours.split(/\r?\n/);
      await commitConfig(st => {
        catalog.saveAddons(st.config, rows);
        catalog.saveFlavours(st.config, flavours);
      });
      addonDraft = null;
      closeSheet();
      toast(`Saved ${plural(C().addons.length, 'add-on')} and ${plural(C().flavours.length, 'flavour')}.`);
    },

    // --- stock room ---
    'menu-stock-add': async () => {
      captureStock();
      const name = valueOf('menu-stock-new');
      const key = await commitConfig(st => catalog.addStockPool(st.config, name));
      if (stockDraft) stockDraft.totals[key] = '0';
      stockSheet(key);
      toast(`Pool “${humanize(key)}” added. Enter how many you stocked.`);
    },
    'menu-stock-del': async (_el, ds) => {
      captureStock();
      const key = ds.key || '';
      await commitConfig(st => catalog.deleteStockPool(st.config, key));
      if (stockDraft) delete stockDraft.totals[key];
      stockSheet();
      toast(`Pool “${humanize(key)}” deleted.`);
    },
    'menu-stock-save': async () => {
      if (!stockDraft) throw Error('Open the stock room again.');
      captureStock();
      const inventory = stockDraft.inventory;
      /** @type {Record<string, number>} */
      const stock = {};
      for (const [key, text] of Object.entries(stockDraft.totals)) stock[key] = String(text).trim() === '' ? NaN : Number(text);
      await commitConfig(st => catalog.saveStock(st.config, stockUsed(st[st.mode]), {inventory, stock}));
      stockDraft = null;
      closeSheet();
      toast(inventory ? 'Stock saved. Sell now counts down what’s left.' : 'Stock saved. Tracking is off.');
    },
  },
  {
    admin: [
      'menu-new-product', 'menu-edit-product', 'menu-quick-price', 'menu-price-board', 'menu-stock',
      'menu-new-category', 'menu-rename-category', 'menu-save-category', 'menu-move-category', 'menu-delete-category',
      'menu-delete-category-go', 'menu-toggle-visible', 'menu-dup', 'menu-move', 'menu-delete', 'menu-new-combo',
      'menu-save-product', 'menu-pb-save', 'menu-qp-save', 'menu-qp-unlock', 'menu-addons', 'menu-ao-save',
      'menu-stock-add', 'menu-stock-del', 'menu-stock-save',
    ],
  },
);
