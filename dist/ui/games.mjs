// Game corner for ManageYourStall (ARCHITECTURE.md §13.9): game cards with play counts, "Record play" sheet
// (prize, fee method + receipt confirmation), recent plays with admin reversal, game stats. created by viraj
//
// Public action: games-open. Private: games-record, games-method, games-save, games-reverse.
import {
  S, C, esc, money, icon, btn, field, check, heading, emptyState, artFrame, openSheet, closeSheet, sheetEl, confirmSheet, toast,
  commit, navigate, registerScreen, registerActions, requireAdmin, time, date,
} from './core.mjs';
import {addGame, voidGame, report, uuid} from '../domain.mjs';
import {PAYMENT_METHODS, LIMITS} from '../constants.mjs';
import {istDate} from '../util.mjs';

/** Card tints, cycled by position (games have art but no tint of their own). */
const TINTS = ['lavender', 'yellow', 'sky', 'pink', 'lime', 'mint', 'peach', 'coral'];
/** Payment method picked in the open "Record play" sheet. @type {'Cash'|'UPI'|'Other'} */
let playMethod = 'Cash';

const METHOD_ICON = {Cash: 'cash', UPI: 'upi', Other: 'wallet'};

/** @param {any} c @param {string} id */
const tintOf = (c, id) => TINTS[Math.max(0, c.games.findIndex((/** @type {any} */ g) => g.id === id)) % TINTS.length];

/** Confirmation wording for a paid play. @param {string} method @param {number} fee */
const confirmText = (method, fee) =>
  method === 'UPI' ? `I saw ${money(fee)} arrive in my UPI app` : method === 'Other' ? `I received ${money(fee)} (other method)` : `I received ${money(fee)} in cash`;

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function gamesScreen() {
  const c = C();
  const s = S();
  const r = report(s, c);
  const back = btn(`${icon('chevron-left')} More`, 'nav', 'small quiet-outline', 'data-screen="more"');
  const manage = btn(`${icon('edit')} Manage games`, 'studio-open', 'small', 'data-section="games"');
  const head = heading('Game corner', 'The games happen at the stall. We keep the score.', back + (c.games.length ? manage : ''));
  if (!c.games.length) {
    return head + emptyState('game', 'No games set up yet', 'Ring toss, spin the wheel, lucky cup — add a game with an entry fee (or free) and start counting plays.',
      btn(`${icon('plus')} Add a game`, 'studio-open', 'primary', 'data-section="games"'));
  }
  /** @type {Record<string, number>} */
  const counts = {};
  const today = istDate();
  let todayPlays = 0;
  let reversed = 0;
  for (const g of s.games) {
    if (g.void) {
      reversed++;
      continue;
    }
    counts[g.gameId] = (counts[g.gameId] || 0) + 1;
    if (istDate(g.at) === today) todayPlays++;
  }
  const cards = c.games.map((g, i) => {
    const n = counts[g.id] || 0;
    const fee = g.fee > 0 ? `<span class="badge yellow games-fee">${money(g.fee)} / play</span>` : '<span class="badge mint games-fee">Free</span>';
    return `<article class="games-card">
      <div class="games-card-art">${artFrame({art: g.art, tint: TINTS[i % TINTS.length], pattern: 'sunburst', name: g.name}, {size: 'md', cls: 'games-art'})}
        <span class="games-count"><strong>${n}</strong><small>${n === 1 ? 'play' : 'plays'}</small></span></div>
      <div class="games-card-body">
        <div class="games-card-title"><h3>${esc(g.name)}</h3>${fee}</div>
        ${btn(`${icon('plus')} Record play`, 'games-record', 'primary block', `data-id="${esc(g.id)}"`)}
      </div>
    </article>`;
  }).join('');

  const recent = s.games.slice(-25).reverse();
  const rows = recent.length
    ? recent.map(g => {
      const meta = [time(g.at), g.operator, g.fee > 0 ? g.method : 'Free', g.prize ? `Prize: ${g.prize}` : ''].filter(Boolean).map(esc).join(' · ');
      return `<div class="games-play${g.void ? ' is-void' : ''}">
        ${artFrame({art: c.games.find(x => x.id === g.gameId)?.art || 'spin-wheel', tint: tintOf(c, g.gameId)}, {size: 'xs', cls: 'games-art'})}
        <div class="grow"><h3>${esc(g.name)}${g.void ? ' <span class="badge coral">Reversed</span>' : ''}</h3><small>${meta}</small></div>
        <div class="games-play-end"><strong class="games-play-fee">${g.fee > 0 ? money(g.fee) : 'Free'}</strong>
        ${g.void ? '' : btn('Reverse', 'games-reverse', 'small quiet-outline', `data-id="${esc(g.id)}" aria-label="Reverse ${esc(g.name)} play at ${esc(time(g.at))}"`)}</div>
      </div>`;
    }).join('')
    : `<p class="games-empty">${icon('game')} Who’s feeling lucky? Record the first play.</p>`;

  return `${head}
  <div class="games-stats">
    <div class="stat">${icon('game')}<strong>${r.games}</strong><small>Plays · not unique people</small></div>
    <div class="stat">${icon('rupee')}<strong>${money(r.gameIncome)}</strong><small>Net game income</small></div>
    <div class="stat">${icon('clock')}<strong>${todayPlays}</strong><small>Plays today${reversed ? ` · ${reversed} reversed` : ''}</small></div>
  </div>
  <div class="games-grid">${cards}</div>
  <section class="panel games-recent" aria-labelledby="games-recent-title">
    <div class="games-recent-head"><h2 id="games-recent-title">Recent plays</h2>${s.games.length > 25 ? `<span class="badge">Last 25 of ${s.games.length}</span>` : ''}</div>
    ${rows}
  </section>`;
}

registerScreen('games', gamesScreen);

// ---------------------------------------------------------------------------------------------------------------------
// Record a play
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function recordSheet(id) {
  const c = C();
  const g = c.games.find(x => x.id === id);
  if (!g) throw Error('That game is no longer set up.');
  playMethod = 'Cash';
  const paid = g.fee > 0;
  const methods = PAYMENT_METHODS.map(m =>
    `<button type="button" data-action="games-method" data-method="${m}" aria-pressed="${m === playMethod}">${icon(METHOD_ICON[m])} ${m}</button>`).join('');
  const payment = paid
    ? `<div class="field"><span class="field-label" id="games-method-label">How did they pay ${money(g.fee)}?</span>
        <div class="segmented block games-methods" role="group" aria-labelledby="games-method-label">${methods}</div></div>
      <div class="games-confirm">${check('games-paid', `<span data-games-confirm>${confirmText(playMethod, g.fee)}</span>`)}</div>
      <p class="footnote games-upi-note" hidden>Check the credit in your UPI app before ticking — MYS can’t see bank payments.</p>`
    : `<div class="notice mint">${icon('gift')}<div><strong>Free game — nothing to collect.</strong> Just count the play.</div></div>`;
  const body = `<form class="games-form" data-submit="games-save" data-id="${esc(g.id)}" data-play="${uuid()}">
    <div class="games-sheet-head">${artFrame({art: g.art, tint: tintOf(c, g.id), pattern: 'sunburst'}, {size: 'sm', cls: 'games-art'})}
      <div class="grow"><strong>${esc(g.name)}</strong><small>${paid ? `${money(g.fee)} entry fee` : 'Free to play'}</small></div></div>
    ${field('Prize given (optional)', 'games-prize', '', 'text', `maxlength="${LIMITS.prize}" autocomplete="off" placeholder="Keychain, toffee… or better luck next time"`)}
    ${payment}
  </form>`;
  openSheet('Record a play', body, btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Record play${paid ? ` · ${money(g.fee)}` : ''}`, 'games-save', 'primary'), 'games-record');
}

/** @param {string} method */
function pickMethod(method) {
  if (!PAYMENT_METHODS.includes(/** @type {any} */ (method))) return;
  playMethod = /** @type {'Cash'|'UPI'|'Other'} */ (method);
  const sheet = sheetEl();
  const form = sheet?.querySelector('.games-form');
  const g = C().games.find(x => x.id === form?.getAttribute('data-id'));
  if (!sheet || !g) return;
  sheet.querySelectorAll('[data-action="games-method"]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-method') === method)));
  const label = sheet.querySelector('[data-games-confirm]');
  if (label) label.textContent = confirmText(method, g.fee);
  const box = /** @type {HTMLInputElement|null} */ (sheet.querySelector('[name="games-paid"]'));
  if (box) box.checked = false;
  const note = /** @type {HTMLElement|null} */ (sheet.querySelector('.games-upi-note'));
  if (note) note.hidden = method !== 'UPI';
}

async function savePlay() {
  const form = /** @type {HTMLFormElement|null} */ (sheetEl()?.querySelector('.games-form'));
  if (!form) return;
  const g = C().games.find(x => x.id === form.dataset.id);
  if (!g) throw Error('That game is no longer set up.');
  const prize = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="games-prize"]'))?.value ?? '';
  const paid = g.fee > 0;
  if (paid && !(/** @type {HTMLInputElement|null} */ (form.querySelector('[name="games-paid"]'))?.checked)) {
    throw Error(`Tick the box once you have the ${money(g.fee)} — ${playMethod === 'UPI' ? 'check your UPI app' : 'count the cash'}.`);
  }
  const method = paid ? playMethod : 'Cash';
  await commit(st => addGame(st[st.mode], st.config, {id: form.dataset.play || uuid(), gameId: g.id, prize, method}));
  closeSheet();
  toast(paid ? `${g.name}: play recorded · ${money(g.fee)} ${method}.` : `${g.name}: play recorded. Good luck to them!`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reverse a play
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
function reverseSheet(id) {
  const play = S().games.find(g => g.id === id);
  if (!play) throw Error('That game play could not be found.');
  if (play.void) throw Error('This play is already reversed.');
  const paid = play.fee > 0;
  confirmSheet({
    title: 'Reverse this play?',
    body: `<div class="games-reverse-card"><strong>${esc(play.name)}</strong><small>${esc(date(play.at))} · ${esc(play.operator)}${paid ? ` · ${money(play.fee)} ${esc(play.method)}` : ' · Free'}</small></div>
      ${field('Reason', 'games-reason', '', 'text', `maxlength="${LIMITS.reason}" autocomplete="off" required placeholder="Tapped the wrong game, fee returned…"`)}
      ${paid ? check('games-refunded', `I gave back the ${money(play.fee)} (${esc(play.method)})`) : ''}
      <p class="footnote">The play stays in history marked REVERSED${paid ? ' and its fee leaves your collections' : ''}.</p>`,
    confirmLabel: 'Reverse play',
    danger: true,
    onConfirm: async () => {
      const sheet = sheetEl();
      const reason = /** @type {HTMLInputElement|null} */ (sheet?.querySelector('[name="games-reason"]'))?.value.trim() ?? '';
      if (!reason) throw Error('Add a short reason so the audit trail makes sense later.');
      if (paid && !(/** @type {HTMLInputElement|null} */ (sheet?.querySelector('[name="games-refunded"]'))?.checked)) {
        throw Error(`Tick the box once the ${money(play.fee)} is back with the customer.`);
      }
      const done = await requireAdmin(async () => {
        await commit(st => voidGame(st[st.mode], st.config, id, reason));
        return true;
      });
      if (!done) throw Error('The admin PIN is needed to reverse a play.');
      closeSheet();
      toast(paid ? `Play reversed. ${money(play.fee)} removed from collections.` : 'Play reversed.');
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

registerActions(
  {
    'games-open': () => {
      closeSheet();
      navigate('games');
    },
    'games-record': (_el, ds) => recordSheet(ds.id || ''),
    'games-method': (_el, ds) => pickMethod(ds.method || ''),
    'games-save': () => savePlay(),
    'games-reverse': (_el, ds) => reverseSheet(ds.id || ''),
  },
  {admin: ['games-reverse']},
);
