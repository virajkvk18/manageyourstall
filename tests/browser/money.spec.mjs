// Expenses & Team Contri (ARCHITECTURE.md §16.7) — owner: money agent.
import {test, expect} from '@playwright/test';
import {ready, act, sheet, go, adminClick, noOverflow, state} from './helpers.mjs';

/** Add partners through the kernel; returns their ids in order. */
const addTeam = (page, names = ['Aarav', 'Bhavna', 'Chirag']) =>
  page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const cat = await import('/catalog.mjs');
    await core.commitConfig(st => {
      for (const name of list) cat.addMember(st.config, {name});
    });
    return core.store.state.config.team.members.map(m => m.id);
  }, names);

/** Current break-even target (paise) from the domain report. */
const target = page =>
  page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    return d.report(core.S(), core.C()).mission.target;
  });

/** A large, noisy PNG (forces the in-browser JPEG compression path). */
const bigPng = async page => {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1800;
    const x = c.getContext('2d');
    for (let i = 0; i < 2500; i++) {
      x.fillStyle = `hsl(${(i * 47) % 360} 80% ${30 + (i % 50)}%)`;
      x.fillRect((i * 97) % 2400, (i * 61) % 1800, 40 + (i % 90), 30 + (i % 70));
    }
    x.fillStyle = '#171717';
    x.font = 'bold 120px sans-serif';
    x.fillText('BILL ₹1,250', 200, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  return {name: 'bill.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64')};
};

const openMoney = async (page, tab = 'bills') => {
  await go(page, 'money');
  if (tab !== 'bills') await act(page, 'money-tab', `[data-tab="${tab}"]`).click();
  await expect(page.locator(`.money-tab-body[data-money-tab="${tab}"]`)).toBeVisible();
};

test.beforeEach(async ({page}) => {
  await ready(page);
});

test('add a pre-stall bill paid by a partner with a compressed photo', async ({page}) => {
  const [aarav] = await addTeam(page);
  await openMoney(page);
  const before = await target(page);
  await act(page, 'money-add-bill').click();
  const dlg = sheet(page);
  await expect(dlg).toHaveAttribute('data-kind', 'money-bill-form');
  await dlg.locator('#money-title').fill('Raw material run');
  await expect(dlg.locator('[data-field="category"][data-value="pre-stall"]')).toHaveClass(/active/);
  await dlg.locator('#money-amount').fill('1,250');
  await dlg.locator(`[data-field="method"][data-value="UPI"]`).click();
  await dlg.locator(`[data-field="paidBy"][data-value="${aarav}"]`).click();
  await dlg.locator('input[data-src="gallery"]').setInputFiles(await bigPng(page));
  await expect(dlg.locator('.money-photo img')).toBeVisible({timeout: 15000});
  await dlg.locator('#money-notes').fill('5 kg potatoes, chutneys, sev');
  await act(page, 'money-save-bill').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('break-even now');

  const st = await state(page);
  const e = st.live.expenses.at(-1);
  expect(e).toMatchObject({title: 'Raw material run', category: 'pre-stall', amount: 125000, method: 'UPI', paidBy: aarav, void: false});
  expect(e.billImage).toMatch(/^media:/);
  expect(await target(page)).toBe(before + 125000);

  // The stored photo is a ≤600 KB JPEG with its longest side ≤1400 px.
  const info = await page.evaluate(async ref => {
    const storage = await import('/storage.mjs');
    const all = await storage.getAllMedia();
    const data = all[ref.slice(6)];
    const img = new Image();
    img.src = data;
    await img.decode();
    const b64 = data.slice(data.indexOf(',') + 1);
    return {mime: data.slice(5, data.indexOf(';')), bytes: Math.floor((b64.length * 3) / 4), w: img.naturalWidth, h: img.naturalHeight};
  }, e.billImage);
  expect(info.mime).toBe('image/jpeg');
  expect(info.bytes).toBeLessThanOrEqual(600 * 1024);
  expect(Math.max(info.w, info.h)).toBeLessThanOrEqual(1400);

  const row = page.locator(`[data-action="money-bill"][data-id="${e.id}"]`);
  await expect(row).toContainText('Raw material run');
  await expect(row).toContainText('₹1,250');
  await expect(row).toContainText('Aarav');
  await expect(row.locator('.money-thumb img')).toBeVisible();
  await expect(page.locator('.money-tiles-bills')).toContainText('₹1,250');

  // Detail sheet shows the photo and notes; tapping zooms.
  await row.click();
  await expect(dlg).toHaveAttribute('data-kind', 'money-bill');
  await expect(dlg.locator('.money-detail-photo img')).toBeVisible();
  await expect(dlg).toContainText('5 kg potatoes');
  await dlg.locator('[data-action="money-zoom"]').click();
  await expect(dlg.locator('.money-detail-photo')).toHaveClass(/is-zoomed/);
  await noOverflow(page, 'bill detail');
});

test('quick restock raises the target, filters narrow the ledger, double-tap saves once', async ({page}) => {
  await openMoney(page);
  const before = await target(page);
  await act(page, 'money-restock').click();
  const dlg = sheet(page);
  await dlg.locator('[data-action="money-suggest"]').nth(1).click();
  await expect(dlg.locator('#money-title')).not.toHaveValue('');
  await dlg.locator('#money-amount').fill('300');
  await dlg.locator('[data-action="money-save-bill"]').dblclick();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  let st = await state(page);
  expect(st.live.expenses.length).toBe(1);
  expect(st.live.expenses[0]).toMatchObject({category: 'restock', amount: 30000, paidBy: 'drawer', method: 'Cash'});
  expect(await target(page)).toBe(before + 30000);

  // A decor bill via the add sheet (Enter submits the form).
  await act(page, 'money-add-bill').click();
  await dlg.locator('[data-field="category"][data-value="decor"]').click();
  await dlg.locator('#money-title').fill('Banner & fairy lights');
  await dlg.locator('#money-amount').fill('450.50');
  await dlg.locator('#money-amount').press('Enter');
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  st = await state(page);
  expect(st.live.expenses.map(e => e.amount)).toEqual([30000, 45050]);

  const rows = page.locator('.money-list [data-action="money-bill"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Banner'); // newest first
  await act(page, 'money-filter', '[data-cat="restock"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('₹300');
  await act(page, 'money-filter', '[data-cat="rent"]').click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.money-empty-filter')).toBeVisible();
  await act(page, 'money-filter', '[data-cat="all"]').click();
  await expect(rows).toHaveCount(2);
  await noOverflow(page, 'bills tab');
});

test('voiding a bill needs the PIN and drops it from every total', async ({page}) => {
  await openMoney(page);
  const ids = await page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    const a = d.uuid();
    const b = d.uuid();
    await core.commit(st => {
      d.addExpense(st[st.mode], st.config, {id: a, title: 'Stall rent', category: 'rent', amount: 150000});
      d.addExpense(st[st.mode], st.config, {id: b, title: 'Typo bill', category: 'misc', amount: 99900});
    });
    return [a, b];
  });
  const before = await target(page);
  await page.locator(`[data-action="money-bill"][data-id="${ids[1]}"]`).click();
  await adminClick(page, act(page, 'money-void-bill'));
  const dlg = sheet(page);
  await expect(dlg).toHaveAttribute('data-kind', 'confirm');
  await act(page, 'core-confirm').click();
  await expect(dlg.locator('[data-error]')).toContainText('reason');
  await dlg.locator('#money-void-reason').fill('Entered twice');
  await act(page, 'core-confirm').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  const st = await state(page);
  expect(st.live.expenses.find(e => e.id === ids[1])).toMatchObject({void: true, voidReason: 'Entered twice'});
  expect(await target(page)).toBe(before - 99900);
  const row = page.locator(`[data-action="money-bill"][data-id="${ids[1]}"]`);
  await expect(row).toHaveClass(/is-void/);
  await expect(row).toContainText('VOID');
  await expect(page.locator('.money-tiles-bills .money-tile').first()).toContainText('₹1,500');

  // Edit (admin, already unlocked) updates the amount.
  await page.locator(`[data-action="money-bill"][data-id="${ids[0]}"]`).click();
  await act(page, 'money-edit-bill').click();
  await expect(dlg).toHaveAttribute('data-kind', 'money-bill-form');
  await expect(dlg.locator('#money-amount')).toHaveValue('1500');
  await dlg.locator('#money-amount').fill('1600');
  await act(page, 'money-save-bill').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  expect((await state(page)).live.expenses.find(e => e.id === ids[0]).amount).toBe(160000);
});

test('planned mission banner switches the break-even to bills (PIN)', async ({page}) => {
  await page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const cat = await import('/catalog.mjs');
    await core.commitConfig(st => cat.saveMission(st.config, {mode: 'total', total: 200000, items: [{label: 'Stall rent', amount: 150000}]}));
  });
  await openMoney(page);
  await expect(page.locator('.money-be.is-planned')).toContainText('planned ₹2,000');
  await adminClick(page, act(page, 'money-ledger-mode'));
  await expect(page.locator('.money-be.is-planned')).toHaveCount(0);
  await expect(page.locator('.money-be')).toContainText('Break-even = all bills');
  expect((await state(page)).config.mission.mode).toBe('ledger');
  // Ledger mode: mission items become quick-add chips that prefill the sheet.
  await act(page, 'money-quick').click();
  await expect(sheet(page).locator('#money-title')).toHaveValue('Stall rent');
  await expect(sheet(page).locator('#money-amount')).toHaveValue('1500');
  await expect(sheet(page).locator('[data-field="category"][data-value="rent"]')).toHaveClass(/active/);
});

test('team: record contri with the PIN, leaderboard numbers, void contri', async ({page}) => {
  await openMoney(page, 'team');
  await expect(page.locator('.money-tab-body')).toContainText('Add your stall partners');
  const [a, b] = await addTeam(page, ['Aarav', 'Bhavna']);
  await page.evaluate(async bId => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      d.addExpense(st[st.mode], st.config, {id: d.uuid(), title: 'Gas cylinder', category: 'pre-stall', amount: 120000, paidBy: bId});
      d.addExpense(st[st.mode], st.config, {id: d.uuid(), title: 'Plates', category: 'packaging', amount: 80000});
    });
  }, b);
  await adminClick(page, act(page, 'money-contri'));
  const dlg = sheet(page);
  await expect(dlg).toHaveAttribute('data-kind', 'money-contri-form');
  await dlg.locator(`[data-field="memberId"][data-value="${a}"]`).click();
  await dlg.locator('#money-contri-amount').fill('1500');
  await dlg.locator('[data-field="cmethod"][data-value="UPI"]').click();
  await dlg.locator('#money-contri-note').fill('Sent to stall UPI');
  await act(page, 'money-save-contri').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  let st = await state(page);
  expect(st.live.contributions).toHaveLength(1);
  expect(st.live.contributions[0]).toMatchObject({memberId: a, amount: 150000, method: 'UPI', note: 'Sent to stall UPI'});

  const leaders = page.locator('.money-leader');
  await expect(leaders).toHaveCount(2);
  await expect(leaders.first()).toHaveAttribute('data-member', a); // ₹1,500 > ₹1,200
  const A = page.locator(`.money-leader[data-member="${a}"]`);
  const B = page.locator(`.money-leader[data-member="${b}"]`);
  await expect(A.locator('[data-k="contri"]')).toHaveText('₹1,500');
  await expect(A.locator('[data-k="bills"]')).toHaveText('₹0');
  await expect(A.locator('[data-k="capital"]')).toHaveText('₹1,500');
  await expect(A.locator('[data-k="funded"]')).toHaveText('75%'); // 1,500 of 2,000 bills
  await expect(B.locator('[data-k="bills"]')).toHaveText('₹1,200');
  await expect(B.locator('[data-k="capital"]')).toHaveText('₹1,200');
  await expect(B.locator('[data-k="funded"]')).toHaveText('60%');
  await expect(page.locator('.money-team-top')).toContainText('Equal split');
  await noOverflow(page, 'team tab');

  await act(page, 'money-void-contri').click();
  await dlg.locator('#money-void-reason').fill('Returned the money');
  await act(page, 'core-confirm').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
  st = await state(page);
  expect(st.live.contributions[0].void).toBe(true);
  await expect(A.locator('[data-k="capital"]')).toHaveText('₹0');
  await expect(page.locator('.money-contri.is-void')).toContainText('VOID');
});

test('settlement worked example: exact payouts, copy, WhatsApp, snapshot', async ({page}) => {
  const ids = await addTeam(page);
  await page.evaluate(async ([a, b, c]) => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    const cat = await import('/catalog.mjs');
    await core.commitConfig(st => {
      cat.saveProduct(st.config, {id: 'test-plate', name: 'Test Plate', categoryId: st.config.categories[0].id, price: 10000});
    });
    await core.commit(st => {
      const s = st[st.mode];
      const cfg = st.config;
      d.addContribution(s, cfg, {id: d.uuid(), memberId: a, amount: 100000});
      d.addContribution(s, cfg, {id: d.uuid(), memberId: b, amount: 50000, method: 'UPI'});
      d.addExpense(s, cfg, {id: d.uuid(), title: 'Stall rent', category: 'rent', amount: 60000, method: 'UPI', paidBy: c});
      d.addExpense(s, cfg, {id: d.uuid(), title: 'Ice & water', category: 'restock', amount: 30000});
      const pid = cfg.products.find(p => p.name === 'Test Plate').id;
      d.createOrder(s, cfg, {id: d.uuid(), items: [d.makeLine(cfg, pid, {quantity: 20})], method: 'Cash'});
      d.createOrder(s, cfg, {id: d.uuid(), items: [d.makeLine(cfg, pid, {quantity: 10})], method: 'UPI'});
    });
  }, ids);
  await openMoney(page, 'settle');
  // revenue 3,000 · bills 900 → net profit 2,100 · capital 1,000 + 500 + 600 = 2,100 · pot 4,200 · profit 700 each.
  await expect(page.locator('.money-board [data-k="net"]')).toHaveText('₹2,100');
  await expect(page.locator('.money-board [data-k="pot"]')).toHaveText('₹4,200');
  await expect(page.locator('.money-board')).toContainText('Cash ₹2,000 + UPI ₹1,000');
  const expected = {[ids[0]]: ['₹1,000', '₹1,700'], [ids[1]]: ['₹500', '₹1,200'], [ids[2]]: ['₹600', '₹1,300']};
  for (const [id, [cap, pay]] of Object.entries(expected)) {
    const card = page.locator(`.money-payout[data-member="${id}"]`);
    await expect(card.locator('[data-k="capital"]')).toHaveText(cap);
    await expect(card.locator('[data-k="profit"]')).toHaveText('+ ₹700');
    await expect(card.locator('[data-k="payout"]')).toHaveText(pay);
  }
  const r = await page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    return d.teamSettlement(core.S(), core.C());
  });
  expect(r.members.map(m => m.payout)).toEqual([170000, 120000, 130000]);
  expect(r.members.reduce((t, m) => t + m.payout, 0)).toBe(r.totals.pot);
  expect(r.totals.pot).toBe(420000);
  await noOverflow(page, 'settlement tab');

  // Copy goes through the clipboard API; WhatsApp link carries the same text.
  await page.evaluate(() => {
    window.__copied = '';
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async t => (window.__copied = t)}});
  });
  await act(page, 'money-copy').click();
  await expect(page.locator('#toast')).toContainText('copied');
  const copied = await page.evaluate(() => window.__copied);
  const text = await page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    return d.settlementText(core.S(), core.C());
  });
  expect(copied).toBe(text);
  expect(copied).toContain('₹1,700');
  const href = await page.locator('a[data-money-wa]').getAttribute('href');
  expect(href.startsWith('https://wa.me/?text=')).toBe(true);
  expect(decodeURIComponent(href.slice('https://wa.me/?text='.length))).toBe(text);
  await expect(page.locator('a[data-money-wa]')).toHaveAttribute('target', '_blank');

  await adminClick(page, act(page, 'money-snapshot'));
  await expect(page.locator('.money-snap')).toHaveCount(1);
  const st = await state(page);
  expect(st.live.settlements).toHaveLength(1);
  expect(st.live.settlements[0].result.totals.pot).toBe(420000);
  await act(page, 'money-snap').click();
  await expect(sheet(page)).toHaveAttribute('data-kind', 'money-snapshot');
  await expect(sheet(page).locator('.money-bubble')).toContainText('Team settlement');
});

test('public actions open the right tab and the tab is remembered', async ({page}) => {
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.runAction('money-open', {tab: 'team'})));
  await expect(page.locator('#main.screen-money')).toBeVisible();
  await expect(page.locator('.money-tab-body[data-money-tab="team"]')).toBeVisible();
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.navigate('sell')));
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.navigate('money')));
  await expect(page.locator('.money-tab-body[data-money-tab="team"]')).toBeVisible();
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.runAction('money-add-bill', {category: 'packaging'})));
  await expect(sheet(page).locator('[data-field="category"][data-value="packaging"]')).toHaveClass(/active/);
  await expect(sheet(page).locator('.money-hint')).toContainText('No partners yet');
  await noOverflow(page, 'add sheet');
  await page.keyboard.press('Escape');
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.runAction('money-restock')));
  await expect(sheet(page)).toContainText('Quick mid-stall restock');
  // Every tab is overflow-free.
  await page.keyboard.press('Escape');
  for (const t of ['bills', 'team', 'settle']) {
    await act(page, 'money-tab', `[data-tab="${t}"]`).click();
    await noOverflow(page, `${t} tab`);
  }
});
