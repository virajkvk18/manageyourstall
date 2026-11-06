// Storage adapter tests (dist/storage.mjs) against fake-indexeddb.
// This suite tests the IndexedDB adapter only — not a real browser, BroadcastChannel or service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import 'fake-indexeddb/auto';

globalThis.BroadcastChannel = undefined;

const storage = await import('../dist/storage.mjs');
const {init, mutate, read, closeDB, getAllMedia, putMedia, deleteMedia, replaceAll, pruneMedia, DB_NAME} = storage;
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
  const st = await init();
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
