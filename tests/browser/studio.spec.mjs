// "Customize My Stall" (Stall Studio) + onboarding acceptance tests (studio agent, ARCHITECTURE.md §13.8 + §16).
import {test, expect} from '@playwright/test';
import {act, sheet, ready, go, adminClick, unlockAdmin, noOverflow, state, runAction} from './helpers.mjs';

/** @param {import('@playwright/test').Page} page */
const isPhone = page => (page.viewportSize()?.width || 1440) < 768;

/** Put a priced line (and optionally a discount) in the cart of both ledgers, straight through the kernel. */
async function cartWithDiscount(page, spec) {
  await page.evaluate(async s => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      for (const mode of ['live', 'demo']) {
        const ses = st[mode];
        d.addToDraft(ses, st.config, d.makeLine(st.config, 'veggie-chips-chaat-small', {quantity: 3}));
        const ruleSpec = s === 'first' ? {ruleId: st.config.discounts[0].id} : s;
        d.setDraftDiscount(ses, st.config, ruleSpec);
      }
    });
  }, spec);
}

/** One paid order in the current ledger. */
async function oneOrder(page) {
  await page.evaluate(async () => {
    const core = await import('/ui/core.mjs');
    const d = await import('/domain.mjs');
    await core.commit(st => {
      const s = st[st.mode];
      d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'veggie-chips-chaat-small')], method: 'Cash'});
    });
  });
}

/** Add partners straight through the catalog (fast setup). */
async function addPartners(page, names) {
  await page.evaluate(async list => {
    const core = await import('/ui/core.mjs');
    const cat = await import('/catalog.mjs');
    await core.commitConfig(st => {
      for (const name of list) cat.addMember(st.config, {name});
    });
  }, names);
}

/** Open Studio scrolled to a section. */
async function openStudio(page, section = '') {
  await runAction(page, 'studio-open', section ? {section} : {});
  await expect(page.locator('#main.screen-studio')).toBeVisible();
}

const cssVar = (page, name) => page.evaluate(n => document.documentElement.style.getPropertyValue(n), name);

test.describe('customize my stall & onboarding', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('fresh device: onboarding picks Chai & Maggi and names the stall', async ({page}) => {
    await ready(page, {onboarding: 'keep'});
    const dlg = sheet(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.onb-dots')).toBeVisible();
    await expect(dlg.locator('[data-action="onb-skip"]')).toBeVisible();
    await expect(dlg.locator('.studio-theme-card')).toHaveCount(7); // 6 themes + blank
    await expect(dlg.locator('.studio-theme-card .studio-hero svg').first()).toBeVisible();
    await expect(dlg.locator('#onb-tpl-street-chaat')).toBeChecked();
    await noOverflow(page, 'onboarding step 1');

    await dlg.locator('label[for="onb-tpl-chai-maggi"]').click();
    await expect(dlg.locator('#onb-tpl-chai-maggi')).toBeChecked();
    await expect(dlg.locator('#onb-prices')).toBeChecked();
    await dlg.locator('[data-action="onb-next"]').click();

    // Step 2: name it (tagline follows the chosen theme).
    await expect(dlg.locator('#onb-tagline')).toHaveValue('Kadak chai. Hot Maggi. Happy campus.');
    await dlg.locator('#onb-stallName').fill('Chai Sutta Point');
    await dlg.locator('#onb-booth').fill('Booth B-12');
    if (!isPhone(page)) await expect(dlg.locator('[data-onb-pv="title"]')).toHaveText('Chai Sutta Point · Booth B-12');
    await noOverflow(page, 'onboarding step 2');
    await dlg.locator('[data-action="onb-next"]').click();

    // Step 3: ready tips, Back keeps typed values.
    await expect(dlg.locator('.onb-tips [data-to="prices"]')).toBeVisible();
    await expect(dlg.locator('.onb-tips [data-to="upi"]')).toBeVisible();
    await dlg.locator('[data-action="onb-back"]').click();
    await expect(dlg.locator('#onb-stallName')).toHaveValue('Chai Sutta Point');
    await dlg.locator('[data-action="onb-next"]').click();
    await noOverflow(page, 'onboarding step 3');

    await dlg.locator('[data-action="onb-finish"]').click(); // first run: no PIN
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);

    await expect(page.locator('.event-title:visible')).toContainText('Chai Sutta Point');
    await expect(page).toHaveTitle('Chai Sutta Point · ManageYourStall');
    await expect(page.locator('#main.screen-sell')).toContainText('Kadak chai. Hot Maggi. Happy campus.');
    const st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.pin).toBeNull();
    expect(st.config.templateId).toBe('chai-maggi');
    expect(st.config.theme.themeId).toBe('chai-maggi');
    expect(st.config.profile.booth).toBe('Booth B-12');
    expect(st.config.theme.accent).toBe('#FF9F43');
    expect(st.config.team.members).toEqual([]);
    expect(st.config.products.some(p => p.name === 'Masala Chai' && p.price !== null)).toBe(true);

    // Reload: onboarding stays closed.
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
  });

  test('onboarding with Momo Corner + partner names creates the team', async ({page}) => {
    await ready(page, {onboarding: 'keep'});
    const dlg = sheet(page);
    await dlg.locator('label[for="onb-tpl-momo-corner"]').click();
    await dlg.locator('#onb-prices').uncheck();
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('#onb-stallName').fill('Momo Mafia');
    await dlg.locator('#onb-partners').fill('Aarav, Diya\nKabir\n aarav ');
    await expect(dlg.locator('[data-onb-partners]')).toContainText('3 partners');
    await dlg.locator('[data-action="onb-next"]').click();
    await expect(dlg.locator('.onb-ready')).toContainText('3 partners');
    await dlg.locator('[data-action="onb-finish"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);

    const st = await state(page);
    expect(st.config.templateId).toBe('momo-corner');
    expect(st.config.theme).toMatchObject({themeId: 'momo-corner', accent: '#7EE0B5', heroTint: 'mint'});
    expect(st.config.profile.stallName).toBe('Momo Mafia');
    expect(st.config.team.members.map(m => m.name)).toEqual(['Aarav', 'Diya', 'Kabir']);
    expect(new Set(st.config.team.members.map(m => m.color)).size).toBe(3);
    expect(st.config.products.length).toBeGreaterThan(0);
    expect(st.config.products.every(p => p.price === null)).toBe(true);
    expect(st.pin).toBeNull();

    // The partners show up in Studio › Team.
    await openStudio(page, 'team');
    await expect(page.locator('#studio-team .studio-member')).toHaveCount(3);
  });

  test('onb-skip keeps the sample stall; onb-open reopens the flow', async ({page}) => {
    await ready(page, {onboarding: 'keep'});
    await sheet(page).locator('[data-action="onb-skip"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    let st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.config.templateId).toBe('street-chaat');
    expect(st.config.profile.stallName).toBe('My Awesome Stall');

    await openStudio(page);
    await expect(page.locator('#main h1')).toHaveText('Customize My Stall');
    await act(page, 'onb-open').click();
    await expect(sheet(page).locator('.onb-dots')).toBeVisible();
    await expect(sheet(page).locator('#onb-tpl-street-chaat')).toBeChecked();
    await sheet(page).locator('[data-action="onb-skip"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.config.templateId).toBe('street-chaat');
  });

  test('theme look only: --accent/--secondary and the Sell hero change, the menu stays', async ({page}) => {
    await ready(page);
    const before = await state(page);
    await go(page, 'sell');
    const heroBefore = await page.locator('.sell-hero-art svg').first().innerHTML();
    await openStudio(page, 'themes');
    const sec = page.locator('#studio-themes');
    await expect(sec.locator('.studio-theme-card')).toHaveCount(7);
    await expect(sec.locator('.studio-theme-card[data-id="street-chaat"] .studio-theme-current')).toBeVisible();
    await expect(sec.locator('.studio-theme-card .studio-dot')).toHaveCount(14);

    await sec.locator('.studio-theme-card[data-id="momo-corner"]').click();
    const dlg = sheet(page);
    await expect(dlg).toHaveAttribute('data-kind', 'studio-theme');
    await expect(dlg.locator('#studio-theme-menu')).not.toBeChecked();
    await expect(dlg.locator('[data-ts-prices]')).toBeHidden();
    await noOverflow(page, 'theme sheet');
    await adminClick(page, dlg.locator('[data-action="studio-theme-apply"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);

    await expect.poll(() => cssVar(page, '--accent')).toBe('#7EE0B5');
    expect(await cssVar(page, '--secondary')).toBe('#FF6B5B');
    const st = await state(page);
    expect(st.config.theme).toMatchObject({themeId: 'momo-corner', heroArt: ['frankie-roll', 'steamed-momos', 'burger'], heroTint: 'mint'});
    expect(st.config.templateId).toBe('street-chaat');
    expect(st.config.products.map(p => p.id)).toEqual(before.config.products.map(p => p.id));
    await expect(sec.locator('.studio-theme-card[data-id="momo-corner"] .studio-theme-current')).toBeVisible();

    await go(page, 'sell');
    await expect(page.locator('.sell-hero')).toHaveClass(/tint-mint/);
    const heroAfter = await page.locator('.sell-hero-art svg').first().innerHTML();
    expect(heroAfter).not.toBe(heroBefore);
    await expect(page.locator('#main.screen-sell')).toContainText('Veggie Chips Chaat');
  });

  test('theme with starter menu replaces the menu and keeps order history', async ({page}) => {
    await ready(page);
    await oneOrder(page);
    await openStudio(page, 'templates'); // old alias scrolls to Themes
    await expect(page.locator('#studio-themes')).toBeInViewport();
    await expect(page.locator('.studio-chips .chip.active')).toHaveText(/Themes/);
    await page.locator('#studio-themes .studio-theme-card[data-id="chai-maggi"]').click();
    const dlg = sheet(page);
    await dlg.locator('#studio-theme-menu').check();
    await expect(dlg.locator('[data-ts-prices]')).toBeVisible();
    await dlg.locator('#studio-theme-prices').uncheck();
    await expect(dlg).toContainText('Sales history stays');
    await adminClick(page, dlg.locator('[data-action="studio-theme-apply"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const st = await state(page);
    expect(st.config.templateId).toBe('chai-maggi');
    expect(st.config.theme.themeId).toBe('chai-maggi');
    expect(st.live.orders.length).toBe(1);
    expect(st.live.payments.length).toBe(1);
    const chai = st.config.products.find(p => p.name === 'Masala Chai');
    expect(chai).toBeTruthy();
    expect(chai.price).toBeNull(); // suggested prices left out
    expect(st.config.products.some(p => p.id === 'veggie-chips-chaat-small')).toBe(false);
    expect(st.config.profile.stallName).toBe('My Awesome Stall');
  });

  test('stall photo upload shows an <img> hero on Sell; remove brings the art back', async ({page}) => {
    await ready(page);
    await openStudio(page, 'themes');
    const sec = page.locator('#studio-photo');
    await expect(sec.locator('img')).toHaveCount(0);
    // A big photo (2400×1600) — compressed to ≤1600 px JPEG before it is stored.
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2400;
      c.height = 1600;
      const x = c.getContext('2d');
      for (let i = 0; i < 40; i++) {
        x.fillStyle = `hsl(${i * 9} 80% 60%)`;
        x.fillRect((i % 8) * 300, Math.floor(i / 8) * 320, 300, 320);
      }
      return c.toDataURL('image/png').split(',')[1];
    });
    await sec.locator('#studio-photo-input').setInputFiles({name: 'stall.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64')});
    await unlockAdmin(page);
    await expect(sec.locator('img.studio-hero-img')).toBeVisible();
    let st = await state(page);
    expect(st.config.theme.heroImage).toMatch(/^media:/);
    const size = await page.evaluate(async ref => {
      const core = await import('/ui/core.mjs');
      const img = new Image();
      img.src = core.mediaUrl(ref);
      await img.decode();
      const blob = await fetch(img.src).then(r => r.blob());
      return {w: img.naturalWidth, h: img.naturalHeight, bytes: blob.size, type: blob.type};
    }, st.config.theme.heroImage);
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(1600);
    expect(size.bytes).toBeLessThanOrEqual(400 * 1024);
    expect(size.type).toBe('image/jpeg');

    await go(page, 'sell');
    await expect(page.locator('.sell-hero img')).toBeVisible();

    await openStudio(page, 'themes');
    await page.locator('[data-action="studio-photo-remove"]').click();
    await expect(page.locator('#studio-photo img')).toHaveCount(0);
    st = await state(page);
    expect(st.config.theme.heroImage).toBeNull();
    await go(page, 'sell');
    await expect(page.locator('.sell-hero img')).toHaveCount(0);
  });

  test('colours: accent + secondary swatches preview, then save', async ({page}) => {
    await ready(page);
    await openStudio(page, 'look');
    await expect(page.locator('#studio-themes')).toBeInViewport();
    const sec = page.locator('#studio-look');
    await sec.locator('[data-action="studio-accent"][data-slot="accent"][data-color="#7EE0B5"]').click();
    await sec.locator('[data-action="studio-accent"][data-slot="secondary"][data-color="#8FD3FF"]').click();
    await expect(sec.locator('[data-slot="accent"][data-color="#7EE0B5"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(sec.locator('[data-slot="secondary"][data-color="#8FD3FF"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(sec.locator('[data-dirty="look"]')).toBeVisible();
    await expect(sec.locator('[data-look-preview]')).toHaveAttribute('style', /--pv2:\s*#8FD3FF/i);
    // Not applied app-wide until saved.
    expect(await cssVar(page, '--accent')).toBe('#FFDD35');
    await adminClick(page, sec.locator('[data-action="studio-save-look"]'));
    await expect.poll(() => cssVar(page, '--accent')).toBe('#7EE0B5');
    expect(await cssVar(page, '--secondary')).toBe('#8FD3FF');
    const st = await state(page);
    expect(st.config.theme).toMatchObject({accent: '#7EE0B5', secondary: '#8FD3FF', themeId: 'street-chaat'});
    await expect(sec.locator('[data-dirty="look"]')).toBeHidden();
  });

  test('profile edits preview live, ask for the PIN and update topbar + title', async ({page}) => {
    await ready(page);
    await openStudio(page, 'profile');
    const sec = page.locator('#studio-profile');
    await expect(sec.locator('[data-dirty="profile"]')).toBeHidden();
    await sec.locator('#studio-p-stallName').fill('Momo Mafia');
    await sec.locator('#studio-p-booth').fill('Stall No. 7');
    await sec.locator('#studio-p-tagline').fill('Steam. Dip. Repeat.');
    await sec.locator('#studio-p-initials').fill('MM');
    await sec.locator('#studio-p-eventDate').fill('2026-11-08');
    await expect(sec.locator('[data-dirty="profile"]')).toBeVisible();
    await expect(sec.locator('[data-pv="title"]')).toHaveText('Momo Mafia · Stall No. 7');
    await expect(sec.locator('[data-pv="tagline"]')).toHaveText('Steam. Dip. Repeat.');
    await expect(sec.locator('[data-pv="initials"]')).toHaveText('MM');
    await expect(sec.locator('[data-pv="sub"]')).toContainText('8 Nov 2026');

    // Typed values survive an unrelated re-render.
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.render()));
    await expect(sec.locator('#studio-p-stallName')).toHaveValue('Momo Mafia');

    // A blank name is refused inline; nothing is lost.
    await sec.locator('#studio-p-stallName').fill('  ');
    await adminClick(page, sec.locator('[data-action="studio-save-profile"]'));
    await expect(sec.locator('[data-studio-error="profile"]')).toContainText('name');
    await sec.locator('#studio-p-stallName').fill('Momo Mafia');
    await adminClick(page, sec.locator('[data-action="studio-save-profile"]'));
    await expect(sec.locator('[data-dirty="profile"]')).toBeHidden();
    await expect(page.locator('.event-title:visible')).toContainText('Momo Mafia · Stall No. 7');
    await expect(page).toHaveTitle('Momo Mafia · ManageYourStall');
    await expect(page.locator('button.avatar')).toHaveText('MM');
    const st = await state(page);
    expect(st.config.profile).toMatchObject({stallName: 'Momo Mafia', booth: 'Stall No. 7', tagline: 'Steam. Dip. Repeat.', eventDate: '2026-11-08'});
    expect(st.pin).not.toBeNull();
  });

  test('UPI ID is validated and draws a test QR', async ({page}) => {
    await ready(page);
    await openStudio(page, 'upi');
    const sec = page.locator('#studio-upi');
    await expect(sec.locator('[data-test-qr]')).toHaveCount(0);
    await sec.locator('#studio-upi-id').fill('not a upi');
    await expect(sec.locator('#studio-upi-id')).toHaveAttribute('aria-invalid', 'true');
    await expect(sec.locator('[data-test-qr]')).toHaveCount(0);
    await adminClick(page, sec.locator('[data-action="studio-save-upi"]'));
    await expect(sec.locator('[data-studio-error="upi"]')).toBeVisible();
    expect((await state(page)).config.upi.id).toBe('');

    await sec.locator('#studio-upi-id').fill('momomafia@okaxis');
    await sec.locator('#studio-upi-payee').fill('Momo Mafia');
    await expect(sec.locator('#studio-upi-id')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(sec.locator('[data-test-qr] svg')).toBeVisible();
    await expect(sec).toContainText('don’t pay');
    await expect(sec).toContainText('never sees your bank');
    await adminClick(page, sec.locator('[data-action="studio-save-upi"]'));
    await expect(sec.locator('[data-studio-error="upi"]')).toBeHidden();
    expect((await state(page)).config.upi).toEqual({id: 'momomafia@okaxis', payeeName: 'Momo Mafia'});
    await expect(sec.locator('[data-test-qr] svg')).toBeVisible();
  });

  test('discounts: add, edit, toggle, reorder, delete — and stale cart discounts are cleared', async ({page}) => {
    await ready(page);
    await openStudio(page, 'discounts');
    const sec = page.locator('#studio-discounts');
    const before = (await state(page)).config.discounts.length;

    await sec.locator('.studio-list-foot [data-action="studio-disc-edit"]').click();
    await sheet(page).locator('#studio-disc-label').fill('Stall buddy ₹5 off');
    await sheet(page).locator('#studio-disc-value').fill('5');
    await adminClick(page, sheet(page).locator('[data-action="studio-disc-save"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(sec.locator('.studio-disc-row')).toHaveCount(before + 1);
    let st = await state(page);
    const added = st.config.discounts.at(-1);
    expect(added).toMatchObject({label: 'Stall buddy ₹5 off', type: 'flat', value: 500, minimum: 0, active: true});

    // Edit → 10% off on ₹150+
    await sec.locator(`[data-action="studio-disc-edit"][data-id="${added.id}"]`).click();
    await sheet(page).locator('label.choice', {hasText: '% off'}).click();
    await sheet(page).locator('#studio-disc-value').fill('10');
    await sheet(page).locator('#studio-disc-min').fill('150');
    await adminClick(page, sheet(page).locator('[data-action="studio-disc-save"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.config.discounts.at(-1)).toMatchObject({id: added.id, type: 'percent', value: 10, minimum: 15000});

    // Invalid percent is refused in the sheet.
    await sec.locator(`[data-action="studio-disc-edit"][data-id="${added.id}"]`).click();
    await sheet(page).locator('#studio-disc-value').fill('150');
    await adminClick(page, sheet(page).locator('[data-action="studio-disc-save"]'));
    await expect(sheet(page).locator('[data-error]')).toContainText('1 to 100');
    await sheet(page).locator('[data-action="close"]').first().click();

    // Move up, toggle off.
    await adminClick(page, sec.locator(`[data-action="studio-disc-move"][data-id="${added.id}"][data-dir="-1"]`));
    await expect.poll(async () => (await state(page)).config.discounts.at(-2).id).toBe(added.id);
    await adminClick(page, sec.locator(`[data-action="studio-disc-active"][data-id="${added.id}"]`));
    await expect.poll(async () => (await state(page)).config.discounts.find(d => d.id === added.id).active).toBe(false);

    // Delete (confirm).
    await adminClick(page, sec.locator(`[data-action="studio-disc-delete"][data-id="${added.id}"]`));
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(sec.locator('.studio-disc-row')).toHaveCount(before);

    // Deleting a discount that sits on a cart clears it from both carts.
    await cartWithDiscount(page, 'first');
    st = await state(page);
    const first = st.config.discounts[0];
    expect(st.live.draftDiscount).toEqual({ruleId: first.id});
    await sec.locator(`[data-action="studio-disc-delete"][data-id="${first.id}"]`).click();
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.live.draftDiscount).toBeNull();
    expect(st.demo.draftDiscount).toBeNull();
    expect(st.live.draft.length).toBe(1); // cart items stay

    // Turning custom discounts off clears a custom cart discount too.
    if (!st.config.allowCustomDiscount) {
      await sec.locator('[data-action="studio-custom-toggle"]').click();
      await expect.poll(async () => (await state(page)).config.allowCustomDiscount).toBe(true);
    }
    await cartWithDiscount(page, {custom: true, type: 'flat', value: 1000});
    await sec.locator('[data-action="studio-custom-toggle"]').click();
    await expect.poll(async () => (await state(page)).config.allowCustomDiscount).toBe(false);
    st = await state(page);
    expect(st.live.draftDiscount).toBeNull();
    expect(st.demo.draftDiscount).toBeNull();
  });

  test('mission: ledger mode follows the bills; planned list and total still work', async ({page}) => {
    await ready(page);
    const mission = () => page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      return d.report(core.S(), core.C()).mission;
    });
    expect((await mission()).mode).toBe('ledger');
    // Two bills (one voided later would not count) recorded in the ledger.
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'Stall rent', category: 'rent', amount: 150000});
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'Ice & water', category: 'restock', amount: 25050});
      });
    });
    await openStudio(page, 'mission');
    const sec = page.locator('#studio-mission');
    await expect(sec.locator('#studio-mm-ledger')).toHaveAttribute('aria-pressed', 'true');
    await expect(sec).toContainText('Recommended');
    await expect(sec.locator('[data-mission-bills]')).toHaveText('₹1,750.50');
    await expect(sec.locator('[data-mission-target]')).toHaveText('₹1,750.50');
    await expect(sec.locator('[data-action="money-open"][data-tab="bills"]')).toBeVisible();
    await expect(sec).toContainText('Suggested bills');
    expect((await mission()).target).toBe(175050);

    // Planned list: Σ items + bills on top.
    await sec.locator('[data-action="studio-mission-mode"][data-mode="itemized"]').click();
    await expect(sec.locator('[data-mission-sum]')).toHaveText('₹5,140');
    const firstAmount = sec.locator('[data-mi] input[data-key="amount"]').first();
    await firstAmount.fill('2000'); // stall rent 1500 → 2000
    await expect(sec.locator('[data-mission-sum]')).toHaveText('₹5,640');
    await expect(sec.locator('[data-mission-target]')).toHaveText('₹7,390.50');
    await expect(sec.locator('[data-dirty="mission"]')).toBeVisible();
    await sec.locator('[data-action="studio-mission-add"][data-label="Gas & fuel"]').click();
    const gas = sec.locator('[data-mi]').last();
    await expect(gas.locator('input[data-key="label"]')).toHaveValue('Gas & fuel');
    await gas.locator('input[data-key="amount"]').fill('250.50');
    await expect(sec.locator('[data-mission-sum]')).toHaveText('₹5,890.50');
    await sec.locator('[data-action="studio-mission-remove"]').nth(4).click(); // Helper cost ₹440
    await expect(sec.locator('[data-mission-sum]')).toHaveText('₹5,450.50');
    await adminClick(page, sec.locator('[data-action="studio-save-mission"]'));
    await expect(sec.locator('[data-dirty="mission"]')).toBeHidden();
    expect((await mission()).target).toBe(545050 + 175050);

    // One total amount.
    await sec.locator('[data-action="studio-mission-mode"][data-mode="total"]').click();
    await sec.locator('#studio-mission-total').fill('8000');
    await adminClick(page, sec.locator('[data-action="studio-save-mission"]'));
    await expect.poll(async () => (await mission()).target).toBe(800000 + 175050);

    // Back to bills: break-even = bills only, suggestions kept.
    await sec.locator('[data-action="studio-mission-mode"][data-mode="ledger"]').click();
    await adminClick(page, sec.locator('[data-action="studio-save-mission"]'));
    await expect.poll(async () => (await mission()).target).toBe(175050);
    const st = await state(page);
    expect(st.config.mission.mode).toBe('ledger');
    expect(st.config.mission.items.length).toBe(5);
  });

  test('partners: add, rename, recolour, remove, custom shares add up to 100', async ({page}) => {
    await ready(page);
    await openStudio(page, 'team');
    const sec = page.locator('#studio-partners');
    await expect(sec.locator('.empty-state')).toBeVisible();

    for (const name of ['Aarav', 'Diya', 'Kabir']) {
      await sec.locator('.studio-partner-actions [data-action="studio-member-edit"]').click();
      await sheet(page).locator('#studio-member-name').fill(name);
      if (name === 'Diya') await sheet(page).locator('label.studio-tint-choice', {hasText: 'Lavender'}).click();
      await adminClick(page, sheet(page).locator('[data-action="studio-member-save"]'));
      await expect(page.locator('#sheet[open]')).toHaveCount(0);
    }
    await expect(sec.locator('.studio-member')).toHaveCount(3);
    await expect(sec.locator('.studio-share-chip')).toHaveText(['34%', '33%', '33%']);
    let st = await state(page);
    const [aarav, diya, kabir] = st.config.team.members;
    expect(diya.color).toBe('lavender');

    // Duplicate names are refused in the sheet.
    await sec.locator('.studio-partner-actions [data-action="studio-member-edit"]').click();
    await sheet(page).locator('#studio-member-name').fill('aarav');
    await sheet(page).locator('[data-action="studio-member-save"]').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('already on the team');
    await sheet(page).locator('[data-action="close"]').first().click();

    // Rename + recolour.
    await sec.locator(`[data-action="studio-member-edit"][data-id="${kabir.id}"]`).click();
    await sheet(page).locator('#studio-member-name').fill('Kabir S');
    await sheet(page).locator('label.studio-tint-choice', {hasText: 'Mint'}).click();
    await sheet(page).locator('[data-action="studio-member-save"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.config.team.members[2]).toMatchObject({id: kabir.id, name: 'Kabir S', color: 'mint'});

    // Custom split with live validation.
    await sec.locator('[data-action="studio-split-mode"][data-mode="custom"]').click();
    await expect.poll(async () => (await state(page)).config.team.splitMode).toBe('custom');
    await expect(sec.locator('[data-share-sum]')).toContainText('100%');
    await sec.locator(`#studio-share-${aarav.id}`).fill('50');
    await sec.locator(`#studio-share-${diya.id}`).fill('30');
    await sec.locator(`#studio-share-${kabir.id}`).fill('10');
    await expect(sec.locator('[data-share-sum]')).toContainText('90%');
    await expect(sec.locator('[data-share-sum]')).not.toHaveClass(/ok/);
    await sec.locator('[data-action="studio-save-shares"]').click();
    await expect(sec.locator('[data-studio-error="shares"]')).toContainText('100%');
    await sec.locator(`#studio-share-${kabir.id}`).fill('20');
    await expect(sec.locator('[data-share-sum]')).toHaveClass(/ok/);
    await sec.locator('[data-action="studio-save-shares"]').click();
    await expect.poll(async () => (await state(page)).config.team.members.map(m => m.share)).toEqual([50, 30, 20]);

    // A partner with a bill can't be removed (friendly error); one without can.
    await page.evaluate(async id => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => d.addExpense(st[st.mode], st.config, {id: crypto.randomUUID(), title: 'Gas refill', category: 'restock', amount: 90000, paidBy: id}));
    }, aarav.id);
    await sec.locator(`[data-action="studio-member-remove"][data-id="${aarav.id}"]`).click();
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('Rename them instead');
    await sheet(page).locator('[data-action="close"]').first().click();
    expect((await state(page)).config.team.members.length).toBe(3);

    await page.locator('#studio-partners').locator('[data-action="studio-split-mode"][data-mode="equal"]').click();
    await expect.poll(async () => (await state(page)).config.team.splitMode).toBe('equal');
    await page.locator(`#studio-partners [data-action="studio-member-remove"][data-id="${diya.id}"]`).click();
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.config.team.members.map(m => m.name)).toEqual(['Aarav', 'Kabir S']);
    await expect(page.locator('#studio-partners .studio-share-chip')).toHaveText(['50%', '50%']);
  });

  test('copy partners to cashiers', async ({page}) => {
    await ready(page);
    await addPartners(page, ['Aarav', 'Team Stall']);
    await openStudio(page, 'team');
    await adminClick(page, page.locator('[data-action="studio-copy-partners"]'));
    await expect.poll(async () => (await state(page)).config.operators).toEqual(['Team Stall', 'Cashier 1', 'Cashier 2', 'Aarav']);
    await expect(page.locator('#studio-crew .studio-op-row')).toHaveCount(4);
  });

  test('cashiers: add, rename, remove, pick the cashier; kitchen queue toggle', async ({page}) => {
    await ready(page);
    await openStudio(page, 'team');
    const sec = page.locator('#studio-crew');
    await sec.locator('[data-action="studio-op-add"]').click();
    const inputs = sec.locator('.studio-op-row input[type="text"]');
    await expect(inputs).toHaveCount(4);
    await inputs.nth(3).fill('Rahul');
    await inputs.nth(1).fill('Priya');
    await sec.locator('.studio-op-row').nth(3).locator('.studio-op-current').click();
    await sec.locator('.studio-op-row').nth(2).locator('[data-action="studio-op-remove"]').click();
    await expect(inputs).toHaveCount(3);
    await expect(inputs.nth(1)).toHaveValue('Priya'); // typed values survive the re-render
    await adminClick(page, sec.locator('[data-action="studio-save-team"]'));
    await expect(sec.locator('[data-dirty="team"]')).toBeHidden();
    let st = await state(page);
    expect(st.config.operators).toEqual(['Team Stall', 'Priya', 'Rahul']);
    expect(st.config.operator).toBe('Rahul');
    if (!isPhone(page) && (page.viewportSize()?.width || 1440) >= 1024) await expect(page.locator('.operator-name')).toContainText('Rahul');

    expect(st.config.kitchenQueue).toBe(true);
    await adminClick(page, sec.locator('[data-action="studio-kitchen-toggle"]'));
    await expect.poll(async () => (await state(page)).config.kitchenQueue).toBe(false);
    await expect(sec.locator('[data-action="studio-kitchen-toggle"]')).toHaveAttribute('aria-pressed', 'false');
    st = await state(page);
    expect(st.config.operators.length).toBe(3);
  });

  test('cashiers: picking the cashier needs no PIN, and a switch made from the avatar sheet survives a save', async ({page}) => {
    await ready(page);
    await openStudio(page, 'team');
    const sec = page.locator('#studio-crew');
    await sec.locator('.studio-op-row').nth(1).locator('.studio-op-current').click();
    await sec.locator('[data-action="studio-save-team"]').click();
    await expect.poll(async () => (await state(page)).config.operator).toBe('Cashier 1');
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);
    expect((await state(page)).pin).toBeNull();

    await sec.locator('.studio-op-row input[type="text"]').nth(2).fill('Cashier Two');
    await page.locator('button.avatar').click();
    await sheet(page).locator('[data-action="save-operator"][data-name="Cashier 2"]').click();
    await expect.poll(async () => (await state(page)).config.operator).toBe('Cashier 2');
    await adminClick(page, sec.locator('[data-action="studio-save-team"]')); // list changed → PIN
    await expect(sec.locator('[data-dirty="team"]')).toBeHidden();
    const st = await state(page);
    expect(st.config.operators).toEqual(['Team Stall', 'Cashier 1', 'Cashier Two']);
    expect(st.config.operator).toBe('Cashier Two');
    expect(st.pin).not.toBeNull();
  });

  test('reopened onboarding: unchanged Finish just closes; changes ask for the admin PIN', async ({page}) => {
    await ready(page);
    await openStudio(page);
    await act(page, 'onb-open').click();
    const dlg = sheet(page);
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('[data-action="onb-finish"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);
    expect((await state(page)).pin).toBeNull();

    await runAction(page, 'onb-open');
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('#onb-stallName').fill('Tour Changed');
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('[data-action="onb-finish"]').click();
    await expect(page.locator('#pin-dialog[open]')).toBeVisible();
    await page.locator('#pin-dialog [data-pin-action="cancel"]').click();
    expect((await state(page)).config.profile.stallName).toBe('My Awesome Stall'); // cancelled → nothing changed
    await adminClick(page, dlg.locator('[data-action="onb-finish"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect((await state(page)).config.profile.stallName).toBe('Tour Changed');
  });

  test('money inputs explain negative and too-large amounts', async ({page}) => {
    await ready(page);
    await openStudio(page, 'games');
    await page.locator('#studio-games .studio-list-foot [data-action="studio-game-edit"]').click();
    await sheet(page).locator('#studio-game-name').fill('Lucky Cup');
    await sheet(page).locator('#studio-game-fee').fill('-5');
    await adminClick(page, sheet(page).locator('[data-action="studio-game-save"]'));
    await expect(sheet(page).locator('[data-error]')).toContainText('can’t be negative');
    await sheet(page).locator('#studio-game-fee').fill('99999999');
    await sheet(page).locator('[data-action="studio-game-save"]').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('is the most you can enter');
  });

  test('games: add, edit and delete', async ({page}) => {
    await ready(page);
    await openStudio(page, 'games');
    const sec = page.locator('#studio-games');
    const start = (await state(page)).config.games.length;
    await sec.locator('.studio-list-foot [data-action="studio-game-edit"]').click();
    await sheet(page).locator('#studio-game-name').fill('Ring Toss Pro');
    await sheet(page).locator('#studio-game-fee').fill('20');
    await sheet(page).locator('label.studio-art-choice', {hasText: 'Ring Toss'}).first().click();
    await adminClick(page, sheet(page).locator('[data-action="studio-game-save"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(sec.locator('.studio-game')).toHaveCount(start + 1);
    let st = await state(page);
    const ring = st.config.games.at(-1);
    expect(ring).toMatchObject({name: 'Ring Toss Pro', fee: 2000, art: 'ring-toss'});

    await sec.locator(`[data-action="studio-game-edit"][data-id="${ring.id}"]`).click();
    await expect(sheet(page).locator('#studio-game-fee')).toHaveValue('20');
    await sheet(page).locator('#studio-game-fee').fill('25');
    await adminClick(page, sheet(page).locator('[data-action="studio-game-save"]'));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    st = await state(page);
    expect(st.config.games.find(g => g.id === ring.id).fee).toBe(2500);
    await expect(sec).toContainText('₹25');

    await adminClick(page, sec.locator(`[data-action="studio-game-delete"][data-id="${ring.id}"]`));
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(sec.locator('.studio-game')).toHaveCount(start);
    expect((await state(page)).config.games.some(g => g.id === ring.id)).toBe(false);
  });

  test('studio-open scrolls to the section and lights its chip; no overflow anywhere', async ({page}) => {
    await ready(page);
    await addPartners(page, ['Aarav Mehta-Kulkarni', 'Diya']);
    await go(page, 'sell');
    await runAction(page, 'studio-open', {section: 'mission'});
    await expect(page.locator('#main.screen-studio')).toBeVisible();
    await expect(page.locator('#studio-mission')).toBeInViewport();
    await expect(page.locator('.studio-chips .chip.active')).toHaveText(/Mission/);
    await noOverflow(page, 'studio');

    // From the cashier sheet's "Manage team".
    await page.locator('button.avatar').click();
    await sheet(page).locator('[data-action="studio-open"][data-section="team"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(page.locator('#studio-team')).toBeInViewport();

    // Chips jump too.
    await page.locator('.studio-chips [data-section="upi"]').click();
    await expect(page.locator('#studio-upi')).toBeInViewport();

    // Custom split inputs fit.
    await adminClick(page, page.locator('#studio-partners [data-action="studio-split-mode"][data-mode="custom"]'));
    await expect(page.locator('#studio-partners .studio-share-field').first()).toBeVisible();
    await noOverflow(page, 'custom split');

    // Sheets fit as well.
    await page.locator('#studio-discounts .studio-list-foot [data-action="studio-disc-edit"]').click();
    await noOverflow(page, 'discount sheet');
    await sheet(page).locator('[data-action="close"]').first().click();
    await page.locator('#studio-games .studio-list-foot [data-action="studio-game-edit"]').click();
    await noOverflow(page, 'game sheet');
    await sheet(page).locator('[data-action="close"]').first().click();
    await page.locator('#studio-partners .studio-partner-actions [data-action="studio-member-edit"]').click();
    await noOverflow(page, 'partner sheet');
    await sheet(page).locator('[data-action="close"]').first().click();
    await page.locator('#studio-themes [data-action="studio-theme-pick"][data-id="drinks-games"]').click();
    await sheet(page).locator('#studio-theme-menu').check();
    await noOverflow(page, 'theme sheet');

    // Tap targets in Studio are at least 44px.
    await sheet(page).locator('[data-action="close"]').first().click();
    const small = await page.evaluate(() => [...document.querySelectorAll('#main.screen-studio button:not([disabled]), #main.screen-studio .studio-upload')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, t: el.textContent.trim().slice(0, 20) || el.getAttribute('aria-label')}))
      .filter(b => b.h < 40 || b.w < 40));
    expect(small).toEqual([]);
  });
});
