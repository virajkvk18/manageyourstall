// MYS landing page — `#/welcome` (ARCHITECTURE.md §17.5). created by viraj
//
// A loud, joyful Neo-Brutalist marketing page for stall owners at college fests and melas. It renders full screen,
// outside the stall shell, through the kernel's registerPage (§17.2). The page is static apart from one fact read
// from the device: whether this phone already keeps stalls (storage meta), which shows the "Your stalls" button.
//
// Navigation uses real hash links (`#/setup`, `#/login`, `#/stalls`, `#/join`) that also carry data-action="land-go",
// so the kernel's goPage() renders the page straight away; without goPage the hash alone routes.
// No fake testimonials, no fake numbers: every claim below is something MYS does today (or is labelled COMING SOON).
import * as core from './core.mjs';
import * as storage from '../storage.mjs';
import {esc} from '../util.mjs';
import {icon} from '../icons.mjs';
import {artSvg, heroSvg} from '../library.mjs';
import {TEMPLATES} from '../templates.mjs';
import {BRAND} from '../constants.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Content (static copy)
// ---------------------------------------------------------------------------------------------------------------------

/** Short theme names for the feature card chips (TEMPLATES ids → label). Unknown ids fall back to the template name. */
const THEME_SHORT = Object.freeze({
  'street-chaat': 'Chaat',
  'snacks-pizza': 'Pizza & Fizz',
  'chai-maggi': 'Chai & Maggi',
  'momo-corner': 'Momos',
  'sweet-tooth': 'Desserts',
  'drinks-games': 'Mela games',
});

/** The six ready stall themes (blank is not a theme). */
const THEMES = TEMPLATES.filter(t => t.id !== 'blank').slice(0, 6);

/** Floating stickers around the hero card: library art id, position (% of the stage), tilt, size class, tint. */
const STICKERS = Object.freeze([
  {art: 'samosa', x: 2, y: 4, r: -12, size: 'lg', tint: 'yellow'},
  {art: 'steamed-momos', x: 72, y: 0, r: 10, size: 'lg', tint: 'mint'},
  {art: 'kulfi', x: 78, y: 40, r: 14, size: 'md', tint: 'pink'},
  {art: 'cold-coffee', x: 0, y: 58, r: -8, size: 'md', tint: 'sky'},
  {art: 'ring-toss', x: 52, y: 76, r: 8, size: 'md', tint: 'lavender'},
  {art: 'french-fries', x: 20, y: 80, r: -6, size: 'sm', tint: 'coral'},
  {art: 'gulab-jamun', x: 40, y: 0, r: 6, size: 'sm', tint: 'lime'},
]);

/** Feature grid. `art` is a small library sticker drawn on the card corner. */
const FEATURES = Object.freeze([
  {
    key: 'themes',
    icon: 'palette',
    tint: 'yellow',
    art: 'pani-puri',
    title: '6 stall themes',
    text: 'Chaat, pizza, chai, momos, desserts or mela games — pick one and get a starter menu with suggested prices. Tweak everything.',
  },
  {
    key: 'upi',
    icon: 'qr',
    tint: 'pink',
    art: 'lime-can',
    title: 'UPI QR checkout',
    text: 'Your own UPI QR with the exact amount filled in. Cash change maths done for you. Split cash + UPI in one tap.',
  },
  {
    key: 'tokens',
    icon: 'ticket',
    tint: 'mint',
    art: 'maggi',
    title: 'Tokens & kitchen queue',
    text: 'Every order gets a token. The kitchen sees what to make next, you call out “Ready!” — no chaos at the counter.',
  },
  {
    key: 'money',
    icon: 'users',
    tint: 'sky',
    art: 'combo-triple',
    title: 'Bills + team payouts',
    text: 'Snap every bill, track who put in how much, and split the profit fair and square when the fest ends.',
  },
  {
    key: 'offline',
    icon: 'wifi-off',
    tint: 'lavender',
    art: 'chips-packet',
    title: 'Works offline',
    text: 'Every sale saves on your phone first. Ground full of people and zero signal? Keep billing, no tension.',
  },
  {
    key: 'report',
    icon: 'share',
    tint: 'lime',
    art: 'masala-chai',
    title: 'WhatsApp day report',
    text: 'One tap at closing time: sales, cash vs UPI, best sellers — straight to your team group.',
  },
]);

/** "How it works" steps. */
const STEPS = Object.freeze([
  {no: '01', tint: 'yellow', art: 'crispy-corn', title: 'Set up your stall', text: 'Name it, pick a theme, add your UPI ID. Stall number? Optional.'},
  {no: '02', tint: 'pink', art: 'frankie-roll', title: 'Sell like crazy', text: 'Tap items, take Cash or UPI, hand out tokens. Rush hour, handled.'},
  {no: '03', tint: 'mint', art: 'brownie-sundae', title: 'Count the paisa', text: 'Day report, bills and team payouts — everyone knows their share.'},
]);

/** Marquee words (two crossing tapes). */
const TAPE_A = Object.freeze(['Pani puri', 'Momos', 'Masala chai', 'Maggi', 'Cold coffee', 'Ring toss', 'Kulfi', 'Frankie', 'Pizza']);
const TAPE_B = Object.freeze(['College fests', 'Diwali melas', 'Flea markets', 'Pop-ups', 'Food courts', 'Night bazaars']);

// ---------------------------------------------------------------------------------------------------------------------
// Device facts: does this phone keep any stalls? (storage meta, §17.1)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Our own latest read of the storage meta: the stall count and the kernel meta object current at that moment. It only
 * overrides the kernel's in-memory `store.meta` until the kernel replaces that object (then the kernel is fresher).
 * @type {{count: number, kernelMeta: any} | null}
 */
let lastRead = null;
let reading = false;

/** The kernel's in-memory stalls index (§17.2 `store.meta`), if any. */
const kernelMeta = () => /** @type {any} */ (core.store)?.meta ?? null;

/** @param {any} meta @returns {number|null} */
const countOf = meta => (meta && Array.isArray(meta.stalls) ? meta.stalls.length : null);

/** How many stalls this device keeps (best current knowledge; 0 when unknown). */
function deviceStalls() {
  const km = kernelMeta();
  if (lastRead && (lastRead.kernelMeta === km || countOf(km) === null)) return lastRead.count;
  return countOf(km) ?? lastRead?.count ?? 0;
}

/** Re-read the storage meta in the background; re-render the welcome page when the shown count would change. */
function refreshStallCount() {
  const getMeta = /** @type {any} */ (storage).getMeta;
  if (reading || typeof getMeta !== 'function') return;
  reading = true;
  const shown = deviceStalls();
  Promise.resolve()
    .then(() => getMeta())
    .then(meta => {
      lastRead = {count: countOf(meta) ?? 0, kernelMeta: kernelMeta()};
      if (deviceStalls() !== shown && typeof document !== 'undefined' && document.querySelector('#app .land')) core.render();
    })
    .catch(err => console.warn('Could not read the stalls list', err))
    .finally(() => {
      reading = false;
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A routing link: a real hash href plus data-action="land-go" (kernel goPage when present).
 * @param {string} page outside page name (setup, login, stalls, join)
 * @param {string} label trusted markup
 * @param {string} cls classes
 * @param {string} [cta] data-land-cta marker for tests/analytics-free hooks
 */
const go = (page, label, cls, cta = page) =>
  `<a href="#/${esc(page)}" class="${esc(cls)}" data-action="land-go" data-page="${esc(page)}" data-land-cta="${esc(cta)}">${label}</a>`;

/** The MYS sticker mark with its permanent credit. @param {'giant'|'mini'} size */
const mark = size => `<span class="land-mark land-mark-${size}" aria-hidden="true">${esc(BRAND.short)}</span>`;

function topBar() {
  return `<header class="land-top">
    <a href="#/welcome" class="land-top-brand" data-action="land-top" aria-label="${esc(BRAND.name)} home">
      ${mark('mini')}
      <span class="land-top-words">
        <strong>${esc(BRAND.name)}</strong>
        <span class="credit-badge">${esc(BRAND.credit)}</span>
      </span>
    </a>
    <nav class="land-top-links" aria-label="Account">
      ${go('join', 'Join a team', 'land-link land-top-join', 'top-join')}
      ${go('login', 'Log in', 'land-btn land-btn-paper land-btn-sm', 'top-login')}
    </nav>
  </header>`;
}

function collage() {
  const stickers = STICKERS.map((s, i) => `<span class="land-sticker land-s-${s.size} land-t-${s.tint}"
      style="--x:${s.x}%;--y:${s.y}%;--r:${s.r}deg;--d:${(i * 0.55).toFixed(2)}s">${artSvg(s.art, 'land-sticker-art')}</span>`).join('');
  return `<div class="land-collage" aria-hidden="true">
    <div class="land-stage">
      <div class="land-hero-card">
        <span class="land-hero-tag">Today’s menu</span>
        ${heroSvg(['pani-puri', 'cheese-pizza', 'kulhad-chai'], {cls: 'land-hero-art'})}
      </div>
      ${stickers}
      <span class="land-chip land-chip-token">${icon('ticket')}<span>Token <b>A-07</b> · Ready!</span></span>
      <span class="land-chip land-chip-upi">${icon('qr')}<span>UPI · Cash · Split</span></span>
      <span class="land-chip land-chip-off">${icon('wifi-off')}<span>Saved on phone</span></span>
      <span class="land-burst"><span>Fest<br>ready!</span></span>
    </div>
  </div>`;
}

function hero(stalls) {
  const yours = stalls > 0
    ? go('stalls', `${icon('store')}<span>Your stalls <span class="land-count">${stalls}</span></span>`, 'land-btn land-btn-yellow', 'stalls')
    : '';
  return `<section class="land-hero" aria-labelledby="land-title">
    <div class="land-hero-copy">
      <div class="land-logo">
        ${mark('giant')}
        <span class="land-logo-side">
          <span class="land-logo-word">${esc(BRAND.name)}</span>
          <span class="credit-badge land-credit">${esc(BRAND.credit)}</span>
        </span>
      </div>
      <p class="land-eyebrow"><span>🎪</span> The stall app for fests &amp; melas</p>
      <h1 id="land-title" class="land-title">Your stall.<br>Full <span class="land-hl">dhamaka</span> mode.</h1>
      <p class="land-sub">Billing, UPI QR, tokens, kitchen queue, bills and team hisaab — all on one phone. Even when the fest network ghosts you.</p>
      <div class="land-ctas">
        ${go('setup', '<span>Start my stall</span> <span class="land-arrow" aria-hidden="true">→</span>', 'land-btn land-btn-primary land-btn-xl', 'start')}
        <div class="land-cta-row">
          ${yours}
          ${go('login', `${icon('user')}<span>Log in</span>`, 'land-btn land-btn-paper', 'login')}
          ${go('join', `${icon('users')}<span>Join a team stall</span>`, 'land-btn land-btn-sky', 'join')}
        </div>
      </div>
      <p class="land-note">${icon('check')}<span>No account needed to start — your stall lives on this phone.</span></p>
    </div>
    ${collage()}
  </section>`;
}

/** @param {readonly string[]} words @param {string} cls */
function tape(words, cls) {
  const run = words.map(w => `<span>${esc(w)}</span><i aria-hidden="true">✦</i>`).join('');
  return `<div class="land-tape ${cls}"><div class="land-tape-track"><div class="land-tape-run">${run}</div>` +
    `<div class="land-tape-run" aria-hidden="true">${run}</div></div></div>`;
}

function marquee() {
  return `<section class="land-marquee" aria-label="Made for every kind of stall">
    ${tape(TAPE_A, 'land-tape-a')}
    ${tape(TAPE_B, 'land-tape-b')}
  </section>`;
}

function themeChips() {
  return `<ul class="land-theme-chips" aria-label="Stall themes">${THEMES.map(t =>
    `<li style="--chip:${esc(t.accent || '#ffdd35')}"><span aria-hidden="true">${esc(t.emoji || '✨')}</span>${esc(THEME_SHORT[t.id] || t.name)}</li>`).join('')}</ul>`;
}

function features() {
  const cards = FEATURES.map(f => `<li class="land-feat land-t-${f.tint}" data-feature="${f.key}">
      <span class="land-feat-icon">${icon(f.icon)}</span>
      ${artSvg(f.art, 'land-feat-art')}
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.text)}</p>
      ${f.key === 'themes' ? themeChips() : ''}
    </li>`).join('');
  return `<section class="land-section land-features" aria-labelledby="land-feat-title">
    <p class="land-kicker">What’s inside</p>
    <h2 id="land-feat-title" class="land-h2">Everything your counter needs. <span class="land-hl-2">Nothing it doesn’t.</span></h2>
    <ul class="land-feat-grid">${cards}</ul>
  </section>`;
}

function steps() {
  const items = STEPS.map(s => `<li class="land-step land-t-${s.tint}">
      <span class="land-step-no">${s.no}</span>
      ${artSvg(s.art, 'land-step-art')}
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.text)}</p>
    </li>`).join('');
  return `<section class="land-section land-how" aria-labelledby="land-how-title">
    <p class="land-kicker">How it works</p>
    <h2 id="land-how-title" class="land-h2">Three steps. <span class="land-hl-2">Zero drama.</span></h2>
    <ol class="land-steps">${items}</ol>
  </section>`;
}

function collab() {
  return `<section class="land-section land-collab" aria-labelledby="land-collab-title">
    <div class="land-collab-card">
      <div class="land-collab-copy">
        <span class="land-soon">Coming soon</span>
        <h2 id="land-collab-title" class="land-h2">Stall’s Collab</h2>
        <p class="land-collab-line">Stalls that team up, <mark>sell out.</mark></p>
        <p>Neighbouring stalls sharing crowds, cutting combo deals and rescuing each other mid-rush. We’re still building it — nothing to sign up for yet.</p>
      </div>
      <div class="land-collab-art" aria-hidden="true">
        <span class="land-collab-bubble land-t-mint">${artSvg('fried-momos', 'land-collab-svg')}</span>
        <span class="land-collab-plus">+</span>
        <span class="land-collab-bubble land-t-pink">${artSvg('lassi', 'land-collab-svg')}</span>
      </div>
    </div>
  </section>`;
}

function finalCta(stalls) {
  return `<section class="land-final" aria-labelledby="land-final-title">
    <h2 id="land-final-title" class="land-final-title">Ready to make some noise?</h2>
    <p>Set up in a few taps. Your first sale could be minutes away.</p>
    <div class="land-final-ctas">
      ${go('setup', '<span>Start my stall</span> <span class="land-arrow" aria-hidden="true">→</span>', 'land-btn land-btn-primary land-btn-xl', 'final-start')}
      ${stalls > 0 ? go('stalls', `${icon('store')}<span>Your stalls</span>`, 'land-btn land-btn-paper', 'final-stalls') : ''}
    </div>
  </section>`;
}

function footer(stalls) {
  return `<footer class="land-foot">
    <div class="land-foot-brand">
      ${mark('mini')}
      <span class="land-foot-words">
        <strong>${esc(BRAND.name)}</strong>
        <span class="credit-badge">${esc(BRAND.credit)}</span>
      </span>
    </div>
    <ul class="land-honest" aria-label="Straight talk">
      <li>${icon('wifi-off')}<span><b>Offline-first.</b> Every sale saves on your phone first — no internet needed at the counter.</span></li>
      <li>${icon('lock')}<span><b>Your data, your phone.</b> It stays on this phone unless you save it to your MYS account. Cloud sync needs internet.</span></li>
      <li>${icon('upi')}<span><b>Honest money.</b> MYS shows your UPI QR but never verifies bank payments — always check your UPI app.</span></li>
    </ul>
    <nav class="land-foot-links" aria-label="More">
      ${go('setup', 'Start my stall', 'land-link', 'foot-start')}
      ${go('login', 'Log in', 'land-link', 'foot-login')}
      ${go('join', 'Join a team stall', 'land-link', 'foot-join')}
      ${stalls > 0 ? go('stalls', 'Your stalls', 'land-link', 'foot-stalls') : ''}
    </nav>
    <p class="land-foot-fine">Made for college fests, Diwali melas, flea markets &amp; pop-ups across India.</p>
  </footer>`;
}

/**
 * The whole landing page markup (full screen, outside the stall shell).
 * @returns {string}
 */
export function renderLanding() {
  /** @type {any} */ (core).installArtSprite?.();
  refreshStallCount();
  const stalls = deviceStalls();
  return `<div class="land" data-page="welcome">
    <div class="land-wrap">
      ${topBar()}
      ${hero(stalls)}
    </div>
    ${marquee()}
    <div class="land-wrap">
      ${features()}
      ${steps()}
      ${collab()}
    </div>
    ${finalCta(stalls)}
    <div class="land-wrap">${footer(stalls)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration (kernel API lands in §17.2; feature-detected so this module never breaks boot)
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} page */
function goPage(page) {
  const fn = /** @type {any} */ (core).goPage;
  if (typeof fn === 'function') return fn(page);
  location.hash = `#/${page}`;
  window.scrollTo(0, 0);
}

core.registerActions({
  'land-go': (_el, ds) => goPage(String(ds.page || 'welcome')),
  'land-top': () => window.scrollTo({top: 0, behavior: 'smooth'}),
});

const registerPage = /** @type {any} */ (core).registerPage;
if (typeof registerPage === 'function') registerPage('welcome', renderLanding);
