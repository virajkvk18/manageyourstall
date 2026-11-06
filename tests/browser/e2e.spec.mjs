// End-to-end golden path (lead): one stall, start to finish, the way an owner and a cashier use it on fest day.
// fresh install → onboarding (Chai & Maggi + name) → Studio UPI (PIN 1234) → Sell 2 items + note → Checkout UPI (QR,
// confirm) → success token #01 → Orders queue ready → handed → Dashboard numbers & bestsellers → Day report + WhatsApp →
// Menu sold out → Sell shows it → JSON backup → factory reset → restore → everything is back.
// Plus: an existing Packet Pataka v1 device upgrades cleanly.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {ready, go, act, sheet, state, adminClick, noOverflow} from './helpers.mjs';

const STALL = 'Kadak Corner';
const isPhone = page => (page.viewportSize()?.width || 1440) <= 760;
const openSheet = page => page.locator('#sheet[open]');

/** Studio is in the sidebar on desktop and behind the More hub on phones. */
async function goStudio(page) {
  if (isPhone(page)) {
    await go(page, 'more');
    await page.locator('[data-tile="studio"]').click();
    await expect(page.locator('#main.screen-studio')).toBeVisible();
  } else {
    await go(page, 'studio');
  }
}

/** Collect page errors and console errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.describe('golden path', () => {
  test('fresh install → sell → pay by UPI → queue → dashboard → report → sold out → backup → reset → restore', async ({page}, testInfo) => {
    test.setTimeout(120000);
    const errors = watchErrors(page);

    // 1. Fresh install: onboarding opens. Pick Chai & Maggi and name the stall.
    await ready(page, {onboarding: 'keep'});
    const dlg = sheet(page);
    await expect(page.locator('#sheet[open][data-kind="onboarding"]')).toBeVisible();
    await expect(page.locator('.brand-mark:visible').first()).toHaveText('MYS');
    await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');
    await dlg.locator('label[for="onb-tpl-chai-maggi"]').click();
    await expect(dlg.locator('#onb-tpl-chai-maggi')).toBeChecked();
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('#onb-stallName').fill(STALL);
    await dlg.locator('#onb-booth').fill('Stall No. 7');
    await dlg.locator('[data-action="onb-next"]').click();
    await expect(dlg).toContainText(`${STALL} is ready!`);
    await dlg.locator('[data-action="onb-finish"]').click();
    await expect(openSheet(page)).toHaveCount(0);
    await expect(page.locator('#main.screen-sell')).toBeVisible();
    let st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.config.templateId).toBe('chai-maggi');
    expect(st.config.profile.stallName).toBe(STALL);
    await expect(page.locator('.event-title')).toContainText(STALL);
    await expect(page.locator('article.sell-card[data-product="masala-chai"]')).toBeVisible();

    // 2. Studio: add a UPI ID. The first admin action creates PIN 1234.
    await goStudio(page);
    await page.locator('#studio-upi-id').fill('kadakcorner@okaxis');
    await expect(page.locator('[data-upi-qr] svg')).toBeVisible();
    await adminClick(page, act(page, 'studio-save-upi'));
    await expect.poll(async () => (await state(page)).config.upi.id).toBe('kadakcorner@okaxis');
    expect((await state(page)).pin).not.toBeNull();

    // 3. Sell: Masala Chai ×2 and a Samosa, plus an order note.
    await go(page, 'sell');
    const chai = page.locator('article.sell-card[data-product="masala-chai"] .sell-card-main');
    await chai.click();
    await expect(page.locator('article.sell-card[data-product="masala-chai"] .sell-qty-badge')).toContainText('1');
    await page.locator('article.sell-card[data-product="masala-chai"] [data-action="sell-inc"]').first().click();
    await expect(page.locator('article.sell-card[data-product="masala-chai"] .sell-qty-badge')).toContainText('2');
    await page.locator('article.sell-card[data-product="samosa"] .sell-card-main').click();
    await expect.poll(async () => (await state(page)).live.draft.reduce((n, l) => n + l.quantity, 0)).toBe(3);
    if (!(await act(page, 'sell-note').count())) await act(page, 'sell-cart-open').click();
    await act(page, 'sell-note').click();
    await sheet(page).locator('#sell-note-text').fill('Less sugar, extra hot');
    await act(page, 'sell-note-save').click();
    await expect.poll(async () => (await state(page)).live.draftNote).toBe('Less sugar, extra hot');

    // 4. Checkout by UPI: QR visible, receipt confirmed by the cashier, token #01.
    // Phones come back to the cart sheet after the note; its own "Review & pay" sits above the cart bar.
    const pay = (await openSheet(page).count()) ? openSheet(page).locator('[data-action="co-open"]') : act(page, 'co-open');
    await pay.click();
    await expect(page.locator('#sheet[open][data-kind="checkout"]')).toBeVisible();
    await expect(dlg.locator('.co-grand-amount')).toContainText('₹60');
    await dlg.locator('[data-action="co-method"][data-method="UPI"]').click();
    const qr = dlg.locator('.co-qr');
    await expect(qr).toBeVisible();
    await expect(qr.locator('svg')).toBeVisible();
    await expect(qr).toHaveAttribute('data-upi', /pa=kadakcorner%40okaxis.*am=60\.00/);
    await expect(dlg.locator('#co-complete')).toBeDisabled();
    await dlg.locator('#co-confirm').check();
    await dlg.locator('#co-complete').click();
    await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
    await expect(dlg.locator('.co-token')).toHaveText('#01');
    await expect(dlg.locator('.co-success-total')).toHaveText('₹60');
    st = await state(page);
    expect(st.live.orders).toHaveLength(1);
    const order = st.live.orders[0];
    expect(order).toMatchObject({token: 1, total: 6000, method: 'UPI', status: 'paid', note: 'Less sugar, extra hot', kitchen: 'preparing'});
    expect(st.live.draft).toHaveLength(0);

    // 5. Orders queue: ready → handed over.
    await dlg.locator('[data-action="ord-queue"]').click();
    await expect(page.locator('#main.screen-orders')).toBeVisible();
    const ticket = page.locator(`.ord-ticket[data-order="${order.id}"]`);
    await expect(page.locator(`.ord-col-preparing .ord-ticket[data-order="${order.id}"]`)).toBeVisible();
    await expect(ticket.locator('.ord-ticket-items')).toContainText('2× Masala Chai');
    await expect(ticket.locator('.ord-note')).toContainText('Less sugar, extra hot');
    await ticket.locator('[data-to="ready"]').click();
    await expect(page.locator(`.ord-col-ready .ord-ticket[data-order="${order.id}"]`)).toBeVisible();
    // The queue ignores a second tap on the same spot right after the layout moved (anti double-tap), so retry.
    await expect(async () => {
      await ticket.locator('[data-to="handed"]').click({timeout: 1000});
      await expect(ticket).toHaveCount(0, {timeout: 1000});
    }).toPass({timeout: 10000});
    await expect.poll(async () => (await state(page)).live.orders[0].kitchen).toBe('handed');

    // 6. Dashboard: numbers and bestsellers.
    await go(page, 'dashboard');
    const tile = label => page.locator('.dash-stat').filter({has: page.locator('small', {hasText: new RegExp(`^${label}`)})}).locator('strong');
    await expect(tile('Collected')).toHaveText('₹60');
    await expect(tile('Orders')).toHaveText('1');
    await expect(tile('Items sold')).toHaveText('3');
    await expect(tile('UPI')).toHaveText('₹60');
    await expect(tile('Cash')).toHaveText('₹0');
    await expect(page.locator('.dash-best-row').first()).toContainText('Masala Chai');
    await expect(page.locator('.dash-best-row').first()).toContainText('2');
    await noOverflow(page, 'dashboard after a sale');

    // 7. Day report: text + WhatsApp link with the same text.
    await act(page, 'dash-report').click();
    const bubble = sheet(page).locator('[data-report-text]');
    await expect(bubble).toContainText(STALL);
    await expect(bubble).toContainText('Collected: ₹60');
    await expect(bubble).toContainText('1. Masala Chai — 2 sold');
    const text = await bubble.innerText();
    const href = await sheet(page).locator('a.dash-wa-link').getAttribute('href');
    expect(href?.startsWith('https://wa.me/?text=')).toBeTruthy();
    expect(decodeURIComponent(String(href).slice('https://wa.me/?text='.length)).trim()).toBe(text.trim());
    await act(page, 'close').click();

    // 8. Menu: mark Samosa sold out (no PIN needed); Sell shows it sold out.
    await go(page, 'menu');
    await page.locator('.menu-row[data-product="samosa"] [data-action="menu-toggle-soldout"]').click();
    await expect.poll(async () => (await state(page)).config.products.find(p => p.id === 'samosa').soldOut).toBe(true);
    await go(page, 'sell');
    await expect(page.locator('article.sell-card[data-product="samosa"] .sell-ribbon')).toContainText(/sold out/i);

    // 9. Backup JSON download.
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), act(page, 'data-export', '[data-kind="json"]').click()]);
    expect(dl.suggestedFilename()).toMatch(/^mys-backup-kadak-corner-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath('e2e-backup.json');
    await dl.saveAs(file);
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    expect(backup.state.config.profile.stallName).toBe(STALL);
    await act(page, 'close').click();

    // 10. Factory reset: the stall is wiped and onboarding opens again.
    await page.locator('[data-tile="danger"]').click();
    await adminClick(page, act(page, 'data-factory'));
    await sheet(page).locator('#confirm-typed').fill('FACTORY RESET');
    await act(page, 'core-confirm').click();
    await expect(page.locator('#sheet[open][data-kind="onboarding"]')).toBeVisible();
    st = await state(page);
    expect(st.onboarded).toBe(false);
    expect(st.live.orders).toHaveLength(0);
    expect(st.pin).toBeNull();
    await sheet(page).locator('[data-action="onb-skip"]').click();
    await expect(openSheet(page)).toHaveCount(0);

    // 11. Restore the backup: orders, stall name and menu are back (the backup's PIN is 1234).
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    await page.setInputFiles('#data-restore-file', file);
    await expect(sheet(page).locator('[data-restore-summary]')).toContainText(STALL);
    // After a factory reset there is no PIN yet: the prompt creates one before the restore goes through.
    await adminClick(page, act(page, 'data-restore'));
    await expect(openSheet(page)).toContainText('Replace this device’s stall?');
    await act(page, 'core-confirm').click();
    await expect(openSheet(page)).toHaveCount(0);
    st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.config.profile.stallName).toBe(STALL);
    expect(st.config.templateId).toBe('chai-maggi');
    expect(st.config.upi.id).toBe('kadakcorner@okaxis');
    expect(st.live.orders).toHaveLength(1);
    expect(st.live.orders[0]).toMatchObject({id: order.id, total: 6000, token: 1, kitchen: 'handed'});
    expect(st.config.products.find(p => p.id === 'samosa').soldOut).toBe(true);
    await expect(page.locator('.event-title')).toContainText(STALL);
    await go(page, 'dashboard');
    await expect(tile('Collected')).toHaveText('₹60');
    await go(page, 'sell');
    await expect(page.locator('article.sell-card[data-product="masala-chai"]')).toBeVisible();
    await expect(page.locator('article.sell-card[data-product="samosa"] .sell-ribbon')).toContainText(/sold out/i);
    await noOverflow(page, 'sell after restore');

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('integration polish: tinted art, toasts clear of sheet buttons, focus on open and after close', async ({page}) => {
    const errors = watchErrors(page);
    await ready(page);
    // Art frames wear the item's tint (base .art-frame used to paint every frame cream).
    const bg = await page.locator('article.sell-card[data-product="veggie-chips-chaat-small"] .art-frame').first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    const cream = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--tint-cream)';
      document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    expect(bg).not.toBe(cream);

    // A sheet opens with focus on its title (no ring on the close button), and a toast never covers its action bar.
    await go(page, 'dashboard');
    const opener = act(page, 'dash-report');
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sheet[open][data-kind="dash-report"]')).toBeVisible();
    await expect(page.locator('#sheet-title')).toBeFocused();
    await page.evaluate(() => import('/ui/core.mjs').then(c => c.toast('Copied!')));
    const toastBox = await page.locator('#toast').boundingBox();
    const barBox = await page.locator('#sheet .sheet-actions').boundingBox();
    expect(toastBox && barBox).toBeTruthy();
    expect(toastBox.y + toastBox.height <= barBox.y || toastBox.y >= barBox.y + barBox.height).toBeTruthy();

    // Closing (even after a re-render replaced the opener) gives focus back to the control that opened it.
    await page.evaluate(() => import('/ui/core.mjs').then(c => c.render()));
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(act(page, 'dash-report')).toBeFocused();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an existing Packet Pataka v1 device upgrades cleanly', async ({page}) => {
    const errors = watchErrors(page);
    const v1 = JSON.parse(readFileSync(new URL('../fixtures/v1-state.json', import.meta.url), 'utf8'));
    const expected = JSON.parse(readFileSync(new URL('../fixtures/v1-expected.json', import.meta.url), 'utf8'));
    // A blank page on the app's origin seeds the legacy v1 database before the app ever loads.
    await page.route('**/__seed-v1', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>seed</title>'}));
    await page.goto('/__seed-v1');
    await page.evaluate(value => new Promise((resolve, reject) => {
      const req = indexedDB.open('packet-pataka-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(value, 'root');
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    }), v1);

    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
    await expect(page.locator('.app-shell')).toBeVisible();
    // No onboarding: this stall already has sales.
    await expect(openSheet(page)).toHaveCount(0);
    const st = await state(page);
    expect(st.version).toBe(2);
    expect(st.onboarded).toBe(true);
    expect(st.config.profile.stallName).toBe('Packet Pataka');
    expect(st.pin).toEqual({salt: v1.pin.salt, hash: 'a'.repeat(64)});
    expect(st.live.orders).toHaveLength(expected.liveOrderCount);
    expect(st.demo.orders).toHaveLength(expected.demoOrderCount);
    await expect(page.locator('.event-title')).toContainText('Packet Pataka');
    await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');

    // Collections survive on the Dashboard exactly.
    await go(page, 'dashboard');
    const tile = label => page.locator('.dash-stat').filter({has: page.locator('small', {hasText: new RegExp(`^${label}`)})}).locator('strong');
    const rupees = p => `₹${(p / 100).toLocaleString('en-IN')}`;
    await expect(tile('Collected')).toHaveText(rupees(expected.collected));
    await expect(tile('Orders')).toHaveText(String(expected.orders));
    await expect(tile('Items sold')).toHaveText(String(expected.units));
    await expect(tile('Cash')).toHaveText(rupees(expected.methods.Cash));
    await expect(tile('UPI')).toHaveText(rupees(expected.methods.UPI));
    const r = await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      return d.report(core.store.state.live, core.C());
    });
    for (const k of ['collected', 'orders', 'units', 'games', 'gameIncome', 'discounts', 'refunds']) expect(r[k], k).toBe(expected[k]);
    expect(r.methods).toEqual(expected.methods);
    await noOverflow(page, 'migrated dashboard');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
