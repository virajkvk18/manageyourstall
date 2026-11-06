// Unit tests for dist/catalog.mjs (config helpers + validateConfig). Run: node --test tests/catalog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cat from '../dist/catalog.mjs';
import { TEMPLATES, buildTemplate } from '../dist/templates.mjs';

const {
  validateConfig, normalizeProduct, missionTarget, autoMilestones, newId, niceAmount, CATALOG_LIMITS,
  addCategory, renameCategory, moveCategory, deleteCategory,
  saveProduct, duplicateProduct, deleteProduct, moveProduct, setSoldOut, setActive, setPrices, setPriceLock,
  saveAddons, saveFlavours, addStockPool, deleteStockPool, saveStock,
  saveDiscount, deleteDiscount, moveDiscount, setAllowCustomDiscount,
  saveMission, saveMilestone, deleteMilestone, moveMilestone, replaceMilestones,
  saveGame, deleteGame, saveProfile, saveTheme, saveUpi, saveOperators, setKitchenQueue,
  saveTeam, addMember, renameMember, setMemberColor, removeMember, setSplitMode, setShares, equalShares,
} = cat;

// ---------------------------------------------------------------------------------------------------------------------------
// fixtures

/** A fully populated product (§2) with overrides. */
const product = (id, name, categoryId, extra = {}) => ({
  id, name, subtitle: '', categoryId, size: '', price: 5000, priceLocked: false, art: 'samosa', image: null, tint: 'yellow',
  pattern: 'none', tags: [], active: true, soldOut: false, customizable: false, stockKey: '', stockUnits: 1, bundle: null, ...extra,
});

/** Hand-built valid config. */
function makeConfig() {
  return {
    schema: 2,
    templateId: 'snacks-pizza',
    profile: {
      stallName: 'My Awesome Stall', booth: 'Stall No. 1', tagline: 'Little packets. Big energy.', subTagline: 'Tap to sell.',
      eventName: 'College Fest', venue: 'Main Ground', city: 'Jabalpur', eventDate: '2026-11-04', ownerName: 'Team Stall', initials: '',
    },
    theme: {
      accent: '#FFDD35', themeId: 'snacks-pizza', secondary: '#FF4D87', heroArt: ['packet', 'veg-pizza', 'cola-can'], heroTint: 'yellow',
      heroPattern: 'sunburst', heroImage: null,
    },
    team: {
      members: [
        { id: 'asha', name: 'Asha', color: 'pink', share: null },
        { id: 'ravi', name: 'Ravi', color: 'mint', share: null },
      ],
      splitMode: 'equal',
    },
    upi: { id: '', payeeName: '' },
    operator: 'Team Stall',
    operators: ['Team Stall', 'Cashier 1', 'Cashier 2'],
    kitchenQueue: true,
    allowCustomDiscount: true,
    inventory: false,
    stock: { samosa: 40, chai: 100, cola: 0 },
    categories: [{ id: 'snacks', name: 'Snacks' }, { id: 'drinks', name: 'Drinks' }, { id: 'combos', name: 'Combos' }],
    products: [
      product('samosa', 'Samosa', 'snacks', { price: 2000, stockKey: 'samosa', tags: ['BESTSELLER'] }),
      product('chai', 'Masala Chai', 'drinks', { price: 1500, art: 'masala-chai', stockKey: 'chai', priceLocked: true }),
      product('fries', 'French Fries', 'snacks', { price: 6000, art: 'french-fries', customizable: true }),
      product('cola', 'Cola', 'drinks', { price: 4000, art: 'cola-can', stockKey: 'cola', tags: ['CHILLED'] }),
      product('nachos', 'Nachos', 'snacks', { price: null, art: 'nachos' }),
      product('combo-samosa-chai', 'Samosa + Chai', 'combos', {
        price: 3000, art: 'combo-snack-drink', tags: ['COMBO'],
        bundle: [{ productId: 'samosa', quantity: 1 }, { productId: 'chai', quantity: 1 }],
      }),
      product('combo-party', 'Party Pack', 'combos', {
        price: 15000, art: 'combo-triple', bundle: [{ productId: 'samosa', quantity: 4 }, { productId: 'cola', quantity: 2 }],
      }),
    ],
    addons: [{ id: 'cheese', name: 'Cheese', price: 1000 }, { id: 'peri', name: 'Peri peri', price: 0 }],
    flavours: ['Classic', 'Masala'],
    games: [{ id: 'spin', name: 'Spin the Wheel', fee: 0, art: 'spin-wheel' }],
    discounts: [
      { id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1000, minimum: 0, active: true },
      { id: 'friends', label: 'Friends & faculty ₹20 off', type: 'flat', value: 2000, minimum: 10000, active: true },
      { id: 'festive', label: 'Festive 10% off', type: 'percent', value: 10, minimum: 20000, active: false },
    ],
    mission: {
      mode: 'itemized', total: 0,
      items: [{ id: 'rent', label: 'Stall rent', amount: 200000 }, { id: 'raw', label: 'Raw materials', amount: 314000 }],
    },
    milestones: [
      { id: 'first', title: 'First sale', type: 'orders', target: 1 },
      { id: 'club', title: '₹1,000 Club', type: 'revenue', target: 100000 },
      { id: 'half', title: 'Halfway there', type: 'recovery', target: 50 },
    ],
  };
}

const line = (productId, id = newId()) => ({ id, productId, name: productId, quantity: 1 });
const makeState = () => ({
  config: makeConfig(),
  live: { draft: [line('nachos'), line('fries'), line('nachos')] },
  demo: { draft: [line('nachos'), line('cola')] },
});
const ids = list => list.map(x => x.id);
const throwsMsg = (fn, re) => assert.throws(fn, err => err instanceof Error && re.test(err.message), `expected ${re}`);

/** Map the v1 fixture config to a v2 config the way §14 describes (stand-in for domain.migrate). */
function migratedFixtureConfig() {
  const v1 = JSON.parse(readFileSync(new URL('./fixtures/v1-state.json', import.meta.url), 'utf8')).config;
  const slugOf = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const categories = [];
  for (const p of v1.products) if (!categories.some(c => c.name === p.category)) categories.push({ id: slugOf(p.category), name: p.category });
  return {
    schema: 2, templateId: 'legacy',
    profile: {
      stallName: v1.stallName, booth: `Stall No. ${v1.stallNumber}`, tagline: 'Little packets. Big pataka energy.',
      subTagline: 'Good food. Fast orders. A fest to remember.', eventName: 'Diwali Celebration', venue: 'Baderia Global Institute',
      city: 'Jabalpur', eventDate: v1.eventDate, ownerName: v1.operator, initials: '',
    },
    theme: { accent: v1.accent }, upi: { id: '', payeeName: '' },
    operator: v1.operator, operators: v1.operators, kitchenQueue: true, allowCustomDiscount: false,
    inventory: v1.inventory, stock: v1.stock, categories,
    products: v1.products.map(p => ({
      id: p.id, name: p.name, subtitle: '', categoryId: categories.find(c => c.name === p.category).id, size: p.size || '',
      price: p.price, priceLocked: false, art: p.art, image: null, tint: p.tint === 'blue' ? 'sky' : p.tint, pattern: 'none',
      tags: p.bundle ? ['COMBO'] : [], active: p.active, soldOut: p.soldOut, customizable: false, stockKey: p.stockKey || '',
      stockUnits: p.stockUnits || 1, bundle: p.bundle || null,
    })),
    addons: v1.addons, flavours: v1.flavours,
    games: v1.games.map(g => ({ ...g, art: g.id === 'wheel' ? 'spin-wheel' : 'lucky-cup' })),
    discounts: v1.promo > 0
      ? [{ id: 'promo', label: `Reel / banner ₹${v1.promo / 100} off`, type: 'flat', value: v1.promo, minimum: v1.promoMinimum, active: true }]
      : [],
    mission: { mode: 'total', total: v1.target, items: [] },
    milestones: [
      { id: 'spark', title: 'First Spark', type: 'orders', target: 1 },
      { id: 'game', title: 'Game On', type: 'games', target: 1 },
      { id: 'crowd', title: 'Crowd Magnet', type: 'orders', target: 50 },
      { id: 'big', title: 'The Big Pataka', type: 'recovery', target: 100 },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// validateConfig — acceptance

test('validateConfig accepts the hand-built config and returns it', () => {
  const c = makeConfig();
  assert.equal(validateConfig(c), c);
});

test('validateConfig accepts a v1-migrated config (legacy template, classic art, null prices, games with art)', () => {
  const c = migratedFixtureConfig();
  validateConfig(c);
  const unpriced = structuredClone(c);
  for (const p of unpriced.products) p.price = null;
  validateConfig(unpriced);
  const legacyTints = structuredClone(c);
  ['yellow', 'pink', 'cream', 'lime', 'sky'].forEach((t, i) => { legacyTints.products[i].tint = t; });
  validateConfig(legacyTints);
});

test('validateConfig accepts every template merged into a config (with and without prices)', () => {
  for (const t of TEMPLATES) {
    for (const withPrices of [true, false]) {
      const built = buildTemplate(t.id, { withPrices });
      const c = makeConfig();
      const { accent, tagline, subTagline, ...menu } = built;
      Object.assign(c, menu);
      c.theme.accent = accent;
      if (tagline) c.profile.tagline = tagline;
      if (subTagline) c.profile.subTagline = subTagline;
      assert.doesNotThrow(() => validateConfig(c), `${t.id} withPrices=${withPrices}`);
    }
  }
});

test('validateConfig accepts unknown art ids, uploads and https images, and edge values', () => {
  const c = makeConfig();
  c.products[0].art = 'some-future-art-99';
  c.products[1].image = 'media:abc_123-x';
  c.products[2].image = 'https://example.com/fries.webp';
  c.products[3].price = 0;
  c.products[4].price = CATALOG_LIMITS.price;
  c.upi.id = 'shop.name-1@ybl';
  c.profile.eventDate = '';
  c.profile.initials = 'AB';
  c.theme.accent = '#ff4d87';
  c.discounts[2].value = 100;
  c.mission.mode = 'total';
  c.mission.total = 0;
  c.milestones.push({ id: 'r', title: 'Recovery max', type: 'recovery', target: 1000 });
  c.flavours = [];
  c.addons = [];
  c.games = [];
  c.discounts = [];
  c.milestones = [];
  c.operator = 'Somebody not on the list'; // v1 allowed a free-typed operator
  validateConfig(c);
});

// ---------------------------------------------------------------------------------------------------------------------------
// validateConfig — table-driven rejections: every single mutation of a valid config must throw

const P = (i, fn) => c => fn(c.products[i], c);
const REJECTIONS = {
  'not an object': c => 'nope',
  'null config': c => null,
  'schema 1': c => { c.schema = 1; },
  'missing schema': c => { delete c.schema; },
  'templateId empty': c => { c.templateId = ''; },
  'templateId with space': c => { c.templateId = 'snacks pizza'; },
  'templateId number': c => { c.templateId = 5; },
  'profile missing': c => { delete c.profile; },
  'stallName blank': c => { c.profile.stallName = '   '; },
  'stallName too long': c => { c.profile.stallName = 'x'.repeat(51); },
  'booth too long': c => { c.profile.booth = 'x'.repeat(25); },
  'tagline too long': c => { c.profile.tagline = 'x'.repeat(71); },
  'subTagline too long': c => { c.profile.subTagline = 'x'.repeat(91); },
  'eventName too long': c => { c.profile.eventName = 'x'.repeat(61); },
  'venue too long': c => { c.profile.venue = 'x'.repeat(81); },
  'city too long': c => { c.profile.city = 'x'.repeat(41); },
  'ownerName too long': c => { c.profile.ownerName = 'x'.repeat(41); },
  'initials too long': c => { c.profile.initials = 'ABCD'; },
  'profile field not a string': c => { c.profile.venue = null; },
  'profile field missing': c => { delete c.profile.city; },
  'eventDate bad format': c => { c.profile.eventDate = '04-11-2026'; },
  'eventDate impossible': c => { c.profile.eventDate = '2026-02-30'; },
  'theme missing': c => { delete c.theme; },
  'accent short hex': c => { c.theme.accent = '#FD3'; },
  'accent name': c => { c.theme.accent = 'yellow'; },
  'upi missing': c => { delete c.upi; },
  'upi id invalid': c => { c.upi.id = 'abc'; },
  'upi id with space': c => { c.upi.id = 'with space@ok'; },
  'upi id too long': c => { c.upi.id = `${'a'.repeat(98)}@ok`; },
  'payeeName too long': c => { c.upi.payeeName = 'x'.repeat(51); },
  'operators empty': c => { c.operators = []; },
  'operators not array': c => { c.operators = 'Team'; },
  'operators duplicate': c => { c.operators.push('Cashier 1'); },
  'operators blank name': c => { c.operators.push(' '); },
  'operators too many': c => { c.operators = Array.from({ length: 21 }, (_, i) => `Cashier ${i}`); },
  'operator blank': c => { c.operator = ''; },
  'operator too long': c => { c.operator = 'x'.repeat(41); },
  'kitchenQueue not boolean': c => { c.kitchenQueue = 'yes'; },
  'allowCustomDiscount missing': c => { delete c.allowCustomDiscount; },
  'inventory not boolean': c => { c.inventory = 1; },
  'stock not object': c => { c.stock = []; },
  'stock negative': c => { c.stock.samosa = -1; },
  'stock fraction': c => { c.stock.samosa = 1.5; },
  'stock key invalid': c => { c.stock['bad key'] = 1; },
  'stock too big': c => { c.stock.samosa = CATALOG_LIMITS.stock + 1; },
  'categories empty': c => { c.categories = []; c.products = []; },
  'categories not array': c => { c.categories = {}; },
  'category duplicate id': c => { c.categories.push({ id: 'snacks', name: 'More snacks' }); },
  'category bad id': c => { c.categories[0].id = 'bad id!'; },
  'category name duplicate (case-insensitive)': c => { c.categories.push({ id: 'x', name: 'SNACKS' }); },
  'category name blank': c => { c.categories[0].name = ''; },
  'category name too long': c => { c.categories[0].name = 'x'.repeat(31); },
  'too many categories': c => { for (let i = 0; i < 38; i++) c.categories.push({ id: `c${i}`, name: `Cat ${i}` }); },
  'products not array': c => { c.products = null; },
  'too many products': c => { for (let i = 0; i < 294; i++) c.products.push(product(`p${i}`, `P ${i}`, 'snacks')); },
  'product duplicate id': c => { c.products.push(product('samosa', 'Another', 'snacks')); },
  'product bad id': P(0, p => { p.id = 'has space'; }),
  'product name blank': P(0, p => { p.name = ' '; }),
  'product name too long': P(0, p => { p.name = 'x'.repeat(51); }),
  'product subtitle too long': P(0, p => { p.subtitle = 'x'.repeat(81); }),
  'product subtitle missing': P(0, p => { delete p.subtitle; }),
  'product size too long': P(0, p => { p.size = 'x'.repeat(21); }),
  'product unknown category': P(0, p => { p.categoryId = 'ghost'; }),
  'product negative price': P(0, p => { p.price = -1; }),
  'product fractional price': P(0, p => { p.price = 10.5; }),
  'product price too big': P(0, p => { p.price = CATALOG_LIMITS.price + 1; }),
  'product price string': P(0, p => { p.price = '20'; }),
  'product price undefined': P(0, p => { delete p.price; }),
  'product priceLocked not boolean': P(0, p => { p.priceLocked = 'no'; }),
  'product art empty': P(0, p => { p.art = ''; }),
  'product art uppercase': P(0, p => { p.art = 'Samosa'; }),
  'product art too long': P(0, p => { p.art = 'a'.repeat(41); }),
  'product art not string': P(0, p => { p.art = 7; }),
  'product image http': P(0, p => { p.image = 'http://example.com/a.png'; }),
  'product image data url': P(0, p => { p.image = 'data:image/png;base64,AAAA'; }),
  'product image bad media ref': P(0, p => { p.image = 'media:bad id'; }),
  'product image empty string': P(0, p => { p.image = ''; }),
  'product image too long': P(0, p => { p.image = `https://e.com/${'a'.repeat(2000)}`; }),
  'product unknown tint': P(0, p => { p.tint = 'blue'; }),
  'product unknown pattern': P(0, p => { p.pattern = 'plaid'; }),
  'product unknown tag': P(0, p => { p.tags = ['HOT']; }),
  'product duplicate tag': P(0, p => { p.tags = ['NEW', 'NEW']; }),
  'product tags not array': P(0, p => { p.tags = 'NEW'; }),
  'product active not boolean': P(0, p => { p.active = 1; }),
  'product soldOut missing': P(0, p => { delete p.soldOut; }),
  'product customizable not boolean': P(0, p => { p.customizable = null; }),
  'product unknown stockKey': P(0, p => { p.stockKey = 'ghost'; }),
  'product stockKey not string': P(0, p => { p.stockKey = null; }),
  'product stockUnits zero': P(0, p => { p.stockUnits = 0; }),
  'product stockUnits missing': P(0, p => { delete p.stockUnits; }),
  'product bundle undefined': P(0, p => { delete p.bundle; }),
  'bundle empty': P(5, p => { p.bundle = []; }),
  'bundle not array': P(5, p => { p.bundle = {}; }),
  'bundle missing component': P(5, p => { p.bundle[0].productId = 'ghost'; }),
  'bundle includes a combo': P(5, p => { p.bundle[0].productId = 'combo-party'; }),
  'bundle includes itself': P(5, p => { p.bundle[0].productId = p.id; }),
  'bundle quantity zero': P(5, p => { p.bundle[0].quantity = 0; }),
  'bundle quantity 100': P(5, p => { p.bundle[0].quantity = 100; }),
  'bundle duplicate component': P(5, p => { p.bundle[1].productId = 'samosa'; }),
  'bundle part not object': P(5, p => { p.bundle[0] = 'samosa'; }),
  'addons not array': c => { c.addons = null; },
  'addon duplicate id': c => { c.addons[1].id = 'cheese'; },
  'addon name blank': c => { c.addons[0].name = ''; },
  'addon name too long': c => { c.addons[0].name = 'x'.repeat(41); },
  'addon negative price': c => { c.addons[0].price = -100; },
  'addon price null': c => { c.addons[0].price = null; },
  'flavours not array': c => { c.flavours = 'Classic'; },
  'flavour blank': c => { c.flavours.push(''); },
  'flavour too long': c => { c.flavours.push('x'.repeat(41)); },
  'flavour duplicate': c => { c.flavours.push('Classic'); },
  'too many flavours': c => { c.flavours = Array.from({ length: 31 }, (_, i) => `F${i}`); },
  'flavour not string': c => { c.flavours.push(3); },
  'games not array': c => { c.games = {}; },
  'game duplicate id': c => { c.games.push({ id: 'spin', name: 'Spin 2', fee: 0, art: 'spin-wheel' }); },
  'game name blank': c => { c.games[0].name = ' '; },
  'game negative fee': c => { c.games[0].fee = -1; },
  'game missing art': c => { delete c.games[0].art; },
  'game bad art': c => { c.games[0].art = 'Spin Wheel'; },
  'discounts not array': c => { c.discounts = null; },
  'discount duplicate id': c => { c.discounts[1].id = 'reel'; },
  'discount label blank': c => { c.discounts[0].label = ''; },
  'discount label too long': c => { c.discounts[0].label = 'x'.repeat(41); },
  'discount unknown type': c => { c.discounts[0].type = 'bogo'; },
  'discount flat zero': c => { c.discounts[0].value = 0; },
  'discount percent 101': c => { c.discounts[2].value = 101; },
  'discount percent fraction': c => { c.discounts[2].value = 12.5; },
  'discount negative minimum': c => { c.discounts[0].minimum = -1; },
  'discount active missing': c => { delete c.discounts[0].active; },
  'mission missing': c => { delete c.mission; },
  'mission unknown mode': c => { c.mission.mode = 'both'; },
  'mission negative total': c => { c.mission.total = -1; },
  'mission total fraction': c => { c.mission.total = 0.5; },
  'mission items not array': c => { c.mission.items = null; },
  'mission item label blank': c => { c.mission.items[0].label = ''; },
  'mission item negative amount': c => { c.mission.items[0].amount = -5; },
  'mission item duplicate id': c => { c.mission.items[1].id = 'rent'; },
  'milestones not array': c => { c.milestones = undefined; },
  'milestone duplicate id': c => { c.milestones[1].id = 'first'; },
  'milestone title blank': c => { c.milestones[0].title = ''; },
  'milestone title too long': c => { c.milestones[0].title = 'x'.repeat(41); },
  'milestone unknown type': c => { c.milestones[0].type = 'likes'; },
  'milestone target zero': c => { c.milestones[0].target = 0; },
  'milestone recovery 1001': c => { c.milestones[2].target = 1001; },
  'milestone revenue fraction': c => { c.milestones[1].target = 99.5; },
  'milestone bad id': c => { c.milestones[0].id = ''; },
  // Phase 2 (§16.4): theme and team
  'theme id with space': c => { c.theme.themeId = 'street chaat'; },
  'theme secondary name': c => { c.theme.secondary = 'pink'; },
  'theme hero art 4 pictures': c => { c.theme.heroArt = ['packet', 'pizza', 'cold', 'corn']; },
  'theme hero art bad id': c => { c.theme.heroArt = ['Packet!']; },
  'theme hero art not a list': c => { c.theme.heroArt = 'packet'; },
  'theme hero tint': c => { c.theme.heroTint = 'neon'; },
  'theme hero pattern': c => { c.theme.heroPattern = 'plaid'; },
  'theme hero image http': c => { c.theme.heroImage = 'http://example.com/x.png'; },
  'theme hero image junk': c => { c.theme.heroImage = 42; },
  'team not an object': c => { c.team = []; },
  'team split mode': c => { c.team.splitMode = 'half'; },
  'team members missing': c => { delete c.team.members; },
  'team duplicate member id': c => { c.team.members[1].id = 'asha'; },
  'team duplicate name (case)': c => { c.team.members[1].name = 'ASHA'; },
  'team blank name': c => { c.team.members[0].name = ' '; },
  'team long name': c => { c.team.members[0].name = 'x'.repeat(41); },
  'team colour': c => { c.team.members[0].color = '#FF0000'; },
  'team share 101': c => { c.team.members[0].share = 101; },
  'team share fraction': c => { c.team.members[0].share = 33.3; },
  'team 21 members': c => { c.team.members = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, color: 'pink', share: null })); },
  'mission unknown mode (planned)': c => { c.mission.mode = 'bills'; },
};

for (const [name, mutate] of Object.entries(REJECTIONS)) {
  test(`validateConfig rejects: ${name}`, () => {
    const c = makeConfig();
    const replaced = mutate(c);
    const target = replaced === undefined ? c : replaced;
    assert.throws(() => validateConfig(target), Error);
  });
}

test('validateConfig messages are specific and friendly', () => {
  const c = makeConfig();
  c.products[1].price = -5;
  throwsMsg(() => validateConfig(c), /Masala Chai/);
  const d = makeConfig();
  d.products[5].bundle[0].productId = 'combo-party';
  throwsMsg(() => validateConfig(d), /“Samosa \+ Chai”.*another combo/);
});

// ---------------------------------------------------------------------------------------------------------------------------
// mission target & auto milestones

test('missionTarget: total vs itemized', () => {
  const c = makeConfig();
  assert.equal(missionTarget(c), 514000);
  c.mission.mode = 'total';
  c.mission.total = 99900;
  assert.equal(missionTarget(c), 99900);
  assert.equal(missionTarget({}), 0);
  assert.equal(missionTarget({ mission: { mode: 'itemized', items: [] } }), 0);
});

test('niceAmount rounds to friendly figures', () => {
  assert.equal(niceAmount(1_028_000), 1_000_000); // ₹10,280 → ₹10,000
  assert.equal(niceAmount(2_370_000), 2_500_000); // ₹23,700 → ₹25,000
  assert.equal(niceAmount(4_400_000), 4_000_000); // ₹44,000 → ₹40,000
  assert.equal(niceAmount(7_300_000), 7_500_000);
  assert.equal(niceAmount(9_600_000), 10_000_000);
});

test('autoMilestones: unique ids, standard set, stretch goal, game milestone only with games', () => {
  const c = makeConfig(); // investment ₹5,140 → stretch ₹10,280 → ₹10,000
  const list = autoMilestones(c);
  assert.equal(new Set(ids(list)).size, list.length);
  assert.deepEqual(list.map(m => [m.title, m.type, m.target]), [
    ['First sale', 'orders', 1],
    ['₹1,000 Club', 'revenue', 100000],
    ['Crowd magnet', 'orders', 25],
    ['Halfway there', 'recovery', 50],
    ['Break-even boss', 'recovery', 100],
    ['₹10,000 Dhamaka', 'revenue', 1_000_000],
    ['Game on', 'games', 1],
  ]);
  assert.notDeepEqual(ids(autoMilestones(c)), ids(list), 'fresh ids each call');

  c.games = [];
  assert.ok(!autoMilestones(c).some(m => m.type === 'games'));

  c.mission = { mode: 'total', total: 1_185_000, items: [] }; // ₹11,850 → ₹23,700 → ₹25,000
  const stretch = autoMilestones(c).at(-1);
  assert.equal(stretch.target, 2_500_000);
  assert.equal(stretch.title, '₹25,000 Dhamaka');

  c.mission.total = 0; // no investment → minimum ₹10,000
  assert.equal(autoMilestones(c).at(-1).target, 1_000_000);

  c.milestones = autoMilestones(c);
  validateConfig(c);
  replaceMilestones(c, autoMilestones(c));
  validateConfig(c);
});

// ---------------------------------------------------------------------------------------------------------------------------
// categories

test('addCategory / renameCategory with unique names', () => {
  const c = makeConfig();
  const added = addCategory(c, { name: '  Sweets  ' });
  assert.equal(added.name, 'Sweets');
  assert.equal(c.categories.at(-1), added);
  assert.match(added.id, /^[a-zA-Z0-9_-]{1,100}$/);
  throwsMsg(() => addCategory(c, { name: 'snacks' }), /already a category called “Snacks”/);
  throwsMsg(() => addCategory(c, { name: '   ' }), /Give this category a name/);
  throwsMsg(() => addCategory(c, { name: 'x'.repeat(31) }), /at most 30/);
  renameCategory(c, 'snacks', 'Street Snacks');
  assert.equal(c.categories[0].name, 'Street Snacks');
  renameCategory(c, 'snacks', 'street snacks'); // same category, case change is fine
  throwsMsg(() => renameCategory(c, 'snacks', 'Drinks'), /already a category/);
  throwsMsg(() => renameCategory(c, 'ghost', 'X'), /no longer exists/);
  validateConfig(c);
});

test('addCategory respects MAX_CATEGORIES', () => {
  const c = makeConfig();
  for (let i = c.categories.length; i < 40; i++) addCategory(c, { name: `Cat ${i}` });
  throwsMsg(() => addCategory(c, { name: 'One more' }), /at most 40 categories/);
});

test('moveCategory swaps neighbours and is a no-op at the ends', () => {
  const c = makeConfig();
  moveCategory(c, 'drinks', -1);
  assert.deepEqual(ids(c.categories), ['drinks', 'snacks', 'combos']);
  moveCategory(c, 'drinks', -1);
  assert.deepEqual(ids(c.categories), ['drinks', 'snacks', 'combos']);
  moveCategory(c, 'combos', 1);
  assert.deepEqual(ids(c.categories), ['drinks', 'snacks', 'combos']);
  throwsMsg(() => moveCategory(c, 'snacks', 2), /up or down/);
  throwsMsg(() => moveCategory(c, 'ghost', 1), /no longer exists/);
});

test('deleteCategory: empty, non-empty with moveTo, and refusals', () => {
  const c = makeConfig();
  throwsMsg(() => deleteCategory(c, 'snacks'), /^“Snacks” still has 3 items\. Move them to another category first\.$/);
  throwsMsg(() => deleteCategory(c, 'snacks', { moveTo: 'snacks' }), /different category/);
  throwsMsg(() => deleteCategory(c, 'snacks', { moveTo: 'ghost' }), /no longer exists/);
  deleteCategory(c, 'snacks', { moveTo: 'drinks' });
  assert.deepEqual(ids(c.categories), ['drinks', 'combos']);
  assert.deepEqual(c.products.filter(p => p.categoryId === 'drinks').map(p => p.id), ['chai', 'cola', 'samosa', 'fries', 'nachos']);
  // grouped: moved items follow the target's last item
  assert.deepEqual(ids(c.products), ['chai', 'cola', 'samosa', 'fries', 'nachos', 'combo-samosa-chai', 'combo-party']);
  const empty = addCategory(c, { name: 'Empty' });
  deleteCategory(c, empty.id);
  assert.ok(!c.categories.some(x => x.id === empty.id));
  validateConfig(c);

  const one = makeConfig();
  one.products = [];
  one.categories = [{ id: 'only', name: 'Only' }];
  throwsMsg(() => deleteCategory(one, 'only'), /at least one category/);
  const single = makeConfig();
  single.products = [product('x', 'X', 'snacks')];
  throwsMsg(() => deleteCategory(single, 'snacks'), /still has 1 item\. Move it/);
});

// ---------------------------------------------------------------------------------------------------------------------------
// products

test('normalizeProduct fills defaults and trims', () => {
  const c = makeConfig();
  const p = normalizeProduct(c, { name: '  Pav Bhaji ', categoryId: 'snacks' });
  assert.equal(p.name, 'Pav Bhaji');
  assert.deepEqual({ ...p, id: 'x' }, {
    id: 'x', name: 'Pav Bhaji', subtitle: '', categoryId: 'snacks', size: '', price: null, priceLocked: false, art: 'chips-packet',
    image: null, tint: 'yellow', pattern: 'none', tags: [], active: true, soldOut: false, customizable: false, stockKey: '',
    stockUnits: 1, bundle: null,
  });
  assert.equal(c.products.length, 7, 'does not insert');
  assert.equal(normalizeProduct(c, { name: 'X' }).categoryId, 'snacks', 'defaults to the first category');
  assert.deepEqual(normalizeProduct(c, { name: 'X', tags: ['NEW', 'NEW', 'SPICY'] }).tags, ['NEW', 'SPICY']);
  assert.equal(normalizeProduct(c, { name: 'X', image: '  ' }).image, null);
  const combo = normalizeProduct(c, { name: 'C', bundle: [{ productId: 'fries', quantity: 2 }], stockKey: 'samosa', customizable: true });
  assert.equal(combo.stockKey, '');
  assert.equal(combo.customizable, false);
  assert.equal(combo.art, 'combo-snack-drink');
});

test('normalizeProduct failures', () => {
  const c = makeConfig();
  const cases = [
    [{ name: '' }, /Give this item a name\./],
    [{ name: 'x'.repeat(51) }, /at most 50/],
    [{ name: 'X', subtitle: 'x'.repeat(81) }, /at most 80/],
    [{ name: 'X', size: 'x'.repeat(21) }, /at most 20/],
    [{ name: 'X', categoryId: 'ghost' }, /Pick a category/],
    [{ name: 'Vada', price: -1 }, /valid price for “Vada”/],
    [{ name: 'X', price: '20' }, /valid price/],
    [{ name: 'X', price: 12.5 }, /valid price/],
    [{ name: 'X', priceLocked: 'yes' }, /Price lock/],
    [{ name: 'X', art: '' }, /picture/],
    [{ name: 'X', art: 'Bad Art' }, /picture/],
    [{ name: 'X', image: 'http://x.com/a.png' }, /https/],
    [{ name: 'X', image: 'javascript:alert(1)' }, /https/],
    [{ name: 'X', tint: 'blue' }, /card colour/],
    [{ name: 'X', pattern: 'plaid' }, /pattern/],
    [{ name: 'X', tags: ['HOT'] }, /Unknown tag “HOT”/],
    [{ name: 'X', tags: 'NEW' }, /list/],
    [{ name: 'X', active: 'true' }, /Visible/],
    [{ name: 'X', soldOut: 1 }, /Sold out/],
    [{ name: 'X', customizable: null }, /Customizable/],
    [{ name: 'X', stockKey: 'ghost' }, /stock pool/],
    [{ name: 'X', stockUnits: 0 }, /Units per sale/],
    [{ name: 'X', bundle: [] }, /at least one item/],
    [{ name: 'X', bundle: [{ productId: 'ghost', quantity: 1 }] }, /no longer exists/],
    [{ name: 'X', bundle: [{ productId: 'combo-party', quantity: 1 }] }, /can't include another combo/],
    [{ name: 'X', bundle: [{ productId: 'fries', quantity: 1 }, { productId: 'fries', quantity: 1 }] }, /listed twice/],
    [{ name: 'X', bundle: [{ productId: 'fries', quantity: 100 }] }, /1 to 99/],
    ['nope', /missing/],
  ];
  for (const [data, re] of cases) throwsMsg(() => normalizeProduct(c, data), re);
});

test('saveProduct creates after its category\'s last item; unknown id makes a new id', () => {
  const c = makeConfig();
  const a = saveProduct(c, { name: 'Vada Pav', categoryId: 'snacks', price: 3000 });
  assert.deepEqual(ids(c.products).slice(0, 6), ['samosa', 'chai', 'fries', 'cola', 'nachos', a.id]);
  const b = saveProduct(c, { id: 'not-there', name: 'Lassi', categoryId: 'drinks' });
  assert.notEqual(b.id, 'not-there');
  assert.equal(ids(c.products).indexOf(b.id), ids(c.products).indexOf('cola') + 1);
  const cat2 = addCategory(c, { name: 'Sweets' });
  const s = saveProduct(c, { name: 'Kulfi', categoryId: cat2.id, art: 'kulfi' });
  assert.equal(c.products.at(-1), s);
  validateConfig(c);
});

test('saveProduct updates in place; category change moves to the end of the new category', () => {
  const c = makeConfig();
  const updated = saveProduct(c, { id: 'fries', subtitle: 'Crispy & salted', price: 6500 });
  assert.equal(updated.name, 'French Fries', 'keeps unspecified fields');
  assert.equal(c.products[2], updated);
  assert.equal(c.products[2].price, 6500);
  saveProduct(c, { id: 'samosa', categoryId: 'drinks' });
  assert.deepEqual(ids(c.products), ['chai', 'fries', 'cola', 'samosa', 'nachos', 'combo-samosa-chai', 'combo-party']);
  validateConfig(c);
});

test('saveProduct price lock rules', () => {
  const c = makeConfig();
  throwsMsg(() => saveProduct(c, { id: 'chai', price: 2000 }), /^Unlock “Masala Chai” to change its price\.$/);
  saveProduct(c, { id: 'chai', name: 'Chai', price: 1500 }); // same price is fine while locked
  saveProduct(c, { id: 'chai', price: 2000, priceLocked: false }); // unlock + change in one save
  assert.equal(c.products[1].price, 2000);
  assert.equal(c.products[1].priceLocked, false);
});

test('saveProduct refuses to turn a combo component into a combo, and caps item count', () => {
  const c = makeConfig();
  throwsMsg(() => saveProduct(c, { id: 'samosa', bundle: [{ productId: 'fries', quantity: 1 }] }), /part of “Samosa \+ Chai” and “Party Pack”/);
  throwsMsg(() => saveProduct(c, { id: 'combo-party', bundle: [{ productId: 'combo-party', quantity: 1 }] }), /no longer exists/);
  while (c.products.length < 300) c.products.push(product(`p${c.products.length}`, 'P', 'snacks'));
  throwsMsg(() => saveProduct(c, { name: 'One more' }), /at most 300 items/);
  saveProduct(c, { id: 'fries', price: 1 }); // updates still work at the cap
});

test('duplicateProduct: "(copy)" naming, placement after original, new id, unlocked price', () => {
  const c = makeConfig();
  const copy = duplicateProduct(c, 'chai');
  assert.equal(copy.name, 'Masala Chai (copy)');
  assert.notEqual(copy.id, 'chai');
  assert.equal(copy.priceLocked, false);
  assert.equal(copy.price, 1500);
  assert.equal(c.products[2], copy);
  const again = duplicateProduct(c, 'chai');
  assert.equal(again.name, 'Masala Chai (copy 2)');
  assert.equal(c.products[2], again);
  const combo = duplicateProduct(c, 'combo-party');
  combo.bundle[0].quantity = 9;
  assert.equal(c.products.find(p => p.id === 'combo-party').bundle[0].quantity, 4, 'deep copy');
  c.products[0].name = 'x'.repeat(50);
  assert.equal([...duplicateProduct(c, 'samosa').name].length, 50);
  throwsMsg(() => duplicateProduct(c, 'ghost'), /no longer exists/);
  validateConfig(c);
});

test('deleteProduct is blocked by combos (naming them) and strips both drafts', () => {
  const st = makeState();
  throwsMsg(() => deleteProduct(st, 'samosa'), /^“Samosa \+ Chai” and “Party Pack” use “Samosa”\. Remove it from those combos first\.$/);
  throwsMsg(() => deleteProduct(st, 'chai'), /^“Samosa \+ Chai” uses “Masala Chai”\. Remove it from that combo first\.$/);
  deleteProduct(st, 'nachos');
  assert.ok(!st.config.products.some(p => p.id === 'nachos'));
  assert.deepEqual(st.live.draft.map(l => l.productId), ['fries']);
  assert.deepEqual(st.demo.draft.map(l => l.productId), ['cola']);
  deleteProduct(st, 'combo-samosa-chai');
  deleteProduct(st, 'chai');
  throwsMsg(() => deleteProduct(st, 'ghost'), /no longer exists/);
  validateConfig(st.config);
  deleteProduct({ config: makeConfig() }, 'fries'); // sessions are optional
});

test('moveProduct moves within the same category only; no-op at boundaries', () => {
  const c = makeConfig();
  moveProduct(c, 'fries', -1); // previous snack is samosa (index 0), skipping drinks
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'chai', 'samosa', 'cola', 'nachos']);
  moveProduct(c, 'fries', -1);
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'chai', 'samosa', 'cola', 'nachos']);
  moveProduct(c, 'samosa', 1); // next snack is nachos
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'chai', 'nachos', 'cola', 'samosa']);
  moveProduct(c, 'samosa', 1);
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'chai', 'nachos', 'cola', 'samosa']);
  moveProduct(c, 'cola', 1); // last drink
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'chai', 'nachos', 'cola', 'samosa']);
  moveProduct(c, 'cola', -1);
  assert.deepEqual(ids(c.products).slice(0, 5), ['fries', 'cola', 'nachos', 'chai', 'samosa']);
  throwsMsg(() => moveProduct(c, 'cola', 0), /up or down/);
  throwsMsg(() => moveProduct(c, 'ghost', 1), /no longer exists/);
});

test('setSoldOut / setActive', () => {
  const c = makeConfig();
  setSoldOut(c, 'fries', true);
  setActive(c, 'cola', false);
  assert.equal(c.products[2].soldOut, true);
  assert.equal(c.products[3].active, false);
  throwsMsg(() => setSoldOut(c, 'fries', 'false'), /on or off/);
  throwsMsg(() => setActive(c, 'cola', 0), /on or off/);
  throwsMsg(() => setSoldOut(c, 'ghost', true), /no longer exists/);
});

test('setPrices: batch, locked items refuse changes, atomic on failure', () => {
  const c = makeConfig();
  setPrices(c, { fries: 7000, nachos: 5500, samosa: null, chai: 1500 /* locked but unchanged */ });
  assert.deepEqual([c.products[2].price, c.products[4].price, c.products[0].price, c.products[1].price], [7000, 5500, null, 1500]);
  throwsMsg(() => setPrices(c, { fries: 1, chai: 2000 }), /^Unlock “Masala Chai” to change its price\.$/);
  assert.equal(c.products[2].price, 7000, 'nothing applied when one fails');
  throwsMsg(() => setPrices(c, { chai: null }), /Unlock/);
  throwsMsg(() => setPrices(c, { fries: -5 }), /valid price for “French Fries”/);
  throwsMsg(() => setPrices(c, { fries: 1e9 }), /valid price/);
  throwsMsg(() => setPrices(c, { ghost: 5 }), /no longer exists/);
  throwsMsg(() => setPrices(c, null), /No prices/);
});

test('setPriceLock with ids and "all"', () => {
  const c = makeConfig();
  setPriceLock(c, ['fries', 'cola'], true);
  assert.deepEqual(c.products.filter(p => p.priceLocked).map(p => p.id), ['chai', 'fries', 'cola']);
  setPriceLock(c, 'all', true);
  assert.ok(c.products.every(p => p.priceLocked));
  throwsMsg(() => setPrices(c, { fries: 1 }), /Unlock “French Fries”/);
  setPriceLock(c, 'all', false);
  assert.ok(c.products.every(p => !p.priceLocked));
  throwsMsg(() => setPriceLock(c, ['ghost'], true), /no longer exists/);
  throwsMsg(() => setPriceLock(c, 'fries', true), /Pick the items/);
  throwsMsg(() => setPriceLock(c, 'all', 'yes'), /on or off/);
});

// ---------------------------------------------------------------------------------------------------------------------------
// add-ons, flavours, stock

test('saveAddons replaces the list, keeping existing ids', () => {
  const c = makeConfig();
  saveAddons(c, [{ id: 'peri', name: ' Peri peri ', price: 500 }, { name: 'Extra dip', price: 0 }, { id: 'unknown', name: 'Mayo', price: 1000 }]);
  assert.equal(c.addons.length, 3);
  assert.deepEqual(c.addons[0], { id: 'peri', name: 'Peri peri', price: 500 });
  assert.notEqual(c.addons[2].id, 'unknown');
  assert.equal(new Set(ids(c.addons)).size, 3);
  saveAddons(c, []);
  assert.deepEqual(c.addons, []);
  throwsMsg(() => saveAddons(c, [{ name: '', price: 0 }]), /Give this add-on a name/);
  throwsMsg(() => saveAddons(c, [{ name: 'Cheese', price: -1 }]), /valid price for “Cheese”/);
  throwsMsg(() => saveAddons(c, [{ name: 'Cheese', price: 1 }, { name: 'cheese', price: 2 }]), /listed twice/);
  throwsMsg(() => saveAddons(c, Array.from({ length: 41 }, (_, i) => ({ name: `A${i}`, price: 0 }))), /at most 40/);
  throwsMsg(() => saveAddons(c, 'x'), /list/);
  validateConfig(c);
});

test('saveFlavours trims, drops blanks and repeats, enforces limits', () => {
  const c = makeConfig();
  saveFlavours(c, [' Classic ', '', 'classic', 'Tangy Tomato', '   ']);
  assert.deepEqual(c.flavours, ['Classic', 'Tangy Tomato']);
  saveFlavours(c, []);
  assert.deepEqual(c.flavours, []);
  throwsMsg(() => saveFlavours(c, ['x'.repeat(41)]), /at most 40/);
  throwsMsg(() => saveFlavours(c, Array.from({ length: 31 }, (_, i) => `F${i}`)), /at most 30 flavours/);
  saveFlavours(c, [...Array.from({ length: 30 }, (_, i) => `F${i}`), 'f1']); // repeats don't count
  assert.equal(c.flavours.length, 30);
  throwsMsg(() => saveFlavours(c, 'x'), /list/);
  validateConfig(c);
});

test('addStockPool / deleteStockPool rules', () => {
  const c = makeConfig();
  const key = addStockPool(c, '  Small Packets! ');
  assert.equal(key, 'small-packets');
  assert.equal(c.stock[key], 0);
  throwsMsg(() => addStockPool(c, 'small packets'), /already a stock pool/);
  throwsMsg(() => addStockPool(c, 'Samosa'), /already a stock pool/);
  throwsMsg(() => addStockPool(c, ''), /Give this stock pool a name/);
  throwsMsg(() => addStockPool(c, '!!!'), /letters or numbers/);
  deleteStockPool(c, key);
  assert.ok(!(key in c.stock));
  throwsMsg(() => deleteStockPool(c, 'samosa'), /^“Samosa” uses “samosa”\. Change its stock pool first\.$/);
  throwsMsg(() => deleteStockPool(c, 'ghost'), /no longer exists/);
  for (let i = 0; i < 5; i++) c.products.push(product(`s${i}`, `Snack ${i}`, 'snacks', { stockKey: 'chai' }));
  throwsMsg(() => deleteStockPool(c, 'chai'), /“Masala Chai”, “Snack 0”, “Snack 1” and 3 more items use “chai”/);
  const full = makeConfig();
  for (let i = Object.keys(full.stock).length; i < 60; i++) addStockPool(full, `pool ${i}`);
  throwsMsg(() => addStockPool(full, 'one more'), /at most 60/);
  validateConfig(c);
});

test('saveStock: inventory switch, totals, below-used rejection', () => {
  const c = makeConfig();
  saveStock(c, { samosa: 12 }, { inventory: true, stock: { samosa: 12, chai: 0 } });
  assert.equal(c.inventory, true);
  assert.deepEqual(c.stock, { samosa: 12, chai: 0, cola: 0 });
  throwsMsg(() => saveStock(c, { samosa: 12 }, { stock: { samosa: 11 } }), /12 of “samosa” already sold or reserved\. Stock can't go below 12\./);
  assert.equal(c.stock.samosa, 12);
  // an unchanged total that is already below "used" (inventory was off) is not an error
  c.stock.cola = 2;
  saveStock(c, { cola: 5 }, { inventory: false, stock: { cola: 2, chai: 3 } });
  assert.equal(c.inventory, false);
  assert.equal(c.stock.chai, 3);
  throwsMsg(() => saveStock(c, {}, { stock: { ghost: 3 } }), /no stock pool called “ghost”/);
  throwsMsg(() => saveStock(c, {}, { stock: { chai: -1 } }), /whole number/);
  throwsMsg(() => saveStock(c, {}, { stock: { chai: 2.5 } }), /whole number/);
  throwsMsg(() => saveStock(c, {}, { inventory: 'on' }), /on or off/);
  saveStock(c, {}, {}); // nothing to do
  validateConfig(c);
});

// ---------------------------------------------------------------------------------------------------------------------------
// discounts

test('discount CRUD, ordering and validation', () => {
  const c = makeConfig();
  const rule = saveDiscount(c, { label: ' Student 5% off ', type: 'percent', value: 5 });
  assert.deepEqual({ ...rule, id: 'x' }, { id: 'x', label: 'Student 5% off', type: 'percent', value: 5, minimum: 0, active: true });
  assert.equal(c.discounts.at(-1), rule);
  const edited = saveDiscount(c, { id: 'reel', value: 1500, active: false });
  assert.deepEqual(edited, { id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1500, minimum: 0, active: false });
  assert.equal(c.discounts[0], edited);
  moveDiscount(c, 'reel', 1);
  assert.deepEqual(ids(c.discounts).slice(0, 2), ['friends', 'reel']);
  moveDiscount(c, 'friends', -1);
  assert.deepEqual(ids(c.discounts).slice(0, 2), ['friends', 'reel']);
  moveDiscount(c, rule.id, 1);
  assert.equal(c.discounts.at(-1), rule);
  deleteDiscount(c, 'festive');
  assert.ok(!c.discounts.some(d => d.id === 'festive'));
  throwsMsg(() => deleteDiscount(c, 'festive'), /no longer exists/);
  throwsMsg(() => moveDiscount(c, 'ghost', 1), /no longer exists/);
  setAllowCustomDiscount(c, false);
  assert.equal(c.allowCustomDiscount, false);
  throwsMsg(() => setAllowCustomDiscount(c, 'no'), /on or off/);

  throwsMsg(() => saveDiscount(c, { label: '', type: 'flat', value: 100 }), /Give this discount a label/);
  throwsMsg(() => saveDiscount(c, { label: 'x'.repeat(41), type: 'flat', value: 100 }), /at most 40/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'bogo', value: 100 }), /₹ off or % off/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'flat', value: 0 }), /how much to take off/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'percent', value: 101 }), /1 to 100/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'percent', value: 0 }), /1 to 100/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'flat', value: 100, minimum: -1 }), /minimum/);
  throwsMsg(() => saveDiscount(c, { label: 'X', type: 'flat', value: 100, active: 'yes' }), /on or off/);
  throwsMsg(() => saveDiscount(c, { id: 'reel', type: 'percent', value: 1500 }), /1 to 100/); // switching type re-validates value
  validateConfig(c);
  while (c.discounts.length < 20) saveDiscount(c, { label: 'D', type: 'flat', value: 1 });
  throwsMsg(() => saveDiscount(c, { label: 'D', type: 'flat', value: 1 }), /at most 20/);
});

// ---------------------------------------------------------------------------------------------------------------------------
// mission & milestones

test('saveMission: total vs itemized, ids kept, validation', () => {
  const c = makeConfig();
  saveMission(c, { mode: 'total', total: 300000 });
  assert.equal(missionTarget(c), 300000);
  assert.equal(c.mission.items.length, 2, 'items survive switching to total');
  saveMission(c, { mode: 'itemized', items: [{ id: 'rent', label: ' Stall rent ', amount: 250000 }, { label: 'Gas & fuel', amount: 40000 }] });
  assert.equal(missionTarget(c), 290000);
  assert.equal(c.mission.items[0].id, 'rent');
  assert.equal(c.mission.items[0].label, 'Stall rent');
  assert.match(c.mission.items[1].id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(c.mission.total, 300000, 'total kept while itemized');
  saveMission(c, { mode: 'itemized', items: [] });
  assert.equal(missionTarget(c), 0);
  throwsMsg(() => saveMission(c, { mode: 'both' }), /Total or Itemized/);
  throwsMsg(() => saveMission(c, { total: -1 }), /valid investment/);
  throwsMsg(() => saveMission(c, { total: 1.5 }), /valid investment/);
  throwsMsg(() => saveMission(c, { items: [{ label: '', amount: 1 }] }), /Name this cost/);
  throwsMsg(() => saveMission(c, { items: [{ label: 'Rent', amount: -1 }] }), /valid amount for “Rent”/);
  throwsMsg(() => saveMission(c, { items: Array.from({ length: 31 }, () => ({ label: 'X', amount: 1 })) }), /at most 30/);
  validateConfig(c);
});

test('milestone CRUD, ordering, replace and validation', () => {
  const c = makeConfig();
  const m = saveMilestone(c, { title: 'Snack attack', type: 'items', target: 100 });
  assert.equal(c.milestones.at(-1), m);
  const edited = saveMilestone(c, { id: 'club', target: 200000 });
  assert.deepEqual(edited, { id: 'club', title: '₹1,000 Club', type: 'revenue', target: 200000 });
  moveMilestone(c, 'first', -1);
  assert.equal(c.milestones[0].id, 'first');
  moveMilestone(c, 'first', 1);
  assert.deepEqual(ids(c.milestones).slice(0, 2), ['club', 'first']);
  deleteMilestone(c, 'half');
  throwsMsg(() => deleteMilestone(c, 'half'), /no longer exists/);
  throwsMsg(() => moveMilestone(c, 'half', 1), /no longer exists/);
  throwsMsg(() => saveMilestone(c, { title: '', type: 'orders', target: 1 }), /Give this milestone a title/);
  throwsMsg(() => saveMilestone(c, { title: 'X', type: 'likes', target: 1 }), /what this milestone counts/);
  throwsMsg(() => saveMilestone(c, { title: 'X', type: 'orders', target: 0 }), /whole number from 1/);
  throwsMsg(() => saveMilestone(c, { title: 'X', type: 'games', target: 2.5 }), /whole number from 1/);
  throwsMsg(() => saveMilestone(c, { title: 'X', type: 'recovery', target: 1001 }), /whole percent/);
  throwsMsg(() => saveMilestone(c, { title: 'X', type: 'revenue', target: 0 }), /Money target/);
  validateConfig(c);

  replaceMilestones(c, [{ id: 'keep', title: 'A', type: 'orders', target: 5 }, { id: 'keep', title: 'B', type: 'orders', target: 6 }, { title: 'C', type: 'games', target: 1 }]);
  assert.equal(c.milestones.length, 3);
  assert.equal(c.milestones[0].id, 'keep');
  assert.equal(new Set(ids(c.milestones)).size, 3);
  throwsMsg(() => replaceMilestones(c, [{ title: '', type: 'orders', target: 1 }]), /title/);
  throwsMsg(() => replaceMilestones(c, 'x'), /list/);
  validateConfig(c);
});

// ---------------------------------------------------------------------------------------------------------------------------
// games

test('game CRUD and validation', () => {
  const c = makeConfig();
  const g = saveGame(c, { name: ' Ring Toss ', fee: 2000, art: 'ring-toss' });
  assert.deepEqual({ ...g, id: 'x' }, { id: 'x', name: 'Ring Toss', fee: 2000, art: 'ring-toss' });
  const free = saveGame(c, { name: 'Lucky Cup' });
  assert.equal(free.fee, 0);
  assert.equal(free.art, 'spin-wheel');
  const edited = saveGame(c, { id: 'spin', fee: 3000 });
  assert.deepEqual(edited, { id: 'spin', name: 'Spin the Wheel', fee: 3000, art: 'spin-wheel' });
  assert.equal(c.games[0], edited);
  deleteGame(c, 'spin');
  assert.ok(!c.games.some(x => x.id === 'spin'));
  throwsMsg(() => deleteGame(c, 'spin'), /no longer exists/);
  throwsMsg(() => saveGame(c, { name: '' }), /Give this game a name/);
  throwsMsg(() => saveGame(c, { name: 'Darts', fee: -1 }), /valid fee for “Darts”/);
  throwsMsg(() => saveGame(c, { name: 'Darts', art: '' }), /picture/);
  throwsMsg(() => saveGame(c, { name: 'x'.repeat(41) }), /at most 40/);
  validateConfig(c);
});

// ---------------------------------------------------------------------------------------------------------------------------
// profile, look, UPI, team

test('saveProfile trims, validates limits, ignores unknown keys', () => {
  const c = makeConfig();
  saveProfile(c, { stallName: '  Chai Point ', booth: 'Booth B-12', eventDate: '2026-12-31', initials: 'CP', bogus: 'x' });
  assert.equal(c.profile.stallName, 'Chai Point');
  assert.equal(c.profile.booth, 'Booth B-12');
  assert.equal(c.profile.city, 'Jabalpur', 'untouched fields kept');
  assert.ok(!('bogus' in c.profile));
  saveProfile(c, { eventDate: '', initials: '' });
  assert.equal(c.profile.eventDate, '');
  throwsMsg(() => saveProfile(c, { stallName: '  ' }), /Give your stall a name/);
  const limits = { stallName: 50, booth: 24, tagline: 70, subTagline: 90, eventName: 60, venue: 80, city: 40, ownerName: 40, initials: 3 };
  for (const [key, max] of Object.entries(limits)) {
    saveProfile(c, { [key]: 'x'.repeat(max) });
    throwsMsg(() => saveProfile(c, { [key]: 'x'.repeat(max + 1) }), new RegExp(`at most ${max} characters`));
  }
  saveProfile(c, { initials: '🔥🎉' }); // emoji count as one character each
  throwsMsg(() => saveProfile(c, { eventDate: '2026-13-01' }), /real event date/);
  throwsMsg(() => saveProfile(c, { eventDate: 'tomorrow' }), /real event date/);
  throwsMsg(() => saveProfile(c, { venue: 42 }), /must be text/);
  throwsMsg(() => saveProfile(c, null), /missing/);
  validateConfig(c);
});

test('saveTheme accepts #RRGGBB only', () => {
  const c = makeConfig();
  saveTheme(c, { accent: '#ff4d87' });
  assert.equal(c.theme.accent, '#FF4D87');
  for (const bad of ['#fff', 'ff4d87', '#GGGGGG', '', null]) throwsMsg(() => saveTheme(c, { accent: bad }), /#FFDD35/);
  validateConfig(c);
});

test('saveUpi accepts real-looking VPAs, rejects junk, empty disables', () => {
  const c = makeConfig();
  for (const id of ['name@okaxis', 'shop.name-1@ybl', '9876543210@paytm']) {
    saveUpi(c, { id, payeeName: 'Chai Point' });
    assert.equal(c.upi.id, id);
    validateConfig(c);
  }
  saveUpi(c, { id: '  name@okaxis  ', payeeName: '  ' });
  assert.deepEqual(c.upi, { id: 'name@okaxis', payeeName: '' });
  for (const bad of ['abc', 'a@1bank', 'with space@ok', '@ybl', 'name@', 'name@@ybl']) {
    throwsMsg(() => saveUpi(c, { id: bad }), /doesn’t look right/);
  }
  throwsMsg(() => saveUpi(c, { id: `${'a'.repeat(98)}@ok` }), /at most 100/);
  throwsMsg(() => saveUpi(c, { id: 'name@okaxis', payeeName: 'x'.repeat(51) }), /at most 50/);
  saveUpi(c, { id: '', payeeName: '' });
  assert.deepEqual(c.upi, { id: '', payeeName: '' });
  validateConfig(c);
});

test('saveOperators: list rules and current cashier', () => {
  const c = makeConfig();
  saveOperators(c, { operators: [' Asha ', '', 'Ravi'], operator: 'ravi' });
  assert.deepEqual(c.operators, ['Asha', 'Ravi']);
  assert.equal(c.operator, 'Ravi');
  saveOperators(c, { operator: 'Asha' });
  assert.equal(c.operator, 'Asha');
  saveOperators(c, { operators: ['Ravi', 'Meera'] }); // current removed → first in list
  assert.equal(c.operator, 'Ravi');
  saveOperators(c, { operators: ['Meera', 'Ravi'] }); // current still there → kept
  assert.equal(c.operator, 'Ravi');
  throwsMsg(() => saveOperators(c, { operators: ['', '  '] }), /at least one team member/);
  throwsMsg(() => saveOperators(c, { operators: ['Ravi', 'ravi'] }), /listed twice/);
  throwsMsg(() => saveOperators(c, { operators: ['x'.repeat(41)] }), /at most 40/);
  throwsMsg(() => saveOperators(c, { operators: Array.from({ length: 21 }, (_, i) => `P${i}`) }), /at most 20/);
  throwsMsg(() => saveOperators(c, { operator: 'Stranger' }), /isn't on the team list/);
  throwsMsg(() => saveOperators(c, { operator: ' ' }), /Pick who is on the counter/);
  validateConfig(c);
});

test('setKitchenQueue', () => {
  const c = makeConfig();
  setKitchenQueue(c, false);
  assert.equal(c.kitchenQueue, false);
  throwsMsg(() => setKitchenQueue(c, 'off'), /on or off/);
});

test('newId returns ID_RE-compatible unique ids', () => {
  const a = newId();
  assert.match(a, /^[a-zA-Z0-9_-]{1,100}$/);
  assert.notEqual(a, newId());
});

// ---------------------------------------------------------------------------------------------------------------------------
// Phase 2 (§16.4): ledger mission, themes, team

test('validateConfig accepts Phase-1 configs (theme {accent}, no team) and every Phase-2 field', () => {
  const c = makeConfig();
  validateConfig(c);
  const phase1 = makeConfig();
  phase1.theme = { accent: '#FFDD35' };
  delete phase1.team;
  assert.doesNotThrow(() => validateConfig(phase1), 'migrate() fills the rest before real data is validated');
  for (const heroImage of ['media:hero-1', 'https://example.com/stall.jpg', null]) validateConfig({ ...c, theme: { ...c.theme, heroImage } });
  validateConfig({ ...c, theme: { ...c.theme, themeId: 'custom', heroArt: [] } });
  const custom = structuredClone(c);
  custom.team.splitMode = 'custom';
  custom.team.members[0].share = 60;
  custom.team.members[1].share = 30;
  assert.doesNotThrow(() => validateConfig(custom), 'custom shares off 100 are allowed (teamSettlement warns and splits equally)');
  validateConfig({ ...c, team: { members: [], splitMode: 'equal' } });
});

test('missionTarget is 0 in ledger mode; saveMission accepts ledger and keeps items as suggestions', () => {
  const c = makeConfig();
  assert.equal(missionTarget(c), 514000);
  saveMission(c, { mode: 'ledger' });
  assert.equal(c.mission.mode, 'ledger');
  assert.equal(missionTarget(c), 0);
  assert.equal(c.mission.items.length, 2, 'items kept');
  validateConfig(c);
  // Auto milestones with no planned investment fall back to the ₹10,000 stretch goal.
  assert.ok(autoMilestones(c).some(m => m.title === '₹10,000 Dhamaka'));
  saveMission(c, { mode: 'itemized' });
  assert.equal(missionTarget(c), 514000);
  throwsMsg(() => saveMission(c, { mode: 'bills' }), /From my bills, Total or Itemized/);
});

test('saveTheme accepts every theme field (partial updates) and validates each', () => {
  const c = makeConfig();
  saveTheme(c, { secondary: '#7ee0b5', heroArt: ['samosa', 'cola-can'], heroTint: 'mint', heroPattern: 'dots', themeId: 'custom' });
  assert.deepEqual(c.theme, {
    accent: '#FFDD35', themeId: 'custom', secondary: '#7EE0B5', heroArt: ['samosa', 'cola-can'], heroTint: 'mint', heroPattern: 'dots',
    heroImage: null,
  });
  saveTheme(c, { heroImage: 'media:abc' });
  assert.equal(c.theme.heroImage, 'media:abc');
  saveTheme(c, { heroImage: ' https://example.com/stall.jpg ' });
  assert.equal(c.theme.heroImage, 'https://example.com/stall.jpg');
  saveTheme(c, { heroImage: '' });
  assert.equal(c.theme.heroImage, null, "'' removes the photo");
  saveTheme(c, {});
  validateConfig(c);
  throwsMsg(() => saveTheme(c, { secondary: 'pink' }), /#FF4D87/);
  throwsMsg(() => saveTheme(c, { heroArt: ['a', 'b', 'c', 'd'] }), /up to 3/);
  throwsMsg(() => saveTheme(c, { heroArt: ['Bad Id'] }), /library/);
  throwsMsg(() => saveTheme(c, { heroTint: 'neon' }), /background colour/);
  throwsMsg(() => saveTheme(c, { heroPattern: 'plaid' }), /pattern/);
  throwsMsg(() => saveTheme(c, { heroImage: 'http://insecure.example/x.png' }), /doesn’t look right/);
  throwsMsg(() => saveTheme(c, { themeId: 'bad id' }), /theme/);
  throwsMsg(() => saveTheme(c, null), /missing/);
  assert.equal(c.theme.secondary, '#7EE0B5', 'rejected saves change nothing');
});

test('team: addMember, renameMember, setMemberColor', () => {
  const c = makeConfig();
  const z = addMember(c, { name: '  Zoya ' });
  assert.deepEqual([z.name, z.share], ['Zoya', null]);
  assert.match(z.id, /^[a-zA-Z0-9_-]+$/);
  assert.ok(!['pink', 'mint'].includes(z.color), 'a free colour is picked');
  const k = addMember(c, { name: 'Kabir', color: 'sky' });
  assert.equal(k.color, 'sky');
  throwsMsg(() => addMember(c, { name: 'zoya' }), /already on the team/);
  throwsMsg(() => addMember(c, { name: ' ' }), /Give this partner a name/);
  throwsMsg(() => addMember(c, { name: 'x'.repeat(41) }), /at most 40/);
  throwsMsg(() => addMember(c, { name: 'Neon', color: 'neon' }), /colour/);
  renameMember(c, z.id, 'Zoya K');
  renameMember(c, z.id, 'zoya k'); // same partner, new case
  assert.equal(c.team.members.find(m => m.id === z.id).name, 'zoya k');
  throwsMsg(() => renameMember(c, z.id, 'Asha'), /already on the team/);
  throwsMsg(() => renameMember(c, 'ghost', 'X'), /no longer on the team/);
  setMemberColor(c, z.id, 'lavender');
  throwsMsg(() => setMemberColor(c, z.id, 'gold'), /colour/);
  validateConfig(c);
  // Up to 20 partners.
  while (c.team.members.length < 20) addMember(c, { name: `P${c.team.members.length}` });
  throwsMsg(() => addMember(c, { name: 'One too many' }), /at most 20/);
  validateConfig(c);
  // A config from before Phase 2 gets a team on first use.
  const old = makeConfig();
  delete old.team;
  addMember(old, { name: 'First' });
  assert.deepEqual([old.team.splitMode, old.team.members.length], ['equal', 1]);
});

test('team: split mode and custom shares', () => {
  const c = makeConfig();
  addMember(c, { name: 'Kabir' });
  setSplitMode(c, 'custom');
  assert.deepEqual(c.team.members.map(m => m.share), [34, 33, 33], 'switching to custom starts on equal whole percents');
  setShares(c, { asha: 70, ravi: 20, [c.team.members[2].id]: 10 });
  assert.deepEqual(c.team.members.map(m => m.share), [70, 20, 10]);
  setShares(c, { ravi: 25, [c.team.members[2].id]: 5 }); // Asha keeps 70
  assert.deepEqual(c.team.members.map(m => m.share), [70, 25, 5]);
  throwsMsg(() => setShares(c, { asha: 80 }), /add up to 110%/);
  throwsMsg(() => setShares(c, { asha: 70.5 }), /whole-number share/);
  throwsMsg(() => setShares(c, { asha: -1 }), /whole-number share/);
  throwsMsg(() => setShares(c, { ghost: 10 }), /no longer on the team/);
  assert.deepEqual(c.team.members.map(m => m.share), [70, 25, 5], 'rejected shares change nothing');
  setSplitMode(c, 'equal');
  setSplitMode(c, 'custom');
  assert.deepEqual(c.team.members.map(m => m.share), [70, 25, 5], 'valid custom shares survive a round trip');
  assert.equal(addMember(c, { name: 'Late joiner' }).share, 0, 'newcomers start at 0% in custom mode');
  throwsMsg(() => setSplitMode(c, 'half'), /Equal or Custom/);
  validateConfig(c);
  assert.deepEqual([equalShares(1), equalShares(3), equalShares(6), equalShares(0)], [[100], [34, 33, 33], [17, 17, 17, 17, 16, 16], []]);
});

test('team: saveTeam replaces the list (ids kept), enforces custom shares', () => {
  const c = makeConfig();
  const team = saveTeam(c, { members: [{ id: 'ravi', name: 'Ravi S', color: 'mint' }, { name: 'Neha' }], splitMode: 'equal' });
  assert.deepEqual(team.members.map(m => [m.id === 'ravi', m.name]), [[true, 'Ravi S'], [false, 'Neha']]);
  assert.equal(c.team, team);
  throwsMsg(() => saveTeam(c, { members: [{ name: 'A', share: 60 }, { name: 'B', share: 30 }], splitMode: 'custom' }), /add up to 90%/);
  throwsMsg(() => saveTeam(c, { members: [{ name: 'A' }, { name: 'a' }] }), /already on the team/);
  throwsMsg(() => saveTeam(c, { splitMode: 'custom' }), /whole-number share/);
  throwsMsg(() => saveTeam(c, { members: 'Asha' }), /list/);
  saveTeam(c, { members: [{ name: 'A', share: 60 }, { name: 'B', share: 40 }], splitMode: 'custom' });
  assert.deepEqual(c.team.members.map(m => m.share), [60, 40]);
  validateConfig(c);
});

test('team: removeMember refuses while the partner has bills or contri (live or practice); voided ones do not count', () => {
  const state = { config: makeConfig(), live: { expenses: [], contributions: [] }, demo: { expenses: [], contributions: [] } };
  state.live.expenses.push({ id: 'b1', paidBy: 'asha', amount: 100, void: false });
  state.demo.contributions.push({ id: 'c1', memberId: 'ravi', amount: 100, void: false });
  throwsMsg(() => removeMember(state, 'asha'), /“Asha” has bills recorded\. Rename them instead/);
  throwsMsg(() => removeMember(state, 'ravi'), /“Ravi” has contri recorded in the practice ledger/);
  state.live.expenses[0].void = true;
  removeMember(state, 'asha');
  assert.deepEqual(state.config.team.members.map(m => m.id), ['ravi']);
  throwsMsg(() => removeMember(state, 'asha'), /no longer on the team/);
  validateConfig(state.config);
});
