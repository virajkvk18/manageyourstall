// ManageYourStall (MYS) bootstrap — created by viraj.
// Imports the UI kernel, the shell and every feature module (each registers its screens and actions on import),
// then boots: open storage (stalls index + the open stall, §17.1) → load images → first render (the stall shell, or a
// full-screen page such as #/welcome when no stall is open, §17.2) → boot hooks → cloud sync → offline service worker.
import {store, ui, render, runBoot, reloadMedia, registerServiceWorker, esc, onStallChange, currentPage} from './ui/core.mjs';
import './ui/shell.mjs';
import './ui/sell.mjs';
import './ui/checkout.mjs';
import './ui/orders.mjs';
import './ui/dashboard.mjs';
import './ui/milestones.mjs';
import './ui/menu.mjs';
import './ui/picker.mjs';
import {resetStudioDrafts} from './ui/studio.mjs';
import {openOnboarding} from './ui/onboarding.mjs';
import './ui/more.mjs';
import './ui/games.mjs';
import './ui/data.mjs';
import './ui/money.mjs';
import './ui/collab.mjs';
import './ui/landing.mjs';
import './ui/setup.mjs';
import './ui/stalls.mjs';
import './ui/account.mjs';
import {init, pruneMedia} from './storage.mjs';
import * as cloud from './cloud.mjs';

/** Branded fallback when this browser cannot store orders safely. @param {unknown} err */
function bootError(err) {
  console.error(err);
  const app = document.getElementById('app');
  if (!app) return;
  const detail = err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : '';
  app.innerHTML = `<div class="boot boot-error" role="alert">
    <span class="boot-mark">MYS</span>
    <span class="credit-badge">created by viraj</span>
    <h1>Storage needs attention.</h1>
    <p>ManageYourStall can't save orders in this browser right now, so it won't open the counter.</p>
    <p>Use a regular (not private) Chrome, Edge or Safari window with site data allowed, then reload.</p>
    ${detail ? `<p class="footnote">${esc(detail)}</p>` : ''}
    <button type="button" class="primary" data-boot-reload>Reload</button>
  </div>`;
  app.querySelector('[data-boot-reload]')?.addEventListener('click', () => location.reload());
}

/** Per-stall transient state that must not leak into another stall, and first-run onboarding for a fresh stall. */
onStallChange(({state}) => {
  try {
    resetStudioDrafts();
  } catch (err) {
    console.warn(err);
  }
  if (state && !state.onboarded && !currentPage()) openOnboarding();
});

async function boot() {
  if (typeof indexedDB === 'undefined') throw Error('IndexedDB is not available.');
  const {meta, state} = await init();
  store.meta = meta;
  store.state = state;
  store.stallId = state ? meta.activeStallId : null;
  if (!state) ui.screen = '';
  await reloadMedia().catch(err => console.warn('Images could not be loaded', err));
  pruneMedia().catch(err => console.warn('Image cleanup skipped', err));
  render();
  await runBoot();
  document.documentElement.dataset.booted = '1'; // boot hooks finished (browser tests wait for this)
  const sync = /** @type {any} */ (cloud).startSync;
  if (typeof sync === 'function') Promise.resolve(sync()).catch(err => console.warn('Cloud sync is off', err));
}

boot()
  .then(() => registerServiceWorker())
  .catch(bootError);
