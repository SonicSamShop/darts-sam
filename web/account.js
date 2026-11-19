// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The hosted version: who is signed in on this device.
//
// The server at home has no accounts and no /api/me address; finding one is
// how the app knows it is the hosted version (hosted). There each person signs
// in with Google, Apple or a code sent by email and has their own players, games and stats, and
// nobody plays without signing in (locked): they get the welcome page instead.
//
// The site can keep its home page at one address and the app at another (home,
// app: "home" and "site" in the server's host.json). At the home page's address
// (front) nobody is ever signed in: it is always the welcome page, and signing in
// happens at the app's.
//
// One person's data is also kept on the device (see sync.js) so the app works
// offline. DEVICE_KEYS is that data: it is cleared when they sign out, so the
// next person to sign in here starts empty instead of inheriting it.
export const DEVICE_KEYS = ['players', 'ops', 'pending', 'dirty', 'recent', 'settings', 'setup', 'match', 'totals', 'events'];

// request(path, method, body): resolves with the server's reply or rejects.
// store: {get(key, fallback), set(key, value)}.  onChange(): signed in or out.
// origin: the address the page is at.
export function createAccount({ request, store, onChange = () => {}, origin = globalThis.location?.origin }) {
  let hosted = false, account = null, clientId = null, appleId = null, email = false, helper = null;
  let home = store.get('home', null);  // kept from last time, like the rest
  let app = store.get('front', null);  // kept from last time at the home page's address: where the app is
  let front = !!app;
  // Has the server said, this time, whether it is the hosted version and who is
  // signed in? Until it has, the app goes by what it found last time ('hosted'
  // and 'owner' on the device), so it opens on the right page straight away.
  let known = false;
  const before = store.get('hosted', null);  // null: this device has never been told
  const sure = is => { hosted = is; known = true; store.set('hosted', is); };
  const clear = () => { for (const k of DEVICE_KEYS) store.set(k, null); };
  function now(acc) {
    account = acc;
    onChange();
  }

  return {
    get hosted() { return hosted; },
    get account() { return account; },
    get clientId() { return clientId; },
    get appleId() { return appleId; },  // null: no "Sign in with Apple" on this site
    get email() { return email; },      // false: no signing in by email on this site
    get home() { return home; },        // the home page's address, when it is not the app's (else null)
    get app() { return app; },          // and the app's (null too when they are the same)
    get front() { return front; },      // this is the home page's address: the welcome page, whoever they are
    // Nothing to go by yet, from the server or from last time: wait for load() before drawing anything.
    get undecided() { return !known && before === null; },
    // Nobody is signed in on the hosted version: the welcome page, and nothing else.
    // With no network, whoever was last signed in on this device plays on.
    get locked() { return front || (known ? hosted && !account : before === true && !store.get('owner', null)); },
    // The computer the person's cameras are plugged into, once paired:
    // {connected, cameras, platform}. null: none paired, or signed out.
    get helper() { return account ? helper : null; },

    async load() {
      let me;
      try { me = await request('/api/me'); } catch (e) {
        if (e.status) sure(false);  // answered, with no such address: the server at home
        return;                     // no network: as last known
      }
      sure(!!me.hosted);
      clientId = me.google_client_id ?? null;
      appleId = me.apple_client_id ?? null;
      email = !!me.email;
      helper = me.helper ?? null;
      home = me.home ?? null;
      store.set('home', home);
      app = me.app ?? null;
      front = !!home && !!app && origin === home;
      store.set('front', front ? app : null);
      now(front ? null : me.account ?? null);
    },
    // Ask again (has the helper connected yet?). Rejects if the server can't be reached.
    async refresh() {
      const me = await request('/api/me');
      if (front) return;
      helper = me.helper ?? null;
      if ((me.account?.id ?? null) !== (account?.id ?? null)) now(me.account ?? null);
    },
    // The server said "not signed in" to something: the session has run out.
    // (If the app opened with no network it has not asked who is signed in yet: now it can.)
    expired() {
      if (account) now(null); else if (!known) return this.load();
    },

    // Signing in by email, step one: have a code and a link sent to the address.
    async sendCode(address) {
      await request('/auth/email/start', 'POST', { email: address });
    },
    // provider and what it needs to be told:
    //   'google', 'apple'  {credential} what its button gave the page (and from
    //                      Apple, the first time only, {name}: the person's first name)
    //   'email'            {email, code}: the code they were sent, typed in
    //   'email/link'       {token}: from the link in the email
    // Someone new to the site gets an account there and then, and 'new' back ('unnamed' when the
    // sign-in said no name, as by email: the account and its player are "Player" until they give one);
    // anyone else 'in'.
    async signIn(provider, details) {
      const r = await request(`/auth/${provider}`, 'POST', details);
      const owner = store.get('owner', null);
      if (owner && owner !== r.account.id) clear();  // someone else's, left by a session that ran out
      store.set('owner', r.account.id);
      now(r.account);
      return r.new ? (r.named === false ? 'unnamed' : 'new') : 'in';
    },
    // Change the account's name; with player, their player of the old name takes it too.
    async rename(nickname, player = false) {
      const r = await request('/api/me', 'PATCH', { nickname, player });
      now(r.account);
    },
    async signOut() {
      await request('/auth/signout', 'POST');
      clear();
      store.set('owner', null);
      now(null);
    },
    // Delete the account and everything saved in it.
    async remove() {
      await request('/api/me', 'DELETE');
      clear();
      store.set('owner', null);
      now(null);
    },
  };
}
