// App shell for ManageYourStall (ARCHITECTURE.md §10): layout, MYS brand, navigation, stall identity,
// device status, practice-mode bar and the cashier (operator) switcher.
//
// Layout by width (§16.6): desktop ≥1024px full sidebar · tablet 768–1023px icon rail (brand moves into the topbar) ·
// mobile ≤767px (top brand bar + fixed 6-item bottom nav). The "created by viraj" credit sits under the MYS mark at
// every width. Stall's Collab carries a Neo-Brutalist <sup class="nav-soon"> pill ("COMING SOON"; "SOON" where narrow).
import {
  C, S, store, ui, esc, icon, btn, registerShell, registerActions, openSheet, closeSheet, commitConfig, toast,
  navigate, isAdmin, lockAdmin, render, sheetKind,
} from './core.mjs';
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
    ${nav(false)}
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
    'unlock-admin': () => {
      if (sheetKind() === 'operator') operatorSheet();
      toast('Admin unlocked for 10 minutes.');
    },
  },
  {admin: ['unlock-admin']},
);
