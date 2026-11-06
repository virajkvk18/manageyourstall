// Orders, kitchen queue, receipts, payment confirmation and corrections (ARCHITECTURE.md §13.3). created by viraj
//
// Public actions: `ord-receipt` (data-id) opens an order's receipt sheet · `ord-queue` goes to Orders › Queue.
// Every money change goes through domain helpers inside commit(); this file only collects input and shows results.
import {
  C, S, ui, esc, money, paise, tokenLabel, icon, btn, field, check, heading, emptyState, date, time, toast,
  openSheet, closeSheet, sheetKind, sheetEl, confirmSheet, commit, render, navigate,
  registerScreen, registerActions, registerInputs, onBoot,
} from './core.mjs';
import {kitchenQueue, setKitchen, resetTokens, upcomingToken, markPaid, correctOrder, netFor, methodBalances, upiUri} from '../domain.mjs';
import {qrSvg} from '../qr.mjs';
import {istDate} from '../util.mjs';
import {CASH_QUICK, LIMITS} from '../constants.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Transient UI state (module-level, never persisted)
// ---------------------------------------------------------------------------------------------------------------------

/** @type {'queue'|'all'|null} null → Queue when the kitchen queue is on, else All orders */
let tab = null;
let query = '';
let filter = 'all';
const PAGE = 200;
let limit = PAGE;
/** Recently handed-over orders stay undoable for this long. */
const UNDO_MS = 15 * 60 * 1000;
/** Tickets older than this look urgent. */
const LATE_MIN = 10;

/**
 * Rush-hour double taps: after a card moves or a sheet swaps, the next card / button slides under the finger and a
 * second tap ~150–300 ms later would hit it (e.g. mark the NEXT token ready). A pointer tap at (almost) the same spot
 * within SETTLE_MS of such a change is treated as the tail of a double tap and ignored. Keyboard activations and
 * programmatic runs (no event) are never blocked, and a deliberate tap elsewhere goes through at once.
 */
const SETTLE_MS = 450;
const SETTLE_PX = 40;
/** @type {null | {x: number, y: number, until: number}} */
let settleAt = null;
/** Remember the tap that just changed the layout. @param {any} ev */
const settle = ev => {
  settleAt = ev && ev.detail > 0 && typeof ev.clientX === 'number' ? {x: ev.clientX, y: ev.clientY, until: Date.now() + SETTLE_MS} : null;
};
/** Is this tap the second half of a double tap? @param {any} ev */
const settling = ev => !!ev && !!settleAt && ev.detail > 0 && Date.now() < settleAt.until
  && Math.hypot(ev.clientX - settleAt.x, ev.clientY - settleAt.y) < SETTLE_PX;

/** @type {null | {id: string, method: string}} */
let pay = null;
/** @type {null | {id: string, type: 'refund'|'void', method: string|null, amountTouched: boolean}} */
let fix = null;

const FILTERS = [
  ['all', 'All'],
  ['Cash', 'Cash'],
  ['UPI', 'UPI'],
  ['Split', 'Split'],
  ['Other', 'Other'],
  ['pending', 'Pending'],
  ['corrected', 'Refunded/Void'],
];

const STATUS = {
  paid: ['PAID', 'lime', 'check'],
  pending: ['UNPAID', 'coral', 'clock'],
  partial: ['PART REFUND', 'lavender', 'reset'],
  refunded: ['REFUNDED', 'sky', 'reset'],
  void: ['VOID', 'ink', 'close'],
};
const KITCHEN = {
  preparing: ['PREPARING', 'yellow', 'chef'],
  ready: ['READY', 'mint', 'bolt'],
  handed: ['HANDED OVER', '', 'check'],
};
const METHOD_ICON = {Cash: 'cash', UPI: 'upi', Split: 'split', Other: 'wallet'};

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
const findOrder = id => S().orders.find(o => o.id === id);

/** '#07', or the order number for migrated orders without a token. @param {any} o */
const tokenOf = o => (o.token == null ? `#${o.number}` : tokenLabel(o.token));

/** Kitchen actions are only meaningful for orders still standing. @param {any} o */
const live = o => o.status !== 'void' && o.status !== 'refunded';

/** @param {string} status */
const statusBadge = status => {
  const [label, tone, ic] = STATUS[status] || [String(status).toUpperCase(), '', 'info'];
  return `<span class="badge ${tone} ord-status-${esc(status)}">${icon(ic)}${esc(label)}</span>`;
};

/** @param {string} k */
const kitchenBadge = k => {
  const [label, tone, ic] = KITCHEN[k] || [String(k).toUpperCase(), '', 'info'];
  return `<span class="badge ${tone} ord-kitchen-badge">${icon(ic)}${esc(label)}</span>`;
};

/** @param {string} m */
const methodBadge = m => `<span class="badge ord-method">${icon(METHOD_ICON[m] || 'wallet')}${esc(m)}</span>`;

/** Age label for a timestamp: 'just now', '4 min', '1 h 5 min'. @param {string} iso */
function ageLabel(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
}

/** @param {string} iso */
const ageMinutes = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

/** '6:30 pm' today, else '4 Nov, 6:30 pm'. @param {string} iso */
const when = iso => (istDate(iso) === istDate() ? time(iso) : date(iso));

/** Flavour, add-ons and line note of a cart line, escaped. @param {any} l */
const lineDetails = l => [l.flavour, ...(l.addons || []).map(a => `+ ${a.name}`), l.note ? `“${l.note}”` : '']
  .filter(Boolean)
  .map(esc)
  .join(' · ');

/** "2× Masala Chai (Extra spicy) · 1× Samosa" as markup. @param {any} o @param {number} [max] */
function itemsSummary(o, max = 8) {
  const shown = o.items.slice(0, max).map(l => {
    const extra = lineDetails(l);
    return `<span class="ord-item"><b>${l.quantity}×</b> ${esc(l.name)}${extra ? ` <small>(${extra})</small>` : ''}</span>`;
  });
  if (o.items.length > max) shown.push(`<span class="ord-item ord-item-more">+${o.items.length - max} more</span>`);
  return shown.join('');
}

/** @param {any} o */
const itemCount = o => o.items.reduce((n, l) => n + l.quantity, 0);

/** @param {string} text */
const tape = (text, tag = 'p') => `<${tag} class="ord-note">${icon('note')}<span>${esc(text)}</span></${tag}>`;

/** Is the device busy with something we must not disturb? */
function userBusy() {
  if (sheetEl()?.open || /** @type {any} */ (document.getElementById('pin-dialog'))?.open) return true;
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || /** @type {any} */ (a).isContentEditable);
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function currentTab() {
  return tab || (C().kitchenQueue ? 'queue' : 'all');
}

function ordersScreen() {
  const q = kitchenQueue(S());
  const inQueue = q.preparing.length + q.ready.length;
  const t = currentTab();
  const tabBtn = (key, label, count) => {
    const on = t === key;
    return `<button type="button" class="ord-tab${on ? ' active' : ''}" data-action="ord-tab" data-tab="${key}" aria-pressed="${on}">${label}<span class="ord-tab-count">${count}</span></button>`;
  };
  const tabs = `<div class="segmented ord-tabs" role="group" aria-label="Orders view">
    ${tabBtn('queue', `${icon('chef')}Queue`, inQueue)}${tabBtn('all', `${icon('receipt')}All orders`, S().orders.length)}
  </div>`;
  return `<div class="ord-screen">
    ${heading('Orders', t === 'queue' && C().kitchenQueue ? 'Tokens on the fire. Shout them out when they’re ready.' : 'Every order. Every rupee. All accounted for.', tabs)}
    ${t === 'queue' ? queueView(q) : allView()}
  </div>`;
}

// ---- Queue ----------------------------------------------------------------------------------------------------------

/** @param {{preparing: any[], ready: any[]}} q */
function queueView(q) {
  const s = S();
  const total = q.preparing.length + q.ready.length;
  const toolbar = `<div class="ord-toolbar">
    <span class="ord-next">Next token <b>${tokenLabel(upcomingToken(s))}</b></span>
    ${btn(`${icon('reset')} Reset tokens`, 'ord-reset-tokens', 'small quiet-outline')}
  </div>`;
  const off = !C().kitchenQueue
    ? `<div class="notice sky ord-off">${icon('info')}<div class="grow"><strong>Kitchen queue is off.</strong>
        <p>New orders are marked handed over right away. Turn the queue on to get big token cards your kitchen can follow.</p>
        ${btn(`${icon('users')} Turn it on in Studio › Team`, 'studio-open', 'small', 'data-section="team"')}</div></div>`
    : '';
  if (!total) {
    return `${off}${C().kitchenQueue ? toolbar : ''}${justHanded()}${
      C().kitchenQueue ? emptyState('chef', 'All caught up!', 'No tokens waiting. New orders land here with a big token number.', btn(`${icon('sell')} Back to selling`, 'nav', 'primary', 'data-screen="sell"')) : ''
    }`;
  }
  const column = (key, list, title, ic) => `<section class="ord-col ord-col-${key}" aria-label="${title}">
    <h2 class="ord-col-title">${icon(ic)}<span class="grow">${title}</span><span class="ord-col-count">${list.length}</span></h2>
    ${list.length ? `<div class="ord-tickets">${list.map(ticket).join('')}</div>` : `<p class="ord-col-empty">${key === 'ready' ? 'Nothing waiting at the counter.' : 'Kitchen is clear.'}</p>`}
  </section>`;
  return `${off}${toolbar}${justHanded()}<div class="ord-board">
    ${column('preparing', q.preparing, 'Preparing', 'chef')}
    ${column('ready', q.ready, 'Ready', 'bolt')}
  </div>`;
}

/** One big token card. @param {any} o */
function ticket(o) {
  const ready = o.kitchen === 'ready';
  const since = o.at; // customers count from the moment they ordered
  const late = !ready && ageMinutes(since) >= LATE_MIN;
  const advance = ready
    ? btn(`${icon('check')} Handed over`, 'ord-kitchen', 'primary ord-advance', `data-id="${esc(o.id)}" data-to="handed"`)
    : btn(`${icon('bolt')} Mark ready`, 'ord-kitchen', 'lime ord-advance', `data-id="${esc(o.id)}" data-to="ready"`);
  const undo = ready
    ? btn(icon('reset'), 'ord-kitchen', 'icon-btn small quiet-outline ord-undo', `data-id="${esc(o.id)}" data-to="preparing" aria-label="Undo: move ${tokenOf(o)} back to Preparing" title="Back to Preparing"`)
    : '';
  return `<article class="ord-ticket${ready ? ' is-ready' : ''}${late ? ' is-late' : ''}" data-order="${esc(o.id)}">
    <button type="button" class="quiet ord-ticket-main" data-action="ord-receipt" data-id="${esc(o.id)}" title="Open receipt">
      <span class="sr-only">Open receipt for order #${o.number}, token</span>
      <span class="ord-ticket-head">
        <span class="ord-token">${tokenOf(o)}</span>
        <span class="ord-ticket-meta">
          ${o.status === 'pending' ? `<span class="badge coral ord-unpaid">${icon('alert')}UNPAID</span>` : ''}
          <span class="ord-age${late ? ' late' : ''}" data-at="${esc(since)}" data-late="${ready ? '' : '1'}">${icon('clock')}<span>${ageLabel(since)}</span></span>
        </span>
      </span>
      <span class="ord-ticket-items">${itemsSummary(o)}</span>
      ${o.note ? tape(o.note, 'span') : ''}
    </button>
    <div class="ord-ticket-actions">${undo}${advance}</div>
  </article>`;
}

/** Strip of orders handed over in the last few minutes, each with an undo. */
function justHanded() {
  const now = Date.now();
  const recent = S().orders
    .filter(o => live(o) && o.kitchen === 'handed' && o.kitchenAt?.preparing && o.kitchenAt?.handed && now - new Date(o.kitchenAt.handed).getTime() < UNDO_MS)
    .sort((a, b) => (a.kitchenAt.handed < b.kitchenAt.handed ? 1 : -1))
    .slice(0, 4);
  if (!recent.length) return '';
  return `<div class="ord-handed" aria-label="Just handed over">
    <span class="eyebrow">Just handed over</span>
    <div class="ord-handed-list">${recent.map(o => btn(`${icon('reset')} ${tokenOf(o)} · Undo`, 'ord-kitchen', 'small quiet-outline ord-handed-undo', `data-id="${esc(o.id)}" data-to="ready" aria-label="Undo: move ${tokenOf(o)} back to Ready"`)).join('')}</div>
  </div>`;
}

// ---- All orders -----------------------------------------------------------------------------------------------------

/** @param {any} o @param {string} f */
function passesFilter(o, f) {
  if (f === 'all') return true;
  if (f === 'pending') return o.status === 'pending';
  if (f === 'corrected') return o.status === 'partial' || o.status === 'refunded' || o.status === 'void';
  return o.method === f && o.status !== 'pending'; // pending orders have only an expected method
}

/** Token "#07" / "7", order number, or item / flavour / note text. @param {any} o @param {string} q */
function matches(o, q) {
  if (!q) return true;
  const num = /^#?\s*0*(\d{1,6})$/.exec(q);
  if (num) {
    const n = Number(num[1]);
    if (o.token === n || o.number === n) return true;
  }
  const needle = q.toLowerCase();
  return o.items.some(l => `${l.name} ${l.flavour || ''} ${l.note || ''}`.toLowerCase().includes(needle)) || (o.note || '').toLowerCase().includes(needle);
}

function allView() {
  const orders = S().orders;
  if (!orders.length) {
    return emptyState('receipt', 'No orders yet', 'Your first sale shows up here with its token, payment and receipt.', btn(`${icon('sell')} Start selling`, 'nav', 'primary', 'data-screen="sell"'));
  }
  const q = query.trim();
  const searched = orders.filter(o => matches(o, q));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, 0]));
  for (const o of searched) for (const [k] of FILTERS) if (passesFilter(o, k)) counts[k]++;
  const list = searched
    .filter(o => passesFilter(o, filter))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.number - a.number));
  const chips = FILTERS.map(([k, label]) => {
    const on = filter === k;
    return `<button type="button" class="chip${on ? ' active' : ''}" data-action="ord-filter" data-filter="${k}" aria-pressed="${on}">${label}<span class="ord-chip-count">${counts[k]}</span></button>`;
  }).join('');
  const search = `<div class="ord-search">
    <label class="sr-only" for="ord-search">Search orders</label>
    ${icon('search', 'ord-search-icon')}
    <input id="ord-search" type="search" data-input="ord-search" value="${esc(query)}" placeholder="Token, order no. or item" autocomplete="off" enterkeyhint="search" maxlength="60">
  </div>`;
  const shown = list.slice(0, limit);
  const body = list.length
    ? `<div class="panel ord-list">${shown.map(row).join('')}</div>
      ${list.length > shown.length ? `<div class="ord-more">${btn(`Show more · ${list.length - shown.length} left`, 'ord-more', 'quiet-outline')}</div>` : ''}`
    : emptyState('search', 'No orders match', 'Try a token like 7, an order number, or an item name.', btn('Clear search & filters', 'ord-clear', 'small'));
  return `<div class="ord-filters">${search}<div class="ord-chips" role="group" aria-label="Filter orders">${chips}</div></div>
    <p class="ord-count muted">${list.length === 1 ? '1 order' : `${list.length} orders`}${list.length > shown.length ? ` · showing newest ${shown.length}` : ''}</p>
    ${body}`;
}

/** @param {any} o */
function row(o) {
  const n = itemCount(o);
  const names = o.items.map(l => `${l.quantity}× ${l.name}`).join(', ');
  return `<button type="button" class="quiet ord-row ord-row-${esc(o.status)}" data-action="ord-receipt" data-id="${esc(o.id)}">
    <span class="ord-row-token">${tokenOf(o)}</span>
    <span class="ord-row-main">
      <span class="ord-row-title">Order #${o.number} <span class="muted">· ${when(o.at)}</span></span>
      <span class="ord-row-items">${n} ${n === 1 ? 'item' : 'items'} · ${esc(names)}</span>
    </span>
    <span class="ord-row-badges">${methodBadge(o.method)}${statusBadge(o.status)}${live(o) ? kitchenBadge(o.kitchen) : ''}</span>
    <span class="ord-row-total${o.status === 'void' ? ' struck' : ''}">${money(o.total)}</span>
  </button>`;
}

registerScreen('orders', ordersScreen);

// ---------------------------------------------------------------------------------------------------------------------
// Receipt sheet
// ---------------------------------------------------------------------------------------------------------------------

/** Human line for one audit entry. @param {any} a */
function auditText(a) {
  const d = a.details || {};
  const amt = typeof d.amount === 'number' ? money(d.amount) : '';
  switch (a.type) {
    case 'order-created': {
      const total = typeof d.total === 'number' ? money(d.total) : '';
      return d.status === 'pending'
        ? `Order saved as unpaid${total ? ` · ${total} due` : ''}`
        : `Order placed${total ? ` · ${total}` : ''}${d.method ? ` by ${esc(d.method)}` : ''}`;
    }
    case 'payment-confirmed': {
      const parts = d.split ? ` (Cash ${money(d.split.Cash)} + UPI ${money(d.split.UPI)})` : '';
      return `Payment confirmed · ${amt} by ${esc(d.method || '')}${parts}`;
    }
    case 'refund': {
      const by = Array.isArray(d.methods) ? d.methods.map(m => esc(m.method)).join(' + ') : '';
      return `Refund · ${amt}${by ? ` from ${by}` : ''}`;
    }
    case 'void':
      return `Order voided${d.amount ? ` · ${amt} reversed` : ''}`;
    default:
      return esc(String(a.type || 'update').replaceAll('-', ' '));
  }
}

/** @param {string} id */
function openReceipt(id) {
  const o = findOrder(id);
  if (!o) throw Error('That order isn’t in this ledger. It may belong to the other (live / practice) counter.');
  const s = S();
  const net = netFor(s, id);
  const bal = methodBalances(s, id);
  const refunded = s.payments.filter(p => p.entityId === id && p.amount < 0).reduce((n, p) => n - p.amount, 0);

  const notice = o.status === 'pending'
    ? `<div class="notice pink">${icon('alert')}<div><strong>Not paid yet.</strong> Collect ${money(o.total)}, then confirm the payment.</div></div>`
    : o.status === 'void'
      ? `<div class="notice danger">${icon('close')}<div><strong>Voided.</strong> No money kept on this order and its stock was released.</div></div>`
      : o.status === 'refunded'
        ? `<div class="notice sky">${icon('reset')}<div><strong>Fully refunded.</strong> ${money(refunded)} went back to the customer.</div></div>`
        : '';

  const lines = o.items.map(l => {
    const extra = lineDetails(l);
    const each = l.quantity > 1 ? `${money(l.unitPrice)} each` : '';
    const sub = [extra, each, l.bundle ? 'combo price' : ''].filter(Boolean).join(' · ');
    return `<div class="receipt-line"><span><b>${l.quantity} ×</b> ${esc(l.name)}${sub ? `<small>${sub}</small>` : ''}</span><strong>${money(l.lineTotal)}</strong></div>`;
  }).join('');

  const totalsHtml = [
    `<div class="receipt-line"><span>Subtotal</span><strong>${money(o.subtotal)}</strong></div>`,
    o.discount || o.discountInfo
      ? `<div class="receipt-line"><span>Discount${o.discountInfo ? `<small>${esc(o.discountInfo.label)}</small>` : ''}</span><strong>−${money(o.discount)}</strong></div>`
      : '',
    `<div class="receipt-line ord-total-line"><span>Order total</span><strong>${money(o.total)}</strong></div>`,
    refunded ? `<div class="receipt-line ord-refunded-line"><span>${o.status === 'void' ? 'Reversed (void & refunds)' : 'Refunded'}</span><strong>−${money(refunded)}</strong></div>` : '',
    `<div class="receipt-line ord-net-line"><span>Net collected<small>${o.status === 'pending' ? 'Nothing recorded until payment is confirmed' : 'What this order actually brought in'}</small></span><strong>${money(net)}</strong></div>`,
  ].join('');

  const payRows = [];
  if (o.status !== 'pending') {
    if (o.split) payRows.push(['Split', `Cash ${money(o.split.Cash)} + UPI ${money(o.split.UPI)}`]);
    if (o.cashReceived != null) {
      payRows.push(['Cash received', money(o.cashReceived)]);
      payRows.push(['Change returned', money(o.change)]);
    }
    if (refunded || o.method === 'Split') {
      const parts = ['Cash', 'UPI', 'Other'].filter(m => bal[m] !== 0 || (o.split && m !== 'Other')).map(m => `${m} ${money(bal[m])}`);
      if (parts.length) payRows.push(['Net by method', parts.join(' · ')]);
    }
  }
  const payment = `<h3 class="ord-sub">${icon(METHOD_ICON[o.method] || 'wallet')} Payment</h3>
    <div class="receipt-line"><span>${o.status === 'pending' ? 'Expected method' : 'Method'}</span><strong>${esc(o.method)}</strong></div>
    ${payRows.map(([k, v]) => `<div class="receipt-line"><span>${k}</span><strong>${v}</strong></div>`).join('')}`;

  const steps = [['preparing', 'Order in · preparing'], ['ready', 'Ready at the counter'], ['handed', 'Handed over']];
  const stamps = steps.filter(([k]) => o.kitchenAt?.[k]);
  const timeline = stamps.length
    ? `<ol class="ord-timeline">${stamps.map(([k, label]) => `<li class="${o.kitchen === k ? 'now' : ''}"><span class="ord-dot" aria-hidden="true"></span><span class="grow">${label}</span><time>${time(o.kitchenAt[k])}</time></li>`).join('')}</ol>`
    : '<p class="muted ord-small">No kitchen times recorded for this order.</p>';
  let kitchenBtns = '';
  if (live(o)) {
    const k = (to, label, cls) => btn(label, 'ord-kitchen', `small ${cls}`, `data-id="${esc(o.id)}" data-to="${to}"`);
    if (o.kitchen === 'preparing') kitchenBtns = k('ready', `${icon('bolt')} Mark ready`, 'lime');
    else if (o.kitchen === 'ready') kitchenBtns = k('preparing', `${icon('reset')} Back to preparing`, 'quiet-outline') + k('handed', `${icon('check')} Handed over`, 'primary');
    // Only orders that went through the kitchen can go back to Ready (not queue-off or migrated v1 orders).
    else if (o.kitchenAt?.preparing || o.kitchenAt?.ready) kitchenBtns = k('ready', `${icon('reset')} Back to ready`, 'quiet-outline');
  }

  const history = s.audit.filter(a => a.entityId === id).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  const historyHtml = history.length
    ? `<ul class="ord-audit">${history.map(a => `<li class="ord-audit-${esc(a.type)}"><span class="ord-audit-text"><strong>${auditText(a)}</strong>${a.details?.reason ? `<span class="ord-reason">“${esc(a.details.reason)}”</span>` : ''}</span><small>${date(a.at)} · ${esc(a.operator)}</small></li>`).join('')}</ul>`
    : '<p class="muted ord-small">No history yet.</p>';

  const body = `<div class="ord-receipt">
    <div class="ord-receipt-a">
    <div class="ord-hero">
      <span class="ord-hero-token">${tokenOf(o)}</span>
      <div class="ord-hero-info">
        <strong class="ord-hero-no">Order #${o.number}</strong>
        <span class="muted">${date(o.at)} · ${esc(o.operator)}</span>
        <span class="ord-row-badges">${statusBadge(o.status)}${live(o) ? kitchenBadge(o.kitchen) : ''}${methodBadge(o.method)}</span>
      </div>
    </div>
    ${notice}
    <h3 class="ord-sub">${icon('receipt')} Items</h3>
    <div class="ord-lines">${lines}</div>
    ${o.note ? tape(o.note) : ''}
    <div class="ord-totals">${totalsHtml}</div>
    </div>
    <div class="ord-receipt-b">
    ${payment}
    <h3 class="ord-sub">${icon('chef')} Kitchen</h3>
    ${timeline}
    ${kitchenBtns ? `<div class="ord-kitchen-btns">${kitchenBtns}</div>` : ''}
    <h3 class="ord-sub">${icon('list')} History</h3>
    ${historyHtml}
    <p class="footnote">Reference ${esc(o.id)}</p>
    </div>
  </div>`;

  const actions = [
    o.status === 'pending' ? btn(`${icon('check')} Confirm payment`, 'ord-pay', 'primary', `data-id="${esc(id)}"`) : '',
    o.status !== 'void' && o.status !== 'refunded' ? btn(`${icon('lock')} Correct order`, 'ord-correct', 'quiet-outline', `data-id="${esc(id)}"`) : '',
    o.status !== 'pending' ? btn('Done', 'close', o.status === 'void' || o.status === 'refunded' ? 'primary' : 'yellow') : '',
  ].join('');
  openSheet(`${esc(tokenOf(o))} · Order #${o.number}`, body, actions, 'ord-receipt', {wide: true});
}

// ---------------------------------------------------------------------------------------------------------------------
// Confirm payment sheet (pending orders)
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function openPay(id, ev = null) {
  const o = findOrder(id);
  if (!o) throw Error('That order could not be found.');
  if (o.status !== 'pending') {
    openReceipt(id);
    throw Error('This order is already paid.');
  }
  const canSplit = o.total >= 2;
  pay = {id, method: o.method === 'Split' && !canSplit ? 'Cash' : o.method};
  const c = C();
  const methods = ['Cash', 'UPI', 'Split', 'Other'].map(m => {
    const disabled = m === 'Split' && !canSplit;
    return `<button type="button" data-action="ord-pay-method" data-method="${m}" aria-pressed="${pay.method === m}"${disabled ? ' disabled' : ''}>${icon(METHOD_ICON[m])}${m}</button>`;
  }).join('');
  const quick = [`<button type="button" class="small ord-quick" data-action="ord-pay-quick" data-amount="exact">Exact</button>`]
    .concat(CASH_QUICK.map(p => `<button type="button" class="small ord-quick" data-action="ord-pay-quick" data-amount="${p}">${money(p)}</button>`))
    .join('');
  const upiHint = c.upi.id
    ? ''
    : `<div class="notice sky ord-upi-hint">${icon('qr')}<div>Add your UPI ID in Studio to show a scan-and-pay QR here. ${btn('Set up UPI', 'studio-open', 'small', 'data-section="upi"')}</div></div>`;
  const body = `<form class="ord-pay" data-submit="ord-pay-save" data-id="${esc(id)}" novalidate>
    <div class="ord-due">
      <span class="ord-due-token">${tokenOf(o)}</span>
      <div><span class="eyebrow">Collect for order #${o.number}</span><strong class="ord-due-amount">${money(o.total)}</strong></div>
    </div>
    <div class="field"><span class="field-label" id="ord-pay-label">How did they pay?</span>
      <div class="segmented block ord-methods" role="group" aria-labelledby="ord-pay-label">${methods}</div></div>
    <div data-pay-part="split" hidden>
      ${field('Cash part (₹)', 'ord-pay-cash', o.split ? String(o.split.Cash / 100) : '', 'text', 'inputmode="decimal" autocomplete="off" data-input="ord-pay" placeholder="e.g. 50"')}
      <p class="ord-split-upi">UPI part <strong data-pay-out="upi-part">—</strong></p>
    </div>
    <div data-pay-part="cash" hidden>
      ${field('Cash received (optional)', 'ord-pay-received', '', 'text', 'inputmode="decimal" autocomplete="off" data-input="ord-pay" placeholder="Tap a note or type"')}
      <div class="ord-quicks" role="group" aria-label="Quick cash amounts">${quick}</div>
      <p class="ord-change" data-pay-out="change" aria-live="polite"></p>
    </div>
    <div data-pay-part="qr" hidden>${upiHint}<div class="ord-qr" data-pay-out="qr"></div></div>
    <div class="ord-confirm">${check('ord-pay-ok', '<span data-pay-out="ok-text">I received the money.</span>', false, 'id="ord-pay-ok"')}</div>
    <p class="footnote">MYS doesn’t check bank or UPI payments. Confirm only after you’ve seen the money in hand or in your UPI app.</p>
  </form>`;
  openSheet(`Confirm payment · ${esc(tokenOf(o))}`, body, btn('Cancel', 'ord-back', 'quiet-outline', `data-id="${esc(id)}"`) + btn(`Mark paid · ${money(o.total)}`, 'ord-pay-save', 'primary ord-pay-save'), 'ord-pay');
  settle(ev);
  syncPay();
}

/** Read the pay form, update derived displays in place. Returns the parsed payment. */
function syncPay() {
  const root = sheetEl();
  if (!pay || sheetKind() !== 'ord-pay') return null;
  const o = findOrder(pay.id);
  if (!o) return null;
  const m = pay.method;
  const val = (/** @type {string} */ name) => (/** @type {HTMLInputElement|null} */ (root.querySelector(`#${name}`))?.value || '').trim();
  const out = (/** @type {string} */ k) => /** @type {HTMLElement|null} */ (root.querySelector(`[data-pay-out="${k}"]`));
  const part = (/** @type {string} */ k, /** @type {boolean} */ show) => {
    const el = root.querySelector(`[data-pay-part="${k}"]`);
    if (el) /** @type {HTMLElement} */ (el).hidden = !show;
  };
  root.querySelectorAll('[data-action="ord-pay-method"]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-method') === m)));

  /** @type {number|null} */
  let cashPart = null;
  let cashPartError = '';
  if (m === 'Split') {
    const raw = val('ord-pay-cash');
    if (raw) {
      try {
        cashPart = paise(raw);
        if (cashPart < 1 || cashPart >= o.total) {
          cashPartError = `Cash part must be between ₹0.01 and ${money(o.total - 1)}.`;
          cashPart = null;
        }
      } catch (err) {
        cashPartError = /** @type {Error} */ (err).message;
      }
    }
  }
  const upiAmount = m === 'UPI' ? o.total : m === 'Split' && cashPart !== null ? o.total - cashPart : 0;
  const cashDue = m === 'Cash' ? o.total : m === 'Split' ? cashPart : null;

  part('split', m === 'Split');
  part('cash', m === 'Cash' || m === 'Split');
  part('qr', m === 'UPI' || m === 'Split');
  const upiPart = out('upi-part');
  if (upiPart) {
    upiPart.textContent = m === 'Split' ? (cashPart !== null ? money(upiAmount) : cashPartError || 'enter the cash part') : '';
    upiPart.classList.toggle('bad', !!cashPartError);
    upiPart.classList.toggle('hint', m === 'Split' && cashPart === null && !cashPartError);
  }

  // Cash received → change
  let received = null;
  const change = out('change');
  const rawReceived = val('ord-pay-received');
  if (change) {
    change.textContent = '';
    change.className = 'ord-change';
    if (rawReceived && cashDue !== null) {
      try {
        received = paise(rawReceived);
        if (received >= cashDue) {
          change.innerHTML = `Return <strong>${money(received - cashDue)}</strong>`;
          change.classList.add('good');
        } else {
          change.textContent = `Short by ${money(cashDue - received)}`;
          change.classList.add('bad');
        }
      } catch (err) {
        change.textContent = /** @type {Error} */ (err).message;
        change.classList.add('bad');
      }
    } else if (cashDue !== null) {
      change.textContent = `Cash due ${money(cashDue)}`;
    }
  }
  root.querySelectorAll('[data-action="ord-pay-quick"]').forEach(b => {
    const amt = b.getAttribute('data-amount');
    /** @type {HTMLButtonElement} */ (b).disabled = cashDue === null || (amt !== 'exact' && Number(amt) < cashDue);
  });

  // UPI QR
  const qr = out('qr');
  if (qr) {
    const c = C();
    const key = `${m}:${upiAmount}:${c.upi.id}:${c.upi.payeeName}`;
    if (qr.dataset.key !== key) {
      qr.dataset.key = key;
      let uri = null;
      try {
        uri = upiAmount >= 1 ? upiUri(c, upiAmount, `Token ${tokenOf(o)} · ${c.profile.stallName}`.slice(0, 80)) : null;
      } catch {
        uri = null;
      }
      qr.innerHTML = uri
        ? `<div class="ord-qr-code">${qrSvg(uri, {label: `UPI QR for ${money(upiAmount)}`})}</div><div class="ord-qr-info"><span class="eyebrow">Scan & pay</span><strong>${money(upiAmount)}</strong><span>to ${esc(c.upi.payeeName || c.profile.stallName)}</span><small>${esc(c.upi.id)}</small></div>`
        : c.upi.id && m === 'Split'
          ? '<p class="muted ord-small">The QR appears once the cash part is set.</p>'
          : '';
    }
  }

  // Confirmation text and button label
  const okText = out('ok-text');
  if (okText) {
    okText.textContent = m === 'Cash'
      ? `I collected ${money(o.total)} in cash.`
      : m === 'UPI'
        ? `I saw ${money(o.total)} arrive in our UPI app.`
        : m === 'Split'
          ? cashPart !== null ? `I collected ${money(cashPart)} cash and saw ${money(upiAmount)} arrive on UPI.` : 'I collected the cash part and saw the UPI part arrive.'
          : `I received ${money(o.total)} another way.`;
  }
  return {o, m, cashPart, cashPartError, received, rawReceived};
}

async function savePay() {
  const r = syncPay();
  if (!r || !pay) return;
  const {o, m, cashPart, cashPartError} = r;
  /** @type {any} */
  let split = null;
  if (m === 'Split') {
    if (cashPartError) throw Error(cashPartError);
    if (cashPart === null) throw Error('Enter the cash part of the split.');
    split = {Cash: cashPart, UPI: o.total - cashPart};
  }
  const cashReceived = (m === 'Cash' || m === 'Split') && r.rawReceived ? paise(r.rawReceived) : null;
  const ok = /** @type {HTMLInputElement|null} */ (sheetEl().querySelector('#ord-pay-ok'));
  if (!ok?.checked) throw Error('Tick the confirmation once the money is really in hand.');
  const id = pay.id;
  const order = await commit(st => markPaid(st[st.mode], st.config, id, {method: m, split, cashReceived}));
  pay = null;
  openReceipt(id);
  toast(`Paid! ${money(order.total)} recorded for ${tokenOf(order)}.${order.change ? ` Return ${money(order.change)}.` : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Correction sheet (admin): refund part of an order, or void it
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function openFix(id, ev = null) {
  const o = findOrder(id);
  if (!o) throw Error('That order could not be found.');
  if (o.status === 'void') throw Error('This order is already void.');
  const s = S();
  const bal = methodBalances(s, id);
  const net = netFor(s, id);
  const canRefund = o.status !== 'pending' && net > 0;
  const isSplit = o.method === 'Split';
  // A Split order with money left on only one part: pick that part for the cashier.
  const splitLeft = isSplit ? ['Cash', 'UPI'].filter(m => bal[m] > 0) : [];
  const method = isSplit ? (splitLeft.length === 1 ? splitLeft[0] : null) : o.method;
  fix = {id, type: canRefund ? 'refund' : 'void', method, amountTouched: false};
  const defaultAmount = canRefund && method ? bal[/** @type {'Cash'|'UPI'|'Other'} */ (method)] || 0 : 0;
  const types = `<div class="segmented block ord-fix-types" role="group" aria-label="Correction type">
    <button type="button" data-action="ord-fix-type" data-type="refund" aria-pressed="${fix.type === 'refund'}"${canRefund ? '' : ' disabled'}>${icon('reset')}Refund</button>
    <button type="button" data-action="ord-fix-type" data-type="void" aria-pressed="${fix.type === 'void'}">${icon('close')}Void order</button>
  </div>`;
  const methodPick = isSplit
    ? `<div class="field"><span class="field-label" id="ord-fix-mlabel">Refund from which part?</span>
        <div class="ord-fix-methods" role="group" aria-labelledby="ord-fix-mlabel">${['Cash', 'UPI'].map(m => `<button type="button" class="ord-fix-method" data-action="ord-fix-method" data-method="${m}" aria-pressed="false"${bal[m] > 0 ? '' : ' disabled'}>${icon(METHOD_ICON[m])}<span class="grow">${m}</span><small>${money(bal[m])} left</small></button>`).join('')}</div></div>`
    : '';
  const netSummary = `<div class="ord-fix-summary">
    <div><span class="eyebrow">Order total</span><strong>${money(o.total)}</strong></div>
    <div><span class="eyebrow">Net collected</span><strong>${money(net)}</strong></div>
    <div><span class="eyebrow">Status</span>${statusBadge(o.status)}</div>
  </div>`;
  const reverseList = ['Cash', 'UPI', 'Other'].filter(m => bal[m] > 0).map(m => `${money(bal[m])} ${m}`).join(' + ');
  const body = `<form class="ord-fix" data-submit="ord-fix-save" data-id="${esc(id)}" novalidate>
    ${netSummary}
    ${types}
    ${!canRefund ? `<p class="muted ord-small">${o.status === 'pending' ? 'Nothing was paid on this order yet, so it can only be voided.' : 'No money is left on this order to refund.'}</p>` : ''}
    <div data-fix-part="refund">
      ${methodPick}
      ${field('Refund amount (₹)', 'ord-fix-amount', defaultAmount ? String(defaultAmount / 100) : '', 'text', 'inputmode="decimal" autocomplete="off" data-input="ord-fix-amount"', isSplit ? 'Pick Cash or UPI first. Each part can only refund what it collected.' : `Up to ${money(defaultAmount)} by ${esc(o.method)}.`)}
      <div class="notice">${icon('info')}<div>Refunds don’t put prepared food back in stock. The order stays on the books with a lower net.</div></div>
    </div>
    <div data-fix-part="void" hidden>
      <div class="notice danger">${icon('alert')}<div><strong>Void cancels the whole order.</strong> ${reverseList ? `${reverseList} is reversed out of your collections.` : 'No money was collected on it.'} Its stock is released and it leaves the kitchen queue.</div></div>
    </div>
    ${field('Reason (required)', 'ord-fix-reason', '', 'text', `maxlength="${LIMITS.reason}" autocomplete="off" placeholder="e.g. Wrong item, customer changed mind"`)}
    <div class="ord-confirm">${check('ord-fix-ok', '<span data-fix-out="ok-text">I’ve returned the money to the customer.</span>', false, 'id="ord-fix-ok"')}</div>
    <p class="footnote">Corrections are permanent and show in this order’s history with your name.</p>
  </form>`;
  openSheet(`Correct ${esc(tokenOf(o))} · Order #${o.number}`, body,
    btn('Cancel', 'ord-back', 'quiet-outline', `data-id="${esc(id)}"`) + btn('Save correction', 'ord-fix-save', 'danger ord-fix-save'), 'ord-fix');
  settle(ev);
  syncFix();
}

function syncFix() {
  const root = sheetEl();
  if (!fix || sheetKind() !== 'ord-fix') return;
  const o = findOrder(fix.id);
  if (!o) return;
  const bal = methodBalances(S(), fix.id);
  root.querySelectorAll('[data-action="ord-fix-type"]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-type') === fix.type)));
  root.querySelectorAll('[data-action="ord-fix-method"]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-method') === fix.method)));
  root.querySelectorAll('[data-fix-part]').forEach(el => {
    /** @type {HTMLElement} */ (el).hidden = el.getAttribute('data-fix-part') !== fix.type;
  });
  const raw = (/** @type {HTMLInputElement|null} */ (root.querySelector('#ord-fix-amount'))?.value || '').trim();
  let amount = null;
  try {
    amount = raw ? paise(raw) : null;
  } catch {
    amount = null;
  }
  const okText = root.querySelector('[data-fix-out="ok-text"]');
  const save = root.querySelector('.ord-fix-save');
  if (fix.type === 'void') {
    const net = netFor(S(), fix.id);
    if (okText) okText.textContent = net > 0 ? `I’ve returned ${money(net)} and want to cancel this order for good.` : 'Cancel this order for good.';
    if (save) save.innerHTML = `${icon('close')} Void order`;
  } else {
    const from = fix.method ? ` by ${fix.method}` : '';
    if (okText) okText.textContent = amount ? `I’ve returned ${money(amount)}${from} to the customer.` : 'I’ve returned the money to the customer.';
    if (save) save.innerHTML = `${icon('reset')} ${amount ? `Refund ${money(amount)}` : 'Refund'}`;
  }
  const hint = root.querySelector('#ord-fix-amount-hint');
  if (hint && o.method === 'Split') hint.textContent = fix.method ? `Up to ${money(bal[fix.method])} by ${fix.method}.` : 'Pick Cash or UPI first. Each part can only refund what it collected.';
}

async function saveFix() {
  if (!fix || sheetKind() !== 'ord-fix') return;
  const root = sheetEl();
  const id = fix.id;
  const type = fix.type;
  const reason = (/** @type {HTMLInputElement} */ (root.querySelector('#ord-fix-reason'))?.value || '').trim();
  /** @type {number} */
  let amount = 0;
  if (type === 'refund') {
    const raw = (/** @type {HTMLInputElement} */ (root.querySelector('#ord-fix-amount'))?.value || '').trim();
    if (!raw) throw Error('Enter how much to refund.');
    amount = paise(raw);
  }
  if (!reason) throw Error('Add a short reason so the team knows what happened.');
  if (!/** @type {HTMLInputElement|null} */ (root.querySelector('#ord-fix-ok'))?.checked) throw Error('Tick the confirmation to save this correction.');
  const method = type === 'refund' ? fix.method : null;
  const order = await commit(st => correctOrder(st[st.mode], st.config, id, {type, amount, reason, method}));
  fix = null;
  openReceipt(id);
  toast(type === 'void' ? `${tokenOf(order)} voided. Collections updated.` : `Refund of ${money(amount)} recorded for ${tokenOf(order)}.`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions & inputs
// ---------------------------------------------------------------------------------------------------------------------

registerActions(
  {
    'ord-receipt': (_el, ds, ev) => {
      if (settling(ev)) return;
      openReceipt(ds.id || '');
    },
    'ord-queue': () => {
      tab = 'queue';
      closeSheet();
      navigate('orders');
    },
    'ord-tab': (_el, ds) => {
      tab = ds.tab === 'all' ? 'all' : 'queue';
      render();
    },
    'ord-filter': (_el, ds) => {
      filter = FILTERS.some(([k]) => k === ds.filter) ? ds.filter : 'all';
      limit = PAGE;
      render();
    },
    'ord-clear': () => {
      filter = 'all';
      query = '';
      limit = PAGE;
      render();
    },
    'ord-more': () => {
      limit += PAGE;
      render();
    },
    'ord-kitchen': async (_el, ds, ev) => {
      if (settling(ev)) return;
      const id = ds.id || '';
      const to = ds.to || '';
      const fromSheet = sheetKind() === 'ord-receipt';
      const before = findOrder(id)?.kitchen;
      const o = await commit(st => setKitchen(st[st.mode], st.config, id, to));
      settle(ev);
      if (fromSheet) openReceipt(id);
      const forward = ['preparing', 'ready', 'handed'].indexOf(to) > ['preparing', 'ready', 'handed'].indexOf(before);
      if (to === 'ready' && forward) toast(`${tokenOf(o)} is ready. Shout it out!`);
      else if (to === 'handed') toast(`${tokenOf(o)} handed over. Paisa vasool!`);
      else toast(`${tokenOf(o)} moved back to ${to === 'ready' ? 'Ready' : 'Preparing'}.`);
    },
    'ord-reset-tokens': () => {
      const q = kitchenQueue(S());
      const waiting = q.preparing.length + q.ready.length;
      confirmSheet({
        title: 'Reset tokens?',
        body: `<p>The next order gets token <strong>#01</strong>. Use this when a new shift or day starts.</p>${
          waiting ? `<p class="notice">${waiting} ${waiting === 1 ? 'order is' : 'orders are'} still in the queue and keep their tokens, so numbers may repeat for a while.</p>` : ''
        }<p class="muted">No orders or money change.</p>`,
        confirmLabel: 'Reset to #01',
        onConfirm: async () => {
          await commit(st => resetTokens(st[st.mode], st.config));
          toast('Tokens reset. Next order is #01.');
        },
      });
    },
    'ord-back': (_el, ds, ev) => {
      if (settling(ev)) return;
      pay = null;
      fix = null;
      if (ds.id && findOrder(ds.id)) openReceipt(ds.id);
      else closeSheet();
    },
    'ord-pay': (_el, ds, ev) => openPay(ds.id || '', ev),
    'ord-pay-method': (_el, ds) => {
      if (!pay) return;
      pay.method = ['Cash', 'UPI', 'Split', 'Other'].includes(ds.method) ? ds.method : 'Cash';
      syncPay();
    },
    'ord-pay-quick': (_el, ds) => {
      const r = syncPay();
      if (!r) return;
      const due = r.m === 'Cash' ? r.o.total : r.cashPart;
      if (due === null) return;
      const input = /** @type {HTMLInputElement|null} */ (sheetEl().querySelector('#ord-pay-received'));
      if (input) input.value = String((ds.amount === 'exact' ? due : Number(ds.amount)) / 100);
      syncPay();
    },
    'ord-pay-save': () => savePay(),
    'ord-correct': (_el, ds, ev) => openFix(ds.id || '', ev),
    'ord-fix-type': (_el, ds) => {
      if (!fix) return;
      fix.type = ds.type === 'void' ? 'void' : 'refund';
      syncFix();
    },
    'ord-fix-method': (_el, ds) => {
      if (!fix) return;
      fix.method = ds.method === 'UPI' ? 'UPI' : 'Cash';
      const input = /** @type {HTMLInputElement|null} */ (sheetEl().querySelector('#ord-fix-amount'));
      if (input && !fix.amountTouched) input.value = String(methodBalances(S(), fix.id)[fix.method] / 100);
      syncFix();
    },
    'ord-fix-save': () => saveFix(),
  },
  {admin: ['ord-correct', 'ord-fix-save']},
);

registerInputs({
  'ord-search': el => {
    query = String(el.value || '').slice(0, 60);
    limit = PAGE;
    render();
  },
  'ord-pay': () => syncPay(),
  'ord-fix-amount': () => {
    if (fix) fix.amountTouched = true;
    syncFix();
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Live ages: refresh every 30 s while the Orders screen is visible and nobody is typing or in a sheet
// ---------------------------------------------------------------------------------------------------------------------

function refreshAges() {
  if (typeof document === 'undefined' || document.hidden || ui.screen !== 'orders' || userBusy()) return;
  document.querySelectorAll('.ord-age[data-at]').forEach(el => {
    const at = el.getAttribute('data-at') || '';
    const label = el.querySelector('span');
    if (label) label.textContent = ageLabel(at);
    const late = el.getAttribute('data-late') === '1' && ageMinutes(at) >= LATE_MIN;
    el.classList.toggle('late', late);
    el.closest('.ord-ticket')?.classList.toggle('is-late', late);
  });
}

onBoot(() => {
  window.setInterval(refreshAges, 30000);
  document.addEventListener('visibilitychange', refreshAges);
});
