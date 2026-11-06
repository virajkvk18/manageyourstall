// The owner's acceptance flow (lead): one stall, from a fresh phone to the end-of-stall settlement, with real clicks.
// 1. onboarding: Momo & Fast-Food Corner (+ prices) · "Momo Masti" · partners Viraj, Aisha, Kabir → themed Sell hero;
//    Studio › Themes switches to Sweet Tooth look-only (menu unchanged) and back.
// 2. Expenses: three pre-stall bills (one with a photo made in the test) + Kabir's contri (PIN) → break-even ₹3,800.
// 3. Sales through Review & pay: Cash with change, UPI with a Studio UPI ID → ₹2,000 (Halfway milestone unlocked).
// 4. Dashboard "+ Quick mid-stall restock" ₹600 paid by Kabir → break-even ₹4,400, Halfway reversed; one more sale
//    re-unlocks it.
// 5. Team › Settlement checked against an independent §16.3 calculation (loss case, then profit case); copy text,
//    WhatsApp link, snapshot with the PIN.
// 6. JSON backup → factory reset → restore: bills (with the photo), contri, team, theme and sales are all back.
// Plus: the nav shows Stall's Collab with its COMING SOON sticker on first load and the page opens.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {ready, go, act, sheet, state, adminClick, unlockAdmin, noOverflow} from './helpers.mjs';

const STALL = 'Momo Masti';
const UPI_ID = 'momomasti@okaxis';
const MOMO_LOOK = {accent: '#7EE0B5', secondary: '#FF6B5B', heroArt: ['frankie-roll', 'steamed-momos', 'burger']};
const SWEET_LOOK = {accent: '#FF4D87', secondary: '#C7B6FF', heroArt: ['kulfi', 'brownie-sundae', 'milkshake']};

/** Phones (<768px) have a 6-item bottom nav; Studio and Expenses live behind the More hub there. */
const isPhone = page => (page.viewportSize()?.width || 1440) < 768;
const isDesktop = page => (page.viewportSize()?.width || 1440) >= 1024;
const openDialog = page => page.locator('#sheet[open]');

/** ₹ in Indian grouping, paise only when there are any — written here independently of util.money. */
const inr = p => {
  const neg = p < 0;
  const a = Math.abs(p);
  const r = Math.floor(a / 100).toLocaleString('en-IN');
  return `${neg ? '−' : ''}₹${r}${a % 100 ? '.' + String(a % 100).padStart(2, '0') : ''}`;
};

/**
 * Independent §16.3 settlement: capital = contri + pocket bills; pot = capital + netProfit; step 1 recovery (all back, or
 * the pot in proportion to capital, or nothing); step 2 profit split (equal) — both largest-remainder, ties → member order.
 */
function largestRemainder(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const parts = [];
  const rems = [];
  for (const w of weights) {
    const exact = BigInt(total) * BigInt(w);
    parts.push(Number(exact / BigInt(sum)));
    rems.push(exact % BigInt(sum));
  }
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => (rems[a] === rems[b] ? a - b : rems[b] > rems[a] ? 1 : -1));
  for (let k = 0; left > 0; k++, left--) parts[order[k]]++;
  return parts;
}
function settle({names, contri, pocket, revenue, expenses}) {
  const capital = names.map((_, i) => contri[i] + pocket[i]);
  const cap = capital.reduce((a, b) => a + b, 0);
  const netProfit = revenue - expenses;
  const pot = cap + netProfit;
  const recovery = pot >= cap ? capital.slice() : pot > 0 ? largestRemainder(pot, capital) : capital.map(() => 0);
  const profit = netProfit > 0 ? largestRemainder(netProfit, names.map(() => 1)) : names.map(() => 0);
  return {pot, netProfit, members: names.map((name, i) => ({name, capital: capital[i], recovery: recovery[i], profit: profit[i], payout: recovery[i] + profit[i]}))};
}

/** Collect page errors and console errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Use the visible nav when it has the screen; otherwise the More hub tile (phones); else the kernel (no UI path). */
async function goTo(page, screen, tile = '') {
  const nav = page.locator(`[data-action="nav"][data-screen="${screen}"]:visible`).first();
  if (await nav.count()) {
    await nav.click();
  } else if (tile) {
    await go(page, 'more');
    await page.locator(`[data-tile="${tile}"]`).click();
  } else {
    await go(page, screen);
  }
  await expect(page.locator(`#main.screen-${screen}`)).toBeVisible();
}

const goStudio = page => goTo(page, 'studio', 'studio');
const goMoney = async (page, tab = 'bills') => {
  await goTo(page, 'money', 'money');
  await act(page, 'money-tab', `[data-tab="${tab}"]`).click();
  await expect(page.locator(`.money-tab-body[data-money-tab="${tab}"]`)).toBeVisible();
};

/** Quantity of one product in the open cart. */
const inCart = (page, id) =>
  page.evaluate(pid => import('/ui/core.mjs').then(m => m.S().draft.filter(l => l.productId === pid).reduce((n, l) => n + l.quantity, 0)), id);

/** Tap a product card `qty` times (each tap waits for the cart to take it — repeat taps in flight are ignored by design). */
async function addItems(page, id, qty) {
  const main = page.locator(`article.sell-card[data-product="${id}"] .sell-card-main`);
  const start = await inCart(page, id);
  for (let i = 1; i <= qty; i++) {
    await main.click();
    await expect.poll(() => inCart(page, id)).toBe(start + i);
  }
}

/**
 * Ring up a cart on Sell and pay through Review & pay.
 * @param {{items: Array<[string, number]>, total: number, method: 'Cash'|'UPI', tender?: string, note?: number, change?: number}} sale
 */
async function sell(page, {items, total, method, tender = '', note = 0, change = 0}) {
  await goTo(page, 'sell');
  for (const [id, qty] of items) await addItems(page, id, qty);
  // Desktop: the cart column's pay button. Tablet/phone: the floating "N items · ₹X · Review & Pay →" bar.
  if (!isDesktop(page)) await expect(page.locator('.sell-cartbar')).toContainText(inr(total));
  await act(page, 'co-open').click();
  await expect(page.locator('#sheet[open][data-kind="checkout"]')).toBeVisible();
  const s = sheet(page);
  await expect(s.locator('.co-grand-amount')).toHaveText(inr(total));
  if (method === 'Cash') {
    // Checkout remembers the last method used, so pick Cash explicitly.
    await s.locator('[data-action="co-method"][data-method="Cash"]').click();
    await expect(s.locator('[data-action="co-method"][data-method="Cash"]')).toHaveAttribute('aria-pressed', 'true');
    if (note) await s.locator(`[data-action="co-tender"][data-amount="${note}"]`).click();
    else await s.locator('#co-tendered').fill(tender);
    await expect(s.locator('#co-cash-result')).toContainText('Return');
    await expect(s.locator('#co-cash-result')).toContainText(inr(change));
  } else {
    await s.locator('[data-action="co-method"][data-method="UPI"]').click();
    const qr = s.locator('.co-qr');
    await expect(qr.locator('svg')).toBeVisible();
    await expect(qr).toHaveAttribute('data-upi', new RegExp(`pa=momomasti%40okaxis.*am=${(total / 100).toFixed(2).replace('.', '\\.')}`));
    await expect(s.locator('#co-complete')).toBeDisabled();
    await s.locator('#co-confirm').check();
  }
  await s.locator('#co-complete').click();
  await expect(page.locator('#sheet[open][data-kind="co-success"]')).toBeVisible();
  await expect(s.locator('.co-success-total')).toHaveText(inr(total));
  if (method === 'Cash' && change) await expect(s.locator('.co-success-change')).toContainText(inr(change));
  const next = s.locator('[data-action="co-next"]');
  await expect(next).not.toHaveClass(/co-arming/);
  await next.click();
  await expect(openDialog(page)).toHaveCount(0);
}

/** Dashboard mission hero + Sell mission strip both show this break-even, collected and percent. */
async function expectMission(page, {target, collected}) {
  const pct = Math.floor((collected * 100) / target);
  await goTo(page, 'dashboard');
  await expect(page.locator('#dash-hero-title')).toHaveText(`THE ${inr(target)} MISSION`);
  await expect(page.locator('.dash-hero .dash-big')).toContainText(`${inr(collected)} / ${inr(target)}`);
  await expect(page.locator('.dash-hero .dash-pct')).toHaveText(`${pct}% recovered`);
  await expect(page.locator('.dash-hero-meta .badge')).toHaveText(`${inr(target - collected)} to break even`);
  await expect(page.locator('.dash-breakdown-total')).toContainText(inr(target));
  await goTo(page, 'sell');
  const strip = page.locator('.sell-mission');
  await expect(strip).toContainText(`${inr(collected)} / ${inr(target)} recovered`);
  await expect(strip.locator('.sell-mission-pct')).toHaveText(`${pct}%`);
}

/** Milestone card state on the Milestones screen (+ the stored unlock record). */
async function expectMilestone(page, id, cls) {
  // Phones have no Milestones nav item: go through the Dashboard's "Milestones" button.
  if (!(await page.locator('[data-action="nav"][data-screen="milestones"]:visible').count())) await goTo(page, 'dashboard');
  await goTo(page, 'milestones');
  await expect(page.locator(`.ms-card[data-milestone="${id}"]`)).toHaveClass(new RegExp(cls));
}

/** Rendered Sell hero art equals library.heroSvg(ids) and the root palette follows the theme. */
async function expectLook(page, look) {
  const same = await page.evaluate(async ids => {
    const lib = await import('/library.mjs');
    const box = document.createElement('div');
    box.innerHTML = lib.heroSvg(ids, {cls: 'sell-hero-svg'});
    const shown = document.querySelector('.sell-hero .sell-hero-svg');
    return !!shown && shown.outerHTML === box.firstElementChild.outerHTML;
  }, look.heroArt);
  expect(same, 'Sell hero shows the theme heroSvg').toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').toUpperCase())).toBe(look.accent);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--secondary').toUpperCase())).toBe(look.secondary);
}

/** Pick a theme card in Studio › Themes and apply it look-only (admin). */
async function applyLook(page, themeId) {
  await goTo(page, 'studio', 'themes');
  await page.locator(`[data-action="studio-theme-pick"][data-id="${themeId}"]`).click();
  await expect(page.locator('#sheet[open][data-kind="studio-theme"]')).toBeVisible();
  await expect(sheet(page).locator('#studio-theme-menu')).not.toBeChecked();
  await adminClick(page, sheet(page).locator('[data-action="studio-theme-apply"]'));
  await expect(openDialog(page)).toHaveCount(0);
  await expect.poll(async () => (await state(page)).config.theme.themeId).toBe(themeId);
}

/** A bill photo drawn in the page (PNG, big enough to go through the in-browser JPEG compression). */
async function billPhoto(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1800;
    c.height = 1200;
    const x = c.getContext('2d');
    x.fillStyle = '#fffdf5';
    x.fillRect(0, 0, 1800, 1200);
    for (let i = 0; i < 600; i++) {
      x.fillStyle = `hsl(${(i * 37) % 360} 70% ${40 + (i % 40)}%)`;
      x.fillRect((i * 83) % 1800, (i * 47) % 1200, 30 + (i % 60), 20 + (i % 40));
    }
    x.fillStyle = '#171717';
    x.font = 'bold 110px sans-serif';
    x.fillText('RAW MATERIAL ₹2,000', 120, 600);
    return c.toDataURL('image/png').split(',')[1];
  });
  return {name: 'raw-material-bill.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64')};
}

/** Fill and save the Add-bill / restock sheet. */
async function fillBill(page, {title = '', suggest = '', category = '', amount, method = 'Cash', payer = '', photo = null}) {
  const dlg = sheet(page);
  await expect(page.locator('#sheet[open][data-kind="money-bill-form"]')).toBeVisible();
  if (suggest) {
    await dlg.locator(`[data-action="money-suggest"][data-title="${suggest}"]`).click();
    await expect(dlg.locator('#money-title')).toHaveValue(suggest);
  } else {
    await dlg.locator('#money-title').fill(title);
  }
  if (category) {
    await dlg.locator(`[data-field="category"][data-value="${category}"]`).click();
    await expect(dlg.locator(`[data-field="category"][data-value="${category}"]`)).toHaveClass(/active/);
  }
  await dlg.locator('#money-amount').fill(String(amount / 100));
  await dlg.locator(`[data-field="method"][data-value="${method}"]`).click();
  const chip = payer
    ? dlg.locator('[data-field="paidBy"]').filter({hasText: payer})
    : dlg.locator('[data-field="paidBy"][data-value="drawer"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  if (photo) {
    await dlg.locator('input[data-src="gallery"]').setInputFiles(photo);
    await expect(dlg.locator('.money-photo img')).toBeVisible({timeout: 15000});
  }
  await dlg.locator('[data-action="money-save-bill"]').click();
  await expect(openDialog(page)).toHaveCount(0);
}

/** Settlement payout cards equal the independent calculation. */
async function expectSettlement(page, exp, ids) {
  await goMoney(page, 'settle');
  await expect(page.locator('.money-board [data-k="pot"]')).toHaveText(inr(Math.max(exp.pot, 0)));
  await expect(page.locator('.money-board [data-k="net"]')).toHaveText(exp.netProfit >= 0 ? inr(exp.netProfit) : `−${inr(-exp.netProfit)}`);
  for (const [i, m] of exp.members.entries()) {
    const card = page.locator(`.money-payout[data-member="${ids[i]}"]`);
    await expect(card.locator('.money-payout-head')).toContainText(m.name);
    await expect(card.locator('dt').first()).toContainText('Put in');
    await expect(card.locator('[data-k="capital"]')).toHaveText(inr(m.capital));
    if (m.recovery !== m.capital) await expect(card.locator('[data-k="recovery"]')).toHaveText(inr(m.recovery));
    else await expect(card.locator('[data-k="recovery"]')).toHaveCount(0);
    await expect(card.locator('[data-k="profit"]')).toHaveText(`+ ${inr(m.profit)}`);
    await expect(card.locator('.money-payout-total')).toContainText('take-home');
    await expect(card.locator('[data-k="payout"]')).toHaveText(inr(m.payout));
  }
  expect(exp.members.reduce((t, m) => t + m.payout, 0), 'Σ take-home = pot').toBe(Math.max(exp.pot, 0));
  // The rendered take-home amounts add up to the rendered pot too.
  const shown = await page.locator('.money-payout [data-k="payout"]').allInnerTexts();
  const toPaise = t => Math.round(Number(t.replace(/[₹,\s]/g, '')) * 100);
  expect(shown.reduce((t, x) => t + toPaise(x), 0)).toBe(toPaise(await page.locator('.money-board [data-k="pot"]').innerText()));
}

test.describe('owner acceptance flow', () => {
  test('momo stall: onboarding → themes → bills & contri → sales → restock → settlement → backup/restore', async ({page}, testInfo) => {
    test.setTimeout(300000);
    const errors = watchErrors(page);

    // ---- 1. Fresh device → onboarding ------------------------------------------------------------------------------
    await ready(page, {onboarding: 'keep'});
    await expect(page.locator('#sheet[open][data-kind="onboarding"]')).toBeVisible();
    // Stall's Collab + COMING SOON sticker is in the nav on first load (sidebar / rail / bottom nav).
    const collabNav = page.locator('[data-action="nav"][data-screen="collab"]:visible').first();
    await expect(collabNav).toBeVisible();
    await expect(collabNav).toContainText(isDesktop(page) ? 'Stall’s Collab' : 'Collab');
    await expect(collabNav.locator('sup.nav-soon')).toBeVisible();
    await expect(collabNav.locator('sup.nav-soon')).toHaveText(isDesktop(page) ? 'COMING SOON' : 'SOON', {useInnerText: true});

    const dlg = sheet(page);
    await dlg.locator('label[for="onb-tpl-momo-corner"]').click();
    await expect(dlg.locator('#onb-tpl-momo-corner')).toBeChecked();
    await expect(dlg.locator('#onb-prices')).toBeChecked();
    await dlg.locator('[data-action="onb-next"]').click();
    await dlg.locator('#onb-stallName').fill(STALL);
    await dlg.locator('#onb-partners').fill('Viraj, Aisha, Kabir');
    await expect(dlg.locator('[data-onb-partners]')).toContainText('3');
    await dlg.locator('[data-action="onb-next"]').click();
    await expect(dlg).toContainText(`${STALL} is ready!`);
    await expect(dlg).toContainText('3 partners');
    await dlg.locator('[data-action="onb-finish"]').click();
    await expect(openDialog(page)).toHaveCount(0);
    await expect(page.locator('#main.screen-sell')).toBeVisible();

    let st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.config.templateId).toBe('momo-corner');
    expect(st.config.theme).toMatchObject({themeId: 'momo-corner', ...MOMO_LOOK});
    expect(st.config.profile.stallName).toBe(STALL);
    expect(st.config.mission.mode).toBe('ledger');
    const members = st.config.team.members;
    expect(members.map(m => m.name)).toEqual(['Viraj', 'Aisha', 'Kabir']);
    const ids = members.map(m => m.id);
    const menuIds = st.config.products.map(p => p.id);
    expect(menuIds).toContain('steamed-veg-momos-full');
    expect(st.config.products.every(p => p.price !== null)).toBe(true);

    // Sell: themed hero + the new name; ledger stall with no bills → no target yet.
    await expect(page.locator('.sell-hero .sell-hero-name')).toContainText(STALL);
    await expect(page.locator('.event-title')).toContainText(STALL);
    await expectLook(page, MOMO_LOOK);
    await expect(page.locator('.sell-mission.is-unset')).toContainText('No bills logged yet');
    await noOverflow(page, 'themed sell');

    // The Collab page opens from the nav.
    await page.locator('[data-action="nav"][data-screen="collab"]:visible').first().click();
    await expect(page.locator('#main.screen-collab .collab-page')).toBeVisible();
    await expect(page.locator('.collab-hero sup.collab-soon')).toHaveText('COMING SOON');

    // Studio › Themes: Sweet Tooth look only (first admin action creates PIN 1234), menu stays; then back.
    await applyLook(page, 'sweet-tooth');
    st = await state(page);
    expect(st.config.theme).toMatchObject({themeId: 'sweet-tooth', ...SWEET_LOOK});
    expect(st.config.templateId).toBe('momo-corner');
    expect(st.config.products.map(p => p.id)).toEqual(menuIds);
    expect(st.pin).not.toBeNull();
    await goTo(page, 'sell');
    await expectLook(page, SWEET_LOOK);
    await expect(page.locator('article.sell-card[data-product="steamed-veg-momos-full"]')).toBeVisible();
    await applyLook(page, 'momo-corner');
    st = await state(page);
    expect(st.config.theme).toMatchObject({themeId: 'momo-corner', ...MOMO_LOOK});
    expect(st.config.products.map(p => p.id)).toEqual(menuIds);
    await goTo(page, 'sell');
    await expectLook(page, MOMO_LOOK);

    // ---- 2. Expenses & Team Contri ---------------------------------------------------------------------------------
    await goMoney(page, 'bills');
    await act(page, 'money-add-bill').click();
    await fillBill(page, {title: 'Stall rent', category: 'rent', amount: 150000, method: 'UPI', payer: 'Viraj'});
    await expect(page.locator('#toast')).toContainText('break-even now ₹1,500');
    await act(page, 'money-add-bill').click();
    await fillBill(page, {title: 'Initial raw materials', category: 'pre-stall', amount: 200000, method: 'Cash', payer: 'Aisha', photo: await billPhoto(page)});
    await act(page, 'money-add-bill').click();
    await fillBill(page, {title: 'Plates & cups', category: 'packaging', amount: 30000, method: 'Cash'});
    await expect(page.locator('#toast')).toContainText('break-even now ₹3,800');

    st = await state(page);
    const bills = st.live.expenses;
    expect(bills.map(e => [e.title, e.category, e.amount, e.method, e.paidBy])).toEqual([
      ['Stall rent', 'rent', 150000, 'UPI', ids[0]],
      ['Initial raw materials', 'pre-stall', 200000, 'Cash', ids[1]],
      ['Plates & cups', 'packaging', 30000, 'Cash', 'drawer'],
    ]);
    const photoRef = bills[1].billImage;
    expect(photoRef).toMatch(/^media:/);
    expect(bills[0].billImage).toBeNull();
    const rawRow = page.locator(`[data-action="money-bill"][data-id="${bills[1].id}"]`);
    await expect(rawRow).toContainText('Initial raw materials');
    await expect(rawRow).toContainText('₹2,000');
    await expect(rawRow.locator('.money-thumb img')).toBeVisible();
    await noOverflow(page, 'bills ledger');

    // Contri: Kabir ₹1,000 — the PIN is asked (admin locked first so the prompt really shows).
    await goMoney(page, 'team');
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.lockAdmin()));
    await act(page, 'money-contri').click();
    await unlockAdmin(page, '1234');
    await expect(page.locator('#sheet[open][data-kind="money-contri-form"]')).toBeVisible();
    await sheet(page).locator('[data-field="memberId"]').filter({hasText: 'Kabir'}).click();
    await sheet(page).locator('#money-contri-amount').fill('1000');
    await act(page, 'money-save-contri').click();
    await expect(openDialog(page)).toHaveCount(0);
    st = await state(page);
    expect(st.live.contributions.map(x => [x.memberId, x.amount, x.method, x.void])).toEqual([[ids[2], 100000, 'Cash', false]]);
    const kabir = page.locator(`.money-leader[data-member="${ids[2]}"]`);
    await expect(kabir.locator('[data-k="contri"]')).toHaveText('₹1,000');
    await expect(page.locator(`.money-leader[data-member="${ids[1]}"] [data-k="bills"]`)).toHaveText('₹2,000');

    await expectMission(page, {target: 380000, collected: 0});

    // ---- 3. Live sales (UPI ID set in Studio first) ----------------------------------------------------------------
    await goStudio(page);
    await page.locator('#studio-upi-id').fill(UPI_ID);
    await adminClick(page, act(page, 'studio-save-upi'));
    await expect.poll(async () => (await state(page)).config.upi.id).toBe(UPI_ID);

    // Cash ₹1,100 paid with ₹1,200 → ₹100 change.
    await sell(page, {items: [['chole-bhature', 5], ['steamed-veg-momos-full', 5], ['cola', 5]], total: 110000, method: 'Cash', tender: '1200', change: 10000});
    // UPI ₹900 (QR for the exact amount, cashier confirms).
    await sell(page, {items: [['fried-momos-full', 5], ['mint-mojito', 7]], total: 90000, method: 'UPI'});
    st = await state(page);
    expect(st.live.orders.map(o => [o.method, o.total, o.status])).toEqual([['Cash', 110000, 'paid'], ['UPI', 90000, 'paid']]);
    expect(st.live.orders[0]).toMatchObject({cashReceived: 120000, change: 10000});
    await expectMission(page, {target: 380000, collected: 200000});
    // 2,000 / 3,800 = 52% → "Halfway there" (recovery 50) unlocked.
    await expectMilestone(page, 'halfway-there', 'is-unlocked');
    expect((await state(page)).live.milestones['halfway-there']).toMatchObject({active: true});

    // ---- 4. Mid-stall restock from the Dashboard -------------------------------------------------------------------
    await goTo(page, 'dashboard');
    await page.locator('.dash-hero [data-action="money-restock"]:visible').first().click();
    await expect(sheet(page)).toContainText('Quick mid-stall restock');
    await fillBill(page, {suggest: 'Extra cheese & buns', amount: 60000, method: 'Cash', payer: 'Kabir'});
    await expect(page.locator('#toast')).toContainText('break-even now ₹4,400');
    st = await state(page);
    expect(st.live.expenses.at(-1)).toMatchObject({title: 'Extra cheese & buns', category: 'restock', amount: 60000, paidBy: ids[2]});
    await expect(page.locator('.dash-breakdown-restock')).toContainText('₹600');
    await expectMission(page, {target: 440000, collected: 200000});
    // 2,000 / 4,400 = 45% < 50% → the Halfway milestone is reversed (keeps its unlock record).
    await expectMilestone(page, 'halfway-there', 'is-reversed');
    await expect(page.locator('.ms-card[data-milestone="halfway-there"]')).toContainText('REVERSED');
    st = await state(page);
    expect(st.live.milestones['halfway-there'].active).toBe(false);
    expect(st.live.milestones['halfway-there'].unlockedAt).toEqual(expect.any(String));

    // One more cash sale (₹400 with a ₹500 note) → 2,400 / 4,400 = 54% → unlocked again.
    await sell(page, {items: [['chole-bhature', 4]], total: 40000, method: 'Cash', note: 50000, change: 10000});
    await expectMission(page, {target: 440000, collected: 240000});
    await expectMilestone(page, 'halfway-there', 'is-unlocked');
    expect((await state(page)).live.milestones['halfway-there'].active).toBe(true);

    // ---- 5. Settlement ----------------------------------------------------------------------------------------------
    const names = ['Viraj', 'Aisha', 'Kabir'];
    const contri = [0, 0, 100000];
    const pocket = [150000, 200000, 60000];
    const expenses = 150000 + 200000 + 30000 + 60000;
    // Loss so far: revenue 2,400 − bills 4,400 → pot 3,100 shared in proportion to capital (paise by largest remainder).
    const loss = settle({names, contri, pocket, revenue: 240000, expenses});
    expect(loss.pot).toBe(310000);
    expect(loss.members.map(m => m.payout)).toEqual([91176, 121569, 97255]);
    await expectSettlement(page, loss, ids);

    // Into profit: ₹2,100 more by UPI → revenue 4,500, net profit ₹100 → ₹33.34 / ₹33.33 / ₹33.33.
    await sell(page, {items: [['fried-momos-full', 10], ['chole-bhature', 10]], total: 210000, method: 'UPI'});
    const win = settle({names, contri, pocket, revenue: 450000, expenses});
    expect(win.pot).toBe(520000);
    expect(win.members.map(m => [m.capital, m.recovery, m.profit, m.payout])).toEqual([
      [150000, 150000, 3334, 153334],
      [200000, 200000, 3333, 203333],
      [160000, 160000, 3333, 163333],
    ]);
    await expectSettlement(page, win, ids);
    await noOverflow(page, 'settlement');

    // Copy settlement report: every member line is in it; the WhatsApp link carries the same text.
    await page.evaluate(() => {
      window.__copied = '';
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async t => (window.__copied = t)}});
    });
    await act(page, 'money-copy').click();
    await expect(page.locator('#toast')).toContainText('copied');
    const copied = await page.evaluate(() => window.__copied);
    expect(copied).toContain(`*🤝 ${STALL} — Team settlement*`);
    expect(copied).toContain('💰 Revenue: ₹4,500');
    expect(copied).toContain('📈 Net profit: ₹100');
    for (const m of win.members) {
      expect(copied).toContain(`• ${m.name} — put in ${inr(m.capital)} → back ${inr(m.recovery)} + profit ${inr(m.profit)} = *${inr(m.payout)}*`);
    }
    const href = await page.locator('a[data-money-wa]').getAttribute('href');
    expect(href?.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(String(href).slice('https://wa.me/?text='.length))).toBe(copied);

    // Save snapshot asks for the PIN, then shows up in the list.
    await page.evaluate(() => import('/ui/core.mjs').then(m => m.lockAdmin()));
    await act(page, 'money-snapshot').click();
    await unlockAdmin(page, '1234');
    await expect(page.locator('.money-snap')).toHaveCount(1);
    await expect(page.locator('.money-snap')).toContainText('Profit ₹100');
    await expect(page.locator('.money-snap')).toContainText('split ₹5,200');
    st = await state(page);
    expect(st.live.settlements).toHaveLength(1);
    expect(st.live.settlements[0].result.members.map(m => m.payout)).toEqual([153334, 203333, 163333]);

    // ---- 6. Backup → factory reset → restore -----------------------------------------------------------------------
    await goTo(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), act(page, 'data-export', '[data-kind="json"]').click()]);
    expect(dl.suggestedFilename()).toMatch(/^mys-backup-momo-masti-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath('flow-backup.json');
    await dl.saveAs(file);
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    expect(backup.state.live.expenses).toHaveLength(4);
    expect(Object.keys(backup.media || {})).toContain(photoRef.slice('media:'.length));
    await act(page, 'close').click();
    await expect(openDialog(page)).toHaveCount(0);

    await page.locator('[data-tile="danger"]').click();
    await adminClick(page, act(page, 'data-factory'));
    await sheet(page).locator('#confirm-typed').fill('FACTORY RESET');
    await act(page, 'core-confirm').click();
    await expect(page.locator('#sheet[open][data-kind="onboarding"]')).toBeVisible();
    st = await state(page);
    expect(st.onboarded).toBe(false);
    expect(st.live.orders).toHaveLength(0);
    expect(st.live.expenses).toHaveLength(0);
    expect(st.live.contributions).toHaveLength(0);
    expect(st.config.team.members).toHaveLength(0);
    await sheet(page).locator('[data-action="onb-skip"]').click();
    await expect(openDialog(page)).toHaveCount(0);

    await goTo(page, 'more');
    await page.locator('[data-tile="backups"]').click();
    await page.setInputFiles('#data-restore-file', file);
    await expect(sheet(page).locator('[data-restore-summary]')).toContainText(STALL);
    await adminClick(page, act(page, 'data-restore'));
    await expect(openDialog(page)).toContainText('Replace this device’s stall?');
    await act(page, 'core-confirm').click();
    await expect(openDialog(page)).toHaveCount(0);

    st = await state(page);
    expect(st.onboarded).toBe(true);
    expect(st.config.profile.stallName).toBe(STALL);
    expect(st.config.theme).toMatchObject({themeId: 'momo-corner', ...MOMO_LOOK});
    expect(st.config.team.members.map(m => [m.id, m.name])).toEqual(ids.map((id, i) => [id, names[i]]));
    expect(st.config.upi.id).toBe(UPI_ID);
    expect(st.live.expenses.map(e => [e.title, e.amount, e.paidBy, e.billImage])).toEqual([
      ['Stall rent', 150000, ids[0], null],
      ['Initial raw materials', 200000, ids[1], photoRef],
      ['Plates & cups', 30000, 'drawer', null],
      ['Extra cheese & buns', 60000, ids[2], null],
    ]);
    expect(st.live.contributions.map(x => [x.memberId, x.amount])).toEqual([[ids[2], 100000]]);
    expect(st.live.orders.map(o => o.total)).toEqual([110000, 90000, 40000, 210000]);
    expect(st.live.settlements).toHaveLength(1);
    const photoBack = await page.evaluate(async id => {
      const storage = await import('/storage.mjs');
      const all = await storage.getAllMedia();
      return typeof all[id] === 'string' && all[id].startsWith('data:image/jpeg');
    }, photoRef.slice('media:'.length));
    expect(photoBack, 'bill photo restored into the media store').toBe(true);

    // The UI agrees: themed hero, profit mode, bill photo, contri, payouts.
    await goTo(page, 'sell');
    await expect(page.locator('.sell-hero .sell-hero-name')).toContainText(STALL);
    await expectLook(page, MOMO_LOOK);
    await expect(page.locator('.sell-mission.is-profit')).toContainText('₹100 profit');
    await goMoney(page, 'bills');
    const restoredRow = page.locator(`[data-action="money-bill"][data-id="${bills[1].id}"]`);
    await expect(restoredRow.locator('.money-thumb img')).toBeVisible();
    await restoredRow.click();
    await expect(sheet(page).locator('.money-detail-photo img')).toBeVisible();
    await expect.poll(() => sheet(page).locator('.money-detail-photo img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await act(page, 'close').click();
    await expect(openDialog(page)).toHaveCount(0);
    await goMoney(page, 'team');
    await expect(page.locator(`.money-leader[data-member="${ids[2]}"] [data-k="contri"]`)).toHaveText('₹1,000');
    await expectSettlement(page, win, ids);
    await expect(page.locator('.money-snap')).toHaveCount(1);
    await noOverflow(page, 'restored settlement');

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
