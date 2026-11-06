// Unit tests for dist/templates.mjs: stall themes / starter templates (ARCHITECTURE.md §5 and §16.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TEMPLATES, TEMPLATE_ALIASES, buildTemplate, resolveTemplateId} from '../dist/templates.mjs';
import {REQUIRED_ART_IDS} from '../dist/library.mjs';
import {validateConfig} from '../dist/catalog.mjs';
import {
  ACCENTS, HEX_RE, ID_RE, LIMITS, MAX_CATEGORIES, MAX_PRODUCTS, MILESTONE_TYPE_IDS, PATTERN_IDS, TAG_IDS, TINT_IDS,
} from '../dist/constants.mjs';

const IDS = ['street-chaat', 'snacks-pizza', 'chai-maggi', 'momo-corner', 'sweet-tooth', 'drinks-games', 'blank'];
const MENU_IDS = IDS.filter(id => id !== 'blank');
const ART_IDS = new Set(Object.values(REQUIRED_ART_IDS).flat());
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRODUCT_KEYS = ['id', 'name', 'subtitle', 'categoryId', 'size', 'price', 'priceLocked', 'art', 'image', 'tint', 'pattern',
  'tags', 'active', 'soldOut', 'customizable', 'stockKey', 'stockUnits', 'bundle'];
const BUILD_KEYS = ['templateId', 'accent', 'theme', 'tagline', 'subTagline', 'categories', 'products', 'addons', 'flavours',
  'games', 'discounts', 'allowCustomDiscount', 'mission', 'milestones', 'inventory', 'stock', 'kitchenQueue'];
const THEME_KEYS = ['accent', 'heroArt', 'heroPattern', 'heroTint', 'secondary'];
const MISSION_LABELS = ['Stall rent', 'Raw materials', 'Disposables & plates', 'Banner & decor', 'Helper cost'];
/** Bigger rank = bigger portion. Pairs used by templates: Small/Large, Half/Full, Regular/Large. */
const SIZE_RANK = {Small: 0, Half: 0, Regular: 1, Medium: 1, Large: 2, Full: 2};
/** Light sanity check that an illustration fits the item it is drawn for (non-combo products; whole words only). */
const ART_HINTS = [
  [/\bchips\b/i, ['packet', 'corn', 'chips-packet']],
  [/\bfries\b/i, ['french-fries', 'peri-peri-fries']],
  [/\bnachos\b/i, ['nachos']],
  [/\bpizza\b/i, ['veg-pizza', 'cheese-pizza', 'pizza']],
  [/\bmomos?\b/i, ['steamed-momos', 'fried-momos']],
  [/\bmaggi\b/i, ['maggi']],
  [/\bchai\b/i, ['masala-chai', 'kulhad-chai']],
  [/\bhot coffee\b/i, ['hot-coffee']],
  [/\bcold coffee\b/i, ['cold-coffee']],
  [/\bcola\b/i, ['cola-can', 'cold']],
  [/\b(lemon|shikanji|nimbu)\b/i, ['lemon-fizz', 'lemon']],
  [/\blime\b/i, ['lime-can', 'lemon-fizz', 'lemon']],
  [/\borange\b/i, ['orange-fizz', 'orange-can', 'masala']],
  [/\bmojitos?\b/i, ['mint-mojito']],
  [/\blassi\b/i, ['lassi']],
  [/\bmilkshake\b/i, ['milkshake']],
  [/\bsamosa\b/i, ['samosa']],
  [/\btikki\b/i, ['aloo-tikki']],
  [/\bkachori\b/i, ['kachori']],
  [/\bpani puri\b/i, ['pani-puri']],
  [/\bbhel\b/i, ['bhel-puri']],
  [/\bkulfi\b/i, ['kulfi']],
  [/\bgulab jamun\b/i, ['gulab-jamun']],
  [/\bbrownie\b/i, ['brownie-sundae']],
  [/\bburger\b/i, ['burger']],
  [/\bfrankie\b/i, ['frankie-roll']],
  [/\bsandwich\b/i, ['grilled-sandwich']],
  [/\bpav bhaji\b/i, ['pav-bhaji']],
  [/\bchole bhature\b/i, ['chole-bhature']],
];
/** Generic names only: no packaged-food or drink brands (Maggi is the one generic-ized name the brief asks for). */
const BRANDS = new RegExp([
  'coca', 'pepsi', 'sprite', 'fanta', 'thums', 'limca', 'mirinda', '7\\s?up', 'mountain dew', "\\blay[’']?s\\b", 'kurkure', 'oreo',
  'kit\\s?kat', 'nescaf', 'bournvita', 'red\\s?bull', 'frooti', 'maaza', 'cadbury', 'nutella', 'haldiram', 'bisleri',
].join('|'), 'i');

/**
 * The original chips-chaat stall products (Phase-1 'snacks-pizza' default) that street-chaat must carry over unchanged:
 * other modules' tests and existing installs rely on these ids, prices, art and stock pools.
 * [id, name, rupees, art, customizable, stockKey, stockUnits]
 */
const CARRIED_OVER = [
  ['veggie-chips-chaat-small', 'Veggie Chips Chaat · Small', 40, 'packet', true, 'chips-small', 1],
  ['veggie-chips-chaat-large', 'Veggie Chips Chaat · Large', 60, 'packet', true, 'chips-large', 1],
  ['corn-chips-chaat-small', 'Corn Chips Chaat · Small', 50, 'corn', true, 'chips-small', 1],
  ['corn-chips-chaat-large', 'Corn Chips Chaat · Large', 70, 'corn', true, 'chips-large', 1],
  ['cheese-chips-chaat-small', 'Cheese Chips Chaat · Small', 60, 'chips-packet', true, 'chips-small', 1],
  ['cheese-chips-chaat-large', 'Cheese Chips Chaat · Large', 80, 'chips-packet', true, 'chips-large', 1],
  ['peri-peri-fries', 'Peri Peri Fries', 70, 'peri-peri-fries', false, 'fries', 1],
  ['french-fries', 'French Fries', 60, 'french-fries', false, 'fries', 1],
  ['cola', 'Cola', 30, 'cola-can', false, 'cola', 1],
  ['lemon-fizz', 'Lemon Fizz', 30, 'lemon-fizz', false, 'lemon-fizz', 1],
  ['orange-fizz', 'Orange Fizz', 30, 'orange-fizz', false, 'orange-fizz', 1],
];

/** Display name without the " · Size" suffix. @param {{name: string}} p */
const baseName = p => p.name.split(' · ')[0];
/** Same rule as util.slug (without its 'stall' fallback). @param {string} text */
const slugOf = text => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Σ component price × quantity for a combo. */
const separatePrice = (t, combo) =>
  combo.bundle.reduce((sum, part) => sum + t.products.find(p => p.id === part.productId).price * part.quantity, 0);
/** Every object and array inside a JSON-like value (including the value itself). */
function containers(value, out = []) {
  if (value !== null && typeof value === 'object') {
    out.push(value);
    for (const child of Object.values(value)) containers(child, out);
  }
  return out;
}
/** A minimal valid §2 + §16.1 Config with the built template merged in (mirrors domain.initialState). */
function configFor(t) {
  return {
    schema: 2,
    templateId: t.templateId,
    profile: {
      stallName: 'My Awesome Stall', booth: 'Stall No. 1', tagline: t.tagline, subTagline: t.subTagline, eventName: 'College Fest',
      venue: '', city: '', eventDate: '', ownerName: 'Team Stall', initials: '',
    },
    theme: {...t.theme, themeId: t.templateId, heroImage: null},
    team: {members: [], splitMode: 'equal'},
    upi: {id: '', payeeName: ''},
    operator: 'Team Stall',
    operators: ['Team Stall', 'Cashier 1', 'Cashier 2'],
    kitchenQueue: t.kitchenQueue,
    allowCustomDiscount: t.allowCustomDiscount,
    inventory: t.inventory,
    stock: t.stock,
    categories: t.categories,
    products: t.products,
    addons: t.addons,
    flavours: t.flavours,
    games: t.games,
    discounts: t.discounts,
    mission: t.mission,
    milestones: t.milestones,
  };
}

test('TEMPLATES lists six stall themes + blank in picker order with complete, frozen card metadata', () => {
  assert.deepEqual(TEMPLATES.map(t => t.id), IDS);
  assert.deepEqual(TEMPLATES.map(t => t.name), [
    'Pataka Street Chaat & Snacks', 'Pizza & Fizz Hub', 'Chai, Coffee & Maggi Point', 'Momo & Fast-Food Corner',
    'Sweet Tooth & Dessert Bar', 'Mela Games & Lucky Zone', 'Blank stall',
  ]);
  assert.equal(TEMPLATES[0].id, 'street-chaat', 'the default template for new installs comes first');
  for (const t of TEMPLATES) {
    assert.deepEqual(Object.keys(t).sort(), ['accent', 'art', 'description', 'emoji', 'id', 'name', 'tagline', 'theme'], t.id);
    for (const key of ['name', 'emoji', 'tagline', 'description']) {
      assert.equal(typeof t[key], 'string', `${t.id}.${key}`);
      assert.ok(t[key].length > 0 && t[key] === t[key].trim(), `${t.id}.${key} must be non-empty and trimmed`);
    }
    assert.ok([...t.emoji].length <= 3, `${t.id}: emoji should be a single emoji`);
    assert.ok(t.tagline.length <= LIMITS.tagline, `${t.id}: tagline is longer than ${LIMITS.tagline}`);
    assert.ok(t.description.length <= 160, `${t.id}: description should be short`);
    assert.equal(t.description.match(/[.!?](?=\s|$)/g)?.length, 1, `${t.id}: description should be exactly one sentence`);
    assert.match(t.accent, HEX_RE);
    assert.ok(ACCENTS.includes(t.accent), `${t.id}: accent ${t.accent} should be one of the Studio swatches`);
    assert.ok(ART_IDS.has(t.art), `${t.id}: card art ${t.art} is not in REQUIRED_ART_IDS`);
  }
  assert.ok(Object.isFrozen(TEMPLATES) && TEMPLATES.every(t => Object.isFrozen(t)), 'TEMPLATES must be frozen');
  assert.ok(TEMPLATES.every(t => Object.isFrozen(t.theme) && Object.isFrozen(t.theme.heroArt)), 'themes must be frozen too');
});

test('every theme carries a distinct, joyful palette and a valid hero (§16.5)', () => {
  for (const t of TEMPLATES) {
    const th = t.theme;
    assert.deepEqual(Object.keys(th).sort(), THEME_KEYS, t.id);
    assert.match(th.accent, HEX_RE, `${t.id}: accent`);
    assert.match(th.secondary, HEX_RE, `${t.id}: secondary`);
    assert.equal(th.accent, t.accent, `${t.id}: theme.accent mirrors the card accent`);
    assert.notEqual(th.secondary.toUpperCase(), th.accent.toUpperCase(), `${t.id}: secondary must differ from accent`);
    assert.ok(Array.isArray(th.heroArt) && th.heroArt.length === 3, `${t.id}: heroArt has 3 ids`);
    assert.equal(new Set(th.heroArt).size, 3, `${t.id}: heroArt ids are distinct`);
    for (const art of th.heroArt) assert.ok(ART_IDS.has(art), `${t.id}: hero art ${art} is not in REQUIRED_ART_IDS`);
    assert.ok(TINT_IDS.includes(th.heroTint), `${t.id}: heroTint ${th.heroTint}`);
    assert.ok(PATTERN_IDS.includes(th.heroPattern), `${t.id}: heroPattern ${th.heroPattern}`);
  }
  const unique = (list, what) => assert.equal(new Set(list).size, list.length, what);
  unique(TEMPLATES.map(t => t.theme.accent.toUpperCase()), 'every theme has its own accent');
  unique(TEMPLATES.map(t => t.theme.secondary.toUpperCase()), 'every theme has its own secondary colour');
  unique(TEMPLATES.map(t => t.theme.heroTint), 'every theme has its own hero background');
  unique(TEMPLATES.map(t => [...t.theme.heroArt].sort().join()), 'every theme has its own hero illustration');
  assert.ok(new Set(TEMPLATES.map(t => t.theme.heroPattern)).size >= 4, 'hero patterns are varied');
  assert.ok(TEMPLATES.some(t => t.theme.heroArt.includes('lime-can') && t.theme.heroArt.includes('orange-can')), 'new cans star');
});

test('buildTemplate(id).theme is a fresh, mutable copy of the card theme', () => {
  for (const info of TEMPLATES) {
    const t = buildTemplate(info.id);
    assert.deepEqual(t.theme, {...info.theme, heroArt: [...info.theme.heroArt]}, info.id);
    assert.notEqual(t.theme, info.theme);
    assert.notEqual(t.theme.heroArt, info.theme.heroArt);
    assert.ok(!Object.isFrozen(t.theme) && !Object.isFrozen(t.theme.heroArt), `${info.id}: builds are mutable`);
    t.theme.heroArt.push('junk');
    t.theme.accent = '#000000';
    assert.equal(info.theme.heroArt.length, 3);
    assert.equal(buildTemplate(info.id).theme.accent, info.accent, `${info.id}: mutation leaked`);
    assert.deepEqual(buildTemplate(info.id).theme.heroArt, [...info.theme.heroArt], `${info.id}: mutation leaked`);
  }
});

test('buildTemplate returns every config section plus the card hero copy, accent and theme', () => {
  for (const info of TEMPLATES) {
    for (const withPrices of [true, false]) {
      const t = buildTemplate(info.id, {withPrices});
      assert.deepEqual(Object.keys(t).sort(), [...BUILD_KEYS].sort(), info.id);
      assert.equal(t.templateId, info.id);
      assert.equal(t.accent, info.accent);
      assert.equal(t.theme.accent, info.accent);
      assert.equal(t.tagline, info.tagline);
      assert.ok(typeof t.subTagline === 'string' && t.subTagline.length > 0, `${info.id}: subTagline`);
      assert.equal(t.inventory, false);
      assert.equal(t.kitchenQueue, true);
      assert.equal(t.allowCustomDiscount, true);
      for (const key of ['categories', 'products', 'addons', 'flavours', 'games', 'discounts', 'milestones']) {
        assert.ok(Array.isArray(t[key]), `${info.id}.${key} must be an array`);
      }
      assert.ok(t.stock && typeof t.stock === 'object' && !Array.isArray(t.stock), `${info.id}.stock must be a plain object`);
    }
  }
  assert.deepEqual(buildTemplate('street-chaat'), buildTemplate('street-chaat', {withPrices: true}), 'prices are on by default');
  assert.deepEqual(buildTemplate('street-chaat', {}), buildTemplate('street-chaat', {withPrices: true}));
});

test("'chaat-momo' is an unlisted alias that builds momo-corner", () => {
  assert.deepEqual({...TEMPLATE_ALIASES}, {'chaat-momo': 'momo-corner'});
  assert.ok(Object.isFrozen(TEMPLATE_ALIASES));
  assert.ok(!TEMPLATES.some(t => t.id === 'chaat-momo'), 'aliases are not listed in the picker');
  assert.deepEqual(buildTemplate('chaat-momo'), buildTemplate('momo-corner'));
  assert.deepEqual(buildTemplate('chaat-momo', {withPrices: false}), buildTemplate('momo-corner', {withPrices: false}));
  assert.equal(buildTemplate('chaat-momo').templateId, 'momo-corner', 'builds always carry the listed id');
  assert.equal(resolveTemplateId('chaat-momo'), 'momo-corner');
  for (const id of IDS) assert.equal(resolveTemplateId(id), id);
  for (const id of ['', 'nope', 'legacy', 'Chaat-Momo', 'constructor', '__proto__', 'toString', undefined, null, 42]) {
    assert.equal(resolveTemplateId(id), null, `resolve ${String(id)}`);
  }
});

test('every product is a fully populated §2 product', () => {
  for (const id of IDS) {
    for (const withPrices of [true, false]) {
      const t = buildTemplate(id, {withPrices});
      assert.ok(t.products.length <= MAX_PRODUCTS);
      for (const p of t.products) {
        const where = `${id}/${p.id}`;
        assert.deepEqual(Object.keys(p).sort(), [...PRODUCT_KEYS].sort(), `${where}: every §2 field, nothing else`);
        for (const key of ['id', 'name', 'subtitle', 'categoryId', 'size', 'art', 'tint', 'pattern', 'stockKey']) {
          assert.equal(typeof p[key], 'string', `${where}.${key}`);
        }
        assert.ok(p.price === null || Number.isSafeInteger(p.price), `${where}.price`);
        assert.equal(p.priceLocked, false, `${where}.priceLocked`);
        assert.equal(p.image, null, `${where}.image`);
        assert.equal(p.active, true, `${where}.active`);
        assert.equal(p.soldOut, false, `${where}.soldOut`);
        assert.equal(typeof p.customizable, 'boolean', `${where}.customizable`);
        assert.ok(Array.isArray(p.tags), `${where}.tags`);
        assert.ok(Number.isSafeInteger(p.stockUnits) && p.stockUnits >= 1, `${where}.stockUnits`);
        assert.ok(p.bundle === null || (Array.isArray(p.bundle) && p.bundle.length > 0), `${where}.bundle`);
      }
    }
  }
});

test('ids are unique, deterministic slugs within every collection', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    const collections = {
      categories: t.categories, products: t.products, addons: t.addons, games: t.games, discounts: t.discounts,
      'mission items': t.mission.items, milestones: t.milestones,
    };
    for (const [what, list] of Object.entries(collections)) {
      const ids = list.map(x => x.id);
      assert.equal(new Set(ids).size, ids.length, `${id} ${what}: duplicate ids in ${ids.join(', ')}`);
      for (const x of ids) {
        assert.match(x, ID_RE, `${id} ${what}: ${x}`);
        assert.match(x, SLUG_RE, `${id} ${what}: ${x} should be a lowercase slug`);
      }
    }
    for (const key of Object.keys(t.stock)) assert.match(key, SLUG_RE, `${id}: stock pool ${key}`);
    // Slugs of the display names, so other modules and tests can guess them ('masala-chai', 'combo-…').
    for (const p of t.products) assert.equal(p.id, (p.bundle ? 'combo-' : '') + slugOf(p.name), `${id}/${p.id}`);
    for (const x of [...t.categories, ...t.addons, ...t.games]) assert.equal(x.id, slugOf(x.name), `${id}/${x.id}`);
    for (const x of t.mission.items) assert.equal(x.id, slugOf(x.label), `${id}/${x.id}`);
    // Names are unique too (receipts, reports and bestseller lists show names).
    const names = t.products.map(p => p.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${id}: duplicate product names`);
    const categoryNames = t.categories.map(c => c.name.toLowerCase());
    assert.equal(new Set(categoryNames).size, categoryNames.length, `${id}: duplicate category names`);
  }
});

test('products reference existing categories, are grouped in category order, and no category is empty', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    assert.ok(t.categories.length >= 1 && t.categories.length <= MAX_CATEGORIES, `${id}: category count`);
    const order = t.categories.map(c => c.id);
    let previous = 0;
    for (const p of t.products) {
      const index = order.indexOf(p.categoryId);
      assert.ok(index >= 0, `${id}/${p.id}: unknown category ${p.categoryId}`);
      assert.ok(index >= previous, `${id}/${p.id}: products must be listed grouped in category order`);
      previous = index;
    }
    if (id === 'blank') continue;
    for (const c of t.categories) assert.ok(t.products.some(p => p.categoryId === c.id), `${id}: category ${c.name} is empty`);
  }
});

test('withPrices:false sets every product price to null and changes nothing else (theme and bill suggestions stay)', () => {
  for (const id of IDS) {
    const unpriced = buildTemplate(id, {withPrices: false});
    assert.ok(unpriced.products.every(p => p.price === null), `${id}: every price must be null`);
    const priced = buildTemplate(id);
    for (const p of priced.products) p.price = null;
    assert.deepEqual(unpriced, priced, `${id}: only product prices may differ (add-on prices and game fees stay)`);
  }
});

test('suggested prices are realistic whole rupees: products ₹10–₹200, add-ons ≤ ₹50', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    for (const p of t.products) {
      assert.ok(Number.isSafeInteger(p.price) && p.price >= 1000 && p.price <= 20000, `${id}/${p.id}: ₹${p.price / 100} out of range`);
      assert.equal(p.price % 100, 0, `${id}/${p.id}: whole rupees only`);
    }
    for (const a of t.addons) {
      assert.ok(Number.isSafeInteger(a.price) && a.price >= 500 && a.price <= 5000 && a.price % 100 === 0, `${id}/${a.id}`);
    }
    for (const g of t.games) assert.ok(Number.isSafeInteger(g.fee) && g.fee >= 0 && g.fee <= 10000 && g.fee % 100 === 0, `${id}/${g.id}`);
  }
});

test('combos: 1–3 per menu, real non-combo components, cheaper than buying the parts separately', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    const byId = new Map(t.products.map(p => [p.id, p]));
    const combos = t.products.filter(p => p.bundle);
    if (id !== 'blank') assert.ok(combos.length >= 1 && combos.length <= 3, `${id}: ${combos.length} combos`);
    for (const combo of combos) {
      const where = `${id}/${combo.id}`;
      for (const part of combo.bundle) {
        assert.deepEqual(Object.keys(part).sort(), ['productId', 'quantity'], where);
        const component = byId.get(part.productId);
        assert.ok(component, `${where}: missing component ${part.productId}`);
        assert.equal(component.bundle, null, `${where}: component ${part.productId} is itself a combo`);
        assert.ok(Number.isInteger(part.quantity) && part.quantity >= 1 && part.quantity <= 99, `${where}: quantity`);
      }
      const partIds = combo.bundle.map(part => part.productId);
      assert.equal(new Set(partIds).size, partIds.length, `${where}: repeat a component with quantity instead`);
      const separately = separatePrice(t, combo);
      assert.ok(combo.price < separately, `${where}: ₹${combo.price / 100} must be below ₹${separately / 100}`);
      const off = Math.round(100 - (combo.price / separately) * 100);
      assert.ok(combo.price >= separately * 0.75, `${where}: a ${off}% combo discount is too deep`);
      assert.ok(combo.tags.includes('COMBO'), `${where}: COMBO tag`);
      assert.equal(combo.stockKey, '', `${where}: combo stock comes from its components`);
      assert.equal(combo.customizable, false, `${where}: add-ons are not charged on combos`);
      assert.equal(combo.size, '', `${where}: size`);
    }
    for (const p of t.products.filter(x => !x.bundle)) assert.ok(!p.tags.includes('COMBO'), `${id}/${p.id}: COMBO tag on a non-combo`);
  }
});

test('every art id (products, games, cards, heroes) comes from library REQUIRED_ART_IDS and fits the item', () => {
  for (const info of TEMPLATES) {
    assert.ok(ART_IDS.has(info.art), `${info.id}: card art ${info.art}`);
    for (const art of info.theme.heroArt) assert.ok(ART_IDS.has(art), `${info.id}: hero art ${art}`);
  }
  for (const id of IDS) {
    const t = buildTemplate(id);
    for (const g of t.games) assert.ok(ART_IDS.has(g.art), `${id}/${g.id}: game art ${g.art}`);
    for (const p of t.products) {
      assert.ok(ART_IDS.has(p.art), `${id}/${p.id}: art ${p.art} is not in REQUIRED_ART_IDS`);
      if (p.bundle) continue;
      for (const [pattern, arts] of ART_HINTS) {
        if (pattern.test(p.name)) assert.ok(arts.includes(p.art), `${id}/${p.id}: "${p.art}" does not look like ${p.name}`);
      }
    }
  }
  const pizza = buildTemplate('snacks-pizza').products;
  for (const art of ['cola-can', 'lime-can', 'orange-can']) assert.ok(pizza.some(p => p.art === art), `snacks-pizza sells a ${art}`);
});

test('tags, tints and patterns are valid; tags are sparing and the grid stays lively', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    for (const p of t.products) {
      const where = `${id}/${p.id}`;
      assert.ok(TINT_IDS.includes(p.tint), `${where}: tint ${p.tint}`);
      assert.ok(PATTERN_IDS.includes(p.pattern), `${where}: pattern ${p.pattern}`);
      assert.ok(p.tags.every(tag => TAG_IDS.includes(tag)), `${where}: tags ${p.tags}`);
      assert.equal(new Set(p.tags).size, p.tags.length, `${where}: duplicate tags`);
      assert.ok(p.tags.length <= 2, `${where}: too many tags`);
    }
    if (id === 'blank') continue;
    const tagged = t.products.filter(p => p.tags.length).length;
    assert.ok(tagged < t.products.length / 2, `${id}: ${tagged}/${t.products.length} products tagged; use tags sparingly`);
    assert.ok(new Set(t.products.map(p => p.tint)).size >= 6, `${id}: use more tints`);
    assert.ok(new Set(t.products.map(p => p.pattern)).size >= 4, `${id}: use more patterns`);
    t.products.forEach((p, i) => {
      const next = t.products[i + 1];
      if (!next) return;
      assert.ok(p.tint !== next.tint || p.pattern !== next.pattern, `${id}: ${p.id} and ${next.id} look identical side by side`);
      if (p.tint === next.tint) assert.equal(baseName(p), baseName(next), `${id}: neighbours ${p.id}/${next.id} share a tint`);
    });
  }
});

test('sizes are separate "Name · Size" products; bigger portions cost more and use more shared stock', () => {
  for (const id of MENU_IDS) {
    const t = buildTemplate(id);
    /** @type {Map<string, object[]>} */
    const groups = new Map();
    for (const p of t.products) {
      if (!p.size) {
        assert.ok(!p.name.includes(' · '), `${id}/${p.id}: a "Name · Size" product needs its size field`);
        continue;
      }
      assert.ok(p.size in SIZE_RANK, `${id}/${p.id}: unexpected size ${p.size}`);
      assert.equal(p.name, `${baseName(p)} · ${p.size}`, `${id}/${p.id}: sized products are named "Name · Size"`);
      groups.set(baseName(p), [...(groups.get(baseName(p)) || []), p]);
    }
    assert.ok(groups.size >= 1, `${id}: offer at least one item in two sizes`);
    for (const [name, variants] of groups) {
      assert.ok(variants.length >= 2, `${id}: ${name} comes in only one size`);
      assert.equal(new Set(variants.map(v => v.art)).size, 1, `${id}: ${name} sizes should share art`);
      assert.equal(new Set(variants.map(v => v.categoryId)).size, 1, `${id}: ${name} sizes should share a category`);
      const sorted = [...variants].sort((a, b) => SIZE_RANK[a.size] - SIZE_RANK[b.size]);
      for (let i = 1; i < sorted.length; i++) {
        const [small, big] = [sorted[i - 1], sorted[i]];
        assert.ok(SIZE_RANK[big.size] > SIZE_RANK[small.size], `${id}: ${name} has two sizes of the same rank`);
        assert.ok(big.price > small.price, `${id}: ${big.name} should cost more than ${small.name}`);
        if (big.stockKey && big.stockKey === small.stockKey) {
          assert.ok(big.stockUnits > small.stockUnits, `${id}: ${big.name} should use more ${big.stockKey} than ${small.name}`);
        }
      }
    }
  }
});

test('customizable items have flavours or add-ons to pick; add-ons and flavours are valid', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    const customizable = t.products.filter(p => p.customizable);
    if (customizable.length) assert.ok(t.flavours.length + t.addons.length > 0, `${id}: nothing to customize with`);
    if (t.flavours.length || t.addons.length) assert.ok(customizable.length > 0, `${id}: flavours/add-ons but no customizable item`);
    for (const a of t.addons) {
      assert.deepEqual(Object.keys(a).sort(), ['id', 'name', 'price'], `${id}/${a.id}`);
      assert.ok(Number.isSafeInteger(a.price) && a.price >= 0, `${id}/${a.id}: price`);
    }
    assert.ok(t.flavours.length <= 30, `${id}: too many flavours`);
    assert.ok(t.flavours.every(f => typeof f === 'string' && f.trim() === f && f.length > 0), `${id}: flavours`);
    assert.equal(new Set(t.flavours.map(f => f.toLowerCase())).size, t.flavours.length, `${id}: duplicate flavours`);
  }
});

test('stock pools: inventory off by default, every stockKey names a pool and every pool is used', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    assert.equal(t.inventory, false, `${id}: inventory starts off`);
    for (const [key, units] of Object.entries(t.stock)) {
      assert.match(key, ID_RE, `${id}: pool ${key}`);
      assert.ok(Number.isSafeInteger(units) && units >= 0, `${id}: pool ${key} = ${units}`);
      assert.ok(t.products.some(p => p.stockKey === key), `${id}: stock pool ${key} is never used`);
    }
    for (const p of t.products) {
      if (!p.stockKey) {
        assert.equal(p.stockUnits, 1, `${id}/${p.id}: untracked items use stockUnits 1`);
        continue;
      }
      assert.ok(Object.hasOwn(t.stock, p.stockKey), `${id}/${p.id}: unknown stock pool ${p.stockKey}`);
      assert.ok(t.stock[p.stockKey] >= p.stockUnits * 10, `${id}/${p.id}: starting stock should cover at least 10 sales`);
    }
    if (id !== 'blank') assert.ok(Object.keys(t.stock).length >= 3, `${id}: suggest a few stock pools`);
  }
  assert.deepEqual(buildTemplate('blank').stock, {});
});

test('discount rules and milestones follow §5 (the same everywhere; "Game on" only when games exist)', () => {
  const discounts = [
    {id: 'reel-story', label: 'Reel story? ₹10 off', type: 'flat', value: 1000, minimum: 0, active: true},
    {id: 'friends-faculty', label: 'Friends & faculty ₹20 off', type: 'flat', value: 2000, minimum: 10000, active: true},
    {id: 'festive-10', label: 'Festive 10% off', type: 'percent', value: 10, minimum: 20000, active: false},
  ];
  const ladder = [
    {id: 'first-sale', title: 'First sale', type: 'orders', target: 1},
    {id: 'club-1000', title: '₹1,000 Club', type: 'revenue', target: 100000},
    {id: 'crowd-magnet', title: 'Crowd magnet', type: 'orders', target: 25},
    {id: 'halfway-there', title: 'Halfway there', type: 'recovery', target: 50},
    {id: 'break-even-boss', title: 'Break-even boss', type: 'recovery', target: 100},
    {id: 'dhamaka-10000', title: '₹10,000 Dhamaka', type: 'revenue', target: 1000000},
  ];
  const gameOn = {id: 'game-on', title: 'Game on', type: 'games', target: 1};
  for (const id of IDS) {
    const t = buildTemplate(id);
    assert.deepEqual(t.discounts, discounts, id);
    assert.deepEqual(t.milestones, t.games.length ? [...ladder, gameOn] : ladder, id);
    for (const r of t.discounts) {
      if (r.type === 'flat') assert.ok(Number.isSafeInteger(r.value) && r.value >= 1, `${id}/${r.id}`);
      else assert.ok(Number.isInteger(r.value) && r.value >= 1 && r.value <= 100, `${id}/${r.id}`);
      assert.ok(Number.isSafeInteger(r.minimum) && r.minimum >= 0, `${id}/${r.id}: minimum`);
    }
    for (const m of t.milestones) {
      assert.ok(MILESTONE_TYPE_IDS.includes(m.type), `${id}/${m.id}: type ${m.type}`);
      assert.ok(Number.isSafeInteger(m.target) && m.target >= 1, `${id}/${m.id}: target`);
      if (m.type === 'recovery') assert.ok(m.target <= 1000, `${id}/${m.id}: recovery target`);
    }
  }
  for (const id of ['street-chaat', 'snacks-pizza', 'drinks-games']) assert.equal(buildTemplate(id).milestones.length, 7, id);
  for (const id of ['chai-maggi', 'momo-corner', 'sweet-tooth', 'blank']) assert.equal(buildTemplate(id).milestones.length, 6, id);
});

test('missions follow the bills ledger (§16.1): mode ledger, total 0, the five standard lines as suggested bills', () => {
  for (const id of IDS) {
    const t = buildTemplate(id);
    assert.deepEqual(Object.keys(t.mission).sort(), ['items', 'mode', 'total'], id);
    assert.equal(t.mission.mode, 'ledger', id);
    assert.equal(t.mission.total, 0, `${id}: break-even comes from recorded bills, not a planned total`);
    assert.deepEqual(t.mission.items.map(i => i.label), MISSION_LABELS, id);
    for (const item of t.mission.items) {
      assert.deepEqual(Object.keys(item).sort(), ['amount', 'id', 'label'], `${id}/${item.id}`);
      assert.ok(Number.isSafeInteger(item.amount) && item.amount >= 0, `${id}/${item.id}: amount`);
    }
    const typical = t.mission.items.reduce((sum, i) => sum + i.amount, 0);
    if (id === 'blank') {
      assert.equal(typical, 0);
      continue;
    }
    assert.ok(t.mission.items.every(i => i.amount > 0 && i.amount % 100 === 0), `${id}: every suggestion is a whole-rupee cost`);
    // The "₹10,000 Dhamaka" stretch goal is ≈ 2× the stall cost (§13.5), so keep typical costs near ₹5,000.
    assert.ok(Math.abs(2 * typical - 1000000) <= 200000, `${id}: ₹${typical / 100} of suggested bills doesn't fit the stretch goal`);
  }
  const chaat = buildTemplate('street-chaat').mission;
  assert.deepEqual(chaat.items.map(i => i.amount), [150000, 250000, 40000, 30000, 44000]);
  assert.equal(chaat.items.reduce((sum, i) => sum + i.amount, 0), 514000);
});

test('games: a free Spin the Wheel for street-chaat and snacks-pizza, four paid games for drinks-games, none elsewhere', () => {
  for (const id of ['street-chaat', 'snacks-pizza']) {
    assert.deepEqual(buildTemplate(id).games, [{id: 'spin-the-wheel', name: 'Spin the Wheel', fee: 0, art: 'spin-wheel'}], id);
  }
  assert.deepEqual(buildTemplate('drinks-games').games.map(g => [g.name, g.fee, g.art]), [
    ['Ring Toss', 2000, 'ring-toss'],
    ['Spin the Wheel', 3000, 'spin-wheel'],
    ['Dart Game', 2000, 'dart-game'],
    ['Lucky Cup', 1000, 'lucky-cup'],
  ]);
  for (const id of ['chai-maggi', 'momo-corner', 'sweet-tooth', 'blank']) assert.deepEqual(buildTemplate(id).games, [], id);
  for (const id of IDS) {
    for (const g of buildTemplate(id).games) assert.deepEqual(Object.keys(g).sort(), ['art', 'fee', 'id', 'name'], `${id}/${g.id}`);
  }
  assert.deepEqual(buildTemplate('drinks-games', {withPrices: false}).games, buildTemplate('drinks-games').games, 'fees stay');
});

test('blank: Snacks/Drinks/Combos, no products or games, ₹0 bill suggestions, the same discounts and milestones', () => {
  const t = buildTemplate('blank');
  assert.deepEqual(t.categories, [{id: 'snacks', name: 'Snacks'}, {id: 'drinks', name: 'Drinks'}, {id: 'combos', name: 'Combos'}]);
  assert.deepEqual([t.products, t.games, t.addons, t.flavours], [[], [], [], []]);
  assert.deepEqual(t.mission, {mode: 'ledger', total: 0, items: MISSION_LABELS.map(label => ({id: slugOf(label), label, amount: 0}))});
  assert.deepEqual(t.discounts, buildTemplate('chai-maggi').discounts);
  assert.deepEqual(t.milestones, buildTemplate('chai-maggi').milestones);
  assert.deepEqual(buildTemplate('blank', {withPrices: false}), t);
});

test('street-chaat carries the original chips-chaat stall over unchanged (ids, prices, art, flavours, add-ons, pools)', () => {
  const t = buildTemplate('street-chaat');
  const byId = new Map(t.products.map(p => [p.id, p]));
  for (const [id, name, rupees, art, customizable, stockKey, stockUnits] of CARRIED_OVER) {
    const p = byId.get(id);
    assert.ok(p, `street-chaat is missing ${id}`);
    assert.deepEqual([p.name, p.price, p.art, p.customizable, p.stockKey, p.stockUnits],
      [name, rupees * 100, art, customizable, stockKey, stockUnits], id);
  }
  assert.deepEqual(t.flavours, ['Classic Salted', 'Magic Masala', 'Cream & Onion', 'Tomato Tango', 'Chilli Chatka']);
  assert.deepEqual(t.addons,
    [{id: 'extra-cheese', name: 'Extra Cheese', price: 1000}, {id: 'sweet-corn', name: 'Sweet Corn', price: 1000}]);
  for (const p of t.products) {
    assert.equal(p.customizable, p.name.includes('Chips Chaat'), `${p.id}: only chips chaat takes chip flavours and add-ons`);
  }
  const pools = {'chips-small': 50, 'chips-large': 50, fries: 40, cola: 24, 'lemon-fizz': 24, 'orange-fizz': 24};
  for (const [pool, units] of Object.entries(pools)) {
    assert.equal(t.stock[pool], units, `stock pool ${pool}`);
  }
  // The original chips-chaat combo, unchanged, plus the Triple Dhamaka id at its old ₹130 price.
  assert.deepEqual(byId.get('combo-snack-fizz').bundle,
    [{productId: 'veggie-chips-chaat-small', quantity: 1}, {productId: 'cola', quantity: 1}]);
  assert.equal(byId.get('combo-snack-fizz').price, 6000);
  assert.equal(byId.get('combo-triple-dhamaka').price, 13000);
  assert.ok(t.products.filter(p => p.bundle).some(c => c.bundle.some(part => part.productId.includes('chips-chaat'))),
    'at least one chips-chaat combo');
  assert.equal(t.accent, '#FFDD35');
  assert.equal(t.tagline, 'Little packets. Big fest energy.');
});

test('themed templates carry their signature items, 12–20 products each', () => {
  const signature = {
    'street-chaat': {
      categories: ['Chips Chaat', 'Street Chaat', 'Hot & Crispy', 'Fizz', 'Combos'],
      items: ['Pani Puri', 'Bhel Puri', 'Samosa', 'Kachori', 'Aloo Tikki', 'Peri Peri Fries', 'Cola', 'Lemon Fizz', 'Orange Fizz',
        'Snack + Fizz', 'Chaat Party', 'Triple Dhamaka'],
    },
    'snacks-pizza': {
      categories: ['Pizza', 'Sides', 'Fizz', 'Combos'],
      items: ['Veg Pizza', 'Cheese Pizza', 'Corn Cheese Pizza', 'French Fries', 'Loaded Nachos', 'Veg Burger', 'Cola', 'Lime Soda',
        'Orange Soda', 'Pizza + Fizz', 'Burger Meal'],
    },
    'chai-maggi': {
      categories: ['Chai', 'Coffee', 'Maggi', 'Snacks', 'Combos'],
      items: ['Masala Chai', 'Kulhad Chai', 'Adrak Elaichi Chai', 'Hot Coffee', 'Cold Coffee', 'Classic Maggi · Half',
        'Classic Maggi · Full', 'Masala Maggi · Half', 'Masala Maggi · Full', 'Cheese Maggi', 'Samosa', 'Grilled Sandwich',
        'Aloo Tikki', 'Chai + Samosa', 'Maggi + Cold Coffee'],
    },
    'momo-corner': {
      categories: ['Momos', 'Fast Food', 'Desi Mains', 'Drinks', 'Combos'],
      items: ['Steamed Veg Momos · Half', 'Steamed Veg Momos · Full', 'Fried Momos · Half', 'Fried Momos · Full', 'Veg Burger',
        'Veg Frankie', 'Grilled Sandwich', 'Pav Bhaji', 'Chole Bhature', 'Mint Mojito', 'Cola', 'Momo + Mojito'],
    },
    'sweet-tooth': {
      categories: ['Desserts', 'Shakes', 'Lassi & Cold Coffee', 'Combos'],
      items: ['Brownie Sundae', 'Gulab Jamun', 'Malai Kulfi', 'Chocolate Milkshake · Regular', 'Mango Lassi',
        'Cold Coffee · Regular', 'Shake + Brownie'],
    },
    'drinks-games': {
      categories: ['Fizz & Coolers', 'Shakes', 'Desserts', 'Combos'],
      items: ['Cola', 'Lemon Fizz', 'Orange Fizz', 'Mint Mojito', 'Chocolate Milkshake · Regular', 'Mango Lassi',
        'Cold Coffee · Regular', 'Brownie Sundae', 'Kulfi', 'Shake + Brownie'],
    },
  };
  assert.deepEqual(Object.keys(signature), MENU_IDS, 'every themed template has a signature');
  for (const [id, expected] of Object.entries(signature)) {
    const t = buildTemplate(id);
    assert.deepEqual(t.categories.map(c => c.name), expected.categories, id);
    const names = t.products.map(p => p.name);
    for (const item of expected.items) assert.ok(names.includes(item), `${id} is missing ${item}`);
  }
  for (const id of MENU_IDS) {
    const count = buildTemplate(id).products.length;
    assert.ok(count >= 12 && count <= 20, `${id}: ${count} products`);
  }
});

test('copy fits LIMITS, is trimmed, uses generic names and no legacy branding', () => {
  const texts = TEMPLATES.flatMap(t => [t.name, t.tagline, t.description]);
  /** @param {unknown} text @param {number} max @param {string} what */
  const check = (text, max, what) => {
    assert.equal(typeof text, 'string', what);
    assert.ok(text.length > 0 && text.length <= max, `${what}: "${text}" must be 1–${max} characters`);
    assert.equal(text, text.trim(), `${what}: "${text}" is not trimmed`);
    texts.push(text);
  };
  for (const id of IDS) {
    const t = buildTemplate(id);
    check(t.tagline, LIMITS.tagline, `${id} tagline`);
    check(t.subTagline, LIMITS.subTagline, `${id} subTagline`);
    for (const c of t.categories) check(c.name, LIMITS.categoryName, `${id} category ${c.id}`);
    for (const p of t.products) {
      check(p.name, LIMITS.productName, `${id}/${p.id} name`);
      check(p.subtitle, LIMITS.subtitle, `${id}/${p.id} subtitle`);
      if (p.size) check(p.size, LIMITS.size, `${id}/${p.id} size`);
    }
    for (const a of t.addons) check(a.name, LIMITS.addonName, `${id}/${a.id} add-on`);
    for (const f of t.flavours) check(f, LIMITS.flavour, `${id} flavour`);
    for (const g of t.games) check(g.name, LIMITS.gameName, `${id}/${g.id} game`);
    for (const r of t.discounts) check(r.label, LIMITS.discountLabel, `${id}/${r.id} discount`);
    for (const i of t.mission.items) check(i.label, LIMITS.missionLabel, `${id}/${i.id} mission line`);
    for (const m of t.milestones) check(m.title, LIMITS.milestoneTitle, `${id}/${m.id} milestone`);
  }
  for (const text of texts) {
    assert.doesNotMatch(text, BRANDS, `brand name in "${text}"`);
    assert.doesNotMatch(text, /packet\s*pataka/i, `legacy branding in "${text}"`);
  }
});

test('builds are deterministic and deep-fresh: no shared objects, and mutations never leak into later builds', () => {
  for (const id of [...IDS, 'chaat-momo']) {
    for (const withPrices of [true, false]) {
      const first = buildTemplate(id, {withPrices});
      const second = buildTemplate(id, {withPrices});
      assert.deepEqual(second, first, `${id}: builds differ`);
      const seen = new Set(containers(first));
      assert.ok(containers(second).every(node => !seen.has(node)), `${id}: two builds share an object or array`);
      const catalogue = new Set(TEMPLATES.flatMap(t => [t, t.theme, t.theme.heroArt]));
      assert.ok(containers(first).every(node => !catalogue.has(node)), `${id}: a build shares an object with TEMPLATES`);
      // Vandalize the first build all the way down, then build again.
      for (const node of containers(first)) {
        if (Array.isArray(node)) node.push('junk');
        else for (const key of Object.keys(node)) if (node[key] === null || typeof node[key] !== 'object') node[key] = 'junk';
      }
      first.products.length = 0;
      first.stock.extra = 99;
      assert.deepEqual(buildTemplate(id, {withPrices}), second, `${id}: mutating a build leaked into the next one`);
    }
  }
});

test('unknown template ids throw', () => {
  for (const id of ['', 'nope', 'legacy', 'Snacks-Pizza', ' blank', 'Chaat-Momo', 'constructor', '__proto__', 'toString',
    'hasOwnProperty', undefined, null, 42]) {
    assert.throws(() => buildTemplate(/** @type {any} */ (id)), /Unknown stall template/, `id ${String(id)}`);
  }
});

test('templates.mjs stays a pure data module: @ts-check, no imports, no DOM or storage', () => {
  const source = readFileSync(new URL('../dist/templates.mjs', import.meta.url), 'utf8');
  assert.match(source, /^\/\/ @ts-check/);
  assert.doesNotMatch(source, /^\s*import[\s{*]|\bimport\s*\(|\brequire\s*\(/m, 'no imports');
  assert.doesNotMatch(source, /\b(document|window|localStorage|sessionStorage|indexedDB|fetch)\b/, 'no DOM, storage or network');
});

for (const id of IDS) {
  test(`${id}: merged into a minimal config, passes catalog.validateConfig`, () => {
    for (const withPrices of [true, false]) {
      for (const inventory of [false, true]) {
        const config = configFor(buildTemplate(id, {withPrices}));
        config.inventory = inventory;
        assert.doesNotThrow(() => validateConfig(config), `${id} withPrices=${withPrices} inventory=${inventory}`);
      }
    }
  });
}
