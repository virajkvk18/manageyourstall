// Stall's Collab — COMING SOON concept page (ARCHITECTURE.md §16.7). created by viraj
//
// A magazine-style, Neo-Brutalist preview of how ManageYourStall will connect the temporary stalls at a fest:
//   0. Hero · 1. Crowd & Revenue Rescue · 2. Deal Room chat · 3. Booth Exchange Board · 4. SOS Lifeline ·
//   5. Match Simulator & feature poll.
// Everything here is an honest, local preview: nothing is sent to other stalls and nothing is committed to the stall
// state. All interactive state lives in this module; the only persistence is the poll pick in localStorage
// ('mys-collab-vote'). Interactive regions are patched in place (outerHTML) so the rest of the page — and its
// animations — never restart; a full app re-render rebuilds the same view from this module's state.
import {registerScreen, registerActions, ui, esc, money, icon, toast, render} from './core.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Content (static, illustrative — never real stall data)
// ---------------------------------------------------------------------------------------------------------------------

/** localStorage key of the poll pick (per device). */
export const VOTE_KEY = 'mys-collab-vote';

/** Page sections, in order (quick-jump chips + headings). */
const SECTIONS = Object.freeze([
  {id: 'collab-rescue', no: '01', label: 'Crowd Rescue', emoji: '🔥'},
  {id: 'collab-deal', no: '02', label: 'Deal Room', emoji: '💬'},
  {id: 'collab-board', no: '03', label: 'Booth Exchange', emoji: '🗺️'},
  {id: 'collab-sos', no: '04', label: 'SOS Lifeline', emoji: '🆘'},
  {id: 'collab-match', no: '05', label: 'Match & Vote', emoji: '🎯'},
]);

/** Before/after evening-rush revenue (paise) for the rescue mini-chart. */
const RESCUE_CHART = Object.freeze([
  {stall: 'Stall A · Momo Mania', mood: '🔥', before: 640000, after: 720000, note: 'fewer walk-aways'},
  {stall: 'Stall B · Lassi Lounge', mood: '😴', before: 180000, after: 420000, note: '+40 walk-ins'},
]);

const PARTNER = Object.freeze({a: {name: 'Momo Mania', who: 'You', initials: 'MM'}, b: {name: 'Lassi Lounge', who: 'Riya', initials: 'LL'}});

/** Quick replies you (Momo Mania) can send in the Deal Room, with Lassi Lounge's scripted answers. */
const QUICK_REPLIES = Object.freeze([
  {id: 'how', text: 'How do the tokens work?', reply: 'Every momo plate gets a token. They show it at our counter → ₹15 off any lassi. Easy 🥤'},
  {id: 'print', text: 'Who prints the tokens?', reply: 'Nobody! MYS adds a token QR to your receipt — no printing 🖨️❌ (once Collab launches).'},
  {id: 'cost', text: 'Do I lose money on this?', reply: 'Not a paisa. The ₹15 off comes from our margin — you get a shorter queue and happier crowd 🙌'},
]);

const INITIAL_CHAT = () => [
  {from: 'b', text: 'Hey Momo Mania! Your queue is going round the block 😅 Ours is totally empty.'},
  {from: 'b', text: 'Send some of that crowd our way? We’ll make it worth it.'},
  {from: 'a', text: 'Haha, people ARE leaving my line. What’s the deal?'},
  {from: 'b', kind: 'deal'},
];

/** @typedef {{id: string, code: string, name: string, emoji: string, crowd: number, you?: boolean, offer: string, distance: string}} Booth */

/** Fest ground booths (crowd 0–100). */
const BOOTHS = Object.freeze(/** @type {Booth[]} */ ([
  {id: 'b1', code: 'B-01', name: 'Momo Mania', emoji: '🥟', crowd: 96, offer: 'Needs a second table for the queue', distance: '20 m'},
  {id: 'b2', code: 'B-02', name: 'Chai Tapri', emoji: '☕', crowd: 64, offer: 'Shares a table for the evening rush', distance: '35 m'},
  {id: 'b3', code: 'B-03', name: 'Lassi Lounge', emoji: '🥤', crowd: 12, offer: 'Wants footfall — combo tokens welcome', distance: '40 m'},
  {id: 'b4', code: 'B-04', name: 'Ring Toss Arena', emoji: '🎯', crowd: 72, offer: 'Open to a prize-for-snack swap', distance: '60 m'},
  {id: 'b5', code: 'B-05', name: 'Maggi Point', emoji: '🍜', crowd: 81, offer: 'Can lend a gas burner after 8 pm', distance: '55 m'},
  {id: 'b6', code: 'B-06', name: 'Henna Corner', emoji: '🌿', crowd: 30, offer: 'Happy to swap for a busier spot', distance: '45 m'},
  {id: 'b7', code: 'B-07', name: 'Pani Puri Express', emoji: '🫓', crowd: 90, offer: 'Needs plates — will trade pani puri', distance: '30 m'},
  {id: 'b8', code: 'B-08', name: 'Cold Coffee Co.', emoji: '🧋', crowd: 48, offer: 'Has spare ice till 7 pm', distance: '50 m'},
  {id: 'b9', code: 'B-09', name: 'Your stall', emoji: '⭐', crowd: 55, you: true, offer: 'This is you — tap others to collab', distance: '0 m'},
  {id: 'b10', code: 'B-10', name: 'Book Swap', emoji: '📚', crowd: 18, offer: 'Swap my corner spot 4–6 pm', distance: '25 m'},
  {id: 'b11', code: 'B-11', name: 'Kulfi Cart', emoji: '🍦', crowd: 38, offer: 'Free stage-front spot 2 hrs while restocking', distance: '70 m'},
  {id: 'b12', code: 'B-12', name: 'Photo Booth', emoji: '📸', crowd: 66, offer: 'Shares a table for the evening rush', distance: '80 m'},
]));

/** Crowd level label + heat class for a 0–100 crowd number. @param {number} crowd */
function heat(crowd) {
  if (crowd >= 80) return {cls: 'hot', label: 'Packed', emoji: '🔥'};
  if (crowd >= 55) return {cls: 'warm', label: 'Busy', emoji: '⚡'};
  if (crowd >= 30) return {cls: 'calm', label: 'Steady', emoji: '🙂'};
  return {cls: 'quiet', label: 'Quiet', emoji: '😴'};
}

/** Map layout: booths plus landmarks, row by row (6 columns on wide screens). */
const MAP = Object.freeze([
  {land: 'stage', label: 'Main stage', emoji: '🎤', span: 2},
  {booth: 'b1'}, {booth: 'b2'}, {booth: 'b3'}, {booth: 'b4'},
  {land: 'walk', label: 'Main walkway', emoji: '🚶', span: 6},
  {booth: 'b5'}, {booth: 'b6'},
  {land: 'court', label: 'Seating', emoji: '🪑', span: 2},
  {booth: 'b7'}, {booth: 'b8'},
  {land: 'gate', label: 'Entry gate', emoji: '🚪', span: 2},
  {booth: 'b9'}, {booth: 'b10'}, {booth: 'b11'}, {booth: 'b12'},
]);

const LISTINGS = Object.freeze([
  {tag: 'SWAP', tone: 'lavender', title: 'Swap my corner spot 4–6 pm', by: 'Book Swap · B-10', text: 'Corner by the gate gets the entry rush. We’re a slow-browse stall — happy to trade for your inner spot.'},
  {tag: 'SHARE', tone: 'mint', title: 'Share a table for the evening rush', by: 'Chai Tapri · B-02', text: 'One spare 6-ft table from 6 pm. Split it — your plates on one side, our chai on the other.'},
  {tag: 'OFFER', tone: 'yellow', title: 'Stage-front booth free for 2 hrs', by: 'Kulfi Cart · B-11', text: 'We go restock at 5 pm. Use our stage-front booth till 7 pm — just leave the freezer plugged in.'},
]);

/** Mid-rush SOS supplies and who nearby could help. */
const SUPPLIES = Object.freeze([
  {id: 'change', emoji: '🪙', label: '₹10 / ₹20 change', hint: 'Out of change notes', responders: [
    {stall: 'Chai Tapri', dist: '35 m', text: 'can spare ₹500 in ₹10s', ok: true},
    {stall: 'Ring Toss Arena', dist: '60 m', text: '₹300 in ₹20s, swap for a ₹500 note', ok: true},
    {stall: 'Photo Booth', dist: '80 m', text: 'all UPI today, sorry!', ok: false},
  ]},
  {id: 'plates', emoji: '🍽️', label: 'Plates & bowls', hint: 'Last stack running out', responders: [
    {stall: 'Momo Corner', dist: '40 m', text: 'can spare 50 plates', ok: true},
    {stall: 'Pani Puri Express', dist: '30 m', text: '20 bowls now, return tomorrow', ok: true},
    {stall: 'Kulfi Cart', dist: '70 m', text: 'busy — maybe in 30 min', ok: false},
  ]},
  {id: 'ice', emoji: '🧊', label: 'Ice', hint: 'Drinks going warm', responders: [
    {stall: 'Cold Coffee Co.', dist: '50 m', text: 'one bag of ice till 7 pm', ok: true},
    {stall: 'Lassi Lounge', dist: '40 m', text: 'half a box, come quick', ok: true},
    {stall: 'Maggi Point', dist: '55 m', text: 'no ice here, sorry', ok: false},
  ]},
  {id: 'buns', emoji: '🍞', label: 'Buns & pav', hint: 'Vada pav rush hit', responders: [
    {stall: 'Burger Shack', dist: '65 m', text: 'can spare 2 dozen buns', ok: true},
    {stall: 'Maggi Point', dist: '55 m', text: '1 dozen pav, trade for chutney?', ok: true},
    {stall: 'Chai Tapri', dist: '35 m', text: 'only rusks, haha', ok: false},
  ]},
  {id: 'oil', emoji: '🛢️', label: 'Cooking oil', hint: 'Fryer running low', responders: [
    {stall: 'Pani Puri Express', dist: '30 m', text: 'can spare 1 litre', ok: true},
    {stall: 'Maggi Point', dist: '55 m', text: 'half a litre, pay back tomorrow', ok: true},
    {stall: 'Henna Corner', dist: '45 m', text: 'we don’t cook, but cheering for you!', ok: false},
  ]},
]);

/** Match simulator choices and their example matches. */
const CHOICES = Object.freeze([
  {id: 'crowd', emoji: '🔥', label: 'My stall has huge crowd', tone: 'coral',
    match: {name: 'Lassi Lounge', code: 'B-03', emoji: '🥤', why: 'Quiet stall 40 m away with a fresh-drinks menu',
      deal: 'Every momo plate gets a combo token → ₹15 off any lassi', benefit: 'Your queue drops ~10 min; they gain ~40 walk-ins',
      gain: 240000, gainLabel: 'extra for them, zero cost to you'}},
  {id: 'footfall', emoji: '🚀', label: 'My stall needs footfall', tone: 'sky',
    match: {name: 'Momo Mania', code: 'B-01', emoji: '🥟', why: 'Packed stall 20 m away — people are leaving its queue',
      deal: 'Their customers get ₹15 off at your counter', benefit: '+40 walk-ins during the 6–9 pm rush',
      gain: 240000, gainLabel: 'extra sales for you (example)'}},
  {id: 'exchange', emoji: '🔄', label: 'I want to exchange stall places', tone: 'lavender',
    match: {name: 'Book Swap', code: 'B-10', emoji: '📚', why: 'Gate-corner spot, slow-browse stall, open to a swap',
      deal: 'Swap spots 4–6 pm for the evening entry rush', benefit: 'Gate crowd for you, calm inner lane for them',
      gain: 150000, gainLabel: 'extra for you in 2 hrs (example)'}},
  {id: 'sos', emoji: '🆘', label: 'I need emergency supplies', tone: 'yellow',
    match: {name: 'Momo Corner', code: 'B-14', emoji: '🍽️', why: '40 m away with 200 spare plates',
      deal: '50 plates now, return 50 tomorrow morning', benefit: 'Back to selling in under 5 minutes',
      gain: 90000, gainLabel: 'of sales saved in the rush (example)'}},
]);

const SIM_STEPS = Object.freeze(['Reading your stall’s rush', 'Scanning 24 stalls at the fest', 'Locking the best match']);

/** Poll options: which Collab tool launches first. */
const POLL = Object.freeze([
  {id: 'tokens', emoji: '🎟️', label: 'Cross-Stall Combo Tokens'},
  {id: 'deal-room', emoji: '💬', label: 'Stall-to-Stall Deal Room'},
  {id: 'booth', emoji: '🗺️', label: 'Booth Exchange Board'},
  {id: 'sos', emoji: '🆘', label: 'Fest Lifeline SOS'},
]);

// ---------------------------------------------------------------------------------------------------------------------
// Module-local UI state (never committed to the stall state)
// ---------------------------------------------------------------------------------------------------------------------

const view = {
  chat: {msgs: INITIAL_CHAT(), used: /** @type {string[]} */ ([]), typing: false, deal: {tokens: 50, off: 1500, ends: '9 pm', status: 'open', revised: false}},
  booth: /** @type {string|null} */ (null),
  sos: {id: /** @type {string|null} */ (null), phase: /** @type {'idle'|'ping'|'done'} */ ('idle')},
  sim: {id: /** @type {string|null} */ (null), step: 0},
};

/** Bumped per feature so a stale timer from an earlier tap never overwrites a newer one. */
const runs = {chat: 0, sos: 0, sim: 0};

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Delay for scripted sequences; 0 when the person prefers reduced motion. @param {number} ms */
const pace = ms => (reducedMotion() ? 0 : ms);

/** Read the saved poll pick ('' when none or storage is blocked). */
export function readVote() {
  try {
    const v = window.localStorage.getItem(VOTE_KEY) || '';
    return POLL.some(p => p.id === v) ? v : '';
  } catch {
    return '';
  }
}

/** @param {string} id */
function saveVote(id) {
  try {
    window.localStorage.setItem(VOTE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * WhatsApp link telling the MYS team which Collab tool to launch first.
 * @param {string} label the chosen feature
 */
export function whatsappVoteUrl(label) {
  const text = `Hey MYS team! 👋 I want "${label}" to launch first in Stall's Collab. — sent from ManageYourStall`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// In-place patching
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Replace one interactive region (by id) with fresh markup, keeping keyboard focus on the matching control.
 * Falls back to a full render when the region is not on screen. Does nothing when another screen is open.
 * @param {string} id
 * @param {() => string} html
 */
function patch(id, html) {
  if (ui.screen !== 'collab') return;
  const el = document.getElementById(id);
  if (!el) {
    render();
    return;
  }
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const focusKey = active && el.contains(active) ? active.getAttribute('data-focus') || '' : null;
  el.outerHTML = html();
  const fresh = document.getElementById(id);
  if (!fresh) return;
  if (focusKey !== null) {
    const target = /** @type {HTMLElement|null} */ (focusKey ? fresh.querySelector(`[data-focus="${focusKey}"]:not([disabled])`) : null)
      || /** @type {HTMLElement|null} */ (fresh.querySelector('[data-focus-fallback]'))
      || fresh;
    target.focus({preventScroll: true});
  }
  fresh.querySelectorAll('[data-autoscroll]').forEach(log => {
    log.scrollTop = log.scrollHeight;
  });
}

/**
 * Run `fn` after `ms` unless a newer run of the same feature started meanwhile.
 * @param {'chat'|'sos'|'sim'} key
 * @param {number} run
 * @param {number} ms
 * @param {() => void} fn
 */
function later(key, run, ms, fn) {
  const go = () => {
    if (runs[key] === run) fn();
  };
  if (ms <= 0) go();
  else window.setTimeout(go, ms);
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Big numbered section header.
 * @param {string} no @param {string} kicker @param {string} title @param {string} lede @param {string} tone @param {string} id heading id
 */
function sectionHead(no, kicker, title, lede, tone, id) {
  return `<header class="collab-sec-head">
    <span class="collab-sec-no" aria-hidden="true">${esc(no)}</span>
    <div class="collab-sec-titles">
      <span class="collab-kicker tone-${tone}">${esc(kicker)}</span>
      <h2 class="collab-sec-title" id="${id}" tabindex="-1">${esc(title)}</h2>
      <p class="collab-lede">${esc(lede)}</p>
    </div>
  </header>`;
}

const previewNote = (text = 'Preview · nothing is sent to other stalls yet') =>
  `<p class="collab-preview-note">${icon('info')}<span>${esc(text)}</span></p>`;

// ---------------------------------------------------------------------------------------------------------------------
// 0. Hero
// ---------------------------------------------------------------------------------------------------------------------

/** Two stalls linked by a combo token (decorative). */
function heroArt() {
  const queue = [26, 42, 58, 74, 90, 106, 122, 138]
    .map((x, i) => `<g class="collab-person" style="--i:${i}"><circle cx="${x}" cy="196" r="7" fill="${['#ff4d87', '#ffdd35', '#8fd3ff', '#b9f36b'][i % 4]}" stroke="#171717" stroke-width="2.5"/><rect x="${x - 6}" y="204" width="12" height="12" rx="4" fill="#171717"/></g>`)
    .join('');
  const scallops = (x0, color) => {
    let d = `M${x0} 74`;
    for (let i = 0; i < 5; i++) d += ` q 14.6 16 29.2 0`;
    return `<path d="${d} Z" fill="${color}" stroke="#171717" stroke-width="3" stroke-linejoin="round"/>`;
  };
  const stripes = (x0, a, b) => [0, 1, 2, 3, 4]
    .map(i => `<rect x="${x0 + i * 29.2}" y="40" width="29.2" height="34" fill="${i % 2 ? b : a}"/>`).join('');
  const stall = (x0, awnA, awnB, counter, name) => `
    <rect x="${x0 + 5}" y="45" width="146" height="141" rx="6" fill="#171717"/>
    <rect x="${x0 + 8}" y="74" width="8" height="56" fill="#171717"/>
    <rect x="${x0 + 130}" y="74" width="8" height="56" fill="#171717"/>
    <rect x="${x0 + 16}" y="80" width="114" height="46" fill="#fffdf5" stroke="#171717" stroke-width="2"/>
    ${stripes(x0, awnA, awnB)}
    <rect x="${x0}" y="40" width="146" height="34" rx="4" fill="none" stroke="#171717" stroke-width="3"/>
    ${scallops(x0, awnA)}
    <rect x="${x0}" y="126" width="146" height="56" rx="5" fill="${counter}" stroke="#171717" stroke-width="3"/>
    <text x="${x0 + 73}" y="160" text-anchor="middle" class="collab-svg-label">${name}</text>`;
  return `<svg class="collab-hero-art" viewBox="0 0 360 230" role="img" aria-label="Illustration: a packed stall with a long queue shares a ₹15 combo token with a quiet stall next door">
    ${stall(8, '#ff4d87', '#fff9ed', '#ffdd35', 'MOMO MANIA')}
    ${stall(204, '#8fd3ff', '#fff9ed', '#7ee0b5', 'LASSI LOUNGE')}
    <path class="collab-dash" d="M120 36 C 150 -14, 210 -14, 240 36" fill="none" stroke="#171717" stroke-width="3" stroke-dasharray="7 5" stroke-linecap="round"/>
    <polygon points="240,36 229,30 242,24" fill="#171717"/>
    <g class="collab-coin"><circle cx="180" cy="14" r="17" fill="#171717"/><circle cx="178" cy="12" r="17" fill="#ffdd35" stroke="#171717" stroke-width="3"/><text x="178" y="17" text-anchor="middle" class="collab-svg-coin">₹15</text></g>
    ${queue}
    <text x="290" y="205" text-anchor="middle" class="collab-svg-zzz">z z z</text>
    <g><circle cx="262" cy="196" r="7" fill="#c7b6ff" stroke="#171717" stroke-width="2.5"/><rect x="256" y="204" width="12" height="12" rx="4" fill="#171717"/></g>
  </svg>`;
}

function heroSection() {
  const chips = SECTIONS.map(s => `<button type="button" class="chip collab-jump" data-action="collab-jump" data-target="${s.id}"><span class="collab-jump-no">${s.no}</span>${s.emoji} ${esc(s.label)}</button>`).join('');
  return `<section class="collab-hero" aria-labelledby="collab-title">
    <div class="collab-hero-copy">
      <div class="collab-masthead"><span class="collab-sticker tilt-l">MYS LAB</span><span class="collab-issue">Issue 01 · Fest season 2026 · Concept preview</span></div>
      <h1 class="collab-title" id="collab-title">Stall’s Collab<sup class="collab-soon">COMING SOON</sup></h1>
      <p class="collab-promise">Stalls that team up, <mark>sell out.</mark></p>
      <p class="collab-intro">A first look at how ManageYourStall will connect the temporary stalls at your fest — share crowds, cut deals, swap spots and rescue each other mid-rush.</p>
      <p class="collab-honest" role="note">${icon('info')}<span><strong>Coming soon · nothing is sent to other stalls yet.</strong> Everything on this page is a local preview you can play with.</span></p>
      <div class="collab-cta">
        <button type="button" class="primary big" data-action="collab-jump" data-target="collab-sim">${icon('target')} Try the match simulator</button>
        <button type="button" class="yellow big" data-action="collab-jump" data-target="collab-poll">${icon('star')} Vote for the first feature</button>
      </div>
    </div>
    <div class="collab-hero-visual">
      <span class="collab-sticker collab-sticker-float tilt-r" aria-hidden="true">🤝 Team up!</span>
      ${heroArt()}
      <span class="collab-sticker collab-sticker-low tilt-l" aria-hidden="true">₹15 OFF</span>
    </div>
    <nav class="collab-jumps" aria-label="Jump to a section">${chips}</nav>
  </section>
  <div class="collab-ticker" aria-hidden="true"><div class="collab-ticker-track">${'<span>CROWD SHARING ✦ COMBO TOKENS ✦ DEAL ROOM ✦ BOOTH SWAP ✦ SOS LIFELINE ✦ </span>'.repeat(4)}</div></div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Crowd & Revenue Rescue
// ---------------------------------------------------------------------------------------------------------------------

const FLOW = Object.freeze([
  {emoji: '🔥', title: 'Packed queue', sub: 'Stall A: 38 waiting'},
  {emoji: '🎟️', title: 'Combo token', sub: '₹15 off at Stall B'},
  {emoji: '🚶', title: 'New footfall', sub: '+40 walk-ins to B'},
  {emoji: '📈', title: 'Revenue up', sub: 'for both stalls'},
]);
const FLOW_FILLS = ['#ffd5e3', '#fff1bf', '#dcf1ff', '#dcf6b6'];

/** One flow node box at (x, y). */
function flowNode(n, i, x, y, w, h) {
  return `<g>
    <rect x="${x + 5}" y="${y + 5}" width="${w}" height="${h}" rx="12" fill="#171717"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${FLOW_FILLS[i]}" stroke="#171717" stroke-width="3"/>
    <circle cx="${x + 4}" cy="${y + 4}" r="15" fill="#171717"/>
    <text x="${x + 4}" y="${y + 10}" text-anchor="middle" class="collab-svg-num">${i + 1}</text>
    <text x="${x + w / 2}" y="${y + h * 0.42}" text-anchor="middle" class="collab-svg-emoji">${n.emoji}</text>
    <text x="${x + w / 2}" y="${y + h * 0.68}" text-anchor="middle" class="collab-svg-title">${esc(n.title)}</text>
    <text x="${x + w / 2}" y="${y + h * 0.86}" text-anchor="middle" class="collab-svg-sub">${esc(n.sub)}</text>
  </g>`;
}

/** Flow diagram: horizontal (wide) and vertical (narrow) variants; CSS shows one. */
function flowDiagram() {
  const label = 'Flow: a packed queue at Stall A hands out combo tokens, which bring new footfall to Stall B, so revenue goes up for both stalls';
  const wide = FLOW.map((n, i) => flowNode(n, i, 14 + i * 196, 22, 160, 128)).join('')
    + [0, 1, 2].map(i => {
      const x1 = 14 + i * 196 + 168;
      const x2 = x1 + 24;
      return `<path class="collab-dash" d="M${x1} 86 L${x2} 86" stroke="#171717" stroke-width="3.5" stroke-dasharray="7 5" fill="none"/><polygon points="${x2 + 8},86 ${x2 - 2},79 ${x2 - 2},93" fill="#171717"/>`;
    }).join('');
  const tall = FLOW.map((n, i) => flowNode(n, i, 20, 14 + i * 132, 250, 100)).join('')
    + [0, 1, 2].map(i => {
      const y1 = 14 + i * 132 + 106;
      const y2 = y1 + 16;
      return `<path class="collab-dash" d="M145 ${y1} L145 ${y2}" stroke="#171717" stroke-width="3.5" stroke-dasharray="7 5" fill="none"/><polygon points="145,${y2 + 8} 138,${y2 - 1} 152,${y2 - 1}" fill="#171717"/>`;
    }).join('');
  return `<figure class="collab-flow">
    <svg class="collab-flow-wide" viewBox="0 0 800 168" role="img" aria-label="${label}">${wide}</svg>
    <svg class="collab-flow-tall" viewBox="0 0 290 540" role="img" aria-label="${label}">${tall}</svg>
  </figure>`;
}

/** Before/after mini bar chart (illustrative numbers). */
function rescueChart() {
  const max = Math.max(...RESCUE_CHART.map(r => Math.max(r.before, r.after)));
  const bar = (value, kind) => `<div class="collab-bar-row"><span class="collab-bar-key">${kind === 'before' ? 'Before' : 'After'}</span>
      <span class="collab-bar-track"><span class="collab-bar ${kind}" style="--w:${Math.round((value / max) * 1000) / 10}%" title="${kind === 'before' ? 'Before' : 'After'}: ${money(value)}"></span></span>
      <span class="collab-bar-val">${money(value)}</span></div>`;
  const groups = RESCUE_CHART.map(r => `<div class="collab-bar-group">
      <div class="collab-bar-stall"><strong>${r.mood} ${esc(r.stall)}</strong><span class="badge lime">+${money(r.after - r.before)} · ${esc(r.note)}</span></div>
      ${bar(r.before, 'before')}${bar(r.after, 'after')}
    </div>`).join('');
  return `<figure class="collab-chart">
    <figcaption><span class="eyebrow">Evening rush · 6–9 pm</span><strong>Revenue before vs after the collab</strong></figcaption>
    <div class="collab-legend" aria-hidden="true"><span><i class="collab-swatch before"></i>Before</span><span><i class="collab-swatch after"></i>After</span></div>
    ${groups}
    <p class="collab-fine">Illustrative example — not real stall data.</p>
  </figure>`;
}

function rescueSection() {
  const people = Array.from({length: 12}, (_, i) => `<span class="collab-dot" style="--i:${i}"></span>`).join('');
  return `<section class="collab-sec collab-rescue" id="collab-rescue" aria-labelledby="collab-rescue-h">
    ${sectionHead('01', 'Crowd & Revenue Rescue', 'Your queue is someone else’s lifeline.', 'A packed stall loses customers who give up waiting. A quiet stall next door is losing money. Collab pairs them up with Cross-Stall Combo Tokens.', 'pink', 'collab-rescue-h')}
    <div class="collab-duo">
      <article class="collab-stall hot">
        <span class="collab-sticker tilt-r collab-stall-tag">🔥 PACKED</span>
        <h3>Stall A · Momo Mania</h3>
        <p class="collab-stall-stat"><strong>38</strong> people in line · 25 min wait</p>
        <div class="collab-queue" aria-hidden="true">${people}</div>
        <p class="muted">Every 5 minutes, 3 people walk away.</p>
      </article>
      <div class="collab-token" role="img" aria-label="Combo token: buy at Stall A, get ₹15 off at Stall B">
        <span class="collab-token-top">COMBO TOKEN</span>
        <span class="collab-token-big">₹15 OFF</span>
        <span class="collab-token-line">Buy at Stall A → get ₹15 off at Stall B</span>
      </div>
      <article class="collab-stall quiet">
        <span class="collab-sticker tilt-l collab-stall-tag">😴 QUIET</span>
        <h3>Stall B · Lassi Lounge</h3>
        <p class="collab-stall-stat"><strong>2</strong> customers in 30 min</p>
        <div class="collab-queue sparse" aria-hidden="true"><span class="collab-dot"></span><span class="collab-zzz">z z z</span></div>
        <p class="muted">${money(120000)} short of break-even.</p>
      </article>
    </div>
    ${flowDiagram()}
    <div class="collab-rescue-bottom">
      <ol class="collab-steps">
        <li><strong>Queue overflows.</strong> Momo Mania turns on “Share my crowd” when the wait crosses 15 minutes.</li>
        <li><strong>Token on the receipt.</strong> Every plate prints a combo token — buy here, get ₹15 off at Lassi Lounge.</li>
        <li><strong>Footfall walks over.</strong> Waiting customers grab a lassi 40 m away instead of leaving the fest lane.</li>
        <li><strong>Both stalls win.</strong> A shorter queue for A, fresh revenue for B — tracked on both dashboards.</li>
      </ol>
      ${rescueChart()}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Deal Room chat
// ---------------------------------------------------------------------------------------------------------------------

function dealCard() {
  const d = view.chat.deal;
  const status = d.status === 'accepted'
    ? `<span class="badge lime">${icon('check')} Accepted · preview</span>`
    : d.revised ? '<span class="badge yellow">Revised offer</span>' : '<span class="badge pink">New deal</span>';
  const buttons = d.status === 'accepted'
    ? ''
    : `<div class="collab-deal-actions">
        <button type="button" class="lime small" data-action="collab-deal-accept" data-focus="accept"${view.chat.typing ? ' disabled' : ''}>${icon('check')} Accept</button>
        ${d.revised ? '' : `<button type="button" class="small" data-action="collab-deal-counter" data-focus="counter"${view.chat.typing ? ' disabled' : ''}>${icon('refresh')} Counter</button>`}
      </div>`;
  return `<div class="collab-deal${d.status === 'accepted' ? ' accepted' : ''}">
    <div class="collab-deal-head"><span class="eyebrow">Collab deal</span>${status}</div>
    <p class="collab-deal-terms"><strong>${d.tokens} combo tokens</strong> · <strong>${money(d.off)} off</strong> · ends ${esc(d.ends)}</p>
    <p class="collab-deal-sub">Momo Mania hands out tokens → Lassi Lounge honours them.</p>
    ${buttons}
  </div>`;
}

function chatBox() {
  const c = view.chat;
  const msgs = c.msgs.map(m => {
    if (m.kind === 'deal') return `<div class="collab-msg from-b is-deal">${dealCard()}</div>`;
    if (m.kind === 'system') return `<p class="collab-msg-system">${esc(m.text)}</p>`;
    const p = PARTNER[m.from];
    return `<div class="collab-msg from-${m.from}"><span class="collab-avatar" aria-hidden="true">${p.initials}</span><p class="collab-bubble"><span class="sr-only">${esc(p.name)}: </span>${esc(m.text)}</p></div>`;
  }).join('');
  const typing = c.typing
    ? `<div class="collab-msg from-b collab-typing-row"><span class="collab-avatar" aria-hidden="true">LL</span><p class="collab-bubble collab-typing" aria-label="Lassi Lounge is typing"><i></i><i></i><i></i></p></div>`
    : '';
  const left = QUICK_REPLIES.filter(q => !c.used.includes(q.id));
  const replies = c.deal.status === 'accepted'
    ? `<button type="button" class="small quiet-outline" data-action="collab-chat-reset" data-focus="reset">${icon('reset')} Replay the chat</button>`
    : left.map(q => `<button type="button" class="chip collab-reply" data-action="collab-chat-reply" data-id="${q.id}" data-focus="r-${q.id}"${c.typing ? ' disabled' : ''}>${esc(q.text)}</button>`).join('')
      + (left.length ? '' : '<span class="collab-fine">Out of questions — accept or counter the deal ☝️</span>');
  return `<div class="collab-chat" id="collab-chat">
    <div class="collab-chat-head">
      <span class="collab-avatar big" aria-hidden="true">LL</span>
      <div class="grow"><strong>Lassi Lounge · B-03</strong><span><i class="collab-online" aria-hidden="true"></i>Riya · 40 m away</span></div>
      <span class="badge ink">Deal Room</span>
    </div>
    <div class="collab-chat-log" role="log" aria-live="polite" aria-label="Deal Room chat preview" data-autoscroll tabindex="0">${msgs}${typing}</div>
    <div class="collab-replies" role="group" aria-label="Quick replies" data-focus-fallback tabindex="-1">${replies}</div>
  </div>`;
}

function dealSection() {
  return `<section class="collab-sec collab-dealroom" id="collab-deal" aria-labelledby="collab-deal-h">
    ${sectionHead('02', 'Live Stall-to-Stall Chat & Collab Deal Room', 'Strike a deal before the rush peaks.', 'Owners at the same fest chat in real time and turn ideas into one-tap deal cards with tokens, discounts and an end time.', 'sky', 'collab-deal-h')}
    <div class="collab-deal-grid">
      ${chatBox()}
      <aside class="collab-side">
        <span class="collab-sticker tilt-r">You are Momo Mania 🥟</span>
        <h3>Tap a quick reply to play the chat</h3>
        <ul class="collab-ticks">
          <li>${icon('users')}<span><strong>Only stalls at your fest</strong> — matched by event, booth and distance.</span></li>
          <li>${icon('ticket')}<span><strong>Deal cards</strong> — tokens, ₹ off and an end time, accepted in one tap.</span></li>
          <li>${icon('receipt')}<span><strong>Auto-tracked</strong> — redeemed tokens show up on both dashboards.</span></li>
          <li>${icon('lock')}<span><strong>Your sales stay yours</strong> — only the deal is shared, never your ledger.</span></li>
        </ul>
        ${previewNote('Preview · scripted locally, nothing is sent to other stalls yet')}
      </aside>
    </div>
  </section>`;
}

/** Your message, then Lassi Lounge types and answers. */
function chatExchange(mine, theirs, after = () => {}) {
  const c = view.chat;
  const run = ++runs.chat;
  c.msgs.push({from: 'a', text: mine});
  c.typing = true;
  patch('collab-chat', chatBox);
  later('chat', run, pace(1000), () => {
    c.typing = false;
    c.msgs.push({from: 'b', text: theirs});
    after();
    patch('collab-chat', chatBox);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Booth Exchange Board
// ---------------------------------------------------------------------------------------------------------------------

function boothCard() {
  const b = BOOTHS.find(x => x.id === view.booth);
  if (!b) {
    return `<div class="collab-booth-card empty" id="collab-booth-card" aria-live="polite">
      <span class="collab-booth-emoji" aria-hidden="true">👆</span>
      <h3>Tap a booth on the map</h3>
      <p class="muted">See how crowded it is and what it’s offering — a swap, a shared table or a free spot.</p>
    </div>`;
  }
  const h = heat(b.crowd);
  const tools = b.you
    ? '<p class="collab-fine">Owners will list their own booth here to offer swaps.</p>'
    : `<div class="collab-booth-actions">
        <button type="button" class="lavender small" data-action="collab-soon" data-what="Booth swaps" data-focus="swap">${icon('refresh')} Swap for 2 hrs</button>
        <button type="button" class="mint small" data-action="collab-soon" data-what="Table sharing" data-focus="share">${icon('users')} Share table</button>
      </div>`;
  return `<div class="collab-booth-card heat-${h.cls}" id="collab-booth-card" aria-live="polite">
    <div class="collab-booth-top"><span class="collab-booth-emoji" aria-hidden="true">${b.emoji}</span>
      <div class="grow"><span class="eyebrow">${esc(b.code)} · ${esc(b.distance)} from you</span><h3>${esc(b.name)}</h3></div>
      <span class="badge collab-heat-badge heat-${h.cls}">${h.emoji} ${esc(h.label)}</span></div>
    <div class="collab-meter" role="meter" aria-label="Crowd level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.crowd}"><span style="--w:${b.crowd}%"></span></div>
    <p class="collab-meter-label">Crowd level <strong>${b.crowd}%</strong></p>
    <p class="collab-booth-offer">“${esc(b.offer)}”</p>
    ${tools}
  </div>`;
}

function boardBox() {
  const cells = MAP.map(cell => {
    if (cell.land) {
      return `<div class="collab-land land-${cell.land}" style="--span:${cell.span}"><span aria-hidden="true">${cell.emoji}</span>${esc(cell.label)}</div>`;
    }
    const b = /** @type {Booth} */ (BOOTHS.find(x => x.id === cell.booth));
    const h = heat(b.crowd);
    const on = view.booth === b.id;
    return `<button type="button" class="collab-booth heat-${h.cls}${b.you ? ' is-you' : ''}${on ? ' selected' : ''}" data-action="collab-booth" data-id="${b.id}" data-focus="${b.id}" aria-pressed="${on}" aria-label="${esc(`${b.code} ${b.name} — ${h.label}`)}"><span class="collab-booth-code">${b.you ? 'YOU' : esc(b.code.slice(2))}</span><span aria-hidden="true">${b.emoji}</span></button>`;
  }).join('');
  const legend = [['hot', 'Packed'], ['warm', 'Busy'], ['calm', 'Steady'], ['quiet', 'Quiet']]
    .map(([k, l]) => `<span><i class="collab-heat-dot heat-${k}"></i>${l}</span>`).join('');
  return `<div class="collab-board-box" id="collab-board-box">
    <div class="collab-map-wrap">
      <div class="collab-map-head"><strong>🗺️ Fest ground · live crowd heat</strong><span class="badge yellow">Example map</span></div>
      <div class="collab-map" role="group" aria-label="Fest ground booths">${cells}</div>
      <div class="collab-heat-legend">${legend}</div>
    </div>
    ${boothCard()}
  </div>`;
}

function boardSection() {
  const listings = LISTINGS.map((l, i) => `<article class="collab-listing tone-${l.tone}">
      <span class="tag collab-listing-tag">${esc(l.tag)}</span>
      <h3>${esc(l.title)}</h3>
      <p class="collab-listing-by">${icon('store')}${esc(l.by)}</p>
      <p>${esc(l.text)}</p>
      <button type="button" class="small" data-action="collab-soon" data-what="Booth requests" data-focus="list-${i}">${icon('chat')} Request · soon</button>
    </article>`).join('');
  return `<section class="collab-sec collab-board" id="collab-board" aria-labelledby="collab-board-h">
    ${sectionHead('03', 'Stall Spot & Booth Exchange Board', 'The best spot at the fest changes every hour.', 'See which booths are packed or quiet, then swap spots for the evening rush or share a table with a neighbour.', 'lavender', 'collab-board-h')}
    ${boardBox()}
    <h3 class="collab-sub-h">📌 On the exchange board right now</h3>
    <div class="collab-listings">${listings}</div>
  </section>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. SOS Lifeline
// ---------------------------------------------------------------------------------------------------------------------

/** Radar blip positions (percent of the radar box). */
const BLIPS = [[72, 26], [24, 64], [78, 74]];

function sosBox() {
  const s = view.sos;
  const supply = SUPPLIES.find(x => x.id === s.id);
  const cards = SUPPLIES.map(x => {
    const on = x.id === s.id;
    return `<button type="button" class="collab-supply${on ? ' selected' : ''}" data-action="collab-sos" data-id="${x.id}" data-focus="${x.id}" aria-pressed="${on}"${s.phase === 'ping' ? ' disabled' : ''}>
      <span class="collab-supply-emoji" aria-hidden="true">${x.emoji}</span><strong>${esc(x.label)}</strong><span class="collab-supply-hint">${esc(x.hint)}</span></button>`;
  }).join('');
  const blips = supply && s.phase === 'done'
    ? supply.responders.map((r, i) => `<span class="collab-blip${r.ok ? '' : ' no'}" style="left:${BLIPS[i][0]}%;top:${BLIPS[i][1]}%;--i:${i}"></span>`).join('')
    : '';
  let status = '<strong>Tap what you’re running out of.</strong> Collab pings stalls within 100 m.';
  if (supply && s.phase === 'ping') status = `<strong>Pinging stalls within 100 m…</strong> “Need ${esc(supply.label.toLowerCase())}!”`;
  if (supply && s.phase === 'done') status = `<strong>${supply.responders.filter(r => r.ok).length} stalls can help</strong> with ${esc(supply.label.toLowerCase())}.`;
  const responders = supply && s.phase === 'done'
    ? `<ul class="collab-responders">${supply.responders.map((r, i) => `<li class="collab-responder${r.ok ? '' : ' no'}" style="--i:${i}">
        <span class="collab-responder-icon" aria-hidden="true">${r.ok ? '✅' : '⏳'}</span>
        <span><strong>${esc(r.stall)}</strong> · ${esc(r.dist)} · ${esc(r.text)}</span></li>`).join('')}</ul>
      ${previewNote('Preview · no stall was actually pinged')}`
    : '';
  return `<div class="collab-sos-box" id="collab-sos-box">
    <div class="collab-supplies" role="group" aria-label="Supplies you need">${cards}</div>
    <div class="collab-radar-panel${s.phase === 'ping' ? ' is-pinging' : ''}${s.phase === 'done' ? ' is-done' : ''}">
      <div class="collab-radar" aria-hidden="true">
        <span class="collab-ring r1"></span><span class="collab-ring r2"></span><span class="collab-ring r3"></span>
        <span class="collab-sweep"></span>
        <span class="collab-radar-you">${supply ? supply.emoji : '📍'}</span>
        ${blips}
      </div>
      <div class="collab-radar-copy">
        <p class="collab-radar-status" role="status" aria-live="polite">${status}</p>
        ${responders}
      </div>
    </div>
  </div>`;
}

function sosSection() {
  return `<section class="collab-sec collab-sos" id="collab-sos" aria-labelledby="collab-sos-h">
    ${sectionHead('04', 'Fest Lifeline — Mid-Rush SOS', 'Ran out mid-rush? Your neighbours have it.', 'One tap sends an SOS to nearby stalls. They answer with what they can spare — change, plates, ice, buns or oil — and you settle up later.', 'coral', 'collab-sos-h')}
    ${sosBox()}
  </section>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Match Simulator & poll
// ---------------------------------------------------------------------------------------------------------------------

function simBox() {
  const s = view.sim;
  const choice = CHOICES.find(c => c.id === s.id);
  const busy = !!choice && s.step < SIM_STEPS.length;
  const buttons = CHOICES.map(c => {
    const on = c.id === s.id;
    return `<button type="button" class="collab-choice tone-${c.tone}${on ? ' selected' : ''}" data-action="collab-sim" data-id="${c.id}" data-focus="${c.id}" aria-pressed="${on}"${busy ? ' disabled' : ''}><span class="collab-choice-emoji" aria-hidden="true">${c.emoji}</span><span>${esc(c.label)}</span></button>`;
  }).join('');
  let stage = `<div class="collab-sim-idle"><span aria-hidden="true">🎯</span><p><strong>Pick your situation</strong> and watch Collab find your partner stall.</p></div>`;
  if (choice) {
    const steps = SIM_STEPS.map((t, i) => {
      const state = i < s.step ? 'done' : i === s.step ? 'active' : 'todo';
      return `<li class="collab-sim-step ${state}"><span class="collab-sim-tick" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span>${esc(t)}${state === 'active' ? '…' : ''}</li>`;
    }).join('');
    const m = choice.match;
    const card = s.step >= SIM_STEPS.length
      ? `<article class="collab-match-card tone-${choice.tone}" aria-label="Your match">
          <span class="collab-sticker tilt-r collab-match-stamp">IT’S A MATCH!</span>
          <div class="collab-match-pair">
            <span class="collab-match-face">⭐<small>You</small></span>
            <span class="collab-match-link" aria-hidden="true">🤝</span>
            <span class="collab-match-face">${m.emoji}<small>${esc(m.code)}</small></span>
          </div>
          <h3>You ⇄ ${esc(m.name)}</h3>
          <p class="muted">${esc(m.why)}</p>
          <dl class="collab-match-facts">
            <div><dt>Example deal</dt><dd>${esc(m.deal)}</dd></div>
            <div><dt>Expected benefit</dt><dd>${esc(m.benefit)}</dd></div>
            <div><dt>Could mean</dt><dd><strong class="collab-match-gain">≈ ${money(m.gain)}</strong> ${esc(m.gainLabel)}</dd></div>
          </dl>
          <button type="button" class="small quiet-outline" data-action="collab-sim-reset" data-focus="again">${icon('refresh')} Try another situation</button>
        </article>`
      : '';
    stage = `<ol class="collab-sim-steps" aria-label="Matching progress">${steps}</ol>${card}`;
  }
  return `<div class="collab-sim-box" id="collab-sim-box">
    <div class="collab-choices" role="group" aria-label="Your situation" data-focus-fallback tabindex="-1">${buttons}</div>
    <div class="collab-sim-stage" role="status" aria-live="polite">${stage}</div>
  </div>`;
}

function pollBox() {
  const vote = readVote();
  const options = POLL.map(p => {
    const on = p.id === vote;
    return `<button type="button" class="collab-poll-opt${on ? ' selected' : ''}" data-action="collab-vote" data-id="${p.id}" data-focus="${p.id}" aria-pressed="${on}">
      <span class="collab-poll-label"><span aria-hidden="true">${p.emoji}</span>${esc(p.label)}</span>
      <span class="collab-poll-bar" aria-hidden="true"><span style="--w:${on ? 100 : 0}%"></span></span>
      <span class="collab-poll-count">${on ? '1 vote · yours! 🎉' : vote ? 'Tap to switch your vote' : 'Tap to vote'}</span>
    </button>`;
  }).join('');
  const picked = POLL.find(p => p.id === vote);
  const result = picked
    ? `<div class="collab-poll-result">
        <p><span class="collab-sticker tilt-l">YOUR PICK</span> <strong>${picked.emoji} ${esc(picked.label)}</strong></p>
        <p class="collab-fine">Saved on this device only — tap another option to change it. Want the MYS team to hear it?</p>
        <a class="collab-wa" href="${esc(whatsappVoteUrl(picked.label))}" target="_blank" rel="noopener noreferrer" data-focus="wa">${icon('share')} Tell the MYS team on WhatsApp</a>
      </div>`
    : '<p class="collab-fine">Your vote stays on this device. Nothing is sent unless you share it yourself.</p>';
  return `<div class="collab-poll" id="collab-poll-box">
    <div class="collab-poll-opts" role="group" aria-label="Which Collab tool should launch first?">${options}</div>
    ${result}
  </div>`;
}

function matchSection() {
  return `<section class="collab-sec collab-match" id="collab-match" aria-labelledby="collab-match-h">
    ${sectionHead('05', 'Collab Match Simulator & Feature Poll', 'Who should your stall team up with?', 'Tell the simulator what’s happening at your counter. It walks through how Collab will find a partner stall and a deal that works for both.', 'lime', 'collab-match-h')}
    <div class="collab-sim" id="collab-sim">
      <h3 class="collab-sub-h" tabindex="-1">🎰 Collab Match Simulator</h3>
      ${simBox()}
    </div>
    <div class="collab-poll-wrap" id="collab-poll">
      <h3 class="collab-sub-h" tabindex="-1">🗳️ Which Collab tool should launch first?</h3>
      ${pollBox()}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

function collabScreen() {
  return `<div class="collab-page">
    ${heroSection()}
    ${rescueSection()}
    ${dealSection()}
    ${boardSection()}
    ${sosSection()}
    ${matchSection()}
    <footer class="collab-footer">
      <span class="collab-sticker tilt-l">COMING SOON</span>
      <p><strong>Stall’s Collab is a concept preview.</strong> Nothing on this page is sent to other stalls, and your sales stay on this device. When it launches, you’ll choose to opt in.</p>
    </footer>
  </div>`;
}

registerScreen('collab', collabScreen);

registerActions({
  'collab-jump': (_el, ds) => {
    const target = document.getElementById(ds.target || '');
    if (!target) return;
    target.scrollIntoView({behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start'});
    const h = /** @type {HTMLElement|null} */ (target.querySelector('[tabindex="-1"]'));
    h?.focus({preventScroll: true});
  },

  'collab-chat-reply': (_el, ds) => {
    const c = view.chat;
    const q = QUICK_REPLIES.find(x => x.id === ds.id);
    if (!q || c.typing || c.used.includes(q.id) || c.deal.status === 'accepted') return;
    c.used.push(q.id);
    chatExchange(q.text, q.reply);
  },
  'collab-deal-accept': () => {
    const c = view.chat;
    if (c.typing || c.deal.status === 'accepted') return;
    c.deal.status = 'accepted';
    chatExchange('Deal! 🤝', `Yesss! ${c.deal.tokens} tokens live till ${c.deal.ends}. See you at the rush 🔥`, () => {
      c.msgs.push({kind: 'system', text: 'Preview · in the real Deal Room both counters would get the tokens. Nothing was sent.'});
    });
  },
  'collab-deal-counter': () => {
    const c = view.chat;
    if (c.typing || c.deal.revised || c.deal.status === 'accepted') return;
    chatExchange('Counter: 40 tokens · ₹12 off?', 'Meet in the middle — 45 tokens, ₹12 off? Updated the card 👇', () => {
      c.deal = {...c.deal, tokens: 45, off: 1200, revised: true};
      c.msgs.push({from: 'b', kind: 'deal'});
      c.msgs = c.msgs.filter((m, i, all) => m.kind !== 'deal' || i === all.length - 1);
    });
  },
  'collab-chat-reset': () => {
    runs.chat++;
    view.chat = {msgs: INITIAL_CHAT(), used: [], typing: false, deal: {tokens: 50, off: 1500, ends: '9 pm', status: 'open', revised: false}};
    patch('collab-chat', chatBox);
  },

  'collab-booth': (_el, ds) => {
    view.booth = view.booth === ds.id ? null : ds.id || null;
    patch('collab-board-box', boardBox);
  },
  'collab-soon': (_el, ds) => {
    toast(`${ds.what || 'This'} — coming soon with Stall’s Collab. Nothing was sent.`);
  },

  'collab-sos': (_el, ds) => {
    if (!SUPPLIES.some(x => x.id === ds.id) || view.sos.phase === 'ping') return;
    const run = ++runs.sos;
    view.sos = {id: ds.id || null, phase: 'ping'};
    patch('collab-sos-box', sosBox);
    later('sos', run, pace(1400), () => {
      view.sos = {...view.sos, phase: 'done'};
      patch('collab-sos-box', sosBox);
    });
  },

  'collab-sim': (_el, ds) => {
    const s = view.sim;
    if (!CHOICES.some(c => c.id === ds.id) || (s.id && s.step < SIM_STEPS.length)) return;
    const run = ++runs.sim;
    view.sim = {id: ds.id || null, step: 0};
    patch('collab-sim-box', simBox);
    const tick = () => {
      view.sim = {...view.sim, step: view.sim.step + 1};
      patch('collab-sim-box', simBox);
      if (view.sim.step < SIM_STEPS.length) later('sim', run, pace(700), tick);
    };
    later('sim', run, pace(700), tick);
  },
  'collab-sim-reset': () => {
    runs.sim++;
    view.sim = {id: null, step: 0};
    patch('collab-sim-box', simBox);
  },

  'collab-vote': (_el, ds) => {
    const pick = POLL.find(p => p.id === ds.id);
    if (!pick) return;
    if (!saveVote(pick.id)) {
      toast('Couldn’t save your vote — this browser is blocking storage.', {tone: 'warn'});
      return;
    }
    patch('collab-poll-box', pollBox);
    toast(`Vote saved: ${pick.label} 🎉`);
  },
});
