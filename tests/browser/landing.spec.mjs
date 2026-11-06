// MYS landing page `#/welcome` (ARCHITECTURE.md §17.5). Owner: landing agent. created by viraj
import {test, expect} from '@playwright/test';
import {noOverflow} from './helpers.mjs';

/** Open the landing page on this test's (empty) device and wait for boot. */
async function openWelcome(page, path = '/#/welcome') {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
  await expect(page.locator('#app .land')).toBeVisible();
}

/** Put one stall on this device (then leave it, so nothing is active) and reopen the landing page. */
async function withOneStall(page) {
  await page.evaluate(async () => {
    const [storage, domain] = await Promise.all([import('/storage.mjs'), import('/domain.mjs')]);
    const st = domain.initialState({templateId: 'momo-corner'});
    st.config.profile.stallName = 'Momo Mania';
    await storage.createStall(st);
    await storage.leaveStall();
  });
  // Same-URL goto would only be a hash navigation; reload so the page boots against the new stalls index.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
  await expect(page.locator('#app .land')).toBeVisible();
}

const cta = (page, name) => page.locator(`.land [data-land-cta="${name}"]`);

test.describe('landing page', () => {
  test('a brand-new device lands on the welcome page with the full pitch', async ({page}) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openWelcome(page, '/');
    await expect(page).toHaveURL(/#\/welcome$|\/$/);
    await expect(page.locator('.app-shell')).toHaveCount(0);

    // Brand: giant MYS sticker + permanent credit.
    await expect(page.locator('.land-mark-giant')).toHaveText('MYS');
    await expect(page.locator('.land .credit-badge:visible').first()).toHaveText('created by viraj');

    // One h1 headline, sub-headline, primary CTA first.
    await expect(page.locator('.land h1')).toHaveCount(1);
    await expect(page.locator('.land h1')).toContainText('dhamaka');
    await expect(page.locator('.land-sub')).toBeVisible();
    await expect(cta(page, 'start')).toBeVisible();
    await expect(cta(page, 'start')).toContainText('Start my stall');
    await expect(cta(page, 'start')).toHaveAttribute('href', '#/setup');
    await expect(cta(page, 'login')).toHaveAttribute('href', '#/login');
    await expect(cta(page, 'join')).toHaveAttribute('href', '#/join');

    // No stalls on this device → no "Your stalls".
    await expect(page.locator('.land [data-page="stalls"]')).toHaveCount(0);

    // Collage art from the library, feature grid, steps, collab teaser and honest footer.
    expect(await page.locator('.land-collage .land-sticker').count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('.land-collage svg.land-hero-art')).toHaveCount(1);
    const features = page.locator('.land-feat');
    await expect(features).toHaveCount(6);
    for (const key of ['themes', 'upi', 'tokens', 'money', 'offline', 'report']) {
      await expect(page.locator(`.land-feat[data-feature="${key}"] h3`)).toBeVisible();
    }
    await expect(page.locator('.land-theme-chips li')).toHaveCount(6);
    await expect(page.locator('.land-step')).toHaveCount(3);
    await expect(page.locator('.land-collab')).toContainText('Stall’s Collab');
    await expect(page.locator('.land-soon')).toHaveText(/coming soon/i);
    await expect(page.locator('.land-tape')).toHaveCount(2);
    const foot = page.locator('.land-foot');
    await expect(foot).toContainText('Offline-first');
    await expect(foot).toContainText('unless you save it to your MYS account');
    await expect(foot).toContainText('never verifies bank payments');
    await expect(foot.locator('.credit-badge')).toHaveText('created by viraj');
    expect(errors).toEqual([]);
  });

  for (const [name, hash] of [['start', '#/setup'], ['login', '#/login'], ['join', '#/join'], ['final-start', '#/setup']]) {
    test(`"${name}" CTA routes to ${hash}`, async ({page}) => {
      await openWelcome(page);
      const link = cta(page, name);
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${hash.replace('/', '\\/')}$`));
    });
  }

  test('"Your stalls" appears only when this device keeps stalls, and routes to #/stalls', async ({page}) => {
    await openWelcome(page);
    await expect(page.locator('.land [data-page="stalls"]')).toHaveCount(0);
    await withOneStall(page);
    const yours = cta(page, 'stalls');
    await expect(yours).toBeVisible();
    await expect(yours).toContainText('Your stalls');
    await expect(yours.locator('.land-count')).toHaveText('1');
    await expect(cta(page, 'final-stalls')).toBeVisible();
    await yours.click();
    await expect(page).toHaveURL(/#\/stalls$/);
  });

  test('no horizontal overflow, 44px tap targets, everything inside the viewport', async ({page}) => {
    await openWelcome(page);
    await noOverflow(page, 'landing top');
    await page.locator('.land-foot').scrollIntoViewIfNeeded();
    await noOverflow(page, 'landing bottom');
    const report = await page.evaluate(() => {
      const vw = window.innerWidth;
      const small = [...document.querySelectorAll('.land a, .land button')]
        .filter(el => el.getClientRects().length)
        .map(el => ({t: (el.textContent || '').trim().slice(0, 24), r: el.getBoundingClientRect()}))
        .filter(({r}) => r.height < 43.5 || r.width < 43.5)
        .map(({t, r}) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`);
      // Text blocks (not decorative tapes/collage, which are clipped on purpose) must fit the viewport.
      const outside = [...document.querySelectorAll('.land h1, .land h2, .land h3, .land p, .land .land-btn, .land-feat, .land-step, .land-honest li')]
        .filter(el => el.getClientRects().length && !el.closest('.land-collage, .land-marquee'))
        .map(el => ({el, r: el.getBoundingClientRect()}))
        .filter(({r}) => r.left < -1 || r.right > vw + 1)
        .map(({el, r}) => `${el.className || el.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
      return {small, outside};
    });
    expect(report.small, 'tap targets under 44px').toEqual([]);
    expect(report.outside, 'content outside the viewport').toEqual([]);
  });

  test('reduced motion stops the floating stickers and tapes', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await openWelcome(page);
    const names = await page.evaluate(() => ['.land-sticker', '.land-tape-track', '.land-mark-giant', '.land-burst']
      .map(s => getComputedStyle(/** @type {Element} */ (document.querySelector(s))).animationName));
    expect(names).toEqual(['none', 'none', 'none', 'none']);
  });
});
