// Stall's Collab — COMING SOON concept page (collab agent, ARCHITECTURE.md §16.7).
import {test, expect} from '@playwright/test';
import {ready, noOverflow, state} from './helpers.mjs';

/** Open the collab screen (the nav item is owned by the shell; navigate through the kernel). */
async function openCollab(page) {
  await page.evaluate(() => import('/ui/core.mjs').then(m => m.navigate('collab')));
  await expect(page.locator('#main.screen-collab .collab-page')).toBeVisible();
}

const SECTION_IDS = ['collab-rescue', 'collab-deal', 'collab-board', 'collab-sos', 'collab-match'];

test.describe("Stall's Collab concept page", () => {
  /** @type {string[]} */
  let errors;
  test.beforeEach(async ({page}) => {
    errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    await openCollab(page);
  });
  test.afterEach(() => {
    expect(errors, 'page errors').toEqual([]);
  });

  test('renders the hero, all five sections and an honest COMING SOON note', async ({page}) => {
    const hero = page.locator('.collab-hero');
    await expect(hero.locator('h1')).toContainText('Stall’s Collab');
    await expect(hero.locator('sup.collab-soon')).toHaveText('COMING SOON');
    await expect(hero).toContainText('Stalls that team up, sell out.');
    await expect(hero).toContainText('Coming soon · nothing is sent to other stalls yet');
    for (const id of SECTION_IDS) await expect(page.locator(`section#${id} h2`)).toBeVisible();
    await expect(page.locator('section#collab-rescue')).toContainText('Buy at Stall A → get ₹15 off at Stall B');
    await expect(page.locator('section#collab-rescue svg[role="img"]:visible')).toHaveCount(1);
    await expect(page.locator('.collab-jumps [data-action="collab-jump"]')).toHaveCount(5);
    await expect(page.locator('.collab-cta')).toContainText('Try the match simulator');
    await expect(page.locator('.collab-cta')).toContainText('Vote for the first feature');
    await noOverflow(page, 'collab first load');
  });

  test('quick jumps move keyboard focus to the target section', async ({page}) => {
    const cta = page.locator('.collab-cta [data-target="collab-sim"]');
    await cta.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#collab-sim .collab-sub-h')).toBeFocused();
    await page.locator('.collab-jumps [data-target="collab-sos"]').click();
    await expect(page.locator('#collab-sos-h')).toBeFocused();
  });

  test('chat quick reply plays the scripted messages and the deal can be accepted', async ({page}) => {
    const revision = (await state(page)).revision;
    const log = page.locator('.collab-chat-log');
    const msgs = log.locator('.collab-msg');
    const before = await msgs.count();
    await page.locator('.collab-reply').first().click();
    await expect(log.locator('.collab-msg.from-a').last()).toContainText('How do the tokens work?');
    await expect(msgs).toHaveCount(before + 2);
    await expect(log.locator('.collab-msg.from-b').last()).toContainText('₹15 off any lassi');
    await expect(page.locator('.collab-reply')).toHaveCount(2);

    await page.locator('[data-action="collab-deal-accept"]').click();
    await expect(page.locator('.collab-deal.accepted')).toContainText('Accepted');
    await expect(log.locator('.collab-msg-system')).toContainText('Nothing was sent');
    await page.locator('[data-action="collab-chat-reset"]').click();
    await expect(msgs).toHaveCount(before);
    // The concept page never writes to the stall ledger.
    expect((await state(page)).revision).toBe(revision);
  });

  test('countering the deal revises the card', async ({page}) => {
    await page.locator('[data-action="collab-deal-counter"]').click();
    await expect(page.locator('.collab-deal-terms')).toContainText('45 combo tokens');
    await expect(page.locator('.collab-deal-terms')).toContainText('₹12 off');
    await expect(page.locator('[data-action="collab-deal-counter"]')).toHaveCount(0);
    await expect(page.locator('.collab-deal')).toHaveCount(1);
  });

  test('tapping a booth on the map shows its card', async ({page}) => {
    const card = page.locator('#collab-booth-card');
    await expect(card).toContainText('Tap a booth on the map');
    const booth = page.locator('[data-action="collab-booth"][data-id="b3"]');
    await booth.click();
    await expect(booth).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toContainText('Lassi Lounge');
    await expect(card).toContainText('Quiet');
    await expect(card.locator('[role="meter"]')).toHaveAttribute('aria-valuenow', '12');
    await expect(card).toContainText('Swap for 2 hrs');
    await expect(card).toContainText('Share table');
    await expect(page.locator('.collab-listing')).toHaveCount(3);
    await expect(page.locator('.collab-listings')).toContainText('Swap my corner spot 4–6 pm');
    await expect(page.locator('.collab-listings')).toContainText('Share a table for the evening rush');
    await card.locator('[data-action="collab-soon"]').first().click();
    await expect(page.locator('#toast')).toContainText('Nothing was sent');
  });

  test('SOS ping shows nearby responders', async ({page}) => {
    await page.locator('[data-action="collab-sos"][data-id="plates"]').click();
    await expect(page.locator('.collab-radar-status')).toContainText(/Pinging stalls|stalls can help/);
    const responders = page.locator('.collab-responder');
    await expect(responders).toHaveCount(3);
    await expect(responders.first()).toContainText('Momo Corner · 40 m · can spare 50 plates');
    await expect(page.locator('.collab-radar-status')).toContainText('2 stalls can help');
    await expect(page.locator('.collab-blip')).toHaveCount(3);
    await page.locator('[data-action="collab-sos"][data-id="ice"]').click();
    await expect(page.locator('.collab-responder').first()).toContainText('Cold Coffee Co.');
  });

  test('match simulator: every choice ends in a match card', async ({page}) => {
    const expected = {crowd: 'Lassi Lounge', footfall: 'Momo Mania', exchange: 'Book Swap', sos: 'Momo Corner'};
    for (const [id, name] of Object.entries(expected)) {
      await page.locator(`[data-action="collab-sim"][data-id="${id}"]`).click();
      await expect(page.locator('.collab-sim-steps')).toBeVisible();
      const card = page.locator('.collab-match-card');
      await expect(card).toBeVisible();
      await expect(card.locator('h3')).toContainText(`You ⇄ ${name}`);
      await expect(card).toContainText('Example deal');
      await expect(card).toContainText('Expected benefit');
      await expect(page.locator('.collab-sim-step.done')).toHaveCount(3);
      await expect(page.locator(`[data-action="collab-sim"][data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.locator('[data-action="collab-sim-reset"]').click();
    await expect(page.locator('.collab-match-card')).toHaveCount(0);
  });

  test('reduced motion shows the match immediately', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('[data-action="collab-sim"][data-id="footfall"]').click();
    await expect(page.locator('.collab-match-card')).toContainText('Momo Mania', {timeout: 500});
  });

  test('poll vote persists in localStorage across reloads and links to WhatsApp', async ({page}) => {
    await expect(page.locator('.collab-wa')).toHaveCount(0);
    await page.locator('[data-action="collab-vote"][data-id="booth"]').click();
    expect(await page.evaluate(() => localStorage.getItem('mys-collab-vote'))).toBe('booth');
    await expect(page.locator('.collab-poll-result')).toContainText('Booth Exchange Board');

    const wa = page.locator('a.collab-wa');
    const href = await wa.getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const text = decodeURIComponent(String(href).slice('https://wa.me/?text='.length));
    expect(text).toContain('"Booth Exchange Board"');
    expect(text).toContain('Stall\'s Collab');
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', /noopener/);
    const fromModule = await page.evaluate(() => import('/ui/collab.mjs').then(m => m.whatsappVoteUrl('Fest Lifeline SOS')));
    expect(fromModule).toBe(`https://wa.me/?text=${encodeURIComponent('Hey MYS team! 👋 I want "Fest Lifeline SOS" to launch first in Stall\'s Collab. — sent from ManageYourStall')}`);

    await page.reload();
    await ready(page);
    await openCollab(page);
    await expect(page.locator('[data-action="collab-vote"][data-id="booth"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.collab-poll-result')).toContainText('Booth Exchange Board');

    await page.locator('[data-action="collab-vote"][data-id="sos"]').click();
    expect(await page.evaluate(() => localStorage.getItem('mys-collab-vote'))).toBe('sos');
    await expect(page.locator('a.collab-wa')).toHaveAttribute('href', /Fest%20Lifeline%20SOS/);
  });

  test('no horizontal overflow at any width, before and after interacting', async ({page}) => {
    const widths = [320, 360, 390, 430, 768, 820, 1024, 1280, 1440];
    for (const width of widths) {
      await page.setViewportSize({width, height: 900});
      await noOverflow(page, `${width}px`);
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('.collab-reply').first().click();
    await page.locator('[data-action="collab-booth"][data-id="b1"]').click();
    await page.locator('[data-action="collab-sos"][data-id="change"]').click();
    await page.locator('[data-action="collab-sim"][data-id="exchange"]').click();
    await page.locator('[data-action="collab-vote"][data-id="tokens"]').click();
    await expect(page.locator('.collab-match-card')).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({width, height: 900});
      await noOverflow(page, `${width}px after interacting`);
      const small = await page.evaluate(() => [...document.querySelectorAll('.collab-page button, .collab-page a')]
        .filter(el => el.offsetParent)
        .map(el => ({el, r: el.getBoundingClientRect()}))
        .filter(({r}) => r.height < 43.5 || r.width < 43.5)
        .map(({el}) => el.textContent.trim()));
      expect(small, `tap targets under 44px at ${width}px`).toEqual([]);
    }
  });
});
