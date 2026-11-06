// @ts-check
// Cloud client & background sync for ManageYourStall (ARCHITECTURE.md §17.4).
//
// No SDK: every call goes to the Convex HTTP API —
//   POST ${CONVEX_URL}/api/{query|mutation|action}  {path, args, format: 'json'}
//   → {status: 'success', value} | {status: 'error', errorMessage, errorData}
// The user-facing message is `errorData` when the backend threw ConvexError('…') with a string, else a generic message.
//
// The counter stays offline-first: every sale lands in IndexedDB first (storage.mjs). This module only copies a linked
// stall's snapshot (exportBackup JSON incl. photos) to the cloud and back. Conflicts are never resolved automatically.
//
// Sessions (localStorage):
//   'mys-session' → {token, user: {id, loginId, name}, kind: 'user', stallId: null}   — the MYS account on this phone
//   'mys-team'    → {[cloudStallId]: {token, code, name, at}}                          — team (stall-code) sessions
//   'mys-device'  → uuid of this device
// A team join never replaces the account session: an owner can stay signed in and still help at a friend's stall.
import * as storageModule from './storage.mjs';
import {CONVEX_URL} from './config.mjs';
import {exportBackup, validateBackup, referencedMedia, report} from './domain.mjs';

const SESSION_KEY = 'mys-session';
const TEAM_KEY = 'mys-team';
const DEVICE_KEY = 'mys-device';
/** Debounce between the last committed sale and the background push. */
export const SYNC_DEBOUNCE_MS = 4000;
const CALL_TIMEOUT_MS = 20000;
const TRANSFER_TIMEOUT_MS = 90000;
const FLUSH_TIMEOUT_MS = 8000;

const LOGIN_RE = /^[a-z0-9._@+-]{3,60}$/;
const CODE_RE = /^MYS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const AUTH_RE = /log ?in again|sign ?in again|not signed in|not logged in|session (has )?(expired|ended)|session is (no longer )?valid|invalid session/i;

const MSG = Object.freeze({
  offline: "You're offline. Everything is safe on this phone — cloud sync needs internet.",
  network: "Couldn't reach the MYS cloud. Check your internet and try again.",
  slow: 'The internet is too slow right now. Try again in a bit.',
  generic: 'The MYS cloud hit a snag. Please try again in a moment.',
  notReady: "Cloud features aren't switched on in this copy of MYS.",
  signedOut: 'Log in to your MYS account first.',
  loginToSync: 'Log in to sync this stall.',
  notLinked: 'This stall is only on this phone. Save it to the cloud first.',
  missing: "That stall isn't on this phone any more.",
  noSnapshot: "There's no cloud copy of this stall yet. Save it from the phone that has it.",
  damaged: "The cloud copy didn't pass the safety check, so MYS didn't use it. This phone's data is untouched.",
  dirty: "This phone has sales that aren't in the cloud yet. Sync them first so nothing is lost.",
  ownerOnly: 'Only the stall owner can do that.',
  oldStorage: 'Please reload MYS to finish updating the app.',
});

/** A friendly, user-facing cloud error. `code` lets the UI pick a tone. */
export class CloudError extends Error {
  /**
   * @param {string} message friendly text, safe to show
   * @param {'offline'|'server'|'auth'|'invalid'|'not-ready'|'signed-out'|'not-linked'|'missing'|'empty'|'dirty'|'owner'|'error'} [code]
   * @param {unknown} [data]
   */
  constructor(message, code = 'server', data = null) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Dependencies (overridable in unit tests only)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{
 *   storage: any, core: any, url: string, fetch: (url: string, init?: any) => Promise<any>,
 *   localStorage: () => Storage | null, online: () => boolean, win: () => any, doc: () => any, userAgent: () => string,
 * }} Deps
 */
/** @returns {Deps} */
const defaultDeps = () => ({
  storage: storageModule,
  core: null,
  url: CONVEX_URL,
  fetch: (url, init) => globalThis.fetch(url, init),
  localStorage: () => (typeof localStorage === 'undefined' ? null : localStorage),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  win: () => (typeof window === 'undefined' ? null : window),
  doc: () => (typeof document === 'undefined' ? null : document),
  userAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || ''),
});
let deps = defaultDeps();

/** @returns {Promise<any>} the UI kernel (lazy: keeps this module importable without a DOM) */
async function getCore() {
  if (deps.core) return deps.core;
  try {
    deps.core = await import('./ui/core.mjs');
  } catch (err) {
    console.warn('MYS cloud: the UI kernel is not available', err);
    deps.core = {};
  }
  return deps.core;
}

/** @param {string} name */
function storageFn(name) {
  const fn = deps.storage && deps.storage[name];
  if (typeof fn !== 'function') throw new CloudError(MSG.oldStorage, 'error');
  return fn.bind(deps.storage);
}

const nowIso = () => new Date().toISOString();
const isOnline = () => {
  try {
    return deps.online() !== false;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------------------------------------------------

/** Cloud features are available when a Convex URL is configured. */
export const cloudReady = () => Boolean(deps.url);

/** Is the browser online (navigator.onLine)? */
export const online = () => isOnline();

const base = () => String(deps.url || '').replace(/\/+$/, '');

/** @param {number} ms */
const timeoutSignal = ms => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

/**
 * Normalize anything thrown into a CloudError with a friendly message.
 * @param {unknown} err
 * @returns {CloudError}
 */
export function toCloudError(err) {
  if (err instanceof CloudError) return err;
  const e = /** @type {any} */ (err);
  if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return new CloudError(MSG.slow, 'offline', err);
  if (e && e.name === 'TypeError' && /fetch|network|load failed/i.test(String(e.message))) {
    return new CloudError(isOnline() ? MSG.network : MSG.offline, 'offline', err);
  }
  const text = e && typeof e.message === 'string' && e.message ? e.message : MSG.generic;
  return new CloudError(text, 'error', err);
}

/**
 * A fetch that threw never reached the server: offline, DNS, CORS, a timeout.
 * @param {unknown} err
 */
function networkError(err) {
  const e = /** @type {any} */ (err);
  if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return new CloudError(MSG.slow, 'offline', err);
  return new CloudError(isOnline() ? MSG.network : MSG.offline, 'offline', err);
}

/**
 * Pick the user-facing message out of a Convex error body.
 * @param {any} body
 */
function errorMessage(body) {
  const data = body && body.errorData;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object' && typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return MSG.generic;
}

/**
 * Call a Convex function over HTTP.
 * @param {'query'|'mutation'|'action'} kind
 * @param {string} path e.g. 'stalls:list'
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<any>} the function's return value
 */
export async function call(kind, path, args = {}) {
  if (!cloudReady()) throw new CloudError(MSG.notReady, 'not-ready');
  if (!isOnline()) throw new CloudError(MSG.offline, 'offline');
  let res;
  try {
    res = await deps.fetch(`${base()}/api/${kind}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path, args, format: 'json'}),
      signal: timeoutSignal(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err);
  }
  /** @type {any} */
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (body && body.status === 'success') return body.value;
  if (body && body.status === 'error') {
    const message = errorMessage(body);
    throw new CloudError(message, AUTH_RE.test(message) ? 'auth' : 'server', body.errorData ?? null);
  }
  throw new CloudError(MSG.generic, 'server', {httpStatus: res && res.status});
}

// ---------------------------------------------------------------------------------------------------------------------
// Local session, team sessions & device identity
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Map<string, string>} used when localStorage is unavailable (private mode, blocked site data) */
const memoryStore = new Map();

/** @param {string} key */
function readRaw(key) {
  try {
    const ls = deps.localStorage();
    if (ls) return ls.getItem(key);
  } catch {
    // fall through to memory
  }
  return memoryStore.has(key) ? /** @type {string} */ (memoryStore.get(key)) : null;
}

/** @param {string} key @param {string | null} value */
function writeRaw(key, value) {
  if (value === null) memoryStore.delete(key);
  else memoryStore.set(key, value);
  try {
    const ls = deps.localStorage();
    if (!ls) return;
    if (value === null) ls.removeItem(key);
    else ls.setItem(key, value);
  } catch {
    // memory copy is enough for this page
  }
}

/** @param {string} key */
function readJson(key) {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {any} u */
const cleanUser = u =>
  u && typeof u === 'object'
    ? {id: typeof u.id === 'string' ? u.id : String(u.id ?? ''), loginId: String(u.loginId ?? ''), name: String(u.name ?? '')}
    : null;

/**
 * The signed-in MYS account on this phone.
 * @returns {{token: string, user: {id: string, loginId: string, name: string} | null, kind: 'user'|'stall', stallId: string|null} | null}
 */
export function session() {
  const s = readJson(SESSION_KEY);
  if (!s || typeof s.token !== 'string' || !s.token || (s.kind !== 'user' && s.kind !== 'stall')) return null;
  return {token: s.token, user: cleanUser(s.user), kind: s.kind, stallId: typeof s.stallId === 'string' ? s.stallId : null};
}

/** True when an MYS account (not just a team code) is signed in. */
export const signedIn = () => session()?.kind === 'user';

/** @param {ReturnType<typeof session>} s */
function saveSession(s) {
  writeRaw(SESSION_KEY, s ? JSON.stringify(s) : null);
  emit(null);
}

/** @returns {Record<string, {token: string, code: string, name: string, at: string}>} */
function teamMap() {
  const m = readJson(TEAM_KEY);
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** @param {string} stallId @param {{token: string, code: string, name: string} | null} value */
function saveTeam(stallId, value) {
  const m = teamMap();
  if (value) m[stallId] = {...value, at: nowIso()};
  else delete m[stallId];
  writeRaw(TEAM_KEY, Object.keys(m).length ? JSON.stringify(m) : null);
  emit(null);
}

/** Team stalls this phone joined with a stall code: [{stallId, code, name, at}]. */
export function teamAccess() {
  return Object.entries(teamMap()).map(([stallId, t]) => ({stallId, code: t.code, name: t.name, at: t.at}));
}

/**
 * This device's id (localStorage 'mys-device', a uuid created on first use).
 * @returns {string}
 */
export function deviceId() {
  const known = readRaw(DEVICE_KEY);
  if (known && /^[A-Za-z0-9-]{8,64}$/.test(known)) return known;
  const id = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  writeRaw(DEVICE_KEY, id);
  return id;
}

/**
 * A short human label for this device, e.g. 'Chrome on Android'.
 * @param {string} [ua] user agent (defaults to navigator.userAgent)
 */
export function deviceLabel(ua) {
  const agent = typeof ua === 'string' ? ua : deps.userAgent();
  const browser = /SamsungBrowser/i.test(agent) ? 'Samsung Internet'
    : /EdgA?\/|EdgiOS|Edg\//.test(agent) ? 'Edge'
    : /OPR\/|Opera/.test(agent) ? 'Opera'
    : /Firefox\/|FxiOS/.test(agent) ? 'Firefox'
    : /CriOS|Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : '';
  const os = /Android/i.test(agent) ? 'Android'
    : /iPad/.test(agent) ? 'iPad'
    : /iPhone|iPod/.test(agent) ? 'iPhone'
    : /CrOS/.test(agent) ? 'ChromeOS'
    : /Windows/.test(agent) ? 'Windows'
    : /Mac OS X|Macintosh/.test(agent) ? 'Mac'
    : /Linux/.test(agent) ? 'Linux'
    : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'This device';
}

/**
 * Token that may act on a linked stall: team token for team access, else the account session.
 * @param {any} cloud entry.cloud (or {stallId, access})
 * @returns {string | null}
 */
function tokenFor(cloud) {
  const s = session();
  const team = cloud && cloud.stallId ? teamMap()[cloud.stallId] : null;
  if (cloud && cloud.access === 'team') {
    if (team && team.token) return team.token;
    if (s && s.kind === 'stall' && s.stallId === cloud.stallId) return s.token;
    return null;
  }
  if (s && s.kind === 'user') return s.token;
  if (s && s.kind === 'stall' && cloud && s.stallId === cloud.stallId) return s.token;
  return team && team.token ? team.token : null;
}

function requireUser() {
  const s = session();
  if (!s || s.kind !== 'user') throw new CloudError(MSG.signedOut, 'signed-out');
  return s;
}

/** After an auth-looking error, check the session; a dead one is cleared so the UI shows "Log in". */
async function recheckSession() {
  try {
    await me();
  } catch {
    // offline or server trouble: keep the session
  }
}

/**
 * Run an authenticated call; an auth error re-validates the session.
 * @param {'query'|'mutation'|'action'} kind @param {string} path @param {Record<string, unknown>} args
 */
async function authed(kind, path, args) {
  try {
    return await call(kind, path, args);
  } catch (err) {
    if (err instanceof CloudError && err.code === 'auth') await recheckSession();
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------------------------------

/** @param {unknown} loginId */
function cleanLoginId(loginId) {
  const id = String(loginId ?? '').trim().toLowerCase();
  if (!id) throw new CloudError('Enter your login ID — an email, phone number or username.', 'invalid');
  if (!LOGIN_RE.test(id)) throw new CloudError('Login ID needs 3–60 letters, numbers or . _ @ + -', 'invalid');
  return id;
}

/** @param {unknown} password @param {string} [what] */
function cleanPassword(password, what = 'Password') {
  const p = typeof password === 'string' ? password : '';
  if (p.length < 6 || p.length > 100) throw new CloudError(`${what} needs 6 to 100 characters.`, 'invalid');
  return p;
}

/** @param {any} res */
function adoptAuth(res) {
  if (!res || typeof res.token !== 'string' || !res.user) throw new CloudError(MSG.generic, 'server');
  const s = {token: res.token, user: cleanUser(res.user), kind: /** @type {'user'} */ ('user'), stallId: null};
  saveSession(s);
  return s;
}

/**
 * Create an MYS account and sign this phone in.
 * @param {{loginId: string, password: string, name?: string}} input
 */
export async function signUp({loginId, password, name = ''}) {
  const id = cleanLoginId(loginId);
  const pass = cleanPassword(password);
  const display = String(name ?? '').trim().slice(0, 60) || id.split('@')[0].slice(0, 60);
  const res = await call('action', 'auth:signUp', {loginId: id, password: pass, name: display, deviceId: deviceId(), deviceLabel: deviceLabel()});
  return adoptAuth(res).user;
}

/**
 * Sign this phone in to an existing account.
 * @param {{loginId: string, password: string}} input
 */
export async function logIn({loginId, password}) {
  const id = cleanLoginId(loginId);
  const pass = typeof password === 'string' ? password : '';
  if (!pass) throw new CloudError('Enter your password.', 'invalid');
  const res = await call('action', 'auth:logIn', {loginId: id, password: pass, deviceId: deviceId(), deviceLabel: deviceLabel()});
  return adoptAuth(res).user;
}

/** Sign this phone out (the server session is ended when online; the local session is always cleared). */
export async function logOut() {
  const s = session();
  if (!s) return;
  saveSession(null);
  try {
    await call('mutation', 'auth:logOut', {token: s.token});
  } catch {
    // offline or already expired: the local session is gone, which is what matters on this phone
  }
}

/**
 * Validate the stored session with the server. A dead session is cleared (returns null).
 * Offline: returns the cached session with `offline: true` (never signs anyone out without asking the server).
 */
export async function me() {
  const s = session();
  if (!s) return null;
  let res;
  try {
    res = await call('query', 'auth:me', {token: s.token});
  } catch (err) {
    if (err instanceof CloudError && (err.code === 'offline' || err.code === 'not-ready')) return {...s, offline: true};
    throw err;
  }
  if (!res) {
    if (session()?.token === s.token) saveSession(null);
    return null;
  }
  const next = {
    token: s.token,
    user: cleanUser(res.user) || s.user,
    kind: res.kind === 'stall' ? /** @type {'stall'} */ ('stall') : /** @type {'user'} */ ('user'),
    stallId: typeof res.stallId === 'string' ? res.stallId : s.stallId,
  };
  if (JSON.stringify(next) !== JSON.stringify(s)) saveSession(next);
  return next;
}

/**
 * Change the account password (the server signs out the account's other sessions).
 * @param {string} oldPassword @param {string} newPassword
 */
export async function changePassword(oldPassword, newPassword) {
  const s = requireUser();
  if (typeof oldPassword !== 'string' || !oldPassword) throw new CloudError('Enter your current password.', 'invalid');
  const next = cleanPassword(newPassword, 'New password');
  await authed('action', 'auth:changePassword', {token: s.token, oldPassword, newPassword: next});
  return true;
}

/**
 * Change the account's display name.
 * @param {string} name
 */
export async function updateName(name) {
  const s = requireUser();
  const clean = String(name ?? '').trim().slice(0, 60);
  if (!clean) throw new CloudError('Enter your name.', 'invalid');
  await authed('mutation', 'auth:updateProfile', {token: s.token, name: clean});
  const latest = session();
  if (latest && latest.token === s.token) saveSession({...latest, user: {...(latest.user || {id: '', loginId: ''}), name: clean}});
  return clean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Local stall entries (storage §17.1) — cache + serialized cloud-field writes
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Map<string, any>} entry id → last seen StallEntry */
const entries = new Map();
let activeId = /** @type {string|null} */ (null);
/** @type {Map<string, Promise<unknown>>} */
const entryLocks = new Map();
/** @type {Map<string, Promise<unknown>>} */
const stallLocks = new Map();
/** @type {Set<string>} entries with a push/pull running right now */
const busy = new Set();

/**
 * Run `fn` after every earlier task with the same key (per-key FIFO).
 * @template T @param {Map<string, Promise<unknown>>} map @param {string} key @param {() => Promise<T>} fn @returns {Promise<T>}
 */
function lock(map, key, fn) {
  const prev = map.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  map.set(key, tail);
  tail.then(() => {
    if (map.get(key) === tail) map.delete(key);
  });
  return run;
}

/** @returns {Promise<{version: number, activeStallId: string|null, stalls: any[]}>} */
async function getMeta() {
  const meta = await storageFn('getMeta')();
  const list = meta && Array.isArray(meta.stalls) ? meta.stalls : [];
  entries.clear();
  for (const e of list) if (e && typeof e.id === 'string') entries.set(e.id, e);
  activeId = meta ? meta.activeStallId ?? null : null;
  return {version: meta?.version ?? 1, activeStallId: activeId, stalls: list};
}

/** @param {string} id */
async function getEntry(id) {
  const meta = await getMeta();
  const entry = meta.stalls.find(e => e.id === id);
  if (!entry) throw new CloudError(MSG.missing, 'missing');
  return entry;
}

/**
 * Replace entry.cloud (serialized per entry so read-modify-write never loses a concurrent change made in this tab).
 * `patch` may be an object or a function of the current cloud object; a function returning null skips the write.
 * With `whole`, the patch replaces cloud entirely (null unlinks).
 * @param {string} entryId
 * @param {any} patch
 * @param {{whole?: boolean}} [options]
 */
function patchCloud(entryId, patch, {whole = false} = {}) {
  return lock(entryLocks, entryId, async () => {
    const meta = await getMeta();
    const entry = meta.stalls.find(e => e.id === entryId);
    if (!entry) return null;
    let next;
    if (whole) next = patch;
    else {
      if (!entry.cloud) return null;
      const change = typeof patch === 'function' ? patch(entry.cloud) : patch;
      if (!change) return entry.cloud;
      next = {...entry.cloud, ...change};
    }
    await storageFn('updateEntry')(entryId, {cloud: next});
    entry.cloud = next;
    entries.set(entryId, entry);
    emit(entryId);
    return next;
  });
}

/** @param {any} entry */
async function readEntryState(entry) {
  const st = deps.storage;
  if (typeof st.readStall === 'function') return st.readStall(entry.id);
  if (entry.id === activeId && typeof st.read === 'function') return st.read();
  throw new CloudError(MSG.oldStorage, 'error');
}

/**
 * Cloud-facing stall info from a State.
 * @param {any} state
 */
export function stallInfo(state) {
  const c = (state && state.config) || {};
  const p = c.profile || {};
  const t = c.theme || {};
  const text = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    name: text(p.stallName, 60) || 'My stall',
    booth: text(p.booth, 60),
    themeId: text(t.themeId, 60) || 'custom',
    accent: typeof t.accent === 'string' && HEX_COLOR_RE.test(t.accent) ? t.accent.toUpperCase() : '#FFDD35',
    heroArt: Array.isArray(t.heroArt) ? t.heroArt.filter(a => typeof a === 'string').slice(0, 3) : [],
    eventName: text(p.eventName, 60),
    city: text(p.city, 60),
  };
}

/**
 * Money summary for the cloud stall card — the same numbers as the local stall cards (storage.stallSummary).
 * @param {any} state @param {any} [entry]
 */
export function stallSummary(state, entry) {
  const n = (/** @type {unknown} */ v) => (Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0 ? /** @type {number} */ (v) : 0);
  try {
    if (typeof deps.storage.stallSummary === 'function') {
      const s = deps.storage.stallSummary(state);
      return {orders: n(s.orders), collected: n(s.collected), bills: n(s.bills)};
    }
  } catch {
    // fall back to the ledger report
  }
  try {
    const r = report(state.live, state.config);
    return {orders: n(r.orders), collected: n(r.collected), bills: n(r.expenses)};
  } catch {
    const s = (entry && entry.summary) || {};
    return {orders: n(s.orders), collected: n(s.collected), bills: n(s.bills)};
  }
}

/**
 * The snapshot file: exportBackup(state, photos used by this stall) as a JSON Blob.
 * @param {any} state
 */
async function snapshotBlob(state) {
  const all = await storageFn('getAllMedia')();
  const used = referencedMedia(state);
  /** @type {Record<string, string>} */
  const media = {};
  for (const id of used) if (typeof all[id] === 'string') media[id] = all[id];
  return new Blob([JSON.stringify(exportBackup(state, media))], {type: 'application/json'});
}

/** @param {string} url @param {Blob} blob @returns {Promise<string>} storageId */
async function uploadBlob(url, blob) {
  if (!isOnline()) throw new CloudError(MSG.offline, 'offline');
  let res;
  try {
    res = await deps.fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: blob, signal: timeoutSignal(TRANSFER_TIMEOUT_MS)});
  } catch (err) {
    throw networkError(err);
  }
  /** @type {any} */
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || typeof body.storageId !== 'string') throw new CloudError("Couldn't upload the stall to the cloud. Try again.", 'server');
  return body.storageId;
}

/** @param {string} url @returns {Promise<unknown>} parsed JSON */
async function downloadJson(url) {
  if (!isOnline()) throw new CloudError(MSG.offline, 'offline');
  let res;
  try {
    res = await deps.fetch(url, {method: 'GET', signal: timeoutSignal(TRANSFER_TIMEOUT_MS)});
  } catch (err) {
    throw networkError(err);
  }
  if (!res.ok) throw new CloudError("Couldn't download the cloud copy. Try again.", 'server');
  try {
    return await res.json();
  } catch {
    throw new CloudError(MSG.damaged, 'invalid');
  }
}

/** @param {{snapshotAt?: string|null, snapshotDevice?: string|null}} remote */
function conflictMessage(remote) {
  const who = remote.snapshotDevice ? ` on ${remote.snapshotDevice}` : ' on another phone';
  return `The cloud copy was changed${who}. Pick which copy to keep.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cloud stalls
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Stalls in the signed-in account (or the team stall). Each row gets `localId`: the entry on this phone linked to it, or null.
 * @returns {Promise<any[]>}
 */
export async function listCloudStalls() {
  const s = requireUser();
  const rows = await authed('query', 'stalls:list', {token: s.token});
  const list = Array.isArray(rows) ? rows : [];
  /** @type {Map<string, string>} */
  const local = new Map();
  try {
    for (const e of (await getMeta()).stalls) if (e.cloud && e.cloud.stallId) local.set(e.cloud.stallId, e.id);
  } catch {
    // older storage: no local mapping
  }
  return list.map(r => ({...r, localId: local.get(r.id) ?? null}));
}

/**
 * Save a local stall to the signed-in account: stalls:create, then the first push.
 * Already linked → just pushes. Offline after creating → the link stays and the push waits for internet.
 * @param {string} entryId
 * @returns {Promise<any>} entry.cloud
 */
export async function linkStall(entryId) {
  const s = requireUser();
  const entry = await getEntry(entryId);
  if (!entry.cloud) {
    const state = await readEntryState(entry);
    const created = await authed('mutation', 'stalls:create', {token: s.token, info: stallInfo(state)});
    if (!created || typeof created.id !== 'string') throw new CloudError(MSG.generic, 'server');
    await patchCloud(entryId, {
      stallId: created.id,
      code: typeof created.code === 'string' ? created.code : '',
      ownerLoginId: s.user ? s.user.loginId : null,
      revision: Number.isSafeInteger(created.revision) ? created.revision : 0,
      dirty: true,
      status: 'pending',
      syncedAt: null,
      lastError: null,
      access: 'owner',
    }, {whole: true});
  }
  try {
    await pushStall(entryId);
  } catch (err) {
    if (!(err instanceof CloudError && err.code === 'offline')) throw err;
  }
  return (await getEntry(entryId)).cloud;
}

/**
 * Upload this phone's copy of a linked stall. Serialized per stall.
 * Resolves {ok: true, revision} | {ok: true, skipped: true} (nothing new) | {ok: false, conflict: true, revision, snapshotAt, snapshotDevice}.
 * Throws a CloudError (after recording status 'offline' / 'error') when it could not finish.
 * @param {string} entryId
 * @param {{force?: boolean}} [options] force: overwrite the cloud copy even if another device changed it ("Use this device's copy")
 */
export function pushStall(entryId, {force = false} = {}) {
  return lock(stallLocks, entryId, () => doPush(entryId, force));
}

/** @param {string} entryId @param {boolean} force */
async function doPush(entryId, force) {
  clearTimer(entryId);
  const entry = await getEntry(entryId);
  const cloud = entry.cloud;
  if (!cloud) throw new CloudError(MSG.notLinked, 'not-linked');
  if (!force && !cloud.dirty && cloud.status === 'synced') return {ok: true, revision: cloud.revision, skipped: true};
  const token = tokenFor(cloud);
  if (!token) {
    await patchCloud(entryId, {status: 'pending', dirty: true, lastError: MSG.loginToSync});
    throw new CloudError(MSG.loginToSync, 'signed-out');
  }
  if (!isOnline()) {
    await patchCloud(entryId, {status: 'offline', dirty: true});
    throw new CloudError(MSG.offline, 'offline');
  }
  busy.add(entryId);
  try {
    await patchCloud(entryId, {status: 'syncing', lastError: null});
    const state = await readEntryState(entry);
    const readRevision = state.revision;
    const blob = await snapshotBlob(state);
    const uploadUrl = await authed('mutation', 'stalls:generateUploadUrl', {token});
    if (typeof uploadUrl !== 'string' || !uploadUrl) throw new CloudError(MSG.generic, 'server');
    const storageId = await uploadBlob(uploadUrl, blob);
    const res = await authed('mutation', 'stalls:commitSnapshot', {
      token,
      stallId: cloud.stallId,
      storageId,
      baseRevision: Number.isSafeInteger(cloud.revision) ? cloud.revision : 0,
      bytes: blob.size,
      summary: stallSummary(state, entry),
      info: stallInfo(state),
      device: deviceLabel(),
      force: Boolean(force),
    });
    if (res && res.ok) {
      // A sale committed while we were uploading keeps the stall dirty and queues the next push.
      let later = false;
      try {
        later = (await readEntryState(entry)).revision !== readRevision;
      } catch {
        later = false;
      }
      busy.delete(entryId);
      await patchCloud(entryId, {revision: res.revision, dirty: later, status: later ? 'pending' : 'synced', syncedAt: nowIso(), lastError: null});
      if (later && started) schedule(entryId);
      return {ok: true, revision: res.revision};
    }
    if (res && res.conflict) {
      const remote = {revision: res.revision, snapshotAt: res.snapshotAt ?? null, snapshotDevice: res.snapshotDevice ?? null};
      busy.delete(entryId);
      await patchCloud(entryId, {status: 'conflict', dirty: true, lastError: conflictMessage(remote)});
      return {ok: false, conflict: true, ...remote};
    }
    throw new CloudError(MSG.generic, 'server');
  } catch (err) {
    const e = toCloudError(err);
    busy.delete(entryId);
    try {
      await patchCloud(entryId, {status: e.code === 'offline' ? 'offline' : 'error', dirty: true, lastError: e.message});
    } catch {
      // the entry may have been deleted meanwhile
    }
    throw e;
  } finally {
    busy.delete(entryId);
  }
}

/**
 * Download the cloud copy into this phone.
 * - an entry id: overwrites that local entry (refused with code 'dirty' when it has unsynced changes and is not in conflict,
 *   unless {force: true}); the active stall is swapped in place (replaceAll + reloadMedia + render).
 * - {cloudStallId}: updates the local entry linked to it, or creates a new entry (which becomes active and is opened).
 * Every download is checked with validateBackup first; a tampered or damaged snapshot is rejected and nothing changes.
 * @param {string | {cloudStallId: string}} target
 * @param {{force?: boolean, open?: boolean, access?: 'owner'|'team', code?: string}} [options]
 * @returns {Promise<{entryId: string, created: boolean, revision: number, warnings: string[]}>}
 */
export async function pullStall(target, options = {}) {
  let entryId = typeof target === 'string' ? target : null;
  let cloudStallId = target && typeof target === 'object' ? String(target.cloudStallId || '') : '';
  if (entryId) {
    const entry = await getEntry(entryId);
    if (!entry.cloud || !entry.cloud.stallId) throw new CloudError("This stall isn't saved in the cloud yet.", 'not-linked');
    cloudStallId = entry.cloud.stallId;
  } else {
    if (!cloudStallId) throw new CloudError("This stall isn't saved in the cloud yet.", 'not-linked');
    try {
      entryId = (await getMeta()).stalls.find(e => e.cloud && e.cloud.stallId === cloudStallId)?.id ?? null;
    } catch {
      entryId = null;
    }
  }
  const key = entryId || `cloud:${cloudStallId}`;
  return lock(stallLocks, key, () => doPull(entryId, cloudStallId, options));
}

/**
 * @param {string|null} entryId @param {string} cloudStallId
 * @param {{force?: boolean, open?: boolean, access?: 'owner'|'team', code?: string}} options
 */
async function doPull(entryId, cloudStallId, {force = false, open = true, access, code} = {}) {
  const meta = await getMeta();
  let entry = entryId ? meta.stalls.find(e => e.id === entryId) : meta.stalls.find(e => e.cloud && e.cloud.stallId === cloudStallId);
  if (entryId && !entry) throw new CloudError(MSG.missing, 'missing');
  const cloudRef = entry && entry.cloud
    ? entry.cloud
    : {stallId: cloudStallId, access: access || (signedIn() ? 'owner' : 'team')};
  if (entry && entry.cloud && entry.cloud.dirty && entry.cloud.status !== 'conflict' && !force) throw new CloudError(MSG.dirty, 'dirty');
  const token = tokenFor(cloudRef);
  if (!token) throw new CloudError(cloudRef.access === 'team' ? 'Join this stall with its code and team password first.' : MSG.signedOut, 'signed-out');

  if (entry) busy.add(entry.id);
  if (entry) emit(entry.id);
  try {
    const snap = await authed('query', 'stalls:getSnapshot', {token, stallId: cloudStallId});
    if (!snap || typeof snap.url !== 'string' || !snap.url) throw new CloudError(MSG.noSnapshot, 'empty');
    const raw = await downloadJson(snap.url);
    let backup;
    try {
      backup = validateBackup(raw);
    } catch (err) {
      throw new CloudError(MSG.damaged, 'invalid', /** @type {Error} */ (err).message);
    }
    const {state, media, warnings} = backup;
    const st = deps.storage;
    const linked = {
      stallId: cloudStallId,
      code: (entry && entry.cloud && entry.cloud.code) || code || '',
      ownerLoginId: entry && entry.cloud ? entry.cloud.ownerLoginId ?? null : cloudRef.access === 'owner' ? session()?.user?.loginId ?? null : null,
      revision: Number.isSafeInteger(snap.revision) ? snap.revision : 0,
      dirty: false,
      status: 'synced',
      syncedAt: nowIso(),
      lastError: null,
      access: (entry && entry.cloud && entry.cloud.access) || cloudRef.access || 'owner',
    };
    let created = false;
    let targetId;
    if (entry && entry.id === meta.activeStallId) {
      // The open counter: swap state + photos atomically (storage keeps photos other stalls on this phone still use).
      const stored = await storageFn('replaceAll')(state, media);
      targetId = entry.id;
      clearTimer(targetId);
      await patchCloud(targetId, linked, {whole: true});
      const core = await getCore();
      if (core.store) core.store.state = stored && typeof stored === 'object' ? stored : state;
      if (typeof core.reloadMedia === 'function') await core.reloadMedia();
      if (typeof core.refreshMeta === 'function') await core.refreshMeta().catch(() => {});
      if (typeof core.render === 'function') core.render();
    } else if (entry) {
      for (const [id, data] of Object.entries(media)) await storageFn('putMedia')(id, data);
      await storageFn('writeStall')(entry.id, state);
      targetId = entry.id;
      clearTimer(targetId);
      await patchCloud(targetId, linked, {whole: true});
    } else {
      for (const [id, data] of Object.entries(media)) await storageFn('putMedia')(id, data);
      const made = await storageFn('createStall')(state, {open});
      targetId = made && made.entry ? made.entry.id : null;
      if (!targetId) throw new CloudError(MSG.generic, 'error');
      created = true;
      await patchCloud(targetId, linked, {whole: true});
      if (open) {
        const core = await getCore();
        if (typeof core.openStallById === 'function') await core.openStallById(targetId);
      }
    }
    if (typeof st.pruneMedia === 'function') st.pruneMedia().catch(() => {});
    return {entryId: /** @type {string} */ (targetId), created, revision: linked.revision, warnings};
  } finally {
    if (entry) {
      busy.delete(entry.id);
      emit(entry.id);
    }
  }
}

/**
 * Join a friend's stall with its code + team password, then download it to this phone.
 * The team session is stored per stall; it never replaces the MYS account session.
 * @param {{code: string, password: string}} input
 */
export async function joinStall({code, password}) {
  let c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length === 8 && c.startsWith('MYS')) c = c.slice(3);
  c = `MYS-${c}`;
  if (!CODE_RE.test(c)) throw new CloudError('Stall codes look like MYS-AB3CD. Check it with the owner.', 'invalid');
  if (typeof password !== 'string' || !password) throw new CloudError('Enter the team password.', 'invalid');
  const res = await call('action', 'stalls:join', {code: c, password, deviceId: deviceId(), deviceLabel: deviceLabel()});
  if (!res || typeof res.token !== 'string' || !res.stall || typeof res.stall.id !== 'string') throw new CloudError(MSG.generic, 'server');
  saveTeam(res.stall.id, {token: res.token, code: res.stall.code || c, name: res.stall.name || ''});
  const pulled = await pullStall({cloudStallId: res.stall.id}, {access: 'team', code: res.stall.code || c});
  return {...pulled, stall: res.stall};
}

/**
 * Set (or remove with null) the team password of a linked stall. Owner only.
 * @param {string} entryId @param {string | null} password
 */
export async function setTeamPassword(entryId, password) {
  const entry = await getEntry(entryId);
  if (!entry.cloud) throw new CloudError(MSG.notLinked, 'not-linked');
  if (entry.cloud.access === 'team') throw new CloudError(MSG.ownerOnly, 'owner');
  const s = requireUser();
  const pass = password === null ? null : cleanPassword(password, 'Team password');
  await authed('action', 'stalls:setTeamPassword', {token: s.token, stallId: entry.cloud.stallId, password: pass});
  return true;
}

/**
 * Delete the cloud copy of a stall (owner only). The stall stays on this phone, unlinked.
 * @param {string} entryId
 */
export async function removeCloudStall(entryId) {
  const entry = await getEntry(entryId);
  if (!entry.cloud) return true;
  if (entry.cloud.access === 'team') throw new CloudError(MSG.ownerOnly, 'owner');
  const s = requireUser();
  await lock(stallLocks, entryId, async () => {
    clearTimer(entryId);
    await authed('mutation', 'stalls:remove', {token: s.token, stallId: entry.cloud.stallId});
    await patchCloud(entryId, null, {whole: true});
  });
  return true;
}

/**
 * Forget the cloud link on this phone only (e.g. a helper leaving a team stall). Nothing is deleted anywhere.
 * @param {string} entryId
 */
export async function unlinkStall(entryId) {
  const entry = await getEntry(entryId);
  if (!entry.cloud) return true;
  await lock(stallLocks, entryId, async () => {
    clearTimer(entryId);
    if (entry.cloud.access === 'team') saveTeam(entry.cloud.stallId, null);
    await patchCloud(entryId, null, {whole: true});
  });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Background sync
// ---------------------------------------------------------------------------------------------------------------------

let started = false;
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const timers = new Map();
/** @type {Array<() => void>} */
let teardown = [];

/** @param {string} entryId */
function clearTimer(entryId) {
  const t = timers.get(entryId);
  if (t !== undefined) clearTimeout(t);
  timers.delete(entryId);
}

/** @param {string} entryId @param {number} [delay] */
function schedule(entryId, delay = SYNC_DEBOUNCE_MS) {
  clearTimer(entryId);
  timers.set(entryId, setTimeout(() => {
    timers.delete(entryId);
    autoPush(entryId).catch(() => {});
  }, delay));
}

/**
 * Push now if it can work (online, a token, not in conflict); otherwise just record why it waits.
 * @param {string} entryId
 */
async function autoPush(entryId) {
  const entry = entries.get(entryId) || (await getMeta()).stalls.find(e => e.id === entryId);
  const cloud = entry && entry.cloud;
  if (!cloud || cloud.status === 'conflict') return;
  if (!isOnline()) {
    if (cloud.status !== 'offline') await patchCloud(entryId, {status: 'offline', dirty: true});
    return;
  }
  if (!tokenFor(cloud)) {
    if (cloud.lastError !== MSG.loginToSync) await patchCloud(entryId, {status: 'pending', dirty: true, lastError: MSG.loginToSync});
    return;
  }
  try {
    await pushStall(entryId);
  } catch {
    // status + lastError already recorded on the entry
  }
}

/**
 * Called by the kernel after every committed write: mark the linked stall dirty and debounce a push.
 * @param {{stallId?: string, state?: any}} info
 */
async function handleCommitted(info) {
  const entryId = info && typeof info.stallId === 'string' ? info.stallId : activeId;
  if (!entryId) return;
  const cloud = await patchCloud(entryId, c => {
    if (c.dirty && c.status !== 'synced') return null;
    return {dirty: true, status: c.status === 'conflict' ? 'conflict' : isOnline() ? 'pending' : 'offline'};
  });
  if (cloud && cloud.status !== 'conflict') schedule(entryId);
}

/**
 * Mark a linked stall as changed and queue a push (for edits made without core.commit, e.g. editing a non-active stall).
 * @param {string} entryId
 */
export function markDirty(entryId) {
  return handleCommitted({stallId: entryId});
}

/** Push every dirty linked stall now (sequential per stall). */
async function syncAllDirty() {
  let meta;
  try {
    meta = await getMeta();
  } catch {
    return;
  }
  await Promise.all(meta.stalls.filter(e => e.cloud && e.cloud.dirty && e.cloud.status !== 'conflict').map(e => autoPush(e.id).catch(() => {})));
}

/**
 * Push pending changes right away (e.g. before leaving a stall). Never throws; gives up waiting after a few seconds.
 * @param {string} [entryId] one stall, or every dirty one
 */
export async function flushSync(entryId) {
  const work = entryId ? autoPush(entryId) : syncAllDirty();
  let timer;
  await Promise.race([
    work.catch(() => {}),
    new Promise(resolve => {
      timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Start background sync (idempotent): subscribes to core.onCommitted, retries on 'online', pushes when the page is hidden,
 * and resumes stalls left dirty by an earlier visit.
 */
export async function startSync() {
  if (started) return;
  started = true;
  const core = await getCore();
  if (typeof core.onCommitted === 'function') {
    const off = core.onCommitted((/** @type {any} */ info) => {
      handleCommitted(info).catch(err => console.warn('MYS cloud: could not queue sync', err));
    });
    if (typeof off === 'function') teardown.push(off);
  } else {
    console.warn('MYS cloud: core.onCommitted is missing, background sync is off');
  }
  const win = deps.win();
  const doc = deps.doc();
  if (win && typeof win.addEventListener === 'function') {
    const onOnline = () => {
      emit(null);
      syncAllDirty();
    };
    const onOffline = () => emit(null);
    const onStorage = (/** @type {any} */ e) => {
      if (!e || e.key === SESSION_KEY || e.key === TEAM_KEY || e.key === null) emit(null);
    };
    win.addEventListener('online', onOnline);
    win.addEventListener('offline', onOffline);
    win.addEventListener('storage', onStorage);
    teardown.push(() => {
      win.removeEventListener('online', onOnline);
      win.removeEventListener('offline', onOffline);
      win.removeEventListener('storage', onStorage);
    });
  }
  if (doc && typeof doc.addEventListener === 'function') {
    const onVisibility = () => {
      if (doc.visibilityState !== 'hidden') return;
      const pending = [...timers.keys()];
      for (const id of pending) {
        clearTimer(id);
        autoPush(id).catch(() => {});
      }
    };
    doc.addEventListener('visibilitychange', onVisibility);
    teardown.push(() => doc.removeEventListener('visibilitychange', onVisibility));
  }
  if (typeof deps.storage.onExternalChange === 'function') {
    const off = deps.storage.onExternalChange((/** @type {any} */ msg) => {
      const data = msg && typeof msg === 'object' && 'data' in msg ? msg.data : msg;
      if (data && typeof data === 'object' && data.type === 'meta') {
        getMeta().then(() => emit(typeof data.stallId === 'string' ? data.stallId : null), () => {});
      }
    });
    if (typeof off === 'function') teardown.push(off);
  }
  // A tab closed mid-push leaves 'syncing' behind: settle it, then resume dirty stalls.
  try {
    const meta = await getMeta();
    for (const e of meta.stalls) {
      if (e.cloud && e.cloud.status === 'syncing' && !busy.has(e.id)) {
        await patchCloud(e.id, c => (c.status === 'syncing' ? {status: c.dirty ? 'pending' : 'synced'} : null));
      }
    }
  } catch {
    // older storage without getMeta: nothing to resume
  }
  syncAllDirty();
}

// ---------------------------------------------------------------------------------------------------------------------
// Status for the UI
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Set<(change: {entryId: string|null, state: any}) => void>} */
const listeners = new Set();

/** @param {string|null} entryId */
function emit(entryId) {
  if (!listeners.size) return;
  const change = {entryId, state: entryId ? syncState(entryId) : null};
  for (const fn of [...listeners]) {
    try {
      fn(change);
    } catch (err) {
      console.warn('MYS cloud: a sync listener failed', err);
    }
  }
}

/**
 * Subscribe to sync/session status changes. `fn({entryId, state})`; entryId null = session/online change (refresh everything).
 * @param {(change: {entryId: string|null, state: any}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const LABELS = Object.freeze({
  local: 'Saved on device',
  synced: 'Synced ✓',
  syncing: 'Syncing…',
  pending: 'Waiting to sync',
  offline: 'Offline – will sync',
  login: 'Log in to sync',
  conflict: 'Needs attention',
  error: 'Needs attention',
});

/**
 * Sync status of a stall for badges and pills.
 * @param {string | {id: string, cloud?: any}} entryOrId an entry id (uses the last seen metadata) or a StallEntry
 * @returns {{linked: boolean, status: string, label: string, tone: 'ok'|'muted'|'warn'|'error', detail: string,
 *   dirty: boolean, syncedAt: string|null, lastError: string|null, revision: number, code: string, access: string|null, stallId: string|null}}
 */
export function syncState(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  const entry = typeof entryOrId === 'string' ? entries.get(entryOrId) : entryOrId;
  const cloud = entry && entry.cloud;
  if (!cloud) {
    return {linked: false, status: 'local', label: LABELS.local, tone: 'muted', detail: 'This stall lives only on this phone.',
      dirty: false, syncedAt: null, lastError: null, revision: 0, code: '', access: null, stallId: null};
  }
  let status = id && busy.has(id) ? 'syncing' : String(cloud.status || 'pending');
  let label = LABELS[/** @type {keyof typeof LABELS} */ (status)] || LABELS.pending;
  let tone = /** @type {'ok'|'muted'|'warn'|'error'} */ ('muted');
  let detail = '';
  if (status === 'synced') {
    tone = 'ok';
    detail = 'The cloud copy matches this phone.';
  } else if (status === 'syncing') {
    detail = 'Copying this stall to the cloud…';
  } else if (status === 'conflict') {
    tone = 'error';
    detail = cloud.lastError || 'The cloud copy was changed on another phone. Pick which copy to keep.';
  } else if (status === 'error') {
    tone = 'error';
    detail = cloud.lastError || 'The last sync failed. Your data is safe on this phone.';
  } else if (status === 'offline' || ((status === 'pending') && !isOnline())) {
    status = 'offline';
    label = LABELS.offline;
    tone = 'warn';
    detail = 'Saved on this phone. It will sync when the internet is back.';
  } else if (!tokenFor(cloud)) {
    label = LABELS.login;
    tone = 'warn';
    detail = cloud.access === 'team' ? 'Join again with the stall code to keep syncing.' : 'Log in to your MYS account to sync this stall.';
  } else {
    tone = 'warn';
    detail = 'New sales will sync in a few seconds.';
  }
  return {
    linked: true,
    status,
    label,
    tone,
    detail,
    dirty: Boolean(cloud.dirty),
    syncedAt: cloud.syncedAt ?? null,
    lastError: cloud.lastError ?? null,
    revision: Number.isSafeInteger(cloud.revision) ? cloud.revision : 0,
    code: typeof cloud.code === 'string' ? cloud.code : '',
    access: cloud.access || 'owner',
    stallId: cloud.stallId || null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Test hooks (unit tests only; the app never calls these)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Replace dependencies (storage, core, url, fetch, localStorage, online, win, doc, userAgent) and reset module state.
 * @param {Partial<Deps>} [overrides]
 */
export function __setCloudDeps(overrides = {}) {
  for (const off of teardown) off();
  teardown = [];
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  listeners.clear();
  entries.clear();
  entryLocks.clear();
  stallLocks.clear();
  busy.clear();
  memoryStore.clear();
  activeId = null;
  started = false;
  deps = {...defaultDeps(), ...overrides};
}
