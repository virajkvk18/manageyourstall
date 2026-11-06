// IndexedDB adapter for ManageYourStall (ARCHITECTURE.md §8).
//
// One database, two object stores:
//   state  key 'root'      → State (schema v2, migrated on every read/write)
//   media  key = media id  → { id, data: dataURL, bytes, at }
//
// The database keeps its legacy v1 name so devices that ran the original single-stall app keep their sales.
// Every write is one strict-durability transaction; nothing is persisted unless the whole transaction commits.
import {initialState, migrate, referencedMedia} from './domain.mjs';
import {ID_RE} from './constants.mjs';

export const DB_NAME = 'packet-pataka-v1';
export const DB_VERSION = 2;
export const CHANNEL_NAME = 'mys-ledger';
/** Largest accepted decoded image (1.5 MiB). */
export const MAX_MEDIA_BYTES = 1572864;

const STATE = 'state';
const MEDIA = 'media';
const ROOT = 'root';
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

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

const broadcast = (/** @type {number} */ revision) => {
  try {
    channel?.postMessage(revision);
  } catch {
    // A closed channel must never fail a committed write.
  }
};

/**
 * Read the current stall state (migrated to schema v2). A brand-new device returns a fresh initialState().
 * @returns {Promise<any>}
 */
export async function read() {
  const conn = await openDB();
  const tx = conn.transaction(STATE, 'readonly');
  const raw = await done(tx.objectStore(STATE).get(ROOT));
  return migrate(raw || initialState());
}

/**
 * Run one atomic, strict-durability write.
 * `fn(state)` must be synchronous: it receives the migrated state and mutates it in place; its return value becomes `output`.
 * A throw (or a returned Promise) aborts the transaction so nothing persists. Success resolves only after the
 * transaction has committed, then other tabs are told the new revision.
 * @template T
 * @param {(state: any) => T} fn
 * @returns {Promise<{state: any, output: T}>}
 */
export async function mutate(fn) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STATE, 'readwrite', {durability: 'strict'});
    const os = tx.objectStore(STATE);
    /** @type {any} */
    let next;
    /** @type {any} */
    let output;
    /** @type {unknown} */
    let error = null;
    const req = os.get(ROOT);
    req.onsuccess = () => {
      try {
        next = migrate(req.result || initialState());
        output = fn(next);
        if (output instanceof Promise) {
          output.catch(() => {});
          throw Error('Storage mutations must be synchronous.');
        }
        next.revision = (Number.isSafeInteger(next.revision) ? next.revision : 0) + 1;
        os.put(next, ROOT);
      } catch (e) {
        error = e;
        try {
          tx.abort();
        } catch {
          // already finished
        }
      }
    };
    tx.oncomplete = () => {
      broadcast(next.revision);
      resolve({state: next, output});
    };
    tx.onerror = () => reject(error || tx.error || Error('Storage write failed.'));
    tx.onabort = () => reject(error || tx.error || Error('Storage write failed.'));
  });
}

/**
 * Open the database and make sure a valid v2 state is stored (initializes a new device, migrates a v1 one).
 * @returns {Promise<any>} the committed state
 */
export async function init() {
  await openDB();
  return (await mutate(() => {})).state;
}

/**
 * Listen for writes made by other tabs of this app (BroadcastChannel 'mys-ledger').
 * @param {(event: MessageEvent) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onExternalChange(fn) {
  if (!channel) return () => {};
  channel.addEventListener('message', fn);
  return () => channel.removeEventListener('message', fn);
}

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
 * Every stored image.
 * @returns {Promise<Record<string, string>>} media id → data URL
 */
export async function getAllMedia() {
  const conn = await openDB();
  const tx = conn.transaction(MEDIA, 'readonly');
  const rows = await done(tx.objectStore(MEDIA).getAll());
  /** @type {Record<string, string>} */
  const out = {};
  for (const row of rows || []) if (row && typeof row.id === 'string' && typeof row.data === 'string') out[row.id] = row.data;
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
 * Atomically replace everything: the state and the whole media store (media not in `media` is removed).
 * Used by backup restore and factory reset. Callers validate first (domain.validateBackup / initialState);
 * this stores the state exactly as given. Other tabs are notified on success.
 * @param {any} state
 * @param {Record<string, string>} [media]
 * @returns {Promise<any>} the stored state
 */
export async function replaceAll(state, media = {}) {
  const conn = await openDB();
  const tx = conn.transaction([STATE, MEDIA], 'readwrite', {durability: 'strict'});
  /** @type {unknown} */
  let error = null;
  const result = finished(tx, () => error);
  try {
    const mediaStore = tx.objectStore(MEDIA);
    mediaStore.clear();
    for (const [id, data] of Object.entries(media || {})) {
      const bytes = typeof data === 'string' && DATA_URL_RE.test(data) ? base64Bytes(data.slice(data.indexOf(',') + 1)) : 0;
      mediaStore.put(mediaRecord(id, data, bytes), id);
    }
    tx.objectStore(STATE).put(state, ROOT);
  } catch (e) {
    error = e;
    try {
      tx.abort();
    } catch {
      // already finished
    }
  }
  await result;
  broadcast(state && state.revision);
  return state;
}

/**
 * Delete images nothing references any more. Kept: every id from domain.referencedMedia — product photos, the theme's hero
 * photo and bill photos in both ledgers (voided bills included).
 * @returns {Promise<number>} how many were deleted
 */
export async function pruneMedia() {
  const conn = await openDB();
  const tx = conn.transaction([STATE, MEDIA], 'readwrite', {durability: 'strict'});
  let removed = 0;
  const result = finished(tx);
  const stateReq = tx.objectStore(STATE).get(ROOT);
  stateReq.onsuccess = () => {
    const used = referencedMedia(stateReq.result);
    const media = tx.objectStore(MEDIA);
    const keysReq = media.getAllKeys();
    keysReq.onsuccess = () => {
      for (const key of keysReq.result) {
        if (!used.has(key)) {
          media.delete(key);
          removed++;
        }
      }
    };
  };
  await result;
  return removed;
}
