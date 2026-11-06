// Menu manager acceptance tests (menu agent): categories, item CRUD, duplicate, reorder, delete guard, 1-tap sold out
// without PIN, price board + locks, quick price lock, combo builder, add-ons & flavours, stock room, picker round trip,
// filters and no horizontal overflow. Each test starts on a fresh device with the default 'street-chaat' stall theme (§16.5).
import {test, expect} from '@playwright/test';
import {act, sheet, ready, go, adminClick, noOverflow, state} from './helpers.mjs';

/** @param {import('@playwright/test').Page} page @param {string} id */
const row = (page, id) => page.locator(`.menu-row[data-product="${id}"]`);

/** @param {import('@playwright/test').Page} page */
const openSheet = page => page.locator('#sheet[open]');

/** @param {import('@playwright/test').Page} page */
async function closeIfOpen(page) {
  if (await openSheet(page).count()) {
    await sheet(page).locator('.sheet-close').click();
    await expect(openSheet(page)).toHaveCount(0);
  }
}

/**
 * Run a row tool. Desktop/tablet rows show every tool; phones keep some in the row's "More" sheet.
 * @param {import('@playwright/test').Page} page @param {string} id @param {string} action @param {string} [extra]
 */
async function rowTool(page, id, action, extra = '') {
  const direct = row(page, id).locator(`[data-action="${action}"]${extra}:visible`);
  if (await direct.count()) {
    await adminClick(page, direct.first());
    return;
  }
  await row(page, id).locator('[data-action="menu-row-more"]').click();
  await expect(sheet(page).locator('.menu-rowsheet')).toBeVisible();
  await adminClick(page, sheet(page).locator(`[data-action="${action}"]${extra}`));
}

/** Click the sheet's primary save action. @param {import('@playwright/test').Page} page @param {string} action */
async function save(page, action) {
  await sheet(page).locator(`.sheet-actions [data-action="${action}"]`).click();
  await expect(openSheet(page)).toHaveCount(0);
}

/** @param {import('@playwright/test').Page} page @param {string} id */
const product = async (page, id) => (await state(page)).config.products.find(p => p.id === id);

test.describe('menu manager', () => {
  /** @type {string[]} */
  let errors;

  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    await go(page, 'menu');
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('screen shows counts, tools and categories in order', async ({page}) => {
    await expect(page.locator('#main h1')).toHaveText('Your menu');
    await expect(page.locator('.menu-counts')).toContainText('19 items');
    await expect(page.locator('.menu-counts')).toContainText('19/19 priced');
    for (const action of ['menu-new-product', 'menu-new-category', 'menu-new-combo', 'menu-price-board', 'menu-addons', 'menu-stock']) {
      await expect(page.locator(`.menu-toolbar [data-action="${action}"]`)).toBeVisible();
    }
    const cats = await page.locator('.menu-cat').evaluateAll(els => els.map(el => el.getAttribute('data-category')));
    expect(cats).toEqual(['chips-chaat', 'street-chaat', 'hot-crispy', 'fizz', 'combos']);
    await expect(row(page, 'cola')).toContainText('₹30');
    await noOverflow(page, 'menu screen');
  });

  test('adds a category', async ({page}) => {
    await adminClick(page, act(page, 'menu-new-category'));
    await sheet(page).locator('#menu-cat-name').fill('Chai Corner');
    await save(page, 'menu-save-category');
    const cat = (await state(page)).config.categories.at(-1);
    expect(cat.name).toBe('Chai Corner');
    await expect(page.locator(`.menu-cat[data-category="${cat.id}"]`)).toContainText('No items here yet');
  });

  test('adds a priced item that shows up on Sell', async ({page}) => {
    await adminClick(page, act(page, 'menu-new-product', '[data-category="fizz"]'));
    await expect(sheet(page).locator('#menu-editor')).toBeVisible();
    await sheet(page).locator('#menu-ed-name').fill('Masala Shikanji');
    await sheet(page).locator('#menu-ed-size').fill('Regular');
    await sheet(page).locator('#menu-ed-price').fill('35');
    await sheet(page).locator('[data-action="menu-tag"][data-tag="NEW"]').click();
    await save(page, 'menu-save-product');
    const st = await state(page);
    const p = st.config.products.find(x => x.name === 'Masala Shikanji');
    expect(p).toMatchObject({price: 3500, categoryId: 'fizz', size: 'Regular', tags: ['NEW'], active: true, bundle: null});
    await expect(row(page, p.id)).toContainText('₹35');
    await go(page, 'sell');
    // Sell may still be a stub in this wave; when it renders cards, the new item must be there.
    if (await page.locator('[data-action="sell-add"]').count()) {
      await expect(page.locator(`[data-action="sell-add"][data-id="${p.id}"]`)).toHaveCount(1);
    }
  });

  test('creates a category inline from the item editor', async ({page}) => {
    await adminClick(page, act(page, 'menu-new-product'));
    await sheet(page).locator('#menu-ed-name').fill('Gulab Jamun');
    await sheet(page).locator('#menu-ed-category').selectOption('__new__');
    await expect(sheet(page).locator('#menu-ed-newcat')).toBeVisible();
    await sheet(page).locator('#menu-ed-newcat').fill('Desserts');
    await save(page, 'menu-save-product');
    const st = await state(page);
    const cat = st.config.categories.find(c => c.name === 'Desserts');
    expect(cat).toBeTruthy();
    expect(st.config.products.find(p => p.name === 'Gulab Jamun')).toMatchObject({categoryId: cat.id, price: null});
  });

  test('edits an item', async ({page}) => {
    await rowTool(page, 'cola', 'menu-edit-product');
    await expect(sheet(page).locator('#menu-ed-name')).toHaveValue('Cola');
    await sheet(page).locator('#menu-ed-name').fill('Cola Classic');
    await sheet(page).locator('#menu-ed-subtitle').fill('Chilled can');
    await sheet(page).locator('#menu-ed-price').fill('35.50');
    await sheet(page).locator('[data-action="menu-tag"][data-tag="CHILLED"]').click();
    await sheet(page).locator('[data-field="customizable"]').click();
    await save(page, 'menu-save-product');
    expect(await product(page, 'cola')).toMatchObject({
      name: 'Cola Classic', subtitle: 'Chilled can', price: 3550, tags: ['CHILLED'], customizable: true,
    });
    await expect(row(page, 'cola')).toContainText('Cola Classic');
    await expect(row(page, 'cola')).toContainText('₹35.50');
  });

  test('duplicates an item and opens the copy', async ({page}) => {
    await rowTool(page, 'cola', 'menu-dup');
    await expect(sheet(page).locator('#menu-ed-name')).toHaveValue('Cola (copy)');
    await sheet(page).locator('#menu-ed-name').fill('Cola Large');
    await sheet(page).locator('#menu-ed-price').fill('50');
    await save(page, 'menu-save-product');
    const list = (await state(page)).config.products;
    const i = list.findIndex(p => p.id === 'cola');
    expect(list[i + 1]).toMatchObject({name: 'Cola Large', price: 5000, categoryId: 'fizz', priceLocked: false});
  });

  test('reorders items and categories', async ({page}) => {
    await rowTool(page, 'lemon-fizz', 'menu-move', '[data-dir="-1"]');
    await expect.poll(async () => {
      const ids = (await state(page)).config.products.map(p => p.id);
      return ids.indexOf('lemon-fizz') < ids.indexOf('cola');
    }).toBe(true);
    await closeIfOpen(page);
    const fizzRows = await page.locator('.menu-cat[data-category="fizz"] .menu-row').evaluateAll(els => els.map(el => el.getAttribute('data-product')));
    expect(fizzRows.slice(0, 2)).toEqual(['lemon-fizz', 'cola']);
    await adminClick(page, page.locator('[data-action="menu-move-category"][data-id="street-chaat"][data-dir="-1"]'));
    await expect.poll(async () => (await state(page)).config.categories[0].id).toBe('street-chaat');
    await expect(page.locator('.menu-cat').first()).toHaveAttribute('data-category', 'street-chaat');
  });

  test('delete is blocked for combo items and works after confirming', async ({page}) => {
    await rowTool(page, 'cola', 'menu-delete');
    await expect(sheet(page)).toContainText('Can’t delete this yet');
    await expect(sheet(page)).toContainText('Snack + Fizz');
    await closeIfOpen(page);
    expect(await product(page, 'cola')).toBeTruthy();

    await rowTool(page, 'orange-fizz', 'menu-delete');
    await expect(sheet(page)).toContainText('Delete “Orange Fizz”?');
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await expect(openSheet(page)).toHaveCount(0);
    expect(await product(page, 'orange-fizz')).toBeUndefined();
    await expect(row(page, 'orange-fizz')).toHaveCount(0);
  });

  test('deletes a category after moving its items', async ({page}) => {
    await adminClick(page, page.locator('[data-action="menu-delete-category"][data-id="fizz"]'));
    await sheet(page).locator('#menu-cat-move').selectOption('hot-crispy');
    await save(page, 'menu-delete-category-go');
    const st = await state(page);
    expect(st.config.categories.map(c => c.id)).not.toContain('fizz');
    expect(st.config.products.find(p => p.id === 'cola').categoryId).toBe('hot-crispy');
  });

  test('sold out toggle is one tap and needs no PIN', async ({page}) => {
    const toggle = row(page, 'cola').locator('[data-action="menu-toggle-soldout"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);
    await expect(row(page, 'cola').locator('[data-action="menu-toggle-soldout"]')).toHaveAttribute('aria-pressed', 'false');
    let st = await state(page);
    expect(st.pin).toBeNull();
    expect(st.config.products.find(p => p.id === 'cola').soldOut).toBe(true);
    expect(st.live.audit.some(a => a.type === 'item-sold-out' && a.entityId === 'cola')).toBe(true);
    await row(page, 'cola').locator('[data-action="menu-toggle-soldout"]').click();
    await expect(row(page, 'cola').locator('[data-action="menu-toggle-soldout"]')).toHaveAttribute('aria-pressed', 'true');
    st = await state(page);
    expect(st.config.products.find(p => p.id === 'cola').soldOut).toBe(false);
  });

  test('visible toggle hides an item (admin)', async ({page}) => {
    await adminClick(page, row(page, 'cola').locator('[data-action="menu-toggle-visible"]'));
    await expect.poll(async () => (await product(page, 'cola')).active).toBe(false);
    await expect(row(page, 'cola')).toContainText('Hidden');
  });

  test('price board sets prices and locks in one save', async ({page}) => {
    await adminClick(page, act(page, 'menu-price-board'));
    const board = sheet(page);
    await board.locator('#menu-pb-cola').fill('35');
    await board.locator('#menu-pb-lemon-fizz').fill('32.50');
    await board.locator('#menu-pb-kachori').fill('');
    await board.locator('[data-pb-lock="cola"]').click();
    await expect(board.locator('#menu-pb-cola')).toBeDisabled();
    await save(page, 'menu-pb-save');
    expect(await product(page, 'cola')).toMatchObject({price: 3500, priceLocked: true});
    expect(await product(page, 'lemon-fizz')).toMatchObject({price: 3250, priceLocked: false});
    expect((await product(page, 'kachori')).price).toBeNull();
    await expect(page.locator('.menu-counts')).toContainText('18/19 priced');
    await expect(row(page, 'kachori')).toContainText('SET PRICE');

    await act(page, 'menu-price-board').click();
    await expect(sheet(page).locator('#menu-pb-cola')).toBeDisabled();
    await sheet(page).locator('[data-action="menu-pb-lockall"][data-lock="1"]').click();
    await save(page, 'menu-pb-save');
    const st = await state(page);
    expect(st.config.products.every(p => p.priceLocked)).toBe(true);
    expect(st.live.audit.some(a => a.type === 'prices-changed')).toBe(true);
  });

  test('quick price refuses while locked and works after unlocking', async ({page}) => {
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.commitConfig(st => {
      st.config.products.find(p => p.id === 'cola').priceLocked = true;
    })));
    await adminClick(page, row(page, 'cola').locator('[data-action="menu-quick-price"]'));
    const qp = sheet(page);
    await expect(qp.locator('#menu-qp-price')).toBeDisabled();
    await expect(qp.locator('.sheet-actions [data-action="menu-qp-save"]')).toBeDisabled();
    // Even if the field is forced open, the catalog refuses to change a locked price.
    await page.evaluate(() => {
      const input = document.querySelector('#menu-qp-price');
      input.disabled = false;
      input.value = '99';
      document.querySelector('.sheet-actions [data-action="menu-qp-save"]').disabled = false;
    });
    await qp.locator('.sheet-actions [data-action="menu-qp-save"]').click();
    await expect(qp.locator('[data-error]')).toContainText('Unlock “Cola” to change its price.');
    expect((await product(page, 'cola')).price).toBe(3000);

    await qp.locator('[data-action="menu-qp-unlock"]').click();
    await expect(qp.locator('#menu-qp-price')).toBeEnabled();
    await qp.locator('#menu-qp-price').fill('45');
    await qp.locator('[data-field="qp-lock"]').click();
    await save(page, 'menu-qp-save');
    expect(await product(page, 'cola')).toMatchObject({price: 4500, priceLocked: true});
    await expect(row(page, 'cola').locator('.menu-price')).toContainText('₹45');
  });

  test('combo editor builds a combo with a savings hint', async ({page}) => {
    await adminClick(page, act(page, 'menu-new-combo'));
    const ed = sheet(page);
    await ed.locator('#menu-ed-name').fill('Fries + Fizz');
    await ed.locator('[data-action="menu-combo-step"][data-id="french-fries"][data-dir="1"]').click();
    await ed.locator('[data-action="menu-combo-step"][data-id="lemon-fizz"][data-dir="1"]').click();
    await ed.locator('[data-action="menu-combo-step"][data-id="lemon-fizz"][data-dir="1"]').click();
    await ed.locator('#menu-ed-price').fill('100');
    await expect(ed.locator('#menu-combo-hint')).toContainText('Saves ₹20 vs separate');
    await save(page, 'menu-save-product');
    const combo = (await state(page)).config.products.find(p => p.name === 'Fries + Fizz');
    expect(combo).toMatchObject({
      price: 10000, categoryId: 'combos', tags: ['COMBO'],
      bundle: [{productId: 'french-fries', quantity: 1}, {productId: 'lemon-fizz', quantity: 2}],
    });
    await expect(row(page, combo.id)).toContainText('saves ₹20');
  });

  test('edits add-ons and flavours', async ({page}) => {
    await adminClick(page, act(page, 'menu-addons'));
    const ao = sheet(page);
    await ao.locator('[data-action="menu-ao-add"]').click();
    await ao.locator('#menu-ao-name-2').fill('Extra Masala');
    await ao.locator('#menu-ao-price-2').fill('5');
    await ao.locator('[data-action="menu-ao-remove"][data-index="1"]').click();
    await expect(ao.locator('#menu-ao-name-1')).toHaveValue('Extra Masala');
    await ao.locator('#menu-ao-flavours').fill('Classic Salted\nPeri Peri\n\nclassic salted');
    await save(page, 'menu-ao-save');
    const c = (await state(page)).config;
    expect(c.addons.map(a => [a.name, a.price])).toEqual([['Extra Cheese', 1000], ['Extra Masala', 500]]);
    expect(c.addons[0].id).toBe('extra-cheese');
    expect(c.flavours).toEqual(['Classic Salted', 'Peri Peri']);
  });

  test('stock room turns tracking on, edits, adds and deletes pools', async ({page}) => {
    await adminClick(page, act(page, 'menu-stock'));
    const room = sheet(page);
    await room.locator('[data-field="inventory"]').click();
    await room.locator('#menu-st-cola').fill('48');
    await room.locator('#menu-stock-new').fill('Paper cups');
    await room.locator('[data-action="menu-stock-add"]').click();
    await expect(room.locator('#menu-st-paper-cups')).toBeVisible();
    // Unsaved edits survive adding a pool.
    await expect(room.locator('#menu-st-cola')).toHaveValue('48');
    await expect(room.locator('[data-field="inventory"]')).toHaveAttribute('aria-pressed', 'true');
    await room.locator('#menu-st-paper-cups').fill('100');
    await save(page, 'menu-stock-save');
    let c = (await state(page)).config;
    expect(c.inventory).toBe(true);
    expect(c.stock.cola).toBe(48);
    expect(c.stock['paper-cups']).toBe(100);
    await expect(row(page, 'cola')).toContainText('48 left');

    await act(page, 'menu-stock').click();
    await expect(sheet(page).locator('[data-action="menu-stock-del"][data-key="cola"]')).toHaveCount(0);
    await sheet(page).locator('[data-action="menu-stock-del"][data-key="paper-cups"]').click();
    await expect(sheet(page).locator('#menu-st-paper-cups')).toHaveCount(0);
    c = (await state(page)).config;
    expect(c.stock).not.toHaveProperty('paper-cups');
  });

  test('visual picker round trip keeps unsaved editor values', async ({page}) => {
    await rowTool(page, 'cola', 'menu-edit-product');
    const ed = sheet(page);
    await ed.locator('#menu-ed-name').fill('Cola Zero');
    await ed.locator('#menu-ed-price').fill('25');
    await ed.locator('[data-action="menu-tag"][data-tag="POP"]').click();
    await ed.locator('[data-action="menu-ed-visual"]').click();
    // Real picker: confirm with "Use this". Stub picker: it hands the selection straight back.
    if ((await sheet(page).getAttribute('data-kind')) !== 'menu-editor') {
      await sheet(page).getByRole('button', {name: /use this/i}).first().click();
    }
    await expect(sheet(page).locator('#menu-editor')).toBeVisible();
    await expect(sheet(page).locator('#menu-ed-name')).toHaveValue('Cola Zero');
    await expect(sheet(page).locator('#menu-ed-price')).toHaveValue('25');
    await expect(sheet(page).locator('[data-action="menu-tag"][data-tag="POP"]')).toHaveAttribute('aria-pressed', 'true');
    // Cancelling the picker also comes back to the same unsaved editor.
    await sheet(page).locator('#menu-ed-subtitle').fill('No sugar, all fizz');
    await sheet(page).locator('[data-action="menu-ed-visual"]').click();
    if ((await sheet(page).getAttribute('data-kind')) !== 'menu-editor') {
      await sheet(page).getByRole('button', {name: /^cancel$/i}).first().click();
    }
    await expect(sheet(page).locator('#menu-editor')).toBeVisible();
    await expect(sheet(page).locator('#menu-ed-subtitle')).toHaveValue('No sugar, all fizz');
    await expect(sheet(page).locator('#menu-ed-name')).toHaveValue('Cola Zero');
    await save(page, 'menu-save-product');
    expect(await product(page, 'cola')).toMatchObject({name: 'Cola Zero', price: 2500, tags: ['POP']});
  });

  test('filters and search narrow the list', async ({page}) => {
    await row(page, 'cola').locator('[data-action="menu-toggle-soldout"]').click();
    await expect(row(page, 'cola')).toHaveClass(/is-soldout/);
    await page.locator('[data-action="menu-filter"][data-filter="soldout"]').click();
    await expect(page.locator('.menu-row')).toHaveCount(1);
    await expect(row(page, 'cola')).toBeVisible();
    await page.locator('[data-action="menu-filter"][data-filter="all"]').click();
    await page.locator('#menu-search').fill('samosa');
    await expect(page.locator('#menu-search')).toBeFocused();
    await expect(page.locator('.menu-row')).toHaveCount(1);
    await page.locator('#menu-search').fill('zzz');
    await expect(page.locator('.menu-row')).toHaveCount(0);
    await page.locator('[data-action="menu-clear-filter"]').click();
    await expect(page.locator('.menu-row')).toHaveCount(19);
  });

  // --- review regressions ---------------------------------------------------------------------------------------------

  test('cancelling the PIN at the delete confirm keeps the item and says so', async ({page}) => {
    await rowTool(page, 'orange-fizz', 'menu-delete');
    await expect(sheet(page)).toContainText('Delete “Orange Fizz”?');
    // The 10-minute unlock runs out while the confirm sheet is open.
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.lockAdmin()));
    await sheet(page).locator('[data-action="core-confirm"]').click();
    await page.locator('#pin-dialog[open] [data-pin-action="cancel"]').click();
    await expect(sheet(page).locator('[data-error]')).toContainText('Nothing changed');
    await expect(openSheet(page)).toHaveCount(1);
    await expect(page.locator('#toast')).not.toContainText('deleted');
    expect(await product(page, 'orange-fizz')).toBeTruthy();
    // Confirming again with the PIN deletes it.
    await adminClick(page, sheet(page).locator('[data-action="core-confirm"]'));
    await expect(openSheet(page)).toHaveCount(0);
    expect(await product(page, 'orange-fizz')).toBeUndefined();
  });

  test('price board: unlock, edit and lock again saves the new locked price', async ({page}) => {
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.commitConfig(st => {
      st.config.products.find(p => p.id === 'cola').priceLocked = true;
    })));
    await adminClick(page, act(page, 'menu-price-board'));
    const board = sheet(page);
    await expect(board.locator('#menu-pb-cola')).toBeDisabled();
    await board.locator('[data-pb-lock="cola"]').click();
    await board.locator('#menu-pb-cola').fill('42');
    await board.locator('[data-pb-lock="cola"]').click();
    await expect(board.locator('#menu-pb-cola')).toBeDisabled();
    await save(page, 'menu-pb-save');
    expect(await product(page, 'cola')).toMatchObject({price: 4200, priceLocked: true});
  });

  test('editor: unlock, edit and lock again saves the new locked price', async ({page}) => {
    await page.evaluate(() => import('/ui/core.mjs').then(core => core.commitConfig(st => {
      st.config.products.find(p => p.id === 'cola').priceLocked = true;
    })));
    await rowTool(page, 'cola', 'menu-edit-product');
    const ed = sheet(page);
    await expect(ed.locator('#menu-ed-price')).toBeDisabled();
    await ed.locator('[data-field="priceLocked"]').click();
    await ed.locator('#menu-ed-price').fill('38');
    await ed.locator('[data-field="priceLocked"]').click();
    await save(page, 'menu-save-product');
    expect(await product(page, 'cola')).toMatchObject({price: 3800, priceLocked: true});
    // A locked price that was never unlocked in the editor still can't change.
    await rowTool(page, 'cola', 'menu-edit-product');
    await expect(sheet(page).locator('#menu-ed-price')).toHaveValue('38');
    await expect(sheet(page).locator('#menu-ed-price')).toBeDisabled();
  });

  test('search stays quick and focused on a big menu; setup notice reads right', async ({page}) => {
    await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const cat = await import('/catalog.mjs');
      await core.commitConfig(st => {
        cat.setPrices(st.config, {'peri-peri-fries': null});
        for (let i = 0; i < 60; i++) cat.saveProduct(st.config, {name: `पनीर टिक्का ${i} 🌶️`, categoryId: 'hot-crispy', price: 5000});
      });
    });
    await expect(page.locator('.menu-setup')).toContainText('1 item still needs a price. It shows on Sell');
    await page.locator('#menu-search').fill('टिक्का 4');
    await expect(page.locator('.menu-row')).toHaveCount(11);
    await expect(page.locator('#menu-search')).toBeFocused();
    await expect(page.locator('#menu-search')).toHaveValue('टिक्का 4');
    await noOverflow(page, 'big menu search');
  });

  test('no horizontal overflow on the screen and every sheet', async ({page}) => {
    await noOverflow(page, 'menu');
    await rowTool(page, 'veggie-chips-chaat-small', 'menu-edit-product');
    await expect(sheet(page).locator('#menu-editor')).toBeVisible();
    await noOverflow(page, 'editor');
    for (const action of ['menu-new-combo', 'menu-price-board', 'menu-addons', 'menu-stock', 'menu-new-category']) {
      await closeIfOpen(page);
      await act(page, action).click();
      await expect(openSheet(page)).toHaveCount(1);
      await noOverflow(page, action);
    }
    await closeIfOpen(page);
    await row(page, 'cola').locator('[data-action="menu-quick-price"]').click();
    await noOverflow(page, 'quick price');
  });
});
