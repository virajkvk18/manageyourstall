// Cloud client & sync tests (dist/cloud.mjs, ARCHITECTURE.md §17.4).
// Everything runs in Node against an in-memory fake of the Convex HTTP API (mocked fetch), an in-memory fake of the
// §17.1 storage contract and a fake UI kernel; the last test uses the real storage.mjs on fake-indexeddb.
// No network is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

globalThis.BroadcastChannel = undefined;

const cloud = await import('../dist/cloud.mjs');
const {initialState, validateBackup} = await import('../dist/domain.mjs');

const URL_BASE = 'https://unit-test.convex.cloud';
const UPLOAD = 'https://unit-test.convex.cloud/api/storage/upload?token=';
const FILES = 'https://unit-test.convex.site/files/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** Let queued promise chains and I/O callbacks run (setImmediate is never mocked). */
const settle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
};

// ---------------------------------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

/** ConvexError-like failure: the HTTP API puts the string in errorData. */
const fail = msg => {
  throw Object.assign(Error(msg), {convex: true});
};

/** In-memory Convex backend speaking the HTTP API (§17.3 functions). */
function fakeBackend() {
  const users = new Map(); // loginId → {id, loginId, name, password}
  const sessions = new Map(); // token → {kind, userId?, stallId?, deviceLabel}
  const stalls = new Map(); // id → stall
  const files = new Map(); // storageId → text
  const log = [];
  let seq = 0;
  let inFlightCommits = 0;
  let maxInFlightCommits = 0;
  const hooks = {beforeUploadResponse: null, tamper: null, uploadDelay: 0};
  const next = p => `${p}${++seq}`;
  const tokenFor = sess => {
    const token = `tok_${next('t')}_${'x'.repeat(24)}`;
    sessions.set(token, sess);
    return token;
  };
  const need = token => sessions.get(token) || fail("You're logged out. Please log in again.");
  const userOf = token => {
    const s = need(token);
    if (s.kind !== 'user') fail("Team logins can't do this. Log in with the owner's MYS account.");
    return [...users.values()].find(u => u.id === s.userId);
  };
  const stallFor = (token, stallId, ownerOnly = false) => {
    const s = need(token);
    const stall = stalls.get(stallId);
    if (s.kind === 'stall') {
      if (ownerOnly) fail('Only the stall owner can do this. Log in with the owner\'s MYS account.');
      if (!stall || s.stallId !== stallId) fail('This team login only works for its own stall.');
      return stall;
    }
    if (!stall || stall.ownerId !== s.userId) fail('Stall not found in your account.');
    return stall;
  };
  const pub = u => ({id: u.id, loginId: u.loginId, name: u.name});
  const publicStall = s => ({id: s.id, code: s.code, name: s.name, booth: s.booth, revision: s.revision, summary: s.summary,
    hasTeamPassword: Boolean(s.teamPassword), snapshotAt: s.snapshotAt ?? null, snapshotDevice: s.snapshotDevice ?? null});

  const fns = {
    'auth:signUp': a => {
      if (users.has(a.loginId)) fail('That login ID is already taken. Log in instead, or pick another one.');
      const u = {id: next('user'), loginId: a.loginId, name: a.name || a.loginId, password: a.password};
      users.set(u.loginId, u);
      return {token: tokenFor({kind: 'user', userId: u.id, deviceLabel: a.deviceLabel}), user: pub(u)};
    },
    'auth:logIn': a => {
      const u = users.get(a.loginId);
      if (!u || u.password !== a.password) fail('Login ID or password is wrong.');
      return {token: tokenFor({kind: 'user', userId: u.id, deviceLabel: a.deviceLabel}), user: pub(u)};
    },
    'auth:logOut': a => {
      sessions.delete(a.token);
      return null;
    },
    'auth:me': a => {
      const s = sessions.get(a.token);
      if (!s) return null;
      if (s.kind === 'stall') return {user: null, kind: 'stall', stallId: s.stallId};
      return {user: pub([...users.values()].find(u => u.id === s.userId)), kind: 'user'};
    },
    'auth:changePassword': a => {
      const u = userOf(a.token);
      if (u.password !== a.oldPassword) fail('Current password is wrong.');
      u.password = a.newPassword;
      return null;
    },
    'auth:updateProfile': a => {
      const u = userOf(a.token);
      u.name = a.name;
      return pub(u);
    },
    'stalls:list': a => {
      const s = need(a.token);
      if (s.kind === 'stall') return [publicStall(stalls.get(s.stallId))];
      return [...stalls.values()].filter(x => x.ownerId === s.userId).map(publicStall);
    },
    'stalls:create': a => {
      const u = userOf(a.token);
      if (!a.info || !a.info.name) fail('Give your stall a name.');
      const id = next('stall');
      const code = `MYS-${'ABCDEFGHJK'[seq % 10]}${'MNPQR'[seq % 5]}${'23456'[seq % 5]}${'STUVW'[seq % 5]}${'XYZ78'[seq % 5]}`;
      stalls.set(id, {id, code, ownerId: u.id, ...a.info, revision: 0, summary: {orders: 0, collected: 0, bills: 0}, snapshotId: null});
      return {id, code};
    },
    'stalls:remove': a => {
      const stall = stallFor(a.token, a.stallId, true);
      stalls.delete(stall.id);
      return null;
    },
    'stalls:generateUploadUrl': a => {
      need(a.token);
      return UPLOAD + next('up');
    },
    'stalls:commitSnapshot': a => {
      const stall = stallFor(a.token, a.stallId);
      if (!files.has(a.storageId)) fail("The upload didn't arrive. Please sync again.");
      if (!a.force && a.baseRevision !== stall.revision) {
        files.delete(a.storageId);
        return {ok: false, conflict: true, revision: stall.revision, snapshotAt: stall.snapshotAt, snapshotDevice: stall.snapshotDevice};
      }
      stall.revision += 1;
      stall.snapshotId = a.storageId;
      stall.snapshotAt = new Date().toISOString();
      stall.snapshotDevice = a.device;
      stall.summary = a.summary;
      Object.assign(stall, a.info || {});
      return {ok: true, revision: stall.revision};
    },
    'stalls:getSnapshot': a => {
      const stall = stallFor(a.token, a.stallId);
      if (!stall.snapshotId) return null;
      return {url: FILES + stall.snapshotId, revision: stall.revision, snapshotAt: stall.snapshotAt, snapshotDevice: stall.snapshotDevice, bytes: 1};
    },
    'stalls:setTeamPassword': a => {
      const stall = stallFor(a.token, a.stallId, true);
      stall.teamPassword = a.password;
      return null;
    },
    'stalls:join': a => {
      const stall = [...stalls.values()].find(s => s.code === a.code);
      if (!stall || !stall.teamPassword || stall.teamPassword !== a.password) fail('That stall code or team password is wrong.');
      return {token: tokenFor({kind: 'stall', stallId: stall.id, deviceLabel: a.deviceLabel}), stall: {id: stall.id, code: stall.code, name: stall.name}};
    },
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

  async function fetch(url, init = {}) {
    if (url.startsWith(UPLOAD)) {
      const text = await init.body.text();
      log.push({type: 'upload', url, headers: init.headers, bytes: init.body.size, text});
      if (hooks.uploadDelay) await new Promise(resolve => setTimeout(resolve, hooks.uploadDelay));
      if (hooks.beforeUploadResponse) await hooks.beforeUploadResponse();
      const storageId = next('kg');
      files.set(storageId, text);
      return json({storageId});
    }
    if (url.startsWith(FILES)) {
      const id = url.slice(FILES.length);
      log.push({type: 'download', id});
      let text = files.get(id);
      if (hooks.tamper) text = hooks.tamper(text);
      return new Response(text, {status: 200});
    }
    const m = /^https:\/\/unit-test\.convex\.cloud\/api\/(query|mutation|action)$/.exec(url);
    if (!m) throw new TypeError('fetch failed');
    const body = JSON.parse(init.body);
    log.push({type: 'call', kind: m[1], path: body.path, args: body.args, format: body.format, headers: init.headers, method: init.method});
    const fn = fns[body.path];
    if (!fn) return json({status: 'error', errorMessage: `Could not find public function for '${body.path}'`}, 404);
    if (body.path === 'stalls:commitSnapshot') {
      inFlightCommits++;
      maxInFlightCommits = Math.max(maxInFlightCommits, inFlightCommits);
      await new Promise(resolve => setImmediate(resolve));
      inFlightCommits--;
    }
    try {
      return json({status: 'success', value: structuredClone(fn(body.args))});
    } catch (err) {
      if (!err.convex) throw err;
      return json({status: 'error', errorMessage: `[CONVEX] Uncaught ConvexError: ${err.message}`, errorData: err.message}, 400);
    }
  }

  return {
    fetch,
    users,
    sessions,
    stalls,
    files,
    log,
    hooks,
    calls: path => log.filter(l => l.type === 'call' && (!path || l.path === path)),
    get maxInFlightCommits() {
      return maxInFlightCommits;
    },
  };
}

/** In-memory implementation of the §17.1 storage contract (just what cloud.mjs uses). */
function fakeStorage() {
  const meta = {version: 1, activeStallId: null, stalls: []};
  const states = new Map();
  const media = {};
  const log = [];
  const entry = id => meta.stalls.find(e => e.id === id) || (() => {
    throw Error('That stall isn’t on this phone any more.');
  })();
  let n = 0;
  return {
    meta,
    states,
    media,
    log,
    async getMeta() {
      return structuredClone(meta);
    },
    async readStall(id) {
      return structuredClone(states.get(entry(id).key));
    },
    async writeStall(id, state) {
      log.push(['writeStall', id]);
      states.set(entry(id).key, structuredClone(state));
      return state;
    },
    async updateEntry(id, patch) {
      const e = entry(id);
      if ('cloud' in patch) e.cloud = patch.cloud === null ? null : {...(e.cloud || {}), ...patch.cloud};
      return structuredClone(e);
    },
    async createStall(state, {open = true} = {}) {
      const id = `local${++n}`;
      const e = {id, key: `stall:${id}`, summary: {}, cloud: null, openedAt: null};
      meta.stalls.push(e);
      const next = structuredClone(state);
      next.revision += 1;
      states.set(e.key, next);
      if (open) meta.activeStallId = id;
      log.push(['createStall', id, open]);
      return {entry: structuredClone(e), state: next};
    },
    async getAllMedia() {
      return {...media};
    },
    async putMedia(id, data) {
      media[id] = data;
    },
    async replaceAll(state, m) {
      log.push(['replaceAll', meta.activeStallId]);
      states.set(entry(meta.activeStallId).key, structuredClone(state));
      Object.assign(media, m);
      return state;
    },
    async pruneMedia() {
      return 0;
    },
    onExternalChange() {
      return () => {};
    },
    /** Test helper: add a local stall. */
    add(state, {active = false} = {}) {
      const id = `local${++n}`;
      meta.stalls.push({id, key: `stall:${id}`, summary: {}, cloud: null, openedAt: null});
      states.set(`stall:${id}`, structuredClone(state));
      if (active) meta.activeStallId = id;
      return id;
    },
    /** Test helper: a committed sale-like write (bumps revision). */
    write(id, fn) {
      const st = states.get(entry(id).key);
      fn(st);
      st.revision += 1;
      return structuredClone(st);
    },
    cloudOf(id) {
      return entry(id).cloud;
    },
  };
}

/** Fake UI kernel. */
function fakeCore() {
  const core = {
    store: {state: null},
    committed: null,
    reloads: 0,
    renders: 0,
    opened: [],
    onCommitted(fn) {
      core.committed = fn;
      return () => {
        core.committed = null;
      };
    },
    async reloadMedia() {
      core.reloads++;
    },
    render() {
      core.renders++;
    },
    async openStallById(id) {
      core.opened.push(id);
    },
  };
  return core;
}

function stallState(name = 'Chaat Corner', {photo = false} = {}) {
  const st = initialState();
  st.onboarded = true;
  st.config.profile.stallName = name;
  st.config.profile.booth = 'B-12';
  st.config.profile.eventName = 'Diwali Mela';
  st.config.profile.city = 'Jabalpur';
  if (photo) st.config.products[0].image = 'media:photo1';
  return st;
}

/** Fresh module + fakes. */
function setup({online = true, ua = CHROME_ANDROID} = {}) {
  const backend = fakeBackend();
  const storage = fakeStorage();
  const core = fakeCore();
  const ls = new MemoryStorage();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {visibilityState: 'visible'});
  const net = {online};
  cloud.__setCloudDeps({
    storage,
    core,
    url: URL_BASE,
    fetch: backend.fetch,
    localStorage: () => ls,
    online: () => net.online,
    win: () => win,
    doc: () => doc,
    userAgent: () => ua,
  });
  return {backend, storage, core, ls, win, doc, net};
}

async function signedInSetup(opts) {
  const env = setup(opts);
  await cloud.signUp({loginId: 'Test-Owner@Example.com', password: 'secret123', name: 'Viraj'});
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP API & errors
// ---------------------------------------------------------------------------------------------------------------------

test('call() posts {path, args, format: json} to /api/<kind> and returns the value', async () => {
  const {backend} = setup();
  const res = await cloud.call('mutation', 'auth:signUp', {loginId: 'abc', password: 'secret1', name: 'A'});
  assert.equal(res.user.loginId, 'abc');
  const [c] = backend.calls();
  assert.equal(c.kind, 'mutation');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['Content-Type'], 'application/json');
  assert.equal(c.path, 'auth:signUp');
  assert.equal(c.format, 'json');
  assert.deepEqual(c.args, {loginId: 'abc', password: 'secret1', name: 'A'});
});

test('errors map to friendly CloudErrors', async () => {
  setup();
  // ConvexError string → shown as is
  await assert.rejects(cloud.logIn({loginId: 'nobody', password: 'whatever'}), err => {
    assert.ok(err instanceof cloud.CloudError);
    assert.equal(err.message, 'Login ID or password is wrong.');
    assert.equal(err.code, 'server');
    return true;
  });
  // Non-ConvexError (no errorData) → generic, never the raw server text
  await assert.rejects(cloud.call('query', 'nope:missing', {}), err => err.code === 'server' && /hit a snag/.test(err.message) && !/Could not find/.test(err.message));

  const cases = [
    [async () => new Response('<html>502</html>', {status: 502}), 'server', /hit a snag/],
    [async () => {
      throw new TypeError('fetch failed');
    }, 'offline', /Couldn't reach the MYS cloud/],
    [async () => {
      throw Object.assign(Error('aborted'), {name: 'TimeoutError'});
    }, 'offline', /too slow/],
    [async () => new Response(JSON.stringify({status: 'error', errorData: {message: 'Object message.'}}), {status: 400}), 'server', /^Object message\.$/],
    [async () => new Response(JSON.stringify({status: 'error', errorData: "You're logged out. Please log in again."}), {status: 400}), 'auth', /log in again/],
  ];
  for (const [fetch, code, re] of cases) {
    cloud.__setCloudDeps({url: URL_BASE, fetch, localStorage: () => new MemoryStorage(), online: () => true});
    await assert.rejects(cloud.call('query', 'auth:me', {token: 'x'}), err => {
      assert.ok(err instanceof cloud.CloudError);
      assert.equal(err.code, code);
      assert.match(err.message, re);
      return true;
    });
  }
});

test('offline: no request is made and the error says the data is safe', async () => {
  const {backend} = setup({online: false});
  await assert.rejects(cloud.call('query', 'auth:me', {token: 'x'}), err => err.code === 'offline' && /safe on this phone/.test(err.message));
  assert.equal(backend.log.length, 0);
  assert.equal(cloud.online(), false);
});

test('cloudReady follows the configured URL', async () => {
  cloud.__setCloudDeps({url: ''});
  assert.equal(cloud.cloudReady(), false);
  await assert.rejects(cloud.call('query', 'auth:me', {}), err => err.code === 'not-ready');
  cloud.__setCloudDeps({url: URL_BASE});
  assert.equal(cloud.cloudReady(), true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Accounts & session
// ---------------------------------------------------------------------------------------------------------------------

test('signUp validates locally, sends device info and persists the session in mys-session', async () => {
  const {backend, ls} = setup();
  await assert.rejects(cloud.signUp({loginId: 'a b', password: 'secret123'}), err => err.code === 'invalid');
  await assert.rejects(cloud.signUp({loginId: 'okay', password: '123'}), err => err.code === 'invalid' && /6 to 100/.test(err.message));
  assert.equal(backend.log.length, 0, 'invalid input never reaches the server');

  const user = await cloud.signUp({loginId: '  Test-Owner@Example.com ', password: 'secret123', name: ' Viraj '});
  assert.equal(user.loginId, 'test-owner@example.com');
  const [c] = backend.calls('auth:signUp');
  assert.equal(c.kind, 'action');
  assert.equal(c.args.loginId, 'test-owner@example.com');
  assert.equal(c.args.name, 'Viraj');
  assert.equal(c.args.deviceLabel, 'Chrome on Android');
  assert.match(c.args.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(c.args.deviceId, cloud.deviceId(), 'device id is stable');
  assert.equal(ls.getItem('mys-device'), c.args.deviceId);

  const stored = JSON.parse(ls.getItem('mys-session'));
  assert.equal(stored.kind, 'user');
  assert.equal(stored.user.name, 'Viraj');
  assert.ok(stored.token);
  assert.deepEqual(cloud.session(), {token: stored.token, user: stored.user, kind: 'user', stallId: null});
  assert.equal(cloud.signedIn(), true);

  await assert.rejects(cloud.signUp({loginId: 'test-owner@example.com', password: 'secret123'}), /already taken/);
});

test('logIn / me / updateName / changePassword / logOut', async () => {
  const {backend, ls, net} = await signedInSetup();
  const changes = [];
  cloud.onSyncChange(c => changes.push(c));
  await cloud.logOut();
  assert.equal(cloud.session(), null);
  assert.equal(ls.getItem('mys-session'), null);
  assert.equal(backend.sessions.size, 0, 'server session ended');
  assert.ok(changes.some(c => c.entryId === null), 'listeners hear about session changes');

  await assert.rejects(cloud.logIn({loginId: 'test-owner@example.com', password: 'wrong-pass'}), /wrong/);
  const user = await cloud.logIn({loginId: 'TEST-OWNER@example.com', password: 'secret123'});
  assert.equal(user.name, 'Viraj');

  assert.equal((await cloud.updateName('  Viraj V  ')), 'Viraj V');
  assert.equal(cloud.session().user.name, 'Viraj V');
  const meNow = await cloud.me();
  assert.equal(meNow.user.name, 'Viraj V');
  assert.equal(meNow.kind, 'user');

  await assert.rejects(cloud.changePassword('nope-nope', 'newsecret1'), /Current password is wrong/);
  await assert.rejects(cloud.changePassword('secret123', '123'), err => err.code === 'invalid');
  assert.equal(await cloud.changePassword('secret123', 'newsecret1'), true);

  // Offline: me() keeps the session (never signs out without asking the server).
  net.online = false;
  const offline = await cloud.me();
  assert.equal(offline.offline, true);
  assert.ok(cloud.session());
  // Offline logOut still clears this phone.
  await cloud.logOut();
  assert.equal(cloud.session(), null);
});

test('me() clears a dead session; an auth error re-validates it', async () => {
  const {backend} = await signedInSetup();
  backend.sessions.clear(); // expired / signed out elsewhere
  await assert.rejects(cloud.listCloudStalls(), err => err.code === 'auth');
  assert.equal(cloud.session(), null, 'dead session cleared after the auth error');
  await assert.rejects(cloud.listCloudStalls(), err => err.code === 'signed-out');
  assert.equal(await cloud.me(), null);
});

test('corrupt mys-session is ignored; a blocked localStorage falls back to memory', async () => {
  const {ls} = setup();
  ls.setItem('mys-session', '{not json');
  assert.equal(cloud.session(), null);
  ls.setItem('mys-session', JSON.stringify({token: '', kind: 'user'}));
  assert.equal(cloud.session(), null);

  const backend = fakeBackend();
  cloud.__setCloudDeps({url: URL_BASE, fetch: backend.fetch, online: () => true, localStorage: () => {
    throw Error('SecurityError');
  }});
  await cloud.signUp({loginId: 'mem-user', password: 'secret123'});
  assert.equal(cloud.session().user.loginId, 'mem-user');
  assert.equal(cloud.deviceId(), cloud.deviceId());
});

test('deviceLabel names browser and OS', () => {
  assert.equal(cloud.deviceLabel(CHROME_ANDROID), 'Chrome on Android');
  assert.equal(cloud.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(cloud.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Edge on Windows');
  assert.equal(cloud.deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'), 'Samsung Internet on Android');
  assert.equal(cloud.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox on Mac');
  assert.equal(cloud.deviceLabel(''), 'This device');
});

// ---------------------------------------------------------------------------------------------------------------------
// Link & push
// ---------------------------------------------------------------------------------------------------------------------

test('linkStall creates the cloud stall and pushes the first snapshot (photos included, only this stall\'s)', async () => {
  const {backend, storage} = await signedInSetup();
  storage.media.photo1 = PNG;
  storage.media.otherStallPhoto = GIF;
  const id = storage.add(stallState('Chaat Corner', {photo: true}), {active: true});

  const linked = await cloud.linkStall(id);
  assert.equal(linked.status, 'synced');
  assert.equal(linked.revision, 1);
  assert.equal(linked.dirty, false);
  assert.equal(linked.access, 'owner');
  assert.equal(linked.ownerLoginId, 'test-owner@example.com');
  assert.match(linked.code, /^MYS-/);

  const [create] = backend.calls('stalls:create');
  assert.deepEqual(create.args.info, {name: 'Chaat Corner', booth: 'B-12', themeId: 'street-chaat', accent: '#FFDD35',
    heroArt: ['pani-puri', 'packet', 'samosa'], eventName: 'Diwali Mela', city: 'Jabalpur'});

  const upload = backend.log.find(l => l.type === 'upload');
  assert.equal(upload.headers['Content-Type'], 'application/json');
  const snapshot = JSON.parse(upload.text);
  assert.equal(snapshot.format, 'mys-backup');
  assert.deepEqual(Object.keys(snapshot.media), ['photo1'], 'only photos this stall uses');
  assert.equal(validateBackup(snapshot).state.config.profile.stallName, 'Chaat Corner');

  const [commit] = backend.calls('stalls:commitSnapshot');
  assert.equal(commit.args.baseRevision, 0);
  assert.equal(commit.args.bytes, upload.bytes);
  assert.equal(commit.args.stallId, linked.stallId);
  assert.equal(commit.args.device, 'Chrome on Android');
  assert.equal(commit.args.force, false);
  assert.deepEqual(Object.keys(commit.args.summary).sort(), ['bills', 'collected', 'orders']);
  assert.equal(commit.args.info.name, 'Chaat Corner');
  assert.match(commit.args.storageId, /^kg/);

  const state = cloud.syncState(id);
  assert.equal(state.status, 'synced');
  assert.equal(state.label, 'Synced ✓');
  assert.equal(state.linked, true);

  // Linking again does not create a second cloud stall; a clean stall is not re-uploaded.
  await cloud.linkStall(id);
  assert.equal(backend.calls('stalls:create').length, 1);
  assert.equal(backend.calls('stalls:commitSnapshot').length, 1);
  assert.equal((await cloud.pushStall(id)).skipped, true);

  // listCloudStalls marks the local copy.
  const rows = await cloud.listCloudStalls();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].localId, id);
});

test('linkStall needs an account; offline after create keeps the link and waits', async () => {
  const env = setup();
  const id = env.storage.add(stallState());
  await assert.rejects(cloud.linkStall(id), err => err.code === 'signed-out');

  await cloud.signUp({loginId: 'test-offline', password: 'secret123'});
  // Go offline right after stalls:create answers.
  const realFetch = env.backend.fetch;
  cloud.__setCloudDeps({storage: env.storage, core: env.core, url: URL_BASE, localStorage: () => env.ls, online: () => env.net.online,
    fetch: async (url, init) => {
      const res = await realFetch(url, init);
      if (JSON.parse(init.body || '{}').path === 'stalls:create') env.net.online = false;
      return res;
    }});
  const linked = await cloud.linkStall(id);
  assert.equal(linked.status, 'offline');
  assert.equal(linked.dirty, true);
  assert.equal(cloud.syncState(id).label, 'Offline – will sync');
});

test('pushStall handles a conflict: status conflict, never auto-overwritten; force push resolves it', async () => {
  const {backend, storage, core} = await signedInSetup();
  const id = storage.add(stallState(), {active: true});
  await cloud.linkStall(id);
  await cloud.startSync();
  const stallId = storage.cloudOf(id).stallId;
  backend.stalls.get(stallId).revision = 7; // another phone synced meanwhile

  storage.write(id, st => {
    st.config.profile.tagline = 'changed here';
  });
  await cloud.markDirty(id);
  const res = await cloud.pushStall(id);
  assert.deepEqual({ok: res.ok, conflict: res.conflict, revision: res.revision}, {ok: false, conflict: true, revision: 7});
  assert.equal(storage.cloudOf(id).status, 'conflict');
  assert.equal(storage.cloudOf(id).dirty, true);
  assert.equal(storage.cloudOf(id).revision, 1, 'the known base revision is kept');
  const view = cloud.syncState(id);
  assert.equal(view.label, 'Needs attention');
  assert.equal(view.tone, 'error');
  assert.match(view.detail, /changed on Chrome on Android|another phone/);

  // New sales while in conflict: still never pushed automatically.
  const commits = backend.calls('stalls:commitSnapshot').length;
  core.committed({stallId: id, state: storage.write(id, () => {})});
  await settle();
  await cloud.flushSync(id);
  assert.equal(backend.calls('stalls:commitSnapshot').length, commits);
  assert.equal(storage.cloudOf(id).status, 'conflict');

  const forced = await cloud.pushStall(id, {force: true});
  assert.deepEqual(forced, {ok: true, revision: 8});
  assert.equal(backend.calls('stalls:commitSnapshot').at(-1).args.force, true);
  assert.equal(storage.cloudOf(id).status, 'synced');
  assert.equal(storage.cloudOf(id).revision, 8);
});

test('pushStall errors are recorded on the entry; a signed-out push waits', async () => {
  const {backend, storage} = await signedInSetup();
  const id = storage.add(stallState());
  await cloud.linkStall(id);
  await cloud.markDirty(id);
  // Server failure
  backend.stalls.get(storage.cloudOf(id).stallId).ownerId = 'someone-else';
  await assert.rejects(cloud.pushStall(id), /Stall not found/);
  assert.equal(storage.cloudOf(id).status, 'error');
  assert.equal(storage.cloudOf(id).lastError, 'Stall not found in your account.');
  assert.equal(cloud.syncState(id).tone, 'error');

  await cloud.logOut();
  const before = backend.log.length;
  await assert.rejects(cloud.pushStall(id), err => err.code === 'signed-out');
  assert.equal(backend.log.length, before, 'no request without a token');
  assert.equal(storage.cloudOf(id).status, 'pending');
  assert.equal(cloud.syncState(id).label, 'Log in to sync');
  await assert.rejects(cloud.pushStall(storage.add(stallState())), err => err.code === 'not-linked');
});

// ---------------------------------------------------------------------------------------------------------------------
// Background sync
// ---------------------------------------------------------------------------------------------------------------------

test('startSync: commits mark the stall dirty and coalesce into one push after 4 s', async t => {
  const {backend, storage, core} = await signedInSetup();
  const id = storage.add(stallState(), {active: true});
  await cloud.linkStall(id);
  t.mock.timers.enable({apis: ['setTimeout']});
  await cloud.startSync();
  await cloud.startSync(); // idempotent
  assert.equal(typeof core.committed, 'function');
  const pushesBefore = backend.calls('stalls:commitSnapshot').length;

  for (let i = 0; i < 3; i++) {
    core.committed({stallId: id, state: storage.write(id, st => {
      st.config.profile.tagline = `sale ${i}`;
    })});
    await settle();
    t.mock.timers.tick(1500);
  }
  await settle();
  assert.equal(storage.cloudOf(id).dirty, true);
  assert.equal(storage.cloudOf(id).status, 'pending');
  assert.equal(cloud.syncState(id).label, 'Waiting to sync');
  assert.equal(backend.calls('stalls:commitSnapshot').length, pushesBefore, 'no push inside the debounce window');

  t.mock.timers.tick(cloud.SYNC_DEBOUNCE_MS);
  await settle();
  assert.equal(backend.calls('stalls:commitSnapshot').length, pushesBefore + 1, 'one push for three commits');
  assert.equal(storage.cloudOf(id).status, 'synced');
  assert.equal(storage.cloudOf(id).dirty, false);
  assert.equal(storage.cloudOf(id).revision, 2);
  const snap = JSON.parse(backend.log.filter(l => l.type === 'upload').at(-1).text);
  assert.equal(snap.state.config.profile.tagline, 'sale 2', 'the latest state was uploaded');

  // Commits for an unlinked stall are ignored.
  const local = storage.add(stallState());
  core.committed({stallId: local, state: {}});
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(backend.calls('stalls:commitSnapshot').length, pushesBefore + 1);
});

test('pushes are serialized per stall; a sale during an upload keeps the stall dirty and queues another push', async t => {
  const {backend, storage, core} = await signedInSetup();
  const id = storage.add(stallState(), {active: true});
  await cloud.linkStall(id);
  await cloud.startSync();
  t.mock.timers.enable({apis: ['setTimeout']});

  storage.write(id, () => {});
  await cloud.markDirty(id);
  // A sale lands while the snapshot is uploading.
  backend.hooks.beforeUploadResponse = async () => {
    backend.hooks.beforeUploadResponse = null;
    core.committed({stallId: id, state: storage.write(id, st => {
      st.config.profile.tagline = 'mid-upload sale';
    })});
    await settle(5);
  };
  const [a, b] = await Promise.all([cloud.pushStall(id), cloud.pushStall(id)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(backend.maxInFlightCommits, 1, 'never two commits for the same stall at once');
  const commits = backend.calls('stalls:commitSnapshot');
  assert.deepEqual(commits.slice(-2).map(c => c.args.baseRevision), [1, 2], 'second push builds on the first');
  assert.equal(storage.cloudOf(id).status, 'synced');
  assert.equal(storage.cloudOf(id).dirty, false);
  const last = JSON.parse(backend.log.filter(l => l.type === 'upload').at(-1).text);
  assert.equal(last.state.config.profile.tagline, 'mid-upload sale');

  // Only one push in flight → with a later sale the first push finishes 'pending' and schedules the next.
  backend.hooks.beforeUploadResponse = async () => {
    backend.hooks.beforeUploadResponse = null;
    storage.write(id, () => {});
  };
  await cloud.markDirty(id);
  await cloud.pushStall(id);
  assert.equal(storage.cloudOf(id).status, 'pending');
  assert.equal(storage.cloudOf(id).dirty, true);
  t.mock.timers.tick(cloud.SYNC_DEBOUNCE_MS);
  await settle();
  assert.equal(storage.cloudOf(id).status, 'synced');
});

test('offline queueing: commits wait offline and push when the online event fires', async t => {
  const {backend, storage, core, win, net} = await signedInSetup();
  const id = storage.add(stallState(), {active: true});
  await cloud.linkStall(id);
  t.mock.timers.enable({apis: ['setTimeout']});
  await cloud.startSync();
  const before = backend.log.length;

  net.online = false;
  core.committed({stallId: id, state: storage.write(id, () => {})});
  await settle();
  assert.equal(storage.cloudOf(id).status, 'offline');
  assert.equal(cloud.syncState(id).label, 'Offline – will sync');
  t.mock.timers.tick(cloud.SYNC_DEBOUNCE_MS);
  await settle();
  assert.equal(backend.log.length, before, 'nothing sent while offline');
  assert.equal(storage.cloudOf(id).dirty, true);

  net.online = true;
  win.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(storage.cloudOf(id).status, 'synced');
  assert.equal(storage.cloudOf(id).dirty, false);
  assert.equal(backend.calls('stalls:commitSnapshot').length, 2);
});

test('visibilitychange hidden pushes pending changes right away; startSync resumes dirty stalls', async t => {
  const {backend, storage, core, doc} = await signedInSetup();
  const id = storage.add(stallState(), {active: true});
  await cloud.linkStall(id);
  t.mock.timers.enable({apis: ['setTimeout']});
  await cloud.startSync();

  core.committed({stallId: id, state: storage.write(id, () => {})});
  await settle();
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(backend.calls('stalls:commitSnapshot').length, 2, 'pushed without waiting 4 s');
  assert.equal(storage.cloudOf(id).status, 'synced');

  // Next visit: a stall left dirty (and a stale 'syncing') is settled and pushed on start.
  storage.write(id, () => {});
  storage.meta.stalls[0].cloud = {...storage.cloudOf(id), dirty: true, status: 'syncing'};
  const backend2 = backend;
  cloud.__setCloudDeps({storage, core, url: URL_BASE, fetch: backend2.fetch, localStorage: () => {
    const ls = new MemoryStorage();
    ls.setItem('mys-session', JSON.stringify({token: [...backend.sessions.keys()][0], user: {id: 'u', loginId: 'x', name: 'x'}, kind: 'user'}));
    return ls;
  }, online: () => true, win: () => null, doc: () => null});
  await cloud.startSync();
  await settle();
  assert.equal(backend.calls('stalls:commitSnapshot').length, 3);
  assert.equal(storage.cloudOf(id).status, 'synced');
});

// ---------------------------------------------------------------------------------------------------------------------
// Pull & join
// ---------------------------------------------------------------------------------------------------------------------

/** Device A links + pushes a stall with a photo; returns the cloud stall id. */
async function cloudStallFromDeviceA(env, name = 'Momo Mania') {
  env.storage.media.photo1 = PNG;
  const id = env.storage.add(stallState(name, {photo: true}));
  await cloud.linkStall(id);
  return {id, stallId: env.storage.cloudOf(id).stallId};
}

test('pullStall({cloudStallId}) creates + opens a new local entry with its photos', async () => {
  const env = await signedInSetup();
  const {stallId} = await cloudStallFromDeviceA(env);
  // Device B: same account, empty phone.
  const token = cloud.session().token;
  const b = setup();
  b.ls.setItem('mys-session', JSON.stringify({token, user: {id: 'u', loginId: 'test-owner@example.com', name: 'V'}, kind: 'user'}));
  cloud.__setCloudDeps({storage: b.storage, core: b.core, url: URL_BASE, fetch: env.backend.fetch, localStorage: () => b.ls, online: () => true});

  const res = await cloud.pullStall({cloudStallId: stallId});
  assert.equal(res.created, true);
  assert.equal(res.revision, 1);
  assert.deepEqual(b.core.opened, [res.entryId], 'opened via the kernel');
  assert.equal(b.storage.meta.activeStallId, res.entryId);
  assert.equal(b.storage.media.photo1, PNG, 'photos restored into the media store');
  const st = await b.storage.readStall(res.entryId);
  assert.equal(st.config.profile.stallName, 'Momo Mania');
  const c = b.storage.cloudOf(res.entryId);
  assert.deepEqual({stallId: c.stallId, revision: c.revision, dirty: c.dirty, status: c.status, access: c.access},
    {stallId, revision: 1, dirty: false, status: 'synced', access: 'owner'});

  // Pulling the same cloud stall again updates that entry instead of creating another.
  const again = await cloud.pullStall({cloudStallId: stallId});
  assert.equal(again.created, false);
  assert.equal(again.entryId, res.entryId);
  assert.equal(b.storage.meta.stalls.length, 1);
});

test('pullStall into the active stall swaps it in place (replaceAll + reloadMedia + render)', async () => {
  const env = await signedInSetup();
  const {id} = await cloudStallFromDeviceA(env);
  env.storage.meta.activeStallId = id;
  // The cloud moves on (another phone renamed the stall) — simulate by pushing a changed copy from "elsewhere".
  const cloudStall = env.backend.stalls.get(env.storage.cloudOf(id).stallId);
  const changed = JSON.parse(env.backend.files.get(cloudStall.snapshotId));
  changed.state.config.profile.stallName = 'Renamed Elsewhere';
  env.backend.files.set('kg-elsewhere', JSON.stringify(changed));
  cloudStall.snapshotId = 'kg-elsewhere';
  cloudStall.revision = 5;

  const res = await cloud.pullStall(id);
  assert.equal(res.created, false);
  assert.deepEqual(env.storage.log.filter(l => l[0] === 'replaceAll'), [['replaceAll', id]]);
  assert.equal(env.core.store.state.config.profile.stallName, 'Renamed Elsewhere');
  assert.equal(env.core.reloads, 1);
  assert.ok(env.core.renders >= 1);
  assert.equal(env.storage.cloudOf(id).revision, 5);
  assert.equal(env.storage.cloudOf(id).status, 'synced');
});

test('pullStall into a background stall uses writeStall', async () => {
  const env = await signedInSetup();
  const {id} = await cloudStallFromDeviceA(env);
  env.storage.meta.activeStallId = null;
  const res = await cloud.pullStall(id);
  assert.equal(res.entryId, id);
  assert.deepEqual(env.storage.log.filter(l => l[0] === 'writeStall'), [['writeStall', id]]);
  assert.equal(env.core.reloads, 0);
});

test('a tampered or damaged snapshot is rejected and nothing local changes', async () => {
  const env = await signedInSetup();
  const {id} = await cloudStallFromDeviceA(env);
  const before = structuredClone(await env.storage.readStall(id));
  const tampers = [
    text => {
      const j = JSON.parse(text);
      j.state.live.orders = 'nope';
      return JSON.stringify(j);
    },
    text => {
      const j = JSON.parse(text);
      j.media.photo1 = 'data:text/html;base64,PHNjcmlwdD4=';
      return JSON.stringify(j);
    },
    text => {
      const j = JSON.parse(text);
      j.app = 'EvilApp';
      return JSON.stringify(j);
    },
    () => '{"truncated": ',
  ];
  for (const tamper of tampers) {
    env.backend.hooks.tamper = tamper;
    await assert.rejects(cloud.pullStall(id), err => {
      assert.equal(err.code, 'invalid');
      assert.match(err.message, /safety check/);
      return true;
    });
  }
  assert.deepEqual(await env.storage.readStall(id), before);
  assert.equal(env.storage.log.filter(l => l[0] === 'writeStall' || l[0] === 'replaceAll').length, 0);
  assert.equal(env.storage.cloudOf(id).status, 'synced');
});

test('pullStall refuses to overwrite unsynced local sales unless in conflict or forced', async () => {
  const env = await signedInSetup();
  const {id} = await cloudStallFromDeviceA(env);
  await cloud.markDirty(id);
  await assert.rejects(cloud.pullStall(id), err => err.code === 'dirty');
  await env.storage.updateEntry(id, {cloud: {status: 'conflict'}});
  const res = await cloud.pullStall(id); // "Use the cloud copy"
  assert.equal(res.entryId, id);
  assert.equal(env.storage.cloudOf(id).status, 'synced');
  assert.equal(env.storage.cloudOf(id).dirty, false);
  await cloud.markDirty(id);
  assert.equal((await cloud.pullStall(id, {force: true})).entryId, id);
});

test('pullStall with no cloud copy yet says so', async () => {
  const env = await signedInSetup();
  const id = env.storage.add(stallState());
  const created = await cloud.call('mutation', 'stalls:create', {token: cloud.session().token, info: {name: 'Empty'}});
  await assert.rejects(cloud.pullStall({cloudStallId: created.id}), err => err.code === 'empty');
  await assert.rejects(cloud.pullStall(id), err => err.code === 'not-linked');
  await assert.rejects(cloud.pullStall('missing-id'), err => err.code === 'missing');
});

test('joinStall: team session stored per stall, account session untouched, pushes use the team token', async () => {
  const env = await signedInSetup();
  const {id, stallId} = await cloudStallFromDeviceA(env);
  await assert.rejects(cloud.setTeamPassword(id, '123'), err => err.code === 'invalid');
  await cloud.setTeamPassword(id, 'team-pass-1');
  const code = env.storage.cloudOf(id).code;

  // Helper's phone: signed in to their own account.
  const helper = setup();
  cloud.__setCloudDeps({storage: helper.storage, core: helper.core, url: URL_BASE, fetch: env.backend.fetch, localStorage: () => helper.ls,
    online: () => true, win: () => helper.win, doc: () => helper.doc});
  await cloud.signUp({loginId: 'test-helper', password: 'secret123'});
  const accountToken = cloud.session().token;

  await assert.rejects(cloud.joinStall({code: 'bad', password: 'x'}), err => err.code === 'invalid');
  await assert.rejects(cloud.joinStall({code, password: 'wrong-pass'}), /wrong/);
  const typed = code.toLowerCase().replace('-', ' ');
  const res = await cloud.joinStall({code: typed, password: 'team-pass-1'});
  assert.equal(res.stall.id, stallId);
  assert.equal(res.created, true);
  assert.equal(cloud.session().token, accountToken, 'the account session is not replaced');
  const team = JSON.parse(helper.ls.getItem('mys-team'));
  assert.ok(team[stallId].token);
  assert.deepEqual(cloud.teamAccess().map(t => t.stallId), [stallId]);
  const entryCloud = helper.storage.cloudOf(res.entryId);
  assert.equal(entryCloud.access, 'team');
  assert.equal(entryCloud.code, code);

  // Team push uses the team token; owner-only actions are refused locally.
  helper.storage.write(res.entryId, () => {});
  await cloud.markDirty(res.entryId);
  const r = await cloud.pushStall(res.entryId);
  assert.equal(r.ok, true);
  assert.equal(env.backend.calls('stalls:commitSnapshot').at(-1).args.token, team[stallId].token);
  await assert.rejects(cloud.removeCloudStall(res.entryId), err => err.code === 'owner');
  await assert.rejects(cloud.setTeamPassword(res.entryId, 'another1'), err => err.code === 'owner');

  // Team access survives logging out of the account, and is forgotten by unlinkStall.
  await cloud.logOut();
  assert.equal(cloud.syncState(res.entryId).label !== 'Log in to sync', true);
  await cloud.unlinkStall(res.entryId);
  assert.equal(helper.storage.cloudOf(res.entryId), null);
  assert.deepEqual(cloud.teamAccess(), []);
});

test('removeCloudStall deletes the cloud copy and unlinks; setTeamPassword(null) removes team access', async () => {
  const env = await signedInSetup();
  const {id, stallId} = await cloudStallFromDeviceA(env);
  await cloud.setTeamPassword(id, null);
  assert.equal(env.backend.calls('stalls:setTeamPassword').at(-1).args.password, null);
  await cloud.removeCloudStall(id);
  assert.equal(env.backend.stalls.has(stallId), false);
  assert.equal(env.storage.cloudOf(id), null);
  assert.equal(cloud.syncState(id).status, 'local');
  assert.equal(cloud.syncState(id).label, 'Saved on device');
});

test('syncState accepts an entry object and onSyncChange reports status changes', async () => {
  const env = await signedInSetup();
  const seen = [];
  const off = cloud.onSyncChange(c => c.entryId && seen.push(c.state.status));
  await cloudStallFromDeviceA(env);
  off();
  assert.ok(seen.includes('syncing'));
  assert.equal(seen.at(-1), 'synced');
  assert.equal(cloud.syncState({id: 'x', cloud: null}).linked, false);
  assert.equal(cloud.syncState({id: 'x', cloud: {status: 'error', lastError: 'Boom.', stallId: 's'}}).detail, 'Boom.');
});

// ---------------------------------------------------------------------------------------------------------------------
// Real storage.mjs (fake-indexeddb): link → push → pull on a "second phone"
// ---------------------------------------------------------------------------------------------------------------------

test('round trip with the real storage adapter', async t => {
  const storage = await import('../dist/storage.mjs');
  if (typeof storage.createStall !== 'function' || typeof storage.updateEntry !== 'function') {
    t.skip('multi-stall storage (§17.1) not available');
    return;
  }
  const backend = fakeBackend();
  const core = fakeCore();
  const ls = new MemoryStorage();
  cloud.__setCloudDeps({storage, core, url: URL_BASE, fetch: backend.fetch, localStorage: () => ls, online: () => true});
  await storage.init();
  await cloud.signUp({loginId: 'test-real', password: 'secret123'});

  await storage.putMedia('realphoto', PNG);
  const st = stallState('Real Storage Stall');
  st.config.products[0].image = 'media:realphoto';
  const {entry} = await storage.createStall(st);
  const linked = await cloud.linkStall(entry.id);
  assert.equal(linked.status, 'synced');
  assert.equal((await storage.getMeta()).stalls.find(e => e.id === entry.id).cloud.revision, 1);

  // Second phone = same IndexedDB minus this stall: delete it locally, then download it back.
  await storage.deleteStall(entry.id);
  assert.equal((await storage.getAllMedia()).realphoto, undefined, 'photo pruned with the stall');
  const res = await cloud.pullStall({cloudStallId: linked.stallId});
  assert.equal(res.created, true);
  const meta = await storage.getMeta();
  const back = meta.stalls.find(e => e.id === res.entryId);
  assert.equal(back.cloud.stallId, linked.stallId);
  assert.equal(back.cloud.status, 'synced');
  assert.equal(back.summary.name, 'Real Storage Stall');
  assert.equal((await storage.readStall(res.entryId)).config.products[0].image, 'media:realphoto');
  assert.equal((await storage.getAllMedia()).realphoto, PNG);
  assert.deepEqual(core.opened, [res.entryId]);
});
