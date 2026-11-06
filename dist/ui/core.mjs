// UI kernel for ManageYourStall (ARCHITECTURE.md §9).
//
// Rendering model: the whole app is re-rendered with innerHTML from the persisted state after every change.
// Sheets are one <dialog id="sheet"> whose content openSheet() replaces; admin PIN prompts use a second
// <dialog id="pin-dialog"> stacked on top so an open form is never destroyed.
// Screens, actions, inputs and boot hooks are registered by feature modules (dist/ui/*.mjs).
import * as storage from '../storage.mjs';
import {esc, money, paise, tokenLabel, uuid, IST} from '../util.mjs';
import {icon} from '../icons.mjs';
import {artSvg, artSprite, useSprite, FALLBACK_ART, SPRITE_PREFIX} from '../library.mjs';
import {validateConfig} from '../catalog.mjs';
import {audit} from '../domain.mjs';
import {MEDIA_RE, IMAGE_URL_RE, TINT_IDS, PATTERN_IDS, HEX_RE, BRAND} from '../constants.mjs';

export {esc, money, paise, tokenLabel, icon};

// ---------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Always the latest committed state of the OPEN stall (`state` null when no stall is open), its index id (`stallId`) and
 * the device's stalls index (`meta`, refreshed on boot, stall switches, commits and other-tab changes).
 * @type {{state: any, stallId: string|null, meta: any}}
 */
export const store = {state: null, stallId: null, meta: null};

/** Current session (live or demo ledger). */
export const S = () => store.state[store.state.mode];

/** Stall config (shared by both ledgers). */
export const C = () => store.state.config;

/** Shared transient UI state. Modules keep their own module-level transient variables. */
export const ui = {screen: 'sell'};

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const appEl = () => $('app');
/** @returns {HTMLDialogElement} */
export const sheetEl = () => $('sheet');
const pinEl = () => /** @type {HTMLDialogElement} */ ($('pin-dialog'));

// ---------------------------------------------------------------------------------------------------------------------
// Markup helpers (text inputs are escaped; `label` arguments may contain trusted markup such as icons)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A button that runs a registered action.
 * @param {string} label markup
 * @param {string} action action name
 * @param {string} [cls]
 * @param {string} [attrs] extra raw attributes (data-id="…", disabled, aria-label="…")
 */
export const btn = (label, action, cls = '', attrs = '') =>
  `<button type="button"${cls ? ` class="${cls}"` : ''} data-action="${esc(action)}"${attrs ? ' ' + attrs : ''}>${label}</button>`;

const hintHtml = (/** @type {string} */ name, /** @type {string} */ hint) => (hint ? `<small id="${esc(name)}-hint">${hint}</small>` : '');
const described = (/** @type {string} */ name, /** @type {string} */ hint) => (hint ? ` aria-describedby="${esc(name)}-hint"` : '');

/**
 * Labelled input. The input's id and name are both `name`.
 * @param {string} label markup
 * @param {string} name
 * @param {string|number} [value]
 * @param {string} [type]
 * @param {string} [extra] raw attributes
 * @param {string} [hint] markup shown under the input
 */
export const field = (label, name, value = '', type = 'text', extra = '', hint = '') =>
  `<div class="field"><label for="${esc(name)}">${label}</label><input id="${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"${described(name, hint)}${extra ? ' ' + extra : ''}>${hintHtml(name, hint)}</div>`;

/**
 * Labelled textarea.
 * @param {string} label markup
 * @param {string} name
 * @param {string} [value]
 * @param {string} [extra]
 * @param {string} [hint]
 */
export const textarea = (label, name, value = '', extra = '', hint = '') =>
  `<div class="field"><label for="${esc(name)}">${label}</label><textarea id="${esc(name)}" name="${esc(name)}"${described(name, hint)}${extra ? ' ' + extra : ''}>${esc(value)}</textarea>${hintHtml(name, hint)}</div>`;

/**
 * Labelled select.
 * @param {string} label markup
 * @param {string} name
 * @param {Array<[string|number, string]|string>} options
 * @param {string|number} [value]
 * @param {string} [extra]
 */
export const select = (label, name, options, value = '', extra = '') =>
  `<div class="field"><label for="${esc(name)}">${label}</label><select id="${esc(name)}" name="${esc(name)}"${extra ? ' ' + extra : ''}>${options
    .map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    })
    .join('')}</select></div>`;

/**
 * Checkbox row.
 * @param {string} name
 * @param {string} label markup
 * @param {boolean} [checked]
 * @param {string} [extra]
 */
export const check = (name, label, checked = false, extra = '') =>
  `<label class="check-label"><input type="checkbox" name="${esc(name)}"${checked ? ' checked' : ''}${extra ? ' ' + extra : ''}><span>${label}</span></label>`;

/**
 * One-tap switch button (aria-pressed). Runs `action` on tap; the handler decides the new value.
 * @param {string} action
 * @param {string} label markup
 * @param {boolean} on
 * @param {string} [attrs]
 */
export const toggle = (action, label, on, attrs = '') =>
  `<button type="button" class="toggle${on ? ' on' : ''}" data-action="${esc(action)}" aria-pressed="${on ? 'true' : 'false'}"${attrs ? ' ' + attrs : ''}><span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span><span class="toggle-label">${label}</span></button>`;

/**
 * Screen heading block.
 * @param {string} title text
 * @param {string} [subtitle] text
 * @param {string} [right] markup (badges/buttons)
 */
export const heading = (title, subtitle = '', right = '') =>
  `<div class="screen-heading"><div class="grow"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${right ? `<div class="screen-heading-right">${right}</div>` : ''}</div>`;

/**
 * Friendly empty state.
 * @param {string} iconName
 * @param {string} title text
 * @param {string} [text] text
 * @param {string} [actionHtml] markup
 */
export const emptyState = (iconName, title, text = '', actionHtml = '') =>
  `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${actionHtml ? `<div class="empty-actions">${actionHtml}</div>` : ''}</div>`;

/** URLs that failed to load this session (cleared when the device comes back online). */
const brokenImages = new Set();

/**
 * Tinted, patterned art frame: the library illustration, with the owner's photo layered on top when it resolves.
 * A photo that fails to load hides itself so the illustration shows (offline / broken link).
 * @param {{art?: string, image?: string|null, tint?: string, pattern?: string, name?: string}} item
 * @param {{size?: 'sm'|'md'|'lg'|string, cls?: string}} [options]
 */
export function artFrame(item, {size = 'md', cls = ''} = {}) {
  const tint = TINT_IDS.includes(item?.tint) ? item.tint : 'cream';
  const pattern = PATTERN_IDS.includes(item?.pattern) ? item.pattern : 'none';
  const src = item?.image ? mediaUrl(item.image) : '';
  const img = src && !brokenImages.has(src)
    ? `<img class="art-img" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<div class="art-frame tint-${tint} pattern-${pattern} size-${esc(size)}${cls ? ' ' + cls : ''}">${artSvg(item?.art || FALLBACK_ART, 'food-art')}${img}</div>`;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
const timeFmt = new Intl.DateTimeFormat('en-IN', {timeZone: IST, hour: 'numeric', minute: '2-digit'});

/** '4 Nov, 6:30 pm' in India time. @param {string|number|Date} iso */
export const date = iso => dateFmt.format(new Date(iso));

/** '6:30 pm' in India time. @param {string|number|Date} iso */
export const time = iso => timeFmt.format(new Date(iso));

// ---------------------------------------------------------------------------------------------------------------------
// Feedback: toast, sheets, errors, confirmations
// ---------------------------------------------------------------------------------------------------------------------

let toastTimer = 0;

/**
 * Short status message at the bottom of the screen.
 * @param {string} text
 * @param {{tone?: 'ok'|'warn'|'error'}} [options]
 */
export function toast(text, {tone = 'ok'} = {}) {
  const el = $('toast');
  if (!el) return;
  el.textContent = String(text ?? '');
  el.className = `show ${tone === 'warn' || tone === 'error' ? tone : 'ok'}`;
  // In browsers with the Popover API the toast joins the top layer, so it shows above an open sheet too.
  if (typeof el.showPopover === 'function') {
    if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    safe(() => el.hidePopover());
    safe(() => el.showPopover());
  }
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
    if (typeof el.hidePopover === 'function') safe(() => el.hidePopover());
  }, tone === 'error' ? 5200 : 3400);
}

let currentSheetKind = '';
/** @type {null | (() => void)} */
let sheetOnClose = null;
/** @type {null | {id: string, selector: string}} the control that opened the sheet, to give focus back on close */
let sheetOpener = null;

/** Re-raise a showing toast above a dialog that just entered the top layer. */
function raiseToast() {
  const el = $('toast');
  if (!el || !el.classList.contains('show') || typeof el.showPopover !== 'function') return;
  safe(() => el.hidePopover());
  safe(() => el.showPopover());
}

/**
 * Describe a button outside the sheet so focus can find its re-rendered twin later.
 * @param {Element|null} el
 */
function describeOpener(el) {
  const btnEl = /** @type {HTMLElement|null} */ (el instanceof HTMLElement ? el.closest('button, a[href], [data-action]') : null);
  if (!btnEl || btnEl.closest('#sheet, #pin-dialog') || !appEl()?.contains(btnEl)) return null;
  const ds = btnEl.dataset;
  const parts = ['action', 'id', 'screen', 'section', 'tile', 'kind', 'line', 'filter', 'tab']
    .filter(k => ds[k] !== undefined)
    .map(k => `[data-${k}="${CSS.escape(String(ds[k]))}"]`);
  return {id: btnEl.id || '', selector: ds.action ? parts.join('') : ''};
}

/** After a sheet closes, put keyboard focus back on the control that opened it (render may have replaced it). */
function restoreFocus() {
  const opener = sheetOpener;
  sheetOpener = null;
  if (!opener || (!opener.id && !opener.selector)) return;
  setTimeout(() => {
    if (sheetEl()?.open || pinEl()?.open) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const visible = (/** @type {Element|null} */ el) => !!el && el.getClientRects().length > 0;
    const byId = opener.id ? document.getElementById(opener.id) : null;
    const match = visible(byId)
      ? byId
      : opener.selector
        ? [...(appEl()?.querySelectorAll(opener.selector) || [])].find(visible)
        : null;
    if (match && !(/** @type {any} */ (match).disabled)) /** @type {HTMLElement} */ (match).focus({preventScroll: true});
  }, 0);
}

/**
 * Open (or replace the content of) the sheet dialog.
 * @param {string} title markup — escape user data yourself
 * @param {string} body markup; a `<div data-error>` slot is added when the body has none
 * @param {string} [actions] markup for the sticky action bar
 * @param {string} [kind] identifier returned by sheetKind()
 * @param {{wide?: boolean, onClose?: () => void}} [options] onClose runs once when this sheet closes (not when replaced)
 */
export function openSheet(title, body, actions = '', kind = '', {wide = false, onClose} = {}) {
  const sheet = sheetEl();
  if (!sheet) return;
  sheetOnClose = null;
  pendingConfirm = null; // confirmSheet() sets it again right after
  currentSheetKind = kind;
  sheet.classList.toggle('wide', !!wide);
  sheet.dataset.kind = kind;
  sheet.setAttribute('aria-labelledby', 'sheet-title');
  const errorSlot = /data-error/.test(body) ? '' : '<div class="form-error" data-error hidden role="alert"></div>';
  sheet.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div><div class="sheet-head"><h2 id="sheet-title">${title}</h2>${btn(icon('close'), 'close', 'quiet icon-btn sheet-close', 'aria-label="Close"')}</div><div class="sheet-body">${errorSlot}${body}</div>${actions ? `<div class="sheet-actions">${actions}</div>` : ''}`;
  const fresh = !sheet.open;
  if (fresh) {
    sheetOpener = describeOpener(document.activeElement);
    try {
      sheet.showModal();
    } catch {
      sheet.setAttribute('open', '');
    }
    raiseToast();
  }
  sheet.scrollTop = 0;
  sheet.querySelector('.sheet-body')?.scrollTo?.(0, 0);
  sheetOnClose = onClose || null;
  const auto = /** @type {HTMLElement|null} */ (sheet.querySelector('[autofocus]'));
  if (auto) auto.focus();
  else if (fresh) {
    // Start on the title (read out by screen readers) rather than ringing the close button on open.
    const title = /** @type {HTMLElement|null} */ (sheet.querySelector('#sheet-title'));
    if (title) {
      title.tabIndex = -1;
      title.focus({preventScroll: true});
    }
  }
}

/** Close the sheet (no-op when closed). */
export function closeSheet() {
  const sheet = sheetEl();
  if (sheet?.open) sheet.close();
  finishSheetClose();
}

function finishSheetClose() {
  currentSheetKind = '';
  const sheet = sheetEl();
  if (sheet) {
    sheet.dataset.kind = '';
    sheet.classList.remove('wide');
  }
  pendingConfirm = null;
  const fn = sheetOnClose;
  sheetOnClose = null;
  if (fn) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }
  restoreFocus();
}

/** Kind of the open sheet ('' when closed). */
export const sheetKind = () => (sheetEl()?.open ? currentSheetKind : '');

/** @param {unknown} err */
const messageOf = err => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || ''))
  || 'Something went wrong. Your saved records are unchanged.';

/**
 * Show an error: in the PIN dialog or open sheet's error slot when there is one, else as a toast.
 * @param {unknown} err
 */
export function showError(err) {
  if (!(err instanceof Error)) console.warn(err);
  const msg = messageOf(err);
  const pin = pinEl();
  const sheet = sheetEl();
  const slot = pin?.open ? pin.querySelector('[data-error]') : sheet?.open ? sheet.querySelector('[data-error]') : null;
  if (slot) {
    slot.textContent = msg;
    slot.hidden = false;
    // Scroll only the sheet body: scrollIntoView would also scroll the dialog and push a phone bottom sheet off-screen.
    const body = /** @type {HTMLElement|null} */ (slot.closest('.sheet-body'));
    if (body) {
      const r = slot.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      if (r.top < b.top) body.scrollTop -= b.top - r.top + 8;
      else if (r.bottom > b.bottom) body.scrollTop += r.bottom - b.bottom + 8;
    } else {
      slot.scrollIntoView?.({block: 'nearest'});
    }
  } else {
    toast(msg, {tone: 'error'});
  }
}

/** @param {HTMLElement|null|undefined} root */
function clearError(root) {
  const slot = root?.querySelector('[data-error]');
  if (slot) {
    slot.textContent = '';
    slot.hidden = true;
  }
}

/** @type {null | {typed: string, onConfirm: () => any}} */
let pendingConfirm = null;

/**
 * Ask before doing something. With `typed`, the person must type that phrase exactly.
 * onConfirm may be async and may open another sheet; otherwise the sheet closes after it succeeds.
 * Errors thrown by onConfirm show in the sheet (nothing closes).
 * @param {{title: string, body: string, confirmLabel?: string, danger?: boolean, typed?: string, onConfirm: () => any}} options
 *   title/body are markup (escape user data yourself)
 */
export function confirmSheet({title, body, confirmLabel = 'Confirm', danger = false, typed = '', onConfirm}) {
  const typedField = typed
    ? `<div class="field confirm-typed"><label for="confirm-typed">Type <strong class="typed-phrase">${esc(typed)}</strong> to confirm</label><input id="confirm-typed" name="confirm-typed" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>`
    : '';
  openSheet(
    title,
    `<form class="confirm-form" data-submit="core-confirm"><div class="confirm-body">${body}</div>${typedField}</form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(confirmLabel, 'core-confirm', danger ? 'danger' : 'primary'),
    'confirm',
  );
  pendingConfirm = {typed, onConfirm};
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------------------

/** @type {null | ((screenHtml: string) => string)} */
let shellFn = null;
/** @type {Map<string, () => string>} */
const screens = new Map();

/** Readable text colour on a background hex. @param {string} hex */
function onColor(hex) {
  if (!HEX_RE.test(hex)) return '#171717';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.32 ? '#171717' : '#fff9ed';
}

/**
 * Text colour with the higher WCAG contrast on a background hex (ink or paper). Used for --on-secondary, whose
 * pills and stickers carry tiny uppercase text where legibility beats the warmer accent bias of onColor().
 * @param {string} hex
 */
function onColorMax(hex) {
  if (!HEX_RE.test(hex)) return '#171717';
  const lin = (/** @type {number} */ v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lumOf = (/** @type {string} */ h) => {
    const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bg = lumOf(hex);
  const ratio = (/** @type {number} */ fg) => (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  return ratio(lumOf('#171717')) >= ratio(lumOf('#fff9ed')) ? '#171717' : '#fff9ed';
}

/** @param {string} key */
function screenHtml(key) {
  const fn = screens.get(key) || screens.get('sell');
  if (!fn) return '';
  try {
    return fn();
  } catch (err) {
    console.error(err);
    return `<div class="notice danger screen-crash">${icon('alert')}<div><strong>This screen hit a snag.</strong><p>${esc(messageOf(err))}</p><p>Your saved orders are safe. Try another screen or reload.</p></div></div>`;
  }
}

/** Sprite mode has been switched on (once; tests may switch it off again with library.useSprite(false)). */
let spriteOn = false;

/**
 * Put the illustration sprite (library.artSprite) into <body> once, outside #app so re-renders never touch it, and switch
 * artSvg/heroSvg to tiny <use> references. Runs before the first render; idempotent (re-inserts if it ever went missing).
 */
export function installArtSprite() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!document.getElementById(SPRITE_PREFIX + FALLBACK_ART)) {
    document.body.insertAdjacentHTML('afterbegin', artSprite());
  }
  if (!spriteOn) {
    spriteOn = true;
    useSprite(true);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages outside the stall (§17.2): hash routes rendered full-screen without the shell
// ---------------------------------------------------------------------------------------------------------------------

/** Every outside-the-stall route, in the order of §17.2. */
export const PAGES = Object.freeze(['welcome', 'setup', 'stalls', 'login', 'signup', 'join', 'account']);
const PAGE_TITLES = /** @type {Record<string, string>} */ ({
  welcome: 'Run your stall like a boss',
  setup: 'Start a stall',
  stalls: 'Your stalls',
  login: 'Log in',
  signup: 'Create account',
  join: 'Join a team stall',
  account: 'Your account',
});
/** @type {Map<string, () => string>} */
const pages = new Map();

/**
 * Register a full-screen page for `#/<name>` (rendered without the stall shell).
 * @param {string} name e.g. 'welcome'
 * @param {() => string} renderFn returns the whole page's markup
 */
export function registerPage(name, renderFn) {
  pages.set(String(name).toLowerCase(), renderFn);
}

/** The page named in location.hash ('' when the hash names none). `#/join?code=MYS-ABCDE` → 'join'. */
function hashPage() {
  if (typeof location === 'undefined') return '';
  const m = /^#\/([a-z][a-z0-9-]*)/i.exec(location.hash || '');
  const name = m ? m[1].toLowerCase() : '';
  return name && (pages.has(name) || PAGES.includes(name)) ? name : '';
}

/**
 * The outside page being shown: the one in the hash, else 'welcome' when no stall is open, else '' (the stall shell).
 * @returns {string}
 */
export function currentPage() {
  return hashPage() || (store.state ? '' : 'welcome');
}

/** True while a stall is open in this tab. */
export const hasStall = () => !!store.state;

/** Fallback for a route whose page module hasn't registered (yet). @param {string} name */
function fallbackPage(name) {
  const links = [
    ['setup', 'Start my stall', 'primary'],
    ['stalls', 'Your stalls', ''],
    ['login', 'Log in', 'quiet-outline'],
  ].filter(([key]) => key !== name);
  return `<div class="boot mys-page-fallback">
    <span class="boot-mark">${BRAND.short}</span>
    <span class="credit-badge">${BRAND.credit}</span>
    <p class="boot-word">${BRAND.name}</p>
    <p class="boot-status">${esc(PAGE_TITLES[name] || 'This page')} is loading. Pick where to go next.</p>
    <div class="row wrap" style="justify-content:center">${links.map(([key, label, cls]) => btn(esc(label), 'core-go-page', cls, `data-page="${key}"`)).join('')}
    ${store.state ? btn('Back to my stall', 'core-back-to-stall', 'yellow') : ''}</div>
  </div>`;
}

/** @param {string} name */
function pageHtml(name) {
  const fn = pages.get(name);
  if (!fn) return fallbackPage(name);
  try {
    return fn();
  } catch (err) {
    console.error(err);
    return `<div class="boot boot-error" role="alert"><span class="boot-mark">${BRAND.short}</span><span class="credit-badge">${BRAND.credit}</span>
      <h1>This page hit a snag.</h1><p>${esc(messageOf(err))}</p><p>Your stalls are safe on this phone.</p>
      ${btn('Reload', 'core-reload', 'primary')}</div>`;
  }
}

/** Accent/secondary CSS variables: the open stall's theme inside the shell, MYS defaults on outside pages. @param {any} c */
function applyThemeVars(c) {
  const accent = HEX_RE.test(c?.theme?.accent) ? c.theme.accent : '#FFDD35';
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--on-accent', onColor(accent));
  const secondary = HEX_RE.test(c?.theme?.secondary) ? c.theme.secondary : '#FF4D87';
  root.setProperty('--secondary', secondary);
  root.setProperty('--on-secondary', onColorMax(secondary));
}

/** What the last render showed: 'page:<name>' or 'stall:<id>' (switching views scrolls to the top). */
let lastView = '';

/**
 * Re-render #app, keeping focus and caret of a focused element that has an id. Shows a registered page full-screen when no
 * stall is open or the hash names a page (§17.2); otherwise the stall shell with the current screen.
 */
export function render() {
  const app = appEl();
  if (!app) return;
  const page = currentPage();
  if (!page && (!store.state || !shellFn)) return;
  installArtSprite();
  const active = /** @type {any} */ (document.activeElement);
  const keep = active && active.id && app.contains(active)
    ? {id: active.id, start: safe(() => active.selectionStart), end: safe(() => active.selectionEnd), dir: safe(() => active.selectionDirection)}
    : null;
  const view = page ? `page:${page}` : `stall:${store.stallId || ''}`;
  const root = document.documentElement;
  if (page) {
    // No stall open and no route yet (boot, a stall left in another tab): show it in the URL as #/welcome.
    if (!hashPage()) safe(() => history.replaceState(history.state, '', `${location.pathname}${location.search}#/${page}`));
    root.dataset.view = 'page';
    root.dataset.page = page;
    applyThemeVars(null);
    app.innerHTML = pageHtml(page);
    document.title = `${PAGE_TITLES[page] || BRAND.name} · ${BRAND.name} (${BRAND.short})`;
  } else {
    root.dataset.view = 'stall';
    delete root.dataset.page;
    const c = C();
    applyThemeVars(c);
    app.innerHTML = /** @type {(html: string) => string} */ (shellFn)(screenHtml(ui.screen));
    document.title = `${c?.profile?.stallName || 'My stall'} · ${BRAND.name}`;
  }
  if (keep) {
    const el = /** @type {any} */ (document.getElementById(keep.id));
    if (el && app.contains(el)) {
      el.focus({preventScroll: true});
      if (typeof keep.start === 'number' && typeof el.setSelectionRange === 'function') {
        safe(() => el.setSelectionRange(keep.start, keep.end, keep.dir || 'none'));
      }
    }
  }
  if (lastView && view !== lastView) window.scrollTo(0, 0);
  lastView = view;
}

/** Drop a page route from the URL (keeps history so Back returns to it). */
function clearHash() {
  if (typeof location === 'undefined' || !location.hash) return;
  try {
    history.pushState(null, '', location.pathname + location.search);
  } catch {
    location.hash = '';
  }
}

/**
 * Show an outside page: sets location.hash to `#/<name>` and renders (closes any open sheet first).
 * @param {string} name 'welcome' | 'setup' | 'stalls' | 'login' | 'signup' | 'join' | 'account' (may carry '?query')
 */
export function goPage(name) {
  const target = `#/${String(name || 'welcome').replace(/^#?\/?/, '')}`;
  if (sheetEl()?.open) closeSheet();
  if (pinEl()?.open) closePin(false);
  if (location.hash !== target) location.hash = target;
  render();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stalls: open / leave / switch (§17.1–17.2)
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Set<(info: {stallId: string, state: any}) => void>} */
const committedHooks = new Set();
/** @type {Set<(info: {stallId: string|null, state: any}) => void>} */
const stallHooks = new Set();
/** @type {Set<(stallId: string) => any>} */
const leaveHooks = new Set();

/**
 * Called after every successful commit with {stallId, state} (the cloud sync engine subscribes).
 * @param {(info: {stallId: string, state: any}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onCommitted(fn) {
  committedHooks.add(fn);
  return () => committedHooks.delete(fn);
}

/**
 * Called whenever this tab switches to another stall or leaves one ({stallId: null, state: null}). Modules reset per-stall
 * drafts here.
 * @param {(info: {stallId: string|null, state: any}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onStallChange(fn) {
  stallHooks.add(fn);
  return () => stallHooks.delete(fn);
}

/**
 * Awaited (≤ 6 s each, errors ignored) before leaving a stall — e.g. to push pending cloud changes.
 * @param {(stallId: string) => any} fn
 * @returns {() => void} unsubscribe
 */
export function onBeforeLeave(fn) {
  leaveHooks.add(fn);
  return () => leaveHooks.delete(fn);
}

/** @param {Set<Function>} hooks @param {any} info */
function fire(hooks, info) {
  for (const fn of [...hooks]) {
    try {
      const out = fn(info);
      if (out instanceof Promise) out.catch(err => console.error(err));
    } catch (err) {
      console.error(err);
    }
  }
}

/** Resolve after `ms` at the latest. @param {Promise<any>} p @param {number} ms */
function within(p, ms) {
  let timer = 0;
  return Promise.race([
    Promise.resolve(p).catch(err => console.warn(err)),
    new Promise(resolve => {
      timer = window.setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Re-read the stalls index into store.meta (best effort). */
export async function refreshMeta() {
  try {
    store.meta = await storage.getMeta();
  } catch (err) {
    console.warn('Could not read the stalls list', err);
  }
  return store.meta;
}

/** Keep the in-memory index card of the open stall in step with a committed state. @param {string} id @param {any} state */
function noteSummary(id, state) {
  const entry = store.meta?.stalls?.find((/** @type {any} */ e) => e.id === id);
  if (entry) {
    entry.summary = storage.stallSummary(state);
    entry.updatedAt = new Date().toISOString();
  }
}

/**
 * Adopt a stall (or none) in this tab: state, admin lock, screen, sheets. No storage write. Returns whether the stall
 * changed; callers then render and run `announce()` so onStallChange hooks see the new view.
 * @param {string|null} id
 * @param {any} state
 * @returns {boolean}
 */
function adopt(id, state) {
  const changed = store.stallId !== id;
  if (sheetEl()?.open) closeSheet();
  if (pinEl()?.open) closePin(false);
  store.state = state;
  store.stallId = state ? id : null;
  if (changed) {
    lockAdmin();
    wrongTries = 0;
    ui.screen = state ? 'sell' : '';
  }
  return changed;
}

/** Tell onStallChange hooks about the stall now open in this tab (or none). */
const announce = () => fire(stallHooks, {stallId: store.stallId, state: store.state});

/**
 * Open a stall on this device: storage.openStall → store.state → images → clear the page route → render.
 * @param {string} id stall entry id
 * @returns {Promise<any>} its state
 */
export async function openStallById(id) {
  const state = await storage.openStall(id);
  const changed = adopt(id, state);
  await reloadMedia().catch(err => console.warn('Images could not be loaded', err));
  await refreshMeta();
  clearHash();
  render();
  window.scrollTo(0, 0);
  if (changed) announce();
  return state;
}

/** Push this stall's pending cloud changes before leaving (cloud.mjs is optional and loaded lazily). @param {string} id */
async function flushCloud(id) {
  try {
    const cloud = /** @type {any} */ (await import('../cloud.mjs'));
    if (typeof cloud.flushSync === 'function') {
      await within(cloud.flushSync(id), 6000);
      return;
    }
    const entry = store.meta?.stalls?.find((/** @type {any} */ e) => e.id === id);
    if (typeof cloud.pushStall === 'function' && entry?.cloud?.dirty && navigator.onLine !== false) {
      await within(cloud.pushStall(id), 6000);
    }
  } catch (err) {
    console.warn('Cloud sync skipped before leaving', err);
  }
}

/**
 * Leave the open stall: flush pending cloud sync → storage.leaveStall → store.state = null → the welcome page.
 * The stall's data stays on this device.
 */
export async function leaveCurrentStall() {
  const id = store.stallId;
  if (id) {
    for (const fn of [...leaveHooks]) await within(fn(id), 6000);
    await flushCloud(id);
  }
  await storage.leaveStall();
  const changed = adopt(null, null);
  await refreshMeta();
  goPage('welcome');
  if (changed) announce();
}

/**
 * Persist a change: one atomic storage.mutate(fn) on the open stall, then adopt the new state and re-render.
 * @template T
 * @param {(state: any) => T} fn synchronous; throw to roll back
 * @param {{render?: boolean}} [options]
 * @returns {Promise<T>}
 */
export async function commit(fn, {render: doRender = true} = {}) {
  if (!store.state) throw Error('Open a stall first.');
  /** @type {any} */
  let result;
  try {
    result = await storage.mutate(fn, {stallId: store.stallId});
  } catch (err) {
    if (/different stall/.test(messageOf(err))) syncExternal({type: 'meta', stallId: null});
    throw err;
  }
  store.state = result.state;
  if (!store.stallId) store.stallId = result.stallId;
  noteSummary(result.stallId, result.state);
  if (doRender) render();
  fire(committedHooks, {stallId: result.stallId, state: result.state});
  return result.output;
}

let externalQueue = Promise.resolve();

/**
 * Another tab changed storage: follow a stall switch/leave, adopt a newer state of the open stall, refresh pages.
 * Serialized so bursts of messages apply in order.
 * @param {{type: 'meta'|'state', stallId: string|null}} change
 */
function syncExternal(change) {
  externalQueue = externalQueue.then(() => applyExternal(change)).catch(showError);
  return externalQueue;
}

/** @param {{type: 'meta'|'state', stallId: string|null}} change */
async function applyExternal(change) {
  const meta = await storage.getMeta();
  store.meta = meta;
  const active = meta.activeStallId;
  if (active !== store.stallId) {
    const had = !!store.state;
    const open = (sheetEl()?.open || pinEl()?.open) && had;
    if (active) {
      const state = await storage.read();
      adopt(active, state);
      await reloadMedia().catch(() => {});
      render();
      announce();
      const name = state?.config?.profile?.stallName || 'another stall';
      toast(`Another tab switched this phone to ${name}.${open ? ' Please reopen your panel.' : ''}`, {tone: 'warn'});
    } else {
      adopt(null, null);
      render();
      announce();
      if (had) toast('This stall was closed in another tab. Its data is safe on this phone.', {tone: 'warn'});
    }
    return;
  }
  if (change.type === 'state' && store.state && change.stallId === store.stallId) {
    store.state = await storage.read();
    await reloadMedia().catch(() => {});
    render();
    if (pinEl()?.open) closePin(false);
    if (sheetEl()?.open) {
      closeSheet();
      toast('Another tab updated this stall. Please reopen your panel.', {tone: 'warn'});
    }
    return;
  }
  if (change.type === 'meta' || currentPage()) render();
}

/** @template T @param {() => T} fn @returns {T|null} */
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Switch screens.
 * @param {string} screen registered screen key
 */
export function navigate(screen) {
  ui.screen = screens.has(screen) ? screen : 'sell';
  if (store.state) clearHash(); // a stall screen from an outside page goes back into the shell
  render();
  window.scrollTo(0, 0);
}

/**
 * Like commit, but validates the whole config inside the same transaction so an invalid edit rolls back.
 * @template T
 * @param {(state: any) => T} fn
 * @param {{render?: boolean}} [options]
 * @returns {Promise<T>}
 */
export function commitConfig(fn, options) {
  return commit(st => {
    const out = fn(st);
    validateConfig(st.config);
    return out;
  }, options);
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration & dispatch
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Map<string, (el: any, ds: any, event: any) => any>} */
const actions = new Map();
const adminActions = new Set();
/** @type {Map<string, (el: any, event: any) => any>} */
const inputs = new Map();
/** @type {Map<string, (el: any, event: any) => any>} */
const changes = new Map();
/** @type {Array<() => any>} */
const bootHooks = [];
const running = new Set();

/** @param {(screenHtml: string) => string} fn */
export function registerShell(fn) {
  shellFn = fn;
}

/**
 * @param {string} key
 * @param {() => string} renderFn
 */
export function registerScreen(key, renderFn) {
  screens.set(key, renderFn);
}

/**
 * Register click actions (data-action="name"). Names listed in `admin` need the PIN first.
 * @param {Record<string, (el: any, ds: DOMStringMap|Record<string,string>, event: any) => any>} map
 * @param {{admin?: string[]}} [options]
 */
export function registerActions(map, {admin = []} = {}) {
  for (const [name, fn] of Object.entries(map)) {
    if (actions.has(name)) console.warn(`Action "${name}" registered twice; the later one wins.`);
    actions.set(name, fn);
  }
  for (const name of admin) adminActions.add(name);
}

/** 'input' events from elements with data-input="key" → map[key](el, event). @param {Record<string, (el: any, event: any) => any>} map */
export function registerInputs(map) {
  for (const [k, fn] of Object.entries(map)) inputs.set(k, fn);
}

/** 'change' events from elements with data-change="key" → map[key](el, event). @param {Record<string, (el: any, event: any) => any>} map */
export function registerChanges(map) {
  for (const [k, fn] of Object.entries(map)) changes.set(k, fn);
}

/** Run after the first render. @param {() => any} fn */
export function onBoot(fn) {
  bootHooks.push(fn);
}

/** Run every onBoot hook (called once by app.mjs). Errors are reported, never fatal. */
export async function runBoot() {
  for (const fn of bootHooks) {
    try {
      await fn();
    } catch (err) {
      showError(err);
    }
  }
}

/**
 * Dispatch an action by name (double-tap guarded; admin actions ask for the PIN first; errors → showError).
 * @param {string} name
 * @param {any} el
 * @param {Record<string, string>} ds
 * @param {any} event
 */
async function dispatch(name, el, ds, event) {
  const handler = actions.get(name);
  if (!handler) {
    console.warn(`No handler for action "${name}".`);
    return undefined;
  }
  if (running.has(name)) return undefined;
  running.add(name);
  try {
    if (adminActions.has(name) && !(await ensureAdmin())) return undefined;
    return await handler(el, ds, event);
  } catch (err) {
    showError(err);
    return undefined;
  } finally {
    running.delete(name);
  }
}

/**
 * Programmatic dispatch (cross-module). Same rules as a tap.
 * @param {string} name
 * @param {Record<string, string>} [ds]
 */
export const runAction = (name, ds = {}) => dispatch(name, null, {...ds}, null);

// ---------------------------------------------------------------------------------------------------------------------
// Admin PIN (local shared-device guard; SHA-256(salt + ':' + pin) hex, same as v1)
// ---------------------------------------------------------------------------------------------------------------------

const UNLOCK_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const COOLDOWN_MS = 30 * 1000;
let adminUntil = 0;
let wrongTries = 0;
let cooldownUntil = 0;
let cooldownTimer = 0;
/** @type {Array<(ok: boolean) => void>} */
let pinWaiters = [];
let pinMode = /** @type {'create'|'unlock'} */ ('unlock');

/**
 * Hex SHA-256 of `${salt}:${pin}` (v1-compatible).
 * @param {string} pin
 * @param {string} salt
 * @returns {Promise<string>}
 */
export async function hashPin(pin, salt) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** True while the admin unlock is valid. */
export const isAdmin = () => Date.now() < adminUntil;

/** Lock admin immediately. */
export function lockAdmin() {
  adminUntil = 0;
}

const extendAdmin = () => {
  adminUntil = Date.now() + UNLOCK_MS;
};

/**
 * Validate and store a new admin PIN (4–8 digits). Callers guard with requireAdmin when a PIN already exists.
 * @param {string} pin
 * @param {string} [repeat] when given, must match
 */
export async function savePin(pin, repeat = pin) {
  const clean = String(pin ?? '').trim();
  if (!/^\d{4,8}$/.test(clean)) throw Error('Use 4 to 8 digits for the PIN.');
  if (clean !== String(repeat ?? '').trim()) throw Error('The two PINs don’t match. Type the same PIN twice.');
  const salt = uuid();
  const hash = await hashPin(clean, salt);
  await commit(st => {
    const had = !!st.pin;
    st.pin = {salt, hash};
    audit(st[st.mode], had ? 'pin-changed' : 'pin-set', 'pin', st.config.operator);
  });
  extendAdmin();
}

/** Resolve true when admin is (or becomes) unlocked; false if the prompt is cancelled. Extends the sliding unlock. */
function ensureAdmin() {
  if (isAdmin()) {
    extendAdmin();
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    pinWaiters.push(resolve);
    if (pinWaiters.length === 1) openPinDialog();
  });
}

/**
 * Run `fn` once the admin PIN is unlocked (prompting if needed). Resolves to fn's result, or undefined if cancelled.
 * @template T
 * @param {() => T} fn
 * @returns {Promise<Awaited<T>|undefined>}
 */
export async function requireAdmin(fn) {
  if (!(await ensureAdmin())) return undefined;
  return await fn();
}

/** @param {boolean} ok */
function settlePin(ok) {
  const waiters = pinWaiters;
  pinWaiters = [];
  for (const resolve of waiters) resolve(ok);
}

function openPinDialog() {
  const dlg = pinEl();
  if (!dlg) {
    settlePin(false);
    return;
  }
  pinMode = store.state?.pin ? 'unlock' : 'create';
  const create = pinMode === 'create';
  const pinInput = (/** @type {string} */ name, /** @type {string} */ label) =>
    `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="off" class="pin-input" required></div>`;
  dlg.innerHTML = `<form class="pin-form" method="dialog" novalidate>
    <div class="pin-head"><span class="pin-badge">${icon(create ? 'lock' : 'unlock')}</span><div><h2 id="pin-title">${create ? 'Set your admin PIN' : 'Admin PIN'}</h2>
    <p>${create ? 'Pick 4–8 digits to guard menu edits, corrections and resets on this device.' : 'Unlock admin tools for 10 minutes.'}</p></div></div>
    <div class="form-error" data-error hidden role="alert"></div>
    ${pinInput('pin-entry', create ? 'New PIN' : 'PIN')}
    ${create ? pinInput('pin-repeat', 'Repeat PIN') : ''}
    <p class="footnote">A local guard for a shared counter phone — not a cloud account.</p>
    <div class="pin-actions"><button type="button" class="quiet-outline" data-pin-action="cancel">Cancel</button><button type="submit" class="primary" data-pin-action="submit">${create ? 'Save PIN & continue' : 'Unlock'}</button></div>
  </form>`;
  dlg.setAttribute('aria-labelledby', 'pin-title');
  try {
    dlg.showModal();
  } catch {
    dlg.setAttribute('open', '');
  }
  updateCooldown();
  /** @type {HTMLInputElement|null} */ (dlg.querySelector('#pin-entry'))?.focus();
}

function updateCooldown() {
  const dlg = pinEl();
  if (!dlg?.open) return;
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const submit = /** @type {HTMLButtonElement|null} */ (dlg.querySelector('[data-pin-action="submit"]'));
  const fields = /** @type {NodeListOf<HTMLInputElement>} */ (dlg.querySelectorAll('.pin-input'));
  clearTimeout(cooldownTimer);
  if (left > 0) {
    if (submit) submit.disabled = true;
    fields.forEach(f => (f.disabled = true));
    const slot = dlg.querySelector('[data-error]');
    if (slot) {
      slot.textContent = `Too many wrong tries. Try again in ${left} s.`;
      slot.hidden = false;
    }
    cooldownTimer = window.setTimeout(updateCooldown, 1000);
  } else if (submit?.disabled) {
    submit.disabled = false;
    fields.forEach(f => (f.disabled = false));
    clearError(dlg);
    fields[0]?.focus();
  }
}

async function submitPin() {
  const dlg = pinEl();
  if (!dlg?.open || Date.now() < cooldownUntil) return;
  const entry = /** @type {HTMLInputElement} */ (dlg.querySelector('#pin-entry'));
  const pin = entry?.value.trim() || '';
  if (pinMode === 'create' || !store.state?.pin) {
    const repeat = /** @type {HTMLInputElement|null} */ (dlg.querySelector('#pin-repeat'))?.value ?? pin;
    await savePin(pin, repeat);
  } else {
    if (!/^\d{4,8}$/.test(pin)) throw Error('Enter your 4–8 digit PIN.');
    const {salt, hash} = store.state.pin;
    if ((await hashPin(pin, salt)) !== hash) {
      wrongTries++;
      entry.value = '';
      entry.focus();
      if (wrongTries >= MAX_TRIES) {
        wrongTries = 0;
        cooldownUntil = Date.now() + COOLDOWN_MS;
        updateCooldown();
        return;
      }
      const left = MAX_TRIES - wrongTries;
      throw Error(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a short cooldown.`);
    }
    wrongTries = 0;
    extendAdmin();
  }
  closePin(true);
}

/** Close the PIN prompt and resume (ok) or drop (cancel) the waiting admin actions. @param {boolean} ok */
function closePin(ok) {
  settlePin(ok);
  const dlg = pinEl();
  if (dlg?.open) dlg.close();
}

let pinBusy = false;

function wirePinDialog() {
  const dlg = pinEl();
  if (!dlg || dlg.dataset.wired) return;
  dlg.dataset.wired = '1';
  dlg.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (pinBusy) return;
    pinBusy = true;
    try {
      clearError(dlg);
      await submitPin();
    } catch (err) {
      showError(err);
    } finally {
      pinBusy = false;
    }
  });
  dlg.addEventListener('click', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('[data-pin-action="cancel"]')) closePin(false);
  });
  dlg.addEventListener('close', () => {
    if (dlg.open) return;
    clearTimeout(cooldownTimer);
    settlePin(false);
    dlg.innerHTML = '';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Files & media
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Save text (or a Blob) as a file.
 * @param {string} filename
 * @param {string|Blob} text
 * @param {string} [mime]
 */
export function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob([text], {type: mime});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/** media id → object URL */
const mediaCache = new Map();

/** @param {string} dataURL */
function dataUrlToBlob(dataURL) {
  const comma = dataURL.indexOf(',');
  const mime = dataURL.slice(5, dataURL.indexOf(';'));
  const bin = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type: mime});
}

/**
 * Resolve an image reference to something an <img> can show.
 * @param {string|null|undefined} ref 'media:<id>' | 'https://…'
 * @returns {string} object URL / https URL, or '' when unknown
 */
export function mediaUrl(ref) {
  if (typeof ref !== 'string') return '';
  if (MEDIA_RE.test(ref)) return mediaCache.get(ref.slice(6)) || '';
  if (IMAGE_URL_RE.test(ref)) return ref;
  return '';
}

/**
 * (Re)load the object-URL cache from the media store: adds new images, revokes deleted ones.
 * Call after boot, restores and factory resets.
 * @returns {Promise<void>}
 */
export async function reloadMedia() {
  const all = await storage.getAllMedia();
  for (const [id, url] of mediaCache) {
    if (!(id in all)) {
      URL.revokeObjectURL(url);
      mediaCache.delete(id);
    }
  }
  for (const [id, data] of Object.entries(all)) {
    if (mediaCache.has(id)) continue;
    try {
      mediaCache.set(id, URL.createObjectURL(dataUrlToBlob(data)));
    } catch (err) {
      console.warn('Skipping an unreadable image', id, err);
    }
  }
}

/**
 * Store an uploaded image and return its reference for product.image.
 * @param {string} dataURL data:image/(png|jpeg|webp|gif);base64,… ≤ 1.5 MiB
 * @returns {Promise<string>} 'media:<id>'
 */
export async function saveImageDataUrl(dataURL) {
  const id = uuid();
  await storage.putMedia(id, dataURL);
  mediaCache.set(id, URL.createObjectURL(dataUrlToBlob(dataURL)));
  return `media:${id}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Service worker updates
// ---------------------------------------------------------------------------------------------------------------------

let updateRequested = false;

/** @param {ServiceWorker} worker */
function showUpdateBanner(worker) {
  let bar = $('update-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.className = 'update-banner';
    bar.setAttribute('role', 'status');
    document.body.append(bar);
  }
  bar.innerHTML = `${icon('refresh')}<span>New version ready</span><button type="button" class="small" data-update="now">Update</button><button type="button" class="quiet icon-btn small" data-update="later" aria-label="Later">${icon('close')}</button>`;
  bar.hidden = false;
  bar.onclick = (/** @type {MouseEvent} */ e) => {
    const choice = /** @type {HTMLElement} */ (e.target).closest('[data-update]')?.getAttribute('data-update');
    if (choice === 'later') bar.hidden = true;
    if (choice === 'now') {
      updateRequested = true;
      bar.querySelector('[data-update="now"]').textContent = 'Updating…';
      worker.postMessage({type: 'SKIP_WAITING'});
    }
  };
}

/**
 * Register ./sw.js and offer a non-blocking "New version ready · Update" banner when a new worker is waiting.
 * Never reloads on its own: the page reloads only after the person taps Update.
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    if (!reg) return; // blocked (some test browsers resolve without a registration)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) {
        updateRequested = false;
        location.reload();
      }
    });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    });
  } catch (err) {
    // Blocked or unsupported (private mode, test browsers): the app still works online; nothing to bother the cashier with.
    console.warn('Offline cache unavailable:', err);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Global listeners & core actions
// ---------------------------------------------------------------------------------------------------------------------

registerActions({
  close: () => closeSheet(),
  'core-confirm': async () => {
    const pending = pendingConfirm;
    if (!pending) {
      closeSheet();
      return;
    }
    if (pending.typed) {
      const input = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#confirm-typed'));
      if ((input?.value.trim() ?? '') !== pending.typed) throw Error(`Type ${pending.typed} exactly to continue.`);
    }
    await pending.onConfirm();
    if (sheetKind() === 'confirm' && pendingConfirm === pending) closeSheet();
  },
  // Kernel routing actions any page may use: data-page="stalls" etc.
  'core-go-page': (_el, ds) => goPage(ds.page || 'welcome'),
  'core-open-stall': (_el, ds) => openStallById(ds.id || ''),
  'core-leave-stall': () => leaveCurrentStall(),
  'core-back-to-stall': () => {
    if (!store.state) return goPage('welcome');
    navigate(ui.screen || 'sell');
  },
  'core-reload': () => location.reload(),
});

/** @param {Element} el @returns {Record<string, string>} */
const dataOf = el => ({.../** @type {HTMLElement} */ (el).dataset});

function wireGlobalListeners() {
  document.addEventListener('click', e => {
    const target = /** @type {Element} */ (e.target);
    const el = /** @type {HTMLElement|null} */ (target?.closest?.('[data-action]'));
    if (!el || el.closest('#pin-dialog')) return;
    if (/** @type {any} */ (el).disabled || el.getAttribute('aria-disabled') === 'true') return;
    const tag = el.tagName;
    const type = /** @type {any} */ (el).type;
    if (!(tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) && tag !== 'LABEL') e.preventDefault();
    dispatch(el.dataset.action || '', el, dataOf(el), e);
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (form.closest('#pin-dialog')) return;
    if (form.dataset.submit) dispatch(form.dataset.submit, form, dataOf(form), e);
  });

  // Enter in a single-line field of a data-submit form runs its action (even without a submit button).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'file'].includes(target.type)) return;
    const form = /** @type {HTMLFormElement|null} */ (target.closest('form[data-submit]'));
    if (!form || form.closest('#pin-dialog')) return;
    e.preventDefault();
    dispatch(form.dataset.submit || '', form, dataOf(form), e);
  });

  document.addEventListener('input', e => {
    const el = /** @type {HTMLElement} */ (e.target)?.closest?.('[data-input]');
    const fn = el && inputs.get(/** @type {HTMLElement} */ (el).dataset.input || '');
    if (!fn) return;
    try {
      const out = fn(el, e);
      if (out instanceof Promise) out.catch(showError);
    } catch (err) {
      showError(err);
    }
  });

  document.addEventListener('change', e => {
    const el = /** @type {HTMLElement} */ (e.target)?.closest?.('[data-change]');
    const fn = el && changes.get(/** @type {HTMLElement} */ (el).dataset.change || '');
    if (!fn) return;
    try {
      const out = fn(el, e);
      if (out instanceof Promise) out.catch(showError);
    } catch (err) {
      showError(err);
    }
  });

  // Broken or offline product photos fall back to the illustration underneath.
  document.addEventListener(
    'error',
    e => {
      const img = /** @type {HTMLElement} */ (e.target);
      if (img instanceof HTMLImageElement && img.classList.contains('art-img')) {
        img.hidden = true;
        const src = img.getAttribute('src');
        if (src && !src.startsWith('blob:')) brokenImages.add(src);
      }
    },
    true,
  );

  const sheet = sheetEl();
  // Escape closes the dialog natively; a sheet reopened meanwhile (close event is async) is left alone.
  sheet?.addEventListener('close', () => {
    if (!sheet.open) finishSheetClose();
  });
  wirePinDialog();

  window.addEventListener('online', () => {
    brokenImages.clear();
    render();
  });
  window.addEventListener('offline', () => render());

  // Other tabs: a stall switch/leave elsewhere is followed here; a write to the open stall is adopted (§17.2).
  storage.onExternalChange(change => {
    syncExternal(change);
  });

  // Hash routes (#/welcome, #/stalls, …): Back/Forward and links render the matching view.
  window.addEventListener('hashchange', () => {
    const page = currentPage();
    const view = page ? `page:${page}` : `stall:${store.stallId || ''}`;
    if (view === lastView) return;
    if (sheetEl()?.open) closeSheet();
    render();
  });
  window.addEventListener('popstate', () => {
    const page = currentPage();
    const view = page ? `page:${page}` : `stall:${store.stallId || ''}`;
    if (view !== lastView) render();
  });
}

if (typeof document !== 'undefined') wireGlobalListeners();
