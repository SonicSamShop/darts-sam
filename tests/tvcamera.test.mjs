import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import x01 from '../web/games/x01.js';
import { compute, newMatch } from '../web/engine.js';
import { FULL_VIEW, TOP_20_VIEW, cameraForDart, neighborsOf, pointInView } from '../web/tv-camera.js';

function play(start, darts = []) {
  const m = newMatch('x01', ['Sam', 'Bot'], { start, legs: 1, sets: 1, in: 'straight', out: 'double' });
  for (const d of darts) m.log.push({ t: 'dart', ...d });
  return compute(m);
}

describe('TV broadcast camera (X01)', () => {
  it('frames top 20s (12 / 5 / 20 / 1 / 18) when scoring above 170', () => {
    const cam = x01.tvCamera(play(501));
    assert.equal(cam.mode, 'scoring');
    assert.deepEqual(cam.viewBox, TOP_20_VIEW);
    assert.deepEqual(cam.neighbors, [12, 5, 20, 1, 18]);
  });

  it('tracks 170: top 20s for T20, top 20s for second T20, then zooms to Bull', () => {
    const s0 = play(170);
    assert.equal(x01.tvCamera(s0).mode, 'scoring');

    const s1 = play(170, [{ seg: 20, mult: 3 }]);
    assert.equal(s1.score[0], 110);
    assert.equal(x01.tvCamera(s1).mode, 'scoring');

    const s2 = play(170, [{ seg: 20, mult: 3 }, { seg: 20, mult: 3 }]);
    assert.equal(s2.score[0], 50);
    const cam = x01.tvCamera(s2);
    assert.equal(cam.mode, 'bull');
    assert.equal(cam.camTag, 'Bullseye');
    assert.ok(cam.viewBox[2] <= 150);
  });

  it('zooms tightly to D16 (7 · 16 · 8) on 32, and pans to D8 (16 · 8 · 11) after S16', () => {
    const cam32 = x01.tvCamera(play(32));
    assert.equal(cam32.mode, 'double');
    assert.equal(cam32.finishing, true);
    assert.equal(cam32.camTag, 'Double 16');
    assert.ok(cam32.viewBox[2] <= 120);
    assert.deepEqual(cam32.neighbors, [7, 16, 8]);
    assert.deepEqual(neighborsOf(16), [7, 16, 8]);

    const cam16 = x01.tvCamera(play(32, [{ seg: 16, mult: 1 }]));
    assert.equal(cam16.mode, 'double');
    assert.equal(cam16.finishing, true);
    assert.equal(cam16.camTag, 'Double 8');
    assert.ok(cam16.viewBox[2] <= 120);
    assert.deepEqual(cam16.neighbors, [16, 8, 11]);
  });

  it('switches to T19 (3 · 19 · 7) on 167 after hitting T20', () => {
    const cam = x01.tvCamera(play(167, [{ seg: 20, mult: 3 }]));
    assert.equal(cam.mode, 'treble');
    assert.equal(cam.camTag, 'Treble 19');
    assert.deepEqual(cam.neighbors, [3, 19, 7]);
  });

  it('zooms back out to full board when the leg is won', () => {
    const s = play(32, [{ seg: 16, mult: 2 }]);
    assert.equal(s.winner, 0);
    assert.deepEqual(x01.tvCamera(s).viewBox, FULL_VIEW);
  });

  it('detects out-of-frame darts on lower beds and zooms to show them', () => {
    // T20, Bull, 5, 1, 18 are comfortably inside TOP_20_VIEW (no peek needed)
    assert.equal(pointInView(0, 103, TOP_20_VIEW), true);       // T20
    assert.equal(pointInView(0, 0, TOP_20_VIEW), true);         // Bull
    assert.equal(pointInView(80, 108, TOP_20_VIEW), true);      // S18
    // Edge of frame (within 6mm) or lower bed (T19) triggers peek
    assert.equal(pointInView(124, 100, TOP_20_VIEW), false);    // right on the edge
    assert.equal(pointInView(-32, -98, TOP_20_VIEW), false);    // T19 is out of view
    const peek = cameraForDart({ seg: 19, mult: 3, x: -32, y: -98 });
    assert.equal(peek.camTag, 'Treble 19');
    assert.deepEqual(peek.neighbors, [3, 19, 7]);
    assert.equal(pointInView(-32, -98, peek.viewBox), true);
  });
});
