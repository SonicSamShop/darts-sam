// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the vision code in the phone's browser, off the page's own thread so
// the game stays smooth: Python (Pyodide) with NumPy and OpenCV from
// vision/pyodide/ (tools/fetch_pyodide.py puts it there), and the server's
// own board, calib, autocalib, detect, tracker and phonevision files from
// /vision/py/. One copy of the vision code, for the cameras' computer and phones.
//
// Each message from phonecam.js is {id, cmd, ...}; each answer carries the
// same id. Pictures arrive as RGBA ArrayBuffers.

import { loadPyodide } from './vision/pyodide/pyodide.mjs';

const FILES = ['board', 'calib', 'autocalib', 'detect', 'tracker', 'phonevision'];
let py = null, vision = null, calibration = null;  // the calibration being watched with, for knock checks

const toJs = proxy => {
  if (!proxy?.toJs) return proxy;
  const out = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return out;
};

async function load() {
  if (vision) return;
  postMessage({ type: 'progress', step: 1, of: 3 });
  py = await loadPyodide({ indexURL: new URL('./vision/pyodide/', import.meta.url).href });
  postMessage({ type: 'progress', step: 2, of: 3 });
  await py.loadPackage(['numpy', 'opencv-python']);
  postMessage({ type: 'progress', step: 3, of: 3 });
  py.FS.mkdirTree('/home/pyodide/server');
  py.FS.writeFile('/home/pyodide/server/__init__.py', '');
  await Promise.all(FILES.map(async n => {
    const r = await fetch(new URL(`./vision/py/${n}.py`, import.meta.url));
    if (!r.ok) throw new Error(`Couldn't load the vision code (${n}).`);
    py.FS.writeFile(`/home/pyodide/server/${n}.py`, await r.text());
  }));
  py.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')");
  vision = py.pyimport('server.phonevision');
}

const picture = m => new Uint8Array(m.frame);

const COMMANDS = {
  load: async () => { await load(); return { type: 'ready' }; },
  calibrate: m => ({ type: 'calibrated', result: toJs(vision.calibrate(picture(m), m.w, m.h, m.twenty ? py.toPy(m.twenty) : null)) }),
  start: m => { vision.start(py.toPy(m.calibration)); return { type: 'started' }; },
  frame: m => ({ type: 'events', events: toJs(vision.feed(picture(m), m.w, m.h)) }),
  check: m => ({ type: 'checked', ok: vision.still_matches(picture(m), m.w, m.h, py.toPy(calibration)) }),
  outline: m => ({ type: 'outline', lines: toJs(vision.outline(py.toPy(m.calibration))) }),
  restart: () => { vision.restart(); return { type: 'restarted' }; },
  stop: () => { vision?.stop(); return { type: 'stopped' }; },
};

onmessage = async e => {
  const m = e.data;
  try {
    if (m.cmd === 'start') calibration = m.calibration;
    const fn = COMMANDS[m.cmd];
    if (!fn) throw new Error(`unknown command ${m.cmd}`);
    if (m.cmd !== 'load' && !vision) throw new Error('The vision code has not loaded.');
    postMessage({ id: m.id, ...(await fn(m)) });
  } catch (err) {
    postMessage({ id: m.id, type: 'error', message: String(err?.message || err) });
  }
};
