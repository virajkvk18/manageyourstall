// Your stalls page (#/stalls) + account pages (#/login #/signup #/join #/account) — owner: stalls agent (ARCHITECTURE.md §17.5).
import {test, expect} from '@playwright/test';
import {noOverflow} from './helpers.mjs';

/** Boot a fresh device (no stalls → landing page). */
async function boot(page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
}

/**
 * Put stalls straight into storage (each with `orders` paid cash orders), then reload on #/stalls.
 * The last stall with `open: true` becomes the active one.
 * @returns {Promise<string[]>} entry ids in the given order
 */
async function seed(page, stalls) {
  await boot(page);
  const ids = await page.evaluate(async list => {
    const d = await import('/domain.mjs');
    const s = await import('/storage.mjs');
    const out = [];
    for (const x of list) {
      const st = d.initialState({templateId: x.tpl || 'street-chaat', withPrices: true});
      st.onboarded = true;
      st.config.profile.stallName = x.name;
      st.config.profile.booth = x.booth ?? '';
      st.config.team.members = (x.members || []).map((name, i) => ({id: `m${i + 1}`, name, color: ['pink', 'sky', 'lime'][i % 3], share: null}));
      const p = st.config.products.find(q => q.price > 0 && q.active !== false);
      for (let i = 0; i < (x.orders || 0); i++) {
        d.createOrder(st.live, st.config, {id: `seed-${out.length}-${i}`, items: [d.makeLine(st.config, p.id)]});
      }
      const made = await s.createStall(st, {open: !!x.open});
      out.push(made.entry.id);
    }
    return out;
  }, stalls);
  await page.goto('/#/stalls');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
  await expect(page.locator('.stl-card')).toHaveCount(stalls.length);
  return ids;
}

const card = (page, id) => page.locator(`.stl-card[data-stall="${id}"]`);
const meta = page => page.evaluate(() => import('/storage.mjs').then(s => s.getMeta()));
const readStall = (page, id) => page.evaluate(i => import('/storage.mjs').then(s => s.readStall(i)), id);

test.describe('Your stalls', () => {
  test('lists the stalls on this phone with their summaries', async ({page}) => {
    const [a, b] = await seed(page, [
      {name: 'Chatpata Junction', booth: 'Stall No. 7', orders: 3},
      {name: 'Thanda Cool', tpl: 'drinks-games', booth: '', orders: 0, open: true},
    ]);
    await expect(page.locator('.stl-page .brand-mark').first()).toHaveText('MYS');
    await expect(page.locator('.stl-page .credit-badge').first()).toHaveText('created by viraj');
    await expect(page.locator('h1')).toContainText('Your');
    const first = card(page, a);
    await expect(first.locator('.stl-name')).toHaveText('Chatpata Junction');
    await expect(first.locator('.stl-booth')).toContainText('Stall No. 7');
    await expect(first.locator('.stl-stats')).toContainText('3');
    const m = await meta(page);
    const collected = m.stalls.find(e => e.id === a).summary.collected;
    expect(collected).toBeGreaterThan(0);
    await expect(first.locator('.stl-stats')).toContainText(`₹${collected / 100}`);
    await expect(first.locator('svg.stl-hero-art')).toHaveCount(1);
    await expect(first.locator('[data-sync="local"]')).toBeVisible();
    // the open stall is listed first, marked, and offers the way back
    await expect(page.locator('.stl-card').first()).toHaveAttribute('data-stall', b);
    await expect(card(page, b).locator('.stl-live')).toBeVisible();
    await expect(card(page, b).locator('[data-action="stl-open"]')).toContainText('Back to counter');
    await expect(card(page, b).locator('.stl-booth')).toHaveCount(0);
    await expect(page.locator('[data-action="stl-back"]')).toBeVisible();
    // start / join entry points
    await expect(page.locator('[data-action="stl-go"][data-page="setup"]').first()).toBeVisible();
    await expect(page.locator('[data-action="stl-go"][data-page="join"]').first()).toBeVisible();
    // signed out: account card invites logging in
    await expect(page.locator('.stl-account')).toContainText('Open your stalls on any phone');
    await noOverflow(page, 'stalls');
  });

  test('opens and switches stalls', async ({page}) => {
    const [a, b] = await seed(page, [
      {name: 'Alpha Chaat', orders: 1},
      {name: 'Beta Momos', tpl: 'momo-corner', orders: 2, open: true},
    ]);
    await card(page, a).locator('[data-action="stl-open"]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    expect(await page.evaluate(() => import('/ui/core.mjs').then(m => m.store.state.config.profile.stallName))).toBe('Alpha Chaat');
    expect((await meta(page)).activeStallId).toBe(a);
    // back to Your stalls: Alpha is now the open one
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.goPage('stalls')));
    await expect(page.locator('.stl-card').first()).toHaveAttribute('data-stall', a);
    await expect(card(page, a).locator('.stl-live')).toBeVisible();
    await card(page, b).locator('[data-action="stl-open"]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    expect(await page.evaluate(() => import('/ui/core.mjs').then(m => m.store.state.config.profile.stallName))).toBe('Beta Momos');
    // "Back to <stall>" returns to the counter
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.goPage('stalls')));
    await expect(page.locator('[data-action="stl-back"]')).toContainText('Beta Momos');
    await page.locator('[data-action="stl-back"]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
  });

  test('edit info updates a stall that is not open (storage) and the open one (state)', async ({page}) => {
    const [a, b] = await seed(page, [
      {name: 'Old Name', booth: 'B-1', orders: 1, members: ['Aman', 'Riya', 'Kabir']},
      {name: 'Open Stall', orders: 0, open: true},
    ]);
    await card(page, a).locator('[data-action="stl-edit"]').click();
    const sh = page.locator('#sheet[open]');
    await expect(sh).toContainText('Edit stall info');
    // stall name is required
    await sh.locator('#stl-e-name').fill('');
    await sh.locator('[data-action="stl-edit-save"]').click();
    await expect(sh.locator('[data-error]')).toContainText('name');
    await sh.locator('#stl-e-name').fill('Chatpata Corner');
    await sh.locator('#stl-e-booth').fill('');
    await sh.locator('#stl-e-event').fill('Diwali Mela');
    await sh.locator('#stl-e-city').fill('Jabalpur');
    // rename Aman, remove Riya, add Zoya
    await sh.locator('.stl-member input').first().fill('Aman Verma');
    await sh.locator('[data-action="stl-member-remove"][aria-label="Remove Riya"]').click();
    await sh.locator('#stl-m-new').fill('Zoya');
    await sh.locator('[data-action="stl-member-add"]').click();
    await expect(sh.locator('.stl-member')).toHaveCount(3);
    await sh.locator('[data-action="stl-edit-save"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const st = await readStall(page, a);
    expect(st.config.profile.stallName).toBe('Chatpata Corner');
    expect(st.config.profile.booth).toBe('');
    expect(st.config.profile.eventName).toBe('Diwali Mela');
    expect(st.config.profile.city).toBe('Jabalpur');
    expect(st.config.team.members.map(m => m.name)).toEqual(['Aman Verma', 'Kabir', 'Zoya']);
    expect(st.config.team.members[0].id).toBe('m1');
    expect(st.live.orders.length).toBe(1);
    await expect(card(page, a).locator('.stl-name')).toHaveText('Chatpata Corner');
    await expect(card(page, a).locator('.stl-booth')).toHaveCount(0);

    // the open stall goes through the kernel (commitConfig)
    await card(page, b).locator('[data-action="stl-edit"]').click();
    await sh.locator('#stl-e-name').fill('Renamed Open');
    await sh.locator('#stl-m-new').fill('Dev');
    await sh.locator('#stl-m-new').press('Enter'); // Enter in "Add a partner" adds instead of saving
    await expect(sh.locator('.stl-member')).toHaveCount(1);
    await sh.locator('[data-action="stl-edit-save"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const live = await page.evaluate(() => import('/ui/core.mjs').then(m => m.store.state.config));
    expect(live.profile.stallName).toBe('Renamed Open');
    expect(live.team.members.map(m => m.name)).toEqual(['Dev']);
    expect((await readStall(page, b)).config.profile.stallName).toBe('Renamed Open');
  });

  test('delete removes only that stall after typing DELETE', async ({page}) => {
    const [a, b, c] = await seed(page, [
      {name: 'Keep Me', orders: 1},
      {name: 'Delete Me', orders: 2},
      {name: 'Open One', orders: 0, open: true},
    ]);
    await card(page, b).locator('[data-action="stl-delete"]').click();
    const sh = page.locator('#sheet[open]');
    await expect(sh).toContainText('Delete Me');
    await expect(sh).toContainText('gone for good');
    await expect(sh.locator('[data-action="stl-backup"]')).toBeVisible();
    await sh.locator('#confirm-typed').fill('delete');
    await sh.locator('[data-action="core-confirm"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(1);
    expect((await meta(page)).stalls.length).toBe(3);
    await sh.locator('#confirm-typed').fill('DELETE');
    await sh.locator('[data-action="core-confirm"]').click();
    await expect(page.locator('.stl-card')).toHaveCount(2);
    const m = await meta(page);
    expect(m.stalls.map(e => e.id).sort()).toEqual([a, c].sort());
    expect(m.activeStallId).toBe(c);
    expect((await readStall(page, a)).live.orders.length).toBe(1);
    await expect(card(page, b)).toHaveCount(0);
  });

  test('deleting the open stall leaves it and keeps the others', async ({page}) => {
    const [a, b] = await seed(page, [
      {name: 'Stays', orders: 1},
      {name: 'Open Goes', orders: 0, open: true},
    ]);
    await card(page, b).locator('[data-action="stl-delete"]').click();
    await page.locator('#confirm-typed').fill('DELETE');
    await page.locator('#sheet[open] [data-action="core-confirm"]').click();
    await expect(page.locator('.stl-card')).toHaveCount(1);
    await expect(card(page, a)).toBeVisible();
    const m = await meta(page);
    expect(m.activeStallId).toBe(null);
    expect(m.stalls.map(e => e.id)).toEqual([a]);
    await expect(page.locator('[data-action="stl-back"]')).toHaveCount(0);
  });

  test('signed out: Save to cloud asks to log in first', async ({page}) => {
    const [a] = await seed(page, [{name: 'Local Only', orders: 0, open: true}]);
    await card(page, a).locator('[data-action="stl-link"]').click();
    const sh = page.locator('#sheet[open]');
    await expect(sh).toContainText('Log in to save this stall');
    await sh.locator('[data-action="stl-auth"][data-page="login"]').click();
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.locator('.acc-login form')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('mys-pending-link'))).toBe(a);
  });

  test('a conflicted linked stall explains itself and offers both copies', async ({page}) => {
    const [a] = await seed(page, [{name: 'Two Phones', orders: 1, open: true}]);
    await page.evaluate(id => import('/storage.mjs').then(s => s.updateEntry(id, {cloud: {
      stallId: 'k1', code: 'MYS-ABCDE', ownerLoginId: 'test-x', revision: 2, dirty: true, status: 'conflict', syncedAt: null,
      lastError: 'Another phone saved a newer copy.', access: 'owner',
    }})), a);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1');
    const c = card(page, a);
    await expect(c.locator('[data-sync="conflict"]')).toBeVisible();
    await expect(c.locator('.stl-alert')).toContainText('Two versions');
    await expect(c.locator('[data-action="stl-sync-now"]')).toHaveCount(0);
    await c.locator('[data-action="stl-use-cloud"]').click();
    await expect(page.locator('#sheet[open]')).toContainText('backup file');
    await page.locator('#sheet[open] [data-action="close"]').first().click();
    await c.locator('[data-action="stl-force-push"]').click();
    await expect(page.locator('#sheet[open]')).toContainText('this phone’s copy');
    await page.locator('#sheet[open] [data-action="close"]').first().click();
    // linked owner stalls show Team access with the code
    await c.locator('[data-action="stl-team"]').click();
    await expect(page.locator('#sheet[open] #stl-code')).toHaveText('MYS-ABCDE');
    await noOverflow(page, 'conflict');
  });

  test('empty phone shows a friendly start', async ({page}) => {
    await boot(page, '/#/stalls');
    await expect(page.locator('.stl-empty')).toContainText('No stalls on this phone yet');
    await page.locator('.stl-empty [data-action="stl-go"][data-page="setup"]').click();
    await expect(page).toHaveURL(/#\/setup/);
  });
});

test.describe('Account pages', () => {
  test('login validation, show/hide password', async ({page}) => {
    await boot(page, '/#/login');
    await expect(page.locator('.stl-page .credit-badge').first()).toHaveText('created by viraj');
    const err = page.locator('#acc-error');
    await page.locator('[data-action="acc-login"]').click();
    await expect(err).toContainText('login ID');
    await expect(page.locator('#acc-login-id')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#acc-login-id').fill('no spaces allowed');
    await page.locator('[data-action="acc-login"]').click();
    await expect(err).toContainText('doesn’t look right');
    await page.locator('#acc-login-id').fill('test-someone');
    await page.locator('[data-action="acc-login"]').click();
    await expect(err).toContainText('password');
    const pass = page.locator('#acc-login-pass');
    await pass.fill('secret1');
    await expect(pass).toHaveAttribute('type', 'password');
    await page.locator('[data-action="acc-peek"][data-for="acc-login-pass"]').click();
    await expect(pass).toHaveAttribute('type', 'text');
    await expect(pass).toHaveValue('secret1');
    await page.locator('[data-action="acc-peek"][data-for="acc-login-pass"]').click();
    await expect(pass).toHaveAttribute('type', 'password');
    await noOverflow(page, 'login');
  });

  test('signup validation shows the rules', async ({page}) => {
    await boot(page, '/#/signup');
    const err = page.locator('#acc-error');
    await page.locator('[data-action="acc-signup"]').click();
    await expect(err).toContainText('name');
    await page.locator('#acc-su-name').fill('Viraj');
    await page.locator('#acc-su-id').fill('ab');
    await expect(page.locator('.acc-rule[data-rule="id"]')).not.toHaveClass(/ok/);
    await page.locator('[data-action="acc-signup"]').click();
    await expect(err).toContainText('Login ID');
    await page.locator('#acc-su-id').fill('test-rules');
    await expect(page.locator('.acc-rule[data-rule="id"]')).toHaveClass(/ok/);
    await page.locator('#acc-su-pass').fill('12345');
    await page.locator('[data-action="acc-signup"]').click();
    await expect(err).toContainText('6 characters');
    await page.locator('#acc-su-pass').fill('123456');
    await expect(page.locator('.acc-rule[data-rule="len"]')).toHaveClass(/ok/);
    await page.locator('#acc-su-pass2').fill('1234567');
    await page.locator('[data-action="acc-signup"]').click();
    await expect(err).toContainText('don’t match');
    await expect(page.locator('.acc-rule[data-rule="match"]')).not.toHaveClass(/ok/);
    await page.locator('#acc-su-pass2').fill('123456');
    await expect(page.locator('.acc-rule[data-rule="match"]')).toHaveClass(/ok/);
    await noOverflow(page, 'signup');
  });

  test('join validates the stall code', async ({page}) => {
    await boot(page, '/#/join');
    const err = page.locator('#acc-error');
    await page.locator('[data-action="acc-join"]').click();
    await expect(err).toContainText('stall code');
    await page.locator('#acc-join-code').fill('MYS-12');
    await page.locator('[data-action="acc-join"]').click();
    await expect(err).toContainText('MYS-7K2QD');
    await page.locator('#acc-join-code').fill('mys 7k2qd');
    await page.locator('[data-action="acc-join"]').click();
    await expect(err).toContainText('team password');
    await noOverflow(page, 'join');
  });

  test('account page signed out offers log in', async ({page}) => {
    await boot(page, '/#/account');
    await expect(page.locator('.acc-card')).toContainText('You’re not logged in');
    await page.locator('.acc-card [data-action="acc-go"][data-page="login"]').click();
    await expect(page).toHaveURL(/#\/login/);
    await noOverflow(page, 'account');
  });

  test('no horizontal overflow on any page with stalls', async ({page}) => {
    await seed(page, [
      {name: 'A Very Long Stall Name That Keeps Going And Going', booth: 'Booth 123456789', orders: 4, members: ['A']},
      {name: 'Short', orders: 0, open: true},
    ]);
    for (const p of ['stalls', 'login', 'signup', 'join', 'account']) {
      await page.evaluate(n => import('/ui/core.mjs').then(m => m.goPage(n)), p);
      await expect(page.locator('.stl-page')).toBeVisible();
      await noOverflow(page, p);
    }
  });
});

test.describe('Cloud (live dev backend)', () => {
  test('sign up, save a stall, then download & open it in a new browser', async ({page, browser}, info) => {
    test.skip(info.project.name !== 'desktop', 'live backend round-trip runs once (desktop)');
    test.setTimeout(120000);
    const reachable = await page.request
      .post('https://descriptive-gull-970.convex.cloud/api/query', {data: {path: 'auth:me', args: {token: 'x'}, format: 'json'}, timeout: 10000})
      .then(r => r.ok())
      .catch(() => false);
    test.skip(!reachable, 'Convex dev deployment not reachable');

    const [a] = await seed(page, [{name: 'Cloud Chaat', booth: 'C-9', orders: 3, open: true}]);
    const loginId = `test-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const password = `pw-${Math.random().toString(36).slice(2, 10)}`;

    // Save to cloud while signed out → create account → back on Your stalls, the stall gets linked
    await card(page, a).locator('[data-action="stl-link"]').click();
    await page.locator('#sheet[open] [data-action="stl-auth"][data-page="signup"]').click();
    await page.locator('#acc-su-name').fill('Test Viraj');
    await page.locator('#acc-su-id').fill(loginId);
    await page.locator('#acc-su-pass').fill(password);
    await page.locator('#acc-su-pass2').fill(password);
    await page.locator('[data-action="acc-signup"]').click();
    await expect(page).toHaveURL(/#\/stalls/, {timeout: 30000});
    await expect(page.locator('.stl-account-in')).toContainText(loginId);
    await expect(card(page, a).locator('[data-sync="synced"]')).toBeVisible({timeout: 60000});
    const m = await meta(page);
    const linked = m.stalls.find(e => e.id === a).cloud;
    expect(linked.code).toMatch(/^MYS-[A-Z0-9]{5}$/);

    // Team access sheet shows the code
    await card(page, a).locator('[data-action="stl-team"]').click();
    await expect(page.locator('#sheet[open] #stl-code')).toHaveText(linked.code);
    await page.locator('#sheet[open] [data-action="close"]').first().click();

    // A new browser (another phone): log in, Download & open
    const other = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
    const p2 = await other.newPage();
    await boot(p2, '/#/login');
    await p2.locator('#acc-login-id').fill(loginId.toUpperCase());
    await p2.locator('#acc-login-pass').fill('wrong-password');
    await p2.locator('[data-action="acc-login"]').click();
    await expect(p2.locator('#acc-error')).toBeVisible({timeout: 30000});
    await p2.locator('#acc-login-pass').fill(password);
    await p2.locator('[data-action="acc-login"]').click();
    await expect(p2).toHaveURL(/#\/stalls/, {timeout: 30000});
    const row = p2.locator(`.stl-cloud-row[data-cloud="${linked.stallId}"]`);
    await expect(row).toContainText('Cloud Chaat', {timeout: 30000});
    await row.locator('[data-action="stl-pull"]').click();
    await expect(p2.locator('.app-shell')).toBeVisible({timeout: 60000});
    const st = await p2.evaluate(() => import('/ui/core.mjs').then(x => JSON.parse(JSON.stringify(x.store.state))));
    expect(st.config.profile.stallName).toBe('Cloud Chaat');
    expect(st.live.orders.length).toBe(3);
    await other.close();
  });
});
