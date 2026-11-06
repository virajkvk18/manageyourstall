// Sell screen acceptance tests (sell agent): themed hero banner, category sections, search & chips, card add/stepper, cart
// steppers, remove, clear, persistence, customize sheet, unpriced items, quick-edit sold-out toggle, order note, top sellers,
// the responsive cart (desktop column · tablet drawer · phone checkout bar + full-screen order sheet), keyboard shortcuts and
// overflow at every width. Each test runs on a fresh device with the default 'street-chaat' stall theme.
import {test, expect} from '@playwright/test';
import {act, sheet, ready, noOverflow, state} from './helpers.mjs';

/** @param {import('@playwright/test').Page} page */
const width = page => page.viewportSize()?.width || 1440;
/** Phones: ≤767px. */
const isPhone = page => width(page) <= 767;
/** Tablets: 768–1023px. */
const isTablet = page => width(page) >= 768 && width(page) <= 1023;
/** Desktop (cart column): ≥1024px. */
const isDesk = page => width(page) >= 1024;

/** @param {import('@playwright/test').Page} page @param {string} id */
const cardOf = (page, id) => page.locator(`article.sell-card[data-product="${id}"]`);

/** Live session draft. @param {import('@playwright/test').Page} page */
const draft = async page => {
  const st = await state(page);
  return st[st.mode].draft;
};

/** Total quantity of a product in the persisted cart. @param {import('@playwright/test').Page} page @param {string} id */
const qtyOf = async (page, id) => (await draft(page)).filter(l => l.productId === id).reduce((n, l) => n + l.quantity, 0);

/**
 * The visible cart: the side column (desktop) or the cart sheet opened from the floating cart bar (tablet drawer / phone).
 * @param {import('@playwright/test').Page} page
 */
async function openCart(page) {
  if (isDesk(page)) return page.locator('.sell-cart-panel');
  await act(page, 'sell-cart-open').click();
  await expect(page.locator('#sheet[open][data-kind="cart"] .sell-cart-sheet')).toBeVisible();
  return sheet(page);
}

/** Run something inside the page with the kernel + pure modules. */
const withKernel = (page, fn, arg) => page.evaluate(fn, arg);

/** A tiny PNG served for a fake https stall photo (no real network in tests). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBNAMDQwMDAwAkBgT8a0TNtAAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('sell screen', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    await expect(page.locator('#main.screen-sell .sell-layout')).toBeVisible();
  });
  test.afterEach(() => {
    expect(errors, 'page errors').toEqual([]);
  });

  test('template products show in category sections with themed hero, mission and readiness', async ({page}) => {
    const titles = page.locator('.sell-section-title');
    await expect(titles).toHaveCount(5);
    await expect(titles.nth(0)).toContainText('Chips Chaat');
    await expect(titles.nth(1)).toContainText('Street Chaat');
    await expect(page.locator('.sell-section').nth(0).locator('[data-product="veggie-chips-chaat-small"]')).toBeVisible();
    await expect(page.locator('.sell-section').nth(3).locator('[data-product="lemon-fizz"]')).toBeVisible();
    await expect(page.locator('.sell-hero h1')).toHaveText('Little packets. Big fest energy.');
    await expect(page.locator('.sell-ready')).toContainText('19/19 PRICED');
    // Ledger-mode mission with no bills yet: an honest nudge to log the first bill (no PIN needed).
    await expect(page.locator('.sell-mission')).toContainText('No bills logged yet');
    await expect(page.locator('.sell-mission [data-action="money-add-bill"]')).toBeVisible();
    // Size chip carries the size; the card name drops the duplicated " · Small".
    const card = cardOf(page, 'veggie-chips-chaat-small');
    await expect(card.locator('.sell-card-main')).toHaveText('Veggie Chips Chaat');
    await expect(card.locator('.sell-size')).toHaveText('Small');
    await expect(card.locator('.sell-price')).toHaveText('₹40');
    // No nested interactive elements inside the main button.
    expect(await page.locator('.sell-card-main button, .sell-card-main a, .sell-card-main input').count()).toBe(0);
    // Games chip exists for the sample stall (Spin the Wheel); Top sellers hidden until there are sales.
    await expect(page.locator('.sell-chips [data-action="games-open"]')).toBeVisible();
    await expect(page.locator('[data-action="sell-filter"][data-filter="top"]')).toHaveCount(0);
  });

  test('hero banner follows the stall theme and Customize My Stall opens the studio', async ({page}) => {
    const hero = page.locator('.sell-hero');
    await expect(hero).toHaveClass(/tint-coral/);
    await expect(hero.locator('.sell-hero-bg')).toHaveClass(/pattern-sunburst/);
    await expect(hero.locator('.sell-hero-name')).toHaveText('My Awesome Stall');
    await expect(hero.locator('h1')).toHaveText('Little packets. Big fest energy.');
    await expect(hero.locator('.sell-hero-sub')).toContainText('Chips chaat, pani puri');
    await expect(hero.locator('.sell-hero-art svg')).toBeVisible();
    await expect(hero.locator('.sell-hero-art img')).toHaveCount(0);
    expect(await hero.getAttribute('style')).toContain('--sell-2:#FF4D87');
    if (!isPhone(page) && !isDesk(page)) {
      // Tablet: booth + event chips are shown in the full hero.
      await expect(hero.locator('.sell-hero-chip').first()).toContainText('Stall No. 1');
      await expect(hero.locator('.sell-hero-chip.is-event')).toContainText('College Fest');
    }
    // Owner text is escaped, and the hero follows profile + theme edits live.
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => {
        cat.saveProfile(st.config, {...st.config.profile, stallName: 'Chaat <b>Bros</b>', tagline: 'Teekha & meetha!'});
        cat.saveTheme(st.config, {heroTint: 'mint', heroPattern: 'dots', secondary: '#8FD3FF'});
      });
    });
    await expect(hero.locator('.sell-hero-name')).toHaveText('Chaat <b>Bros</b>');
    await expect(hero.locator('h1')).toHaveText('Teekha & meetha!');
    await expect(hero).toHaveClass(/tint-mint/);
    await expect(hero.locator('.sell-hero-bg')).toHaveClass(/pattern-dots/);
    await noOverflow(page, 'hero');

    const cta = hero.locator('[data-action="studio-open"][data-section="themes"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('aria-label', 'Customize My Stall');
    const box = await cta.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    await cta.click();
    await expect(page.locator('#main.screen-studio')).toBeVisible();
  });

  test('a custom stall photo (heroImage) replaces the illustration', async ({page}) => {
    await page.route('https://images.example.com/**', route => route.fulfill({status: 200, contentType: 'image/png', body: PNG}));
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.saveTheme(st.config, {heroImage: 'https://images.example.com/my-stall.png'}));
    });
    const img = page.locator('.sell-hero .sell-hero-art.has-photo img.sell-hero-img');
    await expect(img).toHaveAttribute('src', 'https://images.example.com/my-stall.png');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => /** @type {HTMLImageElement} */ (el).naturalWidth)).toBeGreaterThan(0);
    await noOverflow(page, 'hero photo');
  });

  test('phone hero stays compact so products start above the fold', async ({page}) => {
    test.skip(!isPhone(page), 'phone layout only');
    const box = await page.locator('.sell-hero').boundingBox();
    expect(box && box.height).toBeLessThanOrEqual(215);
    const first = await page.locator('article.sell-card').first().boundingBox();
    const vh = page.viewportSize()?.height || 0;
    expect(first && first.y).toBeLessThan(vh - 120);
  });

  test('search matches name, tags and category; chips filter; clear resets', async ({page}) => {
    const search = page.locator('#sell-search');
    await search.fill('kachori');
    await expect(page.locator('article.sell-card')).toHaveCount(1);
    await expect(cardOf(page, 'kachori')).toBeVisible();
    await expect(search).toBeFocused(); // focus survives the re-render
    await search.fill('bestseller'); // tag
    await expect(page.locator('article.sell-card')).toHaveCount(2);
    await expect(cardOf(page, 'pani-puri')).toBeVisible();
    await expect(cardOf(page, 'cheese-chips-chaat-small')).toBeVisible();
    await search.fill('fizz large'); // every word must match: nothing
    await expect(page.locator('.sell-products .empty-state')).toContainText('No match');
    await act(page, 'sell-search-clear').click();
    await expect(search).toHaveValue('');
    await expect(page.locator('.sell-section')).toHaveCount(5);

    await page.locator('[data-action="sell-filter"][data-filter="cat:fizz"]').click();
    await expect(page.locator('[data-action="sell-filter"][data-filter="cat:fizz"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('article.sell-card')).toHaveCount(3);
    await search.fill('orange');
    await expect(page.locator('article.sell-card')).toHaveCount(1);
    await expect(cardOf(page, 'orange-fizz')).toBeVisible();
    await search.fill('');
    await page.locator('[data-action="sell-filter"][data-filter="all"]').click();
    await expect(page.locator('.sell-section')).toHaveCount(5);
  });

  test('add, card stepper, cart stepper, remove and clear with confirmation', async ({page}) => {
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    const card = cardOf(page, 'cola');
    await expect(card).toHaveClass(/in-cart/);
    await expect(card.locator('.sell-qty-badge')).toHaveText('×1');
    await card.locator('[data-action="sell-inc"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(2);
    await expect(card.locator('.sell-qty-badge')).toHaveText('×2');
    await card.locator('[data-action="sell-dec"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    await act(page, 'sell-add', '[data-id="lemon-fizz"]').click();
    await expect.poll(() => qtyOf(page, 'lemon-fizz')).toBe(1);

    const cart = await openCart(page);
    const colaLine = cart.locator('.sell-line', {hasText: 'Cola'});
    await expect(colaLine).toBeVisible();
    await colaLine.locator('[data-action="sell-line-inc"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(2);
    await expect(colaLine.locator('.sell-line-total')).toHaveText('₹60');
    await expect(cart.locator('.sell-total-row.is-total')).toContainText('₹90');
    await colaLine.locator('[data-action="sell-line-dec"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    await cart.locator('.sell-line', {hasText: 'Lemon Fizz'}).locator('[data-action="sell-line-remove"]').click();
    await expect.poll(() => qtyOf(page, 'lemon-fizz')).toBe(0);
    await expect(cart.locator('.sell-line')).toHaveCount(1);

    await cart.locator('[data-action="sell-clear"]').click();
    await expect(page.locator('#sheet[open] [data-action="core-confirm"]')).toBeVisible();
    await page.locator('#sheet[open] [data-action="core-confirm"]').click();
    await expect.poll(async () => (await draft(page)).length).toBe(0);
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(cardOf(page, 'cola')).not.toHaveClass(/in-cart/);
    // Dec at qty 1 removes the line from the card stepper too.
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    await cardOf(page, 'cola').locator('[data-action="sell-dec"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(0);
    await expect(cardOf(page, 'cola').locator('.sell-card-stepper')).toHaveCount(0);
  });

  test('cart and note survive a reload; pay button follows the cart', async ({page}) => {
    if (isDesk(page)) await expect(page.locator('.sell-cart-panel [data-action="co-open"]')).toBeDisabled();
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await act(page, 'sell-add', '[data-id="samosa"]').click();
    await expect.poll(async () => (await draft(page)).length).toBe(2);
    let cart = await openCart(page);
    await cart.locator('[data-action="sell-note"]').click();
    await expect(page.locator('#sell-note-text')).toBeVisible();
    await page.locator('#sell-note-text').fill('Extra spicy, no onion');
    await act(page, 'sell-note-save').click();
    await expect.poll(async () => (await state(page))[(await state(page)).mode].draftNote).toBe('Extra spicy, no onion');
    // Saving from the order sheet returns to it.
    if (!isDesk(page)) await expect(page.locator('#sheet[open][data-kind="cart"] .sell-note')).toContainText('Extra spicy, no onion');

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.booted === '1');
    await expect(cardOf(page, 'cola').locator('.sell-qty-badge')).toHaveText('×1');
    cart = await openCart(page);
    await expect(cart.locator('.sell-line')).toHaveCount(2);
    await expect(cart.locator('.sell-note')).toContainText('Extra spicy, no onion');
    await expect(cart.locator('[data-action="co-open"]')).toBeEnabled();
    await expect(cart.locator('[data-action="co-open"]')).toContainText('₹50');
  });

  test('customizable item opens the sheet; flavour and add-on update the live price', async ({page}) => {
    await act(page, 'sell-add', '[data-id="cheese-chips-chaat-small"]').click();
    const dlg = page.locator('#sheet[open]');
    await expect(dlg.locator('.sell-cz')).toBeVisible();
    await expect(dlg.locator('[data-cz-add]')).toHaveText('Add 1 · ₹60');
    await dlg.locator('#sell-cz-flavour').selectOption('Magic Masala');
    await dlg.locator('[data-addon="extra-cheese"]').click();
    await expect(dlg.locator('[data-addon="extra-cheese"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.locator('[data-cz-add]')).toHaveText('Add 1 · ₹70');
    await dlg.locator('[data-action="sell-cz-inc"]').click();
    await expect(dlg.locator('[data-cz-add]')).toHaveText('Add 2 · ₹140');
    await expect(dlg.locator('[data-cz-live]')).toContainText('₹70 each × 2');
    await dlg.locator('#sell-cz-note').fill('No onion');
    await act(page, 'sell-cz-add').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    const lines = await draft(page);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({productId: 'cheese-chips-chaat-small', flavour: 'Magic Masala', quantity: 2, unitPrice: 7000, lineTotal: 14000, note: 'No onion'});
    expect(lines[0].addons.map(a => a.id)).toEqual(['extra-cheese']);
    // The card "+" for a customizable item opens the sheet again instead of blindly adding.
    await cardOf(page, 'cheese-chips-chaat-small').locator('[data-action="sell-inc"]').click();
    await expect(page.locator('#sheet[open] .sell-cz')).toBeVisible();
  });

  test('unpriced item shows SET PRICE, a setup banner, and cannot be added', async ({page}) => {
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.setPrices(st.config, {cola: null}));
    });
    const card = cardOf(page, 'cola');
    await expect(card).toHaveClass(/is-unpriced/);
    await expect(card.locator('.sell-setprice')).toHaveText('SET PRICE');
    await expect(page.locator('.sell-ready')).toContainText('18/19 PRICED');
    await expect(page.locator('.sell-setup [data-action="menu-price-board"]')).toBeVisible();
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect(page.locator('#toast')).toContainText('no price yet');
    expect(await qtyOf(page, 'cola')).toBe(0);
  });

  test('quick edit: sold-out toggle needs no PIN and blocks adding', async ({page}) => {
    await act(page, 'sell-quick-edit').click();
    await expect(page.locator('.sell-quick-banner')).toBeVisible();
    await expect(page.locator('#sell-quick-toggle')).toHaveAttribute('aria-pressed', 'true');
    const card = cardOf(page, 'cola');
    await expect(card.locator('[data-action="menu-quick-price"]')).toBeVisible();
    await expect(card.locator('[data-action="menu-edit-product"]')).toBeVisible();
    await card.locator('[data-action="menu-toggle-soldout"]').click();
    await expect.poll(async () => (await state(page)).config.products.find(p => p.id === 'cola').soldOut).toBe(true);
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);
    await expect(card).toHaveClass(/is-out/);
    await expect(card.locator('.sell-ribbon')).toContainText('SOLD OUT');
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect(page.locator('#toast')).toContainText('sold out');
    expect(await qtyOf(page, 'cola')).toBe(0);
    // Back in stock, out of quick edit, and it sells again.
    await card.locator('[data-action="menu-toggle-soldout"]').click();
    await expect.poll(async () => (await state(page)).config.products.find(p => p.id === 'cola').soldOut).toBe(false);
    await act(page, 'sell-quick-edit').click();
    await expect(page.locator('.sell-quick-banner')).toHaveCount(0);
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
  });

  test('top sellers chip appears after a sale and lists the bestseller first', async ({page}) => {
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.createOrder(s, st.config, {
          id: crypto.randomUUID(),
          items: [d.makeLine(st.config, 'lemon-fizz', {quantity: 3}), d.makeLine(st.config, 'samosa')],
          method: 'Cash',
        });
      });
    });
    const chip = page.locator('[data-action="sell-filter"][data-filter="top"]');
    await expect(chip).toBeVisible();
    await chip.click();
    const cards = page.locator('article.sell-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-product', 'lemon-fizz');
    await expect(cards.nth(1)).toHaveAttribute('data-product', 'samosa');
  });

  test('mission strip tracks bills in ledger mode', async ({page}) => {
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const d = await import('/domain.mjs');
      await core.commit(st => {
        const s = st[st.mode];
        d.addExpense(s, st.config, {id: crypto.randomUUID(), title: 'Stall rent', category: 'rent', amount: 100000});
        d.createOrder(s, st.config, {id: crypto.randomUUID(), items: [d.makeLine(st.config, 'cola', {quantity: 5})], method: 'Cash'});
      });
    });
    const strip = page.locator('.sell-mission');
    await expect(strip).toContainText('₹150');
    await expect(strip).toContainText('₹1,000');
    await expect(strip.locator('.sell-mission-pct')).toHaveText('15%');
  });

  test('desktop: sticky cart column, no floating bar', async ({page}) => {
    test.skip(!isDesk(page), 'desktop layout only');
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    const panel = page.locator('.sell-cart-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.sell-cartbar')).toBeHidden();
    expect(await panel.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
    const main = await page.locator('.sell-main').boundingBox();
    const box = await panel.boundingBox();
    expect(box && main && box.x).toBeGreaterThan((main?.x || 0) + (main?.width || 0) - 1);
  });

  test('tablet: 2-column grid and a slide-over cart drawer (Escape / backdrop close it)', async ({page}) => {
    test.skip(!isTablet(page), 'tablet layout only');
    const cols = await page.locator('.sell-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    await expect(page.locator('.sell-cart-panel')).toBeHidden();
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await act(page, 'sell-add', '[data-id="samosa"]').click();
    await expect.poll(async () => (await draft(page)).length).toBe(2);
    const bar = page.locator('.sell-cartbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText('2 items · ₹50 · Review & Pay →');

    await bar.locator('[data-action="sell-cart-open"]').click();
    const dlg = page.locator('#sheet[open][data-kind="cart"]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#sheet-title')).toHaveText('Your order · 2 items');
    // A right-hand drawer: flush with the right edge, full height, narrower than the screen.
    const vw = width(page);
    const vh = page.viewportSize()?.height || 0;
    await expect.poll(async () => {
      const b = await dlg.boundingBox();
      return b ? Math.round(b.x + b.width) : 0;
    }).toBe(vw);
    const box = await dlg.boundingBox();
    expect(box && box.width).toBeLessThan(vw * 0.7);
    expect(box && box.height).toBeGreaterThanOrEqual(vh - 2);
    // Focus starts inside the drawer and stays there.
    expect(await page.evaluate(() => !!document.activeElement?.closest('#sheet'))).toBe(true);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#sheet'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);

    // Backdrop click (left of the drawer) closes it too; a click inside does not.
    await bar.locator('[data-action="sell-cart-open"]').click();
    await expect(dlg).toBeVisible();
    await dlg.locator('.sell-sheet-meta').click();
    await expect(dlg).toBeVisible();
    await page.mouse.click(40, Math.round(vh / 2));
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await noOverflow(page, 'tablet drawer');
  });

  test('phone: floating checkout bar and full-screen order sheet', async ({page}) => {
    test.skip(!isPhone(page), 'phone layout only');
    await expect(page.locator('.sell-cartbar')).toHaveCount(0);
    await act(page, 'sell-add', '[data-id="french-fries"]').click();
    const bar = page.locator('.sell-cartbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText('1 item · ₹60 · Review & Pay →');
    await expect(page.locator('.sell-cart-panel')).toBeHidden();
    // The bar floats above the bottom nav and fits the screen.
    const bb = await bar.boundingBox();
    expect(bb && bb.x).toBeGreaterThanOrEqual(0);
    expect(bb && bb.x + bb.width).toBeLessThanOrEqual(width(page));
    for (const b of await bar.locator('button').all()) expect((await b.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await bar.locator('[data-action="sell-cart-open"]').click();
    const dlg = page.locator('#sheet[open][data-kind="cart"]');
    await expect(dlg.locator('.sell-cart-sheet .sell-line')).toHaveCount(1);
    await expect(dlg.locator('#sheet-title')).toHaveText('Your order · 1 item');
    const vh = page.viewportSize()?.height || 0;
    await expect.poll(async () => Math.round((await dlg.boundingBox())?.height || 0)).toBeGreaterThanOrEqual(vh - 1);
    const box = await dlg.boundingBox();
    expect(box && Math.round(box.width)).toBe(width(page));
    // The sheet slides up from below: wait for the animation to settle at the top edge.
    await expect.poll(async () => Math.round((await dlg.boundingBox())?.y ?? -1)).toBe(0);
    await dlg.locator('[data-action="sell-line-inc"]').click();
    await expect(dlg.locator('#sheet-title')).toHaveText('Your order · 2 items');
    await expect(dlg.locator('.sell-total-row.is-total')).toContainText('₹120');
    await expect(dlg.locator('[data-action="sell-note"]')).toBeVisible();
    await expect(dlg.locator('[data-action="sell-clear"]')).toBeVisible();
    await expect(dlg.locator('.sheet-actions [data-action="co-open"]')).toContainText('₹120');
    await noOverflow(page, 'order sheet');
    await dlg.locator('.sheet-close').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    await expect(bar).toHaveText('2 items · ₹120 · Review & Pay →');

    // "Review & Pay →" goes straight to checkout.
    await bar.locator('[data-action="co-open"]').click();
    await expect(page.locator('#sheet[open][data-kind="checkout"]')).toBeVisible();
  });

  test('keyboard: / focuses search, Ctrl+Enter opens checkout', async ({page}) => {
    test.skip(isPhone(page), 'hardware keyboard shortcuts');
    await page.locator('.sell-hero h1').click();
    await page.keyboard.press('/');
    await expect(page.locator('#sell-search')).toBeFocused();
    await page.keyboard.type('zesty');
    await expect(page.locator('article.sell-card')).toHaveCount(1);
    await page.keyboard.press('Enter'); // single match → add
    await expect.poll(() => qtyOf(page, 'lemon-fizz')).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sell-search')).toHaveValue('');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#sheet[open]')).toBeVisible();
  });

  // Review regressions -------------------------------------------------------------------------------------------------

  test('taps on different items in quick succession all land (no tap lost while the cart saves)', async ({page}) => {
    await page.evaluate(() => {
      const tap = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.querySelector(`[data-action="sell-add"][data-id="${id}"]`)).click();
      tap('cola');
      setTimeout(() => tap('lemon-fizz'), 0);
      setTimeout(() => tap('samosa'), 1);
    });
    await expect.poll(async () => (await draft(page)).map(l => l.productId).sort()).toEqual(['cola', 'lemon-fizz', 'samosa']);
    // Card steppers on two different items in quick succession land too.
    await page.evaluate(() => {
      const tap = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel)).click();
      tap('#sell-inc-cola');
      setTimeout(() => tap('#sell-inc-lemon-fizz'), 0);
    });
    await expect.poll(async () => [await qtyOf(page, 'cola'), await qtyOf(page, 'lemon-fizz')]).toEqual([2, 2]);
  });

  test('keyboard focus stays on the card after adding, so Enter keeps adding', async ({page}) => {
    await page.locator('#sell-card-cola').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    await expect(page.locator('#sell-card-cola')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => qtyOf(page, 'cola')).toBe(2);
    // "−" down to zero: the stepper disappears and focus falls back to the card.
    await page.locator('#sell-dec-cola').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => qtyOf(page, 'cola')).toBe(1);
    await expect(page.locator('#sell-dec-cola')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => qtyOf(page, 'cola')).toBe(0);
    await expect(page.locator('#sell-card-cola')).toBeFocused();
  });

  test('desktop cart panel keeps Review & pay on screen with a long order', async ({page}) => {
    test.skip(!isDesk(page), 'desktop cart column only (tablet + phones use the drawer / order sheet)');
    for (const id of ['cola', 'samosa', 'lemon-fizz', 'french-fries', 'combo-triple-dhamaka', 'peri-peri-fries', 'orange-fizz']) {
      await act(page, 'sell-add', `[data-id="${id}"]`).click();
    }
    await expect.poll(async () => (await draft(page)).length).toBe(7);
    await page.evaluate(() => window.scrollTo(0, 0));
    const pay = page.locator('.sell-cart-panel [data-action="co-open"]');
    await expect(pay).toBeInViewport({ratio: 1});
  });

  test('stock: the cart counts toward "only N left" and caps adding at what is left', async ({page}) => {
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => {
        const key = cat.addStockPool(st.config, 'Cola cans');
        cat.saveStock(st.config, {}, {inventory: true, stock: {[key]: 2}});
        cat.saveProduct(st.config, {id: 'cola', stockKey: key});
      });
    });
    const card = cardOf(page, 'cola');
    await expect(card.locator('.sell-low')).toHaveText('Only 2 left');
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect(card.locator('.sell-low')).toHaveText('Only 1 left');
    await card.locator('[data-action="sell-inc"]').click();
    await expect.poll(() => qtyOf(page, 'cola')).toBe(2);
    await expect(card.locator('.sell-low')).toHaveText('All left in cart');
    await expect(card.locator('[data-action="sell-inc"]')).toBeDisabled();
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await expect(page.locator('#toast')).toContainText('already in this cart');
    expect(await qtyOf(page, 'cola')).toBe(2);
    // Combos that need a cola are out for this cart too.
    await act(page, 'sell-add', '[data-id="combo-triple-dhamaka"]').click();
    await expect(page.locator('#toast')).toContainText('No Triple Dhamaka stock left');
    expect(await qtyOf(page, 'combo-triple-dhamaka')).toBe(0);
    const cart = await openCart(page);
    await expect(cart.locator('.sell-line', {hasText: 'Cola'}).locator('[data-action="sell-line-inc"]')).toBeDisabled();
  });

  test('an item sold out while in the cart is flagged and cannot be stepped up', async ({page}) => {
    await act(page, 'sell-add', '[data-id="lemon-fizz"]').click();
    await expect.poll(() => qtyOf(page, 'lemon-fizz')).toBe(1);
    await withKernel(page, async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => cat.setSoldOut(st.config, 'lemon-fizz', true));
    });
    const cart = await openCart(page);
    const line = cart.locator('.sell-line', {hasText: 'Lemon Fizz'});
    await expect(line.locator('.sell-line-blocked')).toContainText('Sold out now');
    await expect(line.locator('[data-action="sell-line-inc"]')).toBeDisabled();
    await line.locator('[data-action="sell-line-remove"]').click();
    await expect.poll(() => qtyOf(page, 'lemon-fizz')).toBe(0);
  });

  test('no horizontal overflow: menu, quick edit, cart and customize sheet', async ({page}) => {
    await noOverflow(page, 'sell');
    await act(page, 'sell-add', '[data-id="cola"]').click();
    await act(page, 'sell-add', '[data-id="combo-triple-dhamaka"]').click();
    await expect.poll(async () => (await draft(page)).length).toBe(2);
    await noOverflow(page, 'sell with cart');
    await act(page, 'sell-quick-edit').click();
    await expect(page.locator('.sell-tools').first()).toBeVisible();
    await noOverflow(page, 'quick edit');
    await act(page, 'sell-quick-edit').click();
    await act(page, 'sell-add', '[data-id="corn-chips-chaat-large"]').click();
    await expect(page.locator('#sheet[open] .sell-cz')).toBeVisible();
    await noOverflow(page, 'customize sheet');
    const box = await page.locator('#sheet[open]').boundingBox();
    expect(box && box.width).toBeLessThanOrEqual((page.viewportSize()?.width || 0) + 1);
  });
});
