// Shared Playwright helpers for ManageYourStall browser specs (owner: lead).
// Usage: import {ready, act, go, unlockAdmin, noOverflow, sheet, state} from './helpers.mjs';
import {expect} from '@playwright/test';

/** First visible element with data-action="name" (optional extra selector, e.g. '[data-id="samosa"]'). */
export const act = (page, name, extra = '') => page.locator(`[data-action="${name}"]${extra}:visible`).first();

/** The modal sheet (<dialog id="sheet">). */
export const sheet = page => page.locator('#sheet');

/**
 * Open the app on a fresh device (each Playwright test has its own empty IndexedDB) and wait until boot hooks ran.
 * Fresh installs show onboarding; by default it is skipped so the sample "Snacks & Pizza" stall is ready to sell.
 */
export async function ready(page, {onboarding = 'skip', path = '/'} = {}) {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, {timeout: 15000});
  await expect(page.locator('.app-shell')).toBeVisible();
  if (onboarding === 'skip') {
    const skip = page.locator('#sheet[open] [data-action="onb-skip"]');
    if (await skip.count()) {
      await skip.first().click();
      await expect(page.locator('#sheet[open]')).toHaveCount(0);
    }
  }
}

/** Navigate with the visible nav (sidebar on desktop, bottom nav on phones) or the More hub fallback. */
export async function go(page, screen) {
  const nav = page.locator(`[data-action="nav"][data-screen="${screen}"]:visible`).first();
  if (await nav.count()) await nav.click();
  else await page.evaluate(s => import('/ui/core.mjs').then(m => m.navigate(s)), screen);
  await expect(page.locator(`#main.screen-${screen}`)).toBeVisible();
}

/** Satisfy the admin PIN dialog if it is open (creates the PIN on first use). */
export async function unlockAdmin(page, pin = '1234') {
  const dlg = page.locator('#pin-dialog[open]');
  await dlg.waitFor({state: 'visible', timeout: 5000});
  await dlg.locator('#pin-entry').fill(pin);
  const repeat = dlg.locator('#pin-repeat');
  if (await repeat.count()) await repeat.fill(pin);
  await dlg.locator('[data-pin-action="submit"]').click();
  await expect(page.locator('#pin-dialog[open]')).toHaveCount(0);
}

/**
 * Click an action that may ask for the admin PIN; unlocks when prompted.
 * While admin is already unlocked no prompt can appear, so it returns right away; otherwise it waits up to
 * `timeout` ms for the PIN dialog (generous, so a busy machine running several specs doesn't miss a slow prompt).
 */
export async function adminClick(page, locator, pin = '1234', {timeout = 3000} = {}) {
  const unlocked = await page.evaluate(() => import('/ui/core.mjs').then(m => m.isAdmin())).catch(() => false);
  await locator.click();
  if (unlocked) return;
  const dlg = page.locator('#pin-dialog[open]');
  try {
    await dlg.waitFor({state: 'visible', timeout});
  } catch {
    return;
  }
  await unlockAdmin(page, pin);
}

/** Assert the page has no horizontal scroll. */
export async function noOverflow(page, label = '') {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(ok, `horizontal overflow ${label}`).toBeTruthy();
}

/** Read the persisted state straight from the UI kernel (for assertions only). */
export const state = page => page.evaluate(() => import('/ui/core.mjs').then(m => JSON.parse(JSON.stringify(m.store.state))));

/** Run a registered action programmatically (use sparingly; prefer real clicks). */
export const runAction = (page, name, ds = {}) => page.evaluate(([n, d]) => import('/ui/core.mjs').then(m => m.runAction(n, d)), [name, ds]);
