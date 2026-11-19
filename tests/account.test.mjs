import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../web/api.js';
import { createAccount, DEVICE_KEYS } from '../web/account.js';

const reply = (status, json) => async () => ({ ok: status < 400, status, json: async () => json });

test('a 401 looks like "not reached", so nothing queued is dropped', async () => {
  const e = await request(reply(401, { detail: 'Sign in first.' }), '/api/players').catch(e => e);
  assert.equal(e.status, undefined);
  assert.equal(e.signedOut, true);
});
test('other refusals still carry their status and message', async () => {
  const e = await request(reply(400, { detail: 'That name is taken' }), '/api/players', 'POST', { name: 'x' }).catch(e => e);
  assert.equal(e.status, 400);
  assert.equal(e.message, 'That name is taken');
  assert.deepEqual(await request(reply(200, [1]), '/api/players'), [1]);
});

function setup(routes) {
  const mem = new Map(Object.entries({ players: [{ id: 1, name: 'Ann' }], pending: { m1: {} }, theme: 'dark' }));
  const store = { get: (k, d) => mem.get(k) ?? d, set: (k, v) => mem.set(k, v) };
  const calls = [];
  const request = async (path, method = 'GET', body) => {
    calls.push([method, path, body]);
    const r = routes[`${method} ${path}`];
    if (r instanceof Error) throw r;
    return r;
  };
  return { mem, calls, account: createAccount({ request, store, onChange() {} }) };
}
const empty = v => v == null || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);

test('the local server has no /api/me: not hosted', async () => {
  const { account } = setup({ 'GET /api/me': Object.assign(new Error('Not Found'), { status: 404 }) });
  await account.load();
  assert.equal(account.hosted, false);
});
test('the first sign-in makes the account: no form in between', async () => {
  const { account, calls, mem } = setup({
    'GET /api/me': { hosted: true, google_client_id: 'c', apple_client_id: 'a', email: true, account: null },
    'POST /auth/email/start': { sent: true },
    'POST /auth/email': { account: { id: 'a1', nickname: 'Ann', admin: false }, new: false },
    'POST /auth/google': { account: { id: 'a1', nickname: 'Ann', admin: false }, new: true },
    'POST /auth/apple': { account: { id: 'a1', nickname: 'Ann', admin: false }, new: false },
  });
  await account.load();
  assert.equal(account.hosted, true);
  assert.equal(account.clientId, 'c');
  assert.equal(account.appleId, 'a');
  assert.equal(account.email, true);
  assert.equal(await account.signIn('google', { credential: 'tok' }), 'new');
  assert.deepEqual(calls.at(-1), ['POST', '/auth/google', { credential: 'tok' }]);
  assert.equal(account.account.nickname, 'Ann');
  assert.equal(mem.get('owner'), 'a1');
  assert.equal(mem.get('players').length, 1);  // what was on the device goes up to them
  assert.equal(await account.signIn('apple', { credential: 'tok2', name: 'Ann' }), 'in');
  assert.deepEqual(calls.at(-1), ['POST', '/auth/apple', { credential: 'tok2', name: 'Ann' }]);
  await account.sendCode('ann@example.com');
  assert.deepEqual(calls.at(-1), ['POST', '/auth/email/start', { email: 'ann@example.com' }]);
  assert.equal(await account.signIn('email', { email: 'ann@example.com', code: '123456' }), 'in');
  assert.deepEqual(calls.at(-1), ['POST', '/auth/email', { email: 'ann@example.com', code: '123456' }]);
});
test('someone new by email has no name until they give one', async () => {
  const { account, calls } = setup({
    'GET /api/me': { hosted: true, email: true, account: null },
    'POST /auth/email': { account: { id: 'a1', nickname: 'Player', admin: false }, new: true, named: false },
    'PATCH /api/me': { account: { id: 'a1', nickname: 'Eve', admin: false } },
  });
  await account.load();
  assert.equal(await account.signIn('email', { email: 'eve@example.com', code: '123456' }), 'unnamed');
  await account.rename('Eve', true);
  assert.deepEqual(calls.at(-1), ['PATCH', '/api/me', { nickname: 'Eve', player: true }]);
  assert.equal(account.account.nickname, 'Eve');
});
test('hosted and signed out is locked; the server at home never is', async () => {
  const hosted = setup({ 'GET /api/me': { hosted: true, google_client_id: 'c', account: null },
    'POST /auth/google': { account: { id: 'a1', nickname: 'Ann', admin: false } } });
  assert.equal(hosted.account.undecided, true);   // never been here: nothing to go by
  assert.equal(hosted.account.locked, false);
  await hosted.account.load();
  assert.equal(hosted.account.undecided, false);
  assert.equal(hosted.account.locked, true);
  await hosted.account.signIn('google', { credential: 'tok' });
  assert.equal(hosted.account.locked, false);
  hosted.account.expired();
  assert.equal(hosted.account.locked, true);

  const home = setup({ 'GET /api/me': Object.assign(new Error('Not Found'), { status: 404 }) });
  await home.account.load();
  assert.equal(home.account.undecided, false);
  assert.equal(home.account.locked, false);
  assert.equal(home.mem.get('hosted'), false);
});
test('opening again goes by last time until the server answers', async () => {
  const routes = { 'GET /api/me': new Error('offline') };
  // hosted, and nobody was signed in: the welcome page straight away
  const out = setup(routes);
  out.mem.set('hosted', true);
  const again = createAccount({ request: async () => { throw new Error('offline'); }, store: { get: (k, d) => out.mem.get(k) ?? d, set: (k, v) => out.mem.set(k, v) } });
  assert.equal(again.undecided, false);
  assert.equal(again.locked, true);
  // someone was: they play on with no network
  out.mem.set('owner', 'a1');
  await again.load();
  assert.equal(again.locked, false);
  assert.equal(out.mem.get('hosted'), true);  // not reaching the server changes nothing
});
test('signing out empties this device for the next person; other settings stay', async () => {
  const { account, mem } = setup({
    'GET /api/me': { hosted: true, google_client_id: 'c', account: { id: 'a1', nickname: 'Ann', admin: false } },
    'POST /auth/signout': { ok: true },
  });
  mem.set('owner', 'a1');
  await account.load();
  await account.signOut();
  assert.equal(account.account, null);
  for (const k of DEVICE_KEYS) assert.ok(empty(mem.get(k)), k);
  assert.equal(mem.get('owner'), null);
  assert.equal(mem.get('theme'), 'dark');
});
test('a different person signing in does not inherit the last one\'s games', async () => {
  const { account, mem } = setup({
    'GET /api/me': { hosted: true, google_client_id: 'c', account: null },
    'POST /auth/google': { account: { id: 'b2', nickname: 'Bob', admin: false } },
  });
  mem.set('owner', 'a1');
  await account.load();
  assert.equal(await account.signIn('google', { credential: 'tok' }), 'in');
  assert.ok(empty(mem.get('players')) && empty(mem.get('pending')));
  assert.equal(mem.get('owner'), 'b2');
});
test('a failed sign-out or delete clears nothing', async () => {
  const { account, mem } = setup({
    'GET /api/me': { hosted: true, google_client_id: 'c', account: { id: 'a1', nickname: 'Ann', admin: false } },
    'POST /auth/signout': new Error('offline'),
    'DELETE /api/me': new Error('offline'),
  });
  await account.load();
  await assert.rejects(account.signOut());
  await assert.rejects(account.remove());
  assert.equal(mem.get('players').length, 1);
  assert.equal(account.account.id, 'a1');
});
test('a session that ran out: signed out, nothing cleared', async () => {
  const { account, mem } = setup({ 'GET /api/me': { hosted: true, google_client_id: 'c', account: { id: 'a1', nickname: 'Ann', admin: false } } });
  await account.load();
  account.expired();
  assert.equal(account.account, null);
  assert.equal(mem.get('players').length, 1);
});
test('the paired cameras: known after load, kept up by refresh, nothing when signed out', async () => {
  const acc = { id: 'a1', nickname: 'Ann', admin: false };
  const routes = { 'GET /api/me': { hosted: true, google_client_id: 'c', account: acc, helper: null } };
  const { account } = setup(routes);
  await account.load();
  assert.equal(account.helper, null);
  routes['GET /api/me'] = { hosted: true, google_client_id: 'c', account: acc, helper: { connected: true, cameras: 3, platform: 'linux' } };
  await account.refresh();
  assert.deepEqual(account.helper, { connected: true, cameras: 3, platform: 'linux' });
  assert.equal(account.account.id, 'a1');
  account.expired();
  assert.equal(account.helper, null);
  routes['GET /api/me'] = new Error('offline');
  await assert.rejects(account.refresh());
});

test('at the home page\'s own address it is always the welcome page, and the app\'s address is remembered', async () => {
  const me = { hosted: true, google_client_id: 'c', home: 'https://darts.example', app: 'https://app.darts.example', account: { id: 'a1', nickname: 'Ann' } };
  const mem = new Map();
  const store = { get: (k, d) => mem.get(k) ?? d, set: (k, v) => mem.set(k, v) };
  const at = origin => createAccount({ request: async () => me, store, origin });
  const front = at('https://darts.example');
  await front.load();
  assert.equal(front.front, true);
  assert.equal(front.locked, true);   // signed in or not
  assert.equal(front.account, null);
  assert.equal(front.app, 'https://app.darts.example');
  const again = at('https://darts.example');  // opened again, before the server has answered
  assert.equal(again.locked, true);
  assert.equal(again.app, 'https://app.darts.example');
  const app = at('https://app.darts.example');
  await app.load();
  assert.equal(app.front, false);
  assert.equal(app.locked, false);
  assert.equal(app.account.id, 'a1');
  assert.equal(app.home, 'https://darts.example');
  assert.equal(mem.get('front'), null);
});
