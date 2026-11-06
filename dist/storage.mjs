// IndexedDB adapter for ManageYourStall (ARCHITECTURE.md §8, multi-stall §17.1).
//
// One database, two object stores:
//   state  key 'meta'            → StallsMeta { version: 1, activeStallId, stalls: StallEntry[] }
//          key 'root'            → the legacy (v1 / Phase-1) stall's State — kept at this key forever so an old cached
//                                  tab and the new app always share the same data
//          key 'stall:<uuid>'    → every other stall's State (schema v2, migrated on every read/write)
//   media  key = media id        → { id, data: dataURL, bytes, at }   (shared by all stalls; pruned across all of them)
//
// The database keeps its legacy v1 name so devices that ran the original single-stall app keep their sales.
// Every operation is one strict-durability transaction; nothing is persisted unless the whole transaction commits.
// mutate / read / replaceAll work on the ACTIVE stall (and throw when no stall is open).
import {initialState, migrate, referencedMedia} from './domain.mjs';
import {ID_RE} from './constants.mjs';
import {uuid} from './util.mjs';

export const DB_NAME = 'packet-pataka-v1';
export const DB_VERSION = 2;
export const CHANNEL_NAME = 'mys-ledger';
/** Largest accepted decoded image (1.5 MiB). */
export const MAX_MEDIA_BYTES = 1572864;
/** Key of the stalls index in the 'state' store. */
export const META_KEY = 'meta';
/** Id and key of the legacy stall. */
export const ROOT = 'root';
/** Entry name given to an unlisted legacy stall found next to an existing index (an old cached tab created it). */
export const RECOVERED_NAME = 'Recovered stall';

const STATE = 'state';
const MEDIA = 'media';
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const NO_STALL = 'No stall is open on this device. Pick one from Your stalls.';

/** @type {IDBDatabase | null} */
let db = null;
/** @type {Promise<IDBDatabase> | null} */
let opening = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

/**
 * Open (or reuse) the database. Creates any missing object store on upgrade — a v1 database only has 'state'.
 * Another tab asking for a newer version makes this connection close itself; the next call reopens.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const upgrade = req.result;
      if (!upgrade.objectStoreNames.contains(STATE)) upgrade.createObjectStore(STATE);
      if (!upgrade.objectStoreNames.contains(MEDIA)) upgrade.createObjectStore(MEDIA);
    };
    req.onerror = () => reject(req.error || Error('Could not open the stall database.'));
    req.onblocked = () => console.warn('ManageYourStall is waiting for another tab to release the database.');
    req.onsuccess = () => {
      const conn = req.result;
      conn.onversionchange = () => {
        conn.close();
        if (db === conn) db = null;
      };
      conn.onclose = () => {
        if (db === conn) db = null;
      };
      db = conn;
      resolve(conn);
    };
  }).finally(() => {
    opening = null;
  });
  return opening;
}

/** Close the connection (tests use this to simulate a fresh page load). */
export function closeDB() {
  if (db) db.close();
  db = null;
}

/** @param {IDBRequest} req @returns {Promise<any>} */
const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** @param {IDBTransaction} tx @param {() => unknown} [reason] @returns {Promise<void>} */
const finished = (tx, reason = () => null) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(reason() || tx.error || Error('Storage write failed.'));
  tx.onabort = () => reject(reason() || tx.error || Error('Storage write failed.'));
});

/**
 * Run `body` inside one transaction. `body` may await requests of this transaction (each continuation issues its next
 * request before the transaction can auto-commit). A throw aborts the transaction, so nothing persists; the call
 * resolves only after the transaction committed.
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function transact(stores, mode, body) {
  const conn = await openDB();
  const tx = mode === 'readwrite' ? conn.transaction(stores, mode, {durability: 'strict'}) : conn.transaction(stores, mode);
  /** @type {unknown} */
  let error = null;
  const result = finished(tx, () => error);
  /** @type {T} */
  let out;
  try {
    out = await body(tx);
  } catch (e) {
    error = e;
    try {
      tx.abort();
    } catch {
      // already finished
    }
  }
  await result;
  return /** @type {T} */ (out);
}

/**
 * Tell other tabs what changed: {type: 'meta' | 'state', stallId}.
 * @param {'meta'|'state'} type
 * @param {string|null} stallId
 */
const broadcast = (type, stallId) => {
  try {
    channel?.postMessage({type, stallId});
  } catch {
    // A closed channel must never fail a committed write.
  }
};

const nowIso = () => new Date().toISOString();
const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
const isObj = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------------
// Stalls index (meta)
// ---------------------------------------------------------------------------------------------------------------------

/** @returns {{version: 1, activeStallId: string|null, stalls: any[]}} */
const emptyMeta = () => ({version: 1, activeStallId: null, stalls: []});

/**
 * Card numbers for a stall, from its state: identity, look and live-ledger totals.
 * @param {any} state
 */
export function stallSummary(state) {
  const c = isObj(state) && isObj(state.config) ? state.config : {};
  const p = isObj(c.profile) ? c.profile : {};
  const t = isObj(c.theme) ? c.theme : {};
  const live = isObj(state) && isObj(state.live) ? state.live : {};
  const sum = (/** @type {unknown} */ list, /** @type {(x: any) => number} */ pick) =>
    (Array.isArray(list) ? list : []).reduce((n, x) => n + (Number.isSafeInteger(pick(x)) ? pick(x) : 0), 0);
  return {
    name: str(p.stallName),
    booth: str(p.booth),
    themeId: str(t.themeId) || str(c.templateId),
    accent: str(t.accent) || '#FFDD35',
    heroArt: Array.isArray(t.heroArt) ? t.heroArt.filter(a => typeof a === 'string').slice(0, 3) : [],
    orders: Array.isArray(live.orders) ? live.orders.length : 0,
    collected: sum(live.payments, x => x?.amount),
    bills: sum(live.expenses, x => (x && !x.void ? x.amount : 0)),
    currency: /** @type {'INR'} */ ('INR'),
  };
}

/** A fresh index entry. @param {string} id @param {string} key @param {any} state @param {string} [now] */
function newEntry(id, key, state, now = nowIso()) {
  return {id, key, createdAt: now, updatedAt: now, openedAt: /** @type {string|null} */ (null), summary: stallSummary(state), cloud: null};
}

/** Defensive copy of a stored index (unknown/broken rows dropped). @param {any} raw */
function normalizeMeta(raw) {
  if (!isObj(raw)) return emptyMeta();
  const seen = new Set();
  const stalls = [];
  for (const e of Array.isArray(raw.stalls) ? raw.stalls : []) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id || typeof e.key !== 'string' || !e.key || seen.has(e.id)) continue;
    seen.add(e.id);
    stalls.push({
      ...e,
      createdAt: str(e.createdAt) || nowIso(),
      updatedAt: str(e.updatedAt) || str(e.createdAt) || nowIso(),
      openedAt: typeof e.openedAt === 'string' ? e.openedAt : null,
      summary: isObj(e.summary) ? e.summary : stallSummary(null),
      cloud: isObj(e.cloud) ? e.cloud : null,
    });
  }
  const active = typeof raw.activeStallId === 'string' && seen.has(raw.activeStallId) ? raw.activeStallId : null;
  return {version: /** @type {1} */ (1), activeStallId: active, stalls};
}

/** @param {any} meta @param {string} id */
const entryOf = (meta, id) => meta.stalls.find((/** @type {any} */ e) => e.id === id) || null;

/** @param {IDBObjectStore} os */
const loadMeta = async os => normalizeMeta(await done(os.get(META_KEY)));

/** Migrated copy of a stored state, or null. @param {any} raw */
const migrated = raw => (raw === undefined || raw === null ? null : migrate(raw));

/**
 * The index of stalls on this device (a new device: no stalls, none active). Read-only — init() writes the boot migration.
 * @returns {Promise<{version: 1, activeStallId: string|null, stalls: any[]}>}
 */
export async function getMeta() {
  return transact([STATE], 'readonly', async tx => {
    const os = tx.objectStore(STATE);
    const rawMeta = await done(os.get(META_KEY));
    const meta = normalizeMeta(rawMeta);
    if (!rawMeta) {
      // Not booted yet on a legacy device: report what init() will create.
      const root = await done(os.get(ROOT));
      if (root) {
        meta.stalls.push(newEntry(ROOT, ROOT, safeMigrate(root)));
        meta.activeStallId = ROOT;
      }
    }
    return meta;
  });
}

/** migrate() that never throws (summaries of unreadable data). @param {any} raw */
function safeMigrate(raw) {
  try {
    return migrate(structuredClone(raw));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Open the database and run the boot migration in one transaction:
 * - no 'meta' + an existing 'root' → an index with one active entry {id: 'root', key: 'root'} (the old stall opens as before);
 * - no 'meta' and no 'root' → an empty index, nothing active (a new visitor lands on the welcome page);
 * - 'meta' present but an unlisted 'root' exists (an old cached tab created it) → added as "Recovered stall".
 * The active stall's state is migrated and stored (revision + 1), exactly like the single-stall init did.
 * @returns {Promise<{meta: any, state: any}>} state = the active stall (migrated) or null
 */
export async function init() {
  await openDB();
  return transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const rawMeta = await done(os.get(META_KEY));
    const rawRoot = await done(os.get(ROOT));
    const meta = normalizeMeta(rawMeta);
    const now = nowIso();
    if (!rawMeta) {
      if (rawRoot) {
        const entry = newEntry(ROOT, ROOT, safeMigrate(rawRoot), now);
        entry.openedAt = now;
        meta.stalls.push(entry);
        meta.activeStallId = ROOT;
      }
    } else if (rawRoot && !entryOf(meta, ROOT)) {
      const entry = newEntry(ROOT, ROOT, safeMigrate(rawRoot), now);
      entry.summary.name = RECOVERED_NAME;
      meta.stalls.push(entry);
    }
    /** @type {any} */
    let state = null;
    const active = meta.activeStallId ? entryOf(meta, meta.activeStallId) : null;
    if (active) {
      const raw = active.key === ROOT ? rawRoot : await done(os.get(active.key));
      if (raw) {
        state = migrate(raw);
        state.revision = (Number.isSafeInteger(state.revision) ? state.revision : 0) + 1;
        os.put(state, active.key);
        const name = active.summary?.name;
        active.summary = stallSummary(state);
        if (name === RECOVERED_NAME) active.summary.name = RECOVERED_NAME;
      } else {
        meta.activeStallId = null; // its data is gone: show the stalls list instead of inventing a stall
      }
    }
    os.put(meta, META_KEY);
    return {meta, state};
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Active stall: read / mutate / replaceAll
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Read the active stall's state (migrated to schema v2).
 * @returns {Promise<any>}
 */
export async function read() {
  return transact([STATE], 'readonly', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = meta.activeStallId ? entryOf(meta, meta.activeStallId) : null;
    if (!entry) throw Error(NO_STALL);
    return migrate((await done(os.get(entry.key))) || initialState());
  });
}

/**
 * Run one atomic, strict-durability write on the active stall.
 * `fn(state)` must be synchronous: it receives the migrated state and mutates it in place; its return value becomes `output`.
 * A throw (or a returned Promise) aborts the transaction so nothing persists. Success resolves only after the
 * transaction has committed (the stall's index summary is refreshed in the same transaction), then other tabs are told.
 * `stallId`, when given, must still be the active stall — a tab whose stall was switched elsewhere can't write into another stall.
 * @template T
 * @param {(state: any) => T} fn
 * @param {{stallId?: string|null}} [options]
 * @returns {Promise<{state: any, output: T, stallId: string}>}
 */
export async function mutate(fn, {stallId} = {}) {
  /** @type {string} */
  let id = '';
  const res = await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = meta.activeStallId ? entryOf(meta, meta.activeStallId) : null;
    if (!entry) throw Error(NO_STALL);
    if (stallId && stallId !== entry.id) throw Error('Another tab switched this phone to a different stall. Reopen your stall and try again.');
    id = entry.id;
    const next = migrate((await done(os.get(entry.key))) || initialState());
    const output = fn(next);
    if (output instanceof Promise) {
      output.catch(() => {});
      throw Error('Storage mutations must be synchronous.');
    }
    next.revision = (Number.isSafeInteger(next.revision) ? next.revision : 0) + 1;
    os.put(next, entry.key);
    touch(entry, next);
    os.put(meta, META_KEY);
    return {state: next, output};
  });
  broadcast('state', id);
  return {...res, stallId: id};
}

/** Refresh an entry after a committed write of its state. @param {any} entry @param {any} state */
function touch(entry, state) {
  entry.summary = stallSummary(state);
  entry.updatedAt = nowIso();
}

/**
 * Atomically replace the active stall: its state and its images (backup restore / factory reset). Images not in `media`
 * are removed unless another stall on this device still uses them. Callers validate first (domain.validateBackup /
 * initialState); this stores the state exactly as given. Other tabs are notified on success.
 * @param {any} state
 * @param {Record<string, string>} [media]
 * @returns {Promise<any>} the stored state
 */
export async function replaceAll(state, media = {}) {
  /** @type {string} */
  let id = '';
  await transact([STATE, MEDIA], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = meta.activeStallId ? entryOf(meta, meta.activeStallId) : null;
    if (!entry) throw Error(NO_STALL);
    id = entry.id;
    const keep = await mediaUsedBy(os, meta, entry.key);
    const mediaStore = tx.objectStore(MEDIA);
    const keys = /** @type {string[]} */ (await done(mediaStore.getAllKeys()));
    for (const key of keys) if (!keep.has(key)) mediaStore.delete(key);
    for (const [mid, data] of Object.entries(media || {})) {
      const bytes = typeof data === 'string' && DATA_URL_RE.test(data) ? base64Bytes(data.slice(data.indexOf(',') + 1)) : 0;
      mediaStore.put(mediaRecord(mid, data, bytes), mid);
    }
    os.put(state, entry.key);
    touch(entry, state);
    os.put(meta, META_KEY);
  });
  broadcast('state', id);
  return state;
}

/**
 * Media ids referenced by every stored stall state except `exceptKey` (also unlisted states such as an unrecovered 'root').
 * @param {IDBObjectStore} os
 * @param {any} _meta
 * @param {string|null} exceptKey
 */
async function mediaUsedBy(os, _meta, exceptKey) {
  const keys = /** @type {string[]} */ (await done(os.getAllKeys()));
  const values = await done(os.getAll());
  /** @type {Set<string>} */
  const used = new Set();
  keys.forEach((key, i) => {
    if (key === META_KEY || key === exceptKey) return;
    for (const m of referencedMedia(values[i])) used.add(m);
  });
  return used;
}

// ---------------------------------------------------------------------------------------------------------------------
// Many stalls
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Add a new stall (new uuid entry + key 'stall:<uuid>') holding `state` (migrated; revision + 1) and, unless
 * `{open: false}`, make it the active stall.
 * @param {any} state
 * @param {{open?: boolean}} [options]
 * @returns {Promise<{entry: any, state: any}>}
 */
export async function createStall(state, {open = true} = {}) {
  const next = migrate(structuredClone(state));
  next.revision = (Number.isSafeInteger(next.revision) ? next.revision : 0) + 1;
  const id = uuid();
  const res = await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const now = nowIso();
    const entry = newEntry(id, `stall:${id}`, next, now);
    if (open) {
      entry.openedAt = now;
      meta.activeStallId = id;
    }
    meta.stalls.push(entry);
    os.put(next, entry.key);
    os.put(meta, META_KEY);
    return {entry, state: next};
  });
  broadcast('meta', id);
  return res;
}

/**
 * Make a stall the active one (stamps openedAt).
 * @param {string} id
 * @returns {Promise<any>} its migrated state
 */
export async function openStall(id) {
  const state = await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = entryOf(meta, id);
    if (!entry) throw Error('That stall isn’t on this phone any more.');
    const raw = await done(os.get(entry.key));
    if (!raw) throw Error('This stall’s data is missing on this phone.');
    const st = migrate(raw);
    meta.activeStallId = id;
    entry.openedAt = nowIso();
    os.put(meta, META_KEY);
    return st;
  });
  broadcast('meta', id);
  return state;
}

/** Close the active stall (nothing active; its data stays on the device). @returns {Promise<void>} */
export async function leaveStall() {
  /** @type {string|null} */
  let was = null;
  await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    was = meta.activeStallId;
    meta.activeStallId = null;
    os.put(meta, META_KEY);
  });
  broadcast('meta', was);
}

/**
 * Remove a stall from this device: its state and entry, then every image no remaining stall uses (one transaction).
 * Deleting the active stall leaves nothing active. Never touches a cloud copy.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteStall(id) {
  await transact([STATE, MEDIA], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = entryOf(meta, id);
    if (!entry) throw Error('That stall isn’t on this phone any more.');
    meta.stalls = meta.stalls.filter((/** @type {any} */ e) => e.id !== id);
    if (meta.activeStallId === id) meta.activeStallId = null;
    os.delete(entry.key);
    os.put(meta, META_KEY);
    const used = await mediaUsedBy(os, meta, entry.key);
    const mediaStore = tx.objectStore(MEDIA);
    const keys = /** @type {string[]} */ (await done(mediaStore.getAllKeys()));
    for (const key of keys) if (!used.has(key)) mediaStore.delete(key);
  });
  broadcast('meta', id);
}

/**
 * Any stall's state (migrated), active or not (e.g. cloud push of a background stall).
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function readStall(id) {
  return transact([STATE], 'readonly', async tx => {
    const os = tx.objectStore(STATE);
    const entry = entryOf(await loadMeta(os), id);
    if (!entry) throw Error('That stall isn’t on this phone any more.');
    const st = migrated(await done(os.get(entry.key)));
    if (!st) throw Error('This stall’s data is missing on this phone.');
    return st;
  });
}

/**
 * Store a whole state for a stall, active or not (e.g. cloud pull), refreshing its summary. Stored as given (migrated).
 * The writing tab must adopt the state itself when it is its open stall; other tabs are told.
 * @param {string} id
 * @param {any} state
 * @returns {Promise<any>} the stored state
 */
export async function writeStall(id, state) {
  const next = migrate(structuredClone(state));
  await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = entryOf(meta, id);
    if (!entry) throw Error('That stall isn’t on this phone any more.');
    os.put(next, entry.key);
    touch(entry, next);
    os.put(meta, META_KEY);
  });
  broadcast('state', id);
  return next;
}

/**
 * Merge `patch` into a stall's index entry (id and key can't change). `cloud` is merged field by field; `cloud: null`
 * unlinks; `summary` is merged too.
 * @param {string} id
 * @param {Record<string, any>} patch
 * @returns {Promise<any>} the updated entry
 */
export async function updateEntry(id, patch) {
  const out = await transact([STATE], 'readwrite', async tx => {
    const os = tx.objectStore(STATE);
    const meta = await loadMeta(os);
    const entry = entryOf(meta, id);
    if (!entry) throw Error('That stall isn’t on this phone any more.');
    for (const [k, v] of Object.entries(isObj(patch) ? patch : {})) {
      if (k === 'id' || k === 'key') continue;
      if (k === 'cloud') entry.cloud = v === null ? null : {...(entry.cloud || {}), ...(isObj(v) ? v : {})};
      else if (k === 'summary' && isObj(v)) entry.summary = {...entry.summary, ...v};
      else entry[k] = v;
    }
    os.put(meta, META_KEY);
    return structuredClone(entry);
  });
  broadcast('meta', id);
  return out;
}

/**
 * Listen for changes made by other tabs of this app: fn({type: 'meta' | 'state', stallId}).
 * (An old single-stall tab posts a bare revision number → {type: 'state', stallId: 'root'}.)
 * @param {(change: {type: 'meta'|'state', stallId: string|null}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onExternalChange(fn) {
  if (!channel) return () => {};
  const handler = (/** @type {MessageEvent} */ e) => {
    const d = e?.data;
    const change = isObj(d) && (d.type === 'meta' || d.type === 'state')
      ? {type: d.type, stallId: typeof d.stallId === 'string' ? d.stallId : null}
      : {type: /** @type {'state'} */ ('state'), stallId: ROOT};
    fn(change);
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

// ---------------------------------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------------------------------

/** Decoded byte length of a base64 payload. @param {string} b64 */
function base64Bytes(b64) {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Validate an image data URL and return its decoded size.
 * @param {unknown} dataURL
 * @returns {number} bytes
 */
export function mediaBytes(dataURL) {
  const match = typeof dataURL === 'string' ? DATA_URL_RE.exec(dataURL) : null;
  if (!match) throw Error('Use a PNG, JPEG, WebP or GIF image.');
  const bytes = base64Bytes(match[2]);
  if (bytes > MAX_MEDIA_BYTES) throw Error('That image is larger than 1.5 MB. Pick a smaller one.');
  return bytes;
}

/** @param {string} id @param {string} data @param {number} bytes */
const mediaRecord = (id, data, bytes) => ({id, data, bytes, at: new Date().toISOString()});

/**
 * Every stored image (all stalls on this device).
 * @returns {Promise<Record<string, string>>} media id → data URL
 */
export async function getAllMedia() {
  const rows = await transact([MEDIA], 'readonly', tx => done(tx.objectStore(MEDIA).getAll()));
  /** @type {Record<string, string>} */
  const out = {};
  for (const row of rows || []) if (row && typeof row.id === 'string' && typeof row.data === 'string') out[row.id] = row.data;
  return out;
}

/**
 * Only the images one state references (domain.referencedMedia) — e.g. for a single stall's backup or cloud snapshot.
 * @param {any} state
 * @returns {Promise<Record<string, string>>}
 */
export async function getMediaFor(state) {
  const used = referencedMedia(state);
  const all = await getAllMedia();
  /** @type {Record<string, string>} */
  const out = {};
  for (const id of used) if (id in all) out[id] = all[id];
  return out;
}

/**
 * Store one image (validated: png/jpeg/webp/gif base64 data URL, ≤ 1.5 MiB decoded).
 * @param {string} id media id (ID_RE)
 * @param {string} dataURL
 * @returns {Promise<void>}
 */
export async function putMedia(id, dataURL) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw Error('Invalid image id.');
  const bytes = mediaBytes(dataURL);
  const conn = await openDB();
  const tx = conn.transaction(MEDIA, 'readwrite', {durability: 'strict'});
  tx.objectStore(MEDIA).put(mediaRecord(id, /** @type {string} */ (dataURL), bytes), id);
  await finished(tx);
}

/**
 * Delete images by id.
 * @param {string | string[]} ids
 * @returns {Promise<void>}
 */
export async function deleteMedia(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(id => typeof id === 'string' && id);
  if (!list.length) return;
  const conn = await openDB();
  const tx = conn.transaction(MEDIA, 'readwrite', {durability: 'strict'});
  const os = tx.objectStore(MEDIA);
  for (const id of list) os.delete(id);
  await finished(tx);
}

/**
 * Delete images no stall on this device references any more. Kept: every id from domain.referencedMedia of EVERY stored
 * stall (active or not) — product photos, hero photos and bill photos in both ledgers (voided bills included).
 * @returns {Promise<number>} how many were deleted
 */
export async function pruneMedia() {
  return transact([STATE, MEDIA], 'readwrite', async tx => {
    const used = await mediaUsedBy(tx.objectStore(STATE), null, null);
    const media = tx.objectStore(MEDIA);
    const keys = /** @type {string[]} */ (await done(media.getAllKeys()));
    let removed = 0;
    for (const key of keys) {
      if (!used.has(key)) {
        media.delete(key);
        removed++;
      }
    }
    return removed;
  });
}
