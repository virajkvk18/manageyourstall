// Shell & UI kernel acceptance tests (shell agent): boot, brand + credit, navigation (incl. Expenses and Stall's Collab
// with its COMING SOON pill), §16.6 breakpoints (≥1024 sidebar · 768–1023 rail · ≤767 bottom nav), theme vars, stall
// identity, cashier switch, admin PIN dialog stacking over sheets, confirm sheets, offline pill and overflow at every width.
import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';

/** @param {import('@playwright/test').Page} page */
const isPhone = page => (page.viewportSize()?.width || 1440) <= 767;
/** @param {import('@playwright/test').Page} page */
const isRail = page => !isPhone(page) && (page.viewportSize()?.width || 1440) <= 1023;

/**
 * Open the app with an onboarded stall (skips any first-run sheet) and optional state tweaks.
 * @param {import('@playwright/test').Page} page
 * @param {{profile?: object, mode?: 'live'|'demo', pin?: {salt: string, hash: string}, order?: boolean}} [patch]
 */
async function openStall(page, patch = {}) {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(async p => {
    const storage = await import('./storage.mjs');
    const domain = await import('./domain.mjs');
    await storage.mutate(st => {
      st.onboarded = true;
      Object.assign(st.config.profile, p.profile || {});
      if (p.mode) st.mode = p.mode;
      if (p.pin) st.pin = p.pin;
      if (p.order) {
        st.config.kitchenQueue = true;
        const line = domain.makeLine(st.config, 'lemon-fizz');
        domain.createOrder(st[st.mode], st.config, {id: domain.uuid(), items: [line]});
      }
    });
  }, patch);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page */
async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** @param {import('@playwright/test').Page} page */
const navButton = (page, screen) => page.locator(`${isPhone(page) ? '.bottom-nav' : '.side-nav'} [data-action="nav"][data-screen="${screen}"]`);

/** @param {import('@playwright/test').Page} page */
async function openOperatorSheet(page) {
  await page.locator('button.avatar').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#sheet .operator-list')).toBeVisible();
}

test.describe('app shell', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('boots with the MYS mark and the "created by viraj" credit visible', async ({page}) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ManageYourStall/);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#main h1')).toBeVisible();

    const mark = page.locator('.brand-mark:visible');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveText('MYS');
    const credit = page.locator('.credit-badge:visible');
    await expect(credit).toHaveCount(1);
    await expect(credit).toHaveText('created by viraj');

    const viewport = page.viewportSize();
    const m = await mark.boundingBox();
    const c = await credit.boundingBox();
    expect(m && c).toBeTruthy();
    expect(c.y, 'credit sits below the logo').toBeGreaterThan(m.y + m.height / 2);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(viewport.width);
    expect(c.y + c.height).toBeLessThanOrEqual(viewport.height);
    if (!isPhone(page)) await expect(page.locator('.brand-word:visible')).toHaveText('ManageYourStall');
    await expectNoHorizontalOverflow(page);
  });

  test('navigation reaches every screen', async ({page}) => {
    await openStall(page);
    const screens = isPhone(page)
      ? ['orders', 'dashboard', 'collab', 'menu', 'more', 'sell']
      : ['orders', 'dashboard', 'money', 'milestones', 'menu', 'studio', 'collab', 'more', 'sell'];
    if (isPhone(page)) {
      await expect(page.locator('.bottom-nav')).toBeVisible();
      await expect(page.locator('.sidebar')).toBeHidden();
      await expect(page.locator('.bottom-nav [data-action="nav"]')).toHaveCount(6);
      const order = await page.locator('.bottom-nav [data-action="nav"]').evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).dataset.screen));
      expect(order).toEqual(['sell', 'orders', 'dashboard', 'collab', 'menu', 'more']);
      await expect(navButton(page, 'dashboard')).toHaveText('Stats');
      await expect(navButton(page, 'collab')).toContainText('Collab');
    } else {
      await expect(page.locator('.side-nav')).toBeVisible();
      await expect(page.locator('.bottom-nav')).toBeHidden();
      await expect(page.locator('.side-nav [data-action="nav"]')).toHaveCount(9);
      const order = await page.locator('.side-nav [data-action="nav"]').evaluateAll(els => els.map(e => /** @type {HTMLElement} */ (e).dataset.screen));
      expect(order).toEqual(['sell', 'orders', 'dashboard', 'money', 'milestones', 'menu', 'studio', 'collab', 'more']);
      await expect(navButton(page, 'money').locator('.nav-text:visible')).toHaveText('Expenses');
      await expect(navButton(page, 'collab').locator('.nav-text:visible')).toHaveText(isRail(page) ? 'Collab' : 'Stall’s Collab');
    }
    for (const screen of screens) {
      await navButton(page, screen).click();
      await expect(page.locator('#main')).toHaveClass(new RegExp(`screen-${screen}`));
      await expect(navButton(page, screen)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#main h1')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('stall identity from config shows in the header and document title', async ({page}) => {
    await openStall(page, {profile: {stallName: 'Chai Point Express', booth: 'Booth B-12', eventName: 'Diwali Mela', city: 'Jabalpur', initials: 'CP', tagline: 'Garma garam chai!'}});
    await expect(page.locator('.topbar .event-title')).toContainText('Chai Point Express');
    await expect(page.locator('.topbar .event-title')).toContainText('Booth B-12');
    await expect(page).toHaveTitle('Chai Point Express · ManageYourStall');
    await expect(page.locator('button.avatar')).toHaveText('CP');
    if (!isPhone(page)) await expect(page.locator('.topbar .event-sub')).toContainText('Diwali Mela · Jabalpur');
    if (!isPhone(page) && !isRail(page)) {
      await expect(page.locator('.stall-card')).toContainText('Chai Point Express');
      await expect(page.locator('.tagline-card')).toContainText('Diwali Mela');
      await expect(page.locator('.tagline-card h3')).toHaveText('Garma garam chai!');
      // Live: a profile edit re-renders the card.
      await page.evaluate(async () => {
        const core = await import('./ui/core.mjs');
        await core.commit(st => {
          st.config.profile.tagline = 'Kadak chai, zero wait';
        });
      });
      await expect(page.locator('.tagline-card h3')).toHaveText('Kadak chai, zero wait');
    }
    await expectNoHorizontalOverflow(page);
  });

  test('switching cashier needs no PIN and persists', async ({page}) => {
    await openStall(page);
    await openOperatorSheet(page);
    await expect(page.locator('#sheet .operator-choice.active')).toContainText('Team Stall');
    await page.locator('#sheet .operator-choice', {hasText: 'Cashier 1'}).click();
    await expect(page.locator('#pin-dialog')).toBeHidden();
    await expect(page.locator('#sheet')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('Cashier 1 is on the counter');
    await expect(page.locator('button.avatar')).toHaveAttribute('aria-label', /Cashier 1/);
    await page.reload();
    await expect(page.locator('button.avatar')).toHaveAttribute('aria-label', /Cashier 1/);
    if (!isPhone(page) && !isRail(page)) await expect(page.locator('.operator-name')).toContainText('Cashier 1');
  });

  test('admin PIN: first use creates a PIN, stacks over the open sheet and continues the action', async ({page}) => {
    await openStall(page);
    await openOperatorSheet(page);
    await page.evaluate(() => {
      document.querySelector('#sheet .operator-list').dataset.probe = 'still-here';
    });

    // Cancel does nothing.
    await page.locator('#sheet [data-action="unlock-admin"]').click();
    await expect(page.locator('#pin-dialog')).toBeVisible();
    await page.locator('#pin-dialog [data-pin-action="cancel"]').click();
    await expect(page.locator('#pin-dialog')).toBeHidden();
    await expect(page.locator('#sheet [data-action="unlock-admin"]')).toBeVisible();

    await page.locator('#sheet [data-action="unlock-admin"]').click();
    const pin = page.locator('#pin-dialog');
    await expect(pin).toBeVisible();
    await expect(pin).toContainText('Set your admin PIN');
    // The sheet underneath is untouched.
    await expect(page.locator('#sheet')).toBeVisible();
    await expect(page.locator('#sheet .operator-list')).toHaveAttribute('data-probe', 'still-here');

    await pin.locator('#pin-entry').fill('12');
    await pin.locator('#pin-repeat').fill('12');
    await pin.locator('[data-pin-action="submit"]').click();
    await expect(pin.locator('[data-error]')).toContainText('4 to 8 digits');

    await pin.locator('#pin-entry').fill('2468');
    await pin.locator('#pin-repeat').fill('1357');
    await pin.locator('#pin-repeat').press('Enter');
    await expect(pin.locator('[data-error]')).toContainText('don’t match');

    await pin.locator('#pin-repeat').fill('2468');
    await pin.locator('[data-pin-action="submit"]').click();
    await expect(pin).toBeHidden();
    await expect(page.locator('#toast')).toContainText('Admin unlocked');
    await expect(page.locator('#sheet')).toBeVisible();
    await expect(page.locator('#sheet [data-action="lock-admin"]')).toBeVisible();

    const stored = await page.evaluate(async () => (await (await import('./storage.mjs')).read()).pin);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.hash).toBe(createHash('sha256').update(`${stored.salt}:2468`).digest('hex'));

    // Lock, then unlock again: wrong PIN shows an error, the right one continues.
    await page.locator('#sheet [data-action="lock-admin"]').click();
    await page.locator('#sheet [data-action="unlock-admin"]').click();
    await expect(pin).toBeVisible();
    await expect(pin).toContainText('Admin PIN');
    await expect(pin.locator('#pin-repeat')).toHaveCount(0);
    await pin.locator('#pin-entry').fill('0000');
    await pin.locator('#pin-entry').press('Enter');
    await expect(pin.locator('[data-error]')).toContainText('Wrong PIN');
    await expect(pin).toBeVisible();
    await pin.locator('#pin-entry').fill('2468');
    await pin.locator('#pin-entry').press('Enter');
    await expect(pin).toBeHidden();
    await expect(page.locator('#sheet [data-action="lock-admin"]')).toBeVisible();
  });

  test('a v1 PIN keeps working and five wrong tries trigger a cooldown', async ({page}) => {
    const salt = '0b6c1f0e-1111-4c4c-9a9a-000000000001';
    const hash = createHash('sha256').update(`${salt}:4321`).digest('hex');
    await openStall(page, {pin: {salt, hash}});
    await openOperatorSheet(page);
    await page.locator('#sheet [data-action="unlock-admin"]').click();
    const pin = page.locator('#pin-dialog');
    for (let i = 0; i < 4; i++) {
      await pin.locator('#pin-entry').fill('1111');
      await pin.locator('[data-pin-action="submit"]').click();
      await expect(pin.locator('[data-error]')).toContainText(`${4 - i} ${4 - i === 1 ? 'try' : 'tries'} left`);
    }
    await pin.locator('#pin-entry').fill('1111');
    await pin.locator('[data-pin-action="submit"]').click();
    await expect(pin.locator('[data-error]')).toContainText('Too many wrong tries');
    await expect(pin.locator('[data-pin-action="submit"]')).toBeDisabled();
    await pin.locator('[data-pin-action="cancel"]').click();
    await expect(pin).toBeHidden();
    await expect(page.locator('#sheet')).toBeVisible();

    // Fresh page (cooldown is per page): the migrated v1 PIN unlocks.
    await page.reload();
    await openOperatorSheet(page);
    await page.locator('#sheet [data-action="unlock-admin"]').click();
    await pin.locator('#pin-entry').fill('4321');
    await pin.locator('[data-pin-action="submit"]').click();
    await expect(pin).toBeHidden();
    await expect(page.locator('#toast')).toContainText('Admin unlocked');
  });

  test('confirm sheet with a typed phrase only runs after an exact match', async ({page}) => {
    await openStall(page);
    await page.evaluate(async () => {
      const core = await import('./ui/core.mjs');
      window.__confirmed = 0;
      core.confirmSheet({
        title: 'Reset today’s orders?',
        body: '<p>This clears the current ledger.</p>',
        confirmLabel: 'Reset orders',
        danger: true,
        typed: 'RESET ORDERS',
        onConfirm: () => {
          window.__confirmed++;
          core.toast('Orders reset.', {tone: 'warn'});
        },
      });
    });
    const sheet = page.locator('#sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('#confirm-typed').fill('reset orders');
    await sheet.locator('[data-action="core-confirm"]').click();
    await expect(sheet.locator('[data-error]')).toContainText('Type RESET ORDERS exactly');
    expect(await page.evaluate(() => window.__confirmed)).toBe(0);
    await sheet.locator('#confirm-typed').fill('RESET ORDERS');
    await sheet.locator('#confirm-typed').press('Enter');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#toast')).toHaveClass(/warn/);
    expect(await page.evaluate(() => window.__confirmed)).toBe(1);
  });

  test('online / offline pill follows the connection', async ({page, context}) => {
    await openStall(page);
    const pill = page.locator('.topbar .status-pill');
    await expect(pill).toHaveClass(/online/);
    await expect(pill).toContainText('Online');
    await context.setOffline(true);
    await expect(pill).toHaveClass(/offline/);
    await expect(pill).toContainText('Offline');
    await context.setOffline(false);
    await expect(pill).toHaveClass(/online/);
  });

  test('practice mode shows the demo bar and the Orders badge counts the kitchen queue', async ({page}) => {
    await openStall(page, {mode: 'demo', order: true});
    const bar = page.locator('.demo-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Practice');
    await expect(bar.locator('[data-action="more-live"]')).toHaveText('Back to live');
    await expect(navButton(page, 'orders').locator('.nav-badge')).toHaveText('1');
    await expectNoHorizontalOverflow(page);
  });

  test('no horizontal overflow with a sheet and the PIN dialog open', async ({page}) => {
    await openStall(page, {profile: {stallName: 'The Extremely Long Named Chaat And Momo Corner', booth: 'Booth B-12'}});
    await expectNoHorizontalOverflow(page);
    await openOperatorSheet(page);
    await expectNoHorizontalOverflow(page);
    const box = await page.locator('#sheet').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 0.5);
    await page.locator('#sheet [data-action="unlock-admin"]').click();
    await expect(page.locator('#pin-dialog')).toBeVisible();
    const pinBox = await page.locator('#pin-dialog').boundingBox();
    expect(pinBox.x).toBeGreaterThanOrEqual(0);
    expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(page.viewportSize().width + 0.5);
    await expectNoHorizontalOverflow(page);
  });

  test('Stall’s Collab shows its COMING SOON pill on first load, inside the viewport', async ({page}) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
    const pill = page.locator('.nav-soon:visible');
    await expect(pill).toHaveCount(1);
    // Same accessible text everywhere; the rail and the phone bottom nav show the short "SOON".
    await expect(pill).toHaveText('COMING SOON');
    await expect(pill).toHaveJSProperty('innerText', isPhone(page) || isRail(page) ? 'SOON' : 'COMING SOON');
    const owner = page.locator('[data-action="nav"][data-screen="collab"]:visible');
    await expect(owner).toHaveCount(1);
    await expect(owner).toHaveAttribute('title', /coming soon/i);
    const vp = page.viewportSize();
    const box = await pill.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(box.height).toBeGreaterThanOrEqual(14);
    // The pill never covers the Collab label text.
    const lb = await owner.locator('.nav-text:visible').boundingBox();
    const overlap = !(box.x + box.width <= lb.x || lb.x + lb.width <= box.x || box.y + box.height <= lb.y + 1 || lb.y + lb.height <= box.y + 1);
    expect(overlap, 'SOON pill overlaps the Collab label').toBeFalsy();
    // Neo-Brutalist sticker: ink border, theme secondary fill (default pink), tilted.
    const style = await pill.evaluate(el => {
      const cs = getComputedStyle(el);
      return {border: cs.borderTopWidth, ink: cs.borderTopColor, transform: cs.transform};
    });
    expect(style.border).toBe('2px');
    expect(style.ink).toBe('rgb(23, 23, 23)');
    expect(style.transform).not.toBe('none');
    await expectNoHorizontalOverflow(page);
  });

  test('phone bottom nav: 6 items fit without overflow or truncation (≥44px targets)', async ({page}) => {
    test.skip(!isPhone(page), 'phone layouts only');
    await openStall(page, {mode: 'demo', order: true});
    const nav = page.locator('.bottom-nav');
    await expect(nav).toBeVisible();
    const buttons = nav.locator('[data-action="nav"]');
    await expect(buttons).toHaveCount(6);
    const vp = page.viewportSize();
    for (const b of await buttons.all()) {
      const r = await b.boundingBox();
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(vp.width + 0.5);
      const fits = await b.locator('.nav-text').evaluate(el => {
        const btn = /** @type {HTMLElement} */ (el.closest('button')).getBoundingClientRect();
        const t = el.getBoundingClientRect();
        return el.scrollWidth <= el.clientWidth + 0.5 && t.left >= btn.left - 0.5 && t.right <= btn.right + 0.5;
      });
      expect(fits, `label of ${await b.getAttribute('data-screen')} is truncated`).toBeTruthy();
    }
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await expect(navButton(page, 'orders').locator('.nav-badge')).toHaveText('1');
    await expectNoHorizontalOverflow(page);
    await navButton(page, 'collab').click();
    await expect(page.locator('#main')).toHaveClass(/screen-collab/);
    await expect(navButton(page, 'collab')).toHaveAttribute('aria-current', 'page');
  });

  test('layout switches at 1024 / 768 (§16.6): sidebar → icon rail → bottom nav, brand always visible', async ({page}) => {
    await openStall(page);
    /** @param {number} width */
    const at = async width => {
      await page.setViewportSize({width, height: 900});
      await expect(page.locator('.brand-mark:visible')).toHaveText('MYS');
      await expect(page.locator('.credit-badge:visible')).toHaveText('created by viraj');
      await expect(page.locator('.nav-soon:visible')).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
    };
    for (const w of [1440, 1024]) {
      await at(w);
      await expect(page.locator('.brand-side')).toBeVisible();
      await expect(page.locator('.brand-top')).toBeHidden();
      await expect(page.locator('.side-nav .nav-text-full')).toHaveText('Stall’s Collab');
      await expect(page.locator('.side-nav .nav-text-full')).toBeVisible();
      await expect(page.locator('.stall-card')).toBeVisible();
      await expect(page.locator('.bottom-nav')).toBeHidden();
      expect((await page.locator('.sidebar').boundingBox()).width).toBeGreaterThan(200);
    }
    for (const w of [1023, 820, 768]) {
      await at(w);
      await expect(page.locator('.brand-side')).toBeHidden();
      await expect(page.locator('.brand-top')).toBeVisible();
      await expect(page.locator('.side-nav')).toBeVisible();
      await expect(page.locator('.side-nav .nav-text-rail')).toBeVisible();
      await expect(page.locator('.side-nav .nav-text-full')).toBeHidden();
      await expect(page.locator('.bottom-nav')).toBeHidden();
      expect((await page.locator('.sidebar').boundingBox()).width).toBeLessThan(120);
    }
    for (const w of [767, 390, 320]) {
      await at(w);
      await expect(page.locator('.sidebar')).toBeHidden();
      await expect(page.locator('.bottom-nav')).toBeVisible();
      await expect(page.locator('.brand-top')).toBeVisible();
      await expect(page.locator('.bottom-nav [data-action="nav"]:visible')).toHaveCount(6);
    }
  });

  test('theme colours drive --accent / --secondary with contrast-picked text vars', async ({page}) => {
    await openStall(page);
    const vars = () => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return ['--accent', '--on-accent', '--secondary', '--on-secondary'].map(v => cs.getPropertyValue(v).trim().toLowerCase());
    });
    const expected = await page.evaluate(() => import('./ui/core.mjs').then(m => String(m.C().theme.secondary || '#FF4D87').toLowerCase()));
    const [, , secondary, onSecondary] = await vars();
    expect(secondary).toBe(/^#[0-9a-f]{6}$/.test(expected) ? expected : '#ff4d87');
    expect(['#171717', '#fff9ed']).toContain(onSecondary);
    await page.evaluate(async () => {
      const core = await import('./ui/core.mjs');
      await core.commit(st => {
        st.config.theme.accent = '#2B59C3';
        st.config.theme.secondary = '#1B1464';
      });
    });
    expect(await vars()).toEqual(['#2b59c3', '#fff9ed', '#1b1464', '#fff9ed']);
    await page.evaluate(async () => {
      const core = await import('./ui/core.mjs');
      await core.commit(st => {
        st.config.theme.secondary = '#B9F36B';
      });
    });
    expect((await vars()).slice(2)).toEqual(['#b9f36b', '#171717']);
    // The COMING SOON pill follows the theme secondary.
    await expect(page.locator('.nav-soon:visible')).toHaveCSS('background-color', 'rgb(185, 243, 107)');
    await expect(page.locator('.nav-soon:visible')).toHaveCSS('color', 'rgb(23, 23, 23)');
  });
});
