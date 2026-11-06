// Expenses & Team Contri (ARCHITECTURE.md §16.7) — owner: money agent.
//
// Screen 'money' with three tabs:
//   Bills       — every stall bill (pre-stall setup, mid-stall restock…), who paid it, bill photos, the live break-even.
//   Team        — partners' leaderboard (contri + bills paid = money put in) and the contri ledger.
//   Settlement  — the end-of-stall fair split: capital back first, then profit by share, one payout card per partner.
// All money math lives in domain.mjs (expenseTotals, teamSettlement, settlementText…); this module only renders and commits.
// Adding a bill needs NO PIN (speed at the counter); editing/voiding bills, recording/voiding contri and saving a settlement
// snapshot are admin actions.
import {
  C, S, esc, money, paise, icon, btn, date, time, registerScreen, registerActions, registerChanges,
  openSheet, closeSheet, sheetEl, sheetKind, confirmSheet, toast, commit, commitConfig, navigate, render, mediaUrl,
  saveImageDataUrl, isAdmin, requireAdmin, store,
} from './core.mjs';
import {
  addExpense, updateExpense, voidExpense, addContribution, voidContribution, expenseTotals, teamSettlement, settlementText,
  saveSettlement, report, uuid,
} from '../domain.mjs';
import {saveMission} from '../catalog.mjs';
import {EXPENSE_CATEGORIES, RESTOCK_SUGGESTIONS, LIMITS, DRAWER, TINT_IDS} from '../constants.mjs';
import {initialsOf} from '../util.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Module state (transient UI only — every record lives in the persisted state)
// ---------------------------------------------------------------------------------------------------------------------

const TABS = /** @type {const} */ (['bills', 'team', 'settle']);
const TAB_LABELS = {
  bills: '<span class="money-tab-emoji" aria-hidden="true">📒</span>Bills',
  team: '<span class="money-tab-emoji" aria-hidden="true">👥</span>Team',
  settle: '<span class="money-tab-emoji" aria-hidden="true">🤝</span>Settlement',
};
const TAB_KEY = 'mys-money-tab';

/** @type {'bills'|'team'|'settle'} */
let tab = readTab();
/** Bill category filter ('all' or a category id). */
let filter = 'all';

/**
 * Open add/edit-bill draft (chip choices + photo; text fields are read from the form on save).
 * @type {null | {id: string, mode: 'bill'|'restock'|'edit', editId: string, category: string, method: 'Cash'|'UPI',
 *   paidBy: string, photoData: string, photoRef: string, keepImage: string|null, busy: boolean}}
 */
let bill = null;

/** Open record-contri draft. @type {null | {id: string, memberId: string, method: 'Cash'|'UPI'}} */
let contri = null;

function readTab() {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return /** @type {any} */ (TABS.includes(/** @type {any} */ (v)) ? v : 'bills');
  } catch {
    return 'bills';
  }
}

/** @param {string} next */
function setTab(next) {
  if (!TABS.includes(/** @type {any} */ (next))) return;
  tab = /** @type {any} */ (next);
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // private mode / blocked storage: the tab just isn't remembered across reloads
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

const CAT = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]));
/** @param {string} id */
const catOf = id => CAT[id] || CAT.misc || {id: 'misc', label: 'Misc', emoji: '🧾'};
/** Short chip labels for the category filter / picker. */
const CAT_SHORT = {'pre-stall': 'Pre-stall', restock: 'Restock', rent: 'Rent', packaging: 'Packaging', decor: 'Decor', misc: 'Misc'};
/** @param {string} id */
const catShort = id => CAT_SHORT[/** @type {keyof typeof CAT_SHORT} */ (id)] || catOf(id).label;

/** @returns {any[]} */
const members = () => (Array.isArray(C().team?.members) ? C().team.members : []);
/** @param {string} id */
const memberById = id => members().find(m => m.id === id);
/** @param {string} color */
const tintOf = color => (TINT_IDS.includes(color) ? color : 'cream');
/** @returns {any[]} */
const bills = () => (Array.isArray(S().expenses) ? S().expenses : []);
/** @returns {any[]} */
const contris = () => (Array.isArray(S().contributions) ? S().contributions : []);
/** @returns {any[]} */
const snapshots = () => (Array.isArray(S().settlements) ? S().settlements : []);

/** Newest first. @param {any[]} list */
const newestFirst = list => list.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

/** Signed money: +₹120 / −₹2,300. @param {number} p */
const signed = p => (p >= 0 ? `+${money(p)}` : `−${money(-p)}`);

/** Whole percent, floored, never negative. @param {number} n */
const pct = n => `${Math.max(0, Math.floor(Number(n) || 0))}%`;

/** Bar width 0–100 (tiny non-zero values stay visible). @param {number} v @param {number} max */
const bar = (v, max) => (max > 0 && v > 0 ? Math.max(3, Math.min(100, (v / max) * 100)) : 0);

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Partner avatar (initials on their colour) or the stall drawer.
 * @param {string} payer member id | 'drawer'
 * @param {string} [cls]
 */
function avatar(payer, cls = '') {
  if (payer === DRAWER) return `<span class="money-av money-av-drawer${cls ? ' ' + cls : ''}" aria-hidden="true">${icon('cash')}</span>`;
  const m = memberById(payer);
  if (!m) return `<span class="money-av tint-cream${cls ? ' ' + cls : ''}" aria-hidden="true">?</span>`;
  return `<span class="money-av tint-${tintOf(m.color)}${cls ? ' ' + cls : ''}" aria-hidden="true">${esc(initialsOf(m.name).slice(0, 2) || '?')}</span>`;
}

/** @param {string} payer */
const payerName = payer => (payer === DRAWER ? 'Stall cash drawer' : memberById(payer)?.name || 'Ex-partner');
/** @param {string} payer */
const payerShort = payer => (payer === DRAWER ? 'Drawer' : memberById(payer)?.name || 'Ex-partner');

/** Big tile used on the Bills header and the settlement board. */
function tile(label, value, sub = '', cls = '') {
  return `<div class="money-tile${cls ? ' ' + cls : ''}"><span class="money-tile-label">${label}</span><strong class="money-tile-value">${value}</strong>${sub ? `<span class="money-tile-sub">${sub}</span>` : ''}</div>`;
}

/** Progress bar (base .progress). @param {number} percent @param {string} label @param {string} [cls] */
function progress(percent, label, cls = '') {
  const w = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="progress${cls ? ' ' + cls : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(w)}"><div class="progress-fill" style="width:${w.toFixed(2)}%"></div></div>`;
}

/** Guess a bill category from a mission suggestion label. @param {string} label */
function guessCategory(label) {
  const t = String(label || '').toLowerCase();
  if (/rent|registration|booth|stall fee|entry/.test(t)) return 'rent';
  if (/plate|packag|cup|disposable|tissue|foil|bag|box/.test(t)) return 'packaging';
  if (/banner|decor|light|poster|flex/.test(t)) return 'decor';
  if (/restock|refill|extra/.test(t)) return 'restock';
  if (/helper|transport|misc|other/.test(t)) return 'misc';
  return 'pre-stall';
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function tabsBar() {
  return `<div class="segmented block money-tabs" role="tablist" aria-label="Money sections">${TABS.map(t =>
    `<button type="button" role="tab" class="${t === tab ? 'active' : ''}" aria-selected="${t === tab}" data-action="money-tab" data-tab="${t}">${TAB_LABELS[t]}</button>`,
  ).join('')}</div>`;
}

function screen() {
  const demo = store.state.mode === 'demo'
    ? `<p class="notice money-demo">${icon('info')}<span>Practice ledger — bills and contri here stay separate from your live stall.</span></p>`
    : '';
  const body = tab === 'team' ? teamTab() : tab === 'settle' ? settleTab() : billsTab();
  return `<div class="money-screen">
    <div class="money-head">
      <div class="money-head-text">
        <span class="eyebrow">Paisa ka hisaab</span>
        <h1>Expenses &amp; Team Contri</h1>
        <p>Every bill, every rupee the team put in, and a fair payout at the end. No drama.</p>
      </div>
      <div class="money-head-actions">
        ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'primary money-head-add')}
      </div>
    </div>
    ${demo}
    ${tabsBar()}
    <div class="money-tab-body" data-money-tab="${tab}">${body}</div>
  </div>`;
}

// --- Bills -------------------------------------------------------------------------------------------------------------

function breakEvenBanner() {
  const r = report(S(), C());
  const m = /** @type {any} */ (r.mission);
  const ledger = (m.mode || C().mission?.mode) === 'ledger';
  const billsTotal = m.bills ?? r.expenses;
  if (ledger) {
    const head = `<div class="money-be-top"><span class="badge ink">Break-even</span><strong class="money-be-line">Break-even = all bills · <span class="money-be-target">${money(m.target)}</span></strong></div>`;
    if (!m.hasTarget) {
      return `<section class="money-be panel" aria-label="Break-even">${head}<p class="money-be-sub">Add your first bill — the break-even builds itself from your bills.</p></section>`;
    }
    const status = m.profitMode
      ? `<span class="badge lime">PROFIT MODE 🔥</span> <strong>${signed(m.profit)}</strong> over break-even`
      : `<strong>${money(m.remaining)}</strong> more sales to break even`;
    return `<section class="money-be panel${m.profitMode ? ' is-profit' : ''}" aria-label="Break-even">${head}
      <div class="money-be-progress">${progress(m.percent, 'Collected towards break-even')}<span class="money-be-pct">${pct(m.recovery)}</span></div>
      <p class="money-be-sub"><strong>${money(m.collected)}</strong> collected of ${money(m.target)} · ${status}</p>
    </section>`;
  }
  const planned = m.planned ?? m.investment;
  return `<section class="money-be panel is-planned" aria-label="Break-even">
    <div class="money-be-top"><span class="badge yellow">Planned target</span><strong class="money-be-line">Your break-even uses a planned ${money(planned)} + these bills</strong></div>
    <p class="money-be-sub">${money(planned)} planned + ${money(billsTotal)} bills = <strong class="money-be-target">${money(m.target)}</strong>. Logging every bill here? Let the bills <em>be</em> the break-even so nothing is counted twice.</p>
    <div class="money-be-actions">${btn(`${icon('target')} Use my bills as the break-even`, 'money-ledger-mode', 'yellow')}</div>
  </section>`;
}

function quickAddChips() {
  const c = C();
  if (c.mission?.mode !== 'ledger') return '';
  const items = Array.isArray(c.mission.items) ? c.mission.items : [];
  if (!items.length) return '';
  const titles = new Set(bills().filter(e => !e.void).map(e => String(e.title || '').toLowerCase()));
  const chips = items.slice(0, 12).map((it, i) => {
    const done = titles.has(String(it.label).toLowerCase());
    return `<button type="button" class="chip money-quick${done ? ' is-done' : ''}" data-action="money-quick" data-idx="${i}">${done ? `${icon('check')} ` : `${icon('plus')} `}<span>${esc(it.label)}</span>${it.amount > 0 ? `<span class="money-quick-amt">${money(it.amount)}</span>` : ''}</button>`;
  }).join('');
  return `<section class="money-quickadd" aria-label="Quick-add bills"><h2 class="section-title">${icon('bolt')} Quick-add your usual bills</h2><div class="money-chip-row">${chips}</div></section>`;
}

function billRow(/** @type {any} */ e) {
  const cat = catOf(e.category);
  const src = e.billImage ? mediaUrl(e.billImage) : '';
  const thumb = src
    ? `<span class="money-thumb"><img src="${esc(src)}" alt="Bill photo" loading="lazy" decoding="async"></span>`
    : `<span class="money-thumb money-thumb-empty" aria-hidden="true">${cat.emoji}</span>`;
  const notes = e.notes ? `<span class="money-row-notes">${esc(e.notes.length > 70 ? `${e.notes.slice(0, 70).trim()}…` : e.notes)}</span>` : '';
  return `<li><button type="button" class="money-row${e.void ? ' is-void' : ''}" data-action="money-bill" data-id="${esc(e.id)}">
    ${thumb}
    <span class="money-row-main">
      <span class="money-row-title">${esc(e.title)}</span>
      <span class="money-row-meta"><span class="money-cat cat-${esc(cat.id)}">${cat.emoji} ${esc(catShort(cat.id))}</span><span class="money-method">${e.method === 'UPI' ? icon('upi') : icon('cash')}${esc(e.method)}</span>${e.void ? '<span class="badge ink">VOID</span>' : ''}</span>
      ${notes}
    </span>
    <span class="money-row-side">
      <strong class="money-row-amt">${money(e.amount)}</strong>
      <span class="money-row-payer">${avatar(e.paidBy, 'sm')}<span>${esc(payerShort(e.paidBy))}</span></span>
      <span class="money-row-time">${esc(time(e.at))}</span>
    </span>
  </button></li>`;
}

function billsTab() {
  const et = expenseTotals(S());
  const drawer = et.byPayer?.[DRAWER] || 0;
  const byMembers = et.total - drawer;
  const all = newestFirst(bills());
  const counts = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, 0]));
  for (const e of all) if (!e.void && e.category in counts) counts[e.category]++;
  const shown = filter === 'all' ? all : all.filter(e => e.category === filter);
  const filterChips = [`<button type="button" class="chip${filter === 'all' ? ' active' : ''}" data-action="money-filter" data-cat="all" aria-pressed="${filter === 'all'}">All <span class="money-count">${all.length}</span></button>`]
    .concat(EXPENSE_CATEGORIES.map(c => `<button type="button" class="chip${filter === c.id ? ' active' : ''}" data-action="money-filter" data-cat="${c.id}" aria-pressed="${filter === c.id}">${c.emoji} ${esc(catShort(c.id))}${counts[c.id] ? ` <span class="money-count">${counts[c.id]}</span>` : ''}</button>`))
    .join('');
  const list = shown.length
    ? `<ul class="money-list" aria-label="Bills">${shown.map(billRow).join('')}</ul>`
    : all.length
      ? `<div class="money-empty-filter"><p>No ${esc(catShort(filter).toLowerCase())} bills yet.</p>${btn(`${icon('plus')} Add a ${esc(catShort(filter).toLowerCase())} bill`, 'money-add-bill', 'small', `data-category="${esc(filter)}"`)}</div>`
      : `<div class="empty-state money-empty"><span class="empty-icon">${icon('receipt')}</span><h3>No bills yet</h3><p>Snap the rent receipt, the cheese run, the ice cans — every bill makes your break-even honest.</p><div class="empty-actions">${btn(`${icon('plus')} Add first bill`, 'money-add-bill', 'primary')}</div></div>`;
  return `${breakEvenBanner()}
    <div class="money-tiles money-tiles-bills">
      ${tile('All bills', money(et.total), plural(et.count, 'bill'), 'tint-accent')}
      ${tile('🧰 Pre-stall', money(et.preStall), 'setup before day one')}
      ${tile('🔄 Mid-stall restock', money(et.restock), 'runs during the fest')}
      ${tile('Who paid', `<span class="money-split-val">${money(drawer)}<small>drawer</small></span><span class="money-split-val">${money(byMembers)}<small>partners</small></span>`, 'From drawer vs paid by members', 'money-tile-split')}
    </div>
    <div class="money-cta">
      ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'primary money-cta-btn')}
      ${btn('🔄 Quick mid-stall restock', 'money-restock', 'yellow money-cta-btn')}
    </div>
    ${quickAddChips()}
    <section class="money-ledger" aria-label="Bill ledger">
      <div class="money-ledger-head"><h2 class="section-title">${icon('receipt')} Bill ledger</h2><span class="muted">Newest first</span></div>
      <div class="money-chip-row money-filters" role="group" aria-label="Filter bills by category">${filterChips}</div>
      ${list}
    </section>`;
}

// --- Team --------------------------------------------------------------------------------------------------------------

function splitLine() {
  const c = C();
  const ms = members();
  if (!ms.length) return '';
  if (c.team?.splitMode === 'custom') {
    return `<span class="badge lavender">Custom split</span> ${ms.map(m => `<span class="money-share">${esc(m.name)} ${Number.isInteger(m.share) ? m.share : 0}%</span>`).join('')}`;
  }
  return `<span class="badge mint">Equal split</span> <span class="money-share">${Math.round((10000 / ms.length)) / 100}% each</span>`;
}

function teamTab() {
  const ms = members();
  if (!ms.length) {
    return `<div class="empty-state money-empty"><span class="empty-icon">${icon('users')}</span><h3>Add your stall partners</h3><p>Who chipped in? Add the team once in Studio › Team, then record contri and tag who paid each bill. The payout maths does the rest.</p><div class="empty-actions">${btn(`${icon('users')} Set up the team`, 'studio-open', 'primary', 'data-section="team"')}</div></div>`;
  }
  const r = teamSettlement(S(), C());
  const t = r.totals;
  const ranked = r.members.slice().sort((a, b) => b.capital - a.capital || a.name.localeCompare(b.name));
  const top = ranked[0]?.capital || 0;
  const cards = ranked.map((m, i) => {
    const funded = t.expenses > 0 ? (m.capital * 100) / t.expenses : 0;
    return `<li class="money-leader${i === 0 && m.capital > 0 ? ' is-top' : ''}" data-member="${esc(m.id)}">
      <div class="money-leader-head">
        <span class="money-rank">#${i + 1}</span>
        ${avatar(m.id, 'lg')}
        <div class="money-leader-name"><strong>${esc(m.name)}</strong><span>${m.sharePct}% profit share</span></div>
        ${i === 0 && m.capital > 0 ? '<span class="badge yellow money-crown">👑 Top funder</span>' : ''}
      </div>
      <dl class="money-leader-nums">
        <div><dt>Contri put in</dt><dd data-k="contri">${money(m.contri)}</dd></div>
        <div><dt>Bills paid</dt><dd data-k="bills">${money(m.bills)}</dd></div>
        <div class="is-total"><dt>Total put in</dt><dd data-k="capital">${money(m.capital)}</dd></div>
      </dl>
      <div class="money-leader-bar">${progress(bar(m.capital, top), `${m.name} money put in`, 'money-progress-ink')}</div>
      <p class="money-leader-funded"><strong data-k="funded">${pct(funded)}</strong> of total stall cost funded${t.expenses > 0 ? ` (${money(t.expenses)})` : ''}</p>
    </li>`;
  }).join('');
  const list = newestFirst(contris());
  const rows = list.length
    ? `<ul class="money-list money-contri-list" aria-label="Contri ledger">${list.map(x => `<li class="money-contri${x.void ? ' is-void' : ''}">
        ${avatar(x.memberId)}
        <div class="money-contri-main"><strong>${esc(memberById(x.memberId)?.name || 'Ex-partner')}</strong><span class="money-contri-meta">${esc(date(x.at))} · ${esc(x.method)}${x.note ? ` · ${esc(x.note)}` : ''}</span>${x.void ? `<span class="money-contri-void"><span class="badge ink">VOID</span> ${esc(x.voidReason || '')}</span>` : ''}</div>
        <strong class="money-contri-amt">${money(x.amount)}</strong>
        ${x.void ? '' : btn('Void', 'money-void-contri', 'quiet-outline small money-contri-void-btn', `data-id="${esc(x.id)}" aria-label="Void contri of ${esc(money(x.amount))}"`)}
      </li>`).join('')}</ul>`
    : `<p class="money-none">No contri recorded yet. When a partner drops cash or UPI into the stall pool, log it here.</p>`;
  return `<section class="money-team-top panel">
      <div class="money-team-split"><span class="money-team-split-label">Profit split</span><div class="money-share-row">${splitLine()}</div></div>
      <div class="money-team-actions">
        ${btn(`${icon('wallet')} Record contri`, 'money-contri', 'primary')}
        ${btn(`${icon('users')} Edit team &amp; shares`, 'studio-open', 'quiet-outline', 'data-section="team"')}
      </div>
    </section>
    <div class="money-tiles money-tiles-team">
      ${tile('Contri pool', money(t.contri), 'cash + UPI put in')}
      ${tile('Bills from pockets', money(t.pocketBills), 'paid by partners')}
      ${tile('Total put in', money(t.capital), 'contri + pocket bills', 'tint-accent')}
    </div>
    <h2 class="section-title">${icon('trophy')} Who put in the most</h2>
    <ol class="money-leaders">${cards}</ol>
    <section class="money-contris"><h2 class="section-title">${icon('wallet')} Contri ledger</h2>${rows}</section>`;
}

// --- Settlement --------------------------------------------------------------------------------------------------------

function settleTab() {
  const r = teamSettlement(S(), C());
  const t = r.totals;
  const rep = report(S(), C());
  const ms = r.members;
  const warn = r.warnings.map(w => `<p class="notice${/no partners/i.test(w) ? '' : ' danger'}">${icon('alert')}<span>${esc(w)}</span></p>`).join('');
  const board = `<section class="money-board" aria-label="Stall Settlement & Payout Summary">
    <div class="money-board-head"><span class="eyebrow">End of stall</span><h2>Stall Settlement &amp; Payout Summary</h2></div>
    <div class="money-tiles money-tiles-board">
      ${tile('Money put in', money(t.capital), `contri ${money(t.contri)} + member bills ${money(t.pocketBills)}`)}
      ${tile('All bills', money(t.expenses), `drawer ${money(t.drawerBills)} · partners ${money(t.pocketBills)}`)}
      ${tile('Revenue earned', money(t.revenue), `Cash ${money(rep.methods.Cash)} + UPI ${money(rep.methods.UPI)}${rep.methods.Other ? ` + Other ${money(rep.methods.Other)}` : ''}`)}
      ${tile(t.netProfit >= 0 ? 'Net profit' : 'Net loss', `<span data-k="net">${t.netProfit >= 0 ? money(t.netProfit) : `−${money(-t.netProfit)}`}</span>`, t.netProfit >= 0 ? 'revenue − all bills' : 'bills are more than sales so far', `money-net ${t.netProfit >= 0 ? 'is-profit' : 'is-loss'}`)}
    </div>
    <p class="money-pot"><span>💼 Money to split</span><strong data-k="pot">${money(Math.max(t.pot, 0))}</strong><small>contri ${money(t.contri)} − drawer bills ${money(t.drawerBills)} + revenue ${money(t.revenue)}</small></p>
  </section>`;
  if (!ms.length) {
    return `${board}${warn}<div class="empty-state money-empty"><span class="empty-icon">${icon('users')}</span><h3>Who gets what?</h3><p>Add your partners in Studio › Team to see each person’s payout.</p><div class="empty-actions">${btn(`${icon('users')} Set up the team`, 'studio-open', 'primary', 'data-section="team"')}</div></div>${footnotes()}`;
  }
  const maxCap = Math.max(0, ...ms.map(m => m.capital));
  const step1 = ms.map(m => `<li class="money-step-row"><span class="money-step-who">${avatar(m.id, 'sm')}<span>${esc(m.name)}</span></span>
      <div class="money-step-bars"><div class="money-bar money-bar-ghost" style="width:${bar(m.capital, maxCap).toFixed(2)}%"><div class="money-bar-fill" style="width:${(m.capital > 0 ? Math.min(100, (m.recovery * 100) / m.capital) : 0).toFixed(2)}%"></div></div></div>
      <span class="money-step-amt">${money(m.recovery)}<small>of ${money(m.capital)}</small></span></li>`).join('');
  const maxProfit = Math.max(0, ...ms.map(m => m.profitShare));
  const step2 = t.netProfit > 0
    ? ms.map(m => `<li class="money-step-row"><span class="money-step-who">${avatar(m.id, 'sm')}<span>${esc(m.name)}</span></span>
      <div class="money-step-bars"><div class="money-bar money-bar-profit" style="width:${bar(m.profitShare, maxProfit).toFixed(2)}%"></div></div>
      <span class="money-step-amt">+${money(m.profitShare)}<small>${m.sharePct}%</small></span></li>`).join('')
    : `<li class="money-step-none">No profit to split yet${t.netProfit < 0 ? ` — sales are ${money(-t.netProfit)} short of all bills` : ''}. Step 2 kicks in once revenue beats the bills.</li>`;
  const recLabel = t.capital > 0 ? `${pct(t.recoveryPct)} of the money put in comes back` : 'Nobody has put money in yet';
  const payouts = ms.map(m => `<li class="money-payout" data-member="${esc(m.id)}">
      <div class="money-payout-head">${avatar(m.id, 'lg')}<strong>${esc(m.name)}</strong></div>
      <dl class="money-payout-lines">
        <div><dt>Put in (Contri + Bills)</dt><dd data-k="capital">${money(m.capital)}</dd></div>
        ${m.recovery !== m.capital ? `<div class="is-short"><dt>Capital back</dt><dd data-k="recovery">${money(m.recovery)}</dd></div>` : ''}
        <div><dt>Pure profit share</dt><dd data-k="profit">+ ${money(m.profitShare)}</dd></div>
      </dl>
      <div class="money-payout-total"><span>Total take-home</span><strong data-k="payout">${money(m.payout)}</strong></div>
    </li>`).join('');
  const text = settlementText(S(), C());
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const snaps = newestFirst(snapshots());
  const snapList = snaps.length
    ? `<ul class="money-snaps">${snaps.map(sn => `<li class="money-snap"><div><strong>${esc(date(sn.at))}</strong><span>${sn.result?.totals?.netProfit >= 0 ? 'Profit' : 'Loss'} ${money(Math.abs(sn.result?.totals?.netProfit || 0))} · split ${money(Math.max(0, sn.result?.totals?.pot || 0))}</span></div>${btn(`${icon('eye')} View text`, 'money-snap', 'quiet-outline small', `data-id="${esc(sn.id)}"`)}</li>`).join('')}</ul>`
    : '<p class="money-none">No snapshots yet. Save one when the stall wraps up so everyone agrees on the numbers.</p>';
  return `${board}${warn}
    <div class="money-steps">
      <section class="money-step panel"><div class="money-step-head"><span class="money-step-no">1</span><div><h3>Capital recovery</h3><p>${esc(recLabel)}</p></div></div><ul>${step1}</ul></section>
      <section class="money-step panel"><div class="money-step-head"><span class="money-step-no is-pink">2</span><div><h3>Profit share</h3><p>${t.netProfit > 0 ? `${money(t.netProfit)} profit · ${r.splitMode === 'custom' ? 'custom %' : 'equal split'}` : 'Waiting for profit'}</p></div></div><ul>${step2}</ul></section>
    </div>
    <h2 class="section-title">${icon('wallet')} Final payout</h2>
    <ul class="money-payouts">${payouts}</ul>
    <div class="money-share-actions">
      ${btn(`${icon('copy')} Copy settlement report`, 'money-copy', 'primary')}
      <a class="money-wa" href="${esc(wa)}" target="_blank" rel="noopener" data-money-wa>${icon('chat')} Share to WhatsApp</a>
      ${btn(`${icon('download')} Save settlement snapshot`, 'money-snapshot', 'lavender')}
    </div>
    <details class="money-preview"><summary>Preview the message</summary><div class="money-bubble" data-settle-text>${esc(text)}</div></details>
    ${footnotes()}
    <section class="money-snapshots"><h2 class="section-title">${icon('clock')} Saved snapshots</h2>${snapList}</section>`;
}

function footnotes() {
  return `<div class="money-foot">
    <p>🧮 A fair-split calculator — not accounting or tax advice.</p>
    <p>📲 UPI money sits in the UPI account holder’s bank; cash sits in the drawer. Hand over payouts from wherever the money actually is.</p>
    <p>Rule of the split: everyone gets back what they put in first, then profit is shared by %. Rounding goes to the paise.</p>
  </div>`;
}

registerScreen('money', screen);

// ---------------------------------------------------------------------------------------------------------------------
// Add / edit bill sheet
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {{mode?: 'bill'|'restock'|'edit', category?: string, title?: string, amount?: number, expense?: any}} [options]
 */
function openBillSheet({mode = 'bill', category = '', title = '', amount = 0, expense = null} = {}) {
  const e = expense;
  const cat = e ? e.category : mode === 'restock' ? 'restock' : CAT[category] ? category : 'pre-stall';
  bill = {
    id: uuid(),
    mode,
    editId: e ? e.id : '',
    category: cat,
    method: e ? e.method : 'Cash',
    paidBy: e ? e.paidBy : DRAWER,
    photoData: '',
    photoRef: '',
    keepImage: e ? e.billImage || null : null,
    busy: false,
  };
  const ms = members();
  const titles = new Set([
    ...(mode === 'restock' ? RESTOCK_SUGGESTIONS : []),
    ...(Array.isArray(C().mission?.items) ? C().mission.items.map(/** @param {any} i */ i => i.label) : []),
    ...RESTOCK_SUGGESTIONS,
    ...newestFirst(bills()).map(b => b.title),
  ]);
  const datalist = `<datalist id="money-title-list">${[...titles].slice(0, 40).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`;
  const restockChips = mode === 'restock'
    ? `<div class="money-field"><span class="field-label">What ran out?</span><div class="money-chip-row money-suggest">${RESTOCK_SUGGESTIONS.map(s => `<button type="button" class="chip" data-action="money-suggest" data-title="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`
    : '';
  const catChips = mode === 'restock'
    ? ''
    : `<div class="money-field"><span class="field-label" id="money-cat-label">Category</span><div class="money-chip-row" role="group" aria-labelledby="money-cat-label">${EXPENSE_CATEGORIES.map(c =>
      `<button type="button" class="chip${c.id === cat ? ' active' : ''}" data-action="money-pick" data-field="category" data-value="${c.id}" aria-pressed="${c.id === cat}">${c.emoji} ${esc(c.label)}</button>`).join('')}</div></div>`;
  const payers = `<div class="money-field"><span class="field-label" id="money-payer-label">Paid by</span>
    <div class="money-chip-row money-payers" role="group" aria-labelledby="money-payer-label">
      <button type="button" class="chip money-payer${bill.paidBy === DRAWER ? ' active' : ''}" data-action="money-pick" data-field="paidBy" data-value="${DRAWER}" aria-pressed="${bill.paidBy === DRAWER}">${avatar(DRAWER, 'sm')} Stall cash drawer</button>
      ${ms.map(m => `<button type="button" class="chip money-payer${bill?.paidBy === m.id ? ' active' : ''}" data-action="money-pick" data-field="paidBy" data-value="${esc(m.id)}" aria-pressed="${bill?.paidBy === m.id}">${avatar(m.id, 'sm')} ${esc(m.name)}</button>`).join('')}
      ${e && e.paidBy !== DRAWER && !memberById(e.paidBy) ? `<button type="button" class="chip money-payer active" data-action="money-pick" data-field="paidBy" data-value="${esc(e.paidBy)}" aria-pressed="true">${avatar(e.paidBy, 'sm')} Ex-partner</button>` : ''}
    </div>
    ${ms.length ? '<small class="money-hint">Paid from a partner’s pocket? Tag them — it counts as money they put in.</small>' : `<small class="money-hint">No partners yet, so bills come from the drawer. ${btn('Add your team', 'studio-open', 'quiet small money-inline-link', 'data-section="team"')}</small>`}
  </div>`;
  const methodSeg = `<div class="money-field"><span class="field-label" id="money-method-label">Paid with</span><div class="segmented block money-method-seg" role="group" aria-labelledby="money-method-label">${['Cash', 'UPI'].map(m =>
    `<button type="button" class="${bill?.method === m ? 'active' : ''}" data-action="money-pick" data-field="method" data-value="${m}" aria-pressed="${bill?.method === m}">${m === 'UPI' ? icon('upi') : icon('cash')} ${m}</button>`).join('')}</div></div>`;
  const photo = `<div class="money-field"><span class="field-label">Bill photo <span class="muted">(optional)</span></span>
    <div class="money-photo-btns">
      <label class="money-file-btn"><input type="file" accept="image/*" capture="environment" class="money-file" data-change="money-photo" data-src="camera">📷 Snap bill</label>
      <label class="money-file-btn"><input type="file" accept="image/*" class="money-file" data-change="money-photo" data-src="gallery">🖼️ Choose photo</label>
    </div>
    <div class="money-photo-preview" id="money-photo-preview">${photoPreview()}</div>
  </div>`;
  const amountVal = e ? (e.amount / 100).toFixed(e.amount % 100 ? 2 : 0) : amount > 0 ? (amount / 100).toFixed(amount % 100 ? 2 : 0) : '';
  const heading = mode === 'edit' ? 'Edit bill' : mode === 'restock' ? '🔄 Quick mid-stall restock' : '📒 Add a bill';
  const body = `<form class="money-bill-form" data-submit="money-save-bill" novalidate>
    ${mode === 'restock' ? '<p class="notice sky money-sheet-note">Ran out mid-fest? Log the run in 10 seconds — it goes straight into your break-even.</p>' : ''}
    ${restockChips}
    <div class="field"><label for="money-title">What was it for?</label><input id="money-title" name="money-title" type="text" maxlength="${LIMITS.expenseTitle || 80}" list="money-title-list" value="${esc(e ? e.title : title)}" placeholder="${mode === 'restock' ? 'Extra cheese & buns' : 'Stall rent, raw material, banner…'}" autocomplete="off" required>${datalist}</div>
    ${catChips}
    <div class="money-amount-row">
      <div class="field money-amount"><label for="money-amount">Amount (₹)</label><input id="money-amount" name="money-amount" type="text" inputmode="decimal" value="${esc(amountVal)}" placeholder="0" autocomplete="off" required></div>
      ${methodSeg}
    </div>
    ${payers}
    ${photo}
    <div class="field"><label for="money-notes">Notes <span class="muted">(optional)</span></label><textarea id="money-notes" name="money-notes" maxlength="${LIMITS.expenseNotes || 500}" rows="2" placeholder="2 kg cheese ₹900, 40 buns ₹400…">${esc(e ? e.notes : '')}</textarea></div>
  </form>`;
  openSheet(
    heading,
    body,
    `${btn('Cancel', 'close', 'quiet-outline')}${btn(`${icon('check')} ${mode === 'edit' ? 'Save changes' : 'Save bill'}`, 'money-save-bill', 'primary money-save')}`,
    'money-bill-form',
    {onClose: () => (bill = null)},
  );
  const focus = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector(e || title ? '#money-amount' : '#money-title'));
  if (focus && !matchMedia('(pointer: coarse)').matches) focus.focus();
}

function photoPreview() {
  if (!bill) return '';
  const src = bill.photoData || (bill.keepImage ? mediaUrl(bill.keepImage) : '');
  if (!src) return '';
  const kb = bill.photoData ? Math.round(dataUrlBytes(bill.photoData) / 1024) : 0;
  return `<figure class="money-photo"><img src="${esc(src)}" alt="Bill photo preview"><figcaption>${kb ? `Compressed · ${kb} KB` : 'Saved photo'}</figcaption>${btn(`${icon('trash')} Remove`, 'money-photo-remove', 'quiet-outline small')}</figure>`;
}

function refreshPhotoPreview() {
  const box = sheetEl()?.querySelector('#money-photo-preview');
  if (box) box.innerHTML = photoPreview();
}

/** Decoded byte size of a base64 data URL. @param {string} dataUrl */
function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

const MAX_SIDE = 1400;
const MAX_BYTES = 600 * 1024;

/**
 * Decode an image file (createImageBitmap, falling back to <img>) and return a drawable + its size.
 * @param {File} file
 * @returns {Promise<{src: CanvasImageSource, width: number, height: number, done: () => void}>}
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return {src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close?.()};
    } catch {
      // fall back to <img> (older Safari, some HEIC paths)
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(Error('That photo could not be opened. Try a JPG or PNG.'));
    img.src = url;
  });
  return {src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url)};
}

/**
 * Compress a bill photo in the browser: longest side ≤1400 px, JPEG quality stepping down from 0.82 until ≤600 KB
 * (shrinking further if even low quality is too big).
 * @param {File} file
 * @returns {Promise<string>} data:image/jpeg;base64,…
 */
async function compressPhoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw Error('Pick a photo of the bill.');
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw Error('That photo looks empty. Try another one.');
    let scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    for (let round = 0; round < 6; round++) {
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('This browser can’t process photos. Skip the photo and save the bill.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img.src, 0, 0, w, h);
      for (let q = 0.82; q >= 0.4; q -= 0.08) {
        const url = canvas.toDataURL('image/jpeg', Math.round(q * 100) / 100);
        if (!url.startsWith('data:image/jpeg')) throw Error('This browser can’t process photos. Skip the photo and save the bill.');
        if (dataUrlBytes(url) <= MAX_BYTES) return url;
      }
      scale *= 0.75;
    }
    throw Error('That photo is too big even after compressing. Try a closer shot.');
  } finally {
    img.done();
  }
}

/** Read the bill form and save (add, or update when editing). */
async function saveBill() {
  const d = bill;
  const root = sheetEl();
  if (!d || !root || sheetKind() !== 'money-bill-form') return;
  if (d.busy) throw Error('Still processing the photo — one sec.');
  const val = (/** @type {string} */ id) => /** @type {HTMLInputElement|null} */ (root.querySelector(`#${id}`))?.value ?? '';
  const title = val('money-title').trim();
  if (!title) throw Error('Give this bill a title, like “Extra cheese & buns”.');
  const rawAmount = val('money-amount').trim();
  if (!rawAmount) throw Error('Enter the bill amount.');
  const amount = paise(rawAmount);
  if (amount < 1) throw Error('Enter a bill amount above ₹0.');
  const notes = val('money-notes').trim();
  if (d.photoData && !d.photoRef) d.photoRef = await saveImageDataUrl(d.photoData);
  const billImage = d.photoData ? d.photoRef : d.keepImage;
  const fields = {title, category: d.category, amount, method: d.method, paidBy: d.paidBy, billImage, notes};
  if (d.mode === 'edit') {
    const editId = d.editId;
    const ok = await requireAdmin(() => commit(st => updateExpense(st[st.mode], st.config, editId, fields)));
    if (ok === undefined && !isAdmin()) return;
    bill = null;
    closeSheet();
    toast(`Bill updated · break-even now ${money(report(S(), C()).mission.target)}`);
    return;
  }
  const id = d.id;
  await commit(st => addExpense(st[st.mode], st.config, {id, ...fields}));
  bill = null;
  closeSheet();
  toast(`${d.mode === 'restock' ? 'Restock logged' : 'Bill added'} · break-even now ${money(report(S(), C()).mission.target)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Bill detail sheet
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function openBillDetail(id) {
  const e = bills().find(x => x.id === id);
  if (!e) throw Error('That bill could not be found.');
  const cat = catOf(e.category);
  const src = e.billImage ? mediaUrl(e.billImage) : '';
  const photo = src
    ? `<button type="button" class="money-detail-photo" data-action="money-zoom" aria-label="Zoom bill photo"><img src="${esc(src)}" alt="Bill photo"><span class="badge ink">${icon('search')} Tap to zoom</span></button>`
    : e.billImage
      ? '<p class="notice">Bill photo is not on this device.</p>'
      : '';
  const body = `<div class="money-detail${e.void ? ' is-void' : ''}">
    <div class="money-detail-top">
      <div><span class="money-cat cat-${esc(cat.id)}">${cat.emoji} ${esc(cat.label)}</span>${e.void ? ' <span class="badge ink">VOID</span>' : ''}</div>
      <strong class="money-detail-amt">${money(e.amount)}</strong>
    </div>
    ${photo}
    <dl class="money-detail-list">
      <div><dt>Paid by</dt><dd>${avatar(e.paidBy, 'sm')} ${esc(payerName(e.paidBy))}</dd></div>
      <div><dt>Paid with</dt><dd>${esc(e.method)}</dd></div>
      <div><dt>Recorded</dt><dd>${esc(date(e.at))} · by ${esc(e.operator || '—')}</dd></div>
      ${e.void ? `<div><dt>Voided</dt><dd>${e.voidAt ? esc(date(e.voidAt)) : ''} · ${esc(e.voidReason || '')}</dd></div>` : ''}
    </dl>
    ${e.notes ? `<div class="money-detail-notes"><span class="field-label">Notes</span><p>${esc(e.notes)}</p></div>` : ''}
    ${e.void ? '<p class="footnote">Voided bills stay here for the record but never count in any total.</p>' : ''}
  </div>`;
  const actions = e.void
    ? btn('Close', 'close', 'quiet-outline')
    : `${btn(`${icon('trash')} Void`, 'money-void-bill', 'danger', `data-id="${esc(e.id)}"`)}${btn(`${icon('edit')} Edit`, 'money-edit-bill', 'primary', `data-id="${esc(e.id)}"`)}`;
  openSheet(esc(e.title), body, actions, 'money-bill');
}

// ---------------------------------------------------------------------------------------------------------------------
// Contri sheet
// ---------------------------------------------------------------------------------------------------------------------

function openContriSheet() {
  const ms = members();
  if (!ms.length) throw Error('Add your partners in Studio › Team first.');
  contri = {id: uuid(), memberId: ms.length === 1 ? ms[0].id : '', method: 'Cash'};
  const body = `<form class="money-contri-form" data-submit="money-save-contri" novalidate>
    <div class="money-field"><span class="field-label" id="money-member-label">Who put money in?</span>
      <div class="money-chip-row money-payers" role="group" aria-labelledby="money-member-label">${ms.map(m =>
        `<button type="button" class="chip money-payer${contri?.memberId === m.id ? ' active' : ''}" data-action="money-pick" data-field="memberId" data-value="${esc(m.id)}" aria-pressed="${contri?.memberId === m.id}">${avatar(m.id, 'sm')} ${esc(m.name)}</button>`).join('')}</div></div>
    <div class="money-amount-row">
      <div class="field money-amount"><label for="money-contri-amount">Amount (₹)</label><input id="money-contri-amount" name="money-contri-amount" type="text" inputmode="decimal" placeholder="0" autocomplete="off" required></div>
      <div class="money-field"><span class="field-label" id="money-cmethod-label">Came in as</span><div class="segmented block" role="group" aria-labelledby="money-cmethod-label">${['Cash', 'UPI'].map(m =>
        `<button type="button" class="${m === 'Cash' ? 'active' : ''}" data-action="money-pick" data-field="cmethod" data-value="${m}" aria-pressed="${m === 'Cash'}">${m === 'UPI' ? icon('upi') : icon('cash')} ${m}</button>`).join('')}</div></div>
    </div>
    <div class="field"><label for="money-contri-note">Note <span class="muted">(optional)</span></label><input id="money-contri-note" name="money-contri-note" type="text" maxlength="${LIMITS.contriNote || 120}" placeholder="For the gas cylinder, sent to Rohan’s UPI…" autocomplete="off"></div>
    <p class="footnote">Contri = money a partner puts into the stall pool. It comes back to them first at settlement.</p>
  </form>`;
  openSheet('👥 Record contri', body, `${btn('Cancel', 'close', 'quiet-outline')}${btn(`${icon('check')} Save contri`, 'money-save-contri', 'primary')}`, 'money-contri-form', {
    onClose: () => (contri = null),
  });
}

async function saveContri() {
  const d = contri;
  const root = sheetEl();
  if (!d || !root || sheetKind() !== 'money-contri-form') return;
  if (!d.memberId) throw Error('Pick which partner put this money in.');
  const raw = /** @type {HTMLInputElement|null} */ (root.querySelector('#money-contri-amount'))?.value.trim() || '';
  if (!raw) throw Error('Enter the contri amount.');
  const amount = paise(raw);
  if (amount < 1) throw Error('Enter a contri above ₹0.');
  const note = /** @type {HTMLInputElement|null} */ (root.querySelector('#money-contri-note'))?.value.trim() || '';
  const {id, memberId, method} = d;
  await commit(st => addContribution(st[st.mode], st.config, {id, memberId, amount, method, note}));
  contri = null;
  closeSheet();
  toast(`Contri saved · ${memberById(memberId)?.name || 'Partner'} +${money(amount)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Copy / share
// ---------------------------------------------------------------------------------------------------------------------

/** Copy text with the async clipboard, falling back to a hidden textarea + execCommand. @param {string} text */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // insecure origin / permission denied → legacy path
  }
  const host = sheetEl()?.open ? sheetEl() : document.body;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  host.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Show the text in a sheet so it can be copied by hand. @param {string} text @param {string} title */
function manualCopySheet(text, title) {
  openSheet(title, `<p class="muted">Copy didn’t work on this browser — long-press the text below and copy it.</p><textarea class="money-copy-area" readonly rows="12" aria-label="Settlement text">${esc(text)}</textarea>`, btn('Done', 'close', 'primary'), 'money-copy');
  /** @type {HTMLTextAreaElement|null} */ (sheetEl()?.querySelector('.money-copy-area'))?.select();
}

/** @param {string} text @param {string} title */
async function copyOrShow(text, title) {
  if (await copyText(text)) toast('Settlement copied — paste it in the team group 🤝');
  else manualCopySheet(text, title);
}

/** @param {string} id */
function openSnapshot(id) {
  const sn = snapshots().find(x => x.id === id);
  if (!sn) throw Error('That snapshot could not be found.');
  const wa = `https://wa.me/?text=${encodeURIComponent(sn.text || '')}`;
  openSheet(
    `Snapshot · ${esc(date(sn.at))}`,
    `<p class="footnote">Saved by ${esc(sn.operator || '—')}. Snapshots never change, even if bills are edited later.</p><div class="money-bubble">${esc(sn.text || '')}</div>`,
    `${btn(`${icon('copy')} Copy`, 'money-copy', 'primary', `data-snap="${esc(sn.id)}"`)}<a class="money-wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>`,
    'money-snapshot',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------------

/** Toggle `.active` / aria-pressed on the clicked chip among its siblings (no re-render keeps typed values). @param {HTMLElement} el */
function lightUp(el) {
  const group = el?.parentElement;
  if (!group) return;
  for (const b of group.querySelectorAll('[data-action="money-pick"]')) {
    const on = b === el;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

registerActions(
  {
    'money-open': (_el, ds) => {
      if (ds?.tab) setTab(ds.tab);
      navigate('money');
    },
    'money-tab': (_el, ds) => {
      setTab(ds.tab);
      render();
    },
    'money-filter': (_el, ds) => {
      filter = ds.cat && (ds.cat === 'all' || CAT[ds.cat]) ? ds.cat : 'all';
      render();
    },
    'money-add-bill': (_el, ds) => openBillSheet({mode: 'bill', category: ds?.category || ''}),
    'money-restock': () => openBillSheet({mode: 'restock'}),
    'money-quick': (_el, ds) => {
      const it = (C().mission?.items || [])[Number(ds.idx)];
      if (!it) return;
      openBillSheet({mode: 'bill', title: it.label, amount: it.amount, category: guessCategory(it.label)});
    },
    'money-suggest': (el, ds) => {
      const input = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#money-title'));
      if (input) input.value = ds.title || '';
      for (const b of el?.parentElement?.querySelectorAll('.chip') || []) b.classList.toggle('active', b === el);
      /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#money-amount'))?.focus();
    },
    'money-pick': (el, ds) => {
      const {field, value} = ds;
      if (field === 'memberId' || field === 'cmethod') {
        if (!contri) return;
        if (field === 'memberId') contri.memberId = value;
        else contri.method = value === 'UPI' ? 'UPI' : 'Cash';
      } else {
        if (!bill) return;
        if (field === 'category' && CAT[value]) bill.category = value;
        if (field === 'method') bill.method = value === 'UPI' ? 'UPI' : 'Cash';
        if (field === 'paidBy') bill.paidBy = value;
      }
      lightUp(el);
    },
    'money-photo-remove': () => {
      if (!bill) return;
      bill.photoData = '';
      bill.photoRef = '';
      bill.keepImage = null;
      refreshPhotoPreview();
    },
    'money-save-bill': () => saveBill(),
    'money-bill': (_el, ds) => openBillDetail(ds.id),
    'money-zoom': el => {
      el?.classList.toggle('is-zoomed');
      sheetEl()?.classList.toggle('wide', !!el?.classList.contains('is-zoomed'));
    },
    'money-edit-bill': (_el, ds) => {
      const e = bills().find(x => x.id === ds.id);
      if (!e) throw Error('That bill could not be found.');
      if (e.void) throw Error('This bill is voided. Add a new bill instead.');
      openBillSheet({mode: 'edit', expense: e});
    },
    'money-void-bill': (_el, ds) => {
      const e = bills().find(x => x.id === ds.id);
      if (!e) throw Error('That bill could not be found.');
      confirmSheet({
        title: 'Void this bill?',
        body: `<p><strong>${esc(e.title)}</strong> · ${money(e.amount)}</p><p>It stays in the ledger for the record, but leaves every total, the break-even and the settlement.</p>
          <div class="field"><label for="money-void-reason">Reason</label><input id="money-void-reason" name="money-void-reason" type="text" maxlength="${LIMITS.reason || 200}" placeholder="Entered twice, wrong amount…" autocomplete="off"></div>`,
        confirmLabel: 'Void bill',
        danger: true,
        onConfirm: async () => {
          const reason = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#money-void-reason'))?.value.trim() || '';
          if (!reason) throw Error('Add a short reason so the team knows why.');
          await commit(st => voidExpense(st[st.mode], st.config, e.id, reason));
          toast(`Bill voided · break-even now ${money(report(S(), C()).mission.target)}`, {tone: 'warn'});
        },
      });
    },
    'money-ledger-mode': async () => {
      await commitConfig(st => saveMission(st.config, {...st.config.mission, mode: 'ledger'}));
      toast(`Done — break-even is now your bills · ${money(report(S(), C()).mission.target)}`);
    },
    'money-contri': () => openContriSheet(),
    'money-save-contri': () => saveContri(),
    'money-void-contri': (_el, ds) => {
      const x = contris().find(y => y.id === ds.id);
      if (!x) throw Error('That contri could not be found.');
      confirmSheet({
        title: 'Void this contri?',
        body: `<p><strong>${esc(memberById(x.memberId)?.name || 'Ex-partner')}</strong> · ${money(x.amount)} · ${esc(x.method)}</p><p>It stays listed for the record but no longer counts as money put in.</p>
          <div class="field"><label for="money-void-reason">Reason</label><input id="money-void-reason" name="money-void-reason" type="text" maxlength="${LIMITS.reason || 200}" placeholder="Entered twice, returned the money…" autocomplete="off"></div>`,
        confirmLabel: 'Void contri',
        danger: true,
        onConfirm: async () => {
          const reason = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#money-void-reason'))?.value.trim() || '';
          if (!reason) throw Error('Add a short reason so the team knows why.');
          await commit(st => voidContribution(st[st.mode], st.config, x.id, reason));
          toast('Contri voided', {tone: 'warn'});
        },
      });
    },
    'money-copy': async (_el, ds) => {
      if (ds?.snap) {
        const sn = snapshots().find(x => x.id === ds.snap);
        if (!sn) throw Error('That snapshot could not be found.');
        await copyOrShow(sn.text || '', 'Snapshot text');
        return;
      }
      await copyOrShow(settlementText(S(), C()), 'Settlement report');
    },
    'money-snapshot': async () => {
      const snap = await commit(st => saveSettlement(st[st.mode], st.config));
      toast(`Snapshot saved · ${money(Math.max(0, snap?.result?.totals?.pot || 0))} to split`);
    },
    'money-snap': (_el, ds) => openSnapshot(ds.id),
  },
  {admin: ['money-edit-bill', 'money-void-bill', 'money-ledger-mode', 'money-contri', 'money-save-contri', 'money-void-contri', 'money-snapshot']},
);

registerChanges({
  'money-photo': async el => {
    const input = /** @type {HTMLInputElement} */ (el);
    const file = input.files?.[0];
    input.value = '';
    if (!file || !bill) return;
    const d = bill;
    d.busy = true;
    const box = sheetEl()?.querySelector('#money-photo-preview');
    if (box) box.innerHTML = '<p class="money-photo-busy">Squeezing the photo…</p>';
    try {
      const data = await compressPhoto(file);
      if (bill !== d) return;
      d.photoData = data;
      d.photoRef = '';
      refreshPhotoPreview();
    } catch (err) {
      refreshPhotoPreview();
      throw err;
    } finally {
      d.busy = false;
    }
  },
});

