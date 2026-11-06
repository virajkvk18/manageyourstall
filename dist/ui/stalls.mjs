// "Your stalls" page (ARCHITECTURE.md §17.5) — #/stalls, full screen outside the stall shell.
//
// Account card · "On this phone" stall cards (from storage meta: hero mini, name, booth, orders, collected, last opened,
// sync badge) with Open, Edit info, Team access, Save to cloud / Sync now, conflict fixes and Delete from this phone ·
// "In your account, not on this phone" (cloud.listCloudStalls) with Download & open · Start a new stall · Join a team stall.
// Local data comes from storage.mjs (§17.1); every cloud call goes through cloud.mjs (§17.4).
import * as core from './core.mjs';
import * as cloud from '../cloud.mjs';
import * as storage from '../storage.mjs';
import {
  esc, icon, btn, money, toast, openSheet, closeSheet, sheetEl, confirmSheet, date, time, download,
  registerActions, registerInputs, installArtSprite, commitConfig,
} from './core.mjs';
import {saveProfile, saveTeam, removeMember, validateConfig, equalShares, CATALOG_LIMITS} from '../catalog.mjs';
import {exportBackup, referencedMedia} from '../domain.mjs';
import {heroSvg, artSvg, FALLBACK_ART} from '../library.mjs';
import {HEX_RE, LIMITS} from '../constants.mjs';
import {slug, istDate} from '../util.mjs';
import {
  pageTop, pageFoot, cloudFn, cloudOn, currentSession, signedInUser, cloudErrText, errText, rememberNext, goTo, stallOpen,
  openStallName, backToStall, teamCount, backLabel,
} from './account.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Page data (loaded async, rendered from this cache)
// ---------------------------------------------------------------------------------------------------------------------

/** @type {{meta: any, metaError: string, cloudList: any[] | null, cloudError: string, loading: boolean, cloudLoading: boolean}} */
const page = {meta: null, metaError: '', cloudList: null, cloudError: '', loading: false, cloudLoading: false};
/** Entry ids with a cloud call in flight → label shown on the card. @type {Map<string, string>} */
const busy = new Map();
/** Cloud stall ids being downloaded. @type {Set<string>} */
const pulling = new Set();
let loadSeq = 0;

const onPage = () => {
  try {
    if (typeof core.currentPage === 'function') return core.currentPage() === 'stalls';
  } catch {
    // fall back to the hash
  }
  return /^#\/stalls(\?|$)/.test(location.hash);
};

/** Reload storage meta (and the cloud list when signed in), then re-render if still on this page. */
async function load({withCloud = true} = {}) {
  const seq = ++loadSeq;
  page.loading = true;
  try {
    if (typeof storage.getMeta !== 'function') throw Error('This copy of MYS can’t list stalls yet. Reload the page.');
    page.meta = await storage.getMeta();
    page.metaError = '';
  } catch (err) {
    page.metaError = errText(err);
  } finally {
    page.loading = false;
  }
  if (seq === loadSeq && onPage()) {
    core.render();
    finishPendingLink().catch(err => toast(cloudErrText(err), {tone: 'error'}));
  }
  if (withCloud) await loadCloud();
}

async function loadCloud() {
  if (!cloudOn() || !signedInUser()) {
    page.cloudList = null;
    page.cloudError = '';
    return;
  }
  if (navigator.onLine === false) {
    page.cloudError = 'offline';
    if (onPage()) core.render();
    return;
  }
  page.cloudLoading = true;
  if (onPage()) core.render();
  try {
    const list = await cloudFn('listCloudStalls')();
    page.cloudList = Array.isArray(list) ? list : [];
    page.cloudError = '';
  } catch (err) {
    page.cloudError = cloudErrText(err);
  } finally {
    page.cloudLoading = false;
  }
  if (onPage()) core.render();
}

/** @returns {any[]} device stall entries, the open one first, then most recently opened/updated. */
function entries() {
  const list = Array.isArray(page.meta?.stalls) ? [...page.meta.stalls] : [];
  const active = page.meta?.activeStallId || null;
  const stamp = (/** @type {any} */ e) => String(e.openedAt || e.updatedAt || e.createdAt || '');
  return list.sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : stamp(b).localeCompare(stamp(a))));
}

/** @param {string} id */
const entryById = id => (Array.isArray(page.meta?.stalls) ? page.meta.stalls.find((/** @type {any} */ e) => e.id === id) : null) || null;

/** @param {string} id */
const isActive = id => {
  const open = /** @type {any} */ (core.store).stallId;
  return stallOpen() && (open ? open === id : Boolean(page.meta && page.meta.activeStallId === id));
};

/**
 * Sync status of an entry for the card: cloud.syncState (live engine view) with a meta fallback.
 * @param {any} e
 * @returns {{status: string, label: string, detail: string}}
 */
function syncInfo(e) {
  if (!e?.cloud) return {status: 'local', label: 'On this phone', detail: ''};
  try {
    if (typeof cloud.syncState === 'function') {
      const s = /** @type {any} */ (cloud.syncState(e));
      if (s && typeof s === 'object' && s.status) return {status: String(s.status), label: String(s.label || ''), detail: String(s.detail || '')};
      if (typeof s === 'string' && s) return {status: s, label: '', detail: ''};
    }
  } catch {
    // fall back to meta
  }
  return {status: String(e.cloud.status || (e.cloud.dirty ? 'pending' : 'synced')), label: '', detail: String(e.cloud.lastError || '')};
}

/** @param {any} e */
const syncStatus = e => syncInfo(e).status;

// ---------------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------------

/** Readable ink/paper text on a hex background. @param {string} hex */
function onColor(hex) {
  if (!HEX_RE.test(hex)) return '#171717';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#171717' : '#fff9ed';
}

const SYNC_TONES = {
  local: ['On this phone', 'cream', 'phone'],
  synced: ['Synced', 'mint', 'check'],
  pending: ['Waiting to sync', 'yellow', 'clock'],
  syncing: ['Syncing…', 'sky', 'refresh'],
  offline: ['Offline · will sync', 'lavender', 'wifi-off'],
  conflict: ['Needs attention', 'coral', 'alert'],
  error: ['Needs attention', 'coral', 'alert'],
};

/** @param {{status: string, label: string}} info */
function syncBadge({status, label}) {
  const [fallback, tone, ic] = SYNC_TONES[/** @type {keyof typeof SYNC_TONES} */ (status)] || SYNC_TONES.pending;
  const text = String(label || fallback).replace(/\s*✓$/, '');
  return `<span class="stl-sync stl-sync-${tone}" data-sync="${esc(status)}">${icon(ic)}<span>${esc(text)}</span></span>`;
}

/** @param {string|null|undefined} iso */
function whenText(iso) {
  if (!iso) return 'Not opened yet';
  try {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return 'Not opened yet';
    const today = istDate();
    const day = istDate(at);
    if (day === today) return `Today, ${time(at)}`;
    return date(at);
  } catch {
    return 'Not opened yet';
  }
}

/** The account card at the top of the page. */
function accountCard() {
  if (!cloudOn()) {
    return `<section class="stl-account stl-account-off" aria-label="Account">
      <span class="stl-acc-icon">${icon('phone')}</span>
      <div class="grow"><strong>Everything lives on this phone</strong><p>Cloud accounts aren’t switched on for this copy of MYS.</p></div>
    </section>`;
  }
  const user = signedInUser();
  if (user) {
    const name = String(user.name || 'Your account');
    return `<section class="stl-account stl-account-in" aria-label="Account">
      <span class="stl-acc-avatar" aria-hidden="true">${esc(initialsOf(name || user.loginId))}</span>
      <div class="stl-acc-text grow">
        <span class="stl-acc-eyebrow">${icon('check')} Logged in</span>
        <strong class="stl-acc-name">${esc(name)}</strong>
        <span class="stl-acc-id">${esc(user.loginId || '')}</span>
      </div>
      <div class="stl-acc-actions">
        ${btn(`${icon('lock')}<span>Change password</span>`, 'stl-go', 'small', 'data-page="account"')}
        ${btn(`<span>Log out</span>`, 'acc-logout', 'small quiet-outline')}
      </div>
    </section>`;
  }
  const team = teamCount() > 0;
  return `<section class="stl-account stl-account-out" aria-label="Account">
    <span class="stl-acc-icon">${icon('phone')}</span>
    <div class="stl-acc-text grow">
      <strong class="stl-acc-name">Open your stalls on any phone</strong>
      <p>${team ? 'You’re helping at a team stall. Log in to save your own stalls too.' : 'Free MYS account · syncs when there’s internet.'}</p>
    </div>
    <div class="stl-acc-actions">
      ${btn(`${icon('unlock')}<span>Log in</span>`, 'stl-go', 'primary', 'data-page="login"')}
      ${btn('<span>Create account</span>', 'stl-go', 'yellow', 'data-page="signup"')}
    </div>
  </section>`;
}

/** @param {string} name */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || 'M') + (parts[1]?.[0] || '')).toUpperCase();
}

/** Conflict / error explanation inside a card. @param {any} e @param {{status: string, label: string, detail: string}} info */
function cardNotice(e, info) {
  const status = info.status;
  if (status === 'conflict') {
    return `<div class="stl-alert" role="note">
      <strong>${icon('alert')} Two versions of this stall</strong>
      <p>Another phone saved a newer copy to the cloud. Pick the one to keep — nothing is overwritten until you choose.</p>
      <div class="stl-alert-actions">
        ${btn(`${icon('phone')}<span>Use this phone’s copy</span>`, 'stl-force-push', 'small yellow', `data-id="${esc(e.id)}"`)}
        ${btn(`${icon('download')}<span>Use the cloud copy</span>`, 'stl-use-cloud', 'small sky', `data-id="${esc(e.id)}"`)}
      </div>
    </div>`;
  }
  if (status === 'error') {
    const why = info.detail || e.cloud?.lastError || 'The last sync didn’t go through.';
    return `<div class="stl-alert" role="note"><strong>${icon('alert')} Sync hit a snag</strong><p>${esc(why)} Your sales are safe on this phone.</p></div>`;
  }
  if (status === 'offline') {
    return `<p class="stl-hint">${icon('wifi-off')} Offline — sales are safe here and sync when internet is back.</p>`;
  }
  if (status === 'pending' && /log in|join again/i.test(info.label + ' ' + info.detail)) {
    return `<p class="stl-hint">${icon('info')} ${esc(info.detail || 'Log in to keep this stall syncing.')}</p>`;
  }
  return '';
}

/** One "On this phone" stall card. @param {any} e */
function stallCard(e) {
  const sum = e.summary || {};
  const accent = HEX_RE.test(sum.accent) ? sum.accent : '#FFDD35';
  const info = syncInfo(e);
  const status = info.status;
  const active = isActive(e.id);
  const owner = e.cloud && e.cloud.access !== 'team';
  const working = busy.get(e.id) || '';
  const name = String(sum.name || 'My stall');
  const cloudBtn = !cloudOn()
    ? ''
    : !e.cloud
      ? btn(`${icon('upload')}<span>Save to cloud</span>`, 'stl-link', 'small sky', `data-id="${esc(e.id)}"${working ? ' aria-disabled="true"' : ''}`)
      : status !== 'conflict'
        ? btn(`${icon('refresh', working ? 'stl-spin' : '')}<span>${working || 'Sync now'}</span>`, 'stl-sync-now', 'small mint', `data-id="${esc(e.id)}"${working ? ' aria-disabled="true"' : ''}`)
        : '';
  return `<article class="stl-card${active ? ' is-active' : ''}" data-stall="${esc(e.id)}" style="--stl-accent:${accent};--stl-on:${onColor(accent)}">
    <div class="stl-card-hero">
      ${heroSvg(Array.isArray(sum.heroArt) ? sum.heroArt : [], {cls: 'stl-hero-art'})}
      <div class="stl-card-flags">${active ? '<span class="stl-live">Open now</span>' : ''}${syncBadge(info)}</div>
    </div>
    <div class="stl-card-body">
      <div class="stl-card-title">
        <h3 class="stl-name">${esc(name)}</h3>
        ${sum.booth ? `<span class="stl-booth">${icon('pin')}${esc(sum.booth)}</span>` : ''}
      </div>
      <dl class="stl-stats">
        <div><dt>Orders</dt><dd>${Number(sum.orders) || 0}</dd></div>
        <div><dt>Collected</dt><dd>${esc(money(Number(sum.collected) || 0))}</dd></div>
        <div class="stl-stat-wide"><dt>Last opened</dt><dd>${esc(whenText(e.openedAt))}</dd></div>
      </dl>
      ${cardNotice(e, info)}
      ${btn(`${icon(active ? 'sell' : 'store')}<span>${active ? 'Back to counter' : 'Open stall'}</span>`, 'stl-open', 'primary block stl-open', `data-id="${esc(e.id)}"`)}
      <div class="stl-card-tools">
        ${btn(`${icon('edit')}<span>Edit info</span>`, 'stl-edit', 'small', `data-id="${esc(e.id)}"`)}
        ${owner && cloudOn() ? btn(`${icon('users')}<span>Team access</span>`, 'stl-team', 'small lavender', `data-id="${esc(e.id)}"`) : ''}
        ${cloudBtn}
        ${btn(`${icon('trash')}<span>Delete</span>`, 'stl-delete', 'small quiet-outline stl-del', `data-id="${esc(e.id)}" aria-label="Delete ${esc(name)} from this phone"`)}
      </div>
    </div>
  </article>`;
}

/** Cloud stalls not on this phone. */
function cloudSection() {
  if (!cloudOn() || !signedInUser()) return '';
  const local = new Set(entries().map(e => e.cloud?.stallId).filter(Boolean));
  const onPhone = (/** @type {any} */ c) => local.has(c.id) || Boolean(c.localId && entryById(c.localId));
  let body;
  if (page.cloudError === 'offline') {
    body = `<p class="stl-empty-line">${icon('wifi-off')} You’re offline. Your cloud stalls show up here when you’re connected.</p>`;
  } else if (page.cloudError) {
    body = `<div class="stl-empty-line">${icon('alert')} <span>${esc(page.cloudError)}</span> ${btn('Try again', 'stl-reload', 'small')}</div>`;
  } else if (page.cloudList === null) {
    body = `<p class="stl-empty-line">${icon('refresh', 'stl-spin')} Checking your account…</p>`;
  } else {
    const rest = page.cloudList.filter(c => !onPhone(c));
    body = rest.length
      ? `<div class="stl-cloud-list">${rest.map(cloudRow).join('')}</div>`
      : `<p class="stl-empty-line">${icon('check')} All your cloud stalls are on this phone.</p>`;
  }
  return `<section class="stl-section" aria-labelledby="stl-cloud-h">
    <div class="stl-section-head"><h2 id="stl-cloud-h">In your account, not on this phone</h2>${page.cloudLoading ? `<span class="stl-count">${icon('refresh', 'stl-spin')}</span>` : ''}</div>
    ${body}
  </section>`;
}

/** @param {any} c cloud stall */
function cloudRow(c) {
  const accent = HEX_RE.test(c.accent) ? c.accent : '#FFDD35';
  const sum = c.summary || {};
  const saved = c.snapshotAt ? `Saved ${whenText(c.snapshotAt)}${c.snapshotDevice ? ` · ${c.snapshotDevice}` : ''}` : 'Nothing saved yet';
  const going = pulling.has(c.id);
  return `<article class="stl-cloud-row" data-cloud="${esc(c.id)}" style="--stl-accent:${accent};--stl-on:${onColor(accent)}">
    <div class="stl-cloud-art">${artSvg((Array.isArray(c.heroArt) && c.heroArt[0]) || FALLBACK_ART, 'stl-cloud-svg')}</div>
    <div class="grow stl-cloud-text">
      <strong>${esc(c.name || 'Stall')}</strong>
      <span>${[c.booth, c.eventName, c.city].filter(Boolean).map(x => esc(x)).join(' · ') || esc(c.code || '')}</span>
      <span class="stl-cloud-meta">${Number(sum.orders) || 0} orders · ${esc(money(Number(sum.collected) || 0))} · ${esc(saved)}</span>
    </div>
    ${btn(`${icon('download', going ? 'stl-spin' : '')}<span>${going ? 'Downloading…' : 'Download & open'}</span>`, 'stl-pull', 'small sky', `data-cloud-id="${esc(c.id)}"${going || !c.snapshotAt ? ' aria-disabled="true"' : ''}`)}
  </article>`;
}

function stallsPage() {
  installArtSprite();
  // Arriving on the page (the old DOM, still in place while we render, isn't this page): refresh meta + cloud list.
  if (!document.querySelector('#app .stl-stalls')) load();
  const list = entries();
  const openName = openStallName();
  const back = stallOpen()
    ? btn(`${icon('chevron-left')}${backLabel(openName)}`, 'stl-back', 'small stl-back accent')
    : '';
  let phone;
  if (page.metaError) {
    phone = `<div class="stl-alert">${icon('alert')} <span>${esc(page.metaError)}</span></div>`;
  } else if (!page.meta) {
    phone = `<p class="stl-empty-line">${icon('refresh', 'stl-spin')} Loading your stalls…</p>`;
  } else if (!list.length) {
    phone = `<div class="stl-empty">
      <span class="stl-empty-mark" aria-hidden="true">🎪</span>
      <h3>No stalls on this phone yet</h3>
      <p>Set one up in a minute — or download one from your account.</p>
      ${btn(`${icon('plus')} Start a new stall`, 'stl-go', 'primary', 'data-page="setup"')}
    </div>`;
  } else {
    phone = `<div class="stl-grid">${list.map(stallCard).join('')}</div>`;
  }
  return `<div class="stl-page stl-stalls">
    ${pageTop(back)}
    <main class="stl-main" id="main">
      <section class="stl-hero">
        <div class="stl-hero-text">
          <span class="stl-eyebrow">Stall HQ</span>
          <h1>Your <span class="stl-hl">stalls</span></h1>
          <p>Every stall on this phone — open one, tidy its info, or save it to the cloud.</p>
        </div>
        <div class="stl-hero-cta">
          ${btn(`${icon('plus')}<span>Start a new stall</span>`, 'stl-go', 'primary big', 'data-page="setup"')}
          ${cloudOn() ? btn(`${icon('users')}<span>Join a team stall</span>`, 'stl-go', 'lavender big', 'data-page="join"') : ''}
        </div>
      </section>
      ${accountCard()}
      <section class="stl-section" aria-labelledby="stl-phone-h">
        <div class="stl-section-head"><h2 id="stl-phone-h">On this phone</h2>${page.meta ? `<span class="stl-count">${list.length}</span>` : ''}</div>
        ${phone}
      </section>
      ${cloudSection()}
      <p class="stl-honest">${icon('info')} Sales save on this phone first. Cloud sync needs internet. MYS never checks bank payments — confirm UPI on your own app.</p>
    </main>
    ${pageFoot()}
  </div>`;
}

if (typeof core.registerPage === 'function') core.registerPage('stalls', stallsPage);

// ---------------------------------------------------------------------------------------------------------------------
// Edit info sheet
// ---------------------------------------------------------------------------------------------------------------------

/** @type {null | {id: string, name: string, booth: string, eventName: string, city: string, members: {id?: string, key: string, name: string}[], originalIds: string[]}} */
let edit = null;
let memberSeq = 0;

/** @param {string} id */
async function stallStateOf(id) {
  if (isActive(id)) return core.store.state;
  if (typeof storage.readStall !== 'function') throw Error('This copy of MYS can’t read that stall yet. Reload the page.');
  return storage.readStall(id);
}

/** @param {string} id */
async function openEdit(id) {
  const st = await stallStateOf(id);
  const p = st?.config?.profile || {};
  const members = (st?.config?.team?.members || []).map((/** @type {any} */ m) => ({id: m.id, key: `m${++memberSeq}`, name: m.name}));
  edit = {id, name: p.stallName || '', booth: p.booth || '', eventName: p.eventName || '', city: p.city || '', members, originalIds: members.map(m => m.id)};
  editSheet();
}

/** @param {string} [focusId] */
function editSheet(focusId = '') {
  if (!edit) return;
  const e = edit;
  const rows = e.members.map(m => `<li class="stl-member">
      <label class="sr-only" for="stl-m-${m.key}">Partner name</label>
      <input id="stl-m-${m.key}" class="input" type="text" value="${esc(m.name)}" maxlength="${LIMITS.memberName || 40}" data-input="stl-edit-member" data-key="${m.key}" autocomplete="off">
      ${btn(icon('close'), 'stl-member-remove', 'icon-btn quiet-outline', `data-key="${m.key}" aria-label="Remove ${esc(m.name || 'partner')}"`)}
    </li>`).join('');
  const full = e.members.length >= CATALOG_LIMITS.members;
  openSheet(
    'Edit stall info',
    `<form class="stl-edit-form" data-submit="stl-edit-save" novalidate>
      <div class="field"><label for="stl-e-name">Stall name</label><input id="stl-e-name" type="text" value="${esc(e.name)}" maxlength="${LIMITS.stallName || 60}" data-input="stl-edit-field" data-key="name" autocomplete="off" required></div>
      <div class="field"><label for="stl-e-booth">Stall / booth number <span class="stl-opt">optional</span></label><input id="stl-e-booth" type="text" value="${esc(e.booth)}" maxlength="${LIMITS.booth || 40}" data-input="stl-edit-field" data-key="booth" autocomplete="off" placeholder="No stall number? Leave it empty"></div>
      <div class="form-grid stl-edit-grid">
        <div class="field"><label for="stl-e-event">Event</label><input id="stl-e-event" type="text" value="${esc(e.eventName)}" maxlength="${LIMITS.eventName || 80}" data-input="stl-edit-field" data-key="eventName" autocomplete="off" placeholder="Diwali Mela"></div>
        <div class="field"><label for="stl-e-city">City</label><input id="stl-e-city" type="text" value="${esc(e.city)}" maxlength="${LIMITS.city || 60}" data-input="stl-edit-field" data-key="city" autocomplete="off" placeholder="Jabalpur"></div>
      </div>
      <div class="stl-team-edit">
        <div class="stl-team-head"><strong>Team members</strong><span class="muted">${e.members.length}/${CATALOG_LIMITS.members}</span></div>
        ${rows ? `<ul class="stl-members">${rows}</ul>` : '<p class="muted stl-team-empty">No partners yet — add the people running the stall with you.</p>'}
        <div class="stl-member-add">
          <label class="sr-only" for="stl-m-new">New partner name</label>
          <input id="stl-m-new" class="input" type="text" placeholder="Add a partner’s name" maxlength="${LIMITS.memberName || 40}" autocomplete="off"${full ? ' disabled' : ''}>
          ${btn(`${icon('plus')}<span>Add</span>`, 'stl-member-add', 'small lime', full ? 'aria-disabled="true"' : '')}
        </div>
        <p class="stl-hint">Partners with bills or contri can be renamed, not removed.</p>
      </div>
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save info`, 'stl-edit-save', 'primary'),
    'stl-edit',
    {onClose: () => {
      edit = null;
    }},
  );
  if (focusId) /** @type {HTMLElement|null} */ (document.getElementById(focusId))?.focus();
}

/** Read the add-partner input into the draft (Enter in it adds instead of saving). */
function addMemberFromInput() {
  if (!edit) return false;
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('stl-m-new'));
  const name = (input?.value || '').replace(/\s+/g, ' ').trim();
  if (!name) return false;
  if (edit.members.length >= CATALOG_LIMITS.members) throw Error(`You can have at most ${CATALOG_LIMITS.members} partners.`);
  if (edit.members.some(m => m.name.trim().toLowerCase() === name.toLowerCase())) throw Error(`“${name}” is already on the team.`);
  edit.members.push({key: `m${++memberSeq}`, name});
  editSheet('stl-m-new');
  return true;
}

/**
 * Apply the edit draft to a stall state (mutates it; throws a friendly message when invalid).
 * @param {any} st
 * @param {NonNullable<typeof edit>} e
 */
function applyEdit(st, e) {
  saveProfile(st.config, {stallName: e.name.trim(), booth: e.booth.trim(), eventName: e.eventName.trim(), city: e.city.trim()});
  const keep = new Set(e.members.map(m => m.id).filter(Boolean));
  for (const id of e.originalIds) if (!keep.has(id)) removeMember(st, id);
  const before = st.config.team?.members || [];
  const custom = st.config.team?.splitMode === 'custom';
  const changed = e.members.length !== before.length || e.members.some(m => !m.id);
  const shares = custom && changed ? equalShares(e.members.length) : null;
  const members = e.members.map((m, i) => {
    const old = before.find((/** @type {any} */ x) => x.id === m.id);
    /** @type {any} */
    const out = {name: m.name.replace(/\s+/g, ' ').trim()};
    if (old) {
      out.id = old.id;
      out.color = old.color;
      out.share = old.share;
    }
    if (shares) out.share = shares[i];
    return out;
  });
  saveTeam(st.config, {members});
  validateConfig(st.config);
}

async function saveEdit() {
  if (!edit) return;
  addMemberFromInput();
  const e = edit;
  if (!e.name.trim()) {
    document.getElementById('stl-e-name')?.setAttribute('aria-invalid', 'true');
    throw Error('Give your stall a name.');
  }
  if (e.members.some(m => !m.name.trim())) throw Error('Every partner needs a name (or remove the empty row).');
  const entry = entryById(e.id);
  if (isActive(e.id)) {
    await commitConfig(st => applyEdit(st, e), {render: false});
    // Studio keeps typed-but-unsaved profile/team drafts in memory; drop them so it shows the info saved here.
    await import('./studio.mjs').then(m => m.resetStudioDrafts(['profile', 'team', 'shares'])).catch(() => {});
  } else {
    if (typeof storage.writeStall !== 'function') throw Error('This copy of MYS can’t edit that stall yet. Reload the page.');
    const st = await storage.readStall(e.id);
    applyEdit(st, e);
    await storage.writeStall(e.id, st);
    // Edits outside core.commit don't reach the sync engine by themselves: queue the push for a linked stall.
    if (entry?.cloud && typeof cloud.markDirty === 'function') await Promise.resolve(cloud.markDirty(e.id)).catch(() => {});
  }
  edit = null;
  closeSheet();
  toast(entry?.cloud ? 'Stall info saved. It syncs in a few seconds. ✨' : 'Stall info saved. ✨');
  await load({withCloud: false});
}

// ---------------------------------------------------------------------------------------------------------------------
// Cloud actions
// ---------------------------------------------------------------------------------------------------------------------

/** Push one linked stall; status lands in meta and the card re-renders. @param {string} id @param {{quiet?: boolean}} [o] */
async function syncEntry(id, {quiet = false} = {}) {
  busy.set(id, 'Syncing…');
  if (onPage()) core.render();
  try {
    const out = await cloudFn('pushStall')(id);
    if (out && out.conflict) {
      if (!quiet) toast('Another phone saved a newer copy. Pick which one to keep.', {tone: 'warn'});
    } else if (!quiet) toast(out?.skipped ? 'Already up to date. ✓' : 'Synced to your account. ✓');
  } catch (err) {
    if (!quiet) toast(cloudErrText(err), {tone: 'error'});
  } finally {
    busy.delete(id);
  }
  await load();
}

/** Ask the signed-out owner to log in before saving to the cloud. @param {string} id */
function loginFirstSheet(id) {
  openSheet(
    'Save to cloud',
    `<div class="stl-login-first">
      <span class="stl-lf-art" aria-hidden="true">☁️</span>
      <p><strong>Log in to save this stall to the cloud.</strong></p>
      <p class="muted">An MYS account lets you open this stall on any phone. Your sales stay on this phone either way.</p>
    </div>`,
    btn('Log in', 'stl-auth', 'primary', `data-page="login" data-id="${esc(id)}"`) +
      btn('Create account', 'stl-auth', 'yellow', `data-page="signup" data-id="${esc(id)}"`),
    'stl-login-first',
  );
}

const PENDING_LINK = 'mys-pending-link';

/** After logging in from a "Save to cloud" prompt, finish linking that stall. */
async function finishPendingLink() {
  let id = '';
  try {
    id = sessionStorage.getItem(PENDING_LINK) || '';
    if (id && signedInUser()) sessionStorage.removeItem(PENDING_LINK);
  } catch {
    id = '';
  }
  if (!id || !signedInUser() || !entryById(id) || entryById(id).cloud) return;
  await linkEntry(id);
}

/** @param {string} id */
async function linkEntry(id) {
  if (navigator.onLine === false) throw Error('You’re offline. Saving to the cloud needs internet — try again once you’re connected.');
  busy.set(id, 'Saving…');
  if (onPage()) core.render();
  try {
    await cloudFn('linkStall')(id);
    toast('Saved to your account! Open it on any phone now. ☁️');
  } catch (err) {
    toast(cloudErrText(err), {tone: 'error'});
  } finally {
    busy.delete(id);
  }
  await load();
}

/** A local backup file of one stall (state + the photos it uses). @param {string} id */
async function downloadBackup(id) {
  const st = await stallStateOf(id);
  if (!st) throw Error('That stall isn’t on this phone any more.');
  /** @type {Record<string, string>} */
  let media = {};
  try {
    const all = await storage.getAllMedia();
    const used = referencedMedia(st);
    for (const [key, data] of Object.entries(all || {})) if (used.has(key)) media[key] = data;
  } catch {
    media = {};
  }
  const name = slug(st.config?.profile?.stallName || 'stall') || 'stall';
  download(`mys-${name}-backup-${istDate()}.json`, JSON.stringify(exportBackup(st, media)), 'application/json');
}

/** @param {string} id */
async function teamSheet(id) {
  const e = entryById(id);
  if (!e?.cloud) return;
  const code = String(e.cloud.code || '');
  let hasPassword = null;
  const info = (page.cloudList || []).find(c => c.id === e.cloud.stallId);
  if (info) hasPassword = Boolean(info.hasTeamPassword);
  openSheet(
    'Team access',
    `<div class="stl-team-sheet">
      <p class="muted">Teammates join from <strong>Join a team stall</strong> with this code and a team password — no account needed.</p>
      <div class="stl-code-box">
        <span class="stl-code-label">Stall code</span>
        <span class="stl-code" id="stl-code">${esc(code)}</span>
        ${btn(`${icon('copy')}<span>Copy</span>`, 'stl-copy-code', 'small yellow', `data-code="${esc(code)}"`)}
      </div>
      <p class="stl-team-state">${hasPassword === null ? `${icon('info')} Set a team password to let teammates in.` : hasPassword ? `${icon('check')} Team password is set — teammates can join.` : `${icon('lock')} No team password yet — nobody can join.`}</p>
      <form class="stl-team-form" data-submit="stl-team-save" novalidate>
        <div class="field"><label for="stl-team-pass">${hasPassword ? 'New team password' : 'Team password'}</label><input id="stl-team-pass" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="100" placeholder="At least 6 characters"><small>Share it only with people you trust on the counter.</small></div>
      </form>
      ${hasPassword !== false ? `<div class="stl-team-remove">${btn(`${icon('trash')}<span>Remove team access</span>`, 'stl-team-remove', 'small quiet-outline', `data-id="${esc(id)}"`)}<span class="muted">Phones that already joined are signed out.</span></div>` : ''}
    </div>`,
    btn('Close', 'close', 'quiet-outline') + btn(`${icon('lock')} Set password`, 'stl-team-save', 'primary', `data-id="${esc(id)}"`),
    'stl-team',
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------------

registerInputs({
  'stl-edit-field': el => {
    if (!edit) return;
    const input = /** @type {HTMLInputElement} */ (el);
    /** @type {any} */ (edit)[input.dataset.key || ''] = input.value;
    if (input.getAttribute('aria-invalid') === 'true') input.setAttribute('aria-invalid', 'false');
  },
  'stl-edit-member': el => {
    const input = /** @type {HTMLInputElement} */ (el);
    const m = edit?.members.find(x => x.key === input.dataset.key);
    if (m) m.name = input.value;
  },
});

registerActions({
  'stl-go': (_el, ds) => {
    const target = ds.page || 'stalls';
    if (target === 'login' || target === 'signup') rememberNext('stalls');
    goTo(target);
    window.scrollTo(0, 0);
  },
  'stl-auth': (_el, ds) => {
    try {
      if (ds.id) sessionStorage.setItem(PENDING_LINK, ds.id);
    } catch {
      // the person can tap Save to cloud again after logging in
    }
    rememberNext('stalls');
    closeSheet();
    goTo(ds.page === 'signup' ? 'signup' : 'login');
    window.scrollTo(0, 0);
  },
  'stl-back': () => backToStall(),
  'stl-reload': () => load(),
  'stl-open': async (_el, ds) => {
    const id = ds.id || '';
    if (isActive(id)) return backToStall();
    if (typeof core.openStallById !== 'function') throw Error('This copy of MYS can’t switch stalls yet. Reload the page.');
    await core.openStallById(id);
    window.scrollTo(0, 0);
  },
  'stl-edit': (_el, ds) => openEdit(ds.id || ''),
  'stl-member-add': () => {
    if (!addMemberFromInput()) /** @type {HTMLElement|null} */ (document.getElementById('stl-m-new'))?.focus();
  },
  'stl-member-remove': (_el, ds) => {
    if (!edit) return;
    edit.members = edit.members.filter(m => m.key !== ds.key);
    editSheet();
  },
  'stl-edit-save': async (_el, _ds, event) => {
    // Enter inside "Add a partner" adds that partner instead of saving the sheet.
    const target = /** @type {any} */ (event)?.target;
    if (target && target.id === 'stl-m-new' && String(target.value || '').trim()) {
      addMemberFromInput();
      return;
    }
    await saveEdit();
  },

  'stl-link': async (_el, ds) => {
    const id = ds.id || '';
    if (!signedInUser()) return loginFirstSheet(id);
    await linkEntry(id);
  },
  'stl-sync-now': async (_el, ds) => {
    if (navigator.onLine === false) throw Error('You’re offline. Your sales are safe here and sync once you’re connected.');
    await syncEntry(ds.id || '');
  },
  'stl-force-push': (_el, ds) => {
    const id = ds.id || '';
    confirmSheet({
      title: 'Use this phone’s copy?',
      body: '<p>The cloud copy from the other phone gets replaced by this phone’s stall. Sales only the other phone has will be lost from the cloud.</p>',
      confirmLabel: 'Use this phone’s copy',
      onConfirm: async () => {
        busy.set(id, 'Syncing…');
        try {
          await cloudFn('pushStall')(id, {force: true});
          toast('Done — the cloud now has this phone’s copy.');
        } finally {
          busy.delete(id);
          await load();
        }
      },
    });
  },
  'stl-use-cloud': (_el, ds) => {
    const id = ds.id || '';
    confirmSheet({
      title: 'Use the cloud copy?',
      body: '<p>First we download a backup file of this phone’s copy (just in case). Then the cloud copy replaces this stall on this phone.</p>',
      confirmLabel: 'Back up & use cloud copy',
      onConfirm: async () => {
        await downloadBackup(id);
        busy.set(id, 'Downloading…');
        try {
          // pullStall swaps the open stall in place (state, photos, render) when this is the open one.
          await cloudFn('pullStall')(id);
          toast('Switched to the cloud copy. Backup file saved.');
        } finally {
          busy.delete(id);
          await load();
        }
      },
    });
  },
  'stl-pull': async (_el, ds) => {
    const cloudStallId = ds.cloudId || '';
    if (!cloudStallId || pulling.has(cloudStallId)) return;
    if (navigator.onLine === false) throw Error('You’re offline. Downloading a stall needs internet.');
    pulling.add(cloudStallId);
    core.render();
    try {
      // A new download is created and opened by pullStall; an existing local copy is refreshed, then opened here.
      const out = await cloudFn('pullStall')({cloudStallId});
      let id = out?.entryId || out?.entry?.id || '';
      if (!id) {
        const meta = await storage.getMeta();
        id = (meta?.stalls || []).find((/** @type {any} */ e) => e.cloud?.stallId === cloudStallId)?.id || '';
      }
      toast('Downloaded! Your stall is open. 🎉');
      if (!out?.created && id && typeof core.openStallById === 'function') await core.openStallById(id);
      else if (!id) await load();
    } catch (err) {
      toast(cloudErrText(err), {tone: 'error'});
      await load();
    } finally {
      pulling.delete(cloudStallId);
    }
  },

  'stl-team': async (_el, ds) => {
    const id = ds.id || '';
    if (!page.cloudList && signedInUser() && navigator.onLine !== false) await loadCloud().catch(() => {});
    await teamSheet(id);
  },
  'stl-copy-code': async (el, ds) => {
    const code = ds.code || '';
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copied ${code}`);
    } catch {
      const box = document.getElementById('stl-code');
      if (box) {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      toast('Copy didn’t work here — the code is selected, copy it by hand.', {tone: 'warn'});
    }
    el.classList.add('copied');
  },
  'stl-team-save': async (_el, ds) => {
    const input = /** @type {HTMLInputElement|null} */ (sheetEl()?.querySelector('#stl-team-pass'));
    const pass = input?.value || '';
    const id = ds.id || /** @type {HTMLElement|null} */ (sheetEl()?.querySelector('[data-action="stl-team-save"]'))?.dataset.id || '';
    if (pass.length < 6) {
      input?.setAttribute('aria-invalid', 'true');
      throw Error('Team password needs at least 6 characters.');
    }
    if (pass.length > 100) throw Error('Team password is too long (100 characters max).');
    if (navigator.onLine === false) throw Error('You’re offline. Setting a team password needs internet.');
    await cloudFn('setTeamPassword')(id, pass);
    closeSheet();
    toast('Team password set. Share the code + password with your team.');
    await load();
  },
  'stl-team-remove': (_el, ds) => {
    const id = ds.id || '';
    confirmSheet({
      title: 'Remove team access?',
      body: '<p>The team password is removed and phones that joined with it are signed out. You can set a new one any time.</p>',
      confirmLabel: 'Remove access',
      danger: true,
      onConfirm: async () => {
        if (navigator.onLine === false) throw Error('You’re offline. This needs internet.');
        await cloudFn('setTeamPassword')(id, null);
        toast('Team access removed.');
        await load();
      },
    });
  },

  'stl-backup': async (_el, ds) => {
    await downloadBackup(ds.id || '');
    toast('Backup file saved.');
  },
  'stl-delete': (_el, ds) => {
    const id = ds.id || '';
    const e = entryById(id);
    if (!e) return;
    const name = String(e.summary?.name || 'this stall');
    const linked = Boolean(e.cloud);
    const unsynced = linked && (e.cloud.dirty || ['pending', 'offline', 'error', 'conflict'].includes(syncStatus(e)));
    const body = `<div class="stl-del-body">
      <p>Removes <strong>${esc(name)}</strong> and all its orders from <strong>this phone</strong>.</p>
      ${linked
        ? `<p class="stl-del-safe">${icon('check')} The cloud copy stays in your account — download it again any time.</p>${unsynced ? `<p class="stl-del-warn">${icon('alert')} This phone has changes the cloud doesn’t have yet. They’ll be lost.</p>` : ''}`
        : `<p class="stl-del-warn">${icon('alert')} This stall isn’t saved to the cloud, so it’ll be gone for good.</p>`}
      ${btn(`${icon('download')}<span>Download a backup first</span>`, 'stl-backup', 'small', `data-id="${esc(id)}"`)}
    </div>`;
    confirmSheet({
      title: 'Delete from this phone?',
      body,
      confirmLabel: 'Delete from this phone',
      danger: true,
      typed: 'DELETE',
      onConfirm: async () => {
        if (typeof storage.deleteStall !== 'function') throw Error('This copy of MYS can’t delete stalls yet. Reload the page.');
        if (isActive(id) && typeof core.leaveCurrentStall === 'function') {
          await core.leaveCurrentStall();
        }
        await storage.deleteStall(id);
        closeSheet();
        toast(`${name} removed from this phone.`);
        goTo('stalls');
        await load();
      },
    });
  },
});

// Keep the page live: sync engine updates, other tabs, connectivity.
try {
  if (typeof cloud.onSyncChange === 'function') {
    cloud.onSyncChange(() => {
      if (onPage()) load({withCloud: false});
    });
  }
} catch {
  // the page still refreshes on every visit
}
try {
  storage.onExternalChange?.(() => {
    if (onPage()) load({withCloud: false});
  });
} catch {
  // ignore
}
for (const ev of ['online', 'offline']) {
  window.addEventListener(ev, () => {
    if (onPage()) load();
  });
}
