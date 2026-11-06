import test from 'node:test';
import assert from 'node:assert/strict';
import {ART, ART_LIST, ART_GROUPS, REQUIRED_ART_IDS, artSvg, hasArt, heroSvg, searchArt, FALLBACK_ART, artSprite, useSprite, spriteEnabled,
  SPRITE_PREFIX} from '../dist/library.mjs';

const VOID = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'stop', 'use']);
/** Minimal well-formedness check: every opened element is closed in order. */
function balanced(markup) {
  const stack = [];
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) { if (stack.pop() !== name) return false; }
    else if (!VOID.has(name) || !selfClosing) stack.push(name);
  }
  return stack.length === 0;
}

for (const [group, ids] of Object.entries(REQUIRED_ART_IDS)) {
  test(`art group "${group}" provides every required id`, () => {
    for (const id of ids) {
      assert.ok(hasArt(id), `missing art: ${id}`);
      assert.equal(ART[id].group, group, `${id} should be in group ${group}`);
    }
  });
}

test('library offers at least 25 non-classic illustrations across all groups', () => {
  assert.ok(ART_LIST.filter(a => a.group !== 'classic').length >= 25);
  for (const g of ART_GROUPS) assert.ok(ART_LIST.some(a => a.group === g.id), `group ${g.id} empty`);
});

test('illustrations are safe, self-contained and reasonably small', () => {
  for (const a of ART_LIST) {
    assert.match(a.id, /^[a-z0-9-]{2,40}$/, a.id);
    assert.ok(a.label && a.label.length <= 40, `${a.id} label`);
    assert.ok(Array.isArray(a.keywords), `${a.id} keywords`);
    assert.ok(typeof a.svg === 'string' && a.svg.length > 80, `${a.id} svg too small`);
    assert.ok(a.svg.length <= 9000, `${a.id} svg is ${a.svg.length} chars (max 9000)`);
    assert.doesNotMatch(a.svg, /<script|<foreignObject|<image|href=|url\(|https?:|on[a-z]+=|<style|<svg|\bid=/i, `${a.id} has forbidden markup`);
    assert.ok(balanced(a.svg), `${a.id} has unbalanced tags`);
  }
});

test('artSvg wraps markup and falls back for unknown ids', () => {
  const svg = artSvg('samosa', 'x');
  assert.match(svg, /^<svg class="x" viewBox="0 0 150 150"/);
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(artSvg('does-not-exist').includes(ART[FALLBACK_ART].svg));
});

test('search finds by label, keyword and group', () => {
  assert.ok(searchArt('samosa').some(a => a.id === 'samosa'));
  assert.ok(searchArt('', 'games').every(a => a.group === 'games'));
  assert.ok(searchArt('chai').length >= 2);
});

// ---- Phase 2 (§16.5): generic soda cans and theme heroes ---------------------------------------------------------------

/** Every opening tag name in a markup string. @param {string} markup */
const tagNames = markup => [...markup.matchAll(/<([a-zA-Z][\w-]*)/g)].map(m => m[1]);

test('lime-can and orange-can are generic drinks cans, clearly distinct from cola-can', () => {
  for (const id of ['lime-can', 'orange-can']) {
    assert.ok(REQUIRED_ART_IDS.drinks.includes(id), `${id} is required in the drinks batch`);
    assert.equal(ART[id].group, 'drinks');
    assert.ok(ART[id].keywords.includes('can') && ART[id].keywords.includes('soda'), `${id}: searchable as a soda can`);
    assert.notEqual(ART[id].svg, ART['cola-can'].svg);
    assert.doesNotMatch(ART[id].svg, /<text/i, `${id}: no text or logo on the can`);
    assert.match(ART[id].svg, /fill="#171717" transform="translate\(4 4\)"/, `${id}: hard offset shadow`);
    assert.match(ART[id].svg, /stroke="#171717"/, `${id}: ink outlines`);
  }
  // Body colours: cola is red, lime is lime green, orange is orange.
  assert.match(ART['cola-can'].svg, /fill="#eb4235"/);
  assert.match(ART['lime-can'].svg, /fill="#b9f36b"/);
  assert.match(ART['orange-can'].svg, /fill="#ff9f43"/);
  for (const id of ['lime-can', 'orange-can']) assert.doesNotMatch(ART[id].svg, /#eb4235/, `${id}: no cola red`);
  assert.notEqual(ART['lime-can'].svg, ART['orange-can'].svg);
  assert.ok(searchArt('lime').some(a => a.id === 'lime-can'));
  assert.ok(searchArt('orange soda').some(a => a.id === 'orange-can'));
});

test('heroSvg wraps a wide 360×160 decorative composition', () => {
  const svg = heroSvg(['samosa', 'pani-puri', 'cola-can']);
  assert.match(svg, /^<svg class="hero-art" viewBox="0 0 360 160" aria-hidden="true" focusable="false">/);
  assert.ok(svg.endsWith('</svg>'));
  assert.equal(svg.match(/<svg/g).length, 1, 'one svg element: illustrations are nested groups, not nested svgs');
  assert.ok(balanced(svg), 'balanced tags');
  assert.match(heroSvg(['samosa'], {cls: 'studio-hero x'}), /^<svg class="studio-hero x" /);
  assert.match(heroSvg(['samosa'], {cls: '"><script>'}), /^<svg class="script" /, 'class is sanitized');
  assert.match(heroSvg(['samosa'], {}), /^<svg class="hero-art" /);
});

test('heroSvg places 1–3 illustrations with translate/rotate/scale and keeps their markup intact', () => {
  const placed = /<g transform="translate\(([\d.-]+) ([\d.-]+)\) rotate\(([\d.-]+)\) scale\(([\d.]+)\)">/g;
  for (const ids of [['samosa'], ['samosa', 'cola-can'], ['pani-puri', 'packet', 'samosa']]) {
    const svg = heroSvg(ids);
    const groups = [...svg.matchAll(placed)];
    assert.equal(groups.length, ids.length, `${ids.join()}: one placed group per illustration`);
    for (const [, x, y, r, s] of groups) {
      assert.ok(+x >= 40 && +x <= 320 && +y >= 60 && +y <= 110, `${ids.join()}: centre ${x},${y} inside the hero`);
      assert.ok(Math.abs(+r) <= 15, 'slight tilt only');
      assert.ok(+s >= 0.8 && +s <= 1.2, 'readable scale');
    }
    for (const id of ids) assert.ok(svg.includes(`<g transform="translate(-75 -75)">${ART[id].svg}</g>`), `${id} embedded intact`);
    assert.match(svg, /<ellipse cx="180" cy="148" rx="\d+" ry="7" fill="#171717" opacity="\.14"\/>/, 'soft ground shadow');
  }
  // Three ids read left to right: left and right are drawn first, the middle one last (in front) and biggest.
  const three = heroSvg(['pani-puri', 'packet', 'samosa']);
  const drawOrder = ['pani-puri', 'samosa', 'packet'].map(id => three.indexOf(ART[id].svg));
  assert.ok(drawOrder[0] < drawOrder[1] && drawOrder[1] < drawOrder[2], 'middle illustration is drawn in front');
  const slots = [...three.matchAll(placed)].map(m => ({x: +m[1], s: +m[4]}));
  assert.ok(slots[0].x < slots[2].x && slots[2].x < slots[1].x, 'left, centre, right positions');
  assert.ok(slots[2].s > slots[0].s && slots[2].s > slots[1].s, 'centre illustration is the biggest');
  const xs = slots.map(slot => slot.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 70 && xs[i] - xs[i - 1] <= 120, 'items overlap slightly');
});

test('heroSvg: 4–6 sparkles always; empty, invalid and long lists degrade gracefully', () => {
  for (const ids of [[], ['samosa'], ['samosa', 'kulfi'], ['samosa', 'kulfi', 'burger']]) {
    const sparkles = heroSvg(ids).match(/<g class="hero-sparkles">(.*?)<\/g>/);
    assert.ok(sparkles, `${ids.length} ids: sparkle group`);
    const count = (sparkles[1].match(/<path /g) || []).length;
    assert.ok(count >= 4 && count <= 6, `${ids.length} ids: ${count} sparkles`);
  }
  const empty = heroSvg([]);
  assert.doesNotMatch(empty, /translate\(-75 -75\)/, 'no illustrations for an empty list');
  assert.doesNotMatch(empty, /<ellipse/, 'nothing to stand on, no ground shadow');
  for (const bad of [null, undefined, 'samosa', 42, {}]) assert.equal(heroSvg(/** @type {any} */ (bad)), empty, String(bad));
  // Unknown ids (and non-strings) fall back to FALLBACK_ART in their slot.
  const unknown = heroSvg(['samosa', 'does-not-exist', 'cola-can']);
  assert.ok(unknown.includes(ART[FALLBACK_ART].svg), 'unknown id uses the fallback');
  assert.equal(unknown, heroSvg(['samosa', FALLBACK_ART, 'cola-can']));
  assert.equal(heroSvg([/** @type {any} */ (7)]), heroSvg([FALLBACK_ART]));
  // Only the first three ids are used; output is deterministic.
  assert.equal(heroSvg(['samosa', 'kulfi', 'burger', 'maggi']), heroSvg(['samosa', 'kulfi', 'burger']));
  assert.equal(heroSvg(['samosa', 'kulfi']), heroSvg(['samosa', 'kulfi']));
});

test('heroSvg output is safe: no ids, scripts, external references or forbidden elements', () => {
  const allowed = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
  for (const ids of [[], ['samosa'], ['lime-can', 'cheese-pizza', 'orange-can'], ['ring-toss', 'spin-wheel', 'lucky-cup'], ['x']]) {
    const svg = heroSvg(ids);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|<style|<text|href=|url\(|https?:|on[a-z]+=|\bid=/i, ids.join());
    for (const name of tagNames(svg)) assert.ok(allowed.has(name), `${ids.join()}: unexpected <${name}>`);
    assert.ok(svg.length < 30000, `${ids.join()}: hero is ${svg.length} chars`);
  }
});

// ---- Sprite mode (render performance): one hidden <symbol> sprite, <use> references in artSvg/heroSvg ---------------------

/** Run fn with sprite mode on, always switching it back off (the default every other test relies on). */
function withSprite(fn) {
  useSprite(true);
  try {
    return fn();
  } finally {
    useSprite(false);
  }
}

test('sprite mode is off by default: artSvg/heroSvg inline the full markup', () => {
  assert.equal(spriteEnabled(), false);
  assert.ok(artSvg('samosa').includes(ART.samosa.svg));
  assert.doesNotMatch(artSvg('samosa') + heroSvg(['samosa', 'kulfi']), /<use|href=/);
});

test('artSprite holds one 150×150 <symbol> per illustration, hidden and well formed', () => {
  const sprite = artSprite();
  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" focusable="false">/);
  assert.ok(sprite.endsWith('</svg>'));
  assert.ok(balanced(sprite), 'balanced tags');
  const ids = [...sprite.matchAll(/<symbol id="([^"]+)" viewBox="0 0 150 150">/g)].map(m => m[1]);
  assert.equal(ids.length, ART_LIST.length, 'one symbol per entry');
  assert.equal(new Set(ids).size, ids.length, 'unique symbol ids');
  for (const a of ART_LIST) {
    assert.ok(sprite.includes(`<symbol id="${SPRITE_PREFIX}${a.id}" viewBox="0 0 150 150">${a.svg}</symbol>`), `${a.id} symbol intact`);
  }
  assert.equal((sprite.match(/<svg/g) || []).length, 1, 'symbols are not nested svgs');
  assert.equal(SPRITE_PREFIX, 'mys-art-');
});

test('sprite mode: artSvg references the symbol (with its ground shadow) and falls back for unknown ids', () => {
  withSprite(() => {
    assert.equal(spriteEnabled(), true);
    const svg = artSvg('samosa', 'x');
    assert.equal(svg, '<svg class="x" viewBox="0 0 150 150" aria-hidden="true" focusable="false">' +
      '<ellipse cx="76" cy="136" rx="40" ry="5" fill="#171717" opacity=".12"/><use href="#mys-art-samosa" width="150" height="150"/></svg>');
    assert.ok(!svg.includes(ART.samosa.svg), 'no inline markup');
    assert.match(artSvg('does-not-exist'), /^<svg class="food-art" [^>]*>.*<use href="#mys-art-packet" /);
    assert.ok(balanced(artSvg('kulfi')));
    for (const a of ART_LIST) assert.ok(artSvg(a.id).length < 300, `${a.id}: tiny reference`);
  });
  assert.equal(spriteEnabled(), false);
  assert.ok(artSvg('samosa').includes(ART.samosa.svg), 'switching off restores inline output');
});

test('sprite mode: heroSvg places <use> references with the same layout as inline mode', () => {
  for (const ids of [[], ['samosa'], ['samosa', 'cola-can'], ['pani-puri', 'packet', 'samosa'], ['samosa', 'nope', 7, 'x', 'y']]) {
    const inline = heroSvg(/** @type {any} */ (ids));
    const sprite = withSprite(() => heroSvg(/** @type {any} */ (ids)));
    // Swapping each inlined illustration for its <use> reference gives exactly the sprite output.
    let expected = inline;
    for (const a of ART_LIST) {
      expected = expected.split(`<g transform="translate(-75 -75)">${a.svg}</g>`)
        .join(`<g transform="translate(-75 -75)"><use href="#mys-art-${a.id}" width="150" height="150"/></g>`);
    }
    assert.equal(sprite, expected, ids.join());
    assert.ok(balanced(sprite));
    assert.doesNotMatch(sprite, /<script|<foreignObject|<image|<style|<text|url\(|https?:|on[a-z]+=|\bid=/i);
    assert.ok(sprite.length < 3000, `${ids.join()}: hero is ${sprite.length} chars`);
  }
  const three = withSprite(() => heroSvg(['pani-puri', 'packet', 'samosa'], {cls: 'sell-hero-svg'}));
  assert.match(three, /^<svg class="sell-hero-svg" viewBox="0 0 360 160"/);
  const order = [...three.matchAll(/href="#mys-art-([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['pani-puri', 'samosa', 'packet'], 'middle illustration drawn last (in front)');
});
