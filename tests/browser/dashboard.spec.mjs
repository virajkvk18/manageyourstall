// Dashboard, day report & milestones (owner: dashboard agent) — ARCHITECTURE.md §13.4–13.5 + Phase 2 §16.3 / §16.7.
import {test, expect} from '@playwright/test';
import {act, sheet, ready, go, adminClick, noOverflow, state} from './helpers.mjs';

/**
 * Record orders straight through the ledger (other screens may still be stubs).
 * @param {import('@playwright/test').Page} page
 * @param {Array<{items: Array<[string, number]>, method?: string, pending?: boolean}>} orders
 */
async function seedOrders(page, orders) {
  await page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      const s = st[st.mode];
      for (const o of list) {
        const items = o.items.map(([id, quantity]) => d.makeLine(st.config, id, {quantity}));
        d.createOrder(s, st.config, {id: crypto.randomUUID(), items, method: o.method || 'Cash', pending: !!o.pending});
      }
    });
  }, orders);
}

/**
 * Log bills straight through the domain (§16.3 addExpense). Amounts in paise.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{title: string, category: string, amount: number, method?: string, paidBy?: string}>} bills
 */
async function seedBills(page, bills) {
  await page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      const s = st[st.mode];
      for (const b of list) d.addExpense(s, st.config, {id: crypto.randomUUID(), ...b});
    });
  }, bills);
}

/** The whole-session report, computed by the domain inside the page. @param {import('@playwright/test').Page} page */
const pageReport = page => page.evaluate(async () => {
  const core = await import('/ui/core.mjs');
  const d = await import('/domain.mjs');
  return d.report(core.S(), core.C());
});

/** @param {import('@playwright/test').Page} page */
async function openDashboard(page) {
  await ready(page);
  await go(page, 'dashboard');
}

/** Something visibly answered a click: a sheet opened, a toast showed, or the screen changed. */
async function reacted(page, screenBefore = 'dashboard') {
  await expect.poll(async () => {
    const sheetOpen = await page.locator('#sheet[open]').count();
    const toast = await page.locator('#toast.show').count();
    const moved = await page.locator(`#main.screen-${screenBefore}`).count() === 0 ? 1 : 0;
    return sheetOpen + toast + moved;
  }).toBeGreaterThan(0);
}

test.describe('dashboard', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('fresh stall (ledger, no bills) asks for the first bill', async ({page}) => {
    await openDashboard(page);
    const st = await state(page);
    expect(st.config.mission.mode).toBe('ledger');
    const hero = page.locator('.dash-hero.is-unset');
    await expect(hero).toContainText('BREAK-EVEN = YOUR BILLS');
    await expect(hero).toContainText('₹0');
    await expect(hero).toContainText('collected so far');
    const first = hero.locator('[data-action="money-add-bill"]');
    await expect(first).toBeVisible();
    await expect(first).toContainText('Log your first bill');
    const total = hero.locator('[data-action="studio-open"][data-section="mission"]');
    await expect(total).toBeVisible();
    await expect(total).toContainText('or set one total');
    await expect(hero.locator('[data-action="money-restock"]')).toBeVisible();
    await expect(page.locator('.dash-bills')).toContainText('No bills yet');
    await expect(page.locator('.dash-team [data-action="studio-open"][data-section="team"]')).toBeVisible();
    await expect(page.locator('.dash-panel').filter({hasText: 'Bestsellers'})).toContainText('first sale');
    await expect(page.locator('.dash-panel').filter({hasText: 'Hourly collections'})).toContainText('No collections recorded yet');
    await expect(page.locator('.dash-honest')).toContainText('not accounting advice');
    await expect(page.locator('.dash-honest .dash-verdict')).toContainText('Log a bill');
    await noOverflow(page, 'fresh dashboard');
  });

  test('bills set the break-even: target = Σ bills, remaining and net profit follow', async ({page}) => {
    await openDashboard(page);
    await seedBills(page, [
      {title: 'Stall rent', category: 'rent', amount: 150000},
      {title: 'Raw material', category: 'pre-stall', amount: 100000, method: 'UPI'},
      {title: 'Extra cheese & buns', category: 'restock', amount: 50000},
    ]);
    const hero = page.locator('.dash-hero');
    await expect(hero).toContainText('THE ₹3,000 MISSION');
    await expect(hero).toContainText('0% recovered');
    await expect(hero).toContainText('₹3,000 to break even');
    const bd = hero.locator('.dash-breakdown');
    await expect(bd).toContainText('Break-even = all bills');
    await expect(bd).toContainText('Stall Rent / Registration');
    await expect(bd).toContainText('₹1,500');
    await expect(bd).toContainText('Pre-Stall Setup');
    await expect(bd.locator('.dash-breakdown-restock')).toContainText('₹500');
    await expect(bd.locator('.dash-breakdown-total')).toContainText('₹3,000');
    await expect(bd.locator('[data-action="money-open"][data-tab="bills"]')).toContainText('3 bills logged');
    await expect(hero.locator('.dash-net')).toContainText('−₹3,000');

    await seedOrders(page, [{items: [['lemon-fizz', 2]], method: 'Cash'}]);
    const r = await pageReport(page);
    expect(r.mission).toMatchObject({mode: 'ledger', target: 300000, bills: 300000, restock: 50000, collected: 6000, remaining: 294000, profit: -294000});
    await expect(hero).toContainText('₹2,940 to break even');
    await expect(hero).toContainText('2% recovered');
    await expect(hero.locator('.dash-net.is-down')).toContainText('−₹2,940');
    await expect(page.locator('.dash-honest .dash-verdict.is-down')).toContainText('−₹2,940');

    // Bills panel: category bars + latest bills newest first, each opening the Bills tab.
    const panel = page.locator('.dash-bills');
    await expect(panel.locator('.dash-bills-sum')).toContainText('₹3,000');
    await expect(panel.locator('.dash-bar')).toHaveCount(3);
    await expect(panel.locator('.dash-bar').first()).toContainText('Stall Rent');
    const rows = panel.locator('.dash-bill');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-action', 'money-open');
    await expect(rows.first()).toHaveAttribute('data-tab', 'bills');
    await noOverflow(page, 'dashboard with bills');

    // A void bill drops out of every total.
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.voidExpense(s, st.config, s.expenses[0].id, 'typo');
      });
    });
    await expect(hero).toContainText('THE ₹1,500 MISSION');
    await expect(rows).toHaveCount(2);
  });

  test('only the last 5 bills are listed', async ({page}) => {
    await openDashboard(page);
    await seedBills(page, Array.from({length: 7}, (_, i) => ({title: `Bill ${i + 1}`, category: 'misc', amount: 1000 * (i + 1)})));
    await expect(page.locator('.dash-bills .dash-bill')).toHaveCount(5);
    await expect(page.locator('.dash-bills .dash-bills-sum')).toContainText('7 bills');
  });

  test('restock and add-bill buttons dispatch the money actions', async ({page}) => {
    await openDashboard(page);
    await seedBills(page, [{title: 'Stall rent', category: 'rent', amount: 100000}]);
    const restock = act(page, 'money-restock');
    await expect(restock).toBeVisible();
    await expect(restock).toContainText('Quick mid-stall restock');
    // On phones it sits inside the first screenful.
    const box = await restock.boundingBox();
    expect(box && box.y + box.height).toBeLessThan((page.viewportSize()?.height ?? 900) * 1.35);
    await restock.click();
    await reacted(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await act(page, 'money-add-bill').click();
    await reacted(page);
  });

  test('orders update numbers, bestsellers, recent orders and hourly', async ({page}) => {
    await openDashboard(page);
    await seedOrders(page, [
      {items: [['lemon-fizz', 2]], method: 'Cash'},
      {items: [['cola', 1], ['lemon-fizz', 1]], method: 'UPI'},
      {items: [['veggie-chips-chaat-small', 1]], pending: true},
    ]);
    const stats = page.locator('.dash-stats');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Collected'})).toContainText('₹120');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Orders'})).toContainText('2');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Items sold'})).toContainText('4');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Avg order'})).toContainText('₹60');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Cash'})).toContainText('₹60');
    await expect(stats.locator('.dash-stat').filter({hasText: 'UPI'})).toContainText('₹60');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Games played'})).toContainText('0');
    await expect(stats.locator('.dash-stat').filter({hasText: 'Pending'})).toContainText('₹40 unpaid');

    const best = page.locator('.dash-best-row');
    await expect(best).toHaveCount(2);
    await expect(best.first()).toContainText('Lemon Fizz');
    await expect(best.first()).toContainText('3');
    await expect(best.first()).toContainText('₹90');

    const recent = page.locator('.dash-orders [data-action="ord-receipt"]');
    await expect(recent).toHaveCount(3);
    const st = await state(page);
    await expect(recent.first()).toHaveAttribute('data-id', st.live.orders[2].id);
    await expect(recent.first()).toContainText('UNPAID');

    await expect(page.locator('.dash-hero.is-unset')).toContainText('₹120');
    await expect(page.locator('.dash-hour')).toHaveCount(1);
    await expect(page.locator('.dash-peak')).toContainText('Rush hour');
    await expect(page.locator('.dash-panel').filter({hasText: 'Menu mix'})).toContainText('Fizz');
    await noOverflow(page, 'dashboard with sales');
  });

  test('PROFIT MODE in ledger mode: net profit = revenue − all bills', async ({page}) => {
    await openDashboard(page);
    await seedBills(page, [{title: 'Plates', category: 'packaging', amount: 5000}]);
    await expect(page.locator('.dash-hero')).toContainText('THE ₹50 MISSION');
    await seedOrders(page, [{items: [['lemon-fizz', 2]]}]);
    const hero = page.locator('.dash-hero.is-profit');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('PROFIT MODE');
    await expect(hero.locator('.dash-profit')).toContainText('₹10');
    await expect(hero.locator('.dash-profit')).toContainText('PROFIT');
    await expect(hero.locator('.dash-confetti i').first()).toBeAttached();
    await expect(hero.locator('.dash-breakdown')).toContainText('Packaging & Plates');
    await expect(hero.locator('[data-action="money-restock"]')).toBeVisible();
    await expect(page.locator('.dash-verdict.is-up')).toContainText('Net profit');
    await expect(page.locator('.dash-verdict.is-up')).toContainText('+₹10');
    await noOverflow(page, 'profit mode');

    // A dark theme accent must not swallow the strip's Dashboard button on Milestones.
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.saveTheme(st.config, {accent: '#1E3A8A'}));
    });
    await go(page, 'milestones');
    const link = page.locator('.dash-strip.is-profit .dash-strip-link');
    await expect(link).toBeVisible();
    const colors = await link.evaluate(el => ({bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color}));
    expect(colors.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors.bg).not.toBe(colors.fg);
  });

  test('planned mission (total) = planned + bills', async ({page}) => {
    await openDashboard(page);
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.saveMission(st.config, {mode: 'total', total: 5000}));
    });
    await expect(page.locator('.dash-hero')).toContainText('THE ₹50 MISSION');
    await seedBills(page, [{title: 'Ice', category: 'restock', amount: 2000}]);
    const hero = page.locator('.dash-hero');
    await expect(hero).toContainText('THE ₹70 MISSION');
    await expect(hero.locator('.dash-breakdown')).toContainText('Break-even = plan + bills');
    await expect(hero.locator('.dash-breakdown')).toContainText('Planned investment');
    await expect(hero.locator('.dash-breakdown')).toContainText('Bills logged');
    await expect(hero.locator('.dash-breakdown-total')).toContainText('₹70');
    await seedOrders(page, [{items: [['lemon-fizz', 3]]}]);
    await expect(page.locator('.dash-hero.is-profit .dash-profit')).toContainText('₹20');
    await expect(page.locator('.dash-verdict.is-up')).toContainText('+₹20');
  });

  test('team payout preview shows each partner’s take-home', async ({page}) => {
    await openDashboard(page);
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => {
        cat.addMember(st.config, {name: 'Viraj', color: 'pink'});
        cat.addMember(st.config, {name: 'Anaya Sharma', color: 'sky'});
      });
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        const [a, b] = st.config.team.members;
        d.addContribution(s, st.config, {id: crypto.randomUUID(), memberId: a.id, amount: 100000});
        d.addContribution(s, st.config, {id: crypto.randomUUID(), memberId: b.id, amount: 50000});
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'Rent', category: 'rent', amount: 120000, paidBy: 'drawer'});
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'Cheese', category: 'restock', amount: 20000, paidBy: b.id});
        for (let i = 0; i < 6; i++) {
          d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'combo-triple-dhamaka')], method: 'UPI'});
        }
      });
    });
    const expected = await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      return d.teamSettlement(core.S(), core.C());
    });
    const fmt = (/** @type {number} */ p) => page.evaluate(n => import('/util.mjs').then(u => u.money(n)), p);
    const panel = page.locator('.dash-team');
    const cards = panel.locator('.dash-member');
    await expect(cards).toHaveCount(2);
    for (const [i, m] of expected.members.entries()) {
      await expect(cards.nth(i)).toContainText(m.name);
      await expect(cards.nth(i).locator('.dash-member-pay strong')).toHaveText(await fmt(m.payout));
    }
    expect(expected.members.reduce((n, m) => n + m.payout, 0)).toBe(Math.max(expected.totals.pot, 0));
    await expect(panel.locator('.dash-team-totals')).toContainText(await fmt(Math.max(expected.totals.pot, 0)));
    await expect(cards.nth(1).locator('.dash-avatar')).toHaveText('AS');
    const go2 = panel.locator('[data-action="money-open"][data-tab="settle"]');
    await expect(go2).toContainText('See full settlement');
    await noOverflow(page, 'team preview');
    await go2.click();
    await expect(page.locator('#main.screen-money')).toBeVisible();
  });

  test('day report sheet: scope switch, copy and WhatsApp link', async ({page, context, browserName}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      const clip = navigator.clipboard;
      if (!clip?.writeText) return;
      const real = clip.writeText.bind(clip);
      clip.writeText = text => {
        /** @type {any} */ (window).__mysCopied = text;
        return real(text);
      };
    });
    await openDashboard(page);
    await seedOrders(page, [{items: [['lemon-fizz', 1]]}]);
    await seedBills(page, [{title: 'Ice', category: 'restock', amount: 2000}]);
    await act(page, 'dash-report').click();
    const dlg = sheet(page);
    await expect(dlg).toBeVisible();
    const bubble = dlg.locator('[data-report-text]');
    await expect(bubble).toContainText('Day report');
    await expect(bubble).toContainText('Collected: ₹30');
    await expect(bubble).toContainText('Bills: ₹20');
    await expect(bubble).not.toContainText('Whole event till');
    await expect(dlg.locator('[data-scope="today"]')).toHaveAttribute('aria-pressed', 'true');
    await noOverflow(page, 'report sheet');

    await dlg.locator('[data-action="dash-report-scope"][data-scope="all"]').click();
    await expect(bubble).toContainText('Whole event till');
    await expect(dlg.locator('[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');

    const text = await bubble.textContent();
    const href = await dlg.locator('a.dash-wa-link').getAttribute('href');
    expect(href?.startsWith('https://wa.me/?text=')).toBeTruthy();
    expect(decodeURIComponent(String(href).slice('https://wa.me/?text='.length))).toBe(text);
    await expect(dlg.locator('a.dash-wa-link')).toHaveAttribute('target', '_blank');
    await expect(dlg.locator('a.dash-wa-link')).toHaveAttribute('rel', /noopener/);

    await dlg.locator('[data-action="dash-report-copy"]').click();
    await expect(page.locator('#toast')).toContainText('copied');
    // The OS clipboard is shared by parallel workers, so assert on what the page handed to the real writeText().
    expect(await page.evaluate(() => /** @type {any} */ (window).__mysCopied)).toBe(text);
    if (browserName === 'chromium') {
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip.replace(/\r\n/g, '\n').length).toBeGreaterThan(0); // the OS clipboard may use CRLF
    }
  });

  test('big amounts stay on one line and never widen the page', async ({page}) => {
    await openDashboard(page);
    // ₹1,50,399.25 in cash (a busy mela) plus one ₹99,90,00,000 pending order (price cap × 999) and a big bill.
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      const d = await import('/domain.mjs');
      await core.commitConfig(st => {
        st.config.inventory = false;
        cat.setPrices(st.config, {cola: 15039925, 'lemon-fizz': 100000000});
        cat.addMember(st.config, {name: 'Bahut Lamba Naam Wala Partner Kumar', color: 'lime'});
      });
      await core.commit(st => {
        const s = st[st.mode];
        d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'cola')], method: 'Cash'});
        d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'lemon-fizz', {quantity: 999})], method: 'Cash', pending: true});
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'A really long bill title for the twenty litre water cans and ice', category: 'restock', amount: 9999999});
      });
    });
    await expect(page.locator('.dash-stat').filter({hasText: 'Cash'})).toContainText('₹1,50,399.25');
    const tiles = await page.locator('.dash-stat strong').evaluateAll(els => els.map(el => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
      return {text: el.textContent, oneLine: el.getBoundingClientRect().height < lh * 1.5, fits: el.scrollWidth <= el.clientWidth + 1};
    }));
    for (const t of tiles) expect(t, `tile ${t.text}`).toMatchObject({oneLine: true, fits: true});
    await expect(page.locator('.dash-orders .dash-order-total').first()).toContainText('₹99,90,00,000');
    await noOverflow(page, 'dashboard with crore-sized amounts');
    await go(page, 'milestones');
    await noOverflow(page, 'milestones strip with big amounts');
  });

  test('hourly chart opens on the latest hours', async ({page}) => {
    await openDashboard(page);
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        const start = new Date();
        start.setUTCHours(3, 0, 0, 0); // 8:30 am IST
        for (let i = 0; i < 14; i++) {
          const at = new Date(start.getTime() + i * 3600000).toISOString();
          d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'cola')], method: 'Cash'}, at);
        }
      });
    });
    await expect(page.locator('.dash-hour')).toHaveCount(14);
    const box = await page.locator('.dash-hours-scroll').boundingBox();
    const last = await page.locator('.dash-hour').last().boundingBox();
    expect(box && last).toBeTruthy();
    expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(last.x).toBeGreaterThanOrEqual(box.x - 1);
    await noOverflow(page, 'hourly chart');
  });

  test('switching the report period keeps focus on the chosen period', async ({page}) => {
    await openDashboard(page);
    await act(page, 'dash-report').click();
    const all = sheet(page).locator('[data-action="dash-report-scope"][data-scope="all"]');
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  test('day report is reachable through the public action', async ({page}) => {
    await openDashboard(page);
    await go(page, 'sell');
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.runAction('dash-report')));
    await expect(sheet(page).locator('[data-report-text]')).toContainText('Top sellers: none yet');
  });
});

test.describe('milestones', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('first sale unlocks, counts update and the mission strip shows', async ({page}) => {
    await ready(page);
    await go(page, 'milestones');
    const total = (await state(page)).config.milestones.length;
    await expect(page.locator('.ms-count')).toContainText(`0 / ${total} UNLOCKED`);
    await expect(page.locator('.dash-strip')).toContainText('Break-even = your bills');
    await expect(page.locator('.dash-strip [data-action="money-add-bill"]')).toBeVisible();
    const first = page.locator('.ms-card').filter({hasText: 'First sale'});
    await expect(first).toHaveClass(/is-next/);
    await expect(first).toContainText('0 / 1');

    await seedOrders(page, [{items: [['lemon-fizz', 1]]}]);
    await expect(first).toHaveClass(/is-unlocked/);
    await expect(first).toContainText('Unlocked');
    await expect(page.locator('.ms-count')).toContainText(`1 / ${total} UNLOCKED`);
    await expect(page.locator('.ms-card').filter({hasText: '₹1,000 Club'})).toContainText('₹30 / ₹1,000');

    // A void reverses it.
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.correctOrder(s, st.config, s.orders[0].id, {type: 'void', reason: 'test'});
      });
    });
    await expect(first).toHaveClass(/is-reversed/);
    await expect(first).toContainText('REVERSED · KEEP GOING');
    await expect(first.locator('.ms-why')).toContainText('refund or void');
    await noOverflow(page, 'milestones');
  });

  test('a big restock bill reverses an unlocked break-even milestone', async ({page}) => {
    await ready(page);
    await go(page, 'milestones');
    await seedBills(page, [{title: 'Plates', category: 'packaging', amount: 2000}]);
    await expect(page.locator('.dash-strip')).toContainText('THE ₹20 MISSION');
    await seedOrders(page, [{items: [['lemon-fizz', 1]]}]);
    const boss = page.locator('.ms-card').filter({hasText: 'Break-even boss'});
    const half = page.locator('.ms-card').filter({hasText: 'Halfway there'});
    await expect(boss).toHaveClass(/is-unlocked/);
    await expect(half).toHaveClass(/is-unlocked/);
    await expect(page.locator('.dash-strip.is-profit')).toContainText('+₹10 profit');

    // Mid-fest cheese run: break-even jumps to ₹520, recovery falls to 5%.
    await seedBills(page, [{title: 'Extra cheese & buns', category: 'restock', amount: 50000}]);
    await expect(boss).toHaveClass(/is-reversed/);
    await expect(boss).toContainText('REVERSED · KEEP GOING');
    await expect(boss.locator('.ms-why')).toContainText('New bills raised your break-even');
    await expect(half).toHaveClass(/is-reversed/);
    await expect(page.locator('.dash-strip')).toContainText('THE ₹520 MISSION');
    const st = await state(page);
    const id = st.config.milestones.find(m => m.title === 'Break-even boss').id;
    expect(st.live.milestones[id].active).toBe(false);
    expect(st.live.milestones[id].unlockedAt).toBeTruthy();

    // Voiding that bill wins it back (first unlock time kept).
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.voidExpense(s, st.config, s.expenses.at(-1).id, 'returned the cheese');
      });
    });
    await expect(boss).toHaveClass(/is-unlocked/);
    expect((await state(page)).live.milestones[id].unlockedAt).toBe(st.live.milestones[id].unlockedAt);

    // The dashboard tells the same story.
    await go(page, 'dashboard');
    await expect(page.locator('.dash-hero.is-profit')).toBeVisible();
    await noOverflow(page, 'milestones after bills');
  });

  test('add (PIN), auto-generate and delete milestones', async ({page}) => {
    await ready(page);
    await go(page, 'milestones');
    const before = (await state(page)).config.milestones.length;
    await act(page, 'ms-edit-mode').click();
    await adminClick(page, act(page, 'ms-add'));
    const dlg = sheet(page);
    await expect(dlg.locator('#ms-title')).toBeVisible();
    await dlg.locator('#ms-title').fill('Paisa vasool 500');
    await dlg.locator('#ms-type').selectOption('revenue');
    await expect(dlg.locator('label[for="ms-target"]')).toContainText('₹');
    await dlg.locator('#ms-target').fill('500');
    await dlg.locator('[data-action="ms-save"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const added = page.locator('.ms-card').filter({hasText: 'Paisa vasool 500'});
    await expect(added).toContainText('₹0 / ₹500');
    let st = await state(page);
    expect(st.config.milestones).toHaveLength(before + 1);
    const m = st.config.milestones.at(-1);
    expect(m).toMatchObject({title: 'Paisa vasool 500', type: 'revenue', target: 50000});
    expect(st.live.milestones[m.id]).toMatchObject({active: false});
    expect(st.demo.milestones[m.id]).toMatchObject({active: false});

    // Invalid target stays in the sheet with an error.
    await act(page, 'ms-add').click();
    await dlg.locator('#ms-title').fill('Bad');
    await dlg.locator('#ms-target').fill('2.5');
    await dlg.locator('[data-action="ms-save"]').click();
    await expect(dlg.locator('[data-error]')).toBeVisible();
    await dlg.locator('[data-action="close"]').first().click();

    // Move the new one up.
    await added.locator('[data-action="ms-move"][data-dir="-1"]').click();
    await expect.poll(async () => (await state(page)).config.milestones.at(-2).id).toBe(m.id);

    // Auto-generate replaces the list (street-chaat has a game → 7 goals).
    await act(page, 'ms-auto').click();
    await expect(dlg).toContainText('Auto-generate milestones?');
    await dlg.locator('[data-action="core-confirm"]').click();
    await expect(page.locator('.ms-card')).toHaveCount(7);
    await expect(page.locator('.ms-card').filter({hasText: 'Paisa vasool 500'})).toHaveCount(0);
    await expect(page.locator('.ms-card').filter({hasText: 'Dhamaka'})).toHaveCount(1);

    // Delete one.
    await page.locator('.ms-card').filter({hasText: 'Crowd magnet'}).locator('[data-action="ms-delete"]').click();
    await expect(dlg).toContainText('Crowd magnet');
    await dlg.locator('[data-action="core-confirm"]').click();
    await expect(page.locator('.ms-card')).toHaveCount(6);
    st = await state(page);
    expect(st.config.milestones.some(x => x.title === 'Crowd magnet')).toBe(false);
    await expect(page.locator('.ms-count')).toContainText('/ 6 UNLOCKED');
    await noOverflow(page, 'milestones editor');
  });

  test('raising an unlocked goal starts it fresh instead of showing REVERSED', async ({page}) => {
    await ready(page);
    await go(page, 'milestones');
    await seedOrders(page, [{items: [['lemon-fizz', 1]]}]);
    const first = page.locator('.ms-card').filter({hasText: 'First sale'});
    await expect(first).toHaveClass(/is-unlocked/);
    await act(page, 'ms-edit-mode').click();
    await adminClick(page, first.locator('[data-action="ms-edit"]'));
    const dlg = sheet(page);
    await expect(dlg.locator('#ms-target')).toHaveValue('1');
    await dlg.locator('#ms-target').fill('10');
    await dlg.locator('[data-action="ms-save"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(first).not.toHaveClass(/is-reversed/);
    await expect(first).toHaveClass(/is-next/);
    await expect(first).toContainText('1 / 10');
    const st = await state(page);
    const m = st.config.milestones.find(x => x.title === 'First sale');
    expect(m.target).toBe(10);
    expect(st.live.milestones[m.id]).toMatchObject({active: false, unlockedAt: null});

    // A title-only edit keeps the unlock history.
    const club = page.locator('.ms-card').filter({hasText: '₹1,000 Club'});
    await seedOrders(page, [{items: [['combo-triple-dhamaka', 8]]}]);
    await expect(club).toHaveClass(/is-unlocked/);
    const before = (await state(page)).live.milestones[st.config.milestones[1].id].unlockedAt;
    await club.locator('[data-action="ms-edit"]').click();
    await dlg.locator('#ms-title').fill('Thousand club');
    await dlg.locator('[data-action="ms-save"]').click();
    await expect(page.locator('.ms-card').filter({hasText: 'Thousand club'})).toHaveClass(/is-unlocked/);
    expect((await state(page)).live.milestones[st.config.milestones[1].id].unlockedAt).toBe(before);
  });

  test('reordering keeps keyboard focus on the moved card', async ({page}) => {
    await ready(page);
    await go(page, 'milestones');
    await act(page, 'ms-edit-mode').click();
    const third = page.locator('.ms-card').nth(2);
    const id = await third.getAttribute('data-milestone');
    await adminClick(page, third.locator('[data-action="ms-move"][data-dir="-1"]'));
    await expect.poll(async () => (await state(page)).config.milestones[1].id).toBe(id);
    await expect(page.locator(`.ms-card[data-milestone="${id}"] [data-action="ms-move"][data-dir="-1"]`)).toBeFocused();
    // At the top the up arrow is disabled, so focus falls to the down arrow.
    await page.locator(`.ms-card[data-milestone="${id}"] [data-action="ms-move"][data-dir="-1"]`).click();
    await expect.poll(async () => (await state(page)).config.milestones[0].id).toBe(id);
    await expect(page.locator(`.ms-card[data-milestone="${id}"] [data-action="ms-move"][data-dir="1"]`)).toBeFocused();
  });
});
