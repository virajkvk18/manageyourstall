// Orders acceptance tests (orders agent): kitchen queue, token reset, receipts, payment confirmation (Cash / Split),
// corrections (partial refund, split refund, void), search, filters and layout at every width.
import {test, expect} from '@playwright/test';
import {ready, go, sheet, adminClick, noOverflow, state} from './helpers.mjs';

/**
 * Create orders through the UI kernel + domain (each {items: [[productId, qty]], method?, split?, pending?, note?, ago?}).
 * `ago` = minutes in the past. Returns the new order ids in order.
 * @param {import('@playwright/test').Page} page
 * @param {any[]} list
 * @returns {Promise<string[]>}
 */
const makeOrders = (page, list) => page.evaluate(async orders => {
  const core = await import('/ui/core.mjs');
  const d = await import('/domain.mjs');
  return core.commit(st => orders.map(o => {
    const items = o.items.map(([id, quantity = 1, extra = {}]) => d.makeLine(st.config, id, {quantity, ...extra}));
    const at = o.ago ? new Date(Date.now() - o.ago * 60000).toISOString() : undefined;
    return d.createOrder(st[st.mode], st.config, {
      id: crypto.randomUUID(), items, method: o.method || 'Cash', split: o.split || null, pending: !!o.pending, note: o.note || '',
    }, at).id;
  }));
}, list);

/** @param {import('@playwright/test').Page} page @param {string} id */
const orderOf = async (page, id) => {
  const st = await state(page);
  const s = st[st.mode];
  const o = s.orders.find(x => x.id === id);
  const net = s.payments.filter(p => p.entityId === id).reduce((n, p) => n + p.amount, 0);
  return {...o, net, audit: s.audit.filter(a => a.entityId === id)};
};

/** @param {import('@playwright/test').Page} page */
const openTab = async (page, key) => {
  await page.locator(`[data-action="ord-tab"][data-tab="${key}"]`).click();
  await expect(page.locator(`[data-action="ord-tab"][data-tab="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
};

/** @param {import('@playwright/test').Page} page @param {string} id */
const openReceipt = async (page, id) => {
  await openTab(page, 'all');
  await page.locator(`.ord-row[data-id="${id}"]`).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#sheet .ord-receipt')).toBeVisible();
};

test.describe('orders', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    await go(page, 'orders');
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('queue: oldest first, ready → handed leaves the queue, undo both ways', async ({page}) => {
    await expect(page.locator('.ord-screen .empty-state')).toContainText('All caught up!');
    const [newer, older] = await makeOrders(page, [
      {items: [['lemon-fizz', 2], ['cola']], note: 'extra ice please'},
      {items: [['french-fries']], ago: 5, pending: true},
    ]);
    const prep = page.locator('.ord-col-preparing .ord-ticket');
    await expect(prep).toHaveCount(2);
    // Oldest first, even though it got the later token.
    await expect(prep.nth(0)).toHaveAttribute('data-order', older);
    await expect(prep.nth(0).locator('.ord-token')).toHaveText('#02');
    await expect(prep.nth(0).locator('.ord-unpaid')).toHaveText(/UNPAID/);
    await expect(prep.nth(0).locator('.ord-age')).toContainText('5 min');
    await expect(prep.nth(1).locator('.ord-ticket-items')).toContainText('2× Lemon Fizz');
    await expect(prep.nth(1).locator('.ord-ticket-items')).toContainText('1× Cola');
    await expect(prep.nth(1).locator('.ord-note')).toContainText('extra ice please');
    await expect(prep.nth(1).locator('.ord-unpaid')).toHaveCount(0);
    await expect(page.locator('.ord-col-preparing .ord-col-count')).toHaveText('2');

    const card = page.locator(`.ord-ticket[data-order="${newer}"]`);
    await card.locator('[data-to="ready"]').click();
    await expect(page.locator(`.ord-col-ready .ord-ticket[data-order="${newer}"]`)).toBeVisible();
    await expect(page.locator('.ord-col-ready .ord-col-count')).toHaveText('1');

    // Undo: back to preparing, then forward again.
    await page.locator(`.ord-col-ready .ord-ticket[data-order="${newer}"] .ord-undo`).click();
    await expect(page.locator(`.ord-col-preparing .ord-ticket[data-order="${newer}"]`)).toBeVisible();
    await page.locator(`.ord-ticket[data-order="${newer}"] [data-to="ready"]`).click();
    await page.locator(`.ord-ticket[data-order="${newer}"] [data-to="handed"]`).click();
    await expect(page.locator(`.ord-ticket[data-order="${newer}"]`)).toHaveCount(0);
    expect((await orderOf(page, newer)).kitchen).toBe('handed');

    // Just handed over → undo puts it back in Ready.
    await page.locator(`.ord-handed [data-id="${newer}"]`).click();
    await expect(page.locator(`.ord-col-ready .ord-ticket[data-order="${newer}"]`)).toBeVisible();
    expect((await orderOf(page, newer)).kitchen).toBe('ready');

    // Tapping a ticket opens its receipt with the kitchen timeline.
    await page.locator(`.ord-ticket[data-order="${older}"] .ord-ticket-main`).click();
    await expect(page.locator('#sheet-title')).toContainText('#02 · Order #2');
    await expect(page.locator('#sheet .ord-timeline li')).toHaveCount(1);
    await page.locator('#sheet [data-action="ord-kitchen"][data-to="ready"]').click();
    await expect(page.locator('#sheet .ord-timeline li')).toHaveCount(2);
    await expect(page.locator('#sheet .ord-hero')).toContainText('READY');
    await noOverflow(page, 'receipt from queue');
  });

  test('reset tokens restarts at #01', async ({page}) => {
    await makeOrders(page, [{items: [['cola']]}, {items: [['cola']]}]);
    await expect(page.locator('.ord-next')).toContainText('#03');
    await page.locator('[data-action="ord-reset-tokens"]').click();
    await expect(sheet(page)).toContainText('Reset tokens?');
    await page.locator('#sheet [data-action="core-confirm"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('.ord-next')).toContainText('#01');
    const [id] = await makeOrders(page, [{items: [['lemon-fizz']]}]);
    expect((await orderOf(page, id)).token).toBe(1);
    await expect(page.locator(`.ord-ticket[data-order="${id}"] .ord-token`)).toHaveText('#01');
  });

  test('kitchen queue off: explainer, link to Studio team, All orders by default', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      await core.commitConfig(st => {
        st.config.kitchenQueue = false;
      });
      core.navigate('sell');
      core.navigate('orders');
    });
    await expect(page.locator('[data-action="ord-tab"][data-tab="all"]')).toHaveAttribute('aria-pressed', 'true');
    await openTab(page, 'queue');
    await expect(page.locator('.ord-off')).toContainText('Kitchen queue is off');
    await expect(page.locator('.ord-off [data-action="studio-open"][data-section="team"]')).toBeVisible();
  });

  test('pending orders: UNPAID, confirm payment by Cash and by Split', async ({page}) => {
    const [cashId, splitId] = await makeOrders(page, [
      {items: [['lemon-fizz'], ['cola']], pending: true},
      {items: [['cheese-chips-chaat-large']], pending: true, method: 'Split'},
    ]);
    await openReceipt(page, cashId);
    await expect(page.locator('#sheet .ord-hero')).toContainText('UNPAID');
    await page.locator('#sheet [data-action="ord-pay"]').click();
    await expect(page.locator('#sheet .ord-due-amount')).toHaveText('₹60');
    await page.locator('#sheet [data-action="ord-pay-method"][data-method="Cash"]').click();
    await page.locator('#sheet [data-action="ord-pay-quick"][data-amount="10000"]').click();
    await expect(page.locator('#sheet .ord-change')).toContainText('Return ₹40');
    // Confirmation is required.
    await page.locator('#sheet [data-action="ord-pay-save"]').click();
    await expect(page.locator('#sheet [data-error]')).toContainText('Tick the confirmation');
    await page.locator('#ord-pay-ok').check();
    await noOverflow(page, 'pay sheet cash');
    await page.locator('#sheet [data-action="ord-pay-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('PAID');
    let o = await orderOf(page, cashId);
    expect(o.status).toBe('paid');
    expect(o.net).toBe(6000);
    expect(o.change).toBe(4000);
    await expect(page.locator('#sheet .ord-audit')).toContainText('Payment confirmed');
    await page.locator('#sheet [data-action="close"]').first().click();

    await openReceipt(page, splitId);
    await page.locator('#sheet [data-action="ord-pay"]').click();
    await expect(page.locator('#sheet [data-action="ord-pay-method"][data-method="Split"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#ord-pay-cash').fill('30');
    await expect(page.locator('#sheet [data-pay-out="upi-part"]')).toHaveText('₹50');
    await page.locator('#ord-pay-ok').check();
    await noOverflow(page, 'pay sheet split');
    await page.locator('#sheet [data-action="ord-pay-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('PAID');
    o = await orderOf(page, splitId);
    expect(o.status).toBe('paid');
    expect(o.split).toEqual({Cash: 3000, UPI: 5000});
    await expect(page.locator('#sheet .ord-receipt')).toContainText('Cash ₹30 + UPI ₹50');
  });

  test('UPI QR shows on the confirm sheet when a UPI ID is set', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      await core.commitConfig(st => {
        st.config.upi.id = 'stall@okaxis';
      });
    });
    const [id] = await makeOrders(page, [{items: [['cola']], pending: true, method: 'UPI'}]);
    await openReceipt(page, id);
    await page.locator('#sheet [data-action="ord-pay"]').click();
    await expect(page.locator('#sheet .ord-qr svg')).toBeVisible();
    await expect(page.locator('#sheet .ord-qr-info')).toContainText('₹30');
    await noOverflow(page, 'pay sheet upi');
  });

  test('partial refund needs the PIN, lowers the net and lands in the history', async ({page}) => {
    const [id] = await makeOrders(page, [{items: [['lemon-fizz'], ['cola']]}]);
    await openReceipt(page, id);
    await adminClick(page, page.locator('#sheet [data-action="ord-correct"]'));
    await expect(page.locator('#sheet .ord-fix')).toBeVisible();
    await expect(page.locator('#ord-fix-amount')).toHaveValue('60');
    await page.locator('#ord-fix-amount').fill('20');
    await page.locator('#ord-fix-reason').fill('Cola was flat');
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet [data-error]')).toContainText('Tick the confirmation');
    await page.locator('#ord-fix-ok').check();
    await noOverflow(page, 'refund sheet');
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-receipt')).toBeVisible();
    await expect(page.locator('#sheet .ord-hero')).toContainText('PART REFUND');
    await expect(page.locator('#sheet .ord-net-line')).toContainText('₹40');
    await expect(page.locator('#sheet .ord-audit-refund')).toContainText('Refund · ₹20 from Cash');
    await expect(page.locator('#sheet .ord-audit-refund')).toContainText('Cola was flat');
    const o = await orderOf(page, id);
    expect(o.status).toBe('partial');
    expect(o.net).toBe(4000);
    expect(o.audit.map(a => a.type)).toEqual(['order-created', 'refund']);
  });

  test('split refund requires a method; void releases the order', async ({page}) => {
    const [splitId, voidId] = await makeOrders(page, [
      {items: [['cheese-chips-chaat-large']], method: 'Split', split: {Cash: 3000, UPI: 5000}},
      {items: [['cola']], pending: true},
    ]);
    await openReceipt(page, splitId);
    await adminClick(page, page.locator('#sheet [data-action="ord-correct"]'));
    await page.locator('#ord-fix-amount').fill('10');
    await page.locator('#ord-fix-reason').fill('Overcharged');
    await page.locator('#ord-fix-ok').check();
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet [data-error]')).toContainText('Choose which part to refund');
    await page.locator('#sheet [data-action="ord-fix-method"][data-method="UPI"]').click();
    await expect(page.locator('#ord-fix-amount')).toHaveValue('10'); // a typed amount is kept
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('PART REFUND');
    let o = await orderOf(page, splitId);
    expect(o.net).toBe(7000);
    await expect(page.locator('#sheet .ord-receipt')).toContainText('Cash ₹30 · UPI ₹40');

    // Void the same order: every method's remaining net is reversed.
    await page.locator('#sheet [data-action="ord-correct"]').click();
    await page.locator('#sheet [data-action="ord-fix-type"][data-type="void"]').click();
    await expect(page.locator('#sheet [data-fix-part="void"]')).toContainText('₹30 Cash + ₹40 UPI');
    await page.locator('#ord-fix-reason').fill('Customer left');
    await page.locator('#ord-fix-ok').check();
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('VOID');
    await expect(page.locator('#sheet [data-action="ord-correct"]')).toHaveCount(0);
    o = await orderOf(page, splitId);
    expect(o.status).toBe('void');
    expect(o.net).toBe(0);
    await page.locator('#sheet [data-action="close"]').first().click();

    // A pending order can only be voided.
    await openReceipt(page, voidId);
    await page.locator('#sheet [data-action="ord-correct"]').click();
    await expect(page.locator('#sheet [data-action="ord-fix-type"][data-type="refund"]')).toBeDisabled();
    await expect(page.locator('#sheet [data-action="ord-fix-type"][data-type="void"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#ord-fix-reason').fill('Never paid');
    await page.locator('#ord-fix-ok').check();
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('VOID');
    expect((await orderOf(page, voidId)).status).toBe('void');
    await page.locator('#sheet [data-action="close"]').first().click();
    // Voided orders leave the kitchen queue.
    await openTab(page, 'queue');
    await expect(page.locator(`.ord-ticket[data-order="${voidId}"]`)).toHaveCount(0);
  });

  test('all orders: search by token and item, filters, newest first', async ({page}) => {
    const ids = await makeOrders(page, [
      {items: [['cola']]},
      {items: [['french-fries']], method: 'UPI'},
      {items: [['cheese-chips-chaat-large']], method: 'Split', split: {Cash: 4000, UPI: 4000}},
      {items: [['lemon-fizz']], pending: true},
      {items: [['orange-fizz']], method: 'Other'},
    ]);
    await openTab(page, 'all');
    const rows = page.locator('.ord-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveAttribute('data-id', ids[4]);
    await expect(rows.first()).toContainText('Other');

    await page.locator('#ord-search').fill('#02');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-id', ids[1]);
    await page.locator('#ord-search').fill('3');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-id', ids[2]);
    await expect(page.locator('#ord-search')).toBeFocused();
    await page.locator('#ord-search').fill('fizz');
    await expect(rows).toHaveCount(2);
    await page.locator('#ord-search').fill('nothing like this');
    await expect(page.locator('.ord-screen .empty-state')).toContainText('No orders match');
    await page.locator('[data-action="ord-clear"]').click();
    await expect(rows).toHaveCount(5);

    const pick = async (key, expected) => {
      await page.locator(`[data-action="ord-filter"][data-filter="${key}"]`).click();
      await expect(rows).toHaveCount(expected.length);
      for (const id of expected) await expect(page.locator(`.ord-row[data-id="${id}"]`)).toHaveCount(1);
    };
    await pick('Cash', [ids[0]]);
    await pick('UPI', [ids[1]]);
    await pick('Split', [ids[2]]);
    await pick('Other', [ids[4]]);
    await pick('pending', [ids[3]]);
    await expect(rows.first()).toContainText('UNPAID');
    await pick('corrected', []);
    await pick('all', ids);
    await noOverflow(page, 'all orders');
  });

  // Review regressions -----------------------------------------------------------------------------------------------

  /** A human double tap: two taps at the same spot ~150 ms apart (the layout changes between them). */
  const doubleTap = async (page, locator) => {
    // Screen buttons: centre them (clear of the phone bottom nav). Sheet action bars are already pinned in view.
    await locator.evaluate(el => {
      if (!el.closest('#sheet')) el.scrollIntoView({block: 'center'});
    });
    await page.waitForTimeout(500); // a human pause since the previous tap
    const box = await locator.boundingBox();
    // Both taps are dispatched inside the page so the 150 ms gap holds even on a busy test machine. Each tap hits
    // whatever is under the finger at that moment, like a real touch.
    await page.evaluate(async ([x, y]) => {
      const tap = () => {
        const el = document.elementFromPoint(x, y);
        el?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, view: window}));
      };
      tap();
      await new Promise(r => setTimeout(r, 150));
      tap();
      await new Promise(r => setTimeout(r, 150));
    }, [box.x + box.width / 2, box.y + box.height / 2]);
  };

  test('double tap on a queue button never moves the next token', async ({page}) => {
    const [first, second, third] = await makeOrders(page, [{items: [['cola']], ago: 3}, {items: [['cola']], ago: 2}, {items: [['cola']], ago: 1}]);
    await doubleTap(page, page.locator(`.ord-ticket[data-order="${first}"] [data-to="ready"]`));
    await expect(page.locator(`.ord-col-ready .ord-ticket[data-order="${first}"]`)).toBeVisible();
    expect((await orderOf(page, second)).kitchen).toBe('preparing');
    expect((await orderOf(page, third)).kitchen).toBe('preparing');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);

    // Two ready cards: double tap "Handed over" on the first hands over only that one and opens no receipt.
    // (The next card now sits under the same spot; a deliberate tap there comes after a human pause.)
    await page.waitForTimeout(500);
    await page.locator(`.ord-ticket[data-order="${second}"] [data-to="ready"]`).click();
    await expect(page.locator('.ord-col-ready .ord-ticket')).toHaveCount(2);
    await doubleTap(page, page.locator(`.ord-col-ready .ord-ticket[data-order="${first}"] [data-to="handed"]`));
    await expect(page.locator(`.ord-ticket[data-order="${first}"]`)).toHaveCount(0);
    expect((await orderOf(page, second)).kitchen).toBe('ready');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  test('double tap on Confirm payment keeps the payment sheet open', async ({page}) => {
    const [id] = await makeOrders(page, [{items: [['cola']], pending: true}]);
    await openReceipt(page, id);
    await doubleTap(page, page.locator('#sheet [data-action="ord-pay"]'));
    await expect(page.locator('#sheet .ord-pay')).toBeVisible();
    // A deliberate Cancel still works.
    await page.waitForTimeout(350);
    await page.locator('#sheet [data-action="ord-back"]').click();
    await expect(page.locator('#sheet .ord-receipt')).toBeVisible();
  });

  test('receipts of queue-off orders offer no "Back to ready"; void shows reversed money', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      await core.commitConfig(st => {
        st.config.kitchenQueue = false;
      });
    });
    const [id] = await makeOrders(page, [{items: [['cola']]}]);
    await openReceipt(page, id);
    await expect(page.locator('#sheet .ord-hero')).toContainText('HANDED OVER');
    await expect(page.locator('#sheet [data-action="ord-kitchen"]')).toHaveCount(0);
    await adminClick(page, page.locator('#sheet [data-action="ord-correct"]'));
    await page.locator('#sheet [data-action="ord-fix-type"][data-type="void"]').click();
    await page.locator('#ord-fix-reason').fill('Rang up twice');
    await page.locator('#ord-fix-ok').check();
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-refunded-line')).toContainText('Reversed');
    await expect(page.locator('#sheet .ord-refunded-line')).toContainText('−₹30');
    expect((await orderOf(page, id)).kitchen).toBe('handed');
  });

  test('split correction picks the only part with money left', async ({page}) => {
    const [id] = await makeOrders(page, [{items: [['cheese-chips-chaat-large']], method: 'Split', split: {Cash: 3000, UPI: 5000}}]);
    await page.evaluate(async orderId => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => d.correctOrder(st[st.mode], st.config, orderId, {type: 'refund', amount: 3000, reason: 'Cash back', method: 'Cash'}));
    }, id);
    await openReceipt(page, id);
    await adminClick(page, page.locator('#sheet [data-action="ord-correct"]'));
    await expect(page.locator('#sheet [data-action="ord-fix-method"][data-method="Cash"]')).toBeDisabled();
    await expect(page.locator('#sheet [data-action="ord-fix-method"][data-method="UPI"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ord-fix-amount')).toHaveValue('50');
    await expect(page.locator('#ord-fix-amount-hint')).toContainText('Up to ₹50 by UPI');
    await page.locator('#ord-fix-reason').fill('Chaat was cold');
    await page.locator('#ord-fix-ok').check();
    await page.locator('#sheet [data-action="ord-fix-save"]').click();
    await expect(page.locator('#sheet .ord-hero')).toContainText('REFUNDED');
    const o = await orderOf(page, id);
    expect(o.status).toBe('refunded');
    expect(o.net).toBe(0);
  });

  test('layouts have no horizontal overflow', async ({page}) => {
    await makeOrders(page, [
      {items: [['veggie-chips-chaat-large', 3, {flavour: 'Magic Masala', addons: ['extra-cheese'], note: 'less spicy'}], ['combo-triple-dhamaka']],
        note: 'Pack separately — for the stage crew at gate 2', pending: true},
      {items: [['cola', 12]], ago: 14},
      {items: [['kachori', 3]], method: 'Split', split: {Cash: 4000, UPI: 5000}},
    ]);
    await noOverflow(page, 'queue');
    await openTab(page, 'all');
    await noOverflow(page, 'all orders');
    await page.locator('.ord-row-pending').click();
    await expect(page.locator('#sheet .ord-receipt')).toBeVisible();
    await noOverflow(page, 'receipt');
    await page.locator('#sheet [data-action="ord-pay"]').click();
    await page.locator('#sheet [data-action="ord-pay-method"][data-method="Split"]').click();
    await noOverflow(page, 'pay split');
  });
});
