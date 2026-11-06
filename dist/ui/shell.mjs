// App shell for ManageYourStall (ARCHITECTURE.md §10): layout, MYS brand, navigation, stall identity,
// device status, practice-mode bar and the cashier (operator) switcher. Phase 3 (§17.2): "Your stalls" and "Leave this
// stall" (sidebar + cashier sheet) and a small cloud status pill driven by cloud.mjs when the stall is linked.
//
// Layout by width (§16.6): desktop ≥1024px full sidebar · tablet 768–1023px icon rail (brand moves into the topbar) ·
// mobile ≤767px (top brand bar + fixed 6-item bottom nav). The "created by viraj" credit sits under the MYS mark at
// every width. Stall's Collab carries a Neo-Brutalist <sup class="nav-soon"> pill ("COMING SOON"; "SOON" where narrow).
import {
  C, S, store, ui, esc, icon, btn, registerShell, registerActions, openSheet, closeSheet, commitConfig, toast,
  navigate, isAdmin, lockAdmin, render, sheetKind, goPage, leaveCurrentStall, confirmSheet, currentPage,
} from './core.mjs';
import * as cloud from '../cloud.mjs';
import {kitchenQueue} from '../domain.mjs';
import {saveOperators} from '../catalog.mjs';
import {initialsOf} from '../util.mjs';
import {BRAND} from '../constants.mjs';

/**
 * Sidebar / rail navigation, in order. `rail` = label on the tablet icon rail, `short` = label in the phone bottom nav
 * (both default to `label`); `soon` adds the COMING SOON pill.
 * @type {ReadonlyArray<{key: string, label: string, icon: string, rail?: string, short?: string, soon?: boolean}>}
 */
export const NAV = Object.freeze([
  {key: 'sell', label: 'Sell', icon: 'sell'},
  {key: 'orders', label: 'Orders', icon: 'orders'},
  {key: 'dashboard', label: 'Dashboard', short: 'Stats', icon: 'dashboard'},
  {key: 'money', label: 'Expenses', icon: 'wallet'},
  {key: 'milestones', label: 'Milestones', icon: 'trophy'},
  {key: 'menu', label: 'Menu', icon: 'menu'},
  {key: 'studio', label: 'Studio', icon: 'studio'},
  {key: 'collab', label: 'Stall’s Collab', rail: 'Collab', short: 'Collab', icon: 'users', soon: true},
  {key: 'more', label: 'More', icon: 'more'},
]);

/** Phone bottom navigation (≤767px), 6 items in this order. */
export const MOBILE_NAV = Object.freeze(['sell', 'orders', 'dashboard', 'collab', 'menu', 'more']);

/** Screens that light up a nav item other than their own key. */
const NAV_PARENT = {games: 'more'};

const fmtEventDate = (/** @type {string} */ d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const at = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'}).format(at);
};

/** 'Diwali Celebration · Baderia Global Institute · Jabalpur · 4 Nov 2026' (blank parts skipped). */
export function eventLine() {
  const p = C().profile;
  return [p.eventName, p.venue, p.city, fmtEventDate(p.eventDate)].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
}

/** Avatar text: profile initials, else derived from the owner name. */
export const avatarText = () => (C().profile.initials || initialsOf(C().profile.ownerName || C().profile.stallName)).slice(0, 3);

/** Kitchen queue size (preparing + ready) for the Orders badge. */
function queueCount() {
  try {
    const q = kitchenQueue(S());
    return q.preparing.length + q.ready.length;
  } catch {
    return 0;
  }
}

/**
 * The MYS brand block: sticker mark + wordmark + permanent credit badge (never editable).
 * @param {string} [cls]
 */
export function brandBlock(cls = '') {
  return `<div class="brand${cls ? ' ' + cls : ''}">
    <span class="brand-mark" title="${BRAND.name}">${BRAND.short}</span>
    <span class="brand-word">${BRAND.name}</span>
    <span class="credit-badge">${BRAND.credit}</span>
  </div>`;
}

/** @param {boolean} mobile */
function nav(mobile) {
  const active = NAV_PARENT[ui.screen] || ui.screen;
  const count = queueCount();
  const items = mobile ? MOBILE_NAV.map(k => NAV.find(n => n.key === k)).filter(Boolean) : NAV;
  const buttons = items.map(n => {
    const on = n.key === active;
    const badge = n.key === 'orders' && count > 0 ? `<span class="nav-badge" aria-label="${count} in kitchen queue">${count > 99 ? '99+' : count}</span>` : '';
    // Sidebar: full label, plus the rail label when it differs (CSS shows one of them). Phone: the short label.
    const text = mobile
      ? `<span class="nav-text">${n.short || n.label}</span>`
      : `<span class="nav-text${n.rail ? ' nav-text-full' : ''}">${n.label}</span>${n.rail ? `<span class="nav-text nav-text-rail">${n.rail}</span>` : ''}`;
    const soon = n.soon ? `<sup class="nav-soon"><span class="nav-soon-long">COMING </span>SOON</sup>` : '';
    const name = n.soon ? `${n.label} — coming soon` : n.label;
    return `<button type="button" class="nav-button${on ? ' active' : ''}${n.soon ? ' has-soon' : ''}" data-action="nav" data-screen="${n.key}"${on ? ' aria-current="page"' : ''} title="${name}"><span class="nav-icon">${icon(n.icon)}${badge}</span><span class="nav-label">${text}${soon}</span></button>`;
  }).join('');
  return `<nav class="${mobile ? 'bottom-nav' : 'side-nav'}" aria-label="${mobile ? 'Bottom' : 'Main'} navigation">${buttons}</nav>`;
}

/** Line icons the shared set doesn't have (same markup as icons.mjs). @param {string} d */
const lineIcon = d =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const CLOUD_ICON = lineIcon('M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 11.4 3.8 3.8 0 0 0 7 19Z');
const LEAVE_ICON = lineIcon('M10 4H5v16h5M14 8l4 4-4 4M18 12H9');

/** Styles for the Phase-3 shell bits (kept with their markup; base.css is shared). */
const SHELL_CSS = `
.shell-stall-links { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-1); }
.shell-stall-links button { min-height: 44px; justify-content: center; gap: calc(var(--sp-1) / 2); padding: calc(var(--sp-1) / 2) var(--sp-1);
  font-size: 12px; white-space: nowrap; }
.shell-stall-links button .icon { width: 16px; height: 16px; }
button.nav-button.shell-rail-stalls { display: none; }
.cloud-slot { display: contents; }
button.cloud-pill { min-height: 34px; padding: calc(var(--sp-1) / 2) var(--sp-2) calc(var(--sp-1) / 2) var(--sp-1); border: var(--line);
  border-radius: var(--r-pill); box-shadow: var(--shadow-sm); color: var(--ink); font-size: 12px; font-weight: 900; letter-spacing: 0.06em;
  text-transform: uppercase; }
button.cloud-pill.tone-ok { background: var(--mint); }
button.cloud-pill.tone-busy { background: var(--sky); }
button.cloud-pill.tone-wait { background: var(--yellow); }
button.cloud-pill.tone-off { background: var(--orange); }
button.cloud-pill.tone-bad { background: var(--coral); }
button.cloud-pill.tone-busy .icon { animation: shell-cloud-bob 1s ease-in-out infinite; }
@keyframes shell-cloud-bob { 50% { transform: translateY(-2px); } }
.shell-sheet-stall { display: grid; gap: var(--sp-1); }
.shell-sheet-stall .row button { min-height: 44px; }
@media (max-width: 1023px) {
  .shell-stall-links { display: none; }
  button.nav-button.shell-rail-stalls { display: flex; margin-top: auto; }
  /* Tablet & phone: icon-only cloud pill (label in title/aria-label) so the stall title keeps its room. */
  button.cloud-pill { min-width: 44px; min-height: 44px; justify-content: center; padding: calc(var(--sp-1) / 2); }
  button.cloud-pill .status-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
@media (max-width: 767px) {
  /* A linked stall's cloud pill already says when the phone is offline: drop the second pill on phones. */
  .top-right:has(.cloud-pill) > .status-pill:not(.cloud-pill) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  button.cloud-pill.tone-busy .icon { animation: none; }
}`;

if (typeof document !== 'undefined' && !document.getElementById('shell-phase3-css')) {
  const style = document.createElement('style');
  style.id = 'shell-phase3-css';
  style.textContent = SHELL_CSS;
  document.head.append(style);
}

const CLOUD_TONES = /** @type {Record<string, string>} */ ({
  synced: 'tone-ok', syncing: 'tone-busy', pending: 'tone-wait', login: 'tone-wait', local: 'tone-wait', offline: 'tone-off',
  conflict: 'tone-bad', error: 'tone-bad',
});

/**
 * The open stall's cloud sync status (cloud.mjs, feature-detected), or null when it isn't linked.
 * @returns {null | {status: string, label: string, detail?: string}}
 */
export function cloudStatus() {
  const id = store.stallId;
  const syncState = /** @type {any} */ (cloud).syncState;
  if (!id || typeof syncState !== 'function') return null;
  try {
    let s = syncState(id);
    const entry = store.meta?.stalls?.find((/** @type {any} */ e) => e.id === id);
    if ((!s || !s.linked) && entry?.cloud) s = syncState(entry);
    if (!s || (typeof s === 'object' && !s.linked)) return null;
    if (typeof s === 'string') return {status: s, label: s, detail: ''};
    return s;
  } catch {
    return null;
  }
}

/** Small cloud pill (Synced ✓ / Syncing… / Offline – will sync / Needs attention); tap → Your stalls. */
function cloudPill() {
  const s = cloudStatus();
  if (!s) return '';
  const label = String(s.label || 'Saved on device');
  const tone = CLOUD_TONES[String(s.status)] || 'tone-wait';
  const title = [label, s.detail].filter(Boolean).join(' — ');
  return `<button type="button" class="status-pill cloud-pill ${tone}" data-action="your-stalls" data-cloud="${esc(String(s.status))}" title="${esc(title)}" aria-label="Cloud: ${esc(label)}. Open Your stalls">${CLOUD_ICON}<span class="status-text">${esc(label)}</span></button>`;
}

/** Re-draw only the cloud pill (sync status changes often; a full render would disturb the counter). */
function refreshCloudPill() {
  const slot = document.querySelector('#app .cloud-slot');
  if (slot) slot.innerHTML = cloudPill();
}

if (typeof /** @type {any} */ (cloud).onSyncChange === 'function') {
  /** @type {any} */ (cloud).onSyncChange(() => {
    if (store.state && !currentPage()) refreshCloudPill();
  });
}

function statusPill() {
  const online = navigator.onLine !== false;
  return `<span class="status-pill ${online ? 'online' : 'offline'}" role="status" title="${online ? 'Online' : 'Offline — everything still saves on this device'}">${icon(online ? 'wifi' : 'wifi-off')}<span class="status-text">${online ? 'Online' : 'Offline'}</span></span>`;
}

function demoBar() {
  if (store.state.mode !== 'demo') return '';
  return `<div class="demo-bar" role="note"><span class="demo-chip">PRACTICE</span><span class="demo-text"><span class="demo-text-long">Practice counter · these orders stay separate from your live sales.</span><span class="demo-text-short">Practice orders stay separate from live sales.</span></span>${btn('Back to live', 'more-live', 'small')}</div>`;
}

/** @param {string} screenHtml */
function shell(screenHtml) {
  const p = C().profile;
  const title = [p.stallName, p.booth].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
  const sub = eventLine();
  const mode = store.state.mode === 'demo' ? 'Practice ledger' : 'Live ledger';
  return `${demoBar()}
<div class="app-shell${store.state.mode === 'demo' ? ' is-demo' : ''}">
  <aside class="sidebar" aria-label="Stall">
    ${brandBlock('brand-side')}
    <div class="stall-card">
      <span class="stall-card-icon">${icon('store')}</span>
      <div class="grow"><strong class="stall-card-name">${esc(p.stallName)}</strong>${p.booth ? `<span class="stall-card-booth">${esc(p.booth)}</span>` : ''}</div>
    </div>
    <div class="shell-stall-links">
      ${btn(`${icon('grid')}<span>Your stalls</span>`, 'your-stalls', 'small', 'title="All stalls on this phone"')}
      ${btn(`${LEAVE_ICON}<span>Leave stall</span>`, 'leave-stall', 'small quiet-outline', 'title="Leave this stall (it stays saved here)"')}
    </div>
    ${nav(false)}
    <button type="button" class="nav-button shell-rail-stalls" data-action="your-stalls" title="Your stalls"><span class="nav-icon">${icon('grid')}</span><span class="nav-label"><span class="nav-text">Stalls</span></span></button>
    <div class="side-bottom">
      ${p.tagline || sub ? `<div class="tagline-card">${icon('bolt', 'tagline-icon')}${p.tagline ? `<h3>${esc(p.tagline)}</h3>` : ''}${sub ? `<p>${esc(sub)}</p>` : ''}</div>` : ''}
      <div class="device-status"><span class="device-dot" aria-hidden="true"></span><div><strong>Saved on this device</strong><span>${mode} · works offline</span></div></div>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      ${brandBlock('brand-top')}
      <div class="event-info">
        <div class="event-title">${esc(title)}</div>
        ${sub ? `<div class="event-sub">${esc(sub)}</div>` : ''}
      </div>
      <div class="top-right">
        <span class="cloud-slot">${cloudPill()}</span>
        ${statusPill()}
        <span class="operator-name" title="Cashier on the counter">${icon('user')}<span>${esc(C().operator)}</span></span>
        ${btn(esc(avatarText()), 'operator', 'avatar', `aria-label="Switch cashier (now ${esc(C().operator)})"`)}
      </div>
    </header>
    <main class="main screen-${esc(ui.screen)}" id="main">${screenHtml}</main>
  </div>
</div>
${nav(true)}`;
}

registerShell(shell);

function operatorSheet() {
  const c = C();
  const list = c.operators.map(name => {
    const on = name === c.operator;
    return `<button type="button" class="operator-choice${on ? ' active' : ''}" data-action="save-operator" data-name="${esc(name)}" aria-pressed="${on}"><span class="operator-avatar">${esc(initialsOf(name))}</span><span class="grow">${esc(name)}</span>${on ? `<span class="badge lime">${icon('check')} ON COUNTER</span>` : ''}</button>`;
  }).join('');
  const admin = isAdmin()
    ? btn(`${icon('lock')} Lock admin`, 'lock-admin', 'small')
    : btn(`${icon('unlock')} Unlock admin`, 'unlock-admin', 'small');
  openSheet(
    'Who’s on the counter?',
    `<p class="muted operator-intro">Orders, payments and corrections are stamped with this name. Switching needs no PIN.</p>
    <div class="operator-list" role="group" aria-label="Team">${list}</div>
    <div class="separator"></div>
    <div class="row wrap between operator-tools">
      ${btn(`${icon('users')} Manage team`, 'studio-open', 'small', 'data-section="team"')}
      ${admin}
    </div>
    <div class="separator"></div>
    <div class="shell-sheet-stall">
      <p class="eyebrow">This phone</p>
      <div class="row wrap">
        ${btn(`${icon('grid')} Your stalls`, 'your-stalls', 'small')}
        ${btn(`${LEAVE_ICON} Leave this stall`, 'leave-stall', 'small quiet-outline')}
      </div>
      <p class="footnote">Leaving keeps every sale saved on this phone.</p>
    </div>`,
    btn('Done', 'close', 'primary'),
    'operator',
  );
}

registerActions(
  {
    nav: (_el, ds) => {
      closeSheet();
      navigate(ds.screen || 'sell');
    },
    operator: () => operatorSheet(),
    'save-operator': async (_el, ds) => {
      const name = ds.name || '';
      if (name === C().operator) {
        closeSheet();
        return;
      }
      await commitConfig(st => saveOperators(st.config, {operator: name}));
      closeSheet();
      toast(`${C().operator} is on the counter.`);
    },
    'lock-admin': () => {
      lockAdmin();
      if (sheetKind() === 'operator') operatorSheet();
      render();
      toast('Admin locked. The PIN is needed for the next admin change.');
    },
    'your-stalls': () => {
      closeSheet();
      goPage('stalls');
    },
    'leave-stall': () => {
      if (!store.state) return goPage('welcome');
      const name = C().profile.stallName || 'This stall';
      const linked = !!cloudStatus();
      confirmSheet({
        title: 'Leave this stall?',
        body: `<p><strong>${esc(name)}</strong> stays saved on this phone — every sale, bill and photo. Open it again anytime from <strong>Your stalls</strong>.</p>${linked ? '<p class="muted">Pending changes go to the cloud first when you’re online.</p>' : ''}`,
        confirmLabel: 'Leave stall',
        onConfirm: async () => {
          await leaveCurrentStall();
          toast(`Left ${name}. It’s saved on this phone.`);
        },
      });
      return undefined;
    },
    'unlock-admin': () => {
      if (sheetKind() === 'operator') operatorSheet();
      toast('Admin unlocked for 10 minutes.');
    },
  },
  {admin: ['unlock-admin']},
);
