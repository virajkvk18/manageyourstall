// Unit tests for dist/domain.mjs — the ledger & reports (ARCHITECTURE.md §2, §3, §13.4).
// Configs are built by hand (makeConfig) so these tests never depend on template contents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  uuid, paise, money, initialState, session, migrate, applyTemplate, productById, sellability, unitPrice, stockUsed, stockLeft,
  makeLine, addToDraft, setLineQuantity, removeLine, clearDraft, setDraftDiscount, setDraftNote, resolveDiscount, totals, draftTotals,
  createOrder, markPaid, correctOrder, methodBalances, netFor, setKitchen, kitchenQueue, resetTokens, addGame, voidGame, addExpense,
  report, refreshMilestones, milestoneProgress, upiUri, dayReportText, ordersCsvRows, orderSummaryCsvRows, paymentsCsvRows, csv,
  exportBackup, validateBackup,
} from '../dist/domain.mjs';
import {validateConfig} from '../dist/catalog.mjs';


const T0 = '2026-11-04T10:00:00.000Z'; // 15:30 IST, 4 Nov
const at = (minutes, base = T0) => new Date(Date.parse(base) + minutes * 60000).toISOString();
const V1_FIXTURE = new URL('./fixtures/v1-state.json', import.meta.url);

/** A complete product with §2 defaults. */
function P(id, name, categoryId, price, extra = {}) {
  return {
    id, name, subtitle: '', categoryId, size: '', price, priceLocked: false, art: 'chips-packet', image: null, tint: 'yellow',
    pattern: 'none', tags: [], active: true, soldOut: false, customizable: false, stockKey: '', stockUnits: 1, bundle: null, ...extra,
  };
}

/** A valid §2 config: 3 categories, sized variants, a customizable item, a combo, shared pools, 2 games, 3 discounts, itemized mission. */
function makeConfig() {
  return {
    schema: 2,
    templateId: 'legacy',
    profile: {
      stallName: 'Packet Pataka', booth: 'Stall No. 10', tagline: 'Little packets. Big energy.', subTagline: 'Fast orders.',
      eventName: 'Diwali Mela', venue: 'Main Ground', city: 'Jabalpur', eventDate: '2026-11-04', ownerName: 'Team Pataka', initials: '',
    },
    theme: {accent: '#FFDD35'},
    upi: {id: '', payeeName: ''},
    operator: 'Team Pataka',
    operators: ['Team Pataka', 'Cashier 1'],
    kitchenQueue: true,
    allowCustomDiscount: true,
    inventory: false,
    stock: {small: 100, large: 100, soda: 100, pizza: 20},
    categories: [{id: 'snacks', name: 'Crispy Snacks'}, {id: 'drinks', name: 'Drinks'}, {id: 'combos', name: 'Combos'}],
    products: [
      P('packet-small', 'Cheese Packet · Small', 'snacks', 3000, {size: 'Small', stockKey: 'small', customizable: true}),
      P('packet-large', 'Cheese Packet · Large', 'snacks', 5000, {size: 'Large', stockKey: 'large', customizable: true}),
      P('corn-small', 'Corn Packet · Small', 'snacks', 3000, {size: 'Small', stockKey: 'small'}),
      P('corn-large', 'Corn Packet · Large', 'snacks', 5000, {size: 'Large', stockKey: 'large'}),
      P('pizza', 'Cheese Pizza', 'snacks', 6000, {stockKey: 'pizza', stockUnits: 2, art: 'cheese-pizza'}),
      P('lemon-soda', 'Lemon Soda', 'drinks', 2000, {stockKey: 'soda', art: 'lemon-fizz', tags: ['CHILLED']}),
      P('cola', 'Cola', 'drinks', 2000, {stockKey: 'soda', art: 'cola-can'}),
      P('chai', 'Masala Chai', 'drinks', 1500, {art: 'masala-chai'}),
      P('mystery', 'Mystery Snack', 'snacks', null),
      P('secret', 'Secret Item', 'snacks', 1000, {active: false}),
      P('combo-packet-soda', 'Packet + Soda Combo', 'combos', 4500, {
        art: 'combo-snack-drink', tags: ['COMBO'], bundle: [{productId: 'packet-small', quantity: 1}, {productId: 'lemon-soda', quantity: 1}],
      }),
    ],
    addons: [{id: 'cheese', name: 'Cheese Sauce', price: 1000}, {id: 'corn', name: 'Sweet Corn', price: 1000}],
    flavours: ['Classic Salted', 'Magic Masala'],
    games: [{id: 'wheel', name: 'Spin the Wheel', fee: 0, art: 'spin-wheel'}, {id: 'ring', name: 'Ring Toss', fee: 2000, art: 'ring-toss'}],
    discounts: [
      {id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1000, minimum: 0, active: true},
      {id: 'festive', label: 'Festive 10% off', type: 'percent', value: 10, minimum: 20000, active: true},
      {id: 'staff', label: 'Staff ₹20 off', type: 'flat', value: 2000, minimum: 0, active: false},
    ],
    mission: {
      mode: 'itemized', total: 0,
      items: [{id: 'rent', label: 'Stall rent', amount: 200000}, {id: 'raw', label: 'Raw materials', amount: 250000}, {id: 'banner', label: 'Banner & decor', amount: 64000}],
    },
    milestones: [
      {id: 'first', title: 'First sale', type: 'orders', target: 1},
      {id: 'crowd', title: 'Crowd magnet', type: 'orders', target: 50},
      {id: 'club', title: '₹1,000 Club', type: 'revenue', target: 100000},
      {id: 'half', title: 'Halfway there', type: 'recovery', target: 50},
      {id: 'big', title: 'Break-even boss', type: 'recovery', target: 100},
      {id: 'items', title: 'Ten items', type: 'items', target: 10},
      {id: 'gameon', title: 'Game on', type: 'games', target: 1},
    ],
  };
}

function setup() {
  const st = {version: 2, revision: 0, mode: 'live', onboarded: true, pin: null, config: makeConfig(), live: session(), demo: session()};
  return {st, c: st.config, s: st.live};
}

/** Checkout helper: one small corn packet (₹30) paid in cash unless overridden. */
const sale = (s, c, options = {}, now = T0) =>
  createOrder(s, c, {id: uuid(), ...options, items: options.items || [makeLine(c, 'corn-small')]}, now);
/** A loose line with an arbitrary price (for discount arithmetic). */
const priced = (unitPriceP, quantity = 1) => ({...makeLine(makeConfig(), 'chai'), unitPrice: unitPriceP, quantity, lineTotal: unitPriceP * quantity});

// ---------------------------------------------------------------------------------------------------------------------
// Setup & money basics
// ---------------------------------------------------------------------------------------------------------------------

test('the hand-built test config is valid per validateConfig', () => {
  assert.doesNotThrow(() => validateConfig(makeConfig()));
});

test('exact paise conversion rejects negatives and excess decimals', () => {
  assert.equal(paise('30.10'), 3010);
  assert.equal(paise('₹1,234.5'), 123450);
  for (const v of ['-1', '1.001', 'abc', 'Infinity', '']) assert.throws(() => paise(v));
});

test('initialState is a fresh v2 install with default profile and empty ledgers', () => {
  const st = initialState();
  assert.equal(st.version, 2);
  assert.equal(st.mode, 'live');
  assert.equal(st.onboarded, false);
  assert.equal(st.pin, null);
  assert.equal(st.config.schema, 2);
  assert.equal(st.config.profile.stallName, 'My Awesome Stall');
  assert.equal(st.config.profile.booth, 'Stall No. 1');
  assert.equal(st.config.profile.eventName, 'College Fest');
  assert.deepEqual(st.config.operators, ['Team Stall', 'Cashier 1', 'Cashier 2']);
  assert.equal(st.config.operator, 'Team Stall');
  assert.deepEqual(st.config.upi, {id: '', payeeName: ''});
  assert.ok(Array.isArray(st.config.products));
  for (const s of [st.live, st.demo]) {
    assert.deepEqual(s.orders, []);
    assert.equal(s.draftDiscount, null);
    assert.equal(s.draftNote, '');
    assert.equal(s.tokenDay, null);
    assert.equal(s.tokenSeq, 0);
    assert.match(s.draftId, /^[0-9a-f-]{36}$/);
  }
  assert.notEqual(st.live.draftId, st.demo.draftId);
});

// ---------------------------------------------------------------------------------------------------------------------
// Lines, cart & pricing
// ---------------------------------------------------------------------------------------------------------------------

test('two add-ons multiplied by quantity', () => {
  const {c} = setup();
  const l = makeLine(c, 'packet-small', {addons: ['corn', 'cheese'], quantity: 2});
  assert.equal(l.unitPrice, 5000);
  assert.equal(l.lineTotal, 10000);
  assert.deepEqual(l.addons.map(a => a.id), ['cheese', 'corn']); // config order, deduplicated
  assert.equal(l.category, 'Crispy Snacks');
  assert.deepEqual(l.stock, {small: 1});
  assert.equal(unitPrice(productById(c, 'packet-small'), c, ['cheese', 'cheese']), 4000);
});

test('add-ons and flavours are validated against the config', () => {
  const {c} = setup();
  assert.throws(() => makeLine(c, 'corn-small', {addons: ['cheese']}), /add-ons/);
  assert.throws(() => makeLine(c, 'packet-small', {addons: ['ghost']}), /add-on/);
  assert.throws(() => makeLine(c, 'packet-small', {flavour: 'Durian'}), /flavour/);
  assert.equal(makeLine(c, 'packet-small', {flavour: 'Magic Masala'}).flavour, 'Magic Masala');
  for (const q of [0, 1000, 1.5, -1]) assert.throws(() => makeLine(c, 'chai', {quantity: q}));
  assert.equal(unitPrice(productById(c, 'mystery'), c), null);
});

test('different extras remain separate snapshots', () => {
  const {c, s} = setup();
  const o = sale(s, c, {items: [makeLine(c, 'packet-small', {addons: ['cheese']}), makeLine(c, 'packet-small', {addons: ['corn']})]});
  assert.equal(o.items.length, 2);
  assert.notDeepEqual(o.items[0].addons, o.items[1].addons);
});

test('addToDraft merges identical lines only', () => {
  const {c, s} = setup();
  const a = addToDraft(s, c, makeLine(c, 'packet-small', {addons: ['cheese', 'corn'], flavour: 'Magic Masala'}));
  const b = addToDraft(s, c, makeLine(c, 'packet-small', {addons: ['corn', 'cheese'], flavour: 'Magic Masala', quantity: 2}));
  assert.equal(a, b);
  assert.equal(s.draft.length, 1);
  assert.equal(s.draft[0].quantity, 3);
  assert.equal(s.draft[0].lineTotal, 15000);
  addToDraft(s, c, makeLine(c, 'packet-small', {addons: ['cheese', 'corn'], flavour: 'Classic Salted'})); // other flavour
  addToDraft(s, c, makeLine(c, 'packet-small', {addons: ['cheese'], flavour: 'Magic Masala'})); // other add-ons
  addToDraft(s, c, makeLine(c, 'packet-small', {addons: ['cheese', 'corn'], flavour: 'Magic Masala', note: 'no salt'})); // other note
  assert.equal(s.draft.length, 4);
  const big = makeLine(c, 'packet-small', {addons: ['cheese', 'corn'], flavour: 'Magic Masala', quantity: 997});
  assert.throws(() => addToDraft(s, c, big), /999/);
  assert.equal(s.draft[0].quantity, 3);
});

test('setLineQuantity, removeLine and clearDraft', () => {
  const {c, s} = setup();
  const l = addToDraft(s, c, makeLine(c, 'corn-small', {quantity: 3}));
  const keep = addToDraft(s, c, makeLine(c, 'chai'));
  setLineQuantity(s, l.id, 1);
  assert.equal(s.draft[0].quantity, 1);
  assert.equal(s.draft[0].lineTotal, 3000);
  assert.equal(totals(s.draft).total, 4500);
  assert.throws(() => setLineQuantity(s, l.id, 1000), /999/);
  assert.throws(() => setLineQuantity(s, l.id, -1));
  assert.throws(() => setLineQuantity(s, 'missing', 2), /no longer in the cart/);
  setLineQuantity(s, l.id, 0);
  assert.deepEqual(s.draft.map(x => x.id), [keep.id]);
  removeLine(s, keep.id);
  removeLine(s, keep.id); // already gone: no-op
  assert.equal(s.draft.length, 0);
  addToDraft(s, c, makeLine(c, 'chai'));
  setDraftDiscount(s, c, {ruleId: 'reel'});
  setDraftNote(s, 'table 4');
  const before = s.draftId;
  clearDraft(s);
  assert.deepEqual([s.draft, s.draftDiscount, s.draftNote], [[], null, '']);
  assert.notEqual(s.draftId, before);
});

test('notes: trimmed, limited to 200 characters, kept on lines and orders', () => {
  const {c, s} = setup();
  setDraftNote(s, '  extra spicy, no onion  ');
  assert.equal(s.draftNote, 'extra spicy, no onion');
  assert.throws(() => setDraftNote(s, 'x'.repeat(201)), /200/);
  assert.throws(() => makeLine(c, 'chai', {note: 'x'.repeat(201)}), /200/);
  const line = makeLine(c, 'chai', {note: ' less sugar '});
  assert.equal(line.note, 'less sugar');
  const o = createOrder(s, c, {id: uuid(), items: [line], note: s.draftNote}, T0);
  assert.equal(o.note, 'extra spicy, no onion');
  assert.equal(o.items[0].note, 'less sugar');
  assert.equal(s.draftNote, '', 'checkout clears the draft note');
});

test('empty order is blocked', () => {
  const {s, c} = setup();
  assert.equal(totals([], resolveDiscount(c, {ruleId: 'reel'})).total, 0);
  assert.throws(() => sale(s, c, {items: []}), /Add an item/);
  assert.equal(s.payments.length, 0);
});

test('sold-out, hidden and unpriced items are blocked', () => {
  const {c, s} = setup();
  assert.throws(() => makeLine(c, 'mystery'), /Set a price/);
  assert.throws(() => makeLine(c, 'secret'), /hidden/);
  assert.throws(() => makeLine(c, 'ghost'), /no longer on the menu/);
  const l = makeLine(c, 'corn-small');
  productById(c, 'corn-small').soldOut = true;
  assert.throws(() => makeLine(c, 'corn-small'), /sold out/);
  assert.throws(() => sale(s, c, {items: [l]}), /sold out/);
  const combo = makeLine(c, 'combo-packet-soda');
  productById(c, 'lemon-soda').soldOut = true;
  assert.throws(() => makeLine(c, 'combo-packet-soda'), /combo/);
  assert.throws(() => sale(s, c, {items: [combo]}), /combo/);
  assert.equal(s.orders.length, 0);
});

test('sellability reports the reason and stock left', () => {
  const {c, s} = setup();
  const reason = id => sellability(s, c, productById(c, id)).reason;
  assert.deepEqual(sellability(s, c, productById(c, 'corn-small')), {ok: true, reason: '', left: null});
  assert.equal(reason('secret'), 'hidden');
  assert.equal(reason('mystery'), 'unpriced');
  productById(c, 'cola').soldOut = true;
  assert.equal(reason('cola'), 'soldout');
  assert.equal(stockLeft(s, c, 'small'), null, 'untracked while inventory is off');
  c.inventory = true;
  c.stock.small = 1;
  c.stock.pizza = 3;
  assert.equal(stockLeft(s, c, ''), null);
  assert.deepEqual(sellability(s, c, productById(c, 'corn-small')), {ok: true, reason: '', left: 1});
  assert.deepEqual(sellability(s, c, productById(c, 'combo-packet-soda')), {ok: true, reason: '', left: 1});
  assert.deepEqual(sellability(s, c, productById(c, 'chai')), {ok: true, reason: '', left: null});
  sale(s, c, {items: [makeLine(c, 'pizza')]}); // pizza uses 2 units per item
  assert.deepEqual(sellability(s, c, productById(c, 'pizza')), {ok: false, reason: 'stock', left: 1});
  sale(s, c);
  assert.deepEqual(sellability(s, c, productById(c, 'packet-small')), {ok: false, reason: 'stock', left: 0});
  assert.equal(reason('combo-packet-soda'), 'stock');
  c.stock.small = 5;
  productById(c, 'lemon-soda').soldOut = true;
  assert.equal(reason('combo-packet-soda'), 'component');
});

// ---------------------------------------------------------------------------------------------------------------------
// Discounts & totals
// ---------------------------------------------------------------------------------------------------------------------

test('discount applies once per order and is capped at the subtotal', () => {
  const {c} = setup();
  const reel = resolveDiscount(c, {ruleId: 'reel'});
  assert.deepEqual(reel, {id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1000, minimum: 0});
  const t = totals([makeLine(c, 'corn-small', {quantity: 2}), makeLine(c, 'chai')], reel);
  assert.deepEqual(t, {subtotal: 7500, discount: 1000, total: 6500, discountInfo: {id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1000}, minimumShort: 0});
  const tiny = totals([priced(300)], reel);
  assert.equal(tiny.discount, 300);
  assert.equal(tiny.total, 0);
});

test('percent discounts round to the nearest paise and respect the minimum', () => {
  const {c} = setup();
  const festive = resolveDiscount(c, {ruleId: 'festive'});
  assert.equal(totals([priced(20005)], festive).discount, 2001); // 2000.5 → 2001
  assert.equal(totals([priced(20004)], festive).discount, 2000); // 2000.4 → 2000
  assert.equal(totals([priced(33333, 3)], festive).discount, 10000); // 9999.9 → 10000
  const short = totals([priced(15000)], festive);
  assert.deepEqual([short.discount, short.total, short.minimumShort, short.discountInfo], [0, 15000, 5000, null]);
  const exact = totals([priced(20000)], festive);
  assert.deepEqual([exact.discount, exact.minimumShort], [2000, 0]);
});

test('custom ₹/% discounts: labels, caps and the allowCustomDiscount switch', () => {
  const {c, s} = setup();
  assert.equal(resolveDiscount(c, {custom: true, type: 'flat', value: 2000}).label, 'Custom ₹20 off');
  assert.equal(resolveDiscount(c, {custom: true, type: 'flat', value: 1250}).label, 'Custom ₹12.50 off');
  const pct = resolveDiscount(c, {custom: true, type: 'percent', value: 10});
  assert.deepEqual(pct, {id: null, label: 'Custom 10% off', type: 'percent', value: 10, minimum: 0});
  assert.equal(totals([priced(3000)], resolveDiscount(c, {custom: true, type: 'flat', value: 99999})).total, 0);
  assert.equal(totals([priced(3000)], resolveDiscount(c, {custom: true, type: 'percent', value: 100})).discount, 3000);
  setDraftDiscount(s, c, {custom: true, type: 'percent', value: 10});
  assert.deepEqual(s.draftDiscount, {custom: true, type: 'percent', value: 10});
  for (const bad of [{custom: true, type: 'percent', value: 0}, {custom: true, type: 'percent', value: 101}, {custom: true, type: 'percent', value: 1.5},
    {custom: true, type: 'flat', value: 0}, {custom: true, type: 'bogus', value: 5}]) {
    assert.throws(() => setDraftDiscount(s, c, bad));
    assert.equal(resolveDiscount(c, bad), null);
  }
  c.allowCustomDiscount = false;
  assert.equal(resolveDiscount(c, {custom: true, type: 'flat', value: 2000}), null);
  assert.throws(() => setDraftDiscount(s, c, {custom: true, type: 'flat', value: 2000}), /turned off/);
  assert.throws(() => createOrder(s, c, {id: uuid(), items: [makeLine(c, 'chai')], discount: {custom: true, type: 'flat', value: 100}}, T0), /turned off/);
});

test('inactive or missing rules resolve to null and cannot be chosen', () => {
  const {c, s} = setup();
  assert.equal(resolveDiscount(c, {ruleId: 'staff'}), null);
  assert.equal(resolveDiscount(c, {ruleId: 'ghost'}), null);
  assert.equal(resolveDiscount(c, null), null);
  assert.throws(() => setDraftDiscount(s, c, {ruleId: 'staff'}), /not available/);
  assert.throws(() => setDraftDiscount(s, c, {ruleId: 'ghost'}), /not available/);
  setDraftDiscount(s, c, {ruleId: 'reel'});
  assert.deepEqual(s.draftDiscount, {ruleId: 'reel'});
  addToDraft(s, c, makeLine(c, 'corn-small'));
  assert.equal(draftTotals(s, c).total, 2000);
  setDraftDiscount(s, c, null);
  assert.equal(s.draftDiscount, null);
  assert.equal(draftTotals(s, c).total, 3000);
});

test("the brief's ₹160 order: promo once, five items, UPI", () => {
  const {c, s} = setup();
  const items = [
    makeLine(c, 'packet-small', {quantity: 2, addons: ['cheese']}), // 2 × ₹40 = ₹80
    makeLine(c, 'corn-large'), // ₹50
    makeLine(c, 'lemon-soda', {quantity: 2}), // ₹40
  ];
  const o = createOrder(s, c, {id: uuid(), items, discount: {ruleId: 'reel'}, method: 'UPI'}, T0);
  assert.deepEqual([o.subtotal, o.discount, o.total], [17000, 1000, 16000]);
  assert.deepEqual(o.discountInfo, {id: 'reel', label: 'Reel story? ₹10 off', type: 'flat', value: 1000});
  const r = report(s, c);
  assert.equal(r.methods.UPI, 16000);
  assert.equal(r.collected, 16000);
  assert.equal(r.units, 5);
  assert.equal(r.discounts, 1000);
  assert.equal(r.gross, 17000);
  assert.deepEqual(r.discountUses, {'Reel story? ₹10 off': {count: 1, amount: 1000}});
  assert.equal(r.mission.remaining, 498000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Orders, payments, corrections
// ---------------------------------------------------------------------------------------------------------------------

test('a sale writes order, payment and audit locally and clears the draft', () => {
  const {c, s} = setup();
  addToDraft(s, c, makeLine(c, 'corn-small'));
  setDraftDiscount(s, c, {ruleId: 'reel'});
  const id = s.draftId;
  const o = createOrder(s, c, {id, items: s.draft, discount: s.draftDiscount}, T0);
  assert.deepEqual([o.number, o.status, o.method, o.total, o.operator, o.at], [1, 'paid', 'Cash', 2000, 'Team Pataka', T0]);
  assert.deepEqual(s.payments.map(p => [p.entityId, p.kind, p.amount, p.method]), [[id, 'order', 2000, 'Cash']]);
  assert.equal(s.audit.at(-1).type, 'order-created');
  assert.deepEqual([s.draft, s.draftDiscount], [[], null]);
  assert.notEqual(s.draftId, id);
  assert.equal(report(s, c).collected, 2000);
});

test('combo priced once, component stock consumed correctly', () => {
  const {c, s} = setup();
  c.inventory = true;
  c.stock.small = 2;
  c.stock.soda = 1;
  const l = makeLine(c, 'combo-packet-soda');
  assert.deepEqual(l.stock, {small: 1, soda: 1});
  assert.equal(l.unitPrice, 4500);
  sale(s, c, {items: [l]});
  assert.deepEqual(stockUsed(s), {small: 1, soda: 1});
  assert.equal(report(s, c).collected, 4500);
  assert.equal(report(s, c).units, 1, 'a combo line counts once');
  assert.throws(() => sale(s, c, {items: [l]}), /Not enough stock/);
});

test('idempotency protects double-taps and retries', () => {
  const {c, s} = setup();
  const id = uuid();
  const first = sale(s, c, {id});
  assert.equal(sale(s, c, {id}), first);
  assert.equal(s.orders.length, 1);
  assert.equal(s.payments.length, 1);
  assert.throws(() => sale(s, c, {id: 'bad id!'}), /order id/);
});

test('pending orders count only after confirmation', () => {
  const {c, s} = setup();
  const o = sale(s, c, {method: 'UPI', pending: true});
  assert.equal(o.status, 'pending');
  assert.equal(s.payments.length, 0);
  let r = report(s, c);
  assert.deepEqual([r.collected, r.orders, r.pending.count, r.pending.amount], [0, 0, 1, 3000]);
  markPaid(s, c, o.id, {method: 'UPI'}, at(5));
  r = report(s, c);
  assert.deepEqual([r.methods.UPI, r.orders, r.pending.count], [3000, 1, 0]);
  assert.equal(s.audit.at(-1).type, 'payment-confirmed');
  assert.throws(() => markPaid(s, c, o.id, {method: 'UPI'}), /no longer pending/);
  assert.equal(report(s, c).collected, 3000);
});

test('full refund deducts the method and reverses the first-sale milestone', () => {
  const {c, s} = setup();
  const o = sale(s, c, {method: 'UPI'});
  assert.equal(s.milestones.first.active, true);
  correctOrder(s, c, o.id, {type: 'refund', amount: 3000, reason: 'Cancelled'}, at(1));
  const r = report(s, c);
  assert.deepEqual([r.collected, r.methods.UPI, r.orders, r.refunds], [0, 0, 0, 3000]);
  assert.equal(o.status, 'refunded');
  assert.equal(s.milestones.first.active, false);
  assert.equal(s.milestones.first.unlockedAt, T0, 'first unlock time is kept');
  assert.equal(s.orders.length, 1);
  assert.equal(s.audit.at(-1).type, 'refund');
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 1, reason: 'Again'}));
});

test('partial refund preserves the order and prevents over-refund', () => {
  const {c, s} = setup();
  const o = sale(s, c);
  correctOrder(s, c, o.id, {type: 'refund', amount: 1000, reason: 'Missing item'});
  assert.equal(report(s, c).collected, 2000);
  assert.equal(report(s, c).orders, 1);
  assert.equal(report(s, c).average, 2000);
  assert.equal(o.status, 'partial');
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 2500, reason: 'Too much'}), /more than/);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 100, reason: '  '}), /reason/);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 100, reason: 'Wrong method', method: 'UPI'}), /more than/);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 0, reason: 'Zero'}));
  assert.throws(() => correctOrder(s, c, o.id, {type: 'oops', reason: 'x'}));
  assert.equal(netFor(s, o.id), 2000);
});

test('pending orders can only be voided', () => {
  const {c, s} = setup();
  const o = sale(s, c, {pending: true});
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 100, reason: 'x'}), /Void it instead/);
  correctOrder(s, c, o.id, {type: 'void', reason: 'Customer left'});
  assert.equal(o.status, 'void');
  assert.equal(s.payments.length, 0);
  assert.equal(report(s, c).pending.count, 0);
});

test('price edits leave historical snapshots untouched', () => {
  const {c, s} = setup();
  const o = sale(s, c, {items: [makeLine(c, 'packet-small', {addons: ['cheese']})]});
  productById(c, 'packet-small').price = 9900;
  c.addons.find(a => a.id === 'cheese').price = 2500;
  productById(c, 'packet-small').name = 'Renamed';
  assert.equal(o.items[0].unitPrice, 4000);
  assert.equal(o.items[0].addons[0].price, 1000);
  assert.equal(o.items[0].name, 'Cheese Packet · Small');
  assert.equal(report(s, c).collected, 4000);
});

test('void keeps the audit trail and releases stock exactly once', () => {
  const {c, s} = setup();
  const o = sale(s, c);
  assert.equal(stockUsed(s).small, 1);
  correctOrder(s, c, o.id, {type: 'void', reason: 'Wrong order'});
  assert.equal(stockUsed(s).small, undefined);
  assert.deepEqual(s.audit.map(a => a.type), ['order-created', 'void']);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'void', reason: 'Again'}), /already void/);
  assert.equal(s.payments.filter(p => p.kind === 'refund').length, 1);
  assert.equal(report(s, c).gross, 3000, 'gross keeps void orders');
});

test('refund does not restore prepared food stock', () => {
  const {c, s} = setup();
  const o = sale(s, c);
  correctOrder(s, c, o.id, {type: 'refund', amount: 3000, reason: 'Refund'});
  assert.equal(stockUsed(s).small, 1);
});

test('cash change is correct and underpayment is blocked', () => {
  const {c, s} = setup();
  const o = sale(s, c, {cashReceived: 10000});
  assert.equal(o.cashReceived, 10000);
  assert.equal(o.change, 7000);
  assert.equal(report(s, c).collected, 3000);
  assert.throws(() => sale(s, c, {cashReceived: 1000}), /less than/);
  const upi = sale(s, c, {method: 'UPI', cashReceived: 10000});
  assert.deepEqual([upi.cashReceived, upi.change], [null, 0]);
  assert.throws(() => sale(s, c, {method: 'Card'}), /payment method/);
  assert.equal(s.orders.length, 2);
});

test('a 100% discount order is paid with no payment rows', () => {
  const {c, s} = setup();
  const o = sale(s, c, {discount: {custom: true, type: 'percent', value: 100}});
  assert.deepEqual([o.total, o.status], [0, 'paid']);
  assert.equal(s.payments.length, 0);
  assert.equal(report(s, c).orders, 1);
});

test('shared stock pools across products', () => {
  const {c, s} = setup();
  c.inventory = true;
  c.stock.small = 3;
  sale(s, c, {items: [makeLine(c, 'corn-small'), makeLine(c, 'packet-small', {quantity: 2, addons: ['corn', 'cheese']})]});
  assert.equal(stockUsed(s).small, 3);
  assert.equal(stockLeft(s, c, 'small'), 0);
  assert.throws(() => sale(s, c), /Not enough stock/);
  assert.doesNotThrow(() => sale(s, c, {items: [makeLine(c, 'corn-large')]}));
});

test('one order cannot exceed the pool even split across lines', () => {
  const {c, s} = setup();
  c.inventory = true;
  c.stock.soda = 2;
  assert.throws(() => sale(s, c, {items: [makeLine(c, 'cola', {quantity: 2}), makeLine(c, 'lemon-soda')]}), /Not enough stock/);
});

test('pending orders reserve stock without collection', () => {
  const {c, s} = setup();
  c.inventory = true;
  c.stock.small = 1;
  sale(s, c, {pending: true});
  assert.throws(() => sale(s, c), /Not enough stock/);
  assert.equal(report(s, c).collected, 0);
});

test('demo and live ledgers stay separate', () => {
  const {st, c, s} = setup();
  sale(st.demo, c);
  assert.equal(s.orders.length, 0);
  assert.equal(report(s, c).collected, 0);
  assert.equal(report(st.demo, c).collected, 3000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Split payments
// ---------------------------------------------------------------------------------------------------------------------

test('split writes one Cash and one UPI payment and gives change on the cash part', () => {
  const {c, s} = setup();
  const items = [makeLine(c, 'packet-small', {quantity: 2, addons: ['cheese']}), makeLine(c, 'corn-large'), makeLine(c, 'lemon-soda', {quantity: 2})];
  const o = createOrder(s, c, {id: uuid(), items, discount: {ruleId: 'reel'}, method: 'Split', split: {Cash: 6000, UPI: 10000}, cashReceived: 10000}, T0);
  assert.deepEqual([o.method, o.split, o.cashReceived, o.change], ['Split', {Cash: 6000, UPI: 10000}, 10000, 4000]);
  assert.deepEqual(s.payments.map(p => [p.method, p.amount]), [['Cash', 6000], ['UPI', 10000]]);
  assert.deepEqual(methodBalances(s, o.id), {Cash: 6000, UPI: 10000, Other: 0});
  assert.deepEqual(report(s, c).methods, {Cash: 6000, UPI: 10000, Other: 0});
});

test('split parts must both be > 0 and add up to the total', () => {
  const {c, s} = setup();
  const bad = [null, {Cash: 0, UPI: 3000}, {Cash: 3000, UPI: 0}, {Cash: 1000, UPI: 1000}, {Cash: 1500.5, UPI: 1499.5}, {Cash: -100, UPI: 3100}];
  for (const split of bad) assert.throws(() => sale(s, c, {method: 'Split', split}));
  assert.throws(() => sale(s, c, {method: 'Split', split: {Cash: 1000, UPI: 2000}, cashReceived: 500}), /less than/);
  assert.equal(s.orders.length, 0);
  assert.equal(s.payments.length, 0);
});

test('split refunds are per method and capped by that method', () => {
  const {c, s} = setup();
  const o = sale(s, c, {method: 'Split', split: {Cash: 1000, UPI: 2000}});
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 500, reason: 'x'}), /Cash or UPI/);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 500, reason: 'x', method: 'Other'}), /Cash or UPI/);
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 1001, reason: 'x', method: 'Cash'}), /₹10 collected by Cash/);
  correctOrder(s, c, o.id, {type: 'refund', amount: 1000, reason: 'Paid twice', method: 'Cash'});
  assert.equal(o.status, 'partial');
  assert.deepEqual(methodBalances(s, o.id), {Cash: 0, UPI: 2000, Other: 0});
  assert.throws(() => correctOrder(s, c, o.id, {type: 'refund', amount: 1, reason: 'x', method: 'Cash'}));
  correctOrder(s, c, o.id, {type: 'void', reason: 'Cancelled'});
  assert.equal(o.status, 'void');
  const refunds = s.payments.filter(p => p.kind === 'refund').map(p => [p.method, p.amount]);
  assert.deepEqual(refunds, [['Cash', -1000], ['UPI', -2000]]);
  assert.deepEqual(report(s, c).methods, {Cash: 0, UPI: 0, Other: 0});
});

test('void of a fresh split reverses both methods', () => {
  const {c, s} = setup();
  const o = sale(s, c, {method: 'Split', split: {Cash: 1000, UPI: 2000}});
  correctOrder(s, c, o.id, {type: 'void', reason: 'Wrong order'});
  assert.deepEqual(s.payments.filter(p => p.kind === 'refund').map(p => [p.method, p.amount]), [['Cash', -1000], ['UPI', -2000]]);
  assert.equal(netFor(s, o.id), 0);
});

test('markPaid with a split', () => {
  const {c, s} = setup();
  const o = sale(s, c, {method: 'Split', pending: true});
  assert.equal(o.split, null);
  assert.throws(() => markPaid(s, c, o.id, {method: 'Split', split: {Cash: 1000, UPI: 1000}}), /add up/);
  markPaid(s, c, o.id, {method: 'Split', split: {Cash: 1000, UPI: 2000}, cashReceived: 2000}, at(3));
  assert.deepEqual([o.status, o.split, o.cashReceived, o.change], ['paid', {Cash: 1000, UPI: 2000}, 2000, 1000]);
  assert.deepEqual(s.payments.map(p => [p.method, p.amount, p.at]), [['Cash', 1000, at(3)], ['UPI', 2000, at(3)]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Tokens & kitchen
// ---------------------------------------------------------------------------------------------------------------------

test('tokens run per India-time day and roll over exactly at IST midnight (18:30Z)', () => {
  const {c, s} = setup();
  const a = sale(s, c, {}, '2026-11-04T05:00:00.000Z');
  const b = sale(s, c, {}, '2026-11-04T18:29:59.999Z');
  const d = sale(s, c, {}, '2026-11-04T18:30:00.000Z');
  const e = sale(s, c, {pending: true}, '2026-11-05T02:00:00.000Z');
  assert.deepEqual([a.token, a.tokenDay], [1, '2026-11-04']);
  assert.deepEqual([b.token, b.tokenDay], [2, '2026-11-04']);
  assert.deepEqual([d.token, d.tokenDay], [1, '2026-11-05']);
  assert.deepEqual([e.token, e.tokenDay], [2, '2026-11-05'], 'pending orders get tokens too');
  assert.deepEqual([a.number, b.number, d.number, e.number], [1, 2, 3, 4], 'order numbers never reset');
  assert.deepEqual([s.tokenDay, s.tokenSeq], ['2026-11-05', 2]);
});

test('resetTokens restarts at #01 today', () => {
  const {c, s} = setup();
  sale(s, c);
  sale(s, c);
  resetTokens(s, c, at(1));
  assert.deepEqual([s.tokenSeq, s.tokenDay], [0, '2026-11-04']);
  assert.equal(s.audit.at(-1).type, 'tokens-reset');
  assert.equal(sale(s, c, {}, at(2)).token, 1);
});

test('kitchen transitions forward and undo', () => {
  const {c, s} = setup();
  const o = sale(s, c);
  assert.deepEqual([o.kitchen, o.kitchenAt], ['preparing', {preparing: T0}]);
  setKitchen(s, c, o.id, 'ready', at(4));
  setKitchen(s, c, o.id, 'handed', at(6));
  assert.deepEqual(o.kitchenAt, {preparing: T0, ready: at(4), handed: at(6)});
  setKitchen(s, c, o.id, 'ready', at(7)); // undo
  assert.equal(o.kitchen, 'ready');
  assert.deepEqual(o.kitchenAt, {preparing: T0, ready: at(4)});
  setKitchen(s, c, o.id, 'preparing', at(8)); // undo again
  assert.deepEqual(o.kitchenAt, {preparing: T0});
  setKitchen(s, c, o.id, 'ready', at(9));
  assert.deepEqual(o.kitchenAt, {preparing: T0, ready: at(9)});
  setKitchen(s, c, o.id, 'ready', at(10)); // same status: no-op
  assert.equal(o.kitchenAt.ready, at(9));
  assert.throws(() => setKitchen(s, c, o.id, 'eaten', at(11)), /Unknown kitchen status/);
  assert.throws(() => setKitchen(s, c, 'ghost', 'ready'), /not be found/);
  correctOrder(s, c, o.id, {type: 'void', reason: 'x'});
  assert.throws(() => setKitchen(s, c, o.id, 'handed'), /cancelled/);
  const r = sale(s, c);
  correctOrder(s, c, r.id, {type: 'refund', amount: 3000, reason: 'x'});
  assert.throws(() => setKitchen(s, c, r.id, 'ready'), /cancelled/);
});

test('kitchenQueue: oldest first, pending/partial included, void/refunded/handed excluded', () => {
  const {c, s} = setup();
  const late = sale(s, c, {}, at(30));
  const early = sale(s, c, {pending: true}, at(10));
  const handed = sale(s, c, {}, at(5));
  const voided = sale(s, c, {}, at(1));
  const refunded = sale(s, c, {}, at(2));
  const partial = sale(s, c, {}, at(3));
  const ready = sale(s, c, {}, at(20));
  setKitchen(s, c, handed.id, 'handed', at(40));
  setKitchen(s, c, ready.id, 'ready', at(41));
  correctOrder(s, c, voided.id, {type: 'void', reason: 'x'});
  correctOrder(s, c, refunded.id, {type: 'refund', amount: 3000, reason: 'x'});
  correctOrder(s, c, partial.id, {type: 'refund', amount: 1000, reason: 'x'});
  const q = kitchenQueue(s);
  assert.deepEqual(q.preparing.map(o => o.id), [partial.id, early.id, late.id]);
  assert.deepEqual(q.ready.map(o => o.id), [ready.id]);
});

test('with the kitchen queue off, orders start handed over', () => {
  const {c, s} = setup();
  c.kitchenQueue = false;
  const o = sale(s, c);
  assert.deepEqual([o.kitchen, o.kitchenAt], ['handed', {handed: T0}]);
  assert.deepEqual(kitchenQueue(s), {preparing: [], ready: []});
});

// ---------------------------------------------------------------------------------------------------------------------
// Games & expenses
// ---------------------------------------------------------------------------------------------------------------------

test('paid games count once and do not count as food orders', () => {
  const {c, s} = setup();
  const g = {id: uuid(), gameId: 'ring', method: 'UPI', prize: 'Candy'};
  const play = addGame(s, c, g, T0);
  assert.equal(addGame(s, c, g, T0), play);
  const r = report(s, c);
  assert.deepEqual([r.games, r.orders, r.collected, r.gameIncome, r.food], [1, 0, 2000, 2000, 0]);
  assert.equal(s.milestones.gameon.active, true);
  assert.equal(s.milestones.gameon.reference, g.id);
  assert.equal(s.milestones.first.active, false);
  assert.equal(play.prize, 'Candy');
  assert.throws(() => addGame(s, c, {id: uuid(), gameId: 'ghost'}), /no longer set up/);
  assert.throws(() => addGame(s, c, {id: uuid(), gameId: 'ring', method: 'Split'}), /Cash, UPI or Other/);
});

test('free games have no payment', () => {
  const {c, s} = setup();
  addGame(s, c, {id: uuid(), gameId: 'wheel'});
  assert.equal(s.games.length, 1);
  assert.equal(s.payments.length, 0);
  assert.equal(report(s, c).games, 1);
});

test('game reversal deducts the fee and keeps the record', () => {
  const {c, s} = setup();
  const id = uuid();
  addGame(s, c, {id, gameId: 'ring', method: 'Cash'});
  voidGame(s, c, id, 'Mistap');
  const r = report(s, c);
  assert.deepEqual([r.games, r.collected, r.gameIncome, r.refunds], [0, 0, 0, 2000]);
  assert.equal(s.games.length, 1);
  assert.equal(s.games[0].void, true);
  assert.equal(s.milestones.gameon.active, false);
  assert.throws(() => voidGame(s, c, id, 'Again'), /already reversed/);
  const free = uuid();
  addGame(s, c, {id: free, gameId: 'wheel'});
  assert.throws(() => voidGame(s, c, free, ''), /reason/);
  voidGame(s, c, free, 'Mistap');
  assert.equal(s.payments.length, 2, 'a free game reversal writes no payment');
});

test('expenses raise the break-even target and are idempotent', () => {
  const {c, s} = setup();
  sale(s, c);
  const e = {id: uuid(), category: 'Supplies', amount: 1000, description: 'Extra plates'};
  addExpense(s, c, e, T0);
  addExpense(s, c, e, T0);
  const r = report(s, c);
  assert.equal(r.collected, 3000);
  assert.equal(r.expenses, 1000);
  assert.deepEqual([r.mission.investment, r.mission.extraExpenses, r.mission.target, r.mission.remaining], [514000, 1000, 515000, 512000]);
  assert.equal(s.audit.at(-1).type, 'expense-recorded');
  assert.throws(() => addExpense(s, c, {id: uuid(), category: 'Other', amount: 0}), /at least/);
  assert.throws(() => addExpense(s, c, {id: uuid(), category: 'Other', amount: 10.5}), /at least/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Reports & milestones
// ---------------------------------------------------------------------------------------------------------------------

test('reports never unlock milestones', () => {
  const {c, s} = setup();
  report(s, c);
  assert.deepEqual(s.milestones, {});
  const result = refreshMilestones(s, c, T0);
  assert.ok(Object.values(result).every(v => v === false));
  assert.ok(Object.values(s.milestones).every(m => !m.active && m.unlockedAt === null));
});

test('50-order milestone and reversal', () => {
  const {c, s} = setup();
  for (let i = 0; i < 49; i++) sale(s, c);
  assert.equal(s.milestones.crowd.active, false);
  const o = sale(s, c);
  assert.equal(s.milestones.crowd.active, true);
  assert.equal(s.milestones.crowd.reference, o.id);
  correctOrder(s, c, o.id, {type: 'void', reason: 'Duplicate'});
  assert.equal(s.milestones.crowd.active, false);
  assert.ok(s.milestones.crowd.unlockedAt);
});

test('recovery clamps at 100% and reports profit; reversal re-locks break-even', () => {
  const {c, s} = setup();
  const big = {...makeLine(c, 'corn-small'), unitPrice: 514000, lineTotal: 514000};
  const o = sale(s, c, {items: [big]});
  assert.equal(s.milestones.big.active, true);
  sale(s, c);
  let r = report(s, c);
  assert.deepEqual([r.mission.percent, r.mission.profit, r.mission.profitMode, r.mission.remaining], [100, 3000, true, 0]);
  assert.ok(Math.abs(r.mission.recovery - 517000 * 100 / 514000) < 1e-9);
  correctOrder(s, c, o.id, {type: 'void', reason: 'Reverse'});
  r = report(s, c);
  assert.equal(s.milestones.big.active, false);
  assert.deepEqual([r.mission.remaining, r.mission.profit, r.mission.profitMode], [511000, -511000, false]);
});

test('milestones of every type, exact recovery thresholds, and expense reversal', () => {
  const {c, s} = setup();
  const line = p => ({...makeLine(c, 'chai'), unitPrice: p, lineTotal: p});
  sale(s, c, {items: [line(99999)]});
  assert.equal(s.milestones.club.active, false);
  sale(s, c, {items: [line(1)]});
  assert.equal(s.milestones.club.active, true, 'revenue ≥ ₹1,000');
  sale(s, c, {items: [line(156999)]}); // collected 256,999 of 514,000
  assert.equal(s.milestones.half.active, false);
  sale(s, c, {items: [line(1)]}); // exactly 50%
  assert.equal(s.milestones.half.active, true);
  assert.equal(s.milestones.items.active, false);
  sale(s, c, {items: [makeLine(c, 'chai', {quantity: 6})]});
  assert.equal(s.milestones.items.active, true, '10 items');
  addGame(s, c, {id: uuid(), gameId: 'wheel'});
  assert.equal(s.milestones.gameon.active, true);
  sale(s, c, {items: [line(514000 - 257000 - 9000)]});
  assert.equal(s.milestones.big.active, true, 'exactly 100%');
  const unlocked = s.milestones.big.unlockedAt;
  addExpense(s, c, {id: uuid(), category: 'Supplies', amount: 100}, at(60));
  assert.equal(s.milestones.big.active, false, 'extra costs raise break-even');
  assert.equal(s.milestones.big.unlockedAt, unlocked);
  assert.equal(s.milestones.big.updatedAt, at(60));
});

test('recovery milestones never unlock without a target', () => {
  const {c, s} = setup();
  c.mission = {mode: 'total', total: 0, items: []};
  sale(s, c);
  const r = report(s, c);
  assert.deepEqual([r.mission.hasTarget, r.mission.percent, r.mission.recovery, r.mission.profitMode, r.mission.profit], [false, 0, 0, false, 3000]);
  assert.equal(s.milestones.half.active, false);
  assert.equal(milestoneProgress(c.milestones[3], r).done, false);
});

test('milestoneProgress values and labels', () => {
  const {c, s} = setup();
  sale(s, c, {items: [makeLine(c, 'corn-small', {quantity: 5})]}); // ₹150
  const r = report(s, c);
  const by = id => milestoneProgress(c.milestones.find(m => m.id === id), r);
  assert.deepEqual(by('club'), {value: 15000, goal: 100000, ratio: 0.15, done: false, valueLabel: '₹150', goalLabel: '₹1,000'});
  assert.deepEqual(by('first'), {value: 1, goal: 1, ratio: 1, done: true, valueLabel: '1', goalLabel: '1'});
  assert.deepEqual(by('items'), {value: 5, goal: 10, ratio: 0.5, done: false, valueLabel: '5', goalLabel: '10'});
  const half = by('half');
  assert.equal(half.valueLabel, '2%');
  assert.equal(half.goalLabel, '50%');
  assert.equal(half.done, false);
  assert.ok(Math.abs(half.ratio - 15000 * 100 / 514000 / 50) < 1e-12);
  assert.deepEqual(by('gameon'), {value: 0, goal: 1, ratio: 0, done: false, valueLabel: '0', goalLabel: '1'});
});

test('report scopes sales metrics to an IST day; the mission stays whole-session', () => {
  const {c, s} = setup();
  const day1 = '2026-11-04T17:00:00.000Z'; // 22:30 IST 4 Nov
  const day2 = '2026-11-04T19:00:00.000Z'; // 00:30 IST 5 Nov
  const o1 = sale(s, c, {method: 'UPI'}, day1);
  sale(s, c, {items: [makeLine(c, 'chai', {quantity: 2})]}, day2);
  sale(s, c, {pending: true}, day2);
  addGame(s, c, {id: uuid(), gameId: 'ring', method: 'Cash'}, day2);
  addExpense(s, c, {id: uuid(), category: 'Supplies', amount: 500}, day1);
  correctOrder(s, c, o1.id, {type: 'refund', amount: 1000, reason: 'Late', method: 'UPI'}, day2); // refund on day 2
  const d1 = report(s, c, {day: '2026-11-04'});
  const d2 = report(s, c, {day: '2026-11-05'});
  const all = report(s, c);
  assert.equal(d1.scope, '2026-11-04');
  assert.equal(all.scope, 'all');
  assert.deepEqual([d1.collected, d1.orders, d1.units, d1.games, d1.expenses, d1.pending.count, d1.refunds], [3000, 1, 1, 0, 500, 0, 0]);
  assert.deepEqual(d1.hourly, {'22': 3000});
  assert.equal(d1.average, 2000, 'average uses the order net');
  assert.deepEqual([d2.collected, d2.orders, d2.units, d2.games, d2.gameIncome, d2.expenses, d2.pending.count, d2.refunds],
    [3000 + 2000 - 1000, 1, 2, 1, 2000, 0, 1, 1000]);
  assert.deepEqual(d2.methods, {Cash: 5000, UPI: -1000, Other: 0});
  assert.deepEqual(d2.hourly, {'00': 4000});
  for (const r of [d1, d2]) assert.deepEqual(r.mission, all.mission);
  assert.deepEqual([all.mission.collected, all.mission.extraExpenses, all.mission.target], [7000, 500, 514500]);
  assert.equal(all.collected, d1.collected + d2.collected);
});

test('report details: bestsellers, categories, honest numbers', () => {
  const {c, s} = setup();
  sale(s, c, {items: [makeLine(c, 'cola', {quantity: 2}), makeLine(c, 'corn-large')]});
  sale(s, c, {items: [makeLine(c, 'corn-large', {quantity: 2}), makeLine(c, 'chai', {quantity: 2})]});
  const v = sale(s, c, {items: [makeLine(c, 'chai', {quantity: 9})]});
  correctOrder(s, c, v.id, {type: 'void', reason: 'x'});
  const r = report(s, c);
  assert.deepEqual(r.best.map(b => [b.productId, b.units, b.revenue]), [['corn-large', 3, 15000], ['cola', 2, 4000], ['chai', 2, 3000]]);
  assert.deepEqual(r.categories, {Drinks: 7000, 'Crispy Snacks': 15000});
  assert.deepEqual([r.gross, r.food, r.refunds, r.orders, r.average], [22000 + 13500, 22000, 13500, 2, 11000]);
});

// ---------------------------------------------------------------------------------------------------------------------
// UPI, day report, CSV
// ---------------------------------------------------------------------------------------------------------------------

test('upiUri: exact string, null when unset, encodes spaces # &', () => {
  const {c} = setup();
  assert.equal(upiUri(c, 16000), null);
  c.upi.id = 'packet.pataka@okaxis';
  assert.equal(upiUri(c, 16000), 'upi://pay?pa=packet.pataka%40okaxis&pn=Packet%20Pataka&am=160.00&cu=INR');
  c.upi.payeeName = 'Viraj & Co #1';
  assert.equal(upiUri(c, 1250, 'Token #07 · stall'),
    'upi://pay?pa=packet.pataka%40okaxis&pn=Viraj%20%26%20Co%20%231&am=12.50&cu=INR&tn=Token%20%2307%20%C2%B7%20stall');
  assert.throws(() => upiUri(c, 0));
});

/** A day with two orders: the ₹160 brief order (UPI) and a ₹30 cash packet. */
function reportDay() {
  const {c, s, st} = setup();
  const items = [makeLine(c, 'packet-small', {quantity: 2, addons: ['cheese']}), makeLine(c, 'corn-large'), makeLine(c, 'lemon-soda', {quantity: 2})];
  createOrder(s, c, {id: uuid(), items, discount: {ruleId: 'reel'}, method: 'UPI'}, T0);
  sale(s, c, {}, at(10));
  return {c, s, st};
}

test('dayReportText: "to go" variant, exact WhatsApp text', () => {
  const {c, s} = reportDay();
  assert.equal(dayReportText(s, c, {day: '2026-11-04'}), [
    '*🧾 Packet Pataka — Day report*',
    'Stall No. 10 · Diwali Mela · 4 Nov 2026',
    '💰 Collected: ₹190  (💵 Cash ₹30 · 📲 UPI ₹160 · Other ₹0)',
    '🧾 Orders: 2 · Items: 6 · Avg: ₹95',
    '🎯 Break-even: ₹5,140 (investment ₹5,140 + extra costs ₹0)',
    '📈 Recovered: 3% — ₹4,950 to go',
    '🏆 Top sellers:',
    '1. Cheese Packet · Small — 2 sold',
    '2. Lemon Soda — 2 sold',
    '3. Corn Packet · Large — 1 sold',
    '_Sent from ManageYourStall (MYS)_',
  ].join('\n'));
});

test('dayReportText: PROFIT MODE, games and pending lines only when relevant', () => {
  const {c, s} = reportDay();
  c.mission = {mode: 'total', total: 10000, items: []};
  addExpense(s, c, {id: uuid(), category: 'Helper', amount: 2000}, at(20));
  let text = dayReportText(s, c, {now: at(30)});
  assert.match(text, /^\*🧾 Packet Pataka — Day report\*\nStall No\. 10 · Diwali Mela · Whole event till 4 Nov 2026\n/);
  assert.match(text, /🎯 Break-even: ₹120 \(investment ₹100 \+ extra costs ₹20\)/);
  assert.match(text, /🔥 PROFIT MODE: ₹70 profit/);
  assert.doesNotMatch(text, /Recovered/);
  assert.doesNotMatch(text, /Games|Pending/);
  addGame(s, c, {id: uuid(), gameId: 'ring'}, at(40));
  addGame(s, c, {id: uuid(), gameId: 'wheel'}, at(41));
  sale(s, c, {pending: true}, at(42));
  text = dayReportText(s, c, {day: '2026-11-04'});
  assert.match(text, /🎮 Games: 2 plays · ₹20 fees/);
  assert.match(text, /⏳ Pending: 1 order · ₹30/);
  assert.ok(text.endsWith('_Sent from ManageYourStall (MYS)_'));
  assert.match(dayReportText(s, c, {day: '2026-11-05'}), /Top sellers: none yet/);
  c.mission = {mode: 'total', total: 0, items: []};
  s.expenses = [];
  assert.match(dayReportText(s, c), /Break-even: not set yet/);
});

test('CSV rows: itemized orders, summary and payments (rupee amounts)', () => {
  const {c, s} = setup();
  const items = [makeLine(c, 'packet-small', {quantity: 2, addons: ['cheese'], flavour: 'Magic Masala'}), makeLine(c, 'lemon-soda')];
  const o = createOrder(s, c, {id: uuid(), items, discount: {ruleId: 'reel'}, method: 'Split', split: {Cash: 4000, UPI: 5000}, note: '=cmd'}, T0);
  correctOrder(s, c, o.id, {type: 'refund', amount: 1000, reason: 'x', method: 'UPI'}, at(5));
  addGame(s, c, {id: 'game-1', gameId: 'ring'}, at(6));
  const rows = ordersCsvRows(s);
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], 'Order');
  const h = rows[0];
  const first = Object.fromEntries(h.map((k, i) => [k, rows[1][i]]));
  assert.equal(first.Token, '#01');
  assert.equal(first['Time (IST)'], '2026-11-04 15:30');
  assert.equal(first.Item, 'Cheese Packet · Small');
  assert.equal(first['Add-ons'], 'Cheese Sauce (10.00)');
  assert.deepEqual([first.Quantity, first['Unit price'], first['Line total'], first['Order total']], ['2', '40.00', '80.00', '90.00']);
  const summary = orderSummaryCsvRows(s);
  const row = Object.fromEntries(summary[0].map((k, i) => [k, summary[1][i]]));
  assert.deepEqual([row['Cash part'], row['UPI part'], row['Net collected'], row.Refunded, row.Status, row.Note], ['40.00', '50.00', '80.00', '10.00', 'partial', '=cmd']);
  const pay = paymentsCsvRows(s);
  assert.deepEqual(pay[0], ['Payment ID', 'Time (IST)', 'Kind', 'For', 'Method', 'Amount', 'Entity ID']);
  assert.deepEqual(pay.slice(1).map(r => [r[2], r[3], r[4], r[5]]),
    [['order', 'Order 1 (#01)', 'Cash', '40.00'], ['order', 'Order 1 (#01)', 'UPI', '50.00'], ['refund', 'Order 1 (#01)', 'UPI', '-10.00'],
      ['game', 'Game: Ring Toss', 'Cash', '20.00']]);
  const text = csv(summary);
  assert.ok(text.includes(`"'=cmd"`), 'formula in a note is neutralized');
});

test('csv(): BOM, CRLF, quote everything, formula-injection escaping', () => {
  const out = csv([['a', '=1+2', '-20.00', 'He said "hi"', '@x', '\tz', '+91', '-x', '\rq', 5, null], ['b']]);
  assert.equal(out, '﻿"a","\'=1+2","-20.00","He said ""hi""","\'@x","\'\tz","\'+91","\'-x","\'\rq","5",""\r\n"b"');
});

// ---------------------------------------------------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------------------------------------------------

/** A state with a cash sale, a split order, a pending order, a refund, a game and an expense. */
function busyState() {
  const {st, c, s} = setup();
  sale(s, c, {cashReceived: 5000});
  const split = sale(s, c, {method: 'Split', split: {Cash: 1000, UPI: 2000}}, at(1));
  correctOrder(s, c, split.id, {type: 'refund', amount: 500, reason: 'x', method: 'UPI'}, at(2));
  sale(s, c, {pending: true}, at(3));
  addGame(s, c, {id: uuid(), gameId: 'ring', method: 'UPI'}, at(4));
  addExpense(s, c, {id: uuid(), category: 'Supplies', amount: 700}, at(5));
  sale(st.demo, c, {}, at(6));
  addToDraft(s, c, makeLine(c, 'chai'));
  return st;
}

test('saved snapshot survives serialization and restore validation (raw v2)', () => {
  const st = busyState();
  const input = JSON.parse(JSON.stringify(st));
  const copy = structuredClone(input);
  const {state, media, warnings} = validateBackup(input);
  assert.deepEqual(input, copy, 'input is not mutated');
  assert.deepEqual([media, warnings], [{}, []]);
  assert.deepEqual(report(state.live, state.config), report(st.live, st.config));
  assert.equal(state.demo.orders.length, 1);
  assert.equal(state.live.draft.length, 1);
});

test('exportBackup wrapper round trip with media', () => {
  const st = busyState();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  st.config.products[0].image = 'media:abc123';
  const backup = exportBackup(st, {abc123: png});
  assert.deepEqual(Object.keys(backup), ['app', 'format', 'version', 'exportedAt', 'state', 'media']);
  assert.deepEqual([backup.app, backup.format, backup.version], ['ManageYourStall', 'mys-backup', 2]);
  assert.ok(Date.parse(backup.exportedAt));
  const {state, media, warnings} = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(state.config.products[0].image, 'media:abc123');
  assert.deepEqual(media, {abc123: png});
  assert.deepEqual(warnings, []);
  assert.throws(() => validateBackup({...backup, version: 3}), /unsupported/);
  assert.throws(() => validateBackup({...backup, app: 'Other'}), /unsupported/);
});

test('dangling media references are reset with a warning; bad media is rejected', () => {
  const st = busyState();
  st.config.products[1].image = 'media:gone';
  const {state, warnings} = validateBackup(exportBackup(st, {}));
  assert.equal(state.config.products[1].image, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Cheese Packet · Large/);
  for (const media of [
    {bad: 'data:text/html;base64,PGgxPg=='},
    {bad: 'data:image/svg+xml;base64,PHN2Zz4='},
    {bad: 42},
    {'bad id!': 'data:image/png;base64,AAAA'},
    {big: `data:image/png;base64,${'A'.repeat(2_200_000)}`},
  ]) {
    assert.throws(() => validateBackup(exportBackup(st, media)), /Backup rejected/);
  }
});

test('raw v1 state is migrated and accepted', () => {
  const v1 = JSON.parse(readFileSync(V1_FIXTURE, 'utf8'));
  const {state} = validateBackup(v1);
  assert.equal(state.version, 2);
  assert.equal(state.config.schema, 2);
  assert.equal(report(state.live, state.config).collected, 28000);
  assert.equal(v1.version, 1, 'input is not mutated');
});

test('corrupt backups are rejected', () => {
  const st = busyState();
  assert.doesNotThrow(() => validateBackup(structuredClone(st)));
  const splitIndex = st.live.orders.findIndex(o => o.method === 'Split');
  const pendingIndex = st.live.orders.findIndex(o => o.status === 'pending');
  const corruptions = {
    'order totals': v => v.live.orders[0].total++,
    'line total': v => v.live.orders[0].items[0].lineTotal++,
    'duplicate order id': v => v.live.orders.push(structuredClone(v.live.orders[0])),
    'duplicate payment id': v => v.live.payments.push(structuredClone(v.live.payments[0])),
    'unknown payment entity': v => v.live.payments[0].entityId = 'unknown',
    'split parts do not add up': v => v.live.orders[splitIndex].split.Cash += 1,
    'split parts vs payments': v => {
      v.live.orders[splitIndex].split.Cash += 100;
      v.live.orders[splitIndex].split.UPI -= 100;
    },
    'split on a cash order': v => v.live.orders[0].split = {Cash: 1000, UPI: 2000},
    'bad status': v => v.live.orders[0].status = 'shipped',
    'bad order method': v => v.live.orders[0].method = 'Card',
    'bad payment method': v => v.live.payments[0].method = 'Card',
    'negative price': v => v.config.products[0].price = -100,
    'over-refund': v => v.live.payments.push({id: 'extra-refund', entityId: v.live.orders[0].id, kind: 'refund', amount: -5000, method: 'Cash', at: T0}),
    'paid but short': v => v.live.payments.splice(0, 1),
    'pending with a payment': v => v.live.payments.push({id: 'p-pending', entityId: v.live.orders[pendingIndex].id, kind: 'order', amount: 3000, method: 'Cash', at: T0}),
    'game fee mismatch': v => v.live.games[0].fee = 999,
    'bad kitchen status': v => v.live.orders[0].kitchen = 'eaten',
    'bad timestamp': v => v.live.orders[0].at = 'yesterday',
    'payment sign': v => v.live.payments[0].amount = -v.live.payments[0].amount,
    'missing demo ledger': v => delete v.demo,
    'bad pin': v => v.pin = {salt: 'x', hash: 'nope'},
    'not a backup': () => 'garbage',
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    const copy = structuredClone(st);
    const replaced = corrupt(copy);
    const input = typeof replaced === 'string' ? replaced : copy;
    assert.throws(() => validateBackup(input), /Backup rejected/, name);
  }
});

test('validateBackup enforces validateConfig rules', () => {
  const st = busyState();
  st.config.categories = [];
  assert.throws(() => validateBackup(st), /Backup rejected/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Templates & migration passthrough
// ---------------------------------------------------------------------------------------------------------------------

test('applyTemplate keeps profile, history and PIN and clears both drafts', () => {
  const st = busyState();
  st.pin = {salt: 'salt', hash: 'a'.repeat(64)};
  st.config.profile.tagline = '';
  st.config.upi = {id: 'stall@okaxis', payeeName: 'Viraj'};
  addToDraft(st.demo, st.config, makeLine(st.config, 'chai'));
  setDraftDiscount(st.live, st.config, {ruleId: 'reel'});
  setDraftNote(st.live, 'note');
  const profile = structuredClone(st.config.profile);
  const before = {live: structuredClone(st.live.orders), payments: structuredClone(st.live.payments), demo: structuredClone(st.demo.orders)};
  const oldDraftId = st.live.draftId;
  applyTemplate(st, 'blank', {withPrices: true}, at(90));
  assert.equal(typeof st.config.templateId, 'string');
  assert.ok(Array.isArray(st.config.products));
  assert.deepEqual(st.config.upi, {id: 'stall@okaxis', payeeName: 'Viraj'});
  assert.deepEqual(st.config.operators, ['Team Pataka', 'Cashier 1']);
  assert.equal(st.config.profile.stallName, profile.stallName);
  assert.equal(st.config.profile.subTagline, profile.subTagline, 'a non-empty sub-tagline is kept');
  assert.equal(typeof st.config.profile.tagline, 'string');
  assert.deepEqual(st.pin, {salt: 'salt', hash: 'a'.repeat(64)});
  assert.deepEqual(st.live.orders, before.live);
  assert.deepEqual(st.live.payments, before.payments);
  assert.deepEqual(st.demo.orders, before.demo);
  for (const s of [st.live, st.demo]) assert.deepEqual([s.draft, s.draftDiscount, s.draftNote], [[], null, '']);
  assert.notEqual(st.live.draftId, oldDraftId);
  assert.equal(st.live.audit.at(-1).type, 'template-applied');
});

test('migrate passes v2 through, fills missing optional fields, and is idempotent', () => {
  const {st, c, s} = setup();
  sale(s, c);
  delete s.draftNote;
  delete s.tokenSeq;
  delete s.orders[0].note;
  delete st.onboarded;
  const out = migrate(st);
  assert.equal(out, st);
  assert.deepEqual([s.draftNote, s.tokenSeq, s.orders[0].note, st.onboarded], ['', 0, '', true]);
  const again = migrate(structuredClone(st));
  assert.deepEqual(again, st);
  assert.throws(() => migrate({version: 9, config: {}}), /unknown app version/);
  assert.throws(() => migrate(null));
});

test('money formatting used across reports', () => {
  assert.equal(money(16000), '₹160');
  assert.equal(money(1250), '₹12.50');
  assert.equal(money(514000), '₹5,140');
});
