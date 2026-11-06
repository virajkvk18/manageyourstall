// Visual picker acceptance tests (picker agent, ARCHITECTURE.md §13.7). The picker is opened directly through its module so
// these tests never depend on the menu screen. It must never commit state: "Use this" hands the selection to onDone.
import {test, expect} from '@playwright/test';
import {ready, sheet, noOverflow, state} from './helpers.mjs';

const SAMOSA = {art: 'samosa', image: null, tint: 'yellow', pattern: 'none', name: 'Samosa'};
const IMG_HOST = 'https://img.example.test';
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#ff9f43"/></svg>';

/**
 * Open the picker straight from its module. window.__picked = selection | 'cancel'; window.__calls counts callbacks.
 * @param {import('@playwright/test').Page} page
 * @param {object} [current]
 */
async function openPick(page, current = SAMOSA) {
  await page.evaluate(cur => import('/ui/picker.mjs').then(m => {
    window.__picked = null;
    window.__calls = 0;
    m.openPicker(cur, sel => {
      window.__picked = sel;
      window.__calls++;
    }, {
      onCancel: () => {
        window.__picked = 'cancel';
        window.__calls++;
      },
    });
  }), current);
  await expect(sheet(page).locator('.pick-wrap')).toBeVisible();
}

const picked = page => page.evaluate(() => window.__picked);
const calls = page => page.evaluate(() => window.__calls);
const tab = (page, id) => sheet(page).locator(`[data-action="pick-tab"][data-tab="${id}"]`);
const useThis = page => sheet(page).locator('[data-action="pick-done"]');

/** A real PNG drawn on a canvas in the page (big enough to need downscaling). */
async function canvasPng(page, width = 1200, height = 800) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `hsl(${i * 37}, 80%, 60%)`;
      x.fillRect((i * 97) % w, (i * 53) % h, w / 4, h / 4);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  return Buffer.from(b64, 'base64');
}

test.describe('visual picker', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(`${IMG_HOST}/ok/**`, r => r.fulfill({status: 200, contentType: 'image/svg+xml', body: SVG_OK}));
    await page.route(`${IMG_HOST}/missing/**`, r => r.fulfill({status: 404, contentType: 'text/plain', body: 'nope'}));
    await ready(page);
  });
  test.afterEach(() => {
    expect(errors, 'page errors').toEqual([]);
  });

  test('library: search, group filter, select → Use this returns the art without committing', async ({page}) => {
    const before = (await state(page)).revision;
    await openPick(page);
    const s = sheet(page);
    await expect(s.locator('#sheet-title')).toHaveText('Pick a look');
    await expect(tab(page, 'library')).toHaveAttribute('aria-selected', 'true');
    await expect(s.locator('.pick-preview-name')).toHaveText('Samosa');
    await expect(s.locator('[data-action="pick-art"][data-art="samosa"]')).toHaveAttribute('aria-pressed', 'true');

    await s.locator('#pick-search').fill('momo');
    await expect(s.locator('[data-action="pick-art"][data-art="steamed-momos"]')).toBeVisible();
    await expect(s.locator('[data-action="pick-art"]')).toHaveCount(2);
    await expect(s.locator('.pick-count')).toHaveText('2 illustrations');
    await expect(s.locator('[data-action="pick-art"][data-art="samosa"]')).toHaveCount(0);
    await expect(s.locator('#pick-search')).toBeFocused();

    await s.locator('#pick-search').fill('zzzz-nothing');
    await expect(s.locator('.pick-empty')).toContainText('No art for');
    await s.locator('[data-action="pick-clear-search"]').click();
    await expect(s.locator('#pick-search')).toHaveValue('');

    await s.locator('[data-action="pick-group"][data-group="drinks"]').click();
    await expect(s.locator('[data-action="pick-group"][data-group="drinks"]')).toHaveAttribute('aria-pressed', 'true');
    const ids = await s.locator('[data-action="pick-art"]').evaluateAll(els => els.map(e => e.getAttribute('data-art')));
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids).toContain('lemon-fizz');
    expect(ids).not.toContain('samosa');

    const lemon = s.locator('[data-action="pick-art"][data-art="lemon-fizz"]');
    await lemon.click();
    await expect(lemon).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('.pick-preview-meta')).toContainText('art');
    await expect(s.locator('[aria-pressed="true"][data-action="pick-art"]')).toHaveCount(1);
    await noOverflow(page, 'library tab');

    await useThis(page).click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toEqual({art: 'lemon-fizz', image: null, tint: 'yellow', pattern: 'none'});
    expect(await calls(page)).toBe(1);
    expect((await state(page)).revision).toBe(before);
  });

  test('style: tint and pattern swatches update the preview and the selection', async ({page}) => {
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'style').click();
    await expect(tab(page, 'style')).toHaveAttribute('aria-selected', 'true');
    await expect(s.locator('[data-action="pick-remove-photo"]')).toHaveCount(0);
    const mint = s.locator('[data-action="pick-tint"][data-tint="mint"]');
    await mint.click();
    await expect(mint).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('[data-action="pick-tint"][data-tint="yellow"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(s.locator('.pick-preview .art-frame')).toHaveClass(/tint-mint/);
    const dots = s.locator('[data-action="pick-pattern"][data-pattern="dots"]');
    await dots.click();
    await expect(dots).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('.pick-preview .art-frame')).toHaveClass(/pattern-dots/);
    await noOverflow(page, 'style tab');

    // Choices persist across tabs.
    await tab(page, 'library').click();
    await expect(s.locator('.pick-art-thumb').first()).toHaveClass(/tint-mint/);
    await useThis(page).click();
    expect(await picked(page)).toEqual({art: 'samosa', image: null, tint: 'mint', pattern: 'dots'});
  });

  test('upload: a PNG is downscaled, stored as media and returned as media:<id>', async ({page}) => {
    const before = (await state(page)).revision;
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'upload').click();
    await expect(s.getByText('Stored on this device · works offline.')).toBeVisible();
    await s.locator('#pick-file').setInputFiles({name: 'stall-photo.png', mimeType: 'image/png', buffer: await canvasPng(page)});
    await expect(s.locator('.pick-upload-current')).toContainText('Photo saved!');
    await expect(s.locator('.pick-preview .art-img')).toBeVisible();
    await expect(s.locator('.pick-source')).toContainText('Your photo');
    await noOverflow(page, 'upload tab');

    // Picking a second photo replaces the first; the unused one is tidied up after "Use this".
    await s.locator('#pick-file').setInputFiles({name: 'second.png', mimeType: 'image/png', buffer: await canvasPng(page, 500, 900)});
    await expect(s.locator('.pick-upload-current small')).toContainText('×320px');

    await useThis(page).click();
    const sel = await picked(page);
    expect(sel.image).toMatch(/^media:[a-zA-Z0-9_-]+$/);
    expect(sel).toMatchObject({art: 'samosa', tint: 'yellow', pattern: 'none'});
    const info = await page.evaluate(async ref => {
      const storage = await import('/storage.mjs');
      const all = await storage.getAllMedia();
      const data = all[ref.slice(6)];
      if (!data) return {ids: Object.keys(all)};
      const img = new Image();
      img.src = data;
      await img.decode();
      return {ids: Object.keys(all), prefix: data.slice(0, 16), bytes: storage.mediaBytes(data), w: img.naturalWidth, h: img.naturalHeight};
    }, sel.image);
    expect(info.ids).toContain(sel.image.slice(6));
    await expect.poll(() => page.evaluate(() => import('/storage.mjs').then(m => m.getAllMedia()).then(a => Object.keys(a).length))).toBe(1);
    expect(info.prefix).toMatch(/^data:image\/(webp|jpeg)/);
    expect(info.bytes).toBeLessThanOrEqual(150 * 1024);
    expect(Math.max(info.w, info.h)).toBeLessThanOrEqual(320);
    expect(info.h).toBe(320);
    expect((await state(page)).revision).toBe(before);
  });

  test('upload: unsupported files get a friendly error and nothing is stored', async ({page}) => {
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'upload').click();
    await s.locator('#pick-file').setInputFiles({name: 'IMG_0420.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really heic')});
    await expect(s.locator('.pick-upload-status[role="alert"]')).toContainText('HEIC');
    await s.locator('#pick-file').setInputFiles({name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello')});
    await expect(s.locator('.pick-upload-status[role="alert"]')).toContainText('isn’t a picture');
    await s.locator('#pick-file').setInputFiles({name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('definitely not a png')});
    await expect(s.locator('.pick-upload-status[role="alert"]')).toContainText(/Couldn’t open that photo|didn’t work/);
    await expect(s.locator('.pick-source')).toContainText('Illustration');
    const count = await page.evaluate(() => import('/storage.mjs').then(m => m.getAllMedia()).then(a => Object.keys(a).length));
    expect(count).toBe(0);
    await s.locator('[data-action="pick-cancel"]').click();
    expect(await picked(page)).toBe('cancel');
  });

  test('link: validates https, previews loading/error/ok and returns the URL', async ({page}) => {
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'link').click();
    await expect(s.getByText('Needs internet — the illustration shows when offline.')).toBeVisible();
    const input = s.locator('#pick-url');

    await input.fill('http://img.example.test/ok/samosa.svg');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(s.locator('#pick-url-msg')).toContainText('https://');
    await useThis(page).click();
    await expect(s.locator('[data-error]')).toBeVisible();
    await expect(page.locator('#sheet[open]')).toHaveCount(1);
    expect(await picked(page)).toBeNull();

    await input.fill('not a link');
    await expect(s.locator('#pick-url-msg')).toContainText('spaces');

    await input.fill(`${IMG_HOST}/missing/x.png`);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(s.locator('#pick-link-preview')).toHaveAttribute('data-state', 'error');
    await expect(s.locator('#pick-link-preview')).toContainText('Couldn’t load');

    const url = `${IMG_HOST}/ok/samosa.svg`;
    await input.fill(url);
    await expect(s.locator('#pick-link-preview')).toHaveAttribute('data-state', 'ok');
    await expect(s.locator('.pick-link-img')).toBeVisible();
    await expect(s.locator('.pick-source')).toContainText('Web link');
    await noOverflow(page, 'link tab');

    await useThis(page).click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toEqual({art: 'samosa', image: url, tint: 'yellow', pattern: 'none'});
  });

  test('an existing photo opens on its tab, can be removed, and choosing art clears it', async ({page}) => {
    const url = `${IMG_HOST}/ok/pic.svg`;
    await openPick(page, {...SAMOSA, image: url, tint: 'sky', pattern: 'grid'});
    const s = sheet(page);
    await expect(tab(page, 'link')).toHaveAttribute('aria-selected', 'true');
    await expect(s.locator('#pick-url')).toHaveValue(url);
    await tab(page, 'style').click();
    await s.locator('[data-action="pick-remove-photo"]').click();
    await expect(s.locator('[data-action="pick-remove-photo"]')).toHaveCount(0);
    await expect(s.locator('.pick-source')).toContainText('Illustration');
    await useThis(page).click();
    expect(await picked(page)).toEqual({art: 'samosa', image: null, tint: 'sky', pattern: 'grid'});

    await openPick(page, {...SAMOSA, image: url});
    await tab(page, 'library').click();
    await expect(s.locator('.pick-photo-note')).toBeVisible();
    await s.locator('[data-action="pick-art"][data-art="kachori"]').click();
    await expect(s.locator('.pick-photo-note')).toHaveCount(0);
    await useThis(page).click();
    expect(await picked(page)).toEqual({art: 'kachori', image: null, tint: 'yellow', pattern: 'none'});
  });

  test('Cancel, the close button and Escape call onCancel exactly once; tabs work by keyboard', async ({page}) => {
    await openPick(page);
    await sheet(page).locator('[data-action="pick-cancel"]').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toBe('cancel');
    expect(await calls(page)).toBe(1);

    await openPick(page);
    await sheet(page).locator('.sheet-close').click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toBe('cancel');

    await openPick(page);
    await tab(page, 'library').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'upload')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'upload')).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(page, 'style')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'library')).toBeFocused();
    await expect(sheet(page).locator('#pick-panel')).toHaveAttribute('aria-labelledby', 'pick-tab-library');
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toBe('cancel');
    expect(await calls(page)).toBe(1);

    // onCancel never follows onDone.
    await openPick(page);
    await useThis(page).click();
    await expect(page.locator('#sheet[open]')).toHaveCount(0);
    expect(await picked(page)).toEqual({art: 'samosa', image: null, tint: 'yellow', pattern: 'none'});
    expect(await calls(page)).toBe(1);
  });

  // --- Regressions found in independent review -----------------------------------------------------------------------

  test('review: the sheet keeps one height across tabs and the photo notice is laid out as a grid', async ({page}) => {
    await openPick(page, {...SAMOSA, image: `${IMG_HOST}/ok/pic.svg`});
    const s = sheet(page);
    const heights = [];
    for (const id of ['library', 'upload', 'link', 'style']) {
      await tab(page, id).click();
      await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
      heights.push(await s.evaluate(el => Math.round(el.getBoundingClientRect().height)));
    }
    expect(Math.max(...heights) - Math.min(...heights), `sheet heights ${heights}`).toBeLessThanOrEqual(2);
    // Base `.notice:has(> .icon)` is flex; the picker's grid layout must win so phones stack the button under the text.
    const note = s.locator('.pick-photo-note');
    await expect(note).toHaveCSS('display', 'grid');
    const box = await note.evaluate(el => {
      const text = el.querySelector('.grow').getBoundingClientRect();
      return {text: text.width, note: el.getBoundingClientRect().width};
    });
    if ((page.viewportSize()?.width || 0) <= 767) expect(box.text).toBeGreaterThan(box.note * 0.6);
  });

  test('review: a typed link is fetched once typing pauses, and a bad link on Use this focuses the field', async ({page}) => {
    /** @type {string[]} */
    const hits = [];
    page.on('request', r => {
      if (r.url().startsWith(IMG_HOST)) hits.push(r.url());
    });
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'link').click();
    const url = `${IMG_HOST}/ok/typed-samosa.svg`;
    await s.locator('#pick-url').pressSequentially(url, {delay: 15});
    await expect(s.locator('#pick-link-preview')).toHaveAttribute('data-state', 'ok');
    await expect(s.locator('.pick-source')).toContainText('Web link');
    // Debounced: the final link is fetched, and not one request per keystroke. A busy machine can stall >300 ms
    // mid-typing (a genuine pause), so allow a stray partial fetch or two — the old bug fetched ~10 partial links.
    const distinct = [...new Set(hits)];
    expect(distinct).toContain(url);
    expect(distinct.length).toBeLessThanOrEqual(3);

    await s.locator('#pick-url').fill('www.example.com/a.png');
    await s.locator('.sheet-close').focus();
    await useThis(page).click();
    await expect(s.locator('.sheet-body > [data-error]')).toContainText('https://');
    await expect(s.locator('#pick-url')).toBeFocused();
    expect(await picked(page)).toBeNull();
  });

  test('review: a link preview that failed offline retries when the device is back online', async ({page, context}) => {
    // Routed requests bypass setOffline, so this route fails on its own while "offline".
    let offline = true;
    await page.route(`${IMG_HOST}/flaky/**`, r => (offline
      ? r.abort('internetdisconnected')
      : r.fulfill({status: 200, contentType: 'image/svg+xml', body: SVG_OK})));
    await openPick(page);
    const s = sheet(page);
    await tab(page, 'link').click();
    await context.setOffline(true);
    await s.locator('#pick-url').fill(`${IMG_HOST}/flaky/offline.svg`);
    await expect(s.locator('#pick-link-preview')).toHaveAttribute('data-state', 'error');
    await expect(s.locator('#pick-link-preview')).toContainText('offline');
    offline = false;
    await context.setOffline(false);
    await expect(s.locator('#pick-link-preview')).toHaveAttribute('data-state', 'ok');
    await expect(s.locator('.pick-link-img')).toBeVisible();
  });

  test('review: a photo that finishes saving after switching tabs updates the visible panel', async ({page}) => {
    await openPick(page);
    const s = sheet(page);
    // Hold the decode until the test switches tabs.
    await page.evaluate(() => {
      const real = window.createImageBitmap.bind(window);
      window.__gate = new Promise(resolve => {
        window.__release = resolve;
      });
      window.createImageBitmap = async (...args) => {
        await window.__gate;
        return real(...args);
      };
    });
    await tab(page, 'upload').click();
    await s.locator('#pick-file').setInputFiles({name: 'slow.png', mimeType: 'image/png', buffer: await canvasPng(page, 400, 300)});
    await expect(s.locator('.pick-upload-status')).toContainText('Shrinking');
    await tab(page, 'library').click();
    await expect(s.locator('[data-action="pick-art"][data-art="samosa"]')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.__release());
    await expect(s.locator('.pick-source')).toContainText('Your photo');
    await expect(s.locator('.pick-photo-note')).toBeVisible();
    await expect(s.locator('[data-action="pick-art"][aria-pressed="true"]')).toHaveCount(0);
    await expect(tab(page, 'library')).toHaveAttribute('aria-selected', 'true');
    await useThis(page).click();
    expect((await picked(page)).image).toMatch(/^media:/);
  });

  test('owner text is escaped and every tab fits the screen', async ({page}) => {
    await openPick(page, {...SAMOSA, name: '<img src=x onerror=alert(1)> Masala "Bomb"'});
    const s = sheet(page);
    await expect(s.locator('.pick-preview-name')).toHaveText('<img src=x onerror=alert(1)> Masala "Bomb"');
    for (const id of ['library', 'upload', 'link', 'style']) {
      await tab(page, id).click();
      await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
      await noOverflow(page, `${id} tab`);
      const wide = await s.locator('.sheet-body').evaluate(el => el.scrollWidth - el.clientWidth);
      expect(wide, `${id} panel scrolls sideways`).toBeLessThanOrEqual(0);
    }
    const small = await s.locator('button:visible').evaluateAll(els => els
      .map(el => ({t: el.textContent.trim().slice(0, 20), h: el.getBoundingClientRect().height}))
      .filter(b => b.h < 40));
    expect(small).toEqual([]);
  });
});
