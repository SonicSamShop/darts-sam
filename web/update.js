// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Reloading onto a new version: when the app's files on the server change while
// the app is open, it reloads itself, but only once nobody is in the middle
// of anything (app.js says when that is).
//   reload: reloads the page
//   idle:   true when a reload would not interrupt anyone
//   memory: {get, set} that outlives a reload, so one version is only reloaded for once
export function createUpdater({ reload, idle, memory }) {
  let mine = null, latest = null;  // the version this page is running; the one the server has now
  function check() {
    if (mine == null || latest == null || mine === latest || !idle()) return false;
    // A reload that still came back with the old files must not go round in circles.
    if (memory.get() === latest) return false;
    memory.set(latest);
    reload();
    return true;
  }
  return {
    // The version that came with this page's own files (it may be a saved copy's).
    running(v) { if (v) mine = v; return check(); },
    // The version the server says it has, each time the link to it comes up.
    // Until running() is known, the first one heard stands in for it.
    seen(v) { if (!v) return false; latest = v; mine ??= v; return check(); },
    check,
  };
}
