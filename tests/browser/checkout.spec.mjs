// Review & pay acceptance tests (checkout agent, ARCHITECTURE.md §13.2): cash change, exact cash, UPI with and without a
// UPI ID (QR decoded end-to-end with jsQR), split payments, pending orders, discounts (rules, minimum, custom %), stale
// discounts, double-tap safety, other-tab cart changes, closing keeps the cart, success sheet and no horizontal overflow.
import {test, expect} from '@playwright/test';
import {ready, sheet, state, noOverflow, runAction} from './helpers.mjs';

/**
 * Replace the cart through the UI kernel (independent of the Sell screen).
 * @param {import('@playwright/test').Page} page
 * @param {Array<[string, number]>} items [productId, quantity][]
 */
async function setCart(page, items) {
  await page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      const s = st[st.mode];
      d.clearDraft(s);
      for (const [id, quantity] of list) d.addToDraft(s, st.config, d.makeLine(st.config, id, {quantity}));
    });
  }, items);
}

/** @param {import('@playwright/test').Page} page */
async function openCheckout(page) {
  await runAction(page, 'co-open');
  await expect(page.locator('#sheet[open][data-kind="checkout"]')).toBeVisible();
  await expect(sheet(page).locator('.co-pay')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page @param {'Cash'|'UPI'|'Split'|'Other'} method */
const pickMethod = (page, method) => sheet(page).locator(`[data-action="co-method"][data-method="${method}"]`).click();

/** @param {import('@playwright/test').Page} page */
const completeBtn = page => sheet(page).locator('#co-complete');

/** @param {import('@playwright/test').Page} page @param {string} upiId */
async function setUpi(page, upiId, payeeName = '') {
  await page.evaluate(async ([id, payee]) => {
    const core = await import('/ui/core.mjs');
    const cat = await import('/catalog.mjs');
    await core.commitConfig(st => cat.saveUpi(st.config, {id, payeeName: payee}));
  }, [upiId, payeeName]);
}

/** Expected UPI URI computed by the domain for an amount and the upcoming token. */
async function expectedUri(page, amount) {
  return page.evaluate(async a => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    const note = `Token ${core.tokenLabel(d.upcomingToken(core.S()))} · ${core.C().profile.stallName}`;
    return d.upiUri(core.C(), a, note);
  }, amount);
}

/** Decode the QR <svg> on screen with jsQR (draws it onto a canvas first). */
async function scanQr(page, selector) {
  await page.addScriptTag({path: 'node_modules/jsqr/dist/jsQR.js'});
  return page.evaluate(async sel => {
    const svg = document.querySelector(sel);
    if (!svg) return null;
    const url = URL.createObjectURL(new Blob([svg.outerHTML], {type: 'image/svg+xml'}));
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 480;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const data = ctx.getImageData(0, 0, size, size);
    const code = /** @type {any} */ (window).jsQR(data.data, size, size);
    return code ? code.data : null;
  }, selector);
}

const session = st => st[st.mode];

test.describe('checkout · Review & pay', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('empty cart only shows a toast', async ({page}) => {
    await setCart(page, []);
    await runAction(page, 'co-open');
    await expect(page.locator('#toast')).toContainText('cart is empty');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  test('cash with a ₹500 note shows the change, pays the order with token #01, and the next order gets #02', async ({page}) => {
    await setCart(page, [['lemon-fizz', 3], ['pani-puri', 3]]); // ₹90 + ₹90 = ₹180
    await openCheckout(page);
    const s = sheet(page);
    await expect(s.locator('.co-grand-amount')).toHaveText('₹180');
    await expect(s.locator('.co-next-token')).toContainText('#01');
    await expect(s.locator('[data-action="co-method"][data-method="Cash"]')).toHaveAttribute('aria-pressed', 'true');
    // Notes below the total are disabled.
    await expect(s.locator('[data-action="co-tender"][data-amount="5000"]')).toBeDisabled();
    await expect(s.locator('[data-action="co-tender"][data-amount="10000"]')).toBeDisabled();
    await expect(s.locator('[data-action="co-tender"][data-amount="20000"]')).toBeEnabled();
    await s.locator('[data-action="co-tender"][data-amount="50000"]').click();
    await expect(s.locator('#co-tendered')).toHaveValue('500');
    await expect(s.locator('#co-cash-result')).toContainText('Return');
    await expect(s.locator('#co-cash-result')).toContainText('₹320');
    // Typing less than the total asks for more and blocks completion.
    await s.locator('#co-tendered').fill('150');
    await expect(s.locator('#co-cash-result')).toContainText('₹30 more');
    await expect(completeBtn(page)).toBeDisabled();
    await expect(s.locator('#co-why')).toContainText('Collect ₹30 more');
    await s.locator('#co-tendered').fill('500');
    await expect(s.locator('#co-cash-result')).toContainText('₹320');
    await expect(completeBtn(page)).toHaveText(/Complete sale · ₹180/);
    await completeBtn(page).click();

    await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
    await expect(s.locator('.co-token')).toHaveText('#01');
    await expect(s.locator('.co-order-no')).toHaveText('Order #1');
    await expect(s.locator('.co-success-total')).toHaveText('₹180');
    await expect(s.locator('.co-success-change')).toContainText('₹320');
    await expect(s.locator('[data-action="ord-receipt"]')).toHaveAttribute('data-id', /.+/);
    await expect(s.locator('[data-action="ord-queue"]')).toBeVisible();

    let st = await state(page);
    expect(session(st).orders).toHaveLength(1);
    const order = session(st).orders[0];
    expect(order).toMatchObject({token: 1, number: 1, status: 'paid', method: 'Cash', total: 18000, cashReceived: 50000, change: 32000});
    expect(session(st).payments).toEqual([expect.objectContaining({entityId: order.id, amount: 18000, method: 'Cash', kind: 'order'})]);
    expect(session(st).draft).toEqual([]);
    expect(await s.locator('[data-action="ord-receipt"]').getAttribute('data-id')).toBe(order.id);

    await s.locator('[data-action="co-next"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);

    await setCart(page, [['cola', 1]]);
    await openCheckout(page);
    await expect(s.locator('.co-next-token')).toContainText('#02');
    await completeBtn(page).click(); // blank tendered = exact
    await expect(s.locator('.co-token')).toHaveText('#02');
    st = await state(page);
    expect(session(st).orders.map(o => o.token)).toEqual([1, 2]);
    expect(session(st).orders[1]).toMatchObject({cashReceived: null, change: 0, status: 'paid'});
  });

  test('Exact records the exact cash with no change', async ({page}) => {
    await setCart(page, [['veggie-chips-chaat-small', 2]]); // ₹80
    await openCheckout(page);
    const s = sheet(page);
    await s.locator('[data-action="co-tender"][data-amount="exact"]').click();
    await expect(s.locator('#co-tendered')).toHaveValue('80');
    await expect(s.locator('[data-action="co-tender"][data-amount="exact"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('#co-cash-result')).toContainText('No change');
    await completeBtn(page).click();
    await expect(s.locator('.co-token')).toHaveText('#01');
    await expect(s.locator('.co-success-change')).toHaveCount(0);
    const order = session(await state(page)).orders[0];
    expect(order).toMatchObject({method: 'Cash', total: 8000, cashReceived: 8000, change: 0});
  });

  test('UPI without a UPI ID shows the Studio hint and needs the confirmation tick', async ({page}) => {
    await setCart(page, [['cola', 2]]); // ₹60
    await openCheckout(page);
    const s = sheet(page);
    await pickMethod(page, 'UPI');
    await expect(s.locator('.co-upi-hint')).toBeVisible();
    await expect(s.locator('.co-upi-hint [data-action="studio-open"][data-section="upi"]')).toBeVisible();
    await expect(s.locator('.co-qr')).toHaveCount(0);
    await expect(s.locator('.co-confirm')).toContainText('I received ₹60 on UPI');
    await expect(completeBtn(page)).toBeDisabled();
    await expect(s.locator('#co-why')).toBeVisible();
    await s.locator('#co-confirm').check();
    await expect(completeBtn(page)).toBeEnabled();
    await s.locator('#co-confirm').uncheck();
    await expect(completeBtn(page)).toBeDisabled();
    await s.locator('#co-confirm').check();
    await completeBtn(page).click();
    await expect(s.locator('.co-token')).toHaveText('#01');
    const ses = session(await state(page));
    expect(ses.orders[0]).toMatchObject({method: 'UPI', status: 'paid', total: 6000});
    expect(ses.payments).toEqual([expect.objectContaining({method: 'UPI', amount: 6000})]);
  });

  test('UPI with an ID shows a scannable QR whose payload is exactly the domain UPI URI', async ({page}) => {
    await setUpi(page, 'myawesomestall@okaxis', 'Team Stall & Co');
    await setCart(page, [['cheese-chips-chaat-large', 1], ['samosa', 1], ['lemon-fizz', 1]]); // ₹80 + ₹20 + ₹30 = ₹130
    await openCheckout(page);
    const s = sheet(page);
    await pickMethod(page, 'UPI');
    const qr = s.locator('.co-qr');
    await expect(qr).toBeVisible();
    const uri = await expectedUri(page, 13000);
    expect(uri).toContain('am=130.00');
    expect(uri).toContain('tn=Token%20%2301');
    await expect(qr).toHaveAttribute('data-upi', /** @type {string} */ (uri));
    await expect(s.locator('.co-qr-amount')).toHaveText('₹130');
    await expect(s.locator('.co-qr-payee')).toContainText('Team Stall & Co');
    // Big enough to scan from a phone held at the counter.
    const box = await qr.boundingBox();
    expect(box?.width || 0).toBeGreaterThanOrEqual(240);
    // End-to-end: decode the rendered QR.
    expect(await scanQr(page, '.co-qr svg')).toBe(uri);
    await s.locator('#co-confirm').check();
    await completeBtn(page).click();
    await expect(s.locator('.co-token')).toHaveText('#01');
  });

  test('split: validates the parts, then writes one Cash and one UPI payment that add up to the total', async ({page}) => {
    await setUpi(page, 'stall@ybl');
    await setCart(page, [['lemon-fizz', 3], ['pani-puri', 3]]); // ₹180
    await openCheckout(page);
    const s = sheet(page);
    await pickMethod(page, 'Split');
    const cash = s.locator('#co-split-cash');
    await expect(cash).toBeVisible();
    await expect(completeBtn(page)).toBeDisabled();
    await cash.fill('0');
    await expect(s.locator('#co-split-parts')).toContainText('more than ₹0');
    await expect(completeBtn(page)).toBeDisabled();
    await cash.fill('180');
    await expect(s.locator('#co-split-parts')).toContainText('less than the ₹180 total');
    await expect(completeBtn(page)).toBeDisabled();
    await cash.fill('250');
    await expect(s.locator('#co-split-parts')).toContainText('less than the ₹180 total');
    await expect(s.locator('.co-qr')).toHaveCount(0);

    await cash.fill('100');
    await expect(cash).toBeFocused(); // typing never loses the field
    await expect(s.locator('.co-part-cash')).toContainText('₹100');
    await expect(s.locator('.co-part-upi')).toContainText('₹80');
    await expect(s.locator('.co-qr')).toHaveAttribute('data-upi', /** @type {string} */ (await expectedUri(page, 8000)));
    expect(await scanQr(page, '.co-qr svg')).toBe(await expectedUri(page, 8000));
    await expect(s.locator('.co-confirm')).toContainText('I received ₹80 on UPI');
    await expect(completeBtn(page)).toBeDisabled();
    await s.locator('#co-split-tendered').fill('200');
    await expect(s.locator('#co-split-change')).toContainText('₹100');
    await s.locator('#co-confirm').check();
    await expect(completeBtn(page)).toBeEnabled();
    // Changing the cash part resets the UPI confirmation (the amount changed).
    await cash.fill('120');
    await expect(s.locator('.co-confirm')).toContainText('I received ₹60 on UPI');
    await expect(s.locator('#co-confirm')).not.toBeChecked();
    await expect(completeBtn(page)).toBeDisabled();
    await s.locator('[data-action="co-split-quick"][data-amount="10000"]').click();
    await expect(cash).toHaveValue('100');
    await s.locator('#co-confirm').check();
    await completeBtn(page).click();

    await expect(s.locator('.co-token')).toHaveText('#01');
    await expect(s.locator('.co-success-method')).toContainText('Cash ₹100 + UPI ₹80');
    await expect(s.locator('.co-success-change')).toContainText('₹100');
    const ses = session(await state(page));
    const order = ses.orders[0];
    expect(order).toMatchObject({method: 'Split', split: {Cash: 10000, UPI: 8000}, total: 18000, cashReceived: 20000, change: 10000});
    const pays = ses.payments.filter(p => p.entityId === order.id);
    expect(pays).toHaveLength(2);
    expect(pays.map(p => p.method).sort()).toEqual(['Cash', 'UPI']);
    expect(pays.reduce((n, p) => n + p.amount, 0)).toBe(18000);
  });

  test('pay later saves a pending order without any payment', async ({page}) => {
    await setCart(page, [['cheese-chips-chaat-large', 1]]); // ₹80
    await openCheckout(page);
    const s = sheet(page);
    await pickMethod(page, 'UPI');
    await expect(completeBtn(page)).toBeDisabled();
    await s.locator('#co-pending').check();
    await expect(completeBtn(page)).toBeEnabled();
    await expect(completeBtn(page)).toHaveText(/Save as pending · ₹80/);
    await expect(s.locator('.co-pending-note')).toBeVisible();
    await completeBtn(page).click();
    await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
    await expect(s.locator('.co-success-method')).toContainText('UNPAID');
    const ses = session(await state(page));
    expect(ses.orders[0]).toMatchObject({status: 'pending', method: 'UPI', total: 8000, cashReceived: null});
    expect(ses.payments).toEqual([]);
  });

  test('discount chips apply and remove, show the minimum hint, and a custom % discount works', async ({page}) => {
    await setCart(page, [['lemon-fizz', 3]]); // ₹90
    await openCheckout(page);
    const s = sheet(page);
    const reel = s.locator('[data-action="co-discount"][data-id="reel-story"]');
    const friends = s.locator('[data-action="co-discount"][data-id="friends-faculty"]');
    await expect(s.locator('[data-action="co-discount"][data-id="festive-10"]')).toHaveCount(0); // inactive rule hidden
    await expect(friends).toContainText('Add ₹10 more');

    await reel.click();
    await expect(reel).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('.co-grand-amount')).toHaveText('₹80');
    await expect(s.locator('.co-trow-off')).toContainText('−₹10');
    expect(session(await state(page)).draftDiscount).toEqual({ruleId: 'reel-story'});
    await reel.click(); // tap again removes
    await expect(reel).toHaveAttribute('aria-pressed', 'false');
    await expect(s.locator('.co-grand-amount')).toHaveText('₹90');
    expect(session(await state(page)).draftDiscount).toBeNull();

    // Below the rule's minimum: chosen, but no money off yet, with a clear hint.
    await friends.click();
    await expect(friends).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('.co-minimum')).toContainText('Add ₹10 more');
    await expect(s.locator('.co-grand-amount')).toHaveText('₹90');

    // Custom 10% replaces it (one discount per order).
    await s.locator('[data-action="co-custom"]').click();
    await s.locator('[data-action="co-custom-type"][data-type="percent"]').click();
    await s.locator('#co-custom-value').fill('10');
    await s.locator('[data-action="co-custom-apply"]').click();
    await expect(s.locator('.co-chip-custom')).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('.co-chip-custom')).toContainText('Custom 10% off');
    await expect(friends).toHaveAttribute('aria-pressed', 'false');
    await expect(s.locator('.co-grand-amount')).toHaveText('₹81');
    expect(session(await state(page)).draftDiscount).toEqual({custom: true, type: 'percent', value: 10});

    // Invalid custom values show the domain's message and change nothing.
    await s.locator('[data-action="co-custom"]').click(); // removes the custom discount
    await expect(s.locator('.co-grand-amount')).toHaveText('₹90');
    await s.locator('[data-action="co-custom"]').click(); // opens the form again
    await s.locator('[data-action="co-custom-type"][data-type="percent"]').click();
    await s.locator('#co-custom-value').fill('150');
    await s.locator('[data-action="co-custom-apply"]').click();
    await expect(s.locator('[data-error]')).toContainText('1 to 100');
    await s.locator('#co-custom-value').fill('10');
    await s.locator('#co-custom-value').press('Enter');
    await expect(s.locator('.co-grand-amount')).toHaveText('₹81');

    await completeBtn(page).click();
    await expect(s.locator('.co-success-total')).toHaveText('₹81');
    const order = session(await state(page)).orders[0];
    expect(order).toMatchObject({subtotal: 9000, discount: 900, total: 8100});
    expect(order.discountInfo).toMatchObject({label: 'Custom 10% off', type: 'percent', value: 10});
  });

  test('a stale discount is cleared when checkout opens', async ({page}) => {
    await setCart(page, [['cola', 1]]);
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      const cat = await import('/catalog.mjs');
      await core.commit(st => d.setDraftDiscount(st[st.mode], st.config, {ruleId: 'reel-story'}));
      // Deactivate the rule behind the cart's back (as an owner might in another tab).
      await core.commitConfig(st => cat.saveDiscount(st.config, {id: 'reel-story', active: false}));
    });
    expect(session(await state(page)).draftDiscount).toEqual({ruleId: 'reel-story'});
    await openCheckout(page);
    // Told inside the sheet (a toast raised before the modal opens would sit underneath it).
    await expect(sheet(page).locator('.co-stale')).toBeVisible();
    await expect(sheet(page).locator('.co-stale')).toContainText('discount isn’t available any more');
    expect(session(await state(page)).draftDiscount).toBeNull();
    await expect(sheet(page).locator('.co-grand-amount')).toHaveText('₹30');
    await completeBtn(page).click();
    await expect(sheet(page).locator('.co-token')).toHaveText('#01');
  });

  test('double-clicking Complete creates exactly one order', async ({page}) => {
    await setCart(page, [['cola', 1], ['lemon-fizz', 1]]);
    await openCheckout(page);
    await completeBtn(page).dblclick();
    await expect(sheet(page).locator('.co-token')).toHaveText('#01');
    // A stray programmatic repeat is a no-op too.
    await runAction(page, 'co-complete');
    const ses = session(await state(page));
    expect(ses.orders).toHaveLength(1);
    expect(ses.payments).toHaveLength(1);
  });

  test('refuses to complete when the cart changed in another tab', async ({page}) => {
    await setCart(page, [['cola', 1]]);
    await openCheckout(page);
    await page.evaluate(async () => {
      const storage = await import('/storage.mjs');
      const d = await import('/domain.mjs');
      await storage.mutate(st => d.addToDraft(st[st.mode], st.config, d.makeLine(st.config, 'lemon-fizz')));
    });
    await completeBtn(page).click();
    await expect(sheet(page).locator('[data-error]')).toContainText('The cart changed in another tab');
    await expect(page.locator('#sheet[open][data-kind="checkout"]')).toBeVisible();
    const st = await page.evaluate(async () => (await import('/storage.mjs')).read());
    expect(session(st).orders).toHaveLength(0);
  });

  test('closing the sheet keeps the cart and reopening shows it again', async ({page}) => {
    await setCart(page, [['peri-peri-fries', 2]]);
    await openCheckout(page);
    await sheet(page).locator('[data-action="co-tender"][data-amount="20000"]').click();
    await sheet(page).locator('.sheet-close').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const ses = session(await state(page));
    expect(ses.draft).toHaveLength(1);
    expect(ses.draft[0]).toMatchObject({productId: 'peri-peri-fries', quantity: 2});
    expect(ses.orders).toHaveLength(0);
    await openCheckout(page);
    await expect(sheet(page).locator('.co-grand-amount')).toHaveText('₹140');
    await expect(sheet(page).locator('#co-tendered')).toHaveValue(''); // fresh payment details
  });

  test('no horizontal overflow in any checkout state', async ({page}) => {
    await setUpi(page, 'a-really-long-upi-handle.for.the.stall@okhdfcbank', 'Stall With A Pretty Long Payee Name');
    await setCart(page, [['combo-triple-dhamaka', 2], ['veggie-chips-chaat-large', 2], ['cola', 3]]);
    await openCheckout(page);
    const s = sheet(page);
    const sheetFits = async label => {
      await noOverflow(page, label);
      const ok = await page.evaluate(() => {
        const el = document.querySelector('#sheet .sheet-body');
        const dlg = document.querySelector('#sheet');
        return !!el && el.scrollWidth <= el.clientWidth + 1 && dlg.getBoundingClientRect().right <= window.innerWidth + 1;
      });
      expect(ok, `sheet overflow ${label}`).toBeTruthy();
    };
    await s.locator('[data-action="co-tender"][data-amount="50000"]').click();
    await sheetFits('cash');
    await pickMethod(page, 'UPI');
    await sheetFits('upi');
    await pickMethod(page, 'Split');
    await s.locator('#co-split-cash').fill('100');
    await sheetFits('split');
    await pickMethod(page, 'Other');
    await s.locator('[data-action="co-custom"]').click();
    await sheetFits('custom discount');
    await s.locator('#co-confirm').check();
    await completeBtn(page).click();
    await expect(s.locator('.co-token')).toBeVisible();
    await sheetFits('success');
    await s.locator('[data-action="co-next"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  // ---- Regression tests from the independent review -----------------------------------------------------------------

  test('review: the second tap of a double-tap cannot hit the success sheet buttons', async ({page}) => {
    await setCart(page, [['cola', 1]]);
    await openCheckout(page);
    await completeBtn(page).click();
    await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
    // A tap that arrives right after the success sheet opened (where Complete used to be) is ignored.
    await page.evaluate(() => {
      document.querySelector('#sheet [data-action="ord-queue"]')?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
      document.querySelector('#sheet [data-action="ord-receipt"]')?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });
    await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
    await expect(sheet(page).locator('.co-token')).toHaveText('#01');
    // …then the buttons arm and work, without ever looking disabled.
    const next = sheet(page).locator('[data-action="co-next"]');
    await expect(next).not.toHaveAttribute('aria-disabled', 'true');
    expect(await next.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    await next.click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  test('review: a closed checkout cannot be completed (Escape forgets the payment state)', async ({page}) => {
    await setCart(page, [['cola', 1]]);
    await openCheckout(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await runAction(page, 'co-complete');
    await runAction(page, 'co-method', {method: 'UPI'});
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const ses = session(await state(page));
    expect(ses.orders).toHaveLength(0);
    expect(ses.draft).toHaveLength(1);
  });

  test('review: amounts that are too large say so; ₹0 orders hide Pay later; a bad split part blocks a pending save', async ({page}) => {
    await setCart(page, [['cola', 1]]); // ₹30
    await openCheckout(page);
    const s = sheet(page);
    await s.locator('#co-tendered').fill('99999999');
    await expect(s.locator('#co-cash-result')).toContainText('too large');
    await expect(completeBtn(page)).toBeDisabled();
    await s.locator('#co-tendered').fill('');

    // Pending Split: blank parts are fine (filled in later), a typed invalid part is not.
    await pickMethod(page, 'Split');
    await s.locator('#co-pending').check();
    await expect(completeBtn(page)).toBeEnabled();
    await s.locator('#co-split-cash').fill('45');
    await expect(completeBtn(page)).toBeDisabled();
    await expect(s.locator('#co-why')).toContainText('less than the ₹30 total');
    await s.locator('#co-split-cash').fill('10');
    await expect(completeBtn(page)).toBeEnabled();
    await s.locator('#co-pending').uncheck();
    await pickMethod(page, 'Cash');

    // A discount that covers everything: nothing to collect, so no Pay later (and the order is paid, not pending).
    await s.locator('[data-action="co-custom"]').click();
    await s.locator('[data-action="co-custom-type"][data-type="percent"]').click();
    await s.locator('#co-custom-value').fill('100');
    await s.locator('[data-action="co-custom-apply"]').click();
    await expect(s.locator('.co-grand-amount')).toHaveText('₹0');
    await expect(s.locator('#co-pending')).toHaveCount(0);
    await completeBtn(page).click();
    await expect(s.locator('.co-token')).toHaveText('#01');
    expect(session(await state(page)).orders[0]).toMatchObject({status: 'paid', total: 0});
  });

  test('review: keyboard focus stays on the payment method after switching', async ({page}) => {
    await setCart(page, [['cola', 1]]);
    await openCheckout(page);
    const upi = sheet(page).locator('[data-action="co-method"][data-method="UPI"]');
    await upi.focus();
    await page.keyboard.press('Enter');
    await expect(upi).toHaveAttribute('aria-pressed', 'true');
    await expect(upi).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    await expect(sheet(page).locator('[data-action="co-method"][data-method="Cash"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet(page).locator('[data-action="co-method"][data-method="Cash"]')).toBeFocused();
  });

  test('review: phone tap targets and a short phone still shows the change to return', async ({page}, info) => {
    test.skip(!['mobile', 'narrow'].includes(info.project.name), 'phone layout only');
    await page.setViewportSize({width: info.project.name === 'narrow' ? 320 : 360, height: 640});
    await setCart(page, [['lemon-fizz', 3], ['pani-puri', 3]]); // ₹180
    await openCheckout(page);
    const toggle = sheet(page).locator('[data-action="co-lines"]');
    expect((await toggle.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
    await sheet(page).locator('[data-action="co-tender"][data-amount="50000"]').click();
    await completeBtn(page).click();
    const change = sheet(page).locator('.co-success-change');
    await expect(change).toContainText('₹320');
    await expect(sheet(page).locator('[data-action="co-next"]')).not.toHaveAttribute('aria-disabled', 'true');
    await page.waitForFunction(() => !document.querySelector('#sheet .co-token-card')?.getAnimations().some(a => a.playState === 'running'));
    const [card, bar] = await Promise.all([change.boundingBox(), sheet(page).locator('.sheet-actions').boundingBox()]);
    expect(card && bar && card.y + card.height <= bar.y + 1, 'change card sits above the action bar').toBeTruthy();
  });
});
