// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// One request to the server, and what its answer means.
//
// sync.js tells two kinds of failure apart by whether the error has .status:
//   with .status     the server answered and said no: that change will never be
//                    accepted, so it is dropped from the queue
//   without .status  the server was not reached: keep the change and try later
// "You are not signed in" (401, hosted version only) must be the second kind:
// the games waiting on this device are fine, and go up after signing in.
export async function request(fetchFn, url, method = 'GET', body, timeout = 10000) {
  const r = await fetchFn(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout?.(timeout),  // a server that is switched off can leave a request hanging
  });
  if (r.ok) return r.json();
  const detail = (await r.json().catch(() => ({}))).detail;
  const error = new Error(typeof detail === 'string' ? detail : 'Something went wrong');
  if (r.status === 401) error.signedOut = true; else error.status = r.status;
  throw error;
}
