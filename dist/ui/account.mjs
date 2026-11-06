// MYS account pages (ARCHITECTURE.md §17.5): #/login, #/signup, #/join, #/account — full-screen pages outside the stall shell.
// All cloud calls go through dist/cloud.mjs (§17.4). No PIN here: the admin PIN stays a per-stall shared-phone guard.
//
// Also exports the small page kit the Your stalls page (ui/stalls.mjs) shares: the branded top bar, the "where to go after
// logging in" memory and a guarded cloud-call helper.
import * as core from './core.mjs';
import * as cloud from '../cloud.mjs';
import * as storage from '../storage.mjs';
import {esc, icon, btn, toast, registerActions, registerInputs, installArtSprite} from './core.mjs';
import {brandBlock} from './shell.mjs';

/** Pages an auth flow may return to ('stall' = back into the open stall). */
const RETURN_PAGES = ['stalls', 'setup', 'welcome', 'join', 'account', 'stall'];
const NEXT_KEY = 'mys-auth-next';
export const LOGIN_ID_RE = /^[a-zA-Z0-9._@+-]{3,60}$/;
const NAME_MAX = 60;

// ---------------------------------------------------------------------------------------------------------------------
// Shared page kit
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A cloud.mjs export, or a friendly error when the cloud client isn't available.
 * @param {string} name
 * @returns {(...args: any[]) => any}
 */
export function cloudFn(name) {
  const fn = /** @type {any} */ (cloud)[name];
  if (typeof fn !== 'function') throw Error('Cloud features aren’t ready on this copy of MYS yet. Reload and try again.');
  return fn;
}

/** Cloud features are configured for this build. */
export const cloudOn = () => {
  try {
    return typeof cloud.cloudReady === 'function' ? Boolean(cloud.cloudReady()) : false;
  } catch {
    return false;
  }
};

/** The signed-in session ({token, user, kind, stallId}) or null. */
export function currentSession() {
  try {
    const s = typeof cloud.session === 'function' ? cloud.session() : null;
    return s && typeof s === 'object' ? /** @type {any} */ (s) : null;
  } catch {
    return null;
  }
}

/** How many team stalls this phone joined with a stall code. */
export function teamCount() {
  try {
    const list = typeof cloud.teamAccess === 'function' ? cloud.teamAccess() : [];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

/** A full account session (not a one-stall team session). */
export const signedInUser = () => {
  const s = currentSession();
  return s && s.kind !== 'stall' && s.user ? s.user : null;
};

/** @param {unknown} err */
export const errText = err =>
  (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err || ''))
  || 'Something went wrong. Please try again.';

/** Offline-aware wording for a failed cloud call. @param {unknown} err */
export function cloudErrText(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You’re offline. This needs internet — try again once you’re connected.';
  const msg = errText(err);
  return /failed to fetch|networkerror|load failed|network request/i.test(msg)
    ? 'Couldn’t reach MYS cloud. Check your internet and try again.'
    : msg;
}

/** Name of a page, without any `?query`. */
const pageName = () => {
  try {
    if (typeof core.currentPage === 'function') return String(core.currentPage() || '');
  } catch {
    // fall through to the hash
  }
  return (location.hash.replace(/^#\/?/, '').split('?')[0] || '').trim();
};

/** `?next=` from the hash route (#/login?next=setup). */
function hashNext() {
  const q = location.hash.split('?')[1] || '';
  const next = new URLSearchParams(q).get('next') || '';
  return RETURN_PAGES.includes(next) ? next : '';
}

/**
 * Remember where to come back to after logging in / signing up.
 * @param {string} page one of RETURN_PAGES
 */
export function rememberNext(page) {
  try {
    if (RETURN_PAGES.includes(page)) sessionStorage.setItem(NEXT_KEY, page);
  } catch {
    // private mode: the default (Your stalls) is fine
  }
}

function takeNext() {
  let next = hashNext();
  try {
    next = next || sessionStorage.getItem(NEXT_KEY) || '';
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // ignore
  }
  return RETURN_PAGES.includes(next) ? next : 'stalls';
}

/** Is a stall open on this phone right now? */
export const stallOpen = () => {
  try {
    return typeof core.hasStall === 'function' ? Boolean(core.hasStall()) : Boolean(core.store.state);
  } catch {
    return false;
  }
};

/** Go to an outside-the-stall page. @param {string} name */
export function goTo(name) {
  if (typeof core.goPage === 'function') core.goPage(name);
  else location.hash = `#/${name}`;
}

/** Back into the open stall (the counter). */
export async function backToStall() {
  let id = '';
  try {
    id = String(/** @type {any} */ (core.store).stallId || (typeof storage.getMeta === 'function' ? (await storage.getMeta())?.activeStallId : '') || '');
  } catch {
    id = '';
  }
  if (id && typeof core.openStallById === 'function') {
    await core.openStallById(id);
    return;
  }
  location.hash = '';
  core.render();
}

/** Return to the page that sent the person to log in. */
async function returnAfterAuth() {
  const next = takeNext();
  if (next === 'stall') {
    if (stallOpen()) await backToStall();
    else goTo('stalls');
    return;
  }
  goTo(next);
  window.scrollTo(0, 0);
}

/** Display name of the open stall ('' when none). */
export function openStallName() {
  try {
    return stallOpen() ? String(core.store.state?.config?.profile?.stallName || 'your stall') : '';
  } catch {
    return '';
  }
}

/**
 * The top bar every outside page shares: MYS mark + "created by viraj" (always), plus a right-hand slot.
 * @param {string} [right] markup
 */
export function pageTop(right = '') {
  return `<header class="stl-top">
    <button type="button" class="stl-brand-btn quiet" data-action="acc-home" aria-label="ManageYourStall home">${brandBlock('stl-brand')}</button>
    <div class="stl-top-right">${right}</div>
  </header>`;
}

/** Footer credit line. */
export const pageFoot = () =>
  `<footer class="stl-foot"><span class="stl-foot-mark">MYS</span><span>ManageYourStall</span><span class="credit-badge">created by viraj</span></footer>`;

// ---------------------------------------------------------------------------------------------------------------------
// Auth form drafts (kept across re-renders; passwords are cleared on success and when leaving a page)
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Record<string, string>} */
const draft = {};
let draftPage = '';
let busy = false;
/** Error shown on the current form (survives a re-render). */
let formError = '';

function syncDraftPage() {
  const p = pageName();
  if (p !== draftPage) {
    for (const key of Object.keys(draft)) if (/pass/i.test(key)) delete draft[key];
    formError = '';
    busy = false;
    draftPage = p;
  }
}

/** @param {string} id */
const val = id => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? draft[id] ?? '';

/**
 * Labelled input bound to the draft (data-input="acc-draft").
 * @param {string} label
 * @param {string} id
 * @param {{type?: string, auto?: string, hint?: string, extra?: string, value?: string}} [o]
 */
function input(label, id, {type = 'text', auto = '', hint = '', extra = '', value} = {}) {
  const v = value ?? draft[id] ?? '';
  const isPass = type === 'password';
  const hintHtml = hint ? `<small id="${id}-hint">${hint}</small>` : '';
  const field = `<input id="${id}" name="${id}" type="${type}" value="${isPass ? '' : esc(v)}" data-input="acc-draft"${auto ? ` autocomplete="${auto}"` : ''}${hint ? ` aria-describedby="${id}-hint"` : ''} autocapitalize="off" spellcheck="false"${extra ? ' ' + extra : ''}>`;
  const peek = isPass
    ? `<button type="button" class="acc-peek quiet" data-action="acc-peek" data-for="${id}" aria-label="Show password" aria-pressed="false">${icon('eye')}<span>Show</span></button>`
    : '';
  return `<div class="field acc-field${isPass ? ' acc-pass' : ''}"><label for="${id}">${label}</label><div class="acc-input-wrap">${field}${peek}</div>${hintHtml}</div>`;
}

/** Restore typed passwords after a re-render (values are never written into markup). */
function restorePasswords() {
  for (const [id, v] of Object.entries(draft)) {
    if (!/pass/i.test(id) || !v) continue;
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    if (el && !el.value) el.value = v;
  }
}

const errorSlot = () => `<div class="acc-error" id="acc-error" role="alert"${formError ? '' : ' hidden'}>${icon('alert')}<span>${esc(formError)}</span></div>`;

/** @param {string} msg */
function setError(msg) {
  formError = msg;
  const el = document.getElementById('acc-error');
  if (el) {
    el.hidden = !msg;
    const span = el.querySelector('span');
    if (span) span.textContent = msg;
    if (msg) el.scrollIntoView?.({block: 'nearest'});
  }
}

/** @param {string} id @param {boolean} bad */
function markInvalid(id, bad) {
  const el = document.getElementById(id);
  if (el) el.setAttribute('aria-invalid', bad ? 'true' : 'false');
}

/** @param {HTMLElement|null} el @param {boolean} on @param {string} label */
function setBusy(el, on, label) {
  busy = on;
  const button = /** @type {HTMLButtonElement|null} */ (el?.closest('form')?.querySelector('.acc-submit') || el);
  if (!button) return;
  if (on) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = `${icon('refresh', 'acc-spin')} ${esc(label)}`;
    button.setAttribute('aria-disabled', 'true');
  } else {
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    button.removeAttribute('aria-disabled');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Full-screen auth layout: brand bar, a bold sticker headline, the form card, and a fun side panel on wide screens.
 * @param {{kind: string, eyebrow: string, title: string, lede: string, body: string, side?: string}} o
 */
function authLayout({kind, eyebrow, title, lede, body, side = ''}) {
  installArtSprite();
  const back = stallOpen()
    ? btn(`${icon('chevron-left')}${backLabel(openStallName())}`, 'acc-back-stall', 'small stl-back')
    : btn(`${icon('store')}<span>Your stalls</span>`, 'acc-go', 'small stl-back', 'data-page="stalls"');
  return `<div class="stl-page acc-page acc-${kind}">
    ${pageTop(back)}
    <main class="acc-main" id="main">
      <section class="acc-hero">
        <span class="acc-eyebrow">${eyebrow}</span>
        <h1 class="acc-title">${title}</h1>
        <p class="acc-lede">${lede}</p>
        ${side}
      </section>
      <section class="acc-card" aria-label="${esc(eyebrow)}">${body}</section>
    </main>
    ${pageFoot()}
  </div>`;
}

const offlineNote = () => (navigator.onLine === false
  ? `<div class="acc-note warn">${icon('wifi-off')}<span>You’re offline. Accounts need internet — your stalls still work on this phone.</span></div>`
  : '');

const noCloud = () => `<div class="acc-note warn">${icon('info')}<span>Cloud accounts aren’t switched on for this copy of MYS. Your stalls still work fully on this phone.</span></div>`;

/** Bullet list of what an account gives you (honest). */
const perks = () => `<ul class="acc-perks">
  <li><span class="acc-perk-icon tint-mint">${icon('phone')}</span><span>Open your stalls on any phone</span></li>
  <li><span class="acc-perk-icon tint-yellow">${icon('refresh')}</span><span>Sales sync when there’s internet</span></li>
  <li><span class="acc-perk-icon tint-pink">${icon('users')}</span><span>Share a stall with your team</span></li>
</ul>`;

/** Already signed in on login/signup: say so instead of showing the form again. @param {any} user */
function alreadyIn(user) {
  return `<div class="acc-signed">
    <span class="acc-avatar" aria-hidden="true">${esc(initials(user.name || user.loginId))}</span>
    <div class="grow"><strong>${esc(user.name || 'Your account')}</strong><span class="acc-id">${esc(user.loginId || '')}</span></div>
  </div>
  <p class="acc-small">You’re already logged in on this phone.</p>
  <div class="acc-actions">
    ${btn(`${icon('store')} Go to your stalls`, 'acc-go', 'primary big block', 'data-page="stalls"')}
    ${btn('Log out', 'acc-logout', 'block')}
  </div>`;
}

/** @param {string} name */
function initials(name) {
  const parts = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || 'M') + (parts[1]?.[0] || '')).toUpperCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// #/login
// ---------------------------------------------------------------------------------------------------------------------

function loginPage() {
  syncDraftPage();
  const user = signedInUser();
  const body = !cloudOn()
    ? noCloud()
    : user
      ? alreadyIn(user)
      : `<form class="acc-form" data-submit="acc-login" novalidate>
      <h2 class="acc-card-title">Log in</h2>
      ${offlineNote()}
      ${errorSlot()}
      ${input('Login ID', 'acc-login-id', {auto: 'username', hint: 'Email, phone number or username.', extra: 'inputmode="email" maxlength="60"'})}
      ${input('Password', 'acc-login-pass', {type: 'password', auto: 'current-password', extra: 'maxlength="100"'})}
      ${btn(`${icon('unlock')} Log in`, 'acc-login', 'primary big block acc-submit')}
      <p class="acc-switch">New here? ${btn('Create an account', 'acc-go', 'quiet acc-link', 'data-page="signup" data-keep-next="1"')}</p>
    </form>`;
  setTimeout(restorePasswords, 0);
  return authLayout({
    kind: 'login',
    eyebrow: 'Welcome back',
    title: 'Chalo, <span class="acc-hl">log in!</span>',
    lede: 'Your stalls, on any phone. Sales still save on this phone first — the cloud copy syncs when there’s internet.',
    body,
    side: perks(),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// #/signup
// ---------------------------------------------------------------------------------------------------------------------

function ruleList() {
  const id = draft['acc-su-id'] || '';
  const pass = draft['acc-su-pass'] || '';
  const again = draft['acc-su-pass2'] || '';
  const rules = [
    ['id', LOGIN_ID_RE.test(id.trim()), 'Login ID: 3–60 letters, digits or . _ @ + -'],
    ['len', pass.length >= 6 && pass.length <= 100, 'Password: at least 6 characters'],
    ['match', Boolean(pass) && pass === again, 'Both passwords match'],
  ];
  return `<ul class="acc-rules" id="acc-rules" aria-label="Account rules">${rules.map(([key, ok, text]) =>
    `<li class="acc-rule${ok ? ' ok' : ''}" data-rule="${key}"><span class="acc-rule-dot" aria-hidden="true">${icon(ok ? 'check' : 'minus')}</span><span>${text}</span><span class="sr-only">${ok ? ' (done)' : ''}</span></li>`).join('')}</ul>`;
}

function signupPage() {
  syncDraftPage();
  const user = signedInUser();
  const body = !cloudOn()
    ? noCloud()
    : user
      ? alreadyIn(user)
      : `<form class="acc-form" data-submit="acc-signup" novalidate>
      <h2 class="acc-card-title">Create your MYS account</h2>
      ${offlineNote()}
      ${errorSlot()}
      ${input('Your name', 'acc-su-name', {auto: 'name', extra: `maxlength="${NAME_MAX}" autocapitalize="words"`})}
      ${input('Login ID', 'acc-su-id', {auto: 'username', hint: 'Email, phone number or a username — you’ll log in with it.', extra: 'inputmode="email" maxlength="60"'})}
      ${input('Password', 'acc-su-pass', {type: 'password', auto: 'new-password', extra: 'maxlength="100"'})}
      ${input('Password again', 'acc-su-pass2', {type: 'password', auto: 'new-password', extra: 'maxlength="100"'})}
      ${ruleList()}
      <p class="acc-small">${icon('info')} There’s no password reset yet — keep it somewhere safe.</p>
      ${btn(`${icon('spark')} Create account`, 'acc-signup', 'primary big block acc-submit')}
      <p class="acc-switch">Already have one? ${btn('Log in', 'acc-go', 'quiet acc-link', 'data-page="login" data-keep-next="1"')}</p>
    </form>`;
  setTimeout(restorePasswords, 0);
  return authLayout({
    kind: 'signup',
    eyebrow: 'Free MYS account',
    title: 'Your stall, <span class="acc-hl">everywhere.</span>',
    lede: 'One login ID and a password. No email checks, no spam. Your counter keeps working offline either way.',
    body,
    side: perks(),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// #/join
// ---------------------------------------------------------------------------------------------------------------------

/** 'mys ab 12c' → 'MYS-AB12C'. @param {string} raw */
export function normalizeCode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = clean.startsWith('MYS') ? clean.slice(3) : clean;
  return body ? `MYS-${body.slice(0, 5)}` : '';
}
const CODE_RE = /^MYS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

function joinPage() {
  syncDraftPage();
  const body = !cloudOn()
    ? noCloud()
    : `<form class="acc-form" data-submit="acc-join" novalidate>
      <h2 class="acc-card-title">Join a team stall</h2>
      ${offlineNote()}
      ${errorSlot()}
      ${input('Stall code', 'acc-join-code', {hint: 'Looks like MYS-7K2QD. The stall owner finds it in Your stalls › Team access.', extra: 'maxlength="12" autocapitalize="characters" class="acc-code-input"'})}
      ${input('Team password', 'acc-join-pass', {type: 'password', auto: 'off', extra: 'maxlength="100"'})}
      ${btn(`${icon('users')} Join & open stall`, 'acc-join', 'primary big block acc-submit')}
      <p class="acc-small">${icon('info')} You’ll get this one stall on your phone. No account needed.</p>
    </form>`;
  return authLayout({
    kind: 'join',
    eyebrow: 'Team mode',
    title: 'Jump on the <span class="acc-hl">counter!</span>',
    lede: 'Your stall owner shares a stall code and a team password. Pop them in and the stall opens on this phone.',
    body,
    side: `<div class="acc-code-demo" aria-hidden="true"><span class="acc-code-label">Stall code</span><span class="acc-code-chip">MYS-7K2QD</span></div>`,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// #/account
// ---------------------------------------------------------------------------------------------------------------------

function accountPage() {
  syncDraftPage();
  const user = signedInUser();
  let body;
  if (!cloudOn()) body = noCloud();
  else if (!user) {
    const team = teamCount() > 0;
    body = `<h2 class="acc-card-title">You’re not logged in</h2>
      <p class="acc-small">${team ? 'This phone helps at a team stall with a stall code. Log in to use your own account too.' : 'Log in to open your stalls on any phone.'}</p>
      <div class="acc-actions">
        ${btn(`${icon('unlock')} Log in`, 'acc-go', 'primary big block', 'data-page="login" data-next="account"')}
        ${btn('Create account', 'acc-go', 'block', 'data-page="signup" data-next="account"')}
      </div>`;
  } else {
    body = `<div class="acc-signed">
        <span class="acc-avatar" aria-hidden="true">${esc(initials(user.name || user.loginId))}</span>
        <div class="grow"><strong>${esc(user.name || 'Your account')}</strong><span class="acc-id">Login ID: ${esc(user.loginId || '')}</span></div>
      </div>
      ${offlineNote()}
      ${errorSlot()}
      <form class="acc-form acc-section" data-submit="acc-save-name" novalidate>
        <h2 class="acc-card-title">Your name</h2>
        ${input('Name', 'acc-name', {auto: 'name', value: draft['acc-name'] ?? user.name ?? '', extra: `maxlength="${NAME_MAX}" autocapitalize="words"`})}
        ${btn(`${icon('check')} Save name`, 'acc-save-name', 'yellow block')}
      </form>
      <form class="acc-form acc-section" data-submit="acc-change-pass" novalidate>
        <h2 class="acc-card-title">Change password</h2>
        ${input('Current password', 'acc-old-pass', {type: 'password', auto: 'current-password', extra: 'maxlength="100"'})}
        ${input('New password', 'acc-new-pass', {type: 'password', auto: 'new-password', hint: 'At least 6 characters. Other phones get logged out.', extra: 'maxlength="100"'})}
        ${input('New password again', 'acc-new-pass2', {type: 'password', auto: 'new-password', extra: 'maxlength="100"'})}
        ${btn(`${icon('lock')} Change password`, 'acc-change-pass', 'lavender block')}
      </form>
      <div class="acc-section">
        <h2 class="acc-card-title">This phone</h2>
        <p class="acc-small">Logging out keeps every stall on this phone. Cloud sync pauses until you log in again.</p>
        <div class="acc-actions">${btn(`${icon('store')} Your stalls`, 'acc-go', 'block', 'data-page="stalls"')}${btn('Log out', 'acc-logout', 'danger block')}</div>
      </div>`;
  }
  setTimeout(restorePasswords, 0);
  return authLayout({
    kind: 'account',
    eyebrow: 'Your MYS account',
    title: user ? `Hey <span class="acc-hl">${esc(firstName(user.name || ''))}!</span>` : 'Your <span class="acc-hl">account</span>',
    lede: 'Name, password and this phone’s login. Your stalls live in Your stalls.',
    body,
  });
}

/** @param {string} name */
const firstName = name => String(name || '').trim().split(/\s+/)[0]?.slice(0, 20) || 'there';

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

if (typeof core.registerPage === 'function') {
  core.registerPage('login', loginPage);
  core.registerPage('signup', signupPage);
  core.registerPage('join', joinPage);
  core.registerPage('account', accountPage);
}

/** Live rule ticks on the signup form without re-rendering (keeps focus and the caret). */
function updateRules() {
  const list = document.getElementById('acc-rules');
  if (!list) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = ruleList();
  list.replaceWith(/** @type {Element} */ (tmp.firstElementChild));
}

registerInputs({
  'acc-draft': el => {
    const input = /** @type {HTMLInputElement} */ (el);
    draft[input.id] = input.value;
    if (input.getAttribute('aria-invalid') === 'true') input.setAttribute('aria-invalid', 'false');
    if (input.id.startsWith('acc-su-')) updateRules();
  },
});

/** @param {Element} el */
const formOf = el => /** @type {HTMLElement|null} */ (el instanceof HTMLFormElement ? el : el.closest('form'));

registerActions({
  'acc-home': () => {
    if (stallOpen()) goTo('stalls');
    else goTo('welcome');
  },
  'acc-go': (_el, ds) => {
    if (ds.next) rememberNext(ds.next);
    else if (!ds.keepNext && (ds.page === 'login' || ds.page === 'signup')) rememberNext(pageName() || 'stalls');
    goTo(ds.page || 'stalls');
    window.scrollTo(0, 0);
  },
  'acc-back-stall': () => backToStall(),
  'acc-peek': (el, ds) => {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(ds.for || ''));
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', show ? 'true' : 'false');
    el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    el.innerHTML = `${icon(show ? 'eye-off' : 'eye')}<span>${show ? 'Hide' : 'Show'}</span>`;
  },

  'acc-login': async el => {
    if (busy) return;
    const loginId = val('acc-login-id').trim();
    const password = val('acc-login-pass');
    markInvalid('acc-login-id', false);
    markInvalid('acc-login-pass', false);
    if (!loginId) return fail('acc-login-id', 'Type your login ID.');
    if (!LOGIN_ID_RE.test(loginId)) return fail('acc-login-id', 'That login ID doesn’t look right — 3–60 letters, digits or . _ @ + -');
    if (!password) return fail('acc-login-pass', 'Type your password.');
    setError('');
    setBusy(formOf(el), true, 'Logging in…');
    try {
      const out = await cloudFn('logIn')({loginId, password});
      clearDrafts();
      toast(`Welcome back${out?.user?.name ? `, ${firstName(out.user.name)}` : ''}! 🎉`);
      await returnAfterAuth();
    } catch (err) {
      setBusy(formOf(el), false, '');
      setError(cloudErrText(err));
    } finally {
      busy = false;
    }
  },

  'acc-signup': async el => {
    if (busy) return;
    const name = val('acc-su-name').replace(/\s+/g, ' ').trim();
    const loginId = val('acc-su-id').trim();
    const password = val('acc-su-pass');
    const again = val('acc-su-pass2');
    for (const id of ['acc-su-name', 'acc-su-id', 'acc-su-pass', 'acc-su-pass2']) markInvalid(id, false);
    if (!name) return fail('acc-su-name', 'Tell us your name.');
    if (name.length > NAME_MAX) return fail('acc-su-name', `Keep your name under ${NAME_MAX} letters.`);
    if (!loginId) return fail('acc-su-id', 'Pick a login ID.');
    if (!LOGIN_ID_RE.test(loginId)) return fail('acc-su-id', 'Login ID: 3–60 letters, digits or . _ @ + - (no spaces).');
    if (password.length < 6) return fail('acc-su-pass', 'Password needs at least 6 characters.');
    if (password.length > 100) return fail('acc-su-pass', 'Password is too long (100 characters max).');
    if (password !== again) return fail('acc-su-pass2', 'The two passwords don’t match.');
    setError('');
    setBusy(formOf(el), true, 'Creating…');
    try {
      await cloudFn('signUp')({loginId, password, name});
      clearDrafts();
      toast(`Account ready, ${firstName(name)}! Dhamaka 🎉`);
      await returnAfterAuth();
    } catch (err) {
      setBusy(formOf(el), false, '');
      setError(cloudErrText(err));
    } finally {
      busy = false;
    }
  },

  'acc-join': async el => {
    if (busy) return;
    const code = normalizeCode(val('acc-join-code'));
    const password = val('acc-join-pass');
    markInvalid('acc-join-code', false);
    markInvalid('acc-join-pass', false);
    if (!code) return fail('acc-join-code', 'Type the stall code.');
    if (!CODE_RE.test(code)) return fail('acc-join-code', 'Stall codes look like MYS-7K2QD (5 letters/digits after MYS-).');
    if (!password) return fail('acc-join-pass', 'Type the team password.');
    setError('');
    setBusy(formOf(el), true, 'Joining…');
    try {
      // joinStall downloads the stall; a new copy is opened by the cloud client, an existing one is opened here.
      const out = await cloudFn('joinStall')({code, password});
      clearDrafts();
      const id = out?.entryId || '';
      toast(`You’re on the team${out?.stall?.name ? ` at ${out.stall.name}` : ''}! 🎉`);
      if (!out?.created && id && typeof core.openStallById === 'function') await core.openStallById(id);
      else if (!id) goTo('stalls');
    } catch (err) {
      setBusy(formOf(el), false, '');
      setError(cloudErrText(err));
    } finally {
      busy = false;
    }
  },

  'acc-save-name': async el => {
    const name = val('acc-name').replace(/\s+/g, ' ').trim();
    markInvalid('acc-name', false);
    if (!name) return fail('acc-name', 'Your name can’t be empty.');
    if (name.length > NAME_MAX) return fail('acc-name', `Keep your name under ${NAME_MAX} letters.`);
    setError('');
    setBusy(formOf(el), true, 'Saving…');
    try {
      await cloudFn('updateName')(name);
      delete draft['acc-name'];
      setBusy(formOf(el), false, '');
      toast('Name saved.');
      core.render();
    } catch (err) {
      setBusy(formOf(el), false, '');
      setError(cloudErrText(err));
    } finally {
      busy = false;
    }
  },

  'acc-change-pass': async el => {
    const old = val('acc-old-pass');
    const next = val('acc-new-pass');
    const again = val('acc-new-pass2');
    for (const id of ['acc-old-pass', 'acc-new-pass', 'acc-new-pass2']) markInvalid(id, false);
    if (!old) return fail('acc-old-pass', 'Type your current password.');
    if (next.length < 6) return fail('acc-new-pass', 'New password needs at least 6 characters.');
    if (next.length > 100) return fail('acc-new-pass', 'New password is too long (100 characters max).');
    if (next !== again) return fail('acc-new-pass2', 'The new passwords don’t match.');
    if (next === old) return fail('acc-new-pass', 'Pick a password different from the current one.');
    setError('');
    setBusy(formOf(el), true, 'Changing…');
    try {
      await cloudFn('changePassword')(old, next);
      for (const id of ['acc-old-pass', 'acc-new-pass', 'acc-new-pass2']) delete draft[id];
      setBusy(formOf(el), false, '');
      toast('Password changed. Other phones are logged out.');
      core.render();
    } catch (err) {
      setBusy(formOf(el), false, '');
      setError(cloudErrText(err));
    } finally {
      busy = false;
    }
  },

  'acc-logout': async () => {
    try {
      await cloudFn('logOut')();
    } catch (err) {
      // logOut clears this phone's session even when the server can't be reached.
      console.warn(err);
    }
    clearDrafts();
    toast('Logged out. Your stalls are still on this phone.');
    if (pageName() === 'stalls') core.render();
    else goTo('stalls');
  },
});

/** Show a field error: message in the slot, field marked and focused. @param {string} id @param {string} msg */
function fail(id, msg) {
  markInvalid(id, true);
  setError(msg);
  /** @type {HTMLElement|null} */ (document.getElementById(id))?.focus();
}

function clearDrafts() {
  for (const key of Object.keys(draft)) delete draft[key];
  formError = '';
}

/**
 * "Back to <stall>" button label: the full name where there's room, "My stall" on phones (CSS picks one).
 * @param {string} name
 */
export function backLabel(name) {
  return `<span class="stl-back-long">Back to ${esc(name)}</span><span class="stl-back-short" aria-hidden="true">My stall</span>`;
}
