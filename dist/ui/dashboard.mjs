// Dashboard & day report (ARCHITECTURE.md §13.4, Phase 2 §16.3 / §16.7) — owner: dashboard agent.
//
// One report(S(), C()) per render feeds the mission hero, stat tiles and every panel. The mission follows
// report().mission.mode: 'ledger' (break-even = Σ bills in the expense ledger) or planned 'total' / 'itemized'
// (break-even = planned investment + Σ bills). The team payout preview is teamSettlement(S(), C()) — the dashboard never
// re-does money maths, it only formats what domain.mjs returns. The day report sheet previews dayReportText() in a chat
// bubble and copies / shares exactly that text (WhatsApp link, native share sheet).
import {
  C, S, store, esc, money, icon, btn, tokenLabel, time, date, artFrame, registerScreen, registerActions, openSheet, sheetEl,
  toast,
} from './core.mjs';
import {report, dayReportText, productById, teamSettlement} from '../domain.mjs';
import {EXPENSE_CATEGORIES} from '../constants.mjs';
import {istDate} from '../util.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------------------------------------------------

/** Whole-number percent, floored (matches the day report). @param {number} n */
export const pct = n => `${Math.max(0, Math.floor(Number(n) || 0))}%`;

/** '18' → '6 pm' (IST hour key from report().hourly). @param {string} h */
const hourLabel = h => {
  const n = Number(h);
  return `${n % 12 || 12} ${n < 12 ? 'am' : 'pm'}`;
};

/** Short rupee label for chart columns: ₹850, ₹1.2k, ₹12k, ₹1.5L. @param {number} p paise */
const shortMoney = p => {
  const r = Math.round(Math.abs(p) / 100);
  const sign = p < 0 ? '−' : '';
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(r >= 1000000 ? 0 : 1).replace(/\.0$/, '')}L`;
  if (r >= 1000) return `${sign}₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${sign}₹${r}`;
};

/** Signed money for profit/loss lines: +₹120 / −₹2,300. @param {number} p */
export const signedMoney = p => (p >= 0 ? `+${money(p)}` : `−${money(-p)}`);

/** Bar width in %, never negative. @param {number} v @param {number} max */
const barWidth = (v, max) => (max > 0 && v > 0 ? Math.max(2, Math.min(100, (v / max) * 100)) : 0);

/**
 * Inline style that lets CSS shrink a big number to fit its box (font-size ∝ box width ÷ character count), so
 * ₹1,50,399.25 stays on one line in a phone tile instead of breaking mid-digit. @param {string} text
 */
const fitLen = text => `style="--len:${Math.max(4, [...String(text)].length)}"`;

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STATUS_BADGE = {
  pending: ['UNPAID', 'yellow'],
  partial: ['PART REFUND', 'orange'],
  refunded: ['REFUNDED', 'coral'],
  void: ['VOID', 'ink'],
};

/** Expense category id → {label, emoji} (constants §16.2); unknown ids read as Misc. */
const CATEGORY = Object.fromEntries(EXPENSE_CATEGORIES.map(x => [x.id, x]));
/** @param {string} id */
const categoryOf = id => CATEGORY[id] || CATEGORY.misc || {id: 'misc', label: 'Misc', emoji: '🧾'};

/** Bar colour per expense category (dash-tint-*). */
const CATEGORY_TONE = {'pre-stall': 'lavender', restock: 'orange', rent: 'sky', packaging: 'mint', decor: 'pink', misc: 'yellow'};

/** Valid tint ids for partner avatars (constants TINTS); anything else falls back to cream. */
const AVATAR_TINTS = new Set(['yellow', 'pink', 'coral', 'peach', 'lime', 'mint', 'sky', 'lavender', 'cream']);

/** First letter(s) for a partner avatar. @param {string} name */
const avatarText = name => {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] || '?')].slice(0, 2).join('');
  return letters.toUpperCase();
};

/** Who paid a bill, as a short label. @param {string} paidBy */
function payerName(paidBy) {
  if (!paidBy || paidBy === 'drawer') return 'Stall drawer';
  const m = (C().team?.members || []).find(x => x.id === paidBy);
  return m ? m.name : 'Ex-partner';
}

/** Progress bar markup (base .progress) with an accessible value. @param {number} percent 0–100 @param {string} label */
export function progressBar(percent, label, cls = '') {
  const w = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="progress${cls ? ' ' + cls : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(w)}"><div class="progress-fill" style="width:${w.toFixed(2)}%"></div></div>`;
}

/** Unlocked milestone count for the current ledger. */
export function milestoneCount() {
  const list = C().milestones || [];
  const states = S().milestones || {};
  return {unlocked: list.filter(m => states[m.id]?.active).length, total: list.length};
}

/** Is the break-even driven by the bill ledger (§16.1 mission mode 'ledger')? @param {any} r report */
const isLedger = r => (r.mission.mode || C().mission?.mode) === 'ledger';

// ---------------------------------------------------------------------------------------------------------------------
// Mission (hero + compact strip shared with Milestones)
// ---------------------------------------------------------------------------------------------------------------------

const CONFETTI = 16;

/** "+ Quick mid-stall restock" and "Add bill" — the two money buttons owners hit mid-rush. */
const moneyButtons = () => `<div class="dash-money-actions">
    ${btn(`${icon('refresh')} Quick mid-stall restock`, 'money-restock', 'dash-restock-btn')}
    ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'lime dash-bill-btn')}
  </div>`;

/** @param {any} r report */
function heroBreakdown(r) {
  const m = r.mission;
  const byCategory = r.expenseTotals?.byCategory || {};
  const count = r.expenseTotals?.count ?? 0;
  const restock = m.restock ?? byCategory.restock ?? 0;
  if (isLedger(r)) {
    const rows = EXPENSE_CATEGORIES.filter(x => x.id !== 'restock' && byCategory[x.id] > 0)
      .map(x => `<li><span><span class="dash-cat-emoji" aria-hidden="true">${x.emoji}</span> ${esc(x.label)}</span><strong>${money(byCategory[x.id])}</strong></li>`)
      .join('');
    return `<div class="dash-breakdown">
      <span class="eyebrow">Break-even = all bills</span>
      <ul class="dash-breakdown-list">${rows}
        <li class="dash-breakdown-restock"><span><span class="dash-cat-emoji" aria-hidden="true">🔄</span> Mid-stall restock</span><strong>${money(restock)}</strong></li>
      </ul>
      <div class="dash-breakdown-total"><span>Break-even</span><strong>${money(m.target)}</strong></div>
      <button type="button" class="dash-breakdown-link" data-action="money-open" data-tab="bills">
        <span>${plural(count, 'bill')} logged</span><span class="dash-breakdown-link-go">See bills ${icon('chevron-right')}</span>
      </button>
    </div>`;
  }
  const mission = C().mission;
  const items = m.mode === 'itemized' ? mission.items : [];
  const planned = items.length
    ? items.map(i => `<li><span>${esc(i.label)}</span><strong>${money(i.amount)}</strong></li>`).join('')
    : `<li><span>Planned investment</span><strong>${money(m.planned ?? m.investment)}</strong></li>`;
  return `<div class="dash-breakdown">
    <span class="eyebrow">Break-even = plan + bills</span>
    <ul class="dash-breakdown-list">${planned}
      <li class="dash-breakdown-extra"><span><span class="dash-cat-emoji" aria-hidden="true">🧾</span> Bills logged</span><strong>${money(m.bills ?? m.extraExpenses)}</strong></li>
      ${restock > 0 ? `<li class="dash-breakdown-sub"><span>incl. mid-stall restock</span><strong>${money(restock)}</strong></li>` : ''}
    </ul>
    <div class="dash-breakdown-total"><span>Break-even</span><strong>${money(m.target)}</strong></div>
  </div>`;
}

/**
 * Net profit = revenue − all bills (ledger) / collected − (plan + bills) (planned). Comes straight from r.mission.profit.
 * @param {any} r report
 */
function netLine(r) {
  const m = r.mission;
  const up = m.profit >= 0;
  const label = isLedger(r) ? (up ? 'Net profit' : 'Net so far') : up ? 'Profit vs break-even' : 'Short of break-even';
  const how = isLedger(r) ? 'sales − all bills' : 'sales − (plan + bills)';
  return `<div class="dash-net ${up ? 'is-up' : 'is-down'}">
    <span class="dash-net-label">${label}<small>${how}</small></span>
    <strong>${up ? money(m.profit) : `−${money(-m.profit)}`}</strong>
  </div>`;
}

/** @param {any} r report */
function missionHero(r) {
  const m = r.mission;
  const ledger = isLedger(r);
  const buttons = `<div class="dash-hero-actions">
    ${btn(`${icon('edit')} ${ledger ? 'Mission setup' : 'Edit mission'}`, 'studio-open', 'small', 'data-section="mission"')}
    ${btn(`${icon('chat')} Day report`, 'dash-report', 'small primary')}
    ${btn(`${icon('download')} Export`, 'data-backups', 'small')}
  </div>`;

  if (!m.hasTarget) {
    const cta = ledger
      ? `<div class="dash-cta">
          ${btn(`${icon('plus')} Log your first bill`, 'money-add-bill', 'primary dash-cta-main')}
          ${btn('or set one total', 'studio-open', 'quiet-outline small dash-cta-alt', 'data-section="mission"')}
        </div>`
      : `<div class="dash-cta">
          ${btn(`${icon('edit')} Set break-even`, 'studio-open', 'accent dash-cta-main', 'data-section="mission"')}
          ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'quiet-outline small dash-cta-alt')}
        </div>`;
    const copy = ledger
      ? 'Your break-even is simply every bill you log — rent, raw material, plates, that 9 pm ice run. Log them as you go and we’ll show the exact moment you’re paisa vasool.'
      : 'Add your stall rent, raw material and other costs — we’ll show the exact moment you’re paisa vasool.';
    return `<section class="dash-hero is-unset" aria-labelledby="dash-hero-title">
      <div class="dash-hero-main">
        <span class="dash-eyebrow-sticker" id="dash-hero-title">${ledger ? 'BREAK-EVEN = YOUR BILLS' : 'SET YOUR BREAK-EVEN'}</span>
        <p class="dash-big"><span class="dash-big-num" ${fitLen(money(m.collected))}>${money(m.collected)}</span> <span class="dash-big-of">collected so far</span></p>
        <p class="dash-hero-copy">${copy}</p>
        ${cta}
        <div class="dash-hero-row">
          ${btn(`${icon('refresh')} Quick mid-stall restock`, 'money-restock', 'small dash-restock-btn')}
          ${btn(`${icon('chat')} Day report`, 'dash-report', 'small')}
          ${btn(`${icon('download')} Export`, 'data-backups', 'small')}
        </div>
      </div>
    </section>`;
  }

  if (m.profitMode) {
    const bits = Array.from({length: CONFETTI}, () => '<i></i>').join('');
    return `<section class="dash-hero is-profit" aria-labelledby="dash-hero-title">
      <div class="dash-burst" aria-hidden="true"></div>
      <div class="dash-confetti" aria-hidden="true">${bits}</div>
      <div class="dash-hero-main">
        <span class="dash-eyebrow-sticker is-fire" id="dash-hero-title">PROFIT MODE 🔥</span>
        <p class="dash-profit"><span class="dash-big-num" ${fitLen(money(m.profit))}>${money(m.profit)}</span> <span class="dash-profit-word">PROFIT</span></p>
        <p class="dash-big-sub"><strong>${money(m.collected)}</strong> collected − <strong>${money(m.target)}</strong> ${ledger ? 'in bills' : 'break-even'} = net profit</p>
        ${progressBar(100, 'Break-even recovered')}
        <div class="dash-hero-meta"><strong class="dash-pct">${pct(m.recovery)} recovered</strong><span class="badge lime">${icon('check')} Paisa vasool</span></div>
        ${moneyButtons()}
        ${buttons}
      </div>
      ${heroBreakdown(r)}
    </section>`;
  }

  return `<section class="dash-hero" aria-labelledby="dash-hero-title">
    <div class="dash-hero-main">
      <span class="dash-eyebrow-sticker" id="dash-hero-title">THE ${money(m.target)} MISSION</span>
      <p class="dash-big"><span class="dash-big-num" ${fitLen(money(m.collected))}>${money(m.collected)}</span> <span class="dash-big-of">/ ${money(m.target)}</span></p>
      ${progressBar(m.percent, 'Break-even recovered')}
      <div class="dash-hero-meta"><strong class="dash-pct">${pct(m.percent)} recovered</strong><span class="badge yellow">${money(m.remaining)} to break even</span></div>
      ${netLine(r)}
      ${moneyButtons()}
      ${buttons}
    </div>
    ${heroBreakdown(r)}
  </section>`;
}

/**
 * Compact mission strip (used on Milestones).
 * @param {any} r report(S(), C())
 */
export function missionStrip(r) {
  const m = r.mission;
  if (!m.hasTarget) {
    const ledger = isLedger(r);
    return `<section class="dash-strip is-unset">
      <span class="dash-strip-icon">${icon('target')}</span>
      <div class="grow"><span class="eyebrow">${ledger ? 'Break-even = your bills · none yet' : 'Break-even not set'}</span><strong class="dash-strip-num">${money(m.collected)} collected</strong></div>
      ${ledger
        ? btn(`${icon('plus')} Log a bill`, 'money-add-bill', 'small accent')
        : btn(`${icon('edit')} Set break-even`, 'studio-open', 'small accent', 'data-section="mission"')}
    </section>`;
  }
  return `<section class="dash-strip${m.profitMode ? ' is-profit' : ''}">
    <span class="dash-strip-icon">${icon(m.profitMode ? 'fire' : 'target')}</span>
    <div class="grow dash-strip-body">
      <div class="dash-strip-top">
        <span class="eyebrow">${m.profitMode ? 'PROFIT MODE 🔥' : `THE ${money(m.target)} MISSION`}</span>
        <strong class="dash-strip-pct">${m.profitMode ? `${signedMoney(m.profit)} profit` : pct(m.percent)}</strong>
      </div>
      <strong class="dash-strip-num">${money(m.collected)} <span>/ ${money(m.target)}${isLedger(r) ? ' in bills' : ''}</span></strong>
      ${progressBar(m.percent, 'Break-even recovered')}
    </div>
    ${btn(`Dashboard ${icon('chevron-right')}`, 'nav', 'small quiet-outline dash-strip-link', 'data-screen="dashboard"')}
  </section>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stat tiles & panels
// ---------------------------------------------------------------------------------------------------------------------

/** @param {any} r */
function statTiles(r) {
  /** @type {Array<[string, string, string, string, string?]>} icon, value, label, tint, extra */
  const tiles = [
    ['wallet', money(r.collected), 'Collected', 'accent'],
    ['receipt', String(r.orders), 'Orders', 'pink'],
    ['box', String(r.units), 'Items sold', 'lavender'],
    ['rupee', money(r.average), 'Avg order', 'peach'],
    ['cash', money(r.methods.Cash), 'Cash', 'lime'],
    ['upi', money(r.methods.UPI), 'UPI', 'sky'],
    ['percent', money(r.discounts), 'Discounts given', 'coral'],
  ];
  if (C().games.length || r.games) tiles.push(['game', String(r.games), 'Games played', 'mint']);
  tiles.push(['clock', String(r.pending.count), 'Pending', 'yellow', r.pending.count ? `${money(r.pending.amount)} unpaid` : 'All settled']);
  // Collected is a double-width tile; with no games tile Pending widens too, so 10 cells fill 5 or 2 columns evenly.
  const wide = new Set(['Collected', ...(tiles.length % 2 === 0 ? ['Pending'] : [])]);
  return `<section class="dash-stats" aria-label="Key numbers">${tiles
    .map(([ic, value, label, tint, extra]) => `<div class="stat dash-stat${wide.has(label) ? ' is-wide' : ''}${label === 'Pending' && r.pending.count ? ' is-alert' : ''}">
      <span class="dash-stat-icon dash-tint-${tint}">${icon(ic)}</span>
      <strong ${fitLen(value)}>${esc(value)}</strong>
      <small>${esc(label)}${extra ? ` · ${esc(extra)}` : ''}</small>
    </div>`)
    .join('')}</section>`;
}

/** @param {string} title @param {string} iconName @param {string} [right] markup */
const panelHead = (title, iconName, right = '') =>
  `<div class="dash-panel-head"><h2>${icon(iconName)}<span>${esc(title)}</span></h2>${right}</div>`;

/** @param {string} text */
const panelEmpty = text => `<p class="dash-empty">${esc(text)}</p>`;

/** @param {any} r */
function bestsellersPanel(r) {
  const c = C();
  const top = r.best.slice(0, 5);
  const body = top.length
    ? `<ol class="dash-best">${top
      .map((b, i) => {
        const p = productById(c, b.productId);
        return `<li class="dash-best-row">
          <span class="dash-rank dash-rank-${i + 1}">${i + 1}</span>
          ${p ? artFrame(p, {size: 'xs'}) : ''}
          <div class="grow"><h3>${esc(b.name)}</h3><small>${money(b.revenue)} of sales</small></div>
          <span class="dash-best-units"><strong>${b.units}</strong> sold</span>
        </li>`;
      })
      .join('')}</ol>`
    : panelEmpty('Your first sale gets the leaderboard going.');
  return `<section class="panel dash-panel">${panelHead('Bestsellers', 'trophy', '<span class="badge">BY UNITS</span>')}${body}</section>`;
}

/** @param {any} o order */
function orderRow(o) {
  const [label, tone] = STATUS_BADGE[o.status] || ['', ''];
  const items = o.items.map(l => `${l.quantity}× ${l.name}`).join(', ');
  const tok = o.token != null ? tokenLabel(o.token) : `#${o.number}`;
  return `<li><button type="button" class="dash-order" data-action="ord-receipt" data-id="${esc(o.id)}" aria-label="Order ${esc(tok)} receipt">
    <span class="dash-token">${esc(tok)}</span>
    <span class="grow dash-order-main"><span class="dash-order-items">${esc(items)}</span><small>${esc(time(o.at))} · ${esc(o.method)}${label ? ` · <span class="badge ${tone}">${label}</span>` : ''}</small></span>
    <strong class="dash-order-total${o.status === 'void' || o.status === 'refunded' ? ' is-struck' : ''}${money(o.total).length > 8 ? ' is-long' : ''}">${money(o.total)}</strong>
  </button></li>`;
}

function recentPanel() {
  const recent = S().orders.slice(-5).reverse();
  const body = recent.length ? `<ul class="dash-orders">${recent.map(orderRow).join('')}</ul>` : panelEmpty('No orders yet. Make the first one a dhamaka.');
  return `<section class="panel dash-panel">${panelHead('Fresh off the counter', 'receipt', btn(`All ${icon('chevron-right')}`, 'nav', 'small quiet', 'data-screen="orders"'))}${body}</section>`;
}

/**
 * Horizontal bars.
 * @param {Array<[string, number, string]>} rows label, paise, colour class
 * @param {number} total for the share label (0 hides it)
 */
function bars(rows, total) {
  const max = Math.max(0, ...rows.map(([, v]) => v));
  return `<div class="dash-bars">${rows
    .map(([label, v, tone]) => `<div class="dash-bar">
      <div class="dash-bar-top"><span>${esc(label)}</span><strong>${money(v)}${total > 0 && v > 0 ? ` <small>${pct((v * 100) / total)}</small>` : ''}</strong></div>
      <div class="dash-bar-track"><span class="dash-bar-fill dash-tint-${tone}" style="width:${barWidth(v, max).toFixed(2)}%"></span></div>
    </div>`)
    .join('')}</div>`;
}

/** @param {any} r */
function moneyPanel(r) {
  const total = r.methods.Cash + r.methods.UPI + r.methods.Other;
  return `<section class="panel dash-panel">${panelHead('Where the money came from', 'wallet')}
    ${bars([['Cash', r.methods.Cash, 'lime'], ['UPI', r.methods.UPI, 'sky'], ['Other', r.methods.Other, 'lavender']], total)}
    <div class="dash-mini-line"><span>Game income included</span><strong>${money(r.gameIncome)}</strong></div>
    <p class="footnote">Your team confirms each payment at the counter — MYS doesn’t check bank or UPI accounts. Refunds come off the method they were paid with.</p>
  </section>`;
}

/** Last bills (non-void, newest first), each opening the Bills tab. @param {number} n */
function latestBills(n) {
  return (S().expenses || [])
    .filter(e => !e.void)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, n);
}

/** @param {any} e expense */
function billRow(e) {
  const cat = categoryOf(e.category);
  const title = e.title || e.description || 'Bill';
  return `<li><button type="button" class="dash-bill" data-action="money-open" data-tab="bills" aria-label="${esc(title)}, ${esc(money(e.amount))} — open bills">
    <span class="dash-bill-emoji dash-tint-${CATEGORY_TONE[cat.id] || 'yellow'}" aria-hidden="true">${cat.emoji}</span>
    <span class="grow dash-bill-main"><span class="dash-bill-title">${esc(title)}</span><small>${esc(cat.label)} · ${esc(date(e.at))} · ${esc(e.method || 'Cash')} · ${esc(payerName(e.paidBy))}</small></span>
    <strong class="dash-bill-amount">${money(e.amount)}</strong>
  </button></li>`;
}

/** Bills by category + the last 5 bills (§16.7). @param {any} r */
function billsPanel(r) {
  const et = r.expenseTotals || {total: r.expenses || 0, count: 0, byCategory: {}};
  const head = panelHead('Bills & expenses', 'receipt', btn(`All bills ${icon('chevron-right')}`, 'money-open', 'small quiet', 'data-tab="bills"'));
  if (!et.count) {
    return `<section class="panel dash-panel dash-bills">${head}
      <div class="dash-empty dash-empty-cta">
        <p>No bills yet. Log rent, raw material and every restock run — each bill moves your break-even.</p>
        ${btn(`${icon('plus')} Add bill`, 'money-add-bill', 'small lime')}
      </div>
    </section>`;
  }
  const rows = EXPENSE_CATEGORIES.filter(x => (et.byCategory[x.id] || 0) > 0)
    .sort((a, b) => et.byCategory[b.id] - et.byCategory[a.id])
    .map(x => /** @type {[string, number, string]} */ ([`${x.emoji} ${x.label}`, et.byCategory[x.id], CATEGORY_TONE[x.id] || 'yellow']));
  return `<section class="panel dash-panel dash-bills">${head}
    <div class="dash-bills-sum"><strong>${money(et.total)}</strong><span>across ${plural(et.count, 'bill')}${et.byMethod ? ` · 💵 ${money(et.byMethod.Cash)} · 📲 ${money(et.byMethod.UPI)}` : ''}</span></div>
    ${bars(rows, et.total)}
    <h3 class="dash-sub">Latest bills</h3>
    <ul class="dash-bill-list">${latestBills(5).map(billRow).join('')}</ul>
  </section>`;
}

/** Team payout preview — "if you split right now" (teamSettlement). */
function teamPanel() {
  const head = panelHead('Team payout preview', 'users', '<span class="badge lavender">IF YOU SPLIT NOW</span>');
  const members = C().team?.members || [];
  if (!members.length) {
    return `<section class="panel dash-panel dash-team">${head}
      <div class="dash-empty dash-empty-cta">
        <p>Running this stall with friends? Add your partners — MYS returns everyone’s money first, then splits the profit fairly.</p>
        ${btn(`${icon('users')} Add your team`, 'studio-open', 'small lavender', 'data-section="team"')}
      </div>
    </section>`;
  }
  const res = teamSettlement(S(), C());
  const t = res.totals;
  const cards = res.members.map(m => {
    const tint = AVATAR_TINTS.has(m.color) ? m.color : 'cream';
    return `<li class="dash-member">
      <span class="dash-avatar" style="background:var(--tint-${tint})" aria-hidden="true">${esc(avatarText(m.name))}</span>
      <span class="grow dash-member-main"><span class="dash-member-name">${esc(m.name)}</span><small>put in ${money(m.capital)}</small></span>
      <span class="dash-member-pay"><small>take-home</small><strong>${money(m.payout)}</strong><small>${money(m.recovery)} back + ${money(m.profitShare)} profit</small></span>
    </li>`;
  }).join('');
  const warn = res.warnings[0] ? `<p class="notice dash-team-warn">${icon('alert')} ${esc(res.warnings[0])}</p>` : '';
  return `<section class="panel dash-panel dash-team">${head}
    <div class="dash-team-totals">
      <div><small>To split now</small><strong>${money(Math.max(t.pot, 0))}</strong></div>
      <div class="${t.netProfit >= 0 ? 'is-up' : 'is-down'}"><small>${t.netProfit >= 0 ? 'Net profit' : 'Net loss'}</small><strong>${money(Math.abs(t.netProfit))}</strong></div>
    </div>
    <ul class="dash-team-list">${cards}</ul>
    ${warn}
    ${btn(`See full settlement ${icon('chevron-right')}`, 'money-open', 'block dash-team-go', 'data-tab="settle"')}
    <p class="footnote">Capital back first, then profit by share. A fair-split calculator — not accounting or tax advice.</p>
  </section>`;
}

const MIX_TONES = ['pink', 'accent', 'sky', 'lime', 'lavender', 'orange', 'mint', 'coral'];

/** @param {any} r */
function mixPanel(r) {
  const entries = Object.entries(r.categories).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  const body = entries.length
    ? bars(entries.map(([k, v], i) => [k, v, MIX_TONES[i % MIX_TONES.length]]), total)
    : panelEmpty('Your sales mix shows up after the first order.');
  return `<section class="panel dash-panel">${panelHead('Menu mix', 'grid', '<span class="badge">ITEM VALUE</span>')}${body}</section>`;
}

/** @param {any} r */
function hourlyPanel(r) {
  const keys = Object.keys(r.hourly).sort();
  if (!keys.length) {
    return `<section class="panel dash-panel">${panelHead('Hourly collections', 'clock', '<span class="badge">IST · NET</span>')}${panelEmpty('No collections recorded yet.')}</section>`;
  }
  const max = Math.max(0, ...keys.map(k => r.hourly[k]));
  const peak = keys.reduce((a, k) => (r.hourly[k] > r.hourly[a] ? k : a), keys[0]);
  const cols = keys
    .map(k => {
      const v = r.hourly[k];
      const h = barWidth(v, max);
      return `<li class="dash-hour${k === peak && v > 0 ? ' is-peak' : ''}" title="${esc(hourLabel(k))}: ${esc(money(v))}">
        <span class="dash-hour-val">${esc(shortMoney(v))}</span>
        <span class="dash-hour-bar"><span style="height:${h.toFixed(2)}%"></span></span>
        <span class="dash-hour-label">${esc(hourLabel(k))}</span>
      </li>`;
    })
    .join('');
  const peakLine = r.hourly[peak] > 0
    ? `<p class="dash-peak">${icon('fire')} Rush hour: <strong>${esc(hourLabel(peak))}</strong> · ${money(r.hourly[peak])}</p>`
    : '';
  return `<section class="panel dash-panel">${panelHead('Hourly collections', 'clock', '<span class="badge">IST · NET</span>')}
    <div class="dash-hours-scroll"><ol class="dash-hours" aria-label="Collections by hour, India time">${cols}</ol></div>${peakLine}
  </section>`;
}

/** @param {any} r */
function honestPanel(r) {
  const m = r.mission;
  const ledger = isLedger(r);
  /** @type {Array<[string, string, string?]>} */
  const lines = [
    ['Gross item value', money(r.gross)],
    ['Discounts given', r.discounts ? `−${money(r.discounts)}` : money(0)],
    ['Refunds & reversals', r.refunds ? `−${money(r.refunds)}` : money(0)],
    ['Net food collections', money(r.food)],
    ['Game income', money(r.gameIncome)],
    ['Total collected', money(r.collected), 'is-total'],
    ...(/** @type {Array<[string, string]>} */ (ledger ? [] : [['Planned investment', money(m.planned ?? m.investment)]])),
    ['All bills logged', m.bills ?? m.extraExpenses ? `−${money(m.bills ?? m.extraExpenses)}` : money(0)],
  ];
  const up = m.profit >= 0;
  const verdict = m.hasTarget
    ? `<div class="dash-verdict ${up ? 'is-up' : 'is-down'}"><span>${ledger ? (up ? 'Net profit' : 'Net loss so far') : up ? 'Profit vs break-even' : 'Short of break-even'}</span><strong>${signedMoney(m.profit)}</strong></div>`
    : `<div class="dash-verdict"><span>Net profit</span><strong>${ledger ? 'Log a bill' : 'Set break-even'}</strong></div>`;
  return `<section class="panel dash-panel dash-honest">${panelHead('Honest numbers', 'list')}
    <div class="dash-lines">${lines.map(([k, v, cls]) => `<div class="receipt-line${cls ? ' ' + cls : ''}"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
    ${verdict}
    <p class="footnote">${ledger
      ? 'Net profit = collected − every bill you logged (void bills don’t count).'
      : 'Profit/loss = collected − (planned investment + bills you logged).'} It’s only as complete as the bills you enter — a quick stall check, not accounting advice.</p>
  </section>`;
}

function dashboardScreen() {
  const r = report(S(), C());
  const {unlocked, total} = milestoneCount();
  const demo = store.state.mode === 'demo';
  const right = `${demo ? '<span class="badge ink">PRACTICE LEDGER</span>' : ''}${btn(`${icon('trophy')} Milestones <span class="dash-ms-count">${unlocked}/${total}</span>`, 'nav', 'small lime', 'data-screen="milestones"')}`;
  return `<div class="dash">
    <div class="screen-heading"><div class="grow"><h1>Every rupee counts.</h1><p>Whole event so far · straight from the sales and bills saved on this device.</p></div><div class="screen-heading-right">${right}</div></div>
    ${missionHero(r)}
    ${statTiles(r)}
    <div class="dash-panels">
      ${billsPanel(r)}
      ${teamPanel()}
      ${bestsellersPanel(r)}
      ${recentPanel()}
      ${moneyPanel(r)}
      ${mixPanel(r)}
      ${hourlyPanel(r)}
      ${honestPanel(r)}
    </div>
    <button type="button" class="dash-ms-link" data-action="nav" data-screen="milestones">
      <span class="dash-ms-link-icon">${icon('trophy')}</span>
      <span class="grow"><strong>Milestones</strong><small>${unlocked} of ${plural(total, 'milestone')} unlocked · small sparks, big wins</small></span>
      ${icon('chevron-right')}
    </button>
  </div>`;
}

registerScreen('dashboard', dashboardScreen);

// ---------------------------------------------------------------------------------------------------------------------
// Day report sheet (public action: dash-report)
// ---------------------------------------------------------------------------------------------------------------------

/** @type {'today'|'all'} */
let reportScope = 'today';
let reportText = '';

function openReport() {
  const day = reportScope === 'today' ? istDate() : null;
  reportText = dayReportText(S(), C(), {day});
  const demo = store.state.mode === 'demo';
  const seg = (/** @type {'today'|'all'} */ scope, /** @type {string} */ label) =>
    `<button type="button" data-action="dash-report-scope" data-scope="${scope}" aria-pressed="${reportScope === scope}">${label}</button>`;
  const share = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    ? btn(`${icon('share')} Share…`, 'dash-report-share', 'quiet-outline')
    : '';
  const wa = `https://wa.me/?text=${encodeURIComponent(reportText)}`;
  openSheet(
    'Day report',
    `<div class="dash-report">
      <div class="segmented block dash-report-scope" role="group" aria-label="Report period">${seg('today', 'Today (IST)')}${seg('all', 'Whole event')}</div>
      ${demo ? `<p class="notice">${icon('info')} Practice ledger — these aren’t your live sales.</p>` : ''}
      <div class="dash-chat">
        <div class="dash-bubble" data-report-text>${esc(reportText)}</div>
      </div>
      <p class="footnote dash-report-note">Numbers your team recorded at the counter. MYS doesn’t verify bank or UPI payments.</p>
    </div>`,
    `${btn(`${icon('copy')} Copy report`, 'dash-report-copy', 'primary')}<a class="dash-wa-link" href="${esc(wa)}" target="_blank" rel="noopener">${icon('chat')} Share to WhatsApp</a>${share}`,
    'dash-report',
  );
}

/** Copy text with the async clipboard, falling back to a hidden textarea + execCommand. @param {string} text */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (insecure origin, permission denied…)
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

registerActions({
  'dash-report': () => {
    reportScope = 'today';
    openReport();
  },
  'dash-report-scope': (_el, ds) => {
    reportScope = ds.scope === 'all' ? 'all' : 'today';
    openReport();
    // openSheet replaced the sheet's markup; keep keyboard / screen-reader focus on the chosen period.
    /** @type {HTMLElement|null|undefined} */ (sheetEl()?.querySelector(`[data-action="dash-report-scope"][data-scope="${reportScope}"]`))?.focus();
  },
  'dash-report-copy': async () => {
    const text = reportText || dayReportText(S(), C(), {day: reportScope === 'today' ? istDate() : null});
    if (await copyText(text)) toast('Report copied. Paste it in the team group!');
    else toast('Couldn’t copy here. Long-press the report to copy it.', {tone: 'warn'});
  },
  'dash-report-share': async () => {
    if (typeof navigator.share !== 'function') return;
    try {
      await navigator.share({title: `${C().profile.stallName} — Day report`, text: reportText});
    } catch (err) {
      if (/** @type {any} */ (err)?.name !== 'AbortError') toast('Sharing didn’t work. Try Copy report instead.', {tone: 'warn'});
    }
  },
});
