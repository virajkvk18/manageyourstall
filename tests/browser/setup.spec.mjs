// Setup wizard (#/setup) acceptance tests — owner: setup agent (ARCHITECTURE.md §17.5).
// Each test gets a fresh browser context (empty IndexedDB + sessionStorage), so the device starts with no stalls.
import {test, expect} from '@playwright/test';
import {noOverflow, state} from './helpers.mjs';

/** Open the wizard on a fresh device and wait for boot. */
async function openSetup(page) {
  await page.goto('/#/setup');
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
  await expect(page.locator('.setup-page')).toBeVisible();
}

const onStep = (page, key) => expect(page.locator(`.setup-page.step-${key}`)).toBeVisible();
const next = page => page.locator('[data-action="setup-next"]').click();
const skip = page => page.locator('[data-action="setup-skip"]').click();
const back = page => page.locator('[data-action="setup-back"]').click();

/** The brand mark + permanent credit are on every wizard page. */
async function branded(page) {
  await expect(page.locator('.setup-page .brand-mark').first()).toHaveText('MYS');
  await expect(page.locator('.setup-page .credit-badge').first()).toBeVisible();
  await expect(page.locator('.setup-page .credit-badge').first()).toHaveText('created by viraj');
}

test.describe('Setup wizard', () => {
  test('every step answered → themed stall opens with menu, team, UPI and event', async ({page}) => {
    await openSetup(page);
    await onStep(page, 'name');
    await branded(page);
    await noOverflow(page, 'name step');
    await expect(page.locator('.setup-progress .setup-pstep')).toHaveCount(7);
    await expect(page.locator('.setup-pstep[aria-current="step"]')).toHaveCount(1);

    // Stall name is required.
    await next(page);
    await expect(page.locator('[data-setup-error]')).toBeVisible();
    await expect(page.locator('#setup-stallName')).toHaveAttribute('aria-invalid', 'true');
    await onStep(page, 'name');

    await page.locator('#setup-stallName').fill('Chatpata <b>Corner</b>');
    await expect(page.locator('[data-setup-error]')).toBeHidden();
    await page.locator('#setup-booth').fill('10');
    await expect(page.locator('#setup-booth-hint')).toContainText('Stall No. 10');
    await page.locator('#setup-booth').press('Enter'); // Enter = Next
    await onStep(page, 'menu');

    // Step 2 — themes as hero cards; pick Sweet Tooth.
    await expect(page.locator('.setup-theme')).toHaveCount(7);
    await expect(page.locator('.setup-theme .setup-theme-art').first()).toBeVisible();
    await expect(page.locator('#setup-starter')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#setup-prices')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#setup-theme-sweet-tooth').click();
    await expect(page.locator('#setup-theme-sweet-tooth')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.setup-theme[aria-pressed="true"]')).toHaveCount(1);
    await noOverflow(page, 'menu step');
    await next(page);

    // Step 3 — where & when.
    await onStep(page, 'event');
    await page.locator('#setup-eventName').fill('Diwali Mela');
    await page.locator('#setup-venue').fill('College ground');
    await page.locator('#setup-city').fill('Jabalpur');
    await page.locator('#setup-eventDate').fill('2026-11-08');
    await noOverflow(page, 'event step');
    await next(page);

    // Step 4 — team: owner + partner chips (Enter adds a chip, doesn't move on).
    await onStep(page, 'team');
    await page.locator('#setup-ownerName').fill('Viraj');
    await page.locator('#setup-partner').fill('Aman');
    await page.locator('#setup-partner').press('Enter');
    await onStep(page, 'team');
    await page.locator('#setup-partner').fill('Riya');
    await page.locator('[data-action="setup-partner-add"]').click();
    await expect(page.locator('.setup-partner')).toHaveCount(2);
    await page.locator('#setup-partner').fill('aman');
    await page.locator('[data-action="setup-partner-add"]').click();
    await expect(page.locator('[data-setup-error]')).toContainText('already');
    await page.locator('#setup-partner').fill('');
    await page.locator('.setup-partner', {hasText: 'Aman'}).click(); // tap a chip to remove it
    await expect(page.locator('.setup-partner')).toHaveCount(1);
    await expect(page.locator('.setup-partner')).toHaveText(/Riya/);
    await noOverflow(page, 'team step');
    await next(page);

    // Step 5 — UPI validation.
    await onStep(page, 'upi');
    await page.locator('#setup-upiId').fill('not a upi');
    await next(page);
    await expect(page.locator('[data-setup-error]')).toContainText('UPI');
    await expect(page.locator('#setup-upiId')).toHaveAttribute('aria-invalid', 'true');
    await onStep(page, 'upi');
    await page.locator('#setup-upiId').fill('chatpata@okaxis');
    await page.locator('#setup-payeeName').fill('Chatpata Corner');
    await expect(page.locator('.setup-page')).toContainText('never checks your bank');
    await noOverflow(page, 'upi step');
    await next(page);

    // Step 6 — keep it on this phone only.
    await onStep(page, 'cloud');
    await page.locator('#setup-choice-local').click();
    await expect(page.locator('#setup-choice-local')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#setup-next')).toContainText('Create my stall');
    await noOverflow(page, 'cloud step');
    await next(page);

    // Step 7 — ready: summary + confetti.
    await onStep(page, 'ready');
    await branded(page);
    const ready = page.locator('.setup-page');
    await expect(ready).toContainText('Your stall is ready');
    await expect(ready.locator('.setup-stall-name')).toHaveText('Chatpata <b>Corner</b>'); // escaped, shown literally
    await expect(ready).toContainText('Stall No. 10');
    await expect(ready).toContainText('Diwali Mela · College ground · Jabalpur · 8 Nov 2026');
    await expect(ready).toContainText('Viraj, Riya');
    await expect(ready).toContainText('chatpata@okaxis');
    await expect(ready).toContainText('13 items');
    await expect(ready).toContainText('Saved on this phone');
    await expect(page.locator('.setup-confetti i').first()).toBeAttached();
    await noOverflow(page, 'ready step');

    await page.locator('#setup-open').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.setup-page')).toHaveCount(0);
    await expect(page.locator('#sheet[open]')).toHaveCount(0); // onboarded: no first-run sheet
    await expect(page.locator('.sell-hero-art').first()).toBeVisible();
    await expect(page.locator('.event-title').first()).toHaveText('Chatpata <b>Corner</b> · Stall No. 10');

    const st = await state(page);
    expect(st.onboarded).toBe(true);
    const c = st.config;
    expect(c.profile).toMatchObject({stallName: 'Chatpata <b>Corner</b>', booth: 'Stall No. 10', eventName: 'Diwali Mela',
      venue: 'College ground', city: 'Jabalpur', eventDate: '2026-11-08', ownerName: 'Viraj'});
    expect(c.templateId).toBe('sweet-tooth');
    expect(c.theme.themeId).toBe('sweet-tooth');
    expect(c.theme.accent.toUpperCase()).toBe('#FF4D87');
    expect(c.theme.heroArt).toEqual(['kulfi', 'brownie-sundae', 'milkshake']);
    expect(c.products.find(p => p.id === 'brownie-sundae')?.price).toBe(9000);
    expect(c.upi).toEqual({id: 'chatpata@okaxis', payeeName: 'Chatpata Corner'});
    expect(c.operators).toEqual(['Viraj', 'Riya']);
    expect(c.operator).toBe('Viraj');
    expect(c.team.members.map(m => m.name)).toEqual(['Viraj', 'Riya']);

    // The wizard starts fresh next time.
    expect(await page.evaluate(() => sessionStorage.getItem('mys-setup'))).toBeNull();
  });

  test('only a name: no stall number, blank-menu theme, every optional step skipped', async ({page}) => {
    await openSetup(page);
    await page.locator('#setup-stallName').fill('Solo Stall');
    await page.locator('#setup-booth').fill('22');
    await page.locator('#setup-nobooth').click();
    await expect(page.locator('#setup-nobooth')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#setup-booth')).toBeDisabled();
    await expect(page.locator('#setup-booth')).toHaveValue('');
    await expect(page.locator('.setup-pstep')).toHaveCount(7);
    await next(page);

    await onStep(page, 'menu');
    await page.locator('#setup-theme-chai-maggi').click();
    await page.locator('#setup-starter').click();
    await expect(page.locator('#setup-starter')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#setup-prices')).toBeDisabled();
    await next(page);

    await onStep(page, 'event');
    await page.locator('#setup-eventName').fill('Typed then skipped');
    await skip(page);
    await onStep(page, 'team');
    await skip(page);
    await onStep(page, 'upi');
    await page.locator('#setup-upiId').fill('bad upi'); // skipping ignores an unfinished answer
    await skip(page);
    await onStep(page, 'cloud');
    await expect(page.locator('.setup-pstep.is-skipped')).toHaveCount(3);
    await page.locator('#setup-choice-local').click();
    await next(page);

    await onStep(page, 'ready');
    await expect(page.locator('.setup-page')).toContainText('Empty Chai, Coffee & Maggi Point menu');
    await expect(page.locator('.setup-page')).toContainText('Just you for now');
    await expect(page.locator('.setup-page')).toContainText('Cash for now');
    await expect(page.locator('.setup-stall-booth')).toBeHidden();
    await noOverflow(page, 'ready (minimal)');
    await page.locator('#setup-open').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.event-title').first()).toHaveText('Solo Stall');

    const st = await state(page);
    const c = st.config;
    expect(st.onboarded).toBe(true);
    expect(c.profile.booth).toBe('');
    expect(c.profile.eventName).toBe('');
    expect(c.profile.tagline).toBe('Kadak chai. Hot Maggi. Happy campus.');
    expect(c.theme.themeId).toBe('chai-maggi');
    expect(c.templateId).toBe('blank');
    expect(c.products).toHaveLength(0);
    expect(c.upi.id).toBe('');
    expect(c.operators.length).toBeGreaterThan(0);
    expect(c.team.members).toHaveLength(0);
  });

  test('a refresh mid-wizard keeps every answer (never the password); suggested prices off', async ({page}) => {
    await openSetup(page);
    await page.locator('#setup-stallName').fill('Refresh Ka Raja');
    await page.locator('#setup-booth').fill('B-12');
    await next(page);
    await page.locator('#setup-theme-momo-corner').click();
    await page.locator('#setup-prices').click();
    await expect(page.locator('#setup-prices')).toHaveAttribute('aria-pressed', 'false');
    await next(page);
    await page.locator('#setup-eventName').fill('Holi Fest');

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
    await onStep(page, 'event');
    await expect(page.locator('#setup-eventName')).toHaveValue('Holi Fest');
    await expect(page.locator('.setup-stall-name').first()).toHaveText('Refresh Ka Raja');
    await back(page);
    await onStep(page, 'menu');
    await expect(page.locator('#setup-theme-momo-corner')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#setup-prices')).toHaveAttribute('aria-pressed', 'false');
    await back(page);
    await onStep(page, 'name');
    await expect(page.locator('#setup-stallName')).toHaveValue('Refresh Ka Raja');
    await expect(page.locator('#setup-booth')).toHaveValue('B-12');

    // Jump ahead to the cloud step; a typed password never survives a refresh.
    for (const key of ['name', 'menu', 'event', 'team', 'upi']) {
      await onStep(page, key);
      await next(page);
    }
    await onStep(page, 'cloud');
    const account = page.locator('#setup-choice-account');
    if (await account.isEnabled()) {
      await account.click();
      await page.locator('#setup-password').fill('secret-pass-123');
      await page.locator('[data-action="setup-pw"]').click();
      await expect(page.locator('#setup-password')).toHaveAttribute('type', 'text');
      expect(await page.evaluate(() => sessionStorage.getItem('mys-setup'))).not.toContain('secret-pass-123');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
      await onStep(page, 'cloud');
      await expect(page.locator('#setup-password')).toHaveValue('');
    }
    await page.locator('#setup-choice-local').click();
    await next(page);
    await onStep(page, 'ready');
    await expect(page.locator('.setup-page')).toContainText('prices to set');

    // A refresh on the Ready step still offers "Open my stall".
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
    await onStep(page, 'ready');
    await page.locator('#setup-open').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    const c = (await state(page)).config;
    expect(c.profile.booth).toBe('B-12');
    expect(c.profile.eventName).toBe('Holi Fest');
    expect(c.theme.themeId).toBe('momo-corner');
    expect(c.products.length).toBeGreaterThan(5);
    expect(c.products.every(p => p.price === null)).toBe(true);
  });

  test('signed out → create an MYS account inline and save the new stall to the cloud', async ({page}, info) => {
    test.skip(info.project.name !== 'desktop', 'creates a real account on the dev deployment; run once');
    await openSetup(page);
    const ready = await page.evaluate(() => import('/cloud.mjs').then(m => typeof m.signUp === 'function' && m.cloudReady()));
    test.skip(!ready, 'cloud client not available');
    await page.locator('#setup-stallName').fill('Cloud Chaat');
    await next(page);
    await next(page);
    await skip(page);
    await page.locator('#setup-ownerName').fill('Tester');
    await next(page);
    await skip(page);
    await onStep(page, 'cloud');
    await page.locator('#setup-choice-account').click();
    await expect(page.locator('#setup-accName')).toHaveValue('Tester');
    const loginId = `test-setup-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await page.locator('#setup-loginId').fill(loginId);
    await page.locator('#setup-password').fill('123'); // too short
    await next(page);
    await expect(page.locator('[data-setup-error]')).toContainText('6');
    await page.locator('#setup-password').fill('fest-pass-2026');
    await page.locator('#setup-password').press('Enter');
    await onStep(page, 'ready');
    await expect(page.locator('.setup-sum-row.is-synced')).toBeVisible({timeout: 30000});
    await expect(page.locator('.setup-page')).toContainText('Saved to your account');

    // Tidy up the cloud copy, then open the stall.
    const entryId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mys-setup') || '{}').created?.id);
    expect(entryId).toBeTruthy();
    await page.locator('#setup-open').click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await page.evaluate(id => import('/cloud.mjs').then(async m => {
      try {
        await m.removeCloudStall(id);
      } finally {
        await m.logOut();
      }
    }), entryId);
  });
});
