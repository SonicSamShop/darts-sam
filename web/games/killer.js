// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Killer. First everyone gets a number: one dart each with the weak hand, and
// the segment it lands in is theirs (a miss, the bull or a number already
// taken: throw again). Then hit your own double to become a killer. A killer
// takes a life off anyone whose double they hit, their own included. Last
// player with a life left wins.
//
// Two options change which darts count (both are doubles unless set):
//   - opts.become 'treble': it takes your own treble to become a killer;
//   - opts.kill 'any': a killer takes a life with any part of a number, single,
//     double or treble (one life a dart), their own number included.
//
// Each option's help(value, opts) says in a line what that choice means, shown
// under it on the menu (and over each choice as a tooltip).
//
// House rules (opts.mode 'house') add two things:
//   - hit someone else's double before you are a killer and *they* become one;
//   - a Shanghai on your own number (single, double and treble of it in one
//     visit, in any order) wins the game there and then.
const picking = s => s.num.includes(null);
const becomeMult = s => (s.opts.become === 'treble' ? 3 : 2);
const kills = (s, d) => (s.opts.kill === 'any' ? d.mult > 0 : d.mult === 2);
const alive = s => s.lives.map((l, i) => (l > 0 ? i : -1)).filter(i => i >= 0);

function loseLife(s, i) {
  s.lives[i]--;
  s.event = s.lives[i] > 0 ? `${s.players[i]} loses a life` : `${s.players[i]} is out`;
}

export default {
  id: 'killer',
  kind: 'match',
  name: 'Killer',
  blurb: 'Weak hand for your number, hit your double (or treble) to become a killer, then take lives off the others\' numbers. Last one standing wins.',
  showTotal: false,  // the three-dart sum means nothing in this game
  options: [
    { key: 'lives', label: 'Lives', choices: [[3, '3'], [5, '5']], default: 5, brief: v => `${v} lives`,
      help: v => `Everyone starts with ${v} lives.${v === 3 ? ' A quicker game.' : ''}` },
    { key: 'become', label: 'Become a killer', choices: [['double', 'Double'], ['treble', 'Treble']], default: 'double', brief: v => v === 'treble' ? 'Treble to start' : '',
      help: v => v === 'treble'
        ? 'Hit the treble of your own number (the thin inner ring) to become a killer. Harder, so the game lasts longer.'
        : 'Hit the double of your own number (the thin outer ring) to become a killer.' },
    { key: 'kill', label: 'Take lives with', choices: [['double', 'Double'], ['any', 'Any part']], default: 'double', brief: v => v === 'any' ? 'Any part kills' : '',
      help: v => v === 'any'
        ? 'Once you are a killer, hitting any part of another player\'s number (single, double or treble) takes one of their lives. Hit your own number and you lose one.'
        : 'Once you are a killer, hitting the double of another player\'s number takes one of their lives. Hit your own double and you lose one.' },
    { key: 'mode', label: 'Rules', choices: [['house', 'House rules'], ['classic', 'Classic']], default: 'house', brief: v => v === 'classic' ? 'Classic rules' : 'House rules',
      help: (v, o) => {
        const bed = o?.become === 'treble' ? 'treble' : 'double';
        return v === 'classic'
          ? `No extras: only your own ${bed} makes you a killer, and the last player with a life left wins.`
          : `Hit someone else's ${bed} before you are a killer and they become one. A Shanghai on your own number (single, double and treble in one visit) wins the game outright.`;
      } },
  ],

  init(n, opts) {
    return {
      num: Array(n).fill(null),        // each player's number, once they have one
      lives: Array(n).fill(opts.lives ?? 5),
      killer: Array(n).fill(false),
      event: '',                       // what the last dart did, for the hint and the caller
    };
  },

  // Whose turn the engine skips: while numbers are being thrown for, anyone
  // who already has one; after that, anyone with no lives left.
  out(s, i) { return picking(s) ? s.num[i] != null : s.lives[i] <= 0; },

  dart(s, d) {
    const p = s.current;
    s.event = '';
    if (picking(s)) {
      if (d.mult && d.seg !== 25 && !s.num.includes(d.seg)) {
        s.num[p] = d.seg;
        s.event = `${s.players[p]} is ${d.seg}`;
        s.turnOver = true;  // one dart is all it takes: pull it and move on
      } else {
        s.event = (!d.mult ? 'Missed' : d.seg === 25 ? 'The bull doesn\'t count' : `${d.seg} is taken`) + ', throw again';
      }
      return;
    }

    // Whose number, if anyone's. Before you are a killer only the bed that makes
    // one counts; after, only the ones that take a life.
    const o = d.mult ? s.num.indexOf(d.seg) : -1;
    const makes = d.mult === becomeMult(s);
    if (o >= 0 && s.lives[o] > 0) {
      if (o === p) {
        if (s.killer[p]) { if (kills(s, d)) loseLife(s, p); }
        else if (makes) { s.killer[p] = true; s.event = `${s.players[p]} is a killer`; }
      } else if (s.killer[p]) { if (kills(s, d)) loseLife(s, o); }
      else if (makes && s.opts.mode === 'house' && !s.killer[o]) {
        s.killer[o] = true;
        s.event = `${s.players[o]} is a killer`;
      }
    }

    // Shanghai first: it wins even if its double cost a killer their last life.
    const mine = s.turn.filter(t => t.seg === s.num[p]).map(t => t.mult);
    if (s.opts.mode === 'house' && [1, 2, 3].every(m => mine.includes(m))) {
      s.event = 'Shanghai';
      s.winner = p;
      return;
    }
    const left = alive(s);
    if (left.length <= 1) s.winner = left[0] ?? p;
    else if (s.lives[p] <= 0) s.turnOver = true;  // knocked themselves out: visit over
  },

  summary(s, i) {
    const big = s.num[i] ?? '–';
    if (picking(s)) return { big, small: '' };
    if (s.lives[i] <= 0) return { big, small: 'Out', out: true };
    return { big, small: '♥'.repeat(s.lives[i]) + (s.killer[i] ? ' · KILLER' : '') };
  },

  // Spoken by the app after the dart itself.
  call(s) { return s.event; },

  hint(s) {
    if (s.turnOver) return s.event;
    const p = s.current;
    let tip;
    if (picking(s)) tip = 'Weak hand: one dart for your number';
    else if (!s.killer[p]) tip = `Hit ${becomeMult(s) === 3 ? 'T' : 'D'}${s.num[p]} to become a killer`;
    else {
      const bed = s.opts.kill === 'any' ? '' : 'D';
      tip = 'Killer: ' + alive(s).filter(i => i !== p).map(i => `${bed}${s.num[i]} ${s.players[i]}`).join(', ');
    }
    return [s.event, tip].filter(Boolean).join(' · ');
  },
};
