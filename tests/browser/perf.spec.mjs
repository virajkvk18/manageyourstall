// Render performance guard (owner: lead): illustrations come from one hidden SVG sprite (library.artSprite, injected by
// core.mjs outside #app at boot) so a Sell/Menu re-render stays small and a cart tap re-renders quickly.
import {test, expect} from '@playwright/test';
import {ready, go, act, sheet} from './helpers.mjs';

const KB = 1024;

test.describe('render performance: illustration sprite', () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'no page errors').toEqual([]);
  });

  test('the sprite is injected once, outside #app, and every illustration resolves to one of its symbols', async ({page}) => {
    await ready(page);
    await go(page, 'sell');
    const info = await page.evaluate(() => {
      const symbols = [...document.querySelectorAll('symbol[id^="mys-art-"]')];
      const sprites = new Set(symbols.map(s => s.parentElement));
      const sprite = /** @type {SVGSVGElement} */ ([...sprites][0]);
      const app = /** @type {HTMLElement} */ (document.getElementById('app'));
      const uses = [...app.querySelectorAll('svg use')];
      const ids = new Set(symbols.map(s => s.id));
      return {
        sprites: sprites.size,
        symbols: symbols.length,
        unique: ids.size,
        insideApp: app.contains(sprite),
        inBody: sprite?.parentElement === document.body,
        hidden: sprite ? sprite.getBoundingClientRect().width === 0 && sprite.getBoundingClientRect().height === 0 : false,
        ariaHidden: sprite?.getAttribute('aria-hidden'),
        uses: uses.length,
        cards: app.querySelectorAll('.sell-card').length,
        unresolved: uses.map(u => u.getAttribute('href') || '').filter(h => !ids.has(h.slice(1))),
        // A <use> whose symbol resolves has the illustration's geometry; an unresolved one has an empty box.
        empty: uses.filter(u => {
          const box = /** @type {SVGGraphicsElement} */ (u).getBBox();
          return !(box.width > 10 && box.height > 10);
        }).length,
        inlineArtPaths: app.querySelectorAll('svg.food-art path, svg.sell-hero-svg > g > g > path').length,
      };
    });
    expect(info.sprites, 'exactly one sprite').toBe(1);
    expect(info.symbols).toBeGreaterThanOrEqual(40);
    expect(info.unique).toBe(info.symbols);
    expect(info.insideApp, 'sprite lives outside #app so re-renders never touch it').toBe(false);
    expect(info.inBody).toBe(true);
    expect(info.hidden).toBe(true);
    expect(info.ariaHidden).toBe('true');
    expect(info.cards).toBeGreaterThan(5);
    expect(info.uses, 'card art and hero art are <use> references').toBeGreaterThan(info.cards);
    expect(info.unresolved).toEqual([]);
    expect(info.empty, 'every <use> draws its illustration').toBe(0);
    expect(info.inlineArtPaths, 'no illustration markup is inlined into #app').toBe(0);

    // Re-renders and navigation never duplicate or remove the sprite.
    for (const screen of ['menu', 'dashboard', 'sell']) await go(page, screen);
    await act(page, 'sell-add', '[data-id="pani-puri"]').click();
    await expect(page.locator('#app .sell-card[data-id="pani-puri"], #app [data-id="pani-puri"]').first()).toBeVisible();
    expect(await page.locator('svg:has(> symbol[id^="mys-art-"])').count()).toBe(1);
    expect(await page.locator('#mys-art-packet').count()).toBe(1);
  });

  test("Sell's #app HTML stays small and a cart tap re-renders quickly", async ({page}) => {
    await ready(page);
    await go(page, 'sell');
    const size = await page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('app')).innerHTML.length);
    expect(size, `Sell #app HTML is ${Math.round(size / KB)} KB`).toBeLessThan(150 * KB);

    const timing = await page.evaluate(async () => {
      const core = await import('/ui/core.mjs');
      const app = /** @type {HTMLElement} */ (document.getElementById('app'));
      const frame = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
      const median = (/** @type {number[]} */ a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const renders = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        core.render();
        void app.offsetHeight;
        renders.push(performance.now() - t0);
        await frame();
      }
      // Real taps on a plain priced item: click → state committed → #app re-rendered (new shell node) → layout.
      const taps = [];
      const snapshot = () => JSON.stringify(core.S());
      for (let i = 0; i < 5; i++) {
        const btn = /** @type {HTMLElement} */ (app.querySelector('[data-action="sell-add"][data-id="pani-puri"]'));
        if (!btn) return {error: 'no pani-puri add button'};
        const first = app.firstElementChild;
        const before = snapshot();
        const t0 = performance.now();
        btn.click();
        while ((app.firstElementChild === first || snapshot() === before) && performance.now() - t0 < 5000) {
          await new Promise(res => setTimeout(res, 0));
        }
        void app.offsetHeight;
        taps.push(performance.now() - t0);
        await frame();
      }
      return {render: median(renders), tap: median(taps), html: app.innerHTML.length};
    });
    expect(timing.error).toBeUndefined();
    // Generous bounds (shared CI machines); inline art used to cost several times this on a throttled phone.
    expect(timing.render, `render() median ${timing.render.toFixed(1)} ms`).toBeLessThan(250);
    expect(timing.tap, `tap → re-render median ${timing.tap.toFixed(1)} ms`).toBeLessThan(1500);
    expect(timing.html).toBeLessThan(150 * KB);
    const cart = await page.evaluate(() => import('/ui/core.mjs').then(m => JSON.stringify(m.S())));
    expect(cart).toContain('pani-puri');
  });

  test('sheets (art picker) use the same sprite references', async ({page}) => {
    await ready(page);
    await go(page, 'sell');
    await page.evaluate(() => import('/ui/picker.mjs').then(m => m.openPicker(
      {art: 'samosa', tint: 'cream', pattern: 'none', image: null, name: 'Samosa'}, () => {}, {onCancel() {}})));
    await expect(sheet(page).locator('.pick-wrap')).toBeVisible();
    const thumbs = await sheet(page).evaluate(dlg => {
      const uses = [...dlg.querySelectorAll('.pick-art-thumb svg use')];
      return {uses: uses.length, drawn: uses.filter(u => /** @type {SVGGraphicsElement} */ (u).getBBox().width > 10).length};
    });
    expect(thumbs.uses).toBeGreaterThanOrEqual(40);
    expect(thumbs.drawn).toBe(thumbs.uses);
  });
});
