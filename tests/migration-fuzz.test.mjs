// v1 (Packet Pataka) → v2 (ManageYourStall) upgrade fuzz test (ARCHITECTURE.md §14).
//
// A seeded generator drives the historical v1 domain (tests/fixtures/v1-domain.mjs, an exact copy of the v1 dist/domain.mjs)
// exactly the way the v1 UI did (v1 dist/app.mjs handleAction): every UI action is one transactional "commit" that rolls back
// on any thrown error, like v1 storage.mutate. The resulting v1 state is what a real owner's phone holds; it is then upgraded
// with v2 migrate() and every money number is compared with v1's own report().
//
// Seeds: MYS_FUZZ_SEEDS (default 60, ~300+ for a deep local run) starting at MYS_FUZZ_START (default 1).
//   MYS_FUZZ_SEEDS=400 node --test tests/migration-fuzz.test.mjs
// A failure message names the seed; the action sequence of a seed is deterministic (ids/uuids are random but unused by the
// generator's choices).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as V1 from './fixtures/v1-domain.mjs';
import {
  migrate, report, validateBackup, exportBackup, createOrder, makeLine, markPaid, correctOrder, addGame, voidGame,
  addExpense, netFor, stockUsed, refreshMilestones, draftTotals, sellability, uuid,
} from '../dist/domain.mjs';
import {validateConfig} from '../dist/catalog.mjs';

// Independent oracle for the Phase-2 legacy expense upgrade (ARCHITECTURE.md §16.1): v1 `{category, amount, description}`
// becomes a bill with a title (≤80 UTF-16 units, full text kept in notes when longer), a Phase-2 category id, Cash, paid from
// the drawer, no photo, not void. Money (amount), id, time and operator never change.
const LEGACY_CATEGORY = {Ingredients: 'restock', Supplies: 'restock', Packaging: 'packaging', Helper: 'misc', Transport: 'misc', Other: 'misc'};
const clip = (t, max) => {
  let out = t.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (out.length < t.length && last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
};
function upgradedExpense(e) {
  const d = String(e.description ?? '').trim();
  const long = d.length > 80;
  const {description, category, ...rest} = e;
  return {
    ...rest,
    category: LEGACY_CATEGORY[category] || 'misc',
    title: !d ? 'Expense' : long ? clip(d, 80).trim() : d,
    notes: long ? clip(d, 500) : '',
    method: 'Cash',
    paidBy: 'drawer',
    billImage: null,
    void: false,
  };
}

/** Hour buckets that hold money (a ₹0 promo order makes v1 list an empty ₹0 hour; v2 leaves it out). */
const nonZeroHours = h => Object.fromEntries(Object.entries(h || {}).filter(([, v]) => v !== 0).sort());

const SEEDS = Number(process.env.MYS_FUZZ_SEEDS || 60);
const START = Number(process.env.MYS_FUZZ_START || 1);
const EVENT_START = Date.parse('2026-11-04T04:30:00.000Z'); // 10:00 IST on the real event day

// ---------------------------------------------------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------------------------------------------------

/** mulberry32 */
function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: p => next() < p,
    pick: list => list[Math.floor(next() * list.length)],
    /** @param {[number, any][]} pairs */
    weighted(pairs) {
      const total = pairs.reduce((n, [w]) => n + w, 0);
      let x = next() * total;
      for (const [w, v] of pairs) {
        if ((x -= w) < 0) return v;
      }
      return pairs[pairs.length - 1][1];
    },
  };
  return r;
}

/** Longest prefix of whole code points whose UTF-16 length is ≤ max (what an <input maxlength> lets through). */
function upTo(text, max) {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}
const fill = (seed, max) => upTo(seed.repeat(Math.ceil(max / seed.length) + 1), max);

const PRODUCT_NAMES = [
  'Masala Maggi', 'Paneer Tikka Roll', 'Cold Coffee ☕', 'पाव भाजी', 'Café Frappé', 'Chilli Potato 🌶️', 'Momos (8 pcs) · Steamed',
  'கொத்து பரோட்டா', 'Nimbu Pani 🍋', 'Lay’s + Dip', 'Cheese Burst Nachos', fill('Extra Cheesy Peri Peri Loaded Nachos 🧀 ', 50),
];
const REASONS = [
  'Customer changed mind', 'Wrong item packed', 'ग्राहक ने ऑर्डर रद्द किया', 'Duplicate tap 🙈', 'Cold drink spilled',
  fill('Refund approved by owner — packet burst at the counter 💥 ', 200),
];
const PRIZES = ['', '', 'Toffee', 'Keychain 🔑', 'Free Sprite', 'बड़ा टेडी', fill('Mega prize: Diwali hamper with sweets 🎁 ', 120)];
const DESCRIPTIONS = ['Extra cheese packets', 'Ice for drinks', 'कागज़ की प्लेटें', 'Auto fare 🛺', fill('Emergency run to the wholesale market for more chips ', 150)];
const OPERATORS = ['Team Pataka', 'Cashier 1', 'Cashier 2', 'Games crew', 'Riya', 'Aarav 🎉', 'Kabir Singh', 'प्रिया'];
const FLAVOURS = ['Lay’s Classic Salted', 'Lay’s Magic Masala', 'Kurkure Masala Munch', 'Bingo Mad Angles', 'Peri Peri', 'टमाटर चटाका'];
const STALL_NAMES = ['Packet Pataka', 'पटाका स्टॉल', 'Chai Sutta Bar · Diwali', fill('The Great Big Crispy Packet Pataka Stall 🎆 ', 50)];
const PRICES = [[3, 0], [3, 999], [8, 2000], [10, 3000], [6, 3500], [10, 4000], [4, 4550], [10, 5000], [8, 6000], [6, 8000], [4, 9900],
  [4, 12000], [2, 25000]];

// ---------------------------------------------------------------------------------------------------------------------
// The v1 device: v1 state + v1 UI action semantics
// ---------------------------------------------------------------------------------------------------------------------

/** v1 product editor option lists and defaults per app era (f6a6939 = pre-board menu, HEAD = board menu). */
const ERAS = {
  pre: {
    migrates: false,
    groups: ['Small', 'Large', 'Pizza Bites', 'Drinks', 'Combos'],
    newCategory: 'Drinks',
    comboCategory: 'Combos',
    comboDefault: [{productId: 'small', quantity: 2}],
    samples: [['small', 2, 'UPI'], ['large', 1, 'Cash'], ['lemon', 3, 'Cash']],
    sampleNeedsPrices: false,
  },
  board: {
    migrates: true,
    groups: ['Crispy Dhamaka', 'Pizza Pataka', 'Fizz Pataka', 'Combo Pataka'],
    newCategory: 'Fizz Pataka',
    comboCategory: 'Combo Pataka',
    comboDefault: [{productId: 'veggie-small', quantity: 1}],
    samples: [['veggie-small', 2, 'UPI'], ['corn-cheese-large', 1, 'Cash'], ['fizz-sprite', 3, 'Cash']],
    sampleNeedsPrices: true,
  },
};
const ARTS = ['packet', 'corn', 'pizza', 'lemon', 'masala', 'cold'];

/** The pre-board v1 initial state (git f6a6939:dist/domain.mjs), which has no menuVersion and uses p.base presets. */
function preBoardState() {
  const product = (id, name, category, price, art, tint, extra = {}) => ({id, name, category, price, art, tint, active: true, soldOut: false, ...extra});
  return {
    version: 1, revision: 0, mode: 'live', pin: null,
    config: {
      stallName: 'Packet Pataka', stallNumber: '10', eventDate: '2026-11-04', target: 514000, promo: 1000, promoMinimum: 0,
      operator: 'Team Pataka', operators: ['Team Pataka', 'Cashier 1', 'Cashier 2', 'Games crew'], accent: '#FFDD35', inventory: false,
      stock: {small: 50, large: 50, pizza: 0, lemon: 0, masala: 0, cold: 0},
      flavours: ['Lay’s Classic Salted', 'Lay’s Magic Masala', 'Lay’s Cream & Onion', 'Lay’s Tomato Tango', 'Kurkure Masala Munch',
        'Kurkure Chilli Chatka', 'Bingo Mad Angles', 'Bingo Tedhe Medhe'],
      addons: [{id: 'corn', name: 'Sweet Corn', price: 1000}, {id: 'chipotle', name: 'Chipotle Sauce', price: 1000},
        {id: 'tandoori', name: 'Tandoori Sauce', price: 1000}, {id: 'cheese', name: 'Cheese Sauce', price: 1000}],
      games: [{id: 'wheel', name: 'Spin the Wheel', fee: 0}, {id: 'coin', name: 'Coin in the Bucket', fee: 0}],
      products: [
        product('small', 'Small Pataka', 'Small', 3000, 'packet', 'pink', {custom: true, size: 'small', stockKey: 'small', addons: []}),
        product('large', 'Large Pataka', 'Large', 4000, 'packet', 'yellow', {custom: true, size: 'large', stockKey: 'large', addons: []}),
        product('corn', 'Corn Pataka', 'Small', null, 'corn', 'cream', {base: 'small', size: 'small', addons: ['corn'], stockKey: 'small'}),
        product('cheese', 'Cheese Pataka', 'Small', null, 'packet', 'lime', {base: 'small', size: 'small', addons: ['cheese'], stockKey: 'small'}),
        product('corn-cheese', 'Corn Cheese Pataka', 'Large', null, 'packet', 'pink', {base: 'large', size: 'large', addons: ['corn', 'cheese'], stockKey: 'large'}),
        product('pizza', 'Pizza Bites · 5 pcs', 'Pizza Bites', null, 'pizza', 'pink', {stockKey: 'pizza', stockUnits: 5}),
        product('lemon', 'Lemon Soda', 'Drinks', 2000, 'lemon', 'yellow', {stockKey: 'lemon'}),
        product('masala', 'Masala Soda', 'Drinks', 3000, 'masala', 'cream', {stockKey: 'masala'}),
        product('cold', 'Cold Drink', 'Drinks', null, 'cold', 'blue', {stockKey: 'cold'}),
        product('double-small', 'Double Small', 'Combos', null, 'packet', 'lime', {bundle: [{productId: 'small', quantity: 2}]}),
        product('double-large', 'Double Large', 'Combos', null, 'packet', 'yellow', {bundle: [{productId: 'large', quantity: 2}]}),
      ],
    },
    live: V1.session(),
    demo: V1.session(),
  };
}

const S1 = st => st[st.mode];
const hashPin = (pin, salt) => createHash('sha256').update(`${salt}:${pin}`).digest('hex');

class V1Device {
  constructor(seed, {preBoard = false} = {}) {
    this.r = rng(seed);
    this.era = preBoard ? ERAS.pre : ERAS.board;
    // The v1 app ran storage.mutate → migrate() on first load, so a fresh board-era device starts with the board menu.
    this.st = preBoard ? preBoardState() : V1.migrate(V1.initialState());
    this.promo = false; // v1 app.mjs module variable `promo` (what checkout actually used)
    this.clock = EVENT_START + this.r.int(0, 3600) * 1000;
    this.stats = {ok: 0, rejected: 0, actions: {}};
  }

  now() {
    this.clock += this.r.int(15, 540) * 1000;
    return new Date(this.clock).toISOString();
  }

  /** One v1 storage.mutate: migrate (board era) → fn → revision++; any throw rolls the whole write back. */
  commit(name, fn) {
    const before = structuredClone(this.st);
    try {
      if (this.era.migrates) V1.migrate(this.st);
      fn(this.st);
      this.st.revision++;
      this.stats.ok++;
      this.stats.actions[name] = (this.stats.actions[name] || 0) + 1;
      return true;
    } catch (err) {
      // v1 domain/UI only throws plain Error for invalid input; anything else is a bug in this generator.
      if (!(err instanceof Error) || err.constructor !== Error) throw err;
      this.st = before;
      this.stats.rejected++;
      return false;
    }
  }

  price() {
    const {r} = this;
    return r.weighted(PRICES);
  }

  /** v1 'save-product' (productEditor form values default to the product's current values, like the v1 sheet). */
  saveProduct(id, edit = {}) {
    const {r, era} = this;
    const c = this.st.config;
    const existing = c.products.find(p => p.id === id);
    const p0 = existing || {id, name: '', category: era.newCategory, price: null, art: 'cold', tint: 'cream', active: true, stockUnits: 1};
    // <select> falls back to its first option when the stored value isn't offered.
    const selectValue = (options, value) => (options.includes(value) ? value : options[0]);
    const eligible = c.products.filter(x => x.stockKey && !x.base && !x.bundle);
    const form = {
      name: p0.name,
      category: selectValue(era.groups, p0.category),
      art: selectValue(ARTS, p0.art),
      active: !!p0.active,
      soldOut: !!p0.soldOut,
      price: p0.price ?? null,
      base: p0.base ? selectValue(eligible.map(x => x.id), p0.base) : undefined,
      addons: p0.addons || [],
      stockKey: selectValue(['', ...Object.keys(c.stock)], p0.stockKey || ''),
      stockUnits: p0.stockUnits || 1,
      bundle: eligible.map(x => ({productId: x.id, quantity: p0.bundle?.find(b => b.productId === x.id)?.quantity || 0})),
      ...edit,
    };
    if (form.base !== undefined && r.chance(0.2)) form.base = r.pick(eligible).id;
    if (form.base !== undefined && r.chance(0.3)) form.addons = c.addons.filter(() => r.chance(0.4)).map(a => a.id);
    this.commit(existing ? 'edit-product' : 'new-product', st => {
      if (!form.name.trim()) throw Error('Give this product a name.');
      let p = st.config.products.find(x => x.id === id);
      if (!p) {
        p = {id, tint: 'cream', addons: []};
        st.config.products.push(p);
      }
      const before = structuredClone(p);
      Object.assign(p, {name: form.name.trim(), category: form.category, art: form.art, active: form.active, soldOut: form.soldOut});
      if (p.base) {
        p.base = form.base;
        p.size = p.base;
        p.stockKey = p.base;
        p.addons = form.addons;
      } else p.price = form.price;
      if (p.bundle) {
        p.bundle = st.config.products.filter(x => x.stockKey && !x.base && !x.bundle)
          .map(x => ({productId: x.id, quantity: V1.integer(form.bundle.find(b => b.productId === x.id)?.quantity ?? 0)}))
          .filter(x => x.quantity);
        if (!p.bundle.length) throw Error('Choose at least one combo component.');
      } else if (!p.base) {
        p.stockKey = form.stockKey;
        p.stockUnits = V1.integer(Number(form.stockUnits), 1);
      }
      V1.audit(S1(st), 'product-updated', p.id, st.config.operator, {before, after: structuredClone(p)}, this.now());
    });
  }

  editProduct() {
    const {r} = this;
    const c = this.st.config;
    const p = r.pick(c.products);
    const edit = {};
    if (!p.base && r.chance(0.8)) edit.price = r.chance(0.08) ? null : this.price();
    if (r.chance(0.1)) edit.active = !p.active;
    if (r.chance(0.12)) edit.soldOut = !p.soldOut;
    if (r.chance(0.08)) edit.name = r.pick(PRODUCT_NAMES);
    if (r.chance(0.05)) edit.category = r.pick(this.era.groups);
    if (r.chance(0.05)) edit.art = r.pick(ARTS);
    if (!p.bundle && !p.base && r.chance(0.1)) edit.stockKey = r.pick(['', ...Object.keys(c.stock)]);
    if (!p.bundle && !p.base && r.chance(0.1)) edit.stockUnits = r.int(1, 4);
    if (p.bundle && r.chance(0.3)) {
      const eligible = c.products.filter(x => x.stockKey && !x.base && !x.bundle);
      edit.bundle = eligible.map(x => ({productId: x.id, quantity: r.chance(0.25) ? r.int(1, 3) : 0}));
    }
    this.saveProduct(p.id, edit);
  }

  newProduct() {
    const {r} = this;
    const c = this.st.config;
    this.saveProduct(uuid(), {
      name: r.pick(PRODUCT_NAMES),
      category: r.pick(this.era.groups),
      art: r.pick(ARTS),
      active: r.chance(0.9),
      soldOut: r.chance(0.05),
      price: r.chance(0.15) ? null : this.price(),
      stockKey: r.pick(['', ...Object.keys(c.stock)]),
      stockUnits: r.int(1, 3),
    });
  }

  newCombo() {
    const {r, era} = this;
    let id = null;
    this.commit('new-combo', st => {
      id = uuid();
      st.config.products.push({id, name: 'New combo', category: era.comboCategory, price: null, active: false, art: 'packet', tint: 'yellow',
        bundle: structuredClone(era.comboDefault)});
    });
    if (!id || r.chance(0.15)) return; // owner closed the editor: an inactive, unpriced combo stays behind
    const eligible = this.st.config.products.filter(x => x.stockKey && !x.base && !x.bundle);
    this.saveProduct(id, {
      name: r.pick(['Pataka + Fizz', 'Party Pack 🎉', 'दो पटाका', 'Mega Combo']),
      price: r.chance(0.1) ? null : r.weighted([[1, 4000], [3, 7000], [3, 9900], [2, 12000], [1, 15000]]),
      active: r.chance(0.9),
      bundle: eligible.map(x => ({productId: x.id, quantity: r.chance(0.3) ? r.int(1, 2) : 0})),
    });
  }

  /** v1 'save-addons' (add-on names/prices, one new topping, flavour lines). */
  addons() {
    const {r} = this;
    this.commit('save-addons', st => {
      for (const x of st.config.addons) {
        if (r.chance(0.2)) x.name = r.pick(['Extra Cheese', 'Mayo', 'पनीर', 'Jalapeño 🌶️']);
        if (r.chance(0.3)) x.price = r.pick([500, 1000, 1500, 2000]);
      }
      if (r.chance(0.5)) st.config.addons.push({id: uuid(), name: r.pick(['Extra Cheese', 'Peri Peri Sprinkle', 'Mayo dip']), price: r.pick([0, 500, 1000, 2000])});
      const lines = [];
      for (let i = r.int(0, 9); i > 0; i--) lines.push(r.pick(FLAVOURS));
      if (r.chance(0.08)) lines.push(fill('Lay’s Limited Edition Desi Masala Tadka Flavour ', 60)); // textarea has no maxlength
      st.config.flavours = lines.map(s => s.trim()).filter(Boolean);
      if (!st.config.flavours.length) throw Error('Keep at least one packet flavour.');
      V1.audit(S1(st), 'addons-updated', 'catalog', st.config.operator, {}, this.now());
    });
  }

  /** v1 'save-stock'. */
  stock() {
    const {r} = this;
    this.commit('save-stock', st => {
      const used = V1.stockUsed(S1(st));
      for (const key of Object.keys(st.config.stock)) {
        const n = r.chance(0.6) ? st.config.stock[key] : (used[key] || 0) + r.int(r.chance(0.1) ? -2 : 0, 120);
        if (n < (used[key] || 0)) throw Error(`${key} cannot be lower than stock already used.`);
        st.config.stock[key] = V1.integer(n);
      }
      st.config.inventory = r.chance(0.5) ? !st.config.inventory : st.config.inventory;
      V1.audit(S1(st), 'inventory-updated', 'stock', st.config.operator, {stock: structuredClone(st.config.stock)}, this.now());
    });
  }

  /** v1 'save-settings'. */
  settings() {
    const {r} = this;
    this.commit('save-settings', st => {
      const c = st.config;
      const before = structuredClone(c);
      if (r.chance(0.3)) c.stallName = r.pick(STALL_NAMES);
      if (r.chance(0.2)) c.stallNumber = r.pick(['10', 'B-12', '7A', '12345678']);
      if (r.chance(0.2)) c.eventDate = r.pick(['2026-11-04', '2026-11-05', '2027-01-26']);
      if (r.chance(0.3)) c.operator = r.chance(0.5) ? r.pick(OPERATORS) : r.pick(['Viraj', 'Owner ji', fill('Shift lead on the evening counter ', 40)]);
      if (r.chance(0.4)) c.target = r.weighted([[6, 514000], [3, 300000], [3, 1200000], [1, 100], [1, 100000000]]);
      if (r.chance(0.4)) c.promo = r.weighted([[3, 0], [6, 1000], [3, 2000], [1, 5000], [1, 550]]);
      if (r.chance(0.3)) c.promoMinimum = r.weighted([[5, 0], [2, 10000], [1, 5000]]);
      if (r.chance(0.3)) {
        const list = OPERATORS.filter(() => r.chance(0.5));
        if (r.chance(0.1) && list.length) list.push(list[0]); // the same name typed twice
        if (r.chance(0.05)) list.push(fill('Ramesh Bhaiya from the decoration committee ', 50)); // textarea: no maxlength
        c.operators = list;
      }
      if (r.chance(0.2)) c.accent = `#${r.int(0, 0xffffff).toString(16).padStart(6, '0')}`;
      for (const g of c.games) if (r.chance(0.3)) g.fee = r.pick([0, 0, 1000, 2000, 3000]);
      if (c.target <= 0) throw Error('Recovery target must be greater than zero.');
      V1.audit(S1(st), 'settings-updated', 'settings', c.operator, {before, after: structuredClone(c)}, this.now());
      V1.refreshMilestones(st.live, c, this.now());
      V1.refreshMilestones(st.demo, c, this.now());
    });
  }

  pin() {
    const pin = String(this.r.int(1000, 99999999));
    this.commit('set-pin', st => {
      const salt = uuid();
      st.pin = {salt, hash: hashPin(pin, salt)};
    });
  }

  switchOperator() {
    const c = this.st.config;
    if (!c.operators.length) return;
    const op = this.r.pick(c.operators);
    this.commit('save-operator', st => {
      st.config.operator = op;
    });
  }

  switchMode() {
    this.commit('mode', st => {
      st.mode = st.mode === 'live' ? 'demo' : 'live';
    });
    this.promo = !!S1(this.st).draftPromo;
  }

  /** v1 'product' / 'add-custom' + addLine merge. */
  addToCart() {
    const {r} = this;
    const c = this.st.config;
    const visible = c.products.filter(p => p.active);
    if (!visible.length) return;
    const priced = visible.filter(p => V1.unitPrice(p, c) !== null);
    const p = priced.length && r.chance(0.92) ? r.pick(priced) : r.pick(visible);
    const options = p.custom
      ? {id: r.pick(['small', 'large']), quantity: r.int(1, 3), flavour: r.pick(c.flavours), addons: c.addons.filter(() => r.chance(0.3)).map(a => a.id)}
      : {id: p.id};
    this.commit('add-line', st => {
      const line = V1.makeLine(st.config, options.id, options);
      const d = S1(st).draft;
      const key = l => JSON.stringify([l.productId, l.unitPrice, l.flavour, l.addons.map(a => a.id).sort()]);
      const existing = d.find(l => key(l) === key(line));
      if (existing) {
        V1.integer(existing.quantity + line.quantity, 1);
        if (existing.quantity + line.quantity > 999) throw Error('Maximum quantity is 999.');
        existing.quantity += line.quantity;
        existing.lineTotal = existing.unitPrice * existing.quantity;
      } else d.push(line);
    });
  }

  /** v1 'qty' / 'remove'. */
  cartQuantity() {
    const {r} = this;
    const draft = S1(this.st).draft;
    if (!draft.length) return;
    const id = r.pick(draft).id;
    const remove = r.chance(0.15);
    const delta = r.chance(0.7) ? 1 : -1;
    this.commit('qty', st => {
      const s = S1(st);
      const l = s.draft.find(x => x.id === id);
      if (!l) return;
      if (remove || l.quantity + delta <= 0) s.draft = s.draft.filter(x => x.id !== id);
      else {
        l.quantity = Math.min(999, l.quantity + delta);
        l.lineTotal = l.quantity * l.unitPrice;
      }
      if (!s.draft.length) s.draftId = uuid();
    });
  }

  togglePromo() {
    this.commit('promo', st => {
      S1(st).draftPromo = !S1(st).draftPromo;
    });
    this.promo = !!S1(this.st).draftPromo;
  }

  /** v1 'complete'. */
  checkout() {
    const {r} = this;
    const s = S1(this.st);
    if (!s.draft.length) return;
    const method = r.weighted([[50, 'Cash'], [38, 'UPI'], [12, 'Other']]);
    const pending = r.chance(0.12);
    const total = V1.totals(s.draft, this.st.config, this.promo).total;
    let cashReceived = null;
    if (!pending && method === 'Cash' && r.chance(0.55)) {
      cashReceived = r.chance(0.05) ? Math.max(0, total - 100) : total + r.pick([0, 0, 1000, 5000, 10000, 50000 - (total % 50000)]);
    }
    const promo = this.promo;
    const ok = this.commit('checkout', st => {
      const ss = S1(st);
      return V1.createOrder(ss, st.config, {id: ss.draftId, items: ss.draft, promo, method, pending, cashReceived}, this.now());
    });
    if (ok) this.promo = false;
  }

  markPaid() {
    const pending = S1(this.st).orders.filter(o => o.status === 'pending');
    if (!pending.length) return;
    const id = this.r.pick(pending).id;
    const method = this.r.pick(['Cash', 'UPI', 'Other']);
    this.commit('mark-paid', st => V1.markPaid(S1(st), st.config, id, method, this.now()));
  }

  correct() {
    const {r} = this;
    const s = S1(this.st);
    const open = s.orders.filter(o => o.status !== 'void');
    if (!open.length) return;
    const o = r.pick(open);
    const net = V1.netFor(s, o.id);
    const type = o.status === 'pending' || r.chance(0.3) ? 'void' : 'refund';
    const amount = type === 'refund' ? (r.chance(0.3) ? net : r.chance(0.05) ? net + 100 : r.int(1, Math.max(1, net))) : 0;
    const reason = r.chance(0.03) ? '   ' : r.pick(REASONS);
    this.commit(type, st => V1.correctOrder(S1(st), st.config, o.id, {type, amount, reason}, this.now()));
  }

  playGame() {
    const {r} = this;
    const g = r.pick(this.st.config.games);
    const method = g.fee ? r.weighted([[6, 'Cash'], [3, 'UPI'], [1, 'Other']]) : 'Cash';
    const prize = r.pick(PRIZES);
    this.commit('game', st => V1.addGame(S1(st), st.config, {id: uuid(), gameId: g.id, prize, method}, this.now()));
  }

  reverseGame() {
    const games = S1(this.st).games.filter(g => !g.void);
    if (!games.length) return;
    const id = this.r.pick(games).id;
    const reason = this.r.pick(REASONS);
    this.commit('game-void', st => V1.voidGame(S1(st), st.config, id, reason));
  }

  expense() {
    const {r} = this;
    const amount = r.weighted([[1, 0], [6, r.int(1000, 50000)], [1, r.int(1, 99)]]);
    const description = r.pick(DESCRIPTIONS);
    const category = r.pick(['Ingredients', 'Packaging', 'Supplies', 'Other']);
    const key = uuid();
    this.commit('expense', st => {
      if (!amount || !description.trim()) throw Error('Enter an amount and description.');
      const s = S1(st);
      if (s.expenses.some(e => e.id === key)) return;
      const e = {id: key, category, amount, description: description.trim(), at: this.now(), operator: st.config.operator};
      s.expenses.push(e);
      V1.audit(s, 'expense-recorded', e.id, st.config.operator, {amount}, e.at);
    });
  }

  /** v1 'sample-data' (practice mode only). */
  sampleData() {
    const {era} = this;
    this.commit('sample-data', st => {
      if (st.mode !== 'demo' || st.demo.orders.length || st.demo.draft.length) throw Error('Use an empty practice ledger and cart to load samples.');
      if (era.sampleNeedsPrices && st.config.products.some(p => p.active && V1.unitPrice(p, st.config) === null)) {
        throw Error('Set prices for the menu before loading practice sales.');
      }
      for (const [id, quantity, method] of era.samples) {
        V1.createOrder(st.demo, st.config, {id: uuid(), items: [V1.makeLine(st.config, id, {quantity})], method}, this.now());
      }
      V1.addGame(st.demo, st.config, {id: uuid(), gameId: 'wheel', method: 'Cash'}, this.now());
    });
  }

  /** v1 'do-reset' (typed confirmation). */
  reset(mode) {
    this.commit('ledger-reset', st => {
      st[mode] = V1.session();
      V1.audit(st[mode], 'ledger-reset', mode, st.config.operator, {}, this.now());
    });
    this.promo = false;
  }

  startLive() {
    this.commit('start-live', st => {
      if (st.config.products.some(p => p.active && V1.unitPrice(p, st.config) === null)) throw Error('Configure or hide every unpriced active product.');
      st.mode = 'live';
      st.live.started = true;
      V1.audit(st.live, 'event-started', 'event', st.config.operator, {}, this.now());
    });
    this.promo = false;
  }

  /** Price most of the menu like an owner on the morning of the event. */
  setupMenu() {
    const {r} = this;
    const share = r.pick([0.6, 0.85, 1, 1]);
    for (const p of [...this.st.config.products]) {
      if (p.base || !r.chance(share)) continue;
      this.saveProduct(p.id, {price: p.bundle ? r.pick([6000, 7000, 9900]) : this.price(), active: r.chance(0.95), soldOut: r.chance(0.03)});
    }
  }

  step() {
    const {r} = this;
    const pre = !this.era.migrates;
    const action = r.weighted([
      [30, 'addToCart'], [6, 'cartQuantity'], [5, 'togglePromo'], [22, 'checkout'], [3, 'markPaid'], [4, 'correct'],
      [5, 'playGame'], [1, 'reverseGame'], [2, 'expense'], [3, 'editProduct'], [pre ? 0 : 0.6, 'newProduct'],
      [pre ? 0 : 0.5, 'newCombo'], [0.6, 'addons'], [1, 'stock'], [1.2, 'settings'], [0.2, 'pin'], [1, 'switchOperator'],
      [1.2, 'switchMode'], [0.6, 'sampleData'], [0.12, 'resetLive'], [0.3, 'resetDemo'], [0.5, 'startLive'], [0.5, 'reload'],
    ]);
    if (action === 'resetLive') this.reset('live');
    else if (action === 'resetDemo') this.reset('demo');
    else if (action === 'reload') this.promo = !!S1(this.st).draftPromo; // v1 init(): promo = !!S().draftPromo
    else this[action]();
  }
}

/**
 * Build a realistic v1 state for one seed.
 * @param {number} seed
 * @param {{preBoard?: boolean}} [options]
 */
function simulate(seed, {preBoard = false} = {}) {
  const dev = new V1Device(seed, {preBoard});
  const {r} = dev;
  if (r.chance(0.9)) dev.setupMenu();
  if (r.chance(0.5)) dev.settings();
  if (r.chance(0.3)) dev.pin();
  if (r.chance(0.4)) dev.startLive();
  const steps = r.int(40, 170);
  for (let i = 0; i < steps; i++) {
    dev.step();
    // Pre-board devices later updated to the board-era v1 app (storage.mutate starts running v1 migrate, which keeps the
    // pre-board menu only when records exist).
    if (preBoard && !dev.era.migrates && i > steps / 2 && r.chance(0.05)) dev.era = {...ERAS.board, migrates: true};
  }
  // Leave something in the cart (with or without the promo) like a phone closed mid-order.
  if (r.chance(0.6)) for (let i = r.int(1, 3); i > 0; i--) dev.addToCart();
  if (r.chance(0.4)) dev.togglePromo();
  if (r.chance(0.3)) dev.switchMode();
  return dev;
}

// ---------------------------------------------------------------------------------------------------------------------
// The upgrade checks
// ---------------------------------------------------------------------------------------------------------------------

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const pendingOf = s => {
  const p = s.orders.filter(o => o.status === 'pending');
  return {count: p.length, amount: sum(p, o => o.total)};
};
const bestPairs = best => best.map(b => `${b.units}:${b.revenue}`).sort();

/** Every money/count number of v1's own report(). */
function v1Numbers(s, c) {
  const r = V1.report(s, c);
  return {
    collected: r.collected, food: r.food, methods: r.methods, orders: r.orders, units: r.units, average: r.average, gross: r.gross,
    // v1 computes refunds as −Σ(negatives), which is −0 for an empty ledger; + 0 normalizes it.
    discounts: r.discounts, refunds: r.refunds + 0, games: r.games, gameIncome: r.gameIncome, expenses: r.expenses, pending: pendingOf(s),
    categories: r.categories, hourly: nonZeroHours(r.hourly), best: bestPairs(r.best),
  };
}

function v2Numbers(s, c) {
  const r = report(s, c);
  return {
    collected: r.collected, food: r.food, methods: r.methods, orders: r.orders, units: r.units, average: r.average, gross: r.gross,
    discounts: r.discounts, refunds: r.refunds, games: r.games, gameIncome: r.gameIncome, expenses: r.expenses, pending: r.pending,
    categories: r.categories, hourly: nonZeroHours(r.hourly), best: bestPairs(r.best),
  };
}

const LATER = '2026-11-05T15:00:00.000Z';

/**
 * Upgrade one v1 state and prove the money survived. Returns coverage counters.
 * @param {any} v1 the v1 state (never mutated)
 * @param {string} label
 */
function checkUpgrade(v1, label) {
  const msg = what => `${label}: ${what}`;
  const v1c = v1.config;
  const m = migrate(structuredClone(v1));
  const c = m.config;

  assert.doesNotThrow(() => validateConfig(structuredClone(c)), msg('validateConfig'));
  assert.equal(m.version, 2, msg('version'));
  assert.equal(m.mode, v1.mode, msg('mode'));
  assert.deepEqual(m.pin, v1.pin ?? null, msg('pin unchanged'));
  assert.equal(c.mission.total, v1c.target, msg('mission total = v1 target'));

  for (const mode of ['live', 'demo']) {
    const s1 = v1[mode];
    const s2 = m[mode];
    const where = what => msg(`${mode} ${what}`);

    // Reports: every v1 money/count field.
    assert.deepEqual(v2Numbers(s2, c), v1Numbers(s1, v1c), where('report numbers'));
    const r2 = report(s2, c);
    assert.equal(r2.mission.collected, V1.report(s1, v1c).collected, where('mission collected'));
    assert.equal(r2.mission.target, v1c.target + sum(s1.expenses, e => e.amount), where('break-even = target + expenses (§14)'));

    // Per-entity balances, ledger rows and stock.
    for (const x of [...s1.orders, ...s1.games]) assert.equal(netFor(s2, x.id), V1.netFor(s1, x.id), where(`net of ${x.id}`));
    assert.deepEqual(s2.payments, s1.payments.filter(p => p.amount !== 0), where('payment ledger (minus ₹0 rows)'));
    assert.deepEqual(stockUsed(s2), V1.stockUsed(s1), where('stockUsed'));
    assert.equal(s2.orders.length, s1.orders.length, where('order count'));
    for (const [i, o] of s2.orders.entries()) {
      const old = s1.orders[i];
      for (const k of ['id', 'number', 'at', 'operator', 'subtotal', 'discount', 'total', 'status', 'method', 'cashReceived', 'change']) {
        assert.deepEqual(o[k], old[k], where(`order ${old.number} ${k}`));
      }
      assert.deepEqual(o.items, old.items.map(l => ({...l, note: ''})), where(`order ${old.number} items`));
      if (o.discount > 0) assert.ok(o.discountInfo && o.discountInfo.type === 'flat', where(`order ${old.number} discount snapshot`));
      else assert.equal(o.discountInfo, null, where(`order ${old.number} no discount snapshot`));
    }
    assert.deepEqual(s2.games, s1.games, where('game plays'));
    assert.deepEqual(s2.expenses, s1.expenses.map(upgradedExpense), where('expenses (upgraded to Phase-2 bills, §16.1)'));
    assert.deepEqual(s2.audit, s1.audit, where('audit trail'));

    // Milestones: stored unlock history carries over; re-evaluation agrees with v1.
    for (const [id, rec] of Object.entries(s1.milestones || {})) {
      assert.equal(s2.milestones[id].active, rec.active, where(`stored milestone ${id}`));
      assert.equal(s2.milestones[id].unlockedAt, rec.unlockedAt, where(`milestone ${id} unlockedAt`));
    }
    const rules1 = V1.refreshMilestones(structuredClone(s1), v1c, LATER);
    const rules2 = refreshMilestones(structuredClone(s2), c, LATER);
    for (const id of ['spark', 'game', 'crowd']) assert.equal(rules2[id], rules1[id], where(`milestone ${id}`));
    if (!sum(s1.expenses, e => e.amount)) assert.equal(rules2.big, rules1.big, where('milestone big (no expenses)'));

    // Cart survives with the same totals.
    assert.equal(s2.draftId, s1.draftId, where('draftId'));
    assert.deepEqual(s2.draft, s1.draft.map(l => ({...l, note: ''})), where('draft lines'));
    assert.deepEqual(s2.draftDiscount, s1.draftPromo && v1c.promo > 0 ? {ruleId: 'promo'} : null, where('draftDiscount'));
    const t1 = V1.totals(s1.draft, v1c, !!s1.draftPromo);
    const t2 = draftTotals(s2, c);
    assert.deepEqual([t2.subtotal, t2.discount, t2.total], [t1.subtotal, t1.discount, t1.total], where('draft totals'));

    // Differential checkout of the saved cart: whenever v1 could complete it, v2 completes it for the same money.
    if (s1.draft.length) {
      let v1Order = null;
      try {
        v1Order = V1.createOrder(structuredClone(s1), structuredClone(v1c), {id: s1.draftId, items: s1.draft, promo: !!s1.draftPromo, method: 'UPI'}, LATER);
      } catch {
        v1Order = null;
      }
      if (v1Order) {
        const s = structuredClone(s2);
        const o = createOrder(s, c, {id: s.draftId, items: s.draft, discount: s.draftDiscount, method: 'UPI'}, LATER);
        assert.deepEqual([o.subtotal, o.discount, o.total], [v1Order.subtotal, v1Order.discount, v1Order.total], where('draft checkout'));
      }
    }
  }

  // Backups: the raw v1 state (IndexedDB clone and v1 JSON export) and the v2 export all validate.
  const fromV1 = validateBackup(structuredClone(v1));
  assert.deepEqual(v2Numbers(fromV1.state.live, fromV1.state.config), v1Numbers(v1.live, v1c), msg('validateBackup(v1) live numbers'));
  const fromJson = validateBackup(JSON.parse(JSON.stringify(v1)));
  assert.deepEqual(v2Numbers(fromJson.state.demo, fromJson.state.config), v1Numbers(v1.demo, v1c), msg('validateBackup(v1 JSON) demo numbers'));
  const round = validateBackup(JSON.parse(JSON.stringify(exportBackup(m, {}))));
  assert.deepEqual(round.warnings, [], msg('no backup warnings'));
  assert.deepEqual(v2Numbers(round.state.live, round.state.config), v2Numbers(m.live, c), msg('v2 backup round trip'));

  // Idempotent.
  assert.deepEqual(migrate(structuredClone(m)), m, msg('migrate is idempotent'));
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(m))), JSON.parse(JSON.stringify(m)), msg('migrate idempotent after JSON'));

  // The migrated stall keeps selling, confirming, refunding and backing up.
  const st = structuredClone(m);
  const s = st[st.mode];
  const before = report(s, st.config).collected;
  const product = st.config.products.find(p => !p.bundle && sellability(s, st.config, p).ok) ||
    st.config.products.find(p => sellability(s, st.config, p).ok);
  let sold = false;
  if (product) {
    const line = makeLine(st.config, product.id, {quantity: 2});
    const order = createOrder(s, st.config, {id: uuid(), items: [line], method: 'Cash', cashReceived: line.lineTotal + 1000}, LATER);
    assert.equal(report(s, st.config).collected, before + order.total, msg('a new sale is collected'));
    sold = true;
  }
  const pending = s.orders.find(o => o.status === 'pending');
  if (pending) markPaid(s, st.config, pending.id, {method: pending.total > 1 ? 'Split' : 'UPI', split: pending.total > 1 ? {Cash: 1, UPI: pending.total - 1} : null}, LATER);
  const refundable = s.orders.find(o => (o.status === 'paid' || o.status === 'partial') && netFor(s, o.id) > 0 && o.method !== 'Split');
  if (refundable) correctOrder(s, st.config, refundable.id, {type: 'refund', amount: 1, reason: 'Post-upgrade check'}, LATER);
  const game = st.config.games[0];
  if (game) {
    const playId = uuid();
    addGame(s, st.config, {id: playId, gameId: game.id, method: 'UPI'}, LATER);
    voidGame(s, st.config, playId, 'Post-upgrade check', LATER);
  }
  addExpense(s, st.config, {id: uuid(), category: 'Other', amount: 100, description: 'Post-upgrade check'}, LATER);
  const after = validateBackup(JSON.parse(JSON.stringify(exportBackup(st, {}))));
  assert.equal(report(after.state[st.mode], after.state.config).collected, report(s, st.config).collected, msg('post-upgrade backup'));

  return {sold, pending: !!pending, refundable: !!refundable};
}

/** Coverage counters across seeds, so the generator can't silently stop exercising a path. */
function coverage(st, cov) {
  for (const mode of ['live', 'demo']) {
    const s = st[mode];
    for (const o of s.orders) {
      cov[`status:${o.status}`] = (cov[`status:${o.status}`] || 0) + 1;
      if (o.total === 0) cov.zeroTotal = (cov.zeroTotal || 0) + 1;
      if (o.discount > 0) cov.discounted = (cov.discounted || 0) + 1;
      if (o.cashReceived !== null) cov.cashReceived = (cov.cashReceived || 0) + 1;
      if (o.items.some(l => l.bundle)) cov.comboOrders = (cov.comboOrders || 0) + 1;
    }
    cov.gamesVoid = (cov.gamesVoid || 0) + s.games.filter(g => g.void).length;
    cov.paidGames = (cov.paidGames || 0) + s.games.filter(g => g.fee > 0).length;
    cov.expenses = (cov.expenses || 0) + s.expenses.length;
    if (s.draft.length) cov.drafts = (cov.drafts || 0) + 1;
    if (s.draftPromo) cov.draftPromo = (cov.draftPromo || 0) + 1;
    if (s.audit.some(a => a.type === 'ledger-reset')) cov.resets = (cov.resets || 0) + 1;
  }
  if (st.pin) cov.pins = (cov.pins || 0) + 1;
  if (st.mode === 'demo') cov.demoMode = (cov.demoMode || 0) + 1;
  if (!st.config.operators.includes(st.config.operator)) cov.operatorOutsideList = (cov.operatorOutsideList || 0) + 1;
  if (st.config.products.some(p => p.base)) cov.presets = (cov.presets || 0) + 1;
  if (st.config.inventory) cov.inventory = (cov.inventory || 0) + 1;
  if (st.config.promo === 0) cov.promoZero = (cov.promoZero || 0) + 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------------

test(`fuzz: ${SEEDS} board-era v1 devices upgrade losslessly (seeds ${START}…${START + SEEDS - 1})`, t => {
  const cov = {};
  let sold = 0;
  for (let seed = START; seed < START + SEEDS; seed++) {
    const dev = simulate(seed);
    coverage(dev.st, cov);
    assert.doesNotThrow(() => V1.validateBackup(structuredClone(dev.st)), `seed ${seed}: generator produced a state v1 itself accepts`);
    if (checkUpgrade(dev.st, `seed ${seed}`).sold) sold++;
  }
  t.diagnostic(`coverage ${JSON.stringify(cov)} · still selling after upgrade: ${sold}/${SEEDS}`);
  assert.ok(sold >= SEEDS * 0.8, 'most migrated stalls can sell right away');
  if (SEEDS >= 40) {
    for (const k of ['status:paid', 'status:partial', 'status:refunded', 'status:void', 'status:pending', 'zeroTotal', 'discounted', 'cashReceived',
      'comboOrders', 'gamesVoid', 'paidGames', 'expenses', 'drafts', 'draftPromo', 'resets', 'pins', 'demoMode', 'operatorOutsideList', 'inventory']) {
      assert.ok(cov[k] > 0, `generator covers ${k}`);
    }
  }
});

test('fuzz: pre-board v1 devices (no menuVersion, p.base presets, custom packets) upgrade losslessly', t => {
  const cov = {};
  const n = Math.max(8, Math.round(SEEDS / 4));
  for (let seed = START; seed < START + n; seed++) {
    const dev = simulate(10_000 + seed, {preBoard: true});
    coverage(dev.st, cov);
    checkUpgrade(dev.st, `pre-board seed ${10_000 + seed}`);
  }
  t.diagnostic(`coverage ${JSON.stringify(cov)}`);
  assert.ok(cov.presets > 0, 'some pre-board stalls keep presets');
});

test('edge: preset products become plain products priced base + preset add-ons', () => {
  const v1 = preBoardState();
  const m = migrate(structuredClone(v1));
  const byId = Object.fromEntries(m.config.products.map(p => [p.id, p]));
  assert.equal(byId.corn.price, 3000 + 1000);
  assert.equal(byId['corn-cheese'].price, 4000 + 2000);
  assert.equal(byId.corn.stockKey, 'small');
  assert.equal(byId.cold.tint, 'sky', 'v1 blue → sky');
  assert.equal(byId.small.customizable, true);
  assert.equal(byId.pizza.stockUnits, 5);
  assert.deepEqual(byId['double-small'].bundle, [{productId: 'small', quantity: 2}]);
  assert.equal(m.onboarded, true, 'priced products → onboarded');
  checkUpgrade(v1, 'pre-board initial');
  // A v1 line for a preset (made by v1 makeLine) keeps its snapshot; the new v2 line costs the same.
  const line1 = V1.makeLine(v1.config, 'corn-cheese', {quantity: 2});
  const line2 = makeLine(m.config, 'corn-cheese', {quantity: 2});
  assert.equal(line2.lineTotal, line1.lineTotal);
  assert.deepEqual(line2.stock, line1.stock);
});

test('edge: a preset whose base is a uuid product still produces a valid config', () => {
  const v1 = preBoardState();
  const id = '0f3c8a52-1d2e-4c55-9a4b-7d1e2f3a4b5c';
  v1.config.products.push({id, name: 'Nachos', category: 'Drinks', price: 5000, art: 'packet', tint: 'cream', active: true, soldOut: false,
    stockKey: 'small', stockUnits: 1, addons: []});
  // v1 save-product on a preset: p.base = chosen base id; p.size = p.base; p.stockKey = p.base.
  Object.assign(v1.config.products.find(p => p.id === 'corn'), {base: id, size: id, stockKey: id});
  assert.doesNotThrow(() => V1.validateBackup(structuredClone(v1)));
  const m = migrate(structuredClone(v1));
  assert.doesNotThrow(() => validateConfig(m.config));
  assert.equal(m.config.products.find(p => p.id === 'corn').price, 5000 + 1000);
  checkUpgrade(v1, 'uuid preset base');
});

test('edge: fresh, empty v1 devices (live and practice mode)', () => {
  for (const mode of ['live', 'demo']) {
    const v1 = V1.migrate(V1.initialState());
    v1.mode = mode;
    const m = migrate(structuredClone(v1));
    assert.equal(m.onboarded, false, 'nothing recorded and nothing priced → onboarding opens');
    assert.equal(m.mode, mode);
    checkUpgrade(v1, `empty ${mode}`);
  }
  // Pre-board backup that the board-era v1 app never loaded: no menuVersion, no records.
  const pre = preBoardState();
  delete pre.config.menuVersion;
  checkUpgrade(pre, 'pre-board empty');
});

test('edge: unknown extra fields are tolerated and money is unchanged', () => {
  const dev = simulate(4242);
  const v1 = structuredClone(dev.st);
  v1.experimental = {theme: 'dark'};
  v1.config.legacyFlag = true;
  v1.config.products[0].emoji = '🔥';
  v1.live.extra = [1, 2, 3];
  if (v1.live.orders[0]) v1.live.orders[0].printed = true;
  if (v1.live.draft[0]) v1.live.draft[0].custom = 'x';
  checkUpgrade(v1, 'extra fields');
});

test('edge: promo 0 with a promo-flagged cart, huge and tiny targets, long v1 text at its limits', () => {
  const v1 = V1.migrate(V1.initialState());
  const c = v1.config;
  for (const p of c.products) p.price = p.bundle ? 9900 : 4000;
  c.stallName = fill('पटाका 🎆 Stall ', 50);
  c.stallNumber = '12345678';
  c.operator = fill('Operator naam bahut lamba hai 🎉 ', 40);
  c.target = 100000000;
  c.promo = 0;
  const s = v1.live;
  const line = V1.makeLine(c, 'veggie-small', {quantity: 3});
  const o = V1.createOrder(s, c, {id: uuid(), items: [line], promo: true, method: 'Cash', cashReceived: 50000}, '2026-11-04T13:00:00.000Z');
  assert.equal(o.discount, 0);
  V1.correctOrder(s, c, o.id, {type: 'refund', amount: 1, reason: fill('ग्राहक ने कहा पैकेट खुला था 😕 ', 200)}, '2026-11-04T13:05:00.000Z');
  V1.addGame(s, c, {id: uuid(), gameId: 'wheel', prize: fill('Mega teddy bear 🧸 ', 120), method: 'Cash'}, '2026-11-04T13:06:00.000Z');
  s.expenses.push({id: uuid(), category: 'Other', amount: 1, description: fill('Chillar for change ', 150), at: '2026-11-04T13:07:00.000Z', operator: c.operator});
  s.draft.push(V1.makeLine(c, 'combo-veggie-fizz'));
  s.draftPromo = true;
  const m = checkUpgrade(v1, 'promo 0 / limits');
  assert.equal(m.sold, true);
  const st = migrate(structuredClone(v1));
  assert.deepEqual(st.config.discounts, []);
  assert.equal(st.live.draftDiscount, null);
  assert.equal(st.config.mission.total, 100000000);
  assert.equal(st.config.profile.booth, 'Stall No. 12345678');

  c.target = 1; // ₹0.01: the big milestone is reached by the first rupee
  checkUpgrade(v1, 'tiny target');
});

test('edge: ₹0 orders (promo ≥ item price) leave ₹0 payment rows in v1; the upgrade keeps every rupee', () => {
  const v1 = V1.migrate(V1.initialState());
  const c = v1.config;
  for (const p of c.products) p.price = 999; // ₹9.99, below the default ₹10 promo
  const s = v1.live;
  const at = i => new Date(EVENT_START + i * 60000).toISOString();
  const zero = V1.createOrder(s, c, {id: uuid(), items: [V1.makeLine(c, 'fizz-sprite')], promo: true, method: 'UPI'}, at(1));
  assert.equal(zero.total, 0);
  assert.equal(s.payments.at(-1).amount, 0, 'v1 writes a ₹0 payment row');
  const pend = V1.createOrder(s, c, {id: uuid(), items: [V1.makeLine(c, 'fizz-fanta')], promo: true, method: 'Cash', pending: true}, at(2));
  V1.markPaid(s, c, pend.id, 'Other', at(3));
  const voided = V1.createOrder(s, c, {id: uuid(), items: [V1.makeLine(c, 'fizz-fanta')], promo: true, method: 'Cash'}, at(4));
  V1.correctOrder(s, c, voided.id, {type: 'void', reason: 'Dropped'}, at(5));
  V1.createOrder(s, c, {id: uuid(), items: [V1.makeLine(c, 'veggie-small', {quantity: 2})], promo: true, method: 'Cash'}, at(6));
  assert.doesNotThrow(() => V1.validateBackup(structuredClone(v1)), 'v1 accepts its own ₹0 rows');
  checkUpgrade(v1, 'zero totals');
  const m = migrate(structuredClone(v1));
  assert.equal(m.live.payments.length, 1, 'only the real ₹9.98 payment remains');
  assert.equal(report(m.live, m.config).orders, 3, 'the ₹0 orders still count as paid orders');
});

test('edge: "big" unlocked by game fees alone stores reference undefined in v1', () => {
  const v1 = V1.migrate(V1.initialState());
  const c = v1.config;
  c.target = 1000;
  c.games[0].fee = 2000;
  V1.addGame(v1.live, c, {id: uuid(), gameId: 'wheel', method: 'Cash'}, '2026-11-04T12:00:00.000Z');
  assert.ok(v1.live.milestones.big.active);
  assert.equal(v1.live.milestones.big.reference, undefined, 'v1 stores reference: undefined (no orders yet)');
  checkUpgrade(v1, 'big via games');
  const m = migrate(structuredClone(v1));
  assert.equal(m.live.milestones.big.reference, null);
});

test('edge: messy team and flavour lists typed into v1 textareas', () => {
  const v1 = V1.migrate(V1.initialState());
  const c = v1.config;
  c.operators = ['Riya', 'Riya', fill('Ramesh Bhaiya from the decoration committee ', 50), 'Cashier 1'];
  c.operator = 'Owner ji';
  c.flavours = ['Peri Peri', 'Peri Peri', fill('Lay’s Limited Edition Desi Masala Tadka Flavour ', 60),
    ...Array.from({length: 35}, (_, i) => `Flavour ${i + 1}`)];
  const m = migrate(structuredClone(v1));
  assert.doesNotThrow(() => validateConfig(m.config));
  assert.equal(m.config.operator, 'Owner ji');
  assert.ok(m.config.operators.includes('Owner ji'));
  assert.ok(m.config.operators.includes('Riya'));
  assert.equal(new Set(m.config.operators).size, m.config.operators.length);
  assert.ok(m.config.flavours.includes('Peri Peri'));
  checkUpgrade(v1, 'messy lists');
});

test('edge: a discount snapshot reflects the promo the order actually got', () => {
  const v1 = V1.migrate(V1.initialState());
  const c = v1.config;
  for (const p of c.products) p.price = 5000;
  const at = '2026-11-04T12:00:00.000Z';
  V1.createOrder(v1.live, c, {id: uuid(), items: [V1.makeLine(c, 'veggie-small')], promo: true, method: 'Cash'}, at); // ₹10 off
  c.promo = 2000; // owner raised the promo later
  V1.createOrder(v1.live, c, {id: uuid(), items: [V1.makeLine(c, 'veggie-small')], promo: true, method: 'Cash'}, at); // ₹20 off
  const m = migrate(structuredClone(v1));
  const [a, b] = m.live.orders;
  assert.equal(a.discount, 1000);
  assert.equal(a.discountInfo.value, a.discount, 'old order keeps the ₹10 it actually got');
  assert.equal(b.discountInfo.id, 'promo');
  assert.equal(b.discountInfo.value, 2000);
  const uses = report(m.live, m.config).discountUses;
  assert.equal(Object.values(uses).reduce((n, u) => n + u.amount, 0), 3000);
  assert.equal(Object.keys(uses).length, 2, 'the two promo amounts are reported separately');
  checkUpgrade(v1, 'promo changed');
});
