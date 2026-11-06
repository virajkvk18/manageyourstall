// Multi-stall kernel acceptance tests (kernel agent, ARCHITECTURE.md §17.1–17.2): a legacy single-stall device opens straight
// into its stall, a new device lands on #/welcome, Leave this stall, more stalls via the storage API, Your stalls routing,
// switching shows each stall's own data, deleting removes only that stall, and other tabs follow a switch.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {ready, addStall, stallsMeta, state, sheet} from './helpers.mjs';

const v1 = JSON.parse(readFileSync(new URL('../fixtures/v1-state.json', import.meta.url), 'utf8'));

/** @param {import('@playwright/test').Page} page */
const isPhone = page => (page.viewportSize()?.width || 1440) <= 767;

/** Seed the legacy v1 database ('state' store, key 'root') before the app ever loads on this origin. */
async function seedLegacy(page) {
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
}

const booted = page => page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});

/** Leave the open stall through the cashier (avatar) sheet. */
async function leaveViaSheet(page) {
  await page.locator('button.avatar').click();
  await expect(page.locator('#sheet .shell-sheet-stall')).toBeVisible();
  await page.locator('#sheet [data-action="leave-stall"]').click();
  await page.locator('#sheet[data-kind="confirm"] [data-action="core-confirm"]').click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.locator('.app-shell')).toHaveCount(0);
}

/** Record an order in the open stall through the kernel (same path as a checkout). */
const sell = (page, productId = 'lemon-fizz') => page.evaluate(async id => {
  const core = await import('/ui/core.mjs');
  const d = await import('/domain.mjs');
  await core.commit(st => d.createOrder(st.live, st.config, {id: d.uuid(), items: [d.makeLine(st.config, id)]}));
}, productId);

test.describe('many stalls on one device', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('a legacy single-stall device opens straight into its stall; Leave this stall → #/welcome', async ({page}) => {
    await seedLegacy(page);
    await page.goto('/');
    await booted(page);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('.event-title')).toContainText('Packet Pataka');
    await expect(page.locator('html')).toHaveAttribute('data-view', 'stall');
    const meta = await stallsMeta(page);
    expect(meta.activeStallId).toBe('root');
    expect(meta.stalls).toHaveLength(1);
    expect(meta.stalls[0]).toMatchObject({id: 'root', key: 'root', summary: {name: 'Packet Pataka', orders: 5, collected: 28000}});
    expect((await state(page)).live.orders).toHaveLength(5);

    await leaveViaSheet(page);
    await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');
    expect((await stallsMeta(page)).activeStallId).toBe(null);
    // A reload stays outside the stall; the sales are still on the device.
    await page.reload();
    await booted(page);
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.locator('.app-shell')).toHaveCount(0);
    const back = await page.evaluate(() => import('/storage.mjs').then(m => m.readStall('root')));
    expect(back.live.orders).toHaveLength(5);
    // Opening it again goes straight back to the counter with the same data.
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.openStallById('root')));
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page).not.toHaveURL(/#/);
    await expect(page.locator('.event-title')).toContainText('Packet Pataka');
  });

  test('a new device has no stall and lands on #/welcome', async ({page}) => {
    await ready(page, {stall: false});
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-page', 'welcome');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');
    expect(await page.evaluate(() => import('/ui/core.mjs').then(m => [m.hasStall(), m.currentPage(), m.store.state]))).toEqual([false, 'welcome', null]);
    expect(await stallsMeta(page)).toEqual({version: 1, activeStallId: null, stalls: []});
    // Nothing on the counter runs without a stall: keyboard shortcuts are harmless.
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('/');
    // Other routes render full-screen too, still without the shell.
    for (const name of ['stalls', 'setup', 'login', 'join']) {
      await page.evaluate(n => import('/ui/core.mjs').then(m => m.goPage(n)), name);
      await expect(page).toHaveURL(new RegExp(`#/${name}$`));
      await expect(page.locator('html')).toHaveAttribute('data-page', name);
      await expect(page.locator('.app-shell')).toHaveCount(0);
    }
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(0);
  });

  test('switching stalls shows each stall’s own data; Your stalls routes to the page', async ({page}) => {
    await ready(page);
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.commit(st => {
      st.config.profile.stallName = 'Chai Point';
    })));
    await sell(page);
    await sell(page);
    const first = await page.evaluate(() => import('/ui/core.mjs').then(m => m.store.stallId));

    const second = await addStall(page, {name: 'Momo Corner', templateId: 'momo-corner'});
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('.event-title')).toContainText('Momo Corner');
    await expect(page).toHaveTitle('Momo Corner · ManageYourStall');
    let st = await state(page);
    expect(st.config.profile.stallName).toBe('Momo Corner');
    expect(st.live.orders).toHaveLength(0);
    await expect(page.locator('#main')).toHaveClass(/screen-sell/);

    // Your stalls (sidebar on desktop, cashier sheet everywhere) → #/stalls, outside the shell.
    if (!isPhone(page) && (page.viewportSize()?.width || 0) >= 1024) await page.locator('.shell-stall-links [data-action="your-stalls"]').click();
    else {
      await page.locator('button.avatar').click();
      await sheet(page).locator('[data-action="your-stalls"]').click();
    }
    await expect(page).toHaveURL(/#\/stalls/);
    await expect(page.locator('html')).toHaveAttribute('data-page', 'stalls');
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');

    // Switch back: the first stall's sales and name come back; the PIN unlock never carries over.
    await page.evaluate(id => import('/ui/core.mjs').then(m => m.openStallById(id)), first);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.event-title')).toContainText('Chai Point');
    st = await state(page);
    expect(st.live.orders).toHaveLength(2);
    expect(await page.evaluate(() => import('/ui/core.mjs').then(m => m.isAdmin()))).toBe(false);

    const meta = await stallsMeta(page);
    expect(meta.activeStallId).toBe(first);
    const byId = Object.fromEntries(meta.stalls.map(e => [e.id, e.summary]));
    expect(byId[first]).toMatchObject({name: 'Chai Point', orders: 2});
    expect(byId[first].collected).toBeGreaterThan(0);
    expect(byId[second]).toMatchObject({name: 'Momo Corner', orders: 0, collected: 0, themeId: 'momo-corner'});

    // A sale in the second stall stays there.
    await page.evaluate(id => import('/ui/core.mjs').then(m => m.openStallById(id)), second);
    const momo = await page.evaluate(() => import('/ui/core.mjs').then(m => m.C().products.find(p => p.price && !p.bundle && p.active).id));
    await sell(page, momo);
    expect((await state(page)).live.orders).toHaveLength(1);
    expect((await page.evaluate(id => import('/storage.mjs').then(m => m.readStall(id)), first)).live.orders).toHaveLength(2);
  });

  test('deleting a stall removes only that stall', async ({page}) => {
    await ready(page);
    await sell(page);
    const first = await page.evaluate(() => import('/ui/core.mjs').then(m => m.store.stallId));
    const second = await addStall(page, {name: 'Delete Me', open: false});
    const third = await addStall(page, {name: 'Keep Me', open: false});
    expect((await stallsMeta(page)).stalls).toHaveLength(3);

    await page.evaluate(id => import('/storage.mjs').then(m => m.deleteStall(id)), second);
    let meta = await stallsMeta(page);
    expect(meta.stalls.map(e => e.id)).toEqual([first, third]);
    expect(meta.activeStallId).toBe(first);
    await expect(page.locator('.app-shell')).toBeVisible();
    expect((await state(page)).live.orders).toHaveLength(1);
    await expect(page.evaluate(id => import('/storage.mjs').then(m => m.readStall(id)), second)).rejects.toThrow(/on this phone/);

    // Deleting the open stall: leave first (as Your stalls does), then delete; the others stay.
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.leaveCurrentStall()));
    await expect(page).toHaveURL(/#\/welcome$/);
    await page.evaluate(id => import('/storage.mjs').then(m => m.deleteStall(id)), first);
    meta = await stallsMeta(page);
    expect(meta.stalls.map(e => e.summary.name)).toEqual(['Keep Me']);
    expect(meta.activeStallId).toBe(null);
    await page.reload();
    await booted(page);
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await page.evaluate(id => import('/ui/core.mjs').then(m => m.openStallById(id)), third);
    await expect(page.locator('.event-title')).toContainText('Keep Me');
  });

  test('another tab switching or leaving the stall is followed here', async ({page, context}) => {
    await ready(page);
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.commit(st => {
      st.config.profile.stallName = 'Tab Stall';
    })));
    const other = await context.newPage();
    await other.goto('/');
    await booted(other);
    await expect(other.locator('.event-title')).toContainText('Tab Stall');

    // The other tab opens a new stall: this tab follows (it shares the device's active stall).
    await addStall(other, {name: 'Elsewhere'});
    await expect(page.locator('.event-title')).toContainText('Elsewhere');
    await expect(page.locator('#toast')).toContainText('Another tab switched');
    expect((await state(page)).config.profile.stallName).toBe('Elsewhere');

    // A sale in the other tab shows up here.
    await sell(other);
    await expect.poll(async () => (await state(page)).live.orders.length).toBe(1);

    // The other tab leaves: this tab goes to the welcome page too.
    await other.evaluate(() => import('/ui/core.mjs').then(m => m.leaveCurrentStall()));
    await expect(page.locator('.app-shell')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.locator('#toast')).toContainText('closed in another tab');
    await other.close();
  });
});
