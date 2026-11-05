import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
// This suite tests the storage adapter, not a real browser or service worker.
globalThis.BroadcastChannel=undefined;
const {init,mutate,read}=await import('../dist/storage.mjs');
const {session,makeLine,createOrder,report,uuid}=await import('../dist/domain.mjs');
await init();
const reset=async()=>{await mutate(st=>{st.live=session();st.mode='live';for(const p of st.config.products)p.price=3000;st.config.addons=[{id:'corn',name:'Sweet Corn',price:1000}];});};
test('IndexedDB atomically stores both order and payment',async()=>{await reset();const id=uuid();await mutate(st=>createOrder(st.live,st.config,{id,items:[makeLine(st.config,'veggie-small')]}));const st=await read();assert.equal(st.live.orders.length,1);assert.equal(st.live.payments.length,1);assert.equal(report(st.live,st.config).collected,3000);});
test('failed mutation rolls back all changes',async()=>{await reset();await assert.rejects(mutate(st=>{st.live.orders.push({id:'must-not-persist'});throw Error('Simulated write failure');}));assert.equal((await read()).live.orders.length,0);});
test('concurrent checkout requests with same ID commit once',async()=>{await reset();const id=uuid();await Promise.all(Array.from({length:8},()=>mutate(st=>createOrder(st.live,st.config,{id,items:[makeLine(st.config,'veggie-small')]}))));const st=await read();assert.equal(st.live.orders.length,1);assert.equal(st.live.payments.length,1);});
test('independent concurrent sales do not overwrite each other',async()=>{await reset();await Promise.all(Array.from({length:8},()=>mutate(st=>createOrder(st.live,st.config,{id:uuid(),items:[makeLine(st.config,'fizz-sprite')]}))));const st=await read();assert.equal(st.live.orders.length,8);assert.equal(report(st.live,st.config).collected,24000);});
test('draft survives a new database read before checkout',async()=>{await reset();await mutate(st=>{st.live.draft.push(makeLine(st.config,'veggie-large',{addons:['corn']}));});assert.equal((await read()).live.draft[0].unitPrice,4000);});
test('empty checkout failure cannot create a partial payment',async()=>{await reset();await assert.rejects(mutate(st=>createOrder(st.live,st.config,{id:uuid(),items:[]})));const st=await read();assert.equal(st.live.orders.length,0);assert.equal(st.live.payments.length,0);});
