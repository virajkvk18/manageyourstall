// Set up your stall — the step-by-step setup wizard at #/setup (ARCHITECTURE.md §17.5). created by viraj
//
// Full-screen page rendered outside the stall shell (core.registerPage). One question per step, a progress bar with step
// names, Back / Skip / Next (Enter = Next). Only the stall name is required. Answers live in module memory and in
// sessionStorage ('mys-setup') so a refresh never loses them (passwords are never stored).
//
// Steps: 1 Name → 2 What do you sell → 3 Where & when → 4 Your team → 5 Get paid → 6 Save to cloud → 7 Ready.
// Leaving step 6 creates the stall: initialState + applyTheme + profile/UPI/team + onboarded → storage.createStall, then
// (signed in) cloud.linkStall in the background. "Open my stall" → core.openStallById.
import * as core from './core.mjs';
import {esc, icon, render, registerActions, registerInputs, toast, installArtSprite} from './core.mjs';
import * as storage from '../storage.mjs';
import * as cloud from '../cloud.mjs';
import {initialState, applyTheme} from '../domain.mjs';
import {saveProfile, saveUpi, saveOperators, addMember, validateConfig} from '../catalog.mjs';
import {TEMPLATES, buildTemplate} from '../templates.mjs';
import {heroSvg} from '../library.mjs';
import {BRAND, UPI_RE, HEX_RE, DATE_RE, LIMITS, TINT_IDS, PATTERN_IDS} from '../constants.mjs';

/** Phase-3 kernel, storage and cloud APIs (§17.1–§17.4), read loosely so this page never breaks the app's boot. */
const kernel = /** @type {any} */ (core);
const store = /** @type {any} */ (storage);
const cl = /** @type {any} */ (cloud);

const KEY = 'mys-setup';
const DEFAULT_THEME = TEMPLATES[0]?.id || 'street-chaat';
const LOGIN_RE = /^[A-Za-z0-9._@+-]{3,60}$/;
const MAX_PARTNERS = 19; // + the owner = 20 team members (MAX_MEMBERS)

/** The seven steps, in order. `skip` = the step can be skipped. */
const STEPS = Object.freeze([
  {key: 'name', label: 'Name', title: 'Stall name'},
  {key: 'menu', label: 'Menu', title: 'What you sell', skip: true},
  {key: 'event', label: 'Event', title: 'Where & when', skip: true},
  {key: 'team', label: 'Team', title: 'Your team', skip: true},
  {key: 'upi', label: 'Get paid', title: 'Get paid', skip: true},
  {key: 'cloud', label: 'Cloud', title: 'Save to cloud', skip: true},
  {key: 'ready', label: 'Ready', title: 'Ready'},
]);
const READY = STEPS.length - 1;
const CLOUD = READY - 1;

/** Fresh wizard answers. */
const blank = () => ({
  step: 0,
  stallName: '',
  booth: '',
  noBooth: false,
  templateId: DEFAULT_THEME,
  starter: true,
  withPrices: true,
  eventName: '',
  venue: '',
  city: '',
  eventDate: '',
  ownerName: '',
  partner: '', // the partner name being typed
  partners: /** @type {string[]} */ ([]),
  upiId: '',
  payeeName: '',
  skipped: /** @type {Record<string, boolean>} */ ({}),
  cloudChoice: /** @type {''|'account'|'local'} */ (''),
  authMode: /** @type {'signup'|'login'} */ ('signup'),
  accName: '',
  loginId: '',
  created: /** @type {null|{id: string}} */ (null),
  link: /** @type {''|'local'|'syncing'|'synced'|'error'|'pending'} */ (''),
  linkError: '',
});

/** @type {ReturnType<typeof blank>} */
let w = restore();
/** Transient (never persisted): typed password, show/hide, busy flag, inline error. */
let authPw = '';
let pwShown = false;
let busy = '';
let error = {msg: '', field: ''};
/** Step whose focus/scroll was last set up (so a plain re-render doesn't steal focus). */
let focusedStep = -1;

// ---------------------------------------------------------------------------------------------------------------------
// Persistence (sessionStorage: survives a refresh, not a new tab)
// ---------------------------------------------------------------------------------------------------------------------

function restore() {
  const base = blank();
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return base;
    for (const k of /** @type {Array<keyof typeof base>} */ (Object.keys(base))) {
      const v = raw[k];
      const d = base[k];
      if (v === undefined || v === null) continue;
      if (Array.isArray(d)) {
        if (Array.isArray(v)) /** @type {any} */ (base)[k] = v.filter(x => typeof x === 'string').slice(0, MAX_PARTNERS);
      } else if (k === 'created') {
        if (typeof v === 'object' && typeof v.id === 'string') base.created = {id: v.id};
      } else if (k === 'skipped') {
        if (typeof v === 'object') for (const s of STEPS) if (v[s.key] === true) base.skipped[s.key] = true;
      } else if (typeof v === typeof d) {
        /** @type {any} */ (base)[k] = v;
      }
    }
    base.step = Math.max(0, Math.min(READY, Math.floor(Number(base.step) || 0)));
    if (!TEMPLATES.some(t => t.id === base.templateId)) base.templateId = DEFAULT_THEME;
    if (base.step === READY && !base.created) base.step = CLOUD;
    if (base.created && base.step !== READY) base.step = READY;
    if (base.link === 'syncing') base.link = 'pending'; // the request died with the old page
  } catch {
    /* private mode / corrupt data → start fresh */
  }
  return base;
}

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* storage blocked: the wizard still works for this page */
  }
}

function reset() {
  w = blank();
  authPw = '';
  pwShown = false;
  busy = '';
  error = {msg: '', field: ''};
  focusedStep = -1;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

/** @template T @param {() => T} fn @returns {T|null} */
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

const theme = (/** @type {string} */ id) => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

/** Starter-menu item counts per template (built once). @type {Map<string, number>} */
const menuCounts = new Map();
const menuCount = (/** @type {string} */ id) => {
  if (!menuCounts.has(id)) menuCounts.set(id, safe(() => buildTemplate(id).products.filter(p => p.active).length) ?? 0);
  return menuCounts.get(id) || 0;
};

/** Readable text colour on a background hex. @param {string} hex */
function onColor(hex) {
  if (!HEX_RE.test(hex)) return '#171717';
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#171717' : '#fff9ed';
}

/** What the booth shows as: '' (no number), 'Stall No. 10' for a bare number, else exactly what was typed. */
function boothValue() {
  if (w.noBooth) return '';
  const b = w.booth.trim().replace(/\s+/g, ' ');
  return /^\d{1,14}$/.test(b) ? `Stall No. ${b}` : b;
}

const fmtDate = (/** @type {string} */ d) => {
  if (!DATE_RE.test(d || '')) return '';
  const at = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'}).format(at);
};

const eventLine = () =>
  w.skipped.event ? '' : [w.eventName, w.venue, w.city, fmtDate(w.eventDate)].map(x => String(x || '').trim()).filter(Boolean).join(' · ');

/** Owner + partners, de-duplicated (case-insensitive), as entered. */
function teamNames() {
  if (w.skipped.team) return [];
  const out = /** @type {string[]} */ ([]);
  for (const n of [w.ownerName, ...w.partners].map(x => String(x || '').trim()).filter(Boolean)) {
    if (!out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

/** The signed-in MYS account (user sessions only; a team-stall login can't own new stalls). */
function account() {
  const s = safe(() => (typeof cl.session === 'function' ? cl.session() : null));
  if (!s || !s.user) return null;
  if (s.kind && s.kind !== 'user') return null;
  return /** @type {{token: string, user: {id?: string, loginId: string, name: string}}} */ (s);
}

const cloudReady = () => !!safe(() => (typeof cl.cloudReady === 'function' ? cl.cloudReady() : false));
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** The effective step-6 choice. */
function cloudChoice() {
  if (w.cloudChoice) return w.cloudChoice;
  return cloudReady() && (account() || online()) ? 'account' : 'local';
}

/** @param {string} msg @param {string} [field] */
function fail(msg, field = '') {
  error = {msg, field};
  rerender(false);
  const el = /** @type {HTMLElement|null} */ (field ? document.getElementById(`setup-${field}`) : null);
  if (el) el.focus();
  else document.querySelector('[data-setup-error]')?.scrollIntoView?.({block: 'nearest'});
}

function clearError() {
  error = {msg: '', field: ''};
}

/** @param {unknown} err */
const messageOf = err =>
  (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || '')) ||
  'Something went wrong. Please try again.';

// ---------------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A labelled input bound to a wizard answer (data-input="setup-in", name = answer key).
 * @param {string} key answer key ('password' reads the transient password)
 * @param {string} label text
 * @param {{type?: string, placeholder?: string, max?: number, hint?: string, big?: boolean, auto?: string, extra?: string, focus?: boolean}} [o]
 */
function input(key, label, {type = 'text', placeholder = '', max = 0, hint = '', big = false, auto = 'off', extra = '', focus = false} = {}) {
  const value = key === 'password' ? authPw : String(/** @type {any} */ (w)[key] ?? '');
  const id = `setup-${key}`;
  const bad = error.field === key;
  return `<div class="field setup-field${big ? ' setup-big' : ''}">
    <label for="${id}">${esc(label)}</label>
    <input id="${id}" name="${esc(key)}" type="${esc(type)}" value="${esc(value)}" data-input="setup-in" autocomplete="${esc(auto)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${max ? ` maxlength="${max}"` : ''}${hint ? ` aria-describedby="${id}-hint"` : ''}${bad ? ' aria-invalid="true"' : ''}${focus ? ' data-setup-focus' : ''}${extra ? ' ' + extra : ''}>
    ${hint ? `<small id="${id}-hint">${hint}</small>` : ''}
  </div>`;
}

/** Sticker-style MYS mark with the permanent credit. */
const brand = () => `<div class="setup-brand">
  <span class="brand-mark setup-mark" title="${BRAND.name}">${BRAND.short}</span>
  <span class="setup-brand-text"><span class="setup-brand-word">${BRAND.name}</span><span class="credit-badge">${BRAND.credit}</span></span>
</div>`;

function progress() {
  const items = STEPS.map((s, i) => {
    const state = i < w.step ? 'done' : i === w.step ? 'current' : 'todo';
    const skipped = i < w.step && w.skipped[s.key];
    return `<li class="setup-pstep is-${state}${skipped ? ' is-skipped' : ''}"${i === w.step ? ' aria-current="step"' : ''}>
      <span class="setup-pbar" aria-hidden="true"></span>
      <span class="setup-plabel">${i < w.step && !skipped ? icon('check') : ''}${esc(s.label)}</span>
    </li>`;
  }).join('');
  return `<nav class="setup-progress-wrap" aria-label="Setup progress">
    <p class="setup-progress-text"><strong>Step ${w.step + 1} of ${STEPS.length}</strong> · ${esc(STEPS[w.step].title)}</p>
    <ol class="setup-progress">${items}</ol>
  </nav>`;
}

/** Big question header. @param {string} eyebrow @param {string} title @param {string} sub */
const question = (eyebrow, title, sub) => `<div class="setup-q">
  <span class="setup-eyebrow">${esc(eyebrow)}</span>
  <h1 id="setup-title" tabindex="-1">${esc(title)}</h1>
  ${sub ? `<p class="setup-sub">${esc(sub)}</p>` : ''}
</div>
<div class="form-error setup-error" data-setup-error role="alert"${error.msg ? '' : ' hidden'}>${icon('alert')}<span>${esc(error.msg)}</span></div>`;

function stepName() {
  const shown = boothValue();
  const hint = w.noBooth
    ? 'No number — your stall name shows on its own.'
    : shown
      ? `Shows as “${esc(shown)}”.`
      : 'Optional. A bare number becomes “Stall No. 10”.';
  return `${question('Let’s set up your stall', 'What’s your stall called?', 'Big, bold and on every bill. You can change it any time.')}
    ${input('stallName', 'Stall name', {placeholder: 'e.g. Chatpata Corner', max: LIMITS.stallName, big: true, focus: true, extra: 'required enterkeyhint="next"'})}
    <div class="setup-booth${w.noBooth ? ' is-off' : ''}">
      ${input('booth', 'Stall / booth number', {placeholder: 'e.g. 10 or B-12', max: LIMITS.booth, hint, extra: `enterkeyhint="next"${w.noBooth ? ' disabled' : ''}`})}
      <button type="button" class="setup-nobooth${w.noBooth ? ' on' : ''}" data-action="setup-nobooth" aria-pressed="${w.noBooth}" id="setup-nobooth">
        <span class="setup-tick" aria-hidden="true">${icon('check')}</span>No stall number
      </button>
    </div>`;
}

function stepMenu() {
  const cards = TEMPLATES.map(t => {
    const on = t.id === w.templateId;
    const look = t.theme || {accent: t.accent, secondary: '#FF4D87', heroArt: [t.art], heroTint: 'yellow', heroPattern: 'none'};
    const tint = TINT_IDS.includes(look.heroTint) ? look.heroTint : 'yellow';
    const pattern = PATTERN_IDS.includes(look.heroPattern) ? look.heroPattern : 'none';
    const sw = (/** @type {string} */ hex) => (HEX_RE.test(hex) ? `<span class="setup-swatch" style="background:${hex}"></span>` : '');
    return `<button type="button" class="setup-theme${on ? ' on' : ''}" id="setup-theme-${esc(t.id)}" data-action="setup-theme" data-id="${esc(t.id)}" aria-pressed="${on}">
      <span class="setup-theme-hero tint-${tint} pattern-${pattern}">${heroSvg([...look.heroArt], {cls: 'setup-theme-art'})}${on ? `<span class="setup-picked">${icon('check')} Picked</span>` : ''}</span>
      <span class="setup-theme-body">
        <span class="setup-theme-name"><span aria-hidden="true">${esc(t.emoji)}</span> ${esc(t.name)}</span>
        <span class="setup-theme-tag">${esc(t.tagline)}</span>
        <span class="setup-swatches" aria-hidden="true">${sw(look.accent)}${sw(look.secondary)}<span class="setup-swatch is-tint tint-${tint}"></span></span>
      </span>
    </button>`;
  }).join('');
  const isBlank = w.templateId === 'blank';
  const n = menuCount(w.templateId);
  const toggles = isBlank
    ? `<p class="notice lavender setup-note">${icon('info')}<span>Blank starts with empty Snacks, Drinks and Combos. Add your own items in Menu.</span></p>`
    : `<div class="setup-toggles">
        ${core.toggle('setup-starter', `<span class="setup-tg"><strong>Load the starter menu</strong><small>${n} items ready to sell. Edit anything later.</small></span>`, w.starter, 'id="setup-starter"')}
        ${core.toggle('setup-prices', `<span class="setup-tg"><strong>Suggested prices</strong><small>${w.starter ? 'Typical fest prices. Off = you set every price.' : 'Turn the starter menu on to use these.'}</small></span>`, w.starter && w.withPrices, `id="setup-prices"${w.starter ? '' : ' disabled'}`)}
      </div>`;
  return `${question('What do you sell?', 'Pick your stall’s vibe', 'Sets your colours, hero art and a starter menu. Switch any time in Studio.')}
    <div class="setup-themes" role="group" aria-label="Stall themes">${cards}</div>
    ${toggles}`;
}

function stepEvent() {
  return `${question('Where & when', 'Where’s the mela?', 'Shows on your counter and day reports. Not sure yet? Skip it.')}
    ${input('eventName', 'Event name', {placeholder: 'e.g. Diwali Mela 2026', max: LIMITS.eventName, big: true, focus: true})}
    <div class="setup-grid">
      ${input('venue', 'Venue', {placeholder: 'e.g. College main ground', max: LIMITS.venue})}
      ${input('city', 'City', {placeholder: 'e.g. Jabalpur', max: LIMITS.city})}
    </div>
    ${input('eventDate', 'Date', {type: 'date'})}`;
}

function stepTeam() {
  const chips = w.partners.map((p, i) =>
    `<button type="button" class="setup-partner" data-action="setup-partner-remove" data-index="${i}" aria-label="Remove ${esc(p)}"><span>${esc(p)}</span>${icon('close')}</button>`,
  ).join('');
  return `${question('Your team', 'Who’s running the show?', 'Everyone here can take orders and joins the profit split. Edit any time.')}
    ${input('ownerName', 'Your name', {placeholder: 'e.g. Viraj', max: LIMITS.ownerName, big: true, focus: true, auto: 'name'})}
    <div class="field setup-field">
      <label for="setup-partner">Partners</label>
      <div class="setup-addrow">
        <input id="setup-partner" name="partner" type="text" value="${esc(w.partner)}" data-input="setup-in" autocomplete="off" maxlength="${LIMITS.memberName}" placeholder="Add a partner’s name" enterkeyhint="done" aria-describedby="setup-partner-hint"${error.field === 'partner' ? ' aria-invalid="true"' : ''}>
        <button type="button" class="lime setup-add" data-action="setup-partner-add">${icon('plus')}Add</button>
      </div>
      <small id="setup-partner-hint">Press Enter or Add for each friend. Tap a name to remove it.</small>
    </div>
    ${chips ? `<div class="setup-partners" role="list" aria-label="Partners">${chips}</div>` : '<p class="setup-empty">No partners yet — solo stalls rock too.</p>'}`;
}

function stepUpi() {
  return `${question('Get paid', 'How do people pay you?', 'Add your UPI ID and MYS shows a QR with the exact amount at checkout.')}
    ${input('upiId', 'UPI ID', {placeholder: 'yourname@okaxis', max: LIMITS.upiId, big: true, focus: true, extra: 'inputmode="email" autocapitalize="none" spellcheck="false"', hint: 'Find it in your UPI app under your profile. Looks like name@bank.'})}
    ${input('payeeName', 'Name on the QR (optional)', {placeholder: w.stallName.trim() || 'Your stall name', max: LIMITS.payeeName})}
    <p class="notice setup-note">${icon('alert')}<span><strong>MYS never checks your bank.</strong> Always see the money land in your UPI app before handing over the order.</span></p>`;
}

function stepCloud() {
  const acct = account();
  const ready = cloudReady();
  const choice = cloudChoice();
  const card = (/** @type {'account'|'local'} */ id, /** @type {string} */ ic, /** @type {string} */ title, /** @type {string} */ text, disabled = false) =>
    `<button type="button" class="setup-choice${choice === id ? ' on' : ''}" id="setup-choice-${id}" data-action="setup-cloud-choice" data-choice="${id}" aria-pressed="${choice === id}"${disabled ? ' disabled' : ''}>
      <span class="setup-choice-icon">${icon(ic)}</span>
      <span class="setup-choice-text"><strong>${esc(title)}</strong><small>${esc(text)}</small></span>
      <span class="setup-tick" aria-hidden="true">${icon('check')}</span>
    </button>`;
  let body = '';
  if (acct) {
    body = `<div class="setup-account">
        <span class="setup-avatar" aria-hidden="true">${esc((acct.user.name || acct.user.loginId || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="grow"><span class="setup-account-label">Signed in as</span><strong>${esc(acct.user.name || acct.user.loginId)}</strong><small>${esc(acct.user.loginId)}</small></div>
        <button type="button" class="quiet-outline small" data-action="setup-logout">Switch</button>
      </div>
      <div class="setup-choices">
        ${card('account', 'upload', 'Save to my account', 'Open it on any phone. Syncs whenever there’s internet.')}
        ${card('local', 'phone', 'Keep it on this phone only', 'Works fully offline. Save it to the cloud later from Your stalls.')}
      </div>`;
  } else {
    const form = choice === 'account' && ready ? authForm() : '';
    body = `<div class="setup-choices">
        ${card('account', 'upload', 'Save to an MYS account', ready ? 'Open it on another phone. Needs internet to sync.' : 'Cloud accounts aren’t switched on in this copy of MYS.', !ready)}
        ${card('local', 'phone', 'Keep it on this phone only', 'Works fully offline. You can save it to the cloud later.')}
      </div>
      ${!online() && ready ? `<p class="notice sky setup-note">${icon('wifi-off')}<span>You’re offline. Creating an account needs internet — or keep the stall on this phone for now.</span></p>` : ''}
      ${form}`;
  }
  return `${question('Save to cloud', 'Save it to the cloud?', 'Sales always save on this phone first. An MYS account adds a cloud copy.')}
    ${body}`;
}

function authForm() {
  const signup = w.authMode === 'signup';
  const seg = (/** @type {'signup'|'login'} */ m, /** @type {string} */ label) =>
    `<button type="button" data-action="setup-auth-mode" data-mode="${m}" aria-pressed="${w.authMode === m}" class="${w.authMode === m ? 'active' : ''}">${label}</button>`;
  return `<div class="setup-auth">
    <div class="segmented block setup-seg" role="group" aria-label="Account">${seg('signup', 'Create account')}${seg('login', 'I have an account')}</div>
    ${signup ? input('accName', 'Your name', {placeholder: 'e.g. Viraj', max: 40, auto: 'name'}) : ''}
    ${input('loginId', 'Login ID', {placeholder: 'email, phone or a username', max: 60, auto: 'username', extra: 'autocapitalize="none" spellcheck="false"', hint: signup ? '3–60 letters, numbers or . _ @ + -' : ''})}
    <div class="setup-pw">
      ${input('password', 'Password', {type: pwShown ? 'text' : 'password', max: 100, auto: signup ? 'new-password' : 'current-password', hint: signup ? 'At least 6 characters.' : ''})}
      <button type="button" class="quiet-outline icon-btn setup-eye" data-action="setup-pw" aria-pressed="${pwShown}" aria-label="${pwShown ? 'Hide password' : 'Show password'}">${icon(pwShown ? 'eye-off' : 'eye')}</button>
    </div>
  </div>`;
}

/** Small stall sticker used by the live preview and the Ready summary. @param {string} cls */
function stallCard(cls) {
  const t = theme(w.templateId);
  const look = t.theme;
  const tint = TINT_IDS.includes(look?.heroTint) ? look.heroTint : 'yellow';
  const pattern = PATTERN_IDS.includes(look?.heroPattern) ? look.heroPattern : 'none';
  const name = w.stallName.trim() || 'Your stall';
  const booth = boothValue();
  const ev = eventLine();
  return `<div class="setup-stall ${cls}">
    <div class="setup-stall-hero tint-${tint} pattern-${pattern}">${heroSvg(look ? [...look.heroArt] : [t.art], {cls: 'setup-stall-art'})}</div>
    <div class="setup-stall-body">
      <span class="setup-stall-theme">${esc(t.emoji)} ${esc(t.name)}</span>
      <strong class="setup-stall-name" data-pv="name">${esc(name)}</strong>
      <span class="setup-stall-booth" data-pv="booth"${booth ? '' : ' hidden'}>${esc(booth)}</span>
      <span class="setup-stall-event" data-pv="event"${ev ? '' : ' hidden'}>${esc(ev)}</span>
    </div>
  </div>`;
}

function stepReady() {
  const t = theme(w.templateId);
  const starter = w.starter && w.templateId !== 'blank';
  const n = starter ? menuCount(w.templateId) : 0;
  const names = teamNames();
  const upi = !w.skipped.upi && w.upiId.trim();
  const ev = eventLine();
  const linkText = {
    local: ['phone', 'Saved on this phone', 'Works offline. Save it to the cloud any time from Your stalls.'],
    syncing: ['refresh', 'Saving to your account…', 'Your stall is already safe on this phone.'],
    synced: ['check', 'Saved to your account', 'Open it on any phone with your login.'],
    pending: ['refresh', 'Cloud save in progress', 'Check Your stalls for the sync status.'],
    error: ['alert', 'Saved on this phone — cloud save didn’t finish', w.linkError || 'Try “Save to cloud” from Your stalls when you’re online.'],
  }[w.link || 'local'] || ['phone', 'Saved on this phone', ''];
  const row = (/** @type {string} */ ic, /** @type {string} */ label, /** @type {string} */ value, cls = '') =>
    `<li class="setup-sum-row${cls ? ' ' + cls : ''}"><span class="setup-sum-icon">${icon(ic)}</span><span><small>${esc(label)}</small><strong>${esc(value)}</strong></span></li>`;
  const confetti = Array.from({length: 28}, (_, i) =>
    `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--r:${(i * 53) % 360}deg;--c:${['var(--accent)', 'var(--secondary)', 'var(--lime)', 'var(--sky)', 'var(--pink)', 'var(--yellow)'][i % 6]}"></i>`,
  ).join('');
  return `<div class="setup-confetti" aria-hidden="true">${confetti}</div>
    ${question('Dhamaka!', 'Your stall is ready!', 'Here’s what we set up. Everything can be changed later in Studio.')}
    <div class="setup-ready">
      ${stallCard('is-summary')}
      <ul class="setup-sum">
        ${row('menu', 'Menu', starter ? `${n} items · ${w.withPrices ? 'suggested prices' : 'prices to set'}` : `Empty ${t.name} menu — add your items`)}
        ${row('calendar', 'Event', ev || 'Add event details later')}
        ${row('users', 'Team', names.length ? names.join(', ') : 'Just you for now')}
        ${row('upi', 'Payments', upi ? `UPI QR · ${upi}` : 'Cash for now — add UPI in Studio')}
        ${row(linkText[0], 'Cloud', linkText[1], `is-${w.link || 'local'}`)}
      </ul>
      <p class="setup-sum-note" data-setup-link>${esc(linkText[2])}</p>
    </div>`;
}

function navBar() {
  const s = STEPS[w.step];
  if (w.step === READY) {
    return `<div class="setup-nav is-ready">
      <button type="button" class="accent big setup-next" data-action="setup-open" id="setup-open">${icon('store')}Open my stall</button>
    </div>`;
  }
  const last = w.step === CLOUD;
  const choice = cloudChoice();
  const acct = account();
  let nextLabel = 'Next';
  if (last) nextLabel = choice === 'account' && !acct ? (w.authMode === 'signup' ? 'Sign up & create' : 'Log in & create') : 'Create my stall';
  if (busy) nextLabel = busy;
  return `<div class="setup-nav">
    ${w.step > 0 ? `<button type="button" class="quiet-outline setup-back" data-action="setup-back" aria-label="Back">${icon('chevron-left')}<span class="setup-back-text">Back</span></button>` : ''}
    <span class="grow"></span>
    ${s.skip && !last ? '<button type="button" class="quiet setup-skip" data-action="setup-skip">Skip</button>' : ''}
    <button type="button" class="accent big setup-next" data-action="setup-next" id="setup-next"${busy ? ' aria-disabled="true"' : ''}>${esc(nextLabel)}${busy ? '' : icon('arrow')}</button>
  </div>`;
}

const BODIES = [stepName, stepMenu, stepEvent, stepTeam, stepUpi, stepCloud, stepReady];

/** The #/setup page. */
export function renderSetup() {
  safe(() => installArtSprite());
  const t = theme(w.templateId);
  const accent = HEX_RE.test(t.theme?.accent || '') ? t.theme.accent : t.accent;
  const secondary = HEX_RE.test(t.theme?.secondary || '') ? t.theme.secondary : '#FF4D87';
  const vars = `--accent:${accent};--on-accent:${onColor(accent)};--secondary:${secondary};--on-secondary:${onColor(secondary)}`;
  const s = STEPS[w.step];
  let body = '';
  try {
    body = BODIES[w.step]();
  } catch (err) {
    console.error(err);
    body = `<p class="notice danger">${icon('alert')}<span>This step hit a snag. Go back and try again.</span></p>`;
  }
  const preview = w.step < READY ? `<aside class="setup-preview" aria-label="Live preview"><span class="setup-preview-label">Live preview</span>${stallCard('is-preview')}</aside>` : '';
  return `<div class="setup-page step-${s.key}" style="${vars}">
    <header class="setup-top">
      ${brand()}
      ${w.step < READY ? `<button type="button" class="quiet-outline small setup-exit" data-action="setup-exit">${icon('close')}<span>Exit</span></button>` : ''}
    </header>
    ${progress()}
    <div class="setup-layout">
      <form class="setup-card" data-submit="setup-next" novalidate aria-labelledby="setup-title">
        <div class="setup-body">${body}</div>
        ${navBar()}
      </form>
      ${preview}
    </div>
    <footer class="setup-foot"><span>${BRAND.short} · ${BRAND.name}</span><span class="credit-badge">${BRAND.credit}</span></footer>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------------------------------

/** Re-render; on a step change, scroll to top and move focus to the step's main input (or its heading). */
function rerender(stepChanged = true) {
  render();
  if (!stepChanged || focusedStep === w.step) return;
  focusStep();
}

function focusStep() {
  focusedStep = w.step;
  const app = document.getElementById('app');
  if (!app || !app.querySelector('.setup-page')) return;
  window.scrollTo(0, 0);
  const fine = safe(() => matchMedia('(pointer: fine)').matches) ?? false;
  const target = /** @type {HTMLElement|null} */ ((fine && app.querySelector('[data-setup-focus]')) || app.querySelector('#setup-title'));
  target?.focus({preventScroll: true});
}

/** @param {number} step */
function go(step) {
  clearError();
  w.step = Math.max(0, Math.min(READY, step));
  if (w.step === CLOUD && !w.accName && !w.skipped.team) w.accName = w.ownerName.trim();
  persist();
  focusedStep = -1;
  rerender();
}

/** Validate the current step and move on (step 6 creates the stall). @param {any} event */
async function next(event) {
  if (busy) return;
  clearError();
  const s = STEPS[w.step];
  if (s.key === 'name') {
    const name = w.stallName.trim();
    if (!name) return fail('Give your stall a name — it goes on every bill.', 'stallName');
    if (name.length > LIMITS.stallName) return fail(`Keep the name under ${LIMITS.stallName} characters.`, 'stallName');
    if (boothValue().length > LIMITS.booth) return fail(`Keep the stall number under ${LIMITS.booth} characters.`, 'booth');
  }
  if (s.key === 'event' && w.eventDate && !fmtDate(w.eventDate)) return fail('Pick a real date — or clear it.', 'eventDate');
  if (s.key === 'team') {
    // Enter inside the partner box adds the chip instead of moving on.
    const fromPartner = event?.target instanceof HTMLElement && event.target.id === 'setup-partner';
    if (w.partner.trim()) {
      if (!addPartner()) return undefined;
      if (fromPartner) return rerender(false);
    }
  }
  if (s.key === 'upi') {
    const id = w.upiId.trim();
    if (id && !UPI_RE.test(id)) return fail('That UPI ID doesn’t look right. It should look like name@okaxis.', 'upiId');
  }
  if (s.key === 'cloud') return finish();
  w.skipped[s.key] = false;
  go(w.step + 1);
  return undefined;
}

/** Add the typed partner name as a chip. @returns {boolean} false (with an error shown) when it can't be added */
function addPartner() {
  const name = w.partner.trim().replace(/\s+/g, ' ');
  if (!name) return true;
  if (name.length > LIMITS.memberName) return fail(`Keep names under ${LIMITS.memberName} characters.`, 'partner'), false;
  const all = [w.ownerName.trim(), ...w.partners].filter(Boolean).map(x => x.toLowerCase());
  if (all.includes(name.toLowerCase())) return fail(`${name} is already on the team.`, 'partner'), false;
  if (w.partners.length >= MAX_PARTNERS) return fail('That’s a full team — 20 people max.', 'partner'), false;
  w.partners.push(name);
  w.partner = '';
  persist();
  return true;
}

/** Build the new stall's State from the answers (pure apart from reading `w`). */
export function buildStall() {
  const tid = TEMPLATES.some(t => t.id === w.templateId) ? w.templateId : DEFAULT_THEME;
  const starter = w.starter && tid !== 'blank';
  const st = /** @type {any} */ (initialState({templateId: starter ? tid : 'blank', withPrices: w.withPrices}));
  applyTheme(st, tid, {menu: false, withPrices: w.withPrices, keepPhoto: false});
  const c = st.config;
  if (!starter && tid !== 'blank') {
    const look = /** @type {any} */ (buildTemplate(tid, {withPrices: false}));
    c.profile.tagline = look.tagline || c.profile.tagline;
    c.profile.subTagline = look.subTagline || c.profile.subTagline;
  }
  const ev = !w.skipped.event;
  saveProfile(c, {
    stallName: w.stallName.trim(),
    booth: boothValue(),
    eventName: ev ? w.eventName.trim() : '',
    venue: ev ? w.venue.trim() : '',
    city: ev ? w.city.trim() : '',
    eventDate: ev && fmtDate(w.eventDate) ? w.eventDate : '',
  });
  const names = teamNames();
  if (names.length) {
    if (!w.skipped.team && w.ownerName.trim()) saveProfile(c, {ownerName: w.ownerName.trim()});
    saveOperators(c, {operators: names, operator: names[0]});
    for (const name of names) addMember(c, {name});
  }
  if (!w.skipped.upi && w.upiId.trim()) saveUpi(c, {id: w.upiId.trim(), payeeName: w.payeeName.trim()});
  st.onboarded = true;
  validateConfig(c);
  return st;
}

/** Step 6 → sign up / log in when asked, create the stall, link it to the cloud in the background, show Ready. */
async function finish({local = false} = {}) {
  let link = !local && cloudChoice() === 'account' && cloudReady();
  if (link && !account()) {
    if (!(await auth())) return;
  }
  link = link && !!account();
  busy = 'Creating your stall…';
  rerender(false);
  try {
    if (typeof store.createStall !== 'function') throw Error('This copy of MYS can’t create stalls yet. Reload and try again.');
    const st = buildStall();
    // Not opened yet: a tab with another stall open keeps it until "Open my stall" (openStallById switches).
    const {entry} = await store.createStall(st, {open: false});
    w.created = {id: entry.id};
    w.link = link ? 'syncing' : 'local';
    w.linkError = '';
    w.skipped.cloud = !link;
    busy = '';
    go(READY);
    if (link) linkInBackground(entry.id);
  } catch (err) {
    busy = '';
    fail(messageOf(err));
  }
}

/** @param {string} id */
function linkInBackground(id) {
  Promise.resolve()
    .then(() => {
      if (typeof cl.linkStall !== 'function') throw Error('Cloud sync isn’t available in this copy of MYS.');
      return cl.linkStall(id);
    })
    .then(link => {
      // linkStall resolves with entry.cloud; offline after creating → it stays 'pending' and syncs later.
      const status = link && typeof link === 'object' ? link.status : 'synced';
      w.link = status === 'synced' ? 'synced' : status === 'error' || status === 'conflict' ? 'error' : 'pending';
      if (w.link === 'error') w.linkError = String(link.lastError || '') || 'Try “Sync now” from Your stalls.';
    })
    .catch(err => {
      w.link = 'error';
      w.linkError = online() ? messageOf(err) : 'You’re offline. It will save to the cloud when you’re back online.';
    })
    .finally(() => {
      if (!w.created || w.created.id !== id) return;
      persist();
      if (document.querySelector('.setup-page.step-ready')) rerender(false);
    });
}

/** Inline create-account / log-in. @returns {Promise<boolean>} */
async function auth() {
  const signup = w.authMode === 'signup';
  const loginId = w.loginId.trim();
  const name = w.accName.trim() || w.ownerName.trim();
  if (signup && !name) return fail('Add your name for the account.', 'accName'), false;
  if (!LOGIN_RE.test(loginId)) return fail('Use 3–60 letters, numbers or . _ @ + - for your login ID.', 'loginId'), false;
  if (authPw.length < 6 || authPw.length > 100) return fail('Passwords need 6 to 100 characters.', 'password'), false;
  if (!online()) return fail('You’re offline. Connect to the internet — or keep this stall on the phone for now.'), false;
  const fn = signup ? cl.signUp : cl.logIn;
  if (typeof fn !== 'function') return fail('Accounts aren’t available in this copy of MYS. Keep it on this phone for now.'), false;
  busy = signup ? 'Creating account…' : 'Logging in…';
  rerender(false);
  try {
    await fn(signup ? {loginId, password: authPw, name} : {loginId, password: authPw});
    authPw = '';
    pwShown = false;
    busy = '';
    const who = account();
    toast(signup ? `Welcome to MYS, ${who?.user?.name || name}!` : `Welcome back, ${who?.user?.name || loginId}!`);
    return true;
  } catch (err) {
    busy = '';
    fail(messageOf(err), signup ? '' : 'password');
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

/** Live-preview bits that change while typing (no full re-render, so typing stays smooth). @param {string} key */
function livePreview(key) {
  const set = (/** @type {string} */ pv, /** @type {string} */ text) => {
    for (const el of document.querySelectorAll(`.setup-page [data-pv="${pv}"]`)) {
      el.textContent = text;
      /** @type {HTMLElement} */ (el).hidden = !text && pv !== 'name';
    }
  };
  if (key === 'stallName') set('name', w.stallName.trim() || 'Your stall');
  if (key === 'booth') {
    set('booth', boothValue());
    const hint = document.getElementById('setup-booth-hint');
    if (hint) hint.textContent = boothValue() ? `Shows as “${boothValue()}”.` : 'Optional. A bare number becomes “Stall No. 10”.';
  }
  if (['eventName', 'venue', 'city', 'eventDate'].includes(key)) set('event', eventLine());
}

registerInputs({
  'setup-in': el => {
    const key = el.name;
    if (key === 'password') authPw = el.value;
    else if (key in w && typeof /** @type {any} */ (w)[key] === 'string') /** @type {any} */ (w)[key] = el.value;
    else return;
    if (key !== 'password') persist();
    if (error.field === key || (error.msg && !error.field)) {
      clearError();
      el.removeAttribute('aria-invalid');
      const slot = /** @type {HTMLElement|null} */ (document.querySelector('[data-setup-error]'));
      if (slot) slot.hidden = true;
    }
    livePreview(key);
  },
});

registerActions({
  'setup-next': (_el, _ds, event) => next(event),
  'setup-back': () => {
    if (busy || w.step === 0 || w.step === READY) return;
    go(w.step - 1);
  },
  'setup-skip': () => {
    if (busy) return;
    const s = STEPS[w.step];
    if (!s.skip) return;
    if (s.key === 'cloud') return finish({local: true});
    if (s.key !== 'menu') w.skipped[s.key] = true;
    if (s.key === 'team') w.partner = '';
    go(w.step + 1);
    return undefined;
  },
  'setup-nobooth': () => {
    w.noBooth = !w.noBooth;
    if (w.noBooth) w.booth = '';
    if (error.field === 'booth') clearError();
    persist();
    rerender(false);
  },
  'setup-theme': (_el, ds) => {
    if (!TEMPLATES.some(t => t.id === ds.id)) return;
    w.templateId = ds.id;
    persist();
    rerender(false);
  },
  'setup-starter': () => {
    w.starter = !w.starter;
    persist();
    rerender(false);
  },
  'setup-prices': () => {
    if (!w.starter) return;
    w.withPrices = !w.withPrices;
    persist();
    rerender(false);
  },
  'setup-partner-add': () => {
    clearError();
    if (!w.partner.trim()) return fail('Type a partner’s name first.', 'partner');
    if (addPartner()) {
      rerender(false);
      /** @type {HTMLElement|null} */ (document.getElementById('setup-partner'))?.focus();
    }
    return undefined;
  },
  'setup-partner-remove': (_el, ds) => {
    const i = Number(ds.index);
    if (!Number.isInteger(i) || i < 0 || i >= w.partners.length) return;
    w.partners.splice(i, 1);
    persist();
    rerender(false);
    /** @type {HTMLElement|null} */ (document.getElementById('setup-partner'))?.focus();
  },
  'setup-cloud-choice': (_el, ds) => {
    if (busy) return;
    w.cloudChoice = ds.choice === 'account' ? 'account' : 'local';
    clearError();
    persist();
    rerender(false);
    if (w.cloudChoice === 'account' && !account()) {
      const first = /** @type {HTMLElement|null} */ (document.querySelector(w.authMode === 'signup' ? '#setup-accName' : '#setup-loginId'));
      first?.focus();
    }
  },
  'setup-auth-mode': (_el, ds) => {
    w.authMode = ds.mode === 'login' ? 'login' : 'signup';
    if (w.authMode === 'signup' && !w.accName) w.accName = w.ownerName;
    clearError();
    persist();
    rerender(false);
  },
  'setup-pw': () => {
    pwShown = !pwShown;
    rerender(false);
    /** @type {HTMLElement|null} */ (document.getElementById('setup-password'))?.focus();
  },
  'setup-logout': async () => {
    if (typeof cl.logOut === 'function') await cl.logOut();
    w.cloudChoice = 'account';
    persist();
    rerender(false);
  },
  'setup-open': async () => {
    const id = w.created?.id;
    if (!id) return go(CLOUD);
    if (typeof kernel.openStallById !== 'function') throw Error('Reload the page to open your stall.');
    await kernel.openStallById(id);
    reset();
    return undefined;
  },
  'setup-exit': () => {
    if (safe(() => kernel.hasStall?.())) {
      location.hash = '';
      render();
    } else if (typeof kernel.goPage === 'function') kernel.goPage('welcome');
    else location.hash = '#/welcome';
  },
});

if (typeof kernel.registerPage === 'function') kernel.registerPage('setup', renderSetup);

if (typeof window !== 'undefined') {
  // Prefill the account name from the owner name the first time the cloud step shows.
  if (!w.accName && w.ownerName) w.accName = w.ownerName;
  // A created stall's wizard is done once the person leaves #/setup (the next visit starts fresh). The kernel changes
  // routes with location.hash (hashchange) and, when opening a stall, history.pushState (popstate on Back).
  const onRoute = () => {
    focusedStep = -1;
    if (!/^#\/setup/.test(location.hash)) {
      if (w.created) reset();
      return;
    }
    setTimeout(() => {
      if (document.querySelector('.setup-page')) focusStep();
    }, 0);
  };
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('popstate', onRoute);
}
