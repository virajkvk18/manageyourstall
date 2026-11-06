// "Customize My Stall" — Stall Studio (ARCHITECTURE.md §13.8 + §16): stall themes & look, profile, team & profit split,
// mission, UPI, discounts and games.
//
// Forms live on the screen. Typed values are mirrored into module-level drafts on every keystroke, so a re-render
// (another section saving, the operator switching, an other-tab write) never throws away what the owner typed.
// A section's draft is dropped only by its own Save (after a successful commit) or Discard.
// Every save is an admin action; list edits (discounts, games, partners, active toggles) commit right away.
import {
  C, S, esc, money, paise, icon, btn, field, check, toggle, heading, emptyState, artFrame, toast, openSheet, closeSheet,
  confirmSheet, commitConfig, render, navigate, registerScreen, registerActions, registerInputs, registerChanges,
  sheetEl, requireAdmin, mediaUrl, saveImageDataUrl,
} from './core.mjs';
import {
  saveProfile, saveTheme, saveUpi, saveDiscount, deleteDiscount, moveDiscount, setAllowCustomDiscount, saveMission,
  saveOperators, setKitchenQueue, saveGame, deleteGame, newId, CATALOG_LIMITS, addMember, renameMember, setMemberColor,
  removeMember, setSplitMode, setShares, equalShares,
} from '../catalog.mjs';
import {resolveDiscount, setDraftDiscount, refreshMilestones, report, upiUri, applyTheme, audit} from '../domain.mjs';
import {TEMPLATES} from '../templates.mjs';
import {qrSvg} from '../qr.mjs';
import * as lib from '../library.mjs';
import {initialsOf} from '../util.mjs';
import {ACCENTS, LIMITS, UPI_RE, HEX_RE, MISSION_SUGGESTIONS, BRAND, TINTS, TINT_IDS, PATTERN_IDS} from '../constants.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Sections & shared helpers
// ---------------------------------------------------------------------------------------------------------------------

/** Studio sections in display order (also the valid `data-section` values of `studio-open`). */
export const STUDIO_SECTIONS = Object.freeze([
  {id: 'themes', label: 'Themes', icon: 'palette', title: 'Stall theme & look', sub: 'Pick a vibe: hero art, colours and, if you like, a starter menu.'},
  {id: 'profile', label: 'Profile', icon: 'store', title: 'Stall profile', sub: 'Name, booth, event and the hero line on Sell.'},
  {id: 'team', label: 'Team', icon: 'users', title: 'Team & profit split', sub: 'Who chipped in, how the profit splits, and who’s on the counter.'},
  {id: 'mission', label: 'Mission', icon: 'target', title: 'Break-even mission', sub: 'The number to win back before the profit starts.'},
  {id: 'upi', label: 'UPI', icon: 'upi', title: 'UPI payments', sub: 'Your UPI ID powers the checkout QR.'},
  {id: 'discounts', label: 'Discounts', icon: 'percent', title: 'Discounts', sub: 'One-tap offers at checkout.'},
  {id: 'games', label: 'Games', icon: 'game', title: 'Stall games', sub: 'Ring toss, lucky cups — anything with a fee.'},
]);
const SECTION_IDS = STUDIO_SECTIONS.map(s => s.id);

/** Old section names that now live inside another section. */
const SECTION_ALIASES = Object.freeze({templates: 'themes', look: 'themes', partners: 'team'});

/** @param {string|undefined} id @returns {string} '' when unknown */
function resolveSection(id) {
  const key = String(id || '');
  if (SECTION_IDS.includes(key)) return key;
  return SECTION_ALIASES[key] || '';
}

/** Fun names for the colour swatches (same order as constants.ACCENTS). */
const ACCENT_NAMES = ['Haldi yellow', 'Gulabi pink', 'Tamatar coral', 'Pudina mint', 'Nimbu lime', 'Jamuni lavender', 'Aasmani sky', 'Santra orange'];

/** Integer paise → plain rupee text for an input ('1500', '12.50'). @param {number} p */
const rupees = p => (Number.isSafeInteger(p) ? (p % 100 ? (p / 100).toFixed(2) : String(p / 100)) : '');

/** @param {unknown} err */
const messageOf = err => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || ''));

/** Parse a rupee amount with paise() and a field-specific, honest message. @param {string} raw @param {string} what */
function parseRupees(raw, what) {
  const s = String(raw ?? '').trim();
  try {
    return paise(s);
  } catch (err) {
    if (/^-/.test(s)) throw Error(`${what} can’t be negative.`);
    if (/too large/i.test(messageOf(err))) throw Error(`${what}: ${money(CATALOG_LIMITS.price)} is the most you can enter.`);
    throw Error(`${what}: enter rupees like 150 or 99.50.`);
  }
}

/** Parse an optional rupee amount: blank → 0. @param {string} raw @param {string} what */
const amountOrZero = (raw, what) => (String(raw ?? '').trim() ? parseRupees(raw, what) : 0);

/** Readable text colour on a background hex (mirrors the kernel's --on-accent rule). @param {string} hex */
export function onColor(hex) {
  if (!HEX_RE.test(hex)) return '#171717';
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#171717' : '#fff9ed';
}

/**
 * Clear any cart discount (live and practice) that no longer resolves against the config — call inside the same commit
 * that deletes/deactivates a rule or turns custom discounts off, so checkout never holds a ghost discount.
 * @param {any} st
 */
export function clearStaleDiscounts(st) {
  for (const mode of ['live', 'demo']) {
    const s = st[mode];
    if (s?.draftDiscount && !resolveDiscount(st.config, s.draftDiscount)) setDraftDiscount(s, st.config, null);
  }
}

const fmtDate = (/** @type {string} */ d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const at = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'}).format(at);
};

/** Topbar/hero texts for a (draft) profile, exactly as the shell shows them. @param {Record<string, string>} p */
function previewParts(p) {
  const clean = (/** @type {unknown} */ x) => String(x || '').trim();
  return {
    title: [p.stallName, p.booth].map(clean).filter(Boolean).join(' · ') || 'Your stall',
    sub: [p.eventName, p.venue, p.city, fmtDate(p.eventDate)].map(clean).filter(Boolean).join(' · '),
    initials: (clean(p.initials) || initialsOf(clean(p.ownerName) || clean(p.stallName))).slice(0, 3),
    tagline: clean(p.tagline),
    subTagline: clean(p.subTagline),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stall theme art (shared with onboarding)
// ---------------------------------------------------------------------------------------------------------------------

/** Theme entry by id (undefined for 'custom' / unknown). @param {string} id */
export const themeById = id => TEMPLATES.find(t => t.id === id);

/** The look of a template entry (Phase-1 entries without `theme` fall back to their accent + art). @param {any} t */
export function themeLook(t) {
  const th = t?.theme || {};
  return {
    accent: HEX_RE.test(th.accent) ? th.accent : HEX_RE.test(t?.accent) ? t.accent : '#FFDD35',
    secondary: HEX_RE.test(th.secondary) ? th.secondary : '#FF4D87',
    heroArt: Array.isArray(th.heroArt) && th.heroArt.length ? th.heroArt : [t?.art || 'packet'],
    heroTint: TINT_IDS.includes(th.heroTint) ? th.heroTint : 'yellow',
    heroPattern: PATTERN_IDS.includes(th.heroPattern) ? th.heroPattern : 'sunburst',
  };
}

/** Wide hero illustration (library.heroSvg when available, else the first illustration). @param {string[]} ids */
export function heroArtSvg(ids) {
  const list = Array.isArray(ids) && ids.length ? ids : ['packet'];
  const hero = /** @type {any} */ (lib).heroSvg;
  if (typeof hero === 'function') {
    try {
      return hero(list, {cls: 'studio-hero-svg'});
    } catch (err) {
      console.warn(err);
    }
  }
  return lib.artSvg(list[0], 'studio-hero-svg');
}

/**
 * The themed hero box: the owner's stall photo when given, else the theme illustration on its tint + pattern.
 * @param {{heroArt?: string[], heroTint?: string, heroPattern?: string, heroImage?: string|null}} look
 * @param {{cls?: string, alt?: string}} [options]
 */
export function heroBox(look, {cls = '', alt = ''} = {}) {
  const tint = TINT_IDS.includes(look?.heroTint || '') ? look.heroTint : 'yellow';
  const pattern = PATTERN_IDS.includes(look?.heroPattern || '') ? look.heroPattern : 'none';
  const src = look?.heroImage ? mediaUrl(look.heroImage) : '';
  const inner = src
    ? `<img class="studio-hero-img" src="${esc(src)}" alt="${esc(alt || 'Stall photo')}" decoding="async" referrerpolicy="no-referrer">`
    : heroArtSvg(look?.heroArt || []);
  return `<span class="studio-hero tint-${tint} pattern-${pattern}${src ? ' has-photo' : ''}${cls ? ' ' + cls : ''}">${inner}</span>`;
}

/** Accent + secondary palette dots. @param {string} accent @param {string} secondary */
const paletteDots = (accent, secondary) =>
  `<span class="studio-palette" aria-hidden="true"><span class="studio-dot" style="--dot:${esc(accent)}"></span><span class="studio-dot" style="--dot:${esc(secondary)}"></span></span>`;

/**
 * Stall theme cards (6 themes + blank). Studio renders buttons that open the apply sheet; onboarding renders radios.
 * @param {{mode?: 'button'|'radio', name?: string, selected?: string, current?: string, change?: string, prefix?: string}} opts
 */
export function themeCards({mode = 'button', name = 'theme', selected = '', current = '', change = '', prefix = 'theme'} = {}) {
  return TEMPLATES.map(t => {
    const look = themeLook(t);
    const isCurrent = t.id === current;
    const inner = `${heroBox(look, {cls: 'studio-theme-hero'})}
      <span class="studio-theme-emoji" aria-hidden="true">${esc(t.emoji)}</span>
      <span class="studio-theme-body">
        <span class="studio-theme-name">${esc(t.name)}</span>
        <span class="studio-theme-meta">${paletteDots(look.accent, look.secondary)}${isCurrent ? `<span class="studio-theme-current">${icon('check')} In use</span>` : ''}</span>
      </span>`;
    const style = `--tpl:${esc(look.accent)};--tpl2:${esc(look.secondary)}`;
    if (mode === 'radio') {
      return `<label class="studio-theme-card is-radio${isCurrent ? ' is-current' : ''}" style="${style}" for="${prefix}-${esc(t.id)}" data-theme="${esc(t.id)}">
        <input type="radio" class="studio-theme-radio" id="${prefix}-${esc(t.id)}" name="${esc(name)}" value="${esc(t.id)}"${change ? ` data-change="${esc(change)}"` : ''}${t.id === selected ? ' checked' : ''}>
        ${inner}
        <span class="studio-theme-pick" aria-hidden="true">${icon('check')}</span>
      </label>`;
    }
    return `<button type="button" class="studio-theme-card${isCurrent ? ' is-current' : ''}" style="${style}" data-action="studio-theme-pick" data-id="${esc(t.id)}" data-theme="${esc(t.id)}" aria-label="${esc(t.name)}${isCurrent ? ' (in use)' : ''}: preview and apply">${inner}</button>`;
  }).join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Module state: drafts (typed but unsaved), inline errors, UI bits
// ---------------------------------------------------------------------------------------------------------------------

/** @type {{profile: any, look: any, upi: any, mission: any, team: any, shares: any}} */
const drafts = {profile: null, look: null, upi: null, mission: null, team: null, shares: null};
/** @type {Record<string, string>} */
const errors = {};
let activeSection = 'themes';
let rowSeq = 0;

/**
 * Forget unsaved Studio edits (e.g. after onboarding rewrote the profile, or a factory reset).
 * @param {Array<'profile'|'look'|'upi'|'mission'|'team'|'shares'>} [sections] default: every section
 */
export function resetStudioDrafts(sections = /** @type {any} */ (Object.keys(drafts))) {
  for (const k of sections) {
    drafts[k] = null;
    delete errors[k];
  }
}

const PROFILE_KEYS = ['stallName', 'booth', 'tagline', 'subTagline', 'eventName', 'venue', 'city', 'eventDate', 'ownerName', 'initials'];

// Cashier draft rows remember the saved name they started from (`orig`). `current` stays null until the owner picks a
// cashier here, so a switch made meanwhile from the avatar sheet is followed instead of being overwritten on Save.
const teamRowsFromConfig = () => ({rows: C().operators.map((name, i) => ({key: `m${i}`, name, orig: name})), current: null});

/** Row key of who is on the counter in a team draft. @param {{rows: any[], current: string|null}} t */
function currentKey(t) {
  if (t.current && t.rows.some(r => r.key === t.current)) return t.current;
  const op = C().operator;
  return (t.rows.find(r => r.orig === op) || t.rows.find(r => String(r.name).trim() === op) || t.rows[0])?.key || '';
}

const missionFromConfig = () => {
  const m = C().mission;
  return {mode: m.mode, total: m.total ? rupees(m.total) : '', items: m.items.map(i => ({id: i.id, label: i.label, amount: rupees(i.amount)}))};
};

const lookFromConfig = () => {
  const t = C().theme || {};
  return {accent: String(t.accent || '#FFDD35').toUpperCase(), secondary: String(t.secondary || '#FF4D87').toUpperCase()};
};

/** Partners of the stall (Phase-2 configs; [] before migration). */
const members = () => /** @type {any[]} */ (C().team?.members || []);
const splitMode = () => (C().team?.splitMode === 'custom' ? 'custom' : 'equal');

const sharesFromConfig = () => Object.fromEntries(members().map(m => [m.id, m.share === null || m.share === undefined ? '' : String(m.share)]));

/** The draft for a section, created from the saved config on first edit. @param {'profile'|'look'|'upi'|'mission'|'team'|'shares'} sec */
function draftOf(sec) {
  if (drafts[sec]) return drafts[sec];
  const c = C();
  if (sec === 'profile') drafts.profile = {...c.profile};
  else if (sec === 'look') drafts.look = lookFromConfig();
  else if (sec === 'upi') drafts.upi = {id: c.upi.id, payeeName: c.upi.payeeName};
  else if (sec === 'mission') drafts.mission = missionFromConfig();
  else if (sec === 'team') drafts.team = teamRowsFromConfig();
  else if (sec === 'shares') drafts.shares = sharesFromConfig();
  return drafts[sec];
}

/** What the form shows: the draft if any, else the saved values. */
const view = {
  profile: () => drafts.profile || C().profile,
  look: () => drafts.look || lookFromConfig(),
  upi: () => drafts.upi || C().upi,
  mission: () => drafts.mission || missionFromConfig(),
  team: () => drafts.team || teamRowsFromConfig(),
  shares: () => ({...sharesFromConfig(), ...(drafts.shares || {})}),
};

/** True when a section has typed changes that differ from the saved config. @param {string} sec */
function isDirty(sec) {
  const c = C();
  const d = drafts[sec];
  if (!d) return false;
  if (sec === 'profile') return PROFILE_KEYS.some(k => String(d[k] ?? '').trim() !== String(c.profile[k] ?? ''));
  if (sec === 'look') {
    const saved = lookFromConfig();
    return d.accent !== saved.accent || d.secondary !== saved.secondary;
  }
  if (sec === 'upi') return d.id.trim() !== c.upi.id || d.payeeName.trim() !== c.upi.payeeName;
  if (sec === 'mission') return JSON.stringify(d) !== JSON.stringify(missionFromConfig());
  if (sec === 'team') {
    const names = d.rows.map(r => r.name.trim());
    const cur = d.rows.find(r => r.key === currentKey(d))?.name.trim();
    return JSON.stringify(names) !== JSON.stringify(c.operators) || cur !== c.operator;
  }
  if (sec === 'shares') {
    const saved = sharesFromConfig();
    return Object.entries(d).some(([id, v]) => id in saved && String(v).trim() !== saved[id]);
  }
  return false;
}

/** Update the "Unsaved changes" hint and clear the section's error after an edit (no full render). @param {string} sec */
function touched(sec) {
  const dirty = isDirty(sec);
  document.querySelectorAll(`[data-dirty="${sec}"], [data-discard="${sec}"]`).forEach(el => {
    /** @type {HTMLElement} */ (el).hidden = !dirty;
  });
  if (errors[sec]) {
    delete errors[sec];
    const slot = /** @type {HTMLElement|null} */ (document.querySelector(`[data-studio-error="${sec}"]`));
    if (slot) slot.hidden = true;
  }
}

/** Run a section save; errors show inline in that section (and nothing is lost). @param {string} sec @param {() => Promise<any>} fn */
async function guarded(sec, fn) {
  delete errors[sec];
  try {
    await fn();
  } catch (err) {
    errors[sec] = messageOf(err) || 'That didn’t save. Check the fields and try again.';
    render();
    const slot = document.querySelector(`[data-studio-error="${sec}"]`);
    slot?.scrollIntoView?.({block: 'nearest'});
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Section shells
// ---------------------------------------------------------------------------------------------------------------------

/** Inline error slot for a section or sub-panel. @param {string} key */
function errorSlot(key) {
  const err = errors[key] || '';
  return `<div class="form-error studio-error" data-studio-error="${key}" role="alert"${err ? '' : ' hidden'}>${icon('alert')}<span>${esc(err)}</span></div>`;
}

/**
 * Save bar: "Unsaved changes" pill, Discard and Save.
 * @param {string} key draft key
 * @param {string} save action
 * @param {string} label
 * @param {boolean} [draftable]
 */
function footHtml(key, save, label, draftable = true) {
  const dirty = draftable && isDirty(key);
  return `<div class="studio-foot">${draftable ? `<span class="studio-dirty" data-dirty="${key}"${dirty ? '' : ' hidden'}>${icon('edit')} Unsaved changes</span>` : ''}
      <span class="grow"></span>
      ${draftable ? btn('Discard', 'studio-discard', 'quiet small', `data-section="${key}" data-discard="${key}"${dirty ? '' : ' hidden'}`) : ''}
      ${btn(`${icon('check')} ${label}`, save, 'primary studio-save', `data-section="${key}"`)}
    </div>`;
}

/**
 * @param {string} id
 * @param {string} body markup
 * @param {{save?: string, saveLabel?: string, extra?: string, draftable?: boolean}} [opts]
 */
function section(id, body, {save = '', saveLabel = 'Save', extra = '', draftable = false} = {}) {
  const meta = STUDIO_SECTIONS.find(s => s.id === id);
  return `<section class="panel studio-section" id="studio-${id}" data-studio-section="${id}" aria-labelledby="studio-${id}-title">
    <header class="studio-sec-head">
      <span class="studio-sec-icon" aria-hidden="true">${icon(meta?.icon || 'spark')}</span>
      <div class="grow"><h2 id="studio-${id}-title">${esc(meta?.title || id)}</h2><p>${esc(meta?.sub || '')}</p></div>
      ${extra}
    </header>
    ${errorSlot(id)}
    ${body}
    ${save ? footHtml(id, save, saveLabel, draftable) : ''}
  </section>`;
}

/** Sub-panel heading inside a section. @param {string} ic @param {string} title @param {string} [sub] */
const subTitle = (ic, title, sub = '') =>
  `<div class="studio-sub-head"><span class="studio-sub-icon" aria-hidden="true">${icon(ic)}</span><div class="grow"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;

// ---------------------------------------------------------------------------------------------------------------------
// Themes, stall photo & colours
// ---------------------------------------------------------------------------------------------------------------------

/** Saved theme look + hero image. */
const currentLook = () => {
  const t = C().theme || {};
  const base = themeLook(themeById(t.themeId) || {theme: t});
  return {
    ...base,
    heroArt: Array.isArray(t.heroArt) && t.heroArt.length ? t.heroArt : base.heroArt,
    heroTint: TINT_IDS.includes(t.heroTint) ? t.heroTint : base.heroTint,
    heroPattern: PATTERN_IDS.includes(t.heroPattern) ? t.heroPattern : base.heroPattern,
    heroImage: t.heroImage || null,
  };
};

/** @param {'accent'|'secondary'} slot @param {string} value */
function swatchRow(slot, value) {
  const known = ACCENTS.includes(value);
  const swatches = ACCENTS.map((hex, i) => {
    const on = hex === value;
    const name = ACCENT_NAMES[i] || hex;
    return `<button type="button" class="studio-swatch${on ? ' on' : ''}" id="studio-sw-${slot}-${i}" data-action="studio-accent" data-slot="${slot}" data-color="${hex}" aria-pressed="${on}" aria-label="${esc(name)}" title="${esc(name)}" style="--sw:${hex};--sw-on:${onColor(hex)}">${on ? icon('check') : ''}</button>`;
  }).join('');
  return `<div class="studio-swatches" role="group" aria-label="${slot === 'accent' ? 'Main colour' : 'Second colour'}">${swatches}
    <label class="studio-custom-color${known ? '' : ' on'}" for="studio-${slot}-custom" data-custom-slot="${slot}">
      <input type="color" id="studio-${slot}-custom" data-input="studio-color-custom" data-slot="${slot}" value="${esc(value.toLowerCase())}">
      <span><strong>Custom</strong><small data-look-hex="${slot}">${esc(value)}</small></span>
    </label>
  </div>`;
}

/** Live preview of the two colours on a mini Sell hero. @param {{accent: string, secondary: string}} lk */
function lookPreview(lk) {
  const look = currentLook();
  return `<div class="studio-look-preview" data-look-preview style="--pv:${esc(lk.accent)};--pv-on:${onColor(lk.accent)};--pv2:${esc(lk.secondary)};--pv2-on:${onColor(lk.secondary)}">
    <span class="studio-preview-label">${icon('eye')} Preview</span>
    <div class="studio-lp-hero">
      <span class="studio-lp-blob" aria-hidden="true"></span>
      ${heroBox(look, {cls: 'studio-lp-art'})}
    </div>
    <div class="studio-lp-row">
      <span class="studio-lp-chip">${icon('fire')} Top sellers</span>
      <span class="studio-lp-badge">PROFIT MODE</span>
    </div>
    <span class="studio-lp-btn">${icon('cart')} Review &amp; pay</span>
  </div>`;
}

function photoPanel() {
  const look = currentLook();
  const has = !!look.heroImage;
  return `<div class="studio-subpanel studio-photo" id="studio-photo">
    ${subTitle('image', 'Stall photo', 'A real photo of your stall replaces the illustration on Sell.')}
    ${errorSlot('photo')}
    <div class="studio-photo-frame" data-photo-frame>${heroBox(look, {cls: 'studio-photo-hero', alt: 'Your stall photo'})}
      <span class="studio-photo-tag">${has ? `${icon('image')} Your photo` : `${icon('spark')} Theme art`}</span></div>
    <div class="studio-photo-actions">
      <label class="studio-upload" for="studio-photo-input">${icon('upload')}<span>${has ? 'Change photo' : 'Upload stall photo'}</span>
        <input type="file" id="studio-photo-input" class="sr-only" accept="image/*" data-change="studio-photo"></label>
      ${has ? btn(`${icon('trash')} Remove photo`, 'studio-photo-remove', 'quiet-outline studio-photo-remove') : ''}
    </div>
    <p class="footnote" data-photo-status>Shrunk to 1600 px, saved on this device only. Works offline.</p>
  </div>`;
}

function lookPanel() {
  const lk = view.look();
  return `<div class="studio-subpanel studio-look" id="studio-look">
    ${subTitle('palette', 'Colours', 'Tweak the theme’s two colours. Text flips between ink and cream so it stays readable in the sun.')}
    ${errorSlot('look')}
    <div class="studio-look-grid">
      <div class="studio-look-pick">
        <span class="field-label">Main colour <small class="muted">· buttons, nav, badges</small></span>
        ${swatchRow('accent', lk.accent)}
        <span class="field-label">Second colour <small class="muted">· hero blobs, chips, highlights</small></span>
        ${swatchRow('secondary', lk.secondary)}
      </div>
      ${lookPreview(lk)}
    </div>
    ${footHtml('look', 'studio-save-look', 'Save colours')}
  </div>`;
}

function themesSection() {
  const c = C();
  return section(
    'themes',
    `<div class="studio-theme-grid" role="list" aria-label="Stall themes">${themeCards({mode: 'button', current: c.theme?.themeId || ''})}</div>
    <p class="footnote studio-theme-note">${icon('info')} Tap a theme to preview it. Its look applies right away; its starter menu only if you tick the box.</p>
    <div class="studio-theme-tools">
      ${lookPanel()}
      ${photoPanel()}
    </div>`,
  );
}

function updateLookPreview() {
  const lk = view.look();
  const pv = /** @type {HTMLElement|null} */ (document.querySelector('[data-look-preview]'));
  if (pv) {
    pv.style.setProperty('--pv', lk.accent);
    pv.style.setProperty('--pv-on', onColor(lk.accent));
    pv.style.setProperty('--pv2', lk.secondary);
    pv.style.setProperty('--pv2-on', onColor(lk.secondary));
  }
  for (const slot of /** @type {const} */ (['accent', 'secondary'])) {
    const value = lk[slot];
    const hex = document.querySelector(`[data-look-hex="${slot}"]`);
    if (hex) hex.textContent = value;
    document.querySelectorAll(`.studio-swatch[data-slot="${slot}"]`).forEach(sw => {
      const on = /** @type {HTMLElement} */ (sw).dataset.color === value;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', String(on));
      sw.innerHTML = on ? icon('check') : '';
    });
    document.querySelector(`[data-custom-slot="${slot}"]`)?.classList.toggle('on', !ACCENTS.includes(value));
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`studio-${slot}-custom`));
    if (input && document.activeElement !== input) input.value = value.toLowerCase();
  }
}

/** Apply-theme sheet: look always; starter menu only when ticked. @param {string} id */
function themeSheet(id) {
  const t = themeById(id);
  if (!t) throw Error('That theme isn’t available.');
  const c = C();
  const look = themeLook(t);
  const photo = c.theme?.heroImage;
  const isCurrent = c.theme?.themeId === t.id;
  openSheet(
    `${esc(t.emoji)} ${esc(t.name)}`,
    `<form id="studio-theme-form" class="studio-theme-sheet" data-submit="studio-theme-apply" data-id="${esc(t.id)}" novalidate>
      <div class="studio-ts-hero" style="--tpl:${esc(look.accent)};--tpl2:${esc(look.secondary)}">
        ${heroBox(look, {cls: 'studio-ts-art'})}
        ${paletteDots(look.accent, look.secondary)}
      </div>
      <p class="studio-ts-desc">${esc(t.tagline || '')}${t.description ? ` <span class="muted">${esc(t.description)}</span>` : ''}</p>
      <div class="studio-ts-always">${icon('check')}<div><strong>Look</strong><span>Colours, hero art and background${isCurrent ? ' (already in use: re-applies the original colours)' : ''}.</span></div></div>
      ${photo ? `<p class="notice sky studio-ts-photo">${icon('image')}<span>Your stall photo stays on the hero. Remove it in Themes to show this art.</span></p>` : ''}
      <div class="studio-ts-options">
        ${check('studio-theme-menu', `<strong>Also load its starter menu</strong> <small class="muted">— replaces menu, categories, discounts, games, mission &amp; milestones. Sales history stays. Open carts are emptied.</small>`, false, 'id="studio-theme-menu" data-change="studio-theme-menu"')}
        <div class="studio-ts-prices" data-ts-prices hidden>
          ${check('studio-theme-prices', 'Include suggested prices <small class="muted">— untick to set every price yourself</small>', true, 'id="studio-theme-prices"')}
        </div>
      </div>
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('palette')} Apply theme`, 'studio-theme-apply', 'primary', `data-id="${esc(t.id)}"`),
    'studio-theme',
  );
}

/** Downscale a photo to ≤ max px (longest side) and re-encode as JPEG ≤ bytes. */
async function compressPhoto(/** @type {File} */ file, {max = 1600, bytes = 400 * 1024} = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw Error('Pick a photo (JPG, PNG or WebP).');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw Error('That photo couldn’t be opened. Try a JPG or PNG.');
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw Error('That photo couldn’t be opened. Try a JPG or PNG.');
    let scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('This browser can’t resize photos.');
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.86, 0.76, 0.66, 0.56, 0.46]) {
        const data = canvas.toDataURL('image/jpeg', q);
        const size = Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4);
        if (data.startsWith('data:image/jpeg') && size <= bytes) return data;
      }
      scale *= 0.75;
    }
    throw Error('That photo is too big even after shrinking. Try another one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------------------------------

const PROFILE_FIELDS = [
  {key: 'stallName', label: 'Stall name', max: LIMITS.stallName, ph: 'e.g. Chai Sutta Point', full: true},
  {key: 'booth', label: 'Booth / stall no.', max: LIMITS.booth, ph: 'Stall No. 10'},
  {key: 'eventName', label: 'Event', max: LIMITS.eventName, ph: 'Diwali Mela 2026'},
  {key: 'tagline', label: 'Hero tagline', max: LIMITS.tagline, ph: 'Kadak chai. Hot Maggi.', full: true},
  {key: 'subTagline', label: 'Hero sub-line', max: LIMITS.subTagline, ph: 'Good food. Fast orders.', full: true},
  {key: 'venue', label: 'Venue', max: LIMITS.venue, ph: 'College ground'},
  {key: 'city', label: 'City', max: LIMITS.city, ph: 'Jabalpur'},
  {key: 'eventDate', label: 'Event date', type: 'date'},
  {key: 'ownerName', label: 'Owner / team name', max: LIMITS.ownerName, ph: 'Team Stall'},
  {key: 'initials', label: 'Avatar initials', max: LIMITS.initials, ph: 'Auto', hint: 'Up to 3 letters. Blank = from the owner name.'},
];

function profilePreview(/** @type {Record<string, string>} */ p) {
  const v = previewParts(p);
  return `<div class="studio-preview" aria-label="Live preview">
    <span class="studio-preview-label">${icon('eye')} Live preview</span>
    <div class="studio-pv-top">
      <span class="studio-pv-mark" aria-hidden="true">${BRAND.short}</span>
      <div class="grow studio-pv-info"><strong data-pv="title">${esc(v.title)}</strong><small data-pv="sub"${v.sub ? '' : ' hidden'}>${esc(v.sub)}</small></div>
      <span class="studio-pv-avatar" data-pv="initials">${esc(v.initials)}</span>
    </div>
    <div class="studio-pv-hero">
      <span class="eyebrow">Sell screen</span>
      <h3 data-pv="tagline"${v.tagline ? '' : ' hidden'}>${esc(v.tagline)}</h3>
      <p data-pv="subTagline"${v.subTagline ? '' : ' hidden'}>${esc(v.subTagline)}</p>
      <span class="studio-pv-cta" aria-hidden="true">${icon('cart')} Review &amp; pay</span>
    </div>
  </div>`;
}

function updateProfilePreview() {
  const v = previewParts(view.profile());
  for (const key of ['title', 'sub', 'initials', 'tagline', 'subTagline']) {
    const el = /** @type {HTMLElement|null} */ (document.querySelector(`[data-pv="${key}"]`));
    if (!el) continue;
    el.textContent = v[key];
    if (key !== 'title' && key !== 'initials') el.hidden = !v[key];
  }
}

function profileSection() {
  const p = view.profile();
  const fields = PROFILE_FIELDS.map(f => {
    const extra = `data-input="studio-profile" data-key="${f.key}"${f.max ? ` maxlength="${f.max}"` : ''}${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${
      f.key === 'stallName' ? ' required autocomplete="organization"' : ' autocomplete="off"'}${f.key === 'initials' ? ' autocapitalize="characters"' : ''}`;
    const html = field(esc(f.label), `studio-p-${f.key}`, p[f.key] ?? '', f.type || 'text', extra, f.hint ? esc(f.hint) : '');
    return f.full ? `<div class="full">${html}</div>` : html;
  }).join('');
  return section(
    'profile',
    `<div class="studio-split">
      <form class="form-grid studio-form" id="studio-form-profile" data-submit="studio-save-profile" novalidate>${fields}</form>
      <div class="studio-side">${profilePreview(p)}</div>
    </div>`,
    {save: 'studio-save-profile', saveLabel: 'Save profile', draftable: true},
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// UPI
// ---------------------------------------------------------------------------------------------------------------------

/** QR card markup for the current UPI draft. */
function upiQr() {
  const u = view.upi();
  const id = String(u.id || '').trim();
  if (!id) {
    return `<div class="studio-qr-empty">${icon('qr')}<strong>No UPI ID yet</strong><span>Add yours to see a test QR. Without it, checkout still records UPI — you just show your own QR.</span></div>`;
  }
  if (!UPI_RE.test(id)) {
    return `<div class="studio-qr-empty warn">${icon('alert')}<strong>Check the UPI ID</strong><span>It should look like <b>name@okaxis</b> or <b>98765xxxxx@ybl</b>.</span></div>`;
  }
  try {
    const cfg = {...C(), upi: {id, payeeName: String(u.payeeName || '').trim()}};
    const uri = upiUri(cfg, 100, 'Test');
    const payee = cfg.upi.payeeName || cfg.profile.stallName;
    return `<div class="studio-qr" data-test-qr>${qrSvg(uri || '', {label: 'Test UPI QR for ₹1'})}</div>
      <div class="studio-qr-caption"><strong>Test QR · ₹1</strong><span>Scan to check the name shows <b>${esc(payee)}</b> — don’t pay.</span></div>`;
  } catch (err) {
    return `<div class="studio-qr-empty warn">${icon('alert')}<strong>Can’t draw this QR</strong><span>${esc(messageOf(err))}</span></div>`;
  }
}

function upiSection() {
  const u = view.upi();
  const id = String(u.id || '').trim();
  const bad = !!id && !UPI_RE.test(id);
  return section(
    'upi',
    `<div class="studio-split">
      <form class="studio-form" id="studio-form-upi" data-submit="studio-save-upi" novalidate>
        ${field('UPI ID', 'studio-upi-id', u.id, 'text',
          `data-input="studio-upi" data-key="id" maxlength="${LIMITS.upiId}" placeholder="yourname@okaxis" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="email"${bad ? ' aria-invalid="true"' : ''}`,
          'Leave blank to turn the checkout QR off.')}
        ${field('Payee name', 'studio-upi-payee', u.payeeName, 'text',
          `data-input="studio-upi" data-key="payeeName" maxlength="${LIMITS.payeeName}" placeholder="${esc(C().profile.stallName)}" autocomplete="off"`,
          'Shown in the customer’s UPI app. Blank = your stall name.')}
        <div class="notice sky studio-honest">${icon('info')}<div><strong>MYS never sees your bank.</strong> It only draws the QR. Always check the money landed in your UPI app before you hand over the order.</div></div>
      </form>
      <div class="studio-side"><div class="studio-qr-card" data-upi-qr>${upiQr()}</div></div>
    </div>`,
    {save: 'studio-save-upi', saveLabel: 'Save UPI', draftable: true},
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------------------------------------------------

/** @param {{type: string, value: number}} d */
const discountValue = d => (d.type === 'percent' ? `${d.value}% off` : `${money(d.value)} off`);

function discountsSection() {
  const c = C();
  const list = c.discounts;
  const rows = list.length
    ? list.map((d, i) => `<div class="studio-row studio-disc-row${d.active ? '' : ' off'}" data-disc="${esc(d.id)}">
        <span class="studio-disc-value">${esc(discountValue(d))}</span>
        <div class="grow studio-row-main"><h3>${esc(d.label)}</h3><small>${d.minimum ? `On orders of ${esc(money(d.minimum))}+` : 'Any order'}${d.active ? '' : ' · hidden at checkout'}</small></div>
        <div class="studio-row-tools">
          ${toggle('studio-disc-active', d.active ? 'On' : 'Off', d.active, `data-id="${esc(d.id)}" aria-label="${esc(d.label)}: ${d.active ? 'on — tap to hide at checkout' : 'off — tap to show at checkout'}"`)}
          ${btn(icon('up'), 'studio-disc-move', 'quiet icon-btn small', `data-id="${esc(d.id)}" data-dir="-1" aria-label="Move ${esc(d.label)} up"${i === 0 ? ' disabled' : ''}`)}
          ${btn(icon('down'), 'studio-disc-move', 'quiet icon-btn small', `data-id="${esc(d.id)}" data-dir="1" aria-label="Move ${esc(d.label)} down"${i === list.length - 1 ? ' disabled' : ''}`)}
          ${btn(icon('edit'), 'studio-disc-edit', 'icon-btn small', `data-id="${esc(d.id)}" aria-label="Edit ${esc(d.label)}"`)}
          ${btn(icon('trash'), 'studio-disc-delete', 'icon-btn small studio-danger-btn', `data-id="${esc(d.id)}" aria-label="Delete ${esc(d.label)}"`)}
        </div>
      </div>`).join('')
    : emptyState('percent', 'No discounts yet', 'Add a “Reel story? ₹10 off” and watch the crowd post.');
  const full = list.length >= CATALOG_LIMITS.discounts;
  return section(
    'discounts',
    `<div class="studio-list">${rows}</div>
    <div class="studio-list-foot">
      ${btn(`${icon('plus')} Add discount`, 'studio-disc-edit', 'yellow', full ? 'disabled' : '')}
      <div class="studio-custom-toggle">${toggle('studio-custom-toggle', 'Allow custom discount at checkout', c.allowCustomDiscount, 'id="studio-custom-discount"')}
        <small>Lets the cashier type any ₹ or % off for one order.</small></div>
    </div>`,
  );
}

/** @param {string} [id] */
function discountSheet(id = '') {
  const d = C().discounts.find(x => x.id === id) || null;
  const type = d?.type || 'flat';
  const radio = (/** @type {string} */ value, /** @type {string} */ label) =>
    `<label class="choice"><input type="radio" name="studio-disc-type" value="${value}"${type === value ? ' checked' : ''}><span>${label}</span></label>`;
  openSheet(
    d ? 'Edit discount' : 'New discount',
    `<form id="studio-disc-form" class="studio-sheet-form" data-submit="studio-disc-save" data-id="${esc(d?.id || '')}" novalidate>
      ${field('Label at checkout', 'studio-disc-label', d?.label || '', 'text', `maxlength="${LIMITS.discountLabel}" placeholder="Reel story? ₹10 off" autocomplete="off" autofocus`)}
      <div class="field"><span class="field-label">Type</span><div class="choices studio-choices" role="radiogroup" aria-label="Discount type">${radio('flat', '₹ off')}${radio('percent', '% off')}</div></div>
      <div class="form-grid">
        ${field('Amount off (₹ or %)', 'studio-disc-value', d ? (d.type === 'percent' ? String(d.value) : rupees(d.value)) : '', 'text', 'inputmode="decimal" placeholder="10" autocomplete="off"', '₹ amount, or a whole percent 1–100.')}
        ${field('Minimum order ₹', 'studio-disc-min', d?.minimum ? rupees(d.minimum) : '', 'text', 'inputmode="decimal" placeholder="0 = any order" autocomplete="off"')}
      </div>
      ${check('studio-disc-on', 'Show this chip at checkout', d ? d.active : true, 'id="studio-disc-on"')}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} ${d ? 'Save discount' : 'Add discount'}`, 'studio-disc-save', 'primary'),
    'studio-discount',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------------------------------------------------

const MISSION_MODES_UI = [
  {id: 'ledger', label: 'From my bills', badge: 'Recommended', line: 'Break-even = every bill you add in Expenses. No guessing — it moves as you spend.'},
  {id: 'total', label: 'One total amount', badge: '', line: 'Type one number for everything you spent up front. Bills you add later go on top.'},
  {id: 'itemized', label: 'Planned list', badge: '', line: 'List planned costs — rent, raw material, plates. Bills you add later go on top.'},
];

/** Σ of the itemized draft amounts (invalid ones skipped), and whether any were invalid. */
function missionSum() {
  let sum = 0;
  let bad = false;
  for (const it of view.mission().items) {
    const s = String(it.amount ?? '').trim();
    if (!s) continue;
    try {
      sum += paise(s);
    } catch {
      bad = true;
    }
  }
  return {sum, bad};
}

/** Planned investment of the draft (0 in ledger mode). */
function missionPlanned() {
  const m = view.mission();
  if (m.mode === 'ledger') return 0;
  if (m.mode === 'total') {
    try {
      return String(m.total).trim() ? paise(m.total) : 0;
    } catch {
      return 0;
    }
  }
  return missionSum().sum;
}

/** Bills recorded in the ledger, cached at render so typing never re-runs report(). */
let missionBills = 0;

/** @param {any} m @param {boolean} ledger */
function missionItems(m, ledger) {
  const used = new Set(m.items.map((/** @type {any} */ i) => i.label.trim().toLowerCase()));
  const quick = MISSION_SUGGESTIONS.filter(s => !used.has(s.toLowerCase()));
  const rows = m.items.map((/** @type {any} */ it) => `<div class="studio-mi-row" data-mi="${esc(it.id)}">
      <div class="field studio-mi-label"><label for="studio-mi-label-${esc(it.id)}" class="sr-only">${ledger ? 'Bill name' : 'Cost name'}</label>
        <input id="studio-mi-label-${esc(it.id)}" type="text" value="${esc(it.label)}" list="studio-mission-suggest" maxlength="${LIMITS.missionLabel}" placeholder="${ledger ? 'Gas refill' : 'Stall rent'}" data-input="studio-mission-item" data-id="${esc(it.id)}" data-key="label" autocomplete="off"></div>
      <div class="field studio-mi-amount"><label for="studio-mi-amt-${esc(it.id)}" class="sr-only">${ledger ? 'Usual amount in rupees' : 'Amount in rupees'}</label>
        <span class="studio-rupee" aria-hidden="true">₹</span><input id="studio-mi-amt-${esc(it.id)}" type="text" inputmode="decimal" value="${esc(it.amount)}" placeholder="0" data-input="studio-mission-item" data-id="${esc(it.id)}" data-key="amount" autocomplete="off"></div>
      ${btn(icon('trash'), 'studio-mission-remove', 'quiet icon-btn studio-mi-remove', `data-id="${esc(it.id)}" aria-label="Remove ${esc(it.label || 'this cost')}"`)}
    </div>`).join('');
  const {sum, bad} = missionSum();
  const empty = ledger ? 'No suggestions yet — add the bills you usually pay (gas, ice, plates…).' : 'No costs yet — add stall rent, raw materials, plates…';
  return `${ledger ? `<div class="studio-mi-head"><strong>Suggested bills</strong><small class="muted">Quick-add chips on the Bills screen. Amounts are only a hint — they don’t count until you add the bill.</small></div>` : ''}
    <div class="studio-mi-list">${rows || `<p class="muted studio-mi-empty">${empty}</p>`}</div>
    <datalist id="studio-mission-suggest">${MISSION_SUGGESTIONS.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
    <div class="studio-mi-actions">
      ${btn(`${icon('plus')} ${ledger ? 'Add suggestion' : 'Add cost'}`, 'studio-mission-add', 'small yellow', m.items.length >= CATALOG_LIMITS.missionItems ? 'disabled' : '')}
      ${quick.slice(0, 4).map(s => btn(`${icon('plus')} ${esc(s)}`, 'studio-mission-add', 'chip studio-mi-quick', `data-label="${esc(s)}"`)).join('')}
    </div>
    ${ledger ? '' : `<div class="studio-mi-sum"><span>Planned total</span><strong data-mission-sum>${esc(money(sum))}</strong></div>`}
    <p class="studio-mi-bad muted" data-mission-bad${bad ? '' : ' hidden'}>${icon('alert')} Some amounts aren’t numbers yet — they’re left out.</p>`;
}

function missionSection() {
  const m = view.mission();
  const r = report(S(), C()).mission;
  const bills = Number.isSafeInteger(r.bills) ? r.bills : r.extraExpenses;
  missionBills = bills;
  const mode = MISSION_MODES_UI.some(x => x.id === m.mode) ? m.mode : 'itemized';
  const meta = MISSION_MODES_UI.find(x => x.id === mode);
  const ledger = mode === 'ledger';
  const segments = MISSION_MODES_UI.map(x => btn(
    `<span>${esc(x.label)}</span>${x.badge ? `<small class="studio-mm-badge">${esc(x.badge)}</small>` : ''}`,
    'studio-mission-mode', '', `id="studio-mm-${x.id}" data-mode="${x.id}" aria-pressed="${x.id === mode}"`,
  )).join('');
  const billsCard = `<div class="studio-bills-card">
      <span class="studio-bills-icon" aria-hidden="true">${icon('receipt')}</span>
      <div class="grow"><small>Bills recorded so far</small><strong data-mission-bills>${esc(money(bills))}</strong></div>
      <div class="studio-bills-actions">
        ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'small yellow')}
        ${btn(`Open bills ${icon('chevron-right')}`, 'money-open', 'small quiet-outline', 'data-tab="bills"')}
      </div>
    </div>`;
  const total = field('Total investment ₹', 'studio-mission-total', m.total, 'text', 'inputmode="decimal" placeholder="5000" autocomplete="off" data-input="studio-mission-total"', 'Everything you spent to set up the stall.');
  const planned = missionPlanned();
  return section(
    'mission',
    `<div class="studio-split">
      <div class="studio-mission-main">
        <div class="segmented block studio-mission-mode" role="group" aria-label="How to work out break-even">${segments}</div>
        <p class="studio-mm-line" data-mission-line>${icon('info')}<span>${esc(meta?.line || '')}</span></p>
        ${ledger ? billsCard : ''}
        <form class="studio-form studio-mission-form" id="studio-form-mission" data-submit="studio-save-mission" novalidate>${mode === 'total' ? total : missionItems(m, ledger)}</form>
      </div>
      <div class="studio-side">
        <div class="studio-be">
          <span class="eyebrow">Break-even</span>
          ${ledger ? '' : `<div class="studio-be-line"><span>Planned</span><strong data-mission-investment>${esc(money(planned))}</strong></div>`}
          <div class="studio-be-line"><span>${ledger ? 'Bills recorded' : 'Bills on top'}</span><strong>${esc(money(bills))}</strong></div>
          <div class="studio-be-line total"><span>Break-even target</span><strong data-mission-target>${esc(money(planned + bills))}</strong></div>
          <p class="footnote">${ledger
            ? 'Every bill you add on the Expenses screen raises the target the moment you save it. Voided bills never count.'
            : 'Bills you add on the Expenses screen during the event go on top, so break-even rises with them.'} Sales collected so far: ${esc(money(r.collected))}.</p>
        </div>
      </div>
    </div>`,
    {save: 'studio-save-mission', saveLabel: 'Save mission', draftable: true},
  );
}

function updateMissionNumbers() {
  const {sum, bad} = missionSum();
  const planned = missionPlanned();
  const set = (/** @type {string} */ sel, /** @type {string} */ text) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  };
  set('[data-mission-sum]', money(sum));
  set('[data-mission-investment]', money(planned));
  set('[data-mission-target]', money(planned + missionBills));
  const badEl = /** @type {HTMLElement|null} */ (document.querySelector('[data-mission-bad]'));
  if (badEl) badEl.hidden = !bad;
}

// ---------------------------------------------------------------------------------------------------------------------
// Team: partners & split, cashiers, kitchen
// ---------------------------------------------------------------------------------------------------------------------

/** Σ of the custom share draft and whether every value is a whole 0–100. */
function sharesState() {
  const vals = view.shares();
  let sum = 0;
  let ok = true;
  for (const m of members()) {
    const raw = String(vals[m.id] ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      ok = false;
      continue;
    }
    sum += n;
  }
  return {sum, ok, valid: ok && sum === 100};
}

/** @param {{sum: number, ok: boolean, valid: boolean}} st */
function sharesMessage(st) {
  if (!st.ok) return `${icon('alert')} Use whole numbers from 0 to 100.`;
  if (st.valid) return `${icon('check')} Adds up to 100%. Nice.`;
  return st.sum < 100
    ? `${icon('alert')} Adds up to ${st.sum}% — ${100 - st.sum}% still to give.`
    : `${icon('alert')} Adds up to ${st.sum}% — ${st.sum - 100}% too many.`;
}

function partnersPanel() {
  const list = members();
  const mode = splitMode();
  const eq = equalShares(list.length);
  const shares = view.shares();
  const rows = list.map((m, i) => {
    const share = mode === 'custom'
      ? `<div class="field studio-share-field"><label for="studio-share-${esc(m.id)}" class="sr-only">${esc(m.name)}’s share in percent</label>
          <input id="studio-share-${esc(m.id)}" type="text" inputmode="numeric" value="${esc(shares[m.id] ?? '')}" placeholder="0" maxlength="3" data-input="studio-share" data-id="${esc(m.id)}" autocomplete="off"><span class="studio-share-pct" aria-hidden="true">%</span></div>`
      : `<span class="studio-share-chip" title="Equal split">${eq[i]}%</span>`;
    return `<div class="studio-member" data-member="${esc(m.id)}">
        <span class="studio-member-avatar tint-${TINT_IDS.includes(m.color) ? m.color : 'cream'}" aria-hidden="true">${esc(initialsOf(m.name) || '?')}</span>
        <div class="grow studio-member-main"><strong>${esc(m.name)}</strong><small>${esc(TINTS.find(t => t.id === m.color)?.label || 'No colour')}</small></div>
        ${share}
        <div class="studio-row-tools">
          ${btn(icon('edit'), 'studio-member-edit', 'icon-btn small', `data-id="${esc(m.id)}" aria-label="Rename or recolour ${esc(m.name)}"`)}
          ${btn(icon('trash'), 'studio-member-remove', 'icon-btn small studio-danger-btn', `data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}"`)}
        </div>
      </div>`;
  }).join('');
  const st = sharesState();
  const full = list.length >= CATALOG_LIMITS.members;
  const split = list.length
    ? `<div class="studio-split-mode">
        <span class="field-label">Profit split</span>
        <div class="segmented studio-split-seg" role="group" aria-label="Profit split">
          ${btn(`${icon('users')} Equal`, 'studio-split-mode', '', `data-mode="equal" aria-pressed="${mode === 'equal'}"`)}
          ${btn(`${icon('percent')} Custom %`, 'studio-split-mode', '', `data-mode="custom" aria-pressed="${mode === 'custom'}"`)}
        </div>
      </div>
      ${mode === 'custom' ? `<div class="studio-shares-foot">
        <p class="studio-shares-sum${st.valid ? ' ok' : ''}" data-share-sum role="status">${sharesMessage(st)}</p>
        <span class="studio-dirty" data-dirty="shares"${isDirty('shares') ? '' : ' hidden'}>${icon('edit')} Unsaved</span>
        ${btn(`${icon('check')} Save shares`, 'studio-save-shares', 'primary small')}
      </div>` : ''}`
    : '';
  return `<div class="studio-subpanel studio-partners" id="studio-partners">
    ${subTitle('users', 'Partners', 'Friends who put money in. The Settlement pays back what each put in, then splits the profit.')}
    ${errorSlot('shares')}
    ${list.length ? `<div class="studio-member-list">${rows}</div>` : emptyState('users', 'No partners yet', 'Add everyone who chipped in — even ₹500 counts. Then the payout maths is fair and instant.')}
    <div class="studio-partner-actions">
      ${btn(`${icon('plus')} Add partner`, 'studio-member-edit', 'yellow', full ? 'disabled' : '')}
      ${btn(`${icon('wallet')} Team contri ${icon('chevron-right')}`, 'money-open', 'quiet-outline', 'data-tab="team"')}
    </div>
    ${split}
    <p class="footnote">A fair-split helper, not accounting or tax advice. UPI money lands in whoever’s UPI account it was paid to.</p>
  </div>`;
}

function crewPanel() {
  const t = view.team();
  const c = C();
  const cur = currentKey(t);
  const rows = t.rows.map((r, i) => `<div class="studio-op-row">
      <label class="studio-op-current" title="On the counter now">
        <input type="radio" name="studio-op-current" value="${esc(r.key)}" data-change="studio-op-current"${r.key === cur ? ' checked' : ''} aria-label="${esc(r.name || `Member ${i + 1}`)} is on the counter">
        <span>${esc(initialsOf(r.name) || '?')}</span>
      </label>
      <div class="field grow"><label for="studio-op-${esc(r.key)}" class="sr-only">Cashier ${i + 1}</label>
        <input id="studio-op-${esc(r.key)}" type="text" value="${esc(r.name)}" maxlength="${LIMITS.operator}" placeholder="Name" data-input="studio-op-name" data-key="${esc(r.key)}" autocomplete="off"></div>
      ${btn(icon('trash'), 'studio-op-remove', 'quiet icon-btn', `data-key="${esc(r.key)}" aria-label="Remove ${esc(r.name || 'this cashier')}"${t.rows.length <= 1 ? ' disabled' : ''}`)}
    </div>`).join('');
  const hasPartners = members().length > 0;
  return `<div class="studio-subpanel studio-crew" id="studio-crew">
    ${subTitle('user', 'Counter crew', 'Cashiers who take orders. Every order is stamped with their name.')}
    ${errorSlot('team')}
    <div class="studio-crew-grid">
      <form class="studio-form" id="studio-form-team" data-submit="studio-save-team" novalidate>
        <span class="field-label">Cashiers <small class="muted">· tap a badge to pick who’s on the counter (green)</small></span>
        <div class="studio-op-list">${rows}</div>
        <div class="studio-crew-actions">
          ${btn(`${icon('plus')} Add cashier`, 'studio-op-add', 'small yellow', t.rows.length >= CATALOG_LIMITS.operators ? 'disabled' : '')}
          ${hasPartners ? btn(`${icon('copy')} Copy partners to cashiers`, 'studio-copy-partners', 'small quiet-outline') : ''}
        </div>
        <p class="footnote">Switching cashier needs no PIN; changing the list does.</p>
      </form>
      <div class="studio-kitchen">
        ${toggle('studio-kitchen-toggle', 'Kitchen queue', c.kitchenQueue, 'id="studio-kitchen"')}
        <p>${c.kitchenQueue
          ? 'On: new orders get a token and wait in <b>Preparing</b> until you mark them ready.'
          : 'Off: orders are handed over straight away — best for grab-and-go counters.'}</p>
        <small>Saves instantly.</small>
      </div>
    </div>
    ${footHtml('team', 'studio-save-team', 'Save cashiers')}
  </div>`;
}

function teamSection() {
  return section('team', `<div class="studio-team-stack">${partnersPanel()}${crewPanel()}</div>`);
}

/** Add / edit partner sheet. @param {string} [id] */
function memberSheet(id = '') {
  const m = members().find(x => x.id === id) || null;
  const used = new Set(members().filter(x => x.id !== id).map(x => x.color));
  const color = m?.color || TINT_IDS.find(t => !used.has(t)) || TINT_IDS[0];
  const swatches = TINTS.map(t => `<label class="studio-tint-choice" title="${esc(t.label)}">
      <input type="radio" name="studio-member-color" value="${esc(t.id)}"${t.id === color ? ' checked' : ''}>
      <span class="studio-tint-dot" style="--dot:${esc(t.hex)}" aria-hidden="true">${icon('check')}</span>
      <span class="studio-tint-name">${esc(t.label)}</span>
    </label>`).join('');
  openSheet(
    m ? `Edit ${esc(m.name)}` : 'New partner',
    `<form id="studio-member-form" class="studio-sheet-form" data-submit="studio-member-save" data-id="${esc(m?.id || '')}" novalidate>
      ${field('Name', 'studio-member-name', m?.name || '', 'text', `maxlength="${LIMITS.memberName || 40}" placeholder="e.g. Aarav" autocomplete="off" autofocus`)}
      <div class="field"><span class="field-label">Colour <small class="muted">· shows on bills, contri and the payout card</small></span>
        <div class="studio-tint-choices" role="radiogroup" aria-label="Partner colour">${swatches}</div></div>
      ${m ? '<p class="footnote">Renaming keeps every bill and contri credited to them.</p>' : ''}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} ${m ? 'Save partner' : 'Add partner'}`, 'studio-member-save', 'primary'),
    'studio-member',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------------------------------

const GAME_ART = () => lib.ART_LIST.filter(a => a.group === 'games');

function gamesSection() {
  const games = C().games;
  const cards = games.length
    ? `<div class="studio-games">${games.map(g => `<article class="studio-game">
        ${artFrame({art: g.art, tint: 'lavender', pattern: 'dots'}, {size: 'sm'})}
        <div class="grow studio-row-main"><h3>${esc(g.name)}</h3><span class="badge ${g.fee ? 'lime' : 'sky'}">${g.fee ? esc(money(g.fee)) : 'FREE'}</span></div>
        <div class="studio-row-tools">
          ${btn(icon('edit'), 'studio-game-edit', 'icon-btn small', `data-id="${esc(g.id)}" aria-label="Edit ${esc(g.name)}"`)}
          ${btn(icon('trash'), 'studio-game-delete', 'icon-btn small studio-danger-btn', `data-id="${esc(g.id)}" aria-label="Delete ${esc(g.name)}"`)}
        </div>
      </article>`).join('')}</div>`
    : emptyState('game', 'No games yet', 'Ring toss, spin the wheel, lucky cup — add one and record plays from the Game corner.');
  return section(
    'games',
    `${cards}
    <div class="studio-list-foot">
      ${btn(`${icon('plus')} Add game`, 'studio-game-edit', 'yellow', games.length >= CATALOG_LIMITS.games ? 'disabled' : '')}
      ${games.length ? btn(`${icon('game')} Open game corner`, 'games-open', 'quiet-outline') : ''}
    </div>`,
  );
}

/** @param {string} [id] */
function gameSheet(id = '') {
  const g = C().games.find(x => x.id === id) || null;
  const art = g?.art || 'spin-wheel';
  const choices = GAME_ART().map(a => `<label class="studio-art-choice" title="${esc(a.label)}">
      <input type="radio" name="studio-game-art" value="${esc(a.id)}"${a.id === art ? ' checked' : ''}>
      ${artFrame({art: a.id, tint: 'lavender', pattern: 'none'}, {size: 'sm'})}
      <span>${esc(a.label)}</span>
    </label>`).join('');
  openSheet(
    g ? 'Edit game' : 'New game',
    `<form id="studio-game-form" class="studio-sheet-form" data-submit="studio-game-save" data-id="${esc(g?.id || '')}" novalidate>
      <div class="form-grid">
        ${field('Game name', 'studio-game-name', g?.name || '', 'text', `maxlength="${LIMITS.gameName}" placeholder="Ring Toss" autocomplete="off" autofocus`)}
        ${field('Fee per play ₹', 'studio-game-fee', g?.fee ? rupees(g.fee) : '', 'text', 'inputmode="decimal" placeholder="0 = free" autocomplete="off"', 'Blank or 0 makes it free.')}
      </div>
      <div class="field"><span class="field-label">Picture</span><div class="studio-art-choices" role="radiogroup" aria-label="Game picture">${choices}</div></div>
      ${g ? '<p class="footnote">Plays already recorded keep their old name and fee.</p>' : ''}
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} ${g ? 'Save game' : 'Add game'}`, 'studio-game-save', 'primary'),
    'studio-game',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function chips() {
  return `<nav class="studio-chips" aria-label="Studio sections">${STUDIO_SECTIONS.map(s => {
    const on = s.id === activeSection;
    return `<button type="button" class="chip${on ? ' active' : ''}" data-action="studio-jump" data-section="${s.id}"${on ? ' aria-current="true"' : ''}>${icon(s.icon)}${esc(s.label)}</button>`;
  }).join('')}</nav>`;
}

function studioScreen() {
  return `${heading('Customize My Stall', 'Theme, name, team and money goals — every section saves on its own.', btn(`${icon('spark')} Welcome tour`, 'onb-open', 'small quiet-outline'))}
  ${chips()}
  <div class="studio-sections">
    ${themesSection()}
    ${profileSection()}
    ${teamSection()}
    ${missionSection()}
    ${upiSection()}
    ${discountsSection()}
    ${gamesSection()}
  </div>`;
}

registerScreen('studio', studioScreen);

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Light up one chip (and keep it visible inside the scrolling chip bar). @param {string} sec */
function lightChip(sec) {
  const bar = document.querySelector('.studio-chips');
  if (!bar) return;
  bar.querySelectorAll('.chip').forEach(ch => {
    const on = /** @type {HTMLElement} */ (ch).dataset.section === sec;
    ch.classList.toggle('active', on);
    if (on) {
      ch.setAttribute('aria-current', 'true');
      const box = ch.getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      if (box.left < barBox.left || box.right > barBox.right) bar.scrollBy({left: box.left - barBox.left - 16});
    } else {
      ch.removeAttribute('aria-current');
    }
  });
}

/** Scroll a section into view and flash it briefly. @param {string} id */
function jumpTo(id) {
  const sec = resolveSection(id) || SECTION_IDS[0];
  activeSection = sec;
  lightChip(sec);
  const el = document.getElementById(`studio-${sec}`);
  if (!el) return;
  el.scrollIntoView({block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth'});
  el.classList.remove('studio-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('studio-flash');
  setTimeout(() => el.classList.remove('studio-flash'), 1800);
  lockChipUntil = Date.now() + 900;
}

// The chip of the section under the sticky bar lights up while scrolling (one passive listener, rAF-throttled).
let scrollQueued = false;
let lockChipUntil = 0;
function syncActiveChip() {
  scrollQueued = false;
  if (Date.now() < lockChipUntil) return;
  const bar = document.querySelector('.studio-chips');
  if (!bar) return;
  const line = bar.getBoundingClientRect().bottom + 24;
  let current = SECTION_IDS[0];
  for (const id of SECTION_IDS) {
    const el = document.getElementById(`studio-${id}`);
    if (el && el.getBoundingClientRect().top <= line) current = id;
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTION_IDS[SECTION_IDS.length - 1];
  if (current === activeSection) return;
  activeSection = current;
  lightChip(current);
}
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => {
    if (scrollQueued || !document.querySelector('.studio-chips')) return;
    scrollQueued = true;
    requestAnimationFrame(syncActiveChip);
  }, {passive: true});
}

// ---------------------------------------------------------------------------------------------------------------------
// Inputs & changes (drafts; no full render while typing)
// ---------------------------------------------------------------------------------------------------------------------

/** @param {'accent'|'secondary'} slot @param {string} hex */
function setLookColor(slot, hex) {
  const value = String(hex || '').toUpperCase();
  if (!HEX_RE.test(value)) return;
  draftOf('look')[slot] = value;
  updateLookPreview();
  touched('look');
}

registerInputs({
  'studio-profile': el => {
    draftOf('profile')[el.dataset.key] = el.value;
    updateProfilePreview();
    touched('profile');
  },
  'studio-color-custom': el => setLookColor(el.dataset.slot === 'secondary' ? 'secondary' : 'accent', el.value),
  'studio-upi': el => {
    draftOf('upi')[el.dataset.key] = el.value;
    const id = String(view.upi().id || '').trim();
    const input = document.getElementById('studio-upi-id');
    if (input) {
      if (id && !UPI_RE.test(id)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    const box = document.querySelector('[data-upi-qr]');
    if (box) box.innerHTML = upiQr();
    touched('upi');
  },
  'studio-mission-total': el => {
    draftOf('mission').total = el.value;
    updateMissionNumbers();
    touched('mission');
  },
  'studio-mission-item': el => {
    const item = draftOf('mission').items.find((/** @type {any} */ i) => i.id === el.dataset.id);
    if (!item) return;
    item[el.dataset.key] = el.value;
    if (el.dataset.key === 'amount') {
      let ok = true;
      try {
        if (el.value.trim()) paise(el.value);
      } catch {
        ok = false;
      }
      if (ok) el.removeAttribute('aria-invalid');
      else el.setAttribute('aria-invalid', 'true');
    }
    updateMissionNumbers();
    touched('mission');
  },
  'studio-op-name': el => {
    const row = draftOf('team').rows.find((/** @type {any} */ r) => r.key === el.dataset.key);
    if (row) row.name = el.value;
    touched('team');
  },
  'studio-share': el => {
    draftOf('shares')[el.dataset.id] = el.value;
    const raw = el.value.trim();
    const n = raw === '' ? 0 : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 100) el.removeAttribute('aria-invalid');
    else el.setAttribute('aria-invalid', 'true');
    const st = sharesState();
    const sum = document.querySelector('[data-share-sum]');
    if (sum) {
      sum.innerHTML = sharesMessage(st);
      sum.classList.toggle('ok', st.valid);
    }
    touched('shares');
  },
});

registerChanges({
  'studio-op-current': el => {
    draftOf('team').current = el.value;
    touched('team');
  },
  'studio-theme-menu': el => {
    const box = /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('[data-ts-prices]'));
    if (box) box.hidden = !el.checked;
  },
  'studio-photo': async el => {
    const input = /** @type {HTMLInputElement} */ (el);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const status = document.querySelector('[data-photo-status]');
    if (status) status.textContent = 'Shrinking your photo…';
    await guarded('photo', async () => {
      const data = await compressPhoto(file);
      const done = await requireAdmin(async () => {
        const ref = await saveImageDataUrl(data);
        await commitConfig(st => {
          saveTheme(st.config, {heroImage: ref});
          audit(st[st.mode], 'theme-photo', 'theme', st.config.operator, {photo: true});
        });
        return true;
      });
      if (status) status.textContent = 'Shrunk to 1600 px, saved on this device only. Works offline.';
      if (done) toast('Stall photo on! Check it out on Sell.');
    });
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------------

/** Read a field's value from the open sheet. @param {string} id */
const sheetVal = id => /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector(`#${id}`))?.value ?? '';
/** @param {string} id */
const sheetChecked = id => !!(/** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector(`#${id}`))?.checked);

registerActions(
  {
    'studio-open': (_el, ds) => {
      closeSheet();
      const sec = resolveSection(ds?.section);
      activeSection = sec || SECTION_IDS[0];
      navigate('studio');
      if (sec) requestAnimationFrame(() => jumpTo(sec));
    },
    'studio-jump': (_el, ds) => jumpTo(ds.section || SECTION_IDS[0]),
    'studio-discard': (_el, ds) => {
      const sec = ds.section || '';
      if (sec in drafts) drafts[sec] = null;
      delete errors[sec];
      render();
      toast('Changes discarded.');
    },

    // themes & look
    'studio-theme-pick': (_el, ds) => themeSheet(ds.id || ''),
    'studio-theme-apply': async (_el, ds) => {
      const id = ds.id || /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('#studio-theme-form'))?.dataset.id || '';
      const t = themeById(id);
      if (!t) throw Error('That theme isn’t available.');
      const menu = sheetChecked('studio-theme-menu');
      const withPrices = sheetChecked('studio-theme-prices');
      await commitConfig(st => applyTheme(st, id, {menu, withPrices}));
      drafts.look = null;
      if (menu) drafts.mission = null;
      closeSheet();
      render();
      toast(menu
        ? `${t.name} is on${withPrices ? '. Check the prices before you sell.' : '. Set your prices next.'}`
        : `${t.emoji} ${t.name} look is on. Your menu stays as it is.`);
    },
    'studio-photo-remove': async () => {
      await commitConfig(st => {
        saveTheme(st.config, {heroImage: null});
        audit(st[st.mode], 'theme-photo', 'theme', st.config.operator, {photo: false});
      });
      toast('Photo removed. The theme art is back.');
    },
    'studio-accent': (_el, ds) => setLookColor(ds.slot === 'secondary' ? 'secondary' : 'accent', ds.color || ''),
    'studio-save-look': () => guarded('look', async () => {
      const {accent, secondary} = draftOf('look');
      await commitConfig(st => saveTheme(st.config, {accent, secondary}));
      drafts.look = null;
      render();
      toast('New colours on. Looking sharp!');
    }),

    // profile
    'studio-save-profile': () => guarded('profile', async () => {
      const d = draftOf('profile');
      /** @type {Record<string, string>} */
      const data = {};
      for (const k of PROFILE_KEYS) data[k] = String(d[k] ?? '');
      await commitConfig(st => {
        saveProfile(st.config, data);
        audit(st[st.mode], 'profile-updated', 'profile', st.config.operator, {stallName: st.config.profile.stallName});
      });
      drafts.profile = null;
      render();
      toast(`Saved. Hello, ${C().profile.stallName}!`);
    }),

    // UPI
    'studio-save-upi': () => guarded('upi', async () => {
      const u = draftOf('upi');
      await commitConfig(st => {
        saveUpi(st.config, {id: String(u.id || ''), payeeName: String(u.payeeName || '')});
        audit(st[st.mode], 'upi-updated', 'upi', st.config.operator, {id: st.config.upi.id});
      });
      drafts.upi = null;
      render();
      toast(C().upi.id ? 'UPI saved. Checkout will show your QR.' : 'UPI QR turned off.');
    }),

    // discounts
    'studio-disc-edit': (_el, ds) => discountSheet(ds.id || ''),
    'studio-disc-save': async () => {
      const form = sheetEl()?.querySelector('#studio-disc-form');
      if (!form) return;
      const id = /** @type {HTMLElement} */ (form).dataset.id || '';
      const type = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="studio-disc-type"]:checked'))?.value || 'flat';
      const raw = sheetVal('studio-disc-value').trim().replace(/%$/, '').trim();
      if (!raw) throw Error(type === 'percent' ? 'Enter the percent off (1–100).' : 'Enter how many rupees to take off.');
      const value = type === 'percent' ? Number(raw) : parseRupees(raw, 'Amount off');
      const minimum = amountOrZero(sheetVal('studio-disc-min'), 'Minimum order');
      const active = sheetChecked('studio-disc-on');
      const data = {label: sheetVal('studio-disc-label'), type, value, minimum, active};
      const rule = await commitConfig(st => {
        const saved = saveDiscount(st.config, id ? {...data, id} : data);
        clearStaleDiscounts(st);
        audit(st[st.mode], 'discount-saved', saved.id, st.config.operator, {label: saved.label});
        return saved;
      });
      closeSheet();
      toast(`${rule.label} ${id ? 'updated' : 'added'}.`);
    },
    'studio-disc-active': async (_el, ds) => {
      await commitConfig(st => {
        const rule = st.config.discounts.find((/** @type {any} */ d) => d.id === ds.id);
        if (!rule) throw Error('That discount no longer exists.');
        saveDiscount(st.config, {id: rule.id, active: !rule.active});
        clearStaleDiscounts(st);
      });
    },
    'studio-disc-move': async (_el, ds) => {
      await commitConfig(st => moveDiscount(st.config, ds.id, ds.dir === '-1' ? -1 : 1));
    },
    'studio-disc-delete': (_el, ds) => {
      const rule = C().discounts.find(d => d.id === ds.id);
      if (!rule) throw Error('That discount no longer exists.');
      confirmSheet({
        title: 'Delete this discount?',
        body: `<p><strong>${esc(rule.label)}</strong> (${esc(discountValue(rule))}) leaves checkout. If it’s on a cart right now, it comes off that cart.</p><p class="muted">Past orders keep their discount record.</p>`,
        confirmLabel: 'Delete discount',
        danger: true,
        onConfirm: async () => {
          await commitConfig(st => {
            deleteDiscount(st.config, rule.id);
            clearStaleDiscounts(st);
            audit(st[st.mode], 'discount-deleted', rule.id, st.config.operator, {label: rule.label});
          });
          toast('Discount deleted.');
        },
      });
    },
    'studio-custom-toggle': async () => {
      await commitConfig(st => {
        setAllowCustomDiscount(st.config, !st.config.allowCustomDiscount);
        clearStaleDiscounts(st);
      });
      toast(C().allowCustomDiscount ? 'Custom discount chip is on at checkout.' : 'Custom discount chip is off.');
    },

    // mission
    'studio-mission-mode': (_el, ds) => {
      const mode = ds.mode === 'total' || ds.mode === 'ledger' ? ds.mode : 'itemized';
      draftOf('mission').mode = mode;
      render();
    },
    'studio-mission-add': (_el, ds) => {
      const m = draftOf('mission');
      if (m.items.length >= CATALOG_LIMITS.missionItems) throw Error(`You can have at most ${CATALOG_LIMITS.missionItems} costs.`);
      const id = newId();
      m.items.push({id, label: ds.label || '', amount: ''});
      render();
      const target = document.getElementById(ds.label ? `studio-mi-amt-${id}` : `studio-mi-label-${id}`);
      target?.focus();
    },
    'studio-mission-remove': (_el, ds) => {
      const m = draftOf('mission');
      m.items = m.items.filter((/** @type {any} */ i) => i.id !== ds.id);
      render();
    },
    'studio-save-mission': () => guarded('mission', async () => {
      const m = draftOf('mission');
      const total = amountOrZero(m.total, 'Total investment');
      const items = m.items
        .filter((/** @type {any} */ it) => String(it.label).trim() || String(it.amount).trim())
        .map((/** @type {any} */ it) => ({id: it.id, label: String(it.label), amount: amountOrZero(it.amount, String(it.label).trim() || 'Cost')}));
      await commitConfig(st => {
        saveMission(st.config, {mode: m.mode, total, items});
        refreshMilestones(st.live, st.config);
        refreshMilestones(st.demo, st.config);
      });
      drafts.mission = null;
      render();
      toast(C().mission.mode === 'ledger' ? 'Mission set: every bill now moves break-even.' : 'Mission locked in. Let’s win it back!');
    }),

    // partners & split
    'studio-member-edit': (_el, ds) => memberSheet(ds.id || ''),
    'studio-member-save': async () => {
      const form = sheetEl()?.querySelector('#studio-member-form');
      if (!form) return;
      const id = /** @type {HTMLElement} */ (form).dataset.id || '';
      const name = sheetVal('studio-member-name');
      const color = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="studio-member-color"]:checked'))?.value;
      const saved = await commitConfig(st => {
        if (id) {
          renameMember(st.config, id, name);
          if (color) setMemberColor(st.config, id, color);
          return st.config.team.members.find((/** @type {any} */ m) => m.id === id);
        }
        return addMember(st.config, color ? {name, color} : {name});
      });
      drafts.shares = null;
      closeSheet();
      toast(id ? `${saved.name} updated.` : `${saved.name} joined the team!`);
    },
    'studio-member-remove': (_el, ds) => {
      const m = members().find(x => x.id === ds.id);
      if (!m) throw Error('That partner is no longer on the team.');
      confirmSheet({
        title: `Remove ${esc(m.name)}?`,
        body: `<p><strong>${esc(m.name)}</strong> leaves the partner list and the profit split.</p><p class="muted">Partners with bills or contri recorded can’t be removed — rename them instead, or void those entries first.</p>`,
        confirmLabel: 'Remove partner',
        danger: true,
        onConfirm: async () => {
          await commitConfig(st => removeMember(st, m.id));
          drafts.shares = null;
          toast(`${m.name} removed.`);
        },
      });
    },
    'studio-split-mode': async (_el, ds) => {
      const mode = ds.mode === 'custom' ? 'custom' : 'equal';
      if (mode === splitMode()) return;
      await commitConfig(st => setSplitMode(st.config, mode));
      drafts.shares = null;
      toast(mode === 'custom' ? 'Custom split on. Set each partner’s %.' : 'Equal split on. Everyone gets the same share.');
    },
    'studio-save-shares': () => guarded('shares', async () => {
      const vals = view.shares();
      /** @type {Record<string, number>} */
      const shares = {};
      for (const m of members()) {
        const raw = String(vals[m.id] ?? '').trim();
        const n = raw === '' ? 0 : Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 100) throw Error(`Give ${m.name} a whole-number share from 0 to 100%.`);
        shares[m.id] = n;
      }
      await commitConfig(st => setShares(st.config, shares));
      drafts.shares = null;
      render();
      toast('Shares saved. The settlement uses them now.');
    }),
    'studio-copy-partners': async () => {
      const ops = C().operators;
      const names = members().map(m => m.name).filter(n => !ops.some(o => o.toLowerCase() === n.toLowerCase()));
      if (!names.length) {
        toast('Every partner is already a cashier.');
        return;
      }
      const next = [...ops, ...names];
      if (next.length > CATALOG_LIMITS.operators) throw Error(`That would make ${next.length} cashiers — the most is ${CATALOG_LIMITS.operators}. Remove a few first.`);
      await commitConfig(st => saveOperators(st.config, {operators: next}));
      drafts.team = null;
      render();
      toast(`${names.length} partner${names.length === 1 ? '' : 's'} added as cashier${names.length === 1 ? '' : 's'}.`);
    },

    // cashiers
    'studio-op-add': () => {
      const t = draftOf('team');
      if (t.rows.length >= CATALOG_LIMITS.operators) throw Error(`You can have at most ${CATALOG_LIMITS.operators} cashiers.`);
      const key = `n${++rowSeq}`;
      t.rows.push({key, name: ''});
      render();
      document.getElementById(`studio-op-${key}`)?.focus();
    },
    'studio-op-remove': (_el, ds) => {
      const t = draftOf('team');
      if (t.rows.length <= 1) throw Error('Keep at least one cashier.');
      t.rows = t.rows.filter((/** @type {any} */ r) => r.key !== ds.key);
      if (t.current && !t.rows.some((/** @type {any} */ r) => r.key === t.current)) t.current = null;
      render();
    },
    'studio-save-team': () => guarded('team', async () => {
      const t = draftOf('team');
      const operators = t.rows.map((/** @type {any} */ r) => String(r.name || '').trim()).filter(Boolean);
      if (!operators.length) throw Error('Add at least one cashier.');
      const current = String(t.rows.find((/** @type {any} */ r) => r.key === currentKey(t))?.name || '').trim() || operators[0];
      // Picking who is on the counter needs no PIN (like the avatar sheet); changing the list is an admin edit.
      const listChanged = JSON.stringify(operators) !== JSON.stringify(C().operators);
      const write = () => commitConfig(st => saveOperators(st.config, listChanged ? {operators, operator: current} : {operator: current}));
      if (listChanged) {
        if (!(await requireAdmin(async () => (await write(), true)))) return;
      } else {
        await write();
      }
      drafts.team = null;
      render();
      toast(`Cashiers saved. ${C().operator} is on the counter.`);
    }),
    'studio-kitchen-toggle': async () => {
      await commitConfig(st => setKitchenQueue(st.config, !st.config.kitchenQueue));
      toast(C().kitchenQueue ? 'Kitchen queue on: new orders start in Preparing.' : 'Kitchen queue off: orders are handed over straight away.');
    },

    // games
    'studio-game-edit': (_el, ds) => gameSheet(ds.id || ''),
    'studio-game-save': async () => {
      const form = sheetEl()?.querySelector('#studio-game-form');
      if (!form) return;
      const id = /** @type {HTMLElement} */ (form).dataset.id || '';
      const fee = amountOrZero(sheetVal('studio-game-fee'), 'Fee');
      const art = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="studio-game-art"]:checked'))?.value || 'spin-wheel';
      const data = {name: sheetVal('studio-game-name'), fee, art};
      const game = await commitConfig(st => saveGame(st.config, id ? {...data, id} : data));
      closeSheet();
      toast(`${game.name} ${id ? 'updated' : 'added'}${game.fee ? ` · ${money(game.fee)} a play` : ' · free to play'}.`);
    },
    'studio-game-delete': (_el, ds) => {
      const g = C().games.find(x => x.id === ds.id);
      if (!g) throw Error('That game no longer exists.');
      confirmSheet({
        title: 'Delete this game?',
        body: `<p><strong>${esc(g.name)}</strong> leaves the Game corner.</p><p class="muted">Plays already recorded keep their fee in your totals.</p>`,
        confirmLabel: 'Delete game',
        danger: true,
        onConfirm: async () => {
          await commitConfig(st => deleteGame(st.config, g.id));
          toast('Game deleted.');
        },
      });
    },
  },
  {
    admin: [
      'studio-save-profile', 'studio-save-look', 'studio-save-upi', 'studio-disc-save', 'studio-disc-active', 'studio-disc-move',
      'studio-disc-delete', 'studio-custom-toggle', 'studio-save-mission', 'studio-kitchen-toggle',
      'studio-game-save', 'studio-game-delete', 'studio-theme-apply', 'studio-photo-remove',
      'studio-member-save', 'studio-member-remove', 'studio-split-mode', 'studio-save-shares', 'studio-copy-partners',
    ],
  },
);
