// Storage adapter tests (dist/storage.mjs) against fake-indexeddb.
// This suite tests the IndexedDB adapter only — not a real browser, BroadcastChannel or service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import 'fake-indexeddb/auto';

globalThis.BroadcastChannel = undefined;

const storage = await import('../dist/storage.mjs');
const {
  init, mutate, read, closeDB, getAllMedia, putMedia, deleteMedia, replaceAll, pruneMedia, DB_NAME,
  getMeta, createStall, openStall, leaveStall, deleteStall, readStall, writeStall, updateEntry, getMediaFor, stallSummary,
} = storage;
const {initialState, session, makeLine, createOrder, report, uuid, audit, addExpense, voidExpense, referencedMedia} = await import('../dist/domain.mjs');

const v1State = JSON.parse(readFileSync(new URL('./fixtures/v1-state.json', import.meta.url), 'utf8'));
// 1×1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

/** Create the legacy v1 database (version 1, only a 'state' store) holding `value` at 'root'. */
function createV1Database(value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const conn = req.result;
      const tx = conn.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, 'root');
      tx.oncomplete = () => {
        conn.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Fresh priced v2 stall in live mode with an empty media store. */
async function reset() {
  const fresh = initialState();
  fresh.onboarded = true;
  await replaceAll(fresh, {});
}

test('v1 database upgrades in place: stores, schema v2 and the live ledger survive', async () => {
  await createV1Database(structuredClone(v1State));
  const booted = await init();
  const st = booted.state;
  // The legacy stall becomes the one active entry, still stored at key 'root'.
  assert.equal(booted.meta.activeStallId, 'root');
  assert.equal(booted.meta.stalls.length, 1);
  assert.equal(booted.meta.stalls[0].id, 'root');
  assert.equal(booted.meta.stalls[0].key, 'root');
  assert.equal(booted.meta.stalls[0].summary.name, 'Packet Pataka');
  assert.equal(booted.meta.stalls[0].summary.orders, 5);
  assert.equal(booted.meta.stalls[0].summary.collected, 28000);
  assert.deepEqual(await getMeta(), booted.meta);
  assert.equal(st.version, 2);
  assert.equal(st.config.schema, 2);
  assert.equal(st.revision, v1State.revision + 1);
  assert.equal(report(st.live, st.config).collected, 28000);
  assert.deepEqual(st.pin, v1State.pin, 'the v1 PIN hash and salt are kept so the owner PIN keeps working');
  assert.equal(st.live.orders.length, 5);

  // The media store now exists and works.
  assert.deepEqual(await getAllMedia(), {});
  await putMedia('upgrade-check', PNG);
  assert.equal((await getAllMedia())['upgrade-check'], PNG);
  await deleteMedia('upgrade-check');

  // A "page reload" (new connection) sees the migrated state persisted.
  closeDB();
  const again = await read();
  assert.equal(again.version, 2);
  assert.equal(report(again.live, again.config).collected, 28000);
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => {
      const conn = req.result;
      try {
        assert.equal(conn.version, 2);
        assert.ok(conn.objectStoreNames.contains('state'));
        assert.ok(conn.objectStoreNames.contains('media'));
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        conn.close();
      }
    };
    req.onerror = () => reject(req.error);
  });
});

test('IndexedDB atomically stores both order and payment', async () => {
  await reset();
  const id = uuid();
  await mutate(st => createOrder(st.live, st.config, {id, items: [makeLine(st.config, 'veggie-chips-chaat-small')]}));
  const st = await read();
  assert.equal(st.live.orders.length, 1);
  assert.equal(st.live.payments.length, 1);
  assert.equal(report(st.live, st.config).collected, 4000);
});

test('failed mutation rolls back all changes', async () => {
  await reset();
  const before = await read();
  await assert.rejects(
    mutate(st => {
      st.live.orders.push({id: 'must-not-persist'});
      st.config.profile.stallName = 'Ghost stall';
      throw Error('Simulated write failure');
    }),
    /Simulated write failure/,
  );
  const after = await read();
  assert.equal(after.live.orders.length, 0);
  assert.equal(after.config.profile.stallName, before.config.profile.stallName);
  assert.equal(after.revision, before.revision);
});

test('an async mutation is refused and persists nothing', async () => {
  await reset();
  await assert.rejects(
    mutate(async st => {
      st.live.orders.push({id: 'async'});
    }),
    /synchronous/,
  );
  assert.equal((await read()).live.orders.length, 0);
});

test('concurrent checkout requests with same ID commit once', async () => {
  await reset();
  const id = uuid();
  await Promise.all(
    Array.from({length: 8}, () => mutate(st => createOrder(st.live, st.config, {id, items: [makeLine(st.config, 'veggie-chips-chaat-small')]}))),
  );
  const st = await read();
  assert.equal(st.live.orders.length, 1);
  assert.equal(st.live.payments.length, 1);
});

test('independent concurrent sales do not overwrite each other', async () => {
  await reset();
  await Promise.all(
    Array.from({length: 8}, () => mutate(st => createOrder(st.live, st.config, {id: uuid(), items: [makeLine(st.config, 'lemon-fizz')]}))),
  );
  const st = await read();
  assert.equal(st.live.orders.length, 8);
  assert.equal(report(st.live, st.config).collected, 24000);
});

test('concurrent mutations serialize: every write sees the previous one', async () => {
  await reset();
  const start = (await read()).revision;
  const results = await Promise.all(
    Array.from({length: 20}, (_, i) => mutate(st => {
      audit(st.live, 'test', `w${i}`, 'tester');
      return st.live.audit.length;
    })),
  );
  assert.deepEqual(results.map(r => r.output), Array.from({length: 20}, (_, i) => i + 1));
  assert.deepEqual(results.map(r => r.state.revision), Array.from({length: 20}, (_, i) => start + i + 1));
  const st = await read();
  assert.equal(st.live.audit.length, 20);
  assert.equal(st.revision, start + 20);
});

test('draft survives a new database read before checkout', async () => {
  await reset();
  await mutate(st => {
    st.live.draft.push(makeLine(st.config, 'veggie-chips-chaat-large', {addons: ['extra-cheese']}));
  });
  closeDB();
  assert.equal((await read()).live.draft[0].unitPrice, 7000);
});

test('empty checkout failure cannot create a partial payment', async () => {
  await reset();
  await assert.rejects(mutate(st => createOrder(st.live, st.config, {id: uuid(), items: []})));
  const st = await read();
  assert.equal(st.live.orders.length, 0);
  assert.equal(st.live.payments.length, 0);
});

test('media: put, get, overwrite and delete', async () => {
  await reset();
  await putMedia('photo-1', PNG);
  await putMedia('photo-2', GIF);
  assert.deepEqual(await getAllMedia(), {'photo-1': PNG, 'photo-2': GIF});
  await putMedia('photo-2', PNG);
  assert.equal((await getAllMedia())['photo-2'], PNG);
  await deleteMedia(['photo-1', 'missing-id']);
  assert.deepEqual(Object.keys(await getAllMedia()), ['photo-2']);
  await deleteMedia('photo-2');
  await deleteMedia([]);
  assert.deepEqual(await getAllMedia(), {});
});

test('putMedia rejects bad ids, non-image data and oversized images', async () => {
  await reset();
  await assert.rejects(putMedia('bad id', PNG), /image id/);
  await assert.rejects(putMedia('', PNG), /image id/);
  await assert.rejects(putMedia('x', 'data:text/plain;base64,QUJD'), /PNG, JPEG, WebP or GIF/);
  await assert.rejects(putMedia('x', 'data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPEG, WebP or GIF/);
  await assert.rejects(putMedia('x', 'https://example.com/a.png'), /PNG, JPEG, WebP or GIF/);
  await assert.rejects(putMedia('x', 'data:image/png;base64,not base64!'), /PNG, JPEG, WebP or GIF/);
  await assert.rejects(putMedia('x', 42), /PNG, JPEG, WebP or GIF/);
  // 2,097,152 base64 chars = exactly 1.5 MiB decoded: allowed. Four more chars: too big.
  const exact = 'data:image/jpeg;base64,' + 'A'.repeat(2097152);
  await putMedia('exact', exact);
  await assert.rejects(putMedia('big', 'data:image/jpeg;base64,' + 'A'.repeat(2097156)), /1\.5 MB/);
  assert.deepEqual(Object.keys(await getAllMedia()), ['exact']);
  await deleteMedia('exact');
});

test('pruneMedia deletes only images no product references', async () => {
  await reset();
  await putMedia('keep-me', PNG);
  await putMedia('orphan-1', PNG);
  await putMedia('orphan-2', GIF);
  await mutate(st => {
    st.config.products[0].image = 'media:keep-me';
    st.config.products[1].image = 'https://example.com/chips.png';
  });
  assert.equal(await pruneMedia(), 2);
  assert.deepEqual(Object.keys(await getAllMedia()), ['keep-me']);
  assert.equal(await pruneMedia(), 0);
});

test('pruneMedia keeps every domain.referencedMedia id: products, hero photo and bill photos in live AND practice', async () => {
  await reset();
  const ids = ['prod', 'hero', 'bill-live', 'bill-live-void', 'bill-demo', 'orphan'];
  for (const id of ids) await putMedia(id, PNG);
  await mutate(st => {
    st.config.products[0].image = 'media:prod';
    st.config.theme.heroImage = 'media:hero';
    addExpense(st.live, st.config, {id: 'b1', title: 'Cheese', category: 'restock', amount: 5000, billImage: 'media:bill-live'});
    addExpense(st.live, st.config, {id: 'b2', title: 'Wrong', category: 'misc', amount: 100, billImage: 'media:bill-live-void'});
    voidExpense(st.live, st.config, 'b2', 'Entered twice');
    addExpense(st.demo, st.config, {id: 'b3', title: 'Practice ice', category: 'restock', amount: 100, billImage: 'media:bill-demo'});
  });
  const kept = referencedMedia(await read());
  assert.deepEqual([...kept].sort(), ['bill-demo', 'bill-live', 'bill-live-void', 'hero', 'prod']);
  assert.equal(await pruneMedia(), 1, 'only the orphan goes');
  assert.deepEqual(Object.keys(await getAllMedia()).sort(), [...kept].sort());
  // Removing the hero photo makes it prunable; voided bills keep their photo for audit.
  await mutate(st => { st.config.theme.heroImage = null; });
  assert.equal(await pruneMedia(), 1);
  assert.equal('hero' in await getAllMedia(), false);
  assert.equal('bill-live-void' in await getAllMedia(), true);
});

test('replaceAll swaps state and media atomically', async () => {
  await reset();
  await putMedia('old-photo', PNG);
  const next = initialState({templateId: 'chai-maggi'});
  next.onboarded = true;
  next.revision = 99;
  next.config.profile.stallName = 'Chai Point';
  next.config.products[0].image = 'media:new-photo';
  const stored = await replaceAll(next, {'new-photo': GIF});
  assert.equal(stored.config.profile.stallName, 'Chai Point');
  const st = await read();
  assert.equal(st.config.profile.stallName, 'Chai Point');
  assert.equal(st.config.templateId, 'chai-maggi');
  assert.equal(st.revision, 99);
  assert.deepEqual(await getAllMedia(), {'new-photo': GIF});
});

test('replaceAll rolls back both stores when the write fails', async () => {
  await reset();
  await putMedia('survivor', PNG);
  await mutate(st => {
    st.config.profile.stallName = 'Before restore';
  });
  const broken = initialState();
  broken.config.profile.stallName = 'Broken restore';
  broken.notCloneable = () => 'functions cannot be stored';
  await assert.rejects(replaceAll(broken, {'should-not-exist': GIF}));
  assert.equal((await read()).config.profile.stallName, 'Before restore');
  assert.deepEqual(await getAllMedia(), {survivor: PNG});
});

test('a factory reset via replaceAll clears every image', async () => {
  await reset();
  await putMedia('a', PNG);
  await putMedia('b', PNG);
  await replaceAll(initialState(), {});
  assert.deepEqual(await getAllMedia(), {});
  const st = await read();
  assert.equal(st.onboarded, false);
  assert.equal(st.live.orders.length, 0);
  assert.deepEqual(st.live, {...session(), draftId: st.live.draftId});
});

// ---------------------------------------------------------------------------------------------------------------------
// Many stalls on one device (§17.1)
// ---------------------------------------------------------------------------------------------------------------------

/** Delete the whole database (a brand-new device). */
async function wipe() {
  closeDB();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error('blocked'));
  });
}

/** Raw read/write of one key in the 'state' store (an old cached tab, or a peek under the adapter). */
function raw(key, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const conn = req.result;
      const tx = conn.transaction('state', value === undefined ? 'readonly' : 'readwrite');
      const r = value === undefined ? tx.objectStore('state').get(key) : tx.objectStore('state').put(value, key);
      tx.oncomplete = () => {
        conn.close();
        resolve(value === undefined ? r.result : undefined);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** An onboarded stall named `name`. */
function stall(name, templateId) {
  const st = initialState(templateId ? {templateId} : {});
  st.onboarded = true;
  st.config.profile.stallName = name;
  return st;
}

test('a new device has no stall: empty index, nothing active, active-stall calls refuse', async () => {
  await wipe();
  const {meta, state} = await init();
  assert.equal(state, null);
  assert.deepEqual(meta, {version: 1, activeStallId: null, stalls: []});
  assert.deepEqual(await getMeta(), meta);
  await assert.rejects(read(), /No stall is open/);
  await assert.rejects(mutate(() => {}), /No stall is open/);
  await assert.rejects(replaceAll(initialState(), {}), /No stall is open/);
  assert.equal(await raw('root'), undefined, 'no legacy key is invented');
  // A reload stays empty.
  closeDB();
  assert.equal((await init()).state, null);
});

test('create, open, leave and delete stalls', async () => {
  await wipe();
  await init();
  const a = await createStall(stall('Chai Point', 'chai-maggi'));
  assert.match(a.entry.id, /^[0-9a-f-]{36}$/);
  assert.equal(a.entry.key, `stall:${a.entry.id}`);
  assert.equal(a.entry.cloud, null);
  assert.ok(a.entry.openedAt);
  assert.equal(a.state.revision, 1);
  assert.equal((await getMeta()).activeStallId, a.entry.id, 'a new stall becomes active');
  assert.equal((await read()).config.profile.stallName, 'Chai Point');

  const b = await createStall(stall('Momo Corner', 'momo-corner'));
  assert.equal((await getMeta()).activeStallId, b.entry.id);
  const bg = await createStall(stall('Background'), {open: false});
  assert.equal((await getMeta()).activeStallId, b.entry.id, '{open: false} keeps the active stall');
  assert.equal(bg.entry.openedAt, null);

  const opened = await openStall(a.entry.id);
  assert.equal(opened.config.profile.stallName, 'Chai Point');
  let meta = await getMeta();
  assert.equal(meta.activeStallId, a.entry.id);
  assert.deepEqual(meta.stalls.map(e => e.summary.name), ['Chai Point', 'Momo Corner', 'Background']);
  await assert.rejects(openStall('nope'), /on this phone/);

  await leaveStall();
  meta = await getMeta();
  assert.equal(meta.activeStallId, null);
  assert.equal(meta.stalls.length, 3, 'leaving keeps the data');
  await assert.rejects(read(), /No stall is open/);
  closeDB();
  assert.equal((await init()).state, null, 'a reload after leaving lands outside any stall');

  await openStall(b.entry.id);
  await deleteStall(b.entry.id);
  meta = await getMeta();
  assert.equal(meta.activeStallId, null, 'deleting the open stall leaves nothing open');
  assert.deepEqual(meta.stalls.map(e => e.id), [a.entry.id, bg.entry.id]);
  assert.equal(await raw(b.entry.key), undefined, 'its state is gone');
  assert.equal((await readStall(a.entry.id)).config.profile.stallName, 'Chai Point', 'other stalls are untouched');
  await assert.rejects(deleteStall(b.entry.id), /on this phone/);
});

test('stalls are isolated: sales, config, PIN and revisions stay in their own stall', async () => {
  await wipe();
  await init();
  const a = await createStall(stall('Stall A'));
  await mutate(st => {
    createOrder(st.live, st.config, {id: uuid(), items: [makeLine(st.config, 'lemon-fizz')]});
    st.pin = {salt: 's', hash: 'a'.repeat(64)};
  });
  const b = await createStall(stall('Stall B'));
  const inB = await read();
  assert.equal(inB.config.profile.stallName, 'Stall B');
  assert.equal(inB.live.orders.length, 0);
  assert.equal(inB.pin, null);
  await mutate(st => {
    st.config.profile.stallName = 'Stall B renamed';
  });
  const back = await openStall(a.entry.id);
  assert.equal(back.config.profile.stallName, 'Stall A');
  assert.equal(back.live.orders.length, 1);
  assert.equal(back.revision, 2);
  assert.equal((await readStall(b.entry.id)).config.profile.stallName, 'Stall B renamed');
  // A tab that still thinks stall B is open can't write into stall A.
  await assert.rejects(mutate(st => { st.config.profile.stallName = 'Wrong'; }, {stallId: b.entry.id}), /different stall/);
  assert.equal((await read()).config.profile.stallName, 'Stall A');
  const ok = await mutate(st => st.live.orders.length, {stallId: a.entry.id});
  assert.equal(ok.output, 1);
  assert.equal(ok.stallId, a.entry.id);
});

test('the index summary is refreshed on every committed write (orders, sum of payments, live non-void bills, look)', async () => {
  await wipe();
  await init();
  const {entry} = await createStall(stall('Summary Stall', 'momo-corner'));
  const s0 = entry.summary;
  assert.equal(s0.name, 'Summary Stall');
  assert.equal(s0.booth, 'Stall No. 1');
  assert.equal(s0.themeId, 'momo-corner');
  assert.match(s0.accent, /^#[0-9A-Fa-f]{6}$/);
  assert.ok(Array.isArray(s0.heroArt) && s0.heroArt.length > 0);
  assert.deepEqual([s0.orders, s0.collected, s0.bills, s0.currency], [0, 0, 0, 'INR']);
  const before = entry.updatedAt;
  await new Promise(r => setTimeout(r, 5));
  let expectCollected = 0;
  await mutate(st => {
    for (const p of st.config.products.filter(x => x.price && !x.bundle).slice(0, 2)) {
      createOrder(st.live, st.config, {id: uuid(), items: [makeLine(st.config, p.id)]});
    }
    expectCollected = report(st.live, st.config).collected;
    addExpense(st.live, st.config, {id: 'e1', title: 'Gas', category: 'restock', amount: 25000});
    addExpense(st.live, st.config, {id: 'e2', title: 'Typo', category: 'misc', amount: 999});
    voidExpense(st.live, st.config, 'e2', 'Typo');
    addExpense(st.demo, st.config, {id: 'e3', title: 'Practice', category: 'misc', amount: 100});
    createOrder(st.demo, st.config, {id: uuid(), items: [makeLine(st.config, st.config.products.find(x => x.price && !x.bundle).id)]});
    st.config.profile.booth = 'B-12';
    st.config.theme.accent = '#123456';
  });
  const s1 = (await getMeta()).stalls[0];
  assert.equal(s1.summary.orders, 2, 'live orders only');
  assert.ok(expectCollected > 0);
  assert.equal(s1.summary.collected, expectCollected);
  assert.equal(s1.summary.bills, 25000, 'void and practice bills never count');
  assert.equal(s1.summary.booth, 'B-12');
  assert.equal(s1.summary.accent, '#123456');
  assert.ok(s1.updatedAt > before, 'updatedAt moves on a write');
  // replaceAll and writeStall refresh it too.
  await replaceAll(stall('Restored'), {});
  assert.equal((await getMeta()).stalls[0].summary.name, 'Restored');
  assert.equal((await getMeta()).stalls[0].summary.orders, 0);
  await writeStall(entry.id, stall('Pulled from cloud'));
  assert.equal((await getMeta()).stalls[0].summary.name, 'Pulled from cloud');
  assert.deepEqual(stallSummary(null), {name: '', booth: '', themeId: '', accent: '#FFDD35', heroArt: [], orders: 0, collected: 0, bills: 0, currency: 'INR'});
});

test('updateEntry merges fields and the cloud object; readStall/writeStall reach a background stall', async () => {
  await wipe();
  await init();
  const a = await createStall(stall('Front'));
  const b = await createStall(stall('Back'), {open: false});
  let e = await updateEntry(b.entry.id, {cloud: {stallId: 'cloud1', code: 'MYS-ABCDE', revision: 0, dirty: true, status: 'pending'}});
  assert.equal(e.cloud.code, 'MYS-ABCDE');
  e = await updateEntry(b.entry.id, {cloud: {revision: 3, dirty: false, status: 'synced'}, id: 'hijack', key: 'root'});
  assert.deepEqual([e.id, e.key], [b.entry.id, b.entry.key], 'id and key never change');
  assert.deepEqual([e.cloud.stallId, e.cloud.code, e.cloud.revision, e.cloud.dirty, e.cloud.status], ['cloud1', 'MYS-ABCDE', 3, false, 'synced']);
  assert.equal((await getMeta()).stalls[1].cloud.revision, 3);
  e = await updateEntry(b.entry.id, {cloud: null});
  assert.equal(e.cloud, null);
  await assert.rejects(updateEntry('missing', {}), /on this phone/);

  const pulled = stall('Back v2');
  pulled.revision = 41;
  const stored = await writeStall(b.entry.id, pulled);
  assert.equal(stored.revision, 41, 'stored as given');
  assert.equal((await readStall(b.entry.id)).config.profile.stallName, 'Back v2');
  assert.equal((await read()).config.profile.stallName, 'Front', 'the active stall is untouched');
  assert.equal((await getMeta()).activeStallId, a.entry.id);
  await assert.rejects(writeStall(b.entry.id, {nope: true}), /not a ManageYourStall stall/);
});

test('an unlisted legacy root (old cached tab) is recovered as an extra entry; old tabs keep sharing key root', async () => {
  await wipe();
  await init();
  const a = await createStall(stall('New App Stall'));
  // An old single-stall tab writes its own state at 'root', unaware of the index.
  const legacy = initialState();
  legacy.onboarded = true;
  legacy.config.profile.stallName = 'Old Tab Stall';
  await raw('root', legacy);
  closeDB();
  const {meta, state} = await init();
  assert.equal(state.config.profile.stallName, 'New App Stall', 'the active stall stays active');
  assert.equal(meta.activeStallId, a.entry.id);
  assert.equal(meta.stalls.length, 2);
  const rec = meta.stalls.find(e => e.id === 'root');
  assert.equal(rec.key, 'root');
  assert.equal(rec.summary.name, 'Recovered stall');
  // Booting again doesn't add it twice.
  closeDB();
  assert.equal((await init()).meta.stalls.length, 2);
  // Opening it shows the old tab's data; writes land at 'root' so the old tab sees them too.
  await openStall('root');
  await mutate(st => { st.config.profile.booth = 'Shared'; });
  assert.equal((await raw('root')).config.profile.booth, 'Shared');
  assert.equal((await getMeta()).stalls.find(e => e.id === 'root').summary.name, 'Old Tab Stall');
});

test('media: prune keeps photos of inactive stalls; deleting or resetting a stall removes only its own', async () => {
  await wipe();
  await init();
  const a = await createStall(stall('Photo A'));
  for (const id of ['a-prod', 'a-bill', 'b-hero', 'shared', 'orphan']) await putMedia(id, PNG);
  await mutate(st => {
    st.config.products[0].image = 'media:a-prod';
    st.config.products[1].image = 'media:shared';
    addExpense(st.live, st.config, {id: 'x', title: 'Bill', category: 'misc', amount: 100, billImage: 'media:a-bill'});
  });
  const b = await createStall(stall('Photo B'));
  await mutate(st => {
    st.config.theme.heroImage = 'media:b-hero';
    st.config.products[0].image = 'media:shared';
  });
  await leaveStall();
  assert.equal(await pruneMedia(), 1, 'only the orphan goes, even with no stall open');
  assert.deepEqual(Object.keys(await getAllMedia()).sort(), ['a-bill', 'a-prod', 'b-hero', 'shared']);
  assert.deepEqual(Object.keys(await getMediaFor(await readStall(b.entry.id))).sort(), ['b-hero', 'shared']);

  // Factory-resetting stall A keeps B's photos (and the one they share).
  await openStall(a.entry.id);
  await replaceAll(stall('Photo A reset'), {'a-new': GIF});
  assert.deepEqual(Object.keys(await getAllMedia()).sort(), ['a-new', 'b-hero', 'shared']);
  await mutate(st => { st.config.products[0].image = 'media:a-new'; });

  // Deleting B removes its hero and the photo only it still used; A's photo stays.
  await deleteStall(b.entry.id);
  assert.deepEqual(Object.keys(await getAllMedia()).sort(), ['a-new']);
});

test('concurrency: parallel sales in one stall and parallel stall creation never lose writes', async () => {
  await wipe();
  await init();
  const made = await Promise.all(Array.from({length: 6}, (_, i) => createStall(stall(`Stall ${i}`), {open: false})));
  const meta = await getMeta();
  assert.equal(meta.stalls.length, 6);
  assert.equal(new Set(made.map(m => m.entry.id)).size, 6);
  await openStall(made[2].entry.id);
  await Promise.all([
    ...Array.from({length: 8}, () => mutate(st => createOrder(st.live, st.config, {id: uuid(), items: [makeLine(st.config, 'lemon-fizz')]}))),
    updateEntry(made[2].entry.id, {cloud: {status: 'pending', dirty: true}}),
    updateEntry(made[3].entry.id, {cloud: {status: 'synced', dirty: false}}),
  ]);
  const st = await read();
  assert.equal(st.live.orders.length, 8);
  const after = await getMeta();
  const e2 = after.stalls.find(e => e.id === made[2].entry.id);
  assert.equal(e2.summary.orders, 8, 'summary follows the last write');
  assert.equal(e2.cloud.status, 'pending', 'entry patches interleaved with writes survive');
  assert.equal(after.stalls.find(e => e.id === made[3].entry.id).cloud.status, 'synced');
  assert.equal((await readStall(made[3].entry.id)).live.orders.length, 0);
});
