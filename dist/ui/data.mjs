// Backups, exports, restore and resets for ManageYourStall (ARCHITECTURE.md §13.9). created by viraj
//
// Public actions: data-backups (the "Keep a copy" sheet) · data-export (data-kind: orders | summary | payments | expenses |
// contributions | settlement | json).
// Private: data-danger (danger zone sheet), data-restore, data-reset-orders, data-reset-sales, data-reset-practice, data-factory.
// Everything money-related comes from domain.mjs (CSV rows, backup wrapper/validation, report); this module only moves files.
import {
  store, S, C, ui, esc, money, icon, btn, openSheet, closeSheet, sheetEl, confirmSheet, toast, commit, render,
  navigate, registerActions, registerChanges, download, requireAdmin, lockAdmin, reloadMedia, runAction,
} from './core.mjs';
import {
  ordersCsvRows, orderSummaryCsvRows, paymentsCsvRows, expensesCsvRows, contributionsCsvRows, settlementCsvRows, csv, exportBackup,
  validateBackup, session, initialState, audit, report, refreshMilestones, expenseTotals, referencedMedia,
} from '../domain.mjs';
import {getMediaFor, replaceAll} from '../storage.mjs';
import * as cloud from '../cloud.mjs';
import {istDate, slug} from '../util.mjs';

/** localStorage key for the "last backup" hint (a per-device convenience, never a source of truth). */
const BACKUP_KEY = 'mys-last-backup';
/**
 * Largest restore file we accept. validateBackup allows up to 40 MiB of decoded photos, which is ~54 MB once base64-encoded
 * inside the JSON, so the file cap must sit above that or the app would refuse its own backups.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * CSV exports, by data-kind. Row builders take (session, config); the Phase-1 ones simply ignore the config.
 * @type {Readonly<Record<string, {rows: (s: any, c: any) => string[][], file: string, label: string}>>}
 */
const CSV_KINDS = Object.freeze({
  orders: {rows: ordersCsvRows, file: 'orders', label: 'Itemized orders'},
  summary: {rows: orderSummaryCsvRows, file: 'order-summary', label: 'Order summary'},
  payments: {rows: paymentsCsvRows, file: 'payments', label: 'Payments'},
  expenses: {rows: expensesCsvRows, file: 'expenses', label: 'Bills & expenses'},
  contributions: {rows: contributionsCsvRows, file: 'contributions', label: 'Team contri'},
  settlement: {rows: settlementCsvRows, file: 'settlement', label: 'Team settlement'},
});

/** A validated backup waiting for the owner's confirmation. @type {null | {state: any, media: Record<string, string>, warnings: string[], fileName: string, exportedAt: string}} */
let pendingRestore = null;

// ---------------------------------------------------------------------------------------------------------------------
// Last-backup hint (shared with the More hub)
// ---------------------------------------------------------------------------------------------------------------------

/** ISO time of the last JSON backup downloaded on this device, or null. */
export function lastBackupAt() {
  try {
    const at = localStorage.getItem(BACKUP_KEY);
    return at && !Number.isNaN(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

function noteBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, new Date().toISOString());
  } catch {
    // private mode / blocked storage: the hint just stays empty
  }
}

function forgetBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    // ignore
  }
}

/**
 * Short, human "last backup" line: {text, stale}. stale = never, or older than 3 hours.
 * @returns {{text: string, stale: boolean}}
 */
export function backupHint() {
  const at = lastBackupAt();
  if (!at) return {text: 'No backup downloaded on this device yet', stale: true};
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 60 * 24 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return {text: `Last backup ${ago}`, stale: mins > 180};
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const modeLabel = (/** @type {string} */ mode) => (mode === 'demo' ? 'practice' : 'live');
const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Run fn after the admin PIN; throws when the prompt is cancelled so confirm sheets stay open. @param {() => any} fn */
async function asAdmin(fn) {
  const done = await requireAdmin(async () => {
    await fn();
    return true;
  });
  if (!done) throw Error('The admin PIN is needed for this.');
}

/**
 * A state to hand to replaceAll with a revision above the current one, so "+1 on every committed write" stays true.
 * @param {any} next
 */
const nextRevision = next => ({...next, revision: Math.max(Number(next.revision) || 0, Number(store.state?.revision) || 0) + 1});

/**
 * Money & photo counts for a whole state (both ledgers): bills, contri, saved settlements, and photos (product, hero & bill).
 * @param {any} st
 * @param {Record<string, string> | null} [media] when given, photos = media entries actually in the backup
 */
function backupCounts(st, media = null) {
  const list = (/** @type {any} */ s, /** @type {string} */ key) => (Array.isArray(s?.[key]) ? s[key] : []);
  const both = (/** @type {string} */ key) => [...list(st.live, key), ...list(st.demo, key)];
  const bills = both('expenses').filter((/** @type {any} */ e) => !e.void);
  const billPhotos = both('expenses').filter((/** @type {any} */ e) => typeof e.billImage === 'string' && e.billImage.startsWith('media:')).length;
  let photos = 0;
  try {
    photos = media ? Object.keys(media).length : referencedMedia(st).size;
  } catch {
    photos = 0;
  }
  let liveBills = 0;
  try {
    liveBills = expenseTotals(st.live).total;
  } catch {
    liveBills = 0;
  }
  return {
    bills: bills.length,
    liveBills,
    billPhotos,
    contri: both('contributions').filter((/** @type {any} */ x) => !x.void).length,
    settlements: both('settlements').length,
    photos,
  };
}

/** Four count chips: bills · contri · settlements · photos. @param {ReturnType<typeof backupCounts>} n */
const countStrip = n => `<div class="data-counts" data-backup-counts>
    <span class="data-count"><strong>${n.bills}</strong><small>${n.bills === 1 ? 'Bill' : 'Bills'}</small></span>
    <span class="data-count"><strong>${n.contri}</strong><small>Team contri</small></span>
    <span class="data-count"><strong>${n.settlements}</strong><small>${n.settlements === 1 ? 'Settlement' : 'Settlements'}</small></span>
    <span class="data-count"><strong>${n.photos}</strong><small>${n.photos === 1 ? 'Photo' : 'Photos'}</small></span>
  </div>`;

/** "Download a backup first" button for danger confirmations. */
const backupFirst = () =>
  `<div class="data-backup-first">${icon('download')}<div class="grow"><strong>Download a backup first</strong><small>One tap. Saves both ledgers, menu & photos.</small></div>${btn('Backup', 'data-export', 'small yellow', 'data-kind="json"')}</div>`;

// ---------------------------------------------------------------------------------------------------------------------
// Backups sheet
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} kind @param {string} iconName @param {string} title @param {string} sub @param {string} [cls] */
const exportButton = (kind, iconName, title, sub, cls = '') =>
  `<button type="button" class="data-export-btn${cls ? ' ' + cls : ''}" data-action="data-export" data-kind="${kind}"><span class="data-export-icon">${icon(iconName)}</span><span class="grow"><strong>${title}</strong><small>${sub}</small></span>${icon('download', 'data-export-arrow')}</button>`;

/** The open stall's index entry when it is linked to the cloud, else null. */
function linkedEntry() {
  const entry = store.meta?.stalls?.find(/** @param {any} e */ e => e.id === store.stallId);
  return entry?.cloud ? entry : null;
}

/** A restore replaced the open stall outside commit(): queue a cloud push for a linked stall (never throws). */
function syncAfterReplace() {
  if (!linkedEntry() || !store.stallId) return;
  Promise.resolve()
    .then(() => cloud.markDirty(String(store.stallId)))
    .catch(err => console.warn(err));
}

function backupsSheet() {
  const st = store.state;
  const mode = modeLabel(st.mode);
  const hint = backupHint();
  const counts = backupCounts(st);
  const body = `
  <div class="data-hero">
    <span class="data-hero-icon">${icon('phone')}</span>
    <div class="grow">
      ${linkedEntry()
        ? `<strong>Saved on this phone + in your MYS account.</strong>
      <p>The cloud copy syncs whenever there’s internet. A backup file after every rush is still a smart extra copy.</p>`
        : `<strong>Your sales live only on this phone.</strong>
      <p>Not in the cloud yet — save it from <b>Your stalls</b>, or download a backup after every rush and send it to yourself. Clearing browser data or losing the phone wipes the stall.</p>`}
      <span class="badge ${hint.stale ? 'coral' : 'lime'}" data-backup-hint>${icon(hint.stale ? 'alert' : 'check')} ${esc(hint.text)}</span>
    </div>
  </div>
  <div class="data-grid">
    <section class="data-col" aria-labelledby="data-json-title">
      <h3 class="data-col-title" id="data-json-title">${icon('box')} Full backup</h3>
      ${exportButton('json', 'download', 'Download full backup (.json)', 'Both ledgers, menu, settings, bills, team & every photo', 'data-export-main')}
      ${countStrip(counts)}
      <h3 class="data-col-title" id="data-csv-title">${icon('list')} Sales spreadsheets · ${mode} ledger</h3>
      <div class="data-export-list">
        ${exportButton('orders', 'orders', 'Itemized orders CSV', 'One row per item sold')}
        ${exportButton('summary', 'receipt', 'Order summary CSV', 'One row per order, with net collected')}
        ${exportButton('payments', 'wallet', 'Payments CSV', 'Every payment & refund (the money ledger)')}
      </div>
      <h3 class="data-col-title" id="data-money-title">${icon('users')} Bills & team · ${mode} ledger</h3>
      <div class="data-export-list">
        ${exportButton('expenses', 'receipt', 'Bills & expenses CSV', 'Every bill: category, who paid, Cash/UPI, notes')}
        ${exportButton('contributions', 'users', 'Team contri CSV', 'Money each partner put into the pool')}
        ${exportButton('settlement', 'split', 'Team settlement CSV', 'Capital back + profit share per partner')}
      </div>
      <p class="footnote">Itemized rows repeat order totals — add up money with the summary CSV. Opens in Excel or Google Sheets. The settlement is a fair-split calculator, not tax advice.</p>
    </section>
    <section class="data-col" aria-labelledby="data-restore-title">
      <h3 class="data-col-title" id="data-restore-title">${icon('upload')} Restore a backup</h3>
      <p class="data-note">Moving phones or recovering? Pick a ManageYourStall <b>.json</b> backup. We check it fully before anything changes.</p>
      <label class="data-file" for="data-restore-file">
        ${icon('upload')}<span><strong>Choose backup file</strong><small>.json · up to 64 MB</small></span>
        <input class="sr-only" type="file" id="data-restore-file" accept="application/json,.json" data-change="data-restore-file">
      </label>
      <div class="data-restore-summary" data-restore-summary hidden></div>
      <div class="data-danger-link">
        <div class="grow"><strong>Danger zone</strong><small>Reset orders, practice ledger or the whole stall</small></div>
        ${btn(`${icon('alert')} Open`, 'data-danger', 'small danger')}
      </div>
    </section>
  </div>`;
  pendingRestore = null;
  openSheet('Keep a copy. Keep it safe.', body, btn('Done', 'close', 'quiet-outline'), 'data-backups', {wide: true});
}

/** Refresh the hint badge inside an open backups sheet. */
function refreshHintBadge() {
  const badge = sheetEl()?.querySelector('[data-backup-hint]');
  if (!badge) return;
  const hint = backupHint();
  badge.className = `badge ${hint.stale ? 'coral' : 'lime'}`;
  badge.innerHTML = `${icon(hint.stale ? 'alert' : 'check')} ${esc(hint.text)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} kind */
async function exportData(kind) {
  const st = store.state;
  const name = slug(C().profile.stallName);
  const day = istDate();
  if (kind === 'json') {
    const media = await getMediaFor(st); // only this stall's photos, never another stall's
    const backup = exportBackup(st, media);
    download(`mys-backup-${name}-${day}.json`, JSON.stringify(backup), 'application/json');
    noteBackup();
    refreshHintBadge();
    if (ui.screen === 'more') render();
    const n = backupCounts(st, media);
    const extras = [n.bills ? plural(n.bills, 'bill') : '', n.photos ? plural(n.photos, 'photo') : ''].filter(Boolean).join(', ');
    toast(`Backup saved: ${plural(st.live.orders.length, 'live order')}${extras ? `, ${extras}` : ''}. Send it to yourself on WhatsApp.`);
    return;
  }
  const spec = CSV_KINDS[/** @type {keyof typeof CSV_KINDS} */ (kind)];
  if (!spec) throw Error('Pick orders, summary, payments, bills, contri, settlement or a full backup.');
  const rows = spec.rows(S(), C());
  const suffix = st.mode === 'demo' ? '-practice' : '';
  download(`mys-${spec.file}-${name}${suffix}-${day}.csv`, csv(rows), 'text/csv;charset=utf-8');
  toast(rows.length > 1 ? `${spec.label} CSV downloaded (${modeLabel(st.mode)} ledger).` : `${spec.label} CSV downloaded — just headers, no records yet.`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------------------------------------------------

/** @param {NonNullable<typeof pendingRestore>} p */
function restoreSummary(p) {
  const s = p.state;
  const p1 = s.config.profile;
  const live = report(s.live, s.config);
  const n = backupCounts(s, p.media);
  const when = p.exportedAt ? ` · saved ${esc(new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}).format(new Date(p.exportedAt)))}` : '';
  const warnings = p.warnings.length
    ? `<div class="notice">${icon('alert')}<div><strong>Heads up</strong><ul class="data-warnings">${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`
    : '';
  return `<div class="data-summary-card">
    <span class="badge lime">${icon('check')} Backup looks good</span>
    <h4 class="data-summary-name">${esc(p1.stallName)}</h4>
    <p class="data-summary-meta">${esc([p1.booth, p1.eventName].filter(Boolean).join(' · '))}${when}</p>
    <div class="receipt-line"><span>Live orders</span><strong>${s.live.orders.length}</strong></div>
    <div class="receipt-line"><span>Live collected</span><strong>${money(live.collected)}</strong></div>
    <div class="receipt-line"><span>Practice orders</span><strong>${s.demo.orders.length}</strong></div>
    <div class="receipt-line"><span>Live bills</span><strong>${money(n.liveBills)}</strong></div>
    <div class="receipt-line"><span>Menu items</span><strong>${s.config.products.length}</strong></div>
    ${countStrip(n)}
    ${n.billPhotos ? `<p class="data-summary-meta">${icon('image')} ${plural(n.billPhotos, 'bill photo')} included</p>` : ''}
  </div>
  ${warnings}
  <p class="data-note">Restoring <b>replaces everything on this device</b> — both ledgers, bills & team contri, menu, settings, photos and the admin PIN.</p>
  ${btn(`${icon('upload')} Restore this backup`, 'data-restore', 'danger block')}`;
}

/** @param {HTMLInputElement} el */
async function pickRestoreFile(el) {
  pendingRestore = null;
  const sheet = sheetEl();
  const box = /** @type {HTMLElement|null} */ (sheet?.querySelector('[data-restore-summary]'));
  const slot = /** @type {HTMLElement|null} */ (sheet?.querySelector('[data-error]'));
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  if (slot) {
    slot.hidden = true;
    slot.textContent = '';
  }
  const file = el.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw Error('That file is bigger than 64 MB, so it can’t be a ManageYourStall backup.');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw Error('That file isn’t a ManageYourStall backup (it isn’t readable JSON). Pick the .json file you downloaded.');
    }
    const result = validateBackup(data);
    const exportedAt = data && typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : '';
    pendingRestore = {...result, fileName: file.name, exportedAt};
    if (box) {
      box.innerHTML = restoreSummary(pendingRestore);
      box.hidden = false;
      const scroller = sheet?.querySelector('.sheet-body');
      if (scroller) scroller.scrollTop += box.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    }
  } catch (err) {
    el.value = '';
    throw err;
  }
}

function confirmRestore() {
  const p = pendingRestore;
  if (!p) throw Error('Choose a backup file first.');
  const st = store.state;
  const nowLive = report(st.live, st.config);
  const next = report(p.state.live, p.state.config);
  confirmSheet({
    title: 'Replace this device’s stall?',
    body: `<div class="notice danger">${icon('alert')}<div><strong>Now on this device:</strong> ${esc(st.config.profile.stallName)} · ${plural(st.live.orders.length, 'live order')} · ${money(nowLive.collected)}<br><strong>From the backup:</strong> ${esc(p.state.config.profile.stallName)} · ${plural(p.state.live.orders.length, 'live order')} · ${money(next.collected)} · ${plural(backupCounts(p.state, p.media).bills, 'bill')}</div></div>
      <p>The current data is replaced completely. Admin locks afterwards — use the PIN from the backup.</p>
      ${backupFirst()}`,
    confirmLabel: 'Restore backup',
    danger: true,
    onConfirm: async () => {
      const chosen = pendingRestore;
      if (!chosen) throw Error('Choose a backup file first.');
      await asAdmin(async () => {
        store.state = await replaceAll(nextRevision(chosen.state), chosen.media);
      });
      pendingRestore = null;
      lockAdmin();
      syncAfterReplace();
      await reloadMedia().catch(() => {});
      closeSheet();
      render();
      toast(`Backup restored: ${plural(store.state.live.orders.length, 'live order')} · ${money(report(store.state.live, C()).collected)} collected.`);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------------------------------------------------

function dangerSheet() {
  const st = store.state;
  const mode = modeLabel(st.mode);
  const cur = S();
  const r = report(cur, C());
  const nb = (Array.isArray(cur.expenses) ? cur.expenses : []).filter((/** @type {any} */ e) => !e.void).length;
  const nc = (Array.isArray(cur.contributions) ? cur.contributions : []).filter((/** @type {any} */ x) => !x.void).length;
  const body = `
  <div class="notice danger">${icon('alert')}<div><strong>No undo here.</strong> These wipe records from this device for good. Grab a backup first — it takes one tap.</div></div>
  ${backupFirst()}
  <div class="data-danger-list">
    <div class="data-danger-row">
      <div class="grow"><h3>Reset sales only <span class="data-keep">keeps bills & team contri</span></h3><small>Clears the <b>${mode}</b> sales: ${plural(cur.orders.length, 'order')} · ${money(r.collected)} collected, payments, games & tokens. ${plural(nb, 'bill')}, ${plural(nc, 'contri entry', 'contri entries')} & saved settlements stay.</small></div>
      ${btn(`${icon('reset')} Reset sales`, 'data-reset-sales', 'small')}
    </div>
    <div class="data-danger-row">
      <div class="grow"><h3>Reset today’s orders</h3><small>Wipes the whole <b>${mode}</b> session: ${plural(cur.orders.length, 'order')} · ${money(r.collected)} collected, games, <b>bills & team contri</b>. Menu, setup, the PIN and the ${mode === 'live' ? 'practice' : 'live'} ledger stay.</small></div>
      ${btn(`${icon('reset')} Reset orders`, 'data-reset-orders', 'small danger')}
    </div>
    <div class="data-danger-row">
      <div class="grow"><h3>Reset practice ledger</h3><small>Clears ${plural(st.demo.orders.length, 'practice order')}. Live sales are untouched.</small></div>
      ${btn(`${icon('reset')} Reset practice`, 'data-reset-practice', 'small')}
    </div>
    <div class="data-danger-row is-nuclear">
      <div class="grow"><h3>Factory reset entire stall</h3><small>Wipes both ledgers, menu, photos, settings and the PIN. Setup starts fresh.</small></div>
      ${btn(`${icon('trash')} Factory reset`, 'data-factory', 'small danger')}
    </div>
  </div>`;
  openSheet('Danger zone', body, btn('Back to backups', 'data-backups', 'quiet-outline') + btn('Done', 'close', 'quiet-outline'), 'data-danger');
}

function resetOrders() {
  const st = store.state;
  const mode = st.mode;
  const label = modeLabel(mode);
  const billCount = (st[mode].expenses || []).filter((/** @type {any} */ e) => !e.void).length;
  const contriCount = (st[mode].contributions || []).filter((/** @type {any} */ x) => !x.void).length;
  confirmSheet({
    title: 'Reset today’s orders?',
    body: `<p>This wipes the whole <b>${label} session</b>: <b>${plural(st[mode].orders.length, 'order')}</b>, payments, game plays,
      <b>${plural(billCount, 'bill')}, ${plural(contriCount, 'team contri entry', 'team contri entries')} and saved settlements</b>.</p>
      <p>Only want fresh sales? Use <b>Reset sales only</b> — it keeps bills & contri.</p>
      <p>Your menu, prices, stall setup, PIN and the ${label === 'live' ? 'practice' : 'live'} ledger stay exactly as they are.</p>
      ${backupFirst()}`,
    confirmLabel: 'Reset orders',
    danger: true,
    typed: 'RESET ORDERS',
    onConfirm: async () => {
      await asAdmin(() =>
        commit(s => {
          // Reset the ledger this sheet described, even if another tab switched modes meanwhile.
          const old = s[mode];
          const details = {orders: old.orders.length, collected: report(old, s.config).collected};
          const fresh = session();
          // "Keep menu & setup": an event that was started stays started.
          fresh.started = old.started;
          s[mode] = fresh;
          audit(fresh, 'orders-reset', mode, s.config.operator, details);
          refreshMilestones(fresh, s.config);
        }),
      );
      closeSheet();
      toast(`Fresh start! The ${label} ledger is empty — menu & setup kept.`);
    },
  });
}

function resetSales() {
  const st = store.state;
  const mode = st.mode;
  const label = modeLabel(mode);
  const cur = st[mode];
  const billCount = (cur.expenses || []).filter((/** @type {any} */ e) => !e.void).length;
  const contriCount = (cur.contributions || []).filter((/** @type {any} */ x) => !x.void).length;
  confirmSheet({
    title: 'Reset sales only?',
    body: `<p>This clears <b>${plural(cur.orders.length, 'order')}</b>, payments, game plays, kitchen tokens, the cart and milestone unlocks from the <b>${label} ledger</b>.</p>
      <div class="notice mint">${icon('check')}<div><strong>Kept:</strong> ${plural(billCount, 'bill')} (with photos), ${plural(contriCount, 'team contri entry', 'team contri entries')}, saved settlements and the audit trail. Break-even still counts every bill.</div></div>
      ${backupFirst()}`,
    confirmLabel: 'Reset sales',
    danger: true,
    typed: 'RESET SALES',
    onConfirm: async () => {
      await asAdmin(() =>
        commit(s => {
          // Reset the ledger this sheet described, even if another tab switched modes meanwhile.
          const old = s[mode];
          const details = {orders: old.orders.length, collected: report(old, s.config).collected, keptBills: (old.expenses || []).length};
          const fresh = session();
          fresh.started = old.started;
          // Money that went INTO the stall stays: bills, contri, settlement snapshots and the audit trail.
          fresh.expenses = old.expenses || [];
          fresh.contributions = old.contributions || [];
          fresh.settlements = old.settlements || [];
          fresh.audit = old.audit || [];
          s[mode] = fresh;
          audit(fresh, 'sales-reset', mode, s.config.operator, details);
          refreshMilestones(fresh, s.config);
        }),
      );
      closeSheet();
      toast(`Sales cleared in the ${label} ledger — bills & team contri kept.`);
    },
  });
}

function resetPractice() {
  confirmSheet({
    title: 'Reset practice ledger?',
    body: `<p>This clears <b>${plural(store.state.demo.orders.length, 'practice order')}</b> and every practice payment, game, bill and contri entry.</p><p>Live sales are not touched.</p>`,
    confirmLabel: 'Reset practice',
    danger: true,
    typed: 'RESET PRACTICE',
    onConfirm: async () => {
      await asAdmin(() =>
        commit(s => {
          const old = s.demo;
          const fresh = session();
          fresh.started = old.started;
          s.demo = fresh;
          audit(fresh, 'practice-reset', 'demo', s.config.operator, {orders: old.orders.length});
          refreshMilestones(fresh, s.config);
        }),
      );
      closeSheet();
      toast('Practice ledger cleared. Live sales untouched.');
    },
  });
}

function factoryReset() {
  const st = store.state;
  confirmSheet({
    title: 'Factory reset entire stall?',
    body: `<div class="notice danger">${icon('alert')}<div>Everything on this device goes: <b>${plural(st.live.orders.length, 'live order')}</b>, ${plural(st.demo.orders.length, 'practice order')}, the menu, photos, stall profile, team and the admin PIN.</div></div>
      ${linkedEntry() ? '<p>The cloud copy stays safe in your MYS account — this phone just stops syncing to it. Download it again anytime from <b>Your stalls</b>.</p>' : ''}
      ${backupFirst()}`,
    confirmLabel: 'Wipe everything',
    danger: true,
    typed: 'FACTORY RESET',
    onConfirm: async () => {
      const linked = linkedEntry();
      await asAdmin(async () => {
        store.state = await replaceAll(nextRevision(initialState()), {});
      });
      // A wiped stall must never overwrite the cloud copy: forget the link on this phone (the account keeps the stall).
      if (linked) await Promise.resolve(cloud.unlinkStall(linked.id)).catch(err => console.warn(err));
      pendingRestore = null;
      lockAdmin();
      forgetBackup();
      await reloadMedia().catch(() => {});
      closeSheet();
      navigate('sell');
      toast('Factory reset done. A brand-new stall is ready.');
      await runAction('onb-open');
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------------

registerActions(
  {
    'data-backups': () => backupsSheet(),
    'data-export': (_el, ds) => exportData(ds.kind || 'json'),
    'data-danger': () => dangerSheet(),
    'data-restore': () => confirmRestore(),
    'data-reset-orders': () => resetOrders(),
    'data-reset-sales': () => resetSales(),
    'data-reset-practice': () => resetPractice(),
    'data-factory': () => factoryReset(),
  },
  {admin: ['data-restore', 'data-reset-orders', 'data-reset-sales', 'data-reset-practice', 'data-factory']},
);

registerChanges({
  'data-restore-file': el => pickRestoreFile(el),
});
