// Live tests for the MYS Convex backend (convex/, ARCHITECTURE.md §17.3) through the public HTTP API.
// Runs when MYS_CONVEX_LIVE=1, or when the deployment answers within a few seconds; MYS_CONVEX_LIVE=0 always skips.
// Creates throwaway accounts with login IDs starting "test-"; every stall it creates is removed again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {CONVEX_URL as CONFIG_URL} from '../dist/config.mjs';

const URL_BASE = (process.env.CONVEX_URL || CONFIG_URL || '').replace(/\/+$/, '');

async function reachable() {
  if (!URL_BASE) return false;
  try {
    const r = await fetch(`${URL_BASE}/version`, {signal: AbortSignal.timeout(4000)});
    return r.ok;
  } catch {
    return false;
  }
}

const flag = process.env.MYS_CONVEX_LIVE;
const live = flag === '1' ? Boolean(URL_BASE) : flag === '0' ? false : await reachable();
const skip = live ? false : 'Convex deployment not reachable (set MYS_CONVEX_LIVE=1 to force)';

/** Call a Convex function; resolves the value or rejects with Error(errorData) (err.data = errorData). */
async function call(kind, path, args = {}) {
  const r = await fetch(`${URL_BASE}/api/${kind}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({path, args, format: 'json'}),
  });
  const body = await r.json();
  if (body.status === 'success') return body.value;
  const err = new Error(typeof body.errorData === 'string' ? body.errorData : body.errorMessage);
  /** @type {any} */ (err).data = body.errorData;
  throw err;
}
const q = (path, args) => call('query', path, args);
const m = (path, args) => call('mutation', path, args);
const a = (path, args) => call('action', path, args);

/** Assert a call fails with a friendly ConvexError (string errorData) matching re. */
async function refuses(promise, re) {
  await assert.rejects(promise, err => {
    assert.equal(typeof err.data, 'string', `expected a friendly ConvexError, got: ${err.message}`);
    assert.match(err.data, re);
    return true;
  });
}

const rand = () => randomBytes(5).toString('hex');
const newLoginId = () => `test-${rand()}`;
const device = {deviceId: `test-device-${rand()}`, deviceLabel: 'node:test'};
const PASSWORD = 'chai-samosa-42';

async function signUp(name = 'Test Owner') {
  const loginId = newLoginId();
  const res = await a('auth:signUp', {loginId, password: PASSWORD, name, ...device});
  return {loginId, ...res};
}

/** Upload a JSON snapshot and return its storageId. */
async function upload(token, data) {
  const url = await m('stalls:generateUploadUrl', {token});
  assert.equal(typeof url, 'string');
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)});
  assert.equal(r.status, 200, 'upload POST should succeed');
  const {storageId} = await r.json();
  assert.equal(typeof storageId, 'string');
  return storageId;
}

const INFO = {name: 'Test Chaat Corner', booth: 'B-7', themeId: 'chaat', accent: '#FF5A36', heroArt: ['samosa'],
  eventName: 'Test Fest', city: 'Pune'};
const SUMMARY = {orders: 3, collected: 45000, bills: 1200};
const snapshot = label => ({format: 'mys-backup', label, at: new Date().toISOString(), items: [1, 2, 3], note: 'चाय ☕'});

test('accounts: sign up → me → log out → log in → wrong password → lockout', {skip}, async () => {
  const owner = await signUp('Chotu Owner');
  assert.match(owner.token, /^[A-Za-z0-9_-]{43}$/, '32-byte base64url token');
  assert.deepEqual(owner.user, {id: owner.user.id, loginId: owner.loginId, name: 'Chotu Owner'});

  const me = await q('auth:me', {token: owner.token});
  assert.equal(me.kind, 'user');
  assert.deepEqual(me.user, owner.user);

  assert.equal(await m('auth:logOut', {token: owner.token}), null);
  assert.equal(await q('auth:me', {token: owner.token}), null, 'logged out token is dead');
  assert.equal(await m('auth:logOut', {token: owner.token}), null, 'logging out twice is fine');
  await refuses(q('stalls:list', {token: owner.token}), /log in again/i);

  // Login ID is normalized: spaces + capitals are fine.
  const back = await a('auth:logIn', {loginId: `  ${owner.loginId.toUpperCase()} `, password: PASSWORD, ...device});
  assert.deepEqual(back.user, owner.user);
  assert.notEqual(back.token, owner.token);
  assert.equal((await q('auth:me', {token: back.token})).user.loginId, owner.loginId);

  const updated = await m('auth:updateProfile', {token: back.token, name: '  Chotu Bhai  '});
  assert.equal(updated.name, 'Chotu Bhai');
  await refuses(m('auth:updateProfile', {token: back.token, name: 'x'.repeat(61)}), /at most 60/);

  // 5 wrong passwords → locked; then even the right password is refused for now.
  for (let i = 1; i <= 4; i++) {
    await refuses(a('auth:logIn', {loginId: owner.loginId, password: `wrong-${i}xx`, ...device}), /^Login ID or password is wrong\.$/);
  }
  await refuses(a('auth:logIn', {loginId: owner.loginId, password: 'wrong-5xx', ...device}), /wrong.*Too many wrong tries.*1 min/);
  await refuses(a('auth:logIn', {loginId: owner.loginId, password: PASSWORD, ...device}), /Too many wrong tries/);
  // The existing session keeps working during a lockout.
  assert.equal((await q('auth:me', {token: back.token})).kind, 'user');
});

test('accounts: unknown login, duplicate login ID and bad input are refused kindly', {skip}, async () => {
  const owner = await signUp();
  await refuses(a('auth:signUp', {loginId: owner.loginId.toUpperCase(), password: PASSWORD, name: 'Copy', ...device}),
    /already taken/);
  await refuses(a('auth:logIn', {loginId: newLoginId(), password: PASSWORD, ...device}), /^Login ID or password is wrong\.$/);
  await refuses(a('auth:signUp', {loginId: 'ab', password: PASSWORD, ...device}), /at least 3/);
  await refuses(a('auth:signUp', {loginId: 'has space', password: PASSWORD, ...device}), /letters, numbers/);
  await refuses(a('auth:signUp', {loginId: newLoginId(), password: '12345', ...device}), /at least 6/);
  await refuses(a('auth:signUp', {loginId: newLoginId(), password: 'x'.repeat(101), ...device}), /at most 100/);
  assert.equal(await q('auth:me', {token: 'not-a-real-token-at-all-nope'}), null);
});

test('accounts: change password signs out other sessions', {skip}, async () => {
  const owner = await signUp();
  const other = await a('auth:logIn', {loginId: owner.loginId, password: PASSWORD, ...device});
  assert.equal((await q('auth:me', {token: other.token})).kind, 'user');

  await refuses(a('auth:changePassword', {token: owner.token, oldPassword: 'not-it-123', newPassword: 'new-pass-99'}),
    /Current password is wrong/);
  await refuses(a('auth:changePassword', {token: owner.token, oldPassword: PASSWORD, newPassword: '123'}), /at least 6/);
  assert.equal(await a('auth:changePassword', {token: owner.token, oldPassword: PASSWORD, newPassword: 'new-pass-99'}), null);

  assert.equal((await q('auth:me', {token: owner.token})).kind, 'user', 'this device stays signed in');
  assert.equal(await q('auth:me', {token: other.token}), null, 'other devices are signed out');
  await refuses(a('auth:logIn', {loginId: owner.loginId, password: PASSWORD, ...device}), /wrong/);
  const fresh = await a('auth:logIn', {loginId: owner.loginId, password: 'new-pass-99', ...device});
  assert.equal(fresh.user.id, owner.user.id);
});

test('stalls: create, list, updateInfo, snapshots with conflicts, team access, remove', {skip}, async () => {
  const owner = await signUp();
  const stranger = await signUp('Stranger');
  const token = owner.token;
  const created = [];
  try {
    assert.deepEqual(await q('stalls:list', {token}), []);
    await refuses(m('stalls:create', {token, info: {...INFO, name: '   '}}), /name/i);
    await refuses(m('stalls:create', {token, info: {...INFO, name: 'n'.repeat(61)}}), /at most 60/);

    const stall = await m('stalls:create', {token, info: INFO});
    created.push(stall.id);
    assert.match(stall.code, /^MYS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    const second = await m('stalls:create', {token, info: {name: 'Second Stall'}});
    created.push(second.id);
    assert.notEqual(second.code, stall.code);

    let list = await q('stalls:list', {token});
    assert.equal(list.length, 2);
    const row = list.find(s => s.id === stall.id);
    assert.equal(row.code, stall.code);
    assert.equal(row.name, INFO.name);
    assert.equal(row.booth, 'B-7');
    assert.deepEqual(row.heroArt, ['samosa']);
    assert.equal(row.revision, 0);
    assert.equal(row.snapshotAt, null);
    assert.equal(row.hasTeamPassword, false);
    assert.deepEqual(row.summary, {orders: 0, collected: 0, bills: 0});
    assert.equal(list.find(s => s.id === second.id).booth, '', 'booth is optional');

    const upd = await m('stalls:updateInfo', {token, stallId: stall.id, info: {booth: '', city: 'Mumbai'}});
    assert.equal(upd.booth, '');
    assert.equal(upd.city, 'Mumbai');
    assert.equal(upd.name, INFO.name, 'fields not sent are kept');
    await refuses(m('stalls:updateInfo', {token, stallId: stall.id, info: {eventName: 'e'.repeat(61)}}), /at most 60/);

    // Strangers and bad ids can't touch it.
    assert.deepEqual(await q('stalls:list', {token: stranger.token}), []);
    await refuses(m('stalls:updateInfo', {token: stranger.token, stallId: stall.id, info: {name: 'Hijack'}}), /not found/);
    await refuses(q('stalls:getSnapshot', {token: stranger.token, stallId: stall.id}), /not found/);
    await refuses(m('stalls:remove', {token: stranger.token, stallId: stall.id}), /not found/);
    await refuses(m('stalls:updateInfo', {token, stallId: 'nope', info: {name: 'x'}}), /not found/);

    // ---- snapshots
    assert.equal(await q('stalls:getSnapshot', {token, stallId: stall.id}), null);
    const first = snapshot('first');
    const id1 = await upload(token, first);
    const bytes1 = JSON.stringify(first).length;
    await refuses(m('stalls:commitSnapshot', {token, stallId: stall.id, storageId: id1, baseRevision: 0, bytes: bytes1,
      summary: {...SUMMARY, collected: -5}, info: null, device: 'Phone A'}), /summary/i);
    const c1 = await m('stalls:commitSnapshot', {token, stallId: stall.id, storageId: id1, baseRevision: 0, bytes: bytes1,
      summary: SUMMARY, info: {name: 'Test Chaat Corner 2'}, device: 'Phone A'});
    assert.deepEqual(c1, {ok: true, revision: 1});
    await refuses(m('stalls:commitSnapshot', {token, stallId: second.id, storageId: id1, baseRevision: 0, bytes: bytes1,
      summary: SUMMARY, device: 'Phone A'}), /already used/);

    const snap1 = await q('stalls:getSnapshot', {token, stallId: stall.id});
    assert.equal(snap1.revision, 1);
    assert.equal(snap1.snapshotDevice, 'Phone A');
    assert.ok(Date.parse(snap1.snapshotAt) > 0);
    assert.ok(snap1.bytes > 0);
    assert.deepEqual(await (await fetch(snap1.url)).json(), first, 'download = upload');
    list = await q('stalls:list', {token});
    const after = list.find(s => s.id === stall.id);
    assert.deepEqual(after.summary, SUMMARY);
    assert.equal(after.name, 'Test Chaat Corner 2');
    assert.equal(after.revision, 1);

    // Stale base revision → conflict; the cloud copy is untouched.
    const idStale = await upload(token, snapshot('stale'));
    const conflict = await m('stalls:commitSnapshot', {token, stallId: stall.id, storageId: idStale, baseRevision: 0, bytes: 10,
      summary: SUMMARY, device: 'Phone B'});
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.revision, 1);
    assert.equal(conflict.snapshotDevice, 'Phone A');
    assert.equal(conflict.snapshotAt, snap1.snapshotAt);
    assert.equal((await q('stalls:getSnapshot', {token, stallId: stall.id})).revision, 1);
    // The rejected upload was deleted, so it can't be committed later.
    await refuses(m('stalls:commitSnapshot', {token, stallId: stall.id, storageId: idStale, baseRevision: 1, bytes: 10,
      summary: SUMMARY, device: 'Phone B'}), /didn't arrive/);

    // Force wins and replaces (and deletes) the previous file.
    const forced = snapshot('forced');
    const idForce = await upload(token, forced);
    const c2 = await m('stalls:commitSnapshot', {token, stallId: stall.id, storageId: idForce, baseRevision: 0, bytes: 10,
      summary: {orders: 4, collected: 50000, bills: 1200}, device: 'Phone B', force: true});
    assert.deepEqual(c2, {ok: true, revision: 2});
    const snap2 = await q('stalls:getSnapshot', {token, stallId: stall.id});
    assert.equal(snap2.revision, 2);
    assert.equal(snap2.snapshotDevice, 'Phone B');
    assert.deepEqual(await (await fetch(snap2.url)).json(), forced);
    assert.notEqual((await fetch(snap1.url)).status, 200, 'previous snapshot file is deleted');

    // ---- team access
    await refuses(a('stalls:join', {code: stall.code, password: 'team-pass-1', ...device}), /no team password/);
    await refuses(a('stalls:setTeamPassword', {token, stallId: stall.id, password: '123'}), /at least 6/);
    await refuses(a('stalls:setTeamPassword', {token: stranger.token, stallId: stall.id, password: 'team-pass-1'}), /not found/);
    assert.deepEqual(await a('stalls:setTeamPassword', {token, stallId: stall.id, password: 'team-pass-1'}), {hasTeamPassword: true});
    assert.equal((await q('stalls:list', {token})).find(s => s.id === stall.id).hasTeamPassword, true);

    await refuses(a('stalls:join', {code: stall.code, password: 'not-the-one', ...device}), /code or team password is wrong/);
    await refuses(a('stalls:join', {code: 'MYS-0000', password: 'team-pass-1', ...device}), /look like MYS-/);
    // Codes are forgiving: lowercase, no dash.
    const team = await a('stalls:join', {code: stall.code.replace('-', '').toLowerCase(), password: 'team-pass-1', ...device});
    assert.match(team.token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(team.stall, {id: stall.id, code: stall.code, name: 'Test Chaat Corner 2'});

    const teamMe = await q('auth:me', {token: team.token});
    assert.equal(teamMe.kind, 'stall');
    assert.equal(teamMe.user, null);
    assert.equal(teamMe.stallId, stall.id);
    assert.deepEqual(teamMe.stall, team.stall);

    const teamList = await q('stalls:list', {token: team.token});
    assert.deepEqual(teamList.map(s => s.id), [stall.id], 'team sees only its stall');
    const teamSnap = await q('stalls:getSnapshot', {token: team.token, stallId: stall.id});
    assert.deepEqual(await (await fetch(teamSnap.url)).json(), forced);
    const teamData = snapshot('team');
    const idTeam = await upload(team.token, teamData);
    assert.deepEqual(await m('stalls:commitSnapshot', {token: team.token, stallId: stall.id, storageId: idTeam, baseRevision: 2,
      bytes: 10, summary: SUMMARY, device: 'Team phone'}), {ok: true, revision: 3});
    assert.deepEqual(await (await fetch((await q('stalls:getSnapshot', {token, stallId: stall.id})).url)).json(), teamData);

    await refuses(q('stalls:getSnapshot', {token: team.token, stallId: second.id}), /only works for its own stall/);
    await refuses(m('stalls:updateInfo', {token: team.token, stallId: second.id, info: {name: 'x'}}), /only works for its own stall/);
    await refuses(m('stalls:remove', {token: team.token, stallId: stall.id}), /Only the stall owner/);
    await refuses(m('stalls:create', {token: team.token, info: {name: 'Team made'}}), /Team logins can't/);
    await refuses(a('stalls:setTeamPassword', {token: team.token, stallId: stall.id, password: 'mine-now-1'}), /Only the stall owner/);
    await refuses(a('auth:changePassword', {token: team.token, oldPassword: 'team-pass-1', newPassword: 'whatever-1'}),
      /Team logins can't/);
    await refuses(m('auth:updateProfile', {token: team.token, name: 'Team'}), /Team logins can't/);

    // Removing team access signs the team out.
    assert.deepEqual(await a('stalls:setTeamPassword', {token, stallId: stall.id, password: null}), {hasTeamPassword: false});
    assert.equal(await q('auth:me', {token: team.token}), null);
    await refuses(a('stalls:join', {code: stall.code, password: 'team-pass-1', ...device}), /no team password/);

    // ---- remove
    const lastUrl = (await q('stalls:getSnapshot', {token, stallId: stall.id})).url;
    assert.equal(await m('stalls:remove', {token, stallId: stall.id}), null);
    created.splice(created.indexOf(stall.id), 1);
    assert.deepEqual((await q('stalls:list', {token})).map(s => s.id), [second.id]);
    await refuses(q('stalls:getSnapshot', {token, stallId: stall.id}), /not found/);
    assert.notEqual((await fetch(lastUrl)).status, 200, 'snapshot file is deleted with the stall');
  } finally {
    for (const id of created) await m('stalls:remove', {token, stallId: id}).catch(() => {});
  }
});

test('team join lockout: 5 wrong team passwords lock the stall code', {skip}, async () => {
  const owner = await signUp();
  const stall = await m('stalls:create', {token: owner.token, info: {name: 'Lockout Stall'}});
  try {
    await a('stalls:setTeamPassword', {token: owner.token, stallId: stall.id, password: 'team-pass-2'});
    for (let i = 1; i <= 4; i++) {
      await refuses(a('stalls:join', {code: stall.code, password: `nope-${i}xx`, ...device}), /^Stall code or team password is wrong\.$/);
    }
    await refuses(a('stalls:join', {code: stall.code, password: 'nope-5xx', ...device}), /Too many wrong tries/);
    await refuses(a('stalls:join', {code: stall.code, password: 'team-pass-2', ...device}), /Too many wrong tries/);
  } finally {
    await m('stalls:remove', {token: owner.token, stallId: stall.id}).catch(() => {});
  }
});
