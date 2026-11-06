// Phase-2 money tracking (ARCHITECTURE.md §16.1–§16.4): bills ledger, team contri, settlement math, ledger missions,
// reports/CSV/day report, migration of Phase-1 data, backup validation, stall themes and media references.
// Configs are built by hand so the money maths never depends on template contents. Amounts are paise (₹1 = 100).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  uuid, session, migrate, createOrder, makeLine, correctOrder, addExpense, updateExpense, voidExpense, addContribution,
  voidContribution, expenseTotals, teamSettlement, settlementText, saveSettlement, applyTheme, referencedMedia, report,
  refreshMilestones, dayReportText, expensesCsvRows, contributionsCsvRows, settlementCsvRows, csv, exportBackup, validateBackup,
  initialState, applyTemplate,
} from '../dist/domain.mjs';
import {validateConfig, missionTarget, saveMission, addMember, removeMember, saveTeam, setSplitMode, setShares} from '../dist/catalog.mjs';
import {buildTemplate, TEMPLATES} from '../dist/templates.mjs';
import {EXPENSE_CATEGORIES, EXPENSE_CATEGORY_IDS, DRAWER} from '../dist/constants.mjs';

const T0 = '2026-11-04T10:00:00.000Z'; // 15:30 IST, 4 Nov
const at = (minutes, base = T0) => new Date(Date.parse(base) + minutes * 60000).toISOString();
const rs = n => Math.round(n * 100); // ₹ → paise (readability in the worked examples)
const sum = list => list.reduce((a, b) => a + b, 0);
const THEMES_READY = 'theme' in buildTemplate('blank');

/** A complete product with §2 defaults. */
const P = (id, name, price) => ({
  id, name, subtitle: '', categoryId: 'food', size: '', price, priceLocked: false, art: 'samosa', image: null, tint: 'yellow',
  pattern: 'none', tags: [], active: true, soldOut: false, customizable: false, stockKey: '', stockUnits: 1, bundle: null,
});

/** A valid Phase-2 config: ledger mission, recovery milestones, a team of `names` (equal split). */
function makeConfig(names = ['A', 'B', 'C']) {
  return {
    schema: 2,
    templateId: 'legacy',
    profile: {
      stallName: 'Pataka Point', booth: 'Stall No. 10', tagline: 'Little packets.', subTagline: 'Fast orders.', eventName: 'Diwali Mela',
      venue: 'Main Ground', city: 'Jabalpur', eventDate: '2026-11-04', ownerName: 'Team Pataka', initials: '',
    },
    theme: {
      accent: '#FFDD35', themeId: 'custom', secondary: '#FF4D87', heroArt: ['packet', 'pizza', 'cold'], heroTint: 'yellow',
      heroPattern: 'sunburst', heroImage: null,
    },
    upi: {id: '', payeeName: ''},
    operator: 'Team Pataka',
    operators: ['Team Pataka'],
    kitchenQueue: false,
    allowCustomDiscount: false,
    inventory: false,
    stock: {},
    categories: [{id: 'food', name: 'Food'}],
    products: [P('paisa', 'Penny Toffee', 1), P('rupee', 'One Rupee Sweet', 100), P('thali', 'Thali', rs(500)), P('feast', 'Feast Platter', rs(5000))],
    addons: [],
    flavours: [],
    games: [],
    discounts: [],
    mission: {mode: 'ledger', total: 0, items: [{id: 'rent', label: 'Stall rent', amount: rs(1500)}]},
    milestones: [
      {id: 'half', title: 'Halfway there', type: 'recovery', target: 50},
      {id: 'be', title: 'Break-even boss', type: 'recovery', target: 100},
    ],
    team: {members: names.map((name, i) => ({id: `m-${name.toLowerCase()}`, name, color: ['yellow', 'pink', 'mint', 'sky'][i % 4], share: null})),
      splitMode: 'equal'},
  };
}

function setup(names) {
  const st = {version: 2, revision: 0, mode: 'live', onboarded: true, pin: null, config: makeConfig(names), live: session(), demo: session()};
  return {st, c: st.config, s: st.live};
}

/** Collect exactly `amount` paise of sales (Cash) using the fixed-price products (at most 999 of each per order). */
function sell(s, c, amount, now = T0) {
  let left = amount;
  for (const [id, price] of [['feast', rs(5000)], ['thali', rs(500)], ['rupee', 100], ['paisa', 1]]) {
    const quantity = Math.floor(left / price);
    if (quantity > 0) {
      createOrder(s, c, {id: uuid(), items: [makeLine(c, id, {quantity})], method: 'Cash'}, now);
      left -= quantity * price;
    }
  }
  assert.equal(left, 0, 'sell() could not make that amount');
}

const bill = (s, c, amount, extra = {}, now = T0) =>
  addExpense(s, c, {id: uuid(), title: extra.title || 'Bill', category: 'restock', amount, ...extra}, now);
const contri = (s, c, memberId, amount, extra = {}, now = T0) => addContribution(s, c, {id: uuid(), memberId, amount, ...extra}, now);
const byName = r => Object.fromEntries(r.members.map(m => [m.name, m]));

// ---------------------------------------------------------------------------------------------------------------------
// Settlement — worked examples
// ---------------------------------------------------------------------------------------------------------------------

test('settlement (1): equal split — capital back first, then profit by largest remainder', () => {
  const {c, s} = setup(['A', 'B', 'C']);
  contri(s, c, 'm-a', rs(1000));
  bill(s, c, rs(600), {paidBy: 'm-b', title: 'Cheese from B’s pocket'});
  bill(s, c, rs(300), {paidBy: DRAWER, title: 'Plates from the drawer', category: 'packaging'});
  sell(s, c, rs(5000));
  const r = teamSettlement(s, c);
  assert.deepEqual(r.totals, {
    contri: rs(1000), pocketBills: rs(600), drawerBills: rs(300), expenses: rs(900), capital: rs(1600), revenue: rs(5000),
    netProfit: rs(4100), pot: rs(5700), inProfit: true, recoveryPct: 100,
  });
  const m = byName(r);
  assert.deepEqual([m.A.recovery, m.B.recovery, m.C.recovery], [rs(1000), rs(600), 0]);
  // ₹4,100 / 3 = ₹1,366.666… → 136666 each + 2 spare paise; equal remainders → member order (A, B).
  assert.deepEqual([m.A.profitShare, m.B.profitShare, m.C.profitShare], [136667, 136667, 136666]);
  assert.equal(sum(r.members.map(x => x.profitShare)), rs(4100), 'profit split is exact');
  assert.deepEqual([m.A.payout, m.B.payout, m.C.payout], [236667, 196667, 136666]); // ≈ ₹2,366.67 · ₹1,966.67 · ₹1,366.66
  assert.equal(sum(r.members.map(x => x.payout)), rs(5700), 'Σ payout = pot');
  assert.deepEqual([m.A.contri, m.A.bills, m.A.capital, m.B.contri, m.B.bills, m.B.capital], [rs(1000), 0, rs(1000), 0, rs(600), rs(600)]);
  assert.deepEqual([m.A.capitalPct, m.B.capitalPct, m.C.capitalPct], [62.5, 37.5, 0]);
  assert.deepEqual(r.members.map(x => x.sharePct), [33.33, 33.33, 33.33]);
  assert.equal(r.splitMode, 'equal');
  assert.deepEqual(r.warnings, []);
});

test('settlement (2): loss — the pot is shared in proportion to capital, no profit', () => {
  const {c, s} = setup(['A', 'B']);
  sell(s, c, rs(500));
  bill(s, c, rs(800), {paidBy: 'm-a'});
  bill(s, c, rs(400), {paidBy: DRAWER});
  contri(s, c, 'm-b', rs(600));
  const r = teamSettlement(s, c);
  assert.deepEqual([r.totals.capital, r.totals.netProfit, r.totals.pot, r.totals.inProfit], [rs(1400), rs(-700), rs(700), false]);
  const m = byName(r);
  assert.deepEqual([m.A.recovery, m.B.recovery], [rs(400), rs(300)]);
  assert.deepEqual([m.A.profitShare, m.B.profitShare], [0, 0]);
  assert.equal(sum(r.members.map(x => x.payout)), rs(700));
  assert.equal(r.totals.recoveryPct, 50);
  assert.deepEqual(r.warnings, []);
});

test('settlement (3): custom 70/30 shares, with an odd paisa', () => {
  const {c, s} = setup(['A', 'B']);
  setSplitMode(c, 'custom');
  setShares(c, {'m-a': 70, 'm-b': 30});
  validateConfig(c);
  contri(s, c, 'm-a', rs(1000));
  bill(s, c, rs(500), {paidBy: DRAWER});
  sell(s, c, rs(3000) + 1); // net profit ₹2,500.01
  const r = teamSettlement(s, c);
  const m = byName(r);
  assert.equal(r.splitMode, 'custom');
  assert.deepEqual([m.A.sharePct, m.B.sharePct], [70, 30]);
  // 250001 × 70% = 175000.7 → 175001 (largest remainder), 250001 × 30% = 75000.3 → 75000.
  assert.deepEqual([m.A.profitShare, m.B.profitShare], [175001, 75000]);
  assert.deepEqual([m.A.payout, m.B.payout], [rs(1000) + 175001, 75000]);
  assert.equal(sum(r.members.map(x => x.payout)), r.totals.pot);
});

test('settlement (4): custom shares that do not add up to 100 → warning and an equal split (documented fallback)', () => {
  const {st, c, s} = setup(['A', 'B', 'C']);
  setSplitMode(c, 'custom');
  setShares(c, {'m-a': 50, 'm-b': 30, 'm-c': 20});
  // Removing a partner (no records) in custom mode leaves 50 + 30 = 80%: still a valid config, the settlement falls back.
  removeMember(st, 'm-c');
  assert.doesNotThrow(() => validateConfig(c));
  sell(s, c, rs(1000));
  const r = teamSettlement(s, c);
  assert.equal(r.splitMode, 'equal');
  assert.ok(r.warnings.some(w => /add up to 80%, not 100%/.test(w) && /split equally/.test(w)), r.warnings.join(' | '));
  assert.deepEqual(r.members.map(x => [x.sharePct, x.profitShare]), [[50, rs(500)], [50, rs(500)]]);
  // A missing (null) share is treated the same way.
  c.team.members[1].share = null;
  assert.ok(teamSettlement(s, c).warnings.some(w => /no custom share/.test(w)));
  assert.match(settlementText(s, c, {now: T0}), /⚠️ .*split equally/);
});

test('settlement (5): no partners → a warning, totals still right', () => {
  const {c, s} = setup([]);
  sell(s, c, rs(2000));
  bill(s, c, rs(300));
  const r = teamSettlement(s, c);
  assert.deepEqual(r.members, []);
  assert.deepEqual(r.totals, {
    contri: 0, pocketBills: 0, drawerBills: rs(300), expenses: rs(300), capital: 0, revenue: rs(2000), netProfit: rs(1700),
    pot: rs(1700), inProfit: true, recoveryPct: 100,
  });
  assert.ok(r.warnings.some(w => /No partners yet/.test(w)));
  // A config that predates Phase 2 (no team at all) behaves the same.
  delete c.team;
  assert.deepEqual(teamSettlement(s, c).totals, r.totals);
});

test('settlement (6): voided bills and voided contri are excluded everywhere', () => {
  const base = setup(['A', 'B', 'C']);
  const noisy = setup(['A', 'B', 'C']);
  for (const {c, s} of [base, noisy]) {
    contri(s, c, 'm-a', rs(1000));
    bill(s, c, rs(600), {paidBy: 'm-b'});
    bill(s, c, rs(300));
    sell(s, c, rs(5000));
  }
  const {c, s} = noisy;
  const wrongBill = bill(s, c, rs(999), {paidBy: 'm-c'});
  const wrongContri = contri(s, c, 'm-c', rs(250));
  voidExpense(s, c, wrongBill.id, 'Entered twice', at(1));
  voidContribution(s, c, wrongContri.id, 'Never paid', at(2));
  assert.deepEqual(teamSettlement(s, c), teamSettlement(base.s, base.c));
  assert.equal(report(s, c).mission.bills, rs(900));
  assert.equal(expenseTotals(s).total, rs(900));
  assert.deepEqual([wrongBill.void, wrongBill.voidReason, wrongBill.voidAt], [true, 'Entered twice', at(1)]);
  assert.deepEqual(s.audit.slice(-2).map(a => a.type), ['expense-void', 'contri-void']);
  assert.throws(() => voidExpense(s, c, wrongBill.id, 'again'), /already voided/);
  assert.throws(() => voidContribution(s, c, wrongContri.id, 'again'), /already voided/);
  assert.throws(() => voidExpense(s, c, bill(s, c, 100).id, '  '), /reason is required/);
  assert.throws(() => updateExpense(s, c, wrongBill.id, {amount: 5}), /voided/);
});

test('settlement (7): bills paid by a removed partner count as drawer bills, with a warning', () => {
  const {st, c, s} = setup(['A', 'B']);
  bill(s, c, rs(400), {paidBy: 'm-b'});
  contri(s, c, 'm-a', rs(100));
  sell(s, c, rs(1000));
  // removeMember refuses while B has bills; dropping B through saveTeam (or an old backup) leaves the bill's paidBy dangling.
  assert.throws(() => removeMember(st, 'm-b'), /has bills recorded/);
  saveTeam(c, {members: [{id: 'm-a', name: 'A', color: 'yellow'}]});
  const r = teamSettlement(s, c);
  assert.deepEqual([r.totals.pocketBills, r.totals.drawerBills, r.totals.capital, r.totals.pot], [0, rs(400), rs(100), rs(700)]);
  assert.ok(r.warnings.some(w => /₹400 of bills were paid by a removed partner/.test(w)));
  assert.equal(r.members[0].payout, rs(700));
  assert.equal(expensesCsvRows(s, c)[1][5], 'Removed partner (counted as drawer)');
  // The bill can still be edited without re-picking its payer.
  assert.equal(updateExpense(s, c, s.expenses[0].id, {title: 'Ice (B paid)'}).paidBy, 'm-b');
  assert.doesNotThrow(() => validateBackup(exportBackup(st, {})));
});

test('settlement: the drawer short of money (pot < 0) → nothing to pay out, warning', () => {
  const {c, s} = setup(['A', 'B']);
  contri(s, c, 'm-a', rs(100));
  bill(s, c, rs(500)); // drawer bill bigger than everything that came in
  const r = teamSettlement(s, c);
  assert.deepEqual([r.totals.pot, r.totals.netProfit, r.totals.recoveryPct], [rs(-400), rs(-500), 0]);
  assert.deepEqual(r.members.map(m => m.payout), [0, 0]);
  assert.ok(r.warnings.some(w => /₹400 more than the money that came in/.test(w)));
});

// ---------------------------------------------------------------------------------------------------------------------
// Settlement — seeded fuzz
// ---------------------------------------------------------------------------------------------------------------------

/** mulberry32: small deterministic PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p};
}

test('settlement fuzz (seeds 1…400): Σ payout = max(pot, 0), payouts ≥ 0, recovery ≤ capital, exact profit split', () => {
  let custom = 0;
  let losses = 0;
  let partial = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = prng(seed);
    const n = rnd.int(1, 7);
    const {c, s} = setup(Array.from({length: n}, (_, i) => `P${i}`));
    const ids = c.team.members.map(m => m.id);
    if (rnd.chance(0.5)) {
      // Random custom shares: valid (sum 100) most of the time, sometimes off.
      let left = 100;
      for (const [i, m] of c.team.members.entries()) {
        m.share = i === n - 1 ? left : rnd.int(0, left);
        left -= m.share;
      }
      if (rnd.chance(0.2)) c.team.members[0].share = Math.min(100, c.team.members[0].share + rnd.int(1, 9));
      c.team.splitMode = 'custom';
    }
    const big = rnd.chance(0.1); // occasional huge amounts (BigInt path)
    const amount = () => (big ? rnd.int(1, 100000) * 1000 : rnd.int(1, 300000));
    for (let k = rnd.int(0, 8); k > 0; k--) {
      const x = contri(s, c, rnd.pick(ids), amount());
      if (rnd.chance(0.15)) voidContribution(s, c, x.id, 'oops');
    }
    for (let k = rnd.int(0, 10); k > 0; k--) {
      const paidBy = rnd.chance(0.4) ? DRAWER : rnd.pick(ids);
      const e = bill(s, c, amount(), {paidBy, category: rnd.pick(EXPENSE_CATEGORY_IDS), method: rnd.pick(['Cash', 'UPI'])});
      if (rnd.chance(0.15)) voidExpense(s, c, e.id, 'oops');
    }
    if (rnd.chance(0.15)) s.expenses.push({...bill(s, c, amount()), id: uuid(), paidBy: 'gone-partner'}); // removed partner
    for (let k = rnd.int(0, 6); k > 0; k--) s.payments.push({id: uuid(), entityId: 'x', kind: 'order', amount: amount(), method: 'Cash', at: T0});
    if (rnd.chance(0.3)) s.payments.push({id: uuid(), entityId: 'x', kind: 'refund', amount: -rnd.int(1, 5000), method: 'UPI', at: T0});

    const r = teamSettlement(s, c);
    const t = r.totals;
    const label = `seed ${seed}`;
    const live = s.expenses.filter(e => !e.void);
    const revenue = sum(s.payments.map(p => p.amount));
    const contriSum = sum(s.contributions.filter(x => !x.void).map(x => x.amount));
    const drawer = sum(live.filter(e => !ids.includes(e.paidBy)).map(e => e.amount));
    assert.equal(t.revenue, revenue, label);
    assert.equal(t.expenses, sum(live.map(e => e.amount)), label);
    assert.equal(t.pot, t.capital + t.netProfit, `${label}: pot = capital + net profit`);
    assert.equal(t.pot, contriSum - drawer + revenue, `${label}: pot = Σ contri − drawer bills + revenue`);
    assert.equal(sum(r.members.map(m => m.payout)), Math.max(t.pot, 0), `${label}: Σ payout = max(pot, 0)`);
    assert.equal(sum(r.members.map(m => m.capital)), t.capital, label);
    for (const m of r.members) {
      assert.ok(m.payout >= 0 && m.recovery >= 0 && m.profitShare >= 0, `${label}: ${m.name} never negative`);
      assert.ok(m.recovery <= m.capital, `${label}: ${m.name} recovery ≤ capital`);
      assert.equal(m.payout, m.recovery + m.profitShare, label);
      for (const v of [m.payout, m.recovery, m.profitShare]) assert.ok(Number.isSafeInteger(v), `${label}: integer paise`);
    }
    assert.equal(sum(r.members.map(m => m.recovery)), Math.min(Math.max(t.pot, 0), t.capital), `${label}: Σ recovery`);
    const profit = Math.max(t.netProfit, 0);
    assert.equal(sum(r.members.map(m => m.profitShare)), profit, `${label}: profit split exact`);
    const weights = r.splitMode === 'custom' ? c.team.members.map(m => m.share) : c.team.members.map(() => 1);
    const W = sum(weights);
    for (const [i, m] of r.members.entries()) {
      assert.ok(Math.abs(m.profitShare - (profit * weights[i]) / W) < 1, `${label}: ${m.name} within a paisa of the exact share`);
      if (t.pot > 0 && t.pot < t.capital) {
        assert.ok(Math.abs(m.recovery - (t.pot * m.capital) / t.capital) < 1, `${label}: proportional recovery`);
      }
    }
    custom += r.splitMode === 'custom' ? 1 : 0;
    losses += t.netProfit < 0 ? 1 : 0;
    partial += t.pot > 0 && t.pot < t.capital ? 1 : 0;
  }
  assert.ok(custom > 50 && losses > 50 && partial > 20, `coverage: custom ${custom}, losses ${losses}, partial recovery ${partial}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Bills & contri records
// ---------------------------------------------------------------------------------------------------------------------

test('addExpense: Phase-2 bill shape, defaults, validation and idempotency', () => {
  const {c, s} = setup(['A']);
  const e = addExpense(s, c, {
    id: 'b1', title: '  20L water cans & ice ', category: 'restock', amount: 4500, method: 'UPI', paidBy: 'm-a', billImage: 'media:bill1',
    notes: '2 cans, 1 bag ice',
  }, T0);
  assert.deepEqual(e, {
    id: 'b1', at: T0, operator: 'Team Pataka', title: '20L water cans & ice', category: 'restock', amount: 4500, method: 'UPI',
    paidBy: 'm-a', billImage: 'media:bill1', notes: '2 cans, 1 bag ice', void: false,
  });
  assert.equal(addExpense(s, c, {id: 'b1', title: 'Other', category: 'misc', amount: 1}), e, 'idempotent on id');
  const d = addExpense(s, c, {id: 'b2', title: 'Plates', category: 'packaging', amount: 100}, T0);
  assert.deepEqual([d.method, d.paidBy, d.billImage, d.notes], ['Cash', 'drawer', null, '']);
  assert.equal(s.audit.at(-1).type, 'expense-recorded');
  const bad = {
    'blank title': [{title: '  '}, /title/],
    'long title': [{title: 'x'.repeat(81)}, /80 characters/],
    'unknown category': [{category: 'food'}, /category/],
    'zero amount': [{amount: 0}, /at least/],
    'fraction amount': [{amount: 10.5}, /at least/],
    'huge amount': [{amount: 100000001}, /at most/],
    'card method': [{method: 'Card'}, /Cash or UPI/],
    'unknown payer': [{paidBy: 'stranger'}, /who paid/],
    'bad photo': [{billImage: 'https://x.com/a.png'}, /photo/],
    'long notes': [{notes: 'n'.repeat(501)}, /500 characters/],
  };
  for (const [name, [patch, re]] of Object.entries(bad)) {
    assert.throws(() => addExpense(s, c, {id: uuid(), title: 'Bill', category: 'misc', amount: 100, ...patch}), re, name);
  }
  assert.throws(() => addExpense(s, c, {id: 'bad id!', title: 'x', category: 'misc', amount: 1}), /valid id/);
  assert.equal(s.expenses.length, 2, 'rejected bills are not recorded');
});

test('addExpense keeps the Phase-1 call shape working ({category: "Ingredients", amount, description})', () => {
  const {c, s} = setup([]);
  const map = {Ingredients: 'restock', Supplies: 'restock', Packaging: 'packaging', Helper: 'misc', Transport: 'misc', Other: 'misc'};
  for (const [legacy, id] of Object.entries(map)) {
    const e = addExpense(s, c, {id: uuid(), category: legacy, amount: 100, description: `${legacy} run`});
    assert.deepEqual([e.title, e.category, e.method, e.paidBy, e.void], [`${legacy} run`, id, 'Cash', 'drawer', false]);
  }
  assert.equal(addExpense(s, c, {id: uuid(), category: 'Other', amount: 100, description: ''}).title, 'Expense');
  assert.equal(addExpense(s, c, {id: uuid(), category: '[object Object]', amount: 100}).category, 'misc', 'unknown legacy → misc');
  assert.equal(addExpense(s, c, {id: uuid(), category: 'Mid-Stall Restock', amount: 100}).category, 'restock', 'labels map too');
  const long = addExpense(s, c, {id: uuid(), category: 'Other', amount: 100, description: 'd'.repeat(150)});
  assert.deepEqual([long.title.length, long.notes.length], [80, 150]);
  assert.throws(() => addExpense(s, c, {id: uuid(), category: 'Other', amount: 100, description: 'd'.repeat(151)}), /150 characters/);
  // report().mission.investment / extraExpenses / target keep working for the current UI.
  c.mission = {mode: 'total', total: rs(1000), items: []};
  const m = report(s, c).mission;
  assert.deepEqual([m.investment, m.extraExpenses, m.target], [rs(1000), 1000, rs(1000) + 1000]);
});

test('updateExpense edits fields, audits before/after, and moves the break-even', () => {
  const {c, s} = setup(['A', 'B']);
  const e = bill(s, c, 1000, {title: 'Cheese'});
  updateExpense(s, c, e.id, {amount: 1500, paidBy: 'm-a', category: 'pre-stall', notes: 'two packs', unknown: 'ignored'}, at(5));
  assert.deepEqual([e.amount, e.paidBy, e.category, e.notes, e.title], [1500, 'm-a', 'pre-stall', 'two packs', 'Cheese']);
  const a = s.audit.at(-1);
  assert.equal(a.type, 'expense-updated');
  assert.deepEqual(a.details, {before: {category: 'restock', amount: 1000, paidBy: 'drawer', notes: ''},
    after: {category: 'pre-stall', amount: 1500, paidBy: 'm-a', notes: 'two packs'}});
  assert.equal(report(s, c).mission.target, 1500);
  const audits = s.audit.length;
  assert.equal(updateExpense(s, c, e.id, {title: 'Cheese'}), e);
  assert.equal(s.audit.length, audits, 'no-op edits are not audited');
  assert.throws(() => updateExpense(s, c, e.id, {paidBy: 'ghost'}), /who paid/);
  assert.throws(() => updateExpense(s, c, 'missing', {amount: 1}), /could not be found/);
  assert.equal(e.amount, 1500, 'a rejected edit changes nothing');
});

test('addContribution: validation, idempotency, no effect on sales numbers', () => {
  const {c, s} = setup(['A']);
  const before = report(s, c);
  const x = addContribution(s, c, {id: 'c1', memberId: 'm-a', amount: rs(500), method: 'UPI', note: 'GPay to Viraj'}, T0);
  assert.deepEqual(x, {id: 'c1', at: T0, operator: 'Team Pataka', memberId: 'm-a', amount: rs(500), method: 'UPI', note: 'GPay to Viraj', void: false});
  assert.equal(addContribution(s, c, {id: 'c1', memberId: 'm-a', amount: 1}), x);
  assert.equal(s.audit.at(-1).type, 'contri-recorded');
  assert.throws(() => addContribution(s, c, {id: uuid(), memberId: 'ghost', amount: 100}), /which partner/);
  assert.throws(() => addContribution(s, c, {id: uuid(), memberId: 'm-a', amount: 0}), /at least/);
  assert.throws(() => addContribution(s, c, {id: uuid(), memberId: 'm-a', amount: 100, method: 'Other'}), /Cash or UPI/);
  assert.throws(() => addContribution(s, c, {id: uuid(), memberId: 'm-a', amount: 100, note: 'n'.repeat(121)}), /120 characters/);
  assert.deepEqual(report(s, c), before, 'contri is pool money, not sales or bills');
});

test('expenseTotals: by category, method and payer; day scope; voids excluded', () => {
  const {c, s} = setup(['A']);
  bill(s, c, 1000, {category: 'restock', paidBy: 'm-a', method: 'UPI'}, '2026-11-04T10:00:00.000Z');
  bill(s, c, 2000, {category: 'pre-stall'}, '2026-11-04T10:00:00.000Z');
  bill(s, c, 400, {category: 'restock'}, '2026-11-04T20:00:00.000Z'); // 5 Nov 01:30 IST
  voidExpense(s, c, bill(s, c, 9999, {category: 'rent'}).id, 'typo');
  const all = expenseTotals(s);
  assert.deepEqual(all, {
    total: 3400, count: 3, byCategory: {'pre-stall': 2000, restock: 1400, rent: 0, packaging: 0, decor: 0, misc: 0},
    byMethod: {Cash: 2400, UPI: 1000}, byPayer: {'m-a': 1000, drawer: 2400}, restock: 1400, preStall: 2000,
  });
  assert.deepEqual(Object.keys(all.byCategory), EXPENSE_CATEGORY_IDS);
  const day = expenseTotals(s, {day: '2026-11-05'});
  assert.deepEqual([day.total, day.count, day.restock], [400, 1, 400]);
  const r = report(s, c, {day: '2026-11-05'});
  assert.deepEqual([r.expenses, r.expenseTotals], [400, day]);
  assert.equal(r.mission.bills, 3400, 'the mission stays whole-session');
});

test('constants: six bill categories with labels and emoji', () => {
  assert.deepEqual(EXPENSE_CATEGORIES.map(x => x.id), ['pre-stall', 'restock', 'rent', 'packaging', 'decor', 'misc']);
  assert.deepEqual(EXPENSE_CATEGORIES.map(x => x.label),
    ['Pre-Stall Setup', 'Mid-Stall Restock', 'Stall Rent / Registration', 'Packaging & Plates', 'Decor / Banner', 'Misc']);
  for (const x of EXPENSE_CATEGORIES) assert.ok(x.emoji && Object.isFrozen(x));
  // Phase-1 UI compatibility: treating an entry as a string gives its label (JSON/keys unchanged), and the label maps back.
  assert.deepEqual([...EXPENSE_CATEGORIES].map(String), EXPENSE_CATEGORIES.map(x => x.label));
  assert.equal(JSON.stringify(EXPENSE_CATEGORIES[1]), '{"id":"restock","label":"Mid-Stall Restock","emoji":"🔄"}');
  const {c, s} = setup([]);
  const e = addExpense(s, c, {id: 'ui', category: String(EXPENSE_CATEGORIES[3]), amount: 100, description: 'Plates'});
  assert.deepEqual([e.category, e.title], ['packaging', 'Plates']);
});

// ---------------------------------------------------------------------------------------------------------------------
// Mission semantics & milestones
// ---------------------------------------------------------------------------------------------------------------------

test('ledger mission: break-even = Σ bills; planned missions: plan + bills (Phase-1 semantics)', () => {
  const {c, s} = setup([]);
  bill(s, c, rs(600), {category: 'restock'});
  bill(s, c, rs(400), {category: 'rent'});
  sell(s, c, rs(1500));
  let m = report(s, c).mission;
  assert.equal(missionTarget(c), 0, 'missionTarget is 0 in ledger mode (items are only suggestions)');
  assert.deepEqual(
    [m.mode, m.planned, m.bills, m.restock, m.investment, m.extraExpenses, m.target, m.profit, m.profitMode, m.remaining],
    ['ledger', 0, rs(1000), rs(600), rs(1000), 0, rs(1000), rs(500), true, 0],
  );
  saveMission(c, {mode: 'total', total: rs(2000)});
  m = report(s, c).mission;
  assert.deepEqual([m.mode, m.planned, m.investment, m.extraExpenses, m.target, m.profit, m.profitMode],
    ['total', rs(2000), rs(2000), rs(1000), rs(3000), rs(-1500), false]);
  saveMission(c, {mode: 'itemized'});
  m = report(s, c).mission;
  assert.deepEqual([m.mode, m.planned, m.target], ['itemized', rs(1500), rs(2500)]);
  saveMission(c, {mode: 'ledger'});
  assert.deepEqual(c.mission.items.map(i => i.label), ['Stall rent'], 'items are kept as bill suggestions');
  validateConfig(c);
  // Ledger mode with no bills has no target yet.
  const empty = setup([]);
  assert.deepEqual([report(empty.s, empty.c).mission.hasTarget, report(empty.s, empty.c).mission.target], [false, 0]);
});

test('a big restock bill reverses an unlocked "Break-even" milestone; a later sale re-unlocks it (first unlock time kept)', () => {
  const {c, s} = setup([]);
  bill(s, c, rs(1000), {category: 'pre-stall'}, at(0));
  sell(s, c, rs(1000), at(1));
  assert.equal(s.milestones.be.active, true);
  const first = s.milestones.be.unlockedAt;
  assert.equal(first, at(1));
  bill(s, c, rs(1500), {category: 'restock', title: 'Mid-stall cheese & buns'}, at(2));
  assert.deepEqual([s.milestones.be.active, s.milestones.half.active], [false, false], '₹1,000 of ₹2,500 is 40%');
  assert.equal(report(s, c).mission.restock, rs(1500));
  sell(s, c, rs(1500), at(3));
  assert.equal(s.milestones.be.active, true);
  assert.equal(s.milestones.be.unlockedAt, first, 'the first unlock time is kept');
  // Voiding the restock bill also moves the break-even (and keeps the milestone unlocked).
  voidExpense(s, c, s.expenses[1].id, 'Returned the cheese', at(4));
  assert.deepEqual([report(s, c).mission.target, s.milestones.be.active], [rs(1000), true]);
  // updateExpense raising the bill reverses it again.
  updateExpense(s, c, s.expenses[0].id, {amount: rs(5000)}, at(5));
  assert.equal(s.milestones.be.active, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Day report, settlement text, CSV
// ---------------------------------------------------------------------------------------------------------------------

test('dayReportText: bills line when there are bills; ledger break-even line', () => {
  const {c, s} = setup([]);
  sell(s, c, rs(500));
  let text = dayReportText(s, c, {now: T0});
  assert.ok(!text.includes('Bills:'), 'no bills → no bills line');
  assert.match(text, /🎯 Break-even: not set yet/);
  bill(s, c, rs(600), {category: 'restock'});
  bill(s, c, rs(300), {category: 'packaging'});
  voidExpense(s, c, bill(s, c, rs(50)).id, 'dup');
  text = dayReportText(s, c, {now: T0});
  const lines = text.split('\n');
  const i = lines.indexOf('🧾 Bills: ₹900 (restock ₹600)');
  assert.ok(i > 0, text);
  assert.ok(lines[i - 1].startsWith('🧾 Orders:'), 'right after the orders line');
  assert.equal(lines[i + 1], '🎯 Break-even: ₹900 (all bills so far)');
  assert.equal(lines[i + 2], '📈 Recovered: 55% — ₹400 to go');
  // Day scope: bills of other days are not in the bills line, the break-even stays whole-event.
  assert.ok(!dayReportText(s, c, {day: '2026-11-06', now: T0}).includes('Bills:'));
  // Planned missions keep the Phase-1 wording.
  saveMission(c, {mode: 'total', total: rs(100)});
  assert.match(dayReportText(s, c, {now: T0}), /🎯 Break-even: ₹1,000 \(investment ₹100 \+ extra costs ₹900\)/);
});

test('settlementText: WhatsApp-ready lines per §16.3', () => {
  const {c, s} = setup(['Asha', 'Ravi']);
  contri(s, c, 'm-asha', rs(1000));
  bill(s, c, rs(600), {paidBy: 'm-ravi', category: 'pre-stall'});
  bill(s, c, rs(300), {category: 'restock'});
  sell(s, c, rs(5000));
  const text = settlementText(s, c, {now: T0});
  const lines = text.split('\n');
  assert.equal(lines[0], '*🤝 Pataka Point — Team settlement*');
  assert.equal(lines[1], 'Stall No. 10 · Diwali Mela · 4 Nov 2026');
  assert.ok(lines.includes('💰 Revenue: ₹5,000'));
  assert.ok(lines.includes('🧾 Bills: ₹900 (🧰 Pre-Stall Setup ₹600 · 🔄 Mid-Stall Restock ₹300)'), text);
  assert.ok(lines.includes('📈 Net profit: ₹4,100'));
  assert.ok(lines.includes('👥 Money put in: ₹1,600 (contri ₹1,000 + bills paid by partners ₹600)'));
  assert.ok(lines.includes('• Asha — put in ₹1,000 → back ₹1,000 + profit ₹2,050 = *₹3,050*'), text);
  assert.ok(lines.includes('• Ravi — put in ₹600 → back ₹600 + profit ₹2,050 = *₹2,650*'), text);
  assert.ok(lines.includes('⚖️ Profit split: equal'));
  assert.match(text, /not accounting or tax advice/);
  assert.equal(lines.at(-1), '_Sent from ManageYourStall (MYS)_');
  setSplitMode(c, 'custom');
  setShares(c, {'m-asha': 60, 'm-ravi': 40});
  assert.ok(settlementText(s, c, {now: T0}).includes('⚖️ Profit split: custom (Asha 60% · Ravi 40%)'));
  const loss = setup(['A']);
  bill(loss.s, loss.c, rs(100));
  assert.match(settlementText(loss.s, loss.c, {now: T0}), /📉 Net loss: ₹100/);
});

test('saveSettlement stores an immutable deep copy with its text and audits it', () => {
  const {st, c, s} = setup(['A', 'B']);
  contri(s, c, 'm-a', rs(100));
  sell(s, c, rs(1000));
  const snap = saveSettlement(s, c, at(10));
  assert.deepEqual(Object.keys(snap), ['id', 'at', 'operator', 'result', 'text']);
  assert.deepEqual(snap.result, teamSettlement(s, c));
  assert.equal(snap.text, settlementText(s, c, {now: at(10)}));
  assert.equal(s.settlements.at(-1), snap);
  assert.equal(s.audit.at(-1).type, 'settlement-saved');
  sell(s, c, rs(500));
  assert.equal(snap.result.totals.revenue, rs(1000), 'later sales do not change a saved snapshot');
  const restored = validateBackup(exportBackup(st, {})).state;
  assert.deepEqual(restored.live.settlements, s.settlements);
});

test('bills / contri / settlement CSV rows go through csv() formula-injection safe', () => {
  const {c, s} = setup(['@Asha', 'Ravi']);
  addExpense(s, c, {id: 'b1', title: '=HYPERLINK("http://x")', category: 'restock', amount: 12345, method: 'UPI', paidBy: 'm-@asha',
    notes: '+91 call vendor', billImage: 'media:p1'}, T0);
  voidExpense(s, c, addExpense(s, c, {id: 'b2', title: '-oops', category: 'misc', amount: 100}, T0).id, '@typo', T0);
  addContribution(s, c, {id: 'c1', memberId: 'm-ravi', amount: rs(1000), note: '=1+2'}, T0);
  sell(s, c, rs(2000));

  const bills = expensesCsvRows(s, c);
  assert.deepEqual(bills[0], ['Time (IST)', 'Title', 'Category', 'Amount', 'Method', 'Paid by', 'Bill photo', 'Notes', 'Status', 'Void reason',
    'Operator', 'Bill ID']);
  assert.deepEqual(bills[1], ['2026-11-04 15:30', '=HYPERLINK("http://x")', 'Mid-Stall Restock', '123.45', 'UPI', '@Asha', 'yes',
    '+91 call vendor', 'ok', '', 'Team Pataka', 'b1']);
  assert.deepEqual(bills[2].slice(1, 10), ['-oops', 'Misc', '1.00', 'Cash', 'Stall cash drawer', '', '', 'VOID', '@typo']);
  const contriRows = contributionsCsvRows(s, c);
  assert.deepEqual(contriRows[0], ['Time (IST)', 'Partner', 'Amount', 'Method', 'Note', 'Status', 'Void reason', 'Operator', 'Contri ID']);
  assert.deepEqual(contriRows[1], ['2026-11-04 15:30', 'Ravi', '1000.00', 'Cash', '=1+2', 'ok', '', 'Team Pataka', 'c1']);
  const settle = settlementCsvRows(s, c);
  assert.deepEqual(settle[0], ['Partner', 'Profit share %', 'Contri', 'Bills paid', 'Put in (capital)', 'Capital %', 'Capital back',
    'Profit share', 'Payout']);
  const r = teamSettlement(s, c);
  assert.deepEqual(settle.slice(1, 3).map(row => row[0]), ['@Asha', 'Ravi']);
  const total = settle.find(row => row[0] === 'TOTAL');
  assert.equal(Math.round(Number(total[8]) * 100), Math.max(r.totals.pot, 0));
  assert.ok(settle.some(row => row[0] === 'Pot to split' && row[1] === (r.totals.pot / 100).toFixed(2)));

  for (const rows of [bills, contriRows, settle]) {
    const text = csv(rows);
    assert.ok(!/(^|,)"[=+@]/m.test(text.replace(/^﻿/, '')), 'no cell starts with a formula character');
    assert.ok(!/(^|,)"-[^0-9]/m.test(text.replace(/^﻿/, '')), 'no text cell starts with a minus');
  }
  assert.ok(csv(bills).includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(csv(bills).includes(`"'@Asha"`));
  assert.ok(csv(contriRows).includes(`"'=1+2"`));
  assert.ok(csv(settle).includes(`"'@Asha"`));
});

// ---------------------------------------------------------------------------------------------------------------------
// Migration & backup validation
// ---------------------------------------------------------------------------------------------------------------------

/** A Phase-1 v2 state: old expense shape, theme {accent} only, no team / contributions / settlements. */
function phase1State() {
  const {st, c, s} = setup([]);
  sell(s, c, rs(700));
  delete c.team;
  c.theme = {accent: '#FF4D87'};
  c.templateId = 'snacks-pizza';
  c.mission = {mode: 'itemized', total: 0, items: [{id: 'rent', label: 'Stall rent', amount: rs(300)}]};
  s.expenses.push(
    {id: 'e1', category: 'Ingredients', amount: 5000, description: 'Extra cheese', at: T0, operator: 'Team Pataka'},
    {id: 'e2', category: 'Helper', amount: 2000, description: '', at: T0, operator: 'Team Pataka'},
  );
  st.demo.expenses.push({id: 'e3', category: 'Weird', amount: 100, description: 'Old practice', at: T0, operator: 'Team Pataka'});
  for (const mode of ['live', 'demo']) {
    delete st[mode].contributions;
    delete st[mode].settlements;
  }
  return st;
}

test('migrate upgrades Phase-1 v2 data idempotently (bills, theme defaults, team, contri, settlements)', () => {
  const st = migrate(phase1State());
  assert.deepEqual(st.live.expenses[0], {
    id: 'e1', category: 'restock', amount: 5000, at: T0, operator: 'Team Pataka', title: 'Extra cheese', method: 'Cash', paidBy: 'drawer',
    billImage: null, notes: '', void: false,
  });
  assert.deepEqual([st.live.expenses[1].title, st.live.expenses[1].category], ['Expense', 'misc']);
  assert.equal(st.demo.expenses[0].category, 'misc', 'unknown legacy categories become misc');
  const t = buildTemplate('snacks-pizza');
  assert.deepEqual(st.config.theme, {
    accent: '#FF4D87', themeId: 'snacks-pizza', heroArt: THEMES_READY ? [...t.theme.heroArt] : ['packet', 'pizza', 'cold'],
    secondary: '#FF4D87', heroTint: 'yellow', heroPattern: 'sunburst', heroImage: null,
  });
  assert.deepEqual(st.config.team, {members: [], splitMode: 'equal'});
  assert.equal(st.config.mission.mode, 'itemized', 'a planned mission is kept');
  for (const mode of ['live', 'demo']) assert.deepEqual([st[mode].contributions, st[mode].settlements], [[], []]);
  validateConfig(st.config);
  const again = migrate(structuredClone(st));
  assert.deepEqual(again, st, 'idempotent');
  // An unknown template id becomes a custom look.
  const odd = phase1State();
  odd.config.templateId = 'retired-theme';
  assert.equal(migrate(odd).config.theme.themeId, 'custom');
});

test('validateBackup accepts a Phase-1 v2 backup (old expenses, no team/contri/settlements) and keeps the money', () => {
  const old = phase1State();
  const input = JSON.parse(JSON.stringify(exportBackup(old, {})));
  const copy = structuredClone(input);
  const {state, warnings} = validateBackup(input);
  assert.deepEqual(input, copy, 'input is not mutated');
  assert.deepEqual(warnings, []);
  const r = report(state.live, state.config);
  assert.deepEqual([r.collected, r.expenses, r.mission.planned, r.mission.extraExpenses, r.mission.target],
    [rs(700), 7000, rs(300), 7000, rs(300) + 7000]);
  assert.equal(state.live.expenses[0].title, 'Extra cheese');
});

test('validateBackup rejects corrupted bills, contri and settlement snapshots', () => {
  const {st, c, s} = setup(['A']);
  bill(s, c, 1000, {paidBy: 'm-a'});
  voidExpense(s, c, bill(s, c, 50).id, 'dup');
  contri(s, c, 'm-a', 500);
  voidContribution(s, c, contri(s, c, 'm-a', 20).id, 'dup');
  saveSettlement(s, c);
  assert.doesNotThrow(() => validateBackup(structuredClone(st)));
  const corruptions = {
    'bill amount 0': v => { v.live.expenses[0].amount = 0; },
    'bill fraction': v => { v.live.expenses[0].amount = 1.5; },
    // (an unknown category *string* is a Phase-1 free-text category: migrate maps it to 'misc', so it is not corruption)
    'bill category': v => { v.live.expenses[0].category = 42; },
    'bill method': v => { v.live.expenses[0].method = 'Card'; },
    'bill payer': v => { v.live.expenses[0].paidBy = 'bad id!'; },
    'bill photo': v => { v.live.expenses[0].billImage = 'javascript:alert(1)'; },
    'bill title blank': v => { v.live.expenses[0].title = ' '; },
    'bill title long': v => { v.live.expenses[0].title = 'x'.repeat(81); },
    'bill notes long': v => { v.live.expenses[0].notes = 'x'.repeat(501); },
    'bill void flag': v => { v.live.expenses[0].void = 'no'; },
    'void bill without reason': v => { delete v.live.expenses[1].voidReason; },
    'live bill with void time': v => { v.live.expenses[0].voidAt = T0; },
    'duplicate bill id': v => { v.live.expenses.push(structuredClone(v.live.expenses[0])); },
    'contri member': v => { v.live.contributions[0].memberId = 42; },
    'contri amount': v => { v.live.contributions[0].amount = -5; },
    'contri method': v => { v.live.contributions[0].method = 'Other'; },
    'contri note': v => { v.live.contributions[0].note = 'x'.repeat(121); },
    'contri void reason': v => { v.live.contributions[1].voidReason = ''; },
    'contributions not a list': v => { v.demo.contributions = {}; },
    'settlement result': v => { v.live.settlements[0].result = null; },
    'settlement payout': v => { v.live.settlements[0].result.members[0].payout = 1.5; },
    'settlement time': v => { v.live.settlements[0].at = 'yesterday'; },
    'team member colour': v => { v.config.team.members[0].color = 'neon'; },
    'team split mode': v => { v.config.team.splitMode = 'random'; },
    'team share': v => { v.config.team.members[0].share = 101; },
    'theme secondary': v => { v.config.theme.secondary = 'pink'; },
    'theme hero art': v => { v.config.theme.heroArt = ['a', 'b', 'c', 'd']; },
    'theme hero image': v => { v.config.theme.heroImage = 'http://insecure.example/x.png'; },
    'mission mode': v => { v.config.mission.mode = 'vibes'; },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    const copy = structuredClone(st);
    corrupt(copy);
    assert.throws(() => validateBackup(copy), /Backup rejected/, name);
  }
});

test('validateBackup: dangling bill/hero photos → null + warnings; unknown paidBy is allowed', () => {
  const {st, c, s} = setup(['A']);
  bill(s, c, 1000, {billImage: 'media:gone-bill'});
  bill(s, c, 500, {billImage: 'media:kept-bill'});
  bill(st.demo, c, 500, {billImage: 'media:gone-demo'});
  s.expenses[1].paidBy = 'removed-partner';
  c.theme.heroImage = 'media:gone-hero';
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const {state, media, warnings} = validateBackup(exportBackup(st, {'kept-bill': png}));
  assert.deepEqual(Object.keys(media), ['kept-bill']);
  assert.equal(state.live.expenses[0].billImage, null);
  assert.equal(state.live.expenses[1].billImage, 'media:kept-bill');
  assert.equal(state.live.expenses[1].paidBy, 'removed-partner');
  assert.equal(state.demo.expenses[0].billImage, null);
  assert.equal(state.config.theme.heroImage, null);
  assert.equal(warnings.length, 3, warnings.join(' | '));
  assert.ok(warnings.some(w => /stall photo/.test(w)));
  assert.ok(warnings.some(w => /1 bill photo in the live ledger/.test(w)));
  assert.ok(warnings.some(w => /1 bill photo in the practice ledger/.test(w)));
  assert.ok(teamSettlement(state.live, state.config).warnings.some(w => /removed partner/.test(w)));
});

// ---------------------------------------------------------------------------------------------------------------------
// Media references & themes
// ---------------------------------------------------------------------------------------------------------------------

test('referencedMedia: products, theme hero photo and bill photos in live AND practice (void bills too)', () => {
  const {st, c, s} = setup([]);
  c.products[0].image = 'media:prod-1';
  c.products[1].image = 'https://example.com/x.png';
  c.theme.heroImage = 'media:hero-1';
  bill(s, c, 100, {billImage: 'media:bill-live'});
  voidExpense(s, c, bill(s, c, 100, {billImage: 'media:bill-void'}).id, 'dup');
  bill(st.demo, c, 100, {billImage: 'media:bill-demo'});
  assert.deepEqual([...referencedMedia(st)].sort(), ['bill-demo', 'bill-live', 'bill-void', 'hero-1', 'prod-1']);
  assert.deepEqual([...referencedMedia(null)], []);
  assert.deepEqual([...referencedMedia({config: {products: [{image: 'media:p'}]}})], ['p'], 'tolerates partial data');
  // Every id is a valid media key.
  for (const id of referencedMedia(st)) assert.match(id, /^[a-zA-Z0-9_-]{1,100}$/);
});

test('initialState: Phase-2 theme, empty team and ledgers with contri/settlements', () => {
  const st = initialState();
  assert.equal(st.config.templateId, TEMPLATES.some(t => t.id === 'street-chaat') ? 'street-chaat' : 'snacks-pizza');
  assert.deepEqual(st.config.team, {members: [], splitMode: 'equal'});
  assert.equal(st.config.theme.themeId, st.config.templateId);
  assert.equal(st.config.theme.heroImage, null);
  for (const k of ['secondary', 'heroArt', 'heroTint', 'heroPattern']) assert.ok(k in st.config.theme, k);
  for (const mode of ['live', 'demo']) assert.deepEqual([st[mode].contributions, st[mode].settlements], [[], []]);
  validateConfig(st.config);
});

test('applyTheme copies the template look, keeps the photo by default, and can swap the menu', {skip: !THEMES_READY && 'templates have no theme yet'}, () => {
  const {st, s} = setup(['A']);
  st.config.theme.heroImage = 'media:my-stall';
  const before = structuredClone(st.config.products);
  const target = TEMPLATES.find(t => t.id !== 'blank').id;
  const t = buildTemplate(target);
  applyTheme(st, target, {}, at(1));
  assert.deepEqual(st.config.theme, {...t.theme, heroArt: [...t.theme.heroArt], themeId: t.templateId, heroImage: 'media:my-stall'});
  assert.deepEqual(st.config.products, before, 'menu untouched by default');
  assert.equal(s.audit.at(-1).type, 'theme-applied');
  validateConfig(st.config);

  applyTheme(st, 'blank', {menu: true, withPrices: false, keepPhoto: false}, at(2));
  assert.equal(st.config.theme.heroImage, null);
  assert.equal(st.config.theme.themeId, 'blank');
  assert.equal(st.config.templateId, 'blank');
  assert.deepEqual(s.audit.slice(-2).map(a => a.type), ['template-applied', 'theme-applied']);
  assert.deepEqual(st.config.team.members.map(m => m.name), ['A'], 'the team is not part of a theme');
  validateConfig(st.config);
  assert.throws(() => applyTheme(st, 'no-such-theme'), /Unknown stall template/);
});

test('applyTemplate leaves bills, contri and settlements alone; ledger templates make the bills the break-even', () => {
  const {st, c, s} = setup(['A']);
  bill(s, c, rs(200));
  contri(s, c, 'm-a', rs(100));
  saveSettlement(s, c);
  const before = structuredClone([s.expenses, s.contributions, s.settlements, c.team]);
  applyTemplate(st, 'blank', {}, at(1));
  assert.deepEqual([s.expenses, s.contributions, s.settlements, st.config.team], before);
  const m = report(s, st.config).mission;
  if (st.config.mission.mode === 'ledger') assert.deepEqual([m.investment, m.target], [rs(200), rs(200)]);
  else assert.equal(m.target, missionTarget(st.config) + rs(200));
});

test('team helpers keep the settlement in step (addMember in custom mode starts at 0%)', () => {
  const {st, c, s} = setup(['A', 'B']);
  setSplitMode(c, 'custom');
  assert.deepEqual(c.team.members.map(m => m.share), [50, 50]);
  const z = addMember(c, {name: 'Zoya'});
  assert.equal(z.share, 0);
  sell(s, c, rs(100));
  assert.deepEqual(teamSettlement(s, c).members.map(m => m.profitShare), [rs(50), rs(50), 0]);
  removeMember(st, z.id);
  assert.equal(c.team.members.length, 2);
  refreshMilestones(s, c);
});
