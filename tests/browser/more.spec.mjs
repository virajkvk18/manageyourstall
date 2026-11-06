// More hub, Game corner, money/collab/theme links, backups/exports/restore, resets and live/practice modes (more agent, §13.9, §16).
import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {act, sheet, ready, go, unlockAdmin, adminClick, noOverflow, state} from './helpers.mjs';

/** Create paid Cash orders in the current ledger through the kernel. @param {import('@playwright/test').Page} page */
const seedOrders = (page, ids = ['lemon-fizz']) =>
  page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      const s = st[st.mode];
      for (const id of list) d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, id)], method: 'Cash'});
    });
  }, ids);

/** A tiny valid PNG (1×1, pink) for bill-photo tests. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/**
 * Seed a partner, a bill (optionally with a photo saved to the media store) and a contri in the current ledger.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{memberId: string, billId: string, contriId: string, billImage: string|null}>}
 */
const seedMoney = (page, {photo = false} = {}) =>
  page.evaluate(async ([withPhoto, png]) => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    const cat = await import('/catalog.mjs');
    const billImage = withPhoto ? await core.saveImageDataUrl(png) : null;
    const memberId = await core.commitConfig(st => cat.addMember(st.config, {name: 'Aarav'}).id);
    const billId = crypto.randomUUID();
    const contriId = crypto.randomUUID();
    await core.commit(st => {
      const s = st[st.mode];
      d.addExpense(s, st.config, {id: billId, title: '20L water cans & ice', category: 'restock', amount: 45000, method: 'UPI', paidBy: memberId, billImage, notes: '2 cans + 1 ice slab'});
      d.addContribution(s, st.config, {id: contriId, memberId, amount: 200000, method: 'Cash', note: 'Seed money'});
    });
    return {memberId, billId, contriId, billImage};
  }, [photo, PNG]);

/** Live-ledger report numbers computed by the domain layer. @param {import('@playwright/test').Page} page */
const liveReport = page =>
  page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    const r = d.report(core.store.state.live, core.store.state.config);
    return {collected: r.collected, orders: r.orders, target: r.mission.target};
  });

/** Open the More hub and tap a tile by key. */
async function tile(page, key) {
  await go(page, 'more');
  return page.locator(`.more-tile[data-tile="${key}"]`);
}

const openSheet = page => page.locator('#sheet[open]');

test.describe('More hub, games & data', () => {
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

  test('hub tiles render with live status and no overflow', async ({page}) => {
    await go(page, 'more');
    const tiles = page.locator('.more-tile');
    await expect(tiles).toHaveCount(17);
    for (const title of ['Customize My Stall', 'Stall Studio', 'Menu manager', 'Price board', 'Game corner', 'Stock room',
      'Expenses & Team Contri', 'Quick restock bill', 'Stall’s Collab', 'Day report', 'Backup & exports', 'Practice counter',
      'Event setup', 'Admin PIN', 'Install app', 'Keep data safe', 'Danger zone']) {
      await expect(page.locator('.more-tile-title', {hasText: title}).first()).toBeVisible();
    }
    // Phase 2 tiles point at the right places; the old Expenses sheet tile is gone.
    await expect(page.locator('[data-tile="expenses"]')).toHaveCount(0);
    await expect(page.locator('[data-tile="money"]')).toHaveAttribute('data-action', 'money-open');
    await expect(page.locator('[data-tile="restock"]')).toHaveAttribute('data-action', 'money-restock');
    await expect(page.locator('[data-tile="themes"]')).toHaveAttribute('data-section', 'themes');
    const collab = page.locator('[data-tile="collab"]');
    await expect(collab).toHaveAttribute('data-screen', 'collab');
    const soon = collab.locator('sup.more-soon');
    await expect(soon).toHaveText('COMING SOON');
    await expect(soon).toBeVisible();
    // The pill sits inside its tile (no overlap with the arrow / tile edge).
    const [tileBox, soonBox] = [await collab.boundingBox(), await soon.boundingBox()];
    expect(soonBox.x + soonBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width);
    expect(soonBox.y).toBeGreaterThanOrEqual(tileBox.y);
    await expect(page.locator('.more-device')).toContainText('One phone. One ledger.');
    await expect(page.locator('.more-device')).toContainText('No backup downloaded');
    await expect(page.locator('[data-tile="prices"]')).toContainText(/All \d+ items priced/);
    await noOverflow(page, 'more hub');

    await page.locator('[data-tile="install"]').click();
    await expect(openSheet(page)).toContainText('Add to Home Screen');
    await noOverflow(page, 'install sheet');
    await act(page, 'close').click();

    await page.locator('[data-tile="pin"]').click();
    await expect(openSheet(page)).toContainText('No remote recovery');
    await sheet(page).locator('#more-pin-new').fill('2468');
    await sheet(page).locator('#more-pin-repeat').fill('1357');
    await act(page, 'more-pin-save').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('don’t match');
    await sheet(page).locator('#more-pin-repeat').fill('2468');
    await act(page, 'more-pin-save').click();
    await expect(openSheet(page)).toHaveCount(0);
    expect((await state(page)).pin).not.toBeNull();
  });

  test('practice counter toggles the demo bar and never touches live orders', async ({page}) => {
    await seedOrders(page, ['lemon-fizz', 'cola']);
    await (await tile(page, 'mode')).click();
    await expect(page.locator('.demo-bar')).toBeVisible();
    await expect(page.locator('#main.screen-sell')).toBeVisible();
    let st = await state(page);
    expect(st.mode).toBe('demo');
    expect(st.live.orders).toHaveLength(2);
    expect(st.demo.orders).toHaveLength(0);

    await seedOrders(page, ['cola']);
    await go(page, 'more');
    await expect(page.locator('[data-tile="mode"]')).toContainText('Back to live');
    await noOverflow(page, 'more in practice');
    await page.locator('.demo-bar [data-action="more-live"]').click();
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    st = await state(page);
    expect(st.mode).toBe('live');
    expect(st.live.orders).toHaveLength(2);
    expect(st.demo.orders).toHaveLength(1);
  });

  test('game corner records paid (UPI) and free plays, and reverses with the PIN', async ({page}) => {
    const gameId = await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      return core.commitConfig(st => cat.saveGame(st.config, {name: 'Ring Toss Mega Dhamaka Challenge Round', fee: 2000, art: 'ring-toss'}).id);
    });
    await (await tile(page, 'games')).click();
    await expect(page.locator('#main.screen-games')).toBeVisible();
    await expect(page.locator('.games-card')).toHaveCount(2);
    await noOverflow(page, 'games');
    // Regression: cards in one row keep their "Record play" buttons on the same baseline, whatever the name length.
    const cardTops = await page.locator('.games-card').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    if (cardTops[0] === cardTops[1]) {
      const bottoms = await page.locator('.games-card [data-action="games-record"]').evaluateAll(els => els.map(e => e.getBoundingClientRect().bottom));
      expect(Math.abs(bottoms[0] - bottoms[1])).toBeLessThan(2);
    }

    // Paid play: UPI needs the receipt confirmation.
    await act(page, 'games-record', `[data-id="${gameId}"]`).click();
    await sheet(page).locator('[data-method="UPI"]').click();
    await expect(sheet(page).locator('[data-games-confirm]')).toContainText('UPI');
    await sheet(page).locator('#games-prize').fill('Keychain');
    await noOverflow(page, 'record sheet');
    await act(page, 'games-save').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('Tick the box');
    await sheet(page).locator('[name="games-paid"]').check();
    await act(page, 'games-save').click();
    await expect(openSheet(page)).toHaveCount(0);

    // Free play: nothing to collect.
    await act(page, 'games-record', '[data-id="spin-the-wheel"]').click();
    await expect(openSheet(page)).toContainText('Free game');
    await act(page, 'games-save').click();
    await expect(openSheet(page)).toHaveCount(0);

    let st = await state(page);
    expect(st.live.games).toHaveLength(2);
    const paid = st.live.games.find(g => g.gameId === gameId);
    expect(paid).toMatchObject({method: 'UPI', fee: 2000, prize: 'Keychain', void: false});
    expect(st.live.payments).toEqual([expect.objectContaining({entityId: paid.id, amount: 2000, method: 'UPI', kind: 'game'})]);
    await expect(page.locator('.games-play')).toHaveCount(2);

    // Reverse the paid play (admin + reason + confirmation).
    await adminClick(page, act(page, 'games-reverse', `[data-id="${paid.id}"]`));
    await sheet(page).locator('#games-reason').fill('Wrong game tapped');
    await act(page, 'core-confirm').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('Tick the box');
    await sheet(page).locator('[name="games-refunded"]').check();
    await act(page, 'core-confirm').click();
    await expect(openSheet(page)).toHaveCount(0);
    st = await state(page);
    expect(st.live.games.find(g => g.id === paid.id).void).toBe(true);
    expect(st.live.payments.reduce((n, p) => n + p.amount, 0)).toBe(0);
    await expect(page.locator('.games-play.is-void')).toHaveCount(1);
  });

  test('game corner empty state links to Studio games', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.deleteGame(st.config, 'spin-the-wheel'));
    });
    await go(page, 'more');
    await page.locator('[data-tile="games"]').click();
    await expect(page.locator('#main .empty-state [data-action="studio-open"][data-section="games"]')).toBeVisible();
  });

  test('money tiles open the money screen, restock, collab and themes', async ({page}) => {
    await (await tile(page, 'money')).click();
    await expect(page.locator('#main.screen-money')).toBeVisible();
    // The Phase-1 action names survive as aliases for the money screen (no PIN needed any more).
    await go(page, 'more');
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.runAction('more-expenses')));
    await expect(page.locator('#main.screen-money')).toBeVisible();
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);

    await (await tile(page, 'collab')).click();
    await expect(page.locator('#main.screen-collab')).toBeVisible();

    await (await tile(page, 'themes')).click();
    await expect(page.locator('#main.screen-studio')).toBeVisible();

    // Bills & contri show up in the hub status line (totals from the domain layer).
    await seedMoney(page);
    await go(page, 'more');
    await expect(page.locator('[data-tile="money"]')).toContainText('₹450 in 1 bill');
    await expect(page.locator('[data-tile="money"]')).toContainText('₹2,000 contri');
    await expect(page.locator('[data-tile="restock"]')).toContainText('₹450 restocked so far');
    await noOverflow(page, 'hub with money');
  });

  test('CSV exports download with the right names and headers', async ({page}) => {
    await seedOrders(page, ['lemon-fizz', 'veggie-chips-chaat-small']);
    await seedMoney(page);
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    await expect(openSheet(page)).toContainText('Itemized rows repeat order totals');
    const counts = sheet(page).locator('[data-backup-counts]');
    await expect(counts).toContainText('1Bill');
    await expect(counts).toContainText('1Team contri');
    await noOverflow(page, 'backups sheet');
    const cases = [
      ['orders', /^mys-orders-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Order","Token","Time (IST)"'],
      ['summary', /^mys-order-summary-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Order","Token","Token day"'],
      ['payments', /^mys-payments-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Payment ID","Time (IST)","Kind"'],
      ['expenses', /^mys-expenses-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Time (IST)","Title","Category","Amount"'],
      ['contributions', /^mys-contributions-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Time (IST)","Partner","Amount"'],
      ['settlement', /^mys-settlement-my-awesome-stall-\d{4}-\d{2}-\d{2}\.csv$/, '"Partner","Profit share %"'],
    ];
    for (const [kind, name, header] of cases) {
      const [dl] = await Promise.all([page.waitForEvent('download'), act(page, 'data-export', `[data-kind="${kind}"]`).click()]);
      expect(dl.suggestedFilename()).toMatch(name);
      const text = readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
      const lines = text.split('\r\n');
      expect(lines[0].startsWith(header)).toBeTruthy();
      expect(lines.length).toBeGreaterThan(1);
      if (kind === 'expenses') expect(lines[1]).toContain('20L water cans & ice');
      if (kind === 'contributions') expect(lines[1]).toContain('Aarav');
      if (kind === 'settlement') expect(lines[1]).toContain('Aarav');
    }
  });

  test('JSON backup restores on a fresh device; tampered files are rejected', async ({page, browser}, testInfo) => {
    await seedOrders(page, ['lemon-fizz', 'cola', 'veggie-chips-chaat-small']);
    const money = await seedMoney(page, {photo: true});
    expect(money.billImage).toMatch(/^media:/);
    const source = await liveReport(page);
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), act(page, 'data-export', '[data-kind="json"]').click()]);
    expect(dl.suggestedFilename()).toMatch(/^mys-backup-my-awesome-stall-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath('backup.json');
    await dl.saveAs(file);
    await expect(sheet(page).locator('[data-backup-hint]')).toContainText('Last backup');

    const use = testInfo.project.use;
    const ctx = await browser.newContext({baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, serviceWorkers: 'block'});
    const fresh = await ctx.newPage();
    fresh.on('pageerror', e => errors.push(e.message));
    try {
      await ready(fresh);
      expect((await state(fresh)).live.orders).toHaveLength(0);
      await go(fresh, 'more');
      await fresh.locator('[data-tile="backups"]').click();

      // A tampered backup (order total no longer matches its payments) is refused with a friendly message.
      const tampered = JSON.parse(readFileSync(file, 'utf8'));
      tampered.state.live.orders[0].total += 500;
      const bad = testInfo.outputPath('tampered.json');
      writeFileSync(bad, JSON.stringify(tampered));
      await fresh.setInputFiles('#data-restore-file', bad);
      await expect(sheet(fresh).locator('[data-error]')).toContainText('Backup rejected');
      await expect(sheet(fresh).locator('[data-restore-summary]')).toBeHidden();
      await fresh.setInputFiles('#data-restore-file', {name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json at all')});
      await expect(sheet(fresh).locator('[data-error]')).toContainText('isn’t a ManageYourStall backup');

      // The real one shows a summary, then restores after the PIN + confirmation.
      await fresh.setInputFiles('#data-restore-file', file);
      const summary = sheet(fresh).locator('[data-restore-summary]');
      await expect(summary).toContainText('My Awesome Stall');
      await expect(summary).toContainText('Live orders');
      await expect(summary.locator('[data-backup-counts]')).toContainText('1Bill');
      await expect(summary.locator('[data-backup-counts]')).toContainText('1Team contri');
      await expect(summary.locator('[data-backup-counts]')).toContainText('1Photo');
      await expect(summary).toContainText('1 bill photo included');
      await noOverflow(fresh, 'restore summary');
      const revBefore = (await state(fresh)).revision;
      await adminClick(fresh, act(fresh, 'data-restore'));
      await expect(openSheet(fresh)).toContainText('Replace this device’s stall?');
      await act(fresh, 'core-confirm').click();
      await expect(openSheet(fresh)).toHaveCount(0);
      const restored = await liveReport(fresh);
      expect(restored.orders).toBe(source.orders);
      expect(restored.collected).toBe(source.collected);
      expect((await state(fresh)).live.orders).toHaveLength(3);
      // Regression: a restore never moves the revision backwards.
      expect((await state(fresh)).revision).toBeGreaterThan(revBefore);
      // Bills (with their photo) and team contri come back intact; the photo is in the media store and resolves to a URL.
      const back = await state(fresh);
      expect(back.live.expenses).toEqual([expect.objectContaining({id: money.billId, title: '20L water cans & ice', amount: 45000, billImage: money.billImage})]);
      expect(back.live.contributions).toEqual([expect.objectContaining({id: money.contriId, memberId: money.memberId, amount: 200000})]);
      expect(back.config.team.members.map(m => m.name)).toEqual(['Aarav']);
      const photo = await fresh.evaluate(async ref => {
        const core = await import('/ui/core.mjs');
        const storage = await import('/storage.mjs');
        const media = await storage.getAllMedia();
        return {stored: typeof media[ref.slice('media:'.length)] === 'string', url: core.mediaUrl(ref)};
      }, money.billImage);
      expect(photo.stored).toBe(true);
      expect(photo.url).toMatch(/^blob:|^data:/);
    } finally {
      await ctx.close();
    }
  });

  test('a backup bigger than 40 MB (photos in base64) is still read, not refused by size', async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one 41 MB upload is enough');
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    await expect(sheet(page).locator('.data-file')).toContainText('up to 64 MB');
    const big = Buffer.alloc(41 * 1024 * 1024, 0x20);
    big.write('{}', 0);
    await page.setInputFiles('#data-restore-file', {name: 'big.json', mimeType: 'application/json', buffer: big});
    const err = sheet(page).locator('[data-error]');
    await expect(err).toBeVisible();
    await expect(err).not.toContainText('bigger than');
  });

  test('reset orders needs the exact phrase and keeps the menu', async ({page}) => {
    await seedOrders(page, ['lemon-fizz', 'cola']);
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.commit(st => {
      st.live.started = true;
    })));
    const before = await state(page);
    await go(page, 'more');
    await page.locator('[data-tile="danger"]').click();
    await expect(openSheet(page)).toContainText('No undo here');
    await noOverflow(page, 'danger sheet');
    await adminClick(page, act(page, 'data-reset-orders'));
    await expect(openSheet(page)).toContainText('RESET ORDERS');
    await expect(openSheet(page)).toContainText('team contri');
    await expect(openSheet(page)).toContainText('Reset sales only');
    await expect(sheet(page).locator('[data-action="data-export"][data-kind="json"]')).toBeVisible();
    await sheet(page).locator('#confirm-typed').fill('reset orders');
    await act(page, 'core-confirm').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('Type RESET ORDERS exactly');
    expect((await state(page)).live.orders).toHaveLength(2);
    await sheet(page).locator('#confirm-typed').fill('RESET ORDERS');
    await act(page, 'core-confirm').click();
    await expect(openSheet(page)).toHaveCount(0);
    const after = await state(page);
    expect(after.live.orders).toHaveLength(0);
    expect(after.live.payments).toHaveLength(0);
    expect(after.config.products).toEqual(before.config.products);
    expect(after.config.profile).toEqual(before.config.profile);
    expect(after.pin).not.toBeNull();
    expect(after.live.audit.map(a => a.type)).toContain('orders-reset');
    // Regression: "keep menu & setup" — a started event stays started; milestones are re-evaluated for the empty ledger.
    expect(after.live.started).toBe(true);
    expect(Object.keys(after.live.milestones).length).toBe(after.config.milestones.length);
    expect(Object.values(after.live.milestones).every(m => !m.active)).toBeTruthy();
  });

  test('reset sales only clears orders but keeps bills, contri & audit', async ({page}) => {
    await seedOrders(page, ['lemon-fizz', 'cola']);
    const seeded = await seedMoney(page, {photo: true});
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.commit(st => {
      st.live.started = true;
    })));
    const before = await state(page);
    expect(before.live.orders).toHaveLength(2);
    await go(page, 'more');
    await page.locator('[data-tile="danger"]').click();
    await expect(openSheet(page)).toContainText('Reset sales only');
    await expect(sheet(page).locator('.data-keep')).toBeVisible();
    await noOverflow(page, 'danger sheet with sales reset');
    await adminClick(page, act(page, 'data-reset-sales'));
    await expect(openSheet(page)).toContainText('RESET SALES');
    await expect(openSheet(page)).toContainText('Kept:');
    await sheet(page).locator('#confirm-typed').fill('RESET ORDERS');
    await act(page, 'core-confirm').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('RESET SALES');
    expect((await state(page)).live.orders).toHaveLength(2);
    await sheet(page).locator('#confirm-typed').fill('RESET SALES');
    await act(page, 'core-confirm').click();
    await expect(openSheet(page)).toHaveCount(0);
    const after = await state(page);
    expect(after.live.orders).toHaveLength(0);
    expect(after.live.payments).toHaveLength(0);
    expect(after.live.games).toHaveLength(0);
    expect(after.live.draft).toHaveLength(0);
    expect(after.live.tokenSeq).toBe(0);
    expect(after.live.started).toBe(true);
    expect(after.live.expenses).toEqual(before.live.expenses);
    expect(after.live.expenses[0].billImage).toBe(seeded.billImage);
    expect(after.live.contributions).toEqual(before.live.contributions);
    expect(after.live.settlements).toEqual(before.live.settlements);
    // The audit trail is kept and gains the reset entry.
    const kept = after.live.audit.map(a => a.id);
    expect(before.live.audit.every(a => kept.includes(a.id))).toBeTruthy();
    expect(after.live.audit.length).toBeGreaterThan(before.live.audit.length);
    expect(after.live.audit.map(a => a.type)).toContain('sales-reset');
    expect(after.live.audit.map(a => a.type)).toContain('order-created');
    expect(after.config.products).toEqual(before.config.products);
    // Break-even still counts the kept bill.
    const r = await liveReport(page);
    expect(r.collected).toBe(0);
    expect(r.target).toBeGreaterThanOrEqual(45000);
  });

  test('reset today’s orders wipes bills & contri of the current mode too', async ({page}) => {
    await seedOrders(page, ['lemon-fizz']);
    await seedMoney(page);
    await go(page, 'more');
    await page.locator('[data-tile="danger"]').click();
    await adminClick(page, act(page, 'data-reset-orders'));
    await sheet(page).locator('#confirm-typed').fill('RESET ORDERS');
    await act(page, 'core-confirm').click();
    await expect(openSheet(page)).toHaveCount(0);
    const after = await state(page);
    expect(after.live.orders).toHaveLength(0);
    expect(after.live.expenses).toHaveLength(0);
    expect(after.live.contributions).toHaveLength(0);
    expect(after.config.team.members).toHaveLength(1);
  });

  test('factory reset wipes the stall and reopens onboarding', async ({page}) => {
    await seedOrders(page, ['lemon-fizz']);
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => {
        st.onboarded = true;
        cat.saveProfile(st.config, {stallName: 'Chaat Corner'});
      });
    });
    const revBefore = (await state(page)).revision;
    await go(page, 'more');
    await page.locator('[data-tile="danger"]').click();
    await adminClick(page, act(page, 'data-factory'));
    await sheet(page).locator('#confirm-typed').fill('FACTORY RESET');
    await act(page, 'core-confirm').click();
    await expect(page.locator('#main.screen-sell')).toBeVisible();
    const st = await state(page);
    expect(st.onboarded).toBe(false);
    expect(st.pin).toBeNull();
    expect(st.live.orders).toHaveLength(0);
    expect(st.config.profile.stallName).toBe('My Awesome Stall');
    // Regression: the wiped state does not restart at revision 0.
    expect(st.revision).toBeGreaterThan(revBefore);
    // When the onboarding module is in place, its flow opens right away.
    if (await page.locator('#sheet[open] [data-action="onb-skip"]').count()) await expect(openSheet(page)).toBeVisible();
  });

  test('start live event is blocked while a visible item has no price', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.setPrices(st.config, {cola: null}));
    });
    await go(page, 'more');
    await expect(page.locator('[data-tile="event"]')).toContainText('1 item still needs a price');
    await page.locator('[data-tile="event"]').click();
    await expect(openSheet(page)).toContainText('Pre-flight checklist');
    await expect(sheet(page).locator('[data-action="menu-quick-price"][data-id="cola"]')).toBeVisible();
    await expect(sheet(page).locator('[data-action="more-start-live"]')).toBeDisabled();
    await noOverflow(page, 'event sheet');
    expect((await state(page)).live.started).toBe(false);
    await act(page, 'close').click();

    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.setPrices(st.config, {cola: 3000}));
    });
    await page.locator('[data-tile="event"]').click();
    await expect(sheet(page).locator('[data-action="more-start-live"]')).toBeEnabled();
    await adminClick(page, act(page, 'more-start-live'));
    await expect(page.locator('#main.screen-sell')).toBeVisible();
    const st = await state(page);
    expect(st.live.started).toBe(true);
    expect(st.mode).toBe('live');
    expect(st.live.audit.map(a => a.type)).toContain('event-started');
  });

  test('admin lock from the PIN sheet', async ({page}) => {
    await go(page, 'more');
    await page.locator('[data-tile="pin"]').click();
    await sheet(page).locator('#more-pin-new').fill('1234');
    await sheet(page).locator('#more-pin-repeat').fill('1234');
    await act(page, 'more-pin-save').click();
    await expect(openSheet(page)).toHaveCount(0);
    await page.locator('[data-tile="pin"]').click();
    await act(page, 'more-lock').click();
    await expect(page.locator('[data-tile="pin"]')).toContainText('PIN set · locked');
    await act(page, 'close').click();
    await page.locator('[data-tile="danger"]').click();
    await act(page, 'data-reset-orders').click();
    await unlockAdmin(page);
    await expect(openSheet(page)).toContainText('RESET ORDERS');
  });
});
