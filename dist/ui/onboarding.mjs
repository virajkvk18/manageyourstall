// First-run onboarding (ARCHITECTURE.md §13.8 + §16.5): a wide 3-step sheet — pick a stall theme, name the stall (and
// who's running it), ready tips. Opens on boot while `onboarded` is false, and again via the public `onb-open` action.
// First-run setup needs no PIN. Reopened later, Finish is an admin change like Studio's (it creates the PIN when none
// exists yet) — but only when something actually changed; finishing an unchanged tour just closes it.
// `onb-skip` ("Skip — explore the sample stall") marks the stall onboarded and keeps the sample stall as it is.
import {
  C, store, esc, icon, btn, field, check, textarea, openSheet, closeSheet, sheetKind, sheetEl, commitConfig, commit, toast,
  navigate, runAction, requireAdmin, onBoot, registerActions, registerInputs, registerChanges, currentPage,
} from './core.mjs';
import {saveProfile, addMember, CATALOG_LIMITS} from '../catalog.mjs';
import {applyTheme} from '../domain.mjs';
import {TEMPLATES, buildTemplate} from '../templates.mjs';
import {LIMITS} from '../constants.mjs';
import {themeCards, themeById, themeLook, heroBox, resetStudioDrafts} from './studio.mjs';

const STEPS = ['Theme', 'Name it', 'Ready'];
const MEMBER_MAX = LIMITS.memberName || 40;

/** Transient flow state (lives while the sheet is open). */
const flow = {
  step: 0,
  templateId: 'street-chaat',
  withPrices: true,
  taglineTouched: false,
  profile: {stallName: '', booth: '', eventName: '', tagline: ''},
  partners: '',
};

/** The hero sub-line a template ships with ('' for unknown ids such as migrated 'legacy' stalls). @param {string} id */
function defaultSubTagline(id) {
  try {
    return buildTemplate(id).subTagline || '';
  } catch {
    return '';
  }
}

/** The theme the stall wears now (falls back to its menu template, then the first theme). */
function currentThemeId() {
  const c = C();
  if (themeById(c.theme?.themeId)) return c.theme.themeId;
  if (themeById(c.templateId)) return c.templateId;
  return TEMPLATES[0].id;
}

/** Default tagline for the chosen theme: keep the owner's own line unless it's still the old theme's default. */
function suggestedTagline() {
  const c = C();
  if (flow.templateId === c.templateId) return c.profile.tagline;
  const oldDefault = themeById(c.templateId)?.tagline || '';
  const own = c.profile.tagline && c.profile.tagline !== oldDefault;
  return own ? c.profile.tagline : themeById(flow.templateId)?.tagline || c.profile.tagline;
}

/** Partner names typed in step 2: comma or one per line, trimmed, blanks and repeats (any case) dropped. @param {string} text */
export function parsePartners(text) {
  /** @type {string[]} */
  const out = [];
  for (const raw of String(text || '').split(/[,\n;]/)) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name && !out.some(n => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** Partner names that would be new to the team. */
function newPartners() {
  const existing = (C().team?.members || []).map((/** @type {any} */ m) => String(m.name).toLowerCase());
  return parsePartners(flow.partners).filter(n => !existing.includes(n.toLowerCase()));
}

/** Throws a friendly message when the typed partner names can't be saved. */
function checkPartners() {
  const names = parsePartners(flow.partners);
  const long = names.find(n => n.length > MEMBER_MAX);
  if (long) throw Error(`“${long.slice(0, 20)}…” is too long — keep partner names to ${MEMBER_MAX} letters.`);
  const total = (C().team?.members || []).length + newPartners().length;
  if (total > CATALOG_LIMITS.members) throw Error(`That’s ${total} partners — the most is ${CATALOG_LIMITS.members}.`);
}

function dots() {
  return `<ol class="onb-dots" aria-label="Step ${flow.step + 1} of ${STEPS.length}">${STEPS.map((s, i) => {
    const state = i < flow.step ? 'done' : i === flow.step ? 'now' : '';
    return `<li class="onb-dot${state ? ' ' + state : ''}"${i === flow.step ? ' aria-current="step"' : ''}><span class="onb-dot-num">${i < flow.step ? icon('check') : i + 1}</span><span class="onb-dot-label">${esc(s)}</span></li>`;
  }).join('')}</ol>`;
}

function topRow() {
  return `<div class="onb-top">${dots()}${btn('Skip — explore the sample stall', 'onb-skip', 'quiet-outline small onb-skip')}</div>`;
}

function stepPick() {
  const c = C();
  const sameMenu = flow.templateId === c.templateId;
  const reopen = store.state.onboarded;
  return `<div class="onb-intro">
      <h3>Pick your stall’s vibe</h3>
      <p>Each theme brings its hero art, colours and a starter menu. Every item, price and colour stays editable.</p>
    </div>
    ${reopen && !sameMenu ? `<div class="notice onb-warn">${icon('alert')}<div>A different theme <b>replaces your menu, discounts, games, mission &amp; milestones</b>. Sales history stays.</div></div>` : ''}
    <div class="studio-theme-grid onb-themes" role="radiogroup" aria-label="Stall theme">${themeCards({mode: 'radio', name: 'onb-tpl', selected: flow.templateId, current: reopen ? currentThemeId() : '', change: 'onb-template', prefix: 'onb-tpl'})}</div>
    <div class="onb-prices">${reopen && sameMenu
      ? `<p class="muted">${icon('check')} Keeps the menu you have now${c.products.length ? ` (${c.products.length} items)` : ''}.</p>`
      : check('onb-prices', 'Include suggested prices <small class="muted">— untick to set every price yourself</small>', flow.withPrices, 'id="onb-prices" data-change="onb-prices"')}</div>`;
}

function miniPreview() {
  const p = flow.profile;
  const t = themeById(flow.templateId);
  const look = themeLook(t);
  return `<div class="onb-mini" aria-hidden="true" style="--tpl:${esc(look.accent)}">
      ${heroBox({...look, heroImage: C().theme?.heroImage || null}, {cls: 'onb-mini-hero'})}
      <span class="onb-mini-text"><span class="onb-mini-mark">MYS</span>
      <strong data-onb-pv="title">${esc([p.stallName.trim() || 'Your stall', p.booth.trim()].filter(Boolean).join(' · '))}</strong>
      <small data-onb-pv="tagline">${esc(p.tagline)}</small></span>
    </div>`;
}

function stepName() {
  const p = flow.profile;
  const f = (/** @type {string} */ label, /** @type {string} */ key, /** @type {number} */ max, /** @type {string} */ ph, extra = '') =>
    field(label, `onb-${key}`, p[key], 'text', `data-input="onb-field" data-key="${key}" maxlength="${max}" placeholder="${esc(ph)}" autocomplete="off"${extra}`);
  const count = parsePartners(flow.partners).length;
  return `<div class="onb-intro">
      <h3>Name your stall</h3>
      <p>This shows on the top bar, receipts and your day report.</p>
    </div>
    <div class="onb-name-grid">
      <form class="form-grid onb-form" id="onb-form" data-submit="onb-next" novalidate>
        <div class="full">${f('Stall name', 'stallName', LIMITS.stallName, 'e.g. Chai Sutta Point', ' required autofocus')}</div>
        ${f('Booth / stall no.', 'booth', LIMITS.booth, 'Stall No. 10')}
        ${f('Event', 'eventName', LIMITS.eventName, 'Diwali Mela 2026')}
        <div class="full">${f('Hero tagline', 'tagline', LIMITS.tagline, 'Kadak chai. Hot Maggi.')}</div>
        <div class="full onb-partners">${textarea(
          `Who’s running the stall? <small class="muted">(optional)</small>`, 'onb-partners', flow.partners,
          'data-input="onb-partners" rows="3" placeholder="Aarav, Diya, Kabir" autocomplete="off"',
          'Partners who chipped in — comma or one per line. They split the profit later (Studio › Team).',
        )}<span class="onb-partner-count" data-onb-partners${count ? '' : ' hidden'}>${icon('users')} <span>${count}</span> partner${count === 1 ? '' : 's'}</span></div>
      </form>
      ${miniPreview()}
    </div>`;
}

function stepReady() {
  const t = themeById(flow.templateId);
  const c = C();
  const keepsMenu = store.state.onboarded && flow.templateId === c.templateId;
  let items = c.products.length;
  let priced = c.products.filter(p => p.price !== null).length;
  if (!keepsMenu) {
    try {
      const built = buildTemplate(flow.templateId, {withPrices: flow.withPrices});
      items = built.products.length;
      priced = built.products.filter(p => p.price !== null).length;
    } catch {
      /* unknown template: counts stay as they are */
    }
  }
  const unpriced = items - priced;
  const partners = parsePartners(flow.partners).length;
  const tip = (/** @type {string} */ ic, /** @type {string} */ title, /** @type {string} */ text, /** @type {string} */ to, cls = '') =>
    `<button type="button" class="onb-tip${cls ? ' ' + cls : ''}" data-action="onb-go" data-to="${to}"><span class="onb-tip-icon">${icon(ic)}</span><span class="grow"><strong>${title}</strong><small>${text}</small></span>${icon('chevron-right')}</button>`;
  return `<div class="onb-ready">
      <span class="onb-burst" aria-hidden="true">${esc(t?.emoji || '✨')}</span>
      <h3>${esc(flow.profile.stallName.trim() || C().profile.stallName)} is ready!</h3>
      <p>${esc(t?.name || 'Your stall')} · ${items} item${items === 1 ? '' : 's'}${items ? (unpriced ? ` · ${unpriced} still need a price` : ' · all priced') : ''}${partners ? ` · ${partners} partner${partners === 1 ? '' : 's'}` : ''}</p>
    </div>
    <div class="onb-tips">
      ${tip('rupee', 'Set prices', unpriced ? 'Price board: fill every price in one go.' : 'Check the price board before the rush.', 'prices')}
      ${tip('upi', 'Add UPI', 'Your UPI ID makes a scan-to-pay QR at checkout.', 'upi')}
      ${tip('sell', 'Start selling', 'Tap items, take Cash or UPI, hand over the token.', 'sell', 'go')}
    </div>
    <p class="footnote onb-foot">Everything saves on this device and works offline. Change any of it later in Customize My Stall.</p>`;
}

function show() {
  const step = flow.step;
  const body = `${topRow()}<div class="onb-step" data-onb-step="${step}">${step === 0 ? stepPick() : step === 1 ? stepName() : stepReady()}</div>`;
  const back = step > 0 ? btn(`${icon('chevron-left')} Back`, 'onb-back', 'quiet-outline onb-back') : '';
  const next = step < STEPS.length - 1
    ? btn(`Next ${icon('chevron-right')}`, 'onb-next', 'primary onb-next')
    : btn(`${icon('check')} Finish`, 'onb-finish', 'primary onb-finish');
  openSheet(step === 0 ? 'Welcome to your stall 🎉' : step === 1 ? 'Make it yours' : 'Let’s make some noise!', body, back + next, 'onboarding', {wide: true});
}

/** Open (or restart) the onboarding flow with the current stall as the starting point. */
export function openOnboarding() {
  const c = C();
  // A fresh or factory-reset stall must not inherit half-typed Studio edits from the stall that was there before.
  if (!store.state.onboarded) resetStudioDrafts();
  flow.step = 0;
  flow.templateId = currentThemeId();
  flow.withPrices = true;
  flow.taglineTouched = false;
  flow.profile = {stallName: c.profile.stallName, booth: c.profile.booth, eventName: c.profile.eventName, tagline: c.profile.tagline};
  flow.partners = (c.team?.members || []).map((/** @type {any} */ m) => m.name).join(', ');
  show();
}

/** Write everything chosen in the flow, then mark the stall onboarded. */
async function finish() {
  const c = C();
  const first = !store.state.onboarded;
  const themeId = flow.templateId;
  const menuChange = first || themeId !== c.templateId;
  const lookChange = first || themeId !== c.theme?.themeId;
  const withPrices = flow.withPrices;
  const profile = {...flow.profile};
  const profileChanged = Object.keys(profile).some(k => String(profile[k] ?? '').trim() !== String(c.profile[k] ?? ''));
  if (!String(profile.stallName).trim()) {
    flow.step = 1;
    show();
    throw Error('Give your stall a name.');
  }
  try {
    checkPartners();
  } catch (err) {
    flow.step = 1;
    show();
    throw err;
  }
  const partners = newPartners();
  const run = () => commitConfig(st => {
    if (menuChange || lookChange) {
      // The hero sub-line follows the new theme only while it is still the old theme's default.
      const oldSub = defaultSubTagline(st.config.templateId);
      const untouchedSub = !st.config.profile.subTagline || st.config.profile.subTagline === oldSub;
      applyTheme(st, themeId, {menu: menuChange, withPrices});
      const newSub = defaultSubTagline(themeId);
      if (menuChange && untouchedSub && newSub) saveProfile(st.config, {subTagline: newSub});
    }
    saveProfile(st.config, profile);
    for (const name of partners) addMember(st.config, {name});
    st.onboarded = true;
  });
  // Re-running setup is an admin change (same as Studio's theme switch and profile save); the first run never asks.
  if (!first) {
    if (!menuChange && !lookChange && !profileChanged && !partners.length) return true;
    const done = await requireAdmin(async () => {
      await run();
      return true;
    });
    if (!done) return false;
  } else {
    await run();
  }
  resetStudioDrafts(menuChange || lookChange ? ['profile', 'look', 'mission', 'shares'] : ['profile', 'shares']);
  return true;
}

// Boot guard (§17.2): only an open stall that isn't onboarded yet, and not while a full-screen page (#/stalls…) is showing.
onBoot(() => {
  if (store.state && !store.state.onboarded && !currentPage()) openOnboarding();
});

registerInputs({
  'onb-field': el => {
    const key = el.dataset.key;
    if (!(key in flow.profile)) return;
    flow.profile[key] = el.value;
    if (key === 'tagline') flow.taglineTouched = true;
    const title = document.querySelector('[data-onb-pv="title"]');
    if (title) title.textContent = [flow.profile.stallName.trim() || 'Your stall', flow.profile.booth.trim()].filter(Boolean).join(' · ');
    const tag = document.querySelector('[data-onb-pv="tagline"]');
    if (tag) tag.textContent = flow.profile.tagline;
  },
  'onb-partners': el => {
    flow.partners = el.value;
    const n = parsePartners(flow.partners).length;
    const pill = /** @type {HTMLElement|null} */ (document.querySelector('[data-onb-partners]'));
    if (pill) {
      pill.hidden = !n;
      pill.innerHTML = `${icon('users')} <span>${n}</span> partner${n === 1 ? '' : 's'}`;
    }
  },
});

registerChanges({
  'onb-template': el => {
    flow.templateId = el.value;
    if (!flow.taglineTouched) flow.profile.tagline = suggestedTagline();
    if (sheetKind() === 'onboarding' && flow.step === 0) {
      const body = sheetEl()?.querySelector('.sheet-body');
      const top = body?.scrollTop || 0;
      show();
      const nextBody = sheetEl()?.querySelector('.sheet-body');
      if (nextBody) nextBody.scrollTop = top;
      /** @type {HTMLElement|null} */ (sheetEl()?.querySelector(`#onb-tpl-${CSS.escape(el.value)}`))?.focus({preventScroll: true});
    }
  },
  'onb-prices': el => {
    flow.withPrices = !!el.checked;
  },
});

registerActions({
  'onb-open': () => openOnboarding(),
  'onb-skip': async () => {
    if (!store.state.onboarded) await commit(st => {
      st.onboarded = true;
    });
    closeSheet();
    toast('Sample stall loaded. Have a look around — change anything in Customize My Stall.');
  },
  'onb-next': () => {
    if (flow.step === 1) {
      if (!String(flow.profile.stallName).trim()) throw Error('Give your stall a name.');
      checkPartners();
    }
    flow.step = Math.min(STEPS.length - 1, flow.step + 1);
    show();
  },
  'onb-back': () => {
    flow.step = Math.max(0, flow.step - 1);
    show();
  },
  'onb-finish': async () => {
    if (!(await finish())) return;
    closeSheet();
    navigate('sell');
    toast(`${C().profile.stallName} is open. Let’s make some noise!`);
  },
  'onb-go': async (_el, ds) => {
    if (!(await finish())) return;
    closeSheet();
    if (ds.to === 'prices') {
      navigate('sell');
      await runAction('menu-price-board');
    } else if (ds.to === 'upi') {
      await runAction('studio-open', {section: 'upi'});
    } else {
      navigate('sell');
      toast(`${C().profile.stallName} is open. Let’s make some noise!`);
    }
  },
});
