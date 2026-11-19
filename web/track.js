// The trial's notes on how the app is used (hosted version only).
//
// A few small events are kept on the device and sent to the site when someone
// is signed in: the app was opened, a calibration worked or failed, a problem
// report was made, and "correction": a dart the cameras scored was undone and
// entered by hand instead. The saved game cannot show that, because an undone
// dart is simply not in it, and it is the plainest sign of the cameras being
// wrong.
//
// store: {get, set}.  recording(): is this the hosted version?  sending(): is
// someone signed in?  send(batch): resolves when the site has them.
const KEEP = 200, AT_ONCE = 50;

export function createTracker({ store, send, recording, sending, now = Date.now }) {
  let armed = null;   // {match, was}: a camera dart was just undone
  let flushing = null;

  function track(kind, detail = {}) {
    if (!recording()) return;
    store.set('events', [...store.get('events', []), { kind, ts: now(), detail }].slice(-KEEP));
  }

  return {
    track,
    // Undo took `dart` (the log's last entry, if it was a dart) out of the game.
    undone(matchId, dart) {
      armed = dart?.src === 'cam' ? { match: matchId, was: { seg: dart.seg, mult: dart.mult } } : null;
    },
    // A dart went into the game, however it was entered.
    entered(matchId, dart) {
      if (armed && armed.match === matchId && (dart.src === 'tap' || dart.src === 'miss')) {
        track('correction', { match: matchId, was: armed.was, now: { seg: dart.seg, mult: dart.mult, src: dart.src } });
      }
      armed = null;
    },
    // Play moved on some other way (next player, a new game): no correction is coming.
    moved() { armed = null; },

    // Send what is waiting. One at a time; what fails to go stays for next time.
    flush() {
      if (flushing) return flushing;
      const run = (async () => {
        try {
          while (sending()) {
            const batch = store.get('events', []).slice(0, AT_ONCE);
            if (!batch.length) break;
            await send(batch);
            store.set('events', store.get('events', []).slice(batch.length));  // new ones were added at the end
          }
        } catch { /* not reached: they wait */ }
      })();
      flushing = run;
      run.then(() => { if (flushing === run) flushing = null; });
      return run;
    },
  };
}
