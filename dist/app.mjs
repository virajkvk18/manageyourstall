// ManageYourStall (MYS) bootstrap — created by viraj.
// Imports the UI kernel, the shell and every feature module (each registers its screens and actions on import),
// then boots: open storage → load images → first render → boot hooks → offline service worker.
import {store, render, runBoot, reloadMedia, registerServiceWorker, esc} from './ui/core.mjs';
import './ui/shell.mjs';
import './ui/sell.mjs';
import './ui/checkout.mjs';
import './ui/orders.mjs';
import './ui/dashboard.mjs';
import './ui/milestones.mjs';
import './ui/menu.mjs';
import './ui/picker.mjs';
import './ui/studio.mjs';
import './ui/onboarding.mjs';
import './ui/more.mjs';
import './ui/games.mjs';
import './ui/data.mjs';
import './ui/money.mjs';
import './ui/collab.mjs';
import {init, pruneMedia} from './storage.mjs';

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

async function boot() {
  if (typeof indexedDB === 'undefined') throw Error('IndexedDB is not available.');
  store.state = await init();
  await reloadMedia().catch(err => console.warn('Images could not be loaded', err));
  pruneMedia().catch(err => console.warn('Image cleanup skipped', err));
  render();
  await runBoot();
  document.documentElement.dataset.booted = '1'; // boot hooks finished (browser tests wait for this)
}

boot()
  .then(() => registerServiceWorker())
  .catch(bootError);
