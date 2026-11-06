// Phase 3 end-to-end (lead, ARCHITECTURE.md §17): the whole multi-stall + cloud product as one journey.
// (a) new visitor → landing → Start my stall → wizard (inline test- account) → Open my stall → sell → Synced → Leave → landing
// (b) a second phone (new browser context) → Log in → Your stalls → Download & open → the order is there
// (d) both phones edit the same cloud stall → the second push shows Needs attention with both choices → resolve it
// (c) a legacy Packet Pataka device opens straight into its stall; Leave this stall keeps it listed under Your stalls.
// The live parts talk to the Convex dev deployment and run on desktop + mobile only (each run creates one test- account).
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {noOverflow, state, ready, go, act, adminClick} from './helpers.mjs';

const v1 = JSON.parse(readFileSync(new URL('../fixtures/v1-state.json', import.meta.url), 'utf8'));
const CONVEX = 'https://descriptive-gull-970.convex.cloud';

const booted = page => page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
const isPhone = page => (page.viewportSize()?.width || 1440) <= 767;
const onStep = (page, key) => expect(page.locator(`.setup-page.step-${key}`)).toBeVisible();

/** Collect uncaught page errors and console errors (network noise excluded). */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Sell one Masala Chai for exact cash through the real Sell → Checkout UI. */
async function sellChai(page) {
  await expect(page.locator('#main.screen-sell')).toBeVisible();
  await page.locator('article.sell-card[data-product="masala-chai"] .sell-card-main').click();
  await expect(page.locator('article.sell-card[data-product="masala-chai"] .sell-qty-badge')).toContainText('1');
  await page.locator('[data-action="co-open"]:visible').first().click();
  const s = page.locator('#sheet[open][data-kind="checkout"]');
  await expect(s).toBeVisible();
  await expect(s.locator('[data-action="co-method"][data-method="Cash"]')).toHaveAttribute('aria-pressed', 'true');
  await s.locator('#co-complete').click();
  await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
  await page.locator('#sheet[open] [data-action="co-next"]').click();
  await expect(page.locator('#sheet[open]')).toHaveCount(0);
}

/** Open Your stalls from inside the stall (sidebar / cloud pill / cashier sheet, whichever is visible). */
async function yourStalls(page) {
  await page.locator('[data-action="your-stalls"]:visible').first().click();
  await expect(page).toHaveURL(/#\/stalls$/);
  await expect(page.locator('.stl-page')).toBeVisible();
}

/** Leave the open stall through the cashier (avatar) sheet; lands on the landing page. */
async function leaveStall(page) {
  await page.locator('button.avatar').click();
  await page.locator('#sheet[open] [data-action="leave-stall"]').click();
  await page.locator('#sheet[data-kind="confirm"] [data-action="core-confirm"]').click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.locator('.land')).toBeVisible();
}

const card = (page, id) => page.locator(`.stl-card[data-stall="${id}"]`);
const meta = page => page.evaluate(() => import('/storage.mjs').then(s => s.getMeta()));

test.describe('Phase 3 — one product, two phones', () => {
  test('new visitor → wizard with an inline account → sell → synced → second phone downloads it → conflict', async ({page, browser}, info) => {
    test.skip(!['desktop', 'mobile'].includes(info.project.name), 'live cloud journey runs on desktop + mobile');
    test.setTimeout(240000);
    const reachable = await page.request
      .post(`${CONVEX}/api/query`, {data: {path: 'auth:me', args: {token: 'x'}, format: 'json'}, timeout: 10000})
      .then(r => r.ok())
      .catch(() => false);
    test.skip(!reachable, 'Convex dev deployment not reachable');
    const errors = watchErrors(page);
    const loginId = `test-p3-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const password = `fest-${Math.random().toString(36).slice(2, 10)}`;
    const viewport = page.viewportSize() || {width: 1440, height: 1000};
    /** @type {import('@playwright/test').BrowserContext | null} */
    let other = null;
    let entryId = '';

    try {
      // ── (a) New visitor lands on the landing page ──────────────────────────────────────────────────────────────────
      await page.goto('/');
      await booted(page);
      await expect(page).toHaveURL(/#\/welcome$/);
      await expect(page.locator('.land-mark-giant')).toBeVisible();
      await expect(page.locator('.credit-badge:visible').first()).toHaveText('created by viraj');
      await expect(page.locator('[data-land-cta="stalls"]')).toHaveCount(0);
      await noOverflow(page, 'landing');
      await page.locator('[data-land-cta="start"]').click();
      await expect(page).toHaveURL(/#\/setup$/);

      // Wizard: name, no stall number
      await onStep(page, 'name');
      await page.locator('#setup-stallName').fill('Chai Sutta Point');
      await page.locator('#setup-nobooth').click();
      await expect(page.locator('#setup-booth')).toBeDisabled();
      await page.locator('#setup-next').click();
      // Chai/Coffee & Maggi theme with its starter menu
      await onStep(page, 'menu');
      await page.locator('#setup-theme-chai-maggi').click();
      await expect(page.locator('#setup-theme-chai-maggi')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#setup-next').click();
      // Skip the event
      await onStep(page, 'event');
      await page.locator('[data-action="setup-skip"]').click();
      // Team: owner + a partner
      await onStep(page, 'team');
      await page.locator('#setup-ownerName').fill('Viraj');
      await page.locator('#setup-partner').fill('Kabir');
      await page.locator('#setup-partner').press('Enter');
      await expect(page.locator('.setup-partner')).toHaveCount(1);
      await page.locator('#setup-next').click();
      // UPI
      await onStep(page, 'upi');
      await page.locator('#setup-upiId').fill('chaisutta@okaxis');
      await page.locator('#setup-next').click();
      // Cloud: create a test- account inline
      await onStep(page, 'cloud');
      await page.locator('#setup-choice-account').click();
      await expect(page.locator('#setup-accName')).toHaveValue('Viraj');
      await page.locator('#setup-loginId').fill(loginId);
      await page.locator('#setup-password').fill(password);
      await noOverflow(page, 'cloud step');
      await page.locator('#setup-next').click();
      // Ready: saved to the account
      await onStep(page, 'ready');
      await expect(page.locator('.setup-stall-name')).toHaveText('Chai Sutta Point');
      await expect(page.locator('.setup-sum-row.is-synced')).toBeVisible({timeout: 45000});
      await expect(page.locator('.setup-page')).toContainText('Saved to your account');
      await page.locator('#setup-open').click();

      // Open my stall → the counter with the chai menu
      await expect(page.locator('.app-shell')).toBeVisible();
      await expect(page.locator('#sheet[open]')).toHaveCount(0);
      await expect(page.locator('.event-title').first()).toHaveText('Chai Sutta Point');
      let st = await state(page);
      expect(st.config.profile.booth).toBe('');
      expect(st.config.theme.themeId).toBe('chai-maggi');
      expect(st.config.upi.id).toBe('chaisutta@okaxis');
      expect(st.config.team.members.map(m => m.name)).toEqual(['Viraj', 'Kabir']);
      entryId = (await meta(page)).activeStallId;
      expect(entryId).toBeTruthy();

      // Sell one order (₹ masala chai, exact cash)
      await sellChai(page);
      st = await state(page);
      expect(st.live.orders).toHaveLength(1);
      const order = st.live.orders[0];
      expect(order).toMatchObject({status: 'paid', method: 'Cash'});

      // Your stalls: the stall syncs (debounced push) and shows Synced ✓
      await yourStalls(page);
      const c = card(page, entryId);
      await expect(c.locator('.stl-name')).toHaveText('Chai Sutta Point');
      await expect(c.locator('.stl-stats')).toContainText('1');
      await expect(c.locator('[data-sync="synced"]')).toBeVisible({timeout: 45000});
      await expect(c.locator('[data-sync="synced"]')).toContainText('Synced');
      await expect(page.locator('.stl-account-in')).toContainText(loginId);
      const linked = (await meta(page)).stalls.find(e => e.id === entryId).cloud;
      expect(linked).toMatchObject({dirty: false, status: 'synced', access: 'owner'});
      expect(linked.revision).toBeGreaterThanOrEqual(2); // first push at link + the sale
      expect(linked.code).toMatch(/^MYS-[A-Z0-9]{5}$/);
      await noOverflow(page, 'your stalls synced');

      // Back to the counter, then Leave this stall → landing (now offering Your stalls)
      await page.locator('[data-action="stl-back"]:visible').first().click();
      await expect(page.locator('.app-shell')).toBeVisible();
      await leaveStall(page);
      await expect(page.locator('[data-land-cta="stalls"]')).toBeVisible();
      expect((await meta(page)).activeStallId).toBeNull();

      // ── (b) A second phone: Log in → Your stalls lists the cloud stall → Download & open ─────────────────────────────
      other = await browser.newContext({viewport, hasTouch: isPhone(page), serviceWorkers: 'block'});
      const p2 = await other.newPage();
      const errors2 = watchErrors(p2);
      await p2.goto('/');
      await booted(p2);
      await expect(p2).toHaveURL(/#\/welcome$/);
      await p2.locator('[data-land-cta="login"]').click();
      await expect(p2).toHaveURL(/#\/login/);
      await p2.locator('#acc-login-id').fill(`  ${loginId.toUpperCase()} `);
      await p2.locator('#acc-login-pass').fill(password);
      await p2.locator('[data-action="acc-login"]').click();
      await expect(p2).toHaveURL(/#\/stalls$/, {timeout: 30000});
      await expect(p2.locator('.stl-account-in')).toContainText(loginId);
      await expect(p2.locator('.stl-card')).toHaveCount(0);
      const row = p2.locator(`.stl-cloud-row[data-cloud="${linked.stallId}"]`);
      await expect(row).toContainText('Chai Sutta Point', {timeout: 30000});
      await noOverflow(p2, 'second phone stalls');
      await row.locator('[data-action="stl-pull"]').click();
      await expect(p2.locator('.app-shell')).toBeVisible({timeout: 60000});
      await expect(p2.locator('.event-title').first()).toHaveText('Chai Sutta Point');
      const st2 = await state(p2);
      expect(st2.live.orders).toHaveLength(1);
      expect(st2.live.orders[0]).toMatchObject({id: order.id, total: order.total, method: 'Cash', status: 'paid'});
      expect(st2.live.payments.reduce((n, p) => n + p.amount, 0)).toBe(order.total);
      expect(st2.config.upi.id).toBe('chaisutta@okaxis');

      // ── (d) Conflict: the second phone sells and syncs first ─────────────────────────────────────────────────────────
      await sellChai(p2);
      await yourStalls(p2);
      const id2 = (await meta(p2)).activeStallId;
      await expect(card(p2, id2).locator('[data-sync="synced"]')).toBeVisible({timeout: 45000});
      const rev2 = (await meta(p2)).stalls.find(e => e.id === id2).cloud.revision;
      expect(rev2).toBe(linked.revision + 1);

      // …then the first phone edits its (now stale) copy from Your stalls: its push must not overwrite the cloud.
      await page.locator('[data-land-cta="stalls"]').click();
      await expect(page).toHaveURL(/#\/stalls$/);
      await card(page, entryId).locator('[data-action="stl-edit"]').click();
      await page.locator('#sheet[open] #stl-e-city').fill('Indore');
      await page.locator('#sheet[open] [data-action="stl-edit-save"]').click();
      await expect(page.locator('#sheet[open]')).toHaveCount(0);
      await expect(card(page, entryId).locator('[data-sync="conflict"]')).toBeVisible({timeout: 45000});
      await expect(card(page, entryId).locator('[data-sync="conflict"]')).toContainText('Needs attention');
      const alert = card(page, entryId).locator('.stl-alert');
      await expect(alert).toContainText('Two versions');
      await expect(alert.locator('[data-action="stl-force-push"]')).toBeVisible();
      await expect(alert.locator('[data-action="stl-use-cloud"]')).toBeVisible();
      await noOverflow(page, 'conflict card');
      let m1 = (await meta(page)).stalls.find(e => e.id === entryId).cloud;
      expect(m1).toMatchObject({status: 'conflict', dirty: true, revision: linked.revision});
      // The cloud copy is untouched: still the second phone's revision with both orders.
      const cloudRev = await page.evaluate(() => import('/cloud.mjs').then(m => m.listCloudStalls()).then(rows => rows[0].revision));
      expect(cloudRev).toBe(rev2);

      // Resolve: keep this phone's copy (force push) → synced again at a newer revision.
      await alert.locator('[data-action="stl-force-push"]').click();
      await page.locator('#sheet[open][data-kind="confirm"] [data-action="core-confirm"]').click();
      await expect(card(page, entryId).locator('[data-sync="synced"]')).toBeVisible({timeout: 45000});
      m1 = (await meta(page)).stalls.find(e => e.id === entryId).cloud;
      expect(m1).toMatchObject({status: 'synced', dirty: false, revision: rev2 + 1});
      expect((await page.evaluate(id => import('/storage.mjs').then(s => s.readStall(id)), entryId)).config.profile.city).toBe('Indore');

      expect(errors2, 'second phone: no page errors').toEqual([]);
      expect(errors, 'first phone: no page errors').toEqual([]);
    } finally {
      // Tidy up the dev deployment: remove the cloud stall, log out both phones.
      await page
        .evaluate(id => import('/cloud.mjs').then(async m => {
          try {
            if (id && m.signedIn()) await m.removeCloudStall(id);
          } finally {
            await m.logOut();
          }
        }), entryId)
        .catch(() => {});
      await other?.close();
    }
  });
});

test.describe('Phase 3 — a cloud-linked stall on the counter', () => {
  test('backups say the stall is in the account; a factory reset never overwrites the cloud copy', async ({page}) => {
    const errors = watchErrors(page);
    await ready(page);
    const id = await page.evaluate(async () => {
      const storage = await import('/storage.mjs');
      const core = await import('/ui/core.mjs');
      const meta = await storage.getMeta();
      // A link as the sync engine leaves it after a good push (no session on this device, so nothing is sent).
      await storage.updateEntry(meta.activeStallId, {cloud: {stallId: 'k-test', code: 'MYS-ABCDE', ownerLoginId: 'test-x', revision: 4,
        dirty: false, status: 'synced', syncedAt: new Date().toISOString(), lastError: null, access: 'owner'}});
      await core.refreshMeta();
      return meta.activeStallId;
    });
    await go(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    await expect(page.locator('#sheet[open] .data-hero')).toContainText('in your MYS account');
    await page.locator('#sheet[open] [data-action="close"]').first().click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);

    await page.locator('[data-tile="danger"]').click();
    await adminClick(page, act(page, 'data-factory'));
    await expect(page.locator('#sheet[open]')).toContainText('cloud copy stays safe');
    await page.locator('#sheet[open] #confirm-typed').fill('FACTORY RESET');
    await act(page, 'core-confirm').click();
    await expect(page.locator('#main.screen-sell')).toBeVisible();
    // The wiped stall is no longer linked, so it can never push over the account's copy.
    await expect.poll(async () => (await meta(page)).stalls.find(e => e.id === id).cloud).toBeNull();
    expect((await state(page)).live.orders).toHaveLength(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Phase 3 — legacy device', () => {
  test('a Packet Pataka v1 device opens straight into its stall; after leaving it stays under Your stalls', async ({page}) => {
    const errors = watchErrors(page);
    // Seed the legacy v1 database before the app ever loads on this origin.
    await page.route('**/__seed-v1', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>seed</title>'}));
    await page.goto('/__seed-v1');
    await page.evaluate(value => new Promise((resolve, reject) => {
      const req = indexedDB.open('packet-pataka-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('state', 'readwrite');
        tx.objectStore('state').put(value, 'root');
        tx.oncomplete = () => (req.result.close(), resolve(true));
        tx.onerror = () => reject(tx.error);
      };
    }), v1);

    await page.goto('/');
    await booted(page);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('.event-title')).toContainText('Packet Pataka');
    expect((await state(page)).live.orders).toHaveLength(5);

    await leaveStall(page);
    await expect(page.locator('[data-land-cta="stalls"] .land-count')).toHaveText('1');
    await page.locator('[data-land-cta="stalls"]').click();
    await expect(page).toHaveURL(/#\/stalls$/);
    const c = card(page, 'root');
    await expect(c.locator('.stl-name')).toHaveText('Packet Pataka');
    await expect(c.locator('.stl-stats')).toContainText('5');
    await expect(c.locator('.stl-stats')).toContainText('₹280');
    await expect(c.locator('[data-sync="local"]')).toBeVisible();
    await expect(c.locator('.stl-live')).toHaveCount(0);
    await noOverflow(page, 'legacy your stalls');

    // Open it again: the same five orders.
    await c.locator('[data-action="stl-open"]').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.event-title')).toContainText('Packet Pataka');
    expect((await state(page)).live.orders).toHaveLength(5);
    expect(errors).toEqual([]);
  });
});
