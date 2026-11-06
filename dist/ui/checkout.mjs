// Review & pay (ARCHITECTURE.md §13.2) — the moment money changes hands: correctness, speed, clarity.
//
// Public action: 'co-open' (open checkout for the current cart).
// Private actions/inputs/changes use the 'co-' prefix. Checkout UI state (method, tendered cash, split part, custom
// discount inputs, confirmations, pending) lives in module variables so repainting the sheet keeps what was typed.
// Every money rule (totals, discounts, split validation, change) comes from domain.mjs; this file only presents it.
import {
  S, C, ui, esc, money, paise, tokenLabel, icon, btn, field, toast, openSheet, closeSheet, sheetEl, sheetKind, commit,
  navigate, registerActions, registerInputs, registerChanges,
} from './core.mjs';
import {draftTotals, resolveDiscount, setDraftDiscount, createOrder, upcomingToken, upiUri, report} from '../domain.mjs';
import {qrSvg} from '../qr.mjs';
import {CASH_QUICK} from '../constants.mjs';

/** @typedef {'Cash'|'UPI'|'Split'|'Other'} Method */

const METHODS = /** @type {const} */ ([
  {id: 'Cash', label: 'Cash', icon: 'cash'},
  {id: 'UPI', label: 'UPI', icon: 'upi'},
  {id: 'Split', label: 'Split', icon: 'split'},
  {id: 'Other', label: 'Other', icon: 'wallet'},
]);

const KIND = 'checkout';
const SUCCESS_KIND = 'co-success';
/** The success sheet ignores taps this long (a double-tap's second tap lands ~100–300 ms after the first). */
const ARM_MS = 450;

/** The cashier's preferred method survives between orders (most stalls lean Cash or UPI all evening). */
/** @type {Method} */
let lastMethod = 'Cash';

/**
 * Transient checkout state for the open sheet.
 * @type {{
 *   snapshot: string, draftId: string, method: Method, tendered: string, splitCash: string, splitTendered: string,
 *   confirmed: {UPI: boolean, Split: boolean, Other: boolean}, pending: boolean,
 *   customOpen: boolean, customType: 'flat'|'percent', customValue: string, linesOpen: boolean, busy: boolean, notice: string
 * } | null}
 */
let co = null;

// ---------------------------------------------------------------------------------------------------------------------
// Pure-ish helpers (read state, never write)
// ---------------------------------------------------------------------------------------------------------------------

/** Current cart totals (domain math). */
const cartTotals = () => draftTotals(S(), C());

/** @param {string} v @returns {number|null} paise, null when blank, NaN when unreadable */
function readMoney(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    return paise(s);
  } catch {
    return Number.NaN;
  }
}

/**
 * Why a typed amount can't be read: the domain's "too large", or a format hint.
 * @param {string} v
 * @param {string} example
 */
function moneyProblem(v, example) {
  try {
    paise(String(v ?? '').trim());
    return '';
  } catch (err) {
    return /too large/i.test(String(/** @type {any} */ (err)?.message)) ? 'That amount is too large. Check the number.' : `Type the amount like ${example}.`;
  }
}

/** Pay later only makes sense when there is money to collect. @param {number} total */
const payLater = total => !!co?.pending && total > 0;

/** Note shown in the customer's UPI app. */
const upiNote = () => `Token ${tokenLabel(upcomingToken(S()))} · ${C().profile.stallName}`;

/**
 * Work out whether the sale can be completed right now and with what payment details.
 * Messages are shown inline; the domain re-validates everything on commit.
 * @param {number} total paise
 */
function evaluate(total) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const method = st.method;
  const pending = payLater(total);
  /** @type {{ok: boolean, why: string, split: null|{Cash: number, UPI: number}, cashReceived: number|null, change: number,
   *   short: number, cashPart: number|null, upiPart: number|null, splitProblem: string, tenderProblem: string}} */
  const out = {ok: false, why: '', split: null, cashReceived: null, change: 0, short: 0, cashPart: null, upiPart: null, splitProblem: '', tenderProblem: ''};

  if (method === 'Cash') {
    const given = readMoney(st.tendered);
    if (given === null) {
      out.ok = true; // blank = exact amount, no change
    } else if (Number.isNaN(given)) {
      out.tenderProblem = moneyProblem(st.tendered, '500 or 120.50');
    } else if (given < total) {
      out.short = total - given;
    } else {
      out.ok = true;
      out.cashReceived = given;
      out.change = given - total;
    }
    if (!pending && !out.ok) out.why = out.tenderProblem || `Collect ${money(out.short)} more before completing.`;
  }

  if (method === 'Split') {
    const cash = readMoney(st.splitCash);
    if (total < 2) out.splitProblem = 'This total is too small to split. Use Cash or UPI.';
    else if (cash === null) out.splitProblem = '';
    else if (Number.isNaN(cash)) out.splitProblem = moneyProblem(st.splitCash, '100 or 40.50');
    else if (cash < 1) out.splitProblem = 'The cash part must be more than ₹0.';
    else if (cash >= total) out.splitProblem = `The cash part must be less than the ${money(total)} total. All cash? Pick Cash instead.`;
    else {
      out.cashPart = cash;
      out.upiPart = total - cash;
      out.split = {Cash: cash, UPI: total - cash};
    }
    if (out.split) {
      const given = readMoney(st.splitTendered);
      if (given !== null && Number.isNaN(given)) out.tenderProblem = moneyProblem(st.splitTendered, '500 or 120.50');
      else if (given !== null && given < out.split.Cash) out.short = out.split.Cash - given;
      else if (given !== null) {
        out.cashReceived = given;
        out.change = given - out.split.Cash;
      }
    }
  }

  if (pending) {
    // A pending Split may leave the parts blank (filled in when it is paid), but a typed part must be valid.
    out.ok = !(method === 'Split' && out.splitProblem);
    out.why = out.ok ? '' : out.splitProblem;
    out.cashReceived = null;
    out.change = 0;
    if (method !== 'Split') out.split = null;
    return out;
  }
  if (total === 0) {
    out.ok = method !== 'Split';
    out.why = out.ok ? '' : 'Nothing to split on a free order. Pick Cash.';
    out.split = null;
    return out;
  }
  if (method === 'UPI' || method === 'Other') {
    out.ok = st.confirmed[method];
    out.why = out.ok ? '' : method === 'UPI' ? 'Tick “I received” once the UPI payment shows up.' : 'Tick “I received” once you have the payment.';
  }
  if (method === 'Split') {
    if (!out.split) out.why = out.splitProblem || 'Type the cash part to split the bill.';
    else if (out.tenderProblem) out.why = out.tenderProblem;
    else if (out.short) out.why = `Collect ${money(out.short)} more cash before completing.`;
    else if (!st.confirmed.Split) out.why = `Tick “I received ${money(out.split.UPI)} on UPI” once it shows up.`;
    out.ok = !!out.split && !out.tenderProblem && !out.short && st.confirmed.Split;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------------

/** @param {any} l cart line */
function lineHtml(l) {
  const details = [l.flavour, ...(l.addons || []).map((/** @type {any} */ a) => `+ ${a.name}`)].filter(Boolean).map(esc);
  if (l.quantity > 1) details.push(`${money(l.unitPrice)} each`);
  return `<div class="receipt-line co-line">
    <span class="co-line-main"><span class="co-qty">${l.quantity}×</span><span class="co-line-text"><b>${esc(l.name)}</b>${details.length ? `<small>${details.join(' · ')}</small>` : ''}${l.note ? `<small class="co-line-note">“${esc(l.note)}”</small>` : ''}</span></span>
    <strong>${money(l.lineTotal)}</strong>
  </div>`;
}

/** @param {{subtotal: number}} t */
function discountChips(t) {
  const c = C();
  const spec = S().draftDiscount;
  const rules = c.discounts.filter((/** @type {any} */ d) => d.active);
  const isCustom = !!(spec && spec.custom);
  if (!rules.length && !c.allowCustomDiscount) return '';
  const chips = rules.map((/** @type {any} */ d) => {
    const on = !!spec && spec.ruleId === d.id;
    const short = d.minimum > t.subtotal ? d.minimum - t.subtotal : 0;
    const hint = d.minimum ? (short ? `Add ${money(short)} more` : `min ${money(d.minimum)}`) : '';
    return `<button type="button" class="co-chip${on ? ' on' : ''}${short ? ' short' : ''}" data-action="co-discount" data-id="${esc(d.id)}" aria-pressed="${on}">
      <span class="co-chip-label">${on ? icon('check') : icon('tag')}${esc(d.label)}</span>${hint ? `<small class="co-chip-hint">${hint}</small>` : ''}
    </button>`;
  });
  if (c.allowCustomDiscount) {
    const r = isCustom ? resolveDiscount(c, spec) : null;
    const open = !!co?.customOpen && !isCustom;
    chips.push(`<button type="button" class="co-chip co-chip-custom${isCustom ? ' on' : ''}${open ? ' open' : ''}" data-action="co-custom" aria-pressed="${isCustom}" aria-expanded="${open || isCustom}">
      <span class="co-chip-label">${isCustom ? icon('check') : icon('percent')}${isCustom && r ? esc(r.label) : 'Custom'}</span>${isCustom ? '<small class="co-chip-hint">Tap to remove</small>' : ''}
    </button>`);
  }
  return `<div class="co-block">
    <div class="co-label">${icon('gift')} Discount <small>one per order · tap again to remove</small></div>
    <div class="co-chips">${chips.join('')}</div>
    ${co?.customOpen && !isCustom ? customForm() : ''}
  </div>`;
}

function customForm() {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const flat = st.customType === 'flat';
  return `<form class="co-custom" data-submit="co-custom-apply" autocomplete="off">
    <div class="segmented co-custom-type" role="group" aria-label="Discount type">
      <button type="button" data-action="co-custom-type" data-type="flat" aria-pressed="${flat}">₹ off</button>
      <button type="button" data-action="co-custom-type" data-type="percent" aria-pressed="${!flat}">% off</button>
    </div>
    ${field(flat ? 'Amount off (₹)' : 'Percent off', 'co-custom-value', st.customValue, 'text',
      `inputmode="${flat ? 'decimal' : 'numeric'}" placeholder="${flat ? 'e.g. 15' : 'e.g. 10'}" data-input="co-custom-value" maxlength="9"`)}
    ${btn('Apply', 'co-custom-apply', 'small lime co-custom-apply')}
  </form>`;
}

/** @param {ReturnType<typeof cartTotals>} t */
function totalsHtml(t) {
  const r = resolveDiscount(C(), S().draftDiscount);
  const rows = [`<div class="co-trow"><span>Subtotal</span><strong>${money(t.subtotal)}</strong></div>`];
  if (r && t.discount > 0) rows.push(`<div class="co-trow co-trow-off"><span>${esc(r.label)}</span><strong>−${money(t.discount)}</strong></div>`);
  if (r && t.minimumShort > 0) {
    rows.push(`<div class="co-minimum" role="note">${icon('info')}<span>Add <b>${money(t.minimumShort)}</b> more to unlock “${esc(r.label)}”.</span></div>`);
  }
  return `<div class="co-totals">${rows.join('')}
    <div class="co-grand"><span>Total to collect</span><strong class="co-grand-amount" data-total="${t.total}">${money(t.total)}</strong></div>
  </div>`;
}

/** @param {number} total @param {ReturnType<typeof evaluate>} ev */
function cashResultHtml(total, ev) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  if (ev.tenderProblem) return `<div class="co-result co-result-bad" role="status"><span>${esc(ev.tenderProblem)}</span></div>`;
  if (ev.short) return `<div class="co-result co-result-bad" role="status"><small>Collect</small><strong>${money(ev.short)} more</strong></div>`;
  if (!st.tendered.trim() || ev.change === 0) {
    return `<div class="co-result co-result-exact" role="status"><small>Exact amount</small><strong>No change</strong></div>`;
  }
  return `<div class="co-result co-result-change" role="status"><small>Return</small><strong>${money(ev.change)}</strong><span>from ${money(/** @type {number} */ (ev.cashReceived))} · bill ${money(total)}</span></div>`;
}

/** @param {number} total @param {ReturnType<typeof evaluate>} ev */
function cashPanel(total, ev) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const given = readMoney(st.tendered);
  const exactOn = given === total;
  const notes = CASH_QUICK.map(n => {
    const below = n < total;
    const on = given === n && !below;
    return `<button type="button" class="co-note${on ? ' on' : ''}" data-action="co-tender" data-amount="${n}" aria-pressed="${on}"${below ? ' disabled' : ''}>${money(n)}</button>`;
  }).join('');
  return `<div class="co-label">${icon('cash')} Cash received <small>tap the note you got</small></div>
    <div class="co-notes co-notes-cash">
      <button type="button" class="co-note co-note-exact${exactOn ? ' on' : ''}" data-action="co-tender" data-amount="exact" aria-pressed="${exactOn}">Exact</button>${notes}
    </div>
    ${field('Or type the amount (₹)', 'co-tendered', st.tendered, 'text', 'inputmode="decimal" placeholder="Blank = exact" data-input="co-tendered" maxlength="10" enterkeyhint="done"')}
    <div id="co-cash-result">${cashResultHtml(total, ev)}</div>`;
}

/**
 * Large scannable QR for a UPI amount (or the "add a UPI ID" hint).
 * @param {number} amount paise
 */
function qrHtml(amount) {
  const c = C();
  const uri = amount > 0 ? upiUri(c, amount, upiNote()) : null;
  if (!uri) {
    return `<div class="notice sky co-upi-hint">${icon('qr')}<div><strong>No UPI QR yet.</strong>
      <p>Add your UPI ID once and every order shows a QR with the exact amount filled in.</p>
      ${btn(`${icon('upi')} Add UPI ID`, 'studio-open', 'small co-upi-setup', 'data-section="upi"')}
    </div></div>`;
  }
  const payee = c.upi.payeeName || c.profile.stallName;
  return `<figure class="co-qr-card">
    <div class="co-qr" data-upi="${esc(uri)}">${qrSvg(uri, {ecc: 'M', margin: 4, label: `UPI QR code for ${money(amount)}`})}</div>
    <figcaption>
      <strong class="co-qr-amount">${money(amount)}</strong>
      <span class="co-qr-payee">to ${esc(payee)}</span>
      <small class="co-qr-id">${esc(c.upi.id)} · ${esc(upiNote())}</small>
    </figcaption>
  </figure>`;
}

/** @param {'UPI'|'Split'|'Other'} key @param {string} label */
function confirmBox(key, label) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  return `<label class="check-label co-confirm"><input type="checkbox" id="co-confirm" name="co-confirm" data-change="co-confirm" data-key="${key}"${st.confirmed[key] ? ' checked' : ''}><span>${label}</span></label>`;
}

const honest = '<p class="footnote co-honest">MYS can’t see your bank. Check the payment app or SMS before you tick.</p>';

/** Cash part + UPI part tiles (or why the split isn't valid yet). @param {ReturnType<typeof evaluate>} ev */
function splitPartsHtml(ev) {
  if (!ev.split) {
    return ev.splitProblem
      ? `<div class="co-result co-result-bad" role="status"><span>${esc(ev.splitProblem)}</span></div>`
      : `<p class="muted co-split-wait">Type the cash part — the rest goes on UPI.</p>`;
  }
  return `<div class="co-split-parts">
      <div class="co-part co-part-cash"><small>${icon('cash')} Cash</small><strong>${money(ev.split.Cash)}</strong></div>
      <span class="co-part-plus" aria-hidden="true">+</span>
      <div class="co-part co-part-upi"><small>${icon('upi')} UPI</small><strong>${money(ev.split.UPI)}</strong></div>
    </div>`;
}

/** Change for the cash part. @param {ReturnType<typeof evaluate>} ev */
function splitChangeHtml(ev) {
  if (!ev.split) return '';
  if (ev.tenderProblem) return `<div class="co-result co-result-bad" role="status"><span>${esc(ev.tenderProblem)}</span></div>`;
  if (ev.short) return `<div class="co-result co-result-bad" role="status"><small>Collect</small><strong>${money(ev.short)} more cash</strong></div>`;
  if (ev.change > 0) {
    return `<div class="co-result co-result-change" role="status"><small>Return</small><strong>${money(ev.change)}</strong><span>from ${money(/** @type {number} */ (ev.cashReceived))} · cash part ${money(ev.split.Cash)}</span></div>`;
  }
  return '';
}

/** QR + confirmation for the UPI part. @param {ReturnType<typeof evaluate>} ev */
function splitQrHtml(ev) {
  if (!ev.split || payLater(cartTotals().total)) return '';
  return qrHtml(ev.split.UPI) + confirmBox('Split', `I received <b>${money(ev.split.UPI)}</b> on UPI`) + honest;
}

/** @param {number} total @param {ReturnType<typeof evaluate>} ev */
function splitPanel(total, ev) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const pending = payLater(total);
  const cash = readMoney(st.splitCash);
  const half = Math.round(total / 200) * 100;
  const quick = [...new Set([half, ...CASH_QUICK])].filter(n => n >= 100 && n < total).sort((a, b) => a - b);
  const quickHtml = quick.map(n => {
    const on = cash === n;
    return `<button type="button" class="co-note${on ? ' on' : ''}" data-action="co-split-quick" data-amount="${n}" aria-pressed="${on}">${n === half ? `Half ${money(n)}` : money(n)}</button>`;
  }).join('');
  return `<div class="co-label">${icon('split')} Split the bill <small>part cash, rest on UPI</small></div>
    ${quickHtml ? `<div class="co-notes">${quickHtml}</div>` : ''}
    ${field('Cash part (₹)', 'co-split-cash', st.splitCash, 'text', `inputmode="decimal" placeholder="e.g. ${money(half).replace('₹', '')}" data-input="co-split-cash" maxlength="10"`)}
    <div id="co-split-parts">${splitPartsHtml(ev)}</div>
    ${pending ? '' : field('Cash note received (optional, ₹)', 'co-split-tendered', st.splitTendered, 'text', 'inputmode="decimal" placeholder="For change" data-input="co-split-tendered" maxlength="10"')}
    ${pending ? '' : `<div id="co-split-change">${splitChangeHtml(ev)}</div>`}
    <div id="co-split-qr">${splitQrHtml(ev)}</div>`;
}

/** @param {number} total @param {ReturnType<typeof evaluate>} ev */
function methodPanel(total, ev) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  if (total === 0) {
    return `<div class="notice mint co-free">${icon('gift')}<div><strong>Nothing to collect.</strong><p>The discount covers the whole bill. Complete to issue the token.</p></div></div>`;
  }
  if (payLater(total) && st.method !== 'Split') {
    return `<div class="notice pink co-pending-note">${icon('clock')}<div><strong>Nothing collected now.</strong><p>The order shows UNPAID until you confirm the ${esc(st.method)} payment from Orders.</p></div></div>`;
  }
  if (st.method === 'Cash') return cashPanel(total, ev);
  if (st.method === 'Split') return splitPanel(total, ev);
  if (st.method === 'UPI') {
    return `${qrHtml(total)}${confirmBox('UPI', `I received <b>${money(total)}</b> on UPI`)}${honest}`;
  }
  return `<div class="notice lavender co-other">${icon('wallet')}<div><strong>Card, wallet or coupon?</strong><p>Record it as Other — it counts in your collections once you have it.</p></div></div>
    ${confirmBox('Other', `I received <b>${money(total)}</b>`)}${honest}`;
}

/** @param {number} total @param {ReturnType<typeof evaluate>} ev */
function completeButton(total, ev) {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const pending = payLater(total);
  const label = st.busy ? 'Saving…' : pending ? `Save as pending · ${money(total)}` : `Complete<span class="co-complete-word"> sale</span> · ${money(total)}`;
  return `<button type="button" class="primary big co-complete" data-action="co-complete" id="co-complete"${ev.ok && !st.busy ? '' : ' disabled'}>${pending ? icon('clock') : icon('check')}<span>${label}</span></button>`;
}

/** @param {ReturnType<typeof evaluate>} ev */
const whyHtml = ev => `<p class="co-why" id="co-why" role="status"${ev.ok || !ev.why ? ' hidden' : ''}>${esc(ev.why)}</p>`;

function checkoutBody() {
  const st = /** @type {NonNullable<typeof co>} */ (co);
  const s = S();
  const t = cartTotals();
  const ev = evaluate(t.total);
  const count = s.draft.reduce((/** @type {number} */ n, /** @type {any} */ l) => n + l.quantity, 0);
  const methods = METHODS.map(m => {
    const on = st.method === m.id;
    return `<button type="button" data-action="co-method" data-method="${m.id}" aria-pressed="${on}"${on ? ' class="active"' : ''}>${icon(m.icon)}<span>${m.label}</span></button>`;
  }).join('');
  const body = `<div class="co-layout">
    ${st.notice ? `<div class="notice co-stale" role="status">${icon('info')}<span>${esc(st.notice)}</span></div>` : ''}
    <section class="co-summary${st.linesOpen ? ' lines-open' : ''}" aria-label="Order summary">
      <div class="co-summary-head">
        <span class="co-next-token" title="Token this order will get">${icon('ticket')} Token <b>${tokenLabel(upcomingToken(s))}</b></span>
        <span class="muted co-count">${count} ${count === 1 ? 'item' : 'items'}</span>
        <button type="button" class="small quiet-outline co-lines-toggle" data-action="co-lines" aria-expanded="${st.linesOpen}" aria-controls="co-lines">${count} ${count === 1 ? 'item' : 'items'} ${icon(st.linesOpen ? 'up' : 'down')}</button>
      </div>
      <div class="co-lines" id="co-lines">${s.draft.map(lineHtml).join('')}</div>
      ${s.draftNote ? `<div class="co-note-card">${icon('note')}<span><b>Note:</b> ${esc(s.draftNote)}</span></div>` : ''}
      ${discountChips(t)}
      ${totalsHtml(t)}
    </section>
    <section class="co-pay" aria-label="Payment">
      <form class="co-pay-form" data-submit="co-complete" autocomplete="off">
        <div class="co-label">${icon('wallet')} How are they paying?</div>
        <div class="segmented block co-methods" role="group" aria-label="Payment method">${methods}</div>
        <div class="co-method-panel" data-method-panel="${st.method}">${methodPanel(t.total, ev)}</div>
        ${t.total > 0 ? `<label class="check-label co-pending${st.pending ? ' on' : ''}"><input type="checkbox" id="co-pending" name="co-pending" data-change="co-pending"${st.pending ? ' checked' : ''}><span><b>Pay later</b> — save as pending (not paid yet)<small>Token goes to the kitchen; confirm the money later from Orders.</small></span></label>` : ''}
      </form>
    </section>
  </div>`;
  const actions = `${whyHtml(ev)}${btn(`${icon('chevron-left')}<span class="co-back-text">Back to cart</span>`, 'close', 'quiet-outline co-back', 'aria-label="Back to cart"')}${completeButton(t.total, ev)}`;
  return {body, actions};
}

// ---------------------------------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------------------------------

/** Re-open the checkout sheet from state, keeping scroll position and the focused field. */
function paint() {
  if (!co) return;
  const sheet = sheetEl();
  const reopening = sheetKind() === KIND;
  const scroller = sheet?.querySelector('.sheet-body');
  const scrollTop = reopening && scroller ? scroller.scrollTop : 0;
  const active = /** @type {any} */ (document.activeElement);
  const keep = reopening && active?.id && sheet?.contains(active)
    ? {id: active.id, start: safe(() => active.selectionStart), end: safe(() => active.selectionEnd)}
    : null;
  // Buttons have no ids: find the same control again by its action + data so keyboard focus survives the repaint.
  const keepBtn = reopening && !keep && active?.dataset?.action && sheet?.contains(active)
    ? `[data-action="${CSS.escape(active.dataset.action)}"]${['method', 'amount', 'id', 'type']
      .filter(k => active.dataset[k] != null)
      .map(k => `[data-${k}="${CSS.escape(active.dataset[k])}"]`)
      .join('')}`
    : '';
  const {body, actions} = checkoutBody();
  // Closing (✕, Escape, Back, another tab's write) forgets the payment details, so nothing can complete a closed sheet.
  openSheet('Review &amp; pay', body, actions, KIND, {wide: true, onClose: () => (co = null)});
  const nextScroller = sheetEl()?.querySelector('.sheet-body');
  if (nextScroller && scrollTop) nextScroller.scrollTop = scrollTop;
  if (keep) {
    const el = /** @type {any} */ (document.getElementById(keep.id));
    if (el) {
      el.focus({preventScroll: true});
      if (typeof keep.start === 'number' && typeof el.setSelectionRange === 'function') safe(() => el.setSelectionRange(keep.start, keep.end));
    }
  } else if (keepBtn) {
    /** @type {HTMLElement|null} */ (sheetEl()?.querySelector(keepBtn))?.focus({preventScroll: true});
  }
}

/** Update only the live bits (results, complete button) so typing never loses focus or the keyboard. */
function patch() {
  if (!co || sheetKind() !== KIND) return;
  const sheet = sheetEl();
  const t = cartTotals();
  const ev = evaluate(t.total);
  const cashResult = sheet.querySelector('#co-cash-result');
  if (cashResult) cashResult.innerHTML = cashResultHtml(t.total, ev);
  const splitChange = sheet.querySelector('#co-split-change');
  if (splitChange) splitChange.innerHTML = splitChangeHtml(ev);
  const given = readMoney(co.tendered);
  sheet.querySelectorAll('[data-action="co-tender"]').forEach(b => {
    const amount = b.getAttribute('data-amount');
    const on = !(/** @type {HTMLButtonElement} */ (b).disabled) && (amount === 'exact' ? given === t.total : given === Number(amount));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const cash = readMoney(co.splitCash);
  sheet.querySelectorAll('[data-action="co-split-quick"]').forEach(b => {
    const on = cash === Number(b.getAttribute('data-amount'));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const button = sheet.querySelector('#co-complete');
  if (button) button.outerHTML = completeButton(t.total, ev);
  const why = sheet.querySelector('#co-why');
  if (why) why.outerHTML = whyHtml(ev);
}

/** Re-render the split parts and UPI QR without touching any input. */
function patchSplit() {
  if (!co || sheetKind() !== KIND) return;
  const sheet = sheetEl();
  const ev = evaluate(cartTotals().total);
  const parts = sheet.querySelector('#co-split-parts');
  if (parts) parts.innerHTML = splitPartsHtml(ev);
  const qr = sheet.querySelector('#co-split-qr');
  if (qr) qr.innerHTML = splitQrHtml(ev);
  patch();
}

/** @template T @param {() => T} fn @returns {T|null} */
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Open, complete, success
// ---------------------------------------------------------------------------------------------------------------------

async function openCheckout() {
  if (!S().draft.length) {
    toast('Your cart is empty — add something tasty first.', {tone: 'warn'});
    return;
  }
  const spec = S().draftDiscount;
  let notice = '';
  if (spec && !resolveDiscount(C(), spec)) {
    await commit(st => setDraftDiscount(st[st.mode], st.config, null));
    // Shown inside the sheet: a toast raised just before showModal() sits under the modal where nobody sees it.
    notice = 'That discount isn’t available any more, so we removed it. Check the new total.';
  }
  co = {
    snapshot: JSON.stringify(S().draft),
    draftId: S().draftId,
    method: lastMethod,
    tendered: '',
    splitCash: '',
    splitTendered: '',
    confirmed: {UPI: false, Split: false, Other: false},
    pending: false,
    customOpen: false,
    customType: 'percent',
    customValue: '',
    linesOpen: false,
    busy: false,
    notice,
  };
  paint();
}

/** @param {number} n */
const confetti = n => {
  const colors = ['var(--pink)', 'var(--yellow)', 'var(--mint)', 'var(--sky)', 'var(--lime)', 'var(--lavender)', 'var(--orange)', 'var(--coral)'];
  return `<div class="co-burst" aria-hidden="true">${Array.from({length: n}, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
    const dist = 1 + (i % 3) * 0.09;
    const x = Math.round(Math.cos(angle) * 45 * dist);
    const y = Math.round(Math.sin(angle) * 42 * dist);
    return `<i style="--x:${x}%;--y:${y}%;--r:${(i * 47) % 360}deg;--c:${colors[i % colors.length]};--d:${(i % 5) * 40}ms" class="${i % 3 === 0 ? 'round' : i % 3 === 1 ? 'bar' : ''}"></i>`;
  }).join('')}</div>`;
};

/**
 * @param {any} order
 * @param {boolean} profitFlip this order took the mission into PROFIT MODE
 */
function successSheet(order, profitFlip) {
  const pending = order.status === 'pending';
  const methodLine = pending
    ? `<span class="badge pink">UNPAID</span> Saved as pending · expected ${esc(order.method)}`
    : order.method === 'Split' && order.split
      ? `${icon('split')} Split · Cash ${money(order.split.Cash)} + UPI ${money(order.split.UPI)}`
      : `${icon(order.method === 'UPI' ? 'upi' : order.method === 'Other' ? 'wallet' : 'cash')} ${esc(order.method)}${order.cashReceived != null && order.method === 'Cash' ? ` · got ${money(order.cashReceived)}` : ''}`;
  const change = !pending && order.change > 0
    ? `<div class="co-success-change"><small>Return change</small><strong>${money(order.change)}</strong></div>`
    : '';
  const kitchen = order.kitchen === 'preparing' ? `<p class="co-success-kitchen">${icon('chef')} Sent to the kitchen queue — call out <b>${tokenLabel(order.token)}</b> when it’s ready.</p>` : '';
  const body = `<div class="co-success${profitFlip ? ' profit' : ''}${pending ? ' pending' : ''}">
    ${profitFlip ? `<div class="co-profit-banner" role="status">PROFIT MODE 🔥 <span>Break-even crossed! Every rupee now is profit.</span></div>` : ''}
    <div class="co-token-wrap">
      ${pending ? '' : confetti(profitFlip ? 22 : 12)}
      <div class="co-token-card"><small>TOKEN</small><strong class="co-token">${esc(tokenLabel(order.token) || `#${order.number}`)}</strong></div>
    </div>
    <h3 class="co-success-title">${pending ? 'Saved. Collect later.' : profitFlip ? 'Paisa vasool!' : 'Done! Paisa aa gaya.'}</h3>
    <div class="co-success-facts">
      <span class="co-order-no">Order #${order.number}</span>
      <strong class="co-success-total">${money(order.total)}</strong>
      <span class="co-success-method">${methodLine}</span>
    </div>
    ${change}
    ${kitchen}
  </div>`;
  // The buttons start disarmed (aria-disabled: the kernel ignores them) so the second tap of a double-tap on Complete
  // can't land on Receipt / View queue and whisk the token and the change to return off the screen.
  const arm = 'aria-disabled="true"';
  const actions = `${btn(`${icon('receipt')} Receipt`, 'ord-receipt', 'quiet-outline co-receipt co-arming', `data-id="${esc(order.id)}" ${arm}`)}${btn(`${icon('queue')} View queue`, 'ord-queue', 'co-queue co-arming', arm)}${btn(`Next order ${icon('arrow')}`, 'co-next', 'primary co-next co-arming', `autofocus ${arm}`)}`;
  openSheet(pending ? 'Order saved' : 'Sale complete', body, actions, SUCCESS_KIND, {wide: false});
  const sheet = sheetEl();
  window.setTimeout(() => {
    sheet?.querySelectorAll('.co-arming').forEach(b => {
      b.removeAttribute('aria-disabled');
      b.classList.remove('co-arming');
    });
  }, ARM_MS);
}

async function complete() {
  if (!co || co.busy) return;
  const st0 = co;
  const s = S();
  const already = s.orders.find((/** @type {any} */ o) => o.id === st0.draftId);
  if (!already && JSON.stringify(s.draft) !== st0.snapshot) {
    throw Error('The cart changed in another tab — review it again.');
  }
  const t = cartTotals();
  const ev = evaluate(t.total);
  if (!already && !ev.ok) throw Error(ev.why || 'Finish the payment details first.');
  const before = report(s, C()).mission.profitMode;
  st0.busy = true;
  patch();
  try {
    const order = await commit(st => {
      const ses = st[st.mode];
      const existing = ses.orders.find((/** @type {any} */ o) => o.id === st0.draftId);
      if (existing) return existing;
      if (ses.draftId !== st0.draftId || JSON.stringify(ses.draft) !== st0.snapshot) {
        throw Error('The cart changed in another tab — review it again.');
      }
      if (draftTotals(ses, st.config).total !== t.total) throw Error('The total changed — review it again.');
      return createOrder(ses, st.config, {
        id: ses.draftId,
        items: ses.draft,
        discount: ses.draftDiscount,
        note: ses.draftNote,
        method: st0.method,
        split: ev.split,
        pending: payLater(t.total),
        cashReceived: payLater(t.total) ? null : ev.cashReceived,
      });
    });
    lastMethod = st0.method;
    co = null;
    const after = report(S(), C()).mission.profitMode;
    successSheet(order, !before && after && order.status !== 'pending');
  } finally {
    if (co) {
      co.busy = false;
      patch();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

registerActions({
  'co-open': () => openCheckout(),

  'co-method': (_el, ds) => {
    if (!co) return;
    const m = METHODS.find(x => x.id === ds.method);
    if (!m || co.method === m.id) return;
    co.method = m.id;
    lastMethod = m.id;
    paint();
    // On a phone the new panel (QR, split fields) opens below the fold: scroll the method bar to the top of the sheet.
    if (window.matchMedia('(max-width: 767px)').matches) {
      /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('.co-pay'))?.scrollIntoView({block: 'start'});
    }
  },

  'co-tender': (_el, ds) => {
    if (!co) return;
    const total = cartTotals().total;
    co.tendered = ds.amount === 'exact' ? (total / 100).toFixed(total % 100 ? 2 : 0) : (Number(ds.amount) / 100).toFixed(0);
    paint();
  },

  'co-split-quick': (_el, ds) => {
    if (!co) return;
    const n = Number(ds.amount);
    co.splitCash = (n / 100).toFixed(n % 100 ? 2 : 0);
    co.confirmed.Split = false;
    paint();
  },

  'co-discount': async (_el, ds) => {
    if (!co) return;
    const spec = S().draftDiscount;
    const next = spec && spec.ruleId === ds.id ? null : {ruleId: ds.id || ''};
    await commit(st => setDraftDiscount(st[st.mode], st.config, next));
    if (!co) return;
    co.customOpen = false;
    co.notice = '';
    resetConfirmations();
    paint();
  },

  'co-custom': async () => {
    if (!co) return;
    const spec = S().draftDiscount;
    if (spec && spec.custom) {
      await commit(st => setDraftDiscount(st[st.mode], st.config, null));
      if (!co) return;
      co.customOpen = false;
      resetConfirmations();
    } else {
      co.customOpen = !co.customOpen;
    }
    paint();
    if (co?.customOpen) /** @type {HTMLInputElement|null} */ (sheetEl().querySelector('#co-custom-value'))?.focus();
  },

  'co-custom-type': (_el, ds) => {
    if (!co || (ds.type !== 'flat' && ds.type !== 'percent')) return;
    co.customType = ds.type;
    paint();
    /** @type {HTMLInputElement|null} */ (sheetEl().querySelector('#co-custom-value'))?.focus();
  },

  'co-custom-apply': async () => {
    if (!co) return;
    const raw = co.customValue.trim();
    if (!raw) throw Error(co.customType === 'flat' ? 'Type how many rupees to take off.' : 'Type the percent to take off (1–100).');
    const value = co.customType === 'flat' ? paise(raw) : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    const spec = {custom: true, type: co.customType, value};
    await commit(st => setDraftDiscount(st[st.mode], st.config, spec));
    if (!co) return;
    co.notice = '';
    co.customOpen = false;
    co.customValue = '';
    resetConfirmations();
    paint();
  },

  'co-complete': () => complete(),

  'co-lines': () => {
    if (!co) return;
    co.linesOpen = !co.linesOpen;
    paint();
  },

  'co-next': () => {
    closeSheet();
    if (ui.screen !== 'sell') navigate('sell');
  },
});

/** Totals moved: any "I received ₹X" tick was for a different amount. */
function resetConfirmations() {
  if (!co) return;
  co.confirmed = {UPI: false, Split: false, Other: false};
}

registerInputs({
  'co-tendered': el => {
    if (!co) return;
    co.tendered = el.value;
    patch();
  },
  'co-split-cash': el => {
    if (!co) return;
    co.splitCash = el.value;
    co.confirmed.Split = false;
    patchSplit();
  },
  'co-split-tendered': el => {
    if (!co) return;
    co.splitTendered = el.value;
    patch();
  },
  'co-custom-value': el => {
    if (co) co.customValue = el.value;
  },
});

registerChanges({
  'co-confirm': el => {
    if (!co) return;
    const key = /** @type {'UPI'|'Split'|'Other'} */ (el.dataset.key);
    if (key in co.confirmed) co.confirmed[key] = !!el.checked;
    patch();
  },
  'co-pending': el => {
    if (!co) return;
    co.pending = !!el.checked;
    paint();
  },
});

// Exposed for other modules that might want to know whether checkout is open (no state changes).
export const checkoutOpen = () => sheetKind() === KIND;
