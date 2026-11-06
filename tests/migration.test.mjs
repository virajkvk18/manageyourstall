// v1 (Packet Pataka) → v2 (ManageYourStall) migration, checked against real v1 data (ARCHITECTURE.md §14).
// tests/fixtures/v1-state.json was produced by the v1 code; v1-expected.json holds the v1 report numbers for its live ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {migrate, report, validateBackup, createOrder, makeLine, uuid} from '../dist/domain.mjs';
import {validateConfig} from '../dist/catalog.mjs';


const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const V1 = load('v1-state.json');
const EXPECTED = load('v1-expected.json');
const migrated = () => migrate(structuredClone(V1));

test('the migrated live ledger reports exactly the v1 numbers', () => {
  const st = migrated();
  const r = report(st.live, st.config);
  assert.equal(r.collected, EXPECTED.collected);
  assert.deepEqual(r.methods, EXPECTED.methods);
  assert.equal(r.orders, EXPECTED.orders);
  assert.equal(r.units, EXPECTED.units);
  assert.equal(r.games, EXPECTED.games);
  assert.equal(r.gameIncome, EXPECTED.gameIncome);
  assert.equal(r.expenses, EXPECTED.expenses);
  assert.equal(r.discounts, EXPECTED.discounts);
  assert.equal(r.refunds, EXPECTED.refunds);
  assert.equal(r.pending.count, EXPECTED.pendingOrders);
  assert.equal(st.live.orders.length, EXPECTED.liveOrderCount);
  assert.equal(st.demo.orders.length, EXPECTED.demoOrderCount);
  // v2 break-even = investment + extra expenses (intended difference from v1's remaining).
  assert.equal(r.mission.investment, EXPECTED.target);
  assert.equal(r.mission.target, EXPECTED.target + EXPECTED.expenses);
  assert.equal(r.mission.collected, EXPECTED.collected);
});

test('state header and config root are v2', () => {
  const st = migrated();
  assert.equal(st.version, 2);
  assert.equal(st.config.schema, 2);
  assert.equal(st.onboarded, true);
  assert.equal(st.mode, 'live');
  assert.equal(st.revision, V1.revision);
  assert.deepEqual(st.pin, V1.pin);
  for (const k of ['menuVersion', 'promo', 'promoMinimum', 'target', 'stallName', 'stallNumber', 'eventDate', 'accent']) {
    assert.equal(k in st.config, false, `config.${k} is dropped`);
  }
  assert.equal(st.config.templateId, 'legacy');
  assert.equal(st.config.kitchenQueue, true);
  assert.deepEqual(st.config.upi, {id: '', payeeName: ''});
  // Phase-2 theme defaults (§16.1): a legacy stall is a 'custom' look with the original packet/pizza/cold hero art.
  assert.deepEqual(st.config.theme, {
    accent: '#FFDD35', themeId: 'custom', heroArt: ['packet', 'pizza', 'cold'], secondary: '#FF4D87', heroTint: 'yellow',
    heroPattern: 'sunburst', heroImage: null,
  });
  assert.deepEqual(st.config.team, {members: [], splitMode: 'equal'});
  assert.equal(st.config.mission.mode, 'total', 'migrated v1 stalls keep a planned mission');
  for (const mode of ['live', 'demo']) assert.deepEqual([st[mode].contributions, st[mode].settlements], [[], []]);
  assert.equal(st.config.operator, 'Team Pataka');
  assert.deepEqual(st.config.operators, V1.config.operators);
  assert.equal(st.config.inventory, V1.config.inventory);
  assert.deepEqual(st.config.stock, V1.config.stock);
});

test('profile fields per §14', () => {
  const {profile} = migrated().config;
  assert.deepEqual(profile, {
    stallName: 'Packet Pataka',
    booth: 'Stall No. 10',
    tagline: 'Little packets. Big pataka energy.',
    subTagline: 'Good food. Fast orders. A fest to remember.',
    eventName: 'Diwali Celebration',
    venue: 'Baderia Global Institute',
    city: 'Jabalpur',
    eventDate: '2026-11-04',
    ownerName: 'Team Pataka',
    initials: '',
  });
});

test('categories are derived in order of first appearance and every product has a categoryId', () => {
  const c = migrated().config;
  assert.deepEqual(c.categories, [
    {id: 'crispy-dhamaka', name: 'Crispy Dhamaka'},
    {id: 'pizza-pataka', name: 'Pizza Pataka'},
    {id: 'fizz-pataka', name: 'Fizz Pataka'},
    {id: 'combo-pataka', name: 'Combo Pataka'},
  ]);
  assert.equal(c.products.length, V1.config.products.length);
  const ids = new Set(c.categories.map(x => x.id));
  for (const [i, p] of c.products.entries()) {
    const old = V1.config.products[i];
    assert.ok(ids.has(p.categoryId), `${p.id} has a known category`);
    assert.equal(c.categories.find(x => x.id === p.categoryId).name, old.category);
    assert.deepEqual([p.id, p.name, p.price, p.art, p.tint, p.size], [old.id, old.name, old.price, old.art, old.tint, old.size || '']);
    assert.deepEqual([p.subtitle, p.priceLocked, p.image, p.pattern, p.customizable], ['', false, null, 'none', false]);
    assert.deepEqual(p.tags, old.bundle ? ['COMBO'] : []);
    assert.deepEqual(p.bundle, old.bundle || null);
    assert.equal(p.stockKey, old.stockKey || '');
    assert.equal(p.stockUnits, 1);
  }
});

test('promo becomes a discount rule; mission and milestones carry over', () => {
  const st = migrated();
  const c = st.config;
  assert.deepEqual(c.discounts, [{id: 'promo', label: 'Reel / banner ₹10 off', type: 'flat', value: 1000, minimum: 0, active: true}]);
  assert.deepEqual(c.mission, {mode: 'total', total: 514000, items: []});
  assert.deepEqual(c.milestones.map(m => [m.id, m.type, m.target]), [['spark', 'orders', 1], ['game', 'games', 1], ['crowd', 'orders', 50], ['big', 'recovery', 100]]);
  for (const mode of ['live', 'demo']) {
    for (const [id, active] of Object.entries(V1[mode].milestones).map(([k, v]) => [k, v.active])) {
      assert.equal(st[mode].milestones[id].active, active, `${mode}.${id} active flag preserved`);
      assert.deepEqual(st[mode].milestones[id], V1[mode].milestones[id]);
    }
  }
  assert.deepEqual(Object.fromEntries(Object.entries(st.live.milestones).map(([k, v]) => [k, v.active])), EXPECTED.milestones);
  assert.deepEqual(c.games, [
    {id: 'wheel', name: 'Spin the Wheel', fee: 2000, art: 'spin-wheel'},
    {id: 'coin', name: 'Coin in the Bucket', fee: 0, art: 'lucky-cup'},
  ]);
  assert.deepEqual(c.addons, V1.config.addons);
  assert.deepEqual(c.flavours, V1.config.flavours);
});

test('orders and sessions gain v2 fields without touching money', () => {
  const st = migrated();
  for (const mode of ['live', 'demo']) {
    const s = st[mode];
    assert.deepEqual(s.payments, V1[mode].payments, 'payment ledger untouched');
    assert.deepEqual([s.draftNote, s.tokenDay, s.tokenSeq], ['', null, 0]);
    assert.equal('draftPromo' in s, false);
    assert.equal(s.draftId, V1[mode].draftId);
    for (const [i, o] of s.orders.entries()) {
      const old = V1[mode].orders[i];
      assert.deepEqual([o.token, o.tokenDay, o.kitchen, o.note, o.split], [null, null, 'handed', '', null]);
      assert.deepEqual(o.kitchenAt, {});
      assert.deepEqual([o.subtotal, o.discount, o.total, o.status, o.method], [old.subtotal, old.discount, old.total, old.status, old.method]);
      assert.deepEqual(o.discountInfo, old.discount > 0 ? {id: 'promo', label: 'Reel / banner ₹10 off', type: 'flat', value: 1000} : null);
      for (const l of o.items) assert.equal(l.note, '');
    }
  }
  assert.deepEqual(st.live.draftDiscount, {ruleId: 'promo'});
  assert.equal(st.demo.draftDiscount, null);
  assert.equal(st.live.draft[0].note, '');
});

test('migrate is idempotent', () => {
  const once = migrated();
  const twice = migrate(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('migrated config passes validateConfig', () => {
  assert.doesNotThrow(() => validateConfig(migrated().config));
});

test('validateBackup accepts the raw v1 fixture and returns the migrated state', () => {
  const input = structuredClone(V1);
  const {state, media, warnings} = validateBackup(input);
  assert.deepEqual(input, V1, 'input is not mutated');
  assert.deepEqual([media, warnings], [{}, []]);
  assert.equal(state.version, 2);
  const r = report(state.live, state.config);
  assert.deepEqual([r.collected, r.methods, r.orders, r.units, r.refunds], [EXPECTED.collected, EXPECTED.methods, EXPECTED.orders, EXPECTED.units, EXPECTED.refunds]);
});

test('migrated stalls keep selling: new orders get tokens after legacy null tokens', () => {
  const st = migrated();
  const c = st.config;
  const o = createOrder(st.live, c, {id: uuid(), items: [makeLine(c, 'veggie-small')], discount: st.live.draftDiscount}, '2026-11-05T06:00:00.000Z');
  assert.deepEqual([o.number, o.token, o.tokenDay, o.total], [6, 1, '2026-11-05', 2000]);
  assert.equal(o.kitchen, 'preparing');
  assert.equal(report(st.live, c).collected, EXPECTED.collected + 2000);
});
