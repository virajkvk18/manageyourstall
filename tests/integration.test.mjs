// Integration tests: the pure modules working together (ARCHITECTURE.md §2–§7, §14).
//  1. Cross-checks: every template (fresh install and applied over a stall with history) passes catalog.validateConfig and a
//     backup round trip; the migrated v1 fixture is a valid config; every art id the data relies on exists in the library.
//  2. An adversarial, seeded end-to-end rush (~200 orders across IST midnight) checked against an independent money model
//     after every step, then a backup round trip and a battery of tampered backups.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initialState, applyTemplate, migrate, productById, sellability, stockUsed, stockLeft, makeLine, addToDraft, clearDraft,
  setDraftDiscount, setDraftNote, draftTotals, createOrder, markPaid, correctOrder, methodBalances, netFor, setKitchen, kitchenQueue,
  resetTokens, upcomingToken, addGame, voidGame, addExpense, voidExpense, report, refreshMilestones, milestoneProgress, upiUri, dayReportText,
  ordersCsvRows, orderSummaryCsvRows, paymentsCsvRows, csv, exportBackup, validateBackup,
} from '../dist/domain.mjs';
import {
  validateConfig, missionTarget, autoMilestones, normalizeProduct, saveProduct, saveGame, saveDiscount, saveStock, saveUpi, setSoldOut,
  setKitchenQueue, addStockPool,
} from '../dist/catalog.mjs';
import {TEMPLATES, buildTemplate} from '../dist/templates.mjs';
import {ART, hasArt, FALLBACK_ART} from '../dist/library.mjs';
import {encodeQR, qrSvg} from '../dist/qr.mjs';
import jsQR from 'jsqr';
import {istDate, money} from '../dist/util.mjs';

const TEMPLATE_IDS = TEMPLATES.map(t => t.id);
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const V1 = load('v1-state.json');
const V1_EXPECTED = load('v1-expected.json');
const T0 = '2026-11-04T10:00:00.000Z'; // 15:30 IST
const at = (minutes, base = T0) => new Date(Date.parse(base) + minutes * 60000).toISOString();

/** Ledger fields that must survive any config change untouched. */
const ledgerOf = s => structuredClone({orders: s.orders, payments: s.payments, games: s.games, expenses: s.expenses});
/** Report numbers that only depend on the ledger (not on the menu or mission). */
const salesNumbers = r => ({
  collected: r.collected, food: r.food, gameIncome: r.gameIncome, methods: r.methods, orders: r.orders, units: r.units,
  average: r.average, gross: r.gross, discounts: r.discounts, refunds: r.refunds, games: r.games, expenses: r.expenses,
  pending: r.pending, best: r.best, categories: r.categories, hourly: r.hourly, discountUses: r.discountUses,
});

/** First product that can be sold right now (null when the menu has none). */
const firstSellable = (s, c) => c.products.find(p => sellability(s, c, p).ok) || null;

/** A street-chaat stall with real history in both ledgers, a cart in progress, a PIN and a custom profile. */
function stallWithHistory() {
  const st = initialState({templateId: 'street-chaat'});
  st.onboarded = true;
  st.pin = {salt: 'pepper', hash: 'b'.repeat(64)};
  const c = st.config;
  c.profile.stallName = 'Pataka Point';
  c.profile.tagline = 'Owner tagline';
  c.theme.accent = '#FF4D87';
  saveUpi(c, {id: 'pataka@okaxis', payeeName: 'Pataka Point'});
  saveStock(c, stockUsed(st.live), {inventory: true});
  const s = st.live;
  const cashOrder = createOrder(s, c, {
    id: 'hist-1',
    items: [
      makeLine(c, 'combo-triple-dhamaka'),
      makeLine(c, 'veggie-chips-chaat-large', {addons: ['extra-cheese'], flavour: 'Magic Masala'}),
    ],
    discount: {ruleId: 'friends-faculty'}, method: 'Cash', cashReceived: 50000,
  }, at(0));
  assert.equal(cashOrder.total, 13000 + 7000 - 2000);
  createOrder(s, c, {id: 'hist-2', items: [makeLine(c, 'cola', {quantity: 2})], method: 'UPI', pending: true}, at(5));
  createOrder(s, c, {id: 'hist-3', items: [makeLine(c, 'cheese-chips-chaat-large')], method: 'Split', split: {Cash: 3000, UPI: 5000}}, at(10));
  correctOrder(s, c, 'hist-3', {type: 'refund', amount: 1500, method: 'UPI', reason: 'Burnt crust'}, at(12));
  createOrder(s, c, {id: 'hist-4', items: [makeLine(c, 'orange-fizz')], method: 'Other'}, at(15));
  correctOrder(s, c, 'hist-4', {type: 'void', reason: 'Wrong item'}, at(16));
  addGame(s, c, {id: 'hist-game', gameId: 'spin-the-wheel', prize: 'Sticker'}, at(20));
  addExpense(s, c, {id: 'hist-exp', category: 'Supplies', amount: 25000, description: 'Extra cups'}, at(25));
  addToDraft(s, c, makeLine(c, 'french-fries'));
  setDraftDiscount(s, c, {custom: true, type: 'percent', value: 15});
  setDraftNote(s, 'no ketchup');
  createOrder(st.demo, c, {id: 'demo-1', items: [makeLine(c, 'lemon-fizz')], method: 'Cash'}, at(30));
  addToDraft(st.demo, c, makeLine(c, 'cola'));
  return st;
}

// =====================================================================================================================
// 1. Cross-checks between modules
// =====================================================================================================================

for (const templateId of TEMPLATE_IDS) {
  for (const withPrices of [true, false]) {
    test(`initialState(${templateId}, withPrices: ${withPrices}) passes validateConfig and a backup round trip`, () => {
      const st = initialState({templateId, withPrices});
      assert.equal(validateConfig(st.config), st.config);
      assert.equal(st.config.templateId, templateId);
      const {state, media, warnings} = validateBackup(exportBackup(st, {}));
      assert.deepEqual([media, warnings], [{}, []]);
      assert.deepEqual(state.config, st.config);
      assert.equal(state.onboarded, false);
      assert.equal(report(state.live, state.config).mission.investment, missionTarget(st.config));

      // The fresh stall behaves as the template promises: priced → sellable, unpriced → "SET PRICE".
      const products = st.config.products;
      if (!withPrices) {
        for (const p of products) assert.equal(sellability(st.live, st.config, p).reason, 'unpriced', p.id);
      } else if (products.length) {
        const p = firstSellable(st.live, st.config);
        assert.ok(p, 'a priced template has something to sell');
        const o = createOrder(st.live, st.config, {id: 'first', items: [makeLine(st.config, p.id)], method: 'UPI'}, T0);
        assert.deepEqual([o.status, o.token, o.kitchen, report(st.live, st.config).collected], ['paid', 1, 'preparing', p.price]);
        assert.doesNotThrow(() => validateBackup(exportBackup(st, {})));
      }
    });
  }
}

for (const templateId of TEMPLATE_IDS) {
  for (const withPrices of [true, false]) {
    test(`applyTemplate(${templateId}, withPrices: ${withPrices}) over a stall with history stays valid and keeps the money`, () => {
      const st = stallWithHistory();
      const before = {
        live: ledgerOf(st.live), demo: ledgerOf(st.demo),
        liveReport: salesNumbers(report(st.live, st.config)), demoReport: salesNumbers(report(st.demo, st.config)),
        profile: structuredClone(st.config.profile), upi: structuredClone(st.config.upi), theme: structuredClone(st.config.theme),
        operators: [...st.config.operators], operator: st.config.operator, pin: structuredClone(st.pin),
        liveTokens: [st.live.tokenDay, st.live.tokenSeq],
      };
      const oldDraftId = st.live.draftId;
      applyTemplate(st, templateId, {withPrices}, at(60));
      const c = st.config;

      assert.equal(validateConfig(c), c);
      assert.equal(c.templateId, templateId);
      // History and identity are untouched; the menu side is the template's.
      assert.deepEqual(ledgerOf(st.live), before.live);
      assert.deepEqual(ledgerOf(st.demo), before.demo);
      assert.deepEqual(salesNumbers(report(st.live, c)), before.liveReport);
      assert.deepEqual(salesNumbers(report(st.demo, c)), before.demoReport);
      assert.deepEqual([c.profile, c.upi, c.theme, c.operators, c.operator, st.pin], [
        before.profile, before.upi, before.theme, before.operators, before.operator, before.pin,
      ]);
      assert.deepEqual([st.live.tokenDay, st.live.tokenSeq], before.liveTokens, 'kitchen tokens keep counting');
      const built = buildTemplate(templateId, {withPrices});
      assert.deepEqual([c.categories, c.products, c.games, c.discounts, c.mission, c.milestones, c.stock, c.inventory], [
        built.categories, built.products, built.games, built.discounts, built.mission, built.milestones, built.stock, built.inventory,
      ]);
      // Both carts are cleared with a new idempotency key; the switch is audited.
      for (const s of [st.live, st.demo]) assert.deepEqual([s.draft, s.draftDiscount, s.draftNote], [[], null, '']);
      assert.notEqual(st.live.draftId, oldDraftId);
      assert.equal(st.live.audit.at(-1).type, 'template-applied');
      // The mission now uses the new plan (ledger templates: break-even = the bills); milestones were re-evaluated.
      const r = report(st.live, c);
      assert.equal(r.mission.planned, missionTarget(c));
      assert.equal(r.mission.investment, c.mission.mode === 'ledger' ? r.mission.bills : missionTarget(c));
      assert.equal(r.mission.target, r.mission.planned + r.mission.bills);
      for (const m of c.milestones) assert.equal(st.live.milestones[m.id].active, milestoneProgress(m, r).done, m.id);

      // Restorable, and the stall keeps selling on the new menu (numbers and tokens continue).
      const restored = validateBackup(exportBackup(st, {}));
      assert.deepEqual(restored.state, st);
      const p = firstSellable(st.live, c);
      if (withPrices && c.products.length) {
        const o = createOrder(st.live, c, {id: 'after-switch', items: [makeLine(c, p.id)], method: 'Cash'}, at(61));
        assert.deepEqual([o.number, o.token], [5, 5]);
        assert.doesNotThrow(() => validateBackup(exportBackup(st, {})));
      } else {
        assert.equal(p, null);
      }
    });
  }
}

test('the migrated v1 fixture is a valid v2 config, restorable, and keeps selling after a template switch', () => {
  const st = migrate(structuredClone(V1));
  assert.equal(validateConfig(st.config), st.config);
  const restored = validateBackup(exportBackup(st, {}));
  assert.deepEqual(restored.state.config, st.config);
  const r = report(st.live, st.config);
  assert.deepEqual([r.collected, r.methods, r.orders, r.units, r.refunds, r.games, r.gameIncome, r.expenses, r.discounts, r.pending.count],
    [V1_EXPECTED.collected, V1_EXPECTED.methods, V1_EXPECTED.orders, V1_EXPECTED.units, V1_EXPECTED.refunds, V1_EXPECTED.games,
      V1_EXPECTED.gameIncome, V1_EXPECTED.expenses, V1_EXPECTED.discounts, V1_EXPECTED.pendingOrders]);
  // Legacy milestone ids carry their unlock state.
  for (const [id, active] of Object.entries(V1_EXPECTED.milestones)) {
    assert.equal(restored.state.live.milestones[id]?.active ?? false, active, id);
  }

  applyTemplate(st, 'chaat-momo', {withPrices: true}, '2026-11-05T05:00:00.000Z');
  assert.equal(validateConfig(st.config), st.config);
  assert.deepEqual(salesNumbers(report(st.live, st.config)).collected, V1_EXPECTED.collected);
  const p = firstSellable(st.live, st.config);
  const items = [makeLine(st.config, p.id)];
  const o = createOrder(st.live, st.config, {id: 'v1-then-v2', items, method: 'UPI'}, '2026-11-05T05:01:00.000Z');
  assert.deepEqual([o.number, o.token, o.tokenDay], [V1_EXPECTED.liveOrderCount + 1, 1, '2026-11-05']);
  assert.doesNotThrow(() => validateBackup(exportBackup(st, {})));
});

test('every art id used by templates, games, migration and catalog defaults exists in the library', () => {
  /** @type {Map<string, string>} art id → where it is used */
  const used = new Map();
  for (const card of TEMPLATES) used.set(card.art, `TEMPLATES card ${card.id}`);
  for (const id of TEMPLATE_IDS) {
    for (const withPrices of [true, false]) {
      const t = buildTemplate(id, {withPrices});
      for (const p of t.products) used.set(p.art, `${id} product ${p.id}`);
      for (const g of t.games) used.set(g.art, `${id} game ${g.id}`);
    }
  }
  const migrated = migrate(structuredClone(V1)).config;
  for (const p of migrated.products) used.set(p.art, `migrated v1 product ${p.id}`);
  for (const g of migrated.games) used.set(g.art, `migrated v1 game ${g.id}`);
  // Defaults that catalog/domain fill in when the owner doesn't pick a picture.
  const c = initialState().config;
  used.set(normalizeProduct(c, {name: 'Plain item'}).art, 'catalog default product art');
  used.set(normalizeProduct(c, {name: 'Combo', bundle: [{productId: 'cola', quantity: 1}]}).art, 'catalog default combo art');
  used.set(saveGame(structuredClone(c), {name: 'New game'}).art, 'catalog default game art');
  used.set(FALLBACK_ART, 'library fallback');
  for (const [art, where] of used) assert.ok(hasArt(art), `${where} uses missing art "${art}"`);
  // And none of them silently relies on the fallback picture.
  for (const [art] of used) assert.notEqual(ART[art].svg, '', art);
});

test('catalog edits made through the helpers keep the ledger working (discount, milestones, stock, games)', () => {
  const st = initialState({templateId: 'drinks-games'});
  const c = st.config;
  const s = st.live;
  // Auto milestones for a stall with games include "Game on", and the domain evaluates them.
  c.milestones = autoMilestones(c);
  validateConfig(c);
  assert.ok(c.milestones.some(m => m.type === 'games'));
  const play = addGame(s, c, {id: 'p1', gameId: 'ring-toss', method: 'UPI'}, T0);
  assert.equal(play.fee, 2000);
  const gameOn = c.milestones.find(m => m.type === 'games');
  assert.equal(s.milestones[gameOn.id].active, true);
  // A fee change only affects new plays (snapshots).
  saveGame(c, {id: 'ring-toss', fee: 2500});
  addGame(s, c, {id: 'p2', gameId: 'ring-toss', method: 'Cash'}, at(1));
  assert.deepEqual(s.games.map(g => g.fee), [2000, 2500]);
  assert.equal(report(s, c).gameIncome, 4500);
  // A rule edited after it was put on the cart applies with its current values at checkout.
  saveDiscount(c, {id: 'festive-10', active: true, minimum: 0});
  addToDraft(s, c, makeLine(c, 'combo-shake-brownie'));
  setDraftDiscount(s, c, {ruleId: 'festive-10'});
  saveDiscount(c, {id: 'festive-10', value: 20});
  assert.equal(draftTotals(s, c).discount, 2600);
  const o = createOrder(s, c, {id: 'o1', items: s.draft, discount: s.draftDiscount, method: 'Cash', cashReceived: 20000}, at(2));
  assert.deepEqual([o.subtotal, o.discount, o.total, o.change], [13000, 2600, 10400, 9600]);
  assert.deepEqual(o.discountInfo, {id: 'festive-10', label: 'Festive 10% off', type: 'percent', value: 20});
  // Stock room totals can't drop below what the ledger already used.
  saveStock(c, stockUsed(s), {inventory: true});
  assert.deepEqual(stockUsed(s), {brownies: 1});
  assert.throws(() => saveStock(c, stockUsed(s), {stock: {brownies: 0}}), /can't go below 1/);
  saveStock(c, stockUsed(s), {stock: {brownies: 1}});
  assert.equal(sellability(s, c, productById(c, 'brownie-sundae')).reason, 'stock');
  assert.equal(sellability(s, c, productById(c, 'combo-shake-brownie')).reason, 'stock');
  assert.throws(() => createOrder(s, c, {id: 'o2', items: [makeLine(c, 'brownie-sundae')], method: 'UPI'}, at(3)), /Not enough stock/);
  correctOrder(s, c, 'o1', {type: 'void', reason: 'Customer left'}, at(4));
  assert.equal(stockLeft(s, c, 'brownies'), 1);
  assert.ok(sellability(s, c, productById(c, 'combo-shake-brownie')).ok);
  assert.doesNotThrow(() => validateBackup(exportBackup(st, {})));
});

test('owner-chosen keys that collide with Object.prototype names ("constructor", "toString") stay safe', () => {
  const st = initialState();
  const c = st.config;
  const s = st.live;
  // addStockPool('Constructor') → key 'constructor': stock must still be counted and enforced (was NaN → oversold).
  const key = addStockPool(c, 'Constructor');
  assert.equal(key, 'constructor');
  saveStock(c, stockUsed(s), {inventory: true, stock: {[key]: 3}});
  saveProduct(c, {id: 'cola', stockKey: key});
  assert.deepEqual(makeLine(c, 'combo-snack-fizz').stock, {'chips-small': 1, constructor: 1});
  createOrder(s, c, {id: 'k1', items: [makeLine(c, 'cola', {quantity: 2})], method: 'UPI'}, T0);
  assert.equal(stockLeft(s, c, key), 1);
  assert.deepEqual(sellability(s, c, productById(c, 'cola')), {ok: true, reason: '', left: 1});
  createOrder(s, c, {id: 'k2', items: [makeLine(c, 'combo-snack-fizz')], method: 'Cash'}, at(1));
  assert.deepEqual(stockUsed(s).constructor, 3);
  assert.deepEqual(sellability(s, c, productById(c, 'cola')), {ok: false, reason: 'stock', left: 0});
  assert.equal(sellability(s, c, productById(c, 'combo-triple-dhamaka')).reason, 'stock');
  const oneCola = [makeLine(c, 'cola')];
  assert.throws(() => createOrder(s, c, {id: 'k3', items: oneCola, method: 'UPI'}, at(2)), /Not enough stock for Cola: 0 left/);
  assert.throws(() => saveStock(c, stockUsed(s), {stock: {[key]: 2}}), /can't go below 3/);
  assert.deepEqual(validateBackup(exportBackup(st, {})).state.live.orders.length, 2);

  // validateConfig: a category id must really exist (not be found on Object.prototype).
  for (const bad of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    const copy = structuredClone(c);
    copy.products[0].categoryId = bad;
    assert.throws(() => validateConfig(copy), /category that doesn't exist/, bad);
  }
  // A crafted backup with a "__proto__" stock pool is refused instead of silently losing the pool.
  const text = JSON.stringify(exportBackup(st, {})).replace('"stock":{', '"stock":{"__proto__":5,');
  assert.throws(() => validateBackup(JSON.parse(text)), /Backup rejected: Stock pool “__proto__” has an invalid name/);
  // Milestone ids are read as own properties too.
  c.milestones.push({id: 'toString', title: 'Odd id', type: 'orders', target: 1});
  createOrder(s, c, {id: 'k4', items: [makeLine(c, 'french-fries')], method: 'UPI'}, at(3));
  assert.deepEqual(s.milestones.toString, {active: true, unlockedAt: at(3), reference: 'k4', updatedAt: at(3)});
});

/** Rasterise a QR symbol (4 px per module, 4-module quiet zone) and decode it with jsQR. */
function decodeQR(qr, scale = 4, quiet = 4) {
  const dim = (qr.size + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * dim + (x + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, dim, dim);
}

test('checkout UPI QR: qr.mjs encodes domain.upiUri exactly (payee fallback, UTF-8 names, token notes)', () => {
  const c = initialState().config;
  assert.equal(upiUri(c, 16000), null, 'no QR until a UPI id is set');
  saveUpi(c, {id: 'pataka.point@okaxis', payeeName: ''});
  c.profile.stallName = 'पटाका Point & Co. #10';
  for (const [amount, note] of [[16000, 'Token #07 · पटाका Point'], [1, ''], [99999999, 'Token #123 · Split UPI part']]) {
    const uri = upiUri(c, amount, note);
    assert.ok(uri.startsWith('upi://pay?pa=pataka.point%40okaxis&pn=%E0%A4%AA'), uri);
    assert.ok(uri.includes(`&am=${(amount / 100).toFixed(2)}&cu=INR`), uri);
    const qr = encodeQR(uri);
    const decoded = decodeQR(qr);
    assert.ok(decoded, `jsQR could read the QR for ${uri}`);
    assert.equal(decoded.data, uri);
    const svg = qrSvg(uri, {label: `Pay ${money(amount)} by UPI`});
    assert.ok(svg.includes(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`), 'qrSvg draws the same symbol size');
    assert.ok(svg.includes('aria-label="Pay ₹'), 'label is kept (and escaped)');
  }
  // The payee name wins over the stall name when set.
  saveUpi(c, {id: 'pataka.point@okaxis', payeeName: 'Viraj S'});
  assert.equal(decodeQR(encodeQR(upiUri(c, 2500))).data, 'upi://pay?pa=pataka.point%40okaxis&pn=Viraj%20S&am=25.00&cu=INR');
});

// =====================================================================================================================
// 2. Adversarial end-to-end rush across IST midnight
// =====================================================================================================================

/** Deterministic PRNG (mulberry32). @param {number} seed */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = list => list[Math.floor(next() * list.length)];
  return {next, int, pick, chance: p => next() < p};
}

const METHODS3 = ['Cash', 'UPI', 'Other'];
/** Ledger rows a confirmed payment plan must write: one per Split part, else one row of the method (none for ₹0). */
const planRows = (plan, total) =>
  plan.method === 'Split' ? [['Cash', plan.split.Cash], ['UPI', plan.split.UPI]] : total > 0 ? [[plan.method, total]] : [];
const NOTES = ['', '', '', 'extra spicy, no onion', '=HYPERLINK("http://x")', '+91 98765 43210 call when ready', '-less salt', '@table 4',
  'Table "B", quick!'];

/**
 * Runs a seeded rush against the real modules while keeping an independent model of the money, stock, tokens and milestones,
 * and checks every invariant after every step.
 */
function runRush(seed) {
  const rnd = prng(seed);
  const st = initialState({templateId: 'street-chaat'});
  st.onboarded = true;
  const c = st.config;
  const s = st.live;
  saveGame(c, {name: 'Ring Toss', fee: 2000, art: 'ring-toss'});
  const ringToss = c.games.find(g => g.name === 'Ring Toss').id;
  saveDiscount(c, {id: 'festive-10', active: true});
  saveUpi(c, {id: 'rush.stall@okicici', payeeName: ''});
  saveStock(c, stockUsed(s), {inventory: true});
  validateConfig(c);

  // ---- independent model -------------------------------------------------------------------------------------------
  const model = {
    collected: 0,
    refunds: 0,
    methods: {Cash: 0, UPI: 0, Other: 0},
    expenses: 0,
    restock: 0,
    /** @type {Map<string, number>} live (non-void) bills: id → amount */ bills: new Map(),
    /** @type {Map<string, any>} */ orders: new Map(),
    /** @type {Map<string, any>} */ games: new Map(),
    tokenDay: null,
    tokenSeq: 0,
    lastOrderId: null,
    lastGameId: null,
    /** @type {Record<string, string>} */ firstUnlock: {},
    /** @type {Record<string, string|null>} */ firstReference: {},
    everDeactivated: new Set(),
    lastActive: {},
  };
  const stats = {orders: 0, pending: 0, paidLater: 0, refunds: 0, splitRefunds: 0, voids: 0, games: 0, gameVoids: 0, expenses: 0,
    rejected: 0, stockOuts: 0, splits: 0, customDiscounts: 0, kitchen: 0, idempotent: 0};
  const investment = missionTarget(c);
  let clock = Date.parse('2026-11-04T16:30:00.000Z'); // 22:00 IST
  let now = new Date(clock).toISOString();
  const tick = () => {
    clock += rnd.int(15, 75) * 1000;
    now = new Date(clock).toISOString();
  };

  const pay = (method, amount) => {
    model.collected += amount;
    model.methods[method] += amount;
    if (amount < 0) model.refunds -= amount;
  };
  const stockPer = p => {
    const out = {};
    const parts = p.bundle ? p.bundle.map(b => [productById(c, b.productId), b.quantity]) : [[p, 1]];
    for (const [q, n] of parts) if (q.stockKey) out[q.stockKey] = (out[q.stockKey] || 0) + n * q.stockUnits;
    return out;
  };
  const modelStockUsed = () => {
    const used = {};
    for (const o of model.orders.values()) {
      if (o.status === 'void') continue;
      for (const [k, n] of Object.entries(o.stock)) used[k] = (used[k] || 0) + n;
    }
    return used;
  };
  const eligible = () => [...model.orders.values()].filter(o => o.status === 'paid' || o.status === 'partial');
  const net = o => o.bal.Cash + o.bal.UPI + o.bal.Other;
  const snapshot = () => JSON.stringify([s.orders, s.payments, s.games, s.expenses, s.tokenDay, s.tokenSeq, s.milestones]);
  const rejects = (fn, pattern, label) => {
    const before = snapshot();
    assert.throws(fn, pattern, label);
    assert.equal(snapshot(), before, `${label}: a rejected action must not change the ledger`);
    stats.rejected++;
  };

  // ---- invariants checked after every step -------------------------------------------------------------------------
  const check = label => {
    const r = report(s, c);
    const paymentsSum = s.payments.reduce((n, p) => n + p.amount, 0);
    assert.equal(r.collected, paymentsSum, `${label}: Σ payments = collected`);
    assert.equal(r.collected, model.collected, `${label}: collected matches the model`);
    assert.deepEqual(r.methods, model.methods, `${label}: methods`);
    assert.equal(r.methods.Cash + r.methods.UPI + r.methods.Other, r.collected, `${label}: methods add up`);
    assert.equal(r.food + r.gameIncome, r.collected, `${label}: food + games = collected`);
    assert.equal(r.refunds, model.refunds, `${label}: refunds`);
    assert.equal(r.expenses, model.expenses, `${label}: expenses`);
    const elig = eligible();
    assert.equal(r.orders, elig.length, `${label}: eligible orders`);
    assert.equal(r.units, elig.reduce((n, o) => n + o.units, 0), `${label}: units`);
    const pend = [...model.orders.values()].filter(o => o.status === 'pending');
    assert.deepEqual(r.pending, {count: pend.length, amount: pend.reduce((n, o) => n + o.total, 0)}, `${label}: pending`);
    const plays = [...model.games.values()].filter(g => !g.void).length;
    assert.equal(r.games, plays, `${label}: games`);
    assert.equal(r.average, elig.length ? Math.round(elig.reduce((n, o) => n + net(o), 0) / elig.length) : 0, `${label}: average`);

    // Mission math (always whole-session). Ledger mode: break-even = the bills; planned modes: plan + bills.
    const ledgerMode = c.mission.mode === 'ledger';
    const target = investment + model.expenses;
    assert.deepEqual(r.mission, {
      investment: ledgerMode ? model.expenses : investment, extraExpenses: ledgerMode ? 0 : model.expenses, target,
      collected: model.collected, remaining: Math.max(0, target - model.collected),
      profit: model.collected - target, percent: target > 0 ? Math.min(100, Math.max(0, (model.collected * 100) / target)) : 0,
      recovery: target > 0 ? (model.collected * 100) / target : 0,
      profitMode: target > 0 && model.collected >= target,
      hasTarget: target > 0,
      mode: c.mission.mode, planned: investment, bills: model.expenses, restock: model.restock,
    }, `${label}: mission`);
    assert.equal(r.expenseTotals.total, model.expenses, `${label}: expense totals`);
    assert.equal(r.expenseTotals.count, model.bills.size, `${label}: live bill count`);

    // Per-entity ledger invariants.
    /** @type {Map<string, {bal: any, pos: any, rows: number}>} */
    const ledger = new Map();
    for (const p of s.payments) {
      const e = ledger.get(p.entityId) || {bal: {Cash: 0, UPI: 0, Other: 0}, pos: {Cash: 0, UPI: 0, Other: 0}, rows: 0};
      e.bal[p.method] += p.amount;
      if (p.amount > 0) e.pos[p.method] += p.amount;
      else assert.equal(p.kind, 'refund', `${label}: negative rows are refunds`);
      e.rows++;
      ledger.set(p.entityId, e);
    }
    assert.equal(s.orders.length, model.orders.size, `${label}: order count`);
    for (const o of s.orders) {
      const m = model.orders.get(o.id);
      const e = ledger.get(o.id) || {bal: {Cash: 0, UPI: 0, Other: 0}, pos: {Cash: 0, UPI: 0, Other: 0}, rows: 0};
      const what = `${label}: order ${o.number}`;
      assert.equal(o.status, m.status, `${what} status`);
      assert.deepEqual(e.bal, m.bal, `${what} per-method balance`);
      assert.deepEqual(methodBalances(s, o.id), m.bal, `${what} methodBalances`);
      const n = netFor(s, o.id);
      for (const k of METHODS3) assert.ok(e.bal[k] >= 0, `${what}: ${k} never refunded below zero`);
      if (o.status === 'paid') assert.equal(n, o.total, `${what}: paid ⇒ net = total`);
      if (o.status === 'partial') assert.ok(n > 0 && n < o.total, `${what}: partial ⇒ 0 < net < total`);
      if (['refunded', 'void', 'pending'].includes(o.status)) assert.equal(n, 0, `${what}: ${o.status} ⇒ net 0`);
      if (o.status === 'pending') assert.equal(e.rows, 0, `${what}: pending has no rows`);
      assert.equal(o.subtotal - o.discount, o.total, `${what}: total = subtotal − discount`);
      assert.equal(o.items.reduce((t, l) => t + l.lineTotal, 0), o.subtotal, `${what}: Σ lines = subtotal`);
      assert.deepEqual([o.subtotal, o.discount, o.total], [m.subtotal, m.discount, m.total], `${what}: totals snapshot`);
      const paidIn = e.pos.Cash + e.pos.UPI + e.pos.Other;
      if (o.method === 'Split' && paidIn > 0) {
        assert.deepEqual(e.pos, {Cash: o.split.Cash, UPI: o.split.UPI, Other: 0}, `${what}: split rows = parts`);
        assert.equal(o.split.Cash + o.split.UPI, o.total, `${what}: split parts add up`);
      } else if (paidIn > 0) {
        assert.equal(e.pos[o.method], o.total, `${what}: one row of its own method`);
      }
    }
    for (const g of s.games) {
      const m = model.games.get(g.id);
      const e = ledger.get(g.id);
      const gnet = e ? e.bal.Cash + e.bal.UPI + e.bal.Other : 0;
      assert.equal(g.void, m.void, `${label}: game ${g.id} void flag`);
      assert.equal(gnet, g.void ? 0 : g.fee, `${label}: game ${g.id} net = fee unless void`);
      if (g.fee === 0) assert.equal(e, undefined, `${label}: free game writes no payment`);
    }

    // Stock: pending reserves, void releases, refunds don't return food; never oversold.
    const used = modelStockUsed();
    const actualUsed = stockUsed(s);
    for (const k of new Set([...Object.keys(used), ...Object.keys(actualUsed)])) {
      assert.equal(actualUsed[k] || 0, used[k] || 0, `${label}: stock used for ${k}`);
    }
    for (const [k, total] of Object.entries(c.stock)) {
      assert.ok((used[k] || 0) <= total, `${label}: ${k} oversold (${used[k]} > ${total})`);
      assert.equal(stockLeft(s, c, k), total - (used[k] || 0), `${label}: stockLeft ${k}`);
    }
    for (const p of c.products) {
      const need = stockPer(p);
      let left = null;
      let short = false;
      for (const [k, n] of Object.entries(need)) {
        const rem = c.stock[k] - (used[k] || 0);
        if (rem < n) short = true;
        const v = p.bundle ? Math.floor(rem / n) : rem;
        left = left === null ? v : Math.min(left, v);
      }
      const sel = sellability(s, c, p);
      assert.equal(sel.left, left, `${label}: sellability.left for ${p.id}`);
      if (!p.soldOut && !p.bundle?.some(b => productById(c, b.productId).soldOut)) {
        assert.equal(sel.reason, short ? 'stock' : '', `${label}: sellability.reason for ${p.id}`);
      }
    }

    // Milestones: active state recomputed independently; first unlock time & reference kept through reversals.
    for (const m of c.milestones) {
      const expected = m.type === 'orders' ? elig.length >= m.target
        : m.type === 'revenue' ? model.collected >= m.target
          : m.type === 'recovery' ? target > 0 && model.collected * 100 >= m.target * target
            : m.type === 'items' ? r.units >= m.target
              : plays >= m.target;
      const rec = s.milestones[m.id];
      assert.equal(rec?.active ?? false, expected, `${label}: milestone ${m.id} active`);
      assert.equal(milestoneProgress(m, r).done, expected, `${label}: milestoneProgress ${m.id}`);
      if (expected && !model.firstUnlock[m.id]) {
        model.firstUnlock[m.id] = now;
        model.firstReference[m.id] = m.type === 'games' ? model.lastGameId : model.lastOrderId;
      }
      if (model.lastActive[m.id] && !expected) model.everDeactivated.add(m.id);
      model.lastActive[m.id] = expected;
      assert.equal(rec?.unlockedAt ?? null, model.firstUnlock[m.id] ?? null, `${label}: milestone ${m.id} keeps its first unlock time`);
      assert.equal(rec?.reference ?? null, model.firstReference[m.id] ?? null, `${label}: milestone ${m.id} reference`);
    }

    // Kitchen queue: oldest first, never void/refunded/handed.
    const q = kitchenQueue(s);
    for (const [stage, list] of Object.entries(q)) {
      for (const o of list) {
        assert.equal(o.kitchen, stage);
        assert.ok(!['void', 'refunded'].includes(o.status), `${label}: queue excludes ${o.status}`);
      }
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].at <= list[i].at, `${label}: queue oldest first`);
    }
  };

  // ---- actions -----------------------------------------------------------------------------------------------------
  const sellable = () => c.products.filter(p => sellability(s, {...c, inventory: false}, p).ok);
  const sumNeed = lines => {
    const need = {};
    for (const l of lines) for (const [k, n] of Object.entries(l.stock)) need[k] = (need[k] || 0) + n * l.quantity;
    return need;
  };
  const expectDiscount = (subtotal, spec) => {
    if (!spec) return 0;
    const rule = spec.custom ? {type: spec.type, value: spec.value, minimum: 0} : c.discounts.find(d => d.id === spec.ruleId);
    if (subtotal < rule.minimum) return 0;
    return rule.type === 'flat' ? Math.min(rule.value, subtotal) : Math.min(Math.round((subtotal * rule.value) / 100), subtotal);
  };
  const restock = () => {
    const key = rnd.pick(Object.keys(c.stock));
    const add = rnd.int(10, 30);
    saveStock(c, stockUsed(s), {stock: {[key]: c.stock[key] + add}});
    return key;
  };
  const choosePayment = total => {
    const roll = rnd.next();
    let method = roll < 0.4 ? 'Cash' : roll < 0.7 ? 'UPI' : roll < 0.9 ? 'Split' : 'Other';
    if (method === 'Split' && total < 200) method = 'Cash';
    let split = null;
    let cashReceived = null;
    if (method === 'Split') {
      const cashPart = rnd.chance(0.5) ? rnd.int(1, Math.floor((total - 1) / 100)) * 100 : rnd.int(1, total - 1);
      split = {Cash: cashPart, UPI: total - cashPart};
      if (rnd.chance(0.6)) cashReceived = Math.ceil(cashPart / 5000) * 5000;
    } else if (method === 'Cash' && rnd.chance(0.7)) {
      cashReceived = rnd.pick([total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, 50000 * Math.ceil(total / 50000)]);
    }
    return {method, split, cashReceived};
  };
  const writeModelOrder = (o, plan, lines) => {
    const bal = {Cash: 0, UPI: 0, Other: 0};
    model.orders.set(o.id, {
      status: o.status, total: o.total, subtotal: o.subtotal, discount: o.discount, method: o.method, bal,
      units: lines.reduce((n, l) => n + l.quantity, 0), stock: sumNeed(lines),
    });
    if (o.status === 'paid') {
      for (const [m, a] of planRows(plan, o.total)) {
        bal[m] += a;
        pay(m, a);
      }
    }
  };

  const placeOrder = () => {
    clearDraft(s);
    const menu = sellable();
    const lines = rnd.int(1, 3);
    for (let i = 0; i < lines; i++) {
      const p = rnd.pick(menu);
      const opts = {quantity: rnd.chance(0.7) ? 1 : rnd.int(2, 3)};
      if (p.customizable && !p.bundle) {
        if (rnd.chance(0.5)) opts.addons = c.addons.filter(() => rnd.chance(0.5)).map(a => a.id);
        if (rnd.chance(0.5)) opts.flavour = rnd.pick(c.flavours);
      }
      if (rnd.chance(0.1)) opts.note = 'no onion';
      const line = makeLine(c, p.id, opts);
      // Independent price check of the snapshot.
      const addonPrice = (opts.addons || []).reduce((n, id) => n + c.addons.find(a => a.id === id).price, 0);
      assert.equal(line.unitPrice, p.price + (p.bundle ? 0 : addonPrice), `line price for ${p.id}`);
      assert.deepEqual(line.stock, stockPer(p), `line stock snapshot for ${p.id}`);
      addToDraft(s, c, line);
    }
    // Discount: none, a rule, or a custom ₹ / % off.
    const roll = rnd.next();
    /** @type {any} */
    let spec = null;
    if (roll < 0.15) spec = {ruleId: 'reel-story'};
    else if (roll < 0.25) spec = {ruleId: 'friends-faculty'};
    else if (roll < 0.3) spec = {ruleId: 'festive-10'};
    else if (roll < 0.38) spec = {custom: true, type: 'flat', value: rnd.int(5, 30) * 100};
    else if (roll < 0.45) spec = {custom: true, type: 'percent', value: rnd.int(5, 50)};
    if (spec?.custom) stats.customDiscounts++;
    setDraftDiscount(s, c, spec);
    setDraftNote(s, rnd.pick(NOTES));
    const lineCopy = structuredClone(s.draft);
    const subtotal = lineCopy.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    const discount = expectDiscount(subtotal, spec);
    const t = draftTotals(s, c);
    assert.deepEqual([t.subtotal, t.discount, t.total], [subtotal, discount, subtotal - discount], 'cart totals');
    const total = subtotal - discount;

    const pending = rnd.chance(0.1);
    const plan = pending ? {method: rnd.pick(['Cash', 'UPI', 'Split', 'Other']), split: null, cashReceived: null} : choosePayment(total);
    const id = s.draftId;
    const input = {id, items: s.draft, discount: s.draftDiscount, note: s.draftNote, ...plan, pending};

    // Would the order oversell a pool? Then checkout must refuse and change nothing.
    const used = modelStockUsed();
    const need = sumNeed(lineCopy);
    const short = Object.entries(need).some(([k, n]) => n > c.stock[k] - (used[k] || 0));
    if (short) {
      stats.stockOuts++;
      rejects(() => createOrder(s, c, input, now), /Not enough stock/, 'oversell');
      if (rnd.chance(0.7)) restock();
      clearDraft(s);
      return;
    }
    // Adversarial payment details must be refused without side effects.
    if (!pending && plan.method === 'Cash' && total > 0 && rnd.chance(0.1)) {
      rejects(() => createOrder(s, c, {...input, cashReceived: total - 1}, now), /less than/, 'short cash');
    }
    if (!pending && plan.method === 'Split' && rnd.chance(0.1)) {
      rejects(() => createOrder(s, c, {...input, split: {Cash: plan.split.Cash, UPI: plan.split.UPI + 1}}, now), /add up/, 'bad split');
    }

    const expectedToken = upcomingToken(s, now);
    const o = createOrder(s, c, input, now);
    assert.equal(o.token, expectedToken, 'upcomingToken predicts the token checkout will assign');
    assert.equal(upcomingToken(s, now), o.token + 1);
    stats.orders++;
    if (pending) stats.pending++;
    if (plan.method === 'Split' && !pending) stats.splits++;
    // Tokens: daily IST sequence.
    const day = istDate(now);
    if (model.tokenDay !== day) {
      model.tokenDay = day;
      model.tokenSeq = 0;
    }
    model.tokenSeq++;
    assert.deepEqual([o.token, o.tokenDay, o.number], [model.tokenSeq, day, model.orders.size + 1], 'token & number');
    assert.deepEqual([o.subtotal, o.discount, o.total], [subtotal, discount, total], 'order totals');
    assert.equal(o.status, pending ? 'pending' : 'paid');
    assert.equal(o.kitchen, c.kitchenQueue ? 'preparing' : 'handed');
    if (!pending && plan.cashReceived !== null && plan.method !== 'UPI' && plan.method !== 'Other') {
      const due = plan.method === 'Split' ? plan.split.Cash : total;
      assert.deepEqual([o.cashReceived, o.change], [plan.cashReceived, plan.cashReceived - due], 'cash change');
    }
    assert.deepEqual([s.draft, s.draftDiscount, s.draftNote], [[], null, ''], 'draft cleared');
    model.lastOrderId = o.id;
    writeModelOrder(o, plan, lineCopy);
    // A double tap with the same id returns the same order and writes nothing.
    if (rnd.chance(0.05)) {
      const before = s.payments.length;
      assert.equal(createOrder(s, c, input, now), o);
      assert.equal(s.payments.length, before);
      stats.idempotent++;
    }
  };

  const confirmPending = () => {
    const list = s.orders.filter(o => o.status === 'pending');
    if (!list.length) return false;
    const o = rnd.pick(list);
    const plan = choosePayment(o.total);
    if (plan.method === 'Split' && o.total < 2) plan.method = 'Cash';
    markPaid(s, c, o.id, plan, now);
    const m = model.orders.get(o.id);
    m.status = 'paid';
    m.method = plan.method;
    for (const [k, a] of planRows(plan, o.total)) {
      m.bal[k] += a;
      pay(k, a);
    }
    assert.throws(() => markPaid(s, c, o.id, plan, now), /no longer pending/);
    stats.paidLater++;
    return true;
  };

  const refund = () => {
    const list = s.orders.filter(o => (o.status === 'paid' || o.status === 'partial') && netFor(s, o.id) > 0);
    if (!list.length) return false;
    const o = rnd.pick(list);
    const m = model.orders.get(o.id);
    const methods = METHODS3.filter(k => m.bal[k] > 0);
    const method = o.method === 'Split' ? rnd.pick(methods) : o.method;
    const available = m.bal[method];
    if (o.method === 'Split') {
      rejects(() => correctOrder(s, c, o.id, {type: 'refund', amount: 1, reason: 'x'}, now), /Cash or UPI/, 'split refund without method');
      const other = method === 'Cash' ? 'UPI' : 'Cash';
      rejects(() => correctOrder(s, c, o.id, {type: 'refund', amount: m.bal[other] + 1, method: other, reason: 'x'}, now), /can't be more/,
        'split over-refund of the other part');
    }
    const tooMuch = {type: 'refund', amount: available + 1, method, reason: 'too much'};
    rejects(() => correctOrder(s, c, o.id, tooMuch, now), /can't be more/, 'over-refund');
    rejects(() => correctOrder(s, c, o.id, {type: 'refund', amount: 1, method, reason: '   '}, now), /reason/, 'refund without reason');
    const amount = rnd.chance(0.4) ? available : rnd.int(1, available);
    const refundMethod = o.method === 'Split' ? method : rnd.pick([null, method]); // null → defaults to the order's method
    correctOrder(s, c, o.id, {type: 'refund', amount, method: refundMethod, reason: 'Customer unhappy'}, now);
    m.bal[method] -= amount;
    pay(method, -amount);
    m.status = net(m) === 0 ? 'refunded' : 'partial';
    stats.refunds++;
    if (o.method === 'Split') stats.splitRefunds++;
    return true;
  };

  const voidOrder = () => {
    const list = s.orders.filter(o => o.status !== 'void');
    if (!list.length) return false;
    const o = rnd.pick(list);
    const m = model.orders.get(o.id);
    if (o.status === 'pending') {
      rejects(() => correctOrder(s, c, o.id, {type: 'refund', amount: 100, reason: 'x'}, now), /Void it instead/, 'refund pending');
    }
    const rowsBefore = s.payments.length;
    correctOrder(s, c, o.id, {type: 'void', reason: 'Cancelled at counter'}, now);
    const reversals = METHODS3.filter(k => m.bal[k] > 0);
    assert.equal(s.payments.length - rowsBefore, reversals.length, 'one refund row per method with money left');
    for (const k of reversals) {
      pay(k, -m.bal[k]);
      m.bal[k] = 0;
    }
    m.status = 'void';
    rejects(() => correctOrder(s, c, o.id, {type: 'void', reason: 'again'}, now), /already void/, 'double void');
    rejects(() => setKitchen(s, c, o.id, 'ready', now), /cancelled/, 'kitchen on void');
    stats.voids++;
    return true;
  };

  const playGame = () => {
    const gameId = rnd.chance(0.6) ? ringToss : 'spin-the-wheel';
    const method = rnd.pick(METHODS3);
    const id = `play-${model.games.size + 1}`;
    const g = addGame(s, c, {id, gameId, prize: rnd.pick(['', 'Toffee', '=1+1 sticker']), method}, now);
    model.games.set(id, {fee: g.fee, void: false});
    if (g.fee > 0) pay(method, g.fee);
    model.lastGameId = id;
    assert.equal(addGame(s, c, {id, gameId, method}, now), g, 'game idempotent');
    stats.games++;
  };

  const reverseGame = () => {
    const list = s.games.filter(g => !g.void);
    if (!list.length) return false;
    const g = rnd.pick(list);
    voidGame(s, c, g.id, 'Prize dispute', now);
    const m = model.games.get(g.id);
    m.void = true;
    if (g.fee > 0) pay(g.method, -g.fee);
    if (model.lastGameId === g.id) {
      const live = s.games.filter(x => !x.void);
      model.lastGameId = live.length ? live.at(-1).id : null;
    }
    rejects(() => voidGame(s, c, g.id, 'again', now), /already reversed/, 'double game reversal');
    stats.gameVoids++;
    return true;
  };

  const spend = () => {
    // Sometimes a bill turns out to be a mistake: voiding it takes it out of every total.
    if (model.bills.size && rnd.chance(0.15)) {
      const [id, amount] = rnd.pick([...model.bills]);
      const e = voidExpense(s, c, id, 'Entered twice', now);
      model.bills.delete(id);
      model.expenses -= amount;
      if (e.category === 'restock') model.restock -= amount;
      rejects(() => voidExpense(s, c, id, 'again', now), /already voided/, 'double bill void');
      stats.expenses++;
      return;
    }
    const amount = rnd.int(1, 500) * 100 + (rnd.chance(0.2) ? rnd.int(1, 99) : 0);
    const id = `exp-${stats.expenses + 1}`;
    let restock;
    if (rnd.chance(0.5)) {
      // Phase-1 call shape (the current More › Expenses sheet): Ingredients → restock, Packaging → packaging, Helper → misc.
      const category = rnd.pick(['Ingredients', 'Packaging', 'Helper']);
      addExpense(s, c, {id, category, amount, description: rnd.pick(['', 'ice', '-cups'])}, now);
      restock = category === 'Ingredients';
    } else {
      const category = rnd.pick(['restock', 'pre-stall', 'misc']);
      addExpense(s, c, {id, title: rnd.pick(['Oil refill', '=SUM(A1)', '20L water cans & ice']), category, amount,
        method: rnd.pick(['Cash', 'UPI'])}, now);
      restock = category === 'restock';
    }
    assert.equal(addExpense(s, c, {id, category: 'Other', amount: 1}, now).amount, amount, 'expense idempotent');
    model.expenses += amount;
    if (restock) model.restock += amount;
    model.bills.set(id, amount);
    stats.expenses++;
  };

  const moveKitchen = () => {
    const list = s.orders.filter(o => o.status !== 'void' && o.status !== 'refunded');
    if (!list.length) return false;
    const o = rnd.pick(list);
    const status = rnd.pick(['preparing', 'ready', 'handed']);
    setKitchen(s, c, o.id, status, now);
    assert.equal(o.kitchen, status);
    assert.ok(o.kitchenAt[status], 'stage time recorded');
    stats.kitchen++;
    return true;
  };

  // ---- scripted prologue: milestone unlock → reversal → re-unlock keeps the first unlock time ------------------------
  const big = makeLine(c, 'combo-triple-dhamaka', {quantity: 8}); // ₹1,040
  addToDraft(s, c, big);
  const bigId = s.draftId;
  const bigOrder = createOrder(s, c, {id: bigId, items: s.draft, method: 'UPI'}, now);
  model.tokenDay = istDate(now);
  model.tokenSeq = 1;
  model.lastOrderId = bigId;
  writeModelOrder(bigOrder, {method: 'UPI'}, [big]);
  check('prologue: big order');
  const firstUnlock = now;
  assert.deepEqual([s.milestones['first-sale'].active, s.milestones['club-1000'].active], [true, true]);
  tick();
  correctOrder(s, c, bigId, {type: 'void', reason: 'Card machine test'}, now);
  model.orders.get(bigId).status = 'void';
  pay('UPI', -104000);
  model.orders.get(bigId).bal.UPI = 0;
  check('prologue: void reverses milestones');
  assert.deepEqual([s.milestones['first-sale'].active, s.milestones['club-1000'].active], [false, false]);
  assert.equal(s.milestones['club-1000'].unlockedAt, firstUnlock);
  tick();
  playGame();
  check('prologue: game');
  tick();
  reverseGame();
  check('prologue: game reversed');
  assert.equal(s.milestones['game-on'].active, false);
  assert.ok(s.milestones['game-on'].unlockedAt);

  // ---- the rush ----------------------------------------------------------------------------------------------------
  let step = 0;
  let resetDone = false;
  let soldOutDone = false;
  let queueOffDone = false;
  while (stats.orders < 200) {
    step++;
    tick();
    const label = `step ${step} @ ${now}`;
    // Scripted events at fixed points.
    if (!resetDone && stats.orders >= 40) {
      resetTokens(s, c, now);
      model.tokenSeq = 0;
      model.tokenDay = istDate(now);
      resetDone = true;
      check(`${label} (reset tokens)`);
      continue;
    }
    if (!soldOutDone && stats.orders >= 70) {
      clearDraft(s);
      addToDraft(s, c, makeLine(c, 'cola'));
      setSoldOut(c, 'cola', true);
      rejects(() => makeLine(c, 'combo-snack-fizz'), /sold out or missing/, 'combo with a sold-out part');
      rejects(() => createOrder(s, c, {id: s.draftId, items: s.draft, method: 'UPI'}, now), /sold out/, 'sold-out item in the cart');
      setSoldOut(c, 'cola', false);
      clearDraft(s);
      soldOutDone = true;
      check(`${label} (sold out)`);
      continue;
    }
    if (!queueOffDone && stats.orders >= 120) {
      setKitchenQueue(c, false);
      placeOrder();
      setKitchenQueue(c, true);
      queueOffDone = true;
      check(`${label} (queue off)`);
      continue;
    }
    const roll = rnd.next();
    if (roll < 0.62) placeOrder();
    else if (roll < 0.68) confirmPending() || placeOrder();
    else if (roll < 0.75) refund() || placeOrder();
    else if (roll < 0.79) voidOrder() || placeOrder();
    else if (roll < 0.86) playGame();
    else if (roll < 0.88) reverseGame() || playGame();
    else if (roll < 0.91) spend();
    else if (roll < 0.97) moveKitchen() || placeOrder();
    else restock();
    check(label);
  }
  // End with one unpaid order on the counter, so the final state holds every order status.
  tick();
  const last = c.products.find(p => !p.bundle && sellability(s, c, p).ok);
  const lastLine = makeLine(c, last.id);
  const lastOrder = createOrder(s, c, {id: 'last-unpaid', items: [lastLine], method: 'UPI', pending: true}, now);
  if (model.tokenDay !== istDate(now)) {
    model.tokenDay = istDate(now);
    model.tokenSeq = 0;
  }
  model.tokenSeq++;
  assert.equal(lastOrder.token, model.tokenSeq);
  model.lastOrderId = lastOrder.id;
  writeModelOrder(lastOrder, {method: 'UPI'}, [lastLine]);
  check('final pending order');
  // Practice ledger: evaluate its milestones too, so a restored backup is byte-for-byte the same state.
  refreshMilestones(st.demo, c, now);
  return {st, c, s, stats, model, rnd};
}

test('seeded rush: ~200 orders across IST midnight keep every ledger invariant after every step', () => {
  const {st, c, s, stats, model} = runRush(20261104);

  // The simulation really exercised every path.
  for (const key of ['pending', 'paidLater', 'refunds', 'splitRefunds', 'voids', 'games', 'gameVoids', 'expenses', 'rejected', 'stockOuts',
    'splits', 'customDiscounts', 'kitchen', 'idempotent']) {
    assert.ok(stats[key] > 0, `the rush exercised ${key}`);
  }
  assert.equal(stats.orders, 200);
  assert.equal(s.orders.length, 202, '200 rush orders + the prologue order + the final unpaid order');
  const statuses = new Set(s.orders.map(o => o.status));
  for (const status of ['paid', 'partial', 'refunded', 'void', 'pending']) assert.ok(statuses.has(status), `has a ${status} order`);
  const methods = new Set(s.orders.map(o => o.method));
  for (const method of ['Cash', 'UPI', 'Split', 'Other']) assert.ok(methods.has(method), `has a ${method} order`);
  assert.ok(s.orders.some(o => o.items.some(l => l.bundle)), 'combos were sold');
  assert.ok(s.orders.some(o => o.discountInfo?.id === null), 'custom discounts were used');

  // Token sequence: resets at IST midnight (and on resetTokens), consecutive within each run.
  const days = [...new Set(s.orders.map(o => o.tokenDay))];
  assert.deepEqual(days, ['2026-11-04', '2026-11-05'], 'the rush crossed IST midnight');
  const day2 = s.orders.filter(o => o.tokenDay === '2026-11-05');
  assert.ok(day2.length > 10);
  assert.deepEqual(day2.map(o => o.token), day2.map((_, i) => i + 1), 'day 2 tokens restart at #01 and run consecutively');
  assert.ok(Date.parse(day2[0].at) >= Date.parse('2026-11-04T18:30:00.000Z'));
  const lastDay1 = s.orders.filter(o => o.tokenDay === '2026-11-04').at(-1);
  assert.ok(Date.parse(lastDay1.at) < Date.parse('2026-11-04T18:30:00.000Z'));
  assert.deepEqual(s.orders.map(o => o.number), s.orders.map((_, i) => i + 1), 'order numbers never reset');

  // Day-scoped reports partition the whole session.
  const all = report(s, c);
  const parts = days.map(day => report(s, c, {day}));
  const sum = key => parts.reduce((n, r) => n + r[key], 0);
  for (const key of ['collected', 'food', 'gameIncome', 'orders', 'units', 'gross', 'discounts', 'refunds', 'games', 'expenses']) {
    assert.equal(sum(key), all[key], `day reports add up: ${key}`);
  }
  for (const k of METHODS3) assert.equal(parts.reduce((n, r) => n + r.methods[k], 0), all.methods[k]);
  for (const r of parts) assert.deepEqual(r.mission, all.mission, 'mission block is whole-session in day scope');
  const hourly = Object.values(all.hourly).reduce((n, v) => n + v, 0);
  assert.equal(hourly, all.collected, 'hourly buckets add up to collected');
  const hourKeys = Object.keys(all.hourly);
  assert.ok(hourKeys.includes('23') && hourKeys.includes('00'), 'hourly spans IST midnight');

  // Exports agree with the ledger.
  const payRows = paymentsCsvRows(s);
  assert.equal(payRows.length - 1, s.payments.length);
  assert.equal(payRows.slice(1).reduce((n, row) => n + Math.round(Number(row[5]) * 100), 0), all.collected);
  const summary = orderSummaryCsvRows(s);
  const netCol = summary[0].indexOf('Net collected');
  assert.equal(summary.slice(1).reduce((n, row) => n + Math.round(Number(row[netCol]) * 100), 0), all.food);
  assert.equal(ordersCsvRows(s).length - 1, s.orders.reduce((n, o) => n + o.items.length, 0));
  const text = csv(summary);
  assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'formula notes are neutralised');
  assert.ok(text.includes(`"'+91 98765 43210 call when ready"`));
  assert.ok(!/(^|,)"[=+@]/m.test(text.replace(/^﻿/, '')), 'no cell starts with a formula character');
  for (const day of days) {
    const r = report(s, c, {day});
    const t = dayReportText(s, c, {day});
    assert.ok(t.includes(`💰 Collected: ${money(r.collected)}`), day);
  }
  assert.match(upiUri(c, all.pending.amount || 100, 'Token #07'),
    /^upi:\/\/pay\?pa=rush\.stall%40okicici&pn=My%20Awesome%20Stall&am=\d+\.\d\d&cu=INR&tn=Token%20%2307$/);

  // Break-even reached, then a big extra expense raises the target: profit mode and recovery milestones reverse.
  assert.equal(all.mission.profitMode, true, 'the rush recovered the investment');
  assert.equal(s.milestones['break-even-boss'].active, true);
  const unlockedAt = s.milestones['break-even-boss'].unlockedAt;
  addExpense(s, c, {id: 'exp-big', category: 'Other', amount: all.collected, description: 'Generator hire'}, '2026-11-04T21:00:00.000Z');
  const after = report(s, c);
  assert.equal(after.mission.target, all.mission.target + all.collected);
  assert.equal(after.mission.profitMode, false);
  assert.equal(after.mission.remaining, after.mission.target - after.collected);
  assert.equal(s.milestones['break-even-boss'].active, false);
  assert.equal(s.milestones['break-even-boss'].unlockedAt, unlockedAt, 'the first unlock time is kept');
  assert.equal(s.milestones['halfway-there'].active, after.collected * 100 >= 50 * after.mission.target);
  assert.ok(model.everDeactivated.has('first-sale') && model.everDeactivated.has('game-on'), 'milestones reversed during the rush');
});

test('seeded rush: the final state round-trips through a backup and 20 tampered copies are rejected', () => {
  const {st} = runRush(7);
  const backup = JSON.parse(JSON.stringify(exportBackup(st, {})));
  const restored = validateBackup(backup);
  assert.deepEqual(restored.state, st, 'the restored state is identical');
  assert.deepEqual(restored.warnings, []);

  const s = st.live;
  const paidCash = s.orders.find(o => o.status === 'paid' && o.method === 'Cash' && o.total > 0);
  const paidSplit = s.orders.find(o => o.status === 'paid' && o.method === 'Split');
  const partial = s.orders.find(o => o.status === 'partial');
  const pending = s.orders.find(o => o.status === 'pending');
  const paidGame = s.games.find(g => !g.void && g.fee > 0);
  const refundRow = s.payments.find(p => p.kind === 'refund');
  assert.ok(paidCash && paidSplit && partial && pending && paidGame && refundRow, 'the rush produced every record kind needed');
  const idx = id => s.orders.findIndex(o => o.id === id);
  const rowsOf = id => s.payments.map((p, i) => [p, i]).filter(([p]) => p.entityId === id).map(([, i]) => i);

  /** @type {[string, (b: any) => void][]} */
  const tampers = [
    ['paid order payment inflated', b => { b.state.live.payments[rowsOf(paidCash.id)[0]].amount += 100; }],
    ['paid order payment deleted', b => { b.state.live.payments.splice(rowsOf(paidCash.id)[0], 1); }],
    ['payment duplicated with a new id', b => {
      const p = b.state.live.payments[rowsOf(paidCash.id)[0]];
      b.state.live.payments.push({...p, id: 'dup-row'});
    }],
    ['payment duplicated with the same id', b => { b.state.live.payments.push({...b.state.live.payments[0]}); }],
    ['payment method switched', b => { b.state.live.payments[rowsOf(paidCash.id)[0]].method = 'UPI'; }],
    ['order total edited', b => { b.state.live.orders[idx(paidCash.id)].total += 1000; }],
    ['line price edited', b => { b.state.live.orders[idx(paidCash.id)].items[0].unitPrice += 100; }],
    ['discount larger than the subtotal', b => {
      const o = b.state.live.orders[idx(paidCash.id)];
      o.discount = o.subtotal + 100;
      o.total = -100;
    }],
    ['paid order marked refunded', b => { b.state.live.orders[idx(paidCash.id)].status = 'refunded'; }],
    ['partial order marked paid', b => { b.state.live.orders[idx(partial.id)].status = 'paid'; }],
    ['pending order given a payment', b => {
      const row = {id: 'sneaky', entityId: pending.id, kind: 'order', amount: pending.total || 100, method: 'Cash', at: pending.at};
      b.state.live.payments.push(row);
    }],
    ['split parts edited', b => {
      const o = b.state.live.orders[idx(paidSplit.id)];
      o.split = {Cash: o.split.Cash + 1, UPI: o.split.UPI - 1};
    }],
    ['refund larger than collected', b => { b.state.live.payments[s.payments.indexOf(refundRow)].amount -= 1_000_000; }],
    ['refund with a positive amount', b => {
      const p = b.state.live.payments[s.payments.indexOf(refundRow)];
      p.amount = -p.amount;
    }],
    ['payment for an unknown entity', b => { b.state.live.payments[0].entityId = 'ghost-order'; }],
    ['game fee edited', b => { b.state.live.games[s.games.indexOf(paidGame)].fee += 500; }],
    ['unknown payment method', b => { b.state.live.orders[idx(paidCash.id)].method = 'Bitcoin'; }],
    ['negative product price', b => { b.state.config.products[0].price = -100; }],
    ['product in a missing category', b => { b.state.config.products[0].categoryId = 'nowhere'; }],
    ['bad media data URL', b => { b.media = {photo: 'data:text/html;base64,PHNjcmlwdD4='}; }],
    ['unsupported backup version', b => { b.version = 3; }],
    ['token day garbage', b => { b.state.live.orders[0].tokenDay = 'tomorrow'; }],
    ['unknown kitchen status', b => { b.state.live.orders[0].kitchen = 'cooking'; }],
    ['fractional paise', b => { b.state.live.expenses[0].amount = 10.5; }],
  ];
  assert.ok(tampers.length >= 20);
  for (const [name, tamper] of tampers) {
    const copy = structuredClone(backup);
    tamper(copy);
    assert.throws(() => validateBackup(copy), /^Error: Backup rejected: /, name);
  }
  // The untampered backup is still fine (validateBackup never mutates its input).
  assert.deepEqual(validateBackup(backup).state, st);
});
