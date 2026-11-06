// More hub for ManageYourStall (ARCHITECTURE.md §13.9): tiles to every tool, practice/live modes, event setup checklist,
// money & team links (§16.7), admin PIN, install prompt and persistent storage. created by viraj
//
// Public actions: more-practice · more-live. Private: more-event, more-start-live, more-pin, more-pin-save, more-lock,
// more-install, more-persist. Legacy aliases: more-expenses / more-expense-save → money-open (bills live in the money screen).
import {
  store, S, C, ui, esc, money, icon, btn, field, heading, openSheet, closeSheet, sheetEl, sheetKind, toast, commit,
  render, navigate, registerScreen, registerActions, onBoot, requireAdmin, isAdmin, lockAdmin, savePin, runAction,
} from './core.mjs';
import {report, unitPrice, audit, expenseTotals, teamSettlement} from '../domain.mjs';
import {TEMPLATES} from '../templates.mjs';
import {backupHint} from './data.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Device capabilities (install prompt, persistent storage)
// ---------------------------------------------------------------------------------------------------------------------

/** The deferred beforeinstallprompt event (Chrome/Edge/Android), if the browser offered one. @type {any} */
let installPrompt = null;
/** navigator.storage.persisted(): true / false, or null when unknown or unsupported. @type {boolean|null} */
let persisted = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    if (ui.screen === 'more') render();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (ui.screen === 'more') render();
    toast('Installed! Open MYS from your home screen.');
  });
}

const isStandalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  } catch {
    return false;
  }
};

onBoot(async () => {
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    persisted = null;
  }
  if (ui.screen === 'more') render();
});

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

/** '1 item' / '3 items'. @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Visible products that can't be sold yet because they have no price. @param {any} c */
const unpricedActive = c => c.products.filter((/** @type {any} */ p) => p.active && unitPrice(p, c) === null);

/**
 * Bill & contri numbers for the hub tiles (non-void only; totals from the domain layer).
 * @param {any} s @param {any} c
 */
function billStats(s, c) {
  const t = expenseTotals(s);
  let contri = 0;
  try {
    contri = teamSettlement(s, c).totals.contri;
  } catch {
    contri = 0;
  }
  return {
    total: t.total,
    count: t.count,
    restock: t.restock || 0,
    contri,
    contriCount: (Array.isArray(s.contributions) ? s.contributions : []).filter((/** @type {any} */ x) => !x.void).length,
  };
}

/** Run fn after the admin PIN; throws when the prompt is cancelled. @param {() => any} fn */
async function asAdmin(fn) {
  const done = await requireAdmin(async () => {
    await fn();
    return true;
  });
  if (!done) throw Error('The admin PIN is needed for this.');
}

// ---------------------------------------------------------------------------------------------------------------------
// More hub screen
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{key: string, icon: string, title: string, status: string, tone?: ''|'ok'|'warn', action: string, attrs?: string, tint: string}} Tile
 */

/** @param {Tile} t */
function tile(t) {
  const tone = t.tone ? ` is-${t.tone}` : '';
  const toneIcon = t.tone === 'warn' ? icon('alert') : t.tone === 'ok' ? icon('check') : '';
  return `<button type="button" class="more-tile more-tile-${t.tint}" data-action="${esc(t.action)}" data-tile="${esc(t.key)}"${t.attrs ? ' ' + t.attrs : ''}>
    <span class="more-tile-icon">${icon(t.icon)}</span>
    <span class="more-tile-text"><span class="more-tile-title">${t.title}</span><span class="more-tile-status${tone}">${toneIcon}<span>${esc(t.status)}</span></span></span>
    ${icon('chevron-right', 'more-tile-arrow')}
  </button>`;
}

/** @param {string} title @param {string} iconName @param {Tile[]} tiles */
const group = (title, iconName, tiles) =>
  `<section class="more-group" aria-label="${esc(title)}"><h2 class="section-title more-group-title">${icon(iconName)} ${esc(title)}</h2><div class="more-grid">${tiles.map(tile).join('')}</div></section>`;

function moreScreen() {
  const st = store.state;
  const c = C();
  const s = S();
  const r = report(s, c);
  const demo = st.mode === 'demo';
  const active = c.products.filter(p => p.active);
  const unpriced = unpricedActive(c);
  const soldOut = c.products.filter(p => p.active && p.soldOut).length;
  const hint = backupHint();
  const pools = Object.keys(c.stock || {}).length;
  const bills = billStats(s, c);
  const members = Array.isArray(c.team?.members) ? c.team.members.length : 0;
  const themeId = c.theme?.themeId || '';
  const theme = TEMPLATES.find(t => t.id === themeId);

  /** @type {Tile[]} */
  const run = [
    {key: 'themes', icon: 'palette', title: 'Customize My Stall', tint: 'yellow', action: 'studio-open', attrs: 'data-section="themes"',
      status: theme && theme.id !== 'blank' ? `Theme: ${theme.name}` : themeId === 'custom' ? 'Your own custom look' : 'Pick a stall theme & hero photo'},
    {key: 'studio', icon: 'studio', title: 'Stall Studio', tint: 'pink', action: 'studio-open',
      status: [c.profile.stallName, c.profile.booth].filter(Boolean).join(' · ') || 'Name, look, UPI, team'},
    {key: 'menu', icon: 'menu', title: 'Menu manager', tint: 'yellow', action: 'nav', attrs: 'data-screen="menu"',
      status: `${plural(c.products.length, 'item')} · ${plural(c.categories.length, 'category', 'categories')}${soldOut ? ` · ${soldOut} sold out` : ''}`},
    {key: 'prices', icon: 'tag', title: 'Price board', tint: 'lime', action: 'menu-price-board',
      status: unpriced.length ? `${active.length - unpriced.length}/${active.length} priced — set the rest` : `All ${active.length} items priced`,
      tone: unpriced.length ? 'warn' : 'ok'},
    {key: 'games', icon: 'game', title: 'Game corner', tint: 'lavender', action: 'games-open',
      status: c.games.length ? `${plural(c.games.length, 'game')} · ${plural(r.games, 'play')}` : 'No games yet — add ring toss & more'},
    {key: 'stock', icon: 'box', title: 'Stock room', tint: 'sky', action: 'menu-stock',
      status: c.inventory ? `Tracking ${plural(pools, 'stock pool')}` : 'Stock tracking is off'},
  ];
  /** @type {Tile[]} */
  const team = [
    {key: 'money', icon: 'wallet', title: 'Expenses & Team Contri', tint: 'mint', action: 'money-open',
      status: bills.count || bills.contriCount
        ? `${money(bills.total)} in ${plural(bills.count, 'bill')} · ${money(bills.contri)} contri`
        : members ? `${plural(members, 'partner')} · no bills yet` : 'Log bills, contri & the final split'},
    {key: 'restock', icon: 'refresh', title: 'Quick restock bill', tint: 'lime', action: 'money-restock',
      status: bills.restock ? `${money(bills.restock)} restocked so far` : 'Ran out of cheese? Log it in 10 sec'},
    {key: 'collab', icon: 'users', title: 'Stall’s Collab<sup class="more-soon">COMING SOON</sup>', tint: 'lavender', action: 'nav',
      attrs: 'data-screen="collab"', status: 'Team up with the stalls next door'},
    {key: 'report', icon: 'chat', title: 'Day report', tint: 'yellow', action: 'dash-report',
      status: `${money(r.collected)} collected · ${plural(r.orders, 'order')}`},
  ];
  /** @type {Tile[]} */
  const event = [
    demo
      ? {key: 'mode', icon: 'bolt', title: 'Back to live', tint: 'lime', action: 'more-live',
        status: `Practice on · ${plural(s.orders.length, 'practice order')}`, tone: 'warn'}
      : {key: 'mode', icon: 'spark', title: 'Practice counter', tint: 'lavender', action: 'more-practice',
        status: st.demo.orders.length ? `${plural(st.demo.orders.length, 'practice order')} · separate ledger` : 'Dry-run orders · live sales untouched'},
    {key: 'event', icon: 'calendar', title: 'Event setup', tint: 'pink', action: 'more-event',
      status: unpriced.length ? `${plural(unpriced.length, 'item')} still ${unpriced.length === 1 ? 'needs' : 'need'} a price` : st.live.started ? 'Live event running' : 'Ready — start the live event',
      tone: unpriced.length ? 'warn' : st.live.started ? 'ok' : ''},
  ];
  const standalone = isStandalone();
  /** @type {Tile[]} */
  const device = [
    {key: 'backups', icon: 'download', title: 'Backup & exports', tint: 'sky', action: 'data-backups',
      status: hint.text, tone: hint.stale ? 'warn' : 'ok'},
    {key: 'pin', icon: st.pin ? 'lock' : 'unlock', title: 'Admin PIN', tint: 'yellow', action: 'more-pin',
      status: !st.pin ? 'No PIN yet — set one' : isAdmin() ? 'Unlocked for now' : 'PIN set · locked',
      tone: st.pin ? 'ok' : 'warn'},
    {key: 'install', icon: 'phone', title: 'Install app', tint: 'mint', action: 'more-install',
      status: standalone ? 'Installed on this device' : installPrompt ? 'Ready to install — one tap' : 'Add MYS to your home screen',
      tone: standalone ? 'ok' : ''},
    {key: 'persist', icon: 'lock', title: 'Keep data safe', tint: 'lavender', action: 'more-persist',
      status: persisted === true ? 'Browser keeps this data' : persisted === false ? 'Not protected yet — tap to ask' : 'Ask the browser to keep data',
      tone: persisted === true ? 'ok' : persisted === false ? 'warn' : ''},
    {key: 'danger', icon: 'alert', title: 'Danger zone', tint: 'coral', action: 'data-danger',
      status: 'Reset orders or the whole stall'},
  ];

  const right = `<span class="badge ${demo ? 'yellow' : 'lime'} more-mode-badge">${icon(demo ? 'spark' : 'bolt')} ${demo ? 'Practice counter' : 'Live ledger'}</span>`;
  return `${heading('Behind the counter.', 'Every tool for a smooth fest day, one tap away.', right)}
  <div class="more-device">
    <span class="more-device-icon">${icon('phone')}</span>
    <div class="grow">
      <strong>One phone. One ledger.</strong>
      <p>Sales are saved only in this browser on this device — other phones don’t see these totals, and clearing site data wipes them. Back up after every rush.</p>
      <span class="more-device-hint${hint.stale ? ' is-warn' : ''}">${icon(hint.stale ? 'alert' : 'check')} ${esc(hint.text)}</span>
    </div>
    ${btn(`${icon('download')} Back up now`, 'data-backups', 'accent more-device-btn')}
  </div>
  ${group('Run the stall', 'store', run)}
  ${group('Money & team', 'wallet', team)}
  ${group('Event day', 'bolt', event)}
  ${group('Data & this device', 'phone', device)}
  <p class="footnote more-foot">Cashier on the counter: ${esc(c.operator)} · INR (₹) · India time. The admin PIN is a local guard for a shared phone, not a cloud account.</p>`;
}

registerScreen('more', moreScreen);

// ---------------------------------------------------------------------------------------------------------------------
// Practice / live
// ---------------------------------------------------------------------------------------------------------------------

/** @param {'live'|'demo'} mode */
async function switchMode(mode) {
  if (store.state.mode !== mode) {
    await commit(st => {
      st.mode = mode;
    }, {render: false});
  }
  closeSheet();
  navigate('sell');
  toast(mode === 'demo' ? 'Practice counter on. Go wild — live sales are untouched.' : 'Back to your live counter. Let’s make some noise!');
}

// ---------------------------------------------------------------------------------------------------------------------
// Event setup
// ---------------------------------------------------------------------------------------------------------------------

/** @param {boolean} ok @param {string} title @param {string} sub @param {string} [action] */
const checkRow = (ok, title, sub, action = '') =>
  `<div class="more-check${ok ? ' is-ok' : ' is-todo'}"><span class="more-check-mark">${icon(ok ? 'check' : 'alert')}</span><div class="grow"><h3>${title}</h3><small>${sub}</small></div>${action}</div>`;

function eventSheet() {
  const st = store.state;
  const c = C();
  const live = report(st.live, c);
  const missing = unpricedActive(c);
  // Break-even always comes from the domain report: bills in ledger mode, planned + bills otherwise.
  const target = live.mission.target;
  const ledger = (c.mission.mode || live.mission.mode) === 'ledger';
  const demo = st.mode === 'demo';
  const priceRows = missing.length
    ? `<div class="more-missing">${missing.map(p => `<div class="more-missing-row"><span class="grow"><strong>${esc(p.name)}</strong><small>No price yet — set one or hide it</small></span>${btn(`${icon('tag')} Set price`, 'menu-quick-price', 'small', `data-id="${esc(p.id)}"`)}</div>`).join('')}</div>`
    : '';
  const status = st.live.started
    ? `<div class="notice mint">${icon('check')}<div><strong>Your live event is running.</strong> Starting again never erases sales — it just takes you to the live counter.</div></div>`
    : `<div class="notice">${icon('bolt')}<div><strong>Almost showtime.</strong> Try a few practice orders, fix every price, then go live. Practice records never mix with live sales.</div></div>`;
  const body = `${status}
  <div class="more-counts">
    <div class="more-count"><strong>${st.live.orders.length}</strong><small>Live orders</small></div>
    <div class="more-count"><strong>${money(live.collected)}</strong><small>Live collected</small></div>
    <div class="more-count"><strong>${st.demo.orders.length}</strong><small>Practice orders</small></div>
  </div>
  <h3 class="more-sub">Pre-flight checklist</h3>
  ${checkRow(!missing.length, missing.length ? `${plural(missing.length, 'item')} without a price` : 'Every visible item has a price',
    missing.length ? 'Unpriced items can’t be sold. Price them or hide them in the Menu.' : 'Your menu is good to sell.')}
  ${priceRows}
  ${checkRow(!!c.upi.id, c.upi.id ? 'UPI QR ready' : 'No UPI ID yet',
    c.upi.id ? `Customers scan to pay ${esc(c.upi.id)}. Always check your UPI app for the credit.` : 'Cash still works. Add a UPI ID to show a scan-to-pay QR.',
    c.upi.id ? '' : btn('Add UPI', 'studio-open', 'small', 'data-section="upi"'))}
  ${ledger
    ? checkRow(target > 0, target > 0 ? `Break-even from your bills: ${money(target)}` : 'No bills logged yet',
      target > 0 ? 'Every bill you log moves the mission bar. Add restocks as you go.' : 'Log rent, raw material & setup bills so the mission bar knows your break-even.',
      target > 0 ? '' : btn(`${icon('plus')} Add bill`, 'money-add-bill', 'small'))
    : checkRow(target > 0, target > 0 ? `Break-even target ${money(target)}` : 'No investment target yet',
      target > 0 ? 'Planned costs + every bill you log. The mission bar tracks your recovery.' : 'Add your stall costs to see when you hit profit.',
      target > 0 ? '' : btn('Set mission', 'studio-open', 'small', 'data-section="mission"'))}
  ${demo ? checkRow(false, 'You’re on the practice counter', 'Starting the live event switches this phone to the live ledger.') : ''}
  <p class="footnote">Starting the live event never deletes anything. Practice orders stay in their own ledger.</p>`;
  const label = st.live.started ? `${icon('bolt')} Go to live counter` : `${icon('bolt')} Start live event`;
  openSheet('Ready for the big day?', body, btn('Not yet', 'close', 'quiet-outline') + btn(label, 'more-start-live', 'primary', missing.length ? 'disabled' : ''), 'more-event');
}

async function startLive() {
  const missing = unpricedActive(C());
  if (missing.length) {
    throw Error(missing.length === 1
      ? `Set a price for “${missing[0].name}” (or hide it) before going live.`
      : `Set prices for ${missing.length} items (or hide them) before going live.`);
  }
  const first = !store.state.live.started;
  await commit(st => {
    if (unpricedActive(st.config).length) throw Error('Some visible items still have no price.');
    st.live.started = true;
    st.mode = 'live';
    audit(st.live, first ? 'event-started' : 'event-resumed', 'event', st.config.operator, {});
  }, {render: false});
  closeSheet();
  navigate('sell');
  toast(first ? 'You’re live! Let’s make some noise.' : 'Back on the live counter.');
}

// ---------------------------------------------------------------------------------------------------------------------
// Admin PIN
// ---------------------------------------------------------------------------------------------------------------------

function pinSheet() {
  const st = store.state;
  const has = !!st.pin;
  const unlocked = isAdmin();
  const status = !has
    ? `<span class="badge coral">${icon('unlock')} No PIN yet</span>`
    : unlocked ? `<span class="badge yellow">${icon('unlock')} Unlocked</span>` : `<span class="badge lime">${icon('lock')} Locked</span>`;
  const pinField = (/** @type {string} */ label, /** @type {string} */ name) =>
    field(label, name, '', 'password', 'inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="off" class="more-pin-input"');
  const body = `<div class="more-pin-status">${status}<p>${has
    ? 'Menu edits, corrections, expenses, restores and resets ask for this PIN. It stays unlocked for 10 minutes after each admin step.'
    : 'Set a 4–8 digit PIN so cashiers can sell freely while menu edits, refunds and resets stay with you.'}</p></div>
  <form class="more-pin-form" data-submit="more-pin-save">
    <div class="form-grid">
      ${pinField(has ? 'New PIN' : 'PIN', 'more-pin-new')}
      ${pinField('Repeat PIN', 'more-pin-repeat')}
    </div>
  </form>
  <div class="notice">${icon('info')}<div><strong>No remote recovery.</strong> No email, no OTP — the PIN lives only on this phone. Forget it and the only way back is clearing this browser’s site data, which wipes the stall. Keep backups.</div></div>
  ${has && unlocked ? `<div class="more-pin-lock"><span class="grow">Leaving the counter?</span>${btn(`${icon('lock')} Lock admin now`, 'more-lock', 'small')}</div>` : ''}`;
  openSheet('Admin PIN', body, btn('Close', 'close', 'quiet-outline') + btn(`${icon('check')} ${has ? 'Save new PIN' : 'Set PIN'}`, 'more-pin-save', 'primary'), 'more-pin');
}

async function savePinFromSheet() {
  const form = sheetEl()?.querySelector('.more-pin-form');
  if (!form) return;
  const pin = /** @type {HTMLInputElement} */ (form.querySelector('[name="more-pin-new"]'))?.value ?? '';
  const repeat = /** @type {HTMLInputElement} */ (form.querySelector('[name="more-pin-repeat"]'))?.value ?? '';
  if (!/^\d{4,8}$/.test(pin.trim())) throw Error('Use 4 to 8 digits for the PIN.');
  if (pin.trim() !== repeat.trim()) throw Error('The two PINs don’t match. Type the same PIN twice.');
  const had = !!store.state.pin;
  if (had) await asAdmin(() => savePin(pin, repeat));
  else await savePin(pin, repeat);
  closeSheet();
  toast(had ? 'New PIN saved. Remember it — there’s no remote reset.' : 'PIN set. Admin tools are guarded now.');
}

// ---------------------------------------------------------------------------------------------------------------------
// Install & storage
// ---------------------------------------------------------------------------------------------------------------------

async function install() {
  if (installPrompt) {
    const ev = installPrompt;
    installPrompt = null;
    await ev.prompt();
    const choice = await ev.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') toast('Installing… open MYS from your home screen.');
    else toast('No worries — you can install it later from here.', {tone: 'warn'});
    if (ui.screen === 'more') render();
    return;
  }
  const done = isStandalone();
  const body = `${done ? `<div class="notice mint">${icon('check')}<div><strong>You’re already in the installed app.</strong> Nice — it opens full-screen and works offline.</div></div>` : ''}
  <div class="more-steps">
    <div class="more-step"><span class="more-step-badge">${icon('phone')}</span><div><h3>Android · Chrome</h3><p>Tap the <b>⋮</b> menu (top right) → <b>Install app</b> or <b>Add to Home screen</b>.</p></div></div>
    <div class="more-step"><span class="more-step-badge">${icon('share')}</span><div><h3>iPhone · Safari</h3><p>Tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.</p></div></div>
    <div class="more-step"><span class="more-step-badge">${icon('grid')}</span><div><h3>Laptop · Chrome / Edge</h3><p>Click the install icon at the right end of the address bar.</p></div></div>
  </div>
  <p class="footnote">Open it online once so it caches, then it runs offline. Stick to the same browser — a different browser or phone starts with an empty ledger.</p>`;
  openSheet('Put MYS on your home screen', body, btn('Got it', 'close', 'primary'), 'more-install');
}

async function persist() {
  const storage = navigator.storage;
  if (!storage?.persist) {
    toast('This browser can’t promise to keep data. Download backups often.', {tone: 'warn'});
    return;
  }
  let ok = false;
  try {
    ok = await storage.persist();
  } catch {
    ok = false;
  }
  persisted = ok;
  if (ui.screen === 'more') render();
  if (ok) toast('Done — the browser won’t auto-clear your stall data. Keep downloading backups anyway.');
  else toast('The browser said “not yet” (it decides; installing the app helps). Keep downloading backups.', {tone: 'warn'});
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

registerActions(
  {
    'more-practice': () => switchMode('demo'),
    'more-live': () => switchMode('live'),
    'more-event': () => eventSheet(),
    'more-start-live': () => startLive(),
    // Phase-1 names kept as aliases: bills now live in the money screen (no PIN needed to add one).
    'more-expenses': () => runAction('money-open'),
    'more-expense-save': () => runAction('money-open'),
    'more-pin': () => pinSheet(),
    'more-pin-save': () => savePinFromSheet(),
    'more-lock': () => {
      lockAdmin();
      if (sheetKind() === 'more-pin') pinSheet();
      render();
      toast('Admin locked. The PIN is needed for the next admin change.');
    },
    'more-install': () => install(),
    'more-persist': () => persist(),
  },
  {admin: ['more-start-live']},
);
